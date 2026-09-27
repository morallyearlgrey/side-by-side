-- Disposable PostgreSQL/PostGIS only, after all migrations and seed.sql.
-- The runner wraps these fictional rows and migrations in a rollback transaction.
create or replace function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',message; end if; end;
$$;
create or replace function pg_temp.expect_failure(statement text,message text) returns void language plpgsql as $$
declare failed boolean:=false;
begin
  begin execute statement; exception when others then failed:=true; end;
  if not failed then raise exception 'EXPECTED FAILURE: %',message; end if;
end;
$$;
create function pg_temp.discovery_result() returns jsonb language sql as $$
  select '{"status":"recommend","score":0.9,"onboarding_weight":1,"instagram_weight":0,
    "reason":"supported","model_id":"Qwen/Qwen3-Reranker-4B",
    "model_revision":"22e683669bc0f0bd69640a1354a6d0aebcfeede5","pipeline_version":"online-approved-onboarding-evidence-v4",
    "policy":"onboarding-evidence-v4","policy_sha256":"b1e4b4ef1c58f17007400f5064ef97b12d19489d1a78698ca177e2792080bf57",
    "format_encoder_id":"sentence-transformers/all-MiniLM-L6-v2","format_encoder_revision":"1110a243fdf4706b3f48f1d95db1a4f5529b4d41",
    "evidence_model_id":"MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli","evidence_model_revision":"eb8b17b1983bca679126ea69b12b5d28c5fe9b9a",
    "prompt_version":"source-aware-relevance-sufficiency-v4","feature_version":"onboarding-format-evidence-v4"}'::jsonb;
$$;
create function pg_temp.discovery_job(label text,mode text default 'nearby') returns public.matching_jobs language plpgsql as $$
declare created uuid; claimed public.matching_jobs;
begin
  insert into public.matching_jobs(identity_hash,viewer_id,candidate_id,viewer_version_id,candidate_version_id,context,
    history_version,model_id,model_revision,pipeline_version,policy,policy_sha256,mode)
    values(label,'10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','learn','excluded-v1',
      'Qwen/Qwen3-Reranker-4B','22e683669bc0f0bd69640a1354a6d0aebcfeede5','online-approved-onboarding-evidence-v4',
      'onboarding-evidence-v4','b1e4b4ef1c58f17007400f5064ef97b12d19489d1a78698ca177e2792080bf57',mode)
    returning job_id into created;
  select * into claimed from public.claim_matching_jobs(50,120) where job_id=created;
  perform pg_temp.assert_true(claimed.status='running','fixture job receives a live lease');
  return claimed;
end;
$$;

-- Native discovery uses independent BLE and GPS permissions.
update public.profiles set bluetooth_enabled=true where user_id in
  ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
insert into public.phone_ble_sessions(session_id,user_id,token_hash,issued_at,expires_at) values
  ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',repeat('c',64),now()-interval '2 minutes',now()+interval '3 minutes'),
  ('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',repeat('d',64),now()-interval '2 minutes',now()+interval '3 minutes');

-- A heartbeat changes proximity but does not change approved profile evidence.
do $$
declare nearby_job public.matching_jobs; ble_job public.matching_jobs; old_revision bigint;
begin
  nearby_job:=pg_temp.discovery_job('refresh-nearby');
  ble_job:=pg_temp.discovery_job('refresh-ble','ble');
  select revision into old_revision from public.matching_invalidations where user_id=nearby_job.candidate_id;
  insert into public.match_snapshots(viewer_id,items,expires_at) values
    (nearby_job.viewer_id,jsonb_build_array(jsonb_build_object('candidate_id',nearby_job.candidate_id)),now()+interval '5 minutes'),
    (nearby_job.candidate_id,'[]',now()+interval '5 minutes');
  update public.presence set longitude=longitude+0.00001,observed_at=now(),expires_at=now()+interval '5 minutes'
    where user_id=nearby_job.candidate_id;
  perform pg_temp.assert_true((select status='running' and lease_token=nearby_job.lease_token from public.matching_jobs where job_id=nearby_job.job_id),
    'GPS heartbeat preserves running nearby job and lease');
  perform pg_temp.assert_true((select status='running' and lease_token=ble_job.lease_token from public.matching_jobs where job_id=ble_job.job_id),
    'GPS heartbeat preserves running Bluetooth job and lease');
  perform pg_temp.assert_true((select revision=old_revision from public.matching_invalidations where user_id=nearby_job.candidate_id),
    'GPS heartbeat does not produce a new semantic identity');
  perform pg_temp.assert_true(not exists(select 1 from public.match_snapshots where viewer_id in(nearby_job.viewer_id,nearby_job.candidate_id)),
    'GPS heartbeat clears affected proximity snapshots');
  perform pg_temp.assert_true(public.publish_matching_result(nearby_job.job_id,nearby_job.lease_token,pg_temp.discovery_result()),
    'nearby result publishes after fresh GPS update');
  perform pg_temp.assert_true(public.publish_matching_result(ble_job.job_id,ble_job.lease_token,pg_temp.discovery_result()),
    'Bluetooth result publishes after fresh GPS update');
  update public.presence set observed_at=now(),expires_at=now()+interval '5 minutes' where user_id=nearby_job.viewer_id;
  perform pg_temp.assert_true((select count(*)=2 from public.match_scores where job_id in(nearby_job.job_id,ble_job.job_id)),
    'later GPS heartbeat preserves both completed scores');

  -- Moving away retains semantic evidence, while live eligibility controls display.
  nearby_job:=pg_temp.discovery_job('left-area');
  ble_job:=pg_temp.discovery_job('left-area-ble','ble');
  update public.presence set latitude=41.0 where user_id=nearby_job.candidate_id;
  perform pg_temp.assert_true(not public.eligible_pair(nearby_job.viewer_id,nearby_job.candidate_id,'nearby'),
    'moving outside two miles immediately blocks location discovery');
  perform pg_temp.assert_true(not exists(select 1 from public.nearby_candidates(nearby_job.viewer_id) where user_id=nearby_job.candidate_id),
    'location candidate reads cannot return an out-of-area cached recommendation');
  perform pg_temp.assert_true(not public.publish_matching_result(nearby_job.job_id,nearby_job.lease_token,pg_temp.discovery_result()),
    'a location result cannot publish after leaving the area');
  perform pg_temp.assert_true(public.publish_matching_result(ble_job.job_id,ble_job.lease_token,pg_temp.discovery_result()),
    'GPS movement does not cancel eligible Bluetooth evidence');

  update public.presence set latitude=40.7200 where user_id=nearby_job.candidate_id;
  nearby_job:=pg_temp.discovery_job('expired-presence');
  update public.presence set observed_at=now()-interval '20 minutes',expires_at=now()-interval '10 minutes'
    where user_id=nearby_job.candidate_id;
  perform pg_temp.assert_true(not exists(select 1 from public.nearby_candidates(nearby_job.viewer_id) where user_id=nearby_job.candidate_id),
    'expired GPS cannot disclose a cached recommendation');
  perform pg_temp.assert_true(not public.publish_matching_result(nearby_job.job_id,nearby_job.lease_token,pg_temp.discovery_result()),
    'expired GPS cannot publish a location result');

  update public.presence set observed_at=now(),expires_at=now()+interval '5 minutes' where user_id=nearby_job.candidate_id;
  nearby_job:=pg_temp.discovery_job('deleted-presence');
  delete from public.presence where user_id=nearby_job.candidate_id;
  perform pg_temp.assert_true(not public.publish_matching_result(nearby_job.job_id,nearby_job.lease_token,pg_temp.discovery_result()),
    'deleted GPS cannot publish a location result');
  perform pg_temp.assert_true(public.eligible_pair(nearby_job.viewer_id,nearby_job.candidate_id,'ble'),
    'Bluetooth remains independent of missing GPS');
end;
$$;

-- Encounter storage is monotonic across concurrent/out-of-order client requests.
select public.record_ble_encounter('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',now()-interval '10 seconds',-45);
select public.record_ble_encounter('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',now()-interval '60 seconds',-90);
select pg_temp.assert_true((select observed_at=now()-interval '10 seconds' and rssi=-45 from public.encounters
  where observer_user_id='10000000-0000-4000-8000-000000000001' and observed_session_id='50000000-0000-4000-8000-000000000002'),
  'late old report cannot backdate a live encounter or overwrite its signal');
select public.record_ble_encounter('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',now()-interval '5 seconds',-40);
select pg_temp.assert_true((select observed_at=now()-interval '5 seconds' and rssi=-40 from public.encounters
  where observer_user_id='10000000-0000-4000-8000-000000000001' and observed_session_id='50000000-0000-4000-8000-000000000002'),
  'new report advances encounter time and signal');

-- Authenticated clients cannot invoke a service RPC with another account ID.
set local role authenticated;
select pg_temp.expect_failure($q$select public.record_ble_encounter('10000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',now(),-40)$q$,'unprivileged encounter RPC denied');
reset role;
