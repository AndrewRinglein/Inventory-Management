-- Not every good is taxed, and it turns on the product rather than the distributor.
--
-- Marathon billed us twice on 08/07/2026. Invoice 5812098 is all games: net
-- $1,396.00, tax $136.11, which is 9.75% to the cent. Invoice 5812121 is all
-- daubers: net $987.00, and no tax line at all. Same distributor, same day, same
-- hall. Daubers are bought for resale to players; the games are not.
--
-- Default true, so nothing that already exists changes meaning. Only supplies flip.

alter table products add column if not exists taxable boolean not null default true;

comment on column products.taxable is
  'False for goods bought exempt (resale). Marathon 5812098 taxed games at 9.75%; '
  '5812121, same day, taxed daubers at nothing.';

update products set taxable = false where type = 'supply';

-- and the line remembers it, so a PO reprinted next year still shows the tax it
-- was actually sent with rather than today's rule
alter table po_lines add column if not exists taxable boolean not null default true;
