-- Per-vendor packing surcharge (Bingo Vision charges $4 per box of flash).
-- Modelled as vendor config + a PO line of kind 'fee' so it prints on the PO,
-- counts toward the total and tax, but never creates an inventory box.

alter table vendors add column if not exists packing_fee numeric(10,2) not null default 0;
alter table vendors add column if not exists packing_types text not null default 'flash';

alter table po_lines add column if not exists kind text not null default 'item'
  check (kind in ('item', 'fee'));
alter table po_lines alter column product_id drop not null;

update vendors set packing_fee = 4, packing_types = 'flash' where id = 'bv';
