-- Fictional accounts only; run in the disposable rollback harness.
do $$
declare
  amy uuid := '10000000-0000-4000-8000-000000000001';
  steve uuid := '10000000-0000-4000-8000-000000000002';
  outsider uuid := '10000000-0000-4000-8000-000000000003';
  r public.connection_requests; result jsonb;
begin
  r:=public.request_connection(amy,steve);
  perform public.decide_connection(steve,r.request_id,'accept');
  result:=public.connection_history_preference(amy,r.request_id,'liked');
  if result->>'preference'<>'liked'
    or public.navigation_constellation(amy)#>>'{nodes,0,preference}'<>'liked'
    or public.navigation_constellation(steve)#>>'{nodes,0,preference}' is not null then
    raise exception 'Preference was not private to its owner';
  end if;
  perform public.decide_connection(steve,r.request_id,'revoke');
  result:=public.connection_history_preference(amy,r.request_id,'disliked');
  if result->>'preference'<>'disliked'
    or public.navigation_constellation(amy)#>>'{nodes,0,preference}'<>'disliked' then
    raise exception 'Historical preference was not editable';
  end if;
  begin
    perform public.connection_history_preference(outsider,r.request_id,'liked');
    raise exception 'Outsider rated connection';
  exception when insufficient_privilege then null; end;
  begin
    perform public.delete_connection_history(outsider,r.request_id);
    raise exception 'Outsider deleted connection';
  exception when insufficient_privilege then null; end;
  result:=public.delete_connection_history(amy,r.request_id);
  if (result->>'deleted')::integer<1
    or exists(select 1 from public.connection_requests where
      (requester_user_id=amy and recipient_user_id=steve)
      or (requester_user_id=steve and recipient_user_id=amy))
    or exists(select 1 from public.match_preferences where
      (user_id=amy and candidate_id=steve) or (user_id=steve and candidate_id=amy))
    or jsonb_array_length(public.navigation_constellation(amy)->'nodes')<>0
    or jsonb_array_length(public.navigation_constellation(steve)->'nodes')<>0 then
    raise exception 'Delete did not remove pair for both people';
  end if;
  r:=public.suggest_connection_pair(amy,steve);
  if r.request_id is not null then raise exception 'Automatic suggestion returned after delete'; end if;
  r:=public.request_connection(amy,steve);
  if r.request_id is null then raise exception 'An explicit new invitation should remain possible'; end if;
  perform public.decide_connection(steve,r.request_id,'decline');
  if jsonb_array_length(public.navigation_invitations(amy)->'items')<>0
    or jsonb_array_length(public.navigation_invitations(steve)->'items')<>0 then
    raise exception 'Deny did not remove pending card for both people';
  end if;
  if has_function_privilege('authenticated','public.connection_history_preference(uuid,uuid,text)','execute')
    or has_function_privilege('authenticated','public.delete_connection_history(uuid,uuid)','execute')
    or has_function_privilege('anon','public.delete_connection_history(uuid,uuid)','execute') then
    raise exception 'Connection control RPC allows identity spoofing';
  end if;
end;
$$;
