-- What flash games are set aside for a session, decided ahead of the night and
-- printed for the Paymaster to work from.
--
-- This is a plan, not consumption: assigning does not touch stock. What actually
-- got played comes back later on the count sheet and goes through session_plays.
-- Keeping them apart matters because the two regularly disagree — a game can be
-- racked and never opened.
create table if not exists session_assignments (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  product_id text not null references products(id),
  created_at timestamptz not null default now(),
  unique (session_id, product_id)          -- one of each, which is how the rack works
);
create index if not exists session_assignments_session on session_assignments(session_id);

alter table session_assignments enable row level security;
create policy session_assignments_auth_all on session_assignments
  for all to authenticated using (true) with check (true);

-- The old assign flow tagged a box with a weekday string, which means nothing now
-- that assignment is per dated session. Release any left behind.
update boxes set session_tag = null where session_tag is not null;
