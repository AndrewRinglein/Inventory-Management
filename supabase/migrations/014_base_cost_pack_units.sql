-- A price has three parts and they were all squashed into one number:
--   base_cost   what one unit costs        ($64.60)
--   pack_units  how many units in a box    (x16)
--   cost        what the box costs         (= base x units, $1,033.60)
-- packing_units is separate again: how many units the vendor charges packing on,
-- which is NOT how many are in the box (Monopoly packs 16, is charged for 0).
alter table products add column if not exists base_cost  numeric(10,2);
alter table products add column if not exists pack_units integer not null default 1;

create or replace function sync_product_cost() returns trigger as $$
begin
  if new.base_cost is not null then
    new.cost := round(new.base_cost * greatest(coalesce(new.pack_units, 1), 1), 2);
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists products_cost_sync on products;
create trigger products_cost_sync before insert or update on products
  for each row execute function sync_product_cost();

update products set base_cost = cost, pack_units = 1 where base_cost is null;

-- Bingo Vision pack sizes, per Angela
update products set base_cost = round(cost / 80, 2), pack_units = 80, packing_units = 80
  where name ~* '10.?pack of strips';
update products set type = 'strip', packing_units = 0 where id in ('P180','P181');  -- Broadway, Whole Enchiladas
update products set pack_units = 16 where id in ('P177','P180','P181');             -- + Monopoly
update products set pack_units = 8 where vendor_id = 'bv' and type = 'strip' and pack_units = 1;
