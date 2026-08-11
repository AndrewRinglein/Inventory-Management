-- The distributor's item code, and the names we know a game by.
--
-- Reconciling Bingo Vision invoice 1806034 by name turned up seven games that
-- looked new and were not: "Big 5" is our Big Five cherry ticket, "Dragons Den"
-- is Dragon Den, "Heads Or Tails" is Heads & Tail, "The Jungle Tem" is JUNGLE
-- TEMPLE, "Zipperz" is Guarantee number- Zippers. Every one of them matched on
-- price AND ticket count, so the goods are certainly the same and only the
-- spelling moved. Fuzzy name matching will keep producing that false positive
-- every month.
--
-- Bingo Vision prints its own item code to the left of every line (AI7540,
-- AJTKKMN, AN101316R). That code does not drift. Storing it gives invoice
-- reconciliation a key that survives a rename on either side.
--
-- The codes backfilled below were read off a photograph of 1806034, so treat
-- them as a strong hint rather than gospel until each one has been seen again
-- on a scanned invoice.

alter table products add column if not exists vendor_sku text;
alter table products add column if not exists aliases text[] not null default '{}';

create index if not exists products_vendor_sku_idx on products (vendor_id, vendor_sku)
  where vendor_sku is not null;

comment on column products.vendor_sku is
  'The distributor''s own item code (Bingo Vision prints it left of every line). '
  'Survives the name drift that breaks fuzzy matching.';
comment on column products.aliases is
  'Other names this game is invoiced or programmed under.';

update products set aliases = array['Big 5']                where id='P156';
update products set aliases = array['Dragons Den']          where id='P048';
update products set aliases = array['Heads Or Tails']       where id='P066';
update products set aliases = array['Popeye Quad 4 B']      where id='P110';
update products set aliases = array['The Jungle Tem','Jungle Temple'] where id='P081';
update products set aliases = array['Zipperz','Zippers']    where id='P149';

-- price drift, taken from the invoice rather than the other way round
update products set base_cost = 65.90 where id='P008';   -- Balloney, was 65.60
update products set base_cost = 77.60 where id='P036';   -- Dabbin Derby, was 77.70

-- the one line on 1806034 with no catalog home at all. Billed by the PACK,
-- not the DEAL, which is why it reads 3 x $30.00 and not a deal price.
insert into products
  (id, vendor_id, name, orig_name, vendor_sku, type, base_cost, pack_units, split_boxes,
   packing_units, stock_unit, tickets, price_per_ticket, active)
values
  ('C863','bv','U PIK EM LUCKY 7 3V1','U PIK EM LUCKY 7 3V1 1000/PK','6038005',
   'flash',30.00,1,1,1,'pack',1000,1.00,true)
on conflict (id) do nothing;

update products p set vendor_sku = v.sku from (values
 ('P037','AN51800R'),('P029','AN101316R'),('P025','AN51901R'),('P126','AN101317R'),
 ('P089','AN96624R'),('P053','AJ984Y'),('P057','AI6706Q'),('P140','AI6478F'),
 ('P093','AJ7159'),('P040','AJN420NN'),('P076','AI951F'),('P131','AI6349ZN'),
 ('P079','AI6568J'),('P027','AI7540'),('P069','AI5137R'),('P119','A6778H'),
 ('P080','AI6808K'),('P006','AI2762N'),('C862','AI2A89'),('P111','AI7245B'),
 ('C861','AI319P'),('P141','AI137G'),('P103','AI59600'),('P018','AN6269J'),
 ('P147','AI6300WR'),('P061','AI7354R'),('P036','AJ430KN'),('P048','AN6180Q'),
 ('P081','AI7441HN'),('P156','AJG756'),('P066','AI1W92'),
 ('P110','AIY361N'),('P149','AI955F'),('P008','AI618AN'),('P104','AI7983H'),
 ('P019','AI7979H'),('P011','AI7978H'),('P034','AI7718M'),('P031','AI7706P'),
 ('P171','AJTKKK3'),('P172','AITACIS'),('P178','AJTKKA3'),('P180','AITCCT3'),
 ('P179','AJTKKI3'),('P177','AJTKKMN')
) as v(id,sku) where p.id = v.id;
