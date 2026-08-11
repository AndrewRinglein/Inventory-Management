-- Undo three duplicates that 028/030/031 created.
--
-- The reconciliation matched invoice names against catalog names on a
-- normalised string, and three catalog names defeated it:
--
--   "DOUBLE WIN AI319P"     the item code is glued onto the name (P044)
--   "GRASS HOPPER"          a space (P064)
--   "HOLD YOUR HORSES BIG"  a suffix (P070)
--
-- So C861, C865 and C864 were created for games that were already there. Worse,
-- P070 already WAS the second Hold Your Horses — both sizes existed all along and
-- the split in 031 was unnecessary.
--
-- The originals win, because they carry the stock and the play history. Boxes,
-- PO lines and session plays move onto them, the item codes come across, and the
-- old names survive as aliases so nothing that referenced them stops matching.

update boxes         set product_id='P044' where product_id='C861';
update po_lines      set product_id='P044' where product_id='C861';
update session_plays set product_id='P044' where product_id='C861';
update boxes         set product_id='P064' where product_id='C865';
update po_lines      set product_id='P064' where product_id='C865';
update session_plays set product_id='P064' where product_id='C865';
update boxes         set product_id='P070' where product_id='C864';
update po_lines      set product_id='P070' where product_id='C864';
update session_plays set product_id='P070' where product_id='C864';

update products set vendor_sku='AI319P',  name='DOUBLE WIN',
       aliases=array['DOUBLE WIN AI319P'] where id='P044';
update products set vendor_sku='AN6268J', name='GRASSHOPPER',
       aliases=array['GRASS HOPPER'] where id='P064';
update products set vendor_sku='AI5137R', name='HOLD YOUR HORSES - BALL',
       aliases=array['HOLD YOUR HORSES BIG','Hold Your Horses - Ball','Horse Race Big'] where id='P070';

delete from products where id in ('C861','C864','C865');

-- Checked for others of the same shape; only Banana Split / Spare Change came up,
-- and those really are two games each (the $1500 versions), not duplicates.
