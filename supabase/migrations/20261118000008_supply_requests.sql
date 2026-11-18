-- =====================================================================
-- Almie Bites — Staff supply requests
--
-- Staff ask the Admin for supplies (an inventory item, in pieces; the app
-- lets them type packs + pieces). The Admin approves (optionally changing
-- the quantity) or rejects. On approval the Admin may also:
--   * record the purchase as ONE expense that adds the stock (save_expense),
--     with the amount defaulting to the estimated cost; and/or
--   * add the pieces to the staff member's daily assignment for today
--     (when the item is sold through exactly one product).
-- Approving never deducts stock itself: staff sales deduct inventory when
-- they sell, so nothing is counted twice.
-- Staff never see costs; all staff access is through staff_* functions.
-- =====================================================================

create table public.supply_requests (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  staff_id          uuid not null references public.staff(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  quantity          numeric(12,3) not null check (quantity > 0),          -- requested, in pieces/units
  notes             text,
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  approved_quantity numeric(12,3) check (approved_quantity is null or approved_quantity > 0),
  admin_note        text,
  expense_id        uuid references public.expenses(id) on delete set null,
  added_to_assignment boolean not null default false,
  decided_at        timestamptz,
  created_at        timestamptz not null default now()
);
create index supply_requests_owner_idx on public.supply_requests (owner_id, status, created_at desc);
create index supply_requests_staff_idx on public.supply_requests (staff_id, created_at desc);

alter table public.supply_requests enable row level security;
create policy "requests: owner read" on public.supply_requests for select to authenticated using (owner_id = (select auth.uid()));
create policy "requests: owner update" on public.supply_requests for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "requests: owner delete" on public.supply_requests for delete to authenticated using (owner_id = (select auth.uid()));
create policy "deny staff direct access" on public.supply_requests as restrictive for all to authenticated
  using (not (select private.is_staff_user())) with check (not (select private.is_staff_user()));
revoke all on public.supply_requests from anon;
grant select, update, delete on public.supply_requests to authenticated;

-- ---------------------------------------------------------------------
-- Staff API
-- ---------------------------------------------------------------------
-- Items a staff member can ask for (names/units only — no costs).
create or replace function public.staff_request_items()
returns table (id uuid, name text, category text, unit text, pack_unit text, pieces_per_pack numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.staff := private.require_active_staff();
begin
  return query
  select i.id, i.name, i.category, i.unit, i.pack_unit, i.pieces_per_pack
  from public.inventory_items i
  where i.owner_id = v.owner_id
  order by i.name;
end;
$$;

create or replace function public.staff_create_request(p_item_id uuid, p_quantity numeric, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.staff := private.require_active_staff();
  v_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Enter how many you need.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.inventory_items where id = p_item_id and owner_id = v.owner_id) then
    raise exception 'Item not found.' using errcode = 'P0002';
  end if;
  insert into public.supply_requests (owner_id, staff_id, inventory_item_id, quantity, notes)
  values (v.owner_id, v.id, p_item_id, round(p_quantity, 3), nullif(btrim(p_notes), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.staff_my_requests(p_limit integer default 50)
returns table (id uuid, item_name text, unit text, pack_unit text, pieces_per_pack numeric, quantity numeric,
               approved_quantity numeric, status text, notes text, admin_note text,
               added_to_assignment boolean, created_at timestamptz, decided_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.staff := private.require_active_staff();
begin
  return query
  select r.id, i.name, i.unit, i.pack_unit, i.pieces_per_pack, r.quantity, r.approved_quantity, r.status,
         r.notes, r.admin_note, r.added_to_assignment, r.created_at, r.decided_at
  from public.supply_requests r
  join public.inventory_items i on i.id = r.inventory_item_id
  where r.staff_id = v.id
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

create or replace function public.staff_cancel_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.staff := private.require_active_staff();
begin
  update public.supply_requests set status = 'cancelled', decided_at = now()
  where id = p_request_id and staff_id = v.id and status = 'pending';
  if not found then
    raise exception 'Only your pending requests can be cancelled.' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Admin: decide a request
--   p_data (approve): {quantity, buy, amount, category_id, payment_method,
--                      update_item_cost, assign, note}
--   p_data (reject):  {note}
-- ---------------------------------------------------------------------
create or replace function public.decide_supply_request(p_request_id uuid, p_approve boolean, p_data jsonb default '{}'::jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_owner   uuid := private.require_user();
  r         public.supply_requests%rowtype;
  i         public.inventory_items%rowtype;
  v_qty     numeric;
  v_amount  numeric;
  v_expense uuid;
  v_product uuid;
  v_used    numeric;
  v_links   integer;
  v_day     date := (now() at time zone 'Asia/Manila')::date;
  v_assigned boolean := false;
  v_staff_name text;
begin
  select * into r from public.supply_requests where id = p_request_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request was already %.', r.status using errcode = '22023';
  end if;

  if not p_approve then
    update public.supply_requests
    set status = 'rejected', admin_note = nullif(btrim(p_data ->> 'note'), ''), decided_at = now()
    where id = r.id;
    return;
  end if;

  select * into i from public.inventory_items where id = r.inventory_item_id;
  v_qty := coalesce(nullif(p_data ->> 'quantity', '')::numeric, r.quantity);
  if v_qty <= 0 then
    raise exception 'Approved quantity must be more than 0.' using errcode = '22023';
  end if;
  select full_name into v_staff_name from public.staff where id = r.staff_id;

  -- Optional: record the purchase (one expense) and add the stock.
  if coalesce((p_data ->> 'buy')::boolean, false) then
    v_amount := coalesce(nullif(p_data ->> 'amount', '')::numeric, round(v_qty * i.purchase_price, 2));
    v_expense := public.save_expense(jsonb_build_object(
      'name', i.name,
      'category_id', nullif(p_data ->> 'category_id', ''),
      'amount', v_amount,
      'quantity', case when i.pieces_per_pack > 0 then round(v_qty / i.pieces_per_pack, 3) else v_qty end,
      'inventory_item_id', i.id,
      'add_to_stock', true,
      'stock_quantity', v_qty,
      'update_item_cost', coalesce((p_data ->> 'update_item_cost')::boolean, true) and v_amount > 0,
      'pack_price', case when i.pieces_per_pack > 0 and v_qty > 0 then round(v_amount / (v_qty / i.pieces_per_pack), 2) end,
      'payment_method', coalesce(nullif(p_data ->> 'payment_method', ''), 'Cash'),
      'notes', 'Supply request from ' || coalesce(v_staff_name, 'staff')
    ));
  end if;

  -- Optional: give the pieces to the staff member for today (daily assignment).
  if coalesce((p_data ->> 'assign')::boolean, false) then
    select count(*), min(pr.product_id::text)::uuid, min(pr.quantity_used)
      into v_links, v_product, v_used
    from public.product_recipes pr
    where pr.inventory_item_id = i.id and pr.owner_id = v_owner;
    if v_links = 1 then
      -- first daily assignment of the day: keep their regular products available (no limit)
      if not exists (select 1 from public.daily_assignments where staff_id = r.staff_id and assign_date = v_day) then
        insert into public.daily_assignments (owner_id, staff_id, product_id, assign_date, quantity)
        select v_owner, r.staff_id, a.product_id, v_day, null
        from public.staff_product_assignments a where a.staff_id = r.staff_id
        on conflict (staff_id, product_id, assign_date) do nothing;
      end if;
      insert into public.daily_assignments (owner_id, staff_id, product_id, assign_date, quantity)
      values (v_owner, r.staff_id, v_product, v_day, round(v_qty / coalesce(nullif(v_used, 0), 1), 3))
      on conflict (staff_id, product_id, assign_date)
      do update set quantity = coalesce(public.daily_assignments.quantity, 0) + excluded.quantity;
      v_assigned := true;
    end if;
  end if;

  update public.supply_requests
  set status = 'approved', approved_quantity = v_qty, expense_id = v_expense,
      added_to_assignment = v_assigned, admin_note = nullif(btrim(p_data ->> 'note'), ''), decided_at = now()
  where id = r.id;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges + realtime
-- ---------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.staff_request_items()',
    'public.staff_create_request(uuid, numeric, text)',
    'public.staff_my_requests(integer)',
    'public.staff_cancel_request(uuid)',
    'public.decide_supply_request(uuid, boolean, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.supply_requests;
  end if;
end;
$$;
