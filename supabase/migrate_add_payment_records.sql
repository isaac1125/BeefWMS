-- Add payment_records for payment history
create extension if not exists pgcrypto;

create table if not exists public.payment_records (
  id uuid default gen_random_uuid() primary key,
  customer_id uuid references public.customers(id) on delete cascade,
  payment_date date not null,
  amount numeric(10,2) not null,
  created_at timestamptz default now(),
  constraint payment_amount_non_negative check (amount = floor(amount) and amount >= 0)
);

create index if not exists payment_records_customer_date_idx on public.payment_records(customer_id, payment_date);

