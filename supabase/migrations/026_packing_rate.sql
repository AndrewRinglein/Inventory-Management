-- Per-product packing rate, and the invoice evidence for it.
--
-- One distributor can charge two different rates. Bingo Vision invoice 1806034
-- (flash, 08/07/2026) carries $672.00 of untaxed packing, which is 168 boxes at
-- $4.00. Invoice 1806006 (strips, 08/05/2026) carries a STRIP COLLATION SERVICE
-- line of 800 deals at $2.00 = $1,600.00. A single vendors.packing_fee cannot
-- say both, and using $4.00 for strips doubled the collation on every tote line.
--
-- NULL means "use the distributor's rate". 0 is a real, different answer: a
-- product this vendor packs for free. So the column is nullable and the app only
-- falls through on NULL, never on 0.

alter table products add column if not exists packing_rate numeric(10,2);

comment on column products.packing_rate is
  'Overrides vendors.packing_fee for this product. NULL = use the vendor rate. '
  'Bingo Vision: $4.00/box to pack flash, $2.00/deal to collate strips.';

-- The Biker totes are collated, not packed: 80 deals at $2.00 = $160 a unit.
update products
   set packing_rate = 2.00
 where vendor_id = 'bv'
   and type = 'strip'
   and packing_units > 0;
