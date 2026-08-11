with newpo as (
  insert into purchase_orders (num,hall_id,vendor_id,status,subtotal,tax,total,
      sent_at,created_at,recorded_only,vendor_ref,price_tbd_lines)
  values ('SC-2026-08-MD-001','sc','md','closed',1396.0,136.11,1532.11,
      '2026-08-07T12:00:00Z','2026-08-07T12:00:00Z',true,'5812098',0)
  returning id
), newdel as (
  insert into deliveries (hall_id,vendor_id,received_at,po_id,po_ref,invoice_no,note)
  select 'sc','md','2026-08-07',id,'SC-2026-08-MD-001','5812098','Recorded from Marathon Distributors invoice 5812098.' from newpo
  returning id, po_id
), lines(product_id,name_snapshot,qty,cost,base_cost,pack_units,split_boxes,packing_each,kind,taxable) as (
  values ('P244','Rags to Riches $2',2,209.0,209.0,1,1,0,'item',true),('P236','Naughty or Nice $2',1,209.0,209.0,1,1,0,'item',true),('P256','Sweet & Sassy $2',1,209.0,209.0,1,1,0,'item',true),('P202','Cats & Dogs',1,280.0,280.0,1,1,0,'item',true),('P227','Lucky Bucks',1,280.0,280.0,1,1,0,'item',true)
  
), ins as (
  insert into po_lines (po_id,product_id,name_snapshot,qty,cost,base_cost,pack_units,split_boxes,packing_each,kind,taxable)
  select newpo.id, l.* from newpo, lines l
  returning 1
)
insert into boxes (hall_id,product_id,po_id,delivery_id,cost,state,ordered_at,received_at)
select 'sc', l.product_id, d.po_id, d.id, round(l.base_cost*l.pack_units/l.split_boxes,2),
       'in_inventory', '2026-08-07T12:00:00Z', '2026-08-07T12:00:00Z'
from newdel d, lines l, generate_series(1, l.qty*l.split_boxes)
where l.product_id is not null;