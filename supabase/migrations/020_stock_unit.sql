-- What one counted thing on the shelf actually IS. A count of 16 means nothing
-- without it: 16 totes, 16 lettered packs and 16 boxes are three different
-- quantities of three different sizes, and the same number means all three
-- somewhere in this catalog.
--
-- Stored rather than derived because the rule ("strips are packs") describes how
-- these products are sold today, not a law — a vendor can ship the same game a
-- different way and one row should be able to say so.
alter table products
  add column if not exists stock_unit text not null default 'box'
  check (stock_unit in ('box', 'pack', 'tote', 'dozen'));

comment on column products.stock_unit is
  'The noun for one counted unit on the shelf: box (flash/paper), pack (a lettered strip pack), tote (a repacked Biker tote), dozen (a 12-pack of daubers).';

update products set stock_unit = case
  when pack_units = 80 then 'tote'        -- a 10-pack case, repacked into totes
  when type = 'strip'  then 'pack'        -- one lettered pack out of a set of 8 or 16
  when type = 'supply' then 'dozen'       -- daubers, sold by the 12-pack
  else 'box'                              -- flash, paper
end;
