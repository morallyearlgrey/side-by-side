-- Run after discovery_refresh.sql in the same disposable transaction.
-- Restore the fictional pair's fresh presence after expiry/deletion cases.
insert into public.presence(user_id,latitude,longitude,accuracy_m,observed_at,expires_at)
values('10000000-0000-4000-8000-000000000001',40.72,-74.0,10,now(),now()+interval '5 minutes'),
 ('10000000-0000-4000-8000-000000000002',40.72,-74.0,10,now(),now()+interval '5 minutes')
on conflict(user_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,
 observed_at=excluded.observed_at,expires_at=excluded.expires_at;

do $$
declare j public.matching_jobs; output jsonb;
begin
  j:=pg_temp.discovery_job('contract-99-percent');
  update public.matching_jobs set pipeline_version='online-approved-onboarding-contract-v5',
    policy='onboarding-contract-v5',policy_sha256='09a7d11ed360101af2acdffa68e1504a1cb398b29e80691eb0a4004821502d8f'
    where job_id=j.job_id;
  output:=pg_temp.discovery_result() || jsonb_build_object(
    'score',0.9998361202710789,'pipeline_version','online-approved-onboarding-contract-v5',
    'policy','onboarding-contract-v5','policy_sha256','09a7d11ed360101af2acdffa68e1504a1cb398b29e80691eb0a4004821502d8f',
    'prompt_version','source-aware-relevance-contract-v5','feature_version','onboarding-format-contract-v5');
  perform pg_temp.assert_true(public.publish_matching_result(j.job_id,j.lease_token,output),
    '99 percent supported V5 prediction publishes');
  perform pg_temp.assert_true((select status='recommend' and final_score>0.99 from public.match_scores where job_id=j.job_id),
    'published high score retains recommendation status');
  perform pg_temp.assert_true(public.matching_v4_provenance(pg_temp.discovery_result()),
    'historical V4 worker and outcomes remain compatible');
  perform pg_temp.assert_true(not public.matching_v4_provenance(output || jsonb_build_object('prompt_version','source-aware-relevance-sufficiency-v4')),
    'old generic-gate output cannot masquerade as new contract policy');
  perform pg_temp.assert_true(not public.matching_v4_identity('Qwen/Qwen3-Reranker-4B',j.model_revision,
    'online-approved-onboarding-contract-v5','onboarding-evidence-v4',j.policy_sha256),
    'mixed policy identities fail');
end;
$$;
