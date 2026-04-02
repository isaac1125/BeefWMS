-- Seed data for BeefWMS

-- 7 items (seed default prices)
insert into public.items (name, enabled, requires_weighing, default_price_per_jin, default_price_per_unit)
select '小腱', true, true, 540, null
where not exists (select 1 from public.items where name = '小腱');
insert into public.items (name, enabled, requires_weighing, default_price_per_jin, default_price_per_unit)
select '大腱', true, true, 370, null
where not exists (select 1 from public.items where name = '大腱');
insert into public.items (name, enabled, requires_weighing, default_price_per_jin, default_price_per_unit)
select '牛筋', true, true, 380, null
where not exists (select 1 from public.items where name = '牛筋');
insert into public.items (name, enabled, requires_weighing, default_price_per_jin, default_price_per_unit)
select '牛肚', true, true, 345, null
where not exists (select 1 from public.items where name = '牛肚');
insert into public.items (name, enabled, requires_weighing, default_price_per_jin, default_price_per_unit)
select '辣油', true, false, null, 300
where not exists (select 1 from public.items where name = '辣油');
insert into public.items (name, enabled, requires_weighing, default_price_per_jin, default_price_per_unit)
select '油膏', true, false, null, 500
where not exists (select 1 from public.items where name = '油膏');
insert into public.items (name, enabled, requires_weighing, default_price_per_jin, default_price_per_unit)
select '醬袋', true, false, null, 185
where not exists (select 1 from public.items where name = '醬袋');

-- 5 customers
insert into public.customers (name, enabled)
select '寶春', true
where not exists (select 1 from public.customers where name = '寶春');
insert into public.customers (name, enabled)
select '小許', true
where not exists (select 1 from public.customers where name = '小許');
insert into public.customers (name, enabled)
select '佳宏', true
where not exists (select 1 from public.customers where name = '佳宏');
insert into public.customers (name, enabled)
select '志剛', true
where not exists (select 1 from public.customers where name = '秀琴');
select '阿瑋', true
where not exists (select 1 from public.customers where name = '秀琴');

-- customer_item_prices intentionally starts empty

