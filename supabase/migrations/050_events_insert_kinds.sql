-- The events insert whitelist had fallen behind the app again.
--
-- 034 fixed this once and explained exactly why it is nasty: logEvent is the LAST
-- step of an operation, so by the time row-level security rejects the insert the
-- real work — boxes moved, shipment confirmed, game hidden — has already
-- committed. The screen reports a failure for something that entirely succeeded,
-- and the person presses the button again.
--
-- Since then the app grew seven more kinds and none of them were added here:
--
--   po.delete          an order deleted before it was ever sent
--   po.restore         un-archiving an order (034 listed po.archive but not its pair)
--   session.assign     a play line pointed at a different game by hand
--   session.short      a session applied with less stock than it used
--   shipment.receive   a delivery confirmed in
--   stock.move         boxes moved between the floor and off-site
--   stock.confirm      someone laid eyes on off-site stock
--   catalog.hide       a hall put a game away
--   catalog.unhide     ...and brought it back
--
-- stock.move, stock.confirm and shipment.receive matter most: they are the whole
-- off-site feature, and every one of them would have thrown on the first real use
-- while having already done its work.
--
-- The reason this keeps happening is that the list is a closed enumeration
-- maintained by hand in SQL, while the kinds are string literals scattered through
-- the store. So the check becomes structural instead: a kind must look like one of
-- ours — a known prefix, lowercase, dotted — rather than being named individually.
-- That still rejects junk from a stolen anon key, which is the point of the policy,
-- without breaking the next feature that logs something.
--
-- The audit trigger's own insert/update/delete rows are written as the table owner
-- and bypass RLS entirely, which is why the table never looked empty and this hid
-- for as long as it did.
--
-- APPLIED 2026-08-20 via execute_sql.

drop policy if exists events_auth_insert on events;

create policy events_auth_insert on events
  for insert to authenticated
  with check (
    kind = 'eom'
    or kind = 'adjust'
    or kind = 'count'
    or kind ~ '^(po|session|stock|shipment|delivery|email|catalog)\.[a-z]+$'
  );
