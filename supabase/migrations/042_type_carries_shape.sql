-- Changing a game's type left its shape behind.
--
-- Vanguard Regular was retyped from flash to strip and stayed 1 deal to a box,
-- packed, counted in boxes — while its three Marathon siblings (Vanguard Strips,
-- Vanguard World Champions, Misc Vanguard Packs) are all 8 deals to a lettered
-- pack with no packing. Picking a type and then remembering to hand-fix four
-- other fields is a step nobody performs.
--
-- The form now pulls the shape along with the type (UpdateGame.TYPE_SHAPE) and
-- says what it changed, unless those fields have been hand-set — then the
-- person's numbers win. Strips default to 8; the field stays editable for the
-- 16-packs and for a Biker tote at 80.
--
-- Its ten Redwood City packs were also carrying $0, because base_cost never
-- reached the boxes when the type changed.

update products
   set pack_units = 8, split_boxes = 8, packing_units = 0, stock_unit = 'pack'
 where id = 'R723';

update boxes set cost = 64.00
 where product_id = 'R723' and state = 'in_inventory' and cost = 0;
