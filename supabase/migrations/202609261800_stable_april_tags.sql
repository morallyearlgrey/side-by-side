-- Stable, public AprilTag anchors are allocated per account.  The tag is only
-- a spatial locator; it is never an account identifier or an authorization
-- credential.  Profile reveal continues to use the authenticated device and
-- connection/display-permission checks in 202609260010.
create table public.user_april_tags (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  family text not null default 'tag36h11' check (family = 'tag36h11'),
  tag_id integer not null unique check (tag_id between 0 and 586),
  marker_size_tenths_mm integer not null default 203 check (marker_size_tenths_mm between 1 and 10000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.user_april_tags enable row level security;
revoke all on public.user_april_tags from public, anon, authenticated;
grant all on public.user_april_tags to service_role;

comment on table public.user_april_tags is
  'Stable tag36h11 marker allocation. The marker locates a session and never authenticates or reveals an account.';

create or replace function public.allocate_user_april_tag(p_user_id uuid)
returns public.user_april_tags
language plpgsql security definer set search_path = '' as $$
declare result public.user_april_tags;
begin
  -- Serialize allocation so two new accounts cannot receive the same marker.
  perform pg_advisory_xact_lock(hashtextextended('sidebyside.user_april_tags', 0));
  select * into result from public.user_april_tags where user_id = p_user_id;
  if found then return result; end if;

  insert into public.user_april_tags(user_id, tag_id)
    select p_user_id, candidate::integer
    from generate_series(0, 586) as candidate
    where not exists (select 1 from public.user_april_tags t where t.tag_id = candidate)
    order by candidate
    limit 1
    returning * into result;
  if not found then
    raise exception 'No AprilTag markers remain' using errcode = '53000';
  end if;
  return result;
end;
$$;

create or replace function public.assign_user_april_tag()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.allocate_user_april_tag(new.user_id);
  return new;
end;
$$;

create trigger profile_april_tag after insert on public.profiles
  for each row execute function public.assign_user_april_tag();

-- Existing profiles receive the same allocation path as new accounts.
do $$
declare owner_id uuid;
begin
  for owner_id in select user_id from public.profiles order by user_id loop
    perform public.allocate_user_april_tag(owner_id);
  end loop;
end;
$$;

revoke all on function public.allocate_user_april_tag(uuid), public.assign_user_april_tag() from public, anon, authenticated;
grant execute on function public.allocate_user_april_tag(uuid), public.assign_user_april_tag() to service_role;
