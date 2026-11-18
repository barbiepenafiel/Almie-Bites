-- =====================================================================
-- Almie Bites — Staff accounts, staff sales, earnings and payroll
--
-- Roles
--   Admin : the business owner (the auth user that owns business_settings).
--   Staff : an auth user created by the Admin (app_metadata.role = 'staff')
--           and linked to the Admin's business through public.staff.
--
-- Security model
--   * Staff NEVER read tables directly. A RESTRICTIVE policy on every
--     business table denies staff, so sale costs, expenses, inventory
--     costs and other staff members' data cannot be queried.
--   * Staff use SECURITY DEFINER functions (staff_*) that always resolve
--     "who am I" from auth.uid() and return only safe columns.
--   * Staff earnings are snapshotted on each sale line (type, rate, amount)
--     so later rate changes never alter recorded earnings.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.staff (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_id         uuid unique references auth.users(id) on delete set null,
  full_name       text not null check (length(btrim(full_name)) between 1 and 100),
  staff_code      text check (staff_code is null or length(btrim(staff_code)) between 1 and 30),
  email           text,
  phone           text,
  is_active       boolean not null default true,
  earning_type    text not null default 'per_product'
                  check (earning_type in ('percentage', 'per_item', 'per_product')),
  commission_rate numeric(5,2) not null default 0 check (commission_rate between 0 and 100), -- % for 'percentage'
  rate_per_item   numeric(12,2) not null default 0 check (rate_per_item >= 0),               -- ₱ for 'per_item'
  payout_method   text not null default 'Cash',
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index staff_owner_code_key on public.staff (owner_id, lower(staff_code)) where staff_code is not null;
create index staff_owner_idx on public.staff (owner_id, is_active);
create trigger trg_staff_updated before update on public.staff for each row execute function private.set_updated_at();

-- Which products a staff member may sell, and the per-product earning rate
-- (used when earning_type = 'per_product').
create table public.staff_product_assignments (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  staff_id     uuid not null references public.staff(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  earning_rate numeric(12,2) not null default 0 check (earning_rate >= 0),
  created_at   timestamptz not null default now(),
  unique (staff_id, product_id)
);
create index staff_assignments_product_idx on public.staff_product_assignments (product_id);
create index staff_assignments_owner_idx on public.staff_product_assignments (owner_id);

create table public.staff_payments (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  staff_id       uuid not null references public.staff(id) on delete restrict,
  amount         numeric(12,2) not null check (amount > 0),
  payment_method text not null default 'Cash',
  payment_date   date not null default ((now() at time zone 'Asia/Manila')::date),
  period_start   date,
  period_end     date,
  notes          text,
  recorded_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  check (period_start is null or period_end is null or period_end >= period_start)
);
create index staff_payments_staff_idx on public.staff_payments (staff_id, payment_date desc);
create index staff_payments_owner_idx on public.staff_payments (owner_id, payment_date desc);

-- Sales: who sold it, who typed it in, duplicate-submit protection.
alter table public.sales
  add column staff_id             uuid references public.staff(id) on delete restrict,
  add column recorded_by          uuid default auth.uid() references auth.users(id) on delete set null,
  add column client_ref           uuid,
  add column total_staff_earnings numeric(12,2) not null default 0 check (total_staff_earnings >= 0);
create index sales_staff_idx on public.sales (staff_id, sold_at desc);
create unique index sales_owner_client_ref_key on public.sales (owner_id, client_ref) where client_ref is not null;

-- Sale lines: historical snapshot of the staff earning.
alter table public.sale_items
  add column staff_earning_type   text check (staff_earning_type in ('percentage', 'per_item', 'per_product')),
  add column staff_earning_rate   numeric(12,4) not null default 0 check (staff_earning_rate >= 0),
  add column staff_earning_amount numeric(12,2) not null default 0 check (staff_earning_amount >= 0);

-- ---------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------
-- True for any staff login (active or not). Used by RLS to deny staff
-- every direct table read/write.
create or replace function private.is_staff_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'staff', false)
      or exists (select 1 from public.staff where user_id = auth.uid());
$$;

-- The active staff record of the current login (null if none / inactive).
create or replace function private.current_staff()
returns public.staff
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.staff where user_id = auth.uid() and is_active limit 1;
$$;

-- Owner-only gate. Every existing admin function (expenses, stock,
-- products, void/delete sale, …) starts with private.require_user(), so
-- redefining it here locks all of them to non-staff logins.
create or replace function private.require_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if private.is_staff_user() then
    raise exception 'This action is only available to the owner.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function private.require_active_staff()
returns public.staff
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.staff;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  v := private.current_staff();
  if v.id is null then
    raise exception 'Your staff account is inactive or not found. Please contact the owner.' using errcode = '42501';
  end if;
  return v;
end;
$$;

create or replace function private.is_business_owner(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.business_settings where owner_id = p_uid)
     and not exists (select 1 from public.staff where user_id = p_uid);
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.staff                     enable row level security;
alter table public.staff_product_assignments enable row level security;
alter table public.staff_payments            enable row level security;

create policy "staff: owner read"   on public.staff for select to authenticated using (owner_id = (select auth.uid()));
create policy "staff: owner insert" on public.staff for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "staff: owner update" on public.staff for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "assignments: owner read" on public.staff_product_assignments for select to authenticated using (owner_id = (select auth.uid()));
create policy "assignments: owner write" on public.staff_product_assignments for insert to authenticated with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.staff s where s.id = staff_id and s.owner_id = (select auth.uid()))
  and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
);
create policy "assignments: owner update" on public.staff_product_assignments for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.staff s where s.id = staff_id and s.owner_id = (select auth.uid()))
    and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
  );
create policy "assignments: owner delete" on public.staff_product_assignments for delete to authenticated using (owner_id = (select auth.uid()));

create policy "staff_payments: owner read" on public.staff_payments for select to authenticated using (owner_id = (select auth.uid()));
create policy "staff_payments: owner insert" on public.staff_payments for insert to authenticated with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.staff s where s.id = staff_id and s.owner_id = (select auth.uid()))
);
create policy "staff_payments: owner update" on public.staff_payments for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and exists (select 1 from public.staff s where s.id = staff_id and s.owner_id = (select auth.uid())));
create policy "staff_payments: owner delete" on public.staff_payments for delete to authenticated using (owner_id = (select auth.uid()));

-- Deny staff logins every direct table access (they use staff_* functions).
do $$
declare
  t text;
begin
  foreach t in array array[
    'business_settings', 'categories', 'inventory_items', 'products', 'product_recipes',
    'sales', 'sale_items', 'expenses', 'inventory_movements',
    'staff', 'staff_product_assignments', 'staff_payments'
  ] loop
    execute format(
      'create policy "deny staff direct access" on public.%I as restrictive for all to authenticated
         using (not (select private.is_staff_user())) with check (not (select private.is_staff_user()))', t);
  end loop;
end;
$$;

revoke all on public.staff, public.staff_product_assignments, public.staff_payments from anon;
grant select, insert, update on public.staff to authenticated;
grant select, insert, update, delete on public.staff_product_assignments, public.staff_payments to authenticated;
grant execute on function private.is_staff_user() to authenticated;

-- ---------------------------------------------------------------------
-- Sale engine: staff-aware line insert with earnings snapshot
-- ---------------------------------------------------------------------
drop function if exists private.insert_sale_items(uuid, uuid, jsonb);

create or replace function private.insert_sale_items(
  p_owner   uuid,
  p_sale_id uuid,
  p_items   jsonb,
  p_staff_id uuid default null,
  p_staff_restricted boolean default false   -- true when a staff login records the sale
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
      v_price := v_product.selling_price;          -- staff always sell at the set price
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

    -- Staff earning snapshot
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
        else
          v_erate := coalesce(v_assign.earning_rate, 0);
          v_eamt  := round(v_qty * coalesce(v_assign.earning_rate, 0), 2);
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
  set total_amount = t.amount, total_cost = t.cost, total_staff_earnings = t.earn
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
-- Public API: sales (replaces the owner-only versions)
-- ---------------------------------------------------------------------
drop function if exists public.record_sale(jsonb, text, text, timestamptz);
drop function if exists public.update_sale(uuid, jsonb, text, text, timestamptz);

-- Staff logins: sale is always theirs, timestamped now, assigned products only.
-- Admin: may attribute the sale to one of their staff (p_staff_id) or none.
-- p_client_ref makes the call idempotent (double-click / retry safe).
create or replace function public.record_sale(
  p_items          jsonb,
  p_payment_method text default 'Cash',
  p_notes          text default null,
  p_sold_at        timestamptz default now(),
  p_staff_id       uuid default null,
  p_client_ref     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_staff      public.staff;
  v_owner      uuid;
  v_staff_id   uuid;
  v_restricted boolean := false;
  v_when       timestamptz := coalesce(p_sold_at, now());
  v_id         uuid;
  v_txn        text;
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if private.is_staff_user() then
    v_staff := private.require_active_staff();
    v_owner := v_staff.owner_id;
    v_staff_id := v_staff.id;
    v_restricted := true;
    v_when := now();
  elsif private.is_business_owner(v_uid) then
    v_owner := v_uid;
    v_staff_id := p_staff_id;
    if v_staff_id is not null and not exists (select 1 from public.staff where id = v_staff_id and owner_id = v_owner) then
      raise exception 'Staff member not found.' using errcode = 'P0002';
    end if;
  else
    raise exception 'Your account is not set up yet.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('almie_txn_' || v_owner::text));

  if p_client_ref is not null then
    select id into v_id from public.sales where owner_id = v_owner and client_ref = p_client_ref;
    if found then
      return v_id;   -- already recorded: duplicate submit
    end if;
  end if;

  v_txn := private.next_transaction_number(v_owner, v_when);

  insert into public.sales (owner_id, transaction_number, payment_method, notes, sold_at, staff_id, recorded_by, client_ref)
  values (v_owner, v_txn, coalesce(nullif(btrim(p_payment_method), ''), 'Cash'), nullif(btrim(p_notes), ''),
          v_when, v_staff_id, v_uid, p_client_ref)
  returning id into v_id;

  perform private.insert_sale_items(v_owner, v_id, p_items, v_staff_id, v_restricted);
  perform private.deduct_sale_stock(v_owner, v_id, v_txn);
  return v_id;
end;
$$;

-- Admin only. Earnings are recalculated with the staff member's current rates.
create or replace function public.update_sale(
  p_sale_id        uuid,
  p_items          jsonb,
  p_payment_method text default 'Cash',
  p_notes          text default null,
  p_sold_at        timestamptz default null,
  p_staff_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.require_user();
  v_sale  public.sales%rowtype;
begin
  if not private.is_business_owner(v_owner) then
    raise exception 'Only the owner can edit sales.' using errcode = '42501';
  end if;
  select * into v_sale from public.sales where id = p_sale_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Sale not found.' using errcode = 'P0002';
  end if;
  if v_sale.status = 'voided' then
    raise exception 'Voided sales cannot be edited.' using errcode = '22023';
  end if;
  if p_staff_id is not null and not exists (select 1 from public.staff where id = p_staff_id and owner_id = v_owner) then
    raise exception 'Staff member not found.' using errcode = 'P0002';
  end if;

  perform private.restore_sale_stock(v_owner, p_sale_id, 'Edit of ' || v_sale.transaction_number || ': previous items returned');
  delete from public.sale_items where sale_id = p_sale_id;

  update public.sales
  set payment_method = coalesce(nullif(btrim(p_payment_method), ''), 'Cash'),
      notes          = nullif(btrim(p_notes), ''),
      sold_at        = coalesce(p_sold_at, v_sale.sold_at),
      staff_id       = p_staff_id
  where id = p_sale_id;

  perform private.insert_sale_items(v_owner, p_sale_id, p_items, p_staff_id, false);
  perform private.deduct_sale_stock(v_owner, p_sale_id, v_sale.transaction_number);
  return p_sale_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Admin: save a staff member's earning setup + product assignments atomically
--   p_data:        {earning_type, commission_rate, rate_per_item}
--   p_assignments: [{product_id, earning_rate}]  (the full list; others are removed)
-- ---------------------------------------------------------------------
create or replace function public.save_staff_rates(p_staff_id uuid, p_data jsonb, p_assignments jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid := private.require_user();
begin
  update public.staff set
    earning_type    = coalesce(nullif(p_data ->> 'earning_type', ''), earning_type),
    commission_rate = coalesce(nullif(p_data ->> 'commission_rate', '')::numeric, commission_rate),
    rate_per_item   = coalesce(nullif(p_data ->> 'rate_per_item', '')::numeric, rate_per_item)
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
-- Admin reports (SECURITY INVOKER: RLS + owner filter apply)
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
    select sa.staff_id,
           count(distinct sa.id)::int as transactions,
           coalesce(sum(si.quantity), 0) as items_sold,
           coalesce(sum(si.subtotal), 0) as sales_total,
           coalesce(sum(si.staff_earning_amount), 0) as earnings
    from public.sales sa
    join public.sale_items si on si.sale_id = sa.id
    where sa.owner_id = auth.uid() and sa.status = 'completed' and sa.staff_id is not null
      and sa.sold_at >= (p_start::timestamp at time zone 'Asia/Manila')
      and sa.sold_at <  ((p_end + 1)::timestamp at time zone 'Asia/Manila')
    group by sa.staff_id
  ),
  earned as (
    select staff_id, coalesce(sum(total_staff_earnings), 0) as total
    from public.sales
    where owner_id = auth.uid() and status = 'completed' and staff_id is not null
    group by staff_id
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
  select private.manila_date(sa.sold_at), sa.staff_id,
         count(distinct sa.id)::int, sum(si.quantity), sum(si.subtotal), sum(si.staff_earning_amount)
  from public.sales sa
  join public.sale_items si on si.sale_id = sa.id
  where sa.owner_id = auth.uid() and sa.status = 'completed' and sa.staff_id is not null
    and sa.sold_at >= (p_start::timestamp at time zone 'Asia/Manila')
    and sa.sold_at <  ((p_end + 1)::timestamp at time zone 'Asia/Manila')
  group by 1, 2
  order by 1, 2;
$$;

create or replace function public.report_staff_products(p_start date, p_end date, p_staff_id uuid default null)
returns table (staff_id uuid, product_name text, quantity numeric, sales_total numeric, earnings numeric)
language sql
stable
set search_path = ''
as $$
  select sa.staff_id, si.product_name, sum(si.quantity), sum(si.subtotal), sum(si.staff_earning_amount)
  from public.sales sa
  join public.sale_items si on si.sale_id = sa.id
  where sa.owner_id = auth.uid() and sa.status = 'completed' and sa.staff_id is not null
    and (p_staff_id is null or sa.staff_id = p_staff_id)
    and sa.sold_at >= (p_start::timestamp at time zone 'Asia/Manila')
    and sa.sold_at <  ((p_end + 1)::timestamp at time zone 'Asia/Manila')
  group by sa.staff_id, si.product_name
  order by sum(si.quantity) desc;
$$;

-- ---------------------------------------------------------------------
-- Staff self-service API (SECURITY DEFINER; always scoped to the caller)
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
    'created_at', v.created_at,
    'business_name', coalesce(b.business_name, 'Almie Bites'),
    'logo_url', b.logo_url,
    'payment_methods', coalesce((
      select jsonb_agg(name order by sort_order, name) from public.categories
      where owner_id = v.owner_id and type = 'payment'), '["Cash","GCash","Other"]'::jsonb)
  );
end;
$$;

-- Assigned products with price, how much the staff earns per item,
-- and how many can still be made from current stock (null = no recipe).
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
           else a.earning_rate end, 2),
         (select floor(min(i.current_stock / r.quantity_used))
            from public.product_recipes r join public.inventory_items i on i.id = r.inventory_item_id
           where r.product_id = p.id)
  from public.staff_product_assignments a
  join public.products p on p.id = a.product_id
  where a.staff_id = v.id
  order by p.name;
end;
$$;

-- Totals for a date range + all-time balance + per-product and per-day breakdowns.
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
  with s as (
    select sa.id, sa.sold_at, si.product_name, si.quantity, si.subtotal, si.staff_earning_amount
    from public.sales sa
    join public.sale_items si on si.sale_id = sa.id
    where sa.staff_id = v.id and sa.status = 'completed'
      and sa.sold_at >= (p_start::timestamp at time zone 'Asia/Manila')
      and sa.sold_at <  ((p_end + 1)::timestamp at time zone 'Asia/Manila')
  ),
  earned as (
    select coalesce(sum(total_staff_earnings), 0) as t from public.sales where staff_id = v.id and status = 'completed'
  ),
  paid as (
    select coalesce(sum(amount), 0) as t from public.staff_payments where staff_id = v.id
  )
  select jsonb_build_object(
    'transactions', (select count(distinct id) from s),
    'items_sold',   (select coalesce(sum(quantity), 0) from s),
    'sales_total',  (select coalesce(sum(subtotal), 0) from s),
    'earnings',     (select coalesce(sum(staff_earning_amount), 0) from s),
    'earned_total', (select t from earned),
    'paid_total',   (select t from paid),
    'unpaid',       (select t from earned) - (select t from paid),
    'products', coalesce((
      select jsonb_agg(x order by x.quantity desc) from (
        select product_name, sum(quantity) as quantity, sum(subtotal) as sales_total, sum(staff_earning_amount) as earnings
        from s group by product_name) x), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(d order by d.day) from (
        select private.manila_date(sold_at) as day, count(distinct id) as transactions,
               sum(quantity) as items_sold, sum(subtotal) as sales_total, sum(staff_earning_amount) as earnings
        from s group by 1) d), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

-- The caller's own transactions (no cost data).
create or replace function public.staff_sales(p_start date, p_end date, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.staff := private.require_active_staff();
begin
  return coalesce((
    select jsonb_agg(t order by t.sold_at desc) from (
      select sa.id, sa.transaction_number, sa.sold_at, sa.payment_method, sa.status, sa.notes,
             sa.total_amount, sa.total_staff_earnings,
             (select jsonb_agg(jsonb_build_object(
                'product_name', si.product_name, 'quantity', si.quantity, 'unit_price', si.unit_price,
                'subtotal', si.subtotal, 'earning', si.staff_earning_amount) order by si.product_name)
                from public.sale_items si where si.sale_id = sa.id) as items
      from public.sales sa
      where sa.staff_id = v.id
        and sa.sold_at >= (p_start::timestamp at time zone 'Asia/Manila')
        and sa.sold_at <  ((p_end + 1)::timestamp at time zone 'Asia/Manila')
      order by sa.sold_at desc
      limit greatest(1, least(coalesce(p_limit, 50), 500))
    ) t), '[]'::jsonb);
end;
$$;

create or replace function public.staff_payment_history()
returns table (id uuid, amount numeric, payment_method text, payment_date date,
               period_start date, period_end date, notes text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.staff := private.require_active_staff();
begin
  return query
  select p.id, p.amount, p.payment_method, p.payment_date, p.period_start, p.period_end, p.notes, p.created_at
  from public.staff_payments p
  where p.staff_id = v.id
  order by p.payment_date desc, p.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------
-- Account seeding must never create a business for a staff login.
-- ---------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'role', '') = 'staff' then
    return new;
  end if;
  perform private.seed_account(new.id);
  return new;
end;
$$;

create or replace function public.initialize_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_staff_user() then
    return;
  end if;
  perform private.seed_account(private.require_user());
end;
$$;

-- Who am I? Used by the app to route admin vs staff.
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then 'anonymous'
    when exists (select 1 from public.staff where user_id = auth.uid() and is_active) then 'staff'
    when private.is_staff_user() then 'inactive_staff'
    else 'admin'
  end;
$$;

-- ---------------------------------------------------------------------
-- New accounts: starter products without recipes (sales never touch stock).
-- ---------------------------------------------------------------------
create or replace function private.seed_account(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.business_settings where owner_id = p_owner) then
    return; -- already initialised
  end if;

  insert into public.business_settings (owner_id) values (p_owner);

  insert into public.categories (owner_id, name, type, is_inventory_purchase, sort_order) values
    (p_owner, 'Inventory / Ingredients', 'expense', true, 1),
    (p_owner, 'Packaging',               'expense', true, 2),
    (p_owner, 'Transportation',          'expense', false, 3),
    (p_owner, 'Utilities',               'expense', false, 4),
    (p_owner, 'Equipment',               'expense', false, 5),
    (p_owner, 'Other Expenses',          'expense', false, 6),
    (p_owner, 'Ingredient',              'inventory', false, 1),
    (p_owner, 'Product/Supply',          'inventory', false, 2),
    (p_owner, 'Ingredient/Product',      'inventory', false, 3),
    (p_owner, 'Beverage',                'inventory', false, 4),
    (p_owner, 'Packaging',               'inventory', false, 5),
    (p_owner, 'Snacks',                  'product', false, 1),
    (p_owner, 'Beverages',               'product', false, 2),
    (p_owner, 'Combo',                   'product', false, 3),
    (p_owner, 'Cash',                    'payment', false, 1),
    (p_owner, 'GCash',                   'payment', false, 2),
    (p_owner, 'Other',                   'payment', false, 3)
  on conflict do nothing;

  insert into public.inventory_items (owner_id, name, category, unit, current_stock, minimum_stock, notes) values
    (p_owner, 'Oil',          'Ingredient',         'Kg',     0, 1,  null),
    (p_owner, 'Stick Big',    'Product/Supply',     'Piece',  0, 50, null),
    (p_owner, 'Stick Small',  'Product/Supply',     'Piece',  0, 50, null),
    (p_owner, 'Nestea Juice', 'Beverage',           'Sachet', 0, 5,  'Unit: Sachet/Pack'),
    (p_owner, 'Cup 8oz',      'Packaging',          'Piece',  0, 30, null),
    (p_owner, 'Cup 10oz',     'Packaging',          'Piece',  0, 30, null),
    (p_owner, 'Sili',         'Ingredient',         'Piece',  0, 20, 'Unit: Piece/Kg'),
    (p_owner, 'Calamansi',    'Ingredient',         'Piece',  0, 20, 'Unit: Piece/Kg'),
    (p_owner, 'Hotdog',       'Ingredient/Product', 'Piece',  0, 20, 'Unit: Piece/Pack'),
    (p_owner, 'Siomai',       'Ingredient/Product', 'Piece',  0, 20, 'Unit: Piece/Pack'),
    (p_owner, 'Sugar',        'Ingredient',         'Kg',     0, 1,  null),
    (p_owner, 'Citric Acid',  'Ingredient',         'Pack',   0, 2,  null),
    (p_owner, 'Magic S',      'Ingredient',         'Pack',   0, 2,  null)
  on conflict do nothing;


  -- Starter products (no recipes: selling never changes inventory).
  insert into public.products (owner_id, name, category, description, selling_price)
  values (p_owner, 'Hotdog Stick', 'Snacks', 'Sample product — edit or remove as needed.', 15);

  insert into public.products (owner_id, name, category, description, selling_price)
  values (p_owner, 'Siomai Stick', 'Snacks', 'Sample product — edit or remove as needed.', 10);

  insert into public.products (owner_id, name, category, description, selling_price)
  values (p_owner, 'Juice', 'Beverages', 'Sample product — edit or remove as needed.', 10);
end;
$$;

-- ---------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------
revoke all on all functions in schema private from public, anon;
revoke all on function private.insert_sale_items(uuid, uuid, jsonb, uuid, boolean) from authenticated;
revoke all on function private.current_staff() from authenticated;
revoke all on function private.require_active_staff() from authenticated;
revoke all on function private.is_business_owner(uuid) from authenticated;
grant execute on function private.is_staff_user() to authenticated;
grant execute on function private.require_user() to authenticated;
grant execute on function private.manila_date(timestamptz) to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.record_sale(jsonb, text, text, timestamptz, uuid, uuid)',
    'public.update_sale(uuid, jsonb, text, text, timestamptz, uuid)',
    'public.save_staff_rates(uuid, jsonb, jsonb)',
    'public.report_staff(date, date)',
    'public.report_staff_daily(date, date)',
    'public.report_staff_products(date, date, uuid)',
    'public.staff_profile()',
    'public.staff_products()',
    'public.staff_summary(date, date)',
    'public.staff_sales(date, date, integer)',
    'public.staff_payment_history()',
    'public.initialize_account()',
    'public.my_role()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- Live refresh for the new tables
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.staff, public.staff_payments;
  end if;
end;
$$;
