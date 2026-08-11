-- Re-reading the July 2026 Santa Clara inventory count, after it was queried.
--
-- Three separate faults, all in the original import, all understating stock.
--
-- 1. TEXT-TYPED COUNTS WERE SKIPPED. 25 Bingo Vision rows carry their count as a
--    text cell rather than a number ('38', '.5', '1.33'). The import only read
--    numeric cells, so it dropped every one — 174 units, $77,733.91, including
--    BOTH Biker tote lines (38 and 40 totes) and every lettered strip pack:
--    Monopoly, American Heroes, Bingo Shark, Broadway, Whole Enchiladas, Fiesta,
--    Sheva, Wabbit Twack, the Double Action and Neon paper, and six part-cases of
--    cherry tickets. This is the big one.
--
-- 2. STRIP CASES WERE VALUED AS SINGLE PACKS. The sheet writes "Big Cheese
--    180x8", count 1, $512 — one case of 8 packs at $64. The import stored one
--    box at $64. 21 Marathon rows, $17,684 understated.
--
-- 3. PART-CASES WERE ROUNDED AWAY. Three Marathon rows at 0.5 / 0.25 / 0.5 of a
--    case ($381.75) vanished. Half a case is still stock; each is carried as one
--    box at the value of the part held.
--
-- And one overstatement, found on the way: Pollard's six "Guarantee 6/210" games
-- were in the catalog at $60.00 against the sheet's $10.00, inflating Santa Clara
-- by exactly $4,900.
--
-- Each block now equals the sheet's own row arithmetic:
--
--   Bingo Vision   $122,334.89     Marathon $39,759.75     Pollard $5,763.61
--
-- Two of those disagree with the TOTAL cell printed on the sheet, and the sheet
-- is wrong, not us: its Bingo Vision total (119,040.29) omits the last row,
-- "Premium Misc packs" $3,294.60, and its Pacific total (5,491.45) omits the
-- first row, "3X Lucky" $272.16. Both look like a SUM range that never grew with
-- the table. Marathon's total agrees to the cent.
--
-- Applied directly to the live database; kept here as the record. Do not re-run.

-- CORRECTION, per Angela: on the inventory sheet the count IS the countable unit
-- — packs for strips, totes for Biker — with no deal multiplier. The sheet's
-- dollar column multiplies by deals; ignore it for valuation.
--
-- So every strip and tote from the July count is worth perBoxValue, the same
-- figure the app uses everywhere else:  base_cost x pack_units / split_boxes.
-- A lettered pack is $64.60. A Biker tote is 64.60 x 80 / 16 = $323.00.
--
-- This supersedes fault 2 above: the Marathon "180x8" cases go back to $64 a
-- pack. Boxes from the August invoices already carry perBoxValue and are not
-- touched — deals are stated explicitly there, so no inference is involved.
--
-- Santa Clara opening stock: $106,496.25. Live inventory: 1,650 boxes,
-- $199,699.65.

update boxes b
   set cost = round(p.base_cost * greatest(p.pack_units,1) / greatest(p.split_boxes,1), 2)
  from products p
 where b.product_id = p.id and p.type = 'strip'
   and b.hall_id = 'sc' and b.po_id is null and b.delivery_id is null;
