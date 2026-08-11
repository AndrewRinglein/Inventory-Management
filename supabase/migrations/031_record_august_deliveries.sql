-- August 2026 deliveries recorded from the paper invoices, Santa Clara.
--
-- Two of the five are entered here as recorded-only POs (placed outside this
-- system, so no email follows) each closed by a delivery that puts the stock on
-- the shelf. Both reproduce their invoice to the cent:
--
--   SC-2026-08-BV-001  Bingo Vision 1806034   66 goods lines + the bundling fee
--                      goods 33,119.60  service 672.00  tax 3,229.16  total 37,020.76
--                      313 boxes: 169 flash, 144 strip packs
--   SC-2026-08-MD-001  Marathon 5812098       5 lines
--                      goods 1,396.00  tax 136.11  total 1,532.11   6 boxes
--
--   SC-2026-08-PBF-001 Pacific Gaming / Pollard 44971   13 lines, 120 boxes
--                      goods 6,141.60  tax 598.81  total 6,740.41
--                      A PACKING SLIP, not an invoice: quantities only, no prices
--                      anywhere on it. Every figure above is catalog-derived and
--                      the tax is the standard rate rather than one they billed.
--                      Cosmic has no catalog price, so its 18 boxes sit at zero
--                      and the line is flagged price_tbd.
--
-- Not entered, and why:
--   Bingo Vision 1806006   the ten Biker titles need allocating across the four
--                          day-group tote products before the count can be right
--   Marathon 5812121       quantities not legible
--
-- Hold Your Horses is split in 030/031: the 1080-ticket one keeps P069 as SMALL
-- BALL, and the 1920-ticket one the invoice sells at $112.90 becomes C864 BALL.
--
-- Also created because they appear on 1806034 and were nowhere in the catalog:
--   C863 U PIK EM LUCKY 7 3V1 (billed by the PACK at $30.00)
--   C865 GRASSHOPPER 1260/$1 at $74.10
--
-- The insert itself was run against the live database; it is left out of this
-- file deliberately. Re-running it would create a second copy of both deliveries
-- and double the stock. This migration exists so the history explains the rows.

insert into products
  (id, vendor_id, name, orig_name, vendor_sku, type, base_cost, pack_units, split_boxes,
   packing_units, stock_unit, tickets, price_per_ticket, active)
values
  ('C865','bv','GRASSHOPPER','GRASSHOPPER 1260/$1','AN6268J','flash',74.10,1,1,1,'box',1260,1.00,true)
on conflict (id) do nothing;

-- Marathon prints item codes too (invoice 5812098, page 1 of 1).
update products p set vendor_sku = v.sku from (values
 ('P244','TP5213KR'),('P236','TP4749BR'),('P256','TP8010RR'),
 ('P202','TP7737Q'),('P227','TP7858V')
) as v(id,sku) where p.id = v.id;

-- All five August deliveries are now recorded against Santa Clara:
--
--   SC-2026-08-BV-001   BV 1806034   $37,020.76   313 boxes
--   SC-2026-08-BV-002   BV 1806006   $58,318.80   160 totes  (see assumption below)
--   SC-2026-08-MD-001   MD 5812098    $1,532.11     6 boxes
--   SC-2026-08-MD-002   MD 5812121      $987.00     1 line   (see assumption below)
--   SC-2026-08-PBF-001  PBF 44971     $6,740.41   120 boxes
--                                   -----------
--                                   $104,599.08   600 boxes added
--
-- Two assumptions are carried in the delivery notes so they are visible in the
-- app rather than only here:
--
-- 1806006 — the invoice does not say which day-group each of the ten Biker
-- titles belongs to, so all ten units are booked to P163 (Fri/Sun/Mon). The
-- money is right regardless; only the shelf is a guess.
--
-- 5812121 — the dauber quantities are not legible, so the order sits as one
-- line at its full $987.00 rather than as invented per-colour counts. Split it
-- across S830/S831/S832 when the quantities are known.
--
-- Activity rows (po.record, delivery.add) were backfilled for all five so the
-- history reads the same as if they had been entered through the app.
