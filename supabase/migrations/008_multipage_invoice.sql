-- Invoices can run to several pages; keep every page with the shipment.
alter table shipments add column if not exists invoice_photo_paths text[] not null default '{}';
