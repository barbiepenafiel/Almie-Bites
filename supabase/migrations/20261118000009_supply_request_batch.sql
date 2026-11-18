-- =====================================================================
-- Almie Bites — send several supply requests at once ("cart")
-- All items are saved in one transaction: either every item is sent or none.
--   p_items: [{item_id, quantity}]   (same item twice is merged)
-- =====================================================================
create or replace function public.staff_create_requests(p_items jsonb, p_notes text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.staff := private.require_active_staff();
  v_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item to your request.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Too many items in one request (50 max).' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) x
    where nullif(x ->> 'quantity', '') is null or (x ->> 'quantity')::numeric <= 0
       or not exists (select 1 from public.inventory_items i where i.id = (x ->> 'item_id')::uuid and i.owner_id = v.owner_id)
  ) then
    raise exception 'Each item needs a valid item and a quantity above 0.' using errcode = '22023';
  end if;

  insert into public.supply_requests (owner_id, staff_id, inventory_item_id, quantity, notes)
  select v.owner_id, v.id, (x ->> 'item_id')::uuid, round(sum((x ->> 'quantity')::numeric), 3), nullif(btrim(p_notes), '')
  from jsonb_array_elements(p_items) x
  group by (x ->> 'item_id')::uuid;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.staff_create_requests(jsonb, text) from public, anon;
grant execute on function public.staff_create_requests(jsonb, text) to authenticated;
