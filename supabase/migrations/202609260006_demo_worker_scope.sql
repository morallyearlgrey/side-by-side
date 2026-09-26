-- Capability-scoped Newton access. No service-role key or global queue access.
create table public.demo_worker_scopes (
  scope_id uuid primary key default gen_random_uuid(),
  token_hash text unique not null check (token_hash ~ '^[0-9a-f]{64}$'),
  demo_run_id text not null,
  user_a uuid not null references public.profiles(user_id) on delete cascade,
  version_a uuid not null references public.profile_versions(profile_version_id) on delete cascade,
  user_b uuid not null references public.profiles(user_id) on delete cascade,
  version_b uuid not null references public.profile_versions(profile_version_id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  heartbeat_at timestamptz,
  heartbeat_expires_at timestamptz,
  status text not null default 'unavailable' check (status in ('ready','unavailable')),
  reason text not null default 'worker_not_connected',
  provenance jsonb not null default '{}'::jsonb,
  check (user_a<>user_b and version_a<>version_b)
);
alter table public.demo_worker_scopes enable row level security;
revoke all on public.demo_worker_scopes from public,anon,authenticated;
grant all on public.demo_worker_scopes to service_role;

create function public.demo_scope_valid(s public.demo_worker_scopes)
returns boolean language sql stable security definer set search_path='' as $$
  select s.revoked_at is null and s.expires_at>now()
    and (select count(*)=2 from (values(s.user_a,s.version_a),(s.user_b,s.version_b)) v(uid,vid)
      join auth.users u on u.id=v.uid
      join public.profiles p on p.user_id=v.uid and p.current_profile_version_id=v.vid
      join public.profile_versions pv on pv.user_id=v.uid and pv.profile_version_id=v.vid
      where u.raw_app_meta_data @> jsonb_build_object('sidebyside_demo',true,'data_origin','synthetic','demo_run_id',s.demo_run_id)
        and public.matching_consent(v.uid));
$$;

create function public.demo_worker_auth(p_token text)
returns public.demo_worker_scopes language plpgsql security definer set search_path='' as $$
declare s public.demo_worker_scopes;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid demo capability' using errcode='42501'; end if;
  select * into s from public.demo_worker_scopes where token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
  if s.scope_id is null or not public.demo_scope_valid(s) then
    raise exception 'Expired or invalid demo scope' using errcode='42501';
  end if;
  return s;
end;
$$;

create function public.demo_job_in_scope(j public.matching_jobs,s public.demo_worker_scopes)
returns boolean language sql immutable set search_path='' as $$
  select public.matching_v4_identity(j.model_id,j.model_revision,j.pipeline_version,j.policy,j.policy_sha256)
    and ((j.viewer_id=s.user_a and j.viewer_version_id=s.version_a and j.candidate_id=s.user_b and j.candidate_version_id=s.version_b)
      or (j.viewer_id=s.user_b and j.viewer_version_id=s.version_b and j.candidate_id=s.user_a and j.candidate_version_id=s.version_a));
$$;

create function public.demo_worker_heartbeat(p_token text,p_ready boolean,p_provenance jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.demo_worker_scopes;
begin
  s:=public.demo_worker_auth(p_token);
  if p_ready is null or not public.matching_v4_provenance(p_provenance) then
    raise exception 'Pinned model provenance required' using errcode='22023';
  end if;
  update public.demo_worker_scopes set heartbeat_at=now(),heartbeat_expires_at=least(now()+interval '90 seconds',expires_at),
    status=case when p_ready then 'ready' else 'unavailable' end,
    reason=case when p_ready then '' else 'demo_worker_unavailable' end,provenance=p_provenance where scope_id=s.scope_id;
  return true;
end;
$$;

create function public.demo_worker_claim(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.demo_worker_scopes; j public.matching_jobs; v jsonb; c jsonb;
begin
  s:=public.demo_worker_auth(p_token);
  if s.status<>'ready' or s.heartbeat_expires_at is null or s.heartbeat_expires_at<=now() then return null; end if;
  -- Every mutation, lease, and payload is filtered BEFORE touching the shared queue.
  update public.matching_jobs q set status='failed',error='retry_limit',lease_token=null,lease_expires_at=null,updated_at=now()
    where public.demo_job_in_scope(q,s) and q.attempts>=5 and q.status='running' and q.lease_expires_at<=now();
  select * into j from public.matching_jobs q where public.demo_job_in_scope(q,s)
    and q.attempts<5 and ((q.status='pending' and q.next_attempt_at<=now()) or (q.status='running' and q.lease_expires_at<=now()))
    and public.eligible_pair(q.viewer_id,q.candidate_id,q.mode)
    order by q.next_attempt_at,q.job_id for update skip locked limit 1;
  if j.job_id is null then return null; end if;
  update public.matching_jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),
    lease_expires_at=least(now()+interval '10 minutes',s.expires_at),updated_at=now()
    where job_id=j.job_id returning * into j;
  select to_jsonb(pv) into v from public.profile_versions pv where pv.user_id=j.viewer_id and pv.profile_version_id=j.viewer_version_id;
  select to_jsonb(pv) into c from public.profile_versions pv where pv.user_id=j.candidate_id and pv.profile_version_id=j.candidate_version_id;
  return jsonb_build_object('scope_id',s.scope_id,'job',to_jsonb(j),'viewer',v,'candidate',c);
end;
$$;

create function public.demo_worker_publish(p_token text,p_job_id uuid,p_lease_token uuid,p_result jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.demo_worker_scopes; j public.matching_jobs;
begin
  s:=public.demo_worker_auth(p_token);
  select * into j from public.matching_jobs where job_id=p_job_id and lease_token=p_lease_token and status='running'
    and lease_expires_at>now() for update;
  if j.job_id is null or not public.demo_job_in_scope(j,s) then return false; end if;
  return public.publish_matching_result(p_job_id,p_lease_token,p_result,300);
end;
$$;

create function public.demo_worker_fail(p_token text,p_job_id uuid,p_lease_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.demo_worker_scopes; j public.matching_jobs;
begin
  s:=public.demo_worker_auth(p_token);
  select * into j from public.matching_jobs where job_id=p_job_id and lease_token=p_lease_token and status='running'
    and lease_expires_at>now() for update;
  if j.job_id is null or not public.demo_job_in_scope(j,s) then return false; end if;
  return public.fail_matching_job(p_job_id,p_lease_token,'demo_processing_failed',30);
end;
$$;

-- Only the backend may ask for readiness, and only for the caller's current profile.
create function public.demo_worker_readiness(p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('status',s.status,'reason',s.reason,'scope','fictional_demo_only',
    'expires_at',s.heartbeat_expires_at) from public.demo_worker_scopes s
    where p_user_id in(s.user_a,s.user_b) and public.demo_scope_valid(s)
      and s.heartbeat_expires_at>now() and public.matching_v4_provenance(s.provenance)
    order by (s.status='ready') desc,s.heartbeat_at desc limit 1;
$$;

revoke all on function public.demo_scope_valid(public.demo_worker_scopes), public.demo_worker_auth(text),
  public.demo_job_in_scope(public.matching_jobs,public.demo_worker_scopes),
  public.demo_worker_readiness(uuid), public.demo_worker_heartbeat(text,boolean,jsonb),
  public.demo_worker_claim(text), public.demo_worker_publish(text,uuid,uuid,jsonb), public.demo_worker_fail(text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.demo_worker_readiness(uuid),public.demo_scope_valid(public.demo_worker_scopes) to service_role;
grant execute on function public.demo_worker_heartbeat(text,boolean,jsonb),public.demo_worker_claim(text),
  public.demo_worker_publish(text,uuid,uuid,jsonb),public.demo_worker_fail(text,uuid,uuid) to anon,authenticated,service_role;
