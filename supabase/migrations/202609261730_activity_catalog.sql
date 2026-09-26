-- Public-source activity facts. Only the authenticated API selects recommendations;
-- authenticated users cannot read/write the raw catalog or any ingestion metadata.
create table public.activity_catalog (
  id text primary key check(length(id) between 1 and 100 and id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind text not null check(kind in ('evergreen','recurring','event')),
  title text not null check(length(title) between 1 and 180),
  summary text not null check(length(summary) between 1 and 1000),
  venue text not null check(length(venue) between 1 and 180),
  area text not null check(length(area) between 1 and 120),
  tags text[] not null default '{}' check(cardinality(tags) <= 20),
  cost text not null check(cost in ('free','paid','unknown')),
  cost_note text not null check(length(cost_note) <= 500),
  eligibility text not null check(eligibility in ('public','gt_community','students','unknown')),
  eligibility_note text not null check(length(eligibility_note) <= 500),
  duration_minutes integer not null check(duration_minutes between 5 and 720),
  indoor boolean not null,
  source_url text not null check(length(source_url) <= 2000 and source_url ~ '^https://[^/]+'),
  source_name text not null check(length(source_name) between 1 and 180),
  source_checked_at timestamptz not null,
  review_after timestamptz not null,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'active' check(status in ('active','cancelled','archived')),
  updated_at timestamptz not null default now(),
  check(review_after > source_checked_at),
  check((starts_at is null and ends_at is null) or
    (starts_at is not null and ends_at is not null and ends_at > starts_at)),
  check(kind <> 'event' or starts_at is not null)
);
comment on column public.activity_catalog.duration_minutes is 'Suggested outing duration, not a verified opening or event time.';
comment on column public.activity_catalog.eligibility is 'Public means the curated activity has no known student/member/age restriction. Unknown and restricted records are excluded by the API.';
comment on column public.activity_catalog.review_after is 'Hard expiration of source verification: API suppresses the item until re-reviewed.';
create index activity_catalog_fresh on public.activity_catalog(review_after) where status='active' and eligibility='public';
alter table public.activity_catalog enable row level security;
revoke all on public.activity_catalog from public, anon, authenticated;
grant select, insert, update, delete on public.activity_catalog to service_role;

create function public.touch_activity_catalog() returns trigger
language plpgsql set search_path='' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger activity_catalog_updated before update on public.activity_catalog
for each row execute function public.touch_activity_catalog();
revoke all on function public.touch_activity_catalog() from public, anon, authenticated;
