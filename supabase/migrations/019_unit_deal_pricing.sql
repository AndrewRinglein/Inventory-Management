-- Vocabulary fix and three price corrections, applied 7 Aug 2026.
--
-- "Unit" is what gets ordered and invoiced. "Deals" is how many priceable pieces
-- sit inside one unit — what the base price is quoted against. A dauber is $19
-- per deal, 1 deal per unit; a Biker case is $64.60 per deal, 80 deals per unit.
-- The column headings on the PO email and the Purchase screen now say so.

update products set base_cost = 64.60 where pack_units = 80;            -- Biker 10-packs were $64.00
update products set base_cost = 16.00 where name ilike '$2 DAUBERS%';   -- $16 per deal, 1 deal per unit
update products set base_cost = 19.00 where name ilike '$3 DAUBERS%';   -- $19 per deal, 1 deal per unit
