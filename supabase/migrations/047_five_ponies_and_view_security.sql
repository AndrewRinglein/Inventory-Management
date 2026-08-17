-- Two things that were decided by hand and are recorded here so the schema history
-- matches what the live database actually contains.
--
-- APPLIED 2026-08-17 via execute_sql, in this order, after 045 and 046.

begin;

-- ------------------------------------------------------------ 1. five ponies
-- Two records described the same game and disagreed about what it was: P185
-- "5 Ponies" at 600 tickets / $34.00, and P184 "5 Ponys (Ball)" at 960 / $48.00.
-- Confirmed: 960 is the game the hall buys, so P184 is the real record.
--
-- The split had done real damage. Every play matched P185, which had never
-- received a box, so all five August plays were covered by invented boxes — while
-- P184 sat on three real boxes that nothing ever touched. The merge does not just
-- repoint the rows; it lets those three real boxes take the three earliest plays,
-- which is what physically happened.

update session_plays set product_id = 'P184' where product_id = 'P185';
delete from session_assignments a where a.product_id = 'P185'
  and exists (select 1 from session_assignments b
              where b.session_id = a.session_id and b.product_id = 'P184');
update session_assignments set product_id = 'P184' where product_id = 'P185';

-- the three real boxes are consumed by the three earliest plays, in order
with real3 as (
  select b.id, row_number() over (order by b.id) rn
    from boxes b where b.product_id = 'P184' and b.state = 'in_inventory'),
sess(rn, tag, dt) as (values
  (1, '2026-08-01 PM', date '2026-08-01'),
  (2, '2026-08-02 PM', date '2026-08-02'),
  (3, '2026-08-07',    date '2026-08-07'))
update boxes b set state = 'opened',
       opened_at = (sess.dt + time '20:00')::timestamptz, opened_session = sess.tag
  from real3, sess where b.id = real3.id and sess.rn = real3.rn;

-- in_inventory -> opened -> sold_out; the state guard has no direct edge
update boxes set state = 'sold_out', sold_out_at = opened_at
 where product_id = 'P184' and state = 'opened'
   and opened_session in ('2026-08-01 PM', '2026-08-02 PM', '2026-08-07');

-- their invented stand-ins are no longer needed — the real boxes cover those plays
delete from boxes where product_id = 'P185' and unrecorded
   and opened_session in ('2026-08-01 PM', '2026-08-02 PM', '2026-08-07');

-- the two plays with no real stock behind them keep their write-off boxes, but at
-- the real spec's value, because that is the game that was actually played
update boxes set product_id = 'P184', cost = 48.00 where product_id = 'P185';

update products set aliases = array(select distinct unnest(
    coalesce(aliases, '{}') || array['5 Ponies', '5  Ponies 600/$1', '5 Ponys (Ball)']))
 where id = 'P184';
update products set active = false where id = 'P185';

-- ------------------------------------------------------------ 2. view security
-- PostgreSQL 15 creates views SECURITY DEFINER, which means they run as their
-- owner and quietly ignore row-level security. Every policy on the tables under
-- these three was therefore doing nothing: the anon key could read the whole
-- inventory, the whole usage history and every arrival through them.
--
-- Safe to switch, because each underlying table already grants `authenticated`
-- full access with a `true` predicate — signed-in users see exactly what they saw
-- before, and anonymous callers now get nothing.
--
-- sched_manager_of_record is also DEFINER and is deliberately NOT touched here.
-- It belongs to the scheduling domain and wants its own review.

alter view public.adjustment_history set (security_invoker = on);
alter view public.game_usage         set (security_invoker = on);
alter view public.stock_arrivals     set (security_invoker = on);

commit;

-- Verified after running:
--   5 Ponies    P184: 5 played (3 real + 2 written off), 2 on order, 0 on the shelf
--               P185: no boxes, no plays, inactive
--   Santa Clara invented boxes: 79 -> 76
--   Ledger:     opening + received + delivered + adjusted + written off - used - missing
--               = boxes on the shelf, exactly, at both halls
--   Views:      anonymous reads return 0 rows from all three
