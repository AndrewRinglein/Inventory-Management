-- Two flash games that arrive on Bingo Vision invoice 1806034 (08/07/2026) and
-- had no catalog record at all.
--
-- Puddy Tat is the one that mattered: it is written on the Sunday PM paymaster
-- sheet, so it was being played and paid out against a product that did not
-- exist. Session Use had nothing to match it to.
--
-- Priced and specced from the invoice, packing 1 unit like every other flash box.

insert into products
  (id, vendor_id, name, orig_name, type, base_cost, pack_units, split_boxes,
   packing_units, stock_unit, tickets, price_per_ticket, active)
values
  ('C861','bv','DOUBLE WIN','DOUBLE WIN 1920/$1','flash',112.90,1,1,1,'box',1920,1.00,true),
  ('C862','bv','PUDDY TAT','PUDDY TAT 1900/$1','flash',111.70,1,1,1,'box',1900,1.00,true)
on conflict (id) do nothing;
