-- =============================================================================
-- 0009 Permission clean-up.
--
-- Supabase grants the anonymous (signed-out) role access to new tables by
-- default and relies on row-level security to return nothing.  Nobody uses
-- this app signed out, so take that access away entirely, now and for tables
-- added later.  Public functions are callable by signed-in users only.
-- =============================================================================

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

alter default privileges for role postgres in schema public revoke all on tables    from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

-- Functions default to "anyone may execute".  Limit the app-facing ones to
-- signed-in users and the service role; the private `app` helpers likewise.
revoke execute on all functions in schema public from public;
grant  execute on all functions in schema public to authenticated, service_role;

revoke execute on all functions in schema app from public;
grant  execute on all functions in schema app to authenticated, service_role;

alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public grant  execute on functions to authenticated, service_role;
alter default privileges for role postgres in schema app    revoke execute on functions from public;
alter default privileges for role postgres in schema app    grant  execute on functions to authenticated, service_role;

-- Table-level privileges stay as Supabase sets them for signed-in users
-- (select / insert / update / delete); row-level security decides which rows,
-- and tables with no policy for an action refuse it.
