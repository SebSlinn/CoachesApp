-- 20261023130000_user_settings.sql — Accounts: per-person display settings that follow you between devices.
--
-- First setting: the zone colour/label scheme (contracts/ZONES.md). Until now it lived only in the
-- browser (KEYS.ZONE_SCHEME), so another device — or a cleared browser — showed the default colours.
-- The app still keeps a copy on the device (screens need it on the first render, and offline);
-- this row is the one that travels. Stored value: { id } for a built-in scheme, or the custom scheme
-- object; null = the default.
--
-- Only you read or write your own row. Small by design: a jsonb per setting, size-capped.
-- Idempotent.

create table if not exists public.user_settings (
  user_id     uuid primary key references public.users(id) on delete cascade,
  zone_scheme jsonb check (zone_scheme is null or (jsonb_typeof(zone_scheme) = 'object' and octet_length(zone_scheme::text) <= 20000)),
  updated_at  timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists sz_user_settings_select on public.user_settings;
create policy sz_user_settings_select on public.user_settings for select to authenticated
  using (user_id = auth.uid());

drop policy if exists sz_user_settings_insert on public.user_settings;
create policy sz_user_settings_insert on public.user_settings for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists sz_user_settings_update on public.user_settings;
create policy sz_user_settings_update on public.user_settings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update on public.user_settings to authenticated;
  end if;
end $$;
