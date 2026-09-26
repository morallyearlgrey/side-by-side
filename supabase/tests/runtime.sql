-- Run inside an isolated transaction after migration and seed.sql.
-- tests/run.py always rolls back. Assertions fail psql with ON_ERROR_STOP.
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',message; end if; end;
$$;
create function pg_temp.expect_failure(statement text,message text) returns void language plpgsql as $$
declare failed boolean := false;
begin
  begin execute statement; exception when others then failed:=true; end;
  if not failed then raise exception 'EXPECTED FAILURE: %',message; end if;
end;
$$;

select pg_temp.assert_true((select count(*)=1 from public.nearby_candidates('10000000-0000-4000-8000-000000000001')),
  'PostGIS includes nearby and excludes far, expired, and self');
select pg_temp.assert_true((select user_id='10000000-0000-4000-8000-000000000002' and distance_m>700 and distance_m<900
  from public.nearby_candidates('10000000-0000-4000-8000-000000000001')), 'Correct physical distance');

-- Source ownership, timestamp preservation, append-only versions and facts.
select pg_temp.expect_failure($q$insert into public.onboarding_answers(session_id,user_id,question_key,question_text,answer_text)
  values('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','interests','test','test')$q$,'cross-owner answer');
select pg_temp.expect_failure($q$update public.onboarding_answers set answer_text='rewritten' where answer_id='30000000-0000-4000-8000-000000000001'$q$,'answers immutable');
select pg_temp.expect_failure($q$update public.profile_versions set current_goal='rewritten' where profile_version_id='40000000-0000-4000-8000-000000000001'$q$,'versions immutable');
select pg_temp.expect_failure($q$update public.matching_policies set onboarding_weight=0.7,instagram_weight=0.3 where policy_version='onboarding-only-v1'$q$,'policies immutable');
set constraints profiles_current_version_owner immediate;
select pg_temp.expect_failure($q$update public.profiles set current_profile_version_id='40000000-0000-4000-8000-000000000002'
  where user_id='10000000-0000-4000-8000-000000000001'$q$,'current version same owner');
set constraints profiles_current_version_owner deferred;
select pg_temp.expect_failure($q$select public.publish_profile('10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002','{}')$q$,'publishing foreign session');
select pg_temp.expect_failure($q$insert into public.profile_versions(user_id,onboarding_session_id,onboarding_answers,facts)
  select user_id,onboarding_session_id,onboarding_answers,jsonb_set(facts,'{0,evidence,0,support}','"fabricated quote"')
  from public.profile_versions limit 1$q$,'unsupported source excerpt');
select pg_temp.expect_failure($q$insert into public.profile_versions(user_id,onboarding_session_id,onboarding_answers,facts)
  select user_id,onboarding_session_id,onboarding_answers,jsonb_set(facts,'{0,relationship}','null')
  from public.profile_versions limit 1$q$,'JSON null cannot bypass fact enum');
select pg_temp.expect_failure($q$insert into public.profile_versions(user_id,onboarding_session_id,onboarding_answers,facts)
  select user_id,onboarding_session_id,onboarding_answers,jsonb_set(facts,'{0,evidence,0,source_type}','"owned_post"')
  from public.profile_versions limit 1$q$,'unsupported imported evidence rejected');
select pg_temp.expect_failure($q$insert into public.profile_versions(user_id,onboarding_session_id,onboarding_answers,facts)
  select user_id,onboarding_session_id,jsonb_set(onboarding_answers,'{0,answer_text}','"altered snapshot"'),facts
  from public.profile_versions limit 1$q$,'snapshot must equal original answer');
select pg_temp.expect_failure($q$update public.profile_previews set preview='{"facts":["private evidence"]}'$q$,
  'preview independent allowlist');

-- Reversed blocks, hard filters, and independent preview consent are hard gates.
insert into public.user_blocks(blocker_user_id,blocked_user_id) values
  ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');
select pg_temp.assert_true(not public.eligible_pair('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),'reverse block respected');
delete from public.user_blocks where blocker_user_id='10000000-0000-4000-8000-000000000002'
  and blocked_user_id='10000000-0000-4000-8000-000000000001';
update public.profiles set settings='{"hard_filters":{"conversation_intents":["collaborate"]}}' where user_id='10000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(not public.eligible_pair('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),'explicit hard filter respected');
update public.profiles set settings='{"matching_context":"collaborate"}' where user_id='10000000-0000-4000-8000-000000000002';
select pg_temp.assert_true(public.eligible_pair('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
  'hard filter compares selected context, not natural-language conversation intent');
update public.profiles set settings='{}' where user_id='10000000-0000-4000-8000-000000000001';
update public.profile_previews set enabled=false where user_id='10000000-0000-4000-8000-000000000002';
select pg_temp.assert_true((select count(*)=0 from public.nearby_candidates('10000000-0000-4000-8000-000000000001')),'no preview without opt-in');
update public.profile_previews set enabled=true where user_id='10000000-0000-4000-8000-000000000002';

-- A client cannot read another user's sources, grant consent, write scores,
-- change another person's decision, or call a privileged caller-ID RPC.
set local role authenticated;
set local "request.jwt.claim.sub"='10000000-0000-4000-8000-000000000001';
select pg_temp.assert_true((select count(*)=1 from public.profiles),'only own profile readable');
select pg_temp.assert_true((select count(*)=1 from public.onboarding_answers),'only own sources readable');
select pg_temp.assert_true((select count(*)=1 from public.profile_versions),'only own snapshots readable');
select pg_temp.expect_failure('select * from public.provider_connections','provider credentials inaccessible');
select pg_temp.expect_failure('select * from public.match_scores','raw scores inaccessible');
select pg_temp.expect_failure('select * from public.phone_ble_sessions','token registry inaccessible');
select pg_temp.expect_failure('select * from public.model_worker_heartbeats','worker readiness registry inaccessible');
select pg_temp.expect_failure('update public.profiles set discoverable=true','client cannot bypass authenticated backend mutations');
select pg_temp.expect_failure('update public.connection_requests set recipient_decision=''accept''','no decision columnwide writes');
select pg_temp.expect_failure($q$select public.publish_profile('10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002','{}')$q$,'service RPC cannot be called by authenticated role');
reset role;

insert into public.model_worker_heartbeats(model_id,model_revision,pipeline_version,status,expires_at)
  values('test-model','test-revision','test-pipeline','ready',now()+interval '2 minutes');
select pg_temp.expect_failure($q$insert into public.model_worker_heartbeats(model_id,model_revision,pipeline_version,status,expires_at)
  values('test-model','test-revision','test-pipeline','ready',now()+interval '6 minutes')$q$,'heartbeat lifetime bounded');
select pg_temp.expect_failure($q$insert into public.model_worker_heartbeats(model_id,model_revision,pipeline_version,status,updated_at,expires_at)
  values('test-model','test-revision','test-pipeline','ready',now()+interval '1 hour',now()+interval '62 minutes')$q$,'future worker clock cannot prolong readiness');

-- Request decisions belong to one participant; old versions no longer disclose.
do $$
declare r public.connection_requests; old_version uuid; v public.profile_versions;
begin
  r:=public.request_connection('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
  perform pg_temp.assert_true(r.requester_decision='accept' and r.recipient_decision='pending','requester consents only for self');
  r:=public.decide_connection('10000000-0000-4000-8000-000000000002',r.request_id,'accept');
  perform pg_temp.assert_true(r.requester_decision='accept' and r.recipient_decision='accept','mutual acceptance');
  perform pg_temp.expect_failure(format('select public.decide_connection(%L,%L,%L)',
    '10000000-0000-4000-8000-000000000003',r.request_id,'revoke'),'nonparticipant rejected');
  r:=public.decide_connection('10000000-0000-4000-8000-000000000002',r.request_id,'revoke');
  perform pg_temp.assert_true(r.requester_decision='accept' and r.recipient_decision='revoke','only own decision changed');
  perform pg_temp.expect_failure(format('select public.decide_connection(%L,%L,%L)',
    '10000000-0000-4000-8000-000000000001',r.request_id,'accept'),'revoke cannot be reversed by other actor');
end;
$$;

-- Real SQL worker claims, wrong leases, nullable scores and stale invalidation.
do $$
declare j public.matching_jobs; okay boolean;
begin
  insert into public.matching_jobs(identity_hash,viewer_id,candidate_id,viewer_version_id,candidate_version_id,context,
    history_version,model_id,model_revision,pipeline_version,policy)
    values('test-score','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','learn','none','test-model','test-revision','test-pipeline','onboarding-only-v1');
  select * into j from public.claim_matching_jobs(1,120);
  perform pg_temp.assert_true(j.status='running' and j.attempts=1,'job atomically leased');
  perform pg_temp.assert_true(not public.publish_matching_result(j.job_id,gen_random_uuid(),'{"status":"scored","score":0.9}'),'wrong lease rejected');
  perform pg_temp.expect_failure(format('select public.publish_matching_result(%L,%L,%L)',j.job_id,j.lease_token,
    '{"status":"scored","score":2.5}'),'finite range required');
  okay:=public.publish_matching_result(j.job_id,j.lease_token,'{"status":"abstained","score":null,"reason":"insufficient_evidence"}');
  perform pg_temp.assert_true(okay,'valid abstention saved');
  perform pg_temp.assert_true((select final_score is null and applied_onboarding_weight is null and model_revision='test-revision'
    from public.match_scores where job_id=j.job_id),'abstention not zero; provenance preserved');
  perform pg_temp.expect_failure(format('update public.match_scores set status=''scored'',final_score=0.5,onboarding_score=0.5 where job_id=%L',j.job_id),
    'NULL applied weights cannot satisfy a scored result CHECK');
  insert into public.match_snapshots(viewer_id,items,expires_at) values(j.viewer_id,
    jsonb_build_array(jsonb_build_object('candidate_id',j.candidate_id)),now()+interval '5 minutes');
  update public.profiles set settings='{"profile_location":"New York"}' where user_id=j.candidate_id;
  perform pg_temp.assert_true(not exists(select 1 from public.match_scores where job_id=j.job_id),'candidate edits invalidate cached scores');
  perform pg_temp.assert_true(not exists(select 1 from public.match_snapshots where viewer_id=j.viewer_id),'candidate edits invalidate pagination snapshot');
  insert into public.matching_jobs(identity_hash,viewer_id,candidate_id,viewer_version_id,candidate_version_id,context,
    history_version,model_id,model_revision,pipeline_version,policy)
    select 'test-stale',viewer_id,candidate_id,viewer_version_id,candidate_version_id,context,history_version,model_id,model_revision,pipeline_version,policy
      from public.matching_jobs where job_id=j.job_id;
  select * into j from public.claim_matching_jobs(1,120);
  update public.presence set longitude=longitude+0.00001 where user_id=j.candidate_id;
  perform pg_temp.assert_true(not public.publish_matching_result(j.job_id,j.lease_token,'{"status":"scored","score":0.9}'),'stale lease cannot publish after location change');
end;
$$;

-- Atomic confirmation creates a new immutable version and scopes old requests.
do $$
declare r public.connection_requests; before_version public.profile_versions; after_version public.profile_versions;
begin
  r:=public.request_connection('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
  select * into before_version from public.profile_versions where profile_version_id='40000000-0000-4000-8000-000000000001';
  after_version:=public.publish_profile(before_version.user_id,before_version.onboarding_session_id,
    jsonb_build_object('current_goal','Learn balcony gardening','conversation_intent','Hear firsthand stories and practical advice about balcony gardening.','facts',before_version.facts,
      'open_to_discussing',to_jsonb(before_version.open_to_discussing),'conversation_preferences','[]'::jsonb,'avoid_topics','[]'::jsonb),
    '{"enabled":true,"display_name":"Confirmed test preview","interests":["gardening"]}',
    '{"display_name":"Confirmed test owner","discoverable":true}');
  perform pg_temp.assert_true(after_version.profile_version_id<>before_version.profile_version_id,'confirmation appends version');
  perform pg_temp.assert_true(after_version.conversation_intent='Hear firsthand stories and practical advice about balcony gardening.',
    'natural-language intent preserved independently of six-mode context');
  perform pg_temp.assert_true((select current_profile_version_id=after_version.profile_version_id and display_name='Confirmed test owner'
    from public.profiles where user_id=before_version.user_id),'pointer and settings publish atomically');
  perform pg_temp.assert_true((select current_goal=before_version.current_goal from public.profile_versions where profile_version_id=before_version.profile_version_id),'old snapshot unchanged');
  perform pg_temp.assert_true(after_version.onboarding_answers=before_version.onboarding_answers,'source snapshot frozen from database');
  perform pg_temp.expect_failure(format('select public.decide_connection(%L,%L,%L)',
    '10000000-0000-4000-8000-000000000002',r.request_id,'accept'),'old version request cannot reveal new version');
end;
$$;

-- BLE uses its own opt-in and active sessions; no GPS prerequisite.
update public.profiles set bluetooth_enabled=true where user_id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
insert into public.phone_ble_sessions(user_id,token_hash,expires_at) values
  ('10000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '2 minutes'),
  ('10000000-0000-4000-8000-000000000002',repeat('b',64),now()+interval '2 minutes');
delete from public.presence where user_id='10000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(public.eligible_pair('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','ble'),'BLE independent of GPS');
select pg_temp.assert_true(not public.eligible_pair('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','nearby'),'GPS unavailable remains distinct');
update public.profiles set bluetooth_enabled=false where user_id='10000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(not exists(select 1 from public.phone_ble_sessions where user_id='10000000-0000-4000-8000-000000000001' and revoked_at is null),'Live off revokes sessions');
select pg_temp.assert_true(not public.eligible_pair('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','ble'),'Live off cannot resolve encounters');
update public.consent_receipts set revoked_at=now() where user_id='10000000-0000-4000-8000-000000000002' and purpose='personal_matching';
select pg_temp.assert_true((select not discoverable and not bluetooth_enabled from public.profiles where user_id='10000000-0000-4000-8000-000000000002'),'matching revocation disables both modes');
select pg_temp.assert_true(not exists(select 1 from public.phone_ble_sessions where user_id='10000000-0000-4000-8000-000000000002' and revoked_at is null),'matching revocation clears active BLE');

-- Optimistic onboarding revision protects conversation updates from lost writes.
do $$
declare s public.onboarding_sessions;
begin
  s:=public.start_onboarding('10000000-0000-4000-8000-000000000001');
  perform pg_temp.assert_true(s.turns->0->>'content'='What makes you YOU?','exact first question');
  perform public.append_onboarding_exchange(s.user_id,s.session_id,0,'[{"role":"user","content":"A new answer"}]');
  perform pg_temp.expect_failure(format('select public.append_onboarding_exchange(%L,%L,0,%L)',s.user_id,s.session_id,'[]'),'stale conversation revision');
end;
$$;

select pg_temp.assert_true((select count(*)>0 from public.matching_invalidations),'persistent requeue signals recorded');
delete from public.onboarding_answers where answer_id='30000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(not exists(select 1 from public.profile_versions where user_id='10000000-0000-4000-8000-000000000001'),
  'privacy erasure removes every snapshot containing the deleted source');
select pg_temp.assert_true((select current_profile_version_id is null from public.profiles where user_id='10000000-0000-4000-8000-000000000001'),
  'privacy erasure clears active version pointer');
select 'All runtime database assertions passed.' as result;
