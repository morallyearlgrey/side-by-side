-- Fictional accounts only, inside the disposable rollback harness.
do $$
declare
  amy uuid := '10000000-0000-4000-8000-000000000001';
  steve uuid := '10000000-0000-4000-8000-000000000002';
  r public.connection_requests; repeated public.connection_requests;
begin
  r := public.suggest_connection_pair(amy,steve);
  if r.request_id is null or r.requester_decision<>'pending' or r.recipient_decision<>'pending' then
    raise exception 'A shared suggestion must not accept for either person'; end if;
  repeated := public.suggest_connection_pair(steve,amy);
  if repeated.request_id<>r.request_id or (select count(*) from public.connection_requests)<>1 then
    raise exception 'Reverse discovery duplicated the pair'; end if;
  if public.navigation_invitations(amy)#>>'{items,0,request_id}'<>r.request_id::text
    or public.navigation_invitations(steve)#>>'{items,0,request_id}'<>r.request_id::text
    or (public.navigation_connections_page(amy)->>'total')::integer<>0
    or (public.navigation_connections_page(steve)->>'total')::integer<>0 then
    raise exception 'Suggestion visibility or accepted-only Matches failed'; end if;
  perform public.decide_connection(amy,r.request_id,'accept');
  if (public.navigation_connections_page(amy)->>'total')::integer<>0
    or (public.navigation_connections_page(steve)->>'total')::integer<>0 then
    raise exception 'One acceptance reached Matches'; end if;
  perform public.decide_connection(steve,r.request_id,'accept');
  if (public.navigation_connections_page(amy)->>'total')::integer<>1
    or (public.navigation_connections_page(steve)->>'total')::integer<>1 then
    raise exception 'Mutual acceptance did not reach both Matches'; end if;
  perform public.decide_connection(steve,r.request_id,'revoke');
  repeated := public.suggest_connection_pair(amy,steve);
  if repeated.request_id is not null or (select count(*) from public.connection_requests)<>1 then
    raise exception 'A revocation was recreated by automatic discovery'; end if;
  if has_function_privilege('authenticated','public.suggest_connection_pair(uuid,uuid,integer,text)','execute')
    or has_function_privilege('anon','public.suggest_connection_pair(uuid,uuid,integer,text)','execute') then
    raise exception 'Suggestion RPC allows identity spoofing'; end if;
end;
$$;
