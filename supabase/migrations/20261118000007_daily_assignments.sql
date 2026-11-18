-- =====================================================================
-- Almie Bites — Daily product assignments + sales monitoring
--
-- daily_assignments: products (and optional quantities) the Admin gives a
-- staff member for one Manila day. On a day with daily assignments, the
-- staff member may sell ONLY those products (and not more than the
-- assigned quantity). On a day without any, their regular product
-- assignments (staff_product_assignments) apply as before.
--
-- Inventory sync is unchanged: each sale deducts the linked inventory item
-- inside the same transaction, and record_sale's client_ref prevents a
-- repeated submit from deducting twice.
-- =====================================================================

create table public.daily_assignments (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  staff_id    uuid not null references public.staff(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  assign_date date not null default ((now() at time zone 'Asia/Manila')::date),
  quantity    numeric(12,3) check (quantity is null or quantity > 0),
  created_at  timestamptz not null default now(),
  unique (staff_id, product_id, assign_date)
);
create index daily_assignments_owner_date_idx on public.daily_assignments (owner_id, assign_date);
create index daily_assignments_staff_date_idx on public.daily_assignments (staff_id, assign_date);

alter table public.daily_assignments enable row level security;
create policy "daily: owner read" on public.daily_assignments for select to authenticated using (owner_id = (select auth.uid()));
create policy "daily: owner insert" on public.daily_assignments for insert to authenticated with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.staff s where s.id = staff_id and s.owner_id = (select auth.uid()))
  and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
);
create policy "daily: owner update" on public.daily_assignments for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.staff s where s.id = staff_id and s.owner_id = (select auth.uid()))
    and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
  );
create policy "daily: owner delete" on public.daily_assignments for delete to authenticated using (owner_id = (select auth.uid()));
create policy "deny staff direct access" on public.daily_assignments as restrictive for all to authenticated
  using (not (select private.is_staff_user())) with check (not (select private.is_staff_user()));
revoke all on public.daily_assignments from anon;
grant select, insert, update, delete on public.daily_assignments to authenticated;

-- ---------------------------------------------------------------------
-- What a staff member may sell on a day
-- ---------------------------------------------------------------------
create or replace function private.staff_day_products(p_staff_id uuid, p_day date)
returns table (product_id uuid, quantity numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select d.product_id, d.quantity
  from public.daily_assignments d
  where d.staff_id = p_staff_id and d.assign_date = p_day
  union all
  select a.product_id, null::numeric
  from public.staff_product_assignments a
  where a.staff_id = p_staff_id
    and not exists (select 1 from public.daily_assignments d where d.staff_id = p_staff_id and d.assign_date = p_day);
$$;

-- Quantity of a product a staff member sold on a day (completed sales).
create or replace function private.staff_sold_on(p_staff_id uuid, p_product uuid, p_day date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(si.quantity), 0)
  from public.sale_items si
  join public.sales sa on sa.id = si.sale_id
  where sa.staff_id = p_staff_id and sa.status = 'completed' and si.product_id = p_product
    and sa.sold_at >= (p_day::timestamp at time zone 'Asia/Manila')
    and sa.sold_at <  ((p_day + 1)::timestamp at time zone 'Asia/Manila');
$$;

-- ---------------------------------------------------------------------
-- Admin: replace one staff member's assignments for one day atomically.
--   p_items: [{product_id, quantity|null}]  (empty array clears the day)
-- ---------------------------------------------------------------------
create or replace function public.save_daily_assignments(p_staff_id uuid, p_date date, p_items jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid := private.require_user();
begin
  if not exists (select 1 from public.staff where id = p_staff_id and owner_id = v_owner) then
    raise exception 'Staff member not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
             where nullif(i ->> 'quantity', '') is not null and (i ->> 'quantity')::numeric <= 0) then
    raise exception 'Assigned quantities must be more than 0 (leave blank for no limit).' using errcode = '22023';
  end if;
  delete from public.daily_assignments where staff_id = p_staff_id and assign_date = p_date;
  insert into public.daily_assignments (owner_id, staff_id, product_id, assign_date, quantity)
  select v_owner, p_staff_id, (i ->> 'product_id')::uuid, p_date, nullif(i ->> 'quantity', '')::numeric
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i;
end;
$$;

-- ---------------------------------------------------------------------
-- Admin monitoring: per staff × product for a day.
-- Includes assigned products (even with 0 sales) and anything sold.
-- ---------------------------------------------------------------------
create or replace function public.report_daily_assignments(p_date date)
returns table (
  staff_id        uuid,
  staff_name      text,
  product_id      uuid,
  product_name    text,
  source          text,      -- 'daily' | 'regular' | 'unassigned'
  assigned_qty    numeric,
  sold_qty        numeric,
  sales_total     numeric,
  remaining_qty   numeric,   -- assigned − sold (null when no quantity set)
  inventory_left  numeric,   -- pieces/units the linked inventory can still make (null if not linked)
  zero_sales      boolean
)
language sql
stable
set search_path = ''
as $$
  with st as (
    select s.id, s.full_name,
           exists (select 1 from public.daily_assignments d where d.staff_id = s.id and d.assign_date = p_date) as has_daily
    from public.staff s
    where s.owner_id = auth.uid() and s.is_active
  ),
  assigned as (
    select st.id as staff_id, d.product_id, 'daily'::text as source, d.quantity
    from st join public.daily_assignments d on d.staff_id = st.id and d.assign_date = p_date
    union all
    select st.id, a.product_id, 'regular', null::numeric
    from st join public.staff_product_assignments a on a.staff_id = st.id
    where not st.has_daily
  ),
  sold as (
    select sa.staff_id, si.product_id, sum(si.quantity) as qty, sum(si.subtotal) as amount
    from public.sales sa
    join public.sale_items si on si.sale_id = sa.id
    where sa.owner_id = auth.uid() and sa.status = 'completed' and sa.staff_id is not null and si.product_id is not null
      and sa.sold_at >= (p_date::timestamp at time zone 'Asia/Manila')
      and sa.sold_at <  ((p_date + 1)::timestamp at time zone 'Asia/Manila')
    group by 1, 2
  ),
  combined as (
    select coalesce(a.staff_id, so.staff_id) as staff_id,
           coalesce(a.product_id, so.product_id) as product_id,
           coalesce(a.source, 'unassigned') as source,
           a.quantity as assigned_qty,
           coalesce(so.qty, 0) as sold_qty,
           coalesce(so.amount, 0) as sales_total
    from assigned a
    full join sold so on so.staff_id = a.staff_id and so.product_id = a.product_id
  )
  select c.staff_id, s.full_name, c.product_id, p.name, c.source, c.assigned_qty, c.sold_qty, c.sales_total,
         case when c.assigned_qty is null then null else c.assigned_qty - c.sold_qty end,
         (select floor(min(i.current_stock / r.quantity_used))
            from public.product_recipes r join public.inventory_items i on i.id = r.inventory_item_id
           where r.product_id = c.product_id),
         c.sold_qty = 0
  from combined c
  join public.staff s on s.id = c.staff_id
  join public.products p on p.id = c.product_id
  where s.owner_id = auth.uid()
  order by s.full_name, (c.sold_qty = 0) desc, p.name;
$$;

-- ---------------------------------------------------------------------
-- Staff: today's products with assigned / sold / remaining / sales.
-- (return type changes, so drop and recreate)
-- ---------------------------------------------------------------------
drop function if exists public.staff_products();
create function public.staff_products()
returns table (
  product_id       uuid,
  name             text,
  category         text,
  description      text,
  selling_price    numeric,
  is_available     boolean,
  earning_per_item numeric,
  available_qty    numeric,   -- what inventory can still make (null if not linked)
  assigned_qty     numeric,   -- today's assigned quantity (null = no limit)
  sold_today       numeric,
  sales_today      numeric,
  remaining_qty    numeric,   -- what this staff member can still sell today (null = no limit)
  is_daily         boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.staff := private.require_active_staff();
  v_day date := (now() at time zone 'Asia/Manila')::date;
begin
  return query
  with mine as (
    select dp.product_id, dp.quantity
    from private.staff_day_products(v.id, v_day) dp
  ),
  sold as (
    select si.product_id, sum(si.quantity) as qty, sum(si.subtotal) as amount
    from public.sales sa join public.sale_items si on si.sale_id = sa.id
    where sa.staff_id = v.id and sa.status = 'completed'
      and sa.sold_at >= (v_day::timestamp at time zone 'Asia/Manila')
      and sa.sold_at <  ((v_day + 1)::timestamp at time zone 'Asia/Manila')
    group by si.product_id
  ),
  base as (
    select p.*, m.quantity as assigned_qty, coalesce(s.qty, 0) as sold_qty, coalesce(s.amount, 0) as sold_amount,
           (select floor(min(i.current_stock / r.quantity_used))
              from public.product_recipes r join public.inventory_items i on i.id = r.inventory_item_id
             where r.product_id = p.id) as inv_qty,
           a.earning_rate as rate
    from mine m
    join public.products p on p.id = m.product_id
    left join sold s on s.product_id = p.id
    left join public.staff_product_assignments a on a.staff_id = v.id and a.product_id = p.id
  )
  select b.id, b.name, b.category, b.description, b.selling_price, b.is_available,
         round(case v.earning_type
           when 'percentage' then b.selling_price * v.commission_rate / 100
           when 'per_item' then v.rate_per_item
           when 'per_product' then coalesce(b.rate, 0)
           else 0 end, 2),
         b.inv_qty,
         b.assigned_qty,
         b.sold_qty,
         b.sold_amount,
         case when b.assigned_qty is null then null
              else greatest(b.assigned_qty - b.sold_qty, 0) end,
         exists (select 1 from public.daily_assignments d where d.staff_id = v.id and d.assign_date = v_day)
  from base b
  order by (b.sold_qty = 0) desc, b.name;
end;
$$;

-- ---------------------------------------------------------------------
-- Sale lines: enforce daily assignments + assigned quantities for staff
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
  v_when    timestamptz;
  v_day     date;
  v_rt      public.recovery_targets%rowtype;
  v_before  numeric;
  v_sub     numeric;
  v_excess  numeric;
  v_allowed boolean;
  v_limit   numeric;
  v_sold    numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product to the sale.' using errcode = '22023';
  end if;

  select sold_at into v_when from public.sales where id = p_sale_id;
  v_day := private.manila_date(v_when);

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
      -- today's daily assignment if there is one, otherwise the regular assignment
      select true, dp.quantity into v_allowed, v_limit
      from private.staff_day_products(p_staff_id, v_day) dp
      where dp.product_id = v_product.id
      limit 1;
      if not coalesce(v_allowed, false) then
        raise exception 'You are not assigned to sell "%" today.', v_product.name using errcode = '42501';
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

    -- staff can't sell more than the quantity assigned to them today
    if p_staff_restricted and v_limit is not null then
      v_sold := private.staff_sold_on(p_staff_id, v_product.id, v_day);
      if v_sold + v_qty > v_limit then
        raise exception 'Only % "%" left of the % assigned to you today.',
          trim_scale(greatest(v_limit - v_sold, 0)), v_product.name, trim_scale(v_limit) using errcode = '22023';
      end if;
    end if;
    v_allowed := null; v_limit := null;

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
        when 'after_recovery' then
          -- commission only on the part of this line above the product's recovery target
          v_erate := v_staff.commission_rate;
          v_sub := round(v_qty * v_price, 2);
          select * into v_rt from public.recovery_targets
          where owner_id = p_owner and product_id = v_product.id
            and start_date <= v_day and (end_date is null or end_date >= v_day)
          order by start_date desc limit 1;
          if v_rt.id is null then
            v_excess := v_sub;   -- no expense to recover for this product
          else
            v_before := private.product_sales_between(p_owner, v_product.id, v_rt.start_date, coalesce(v_rt.end_date, v_day));
            v_excess := greatest(v_before + v_sub - v_rt.target_amount, 0) - greatest(v_before - v_rt.target_amount, 0);
          end if;
          v_eamt := round(v_excess * v_staff.commission_rate / 100, 2);
          v_rt := null;
        when 'profit_share' then
          -- share of gross profit: (price - cost per piece) x qty x %
          v_erate := v_staff.commission_rate;
          v_eamt  := round(greatest(v_qty * (v_price - v_cost), 0) * v_staff.commission_rate / 100, 2);
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

revoke all on function private.staff_day_products(uuid, date) from public, anon, authenticated;
revoke all on function private.staff_sold_on(uuid, uuid, date) from public, anon, authenticated;
revoke all on function private.insert_sale_items(uuid, uuid, jsonb, uuid, boolean) from public, anon, authenticated;
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.save_daily_assignments(uuid, date, jsonb)',
    'public.report_daily_assignments(date)',
    'public.staff_products()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.daily_assignments;
  end if;
end;
$$;
