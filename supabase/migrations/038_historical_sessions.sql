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
