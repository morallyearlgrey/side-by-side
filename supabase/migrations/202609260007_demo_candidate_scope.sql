-- The demo API must not advertise support for out-of-scope candidate pairs.
create function public.demo_worker_pair_supported(p_viewer_id uuid,p_candidate_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.demo_worker_scopes s where public.demo_scope_valid(s)
    and ((s.user_a=p_viewer_id and s.user_b=p_candidate_id) or (s.user_b=p_viewer_id and s.user_a=p_candidate_id)));
$$;
create function public.demo_worker_candidates(p_viewer_id uuid)
returns table(user_id uuid,profile_version_id uuid,distance_m double precision,preview jsonb)
language sql stable security definer set search_path='' as $$
  select c.* from public.nearby_candidates(p_viewer_id) c
    where public.demo_worker_pair_supported(p_viewer_id,c.user_id);
$$;
revoke all on function public.demo_worker_pair_supported(uuid,uuid),public.demo_worker_candidates(uuid) from public,anon,authenticated;
grant execute on function public.demo_worker_pair_supported(uuid,uuid),public.demo_worker_candidates(uuid) to service_role;
