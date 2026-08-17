-- Marathon now charges $4 per flash box for packing.
--
-- DRAFT — not applied. Review before running.
--
-- Bingo Vision has charged this all along; Marathon did not. Their invoice
-- 5812098 settles it: $1,396.00 net and $136.11 tax, which is 9.75% of $1,396.00
-- exactly, with no packing line anywhere on it. So this is a new charge, and
-- nothing before it should be restated.
--
-- The rate belongs to the vendor and the unit count to the product, so this is
-- one number. 102 of Marathon's 103 flash products already carry
-- packing_units = 1 and pick it up immediately; all 32 supplies carry
-- packing_units = 0, so no dauber is touched — which is right, because the
-- charge is per flash box.
--
-- Packing is a service and stays out of the tax base (029, poTotals). It is
-- charged on the line that earned it, not as a lump at the bottom.

begin;

update vendors
   set packing_fee = 4.00,
       packing_types = 'flash'
 where id = 'md';

commit;

-- NOT done here, and needing a decision rather than a migration:
--
-- Three Marathon POs were sent before this and quoted no packing at all. At $4 a
-- flash box they are light by:
--
--   RWC-2026-08-MD-001      7 flash boxes      $28
--   RWC-2026-08-MD-002     14 flash boxes      $56
--   SC-2026-08-MD-003      77 flash boxes     $308
--                                            ------
--                                             $392
--
-- Either re-quote and resend them (Orders -> reprice keeps the same PO number), or
-- leave them and let receiving reconcile against the higher invoice. Repricing
-- rewrites the stored subtotal/tax/total on a PO the vendor has already seen, so
-- it should be a deliberate choice, not a side effect of this file.
