-- A supported recommendation in either direction may offer the pair to both
-- people. A suggestion records no acceptance; each decision remains explicit.
create function public.suggest_connection_pair(
  p_viewer_id uuid, p_candidate_id uuid,
  p_lifetime_seconds integer default 86400, p_mode text default 'nearby'
) returns public.connection_requests language plpgsql security definer set search_path = '' as $$
declare r public.connection_requests;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    least(p_viewer_id::text,p_candidate_id::text)||greatest(p_viewer_id::text,p_candidate_id::text),0));
  if p_mode not in ('nearby','ble') or not public.eligible_pair(p_viewer_id,p_candidate_id,p_mode)
    or not exists (select 1 from public.profile_previews where user_id=p_viewer_id and enabled)
    or not exists (select 1 from public.profile_previews where user_id=p_candidate_id and enabled) then
    return null;
  end if;
  if p_mode='nearby' and not exists (
    select 1 from public.profiles v, public.profiles c, public.presence vp, public.presence cp
    where v.user_id=p_viewer_id and c.user_id=p_candidate_id
      and vp.user_id=v.user_id and cp.user_id=c.user_id
      and vp.expires_at>now() and cp.expires_at>now()
      and extensions.st_dwithin(vp.location,cp.location,
        least(coalesce((v.settings->>'discovery_radius_m')::double precision,3218.688),
              coalesce((c.settings->>'discovery_radius_m')::double precision,3218.688)))) then
    return null;
  end if;
  if p_mode='ble' and not exists (
    select 1 from public.encounters e
      join public.phone_ble_sessions s on s.session_id=e.observed_session_id
    where ((e.observer_user_id=p_viewer_id and e.observed_user_id=p_candidate_id)
      or (e.observer_user_id=p_candidate_id and e.observed_user_id=p_viewer_id))
      and e.observed_at>now()-interval '2 minutes' and e.observed_at<=now()
      and s.revoked_at is null and s.expires_at>now()) then
    return null;
  end if;

  -- An explicit decline/revocation or an accepted connection for these profile
  -- versions must never be silently recreated by a background discovery poll.
  if exists (
    select 1 from public.connection_requests x
    where ((x.requester_user_id=p_viewer_id and x.recipient_user_id=p_candidate_id)
      or (x.requester_user_id=p_candidate_id and x.recipient_user_id=p_viewer_id))
      and x.requester_profile_version_id=(select current_profile_version_id from public.profiles where user_id=x.requester_user_id)
      and x.recipient_profile_version_id=(select current_profile_version_id from public.profiles where user_id=x.recipient_user_id)
      and (x.requester_decision in ('decline','revoke') or x.recipient_decision in ('decline','revoke')
        or (x.requester_decision='accept' and x.recipient_decision='accept'))
  ) then return null; end if;

  select * into r from public.connection_requests x
    where x.expires_at>now()
      and x.requester_decision in ('pending','accept') and x.recipient_decision in ('pending','accept')
      and ((x.requester_user_id=p_viewer_id and x.recipient_user_id=p_candidate_id)
        or (x.requester_user_id=p_candidate_id and x.recipient_user_id=p_viewer_id))
      and x.requester_profile_version_id=(select current_profile_version_id from public.profiles where user_id=x.requester_user_id)
      and x.recipient_profile_version_id=(select current_profile_version_id from public.profiles where user_id=x.recipient_user_id)
    order by x.created_at desc limit 1;
  if found then return r; end if;

  insert into public.connection_requests(
    requester_user_id,recipient_user_id,requester_profile_version_id,recipient_profile_version_id,
    requester_decision,recipient_decision,expires_at)
  select p_viewer_id,p_candidate_id,v.current_profile_version_id,c.current_profile_version_id,
    'pending','pending',now()+make_interval(secs=>least(greatest(p_lifetime_seconds,60),86400))
    from public.profiles v,public.profiles c
    where v.user_id=p_viewer_id and c.user_id=p_candidate_id returning * into r;
  return r;
end;
$$;
revoke all on function public.suggest_connection_pair(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.suggest_connection_pair(uuid,uuid,integer,text) to service_role;
notify pgrst, 'reload schema';
