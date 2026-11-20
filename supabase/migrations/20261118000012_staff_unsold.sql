-- =====================================================================
-- Almie Bites — staff: unsold products for a past day
--
-- For the signed-in staff member and a day (e.g. yesterday): every product
-- they had that day with assigned / sold / unsold quantities. Juice income
-- recorded from extra cash (sales.is_cash_over) is not counted as sold.
-- Run after 20261118000011_staff_cash_juice.sql.
-- =====================================================================

create or replace function public.staff_unsold(p_date date)
returns table (
  product_id    uuid,
  name          text,
  selling_price numeric,
  assigned_qty  numeric,   -- null = no set quantity that day
  sold_qty      numeric,
  unsold_qty    numeric,   -- null when there was no set quantity
  unsold_value  numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.staff := private.require_active_staff();
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if p_date is null or p_date > v_today or p_date < v_today - 60 then
    raise exception 'Choose a day within the last 60 days.' using errcode = '22023';
  end if;

  return query
  with mine as (
    select dp.product_id, sum(dp.quantity) as quantity
    from private.staff_day_products(v.id, p_date) dp
    group by dp.product_id
  ),
  sold as (
    select si.product_id, sum(si.quantity) as qty
    from public.sales sa join public.sale_items si on si.sale_id = sa.id
    where sa.staff_id = v.id and sa.status = 'completed' and not sa.is_cash_over
      and sa.sold_at >= (p_date::timestamp at time zone 'Asia/Manila')
      and sa.sold_at <  ((p_date + 1)::timestamp at time zone 'Asia/Manila')
    group by si.product_id
  )
  select p.id, p.name, p.selling_price, m.quantity,
         coalesce(s.qty, 0),
         case when m.quantity is null then null else greatest(m.quantity - coalesce(s.qty, 0), 0) end,
         case when m.quantity is null then 0
              else round(greatest(m.quantity - coalesce(s.qty, 0), 0) * p.selling_price, 2) end
  from mine m
  join public.products p on p.id = m.product_id
  left join sold s on s.product_id = m.product_id
  order by 7 desc, p.name;
end;
$$;

revoke execute on function public.staff_unsold(date) from public, anon;
grant execute on function public.staff_unsold(date) to authenticated;

-- ---------------------------------------------------------------------
-- Admin: every staff member's products for a day with unsold quantities.
-- ---------------------------------------------------------------------
create or replace function public.report_unsold(p_date date)
returns table (
  staff_id      uuid,
  staff_name    text,
  is_active     boolean,
  product_id    uuid,
  product_name  text,
  selling_price numeric,
  assigned_qty  numeric,   -- null = no set quantity that day
  sold_qty      numeric,
  unsold_qty    numeric,   -- null when there was no set quantity
  unsold_value  numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.require_user();
begin
  return query
  with st as (
    select s.id, s.full_name, s.is_active
    from public.staff s
    where s.owner_id = v_owner
  ),
  mine as (
    select st.id as staff_id, dp.product_id, sum(dp.quantity) as quantity
    from st cross join lateral private.staff_day_products(st.id, p_date) dp
    where st.is_active
       or exists (select 1 from public.daily_assignments d where d.staff_id = st.id and d.assign_date = p_date)
    group by 1, 2
  ),
  sold as (
    select sa.staff_id, si.product_id, sum(si.quantity) as qty
    from public.sales sa join public.sale_items si on si.sale_id = sa.id
    where sa.owner_id = v_owner and sa.status = 'completed' and not sa.is_cash_over
      and sa.staff_id is not null
      and sa.sold_at >= (p_date::timestamp at time zone 'Asia/Manila')
      and sa.sold_at <  ((p_date + 1)::timestamp at time zone 'Asia/Manila')
    group by 1, 2
  )
  select st.id, st.full_name, st.is_active, p.id, p.name, p.selling_price, m.quantity,
         coalesce(s.qty, 0),
         case when m.quantity is null then null else greatest(m.quantity - coalesce(s.qty, 0), 0) end,
         case when m.quantity is null then 0
              else round(greatest(m.quantity - coalesce(s.qty, 0), 0) * p.selling_price, 2) end
  from mine m
  join st on st.id = m.staff_id
  join public.products p on p.id = m.product_id
  left join sold s on s.staff_id = m.staff_id and s.product_id = m.product_id
  order by st.full_name, 10 desc, p.name;
end;
$$;

revoke execute on function public.report_unsold(date) from public, anon;
grant execute on function public.report_unsold(date) to authenticated;
