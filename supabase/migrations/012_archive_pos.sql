-- Filing, not deleting. An archived PO keeps its lines, its boxes and its history —
-- it just drops out of every working view so the day-to-day lists stay short. The
-- Archive view is the one place it still shows, and it can be brought back.
alter table purchase_orders add column if not exists archived_at timestamptz;
create index if not exists po_archived on purchase_orders(hall_id, archived_at);
