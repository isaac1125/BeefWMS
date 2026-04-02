-- 清空交易資料：保留 customers + items
-- 使用方式：貼到 Supabase SQL Editor 執行
-- 注意：這會刪除 pickups / billing_records / inventory_records / customer_item_prices 的所有資料

begin;
truncate table
  public.billing_records,
  public.pickups,
  public.inventory_records,
  public.customer_item_prices;
commit;


