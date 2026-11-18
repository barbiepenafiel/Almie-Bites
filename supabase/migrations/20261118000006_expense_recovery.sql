-- =====================================================================
-- Almie Bites — Product expense recovery targets
--
-- A recovery target says: "₱X was spent for product P; sales of P must
-- recover it". Recovery figures are always CALCULATED from completed sales
-- (never stored), so voids/edits/deletes are reflected automatically.
--
--   scope 'day'      : sales of P on start_date only
--   scope 'batch'    : sales of P from start_date until the target is closed
--   scope 'purchase' : like batch, tied to a recorded purchase expense
--
--   recovered = least(sales, target)
--   remaining = greatest(target − sales, 0)
--   above     = greatest(sales − target, 0)   ← sales revenue, NOT profit
--
-- New staff pay method 'after_recovery': commission % only on sales above
-- each product's active recovery target (products without a target earn on
-- the full sale). Snapshotted per sale line like the other methods.
-- =====================================================================

create table public.recovery_targets (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id       uuid not null references public.products(id) on delete cascade,
  expense_id       uuid references public.expenses(id) on delete set null,
  scope            text not null default 'batch' check (scope in ('day', 'batch', 'purchase')),
  assigned_expense numeric(12,2) not null check (assigned_expense >= 0),
  target_amount    numeric(12,2) not null check (target_amount > 0),
  start_date       date not null default ((now() at time zone 'Asia/Manila')::date),
  end_date         date,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (scope <> 'day' or end_date = start_date)
);
create index recovery_targets_owner_idx on public.recovery_targets (owner_id, start_date desc);
create index recovery_targets_product_idx on public.recovery_targets (product_id, start_date desc);
create index recovery_targets_expense_idx on public.recovery_targets (expense_id);
create trigger trg_recovery_targets_updated before update on public.recovery_targets
  for each row execute function private.set_updated_at();

alter table public.recovery_targets enable row level security;
create policy "recovery: owner read" on public.recovery_targets for select to authenticated using (owner_id = (select auth.uid()));
create policy "recovery: owner insert" on public.recovery_targets for insert to authenticated with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
  and (expense_id is null or exists (select 1 from public.expenses e where e.id = expense_id and e.owner_id = (select auth.uid())))
);
create policy "recovery: owner update" on public.recovery_targets for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
    and (expense_id is null or exists (select 1 from public.expenses e where e.id = expense_id and e.owner_id = (select auth.uid())))
  );
create policy "recovery: owner delete" on public.recovery_targets for delete to authenticated using (owner_id = (select auth.uid()));
create policy "deny staff direct access" on public.recovery_targets as restrictive for all to authenticated
  using (not (select private.is_staff_user())) with check (not (select private.is_staff_user()));
revoke all on public.recovery_targets from anon;
grant select, insert, update, delete on public.recovery_targets to authenticated;

-- ---------------------------------------------------------------------
-- Staff pay: commission after recovery
-- ---------------------------------------------------------------------
alter table public.staff drop constraint if exists staff_earning_type_check;
alter table public.staff add constraint staff_earning_type_check
  check (earning_type in ('percentage', 'per_item', 'per_product', 'daily_tier', 'profit_share', 'after_recovery'));
alter table public.sale_items drop constraint if exists sale_items_staff_earning_type_check;
alter table public.sale_items add constraint sale_items_staff_earning_type_check
  check (staff_earning_type in ('percentage', 'per_item', 'per_product', 'daily_tier', 'profit_share', 'after_recovery'));

-- ---------------------------------------------------------------------
-- Sales of a product inside a target window (completed only), up to a date.
-- ---------------------------------------------------------------------
create or replace function private.product_sales_between(p_owner uuid, p_product uuid, p_start date, p_end date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(si.subtotal), 0)
  from public.sale_items si
  join public.sales sa on sa.id = si.sale_id
  where sa.owner_id = p_owner and sa.status = 'completed' and si.product_id = p_product
    and sa.sold_at >= (p_start::timestamp at time zone 'Asia/Manila')
    and (p_end is null or sa.sold_at < ((p_end + 1)::timestamp at time zone 'Asia/Manila'));
$$;

-- ---------------------------------------------------------------------
-- Admin report: recovery progress as of a date (default today).
-- p_active_only: only targets whose window includes p_as_of.
-- ---------------------------------------------------------------------
create or replace function public.report_recovery(p_as_of date default null, p_active_only boolean default false)
returns table (
  target_id        uuid,
  product_id       uuid,
  product_name     text,
  scope            text,
  start_date       date,
  end_date         date,
  expense_id       uuid,
  expense_name     text,
  expense_date     date,
  assigned_expense numeric,
  target_amount    numeric,
  sales_total      numeric,
  recovered        numeric,
  remaining        numeric,
  above_target     numeric,
  percent          numeric,
  status           text,
  is_open          boolean,
  notes            text
)
language sql
stable
set search_path = ''
as $$
  with t as (
    select r.*, p.name as product_name,
           coalesce(p_as_of, (now() at time zone 'Asia/Manila')::date) as as_of
    from public.recovery_targets r
    join public.products p on p.id = r.product_id
    where r.owner_id = auth.uid()
  ),
  s as (
    select t.*,
           private.product_sales_between(t.owner_id, t.product_id, t.start_date,
             least(coalesce(t.end_date, t.as_of), t.as_of)) as sales_total
    from t
    where t.start_date <= t.as_of
      and (not p_active_only or t.end_date is null or t.end_date >= t.as_of)
  )
  select s.id, s.product_id, s.product_name, s.scope, s.start_date, s.end_date,
         s.expense_id, e.name, e.expense_date,
         s.assigned_expense, s.target_amount, s.sales_total,
         least(s.sales_total, s.target_amount),
         greatest(s.target_amount - s.sales_total, 0),
         greatest(s.sales_total - s.target_amount, 0),
         round(s.sales_total / s.target_amount * 100, 1),
         case when s.sales_total <= 0 then 'not_recovered'
              when s.sales_total < s.target_amount then 'partial'
              when s.sales_total = s.target_amount then 'recovered'
              else 'exceeded' end,
         s.end_date is null or s.end_date >= s.as_of,
         s.notes
  from s
  left join public.expenses e on e.id = s.expense_id
  order by (s.end_date is null) desc, s.start_date desc, s.product_name;
$$;

-- ---------------------------------------------------------------------
-- Admin: create a target. For batch/purchase scope, any still-open target
-- of the same product is closed the day before, so sales are never
-- counted against two targets.
--   p_data: {product_id, scope, assigned_expense, target_amount, start_date,
--            expense_id, notes}
-- ---------------------------------------------------------------------
create or replace function public.save_recovery_target(p_data jsonb, p_target_id uuid default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_owner   uuid := private.require_user();
  v_id      uuid := p_target_id;
  v_product uuid := (p_data ->> 'product_id')::uuid;
  v_scope   text := coalesce(nullif(p_data ->> 'scope', ''), 'batch');
  v_expense uuid := nullif(p_data ->> 'expense_id', '')::uuid;
  v_assigned numeric := nullif(p_data ->> 'assigned_expense', '')::numeric;
  v_target  numeric := nullif(p_data ->> 'target_amount', '')::numeric;
  v_start   date := coalesce(nullif(p_data ->> 'start_date', '')::date, (now() at time zone 'Asia/Manila')::date);
  v_exp     public.expenses%rowtype;
begin
  if v_scope not in ('day', 'batch', 'purchase') then
    raise exception 'Choose one day, a batch, or a specific purchase.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = v_product and owner_id = v_owner) then
    raise exception 'Product not found.' using errcode = 'P0002';
  end if;
  if v_expense is not null then
    select * into v_exp from public.expenses where id = v_expense and owner_id = v_owner;
    if not found then
      raise exception 'Expense not found.' using errcode = 'P0002';
    end if;
    v_assigned := coalesce(v_assigned, v_exp.amount);
    if v_scope = 'purchase' then
      v_start := coalesce(nullif(p_data ->> 'start_date', '')::date, v_exp.expense_date);
    end if;
  end if;
  if v_scope = 'purchase' and v_expense is null then
    raise exception 'Choose the purchase this target is for.' using errcode = '22023';
  end if;
  if v_assigned is null or v_assigned < 0 then
    raise exception 'Enter the amount spent.' using errcode = '22023';
  end if;
  v_target := coalesce(v_target, v_assigned);
  if v_target <= 0 then
    raise exception 'The recovery target must be more than ₱0.' using errcode = '22023';
  end if;

  if v_id is null then
    if v_scope <> 'day' then
      update public.recovery_targets
      set end_date = greatest(start_date, v_start - 1)
      where owner_id = v_owner and product_id = v_product and scope <> 'day'
        and end_date is null and start_date < v_start;
    end if;
    insert into public.recovery_targets
      (owner_id, product_id, expense_id, scope, assigned_expense, target_amount, start_date, end_date, notes)
    values
      (v_owner, v_product, v_expense, v_scope, v_assigned, v_target, v_start,
       case when v_scope = 'day' then v_start end, nullif(btrim(p_data ->> 'notes'), ''))
    returning id into v_id;
  else
    update public.recovery_targets set
      product_id = v_product, expense_id = v_expense, scope = v_scope,
      assigned_expense = v_assigned, target_amount = v_target, start_date = v_start,
      end_date = case when v_scope = 'day' then v_start
                      when end_date is not null and end_date < v_start then v_start
                      else end_date end,
      notes = nullif(btrim(p_data ->> 'notes'), '')
    where id = v_id and owner_id = v_owner;
    if not found then
      raise exception 'Recovery target not found.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Sale lines: add after_recovery staff pay
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

revoke all on function private.product_sales_between(uuid, uuid, date, date) from public, anon, authenticated;
revoke all on function private.insert_sale_items(uuid, uuid, jsonb, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.report_recovery(date, boolean) from public, anon;
revoke execute on function public.save_recovery_target(jsonb, uuid) from public, anon;
grant execute on function public.report_recovery(date, boolean) to authenticated;
grant execute on function public.save_recovery_target(jsonb, uuid) to authenticated;
-- report_recovery runs as the caller and needs this helper
grant execute on function private.product_sales_between(uuid, uuid, date, date) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.recovery_targets;
  end if;
end;
$$;
