-- Run only in the rollback test harness, after seed.sql, before runtime.sql.
create function pg_temp.demo_assert(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'DEMO ASSERTION: %',msg; end if; end; $$;
create function pg_temp.demo_denied(statement text) returns void language plpgsql as $$
declare denied boolean:=false;
begin begin execute statement; exception when others then denied:=true; end;
  if not denied then raise exception 'Expected demo permission denial'; end if;
end; $$;
create function pg_temp.demo_provenance() returns jsonb language sql as $$
  select '{"status":"insufficient_evidence","score":null,"onboarding_weight":null,"instagram_weight":null,
    "model_id":"Qwen/Qwen3-Reranker-4B","model_revision":"22e683669bc0f0bd69640a1354a6d0aebcfeede5",
    "pipeline_version":"online-approved-onboarding-evidence-v4","policy":"onboarding-evidence-v4",
    "policy_sha256":"b1e4b4ef1c58f17007400f5064ef97b12d19489d1a78698ca177e2792080bf57",
    "format_encoder_id":"sentence-transformers/all-MiniLM-L6-v2","format_encoder_revision":"1110a243fdf4706b3f48f1d95db1a4f5529b4d41",
    "evidence_model_id":"MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli","evidence_model_revision":"eb8b17b1983bca679126ea69b12b5d28c5fe9b9a",
    "prompt_version":"source-aware-relevance-sufficiency-v4","feature_version":"onboarding-format-evidence-v4"}'::jsonb;
$$;
create function pg_temp.demo_job(a uuid,b uuid) returns uuid language plpgsql as $$
declare j uuid; p jsonb:=pg_temp.demo_provenance();
begin
  insert into public.matching_jobs(identity_hash,viewer_id,candidate_id,viewer_version_id,candidate_version_id,
    context,history_version,model_id,model_revision,pipeline_version,policy,policy_sha256)
    select gen_random_uuid()::text,a,b,pa.current_profile_version_id,pb.current_profile_version_id,'learn','none',
      p->>'model_id',p->>'model_revision',p->>'pipeline_version',p->>'policy',p->>'policy_sha256'
    from public.profiles pa,public.profiles pb where pa.user_id=a and pb.user_id=b returning job_id into j;
  return j;
end; $$;

do $$
declare a uuid:='10000000-0000-4000-8000-000000000001'; b uuid:='10000000-0000-4000-8000-000000000002';
  other uuid:='10000000-0000-4000-8000-000000000003'; token text:=repeat('a',64);
  scope uuid; jid uuid; foreign_job uuid; foreign_before jsonb; payload jsonb; lease uuid; old_version uuid;
begin
  update auth.users set raw_app_meta_data=jsonb_build_object('sidebyside_demo',true,'data_origin','synthetic','demo_run_id','sql-test') where id in(a,b);
  insert into public.demo_worker_scopes(token_hash,demo_run_id,user_a,version_a,user_b,version_b,expires_at)
    select encode(extensions.digest(token,'sha256'),'hex'),'sql-test',a,pa.current_profile_version_id,b,pb.current_profile_version_id,now()+interval '1 hour'
    from public.profiles pa,public.profiles pb where pa.user_id=a and pb.user_id=b returning scope_id into scope;
  jid:=pg_temp.demo_job(a,b);
  foreign_job:=pg_temp.demo_job(a,other);
  update public.matching_jobs set status='running',lease_token=gen_random_uuid(),lease_expires_at=now()-interval '1 second',attempts=5 where job_id=foreign_job;
  select to_jsonb(j) into foreign_before from public.matching_jobs j where job_id=foreign_job;
  perform pg_temp.demo_assert(public.demo_worker_pair_supported(a,b),'approved pair can be requested');
  perform pg_temp.demo_assert(not public.demo_worker_pair_supported(a,other),'other candidate excluded before enqueue');
  perform pg_temp.demo_assert(not public.demo_worker_pair_supported(other,a),'other viewer excluded');
  perform pg_temp.demo_assert((select count(*)=1 from public.demo_worker_candidates(a)),'only approved nearby candidate');

  set local role anon;
  perform pg_temp.demo_denied('select * from public.demo_worker_scopes');
  perform pg_temp.demo_denied('select * from public.profile_versions');
  perform pg_temp.demo_denied('select public.claim_matching_jobs()');
  perform pg_temp.demo_denied('select public.demo_worker_readiness('''||a||''')');
  perform pg_temp.demo_denied('select public.demo_worker_candidates('''||a||''')');
  perform pg_temp.demo_denied('select public.demo_worker_auth('''||token||''')');
  perform pg_temp.demo_denied('select public.demo_worker_claim('''||repeat('b',64)||''')');
  perform pg_temp.demo_assert(public.demo_worker_claim(token) is null,'not ready cannot claim');
  perform public.demo_worker_heartbeat(token,true,pg_temp.demo_provenance());
  payload:=public.demo_worker_claim(token);
  perform pg_temp.demo_assert(payload#>>'{job,job_id}'=jid::text,'only scoped job leased');
  perform pg_temp.demo_assert(payload#>>'{viewer,user_id}'=a::text and payload#>>'{candidate,user_id}'=b::text,'only scoped payload');
  lease:=(payload#>>'{job,lease_token}')::uuid;
  perform pg_temp.demo_assert(public.demo_worker_claim(token) is null,'active lease not reclaimed');
  perform pg_temp.demo_assert(not public.demo_worker_publish(token,jid,gen_random_uuid(),pg_temp.demo_provenance()),'wrong lease rejected');
  perform pg_temp.demo_assert(not public.demo_worker_publish(token,foreign_job,lease,pg_temp.demo_provenance()),'other job not writable');
  perform pg_temp.demo_assert(not public.demo_worker_fail(token,foreign_job,lease),'other job not failed');
  perform pg_temp.demo_assert(public.demo_worker_publish(token,jid,lease,pg_temp.demo_provenance()),'real result path accepts valid provenance');
  reset role;
  perform pg_temp.demo_assert((select to_jsonb(j)=foreign_before from public.matching_jobs j where job_id=foreign_job),'foreign expired job completely untouched');
  perform pg_temp.demo_assert(public.demo_worker_readiness(other) is null,'readiness not global');
  perform pg_temp.demo_assert(public.demo_worker_readiness(a)->>'status'='ready','demo readiness supported');
  update public.demo_worker_scopes set heartbeat_expires_at=now()-interval '1 second' where scope_id=scope;
  perform pg_temp.demo_assert(public.demo_worker_readiness(a) is null,'stale heartbeat unavailable');
  perform public.demo_worker_heartbeat(token,true,pg_temp.demo_provenance());

  -- A block or availability-off prevents payload dispatch, even with valid capability.
  jid:=pg_temp.demo_job(a,b);
  insert into public.user_blocks(blocker_user_id,blocked_user_id) values(b,a);
  perform pg_temp.demo_assert(public.demo_worker_claim(token) is null,'blocked pairs not sent');
  delete from public.user_blocks where blocker_user_id=b and blocked_user_id=a;
  update public.profiles set discoverable=false where user_id=a;
  perform pg_temp.demo_assert(public.demo_worker_claim(token) is null,'availability-off not sent');
  update public.profiles set discoverable=true where user_id=a;

  select current_profile_version_id into old_version from public.profiles where user_id=a;
  update public.profiles set current_profile_version_id=null where user_id=a;
  perform pg_temp.demo_denied('select public.demo_worker_claim('''||token||''')');
  perform pg_temp.demo_assert(public.demo_worker_readiness(a) is null,'edited profile invalidates readiness');
  update public.profiles set current_profile_version_id=old_version where user_id=a;
  update public.consent_receipts set revoked_at=now() where user_id=a and purpose='personal_matching';
  perform pg_temp.demo_denied('select public.demo_worker_claim('''||token||''')');
  update public.consent_receipts set revoked_at=null where user_id=a and purpose='personal_matching';
  update auth.users set raw_app_meta_data='{}' where id=b;
  perform pg_temp.demo_denied('select public.demo_worker_claim('''||token||''')');
  update auth.users set raw_app_meta_data=jsonb_build_object('sidebyside_demo',true,'data_origin','synthetic','demo_run_id','sql-test') where id=b;
  update public.demo_worker_scopes set revoked_at=now() where scope_id=scope;
  perform pg_temp.demo_denied('select public.demo_worker_claim('''||token||''')');
  update public.demo_worker_scopes set revoked_at=null,expires_at=now()-interval '1 second' where scope_id=scope;
  perform pg_temp.demo_denied('select public.demo_worker_claim('''||token||''')');
end; $$;
