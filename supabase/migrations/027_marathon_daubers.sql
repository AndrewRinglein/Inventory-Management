-- Daubers bought from Marathon, priced from invoice 5812121 (08/07/2026).
--
-- Marathon bills daubers by the DZN under its own product names, which do not
-- map onto the Bingo Vision colour SKUs (S800-S827) at all — those stay as they
-- are. These are separate goods from a separate distributor, so they get their
-- own records rather than repricing someone else's.
--
--   4OZ DABBIN FEVER          $12.00 / dozen
--   4OZ SUNSATIONAL           $19.50 / dozen
--   1.5OZ/15MM DABBIN WIN     $10.50 / dozen
--
-- Page 2 of that invoice is washed out ($987.00 net, no tax line legible), so
-- there may be further lines to add once a clean copy turns up.

insert into products
  (id, vendor_id, name, orig_name, type, base_cost, pack_units, split_boxes,
   packing_units, stock_unit, price_per_ticket, active)
values
  ('S830','md','Dabbin Fever 4oz','4OZ DABBIN FEVER','supply',12.00,1,1,0,'dozen',1.00,true),
  ('S831','md','Sunsational 4oz','4OZ SUNSATIONAL','supply',19.50,1,1,0,'dozen',1.00,true),
  ('S832','md','Dabbin Win 1.5oz / 15mm','1.5OZ/15MM DABBIN WIN','supply',10.50,1,1,0,'dozen',1.00,true)
on conflict (id) do update
  set base_cost = excluded.base_cost,
      vendor_id = excluded.vendor_id,
      stock_unit = excluded.stock_unit;
