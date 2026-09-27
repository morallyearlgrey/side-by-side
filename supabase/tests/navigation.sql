-- Fictional, disposable transaction only. 13 peers prove full-set search/filter.
do $$
declare n integer; uid uuid; sid uuid; vid uuid; rid uuid; page jsonb; before_count integer;
  actor uuid := '10000000-0000-4000-8000-000000000001';
  own_version uuid := '40000000-0000-4000-8000-000000000001';
begin
  for n in 1..13 loop
    uid:=('51000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
    sid:=('52000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
    vid:=('53000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
    rid:=('54000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
    insert into auth.users(id,email) values(uid,'navigation-fixture-'||n||'@sidebyside.invalid');
    insert into public.onboarding_sessions(session_id,user_id,status) values(sid,uid,'completed');
    insert into public.profile_versions(profile_version_id,user_id,onboarding_session_id,data_origin,onboarding_answers,facts)
      values(vid,uid,sid,'synthetic','[]','[]');
    update public.profiles set current_profile_version_id=vid where user_id=uid;
    insert into public.consent_receipts(user_id,purpose,policy_version) values(uid,'personal_matching','fictional-test');
    insert into public.profile_previews(user_id,enabled,preview) values(uid,true,
      jsonb_build_object('display_name',case when n=13 then 'Ceramics' else 'Fictional peer '||n end,'interests',jsonb_build_array('ceramics')));
    insert into public.connection_requests(request_id,requester_user_id,recipient_user_id,requester_profile_version_id,
      recipient_profile_version_id,requester_decision,recipient_decision,created_at,expires_at)
      values(rid,actor,uid,own_version,vid,'accept','accept',now()-n*interval '1 minute',now()+interval '1 day');
    if n%2=1 then
      perform public.navigation_preference(actor,uid,own_version,vid,'liked','nearby',rid);
    else
      perform public.navigation_preference(actor,uid,own_version,vid,'disliked','nearby',rid);
    end if;
  end loop;
  page:=public.navigation_connections_page(actor,'','all',1);
  if (page->>'total')::integer<>13 or jsonb_array_length(page->'items')<>6 or (page->>'pages')::integer<>3 then raise exception 'First page incorrect'; end if;
  page:=public.navigation_constellation(actor);
  if jsonb_array_length(page->'nodes')<>13 then raise exception 'Graph incorrectly limited to card page'; end if;
  if exists(select 1 from jsonb_array_elements(page->'nodes') node where node - array['request_id','display_name','preference','active'] <> '{}'::jsonb) then raise exception 'Graph leaked extra data'; end if;
  if jsonb_array_length(public.navigation_constellation('10000000-0000-4000-8000-000000000004')->'nodes')<>0 then raise exception 'Graph actor isolation'; end if;
  page:=public.navigation_connections_page(actor,'','all',2);
  if jsonb_array_length(page->'items')<>6 or page#>>'{items,0,request_id}'<>'54000000-0000-4000-8000-000000000007' then raise exception 'Second page incorrect'; end if;
  page:=public.navigation_connections_page(actor,'','all',99);
  if (page->>'page')::integer<>3 or jsonb_array_length(page->'items')<>1 then raise exception 'Page clamping incorrect'; end if;
  page:=public.navigation_connections_page(actor,'Ceramics','all',1);
  if (page->>'total')::integer<>13 or page#>>'{items,0,preview,display_name}'<>'Ceramics' then raise exception 'Cross-page relevance incorrect'; end if;
  page:=public.navigation_connections_page(actor,'','liked',2);
  if (page->>'total')::integer<>7 or jsonb_array_length(page->'items')<>1 then raise exception 'Cross-page filter incorrect'; end if;
  page:=public.navigation_connections_page(actor,'Ceramics','disliked',1);
  if (page->>'total')::integer<>6 then raise exception 'Combined search/filter incorrect'; end if;
  page:=public.navigation_connections_page('10000000-0000-4000-8000-000000000004','','all',1);
  if (page->>'total')::integer<>0 then raise exception 'Actor isolation failed'; end if;
  update public.connection_requests set recipient_decision='pending' where request_id=rid;
  select count(*) into before_count from public.feedback;
  perform public.navigation_preference(actor,uid,own_version,vid,'disliked','nearby',rid);
  perform public.navigation_preference(actor,uid,own_version,vid,'disliked','nearby',rid);
  if (select count(*) from public.match_preferences where user_id=actor and candidate_id=uid)<>1
    or (select count(*) from public.feedback)<>before_count
    or (select recipient_decision from public.connection_requests where request_id=rid)<>'pending'
    or exists(select 1 from public.connection_location_shares where request_id=rid)
    or exists(select 1 from public.connection_display_permissions where request_id=rid) then raise exception 'Preference changed unrelated consent/outcome'; end if;
  update public.connection_requests set recipient_decision='accept' where request_id=rid;
  if public.navigation_connection(actor,rid)->>'status'<>'accepted' then raise exception 'Acceptance missing'; end if;
  insert into public.user_blocks(blocker_user_id,blocked_user_id) values(uid,actor);
  page:=public.navigation_constellation(actor);
  if jsonb_array_length(page->'nodes')<>13 or not exists(
    select 1 from jsonb_array_elements(page->'nodes') node
    where node->>'request_id'=rid::text and node->>'display_name'='Past connection' and node->>'active'='false'
  ) then raise exception 'Blocked connection history must be anonymous'; end if;
  page:=public.navigation_connection(actor,rid);
  if page->>'status'<>'unavailable' or page->'preview'<>'null' or page->'shared_profile'<>'null' then raise exception 'Block disclosure'; end if;
  begin
    perform public.navigation_preference(actor,uid,own_version,vid,'liked','nearby',rid);
    raise exception 'Blocked preference accepted';
  exception when insufficient_privilege then null; end;
  delete from public.user_blocks where blocker_user_id=uid and blocked_user_id=actor;
  update public.connection_requests set recipient_decision='revoke' where request_id=rid;
  page:=public.navigation_constellation(actor);
  if jsonb_array_length(page->'nodes')<>13 or not exists(
    select 1 from jsonb_array_elements(page->'nodes') node
    where node->>'request_id'=rid::text and node->>'display_name'='Past connection' and node->>'active'='false'
  ) then raise exception 'Revoked connection history must be anonymous'; end if;
  page:=public.navigation_connection(actor,rid);
  if page->>'status'<>'revoked' or page->'preview'<>'null' then raise exception 'Revocation disclosure'; end if;
  page:=public.navigation_connections_page(actor,'Ceramics','all',1);
  if (page->>'total')::integer<>12 then raise exception 'Search leaked revoked preview'; end if;
  update public.profiles set current_profile_version_id=null where user_id=uid;
  if public.navigation_connection(actor,rid)->'preview'<>'null' then raise exception 'Changed profile disclosure'; end if;
  if jsonb_array_length(public.navigation_constellation(actor)->'nodes')<>13 then raise exception 'Profile edit erased accepted history'; end if;
  update public.connection_requests set expires_at=now()-interval '1 second'
    where request_id='54000000-0000-4000-8000-000000000001';
  if jsonb_array_length(public.navigation_constellation(actor)->'nodes')<>13 then raise exception 'Expiry erased accepted history'; end if;
  if has_function_privilege('authenticated','public.navigation_connections_page(uuid,text,text,integer)','execute')
    or has_function_privilege('authenticated','public.navigation_constellation(uuid)','execute')
    or has_function_privilege('anon','public.navigation_preference(uuid,uuid,uuid,uuid,text,text,uuid)','execute')
    or has_table_privilege('authenticated','public.match_preferences','insert') then raise exception 'Client RPC/write access'; end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
do $$ begin if exists(select 1 from public.match_preferences) then raise exception 'Other actor can read private feedback'; end if; end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ begin if (select count(*) from public.match_preferences)<>13 then raise exception 'Owner RLS read failed'; end if; end $$;
reset role;
