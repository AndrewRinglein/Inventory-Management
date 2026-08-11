-- The insert policy on events allowed exactly one kind, 'eom'. Every other
-- logEvent the app makes — session.apply, session.undo, po.record, po.reprice,
-- po.archive, delivery.add, adjust — was rejected by row-level security.
--
-- The failure mode was nasty rather than loud. logEvent is the LAST thing
-- applySession does, so the boxes had already moved and sessions.applied_at was
-- already set when the insert threw. The screen reported a failure for an
-- operation that had entirely succeeded, and anyone who pressed the button again
-- was told the session had already been taken out of stock.
--
-- The row-level audit trigger writes its insert/update/delete rows as the table
-- owner and bypasses RLS, which is why the events table never looked empty and
-- nothing surfaced until sessions were applied in bulk.

drop policy if exists events_auth_insert on events;

create policy events_auth_insert on events
  for insert to authenticated
  with check (kind in (
    'eom','adjust','session.apply','session.undo','po.record','po.reprice',
    'po.archive','delivery.add','email.send','count'
  ));
