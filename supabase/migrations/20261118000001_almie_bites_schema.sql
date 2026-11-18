-- =====================================================================
-- Almie Bites — Inventory & Daily Sales Management
-- Core schema, security (RLS), business logic functions and seed logic.
--
-- Design notes
-- * Every business table carries owner_id -> auth.users(id). RLS limits
--   each signed-in user to their own rows, so the app is single-owner
--   today but ready for multiple accounts later.
-- * Stock quantities are NEVER updated directly by the client. All stock
--   changes go through SECURITY DEFINER functions which lock the item row,
--   update the stock and write an inventory_movements record in the same
--   transaction.
-- * Sales are grouped by Philippine local date (Asia/Manila).
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.manila_date(ts timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select (ts at time zone 'Asia/Manila')::date;
$$;

create or replace function private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.business_settings (
  owner_id             uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  business_name        text not null default 'Almie Bites' check (length(btrim(business_name)) between 1 and 100),
  logo_url             text,
  currency             text not null default 'PHP',
  currency_symbol      text not null default '₱',
  default_min_stock    numeric(14,3) not null default 5 check (default_min_stock >= 0),
  allow_negative_stock boolean not null default false,
  owner_name           text,
  phone                text,
  email                text,
  address              text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.categories (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name                  text not null check (length(btrim(name)) between 1 and 60),
  type                  text not null check (type in ('product', 'inventory', 'expense', 'payment')),
  -- Only meaningful for expense categories: marks purchases of stock/supplies.
  is_inventory_purchase boolean not null default false,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now()
);
create unique index categories_owner_type_name_key on public.categories (owner_id, type, lower(name));
create index categories_owner_type_idx on public.categories (owner_id, type, sort_order);

create table public.inventory_items (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 100),
  category       text not null default 'Ingredient' check (length(btrim(category)) between 1 and 60),
  unit           text not null default 'Piece' check (length(btrim(unit)) between 1 and 30),
  current_stock  numeric(14,3) not null default 0,
  minimum_stock  numeric(14,3) not null default 0 check (minimum_stock >= 0),
  purchase_price numeric(12,2) not null default 0 check (purchase_price >= 0), -- cost per unit
  stock_value    numeric(16,2) generated always as (round(greatest(current_stock, 0) * purchase_price, 2)) stored,
  supplier       text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index inventory_items_owner_name_key on public.inventory_items (owner_id, lower(name));
create index inventory_items_owner_category_idx on public.inventory_items (owner_id, category);

create table public.products (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 100),
  category      text not null default 'Snacks' check (length(btrim(category)) between 1 and 60),
  description   text,
  selling_price numeric(12,2) not null default 0 check (selling_price >= 0),
  is_available  boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index products_owner_name_key on public.products (owner_id, lower(name));
create index products_owner_idx on public.products (owner_id, is_available);

create table public.product_recipes (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id        uuid not null references public.products(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity_used     numeric(14,4) not null check (quantity_used > 0),
  created_at        timestamptz not null default now(),
  unique (product_id, inventory_item_id)
);
create index product_recipes_item_idx on public.product_recipes (inventory_item_id);
create index product_recipes_owner_idx on public.product_recipes (owner_id);

create table public.sales (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  transaction_number text not null,
  total_amount       numeric(12,2) not null default 0 check (total_amount >= 0),
  total_cost         numeric(12,2) not null default 0 check (total_cost >= 0), -- ingredient cost snapshot
  payment_method     text not null default 'Cash' check (length(btrim(payment_method)) between 1 and 40),
  status             text not null default 'completed' check (status in ('completed', 'voided')),
  void_reason        text,
  voided_at          timestamptz,
  notes              text,
  sold_at            timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (owner_id, transaction_number)
);
create index sales_owner_sold_at_idx on public.sales (owner_id, sold_at desc);
create index sales_owner_status_idx on public.sales (owner_id, status);

create table public.sale_items (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sale_id      uuid not null references public.sales(id) on delete cascade,
  product_id   uuid references public.products(id) on delete set null,
  product_name text not null,           -- snapshot so history survives product deletion
  quantity     numeric(12,3) not null check (quantity > 0),
  unit_price   numeric(12,2) not null check (unit_price >= 0),
  subtotal     numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  unit_cost    numeric(12,4) not null default 0 check (unit_cost >= 0) -- recipe cost snapshot
);
create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_product_idx on public.sale_items (product_id);
create index sale_items_owner_idx on public.sale_items (owner_id);

create table public.expenses (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name              text not null check (length(btrim(name)) between 1 and 120),
  category_id       uuid references public.categories(id) on delete set null,
  amount            numeric(12,2) not null check (amount >= 0),
  quantity          numeric(14,3) check (quantity is null or quantity > 0),
  unit_price        numeric(12,2) check (unit_price is null or unit_price >= 0),
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  stock_added       numeric(14,3) not null default 0 check (stock_added >= 0),
  payment_method    text not null default 'Cash',
  notes             text,
  receipt_path      text,
  expense_date      date not null default ((now() at time zone 'Asia/Manila')::date),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index expenses_owner_date_idx on public.expenses (owner_id, expense_date desc);
create index expenses_category_idx on public.expenses (category_id);
create index expenses_item_idx on public.expenses (inventory_item_id);

create table public.inventory_movements (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  movement_type     text not null check (movement_type in (
                      'initial', 'purchase', 'restock', 'sale', 'sale_reversal',
                      'adjustment', 'stock_count', 'damaged', 'expired', 'expense_reversal')),
  quantity          numeric(14,3) not null,   -- signed: + added, - deducted
  previous_stock    numeric(14,3) not null,
  new_stock         numeric(14,3) not null,
  sale_id           uuid references public.sales(id) on delete set null,
  expense_id        uuid references public.expenses(id) on delete set null,
  reference_id      uuid,                     -- generic reference (kept even if the sale/expense is deleted)
  notes             text,
  created_at        timestamptz not null default now()
);
create index inventory_movements_item_idx on public.inventory_movements (inventory_item_id, created_at desc);
create index inventory_movements_owner_idx on public.inventory_movements (owner_id, created_at desc);
create index inventory_movements_sale_idx on public.inventory_movements (sale_id);
create index inventory_movements_expense_idx on public.inventory_movements (expense_id);

-- updated_at triggers
create trigger trg_settings_updated before update on public.business_settings for each row execute function private.set_updated_at();
create trigger trg_items_updated    before update on public.inventory_items  for each row execute function private.set_updated_at();
create trigger trg_products_updated before update on public.products         for each row execute function private.set_updated_at();
create trigger trg_sales_updated    before update on public.sales            for each row execute function private.set_updated_at();
create trigger trg_expenses_updated before update on public.expenses         for each row execute function private.set_updated_at();

-- Record an "initial" movement whenever an item is created with stock.
create or replace function private.log_initial_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_stock <> 0 then
    insert into public.inventory_movements
      (owner_id, inventory_item_id, movement_type, quantity, previous_stock, new_stock, notes)
    values (new.owner_id, new.id, 'initial', new.current_stock, 0, new.current_stock, 'Initial stock');
  end if;
  return new;
end;
$$;
create trigger trg_items_initial_stock after insert on public.inventory_items
  for each row execute function private.log_initial_stock();

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------
create view public.product_costs
with (security_invoker = true)
as
select
  p.id as product_id,
  p.owner_id,
  coalesce(sum(r.quantity_used * i.purchase_price), 0)::numeric(12,4) as estimated_cost,
  count(r.id)::int as recipe_count
from public.products p
left join public.product_recipes r on r.product_id = p.id
left join public.inventory_items i on i.id = r.inventory_item_id
group by p.id, p.owner_id;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.business_settings   enable row level security;
alter table public.categories          enable row level security;
alter table public.inventory_items     enable row level security;
alter table public.products            enable row level security;
alter table public.product_recipes     enable row level security;
alter table public.sales               enable row level security;
alter table public.sale_items          enable row level security;
alter table public.expenses            enable row level security;
alter table public.inventory_movements enable row level security;

-- Settings
create policy "settings: owner read"   on public.business_settings for select to authenticated using (owner_id = (select auth.uid()));
create policy "settings: owner insert" on public.business_settings for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "settings: owner update" on public.business_settings for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- Categories
create policy "categories: owner read"   on public.categories for select to authenticated using (owner_id = (select auth.uid()));
create policy "categories: owner insert" on public.categories for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "categories: owner update" on public.categories for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "categories: owner delete" on public.categories for delete to authenticated using (owner_id = (select auth.uid()));

-- Inventory items (stock column is protected by column privileges below)
create policy "items: owner read"   on public.inventory_items for select to authenticated using (owner_id = (select auth.uid()));
create policy "items: owner insert" on public.inventory_items for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "items: owner update" on public.inventory_items for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "items: owner delete" on public.inventory_items for delete to authenticated using (owner_id = (select auth.uid()));

-- Products
create policy "products: owner read"   on public.products for select to authenticated using (owner_id = (select auth.uid()));
create policy "products: owner insert" on public.products for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "products: owner update" on public.products for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "products: owner delete" on public.products for delete to authenticated using (owner_id = (select auth.uid()));

-- Recipes (both sides of the link must belong to the same owner)
create policy "recipes: owner read" on public.product_recipes for select to authenticated using (owner_id = (select auth.uid()));
create policy "recipes: owner insert" on public.product_recipes for insert to authenticated with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
  and exists (select 1 from public.inventory_items i where i.id = inventory_item_id and i.owner_id = (select auth.uid()))
);
create policy "recipes: owner update" on public.product_recipes for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
    and exists (select 1 from public.inventory_items i where i.id = inventory_item_id and i.owner_id = (select auth.uid()))
  );
create policy "recipes: owner delete" on public.product_recipes for delete to authenticated using (owner_id = (select auth.uid()));

-- Sales, sale items, expenses, movements: read-only to clients.
-- All writes go through the functions below.
create policy "sales: owner read"      on public.sales               for select to authenticated using (owner_id = (select auth.uid()));
create policy "sale_items: owner read" on public.sale_items          for select to authenticated using (owner_id = (select auth.uid()));
create policy "expenses: owner read"   on public.expenses            for select to authenticated using (owner_id = (select auth.uid()));
create policy "movements: owner read"  on public.inventory_movements for select to authenticated using (owner_id = (select auth.uid()));

-- Privileges --------------------------------------------------------------
revoke all on all tables in schema public from anon;

revoke insert, update, delete on public.sales, public.sale_items, public.expenses, public.inventory_movements from authenticated;
grant select on public.sales, public.sale_items, public.expenses, public.inventory_movements to authenticated;

-- inventory_items.current_stock may only be set on insert (initial stock);
-- afterwards it changes exclusively through adjust_stock / sales / expenses.
revoke update on public.inventory_items from authenticated;
grant update (name, category, unit, minimum_stock, purchase_price, supplier, notes) on public.inventory_items to authenticated;

grant select on public.product_costs to authenticated;

-- ---------------------------------------------------------------------
-- Stock engine (private)
-- ---------------------------------------------------------------------
create or replace function private.allow_negative(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select allow_negative_stock from public.business_settings where owner_id = p_owner), false);
$$;

-- Applies a signed quantity change to one item, logging the movement.
create or replace function private.apply_stock_change(
  p_owner      uuid,
  p_item_id    uuid,
  p_delta      numeric,
  p_type       text,
  p_notes      text default null,
  p_sale_id    uuid default null,
  p_expense_id uuid default null,
  p_force      boolean default false
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev numeric;
  v_new  numeric;
  v_name text;
  v_unit text;
begin
  select current_stock, name, unit into v_prev, v_name, v_unit
  from public.inventory_items
  where id = p_item_id and owner_id = p_owner
  for update;

  if not found then
    raise exception 'Inventory item not found.' using errcode = 'P0002';
  end if;

  v_new := v_prev + p_delta;

  if v_new < 0 and not p_force and not private.allow_negative(p_owner) then
    raise exception 'Not enough stock for "%": % % available, % % needed.',
      v_name, trim_scale(v_prev), v_unit, trim_scale(-p_delta), v_unit
      using errcode = 'P0001', hint = 'Restock the item first, or enable "Allow negative stock" in Settings.';
  end if;

  update public.inventory_items set current_stock = v_new where id = p_item_id;

  insert into public.inventory_movements
    (owner_id, inventory_item_id, movement_type, quantity, previous_stock, new_stock,
     sale_id, expense_id, reference_id, notes)
  values
    (p_owner, p_item_id, p_type, p_delta, v_prev, v_new,
     p_sale_id, p_expense_id, coalesce(p_sale_id, p_expense_id), p_notes);

  return v_new;
end;
$$;

-- Inserts sale lines from JSON: [{product_id, quantity, unit_price}]
create or replace function private.insert_sale_items(p_owner uuid, p_sale_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line    jsonb;
  v_product public.products%rowtype;
  v_qty     numeric;
  v_price   numeric;
  v_cost    numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product to the sale.' using errcode = '22023';
  end if;

  for v_line in select * from jsonb_array_elements(p_items) loop
    select * into v_product from public.products
    where id = (v_line ->> 'product_id')::uuid and owner_id = p_owner;
    if not found then
      raise exception 'Product not found.' using errcode = 'P0002';
    end if;

    v_qty   := (v_line ->> 'quantity')::numeric;
    v_price := coalesce((v_line ->> 'unit_price')::numeric, v_product.selling_price);

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

    insert into public.sale_items (owner_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost)
    values (p_owner, p_sale_id, v_product.id, v_product.name, v_qty, v_price, v_cost);
  end loop;

  update public.sales s
  set total_amount = t.amount, total_cost = t.cost
  from (
    select coalesce(sum(subtotal), 0) as amount,
           round(coalesce(sum(quantity * unit_cost), 0), 2) as cost
    from public.sale_items where sale_id = p_sale_id
  ) t
  where s.id = p_sale_id;
end;
$$;

-- Deducts recipe ingredients for every line of a sale (one movement per item).
create or replace function private.deduct_sale_stock(p_owner uuid, p_sale_id uuid, p_txn text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select pr.inventory_item_id, sum(si.quantity * pr.quantity_used) as qty
    from public.sale_items si
    join public.product_recipes pr on pr.product_id = si.product_id
    where si.sale_id = p_sale_id
    group by pr.inventory_item_id
    order by pr.inventory_item_id          -- consistent lock order avoids deadlocks
  loop
    perform private.apply_stock_change(p_owner, r.inventory_item_id, -r.qty, 'sale',
      'Sold via ' || p_txn, p_sale_id, null, false);
  end loop;
end;
$$;

-- Returns to stock whatever this sale has (net) deducted so far.
create or replace function private.restore_sale_stock(p_owner uuid, p_sale_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select inventory_item_id, sum(quantity) as net
    from public.inventory_movements
    where sale_id = p_sale_id and owner_id = p_owner
    group by inventory_item_id
    having sum(quantity) <> 0
    order by inventory_item_id
  loop
    perform private.apply_stock_change(p_owner, r.inventory_item_id, -r.net, 'sale_reversal',
      p_note, p_sale_id, null, true);
  end loop;
end;
$$;

create or replace function private.next_transaction_number(p_owner uuid, p_sold_at timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text := 'AB-' || to_char(p_sold_at at time zone 'Asia/Manila', 'YYYYMMDD') || '-';
  v_next   int;
begin
  -- serialise numbering per owner
  perform pg_advisory_xact_lock(hashtext('almie_txn_' || p_owner::text));
  select coalesce(max(substring(transaction_number from length(v_prefix) + 1)::int), 0) + 1
    into v_next
  from public.sales
  where owner_id = p_owner
    and transaction_number like v_prefix || '%'
    and substring(transaction_number from length(v_prefix) + 1) ~ '^\d+$';
  return v_prefix || lpad(v_next::text, 4, '0');
end;
$$;

-- ---------------------------------------------------------------------
-- Public API: sales
-- ---------------------------------------------------------------------
create or replace function public.record_sale(
  p_items          jsonb,
  p_payment_method text default 'Cash',
  p_notes          text default null,
  p_sold_at        timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.require_user();
  v_id    uuid;
  v_txn   text;
  v_when  timestamptz := coalesce(p_sold_at, now());
begin
  v_txn := private.next_transaction_number(v_owner, v_when);

  insert into public.sales (owner_id, transaction_number, payment_method, notes, sold_at)
  values (v_owner, v_txn, coalesce(nullif(btrim(p_payment_method), ''), 'Cash'), nullif(btrim(p_notes), ''), v_when)
  returning id into v_id;

  perform private.insert_sale_items(v_owner, v_id, p_items);
  perform private.deduct_sale_stock(v_owner, v_id, v_txn);
  return v_id;
end;
$$;

create or replace function public.update_sale(
  p_sale_id        uuid,
  p_items          jsonb,
  p_payment_method text default 'Cash',
  p_notes          text default null,
  p_sold_at        timestamptz default null
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
  select * into v_sale from public.sales where id = p_sale_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Sale not found.' using errcode = 'P0002';
  end if;
  if v_sale.status = 'voided' then
    raise exception 'Voided sales cannot be edited.' using errcode = '22023';
  end if;

  perform private.restore_sale_stock(v_owner, p_sale_id, 'Edit of ' || v_sale.transaction_number || ': previous items returned');
  delete from public.sale_items where sale_id = p_sale_id;

  update public.sales
  set payment_method = coalesce(nullif(btrim(p_payment_method), ''), 'Cash'),
      notes          = nullif(btrim(p_notes), ''),
      sold_at        = coalesce(p_sold_at, v_sale.sold_at)
  where id = p_sale_id;

  perform private.insert_sale_items(v_owner, p_sale_id, p_items);
  perform private.deduct_sale_stock(v_owner, p_sale_id, v_sale.transaction_number);
  return p_sale_id;
end;
$$;

create or replace function public.void_sale(p_sale_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.require_user();
  v_sale  public.sales%rowtype;
begin
  select * into v_sale from public.sales where id = p_sale_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Sale not found.' using errcode = 'P0002';
  end if;
  if v_sale.status = 'voided' then
    return;
  end if;

  perform private.restore_sale_stock(v_owner, p_sale_id, 'Voided ' || v_sale.transaction_number);
  update public.sales
  set status = 'voided', void_reason = nullif(btrim(p_reason), ''), voided_at = now()
  where id = p_sale_id;
end;
$$;

create or replace function public.delete_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.require_user();
  v_sale  public.sales%rowtype;
begin
  select * into v_sale from public.sales where id = p_sale_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Sale not found.' using errcode = 'P0002';
  end if;

  if v_sale.status = 'completed' then
    perform private.restore_sale_stock(v_owner, p_sale_id, 'Deleted ' || v_sale.transaction_number);
  end if;
  delete from public.sales where id = p_sale_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Public API: expenses
--   p_data keys: name, category_id, amount, quantity, unit_price,
--   inventory_item_id, add_to_stock (bool), stock_quantity,
--   update_item_cost (bool), payment_method, notes, expense_date,
--   receipt_path
-- ---------------------------------------------------------------------
create or replace function public.save_expense(p_data jsonb, p_expense_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner     uuid := private.require_user();
  v_old       public.expenses%rowtype;
  v_id        uuid := p_expense_id;
  v_name      text := nullif(btrim(p_data ->> 'name'), '');
  v_category  uuid := nullif(p_data ->> 'category_id', '')::uuid;
  v_amount    numeric := (p_data ->> 'amount')::numeric;
  v_qty       numeric := nullif(p_data ->> 'quantity', '')::numeric;
  v_unit      numeric := nullif(p_data ->> 'unit_price', '')::numeric;
  v_item      uuid := nullif(p_data ->> 'inventory_item_id', '')::uuid;
  v_add       boolean := coalesce((p_data ->> 'add_to_stock')::boolean, false);
  v_stock_qty numeric := coalesce(nullif(p_data ->> 'stock_quantity', '')::numeric, nullif(p_data ->> 'quantity', '')::numeric);
  v_new_added numeric := 0;
  v_date      date := coalesce(nullif(p_data ->> 'expense_date', '')::date, private.manila_date(now()));
  v_item_name text;
begin
  if v_name is null then
    raise exception 'Expense name is required.' using errcode = '22023';
  end if;
  if v_amount is null or v_amount < 0 then
    raise exception 'Amount must be zero or more.' using errcode = '22023';
  end if;
  if v_category is not null and not exists (
    select 1 from public.categories where id = v_category and owner_id = v_owner and type = 'expense') then
    raise exception 'Expense category not found.' using errcode = 'P0002';
  end if;
  if v_item is not null then
    select name into v_item_name from public.inventory_items where id = v_item and owner_id = v_owner;
    if not found then
      raise exception 'Inventory item not found.' using errcode = 'P0002';
    end if;
  end if;
  if v_add then
    if v_item is null then
      raise exception 'Choose the inventory item to restock.' using errcode = '22023';
    end if;
    if v_stock_qty is null or v_stock_qty <= 0 then
      raise exception 'Enter the quantity to add to stock.' using errcode = '22023';
    end if;
    v_new_added := v_stock_qty;
  end if;

  if v_id is null then
    insert into public.expenses
      (owner_id, name, category_id, amount, quantity, unit_price, inventory_item_id, stock_added,
       payment_method, notes, expense_date, receipt_path)
    values
      (v_owner, v_name, v_category, v_amount, v_qty, v_unit, v_item, v_new_added,
       coalesce(nullif(btrim(p_data ->> 'payment_method'), ''), 'Cash'),
       nullif(btrim(p_data ->> 'notes'), ''), v_date, nullif(p_data ->> 'receipt_path', ''))
    returning id into v_id;

    if v_new_added > 0 then
      perform private.apply_stock_change(v_owner, v_item, v_new_added, 'purchase',
        'Purchased: ' || v_name, null, v_id, false);
    end if;
  else
    select * into v_old from public.expenses where id = v_id and owner_id = v_owner for update;
    if not found then
      raise exception 'Expense not found.' using errcode = 'P0002';
    end if;

    -- Reconcile stock with the edited purchase.
    if v_old.inventory_item_id is not distinct from v_item then
      if v_item is not null and v_new_added <> v_old.stock_added then
        perform private.apply_stock_change(v_owner, v_item, v_new_added - v_old.stock_added, 'adjustment',
          'Expense edited: ' || v_name, null, v_id, false);
      end if;
    else
      if v_old.inventory_item_id is not null and v_old.stock_added > 0 then
        perform private.apply_stock_change(v_owner, v_old.inventory_item_id, -v_old.stock_added, 'expense_reversal',
          'Expense edited: item changed', null, v_id, false);
      end if;
      if v_new_added > 0 then
        perform private.apply_stock_change(v_owner, v_item, v_new_added, 'purchase',
          'Purchased: ' || v_name, null, v_id, false);
      end if;
    end if;

    update public.expenses set
      name = v_name, category_id = v_category, amount = v_amount, quantity = v_qty,
      unit_price = v_unit, inventory_item_id = v_item, stock_added = v_new_added,
      payment_method = coalesce(nullif(btrim(p_data ->> 'payment_method'), ''), 'Cash'),
      notes = nullif(btrim(p_data ->> 'notes'), ''), expense_date = v_date,
      receipt_path = case when p_data ? 'receipt_path' then nullif(p_data ->> 'receipt_path', '') else receipt_path end
    where id = v_id;
  end if;

  -- Optionally remember the latest unit cost on the inventory item.
  if v_item is not null and coalesce((p_data ->> 'update_item_cost')::boolean, false) and v_new_added > 0 then
    update public.inventory_items
    set purchase_price = round(v_amount / v_new_added, 2)
    where id = v_item and owner_id = v_owner;
  end if;

  return v_id;
end;
$$;

create or replace function public.delete_expense(p_expense_id uuid, p_reverse_stock boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := private.require_user();
  v_old   public.expenses%rowtype;
begin
  select * into v_old from public.expenses where id = p_expense_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Expense not found.' using errcode = 'P0002';
  end if;

  if p_reverse_stock and v_old.inventory_item_id is not null and v_old.stock_added > 0 then
    perform private.apply_stock_change(v_owner, v_old.inventory_item_id, -v_old.stock_added, 'expense_reversal',
      'Deleted expense: ' || v_old.name, null, p_expense_id, false);
  end if;
  delete from public.expenses where id = p_expense_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Public API: manual stock adjustments
--   restock / adjustment(+/-) : p_quantity is signed delta (restock must be > 0)
--   damaged / expired         : p_quantity is the positive amount removed
--   stock_count               : p_quantity is the new counted stock level
-- ---------------------------------------------------------------------
create or replace function public.adjust_stock(
  p_item_id  uuid,
  p_type     text,
  p_quantity numeric,
  p_notes    text default null
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner   uuid := private.require_user();
  v_current numeric;
  v_delta   numeric;
begin
  if p_quantity is null then
    raise exception 'Quantity is required.' using errcode = '22023';
  end if;

  select current_stock into v_current from public.inventory_items
  where id = p_item_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Inventory item not found.' using errcode = 'P0002';
  end if;

  case p_type
    when 'restock' then
      if p_quantity <= 0 then raise exception 'Restock quantity must be greater than zero.' using errcode = '22023'; end if;
      v_delta := p_quantity;
    when 'adjustment' then
      if p_quantity = 0 then raise exception 'Adjustment cannot be zero.' using errcode = '22023'; end if;
      v_delta := p_quantity;
    when 'damaged', 'expired' then
      if p_quantity <= 0 then raise exception 'Quantity must be greater than zero.' using errcode = '22023'; end if;
      v_delta := -p_quantity;
    when 'stock_count' then
      if p_quantity < 0 then raise exception 'Counted stock cannot be negative.' using errcode = '22023'; end if;
      v_delta := p_quantity - v_current;
      if v_delta = 0 then return v_current; end if;
    else
      raise exception 'Unsupported adjustment type: %', p_type using errcode = '22023';
  end case;

  return private.apply_stock_change(v_owner, p_item_id, v_delta, p_type, nullif(btrim(p_notes), ''), null, null,
    p_type = 'stock_count');
end;
$$;

-- ---------------------------------------------------------------------
-- Public API: products + recipe saved atomically (SECURITY INVOKER: RLS applies)
--   p_data:   {name, category, description, selling_price, is_available}
--   p_recipe: [{inventory_item_id, quantity_used}]
-- ---------------------------------------------------------------------
create or replace function public.save_product(p_data jsonb, p_recipe jsonb default '[]'::jsonb, p_product_id uuid default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid := private.require_user();
  v_id    uuid := p_product_id;
  v_price numeric := coalesce(nullif(p_data ->> 'selling_price', '')::numeric, 0);
begin
  if nullif(btrim(p_data ->> 'name'), '') is null then
    raise exception 'Product name is required.' using errcode = '22023';
  end if;
  if v_price < 0 then
    raise exception 'Selling price cannot be negative.' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.products (owner_id, name, category, description, selling_price, is_available)
    values (v_owner, btrim(p_data ->> 'name'),
            coalesce(nullif(btrim(p_data ->> 'category'), ''), 'Snacks'),
            nullif(btrim(p_data ->> 'description'), ''), v_price,
            coalesce((p_data ->> 'is_available')::boolean, true))
    returning id into v_id;
  else
    update public.products set
      name = btrim(p_data ->> 'name'),
      category = coalesce(nullif(btrim(p_data ->> 'category'), ''), 'Snacks'),
      description = nullif(btrim(p_data ->> 'description'), ''),
      selling_price = v_price,
      is_available = coalesce((p_data ->> 'is_available')::boolean, true)
    where id = v_id and owner_id = v_owner;
    if not found then
      raise exception 'Product not found.' using errcode = 'P0002';
    end if;
  end if;

  delete from public.product_recipes where product_id = v_id;
  insert into public.product_recipes (owner_id, product_id, inventory_item_id, quantity_used)
  select v_owner, v_id, (r ->> 'inventory_item_id')::uuid, sum((r ->> 'quantity_used')::numeric)
  from jsonb_array_elements(coalesce(p_recipe, '[]'::jsonb)) r
  where nullif(r ->> 'inventory_item_id', '') is not null
  group by (r ->> 'inventory_item_id')::uuid;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Reports (SECURITY INVOKER: RLS applies). Dates are Manila calendar days.
-- ---------------------------------------------------------------------
create or replace function public.report_daily(p_start date, p_end date)
returns table (
  day                 date,
  sales_total         numeric,
  transactions        integer,
  items_sold          numeric,
  cost_of_goods       numeric,
  expenses_total      numeric,
  inventory_purchases numeric,
  other_expenses      numeric,
  voided_count        integer
)
language sql
stable
set search_path = ''
as $$
  with days as (
    select d::date as day from generate_series(p_start, p_end, interval '1 day') d
  ),
  s as (
    select private.manila_date(sold_at) as day,
           sum(total_amount) filter (where status = 'completed') as sales_total,
           count(*) filter (where status = 'completed')::int as transactions,
           sum(total_cost) filter (where status = 'completed') as cost_of_goods,
           count(*) filter (where status = 'voided')::int as voided_count
    from public.sales
    where owner_id = auth.uid()
      and sold_at >= (p_start::timestamp at time zone 'Asia/Manila')
      and sold_at <  ((p_end + 1)::timestamp at time zone 'Asia/Manila')
    group by 1
  ),
  q as (
    select private.manila_date(sa.sold_at) as day, sum(si.quantity) as items_sold
    from public.sale_items si
    join public.sales sa on sa.id = si.sale_id
    where sa.owner_id = auth.uid() and sa.status = 'completed'
      and sa.sold_at >= (p_start::timestamp at time zone 'Asia/Manila')
      and sa.sold_at <  ((p_end + 1)::timestamp at time zone 'Asia/Manila')
    group by 1
  ),
  e as (
    select ex.expense_date as day,
           sum(ex.amount) as expenses_total,
           sum(ex.amount) filter (where ex.inventory_item_id is not null or coalesce(c.is_inventory_purchase, false)) as inventory_purchases
    from public.expenses ex
    left join public.categories c on c.id = ex.category_id
    where ex.owner_id = auth.uid() and ex.expense_date between p_start and p_end
    group by 1
  )
  select days.day,
         coalesce(s.sales_total, 0),
         coalesce(s.transactions, 0),
         coalesce(q.items_sold, 0),
         coalesce(s.cost_of_goods, 0),
         coalesce(e.expenses_total, 0),
         coalesce(e.inventory_purchases, 0),
         coalesce(e.expenses_total, 0) - coalesce(e.inventory_purchases, 0),
         coalesce(s.voided_count, 0)
  from days
  left join s on s.day = days.day
  left join q on q.day = days.day
  left join e on e.day = days.day
  order by days.day;
$$;

create or replace function public.report_products(p_start date, p_end date)
returns table (
  product_id   uuid,
  product_name text,
  category     text,
  quantity     numeric,
  revenue      numeric,
  cost         numeric,
  transactions integer
)
language sql
stable
set search_path = ''
as $$
  select si.product_id,
         coalesce(p.name, si.product_name) as product_name,
         coalesce(p.category, 'Uncategorized') as category,
         sum(si.quantity),
         sum(si.subtotal),
         round(sum(si.quantity * si.unit_cost), 2),
         count(distinct si.sale_id)::int
  from public.sale_items si
  join public.sales sa on sa.id = si.sale_id
  left join public.products p on p.id = si.product_id
  where sa.owner_id = auth.uid() and sa.status = 'completed'
    and sa.sold_at >= (p_start::timestamp at time zone 'Asia/Manila')
    and sa.sold_at <  ((p_end + 1)::timestamp at time zone 'Asia/Manila')
  group by si.product_id, coalesce(p.name, si.product_name), coalesce(p.category, 'Uncategorized')
  order by sum(si.quantity) desc;
$$;

create or replace function public.report_payments(p_start date, p_end date)
returns table (payment_method text, transactions integer, total numeric)
language sql
stable
set search_path = ''
as $$
  select payment_method, count(*)::int, sum(total_amount)
  from public.sales
  where owner_id = auth.uid() and status = 'completed'
    and sold_at >= (p_start::timestamp at time zone 'Asia/Manila')
    and sold_at <  ((p_end + 1)::timestamp at time zone 'Asia/Manila')
  group by payment_method
  order by sum(total_amount) desc;
$$;

create or replace function public.report_expense_categories(p_start date, p_end date)
returns table (category_id uuid, category_name text, is_inventory_purchase boolean, entries integer, total numeric)
language sql
stable
set search_path = ''
as $$
  select ex.category_id,
         coalesce(c.name, 'Uncategorized'),
         coalesce(c.is_inventory_purchase, false) or bool_or(ex.inventory_item_id is not null),
         count(*)::int,
         sum(ex.amount)
  from public.expenses ex
  left join public.categories c on c.id = ex.category_id
  where ex.owner_id = auth.uid() and ex.expense_date between p_start and p_end
  group by ex.category_id, c.name, c.is_inventory_purchase
  order by sum(ex.amount) desc;
$$;

-- ---------------------------------------------------------------------
-- Account seeding
-- ---------------------------------------------------------------------
create or replace function private.seed_account(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hotdog uuid; v_stick_big uuid; v_stick_small uuid; v_oil uuid;
  v_siomai uuid; v_cup8 uuid; v_nestea uuid;
  v_p uuid;
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

  select id into v_hotdog      from public.inventory_items where owner_id = p_owner and name = 'Hotdog';
  select id into v_stick_big   from public.inventory_items where owner_id = p_owner and name = 'Stick Big';
  select id into v_stick_small from public.inventory_items where owner_id = p_owner and name = 'Stick Small';
  select id into v_oil         from public.inventory_items where owner_id = p_owner and name = 'Oil';
  select id into v_siomai      from public.inventory_items where owner_id = p_owner and name = 'Siomai';
  select id into v_cup8        from public.inventory_items where owner_id = p_owner and name = 'Cup 8oz';
  select id into v_nestea      from public.inventory_items where owner_id = p_owner and name = 'Nestea Juice';

  -- Starter products with sample recipes (edit quantities in Products).
  insert into public.products (owner_id, name, category, description, selling_price)
  values (p_owner, 'Hotdog Stick', 'Snacks', 'Sample recipe — adjust quantities to match your actual usage.', 15)
  returning id into v_p;
  insert into public.product_recipes (owner_id, product_id, inventory_item_id, quantity_used) values
    (p_owner, v_p, v_hotdog, 1), (p_owner, v_p, v_stick_big, 1), (p_owner, v_p, v_oil, 0.02);

  insert into public.products (owner_id, name, category, description, selling_price)
  values (p_owner, 'Siomai Stick', 'Snacks', 'Sample recipe — adjust quantities to match your actual usage.', 10)
  returning id into v_p;
  insert into public.product_recipes (owner_id, product_id, inventory_item_id, quantity_used) values
    (p_owner, v_p, v_siomai, 1), (p_owner, v_p, v_stick_small, 1), (p_owner, v_p, v_oil, 0.01);

  insert into public.products (owner_id, name, category, description, selling_price)
  values (p_owner, 'Juice', 'Beverages', 'Sample recipe — adjust quantities to match your actual usage.', 10)
  returning id into v_p;
  insert into public.product_recipes (owner_id, product_id, inventory_item_id, quantity_used) values
    (p_owner, v_p, v_cup8, 1), (p_owner, v_p, v_nestea, 0.1);
end;
$$;

-- Callable by the app for accounts created before this migration.
create or replace function public.initialize_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_account(private.require_user());
end;
$$;

-- Seed automatically for every new sign-up.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_account(new.id);
  return new;
end;
$$;

create trigger on_auth_user_created_almie
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------
revoke all on all functions in schema private from public, anon, authenticated;

revoke execute on function public.record_sale(jsonb, text, text, timestamptz)           from public, anon;
revoke execute on function public.update_sale(uuid, jsonb, text, text, timestamptz)     from public, anon;
revoke execute on function public.void_sale(uuid, text)                                 from public, anon;
revoke execute on function public.delete_sale(uuid)                                     from public, anon;
revoke execute on function public.save_expense(jsonb, uuid)                             from public, anon;
revoke execute on function public.delete_expense(uuid, boolean)                         from public, anon;
revoke execute on function public.adjust_stock(uuid, text, numeric, text)               from public, anon;
revoke execute on function public.initialize_account()                                  from public, anon;
revoke execute on function public.save_product(jsonb, jsonb, uuid)                      from public, anon;
revoke execute on function public.report_daily(date, date)                              from public, anon;
revoke execute on function public.report_products(date, date)                           from public, anon;
revoke execute on function public.report_payments(date, date)                           from public, anon;
revoke execute on function public.report_expense_categories(date, date)                 from public, anon;

grant execute on function public.record_sale(jsonb, text, text, timestamptz)       to authenticated;
grant execute on function public.update_sale(uuid, jsonb, text, text, timestamptz) to authenticated;
grant execute on function public.void_sale(uuid, text)                             to authenticated;
grant execute on function public.delete_sale(uuid)                                 to authenticated;
grant execute on function public.save_expense(jsonb, uuid)                         to authenticated;
grant execute on function public.delete_expense(uuid, boolean)                     to authenticated;
grant execute on function public.adjust_stock(uuid, text, numeric, text)           to authenticated;
grant execute on function public.initialize_account()                              to authenticated;
grant execute on function public.save_product(jsonb, jsonb, uuid)                  to authenticated;
grant execute on function public.report_daily(date, date)                          to authenticated;
grant execute on function public.report_products(date, date)                       to authenticated;
grant execute on function public.report_payments(date, date)                       to authenticated;
grant execute on function public.report_expense_categories(date, date)             to authenticated;

-- report functions call private.manila_date as the invoker
grant usage on schema private to authenticated;
grant execute on function private.manila_date(timestamptz) to authenticated;
grant execute on function private.require_user() to authenticated;

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.sales, public.expenses, public.inventory_items, public.products, public.inventory_movements;
  end if;
end;
$$;
