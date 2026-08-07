-- A PO line recorded only its final unit cost, so reprinting an old PO had to
-- reconstruct "$64.60 x 16" from today's catalog — and if the price moved in the
-- meantime, the reprint quietly disagreed with what the vendor was actually sent.
-- Keep the parts alongside the total, so a PO can always be reprinted as it went out.
alter table po_lines
  add column if not exists base_cost   numeric,
  add column if not exists pack_units  integer,
  add column if not exists split_boxes integer;

comment on column po_lines.base_cost is 'Price per deal at the time this PO was sent.';
comment on column po_lines.pack_units is 'Deals per ordered unit at the time this PO was sent.';
comment on column po_lines.split_boxes is 'Inventory units one ordered unit became, at the time this PO was sent.';

-- Backfill the POs already sent from today's catalog. Not perfect for anything
-- repriced since, but closer than nothing.
update po_lines l set
  base_cost   = coalesce(l.base_cost, p.base_cost),
  pack_units  = coalesce(l.pack_units, p.pack_units),
  split_boxes = coalesce(l.split_boxes, p.split_boxes)
from products p
where p.id = l.product_id and l.base_cost is null;
