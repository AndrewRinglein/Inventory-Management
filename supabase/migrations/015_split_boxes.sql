-- The unit you BUY and the unit you SHELVE are not always the same thing.
--
-- One Biker 10-pack case is ordered as a single line at $5,120 + $320 packing,
-- and then arrives as 16 totes. Each tote is what gets counted, opened and sold
-- from, and it is worth a sixteenth of what the case landed at — $340, not $5,120.
-- Valuing each tote at the case price overstated Redwood City by about $174,000.
alter table products add column if not exists split_boxes integer not null default 1;
alter table products add constraint products_split_boxes_positive check (split_boxes >= 1);

update products set split_boxes = 16 where name ~* '10.?pack of strips';

-- existing totes were carrying the whole case price
update boxes b set cost = round((p.cost + 4 * p.packing_units) / p.split_boxes, 2)
from products p where p.id = b.product_id and p.split_boxes > 1;

comment on column products.split_boxes is
  'Inventory boxes produced by one ordered unit. Each carries 1/n of the landed cost.';
