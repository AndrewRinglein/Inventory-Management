-- A session is one night of play at one hall — nine a week, two each on Saturday
-- and Sunday. What it consumed is recorded here first and only moves stock when
-- someone presses the button, because the count sheets and the shelf do not
-- always agree and that disagreement has to be visible before it is acted on.
create table if not exists sessions (
  id           uuid primary key default gen_random_uuid(),
  hall_id      text not null,
  session_date date not null,
  part         text not null default '' check (part in ('', 'AM', 'PM')),
  weekday      text,
  source_file  text,
  applied_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (hall_id, session_date, part)
);

create table if not exists session_plays (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  category    text not null check (category in ('on-site', 'pre-sale')),
  name_raw    text not null,
  qty         integer not null default 1 check (qty > 0),
  serial      text,
  product_id  text references products(id),
  match_how   text,
  match_score numeric
);
create index if not exists session_plays_session on session_plays(session_id);

alter table boxes add column if not exists session_id uuid references sessions(id);
create index if not exists boxes_session on boxes(session_id);

alter table sessions      enable row level security;
alter table session_plays enable row level security;
create policy sessions_auth_all      on sessions      for all to authenticated using (true) with check (true);
create policy session_plays_auth_all on session_plays for all to authenticated using (true) with check (true);
