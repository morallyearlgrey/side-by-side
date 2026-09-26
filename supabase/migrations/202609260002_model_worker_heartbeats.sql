-- Authenticated backend/worker readiness only. These records do not grant
-- scoring permission or expose user profiles/model credentials to clients.
create table public.model_worker_heartbeats (
  worker_id uuid primary key default gen_random_uuid(),
  model_id text not null,
  model_revision text not null,
  pipeline_version text not null,
  status text not null check (status in ('ready','unavailable')),
  reason text,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > updated_at and expires_at <= updated_at + interval '5 minutes'),
  check (updated_at <= now() + interval '5 seconds')
);
create index model_worker_ready on public.model_worker_heartbeats(model_id,model_revision,pipeline_version,expires_at)
  where status='ready';
alter table public.model_worker_heartbeats enable row level security;
revoke all on public.model_worker_heartbeats from public,anon,authenticated;
grant all on public.model_worker_heartbeats to service_role;
