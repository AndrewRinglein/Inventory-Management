-- Order a game we don't have a price for yet.
--
-- Waiting on a price list before placing an order costs real shelf space, so a
-- PO line may go out with the price left open — it prints as "?" and the vendor
-- fills it in on their invoice. cost stays 0 until then; price_tbd is what makes
-- the difference between "free" and "not priced yet" explicit rather than implied.
alter table po_lines add column if not exists price_tbd boolean not null default false;

-- Same on the box: an unpriced box is in inventory and countable, but it must not
-- be valued at $0 in the owned-value total, and receiving has to ask for its price.
alter table boxes add column if not exists price_tbd boolean not null default false;

-- Purchase orders carry a partial total while any line is still open.
alter table purchase_orders add column if not exists price_tbd_lines integer not null default 0;
