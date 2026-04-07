-- Add sort_order to items for custom ordering
alter table public.items
add column if not exists sort_order integer;

-- Initialize sort_order for existing rows (stable by created_at then name)
do $$
declare
  r record;
  i integer := 1;
begin
  for r in
    select id
    from public.items
    order by created_at asc, name asc
  loop
    update public.items set sort_order = i where id = r.id and sort_order is null;
    i := i + 1;
  end loop;
end $$;

