-- Core2 badge status is independent from account discovery and matching consent.
-- Only the authenticated API may provision, report, read, or revoke a badge.
-- Store the SHA-256 of the complete random bearer credential, never its secret.
create table public.badge_devices (
  device_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null default 'SidebySide badge' check (length(trim(label)) between 1 and 64 and length(label) <= 64),
  reported_state text not null default 'paused' check (reported_state in ('paused','available')),
  last_sequence bigint not null default 0 check (last_sequence between 0 and 9007199254740991),
  last_seen_at timestamptz,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= created_at),
  check (
    (last_sequence = 0 and last_seen_at is null and lease_expires_at is null)
    or (last_sequence > 0 and last_seen_at is not null and
      ((revoked_at is null and lease_expires_at is not null and lease_expires_at = last_seen_at + interval '45 seconds')
        or (revoked_at is not null and lease_expires_at is null)))
  )
);
create index badge_devices_owner on public.badge_devices(user_id, created_at, device_id);

-- A credential cannot migrate to a different account, and revocation is final.
-- Replacement or a wiped firmware sequence counter requires a new provision.
create function public.protect_badge_binding() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.device_id is distinct from old.device_id or new.user_id is distinct from old.user_id
    or new.token_hash is distinct from old.token_hash or new.created_at is distinct from old.created_at then
    raise exception 'Badge identity is immutable; provision a replacement' using errcode = '23514';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'Badge revocation is final' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger badge_binding_immutable before update on public.badge_devices
  for each row execute function public.protect_badge_binding();

create function public.report_badge_state(p_device_id uuid, p_token_hash text, p_sequence bigint, p_state text)
returns public.badge_devices language plpgsql security definer set search_path = '' as $$
declare device public.badge_devices; observed_at timestamptz;
begin
  if p_sequence is null or p_sequence < 1 or p_sequence > 9007199254740991
    or p_state is null or p_state not in ('paused','available') then
    raise exception 'Invalid badge report' using errcode = '22023';
  end if;
  select * into device from public.badge_devices
    where device_id = p_device_id and token_hash = p_token_hash and revoked_at is null for update;
  if not found then
    raise exception 'Invalid badge credential' using errcode = '42501';
  end if;
  if p_sequence < device.last_sequence
    or (p_sequence = device.last_sequence and p_state <> device.reported_state) then
    raise exception 'Stale badge report' using errcode = '40001';
  end if;
  -- A lost response may be retried, but replay cannot keep a badge online.
  if p_sequence = device.last_sequence then return device; end if;
  observed_at := clock_timestamp();
  update public.badge_devices set reported_state = p_state, last_sequence = p_sequence,
    last_seen_at = observed_at, lease_expires_at = observed_at + interval '45 seconds'
    where device_id = p_device_id returning * into device;
  return device;
end;
$$;

-- The API derives p_user_id from Supabase Auth; the device credential cannot
-- call this RPC or choose an owner. Keep the last report for owner status/history.
create function public.revoke_badge(p_user_id uuid, p_device_id uuid)
returns public.badge_devices language plpgsql security definer set search_path = '' as $$
declare device public.badge_devices;
begin
  select * into device from public.badge_devices
    where device_id = p_device_id and user_id = p_user_id for update;
  if not found then
    raise exception 'Badge is not owned by this account' using errcode = '42501';
  end if;
  if device.revoked_at is not null then return device; end if;
  update public.badge_devices set revoked_at = clock_timestamp(), lease_expires_at = null
    where device_id = p_device_id returning * into device;
  return device;
end;
$$;

alter table public.badge_devices enable row level security;
revoke all on public.badge_devices from public, anon, authenticated;
grant all on public.badge_devices to service_role;
revoke all on function public.protect_badge_binding(), public.report_badge_state(uuid,text,bigint,text),
  public.revoke_badge(uuid,uuid) from public, anon, authenticated;
grant execute on function public.protect_badge_binding(), public.report_badge_state(uuid,text,bigint,text),
  public.revoke_badge(uuid,uuid) to service_role;

comment on table public.badge_devices is
  'Private device credentials and reported Core2 status. Effective availability requires available, an unexpired lease, and no revocation; it does not grant matching availability or consent.';
