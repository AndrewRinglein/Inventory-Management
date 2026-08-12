-- Stock arriving is recorded in two places, and nothing read both.
--
-- Receiving a PO writes a SHIPMENT — that path carries the invoice number and
-- the photos. "Add delivery", for a drop with no PO of ours, writes a DELIVERY.
-- Both are the same real-world event: boxes turned up.
--
-- The Dashboard's "Recently received" panel and the Received list on Receiving
-- both read deliveries only, so a hall that receives through the normal PO flow
-- showed an empty list. Redwood City had three POs closed and 145 boxes on the
-- shelf and looked like nothing had ever arrived.
--
-- Rather than migrate one table into the other and risk the box counts, this is
-- the single surface for READING. Both write paths keep working untouched.

create or replace view stock_arrivals as
select s.id, 'shipment'::text as source, po.hall_id,
       s.received_at::date as received_at, s.received_at as received_ts,
       po.vendor_id, s.po_id, po.num as po_ref,
       nullif(s.invoice_no, '') as invoice_no, nullif(s.notes, '') as note,
       coalesce(array_length(s.invoice_photo_paths, 1), 0) as photos,
       (select count(*) from boxes b where b.po_id = s.po_id and b.state <> 'on_order') as boxes
from shipments s join purchase_orders po on po.id = s.po_id
union all
select d.id, 'delivery'::text, d.hall_id,
       d.received_at, d.received_at::timestamptz,
       d.vendor_id, d.po_id, d.po_ref, d.invoice_no, d.note, 0,
       (select count(*) from boxes b where b.delivery_id = d.id)
from deliveries d;

comment on view stock_arrivals is
  'Every time stock turned up, from either write path — a received PO (shipments) or an ad-hoc drop (deliveries).';
