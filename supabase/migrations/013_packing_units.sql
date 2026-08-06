-- Packing is charged per unit inside the box, and which products carry it is a
-- property of the product, not of its type. A box of flash holds 1 chargeable unit
-- ($4). The Biker 10-pack cases hold 80 ($320). Ordinary strips carry none at all.
-- 0 means "no packing on this product", which is the safe default for anything
-- nobody has confirmed — daubers included.
alter table products add column if not exists packing_units integer not null default 0;

update products set packing_units = 1  where type = 'flash';
update products set packing_units = 80 where name ~* '10.?pack of strips';

comment on column products.packing_units is
  'Chargeable packing units per box. 0 = this product is never charged packing.';
