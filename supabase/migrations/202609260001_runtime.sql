-- Application runtime. Bryan's research export contract and hardware protocol
-- remain separate and unchanged. All application writes go through the API.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  discoverable boolean not null default false,
  bluetooth_enabled boolean not null default false,
  available boolean not null default true,
  current_profile_version_id uuid,
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.onboarding_sessions (
  session_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress','awaiting_confirmation','completed')),
  turns jsonb not null default '[]' check (jsonb_typeof(turns) = 'array'),
  draft jsonb not null default '{}' check (jsonb_typeof(draft) = 'object'),
  revision integer not null default 0 check (revision >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, session_id)
);
create unique index onboarding_one_active on public.onboarding_sessions(user_id) where status <> 'completed';

create table public.onboarding_answers (
  answer_id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null references public.profiles on delete cascade,
  question_key text not null check (question_key in ('interests','motivation','goals','experiences','open_topics','conversation_style','boundaries')),
  question_text text not null check (length(trim(question_text)) > 0),
  answer_text text not null check (length(trim(answer_text)) > 0),
  answered_at timestamptz not null default now(),
  foreign key (user_id, session_id) references public.onboarding_sessions(user_id, session_id) on delete cascade
);

create table public.profile_versions (
  profile_version_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  onboarding_session_id uuid not null,
  valid_from timestamptz not null default now(),
  data_origin text not null default 'real_opt_in' check (data_origin in ('synthetic','real_opt_in')),
  onboarding_answers jsonb not null check (jsonb_typeof(onboarding_answers) = 'array'),
  current_goal text,
  conversation_intent text check (conversation_intent is null or length(trim(conversation_intent)) > 0),
  facts jsonb not null default '[]' check (jsonb_typeof(facts) = 'array'),
  open_to_discussing text[] not null default '{}',
  conversation_preferences text[] not null default '{}',
  avoid_topics text[] not null default '{}',
  unique(user_id, profile_version_id),
  foreign key (user_id, onboarding_session_id) references public.onboarding_sessions(user_id, session_id) on delete cascade
);
alter table public.profiles add constraint profiles_current_version_owner
  foreign key (user_id, current_profile_version_id)
  references public.profile_versions(user_id, profile_version_id)
  on delete set null (current_profile_version_id) deferrable initially deferred;

create table public.profile_previews (
  user_id uuid primary key references public.profiles on delete cascade,
  enabled boolean not null default false,
  preview jsonb not null default '{}' check (jsonb_typeof(preview) = 'object'),
  updated_at timestamptz not null default now(),
  check ((preview - array['display_name','headline','interests','occupation']) = '{}'::jsonb)
);

create table public.consent_receipts (
  consent_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  purpose text not null check (purpose in ('social_import','personal_matching','model_training')),
  source_ref text,
  policy_version text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= granted_at)
);
create index consent_active_by_user on public.consent_receipts(user_id, purpose) where revoked_at is null;

create table public.user_blocks (
  blocker_user_id uuid not null references public.profiles on delete cascade,
  blocked_user_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  check (blocker_user_id <> blocked_user_id)
);

create table public.presence (
  user_id uuid primary key references public.profiles on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision not null check (accuracy_m between 0 and 10000),
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  location extensions.geography(Point,4326) generated always as
    (extensions.st_setsrid(extensions.st_makepoint(longitude, latitude),4326)::extensions.geography) stored,
  check (expires_at > observed_at and expires_at <= observed_at + interval '30 minutes')
);
create index presence_location_gist on public.presence using gist(location);
create index presence_expiry on public.presence(expires_at);

create table public.phone_ble_sessions (
  session_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > issued_at and expires_at <= issued_at + interval '10 minutes'),
  unique(user_id,session_id)
);
create index phone_ble_active_user on public.phone_ble_sessions(user_id, expires_at) where revoked_at is null;

create table public.encounters (
  encounter_id uuid primary key default gen_random_uuid(),
  observer_user_id uuid not null references public.profiles on delete cascade,
  observed_user_id uuid not null references public.profiles on delete cascade,
  observed_session_id uuid not null references public.phone_ble_sessions on delete cascade,
  observed_at timestamptz not null default now(),
  rssi integer check (rssi between -127 and 20),
  check (observer_user_id <> observed_user_id),
  unique(observer_user_id, observed_session_id),
  foreign key (observed_user_id, observed_session_id) references public.phone_ble_sessions(user_id,session_id) on delete cascade
);

create table public.connection_requests (
  request_id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references public.profiles on delete cascade,
  recipient_user_id uuid not null references public.profiles on delete cascade,
  requester_profile_version_id uuid not null,
  recipient_profile_version_id uuid not null,
  requester_decision text not null default 'pending' check (requester_decision in ('pending','accept','decline','revoke')),
  recipient_decision text not null default 'pending' check (recipient_decision in ('pending','accept','decline','revoke')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (requester_user_id <> recipient_user_id),
  check (expires_at > created_at),
  foreign key (requester_user_id, requester_profile_version_id) references public.profile_versions(user_id, profile_version_id) on delete cascade,
  foreign key (recipient_user_id, recipient_profile_version_id) references public.profile_versions(user_id, profile_version_id) on delete cascade
);
create index connections_participants on public.connection_requests(requester_user_id, recipient_user_id, expires_at);

create table public.feedback (
  feedback_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  viewer_profile_version_id uuid not null,
  candidate_profile_version_id uuid not null references public.profile_versions on delete cascade,
  data_origin text not null default 'real_opt_in' check (data_origin in ('synthetic','real_opt_in')),
  observed_at timestamptz not null default now(),
  context text not null,
  outcomes jsonb not null default '{"connection_accepted":null,"conversation_useful":null,"would_talk_again":null}',
  explicit_comment text,
  foreign key (user_id, viewer_profile_version_id) references public.profile_versions(user_id, profile_version_id) on delete cascade,
  check (jsonb_typeof(outcomes) = 'object' and outcomes ?& array['connection_accepted','conversation_useful','would_talk_again']
    and (outcomes - array['connection_accepted','conversation_useful','would_talk_again']) = '{}'::jsonb
    and jsonb_typeof(outcomes->'connection_accepted') in ('boolean','null')
    and jsonb_typeof(outcomes->'conversation_useful') in ('boolean','null')
    and jsonb_typeof(outcomes->'would_talk_again') in ('boolean','null'))
);

create table public.matching_policies (
  policy_id uuid primary key default gen_random_uuid(),
  policy_version text not null unique,
  onboarding_weight numeric not null default 1.0 check (onboarding_weight between 0 and 1),
  instagram_weight numeric not null default 0.0 check (instagram_weight between 0 and 1),
  missing_instagram_policy text not null default 'onboarding_only' check (missing_instagram_policy = 'onboarding_only'),
  insufficient_onboarding_policy text not null default 'abstain' check (insufficient_onboarding_policy = 'abstain'),
  created_at timestamptz not null default now(),
  check (onboarding_weight + instagram_weight = 1)
);
insert into public.matching_policies(policy_version) values ('onboarding-only-v1');

create table public.matching_jobs (
  job_id uuid primary key default gen_random_uuid(),
  identity_hash text not null unique,
  viewer_id uuid not null references public.profiles on delete cascade,
  candidate_id uuid not null references public.profiles on delete cascade,
  viewer_version_id uuid not null,
  candidate_version_id uuid not null,
  context text not null,
  mode text not null default 'nearby' check (mode in ('nearby','ble')),
  history_version text not null,
  history_cutoff_at timestamptz not null default now(),
  model_id text not null,
  model_revision text not null,
  pipeline_version text not null,
  policy text not null references public.matching_policies(policy_version),
  status text not null default 'pending' check (status in ('pending','running','succeeded','failed','cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  lease_token uuid,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (viewer_id <> candidate_id),
  foreign key (viewer_id, viewer_version_id) references public.profile_versions(user_id, profile_version_id) on delete cascade,
  foreign key (candidate_id, candidate_version_id) references public.profile_versions(user_id, profile_version_id) on delete cascade
);
create index matching_jobs_due on public.matching_jobs(status, next_attempt_at, lease_expires_at);

create table public.match_scores (
  score_id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.matching_jobs on delete cascade,
  viewer_id uuid not null references public.profiles on delete cascade,
  candidate_id uuid not null references public.profiles on delete cascade,
  viewer_profile_version_id uuid not null,
  candidate_profile_version_id uuid not null,
  context text not null,
  history_cutoff_at timestamptz not null,
  prior_feedback_ids uuid[] not null default '{}',
  model_id text not null,
  model_revision text not null,
  pipeline_version text not null,
  policy text not null references public.matching_policies(policy_version),
  status text not null check (status in ('scored','abstained','unavailable')),
  final_score double precision,
  onboarding_score double precision,
  instagram_score double precision,
  applied_onboarding_weight numeric,
  applied_instagram_weight numeric,
  reason text,
  result jsonb not null,
  scored_at timestamptz not null default now(),
  expires_at timestamptz not null,
  foreign key (viewer_id, viewer_profile_version_id) references public.profile_versions(user_id, profile_version_id) on delete cascade,
  foreign key (candidate_id, candidate_profile_version_id) references public.profile_versions(user_id, profile_version_id) on delete cascade,
  check (final_score is null or final_score between 0 and 1),
  check (onboarding_score is null or onboarding_score between 0 and 1),
  check (instagram_score is null or instagram_score between 0 and 1),
  check ((status = 'scored' and final_score is not null and onboarding_score is not null
      and applied_onboarding_weight is not distinct from 1 and applied_instagram_weight is not distinct from 0 and instagram_score is null)
    or (status <> 'scored' and final_score is null and applied_onboarding_weight is null and applied_instagram_weight is null))
);
create index match_scores_viewer_fresh on public.match_scores(viewer_id, expires_at, final_score desc, candidate_id);

create table public.match_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references public.profiles on delete cascade,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);

create table public.provider_oauth_states (
  state_hash text primary key check (length(state_hash) = 64),
  user_id uuid not null references public.profiles on delete cascade,
  provider text not null check (provider = 'spotify'),
  code_verifier_ciphertext text not null,
  redirect_uri text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);
create table public.provider_connections (
  connection_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  provider text not null check (provider = 'spotify'),
  provider_account_id text not null,
  granted_scopes text[] not null default '{}',
  encrypted_token text,
  token_expires_at timestamptz,
  display_data jsonb not null default '{}',
  connected_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(user_id, provider)
);

create function public.initialize_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger initialize_profile after insert on auth.users for each row execute function public.initialize_profile();
insert into public.profiles(user_id) select id from auth.users on conflict do nothing;

create function public.reject_mutation() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Immutable record: append a revision instead' using errcode = '23514'; end;
$$;
create trigger answers_immutable before update on public.onboarding_answers for each row execute function public.reject_mutation();
create trigger versions_immutable before update on public.profile_versions for each row execute function public.reject_mutation();
create trigger feedback_immutable before update on public.feedback for each row execute function public.reject_mutation();
create trigger policies_immutable before update on public.matching_policies for each row execute function public.reject_mutation();

create function public.validate_profile_version() returns trigger language plpgsql set search_path = '' as $$
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
      jsonb_build_object('answer_id',source_answer.answer_id,'question_key',source_answer.question_key,
        'question_text',source_answer.question_text,'answer_text',source_answer.answer_text,'answered_at',source_answer.answered_at)
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
create trigger validate_profile_version before insert on public.profile_versions for each row execute function public.validate_profile_version();

-- Deleting a source for privacy also erases every snapshot containing it.
-- Their foreign keys cascade through scores/jobs/feedback/connections; the
-- owner's current pointer is cleared if that version was active.
create function public.erase_answer_derivatives() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.profile_versions where user_id=old.user_id
    and onboarding_answers @> jsonb_build_array(jsonb_build_object('answer_id',old.answer_id));
  return old;
end;
$$;
create trigger erase_answer_derivatives before delete on public.onboarding_answers for each row execute function public.erase_answer_derivatives();

create function public.start_onboarding(p_user_id uuid) returns public.onboarding_sessions language plpgsql security definer set search_path = '' as $$
declare s public.onboarding_sessions;
begin
  perform 1 from public.profiles where user_id = p_user_id for update;
  if not found then raise exception 'Unknown user'; end if;
  select * into s from public.onboarding_sessions where user_id = p_user_id and status <> 'completed';
  if found then return s; end if;
  insert into public.onboarding_sessions(user_id,turns) values (p_user_id,
    jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'role','assistant','content','What makes you YOU?','created_at',now(),'question_key','interests'))) returning * into s;
  return s;
end;
$$;

create function public.append_onboarding_exchange(p_user_id uuid,p_session_id uuid,p_expected_revision integer,
  p_turns jsonb,p_draft jsonb default null,p_status text default 'in_progress')
returns public.onboarding_sessions language plpgsql security definer set search_path = '' as $$
declare s public.onboarding_sessions;
begin
  if jsonb_typeof(p_turns) <> 'array' or p_status not in ('in_progress','awaiting_confirmation') then raise exception 'Invalid exchange'; end if;
  update public.onboarding_sessions set turns=turns || p_turns, draft=coalesce(p_draft,draft),revision=revision+1,status=p_status
    where session_id=p_session_id and user_id=p_user_id and revision=p_expected_revision and status <> 'completed' returning * into s;
  if not found then raise exception 'Onboarding revision conflict or invalid owner' using errcode='40001'; end if;
  return s;
end;
$$;

create function public.publish_profile(p_user_id uuid,p_session_id uuid,p_profile jsonb,
  p_preview jsonb default '{}',p_settings jsonb default '{}')
returns public.profile_versions language plpgsql security definer set search_path = '' as $$
declare v public.profile_versions; answers jsonb;
begin
  perform 1 from public.profiles where user_id=p_user_id for update;
  perform 1 from public.onboarding_sessions where session_id=p_session_id and user_id=p_user_id for update;
  if not found then raise exception 'Session does not belong to user'; end if;
  if (coalesce((p_settings->>'discoverable')::boolean,false) or coalesce((p_settings->>'bluetooth_enabled')::boolean,false))
    and not public.matching_consent(p_user_id) then raise exception 'Discovery requires personal matching consent'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('answer_id',a.answer_id,'question_key',a.question_key,
    'question_text',a.question_text,'answer_text',a.answer_text,'answered_at',a.answered_at) order by a.answered_at,a.answer_id),'[]') into answers
    from public.onboarding_answers a where a.user_id=p_user_id and a.session_id=p_session_id
      and (not (p_profile ? 'answer_ids') or p_profile->'answer_ids' ? a.answer_id::text);
  insert into public.profile_versions(user_id,onboarding_session_id,data_origin,onboarding_answers,current_goal,conversation_intent,facts,
    open_to_discussing,conversation_preferences,avoid_topics)
    values(p_user_id,p_session_id,'real_opt_in',answers,p_profile->>'current_goal',p_profile->>'conversation_intent',coalesce(p_profile->'facts','[]'),
      array(select jsonb_array_elements_text(coalesce(p_profile->'open_to_discussing','[]'))),
      array(select jsonb_array_elements_text(coalesce(p_profile->'conversation_preferences','[]'))),
      array(select jsonb_array_elements_text(coalesce(p_profile->'avoid_topics','[]')))) returning * into v;
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

create function public.matching_consent(p_user_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.consent_receipts where user_id=p_user_id and purpose='personal_matching' and revoked_at is null and granted_at <= now());
$$;

create function public.eligible_pair(p_viewer_id uuid,p_candidate_id uuid,p_mode text default 'nearby')
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select
    v.user_id <> c.user_id and v.available and c.available
    and v.current_profile_version_id is not null and c.current_profile_version_id is not null
    and public.matching_consent(v.user_id) and public.matching_consent(c.user_id)
    and not exists(select 1 from public.user_blocks b where
      (b.blocker_user_id=v.user_id and b.blocked_user_id=c.user_id) or (b.blocker_user_id=c.user_id and b.blocked_user_id=v.user_id))
    and (coalesce(v.settings#>'{hard_filters,conversation_intents}','[]'::jsonb) = '[]'::jsonb
      or (v.settings#>'{hard_filters,conversation_intents}') ? coalesce(c.settings->>'matching_context','casual_chat'))
    and (coalesce(c.settings#>'{hard_filters,conversation_intents}','[]'::jsonb) = '[]'::jsonb
      or (c.settings#>'{hard_filters,conversation_intents}') ? coalesce(v.settings->>'matching_context','casual_chat'))
    and case p_mode
      when 'nearby' then v.discoverable and c.discoverable and exists (
        select 1 from public.presence vp,public.presence cp where vp.user_id=v.user_id and cp.user_id=c.user_id
          and vp.expires_at > now() and cp.expires_at > now()
          and vp.observed_at <= now() + interval '5 seconds' and cp.observed_at <= now() + interval '5 seconds'
          and extensions.st_dwithin(vp.location,cp.location,3218.688))
      when 'ble' then v.bluetooth_enabled and c.bluetooth_enabled
        and exists(select 1 from public.phone_ble_sessions s where s.user_id=v.user_id and s.revoked_at is null and s.issued_at<=now() and s.expires_at>now())
        and exists(select 1 from public.phone_ble_sessions s where s.user_id=c.user_id and s.revoked_at is null and s.issued_at<=now() and s.expires_at>now())
      when 'connection' then true
      else false end
    from public.profiles v join public.profile_versions vv on vv.profile_version_id=v.current_profile_version_id
      cross join public.profiles c join public.profile_versions cv on cv.profile_version_id=c.current_profile_version_id
    where v.user_id=p_viewer_id and c.user_id=p_candidate_id),false);
$$;

create function public.nearby_candidates(p_viewer_id uuid,p_radius_m double precision default 3218.688)
returns table(user_id uuid,profile_version_id uuid,distance_m double precision,preview jsonb)
language sql stable security definer set search_path = '' as $$
  select p.user_id,p.current_profile_version_id,extensions.st_distance(v.location,c.location),pr.preview
    from public.presence v join public.presence c on extensions.st_dwithin(v.location,c.location,least(greatest(p_radius_m,0),3218.688))
      join public.profiles p on p.user_id=c.user_id join public.profile_previews pr on pr.user_id=p.user_id and pr.enabled
    where v.user_id=p_viewer_id and public.eligible_pair(p_viewer_id,p.user_id,'nearby')
    order by extensions.st_distance(v.location,c.location),p.user_id;
$$;

create function public.request_connection(p_requester_id uuid,p_recipient_id uuid,p_lifetime_seconds integer default 86400,p_mode text default 'nearby')
returns public.connection_requests language plpgsql security definer set search_path = '' as $$
declare r public.connection_requests;
begin
  -- Serialize either direction for a pair, preventing simultaneous duplicate requests.
  perform pg_advisory_xact_lock(hashtextextended(least(p_requester_id::text,p_recipient_id::text)||greatest(p_requester_id::text,p_recipient_id::text),0));
  if p_mode not in ('nearby','ble') or not public.eligible_pair(p_requester_id,p_recipient_id,p_mode) or
    (p_mode='nearby' and not exists(select 1 from public.profile_previews where user_id=p_recipient_id and enabled)) or
    (p_mode='ble' and not exists(select 1 from public.encounters
      where observer_user_id=p_requester_id and observed_user_id=p_recipient_id and observed_at>now()-interval '5 minutes'))
    then raise exception 'Pair is not eligible'; end if;
  select * into r from public.connection_requests where expires_at>now()
    and requester_decision in ('pending','accept') and recipient_decision in ('pending','accept')
    and ((requester_user_id=p_requester_id and recipient_user_id=p_recipient_id) or (requester_user_id=p_recipient_id and recipient_user_id=p_requester_id))
    and requester_profile_version_id=(select current_profile_version_id from public.profiles where user_id=requester_user_id)
    and recipient_profile_version_id=(select current_profile_version_id from public.profiles where user_id=recipient_user_id)
    order by created_at desc limit 1;
  if found then return r; end if;
  insert into public.connection_requests(requester_user_id,recipient_user_id,requester_profile_version_id,recipient_profile_version_id,requester_decision,expires_at)
    select p_requester_id,p_recipient_id,v.current_profile_version_id,c.current_profile_version_id,'accept',now()+make_interval(secs=>least(greatest(p_lifetime_seconds,60),86400))
    from public.profiles v,public.profiles c where v.user_id=p_requester_id and c.user_id=p_recipient_id returning * into r;
  return r;
end;
$$;

create function public.decide_connection(p_user_id uuid,p_request_id uuid,p_decision text)
returns public.connection_requests language plpgsql security definer set search_path = '' as $$
declare r public.connection_requests;
begin
  if p_decision not in ('accept','decline','revoke') then raise exception 'Invalid decision'; end if;
  select * into r from public.connection_requests where request_id=p_request_id and p_user_id in (requester_user_id,recipient_user_id) for update;
  if not found then raise exception 'Request not found'; end if;
  if p_decision='accept' and (r.expires_at<=now() or r.requester_decision in ('decline','revoke') or r.recipient_decision in ('decline','revoke')
    or not public.eligible_pair(r.requester_user_id,r.recipient_user_id,'connection')
    or r.requester_profile_version_id is distinct from (select current_profile_version_id from public.profiles where user_id=r.requester_user_id)
    or r.recipient_profile_version_id is distinct from (select current_profile_version_id from public.profiles where user_id=r.recipient_user_id))
    then raise exception 'Request is no longer eligible'; end if;
  update public.connection_requests set
    requester_decision=case when p_user_id=requester_user_id then p_decision else requester_decision end,
    recipient_decision=case when p_user_id=recipient_user_id then p_decision else recipient_decision end,updated_at=now()
    where request_id=p_request_id returning * into r;
  return r;
end;
$$;

create function public.claim_matching_jobs(p_limit integer default 10,p_lease_seconds integer default 120)
returns setof public.matching_jobs language plpgsql security definer set search_path = '' as $$
begin
  update public.matching_jobs set status='failed',error='retry_limit',lease_token=null,lease_expires_at=null,updated_at=now()
    where attempts>=5 and status='running' and lease_expires_at<=now();
  return query with claimed as (
    select job_id from public.matching_jobs where attempts<5 and
      ((status='pending' and next_attempt_at<=now()) or (status='running' and lease_expires_at<=now()))
      order by next_attempt_at,job_id for update skip locked limit least(greatest(p_limit,1),100)
  ) update public.matching_jobs j set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(secs=>least(greatest(p_lease_seconds,10),600)),updated_at=now()
    from claimed where j.job_id=claimed.job_id returning j.*;
end;
$$;

create function public.publish_matching_result(p_job_id uuid,p_lease_token uuid,p_result jsonb,p_ttl_seconds integer default 300)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.matching_jobs; result_status text; score double precision;
begin
  select * into j from public.matching_jobs where job_id=p_job_id and status='running' and lease_token=p_lease_token and lease_expires_at>now() for update;
  if not found then return false; end if;
  if not public.eligible_pair(j.viewer_id,j.candidate_id,j.mode)
    or j.viewer_version_id is distinct from (select current_profile_version_id from public.profiles where user_id=j.viewer_id)
    or j.candidate_version_id is distinct from (select current_profile_version_id from public.profiles where user_id=j.candidate_id)
    then update public.matching_jobs set status='cancelled',lease_token=null,lease_expires_at=null,updated_at=now() where job_id=j.job_id; return false; end if;
  result_status := p_result->>'status';
  if result_status not in ('scored','abstained','unavailable') or result_status is null then raise exception 'Invalid score status'; end if;
  score := coalesce(p_result->>'final_score',p_result->>'score')::double precision;
  if (result_status='scored' and (score is null or not(score between 0 and 1))) or (result_status<>'scored' and score is not null)
    then raise exception 'Invalid result score'; end if;
  insert into public.match_scores(job_id,viewer_id,candidate_id,viewer_profile_version_id,candidate_profile_version_id,context,history_cutoff_at,
    model_id,model_revision,pipeline_version,policy,status,final_score,onboarding_score,applied_onboarding_weight,applied_instagram_weight,reason,result,expires_at)
    values(j.job_id,j.viewer_id,j.candidate_id,j.viewer_version_id,j.candidate_version_id,j.context,j.history_cutoff_at,
      j.model_id,j.model_revision,j.pipeline_version,j.policy,result_status,score,score,
      case when result_status='scored' then 1 end,case when result_status='scored' then 0 end,p_result->>'reason',p_result,
      now()+make_interval(secs=>least(greatest(p_ttl_seconds,1),600)))
    on conflict(job_id) do update set status=excluded.status,final_score=excluded.final_score,onboarding_score=excluded.onboarding_score,
      applied_onboarding_weight=excluded.applied_onboarding_weight,applied_instagram_weight=excluded.applied_instagram_weight,
      reason=excluded.reason,result=excluded.result,scored_at=now(),expires_at=excluded.expires_at;
  update public.matching_jobs set status='succeeded',result=p_result,lease_token=null,lease_expires_at=null,updated_at=now() where job_id=j.job_id;
  delete from public.match_snapshots where viewer_id=j.viewer_id;
  return true;
end;
$$;

create function public.fail_matching_job(p_job_id uuid,p_lease_token uuid,p_error text,p_retry_seconds integer default 30)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.matching_jobs set status=case when attempts>=5 then 'failed' else 'pending' end,error=left(p_error,1000),
    next_attempt_at=now()+make_interval(secs=>least(greatest(p_retry_seconds,1),3600)),lease_token=null,lease_expires_at=null,updated_at=now()
    where job_id=p_job_id and status='running' and lease_token=p_lease_token and lease_expires_at>now();
  return found;
end;
$$;

create function public.consume_oauth_state(p_state_hash text)
returns public.provider_oauth_states language plpgsql security definer set search_path = '' as $$
declare s public.provider_oauth_states;
begin
  update public.provider_oauth_states set consumed_at=now() where state_hash=p_state_hash and consumed_at is null and expires_at>now() returning * into s;
  if not found then raise exception 'Expired or consumed OAuth state'; end if;
  return s;
end;
$$;

create table public.matching_invalidations (
  user_id uuid primary key references public.profiles on delete cascade,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
create function public.invalidate_user_matches(p_user_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.match_scores where viewer_id=p_user_id or candidate_id=p_user_id;
  update public.matching_jobs set status='cancelled',lease_token=null,lease_expires_at=null,updated_at=now()
    where (viewer_id=p_user_id or candidate_id=p_user_id) and status in ('pending','running');
  delete from public.match_snapshots where viewer_id=p_user_id or exists(select 1 from jsonb_array_elements(items) item
    where item->>'user_id'=p_user_id::text or item->>'candidate_id'=p_user_id::text);
  insert into public.matching_invalidations(user_id) select p_user_id where exists(select 1 from public.profiles where user_id=p_user_id)
    on conflict(user_id) do update set revision=public.matching_invalidations.revision+1,updated_at=now();
end;
$$;

create function public.invalidate_runtime_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid; other uuid;
begin
  if tg_table_name='user_blocks' then
    actor:=case when tg_op='DELETE' then old.blocker_user_id else new.blocker_user_id end;
    other:=case when tg_op='DELETE' then old.blocked_user_id else new.blocked_user_id end;
  else actor:=case when tg_op='DELETE' then old.user_id else new.user_id end; end if;
  perform public.invalidate_user_matches(actor);
  if other is not null then
    perform public.invalidate_user_matches(other);
    if tg_op='INSERT' then update public.connection_requests set requester_decision='revoke',recipient_decision='revoke',updated_at=now()
      where (requester_user_id=actor and recipient_user_id=other) or (requester_user_id=other and recipient_user_id=actor); end if;
  end if;
  if tg_table_name='profiles' and tg_op='UPDATE' then
    if not new.bluetooth_enabled or not new.available or new.current_profile_version_id is null then
      update public.phone_ble_sessions set revoked_at=now() where user_id=actor and revoked_at is null;
    end if;
    if not new.discoverable then delete from public.presence where user_id=actor; end if;
  elsif tg_table_name='consent_receipts' then
    if not public.matching_consent(actor) then
      update public.phone_ble_sessions set revoked_at=now() where user_id=actor and revoked_at is null;
      update public.connection_requests set requester_decision='revoke',recipient_decision='revoke',updated_at=now()
        where requester_user_id=actor or recipient_user_id=actor;
      update public.profiles set discoverable=false,bluetooth_enabled=false,updated_at=now() where user_id=actor and (discoverable or bluetooth_enabled);
    end if;
  end if;
  return null;
end;
$$;

create trigger profiles_invalidate after update on public.profiles for each row execute function public.invalidate_runtime_change();
create trigger presence_invalidate after insert or update or delete on public.presence for each row execute function public.invalidate_runtime_change();
create trigger previews_invalidate after insert or update or delete on public.profile_previews for each row execute function public.invalidate_runtime_change();
create trigger consent_invalidate after insert or update or delete on public.consent_receipts for each row execute function public.invalidate_runtime_change();
create trigger blocks_invalidate after insert or delete on public.user_blocks for each row execute function public.invalidate_runtime_change();
create trigger feedback_invalidate after insert or delete on public.feedback for each row execute function public.invalidate_runtime_change();

-- RLS protects direct PostgREST access too. No app client gets table mutation
-- grants or permission to invoke service RPCs with an arbitrary caller UUID.
do $$
declare t text;
begin
  foreach t in array array['profiles','onboarding_sessions','onboarding_answers','profile_versions','profile_previews','consent_receipts',
    'user_blocks','presence','phone_ble_sessions','encounters','connection_requests','feedback','matching_policies','matching_jobs','match_scores',
    'match_snapshots','provider_oauth_states','provider_connections','matching_invalidations'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  foreach t in array array['profiles','onboarding_sessions','onboarding_answers','profile_versions','profile_previews','consent_receipts','presence','feedback'] loop
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy owner_read on public.%I for select to authenticated using ((select auth.uid()) = user_id)',t);
  end loop;
end;
$$;
grant select on public.user_blocks,public.connection_requests to authenticated;
create policy blocker_read on public.user_blocks for select to authenticated using ((select auth.uid())=blocker_user_id);
create policy participant_read on public.connection_requests for select to authenticated
  using ((select auth.uid()) in (requester_user_id,recipient_user_id));

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('initialize_profile','reject_mutation','validate_profile_version','erase_answer_derivatives','start_onboarding',
      'append_onboarding_exchange','publish_profile','matching_consent','eligible_pair','nearby_candidates','request_connection','decide_connection',
      'claim_matching_jobs','publish_matching_result','fail_matching_job','consume_oauth_state','invalidate_user_matches','invalidate_runtime_change') loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end;
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('profile-imports','profile-imports',false,20971520,array['image/jpeg','image/png','image/heic','application/zip','application/json']),
  ('profile-photos','profile-photos',false,10485760,array['image/jpeg','image/png','image/heic'])
  on conflict(id) do nothing;
create policy private_upload_read on storage.objects for select to authenticated
  using (bucket_id in ('profile-imports','profile-photos') and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy private_upload_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('profile-imports','profile-photos') and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy private_upload_delete on storage.objects for delete to authenticated
  using (bucket_id in ('profile-imports','profile-photos') and (storage.foldername(name))[1]=(select auth.uid())::text);
