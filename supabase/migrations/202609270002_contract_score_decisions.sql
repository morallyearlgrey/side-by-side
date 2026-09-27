-- Admit the versioned application score decision without changing historical
-- V4 predictions or their provenance. Apply before restarting a V5 worker.
insert into public.matching_policies(policy_version) values ('onboarding-contract-v5');

create or replace function public.matching_v4_identity(model_id text,model_revision text,pipeline text,policy text,policy_hash text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(model_id='Qwen/Qwen3-Reranker-4B'
    and model_revision='22e683669bc0f0bd69640a1354a6d0aebcfeede5'
    and ((pipeline='online-approved-onboarding-evidence-v4'
      and policy='onboarding-evidence-v4'
      and policy_hash='b1e4b4ef1c58f17007400f5064ef97b12d19489d1a78698ca177e2792080bf57')
    or (pipeline='online-approved-onboarding-contract-v5'
      and policy='onboarding-contract-v5'
      and policy_hash='09a7d11ed360101af2acdffa68e1504a1cb398b29e80691eb0a4004821502d8f')),false);
$$;

create or replace function public.matching_v4_provenance(value jsonb)
returns boolean language sql immutable set search_path='' as $$
  select public.matching_v4_identity(value->>'model_id',value->>'model_revision',value->>'pipeline_version',value->>'policy',value->>'policy_sha256')
    and coalesce(value->>'format_encoder_id'='sentence-transformers/all-MiniLM-L6-v2'
      and value->>'format_encoder_revision'='1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
      and value->>'evidence_model_id'='MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli'
      and value->>'evidence_model_revision'='eb8b17b1983bca679126ea69b12b5d28c5fe9b9a'
      and ((value->>'pipeline_version'='online-approved-onboarding-evidence-v4'
        and value->>'prompt_version'='source-aware-relevance-sufficiency-v4'
        and value->>'feature_version'='onboarding-format-evidence-v4')
      or (value->>'pipeline_version'='online-approved-onboarding-contract-v5'
        and value->>'prompt_version'='source-aware-relevance-contract-v5'
        and value->>'feature_version'='onboarding-format-contract-v5')),false);
$$;

alter table public.matching_jobs add constraint matching_jobs_v5_identity check
  (pipeline_version<>'online-approved-onboarding-contract-v5'
    or public.matching_v4_identity(model_id,model_revision,pipeline_version,policy,policy_sha256));
alter table public.model_worker_heartbeats add constraint model_worker_v5_identity check
  (pipeline_version<>'online-approved-onboarding-contract-v5'
    or (public.matching_v4_identity(model_id,model_revision,pipeline_version,policy,policy_sha256)
      and public.matching_v4_provenance(provenance)));
alter table public.match_snapshots add constraint snapshots_v5_identity check
  (pipeline_version is distinct from 'online-approved-onboarding-contract-v5'
    or public.matching_v4_identity(model_id,model_revision,pipeline_version,policy,policy_sha256));

-- Existing service-only publish_matching_result still enforces immutable
-- versions, live eligibility, valid numeric scores and status/weight agreement.
