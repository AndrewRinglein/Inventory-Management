-- Human sender layer: vendor contact first names + a named sender identity for emails.
alter table vendors add column if not exists contact_name text;

-- settings.sender holds who the emails come from:
--   { "name": "Sagit", "org": "Vanguard", "title": "", "phone": "", "replyTo": "" }
insert into settings (key, value)
values ('sender', '{"name":"Sagit","org":"Vanguard","title":"","phone":"","replyTo":""}')
on conflict (key) do nothing;
