-- An out-of-order badge report is a permanent HTTP conflict. SQLSTATE 40001
-- means serialization failure and can make PostgREST retry this RPC forever.
-- PT409 is PostgREST's documented explicit HTTP 409 error code:
-- https://docs.postgrest.org/en/v13/references/errors.html#raise-errors-with-http-status-codes
-- Preserve the applied migration 004 and its credential/lease semantics.
create or replace function public.report_badge_state(p_device_id uuid, p_token_hash text, p_sequence bigint, p_state text)
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
    raise sqlstate 'PT409' using message = 'Stale badge report';
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
