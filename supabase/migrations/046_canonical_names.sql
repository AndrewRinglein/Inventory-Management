-- Canonical game names, and two merges.
--
-- APPLIED 2026-08-17 via execute_sql.
--
-- NAMING RULE: every word of a game name starts with a capital. Tokens containing
-- a digit are left exactly as they are, because those are sizes and vendor SKUs —
-- 1199, 4oz, 15mm, AI6219V, AN5307X.
--
-- This is a DISPLAY change only. Matching already ignores case and punctuation
-- (it lowercases and strips non-alphanumerics), which is why "DRAGON RACE",
-- "Dragon Race", "Miss MoneyBags" and "Miss money bags" all resolve today. I
-- verified against every name in the August programmes: 0 would stop matching
-- after this rename.
--
-- The old spelling is added to `aliases` anyway, so anything matching on the
-- literal string still lands.

begin;

-- ------------------------------------------------------------ 1. names
create temp table _rename (id text primary key, name text) on commit drop;
insert into _rename (id, name) values
  ('C862','Puddy Tat'),
  ('C863','U Pik Em Lucky 7 3V1'),
  ('P002','1199 Derby'),
  ('P006','All The Marbles'),
  ('P007','Arcade Slots'),
  ('P009','Barbecue Bucks'),
  ('P010','Bear Foot'),
  ('P012','Big Fish'),
  ('P013','Bonfire Bucks'),
  ('P016','Bubble Pop'),
  ('P018','Cake Walk'),
  ('P021','California Wild'),
  ('P023','Cash N Cherries'),
  ('P025','Casino City Jackpot'),
  ('P026','Catch A Star'),
  ('P027','Cherries A Go Go'),
  ('P029','Cherry Dash Dollar Dash'),
  ('P032','Crazy Colts'),
  ('P033','Cruisin 66'),
  ('P037','Diamonds Emeralds'),
  ('P040','Double Daub 5'),
  ('P041','Double Diamonds'),
  ('P042','Double Down'),
  ('P043','Double Lightning'),
  ('P044','Double Win'),
  ('P045','Downline 500'),
  ('P047','Drag Race AI6219V'),
  ('P050','Eagles Nest'),
  ('P052','Emerald Eyes'),
  ('P053','Fab 4'),
  ('P054','Fab 5'),
  ('P055','Fire Frenzy'),
  ('P056','Fishy'),
  ('P057','Flamingos'),
  ('P059','Get Crackin'),
  ('P060','Gime Diamonds'),
  ('P062','Good Kitty Bad Kitty'),
  ('P063','Good Puppy Bad Puppy'),
  ('P064','Grasshopper'),
  ('P067','High Five'),
  ('P068','Hog Run'),
  ('P069','Hold Your Horses - Small Ball'),
  ('P070','Hold Your Horses - Ball'),
  ('P071','Holy Moly Guacamole'),
  ('P072','Hoot Loot'),
  ('P073','Horse Play'),
  ('P074','Horse & Hound'),
  ('P075','Hot Diggity'),
  ('P076','Hot Streak'),
  ('P077','Hula Hoop'),
  ('P078','It Takes 2'),
  ('P079','It Takes A Thief'),
  ('P080','Jumpin Jalapenos'),
  ('P081','Jungle Temple'),
  ('P082','Just Peachy'),
  ('P087','Mama Bear'),
  ('P088','Matador Derby'),
  ('P089','Mega Bucks Lucky Bucks'),
  ('P090','Mega Ice'),
  ('P092','Money Ball'),
  ('P094','More Chili'),
  ('P096','Mustang Run'),
  ('P097','My Lucky Penny'),
  ('P100','Olive Oyl'),
  ('P103','Paydirt'),
  ('P107','Pick A Looney Tunes'),
  ('P108','Pink Panther Derby'),
  ('P110','Popeye Quad 4 Bngo'),
  ('P111','Purple Passion'),
  ('P113','Quinella AN5307X'),
  ('P117','Red Red Rubies'),
  ('P118','Red Velvet'),
  ('P119','Rest Of The Pie'),
  ('P121','Roadhouse Cash'),
  ('P122','Rodeo'),
  ('P126','Silver Bars Gold Nuggets'),
  ('P127','Sparkle And Shine'),
  ('P130','Super 500 AN6504W'),
  ('P132','Super Six Pack AN5022L'),
  ('P137','Trifecta Bingo AN62081N'),
  ('P138','Triple Crown Derby AI982W'),
  ('P139','Triple Dab 4'),
  ('P140','Triple Emeralds'),
  ('P143','Twice The Fire'),
  ('P145','Ultimate Horse & Hound AN50562'),
  ('P147','Wild Unicorn');

update products p
   set aliases = case when p.name = any(p.aliases) then p.aliases
                      else array_append(p.aliases, p.name) end
  from _rename r where r.id = p.id and r.name <> p.name;

update products p set name = r.name from _rename r where r.id = p.id;

-- ------------------------------------------------------------ 2. Casino City
-- The programmes only ever write "Casino City". It was matching H013 — inactive,
-- no distributor, $0, never received a box — while CASINO CITY JACKPOT holds the
-- stock and had one play. One game; the Jackpot record is the real one.
update products set name = 'Casino City Jackpot',
       aliases = array(select distinct unnest(aliases || array['Casino City','CASINO CITY JACKPOT']))
 where id = 'P025';

update session_plays set product_id = 'P025' where product_id = 'H013';
update boxes          set product_id = 'P025' where product_id = 'H013';
update po_lines       set product_id = 'P025' where product_id = 'H013';
delete from session_assignments a where a.product_id = 'H013'
   and exists (select 1 from session_assignments b
               where b.session_id = a.session_id and b.product_id = 'P025');
update session_assignments set product_id = 'P025' where product_id = 'H013';
update products set active = false where id = 'H013';

commit;

-- What this leaves:
--   86 games renamed to the capital-each-word standard, old spelling kept as an alias
--   Casino City folded into Casino City Jackpot; H013 retired
--
-- NOT done here: the 5 Ponies merge (P184 / P185). Those two records disagree on
-- what the game IS — 960 tickets at $48.00 versus 600 at $34.00 — and the merge
-- direction decides which spec the hall orders against in future. That needs a
-- human answer, not a guess.
