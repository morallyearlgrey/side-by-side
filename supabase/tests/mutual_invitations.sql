-- Fictional accounts only; run after seed.sql in a disposable rollback transaction.
do $$
declare
  actor uuid := '10000000-0000-4000-8000-000000000001';
  peer uuid := '10000000-0000-4000-8000-000000000002';
  outsider uuid := '10000000-0000-4000-8000-000000000003';
  r public.connection_requests; repeated public.connection_requests; item jsonb;
begin
  r:=public.request_connection(actor,peer);
  if r.requester_decision<>'accept' or r.recipient_decision<>'pending' then raise exception 'Send must accept only for sender'; end if;
  foreach item in array array[public.navigation_invitations(actor),public.navigation_invitations(peer)] loop
    if jsonb_array_length(item->'items')<>1 or item#>>'{items,0,request_id}'<>r.request_id::text
      or item#>>'{items,0,status}'<>'pending' or item#>'{items,0,shared_profile}'<>'null' then
      raise exception 'Both participants must see the same pending invitation without private shared facts';
    end if;
  end loop;
  if jsonb_array_length(public.navigation_invitations(outsider)->'items')<>0 then raise exception 'Invitation actor isolation failed'; end if;
  if (public.navigation_connections_page(actor)->>'total')::integer<>0
    or (public.navigation_connections_page(peer)->>'total')::integer<>0
    or jsonb_array_length(public.navigation_constellation(actor)->'nodes')<>0
    or jsonb_array_length(public.navigation_constellation(peer)->'nodes')<>0 then raise exception 'Single acceptance appeared in Matches'; end if;
  repeated:=public.request_connection(actor,peer);
  if repeated.request_id<>r.request_id or repeated.recipient_decision<>'pending'
    or (select count(*) from public.connection_requests)<>1 then raise exception 'Repeated sender must not duplicate or accept for peer'; end if;
  -- No reverse recommendation is required to accept a shared invitation.
  repeated:=public.request_connection(peer,actor);
  if repeated.request_id<>r.request_id or repeated.requester_decision<>'accept' or repeated.recipient_decision<>'accept'
    or (select count(*) from public.connection_requests)<>1 then raise exception 'Reverse explicit send must accept same pair'; end if;
  if (public.navigation_connections_page(actor)->>'total')::integer<>1
    or (public.navigation_connections_page(peer)->>'total')::integer<>1
    or jsonb_array_length(public.navigation_constellation(actor)->'nodes')<>1
    or jsonb_array_length(public.navigation_constellation(peer)->'nodes')<>1
    or jsonb_array_length(public.navigation_invitations(actor)->'items')<>0
    or jsonb_array_length(public.navigation_invitations(peer)->'items')<>0 then raise exception 'Mutual acceptance did not move both views to Matches'; end if;
  perform public.decide_connection(peer,r.request_id,'revoke');
  if (public.navigation_connections_page(actor)->>'total')::integer<>0
    or (public.navigation_connections_page(peer)->>'total')::integer<>0
    or jsonb_array_length(public.navigation_constellation(actor)->'nodes')<>0 then raise exception 'Revoked request remained in Matches'; end if;
  r:=public.request_connection(actor,peer);
  perform public.decide_connection(peer,r.request_id,'decline');
  if jsonb_array_length(public.navigation_invitations(actor)->'items')<>0
    or jsonb_array_length(public.navigation_invitations(peer)->'items')<>0
    or (public.navigation_connections_page(actor)->>'total')::integer<>0 then raise exception 'Declined invitation remained visible'; end if;
  r:=public.request_connection(actor,peer);
  insert into public.user_blocks(blocker_user_id,blocked_user_id) values(peer,actor);
  if jsonb_array_length(public.navigation_invitations(actor)->'items')<>0
    or jsonb_array_length(public.navigation_invitations(peer)->'items')<>0 then raise exception 'Blocked invitation disclosed preview'; end if;
  delete from public.user_blocks where blocker_user_id=peer and blocked_user_id=actor;
  r:=public.request_connection(actor,peer);
  update public.connection_requests set created_at=now()-interval '2 seconds', expires_at=now()-interval '1 second' where request_id=r.request_id;
  if jsonb_array_length(public.navigation_invitations(actor)->'items')<>0 then raise exception 'Expired invitation remained visible'; end if;
  r:=public.request_connection(actor,peer);
  update public.profiles set current_profile_version_id=null where user_id=peer;
  if jsonb_array_length(public.navigation_invitations(actor)->'items')<>0 then raise exception 'Changed profile invitation remained visible'; end if;
  if has_function_privilege('authenticated','public.navigation_invitations(uuid)','execute')
    or has_function_privilege('anon','public.navigation_invitations(uuid)','execute') then raise exception 'Invitation RPC allows identity spoofing'; end if;
end;
$$;
