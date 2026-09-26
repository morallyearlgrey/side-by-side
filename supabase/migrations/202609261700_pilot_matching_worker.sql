-- Private, opt-in intake inference queue. It is isolated from app profiles and
-- the fictional-only Newton workflow; the worker polls Supabase outbound.
begin;

alter table public.pilot_intake_responses
  drop constraint pilot_intake_responses_payload_check;
alter table public.pilot_intake_responses
  add constraint pilot_intake_responses_payload_check check (
    jsonb_typeof(payload) = 'object'
    and payload->>'version' = 'hackgt-intake-v1'
    and payload->>'consent_version' in ('private-pilot-v1', 'private-pilot-runpod-v2')
    and payload->>'consent' = 'true'
    and payload->>'data_origin' = 'real_opt_in'
    and payload->>'training_allowed' = 'false'
    and payload->>'public_sharing_allowed' = 'false'
    and coalesce(jsonb_typeof(payload->'answers') = 'object', false)
  );

create table public.pilot_intake_match_batches (
  batch_id uuid primary key default gen_random_uuid(),
  requested_by uuid not null,
  participant_receipt_ids uuid[] not null check (cardinality(participant_receipt_ids) between 2 and 20),
  status text not null default 'pending' check (status in ('pending','running','succeeded','failed','cancelled')),
  pipeline_version text not null check (pipeline_version = 'pilot-intake-directional-v1'),
  attempts integer not null default 0 check (attempts between 0 and 3),
  lease_token uuid,
  lease_expires_at timestamptz,
  result jsonb,
  model_provenance jsonb,
  error_code text check (error_code is null or error_code ~ '^[a-z_]{1,48}$'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'succeeded') = (result is not null)),
  check (result is null or (
    jsonb_typeof(result) = 'object'
    and result->>'schema_version' = 'pilot-matching-results-v1'
    and jsonb_typeof(result->'pairs') = 'array'
    and jsonb_typeof(result->'abstentions') = 'array'
  )),
  check (model_provenance is null or (
    model_provenance->>'model_id' = 'Qwen/Qwen3-Reranker-4B'
    and model_provenance->>'model_revision' = '22e683669bc0f0bd69640a1354a6d0aebcfeede5'
    and model_provenance->>'pipeline_version' = 'pilot-intake-directional-v1'
  )),
  check ((status = 'running') = (lease_token is not null and lease_expires_at is not null))
);
create index pilot_intake_match_batches_due
  on public.pilot_intake_match_batches(status, lease_expires_at, created_at);

create table public.pilot_intake_match_workers (
  worker_id uuid primary key,
  model_id text not null check (model_id = 'Qwen/Qwen3-Reranker-4B'),
  model_revision text not null check (model_revision = '22e683669bc0f0bd69640a1354a6d0aebcfeede5'),
  pipeline_version text not null check (pipeline_version = 'pilot-intake-directional-v1'),
  status text not null check (status in ('ready','unavailable')),
  updated_at timestamptz not null,
  expires_at timestamptz not null,
  reason text check (reason is null or reason ~ '^[a-z_]{1,48}$')
);
create index pilot_intake_match_workers_ready
  on public.pilot_intake_match_workers(status, expires_at desc);

alter table public.pilot_intake_match_batches enable row level security;
alter table public.pilot_intake_match_workers enable row level security;
revoke all on public.pilot_intake_match_batches, public.pilot_intake_match_workers from public, anon, authenticated;
grant select, insert, update, delete on public.pilot_intake_match_batches, public.pilot_intake_match_workers to service_role;

create function public.claim_pilot_intake_match_batches(p_limit integer default 1, p_lease_seconds integer default 1800)
returns setof public.pilot_intake_match_batches language plpgsql security definer set search_path = '' as $$
begin
  if p_limit not between 1 and 2 or p_lease_seconds not between 300 and 3600 then
    raise exception 'invalid claim limits' using errcode = '22023';
  end if;

  update public.pilot_intake_match_batches b
  set status = 'cancelled', lease_token = null, lease_expires_at = null,
      error_code = 'consent_or_response_unavailable', completed_at = now()
  where b.status in ('pending','running') and exists (
    select 1 from unnest(b.participant_receipt_ids) as selected(receipt_id)
    left join public.pilot_intake_responses r using (receipt_id)
    where r.receipt_id is null
      or r.payload->>'consent_version' <> 'private-pilot-runpod-v2'
      or r.payload->>'consent' <> 'true'
      or r.payload->>'training_allowed' <> 'false'
      or r.payload->>'public_sharing_allowed' <> 'false'
  );

  update public.pilot_intake_match_batches
  set status = 'failed', lease_token = null, lease_expires_at = null,
      error_code = 'retry_limit', completed_at = now()
  where status = 'running' and lease_expires_at <= now() and attempts >= 3;

  return query
    with due as (
      select b.batch_id from public.pilot_intake_match_batches b
      where b.attempts < 3 and (
        b.status = 'pending' or (b.status = 'running' and b.lease_expires_at <= now())
      )
      order by b.created_at, b.batch_id
      for update skip locked limit p_limit
    )
    update public.pilot_intake_match_batches b
    set status = 'running', attempts = b.attempts + 1,
        lease_token = gen_random_uuid(), lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        error_code = null
    from due where b.batch_id = due.batch_id
    returning b.*;
end;
$$;

create function public.complete_pilot_intake_match_batch(
  p_batch_id uuid, p_lease_token uuid, p_result jsonb, p_model_provenance jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare b public.pilot_intake_match_batches;
begin
  select * into b from public.pilot_intake_match_batches
  where batch_id = p_batch_id and status = 'running' and lease_token = p_lease_token
    and lease_expires_at > now() for update;
  if not found then return false; end if;
  if exists (
    select 1 from unnest(b.participant_receipt_ids) as selected(receipt_id)
    left join public.pilot_intake_responses r using (receipt_id)
    where r.receipt_id is null
      or r.payload->>'consent_version' <> 'private-pilot-runpod-v2'
      or r.payload->>'consent' <> 'true'
      or r.payload->>'training_allowed' <> 'false'
      or r.payload->>'public_sharing_allowed' <> 'false'
  ) then
    update public.pilot_intake_match_batches set status = 'cancelled', lease_token = null,
      lease_expires_at = null, error_code = 'consent_or_response_unavailable', completed_at = now()
    where batch_id = p_batch_id;
    return false;
  end if;
  if jsonb_typeof(p_result) <> 'object'
     or p_result->>'schema_version' <> 'pilot-matching-results-v1'
     or jsonb_typeof(p_result->'pairs') <> 'array'
     or jsonb_typeof(p_result->'abstentions') <> 'array'
     or p_model_provenance->>'model_id' <> 'Qwen/Qwen3-Reranker-4B'
     or p_model_provenance->>'model_revision' <> '22e683669bc0f0bd69640a1354a6d0aebcfeede5'
     or p_model_provenance->>'pipeline_version' <> 'pilot-intake-directional-v1' then
    raise exception 'invalid inference result' using errcode = '22023';
  end if;
  update public.pilot_intake_match_batches set status = 'succeeded', result = p_result,
    model_provenance = p_model_provenance, lease_token = null, lease_expires_at = null,
    error_code = null, completed_at = now() where batch_id = p_batch_id;
  return true;
end;
$$;

create function public.fail_pilot_intake_match_batch(
  p_batch_id uuid, p_lease_token uuid, p_error_code text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare b public.pilot_intake_match_batches;
begin
  select * into b from public.pilot_intake_match_batches
  where batch_id = p_batch_id and status = 'running' and lease_token = p_lease_token for update;
  if not found then return false; end if;
  update public.pilot_intake_match_batches set
    status = case when attempts >= 3 then 'failed' else 'pending' end,
    lease_token = null, lease_expires_at = null,
    error_code = case when p_error_code in ('model_unavailable','consent_or_response_unavailable')
      then p_error_code else 'inference_failed' end,
    completed_at = case when attempts >= 3 then now() else null end
  where batch_id = p_batch_id;
  return true;
end;
$$;

revoke all on function public.claim_pilot_intake_match_batches(integer,integer),
  public.complete_pilot_intake_match_batch(uuid,uuid,jsonb,jsonb),
  public.fail_pilot_intake_match_batch(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_pilot_intake_match_batches(integer,integer),
  public.complete_pilot_intake_match_batch(uuid,uuid,jsonb,jsonb),
  public.fail_pilot_intake_match_batch(uuid,uuid,text) to service_role;

comment on table public.pilot_intake_match_batches is
  'Organizer-only pairwise inference batches for participants who opted into the RunPod-hosted pilot worker; no profile creation, public sharing, or model training.';

commit;
