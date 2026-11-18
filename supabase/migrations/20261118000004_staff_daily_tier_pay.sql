-- =====================================================================
-- Almie Bites — Daily staff pay based on total sales (pay tiers)
--
-- New earning method 'daily_tier': a staff member's pay for a day is
-- the amount of the highest tier their TOTAL sales for that day reached.
--   Default tiers:  ₱2,000+ sales → ₱250,  ₱5,000+ sales → ₱500
--
-- The tiers in force are copied onto every sale (sales.pay_tiers), and a
-- day's pay uses the copy from that day's latest sale, so editing tiers
-- later never changes pay already earned.
-- =====================================================================

alter table public.staff drop constraint if exists staff_earning_type_check;
alter table public.staff add constraint staff_earning_type_check
  check (earning_type in ('percentage', 'per_item', 'per_product', 'daily_tier'));
alter table public.staff
  add column pay_tiers jsonb not null
    default '[{"min_sales": 2000, "pay": 250}, {"min_sales": 5000, "pay": 500}]'::jsonb
    check (jsonb_typeof(pay_tiers) = 'array');
alter table public.staff alter column earning_type set default 'daily_tier';

alter table public.sale_items drop constraint if exists sale_items_staff_earning_type_check;
alter table public.sale_items add constraint sale_items_staff_earning_type_check
  check (staff_earning_type in ('percentage', 'per_item', 'per_product', 'daily_tier'));

alter table public.sales add column pay_tiers jsonb;

-- Current staff move to daily tier pay (no staff sales existed yet).
update public.staff set earning_type = 'daily_tier';

-- ---------------------------------------------------------------------
-- Pay for a day's total sales under a tier list.
-- ---------------------------------------------------------------------
create or replace function private.tier_pay(p_tiers jsonb, p_sales numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce((
    select (t ->> 'pay')::numeric
    from jsonb_array_elements(coalesce(p_tiers, '[]'::jsonb)) t
    where (t ->> 'min_sales')::numeric <= coalesce(p_sales, 0)
    order by (t ->> 'min_sales')::numeric desc
    limit 1), 0);
$$;

-- ---------------------------------------------------------------------
-- Per staff per day totals incl. tier pay. SECURITY INVOKER: callers only
-- see rows RLS allows (owners: their business; staff: nothing directly).
-- ---------------------------------------------------------------------
create or replace function private.staff_days(p_owner uuid, p_start date, p_end date, p_staff_id uuid default null)
returns table (
  staff_id      uuid,
  day           date,
  transactions  integer,
  items_sold    numeric,
  sales_total   numeric,
  line_earnings numeric,
  tier_pay      numeric,
  earnings      numeric
)
language sql
stable
set search_path = ''
as $$
  with d as (
    select sa.staff_id,
           private.manila_date(sa.sold_at) as day,
           count(distinct sa.id)::int as transactions,
           sum(si.quantity) as items_sold,
           sum(si.subtotal) as sales_total,
           sum(si.staff_earning_amount) as line_earnings,
           coalesce(sum(si.subtotal) filter (where si.staff_earning_type = 'daily_tier'), 0) as tier_sales,
           (array_agg(sa.pay_tiers order by sa.sold_at desc) filter (where si.staff_earning_type = 'daily_tier'))[1] as tiers
    from public.sales sa
    join public.sale_items si on si.sale_id = sa.id
    where sa.owner_id = p_owner and sa.status = 'completed' and sa.staff_id is not null
      and (p_staff_id is null or sa.staff_id = p_staff_id)
      and (p_start is null or sa.sold_at >= (p_start::timestamp at time zone 'Asia/Manila'))
      and (p_end   is null or sa.sold_at <  ((p_end + 1)::timestamp at time zone 'Asia/Manila'))
    group by 1, 2
  )
  select staff_id, day, transactions, items_sold, sales_total, line_earnings,
         case when tier_sales > 0 then private.tier_pay(tiers, tier_sales) else 0 end,
         line_earnings + case when tier_sales > 0 then private.tier_pay(tiers, tier_sales) else 0 end
  from d;
$$;

-- ---------------------------------------------------------------------
-- Sale lines: daily_tier lines carry no per-line earning; the sale keeps
-- a copy of the tiers.
-- ---------------------------------------------------------------------
create or replace function private.insert_sale_items(
  p_owner   uuid,
  p_sale_id uuid,
  p_items   jsonb,
  p_staff_id uuid default null,
  p_staff_restricted boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line    jsonb;
  v_product public.products%rowtype;
  v_staff   public.staff%rowtype;
  v_qty     numeric;
  v_price   numeric;
  v_cost    numeric;
  v_assign  public.staff_product_assignments%rowtype;
  v_etype   text;
  v_erate   numeric;
  v_eamt    numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product to the sale.' using errcode = '22023';
  end if;

  if p_staff_id is not null then
    select * into v_staff from public.staff where id = p_staff_id and owner_id = p_owner;
    if not found then
      raise exception 'Staff member not found.' using errcode = 'P0002';
    end if;
  end if;

  for v_line in select * from jsonb_array_elements(p_items) loop
    select * into v_product from public.products
    where id = (v_line ->> 'product_id')::uuid and owner_id = p_owner;
    if not found then
      raise exception 'Product not found.' using errcode = 'P0002';
    end if;

    v_assign := null;
    if p_staff_id is not null then
      select * into v_assign from public.staff_product_assignments
      where staff_id = p_staff_id and product_id = v_product.id;
    end if;

    if p_staff_restricted then
      if v_assign.id is null then
        raise exception 'You are not assigned to sell "%".', v_product.name using errcode = '42501';
      end if;
      if not v_product.is_available then
        raise exception '"%" is currently unavailable.', v_product.name using errcode = '22023';
      end if;
      v_price := v_product.selling_price;
    else
      v_price := coalesce((v_line ->> 'unit_price')::numeric, v_product.selling_price);
    end if;

    v_qty := (v_line ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantity for "%" must be greater than zero.', v_product.name using errcode = '22023';
    end if;
    if v_price < 0 then
      raise exception 'Price for "%" cannot be negative.', v_product.name using errcode = '22023';
    end if;

    select coalesce(sum(r.quantity_used * i.purchase_price), 0) into v_cost
    from public.product_recipes r
    join public.inventory_items i on i.id = r.inventory_item_id
    where r.product_id = v_product.id;

    v_etype := null; v_erate := 0; v_eamt := 0;
    if p_staff_id is not null then
      v_etype := v_staff.earning_type;
      case v_staff.earning_type
        when 'percentage' then
          v_erate := v_staff.commission_rate;
          v_eamt  := round(v_qty * v_price * v_staff.commission_rate / 100, 2);
        when 'per_item' then
          v_erate := v_staff.rate_per_item;
          v_eamt  := round(v_qty * v_staff.rate_per_item, 2);
        when 'per_product' then
          v_erate := coalesce(v_assign.earning_rate, 0);
          v_eamt  := round(v_qty * coalesce(v_assign.earning_rate, 0), 2);
        else
          v_erate := 0;   -- daily_tier: pay is worked out per day from total sales
          v_eamt  := 0;
      end case;
    end if;

    insert into public.sale_items
      (owner_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost,
       staff_earning_type, staff_earning_rate, staff_earning_amount)
    values
      (p_owner, p_sale_id, v_product.id, v_product.name, v_qty, v_price, v_cost,
       v_etype, v_erate, v_eamt);
  end loop;

  update public.sales s
  set total_amount = t.amount, total_cost = t.cost, total_staff_earnings = t.earn,
      pay_tiers = case when v_staff.earning_type = 'daily_tier' then v_staff.pay_tiers else null end
  from (
    select coalesce(sum(subtotal), 0) as amount,
           round(coalesce(sum(quantity * unit_cost), 0), 2) as cost,
           coalesce(sum(staff_earning_amount), 0) as earn
    from public.sale_items where sale_id = p_sale_id
  ) t
  where s.id = p_sale_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Admin: save earning setup (now incl. tiers) + assignments
-- ---------------------------------------------------------------------
create or replace function public.save_staff_rates(p_staff_id uuid, p_data jsonb, p_assignments jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid := private.require_user();
  v_tiers jsonb := p_data -> 'pay_tiers';
begin
  if v_tiers is not null then
    if jsonb_typeof(v_tiers) <> 'array' or exists (
      select 1 from jsonb_array_elements(v_tiers) t
      where jsonb_typeof(t) <> 'object'
         or (t ->> 'min_sales') is null or (t ->> 'pay') is null
         or (t ->> 'min_sales')::numeric < 0 or (t ->> 'pay')::numeric < 0) then
      raise exception 'Each pay tier needs a sales amount and a pay amount of ₱0 or more.' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('min_sales', (t ->> 'min_sales')::numeric, 'pay', (t ->> 'pay')::numeric)
                              order by (t ->> 'min_sales')::numeric), '[]'::jsonb)
      into v_tiers from jsonb_array_elements(v_tiers) t;
  end if;

  update public.staff set
    earning_type    = coalesce(nullif(p_data ->> 'earning_type', ''), earning_type),
    commission_rate = coalesce(nullif(p_data ->> 'commission_rate', '')::numeric, commission_rate),
    rate_per_item   = coalesce(nullif(p_data ->> 'rate_per_item', '')::numeric, rate_per_item),
    pay_tiers       = coalesce(v_tiers, pay_tiers)
  where id = p_staff_id and owner_id = v_owner;
  if not found then
    raise exception 'Staff member not found.' using errcode = 'P0002';
  end if;

  delete from public.staff_product_assignments
  where staff_id = p_staff_id
    and product_id not in (
      select (a ->> 'product_id')::uuid from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) a);

  insert into public.staff_product_assignments (owner_id, staff_id, product_id, earning_rate)
  select v_owner, p_staff_id, (a ->> 'product_id')::uuid, coalesce(nullif(a ->> 'earning_rate', '')::numeric, 0)
  from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) a
  on conflict (staff_id, product_id) do update set earning_rate = excluded.earning_rate;
end;
$$;

-- ---------------------------------------------------------------------
-- Reports now use per-day totals (tier pay included)
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
  )
  select s.id, s.full_name, s.staff_code, s.is_active, s.earning_type,
         coalesce(p.transactions, 0), coalesce(p.items_sold, 0), coalesce(p.sales_total, 0), coalesce(p.earnings, 0),
         coalesce(e.total, 0), coalesce(pd.total, 0), coalesce(e.total, 0) - coalesce(pd.total, 0)
  from public.staff s
  left join period p on p.staff_id = s.id
  left join earned e on e.staff_id = s.id
  left join paid pd on pd.staff_id = s.id
  where s.owner_id = auth.uid()
  order by s.full_name;
$$;

create or replace function public.report_staff_daily(p_start date, p_end date)
returns table (day date, staff_id uuid, transactions integer, items_sold numeric, sales_total numeric, earnings numeric)
language sql
stable
set search_path = ''
as $$
  select day, staff_id, transactions, items_sold, sales_total, earnings
  from private.staff_days(auth.uid(), p_start, p_end)
  order by day, staff_id;
$$;

-- ---------------------------------------------------------------------
-- Staff self-service: profile now includes tiers; summary uses per-day pay
-- ---------------------------------------------------------------------
create or replace function public.staff_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.staff := private.require_active_staff();
  b public.business_settings;
begin
  select * into b from public.business_settings where owner_id = v.owner_id;
  return jsonb_build_object(
    'id', v.id,
    'full_name', v.full_name,
    'staff_code', v.staff_code,
    'email', v.email,
    'phone', v.phone,
    'earning_type', v.earning_type,
    'commission_rate', v.commission_rate,
    'rate_per_item', v.rate_per_item,
    'pay_tiers', v.pay_tiers,
    'created_at', v.created_at,
    'business_name', coalesce(b.business_name, 'Almie Bites'),
    'logo_url', b.logo_url,
    'payment_methods', coalesce((
      select jsonb_agg(name order by sort_order, name) from public.categories
      where owner_id = v.owner_id and type = 'payment'), '["Cash","GCash","Other"]'::jsonb)
  );
end;
$$;

create or replace function public.staff_products()
returns table (
  product_id    uuid,
  name          text,
  category      text,
  description   text,
  selling_price numeric,
  is_available  boolean,
  earning_per_item numeric,
  available_qty numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.staff := private.require_active_staff();
begin
  return query
  select p.id, p.name, p.category, p.description, p.selling_price, p.is_available,
         round(case v.earning_type
           when 'percentage' then p.selling_price * v.commission_rate / 100
           when 'per_item' then v.rate_per_item
           when 'per_product' then a.earning_rate
           else 0 end, 2),
         (select floor(min(i.current_stock / r.quantity_used))
            from public.product_recipes r join public.inventory_items i on i.id = r.inventory_item_id
           where r.product_id = p.id)
  from public.staff_product_assignments a
  join public.products p on p.id = a.product_id
  where a.staff_id = v.id
  order by p.name;
end;
$$;

create or replace function public.staff_summary(p_start date, p_end date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.staff := private.require_active_staff();
  r jsonb;
begin
  with days as (
    select * from private.staff_days(v.owner_id, p_start, p_end, v.id)
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
    'transactions', (select coalesce(sum(transactions), 0) from days),
    'items_sold',   (select coalesce(sum(items_sold), 0) from days),
    'sales_total',  (select coalesce(sum(sales_total), 0) from days),
    'earnings',     (select coalesce(sum(earnings), 0) from days),
    'earned_total', (select t from earned),
    'paid_total',   (select t from paid),
    'unpaid',       (select t from earned) - (select t from paid),
    'products', coalesce((
      select jsonb_agg(x order by x.quantity desc) from (
        select product_name, sum(quantity) as quantity, sum(subtotal) as sales_total, sum(staff_earning_amount) as earnings
        from lines group by product_name) x), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'transactions', transactions, 'items_sold', items_sold,
                                          'sales_total', sales_total, 'earnings', earnings) order by day)
      from days), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------
revoke all on function private.tier_pay(jsonb, numeric) from public, anon;
revoke all on function private.staff_days(uuid, date, date, uuid) from public, anon;
grant execute on function private.tier_pay(jsonb, numeric) to authenticated;
grant execute on function private.staff_days(uuid, date, date, uuid) to authenticated;
