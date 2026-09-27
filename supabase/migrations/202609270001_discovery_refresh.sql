-- GPS observations change proximity, not the approved evidence scored by Qwen.
-- Keep semantic jobs/results until expiry; every read and publication still
-- checks current consent, profile versions, blocks and mode eligibility.
create or replace function public.refresh_proximity_matches() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  actor := case when tg_op='DELETE' then old.user_id else new.user_id end;
  delete from public.match_snapshots where viewer_id=actor or exists (
    select 1 from jsonb_array_elements(items) item
    where item->>'user_id'=actor::text or item->>'candidate_id'=actor::text);
  insert into public.matching_invalidations(user_id)
    select actor where exists(select 1 from public.profiles where user_id=actor)
    on conflict(user_id) do update set updated_at=now();
  return null;
end;
$$;

drop trigger if exists presence_invalidate on public.presence;
create trigger presence_invalidate after insert or update or delete on public.presence
  for each row execute function public.refresh_proximity_matches();
revoke all on function public.refresh_proximity_matches() from public, anon, authenticated;
grant execute on function public.refresh_proximity_matches() to service_role;

-- Only the authenticated API resolves an opaque radio token to this session.
-- Recheck the live session/pair atomically and never let an older request move
-- a real observation backwards. Repeated reads of a token remain fresh.
create or replace function public.record_ble_encounter(
  p_observer_id uuid, p_session_id uuid, p_observed_at timestamptz, p_rssi integer
) returns void language plpgsql security definer set search_path = '' as $$
declare seen public.phone_ble_sessions;
begin
  if p_observed_at is null or p_observed_at < now()-interval '120 seconds'
    or p_observed_at > now()+interval '30 seconds'
    or (p_rssi is not null and p_rssi not between -127 and 20) then
    raise exception using errcode='PT422', message='The Bluetooth observation is no longer valid.';
  end if;
  select * into seen from public.phone_ble_sessions
    where session_id=p_session_id and revoked_at is null
      and issued_at<=now() and expires_at>now() for share;
  if not found or p_observed_at < seen.issued_at-interval '30 seconds'
    or not public.eligible_pair(p_observer_id,seen.user_id,'ble') then
    raise exception using errcode='PT404', message='This encounter is not available.';
  end if;
  insert into public.encounters(observer_user_id,observed_user_id,observed_session_id,observed_at,rssi)
    values(p_observer_id,seen.user_id,p_session_id,least(p_observed_at,now()),p_rssi)
    on conflict(observer_user_id,observed_session_id) do update
      set observed_at=excluded.observed_at,rssi=excluded.rssi
      where excluded.observed_at > public.encounters.observed_at;
end;
$$;
revoke all on function public.record_ble_encounter(uuid,uuid,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.record_ble_encounter(uuid,uuid,timestamptz,integer) to service_role;
