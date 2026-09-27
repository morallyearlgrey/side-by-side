-- After discovery_refresh and contract_score_decisions, in a disposable transaction.
do $$
declare j public.matching_jobs; output jsonb;
begin
  j:=pg_temp.discovery_job('topic-boundaries-v6');
  update public.matching_jobs set pipeline_version='online-approved-topic-boundaries-v6',
    policy='topic-boundaries-v6',policy_sha256='ecdb5535bb8973af68312b5e2237eb7ef21b83cbb03881fe94f3aaf303b72090'
    where job_id=j.job_id;
  output:=pg_temp.discovery_result() || jsonb_build_object(
    'score',0.9,'pipeline_version','online-approved-topic-boundaries-v6',
    'policy','topic-boundaries-v6','policy_sha256','ecdb5535bb8973af68312b5e2237eb7ef21b83cbb03881fe94f3aaf303b72090',
    'prompt_version','source-aware-topic-boundaries-v6','feature_version','onboarding-topic-boundaries-v6');
  perform pg_temp.assert_true(public.publish_matching_result(j.job_id,j.lease_token,output),
    'V6 result publishes through the existing consent and lease contract');
  perform pg_temp.assert_true((select status='recommend' and final_score=0.9 from public.match_scores where job_id=j.job_id),
    'V6 preserves computed score');
  perform pg_temp.assert_true(not public.matching_v4_provenance(output || jsonb_build_object('prompt_version','source-aware-relevance-contract-v5')),
    'V5 prompt cannot masquerade as boundary-aware V6');
  perform pg_temp.assert_true(not public.matching_v4_identity(j.model_id,j.model_revision,
    'online-approved-topic-boundaries-v6','onboarding-contract-v5',j.policy_sha256),
    'mixed V5/V6 identity fails');
end;
$$;
