-- Stock arrives whether or not this system issued the paperwork. A delivery is the
-- arrival itself: it may point at a PO we issued, carry a number written elsewhere,
-- or be marked pre-PO for stock predating the system.
create table if not exists deliveries (
  id          uuid primary key default gen_random_uuid(),
  hall_id     text not null,
  vendor_id   text not null references vendors(id),
  received_at date not null,
  po_id       uuid references purchase_orders(id),
  po_ref      text,
  invoice_no  text,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists deliveries_hall on deliveries(hall_id, received_at desc);

alter table boxes add column if not exists delivery_id uuid references deliveries(id);
create index if not exists boxes_delivery on boxes(delivery_id);

comment on column deliveries.po_ref is
  'A purchase order number not issued by this system, or PRE-PO for stock that predates it.';

alter table deliveries enable row level security;
create policy deliveries_auth_all on deliveries for all to authenticated using (true) with check (true);
