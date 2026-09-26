-- A minimal, private graph projection. No coordinates or private profile facts.
create function public.navigation_constellation(p_user_id uuid)
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
  where item->>'status' in ('pending','accepted')
    and nullif(trim(item#>>'{preview,display_name}'),'') is not null;
$$;
revoke all on function public.navigation_constellation(uuid) from public,anon,authenticated;
grant execute on function public.navigation_constellation(uuid) to service_role;
