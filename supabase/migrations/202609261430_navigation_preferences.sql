-- Isolated, additive navigation support. Apply only after review and migrations 001-011.
-- Preferences are private UI choices, never conversation outcomes or training labels.
create table public.match_preferences (
  user_id uuid not null references public.profiles on delete cascade,
  candidate_id uuid not null references public.profiles on delete cascade,
  viewer_version_id uuid not null,
  candidate_version_id uuid not null,
  preference text not null check (preference in ('liked','disliked')),
  updated_at timestamptz not null default now(),
  primary key(user_id,candidate_id,viewer_version_id,candidate_version_id),
  check(user_id <> candidate_id),
  foreign key(user_id,viewer_version_id) references public.profile_versions(user_id,profile_version_id) on delete cascade,
  foreign key(candidate_id,candidate_version_id) references public.profile_versions(user_id,profile_version_id) on delete cascade
);
alter table public.match_preferences enable row level security;
create policy preference_owner_read on public.match_preferences for select to authenticated using(user_id=auth.uid());
revoke all on public.match_preferences from anon, authenticated;
grant select on public.match_preferences to authenticated;
grant all on public.match_preferences to service_role;

create function public.navigation_connection(p_user_id uuid,p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.connection_requests; peer uuid; own_version uuid; peer_version uuid;
  state text := 'pending'; preview jsonb; shared jsonb; preference text;
begin
  select * into r from public.connection_requests where request_id=p_request_id
    and p_user_id in (requester_user_id,recipient_user_id);
  if not found then return null; end if;
  peer:=case when p_user_id=r.requester_user_id then r.recipient_user_id else r.requester_user_id end;
  own_version:=case when p_user_id=r.requester_user_id then r.requester_profile_version_id else r.recipient_profile_version_id end;
  peer_version:=case when p_user_id=r.requester_user_id then r.recipient_profile_version_id else r.requester_profile_version_id end;
  if r.expires_at<=now() or not public.eligible_pair(p_user_id,peer,'connection') then state:='unavailable';
  elsif not exists(select 1 from public.profiles where user_id=p_user_id and current_profile_version_id=own_version)
    or not exists(select 1 from public.profiles where user_id=peer and current_profile_version_id=peer_version) then state:='profile_changed';
  elsif 'revoke' in (r.requester_decision,r.recipient_decision) then state:='revoked';
  elsif 'decline' in (r.requester_decision,r.recipient_decision) then state:='declined';
  elsif r.requester_decision='accept' and r.recipient_decision='accept' then state:='accepted';
  end if;
  -- Redaction precedes search as well as display, including terminal connections.
  if state in ('pending','accepted') then
    select pr.preview into preview from public.profile_previews pr where pr.user_id=peer and pr.enabled;
  end if;
  if state='accepted' then
    select jsonb_build_object('facts',coalesce(jsonb_agg(jsonb_build_object(
      'topic',f->'topic','relationship',f->'relationship','details',f->'details','motivation',f->'motivation')),'[]')) into shared
      from public.profile_versions v cross join lateral jsonb_array_elements(v.facts) f
      where v.user_id=peer and v.profile_version_id=peer_version
      and f->>'confirmation'='confirmed' and f->>'sharing_scope'='after_mutual_consent';
  end if;
  select m.preference into preference from public.match_preferences m where m.user_id=p_user_id and m.candidate_id=peer
    and m.viewer_version_id=own_version and m.candidate_version_id=peer_version;
  return jsonb_build_object('request_id',r.request_id,'requester_id',r.requester_user_id,'recipient_id',r.recipient_user_id,
    'requester_decision',case r.requester_decision when 'accept' then 'accepted' when 'revoke' then 'revoked' when 'decline' then 'declined' else 'pending' end,
    'recipient_decision',case r.recipient_decision when 'accept' then 'accepted' when 'revoke' then 'revoked' when 'decline' then 'declined' else 'pending' end,
    'created_at',r.created_at,'expires_at',r.expires_at,'status',state,'preview',preview,'shared_profile',shared,
    'candidate_id',peer,'viewer_version_id',own_version,'candidate_version_id',peer_version,'preference',preference);
end;
$$;

create function public.navigation_connections_page(p_user_id uuid,p_query text default '',p_filter text default 'all',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if p_page<1 or p_page>1000000 or length(p_query)>200 or p_filter not in ('all','liked','disliked') then
    raise exception 'Invalid page query' using errcode='22023'; end if;
  with projected as materialized (
    select public.navigation_connection(p_user_id,r.request_id) item from public.connection_requests r
      where p_user_id in (r.requester_user_id,r.recipient_user_id)
  ), searchable as (
    select item, concat_ws(' ',item#>>'{preview,display_name}',item#>>'{preview,interests}',
      item#>>'{shared_profile,facts}') searchable from projected
  ), ranked as (
    select item, ts_rank_cd(to_tsvector('simple',searchable),plainto_tsquery('simple',p_query))
      + case when lower(coalesce(item#>>'{preview,display_name}',''))=lower(trim(p_query)) then 2 else 0 end relevance
      from searchable where (p_filter='all' or item->>'preference'=p_filter)
        and (trim(p_query)='' or to_tsvector('simple',searchable) @@ plainto_tsquery('simple',p_query)
          or strpos(lower(searchable),lower(trim(p_query)))>0)
  ), totals as (select count(*)::integer total,greatest(1,ceil(count(*)/6.0)::integer) pages from ranked),
  page as (select item from ranked order by relevance desc,(item->>'created_at')::timestamptz desc,item->>'request_id'
    limit 6 offset (select (least(p_page,pages)-1)*6 from totals))
  select jsonb_build_object('items',coalesce((select jsonb_agg(item) from page),'[]'),
    'total',total,'page',least(p_page,pages),'pages',pages,'page_size',6) into result from totals;
  return result;
end;
$$;

create function public.navigation_preference(p_user_id uuid,p_candidate_id uuid,p_viewer_version_id uuid,
  p_candidate_version_id uuid,p_preference text,p_mode text,p_connection_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare connection jsonb; result public.match_preferences;
begin
  -- Serialize against profile/consent changes; direct client writes are not granted.
  perform 1 from public.profiles where user_id in (p_user_id,p_candidate_id) order by user_id for update;
  if p_preference not in ('liked','disliked') or not public.eligible_pair(p_user_id,p_candidate_id,'connection')
    or not exists(select 1 from public.profiles where user_id=p_user_id and current_profile_version_id=p_viewer_version_id)
    or not exists(select 1 from public.profiles where user_id=p_candidate_id and current_profile_version_id=p_candidate_version_id)
    then raise exception 'Preference unavailable' using errcode='42501'; end if;
  if p_connection_id is not null then
    connection:=public.navigation_connection(p_user_id,p_connection_id);
    if connection is null or connection->>'status' not in ('pending','accepted')
      or connection->>'candidate_id'<>p_candidate_id::text
      or connection->>'viewer_version_id'<>p_viewer_version_id::text
      or connection->>'candidate_version_id'<>p_candidate_version_id::text
      then raise exception 'Connection unavailable' using errcode='42501'; end if;
  else
    if p_mode not in ('nearby','ble') or not public.eligible_pair(p_user_id,p_candidate_id,p_mode)
      or not exists(select 1 from public.match_scores where viewer_id=p_user_id and candidate_id=p_candidate_id
        and viewer_profile_version_id=p_viewer_version_id and candidate_profile_version_id=p_candidate_version_id
        and status='recommend' and expires_at>now()) then raise exception 'Suggestion unavailable' using errcode='42501'; end if;
    if p_mode='ble' and not exists(select 1 from public.encounters where observer_user_id=p_user_id
      and observed_user_id=p_candidate_id and observed_at>now()-interval '2 minutes')
      then raise exception 'Encounter unavailable' using errcode='42501'; end if;
  end if;
  insert into public.match_preferences values(p_user_id,p_candidate_id,p_viewer_version_id,p_candidate_version_id,p_preference,now())
    on conflict(user_id,candidate_id,viewer_version_id,candidate_version_id) do update
    set preference=excluded.preference,updated_at=case when match_preferences.preference=excluded.preference
      then match_preferences.updated_at else excluded.updated_at end returning * into result;
  return jsonb_build_object('preference',result.preference);
end;
$$;

revoke all on function public.navigation_connection(uuid,uuid),public.navigation_connections_page(uuid,text,text,integer),
  public.navigation_preference(uuid,uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.navigation_connection(uuid,uuid),public.navigation_connections_page(uuid,text,text,integer),
  public.navigation_preference(uuid,uuid,uuid,uuid,text,text,uuid) to service_role;
