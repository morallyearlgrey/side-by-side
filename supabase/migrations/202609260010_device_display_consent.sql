-- A connection's normal acceptance and each participant's separate AR opt-in
-- are both required. Hardware never changes phone matching or consent.
create table public.connection_display_permissions (
  request_id uuid not null references public.connection_requests on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  revision bigint not null default 0,
  granted boolean not null default false,
  expires_at timestamptz,
  active_until timestamptz,
  primary key(request_id,user_id)
);
alter table public.connection_display_permissions enable row level security;
revoke all on public.connection_display_permissions from public,anon,authenticated;
grant all on public.connection_display_permissions to service_role;

create function public.connection_display_permission(p_user_id uuid,p_request_id uuid,p_granted boolean default null,p_revision bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.connection_requests; mine public.connection_display_permissions; peer public.connection_display_permissions;
  eligible boolean; other_id uuid;
begin
  select * into r from public.connection_requests where request_id=p_request_id
    and p_user_id in (requester_user_id,recipient_user_id) for update;
  if not found then raise exception 'Unknown connection' using errcode='42501'; end if;
  other_id:=case when p_user_id=r.requester_user_id then r.recipient_user_id else r.requester_user_id end;
  eligible:=r.requester_decision='accept' and r.recipient_decision='accept' and r.expires_at>clock_timestamp()
    and public.eligible_pair(r.requester_user_id,r.recipient_user_id,'connection')
    and r.requester_profile_version_id=(select current_profile_version_id from public.profiles where user_id=r.requester_user_id)
    and r.recipient_profile_version_id=(select current_profile_version_id from public.profiles where user_id=r.recipient_user_id);
  select * into mine from public.connection_display_permissions where request_id=p_request_id and user_id=p_user_id;
  if p_granted is not null then
    if p_revision is distinct from coalesce(mine.revision,0) then raise exception 'Stale display permission' using errcode='PT409'; end if;
    if p_granted and eligible is not true then raise exception 'Mutual acceptance required' using errcode='42501'; end if;
    insert into public.connection_display_permissions(request_id,user_id,revision,granted,expires_at,active_until)
      values(p_request_id,p_user_id,coalesce(mine.revision,0)+1,p_granted,
        case when p_granted then least(r.expires_at,clock_timestamp()+interval '15 minutes') end,
        case when p_granted then clock_timestamp()+interval '30 seconds' end)
      on conflict(request_id,user_id) do update set revision=excluded.revision,granted=excluded.granted,expires_at=excluded.expires_at,active_until=excluded.active_until
      returning * into mine;
  end if;
  if eligible and mine.granted and mine.expires_at>clock_timestamp() then
    update public.connection_display_permissions set active_until=clock_timestamp()+interval '30 seconds'
      where request_id=p_request_id and user_id=p_user_id returning * into mine;
  end if;
  select * into peer from public.connection_display_permissions where request_id=p_request_id and user_id=other_id;
  return jsonb_build_object('revision',coalesce(mine.revision,0),'granted',
    coalesce(eligible and mine.granted and mine.expires_at>clock_timestamp(),false),
    'peer_granted',coalesce(eligible and peer.granted and peer.expires_at>clock_timestamp() and peer.active_until>clock_timestamp(),false),
    'expires_at',case when eligible and mine.granted then mine.expires_at end);
end $$;

create function public.clear_connection_display_permissions() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='connection_requests' then
    if new.requester_decision<>'accept' or new.recipient_decision<>'accept' then
      update public.connection_display_permissions set granted=false,expires_at=null,revision=revision+1
        where request_id=new.request_id and granted;
    end if;
  elsif new.current_profile_version_id is distinct from old.current_profile_version_id or not new.available then
    update public.connection_display_permissions set granted=false,expires_at=null,revision=revision+1
      where granted and request_id in (select request_id from public.connection_requests
        where new.user_id in (requester_user_id,recipient_user_id));
  end if;
  return null;
end $$;
create trigger connection_display_revoke after update on public.connection_requests
  for each row execute function public.clear_connection_display_permissions();
create trigger connection_display_profile after update on public.profiles
  for each row execute function public.clear_connection_display_permissions();

create function public.authorize_headset_target(p_device_id uuid,p_token_hash text,p_session_token text,p_tag_id integer,p_marker_size_tenths_mm integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.headset_devices; b public.badge_devices; r public.connection_requests;
  mine public.connection_display_permissions; theirs public.connection_display_permissions; until_at timestamptz;
begin
  select * into h from public.headset_devices where device_id=p_device_id and token_hash=p_token_hash and revoked_at is null;
  if not found then raise exception 'Invalid headset' using errcode='42501'; end if;
  if h.lease_expires_at is null or h.lease_expires_at<=clock_timestamp() or h.owner_lease_expires_at is null
    or h.owner_lease_expires_at<=clock_timestamp() or h.worn_reported is not true or not h.app_foreground
    or not h.ar_enabled or not h.camera_ready or not h.tracker_ready then return null; end if;
  -- Fail closed on active token OR marker collisions; never pick an arbitrary owner.
  if (select count(*) from public.badge_devices where revoked_at is null and reported_state='available'
      and lease_expires_at>clock_timestamp() and session_expires_at>clock_timestamp()
      and (session_token=p_session_token or tag_id=p_tag_id))<>1 then return null; end if;
  select * into b from public.badge_devices where revoked_at is null and reported_state='available'
    and lease_expires_at>clock_timestamp() and session_expires_at>clock_timestamp()
    and session_token=p_session_token and tag_id=p_tag_id and marker_size_tenths_mm=p_marker_size_tenths_mm;
  if not found or b.user_id=h.user_id then return null; end if;
  select c.* into r from public.connection_requests c where
    ((c.requester_user_id=h.user_id and c.recipient_user_id=b.user_id) or
     (c.recipient_user_id=h.user_id and c.requester_user_id=b.user_id))
    and c.requester_decision='accept' and c.recipient_decision='accept' and c.expires_at>clock_timestamp()
    and public.eligible_pair(c.requester_user_id,c.recipient_user_id,'connection')
    and c.requester_profile_version_id=(select current_profile_version_id from public.profiles where user_id=c.requester_user_id)
    and c.recipient_profile_version_id=(select current_profile_version_id from public.profiles where user_id=c.recipient_user_id)
    and exists(select 1 from public.connection_display_permissions d where d.request_id=c.request_id and d.user_id=h.user_id and d.granted and d.expires_at>clock_timestamp() and d.active_until>clock_timestamp())
    and exists(select 1 from public.connection_display_permissions d where d.request_id=c.request_id and d.user_id=b.user_id and d.granted and d.expires_at>clock_timestamp() and d.active_until>clock_timestamp())
    order by c.created_at desc limit 1;
  if not found then return null; end if;
  select * into mine from public.connection_display_permissions where request_id=r.request_id and user_id=h.user_id;
  select * into theirs from public.connection_display_permissions where request_id=r.request_id and user_id=b.user_id;
  until_at:=least(clock_timestamp()+interval '5 seconds',h.lease_expires_at,h.owner_lease_expires_at,
    b.lease_expires_at,b.session_expires_at,r.expires_at,mine.expires_at,theirs.expires_at,mine.active_until,theirs.active_until);
  return jsonb_build_object('viewer_id',h.user_id,'wearer_id',b.user_id,'request_id',r.request_id,
    'requester_version',r.requester_profile_version_id,'recipient_version',r.recipient_profile_version_id,
    'viewer_permission_revision',mine.revision,'wearer_permission_revision',theirs.revision,
    'badge_device_id',b.device_id,'valid_until',until_at);
end $$;

create or replace function public.end_device_sessions(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.profiles where user_id=p_user_id for update;
  update public.device_pairings set cancelled_at=coalesce(cancelled_at,clock_timestamp())
    where user_id=p_user_id and consumed_at is null;
  update public.headset_devices set revoked_at=clock_timestamp(),lease_expires_at=null,owner_lease_expires_at=null
    where user_id=p_user_id and revoked_at is null;
  update public.connection_display_permissions set granted=false,expires_at=null,active_until=null,revision=revision+1
    where user_id=p_user_id;
end $$;
revoke all on function public.connection_display_permission(uuid,uuid,boolean,bigint),
  public.clear_connection_display_permissions(),public.authorize_headset_target(uuid,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.connection_display_permission(uuid,uuid,boolean,bigint),
  public.clear_connection_display_permissions(),public.authorize_headset_target(uuid,text,text,integer,integer) to service_role;
