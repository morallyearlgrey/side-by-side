-- Forward-only upgrade. Existing snapshots and their missing requests stay unchanged.
-- v4 is an onboarding-only integration of the frozen research evidence policy.
alter table public.profile_versions add column conversation_request jsonb;

create function public.validate_conversation_request() returns trigger language plpgsql set search_path='' as $$
declare r jsonb := new.conversation_request; e jsonb;
begin
  if r is null then return new; end if;
  if jsonb_typeof(r) is distinct from 'object' or not (r ?& array['mode','goal','evidence_requirement'])
    or (r - array['mode','goal','evidence_requirement']) <> '{}'::jsonb
    or coalesce(r->>'mode','') not in ('learn','share','exchange_stories','collaborate','find_activity_partner','casual_chat')
    or jsonb_typeof(r->'goal') is distinct from 'string' or length(r->>'goal')>2000
    then raise exception 'Invalid conversation request'; end if;
  if r->>'goal' is distinct from coalesce(new.current_goal,'') then raise exception 'Request goal must match profile goal'; end if;
  e:=r->'evidence_requirement';
  if jsonb_typeof(e) is distinct from 'object' or not (e ?& array['version','kind','subject','claim','confirmation'])
    or (e-array['version','kind','subject','claim','confirmation']) <> '{}'::jsonb
    or e->'version' is distinct from '1'::jsonb
    or coalesce(e->>'kind','') not in ('none','firsthand','unresolved')
    or coalesce(e->>'confirmation','') not in ('confirmed','pending')
    or jsonb_typeof(e->'subject') not in ('string','null')
    or (e->>'subject' is not null and e->>'subject' not in ('viewer','candidate','both'))
    or jsonb_typeof(e->'claim') not in ('string','null') or length(e->>'claim')>2000
    or (e->>'kind'<>'firsthand' and (e->>'subject' is not null or e->>'claim' is not null))
    or (e->>'kind'='unresolved' and e->>'confirmation'='confirmed')
    then raise exception 'Invalid evidence requirement'; end if;
  if e->>'confirmation'='confirmed' then
    if length(trim(r->>'goal'))=0 then raise exception 'Confirmed request needs a goal'; end if;
    if e->>'kind'='firsthand' and (e->>'subject' is null or coalesce(length(trim(e->>'claim')),0)=0
      or (r->>'mode'='learn' and e->>'subject' not in ('candidate','both'))
      or (r->>'mode'='share' and e->>'subject' not in ('viewer','both')))
      then raise exception 'Confirmed firsthand request needs a compatible subject and claim'; end if;
  end if;
  return new;
end;
$$;
create trigger validate_conversation_request before insert on public.profile_versions
  for each row execute function public.validate_conversation_request();
revoke all on function public.validate_conversation_request() from public,anon,authenticated;
grant execute on function public.validate_conversation_request() to service_role;

create or replace function public.validate_profile_version() returns trigger language plpgsql set search_path = '' as $$
declare a jsonb; f jsonb; e jsonb; source_answer public.onboarding_answers; ids text[] := '{}';
begin
  if new.valid_from > clock_timestamp() + interval '5 seconds' then raise exception 'Future profile version'; end if;
  if new.current_goal is not null and length(trim(new.current_goal))=0 then raise exception 'Empty goal'; end if;
  if exists(select 1 from unnest(new.open_to_discussing || new.conversation_preferences || new.avoid_topics) s where s is null or length(trim(s))=0)
    then raise exception 'Invalid profile string array'; end if;
  for a in select value from jsonb_array_elements(new.onboarding_answers) loop
    if a->>'answer_id'=any(ids) then raise exception 'Duplicate answer snapshot'; end if;
    ids:=array_append(ids,a->>'answer_id');
    select * into source_answer from public.onboarding_answers
      where answer_id = (a->>'answer_id')::uuid and user_id = new.user_id and session_id = new.onboarding_session_id;
    if not found or source_answer.answered_at > new.valid_from or a is distinct from
      (jsonb_build_object('answer_id',source_answer.answer_id,'question_key',source_answer.question_key,
        'question_text',source_answer.question_text,'answer_text',source_answer.answer_text,'answered_at',source_answer.answered_at)
        || case when a ? 'user_id' then jsonb_build_object('user_id',source_answer.user_id) else '{}'::jsonb end)
      then raise exception 'Answer snapshot must match an existing owned source and timestamp'; end if;
  end loop;
  ids:='{}';
  for f in select value from jsonb_array_elements(new.facts) loop
    if jsonb_typeof(f) <> 'object' or not (f ?& array['fact_id','topic','relationship','details','motivation','evidence','confirmation','matching_allowed','sharing_scope'])
      or (f - array['fact_id','topic','relationship','details','motivation','evidence','confirmation','matching_allowed','sharing_scope']) <> '{}'::jsonb
      or jsonb_typeof(f->'fact_id') <> 'string' or length(trim(f->>'fact_id')) = 0
      or f->>'fact_id' = any(ids)
      or jsonb_typeof(f->'topic') <> 'string' or length(trim(f->>'topic')) = 0
      or jsonb_typeof(f->'details') <> 'string' or length(trim(f->>'details')) = 0
      or jsonb_typeof(f->'relationship') <> 'string' or f->>'relationship' not in ('interested','experienced','wants_to_try','learning','can_share')
      or jsonb_typeof(f->'motivation') not in ('string','null')
      or (jsonb_typeof(f->'motivation') = 'string' and length(trim(f->>'motivation')) = 0)
      or jsonb_typeof(f->'confirmation') <> 'string' or f->>'confirmation' not in ('confirmed','pending','rejected')
      or jsonb_typeof(f->'matching_allowed') <> 'boolean'
      or jsonb_typeof(f->'sharing_scope') <> 'string' or f->>'sharing_scope' not in ('matching_only','after_mutual_consent')
      or ((f->>'matching_allowed')::boolean and f->>'confirmation' <> 'confirmed')
      or (f->>'sharing_scope' = 'after_mutual_consent' and (f->>'confirmation' <> 'confirmed' or not (f->>'matching_allowed')::boolean))
      or jsonb_typeof(f->'evidence') <> 'array' or jsonb_array_length(f->'evidence') = 0
      then raise exception 'Invalid fact contract'; end if;
    ids := array_append(ids,f->>'fact_id');
    for e in select value from jsonb_array_elements(f->'evidence') loop
      if jsonb_typeof(e) <> 'object' or not (e ?& array['source_type','reference_id','channel','support'])
        or (e - array['source_type','reference_id','channel','support']) <> '{}'::jsonb
        or e->>'source_type' is distinct from 'onboarding_answer' or e->>'channel' is distinct from 'self_report'
        or jsonb_typeof(e->'reference_id') <> 'string' or length(trim(e->>'reference_id'))=0
        or jsonb_typeof(e->'support') <> 'string' or length(trim(e->>'support')) = 0
        then raise exception 'Only grounded onboarding evidence is supported by runtime v1'; end if;
      if not exists (select 1 from jsonb_array_elements(new.onboarding_answers) answer
        where answer->>'answer_id' = e->>'reference_id' and strpos(answer->>'answer_text', e->>'support') > 0)
        then raise exception 'Evidence must quote an owned answer included in the snapshot'; end if;
    end loop;
  end loop;
  return new;
end;
$$;

create or replace function public.publish_profile(p_user_id uuid,p_session_id uuid,p_profile jsonb,
  p_preview jsonb default '{}',p_settings jsonb default '{}')
returns public.profile_versions language plpgsql security definer set search_path = '' as $$
declare v public.profile_versions; answers jsonb;
begin
  perform 1 from public.profiles where user_id=p_user_id for update;
  perform 1 from public.onboarding_sessions where session_id=p_session_id and user_id=p_user_id for update;
  if not found then raise exception 'Session does not belong to user'; end if;
  if (coalesce((p_settings->>'discoverable')::boolean,false) or coalesce((p_settings->>'bluetooth_enabled')::boolean,false))
    and not public.matching_consent(p_user_id) then raise exception 'Discovery requires personal matching consent'; end if;
  if nullif(p_profile->'conversation_request','null'::jsonb) is not null and
    p_profile#>>'{conversation_request,mode}' is distinct from coalesce(p_settings->>'matching_context',
      (select settings->>'matching_context' from public.profiles where user_id=p_user_id),'casual_chat')
    then raise exception 'Request mode must match current matching context'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('answer_id',a.answer_id,'user_id',a.user_id,'question_key',a.question_key,
    'question_text',a.question_text,'answer_text',a.answer_text,'answered_at',a.answered_at) order by a.answered_at,a.answer_id),'[]') into answers
    from public.onboarding_answers a where a.user_id=p_user_id and a.session_id=p_session_id
      and (not (p_profile ? 'answer_ids') or p_profile->'answer_ids' ? a.answer_id::text);
  insert into public.profile_versions(user_id,onboarding_session_id,data_origin,onboarding_answers,current_goal,conversation_intent,facts,
    open_to_discussing,conversation_preferences,avoid_topics,conversation_request)
    values(p_user_id,p_session_id,'real_opt_in',answers,p_profile->>'current_goal',p_profile->>'conversation_intent',coalesce(p_profile->'facts','[]'),
      array(select jsonb_array_elements_text(coalesce(p_profile->'open_to_discussing','[]'))),
      array(select jsonb_array_elements_text(coalesce(p_profile->'conversation_preferences','[]'))),
      array(select jsonb_array_elements_text(coalesce(p_profile->'avoid_topics','[]'))),nullif(p_profile->'conversation_request','null'::jsonb)) returning * into v;
  update public.profiles set current_profile_version_id=v.profile_version_id,settings=settings || p_settings,
    display_name=coalesce(p_settings->>'display_name',display_name),
    discoverable=coalesce((p_settings->>'discoverable')::boolean,discoverable),
    bluetooth_enabled=coalesce((p_settings->>'bluetooth_enabled')::boolean,bluetooth_enabled),
    available=coalesce((p_settings->>'available')::boolean,available),updated_at=now() where user_id=p_user_id;
  if p_preview <> '{}'::jsonb then
    insert into public.profile_previews(user_id,enabled,preview) values(p_user_id,coalesce((p_preview->>'enabled')::boolean,false),p_preview-'enabled')
      on conflict(user_id) do update set enabled=excluded.enabled,preview=excluded.preview,updated_at=now();
  end if;
  update public.onboarding_sessions set status='completed',completed_at=now(),revision=revision+1 where session_id=p_session_id;
  return v;
end;
$$;


-- No legacy job or score is relabeled as v4. Only new work gets the frozen hash.
insert into public.matching_policies(policy_version) values ('onboarding-evidence-v4');
alter table public.matching_jobs add column policy_sha256 text check (policy_sha256 ~ '^[0-9a-f]{64}$');
alter table public.match_scores add column policy_sha256 text check (policy_sha256 ~ '^[0-9a-f]{64}$');
alter table public.model_worker_heartbeats
  add column policy text,
  add column policy_sha256 text check (policy_sha256 ~ '^[0-9a-f]{64}$'),
  add column provenance jsonb not null default '{}' check (jsonb_typeof(provenance)='object');
alter table public.match_snapshots
  add column pipeline_version text,
  add column policy text,
  add column policy_sha256 text check (policy_sha256 ~ '^[0-9a-f]{64}$'),
  add column model_id text,
  add column model_revision text,
  add column counts jsonb not null default '{}' check (jsonb_typeof(counts)='object');

create function public.matching_v4_identity(model_id text,model_revision text,pipeline text,policy text,policy_hash text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(model_id='Qwen/Qwen3-Reranker-4B'
    and model_revision='22e683669bc0f0bd69640a1354a6d0aebcfeede5'
    and pipeline='online-approved-onboarding-evidence-v4'
    and policy='onboarding-evidence-v4'
    and policy_hash='b1e4b4ef1c58f17007400f5064ef97b12d19489d1a78698ca177e2792080bf57',false);
$$;
create function public.matching_v4_provenance(value jsonb) returns boolean language sql immutable set search_path='' as $$
  select public.matching_v4_identity(value->>'model_id',value->>'model_revision',value->>'pipeline_version',value->>'policy',value->>'policy_sha256')
    and coalesce(value->>'format_encoder_id'='sentence-transformers/all-MiniLM-L6-v2'
      and value->>'format_encoder_revision'='1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
      and value->>'evidence_model_id'='MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli'
      and value->>'evidence_model_revision'='eb8b17b1983bca679126ea69b12b5d28c5fe9b9a'
      and value->>'prompt_version'='source-aware-relevance-sufficiency-v4'
      and value->>'feature_version'='onboarding-format-evidence-v4',false);
$$;
revoke all on function public.matching_v4_identity(text,text,text,text,text),public.matching_v4_provenance(jsonb) from public,anon,authenticated;
grant execute on function public.matching_v4_identity(text,text,text,text,text),public.matching_v4_provenance(jsonb) to service_role;

alter table public.matching_jobs add constraint matching_jobs_v4_identity check
  (pipeline_version<>'online-approved-onboarding-evidence-v4' or public.matching_v4_identity(model_id,model_revision,pipeline_version,policy,policy_sha256));
alter table public.model_worker_heartbeats add constraint model_worker_v4_identity check
  (pipeline_version<>'online-approved-onboarding-evidence-v4' or
    (public.matching_v4_identity(model_id,model_revision,pipeline_version,policy,policy_sha256) and public.matching_v4_provenance(provenance)));
alter table public.match_snapshots add constraint snapshots_v4_identity check
  (pipeline_version is distinct from 'online-approved-onboarding-evidence-v4' or public.matching_v4_identity(model_id,model_revision,pipeline_version,policy,policy_sha256));

-- Replace only status-dependent constraints; preserve ownership, ranges and FKs.
do $$
declare constraint_name text;
begin
  for constraint_name in select conname from pg_constraint where conrelid='public.match_scores'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%status%' loop
    execute format('alter table public.match_scores drop constraint %I',constraint_name);
  end loop;
end;
$$;
alter table public.match_scores add constraint match_scores_outcome_contract check (
  (pipeline_version<>'online-approved-onboarding-evidence-v4' and status in ('scored','abstained','unavailable') and
    ((status='scored' and final_score is not null and onboarding_score is not null
      and applied_onboarding_weight is not distinct from 1 and applied_instagram_weight is not distinct from 0 and instagram_score is null)
      or (status<>'scored' and final_score is null and applied_onboarding_weight is null and applied_instagram_weight is null)))
  or (public.matching_v4_identity(model_id,model_revision,pipeline_version,policy,policy_sha256)
    and public.matching_v4_provenance(result) and instagram_score is null
    and ((status in ('recommend','not_recommended') and final_score is not null and onboarding_score is not distinct from final_score
      and applied_onboarding_weight is not distinct from 1 and applied_instagram_weight is not distinct from 0)
      or (status in ('insufficient_evidence','unavailable') and final_score is null and onboarding_score is null
        and applied_onboarding_weight is null and applied_instagram_weight is null)))
);

create or replace function public.publish_matching_result(p_job_id uuid,p_lease_token uuid,p_result jsonb,p_ttl_seconds integer default 300)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.matching_jobs; result_status text; score double precision;
begin
  select * into j from public.matching_jobs where job_id=p_job_id and status='running'
    and lease_token=p_lease_token and lease_expires_at>now() for update;
  if not found then return false; end if;
  if not public.matching_v4_identity(j.model_id,j.model_revision,j.pipeline_version,j.policy,j.policy_sha256)
    or not public.eligible_pair(j.viewer_id,j.candidate_id,j.mode)
    or j.viewer_version_id is distinct from (select current_profile_version_id from public.profiles where user_id=j.viewer_id)
    or j.candidate_version_id is distinct from (select current_profile_version_id from public.profiles where user_id=j.candidate_id)
    then update public.matching_jobs set status='cancelled',lease_token=null,lease_expires_at=null,updated_at=now() where job_id=j.job_id;
      return false; end if;
  if not public.matching_v4_provenance(p_result) then raise exception 'Result provenance differs from frozen v4 policy'; end if;
  result_status:=p_result->>'status';
  if result_status is null or result_status not in ('recommend','not_recommended','insufficient_evidence','unavailable')
    then raise exception 'Invalid v4 outcome'; end if;
  score:=coalesce(p_result->>'final_score',p_result->>'score')::double precision;
  if (p_result ? 'score' and (p_result->>'score')::double precision is distinct from score)
    or (p_result ? 'final_score' and (p_result->>'final_score')::double precision is distinct from score)
    or (result_status in ('recommend','not_recommended') and (score is null or not(score between 0 and 1)
      or p_result->'onboarding_weight' is distinct from '1.0'::jsonb or p_result->'instagram_weight' is distinct from '0.0'::jsonb))
    or (result_status in ('insufficient_evidence','unavailable') and (score is not null
      or p_result->>'onboarding_weight' is not null or p_result->>'instagram_weight' is not null))
    then raise exception 'Invalid v4 score or weights'; end if;
  insert into public.match_scores(job_id,viewer_id,candidate_id,viewer_profile_version_id,candidate_profile_version_id,context,history_cutoff_at,
    model_id,model_revision,pipeline_version,policy,policy_sha256,status,final_score,onboarding_score,applied_onboarding_weight,applied_instagram_weight,reason,result,expires_at)
    values(j.job_id,j.viewer_id,j.candidate_id,j.viewer_version_id,j.candidate_version_id,j.context,j.history_cutoff_at,
      j.model_id,j.model_revision,j.pipeline_version,j.policy,j.policy_sha256,result_status,score,score,
      case when result_status in ('recommend','not_recommended') then 1 end,
      case when result_status in ('recommend','not_recommended') then 0 end,p_result->>'reason',p_result,
      now()+make_interval(secs=>least(greatest(p_ttl_seconds,1),600)))
    on conflict(job_id) do update set status=excluded.status,final_score=excluded.final_score,onboarding_score=excluded.onboarding_score,
      applied_onboarding_weight=excluded.applied_onboarding_weight,applied_instagram_weight=excluded.applied_instagram_weight,
      reason=excluded.reason,result=excluded.result,scored_at=now(),expires_at=excluded.expires_at;
  update public.matching_jobs set status='succeeded',result=p_result,lease_token=null,lease_expires_at=null,updated_at=now() where job_id=j.job_id;
  delete from public.match_snapshots where viewer_id=j.viewer_id;
  return true;
end;
$$;
