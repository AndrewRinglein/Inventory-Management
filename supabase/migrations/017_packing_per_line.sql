-- Packing belongs on the line it was earned by, not in a lump at the bottom.
-- A single "97 units of packing" line tells nobody what a box of Easy Dab actually
-- costs; $25.90 + $4.00 does. Goods and packing stay in separate columns so the
-- record can still answer "how much of this was packing", but they print and total
-- together per line, and the PO shows a Stock / Packing split above the subtotal.
alter table po_lines add column if not exists packing_each numeric(10,2) not null default 0;

comment on column po_lines.packing_each is
  'Packing charged on ONE unit of this line. Line total = qty * (cost + packing_each).';
