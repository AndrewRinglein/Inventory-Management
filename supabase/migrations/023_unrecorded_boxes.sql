-- A box the count sheet says was played that inventory never knew about.
-- Skipping these made the session record a lie. Created straight into 'sold_out'
-- so they never occupy a shelf; undoing a session deletes them outright.
alter table boxes add column if not exists unrecorded boolean not null default false;
create index if not exists boxes_unrecorded on boxes(product_id, hall_id) where unrecorded;
comment on column boxes.unrecorded is
  'True when this box was created to account for a session play with no matching stock — used, but never received into inventory.';
