-- Migration: inventory_records.week_date -> record_date
-- 目的：把「週別」欄位正式改為「日期」欄位，且不會因 constraint/index 名稱不同而失敗
-- 使用方式：貼到 Supabase SQL Editor 執行

begin;

-- 1) 欄位改名（若你已改過，這行會失敗；請改用下方 IF 判斷版）
alter table public.inventory_records
  rename column week_date to record_date;

-- 2) 依存在與否改名 constraint（可選，不影響功能）
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'inventory_week_item_unique'
      and conrelid = 'public.inventory_records'::regclass
  ) then
    execute 'alter table public.inventory_records rename constraint inventory_week_item_unique to inventory_record_item_unique';
  end if;
end
$$;

-- 3) 依存在與否改名 index（可選，不影響功能）
do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'i'
      and c.relname = 'inventory_records_week_date_idx'
  ) then
    execute 'alter index public.inventory_records_week_date_idx rename to inventory_records_record_date_idx';
  end if;
end
$$;

commit;

-- -----------------------
-- 如果你已經先手動改過欄位名，請改跑這版（不會報錯）：
-- -----------------------
-- do $$
-- begin
--   if exists (
--     select 1
--     from information_schema.columns
--     where table_schema = 'public'
--       and table_name = 'inventory_records'
--       and column_name = 'week_date'
--   ) then
--     execute 'alter table public.inventory_records rename column week_date to record_date';
--   end if;
-- end
-- $$;

