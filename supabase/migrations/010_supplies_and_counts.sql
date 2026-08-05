-- Supplies (daubers, paper) are stocked and counted like games, but aren't games.
alter table products drop constraint if exists products_type_check;
alter table products add constraint products_type_check
  check (type in ('flash','strip','guarantee','paper','supply'));

-- Cherry-ticket cases sell by the ticket, so an opened case has a partial count.
alter table boxes add column if not exists tickets_remaining integer;

-- When this stock was last physically counted (month-end counts differ per section).
alter table boxes add column if not exists counted_at date;
