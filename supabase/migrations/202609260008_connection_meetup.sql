-- Precise meetup locations require two independent, short-lived opt-ins.
-- Neither clients nor the scoped Newton worker can read this table directly.
create table public.connection_location_shares (
  request_id uuid not null references public.connection_requests on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  share_id uuid not null default gen_random_uuid(),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision not null check (accuracy_m between 0 and 250),
  observed_at timestamptz not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (request_id,user_id),
  check (expires_at > started_at and expires_at <= started_at + interval '15 minutes')
);
alter table public.connection_location_shares enable row level security;
revoke all on public.connection_location_shares from public,anon,authenticated;
grant all on public.connection_location_shares to service_role;

create function public.connection_meetup(p_user_id uuid,p_request_id uuid,p_action text default 'read',
  p_point jsonb default null,p_share_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.connection_requests;
  mine public.connection_location_shares;
  theirs public.connection_location_shares;
  other_id uuid; observed timestamptz; output jsonb; valid_until timestamptz;
begin
  -- Serialize reads, opt-ins, refreshes and stop against connection decisions.
  select * into r from public.connection_requests where request_id=p_request_id
    and p_user_id in (requester_user_id,recipient_user_id) for update;
  if not found then raise exception 'Connection not available' using errcode='42501'; end if;
  if p_action not in ('read','start','update','stop') then raise exception 'Invalid action'; end if;
  other_id := case when p_user_id=r.requester_user_id then r.recipient_user_id else r.requester_user_id end;
  if p_action='stop' then
    delete from public.connection_location_shares where request_id=p_request_id and user_id=p_user_id
      and share_id=p_share_id;
  end if;
  delete from public.connection_location_shares where request_id=p_request_id and expires_at<=now();
  if r.requester_decision<>'accept' or r.recipient_decision<>'accept' or r.expires_at<=now()
    or not public.eligible_pair(r.requester_user_id,r.recipient_user_id,'connection')
    or r.requester_profile_version_id is distinct from (select current_profile_version_id from public.profiles where user_id=r.requester_user_id)
    or r.recipient_profile_version_id is distinct from (select current_profile_version_id from public.profiles where user_id=r.recipient_user_id) then
    delete from public.connection_location_shares where request_id=p_request_id;
    return jsonb_build_object('status','unavailable','sharing',false,'peer_sharing',false,
      'share_id',null,'sharing_until',null,'valid_until',null,'me',null,'peer',null);
  end if;
  select * into mine from public.connection_location_shares where request_id=p_request_id and user_id=p_user_id;
  if p_action in ('start','update') then
    if p_point is null or not (p_point ?& array['latitude','longitude','accuracy_m','observed_at']) then raise exception 'Missing location'; end if;
    observed := (p_point->>'observed_at')::timestamptz;
    if observed is null or observed < now()-interval '60 seconds' or observed>now()+interval '5 seconds' then
      raise exception 'A recent location is required' using errcode='22023';
    end if;
    if p_action='start' then
      insert into public.connection_location_shares(request_id,user_id,latitude,longitude,accuracy_m,observed_at,expires_at)
        values (p_request_id,p_user_id,(p_point->>'latitude')::double precision,(p_point->>'longitude')::double precision,
          (p_point->>'accuracy_m')::double precision,observed,least(r.expires_at,now()+interval '15 minutes'))
        on conflict(request_id,user_id) do update set share_id=gen_random_uuid(),latitude=excluded.latitude,
          longitude=excluded.longitude,accuracy_m=excluded.accuracy_m,observed_at=excluded.observed_at,
          started_at=now(),expires_at=excluded.expires_at;
    else
      if mine.share_id is null or mine.share_id is distinct from p_share_id then
        raise exception 'Location sharing has stopped' using errcode='42501';
      end if;
      -- A delayed position cannot overwrite a newer fix or extend the opt-in.
      update public.connection_location_shares set latitude=(p_point->>'latitude')::double precision,
        longitude=(p_point->>'longitude')::double precision,accuracy_m=(p_point->>'accuracy_m')::double precision,
        observed_at=observed where request_id=p_request_id and user_id=p_user_id and observed_at<=observed;
    end if;
  end if;
  select * into mine from public.connection_location_shares where request_id=p_request_id and user_id=p_user_id;
  select * into theirs from public.connection_location_shares where request_id=p_request_id and user_id=other_id;
  output := jsonb_build_object('status',case when mine.share_id is null then 'off' else 'waiting' end,
    'sharing',mine.share_id is not null,'peer_sharing',theirs.share_id is not null,
    'share_id',mine.share_id,'sharing_until',mine.expires_at,'valid_until',null,'me',null,'peer',null);
  if mine.share_id is null or theirs.share_id is null then return output; end if;
  valid_until := least(mine.expires_at,theirs.expires_at,mine.observed_at+interval '2 minutes',
    theirs.observed_at+interval '2 minutes',now()+interval '20 seconds');
  if valid_until<=now() then return output || jsonb_build_object('status','stale'); end if;
  return output || jsonb_build_object('status','sharing','valid_until',valid_until,
    'me',jsonb_build_object('latitude',mine.latitude,'longitude',mine.longitude,'accuracy_m',mine.accuracy_m,'observed_at',mine.observed_at),
    'peer',jsonb_build_object('latitude',theirs.latitude,'longitude',theirs.longitude,'accuracy_m',theirs.accuracy_m,'observed_at',theirs.observed_at));
end;
$$;
revoke all on function public.connection_meetup(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.connection_meetup(uuid,uuid,text,jsonb,uuid) to service_role;

create function public.clear_connection_meetup() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='connection_requests' then
    if new.requester_decision<>'accept' or new.recipient_decision<>'accept' then
      delete from public.connection_location_shares where request_id=new.request_id;
    end if;
  elsif new.current_profile_version_id is distinct from old.current_profile_version_id or not new.available then
    delete from public.connection_location_shares where request_id in (
      select request_id from public.connection_requests where new.user_id in (requester_user_id,recipient_user_id));
  end if;
  return null;
end;
$$;
revoke all on function public.clear_connection_meetup() from public,anon,authenticated;
create trigger connection_meetup_revoke after update on public.connection_requests for each row execute function public.clear_connection_meetup();
create trigger connection_meetup_profile after update on public.profiles for each row execute function public.clear_connection_meetup();
