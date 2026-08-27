-- Santa Clara's Biker 10-pack: a bigger case, split into fewer totes.
--
-- Both halls buy a "10-Pack of strips Biker" from Bingo Vision and the records
-- looked alike, so both carried the same case — 80 deals at $64.60 = $5,168 —
-- split into 16 totes. Neither number was right for Santa Clara.
--
--   deals per case    80 -> 160   SC buys sixteen 10-packs, RWC buys eight
--   totes per case    16 ->   8   SC packs its own totes at 20 deals each
--   collation         80 -> 160   Bingo Vision bills $2.00 a deal to collate
--
-- So a Santa Clara case is $10,336 of goods and reaches the shelf as 8 totes at
-- $1,292. It had been recording a $5,168 case as 16 totes at $323 — half the
-- money, spread over twice the totes.
--
-- The thing that made this hard to see, and worth writing down: A TOTE IS NOT A
-- FIXED SIZE. It was tempting to assume a tote is ten deals everywhere, because
-- two of the four records happen to work out that way. They do not:
--
--   P163 / P164  SC   160 deals /  8 totes = 20 deals, $1,292 a tote
--   R715         RWC   80 deals /  8 totes = 10 deals,   $646 a tote
--   R714         RWC   80 deals / 16 totes =  5 deals,   $323 a tote
--
-- deals_per_case and totes_per_case are genuinely independent: the first is what
-- the distributor ships, the second is what the hall chooses to make of it. Any
-- future cleanup that "normalises" one from the other will silently rewrite the
-- value of everything on both floors.
--
-- Recorded purchase orders are NOT touched. po_lines carry the price they were
-- sent at, and SC-2026-08-BV-002 has no payable against it, so nothing already
-- agreed with the vendor is rewritten. This changes what the NEXT Santa Clara
-- order prices at, and how many totes a receipt creates.
--
-- Existing tote records are left alone by decision. Note the consequence: past SC
-- receipts created 16 totes per case and future ones will create 8, so Santa
-- Clara's Biker rows carry two generations of tote until the old stock is played
-- out or recounted.
--
-- STILL OPEN, deliberately not changed: R714 splits an 80-deal case into 16 totes,
-- which is 5 deals a tote where its sibling R715 is 10. Confirmed as correct for
-- now, but the two Redwood City records do disagree with each other.
--
-- APPLIED 2026-08-26 via execute_sql.

update products
   set pack_units = 160,      -- deals in one ordered case
       packing_units = 160,   -- collation is billed per deal
       split_boxes = 8        -- totes the hall makes of that case
 where id in ('P163', 'P164');

-- Verified after running:
--   P163/P164  case $10,336.00, 8 totes, $1,292.00 a tote, collation $320.00
