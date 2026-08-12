-- A year of session programmes from before the system held inventory.
--
-- 264 files, January to July, both halls, ~15,450 plays. They live in the SAME
-- tables as live sessions so one query answers "how much of this game do we get
-- through" across January to today rather than needing a union of two shapes.
--
-- What keeps them safe is the flag. A historical session describes play at a time
-- when the stock it came from was never recorded, so applying one would invent
-- consumption against today's shelf. The guard is in the DATABASE, not only the
-- app: a check that exists solely in JavaScript is one a script, a console
-- session or a future screen walks straight past.

alter table sessions add column if not exists historical boolean not null default false;

comment on column sessions.historical is
  'Imported from a pre-system programme. Never applied to stock — see guard_no_apply_historical.';

create index if not exists sessions_historical_idx on sessions (hall_id, session_date)
  where historical;

create or replace function guard_no_apply_historical() returns trigger
language plpgsql as $$
begin
  if new.applied_at is not null and new.historical then
    raise exception 'session % is historical — it records what was played before '
      'the system held inventory, so it cannot be taken out of stock', new.session_date;
  end if;
  return new;
end $$;

drop trigger if exists no_apply_historical on sessions;
create trigger no_apply_historical before insert or update on sessions
  for each row execute function guard_no_apply_historical();

-- one programme per hall per date per session slot, which is what Angela says the
-- files should be; a second file for the same slot is a duplicate to resolve
create unique index if not exists sessions_slot_key
  on sessions (hall_id, session_date, part);


-- CORRECTION. The first load of these files counted the strip block at the top
-- of each flash tab as well as the game list below it, and turned every row of
-- it into one box. It is not boxes: those cells are TICKET counts (590, 6997,
-- 235) against the standing strip lineup, which is on every sheet whether or
-- not anything moved.
--
-- It roughly tripled Redwood City. RWC 28 Jul loaded as 50 boxes when the
-- sheet's own "Totals for All Other Flash Games" cell reads 17 on-site and 6
-- pre-sale — 23. Across all 264 files, 6,720 of the 15,484 rows loaded were
-- strip-block rows that never should have been counted.
--
-- It hid behind the reconciliation check because that check only compared the
-- FLASH list against the declared total. Those matched 528 out of 528 — and
-- were right. The strip rows were extra, on top, unchecked.
--
-- Angela caught it by counting a sheet by hand: "I just went and counted one
-- from the window of fifty and found seventeen."
--
-- Only the flash list counts now — from the '1199 Derby' anchor down, where
-- every row is one box. 8,764 boxes across the year, and the monthly averages
-- line up with August instead of towering over it.
