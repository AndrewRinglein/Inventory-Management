-- A rename must never cost a game its match.
--
-- Session sheets are typed by hand at both halls and go on using the name people
-- have always used. Matching tries the product name first, then its aliases — so
-- renaming a game in the catalogue silently stops its sheet lines matching. They
-- drop into the unmatched pile, nobody is warned, and someone keys them in again
-- by hand.
--
-- This already happened. A flash game was reclassified as a strip and given
-- " - Strip" in its title, through the Games screen, which replaced the name and
-- kept no record of the old one. It will keep happening, because that is the
-- correct thing for a person to do when they find a mis-typed game.
--
-- The store now keeps the old name as an alias, but a store fix only covers
-- renames that go through the app. Migrations, a psql session, the Supabase table
-- editor and anything written later all bypass it. So the guarantee lives here,
-- on the table, where every writer is subject to it.
--
-- Deliberately BEFORE UPDATE OF name: it fires only when the name column is in
-- the statement, and it edits NEW in place rather than issuing a second write, so
-- there is no recursion and no extra audit row.
--
-- Verified: flash -> strip with a suffix keeps the old name; a second and third
-- rename keep every spelling; a cost-only update adds nothing; and a name already
-- covered case-insensitively is not duplicated.
--
-- Note this is a safety net, not the whole answer. logic/naming.js normalises a
-- trailing type tag (" - Strip", "(Strip)") and the distributor's tier suffixes
-- away when comparing, so a sheet still matches a renamed game even where no
-- alias was ever recorded.
--
-- APPLIED 2026-09-01 via execute_sql.

create or replace function keep_old_product_name()
returns trigger language plpgsql as $$
declare old_name text := btrim(coalesce(old.name, ''));
begin
  if old_name <> '' and btrim(coalesce(new.name, '')) <> old_name then
    if not exists (
      select 1 from unnest(coalesce(new.aliases, '{}'::text[])) a
       where lower(btrim(a)) = lower(old_name)
    ) then
      new.aliases := coalesce(new.aliases, '{}'::text[]) || old_name;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists products_keep_old_name on products;
create trigger products_keep_old_name
  before update of name on products
  for each row execute function keep_old_product_name();

comment on function keep_old_product_name is
  'Session sheets are typed by hand and keep using the old spelling. Matching tries '
  'name then aliases, so a rename silently stops sheet lines matching. Every rename '
  'therefore keeps its previous name as an alias — in the database, so it holds for '
  'the app, for direct SQL and for migrations alike.';

-- the rename that prompted this, repaired
update products
   set aliases = array(select distinct unnest(coalesce(aliases,'{}'::text[]) || array['In Laws','In Laws 180x8']))
 where id = 'P300';
