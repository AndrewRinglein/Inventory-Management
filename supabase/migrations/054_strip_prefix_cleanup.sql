-- "Strip-Wild Thing - Strip" said it at both ends.
--
-- Seven games carried "Strip-" as a prefix, added by hand at some point as a type
-- label — the same instinct that later produced the " - Strip" suffix. Once every
-- strip was suffixed (052) those seven announced themselves twice and sorted under
-- S instead of under their own name.
--
-- The prefix is dropped; the suffix stays. Every previous spelling survives as an
-- alias, written by the trigger from 053 rather than by hand here, which is the
-- first real use of that guarantee.
--
--   Strip- Big Pickle - Strip        -> Big Pickle - Strip
--   Strip-Cats & Mouse - Strip       -> Cats & Mouse - Strip
--   Strip-Chasing Benjmains - Strip  -> Chasing Benjamins - Strip
--   Strip-Fortune Cookies - Strip    -> Fortune Cookies - Strip
--   Strip-Snack Shack - Strip        -> Snack Shack - Strip
--   Strip-Wabbit Twack - Strip       -> Wabbit Twacks - Strip
--   Strip-Wild Thing - Strip         -> Wild Thing - Strip
--
-- "Benjmains" was a typo and is corrected in passing; the misspelling stays as an
-- alias, because the sheets that carry it are already written.
--
-- NOT touched: "Strip Club - Strip" and "Strip Daddy - Strip". Strip is the first
-- word of what those games are actually called, not a label somebody prepended.
-- Nor is "Chicken Strip", a flash game whose name simply contains the word.
--
-- Wabbit carries four spellings. The record said "Twack", the request said
-- "Twacks", and the session sheets say "Wabbit Tracks" — 14 plays at Santa Clara
-- in the last 60 days. By decision, where names disagree the product answers to
-- all of them rather than one being declared correct.
--
-- WORTH KNOWING, and deliberately left alone: "Wild Thing" is now two active
-- records — P333, a flash game at 1,980 tickets and $86.40, and P348, a strip at
-- 1,800 and $45.00. Both are stocked. They are different games that share a name,
-- so the suffix is the only thing telling them apart, and logic/naming.js returns
-- BOTH as candidates for a bare "Wild Thing" rather than guessing. Which one a
-- sheet means is decided by the block it appears in: rows 12-35 are strips, row 36
-- and below are flash.
--
-- APPLIED 2026-09-01 via execute_sql.

update products set name = 'Big Pickle - Strip'         where id = 'P347';
update products set name = 'Cats & Mouse - Strip'       where id = 'P344';
update products set name = 'Chasing Benjamins - Strip'  where id = 'P343';
update products set name = 'Fortune Cookies - Strip'    where id = 'P345';
update products set name = 'Snack Shack - Strip'        where id = 'P346';
update products set name = 'Wabbit Twacks - Strip'      where id = 'C1787674995270';
update products set name = 'Wild Thing - Strip'         where id = 'P348';

update products
   set aliases = array(select distinct unnest(coalesce(aliases,'{}'::text[])
                       || array['Wabbit Twacks','Wabbit Twack','Wabbit Tracks','Wabbit Track']))
 where id = 'C1787674995270';

-- Verified after running:
--   0 products still begin with a "Strip-" prefix
--   0 double-suffixed; the 8 duplicate active names are all pre-existing
--   every renamed product kept all of its previous spellings as aliases
