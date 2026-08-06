-- Orders that were placed outside this system (phoned in, emailed by hand,
-- already sitting on a truck) still need to exist here or the stock counts and
-- the month's spend are wrong. Recording one creates a real PO with real boxes
-- on order — it just never sends an email.
--
-- recorded_only is what keeps the two apart. Nothing downstream should treat a
-- recorded PO differently: it receives, closes and pays exactly like any other.
-- The flag is there so nobody looks at an empty email log and assumes the send
-- failed, and so "did we actually tell the vendor?" has an answer on the screen.
alter table purchase_orders
  add column if not exists recorded_only boolean not null default false,
  add column if not exists vendor_ref    text;

comment on column purchase_orders.recorded_only is
  'True when this PO was entered for the record and no email was sent to the vendor.';
comment on column purchase_orders.vendor_ref is
  'The vendor''s own order/invoice reference, when the order was placed outside this system.';
