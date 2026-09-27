-- Private preferences remain editable after a connection expires. Deletion is
-- pair-wide and removes connection records; a minimal version-scoped dismissal
-- prevents automatic discovery from recreating the deleted pair immediately.
create table public.connection_pair_dismissals (
  lower_user_id uuid not null references public.profiles on delete cascade,
  upper_user_id uuid not null references public.profiles on delete cascade,
  lower_version_id uuid not null,
  upper_version_id uuid not null,
  dismissed_by uuid not null references public.profiles on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (lower_user_id,upper_user_id,lower_version_id,upper_version_id),
  check (lower_user_id < upper_user_id),
  check (dismissed_by in (lower_user_id,upper_user_id))
);
alter table public.connection_pair_dismissals enable row level security;
revoke all on public.connection_pair_dismissals from public,anon,authenticated;
grant all on public.connection_pair_dismissals to service_role;

create function public.connection_history_preference(
  p_user_id uuid,p_request_id uuid,p_preference text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.connection_requests; peer uuid; own_version uuid; peer_version uuid;
begin
  if p_preference not in ('liked','disliked') then
    raise exception 'Invalid preference' using errcode='22023';
  end if;
  select * into r from public.connection_requests
    where request_id=p_request_id and accepted_at is not null
      and p_user_id in (requester_user_id,recipient_user_id) for update;
  if not found then raise exception 'Connection unavailable' using errcode='42501'; end if;
  if p_user_id=r.requester_user_id then
    peer:=r.recipient_user_id;
    own_version:=r.requester_profile_version_id;
    peer_version:=r.recipient_profile_version_id;
  else
    peer:=r.requester_user_id;
    own_version:=r.recipient_profile_version_id;
    peer_version:=r.requester_profile_version_id;
  end if;
  insert into public.match_preferences(user_id,candidate_id,viewer_version_id,candidate_version_id,preference)
    values(p_user_id,peer,own_version,peer_version,p_preference)
    on conflict(user_id,candidate_id,viewer_version_id,candidate_version_id)
    do update set preference=excluded.preference,updated_at=now();
  return jsonb_build_object('preference',p_preference);
end;
$$;
revoke all on function public.connection_history_preference(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.connection_history_preference(uuid,uuid,text) to service_role;

create function public.delete_connection_history(p_user_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.connection_requests; peer uuid; lower_id uuid; upper_id uuid;
  lower_version uuid; upper_version uuid; deleted_count integer;
begin
  select * into r from public.connection_requests where request_id=p_request_id
    and accepted_at is not null and p_user_id in (requester_user_id,recipient_user_id);
  if not found then raise exception 'Connection unavailable' using errcode='42501'; end if;
  peer:=case when p_user_id=r.requester_user_id then r.recipient_user_id else r.requester_user_id end;
  lower_id:=least(p_user_id,peer); upper_id:=greatest(p_user_id,peer);
  perform pg_advisory_xact_lock(hashtextextended(lower_id::text||upper_id::text,0));
  select * into r from public.connection_requests where request_id=p_request_id
    and accepted_at is not null and p_user_id in (requester_user_id,recipient_user_id) for update;
  if not found then raise exception 'Connection unavailable' using errcode='42501'; end if;
  select current_profile_version_id into lower_version from public.profiles where user_id=lower_id;
  select current_profile_version_id into upper_version from public.profiles where user_id=upper_id;
  if lower_version is not null and upper_version is not null then
    insert into public.connection_pair_dismissals(lower_user_id,upper_user_id,lower_version_id,upper_version_id,dismissed_by)
      values(lower_id,upper_id,lower_version,upper_version,p_user_id)
      on conflict(lower_user_id,upper_user_id,lower_version_id,upper_version_id)
      do update set dismissed_by=excluded.dismissed_by,dismissed_at=now();
  end if;
  delete from public.connection_requests where
    (requester_user_id=lower_id and recipient_user_id=upper_id)
    or (requester_user_id=upper_id and recipient_user_id=lower_id);
  get diagnostics deleted_count=row_count;
  delete from public.match_preferences where
    (user_id=lower_id and candidate_id=upper_id)
    or (user_id=upper_id and candidate_id=lower_id);
  return jsonb_build_object('deleted',deleted_count);
end;
$$;
revoke all on function public.delete_connection_history(uuid,uuid) from public,anon,authenticated;
grant execute on function public.delete_connection_history(uuid,uuid) to service_role;

-- Keep explicit re-invitations possible, while suppressing automatic suggestions
-- for the profile versions that existed when the connection was deleted.
alter function public.suggest_connection_pair(uuid,uuid,integer,text)
  rename to suggest_connection_pair_unsuppressed;
create function public.suggest_connection_pair(
  p_viewer_id uuid,p_candidate_id uuid,
  p_lifetime_seconds integer default 86400,p_mode text default 'nearby'
) returns public.connection_requests language plpgsql security definer set search_path='' as $$
declare lower_id uuid; upper_id uuid; suggested public.connection_requests;
begin
  lower_id:=least(p_viewer_id,p_candidate_id);
  upper_id:=greatest(p_viewer_id,p_candidate_id);
  perform pg_advisory_xact_lock(hashtextextended(lower_id::text||upper_id::text,0));
  if exists (
    select 1 from public.connection_pair_dismissals d
      join public.profiles l on l.user_id=d.lower_user_id
      join public.profiles u on u.user_id=d.upper_user_id
    where d.lower_user_id=lower_id and d.upper_user_id=upper_id
      and d.lower_version_id=l.current_profile_version_id
      and d.upper_version_id=u.current_profile_version_id
  ) then return null; end if;
  suggested:=public.suggest_connection_pair_unsuppressed(
    p_viewer_id,p_candidate_id,p_lifetime_seconds,p_mode);
  return suggested;
end;
$$;
revoke all on function public.suggest_connection_pair(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.suggest_connection_pair(uuid,uuid,integer,text) to service_role;
notify pgrst, 'reload schema';
