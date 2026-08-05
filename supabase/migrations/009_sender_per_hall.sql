-- Each hall's orders come from a different person: Sagit for Santa Clara, Shelly for Redwood City.
-- settings.sender becomes hall-keyed:
--   { "sc": {name, org, title, phone, replyTo}, "rwc": {...} }
-- The app still accepts the old flat shape and applies it to every hall.
update settings
set value = jsonb_build_object(
  'sc',  value || '{"name":"Sagit"}'::jsonb,
  'rwc', value || '{"name":"Shelly"}'::jsonb
)
where key = 'sender' and value ? 'name';

-- Every outgoing email is copied to these addresses (comma-separated).
update settings
set value = value || '{"ccAddress":"andrew@frontiergamingsystems.com, randrews@scvanguard.org"}'::jsonb
where key = 'email';
