-- Session tracking at open time: which of the 9 weekly sessions a box was opened for.
alter table boxes add column if not exists opened_session text;
