-- A mutually accepted connection remains in the owner's private constellation
-- after the request expires, a profile changes, or a participant later revokes.
-- Current preview and matching consent still control whether its name is shown.
alter table public.connection_requests add column accepted_at timestamptz;

-- Existing accepted rows predate this column. Their last update is the best
-- available acceptance time; do not infer acceptance from revoked/pending rows.
update public.connection_requests
  set accepted_at=updated_at
  where requester_decision='accept' and recipient_decision='accept';

create index connection_history_requester on public.connection_requests(requester_user_id,accepted_at desc)
  where accepted_at is not null;
create index connection_history_recipient on public.connection_requests(recipient_user_id,accepted_at desc)
  where accepted_at is not null;

create function public.record_connection_acceptance()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and old.accepted_at is not null then
    new.accepted_at:=old.accepted_at;
  elsif new.requester_decision='accept' and new.recipient_decision='accept' then
    new.accepted_at:=coalesce(new.accepted_at,now());
  else
    new.accepted_at:=null;
  end if;
  return new;
end;
$$;
revoke all on function public.record_connection_acceptance() from public,anon,authenticated;
create trigger connection_acceptance_history
  before insert or update on public.connection_requests
  for each row execute function public.record_connection_acceptance();

create or replace function public.navigation_constellation(p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with pairs as (
    select r.*,case when r.requester_user_id=p_user_id then r.recipient_user_id
      else r.requester_user_id end peer_id
    from public.connection_requests r
    where p_user_id in (r.requester_user_id,r.recipient_user_id)
      and r.accepted_at is not null
  ), latest as (
    select distinct on (peer_id) * from pairs
    order by peer_id,accepted_at desc,created_at desc,request_id
  ), projected as (
    select h.request_id,h.peer_id,
      coalesce((public.navigation_connection(p_user_id,h.request_id)->>'status')='accepted',false) active,
      case when h.requester_decision='accept' and h.recipient_decision='accept'
        and public.eligible_pair(p_user_id,h.peer_id,'connection')
        and pr.enabled then nullif(trim(pr.preview->>'display_name'),'') end safe_name,
      pref.preference
    from latest h
    left join public.profile_previews pr on pr.user_id=h.peer_id
    left join lateral (
      select m.preference from public.match_preferences m
      where m.user_id=p_user_id and m.candidate_id=h.peer_id
      order by m.updated_at desc limit 1
    ) pref on true
  )
  select jsonb_build_object('nodes',coalesce(jsonb_agg(jsonb_build_object(
    'request_id',request_id,
    'display_name',coalesce(safe_name,'Past connection'),
    'preference',preference,
    'active',active and safe_name is not null
  ) order by request_id),'[]'::jsonb))
  from projected;
$$;
revoke all on function public.navigation_constellation(uuid) from public,anon,authenticated;
grant execute on function public.navigation_constellation(uuid) to service_role;
