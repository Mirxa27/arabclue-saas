-- arabclue · AI employees: a per-employee budget for platform emails to the store owner (RE-2)
--
-- An escalation emails the store owner from arabclue's own sender, and a customer decides when
-- escalations happen (every new sender identity can trigger one). So those emails are capped per
-- employee: claim_owner_notification() counts the employee's notifications on a channel inside
-- the window and records a new claim if there is room — under a per-employee advisory lock, so
-- concurrent escalations cannot overshoot. When the budget is spent it returns null and the
-- caller sends nothing; the escalation itself is still recorded in the app (task, escalated
-- conversation, event).
--
-- A claim is a row of the employee's own activity log, ai_employee_actions (action
-- 'owner_notification', channel e.g. 'email', status 'retry' until the caller records the
-- outcome as 'success' or 'failure'). The owner can read that log but not write it through the
-- Data API, so the budget cannot be reset from the browser. Returns the claim's id. The count
-- reads one employee's last window of activity through employee_actions_employee_idx
-- (employee_id, created_at desc) — no new index (building one would lock the busy log).
-- Service role only. Re-runnable: create or replace, revoke-then-grant.

create or replace function public.claim_owner_notification(
  p_employee_id uuid,
  p_channel text,
  p_limit integer,
  p_window_seconds integer,
  p_payload jsonb default null
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_used integer;
  v_id bigint;
begin
  if p_employee_id is null or coalesce(btrim(p_channel), '') = '' or coalesce(p_window_seconds, 0) <= 0
     or (p_payload is not null and jsonb_typeof(p_payload) <> 'object') then
    raise exception 'claim_owner_notification: employee, channel, a positive window and an object payload are required'
      using errcode = '22004';
  end if;

  -- One critical section per employee and channel: the count and the claim cannot interleave.
  perform pg_advisory_xact_lock(hashtextextended('owner_notification:' || p_employee_id::text || ':' || p_channel, 0));

  select count(*) into v_used
    from public.ai_employee_actions
   where employee_id = p_employee_id
     and action = 'owner_notification'
     and channel = p_channel
     and created_at > now() - make_interval(secs => p_window_seconds);
  if v_used >= greatest(coalesce(p_limit, 0), 0) then
    return null;
  end if;

  insert into public.ai_employee_actions (employee_id, action, channel, payload, status)
  values (p_employee_id, 'owner_notification', p_channel, p_payload, 'retry')
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.claim_owner_notification(uuid, text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.claim_owner_notification(uuid, text, integer, integer, jsonb) to service_role;

notify pgrst, 'reload schema';
