-- =====================================================================
-- Almie Bites — Pack-to-piece inventory, piece-level costing, profit share
--
-- * Inventory items bought in packs/kg can store a purchase unit and an
--   estimated number of pieces per pack (decimals allowed, e.g. 12.5).
--   Stock is counted in pieces; purchase_price is the cost PER PIECE.
-- * Buying N packs adds N × pieces-per-pack pieces. Cost per piece uses a
--   weighted average across purchases; each purchase's cost per piece is
--   kept on its stock movement (purchase cost history).
-- * Each product is linked to the inventory item it is sold from
--   (product_recipes, normally 1 piece per sale). Recording a sale deducts
--   pieces and snapshots the cost per piece on the sale line (unit_cost),
--   so historical cost of goods sold never changes.
-- * New staff pay method 'profit_share': % of gross profit
--   (sales − cost of pieces sold).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Inventory: pack conversion + more precise per-piece cost
-- ---------------------------------------------------------------------
drop view if exists public.product_costs;
alter table public.inventory_items drop column stock_value;
alter table public.inventory_items alter column purchase_price type numeric(14,4);
alter table public.inventory_items
  add column stock_value numeric(16,2) generated always as (round(greatest(current_stock, 0) * purchase_price, 2)) stored,
  add column pack_unit text check (pack_unit is null or length(btrim(pack_unit)) between 1 and 40),
  add column pieces_per_pack numeric(12,3) check (pieces_per_pack is null or pieces_per_pack > 0),
  add column pack_price numeric(12,2) check (pack_price is null or pack_price >= 0);

grant update (name, category, unit, minimum_stock, purchase_price, supplier, notes, pack_unit, pieces_per_pack, pack_price)
  on public.inventory_items to authenticated;

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
grant select on public.product_costs to authenticated;

alter table public.inventory_movements add column unit_cost numeric(14,4);

-- ---------------------------------------------------------------------
-- Staff pay: share of gross profit
-- ---------------------------------------------------------------------
alter table public.staff drop constraint if exists staff_earning_type_check;
alter table public.staff add constraint staff_earning_type_check
  check (earning_type in ('percentage', 'per_item', 'per_product', 'daily_tier', 'profit_share'));
alter table public.sale_items drop constraint if exists sale_items_staff_earning_type_check;
alter table public.sale_items add constraint sale_items_staff_earning_type_check
  check (staff_earning_type in ('percentage', 'per_item', 'per_product', 'daily_tier', 'profit_share'));

-- ---------------------------------------------------------------------
-- Starting pack conversions + product links (editable afterwards)
-- ---------------------------------------------------------------------
create or replace function private.setup_pack_conversions(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  v_item uuid;
  v_name text;
begin
  for c in
    select * from (values
      ('Tempura',  '1 kg pack', 29::numeric,   array['Tempura', 'Tempura Stick']),
      ('Kikiam',   '1 kg pack', 8::numeric,    array['Kikiam', 'Kikiam Stick']),
      ('Fishball', '1 kg pack', 11::numeric,   array['Fishball', 'Fishball Stick']),
      ('Hotdog',   '1 pack',    12.5::numeric, array['Hotdog', 'Hotdog Stick']),
      ('Siomai',   '1 pack',    17::numeric,   array['Siomai', 'Siomai Stick'])
    ) as t(item, pack_unit, pieces, product_names)
  loop
    v_item := null;
    select id into v_item from public.inventory_items
    where owner_id = p_owner and lower(name) = lower(c.item);

    if v_item is null then
      insert into public.inventory_items (owner_id, name, category, unit, current_stock, minimum_stock, pack_unit, pieces_per_pack)
      values (p_owner, c.item, 'Ingredient/Product', 'Piece', 0, 10, c.pack_unit, c.pieces)
      returning id into v_item;
    else
      update public.inventory_items
      set pack_unit = coalesce(pack_unit, c.pack_unit),
          pieces_per_pack = coalesce(pieces_per_pack, c.pieces),
          unit = 'Piece'
      where id = v_item;
    end if;

    -- Link matching products that are not linked to anything yet (1 piece per sale).
    foreach v_name in array c.product_names loop
      insert into public.product_recipes (owner_id, product_id, inventory_item_id, quantity_used)
      select p_owner, p.id, v_item, 1
      from public.products p
      where p.owner_id = p_owner and lower(p.name) = lower(v_name)
        and not exists (select 1 from public.product_recipes r where r.product_id = p.id);
    end loop;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Purchases: weighted average cost per piece + purchase cost history
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

  -- Purchase cost per piece for this purchase, kept on the stock movement (cost history).
  if v_item is not null and v_new_added > 0 then
    update public.inventory_movements
    set unit_cost = round(v_amount / v_new_added, 4)
    where expense_id = v_id and movement_type in ('purchase', 'adjustment') and unit_cost is null;
  end if;

  -- Weighted average cost per piece: (old pieces x old cost + this purchase) / all pieces.
  if v_item is not null and coalesce((p_data ->> 'update_item_cost')::boolean, false) and v_new_added > 0 then
    update public.inventory_items i
    set purchase_price = round(
          case when i.current_stock - v_new_added > 0 and i.purchase_price > 0
               then ((i.current_stock - v_new_added) * i.purchase_price + v_amount) / i.current_stock
               else v_amount / v_new_added end, 4),
        pack_price = coalesce(nullif(p_data ->> 'pack_price', '')::numeric, i.pack_price)
    where i.id = v_item and i.owner_id = v_owner;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Sale lines: add profit_share staff pay
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

-- ---------------------------------------------------------------------
-- New accounts also get the pack conversions
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

  perform private.setup_pack_conversions(p_owner);
end;
$$;

-- Apply to every existing business (owners only, never staff logins).
do $$
declare
  o uuid;
begin
  for o in select owner_id from public.business_settings loop
    perform private.setup_pack_conversions(o);
  end loop;
end;
$$;

revoke all on function private.setup_pack_conversions(uuid) from public, anon, authenticated;
revoke all on function private.insert_sale_items(uuid, uuid, jsonb, uuid, boolean) from public, anon, authenticated;
revoke all on function private.seed_account(uuid) from public, anon, authenticated;
revoke execute on function public.save_expense(jsonb, uuid) from public, anon;
grant execute on function public.save_expense(jsonb, uuid) to authenticated;
