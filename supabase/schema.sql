-- BeefWMS Supabase schema (package-stock + weighing billing)
-- Run in Supabase SQL Editor

create extension if not exists pgcrypto;

-- 1) items
create table if not exists public.items (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  enabled boolean default true,
  requires_weighing boolean default false,
  default_price_per_jin numeric(10,2),
  default_price_per_unit numeric(10,2),
  sort_order integer,
  created_at timestamptz default now()
);

-- 2) customers
create table if not exists public.customers (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  enabled boolean default true,
  created_at timestamptz default now()
);

-- 3) customer_item_prices (no discount; per-customer per-item price override)
create table if not exists public.customer_item_prices (
  id uuid default gen_random_uuid() primary key,
  customer_id uuid references public.customers(id) on delete cascade,
  item_id uuid references public.items(id) on delete cascade,
  price_per_unit numeric(10,2),
  price_per_jin numeric(10,2),
  created_at timestamptz default now(),
  unique(customer_id, item_id)
);

-- 4) inventory_records (snapshot: package counts)
create table if not exists public.inventory_records (
  id uuid default gen_random_uuid() primary key,
  item_id uuid references public.items(id) on delete cascade,
  record_date date not null,
  previous_remaining numeric(10,2) default 0,
  current_inbound numeric(10,2) default 0,
  current_total numeric(10,2) default 0,
  created_at timestamptz default now(),
  constraint inventory_record_item_unique unique(record_date, item_id),
  constraint inventory_previous_remaining_is_integer check (previous_remaining = floor(previous_remaining)),
  constraint inventory_current_inbound_is_integer check (current_inbound = floor(current_inbound)),
  constraint inventory_current_total_is_integer check (current_total = floor(current_total)),
  constraint inventory_non_negative check (
    previous_remaining >= 0
    and current_inbound >= 0
    and current_total >= 0
  )
);

create index if not exists inventory_records_record_date_idx on public.inventory_records(record_date);

-- 5) pickups (package take records)
create table if not exists public.pickups (
  id uuid default gen_random_uuid() primary key,
  customer_id uuid references public.customers(id) on delete cascade,
  item_id uuid references public.items(id) on delete cascade,
  quantity numeric(10,2) not null,
  pickup_date date not null,
  pickup_status text default 'pending'
    check (pickup_status in ('pending', 'billed', 'cancelled')),
  created_at timestamptz default now(),
  constraint pickups_quantity_is_integer check (quantity = floor(quantity) and quantity >= 0)
);

create index if not exists pickups_customer_status_idx on public.pickups(customer_id, pickup_status);
create index if not exists pickups_pickup_date_idx on public.pickups(pickup_date);

-- 6) billing_records (final billing + debt)
create table if not exists public.billing_records (
  id uuid default gen_random_uuid() primary key,
  pickup_id uuid references public.pickups(id) on delete cascade,
  customer_id uuid references public.customers(id),
  item_id uuid references public.items(id),
  weight_jin numeric(10,2),
  weight_liang numeric(10,2),
  total_amount numeric(10,2) not null,
  paid_amount numeric(10,2) default 0,
  previous_debt numeric(10,2) default 0,
  current_debt numeric(10,2) not null,
  billing_date date,
  created_at timestamptz default now(),
  constraint billing_weight_liang_range
    check (weight_liang is null or (weight_liang >= 0 and weight_liang < 16)),
  constraint billing_weight_jin_non_negative
    check (weight_jin is null or weight_jin >= 0)
);

create index if not exists billing_records_customer_debt_idx on public.billing_records(customer_id, current_debt);

-- 7) payment_records (payment events for history)
create table if not exists public.payment_records (
  id uuid default gen_random_uuid() primary key,
  customer_id uuid references public.customers(id) on delete cascade,
  payment_date date not null,
  amount numeric(10,2) not null,
  created_at timestamptz default now(),
  constraint payment_amount_non_negative check (amount = floor(amount) and amount >= 0)
);

create index if not exists payment_records_customer_date_idx on public.payment_records(customer_id, payment_date);

