-- 20261009140000_ladder_level_names.sql
-- 1. Labels are display text: a used (locked) test may now have its param and
--    level LABELS changed, like its name and description. Everything that changes
--    what is swum — keys, values, rep counts, send-offs, rest — is still frozen.
-- 2. The 100s Ladder's level names regrouped to fit real swimmers:
--      Junior   J1 10×100 on 2:00 · J2 15×100 on 1:50
--      Club     J3 20×100 on 1:40 · L1 20×100 on 1:30 · L2 25×100 on 1:25
--      National L3 30×100 on 1:20 · N1 35×100 on 1:15 · N2 40×100 on 1:10
--    A national 1500 swimmer (18:00 → 1:12/100) holds 1:20 with ~8 s rest; a
--    regional 20:00 swimmer (1:20/100) gets none — so 1:20 and below is national.
--    The level CODES (J1…N2) don't change, so saved runs keep their level.
-- Re-running is a no-op.

begin;

-- params with every "label" removed (top level of each param, and its options)
create or replace function public.params_without_labels(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(k,
    case when jsonb_typeof(v) = 'object' then
      (v - 'label') || case when jsonb_typeof(v -> 'options') = 'array' then
        jsonb_build_object('options', (
          select coalesce(jsonb_agg(case when jsonb_typeof(o) = 'object' then o - 'label' else o end order by ord), '[]'::jsonb)
            from jsonb_array_elements(v -> 'options') with ordinality as t(o, ord)))
      else '{}'::jsonb end
    else v end), '{}'::jsonb)
  from jsonb_each(coalesce(p, '{}'::jsonb)) as e(k, v)
$$;

create or replace function public.guard_locked_protocol() returns trigger
language plpgsql as $$
begin
  if old.locked then
    if not new.locked then
      raise exception 'LOCKED: a used protocol cannot be unlocked';
    end if;
    if new.key          is distinct from old.key
    or new.version      is distinct from old.version
    or new.owner_org_id is distinct from old.owner_org_id
    or new.set_json     is distinct from old.set_json
    or new.measures     is distinct from old.measures
    or public.params_without_labels(new.params) is distinct from public.params_without_labels(old.params)
    or new.analyser     is distinct from old.analyser then
      raise exception 'LOCKED: protocol % v% has results against it — create version % instead',
        old.key, old.version, old.version + 1;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

do $$
declare
  v_labels jsonb := $j${
    "J1":"Junior 1 — 10×100 on 2:00", "J2":"Junior 2 — 15×100 on 1:50",
    "J3":"Club 1 — 20×100 on 1:40",   "L1":"Club 2 — 20×100 on 1:30",   "L2":"Club 3 — 25×100 on 1:25",
    "L3":"National 1 — 30×100 on 1:20", "N1":"National 2 — 35×100 on 1:15", "N2":"National 3 — 40×100 on 1:10"
  }$j$::jsonb;
  v_desc text := 'Straight 100 Free at AT, one ladder in three bands. '
    'Junior: 10 on 2:00 · 15 on 1:50. Club: 20 on 1:40 · 20 on 1:30 · 25 on 1:25. '
    'National: 30 on 1:20 · 35 on 1:15 · 40 on 1:10. '
    'Guide: an 18:00 1500 swimmer (1:12/100) holds National 1 with about 8 s rest; a 20:00 swimmer (1:20/100) gets none. '
    'Move up a level once the current one is held (every rep swum with at least 5 s rest). '
    'Compare pace, fade and stroke count across the season, with the level marked.';
  p record;
  v_opts jsonb;
begin
  -- every version, so older runs read the same names (labels only — safe when locked)
  for p in select id, params from public.test_protocols
            where key = 'ladder-100s' and owner_org_id is null and params ? 'level' loop
    select jsonb_agg(case when v_labels ? (o ->> 'value') then jsonb_set(o, '{label}', v_labels -> (o ->> 'value')) else o end order by ord)
      into v_opts
      from jsonb_array_elements(p.params -> 'level' -> 'options') with ordinality as t(o, ord);
    update public.test_protocols
       set params = jsonb_set(params, '{level,options}', v_opts), description = v_desc
     where id = p.id
       and (params -> 'level' -> 'options' is distinct from v_opts or description is distinct from v_desc);
  end loop;
end $$;

commit;
