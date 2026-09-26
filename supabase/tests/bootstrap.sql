-- CI ONLY: minimal auth/storage contracts for a disposable PostgreSQL service.
-- NEVER RUN THIS ON SUPABASE OR ANY SHARED/PRODUCTION DATABASE.
-- Requires an empty database named exactly sidebyside_ci, owned by the CI
-- superuser. This is deliberately not a Supabase application migration.
\set ON_ERROR_STOP on
begin;
do $$
begin
  if current_database() <> 'sidebyside_ci' then
    raise exception 'CI bootstrap requires disposable database sidebyside_ci';
  end if;
  if exists(select 1 from pg_namespace where nspname in ('auth','storage','supabase_migrations'))
    or to_regclass('public.profiles') is not null then
    raise exception 'Refusing bootstrap: database is not an empty CI database';
  end if;
end;
$$;

-- postgis/postgis initializes extensions in public. The application uses the
-- Supabase extensions namespace, so prepare the same layout in this empty CI
-- database. These operations must never be copied into a production migration.
drop extension if exists postgis_tiger_geocoder cascade;
drop extension if exists postgis_topology cascade;
drop extension if exists postgis cascade;
create schema extensions;
create extension postgis with schema extensions;

do $$
begin
  if not exists(select 1 from pg_roles where rolname='anon') then
    create role anon nologin;
  end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin;
  end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

create schema auth;
create table auth.users (
  id uuid primary key,
  aud text,
  role text,
  email text,
  created_at timestamptz,
  updated_at timestamptz
);
create function auth.uid() returns uuid language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
$$;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  owner_id text,
  unique(bucket_id,name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable set search_path = '' as $$
  select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1];
$$;

grant usage on schema public,extensions,auth,storage to anon,authenticated,service_role;
grant execute on function auth.uid(),storage.foldername(text) to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to authenticated;
grant all on all tables in schema auth,storage to service_role;
commit;
