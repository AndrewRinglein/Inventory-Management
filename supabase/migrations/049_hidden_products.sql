-- A hall's private view of the catalogue.
--
-- The catalogue is global: one products table, both halls. That is right for
-- accounting — a game is a game, and its cost is its cost. But it is wrong for
-- the floor, because some games only exist at one hall, and worse, some names
-- exist twice with genuinely different contents.
--
-- Red White & Blue is the case that forced this. There are three records:
--   P278            Marathon, $42     5 boxes at SC, 2 at RWC
--   C1787197160866  Bingo Vision      1 box at RWC, no cost yet
--   H027            Bingo Vision      no stock at either hall
-- They are not duplicates to be merged — the halls buy different things under
-- the same spoken name. So neither record can be deleted, and neither hall
-- wants to look at all three.
--
-- Of 456 active games, 173 have only ever been stocked at Santa Clara and 63
-- only at Redwood City. Every one of those is a line a manager has to read past.
--
-- APPLIED 2026-08-20 via execute_sql.
--
-- Hiding is per hall, and it is a VIEW filter only. It never touches a box, a
-- cost, or a count. Hidden stock still exists, is still owned, and is still in
-- the value total — the screens say so out loud rather than letting a floor
-- count quietly stop matching the books.

begin;

create table if not exists hidden_products (
  hall_id     text not null references halls(id),
  product_id  text not null references products(id) on delete cascade,
  hidden_at   timestamptz not null default now(),
  actor       text not null default 'app',
  note        text,
  primary key (hall_id, product_id)
);

-- the only read pattern: "everything this hall hides", loaded once per session
create index if not exists hidden_products_hall on hidden_products (hall_id);

alter table hidden_products enable row level security;
create policy hp_auth_all on hidden_products
  for all to authenticated using (true) with check (true);

comment on table hidden_products is
  'Per-hall display filter for the catalogue. Presence of a row means this hall '
  'does not show this game on Inventory or Purchase. Affects nothing else: the '
  'boxes, their cost and their state are untouched, and Owned Inventory still '
  'reports them. Deleting the row unhides.';
comment on column hidden_products.note is
  'Optional reason, e.g. "RWC buys the Bingo Vision one, not this".';

commit;
