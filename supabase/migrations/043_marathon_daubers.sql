-- Marathon daubers: variety packs, and every colour on its own.
--
-- DRAFT — not applied. Review before running.
--
-- How Marathon sells these. A colour is a DEAL. You can buy one deal of one
-- colour, or you can buy a variety pack, which is one deal of every colour in
-- one line so nobody has to key eleven rows to restock. The variety pack is an
-- ordering convenience, not a physical bundle: it lands as separate packs on the
-- shelf, one per colour.
--
-- So the pack is priced the way every other multi-deal line in this catalog is:
--
--     base_cost   price of ONE deal          $12.00
--     pack_units  deals in the ordered unit   x8
--     cost        what Marathon invoices      $96.00   (trigger-maintained)
--     split_boxes packs it becomes            8
--     perBoxValue what one pack is worth      $12.00
--
-- pack_units and split_boxes are equal on purpose, and both equal the number of
-- colours — the pack is a bundle of deals that immediately comes apart. Sunsational
-- carries eleven colours, so it is x11, not x8.
--
-- The singles are the same deal at pack_units 1, so a pack off a variety order and
-- a pack bought on its own are worth exactly the same on the shelf.
--
-- Daubers are bought for resale and are exempt (029). packing_units stays 0: the
-- $4 Marathon charges is per FLASH box (044) and must not attach to these.
--
-- The colours in each pack are NOT a column. Only these three products have such a
-- thing, and a column would invite every future product to half-fill it. They live
-- in src/data/variety-packs.js, which the PO renderer reads to print them under the
-- line. Kept in sync by tests/variety-packs.mjs.

begin;

-- ---------------------------------------------------------------- the packs
-- S830/S831/S832 already exist at pack_units 1, which understated every one of
-- them by their deal count. They have never been ordered and hold no stock, so
-- reshaping them is safe rather than something to work around.

-- 8 colours: Red, Green, Orange, Teal, Yellow, Purple, Pink, Fuchsia
update products set
  name        = 'Dabbin'' Fever 4oz — colour pack ($2)',
  base_cost   = 12.00,      -- cost recomputes to 96.00 via sync_product_cost
  pack_units  = 8,
  split_boxes = 8,
  stock_unit  = 'pack',
  type        = 'supply',
  taxable     = false,
  packing_units = 0,
  active      = true
where id = 'S830';

-- 11 colours: Red, Green, Orange, Pink, Magenta, Sky Blue, Coral, Lilac, Violet,
--             Yellow, Ruby Red
update products set
  name        = 'Sunsational 4oz — colour pack ($3)',
  base_cost   = 19.50,      -- 11 colours, so cost recomputes to 214.50
  pack_units  = 11,
  split_boxes = 11,
  stock_unit  = 'pack',
  type        = 'supply',
  taxable     = false,
  packing_units = 0,
  active      = true
where id = 'S831';

-- 8 colours: Red, Blue, Green, Orange, Yellow, Purple, Teal, Pink
update products set
  name        = 'Dabbin'' Win 1.5oz/15mm — colour pack ($1)',
  base_cost   = 10.50,      -- cost recomputes to 84.00
  pack_units  = 8,
  split_boxes = 8,
  stock_unit  = 'pack',
  type        = 'supply',
  taxable     = false,
  packing_units = 0,
  active      = true
where id = 'S832';

-- ---------------------------------------------------------------- the singles
-- One deal, one colour, the colour in the name so it is findable by typing it.
-- Same price per deal as inside the pack.
insert into products
  (id, vendor_id, name, orig_name, type, base_cost, pack_units, split_boxes,
   packing_units, stock_unit, tickets, price_per_ticket, taxable, active)
select
  s.id, 'md',
  s.family || ' ' || s.color || ' (' || s.tag || ')',
  s.family || ' ' || s.color,
  'supply', s.price, 1, 1, 0, 'pack', null, 1, false, true
from (values
  -- Dabbin' Fever 4oz — the $2 dauber
  ('S834','Dabbin'' Fever 4oz','Red',     12.00,'$2'),
  ('S835','Dabbin'' Fever 4oz','Green',   12.00,'$2'),
  ('S836','Dabbin'' Fever 4oz','Orange',  12.00,'$2'),
  ('S837','Dabbin'' Fever 4oz','Teal',    12.00,'$2'),
  ('S838','Dabbin'' Fever 4oz','Yellow',  12.00,'$2'),
  ('S839','Dabbin'' Fever 4oz','Purple',  12.00,'$2'),
  ('S840','Dabbin'' Fever 4oz','Pink',    12.00,'$2'),
  ('S841','Dabbin'' Fever 4oz','Fuchsia', 12.00,'$2'),
  -- Dabbin' Win 1.5oz/15mm — the $1 dauber
  ('S842','Dabbin'' Win 1.5oz/15mm','Red',    10.50,'$1'),
  ('S843','Dabbin'' Win 1.5oz/15mm','Blue',   10.50,'$1'),
  ('S844','Dabbin'' Win 1.5oz/15mm','Green',  10.50,'$1'),
  ('S845','Dabbin'' Win 1.5oz/15mm','Orange', 10.50,'$1'),
  ('S846','Dabbin'' Win 1.5oz/15mm','Yellow', 10.50,'$1'),
  ('S847','Dabbin'' Win 1.5oz/15mm','Purple', 10.50,'$1'),
  ('S848','Dabbin'' Win 1.5oz/15mm','Teal',   10.50,'$1'),
  ('S849','Dabbin'' Win 1.5oz/15mm','Pink',   10.50,'$1'),
  -- Sunsational 4oz — the $3 dauber
  ('S850','Sunsational 4oz','Red',      19.50,'$3'),
  ('S851','Sunsational 4oz','Green',    19.50,'$3'),
  ('S852','Sunsational 4oz','Orange',   19.50,'$3'),
  ('S853','Sunsational 4oz','Pink',     19.50,'$3'),
  ('S854','Sunsational 4oz','Magenta',  19.50,'$3'),
  ('S855','Sunsational 4oz','Sky Blue', 19.50,'$3'),
  ('S856','Sunsational 4oz','Coral',    19.50,'$3'),
  ('S857','Sunsational 4oz','Lilac',    19.50,'$3'),
  ('S858','Sunsational 4oz','Violet',   19.50,'$3'),
  ('S859','Sunsational 4oz','Yellow',   19.50,'$3'),
  ('S860','Sunsational 4oz','Ruby Red', 19.50,'$3')
) as s(id, family, color, price, tag)
on conflict (id) do update set
  name = excluded.name, base_cost = excluded.base_cost,
  pack_units = excluded.pack_units, split_boxes = excluded.split_boxes,
  stock_unit = excluded.stock_unit, taxable = excluded.taxable;

commit;

-- What this leaves:
--
--   S830  Dabbin' Fever colour pack   $12.00 x8   = $96.00    -> 8 packs at $12.00
--   S831  Sunsational colour pack     $19.50 x11  = $214.50   -> 11 packs at $19.50
--   S832  Dabbin' Win colour pack     $10.50 x8   = $84.00    -> 8 packs at $10.50
--   S834-S860  27 single colours, one deal each, same per-pack value
--
-- Deliberately NOT touched: S833, the $987 placeholder from invoice 5812121. It
-- stays as it is.
