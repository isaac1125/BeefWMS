-- Migration: inventory_records 欄位命名（週別 -> 上次/本次語意）
-- - last_week_remaining -> previous_remaining
-- - this_week_inbound   -> current_inbound
-- - this_week_total     -> current_total
--
-- 使用方式：貼到 Supabase SQL Editor 執行

begin;

alter table public.inventory_records rename column last_week_remaining to previous_remaining;
alter table public.inventory_records rename column this_week_inbound to current_inbound;
alter table public.inventory_records rename column this_week_total to current_total;

-- （可選）rename check constraint 名稱：若你資料庫裡名字不同，這段可以先不要跑
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'inventory_last_week_remaining_is_integer' and conrelid = 'public.inventory_records'::regclass) then
    execute 'alter table public.inventory_records rename constraint inventory_last_week_remaining_is_integer to inventory_previous_remaining_is_integer';
  end if;
  if exists (select 1 from pg_constraint where conname = 'inventory_this_week_inbound_is_integer' and conrelid = 'public.inventory_records'::regclass) then
    execute 'alter table public.inventory_records rename constraint inventory_this_week_inbound_is_integer to inventory_current_inbound_is_integer';
  end if;
  if exists (select 1 from pg_constraint where conname = 'inventory_this_week_total_is_integer' and conrelid = 'public.inventory_records'::regclass) then
    execute 'alter table public.inventory_records rename constraint inventory_this_week_total_is_integer to inventory_current_total_is_integer';
  end if;
end
$$;

commit;

