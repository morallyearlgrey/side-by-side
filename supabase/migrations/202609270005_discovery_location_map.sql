-- Map areas are deliberately coarse; exact presence coordinates stay private.
-- A fixed grid prevents repeated polls from averaging random noise away.
create function public.discovery_coarse_area(
  p_latitude double precision, p_longitude double precision, p_accuracy double precision,
  p_observed_at timestamptz, p_expires_at timestamptz
) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'latitude', greatest(-89.9985,least(89.9985,round((floor(p_latitude / 0.003) * 0.003 + 0.0015)::numeric,4))),
    'longitude', greatest(-179.9985,least(179.9985,round((floor(p_longitude / 0.003) * 0.003 + 0.0015)::numeric,4))),
    'uncertainty_m', ceil((240 + p_accuracy) / 50) * 50,
    'observed_at', p_observed_at, 'expires_at', p_expires_at);
$$;

create function public.discovery_location_map(p_viewer_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  viewer public.profiles; own_area jsonb; own_expiry timestamptz;
  own_preview boolean; estimates jsonb; valid_until timestamptz;
begin
  select * into viewer from public.profiles where user_id=p_viewer_id;
  select exists(select 1 from public.profile_previews where user_id=p_viewer_id and enabled) into own_preview;
  if viewer.user_id is null or not viewer.available or viewer.current_profile_version_id is null
    or not own_preview or not public.matching_consent(p_viewer_id)
    or not (viewer.discoverable or viewer.bluetooth_enabled) then
    return jsonb_build_object('status','off','me',null,'items','[]'::jsonb,
      'valid_until',null,'refresh_after_seconds',15);
  end if;
  -- A remembered point is not permission to reveal location after opting out.
  if viewer.discoverable then
    select public.discovery_coarse_area(latitude,longitude,accuracy_m,observed_at,
      least(expires_at,observed_at+interval '5 minutes')),
      least(expires_at,observed_at+interval '5 minutes') into own_area,own_expiry
    from public.presence where user_id=p_viewer_id and expires_at>now()
      and observed_at>now()-interval '5 minutes' and observed_at<=now()+interval '5 seconds'
      and accuracy_m between 0 and 250;
  end if;

  with gps as (
    select c.user_id,c.preview->>'display_name' as display_name,'location'::text as source,
      public.discovery_coarse_area(p.latitude,p.longitude,p.accuracy_m,p.observed_at,
        least(p.expires_at,p.observed_at+interval '5 minutes')) as area,
      p.observed_at,least(p.expires_at,p.observed_at+interval '5 minutes') as expires_at,
      null::text as proximity,0 as priority
    from public.nearby_candidates(p_viewer_id,
      coalesce((viewer.settings->>'discovery_radius_m')::double precision,3218.688)) c
    join public.presence p on p.user_id=c.user_id
    where own_area is not null and p.accuracy_m between 0 and 250
      and p.observed_at>now()-interval '5 minutes' and p.observed_at<=now()+interval '5 seconds'
      and p.expires_at>now()
  ), radio as (
    select distinct on(e.observed_user_id) e.observed_user_id as user_id,
      pr.preview->>'display_name' as display_name,'bluetooth'::text as source,
      case when own_area is null then null else own_area || jsonb_build_object(
        'uncertainty_m',(own_area->>'uncertainty_m')::numeric +
          case when e.rssi>=-55 then 30 when e.rssi>=-75 then 100 else 250 end,
        'observed_at',e.observed_at,
        'expires_at',least(own_expiry,e.observed_at+interval '2 minutes',s.expires_at,vs.expires_at)) end as area,
      e.observed_at,
      least(e.observed_at+interval '2 minutes',s.expires_at,vs.expires_at,
        coalesce(own_expiry,e.observed_at+interval '2 minutes')) as expires_at,
      case when e.rssi>=-55 then 'close' when e.rssi>=-75 then 'nearby' else 'uncertain' end as proximity,
      1 as priority
    from public.encounters e
    join public.phone_ble_sessions s on s.session_id=e.observed_session_id and s.user_id=e.observed_user_id
    join public.phone_ble_sessions vs on vs.user_id=p_viewer_id
    join public.profile_previews pr on pr.user_id=e.observed_user_id and pr.enabled
    where e.observer_user_id=p_viewer_id and e.observed_at>now()-interval '2 minutes'
      and e.observed_at<=now() and e.observed_at>=s.issued_at
      and s.revoked_at is null and s.expires_at>now()
      and vs.revoked_at is null and vs.issued_at<=now() and vs.expires_at>now()
      and public.eligible_pair(p_viewer_id,e.observed_user_id,'ble')
    order by e.observed_user_id,e.observed_at desc,vs.expires_at desc
  ), chosen as (
    select distinct on(user_id) user_id,display_name,source,area,observed_at,expires_at,proximity
      from (select * from gps union all select * from radio) combined
      order by user_id,priority,observed_at desc
    limit 50
  ) select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,
    'display_name',coalesce(nullif(display_name,''),'Nearby person'),'source',source,'area',area,
    'observed_at',observed_at,'expires_at',expires_at,'proximity',proximity) order by user_id),'[]'::jsonb),
    least(own_expiry,min(expires_at)) into estimates,valid_until from chosen;

  return jsonb_build_object('status',case when own_area is null then 'location_unavailable' else 'ready' end,
    'me',own_area,'items',estimates,'valid_until',valid_until,'refresh_after_seconds',15);
end;
$$;

revoke all on function public.discovery_coarse_area(double precision,double precision,double precision,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.discovery_location_map(uuid) from public,anon,authenticated;
grant execute on function public.discovery_coarse_area(double precision,double precision,double precision,timestamptz,timestamptz) to service_role;
grant execute on function public.discovery_location_map(uuid) to service_role;
