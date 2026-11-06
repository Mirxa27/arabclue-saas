-- Admin event search (F27). PostgREST does not allow casts in horizontal filters,
-- so `payload::text.ilike.*term*` failed on every search. A service-role-only
-- function does the cast server-side; the term is matched literally (LIKE
-- wildcards escaped). No table rewrite of `events` (a stored generated column
-- would lock and rewrite the table in production).
create or replace function public.admin_search_events(
  p_search text default null,
  p_kind text default null,
  p_merchant text default null,
  p_limit integer default 40,
  p_offset integer default 0
) returns table (id bigint, kind text, merchant text, payload jsonb, created_at timestamptz, total_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      case
        when nullif(btrim(p_search), '') is null then null
        else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      end as pattern
  )
  select e.id, e.kind, e.merchant, e.payload, e.created_at, count(*) over () as total_count
    from public.events e, params
   where (nullif(btrim(p_kind), '') is null or e.kind = btrim(p_kind))
     and (nullif(btrim(p_merchant), '') is null or e.merchant = btrim(p_merchant))
     and (params.pattern is null
          or e.kind ilike params.pattern escape '\'
          or e.payload::text ilike params.pattern escape '\')
   order by e.created_at desc, e.id desc
   limit least(greatest(coalesce(p_limit, 40), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke execute on function public.admin_search_events(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_search_events(text, text, text, integer, integer) to service_role;
