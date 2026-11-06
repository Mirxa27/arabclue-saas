-- arabclue · AI employees: size bounds that hold for every row (RE-5, RE-6, RE-1)
--
-- RE-5  20261106005000 left ai_employees_{config,knowledge,goals,display_name}_size NOT VALID
--       when existing rows exceeded a bound. PostgreSQL checks a NOT VALID CHECK against the
--       whole new row on every UPDATE, so such a row could no longer be paused by the billing
--       cycle, activated after its seat was paid, or paused by the merchant. Here every
--       violating row is brought within the bounds — deterministically, the row itself is kept —
--       and each change is noted in public.events (kind 'employee.bounds_repaired': table, row,
--       column, what was done, sizes and the md5 of the old value; never the content). Then
--       every constraint is VALIDATED, unconditionally.
-- RE-6  The API accepts 8 goals of up to 200 characters. jsonb's text form of that reaches
--       9632 bytes (3-byte characters or \u00XX escapes throughout), but ai_employees_goals_size
--       allowed 4096, so valid requests failed with a raw 23514. The bound now covers the API's
--       worst case: 16384 bytes, like config.
-- RE-1  Chat history and task text reach the model, and the owner can write both through the
--       Data API. Backstops: ai_employee_messages.content <= 16000 characters (new messages are
--       at most 4000), ai_employee_tasks.title <= 200 and .description <= 2000 characters (the
--       tasks API limits). The runtime also clamps them whenever it builds a prompt.
--
-- Repairs — only values that break a bound are changed:
--   config        not an object → {}; over 16384 bytes → only the persona keys the API accepts,
--                 each cut to its API length (persona_id must match the API pattern, persona_age
--                 an integer 16-99, persona_gender a known value; anything else is dropped)
--   knowledge     its first 8000 characters
--   goals         not an array → []; otherwise its first 8 non-empty strings, each trimmed and
--                 cut to 200 characters
--   display_name  its first 64 characters ('' → 'موظف ذكي (AI employee)'); if that clashes with
--                 another employee of the merchant with the same role, the row id is appended
--   messages      content: its first 16000 characters
--   tasks         title / description: their first 200 / 2000 characters
--
-- Re-runnable: constraints are (re)created in guarded statements, the repairs find nothing to
-- change on a re-run (so no further notes are written), validating a valid constraint is a no-op.

-- ── RE-6: the goals bound covers what the API accepts ────────────────────────
-- Replaced in one ALTER TABLE, so the column is never unchecked in between. CASE keeps
-- jsonb_array_length away from non-arrays.
alter table public.ai_employees
  drop constraint if exists ai_employees_goals_size,
  add constraint ai_employees_goals_size check (
    goals is null or case
      when jsonb_typeof(goals) = 'array' then jsonb_array_length(goals) <= 8 and octet_length(goals::text) <= 16384
      else false
    end
  ) not valid;

-- ── RE-1: backstops on the text that reaches the model ───────────────────────
do $$
begin
  alter table public.ai_employee_messages
    add constraint ai_employee_messages_content_size check (char_length(content) <= 16000) not valid;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.ai_employee_tasks
    add constraint ai_employee_tasks_title_size check (char_length(title) <= 200) not valid;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.ai_employee_tasks
    add constraint ai_employee_tasks_description_size
    check (description is null or char_length(description) <= 2000) not valid;
exception when duplicate_object then null;
end $$;

-- ── RE-5: bring the employees that break a bound within it ───────────────────
-- One UPDATE per row with every repaired column: with the bounds still NOT VALID, an UPDATE
-- that fixed one column while another stayed oversized would itself be refused.
do $$
declare
  r record;
  v_config jsonb;
  v_knowledge text;
  v_goals jsonb;
  v_name text;
  v_base text;
  v_notes jsonb := '[]'::jsonb;
  v_note jsonb;
begin
  for r in
    select e.id, e.merchant_id, e.role_id, e.display_name, e.knowledge, e.goals, e.config
      from public.ai_employees e
     where (e.config is not null and not (jsonb_typeof(e.config) = 'object' and octet_length(e.config::text) <= 16384))
        or (e.knowledge is not null and char_length(e.knowledge) > 8000)
        or (e.goals is not null and case
              when jsonb_typeof(e.goals) = 'array' then jsonb_array_length(e.goals) > 8 or octet_length(e.goals::text) > 16384
              else true
            end)
        or char_length(e.display_name) not between 1 and 64
     order by e.id
       for update
  loop
    v_config := r.config;
    v_knowledge := r.knowledge;
    v_goals := r.goals;
    v_name := r.display_name;
    v_notes := '[]'::jsonb;

    -- config
    if r.config is not null and not (jsonb_typeof(r.config) = 'object' and octet_length(r.config::text) <= 16384) then
      if jsonb_typeof(r.config) = 'object' then
        select coalesce(jsonb_object_agg(kept.k, kept.v), '{}'::jsonb)
          into v_config
          from (
            select f.k,
                   case
                     when f.k = 'persona_age' then
                       case when jsonb_typeof(r.config -> f.k) = 'number' then
                         case when (r.config ->> f.k)::numeric between 16 and 99
                                and (r.config ->> f.k)::numeric = trunc((r.config ->> f.k)::numeric)
                              then r.config -> f.k end
                       end
                     when f.k = 'persona_gender' then
                       case when r.config ->> f.k in ('female', 'male', 'neutral') then r.config -> f.k end
                     when jsonb_typeof(r.config -> f.k) <> 'string' then null
                     when f.k = 'persona_id' then
                       case when (r.config ->> f.k) ~ '^[a-z0-9-]{1,64}$' then r.config -> f.k end
                     else
                       nullif(
                         to_jsonb(left(btrim(case when f.single_line
                                                  then regexp_replace(r.config ->> f.k, '[\r\n]+', ' ', 'g')
                                                  else r.config ->> f.k end), f.max_chars)),
                         '""'::jsonb)
                   end as v
              from (values
                ('persona_id', 64, true), ('persona_name', 64, true), ('persona_arabic_name', 64, true),
                ('persona_age', 0, true), ('persona_gender', 0, true), ('persona_nationality', 64, true),
                ('persona_city', 64, true), ('persona_dialect', 32, true), ('persona_voice', 32, true),
                ('persona_background', 500, false), ('persona_signature', 80, true)
              ) as f(k, max_chars, single_line)
             where r.config ? f.k
          ) kept
         where kept.v is not null;
        v_note := jsonb_build_object(
          'action', 'normalized',
          'dropped_key_count', (select count(*) from jsonb_object_keys(r.config) k where not (v_config ? k)),
          'dropped_keys', coalesce((select jsonb_agg(left(d.k, 64))
                                      from (select k from jsonb_object_keys(r.config) k
                                             where not (v_config ? k) order by k limit 20) d), '[]'::jsonb));
      else
        v_config := '{}'::jsonb;
        v_note := jsonb_build_object('action', 'reset', 'was_type', jsonb_typeof(r.config));
      end if;
      -- (object || object merges; the parentheses keep the note one array element)
      v_notes := v_notes || (jsonb_build_object(
        'column', 'config',
        'before', jsonb_build_object('bytes', octet_length(r.config::text), 'md5', md5(r.config::text)),
        'after', jsonb_build_object('bytes', octet_length(v_config::text))) || v_note);
    end if;

    -- knowledge
    if r.knowledge is not null and char_length(r.knowledge) > 8000 then
      v_knowledge := left(r.knowledge, 8000);
      v_notes := v_notes || jsonb_build_object(
        'column', 'knowledge', 'action', 'truncated',
        'before', jsonb_build_object('chars', char_length(r.knowledge), 'bytes', octet_length(r.knowledge), 'md5', md5(r.knowledge)),
        'after', jsonb_build_object('chars', char_length(v_knowledge), 'bytes', octet_length(v_knowledge)));
    end if;

    -- goals (the CASE is parenthesised: plpgsql ends an IF condition at the first THEN)
    if r.goals is not null and (case
         when jsonb_typeof(r.goals) = 'array' then jsonb_array_length(r.goals) > 8 or octet_length(r.goals::text) > 16384
         else true
       end) then
      if jsonb_typeof(r.goals) = 'array' then
        select coalesce(jsonb_agg(to_jsonb(g.goal) order by g.ord), '[]'::jsonb)
          into v_goals
          from (
            select left(btrim(t.value #>> '{}'), 200) as goal, t.ord
              from jsonb_array_elements(r.goals) with ordinality as t(value, ord)
             where jsonb_typeof(t.value) = 'string' and btrim(t.value #>> '{}') <> ''
             order by t.ord
             limit 8
          ) g;
      else
        v_goals := '[]'::jsonb;
      end if;
      v_notes := v_notes || jsonb_build_object(
        'column', 'goals', 'action', case when jsonb_typeof(r.goals) = 'array' then 'normalized' else 'reset' end,
        'before', jsonb_build_object('bytes', octet_length(r.goals::text), 'md5', md5(r.goals::text),
                                     'items', case when jsonb_typeof(r.goals) = 'array' then jsonb_array_length(r.goals) end),
        'after', jsonb_build_object('bytes', octet_length(v_goals::text), 'items', jsonb_array_length(v_goals)));
    end if;

    -- display_name (unique per merchant and role)
    if char_length(r.display_name) not between 1 and 64 then
      v_base := coalesce(nullif(left(r.display_name, 64), ''), 'موظف ذكي (AI employee)');
      v_name := v_base;
      if exists (select 1 from public.ai_employees o
                  where o.merchant_id = r.merchant_id and o.role_id = r.role_id
                    and o.display_name = v_name and o.id <> r.id) then
        v_name := left(v_base, 25) || ' (' || r.id::text || ')';
      end if;
      v_notes := v_notes || jsonb_build_object(
        'column', 'display_name', 'action', case when v_name = v_base then 'truncated' else 'renamed' end,
        'before', jsonb_build_object('chars', char_length(r.display_name), 'md5', md5(r.display_name)),
        'after', jsonb_build_object('chars', char_length(v_name)));
    end if;

    update public.ai_employees
       set config = v_config, knowledge = v_knowledge, goals = v_goals, display_name = v_name
     where id = r.id;

    insert into public.events (kind, merchant, payload)
    select 'employee.bounds_repaired', r.merchant_id::text,
           jsonb_build_object('migration', '20261106009000_employee_bounds_repair', 'table', 'ai_employees',
                              'row_id', r.id, 'employee_id', r.id) || n.note
      from jsonb_array_elements(v_notes) as n(note);
  end loop;
end $$;

-- ── RE-5 / RE-1: messages and tasks the owner wrote oversized ─────────────────
with bad as (
  select m.id, c.employee_id, e.merchant_id,
         char_length(m.content) as chars, octet_length(m.content) as bytes, md5(m.content) as md5
    from public.ai_employee_messages m
    join public.ai_employee_conversations c on c.id = m.conversation_id
    join public.ai_employees e on e.id = c.employee_id
   where char_length(m.content) > 16000
),
fixed as (
  update public.ai_employee_messages m
     set content = left(m.content, 16000)
    from bad
   where m.id = bad.id
  returning m.id, char_length(m.content) as chars, octet_length(m.content) as bytes
)
insert into public.events (kind, merchant, payload)
select 'employee.bounds_repaired', bad.merchant_id::text,
       jsonb_build_object('migration', '20261106009000_employee_bounds_repair', 'table', 'ai_employee_messages',
                          'row_id', bad.id, 'employee_id', bad.employee_id, 'column', 'content', 'action', 'truncated',
                          'before', jsonb_build_object('chars', bad.chars, 'bytes', bad.bytes, 'md5', bad.md5),
                          'after', jsonb_build_object('chars', fixed.chars, 'bytes', fixed.bytes))
  from bad
  join fixed on fixed.id = bad.id;

with bad as (
  select t.id, t.employee_id, e.merchant_id, t.title, t.description
    from public.ai_employee_tasks t
    join public.ai_employees e on e.id = t.employee_id
   where char_length(t.title) > 200 or char_length(t.description) > 2000
),
fixed as (
  update public.ai_employee_tasks t
     set title = left(t.title, 200),
         description = case when char_length(t.description) > 2000 then left(t.description, 2000) else t.description end
    from bad
   where t.id = bad.id
  returning t.id
)
insert into public.events (kind, merchant, payload)
select 'employee.bounds_repaired', bad.merchant_id::text,
       jsonb_build_object('migration', '20261106009000_employee_bounds_repair', 'table', 'ai_employee_tasks',
                          'row_id', bad.id, 'employee_id', bad.employee_id, 'column', col.name, 'action', 'truncated',
                          'before', jsonb_build_object('chars', char_length(col.old), 'bytes', octet_length(col.old), 'md5', md5(col.old)),
                          'after', jsonb_build_object('chars', least(char_length(col.old), col.max_chars)))
  from bad
  join fixed on fixed.id = bad.id
  cross join lateral (values ('title', bad.title, 200), ('description', bad.description, 2000)) as col(name, old, max_chars)
 where char_length(col.old) > col.max_chars;

-- ── Every bound holds for every row from here on ─────────────────────────────
alter table public.ai_employees validate constraint ai_employees_config_size;
alter table public.ai_employees validate constraint ai_employees_knowledge_size;
alter table public.ai_employees validate constraint ai_employees_goals_size;
alter table public.ai_employees validate constraint ai_employees_display_name_size;
alter table public.ai_employee_messages validate constraint ai_employee_messages_content_size;
alter table public.ai_employee_tasks validate constraint ai_employee_tasks_title_size;
alter table public.ai_employee_tasks validate constraint ai_employee_tasks_description_size;
