-- Every strip game says so in its name.
--
-- Strips and flash sit side by side in the same catalogue, and telling them apart
-- meant reading the Type column rather than the name. On the session sheets, on a
-- printed PO and in the game picker, the type is not always there to read. So the
-- name carries it: every active strip now ends " - Strip", all 67 of them, at both
-- halls.
--
-- Uniformly, by decision, including the 30 whose names already contained the word
-- somewhere ("$3- Mini Strip Beaches - Strip", "10-Pack of strips Biker
-- (Fri/Sun/Mon) - Strip"). It reads redundantly, and that is the trade: every
-- strip is now identifiable by its last word and they sort together, which a
-- half-suffixed list cannot do.
--
-- THE PART THAT MATTERS: the old name is pushed into `aliases` for every product
-- renamed. Session sheets are typed by hand and say "Biker Betty", not "Biker
-- Betty - Strip". Matching runs name-then-alias, so without this every strip on
-- every future sheet would drop to the unmatched pile and be keyed in by hand —
-- and 561 of the plays on record matched by exact name. With the alias they keep
-- matching; the match simply reports 'alias' where it used to report 'exact'.
--
-- Guarded on ` - Strip$` so re-running cannot double-suffix.
--
-- Checked before and after:
--   67 renamed, 0 missed, 0 double-suffixed, 0 non-strips touched
--   0 products lost their old name from aliases
--   0 new name collides with any existing product name
--   0 plays orphaned
--
-- Pre-existing and NOT caused by this: two names are duplicated in the catalogue
-- ("$3- Mini Strip Pepe Le Pew", "$3- Mini Strip That's All Folks" — two records
-- each). They stay duplicated, now with the suffix. Worth resolving separately.
--
-- APPLIED 2026-09-01 via execute_sql.

begin;

update products
   set aliases = array(select distinct unnest(coalesce(aliases, '{}'::text[]) || array[name])),
       name = name || ' - Strip'
 where type = 'strip' and active and name !~ ' - Strip$';

commit;
