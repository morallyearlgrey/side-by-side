-- Mutual, self-reported discovery preference. Older profiles default to
-- undisclosed identity and no restriction; gender never enters model prompts.
create or replace function public.eligible_pair(p_viewer_id uuid,p_candidate_id uuid,p_mode text default 'nearby')
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select
    v.user_id <> c.user_id and v.available and c.available
    and v.current_profile_version_id is not null and c.current_profile_version_id is not null
    and public.matching_consent(v.user_id) and public.matching_consent(c.user_id)
    and not exists(select 1 from public.user_blocks b where
      (b.blocker_user_id=v.user_id and b.blocked_user_id=c.user_id) or (b.blocker_user_id=c.user_id and b.blocked_user_id=v.user_id))
    and (coalesce(v.settings#>'{hard_filters,conversation_intents}','[]'::jsonb) = '[]'::jsonb
      or (v.settings#>'{hard_filters,conversation_intents}') ? coalesce(c.settings->>'matching_context','casual_chat'))
    and (coalesce(c.settings#>'{hard_filters,conversation_intents}','[]'::jsonb) = '[]'::jsonb
      or (c.settings#>'{hard_filters,conversation_intents}') ? coalesce(v.settings->>'matching_context','casual_chat'))
    and (coalesce(v.settings->'gender_preferences','[]'::jsonb) = '[]'::jsonb
      or (v.settings->'gender_preferences') ? coalesce(c.settings->>'gender_identity','undisclosed'))
    and (coalesce(c.settings->'gender_preferences','[]'::jsonb) = '[]'::jsonb
      or (c.settings->'gender_preferences') ? coalesce(v.settings->>'gender_identity','undisclosed'))
    and case p_mode
      when 'nearby' then v.discoverable and c.discoverable and exists (
        select 1 from public.presence vp,public.presence cp where vp.user_id=v.user_id and cp.user_id=c.user_id
          and vp.expires_at > now() and cp.expires_at > now()
          and vp.observed_at <= now() + interval '5 seconds' and cp.observed_at <= now() + interval '5 seconds'
          and extensions.st_dwithin(vp.location,cp.location,3218.688))
      when 'ble' then v.bluetooth_enabled and c.bluetooth_enabled
        and exists(select 1 from public.phone_ble_sessions s where s.user_id=v.user_id and s.revoked_at is null and s.issued_at<=now() and s.expires_at>now())
        and exists(select 1 from public.phone_ble_sessions s where s.user_id=c.user_id and s.revoked_at is null and s.issued_at<=now() and s.expires_at>now())
      when 'connection' then true
      else false end
    from public.profiles v join public.profile_versions vv on vv.profile_version_id=v.current_profile_version_id
      cross join public.profiles c join public.profile_versions cv on cv.profile_version_id=c.current_profile_version_id
    where v.user_id=p_viewer_id and c.user_id=p_candidate_id),false);
$$;
