-- =====================================================================
-- Almie Bites — "Only what I pay" (manual) staff pay
--
-- earning_type 'manual': sales never calculate staff earnings. A staff
-- member's pay is exactly the payments the Admin records:
--   earnings in a period = payments dated in that period
--   earned total         = total paid
--   unpaid               = 0 (nothing accrues automatically)
-- This becomes the default and is applied to all current staff.
-- =====================================================================

alter table public.staff drop constraint if exists staff_earning_type_check;
alter table public.staff add constraint staff_earning_type_check
  check (earning_type in ('percentage', 'per_item', 'per_product', 'daily_tier', 'profit_share', 'after_recovery', 'manual'));
alter table public.sale_items drop constraint if exists sale_items_staff_earning_type_check;
alter table public.sale_items add constraint sale_items_staff_earning_type_check
  check (staff_earning_type in ('percentage', 'per_item', 'per_product', 'daily_tier', 'profit_share', 'after_recovery', 'manual'));
alter table public.staff alter column earning_type set default 'manual';

-- Current staff switch to manual pay (sale lines already recorded keep their snapshot).
update public.staff set earning_type = 'manual';

-- ---------------------------------------------------------------------
-- Admin report per staff member
-- ---------------------------------------------------------------------
create or replace function public.report_staff(p_start date, p_end date)
returns table (
  staff_id      uuid,
  full_name     text,
  staff_code    text,
  is_active     boolean,
  earning_type  text,
  transactions  integer,
  items_sold    numeric,
  sales_total   numeric,
  earnings      numeric,
  earned_total  numeric,
  paid_total    numeric,
  unpaid        numeric
)
language sql
stable
set search_path = ''
as $$
  with period as (
    select staff_id, sum(transactions)::int as transactions, sum(items_sold) as items_sold,
           sum(sales_total) as sales_total, sum(earnings) as earnings
    from private.staff_days(auth.uid(), p_start, p_end)
    group by staff_id
  ),
  earned as (
    select staff_id, sum(earnings) as total from private.staff_days(auth.uid(), null, null) group by staff_id
  ),
  paid as (
    select staff_id, coalesce(sum(amount), 0) as total
    from public.staff_payments where owner_id = auth.uid()
    group by staff_id
  ),
  paid_period as (
    select staff_id, coalesce(sum(amount), 0) as total
    from public.staff_payments
    where owner_id = auth.uid() and payment_date between p_start and p_end
    group by staff_id
  )
  select s.id, s.full_name, s.staff_code, s.is_active, s.earning_type,
         coalesce(p.transactions, 0), coalesce(p.items_sold, 0), coalesce(p.sales_total, 0),
         case when s.earning_type = 'manual' then coalesce(pp.total, 0) else coalesce(p.earnings, 0) end,
         case when s.earning_type = 'manual' then coalesce(pd.total, 0) else coalesce(e.total, 0) end,
         coalesce(pd.total, 0),
         case when s.earning_type = 'manual' then 0 else coalesce(e.total, 0) - coalesce(pd.total, 0) end
  from public.staff s
  left join period p on p.staff_id = s.id
  left join earned e on e.staff_id = s.id
  left join paid pd on pd.staff_id = s.id
  left join paid_period pp on pp.staff_id = s.id
  where s.owner_id = auth.uid()
  order by s.full_name;
$$;

-- Per staff per day; manual staff's earnings for a day = payments dated that day.
create or replace function public.report_staff_daily(p_start date, p_end date)
returns table (day date, staff_id uuid, transactions integer, items_sold numeric, sales_total numeric, earnings numeric)
language sql
stable
set search_path = ''
as $$
  with d as (
    select * from private.staff_days(auth.uid(), p_start, p_end)
  ),
  pay as (
    select payment_date as day, staff_id, sum(amount) as amount
    from public.staff_payments
    where owner_id = auth.uid() and payment_date between p_start and p_end
    group by 1, 2
  ),
  st as (
    select id, earning_type from public.staff where owner_id = auth.uid()
  )
  select coalesce(d.day, pay.day), coalesce(d.staff_id, pay.staff_id),
         coalesce(d.transactions, 0), coalesce(d.items_sold, 0), coalesce(d.sales_total, 0),
         case when st.earning_type = 'manual' then coalesce(pay.amount, 0) else coalesce(d.earnings, 0) end
  from d
  full join pay on pay.day = d.day and pay.staff_id = d.staff_id
  join st on st.id = coalesce(d.staff_id, pay.staff_id)
  where st.earning_type = 'manual' or d.staff_id is not null
  order by 1, 2;
$$;

-- ---------------------------------------------------------------------
-- Staff self-service summary
-- ---------------------------------------------------------------------
create or replace function public.staff_summary(p_start date, p_end date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.staff := private.require_active_staff();
  v_manual boolean;
  r jsonb;
begin
  v_manual := v.earning_type = 'manual';
  with days as (
    select * from private.staff_days(v.owner_id, p_start, p_end, v.id)
  ),
  pay_days as (
    select payment_date as day, sum(amount) as amount
    from public.staff_payments
    where staff_id = v.id and payment_date between p_start and p_end
    group by 1
  ),
  all_days as (
    select coalesce(d.day, pd.day) as day,
           coalesce(d.transactions, 0) as transactions,
           coalesce(d.items_sold, 0) as items_sold,
           coalesce(d.sales_total, 0) as sales_total,
           case when v_manual then coalesce(pd.amount, 0) else coalesce(d.earnings, 0) end as earnings
    from days d
    full join pay_days pd on pd.day = d.day
    where v_manual or d.day is not null
  ),
  lines as (
    select si.product_name, si.quantity, si.subtotal, si.staff_earning_amount
    from public.sales sa
    join public.sale_items si on si.sale_id = sa.id
    where sa.staff_id = v.id and sa.status = 'completed'
      and sa.sold_at >= (p_start::timestamp at time zone 'Asia/Manila')
      and sa.sold_at <  ((p_end + 1)::timestamp at time zone 'Asia/Manila')
  ),
  earned as (
    select coalesce(sum(earnings), 0) as t from private.staff_days(v.owner_id, null, null, v.id)
  ),
  paid as (
    select coalesce(sum(amount), 0) as t from public.staff_payments where staff_id = v.id
  )
  select jsonb_build_object(
    'transactions', (select coalesce(sum(transactions), 0) from all_days),
    'items_sold',   (select coalesce(sum(items_sold), 0) from all_days),
    'sales_total',  (select coalesce(sum(sales_total), 0) from all_days),
    'earnings',     (select coalesce(sum(earnings), 0) from all_days),
    'earned_total', case when v_manual then (select t from paid) else (select t from earned) end,
    'paid_total',   (select t from paid),
    'unpaid',       case when v_manual then 0 else (select t from earned) - (select t from paid) end,
    'products', coalesce((
      select jsonb_agg(x order by x.quantity desc) from (
        select product_name, sum(quantity) as quantity, sum(subtotal) as sales_total, sum(staff_earning_amount) as earnings
        from lines group by product_name) x), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'transactions', transactions, 'items_sold', items_sold,
                                          'sales_total', sales_total, 'earnings', earnings) order by day)
      from all_days), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.report_staff(date, date)',
    'public.report_staff_daily(date, date)',
    'public.staff_summary(date, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
