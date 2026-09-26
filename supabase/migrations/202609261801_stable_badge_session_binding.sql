-- Device reports for the stable marker path are bound to the owner's allocated
-- tag. The tag remains public locator data; the device/session and display
-- permission checks still gate every profile reveal.
create or replace function public.report_user_april_tag_session(
  p_device_id uuid, p_token_hash text, p_sequence bigint, p_state text,
  p_session_token text, p_tag_id integer, p_marker_size_tenths_mm integer,
  p_remaining_seconds integer)
returns public.badge_devices language plpgsql security definer set search_path = '' as $$
declare device public.badge_devices; expected_tag integer; sharing_allowed boolean;
begin
  select * into device from public.badge_devices
    where device_id=p_device_id and token_hash=p_token_hash and revoked_at is null;
  if not found then raise exception 'Invalid badge credential' using errcode='42501'; end if;
  select tag_id into expected_tag from public.user_april_tags where user_id=device.user_id;
  if not found then raise exception 'No stable AprilTag is assigned' using errcode='42501'; end if;
  select (available and (discoverable or bluetooth_enabled)) into sharing_allowed
    from public.profiles where user_id=device.user_id;
  if p_state='available' and sharing_allowed is distinct from true then
    -- The account-level sharing switch is authoritative. Treat a stale device
    -- heartbeat as paused so the Charm stops advertising and clears metadata.
    return public.report_badge_session(p_device_id,p_token_hash,p_sequence,'paused',null,null,null,null);
  end if;
  if p_state='available' and p_tag_id is distinct from expected_tag then
    raise exception 'AprilTag does not belong to this badge owner' using errcode='42501';
  end if;
  if p_state='paused' and (p_session_token is not null or p_tag_id is not null
      or p_marker_size_tenths_mm is not null or p_remaining_seconds is not null) then
    raise exception 'Paused badge cannot publish marker metadata' using errcode='22023';
  end if;
  return public.report_badge_session(p_device_id,p_token_hash,p_sequence,p_state,
    p_session_token,p_tag_id,p_marker_size_tenths_mm,p_remaining_seconds);
end;
$$;

revoke all on function public.report_user_april_tag_session(uuid,text,bigint,text,text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.report_user_april_tag_session(uuid,text,bigint,text,text,integer,integer,integer) to service_role;
