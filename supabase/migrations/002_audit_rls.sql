-- Audit triggers + row-level security lockdown

-- generic audit: writes every insert/update/delete on tracked tables into events
create or replace function audit_row() returns trigger as $$
declare
  eid text;
begin
  eid := coalesce(
    case when tg_op = 'DELETE' then null else (to_jsonb(new)->>'id') end,
    (to_jsonb(old)->>'id'), '?');
  insert into events (actor, kind, entity, entity_id, detail)
  values (
    coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'app'),
    lower(tg_op),
    tg_table_name,
    eid,
    case when tg_op = 'DELETE' then jsonb_build_object('old', to_jsonb(old))
         when tg_op = 'INSERT' then jsonb_build_object('new', to_jsonb(new))
         else jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)) end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$ language plpgsql security definer;

create trigger audit_boxes    after insert or update or delete on boxes    for each row execute function audit_row();
create trigger audit_pos      after insert or update or delete on purchase_orders for each row execute function audit_row();
create trigger audit_products after insert or update or delete on products for each row execute function audit_row();
create trigger audit_payments after insert or update or delete on payments for each row execute function audit_row();

-- RLS: everything requires a logged-in user; events are read-only from the app
do $$
declare t text;
begin
  foreach t in array array['halls','vendors','products','order_qty','purchase_orders',
                           'po_lines','shipments','boxes','payments','emails','settings']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_auth_all on %I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

alter table events enable row level security;
create policy events_auth_read on events for select to authenticated using (true);
-- events are written only by the security-definer trigger, never directly by the app
