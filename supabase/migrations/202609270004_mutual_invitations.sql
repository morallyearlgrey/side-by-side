-- Existing requests retain each participant's recorded decision. This migration
-- changes visibility and explicit-send semantics; it never accepts for anyone.
create or replace function public.request_connection(p_requester_id uuid,p_recipient_id uuid,p_lifetime_seconds integer default 86400,p_mode text default 'nearby')
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
  if found then
    -- Either direction of an explicit send means yes from that actor. Repeated
    -- sends are idempotent; the pair advisory lock also serializes reverse sends.
    update public.connection_requests set
      requester_decision=case when requester_user_id=p_requester_id then 'accept' else requester_decision end,
      recipient_decision=case when recipient_user_id=p_requester_id then 'accept' else recipient_decision end,
      updated_at=case when (requester_user_id=p_requester_id and requester_decision<>'accept')
        or (recipient_user_id=p_requester_id and recipient_decision<>'accept') then now() else updated_at end
      where request_id=r.request_id returning * into r;
    return r;
  end if;
  insert into public.connection_requests(requester_user_id,recipient_user_id,requester_profile_version_id,recipient_profile_version_id,requester_decision,expires_at)
    select p_requester_id,p_recipient_id,v.current_profile_version_id,c.current_profile_version_id,'accept',now()+make_interval(secs=>least(greatest(p_lifetime_seconds,60),86400))
    from public.profiles v,public.profiles c where v.user_id=p_requester_id and c.user_id=p_recipient_id returning * into r;
  return r;
end;
$$;

create or replace function public.navigation_connections_page(p_user_id uuid,p_query text default '',p_filter text default 'all',p_page integer default 1)
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
      from searchable where item->>'status'='accepted' and (p_filter='all' or item->>'preference'=p_filter)
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

-- A minimal, private graph projection. No coordinates or private profile facts.
create or replace function public.navigation_constellation(p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with projected as materialized (
    select public.navigation_connection(p_user_id,r.request_id) item
    from public.connection_requests r
    where p_user_id in (r.requester_user_id,r.recipient_user_id)
  )
  select jsonb_build_object('nodes',coalesce(jsonb_agg(jsonb_build_object(
    'request_id',item->'request_id',
    'display_name',item#>'{preview,display_name}',
    'preference',item->'preference'
  ) order by item->>'request_id'),'[]'::jsonb))
  from projected
  where item->>'status'='accepted'
    and nullif(trim(item#>>'{preview,display_name}'),'') is not null;
$$;
revoke all on function public.navigation_constellation(uuid) from public,anon,authenticated;
grant execute on function public.navigation_constellation(uuid) to service_role;

-- Pending invitations use the same privacy and version projection as Matches,
-- but include both participant directions and require no reverse model score.
create function public.navigation_invitations(p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with projected as materialized (
    select public.navigation_connection(p_user_id,r.request_id) item
      from public.connection_requests r
      where p_user_id in (r.requester_user_id,r.recipient_user_id)
        and r.expires_at>now()
        and r.requester_decision in ('pending','accept')
        and r.recipient_decision in ('pending','accept')
        and (r.requester_decision='pending' or r.recipient_decision='pending')
  )
  select jsonb_build_object('items',coalesce(jsonb_agg(item
    order by (item->>'created_at')::timestamptz desc,item->>'request_id'),'[]'::jsonb))
    from projected where item->>'status'='pending';
$$;
revoke all on function public.navigation_invitations(uuid) from public,anon,authenticated;
grant execute on function public.navigation_invitations(uuid) to service_role;

notify pgrst, 'reload schema';
