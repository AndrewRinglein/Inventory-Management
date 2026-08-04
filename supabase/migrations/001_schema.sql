-- Bingo Inventory & Ordering — core schema
-- Run with: supabase db push   (or paste into the Supabase SQL editor)

create table halls (
  id text primary key,              -- 'sc' | 'rwc'
  name text not null
);

create table vendors (
  id text primary key,              -- 'bv','md','cbs','pbf'
  name text not null,
  email text not null default '',
  tax_rate numeric(6,4) not null default 0.0975,
  active boolean not null default true
);

create table products (
  id text primary key,              -- 'P001'... or 'C<timestamp>' for custom
  vendor_id text not null references vendors(id),
  name text not null,
  orig_name text,
  type text not null check (type in ('flash','strip','guarantee','paper')),
  cost numeric(10,2) not null check (cost >= 0),
  tickets integer check (tickets is null or tickets >= 0),
  price_per_ticket numeric(6,2) not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- persisted order-builder quantities (survive refresh, per hall)
create table order_qty (
  hall_id text not null references halls(id),
  product_id text not null references products(id),
  qty integer not null default 0 check (qty >= 0),
  primary key (hall_id, product_id)
);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  num text not null unique,         -- e.g. SC-2026-08-BV-001
  hall_id text not null references halls(id),
  vendor_id text not null references vendors(id),
  status text not null default 'draft'
    check (status in ('draft','sent','partial','closed')),
  subtotal numeric(12,2) not null,
  tax numeric(12,2) not null,
  total numeric(12,2) not null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table po_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  product_id text not null references products(id),
  name_snapshot text not null,      -- name + (tickets/$price) at send time
  qty integer not null check (qty > 0),
  cost numeric(10,2) not null       -- locked unit cost at send time
);

create table shipments (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id),
  invoice_no text not null default '',
  invoice_photo_path text,          -- Supabase Storage path
  notes text not null default '',
  received_at timestamptz not null default now(),
  confirmed boolean not null default false
);

create table boxes (
  id uuid primary key default gen_random_uuid(),
  hall_id text not null references halls(id),
  product_id text not null references products(id),
  po_id uuid references purchase_orders(id),
  shipment_id uuid references shipments(id),
  serial text not null default '',
  cost numeric(10,2) not null default 0,
  state text not null default 'on_order'
    check (state in ('on_order','in_inventory','opened','sold_out','missing')),
  session_tag text,                 -- "set aside" label
  ordered_at timestamptz not null default now(),
  received_at timestamptz,
  opened_at timestamptz,
  sold_out_at timestamptz
);
create index boxes_hall_state on boxes(hall_id, state);
create index boxes_serial on boxes(hall_id, serial);
create index boxes_po on boxes(po_id);

-- payments owed to vendors, created at shipment confirm (delivered $)
create table payments (
  id uuid primary key default gen_random_uuid(),
  hall_id text not null references halls(id),
  vendor_id text not null references vendors(id),
  po_num text not null,
  invoice_no text not null default '',
  amount numeric(12,2) not null,
  status text not null default 'open' check (status in ('open','paid')),
  created_at timestamptz not null default now()
);

create table emails (
  id uuid primary key default gen_random_uuid(),
  hall_id text references halls(id),
  po_num text,
  kind text not null check (kind in ('po','po_copy','shortage','delivered','export','other')),
  to_addr text not null,
  subject text not null,
  body text not null,
  test_mode boolean not null default true,
  provider_id text,                 -- Resend message id
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  created_at timestamptz not null default now()
);

create table events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null default 'app',
  kind text not null,               -- 'box.state','po.status','product.edit',...
  entity text not null,             -- table name
  entity_id text not null,
  detail jsonb not null default '{}'::jsonb
);

create table settings (
  key text primary key,
  value jsonb not null
);

-- state-machine guard: forbid illegal box transitions at the database level
create or replace function guard_box_state() returns trigger as $$
begin
  if old.state = new.state then return new; end if;
  if not (
    (old.state = 'on_order'     and new.state in ('in_inventory','missing')) or
    (old.state = 'in_inventory' and new.state in ('opened','missing')) or
    (old.state = 'opened'       and new.state in ('sold_out','in_inventory')) or  -- in_inventory = undo
    (old.state = 'sold_out'     and new.state in ('opened')) or                    -- undo only
    (old.state = 'missing'      and new.state in ('in_inventory','on_order'))      -- late arrival / undo
  ) then
    raise exception 'illegal box state transition: % -> %', old.state, new.state;
  end if;
  if new.state = 'in_inventory' and new.received_at is null then new.received_at := now(); end if;
  if new.state = 'opened'       and new.opened_at   is null then new.opened_at   := now(); end if;
  if new.state = 'sold_out'     and new.sold_out_at is null then new.sold_out_at := now(); end if;
  return new;
end $$ language plpgsql;

create trigger boxes_state_guard before update on boxes
  for each row execute function guard_box_state();
