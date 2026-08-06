-- Guarantee-number games are flash. Retyping them picks up the flash packing rule:
-- 1 chargeable unit per box, which is $4 at Bingo Vision and nothing at Marathon or
-- Pollard, since the rate belongs to the vendor and those two charge none.
update products set type = 'flash', packing_units = 1 where type = 'guarantee';

-- nothing should be able to go back to it
alter table products drop constraint if exists products_type_check;
alter table products add constraint products_type_check
  check (type is null or type in ('flash','strip','paper','supply'));
