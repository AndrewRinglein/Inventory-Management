-- One row per game played per session, live and historical together.
-- Start here for run rates. `historical` is carried through so a query can
-- exclude the pre-system months, but the usual question wants all of it.
--
-- name_raw sits beside the product because 147 plays across the year still match
-- nothing, and a run rate that silently drops them would read low.

create or replace view game_usage as
select
  s.hall_id, s.session_date,
  date_trunc('month', s.session_date)::date as month,
  s.part, s.weekday, s.historical,
  sp.category, sp.name_raw, sp.product_id,
  p.name as game, p.type as game_type, p.vendor_id,
  v.name as distributor, p.active as still_stocked,
  sp.qty, sp.serial
from session_plays sp
join sessions s on s.id = sp.session_id
left join products p on p.id = sp.product_id
left join vendors  v on v.id = p.vendor_id;

comment on view game_usage is
  'Every game played, live and historical, one row per session line. Start here for run rates.';
