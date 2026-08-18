-- Where a box IS, kept separate from what condition it is in.
--
-- `state` is a lifecycle: on_order -> in_inventory -> opened -> sold_out. "At the
-- distributor" is not a stage of that lifecycle, it is a place, and folding it in
-- as a fifth state would mean every query that counts stock has to know which
-- states mean "here" — and moving a tote from a storage unit to the hall would
-- become a state transition the guard has to grow an edge for. It is a different
-- axis, so it gets a different column.
--
-- This exists because the system answers two questions that are not the same one:
--
--   OWNED     every box with a cost, wherever it sits          -> accounting
--   ON FLOOR  what can actually be played tonight              -> operations
--
-- Off-site stock is exactly where those two diverge, which is why it has had
-- nowhere to live. The important consequence is downstream: a shortage the hall
-- floor cannot cover but off-site stock can is a SHIPMENT, not a purchase. The
-- app has been unable to tell those apart and has been saying "buy" to both.

begin;

alter table boxes add column if not exists location text not null default 'hall';
alter table boxes add column if not exists location_ref text;

-- 'hall'    on the floor at its hall_id — the default, and what every existing row is
-- 'vendor'  bought and invoiced, the distributor is still holding it
-- 'storage' ours, off-site, in a unit or a back room that no one counts
alter table boxes drop constraint if exists boxes_location_ck;
alter table boxes add constraint boxes_location_ck
  check (location in ('hall', 'vendor', 'storage'));

-- every count, every reorder suggestion and every session apply filters on this
create index if not exists boxes_hall_location_state_idx
  on boxes (hall_id, location, state);

comment on column boxes.location is
  'Where the box physically is. hall = on the floor and playable; vendor = bought '
  'and invoiced but the distributor still holds it; storage = ours, off-site. '
  'Independent of state — a box can be in_inventory in any of the three.';
comment on column boxes.location_ref is
  'Which distributor or which unit, free text. Null for hall.';
-- counted_at has been null on every row since the table was created. Off-site
-- stock is the thing nobody ever looks at, so this is where it earns its keep:
-- the last time a human confirmed the box is really still there.
comment on column boxes.counted_at is
  'Last date a person physically confirmed this box exists. Used for off-site '
  'stock, which is otherwise never counted and so quietly goes missing.';

commit;

-- APPLIED 2026-08-17 via execute_sql, along with the first real off-site stock:
--
--   SC-2026-08-MD-006 — recorded-only, 15 Monster Score at $120, bought and
--   invoiced, Marathon still holding them. Boxes are in_inventory at
--   location 'vendor', so they count toward owned value and cannot be played.
--
--   $1,860 subtotal + $175.50 tax = $2,035.50 is RECONSTRUCTED from the catalogue
--   price and Marathon's $4/box packing. No payment row was created — the real
--   invoice number and amount are still needed, and inventing a payable is how
--   a $64,000 order became a $77,000 one.
--
-- Santa Clara after this: 1,865 on the floor, 15 off-site, 1,880 owned.
