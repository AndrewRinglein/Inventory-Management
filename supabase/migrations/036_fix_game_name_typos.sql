-- Three games the 10 Aug programme could not be matched against by name.
-- Bingo Vision's invoice 1806034 is the tiebreaker where it has an opinion,
-- because the distributor's spelling is the one that keeps turning up on paper.
--
--   BOOPOOP ADOOP  -> Boop-Oop-A-Doop   invoice AI670BN reads BOOP-OOP-A-DOOP
--   Dabbin Derby   -> Dabbin' Derby     invoice AJ430KN reads DABBIN' DERBY
--   Tirple 500     -> Triple 500        plain typo; Marathon, no invoice on file
--
-- Two of the three were wrong in the catalog, one in the programme. Every
-- spelling seen on either side is kept as an alias so both keep matching.

update products
   set name = 'Boop-Oop-A-Doop', vendor_sku = coalesce(vendor_sku,'AI670BN'),
       aliases = array['BOOPOOP ADOOP','Boop-Oop A-Doop','Boop Oop A Doop']
 where id = 'P014';

update products
   set name = 'Dabbin'' Derby',
       aliases = array['Dabbin Derby','Dabbing Derby','Dabbin Derby 1320/$1']
 where id = 'P036';

update products
   set name = 'Triple 500',
       aliases = array['Tirple 500','Tirple 500 2280/$1']
 where id = 'P257';
