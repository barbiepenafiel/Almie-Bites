-- =====================================================================
-- Almie Bites — cash received from staff + Juice income
--
-- Each day the Admin types the cash a staff member hands over.
--   expected = that staff member's completed sales for the day
--   cash > expected  → the extra is Juice income, recorded as a Juice sale
--                      for that staff member (counts in sales everywhere,
--                      never touches stock)
--   cash < expected  → shown as a shortage (nothing is recorded)
-- =====================================================================

alter table public.sales add column if not exists is_cash_over boolean not null default false;

create table if not exists public.staff_cash (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  staff_id      uuid not null references public.staff(id) on delete cascade,
  day           date not null,
  cash          numeric(12,2) not null check (cash >= 0),
  juice_sale_id uuid references public.sales(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (owner_id, staff_id, day)
);
create index if not exists staff_cash_owner_day_idx on public.staff_cash (owner_id, day);

alter table public.staff_cash enable row level security;
create policy "staff cash: owner read" on public.staff_cash for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "deny staff direct access" on public.staff_cash as restrictive for all to authenticated
  using (not (select private.is_staff_user())) with check (not (select private.is_staff_user()));
revoke all on public.staff_cash from anon;
grant select on public.staff_cash to authenticated;

-- ---------------------------------------------------------------------
-- Save (or clear, with p_cash = null) the cash a staff member gave for a day.
-- Re-saving recalculates the Juice sale from the current sales.
-- ---------------------------------------------------------------------
create or replace function public.save_staff_cash(p_staff_id uuid, p_day date, p_cash numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner     uuid := private.require_user();
  v_staff     public.staff;
  v_row       public.staff_cash;
  v_expected  numeric;
  v_over      numeric;
  v_sale      uuid;
  v_prod_id   uuid;
  v_prod_name text;
  v_start     timestamptz;
  v_end       timestamptz;
  v_when      timestamptz;
begin
  if p_day is null then
    raise exception 'Choose the day.' using errcode = '22023';
  end if;
  if p_cash is not null and p_cash < 0 then
    raise exception 'Cash can''t be negative.' using errcode = '22023';
  end if;
  select * into v_staff from public.staff where id = p_staff_id and owner_id = v_owner;
  if not found then
    raise exception 'Staff member not found.' using errcode = 'P0002';
  end if;

  select * into v_row from public.staff_cash
  where owner_id = v_owner and staff_id = p_staff_id and day = p_day
  for update;

  -- Drop the previous Juice sale; it is recalculated below.
  if v_row.juice_sale_id is not null then
    delete from public.sales where id = v_row.juice_sale_id and owner_id = v_owner and is_cash_over;
  end if;

  if p_cash is null then
    delete from public.staff_cash where id = v_row.id;
    return jsonb_build_object('cleared', true);
  end if;

  v_start := p_day::timestamp at time zone 'Asia/Manila';
  v_end   := (p_day + 1)::timestamp at time zone 'Asia/Manila';

  select coalesce(sum(total_amount), 0) into v_expected
  from public.sales
  where owner_id = v_owner and staff_id = p_staff_id and status = 'completed' and not is_cash_over
    and sold_at >= v_start and sold_at < v_end;

  v_over := round(p_cash - v_expected, 2);

  if v_over > 0 then
    select id, name into v_prod_id, v_prod_name
    from public.products
    where owner_id = v_owner and name ilike '%juice%'
    order by (lower(btrim(name)) = 'juice') desc, created_at
    limit 1;

    -- Inside the day: now if it is today, else the last second of that day.
    v_when := greatest(v_start, least(now(), v_end - interval '1 second'));

    insert into public.sales
      (owner_id, transaction_number, total_amount, total_cost, payment_method, notes, sold_at,
       staff_id, recorded_by, is_cash_over)
    values
      (v_owner, private.next_transaction_number(v_owner, v_when), v_over, 0, 'Cash',
       format('Juice income: cash %s − expected %s', p_cash, v_expected), v_when,
       p_staff_id, auth.uid(), true)
    returning id into v_sale;

    insert into public.sale_items (owner_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost)
    values (v_owner, v_sale, v_prod_id, coalesce(v_prod_name, 'Juice'), 1, v_over, 0);
  end if;

  insert into public.staff_cash (owner_id, staff_id, day, cash, juice_sale_id)
  values (v_owner, p_staff_id, p_day, p_cash, v_sale)
  on conflict (owner_id, staff_id, day)
  do update set cash = excluded.cash, juice_sale_id = excluded.juice_sale_id, updated_at = now();

  return jsonb_build_object(
    'expected', v_expected,
    'cash', p_cash,
    'juice', greatest(v_over, 0),
    'short', greatest(-v_over, 0)
  );
end;
$$;

revoke execute on function public.save_staff_cash(uuid, date, numeric) from public, anon;
grant execute on function public.save_staff_cash(uuid, date, numeric) to authenticated;
