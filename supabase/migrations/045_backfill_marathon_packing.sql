-- Put Marathon's $4 packing onto the POs that were sent before we knew about it.
--
-- APPLIED 2026-08-17 via execute_sql.
--
-- These three orders are already with Marathon and their invoices will carry the
-- charge. Rather than resend a PO to tell a vendor about their own fee, the stored
-- order is brought up to what will actually be billed, so receiving reconciles to
-- zero instead of printing a variance on every one of them. No email is sent.
--
-- ADDS PACKING ONLY. Line costs are not touched, deliberately.
--
-- A general re-quote would pull every line from today's catalog, and on
-- RWC-2026-08-MD-001 that would also move two strip lines from $64.00 to $512.00 —
-- $896 — because those strips were reshaped to 8 deals a pack after the order went
-- out. That may well be a real problem with that order, but it is a different
-- question from packing and is not settled here.
--
-- Only 'sent' and 'partial' orders. The two closed Marathon POs stay as they are:
-- 5812098 was $1,396.00 net with $136.11 tax, exactly 9.75% of the net and no
-- packing line, which is how we know the charge is new.

begin;

-- packing rides on the line that earned it. packing_units is 1 for a flash box and
-- 0 for everything else Marathon sells, so this reaches flash and nothing else.
update po_lines l
   set packing_each = round(4.00 * coalesce(p.packing_units, 0), 2)
  from products p, purchase_orders po
 where p.id = l.product_id
   and po.id = l.po_id
   and po.vendor_id = 'md'
   and po.status in ('sent', 'partial')
   and l.kind <> 'fee';

-- Rebuild the money from the lines rather than adding a delta, so running this
-- twice lands in the same place. Tax is unchanged by construction — packing is a
-- service and is not taxed — but recomputing it from the same lines keeps the
-- three figures consistent with each other.
update purchase_orders po
   set subtotal = t.subtotal,
       tax      = t.tax,
       total    = round(t.subtotal + t.tax, 2)
  from (
    select l.po_id,
           round(sum(l.qty * (l.cost + l.packing_each)), 2) as subtotal,
           round(sum(l.qty * l.cost)
                 filter (where l.taxable is not false) * 0.0975, 2) as tax
      from po_lines l
     where l.kind <> 'fee' and not l.price_tbd
     group by l.po_id
  ) t
 where t.po_id = po.id
   and po.vendor_id = 'md'
   and po.status in ('sent', 'partial');

commit;

-- Expected result:
--
--   RWC-2026-08-MD-001    $987.75 ->  $1,015.75   (+$28,  7 flash boxes)
--   RWC-2026-08-MD-002  $2,912.77 ->  $2,968.77   (+$56, 14 flash boxes)
--   SC-2026-08-MD-003  $22,117.92 -> $22,425.92   (+$308, 77 flash boxes)
--
-- Tax unchanged on all three: $87.75, $258.77, $1,964.92.

-- WHAT IT ACTUALLY DID, 2026-08-17:
--
--   RWC-2026-08-MD-001    $987.75 ->  $1,015.75   (+$28,  7 flash boxes)
--   RWC-2026-08-MD-002  $2,912.77 ->  $2,968.77   (+$56, 14 flash boxes)
--
-- SC-2026-08-MD-003 is in the note above as a third order. It was archived on
-- 08-12 and is 'closed', so the status filter correctly passed it by — that PO
-- never created a box and was superseded by MD-004.
--
-- SC-2026-08-MD-005 was matched by the filter but already carried its packing
-- ($312 on 78 flash boxes), so recomputing left it untouched. That is the
-- idempotence the rebuild-from-lines approach was for.
--
-- Tax unchanged on both, as designed: $87.75 and $258.77.
