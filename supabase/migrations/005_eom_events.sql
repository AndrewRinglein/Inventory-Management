-- Allow the app to record EOM (end-of-month) completion markers in the activity feed.
create policy events_auth_insert on events for insert to authenticated with check (kind = 'eom');
