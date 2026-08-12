-- Why a count changed, as a first-class record.
--
-- Adjusting stock already left an event with a note, which explains ONE side of
-- ONE product. That is not enough for the thing that actually happens: Bingo
-- Vision runs out of Whole Enchiladas and hands over an American Heroes instead.
-- As two unrelated adjustments those rows only connect in the head of whoever
-- typed both, and if one is later reversed the other quietly lies.
--
-- So an adjustment is a header plus lines. A swap is one header with a line out
-- and a line in. A transfer between halls is the same shape with a different
-- hall on each line. Counts are deliberately NOT forced to balance — a rule that
-- demands one-for-one only teaches people to enter numbers that aren't true.
--
-- And because the reason is a column rather than prose, the year of history can
-- finally answer "what did we write off to damage".

create table if not exists stock_adjustments (
  id          uuid primary key default gen_random_uuid(),
  hall_id     text not null,
  at          timestamptz not null default now(),
  reason      text not null check (reason in
                ('swap','damaged','miscount','found','returned','transfer')),
  note        text not null,
  actor       text not null default 'app',
  created_at  timestamptz not null default now()
);

create table if not exists stock_adjustment_lines (
  id            uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references stock_adjustments(id) on delete cascade,
  hall_id       text not null,        -- a transfer moves between halls, so it lives on the line
  product_id    text not null references products(id),
  delta         integer not null check (delta <> 0),
  each_value    numeric(10,2) not null default 0
);

create index if not exists sa_hall_at on stock_adjustments (hall_id, at desc);
create index if not exists sa_reason on stock_adjustments (reason, at desc);
create index if not exists sal_adj on stock_adjustment_lines (adjustment_id);
create index if not exists sal_product on stock_adjustment_lines (product_id);

alter table stock_adjustments enable row level security;
alter table stock_adjustment_lines enable row level security;
create policy sa_auth_all  on stock_adjustments      for all to authenticated using (true) with check (true);
create policy sal_auth_all on stock_adjustment_lines for all to authenticated using (true) with check (true);

alter table boxes add column if not exists adjustment_id uuid references stock_adjustments(id);
create index if not exists boxes_adjustment on boxes (adjustment_id) where adjustment_id is not null;

comment on table stock_adjustments is
  'A counted change with a reason. One header, one or more lines — a swap is one out and one in.';

create or replace view adjustment_history as
select a.id, a.at, a.hall_id as booked_hall, a.reason, a.note, a.actor,
       l.hall_id, l.product_id, p.name as game, p.type as game_type,
       v.name as distributor, l.delta, l.each_value,
       round(l.delta * l.each_value, 2) as value_change
from stock_adjustments a
join stock_adjustment_lines l on l.adjustment_id = a.id
left join products p on p.id = l.product_id
left join vendors  v on v.id = p.vendor_id;
