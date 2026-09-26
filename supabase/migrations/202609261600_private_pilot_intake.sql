-- A separate pilot inbox. No app profiles, discovery queues, or Newton worker grants.

create table public.pilot_intake_responses (
  request_id uuid primary key,
  receipt_id uuid not null unique,
  created_at timestamptz not null default now(),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and payload @> '{"version":"hackgt-intake-v1","consent_version":"private-pilot-v1","consent":true,"data_origin":"real_opt_in","training_allowed":false,"public_sharing_allowed":false}'::jsonb
    and coalesce(jsonb_typeof(payload->'answers') = 'object', false)
  )
);

create table public.pilot_intake_rate_limits (
  rate_hash text primary key check (rate_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  submissions integer not null check (submissions > 0)
);

alter table public.pilot_intake_responses enable row level security;
alter table public.pilot_intake_rate_limits enable row level security;
revoke all on public.pilot_intake_responses, public.pilot_intake_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.pilot_intake_responses, public.pilot_intake_rate_limits to service_role;

create function public.submit_pilot_intake(
  p_request_id uuid, p_receipt_id uuid, p_payload jsonb, p_payload_hash text, p_rate_hash text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  existing public.pilot_intake_responses%rowtype;
  recent public.pilot_intake_rate_limits%rowtype;
begin
  -- Serializes this small (500-response) pilot only, including concurrent retries.
  perform pg_advisory_xact_lock(1600260926);
  select * into existing from public.pilot_intake_responses where request_id = p_request_id;
  if found then
    if existing.payload_hash <> p_payload_hash or existing.payload <> p_payload then
      return jsonb_build_object('status', 'conflict');
    end if;
    return jsonb_build_object('status', 'saved', 'receipt_id', existing.receipt_id);
  end if;
  if (select count(*) from public.pilot_intake_responses) >= 500 then
    return jsonb_build_object('status', 'full');
  end if;

  delete from public.pilot_intake_rate_limits where window_start < now() - interval '24 hours';
  select * into recent from public.pilot_intake_rate_limits where rate_hash = p_rate_hash;
  -- Allows a shared event Wi-Fi address; no raw IP addresses are persisted.
  if found and recent.window_start > now() - interval '1 hour' and recent.submissions >= 120 then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  insert into public.pilot_intake_rate_limits (rate_hash, window_start, submissions)
  values (p_rate_hash, now(), 1)
  on conflict (rate_hash) do update set
    window_start = case when pilot_intake_rate_limits.window_start <= now() - interval '1 hour'
      then now() else pilot_intake_rate_limits.window_start end,
    submissions = case when pilot_intake_rate_limits.window_start <= now() - interval '1 hour'
      then 1 else pilot_intake_rate_limits.submissions + 1 end;

  insert into public.pilot_intake_responses (request_id, receipt_id, payload_hash, payload)
  values (p_request_id, p_receipt_id, p_payload_hash, p_payload);
  return jsonb_build_object('status', 'saved', 'receipt_id', p_receipt_id);
end;
$$;

revoke all on function public.submit_pilot_intake(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.submit_pilot_intake(uuid, uuid, jsonb, text, text) to service_role;

comment on table public.pilot_intake_responses is 'Private, opt-in HackGT responses for organizer-reviewed matching evaluation. Not authorized for training or Newton processing.';
