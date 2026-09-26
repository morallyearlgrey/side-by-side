-- Optional accessory ownership only. These functions never change matching,
-- consent, profiles, phone presence or Newton worker scope.
create table public.device_pairings (
  pairing_id uuid primary key,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  kind text not null check (kind in ('quest','core2')),
  label text not null check (length(trim(label)) between 1 and 64),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '3 minutes',
  consumed_at timestamptz,
  cancelled_at timestamptz
);
create index device_pairings_owner on public.device_pairings(user_id,created_at);
create table public.headset_devices (
  device_id uuid primary key,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  label text not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  last_sequence bigint not null default 0 check (last_sequence between 0 and 9007199254740991),
  last_seen_at timestamptz,
  lease_expires_at timestamptz,
  owner_lease_expires_at timestamptz,
  worn_reported boolean,
  app_foreground boolean not null default false,
  ar_enabled boolean not null default false,
  camera_ready boolean not null default false,
  tracker_ready boolean not null default false
);
create index headset_devices_owner on public.headset_devices(user_id,created_at);
create trigger headset_binding_immutable before update on public.headset_devices
  for each row execute function public.protect_badge_binding();

create function public.approve_device_pairing(p_user_id uuid,p_pairing_id uuid,p_token_hash text,p_kind text,p_label text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ticket public.device_pairings;
begin
  -- Serialize issuance, claim and signout for this owner.
  perform 1 from public.profiles where user_id=p_user_id for update;
  if not found then raise exception 'Unknown account' using errcode='42501'; end if;
  if (select count(*) from public.device_pairings where user_id=p_user_id and created_at > clock_timestamp()-interval '1 minute') >= 5 then
    raise exception 'Pairing rate exceeded' using errcode='PT429';
  end if;
  insert into public.device_pairings(pairing_id,user_id,kind,label,token_hash)
    values(p_pairing_id,p_user_id,p_kind,p_label,p_token_hash) returning * into ticket;
  return jsonb_build_object('expires_at',ticket.expires_at);
end $$;

create function public.claim_device_pairing(p_pairing_id uuid,p_token_hash text,p_badge_hash text,p_headset_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ticket public.device_pairings; owner_id uuid;
begin
  select user_id into owner_id from public.device_pairings where pairing_id=p_pairing_id and token_hash=p_token_hash;
  if not found then raise exception 'Invalid pairing' using errcode='42501'; end if;
  perform 1 from public.profiles where user_id=owner_id for update;
  select * into ticket from public.device_pairings where pairing_id=p_pairing_id and token_hash=p_token_hash
    and consumed_at is null and cancelled_at is null and expires_at > clock_timestamp() for update;
  if not found then raise exception 'Expired pairing' using errcode='42501'; end if;
  if ticket.kind='core2' then
    insert into public.badge_devices(device_id,user_id,label,token_hash) values(ticket.pairing_id,ticket.user_id,ticket.label,p_badge_hash);
  else
    insert into public.headset_devices(device_id,user_id,label,token_hash) values(ticket.pairing_id,ticket.user_id,ticket.label,p_headset_hash);
  end if;
  update public.device_pairings set consumed_at=clock_timestamp() where pairing_id=p_pairing_id;
  return jsonb_build_object('kind',ticket.kind);
end $$;

create function public.cancel_device_pairing(p_user_id uuid,p_pairing_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.profiles where user_id=p_user_id for update;
  update public.device_pairings set cancelled_at=coalesce(cancelled_at,clock_timestamp())
    where user_id=p_user_id and pairing_id=p_pairing_id and consumed_at is null;
end $$;

create function public.renew_headset_owner_lease(p_user_id uuid,p_device_id uuid)
returns public.headset_devices language plpgsql security definer set search_path='' as $$
declare device public.headset_devices;
begin
  update public.headset_devices set owner_lease_expires_at=clock_timestamp()+interval '30 seconds'
    where user_id=p_user_id and device_id=p_device_id and revoked_at is null returning * into device;
  if not found then raise exception 'Invalid headset owner' using errcode='42501'; end if;
  return device;
end $$;

create function public.report_headset_state(p_device_id uuid,p_token_hash text,p_sequence bigint,p_observation jsonb)
returns public.headset_devices language plpgsql security definer set search_path='' as $$
declare device public.headset_devices; observed_at timestamptz; previous jsonb;
begin
  if p_sequence is null or p_sequence < 1 or p_sequence > 9007199254740991
    or p_observation is null or jsonb_typeof(p_observation) <> 'object'
    or not (p_observation ?& array['worn_reported','app_foreground','ar_enabled','camera_ready','tracker_ready'])
    or (p_observation - array['worn_reported','app_foreground','ar_enabled','camera_ready','tracker_ready']) <> '{}'::jsonb
    or jsonb_typeof(p_observation->'worn_reported') not in ('boolean','null')
    or jsonb_typeof(p_observation->'app_foreground') <> 'boolean'
    or jsonb_typeof(p_observation->'ar_enabled') <> 'boolean'
    or jsonb_typeof(p_observation->'camera_ready') <> 'boolean'
    or jsonb_typeof(p_observation->'tracker_ready') <> 'boolean' then
    raise exception 'Invalid observation' using errcode='22023';
  end if;
  select * into device from public.headset_devices where device_id=p_device_id and token_hash=p_token_hash
    and revoked_at is null for update;
  if not found then raise exception 'Invalid headset credential' using errcode='42501'; end if;
  previous := jsonb_build_object('worn_reported',device.worn_reported,'app_foreground',device.app_foreground,
    'ar_enabled',device.ar_enabled,'camera_ready',device.camera_ready,'tracker_ready',device.tracker_ready);
  if p_sequence < device.last_sequence or (p_sequence=device.last_sequence and previous<>p_observation) then
    raise exception 'Stale report' using errcode='PT409';
  end if;
  if p_sequence=device.last_sequence then return device; end if;
  observed_at := clock_timestamp();
  update public.headset_devices set last_sequence=p_sequence,last_seen_at=observed_at,
    lease_expires_at=observed_at+interval '15 seconds',
    worn_reported=(p_observation->>'worn_reported')::boolean,
    app_foreground=(p_observation->>'app_foreground')::boolean, ar_enabled=(p_observation->>'ar_enabled')::boolean,
    camera_ready=(p_observation->>'camera_ready')::boolean, tracker_ready=(p_observation->>'tracker_ready')::boolean
    where device_id=p_device_id returning * into device;
  return device;
end $$;

create function public.revoke_headset(p_user_id uuid,p_device_id uuid)
returns public.headset_devices language plpgsql security definer set search_path='' as $$
declare device public.headset_devices;
begin
  update public.headset_devices set revoked_at=coalesce(revoked_at,clock_timestamp()),lease_expires_at=null,owner_lease_expires_at=null
    where user_id=p_user_id and device_id=p_device_id returning * into device;
  if not found then raise exception 'Invalid headset owner' using errcode='42501'; end if;
  return device;
end $$;

create function public.end_device_sessions(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.profiles where user_id=p_user_id for update;
  update public.device_pairings set cancelled_at=coalesce(cancelled_at,clock_timestamp())
    where user_id=p_user_id and consumed_at is null;
  update public.headset_devices set revoked_at=clock_timestamp(),lease_expires_at=null,owner_lease_expires_at=null
    where user_id=p_user_id and revoked_at is null;
end $$;

alter table public.badge_devices add column session_token text,
  add column tag_id integer check (tag_id between 0 and 586),
  add column marker_size_tenths_mm integer check (marker_size_tenths_mm between 1 and 10000),
  add column session_expires_at timestamptz,
  add constraint badge_session_metadata check (
    (session_token is null and tag_id is null and marker_size_tenths_mm is null and session_expires_at is null)
    or (session_token is not null and session_token ~ '^[0-9a-f]{16}$' and tag_id is not null
      and marker_size_tenths_mm is not null and session_expires_at is not null));

-- Legacy reports and revocation also erase an earlier v2 association.
create function public.clear_inactive_badge_session() returns trigger language plpgsql set search_path='' as $$
begin
  if new.last_sequence<>old.last_sequence or new.reported_state='paused' or new.revoked_at is not null then
    new.session_token:=null; new.tag_id:=null; new.marker_size_tenths_mm:=null; new.session_expires_at:=null;
  end if;
  return new;
end $$;
create trigger badge_session_inactive before update on public.badge_devices
  for each row execute function public.clear_inactive_badge_session();

create function public.report_badge_session(p_device_id uuid,p_token_hash text,p_sequence bigint,p_state text,
  p_session_token text,p_tag_id integer,p_marker_size_tenths_mm integer,p_remaining_seconds integer)
returns public.badge_devices language plpgsql security definer set search_path='' as $$
declare device public.badge_devices; previous public.badge_devices; expiry timestamptz;
begin
  if (p_state='paused' and (p_session_token is not null or p_tag_id is not null or p_marker_size_tenths_mm is not null or p_remaining_seconds is not null))
    or (p_state='available' and (p_session_token is null or p_session_token !~ '^[0-9a-f]{16}$'
      or p_tag_id is null or p_tag_id not between 0 and 586 or p_marker_size_tenths_mm is null
      or p_marker_size_tenths_mm not between 1 and 10000 or p_remaining_seconds is null or p_remaining_seconds not between 1 and 120)) then
    raise exception 'Invalid badge session' using errcode='22023';
  end if;
  select * into previous from public.badge_devices where device_id=p_device_id and token_hash=p_token_hash and revoked_at is null for update;
  if not found then raise exception 'Invalid badge credential' using errcode='42501'; end if;
  if p_sequence=previous.last_sequence and (p_session_token is distinct from previous.session_token
    or p_tag_id is distinct from previous.tag_id or p_marker_size_tenths_mm is distinct from previous.marker_size_tenths_mm) then
    raise exception 'Conflicting session' using errcode='PT409';
  end if;
  device := public.report_badge_state(p_device_id,p_token_hash,p_sequence,p_state);
  if p_sequence=previous.last_sequence then return device; end if;
  if p_state='available' then
    if p_session_token=previous.session_token then
      if p_tag_id<>previous.tag_id or p_marker_size_tenths_mm<>previous.marker_size_tenths_mm then
        raise exception 'Session metadata changed' using errcode='PT409';
      end if;
      expiry:=least(previous.session_expires_at,clock_timestamp()+make_interval(secs=>p_remaining_seconds));
    else
      expiry:=clock_timestamp()+make_interval(secs=>p_remaining_seconds);
    end if;
    update public.badge_devices set session_token=p_session_token,tag_id=p_tag_id,
      marker_size_tenths_mm=p_marker_size_tenths_mm,session_expires_at=expiry
      where device_id=p_device_id returning * into device;
  end if;
  return device;
end $$;

alter table public.device_pairings enable row level security;
alter table public.headset_devices enable row level security;
revoke all on public.device_pairings,public.headset_devices from public,anon,authenticated;
grant all on public.device_pairings,public.headset_devices to service_role;
revoke all on function public.approve_device_pairing(uuid,uuid,text,text,text),public.claim_device_pairing(uuid,text,text,text),
  public.cancel_device_pairing(uuid,uuid),public.renew_headset_owner_lease(uuid,uuid),public.report_headset_state(uuid,text,bigint,jsonb),
  public.revoke_headset(uuid,uuid),public.end_device_sessions(uuid),public.clear_inactive_badge_session(),
  public.report_badge_session(uuid,text,bigint,text,text,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.approve_device_pairing(uuid,uuid,text,text,text),public.claim_device_pairing(uuid,text,text,text),
  public.cancel_device_pairing(uuid,uuid),public.renew_headset_owner_lease(uuid,uuid),public.report_headset_state(uuid,text,bigint,jsonb),
  public.revoke_headset(uuid,uuid),public.end_device_sessions(uuid),public.clear_inactive_badge_session(),
  public.report_badge_session(uuid,text,bigint,text,text,integer,integer,integer) to service_role;
