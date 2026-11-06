-- Scheduled retention for parked Salla installs (Easy Mode authorizations that no
-- merchant claimed). They hold encrypted store tokens and the installer's email;
-- the in-webhook prune only ran when Salla traffic arrived. Same 60-day horizon as
-- that opportunistic prune (the claim window itself is 30 days). Called from the
-- employees-tick cron.
create or replace function public.prune_salla_installs(p_older_than_days integer default 60)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.salla_installs
   where authorized_at < now() - make_interval(days => greatest(p_older_than_days, 31));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.prune_salla_installs(integer) from public, anon, authenticated;
grant execute on function public.prune_salla_installs(integer) to service_role;
