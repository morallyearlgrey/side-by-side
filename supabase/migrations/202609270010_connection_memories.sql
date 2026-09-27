-- Retain only the preview and facts deliberately shared when both people accept.
-- Neither matching-only evidence nor raw onboarding answers enter this table.
create table public.connection_memories (
  request_id uuid not null references public.connection_requests on delete cascade,
  owner_user_id uuid not null references public.profiles on delete cascade,
  peer_user_id uuid not null references public.profiles on delete cascade,
  peer_preview jsonb not null,
  shared_facts jsonb not null,
  common_interests jsonb not null,
  captured_at timestamptz not null default now(),
  primary key(request_id,owner_user_id),
  check (owner_user_id <> peer_user_id),
  check (jsonb_typeof(peer_preview)='object' and jsonb_typeof(shared_facts)='array'
    and jsonb_typeof(common_interests)='array')
);
create table public.connection_match_ideas (
  request_id uuid not null references public.connection_requests on delete cascade,
  owner_user_id uuid not null references public.profiles on delete cascade,
  ideas jsonb not null check (jsonb_typeof(ideas)='object' and ideas->>'status'='ready'
    and jsonb_typeof(ideas->'activities')='array'),
  saved_at timestamptz not null default now(),
  primary key(request_id,owner_user_id)
);
alter table public.connection_memories enable row level security;
alter table public.connection_match_ideas enable row level security;
revoke all on public.connection_memories,public.connection_match_ideas from public,anon,authenticated;
grant all on public.connection_memories,public.connection_match_ideas to service_role;

create function public.capture_connection_memory()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid; peer_id uuid; owner_preview jsonb; peer_preview jsonb;
  peer_version uuid; facts jsonb; common jsonb;
begin
  if new.accepted_at is null or (tg_op='UPDATE' and old.accepted_at is not null) then
    return new;
  end if;
  if not public.eligible_pair(new.requester_user_id,new.recipient_user_id,'connection') then
    return new;
  end if;
  for owner_id,peer_id,peer_version in
    select new.requester_user_id,new.recipient_user_id,new.recipient_profile_version_id
    union all
    select new.recipient_user_id,new.requester_user_id,new.requester_profile_version_id
  loop
    select preview into owner_preview from public.profile_previews where user_id=owner_id and enabled;
    select preview into peer_preview from public.profile_previews where user_id=peer_id and enabled;
    if owner_preview is null or peer_preview is null then continue; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'topic',f->'topic','relationship',f->'relationship',
      'details',f->'details','motivation',f->'motivation')),'[]'::jsonb)
      into facts from public.profile_versions v
      cross join lateral jsonb_array_elements(v.facts) f
      where v.user_id=peer_id and v.profile_version_id=peer_version
        and f->>'confirmation'='confirmed' and f->>'sharing_scope'='after_mutual_consent';
    select coalesce(jsonb_agg(distinct peer_interest.value),'[]'::jsonb) into common
      from jsonb_array_elements_text(case when jsonb_typeof(peer_preview->'interests')='array'
        then peer_preview->'interests' else '[]'::jsonb end) peer_interest(value)
      where exists(select 1 from jsonb_array_elements_text(
        case when jsonb_typeof(owner_preview->'interests')='array'
          then owner_preview->'interests' else '[]'::jsonb end) own_interest(value)
        where lower(trim(own_interest.value))=lower(trim(peer_interest.value)));
    insert into public.connection_memories
      (request_id,owner_user_id,peer_user_id,peer_preview,shared_facts,common_interests,captured_at)
      values(new.request_id,owner_id,peer_id,
        peer_preview - array['enabled'],facts,common,new.accepted_at)
      on conflict(request_id,owner_user_id) do nothing;
  end loop;
  return new;
end;
$$;
revoke all on function public.capture_connection_memory() from public,anon,authenticated;
create trigger connection_memory_on_accept
  after insert or update on public.connection_requests
  for each row execute function public.capture_connection_memory();

-- Save server-validated ideas seen on a pending invitation or accepted match.
-- The client never supplies this payload directly; only the API service role can call it.
create function public.save_connection_match_ideas(p_user_id uuid,p_request_id uuid,p_ideas jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare projected jsonb;
begin
  projected:=public.navigation_connection(p_user_id,p_request_id);
  if projected is null or projected->>'status' not in ('pending','accepted')
    or p_ideas->>'status' is distinct from 'ready'
    or jsonb_typeof(p_ideas->'activities') is distinct from 'array'
    or length(p_ideas::text)>30000 then
    raise exception 'Connection ideas unavailable' using errcode='42501';
  end if;
  insert into public.connection_match_ideas(request_id,owner_user_id,ideas)
    values(p_request_id,p_user_id,p_ideas)
    on conflict(request_id,owner_user_id) do update
    set ideas=excluded.ideas,saved_at=now();
end;
$$;
revoke all on function public.save_connection_match_ideas(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_connection_match_ideas(uuid,uuid,jsonb) to service_role;

-- Old accepted rows had no approval-time snapshot. Do not invent one from a
-- current preview; future acceptance records are captured by the trigger.
create function public.navigation_connection_memory(p_user_id uuid,p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.connection_requests; peer_id uuid; memory public.connection_memories;
  saved_ideas jsonb; saved_at timestamptz;
begin
  select * into r from public.connection_requests where request_id=p_request_id
    and accepted_at is not null and p_user_id in (requester_user_id,recipient_user_id);
  if not found then return null; end if;
  peer_id:=case when p_user_id=r.requester_user_id then r.recipient_user_id else r.requester_user_id end;
  if r.requester_decision<>'accept' or r.recipient_decision<>'accept'
    or not public.eligible_pair(p_user_id,peer_id,'connection')
    or not exists(select 1 from public.profile_previews where user_id=p_user_id and enabled)
    or not exists(select 1 from public.profile_previews where user_id=peer_id and enabled) then
    return null;
  end if;
  select * into memory from public.connection_memories
    where request_id=p_request_id and owner_user_id=p_user_id;
  if not found then return jsonb_build_object('available',false); end if;
  select i.ideas,i.saved_at into saved_ideas,saved_at from public.connection_match_ideas i
    where i.request_id=p_request_id and i.owner_user_id in (p_user_id,peer_id)
    order by case when i.owner_user_id=p_user_id then 0 else 1 end limit 1;
  return jsonb_build_object('available',true,'captured_at',memory.captured_at,
    'preview',memory.peer_preview,'facts',memory.shared_facts,
    'common_interests',memory.common_interests,'ideas',saved_ideas,'ideas_saved_at',saved_at);
end;
$$;
revoke all on function public.navigation_connection_memory(uuid,uuid) from public,anon,authenticated;
grant execute on function public.navigation_connection_memory(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
