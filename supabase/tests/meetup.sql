-- Fictional fixtures only. The caller wraps this entire suite in a rollback.
create function pg_temp.meetup_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Meetup assertion: %',message; end if; end $$;

do $$
declare
  a uuid := '10000000-0000-4000-8000-000000000001';
  b uuid := '10000000-0000-4000-8000-000000000002';
  outsider uuid := '10000000-0000-4000-8000-000000000003';
  rid uuid := gen_random_uuid();
  p jsonb := jsonb_build_object('latitude',40.7128,'longitude',-74.006,'accuracy_m',10,'observed_at',now());
  result jsonb; other_result jsonb; lease uuid; old_lease uuid; expiry timestamptz;
begin
  perform pg_temp.meetup_assert(not has_table_privilege('anon','public.connection_location_shares','SELECT'), 'anonymous table access denied');
  perform pg_temp.meetup_assert(not has_table_privilege('authenticated','public.connection_location_shares','SELECT'), 'authenticated table access denied');
  perform pg_temp.meetup_assert(not has_function_privilege('anon','public.connection_meetup(uuid,uuid,text,jsonb,uuid)','EXECUTE'), 'worker public key cannot execute meetup RPC');
  perform pg_temp.meetup_assert(not has_function_privilege('authenticated','public.connection_meetup(uuid,uuid,text,jsonb,uuid)','EXECUTE'), 'client cannot forge actor via RPC');
  perform pg_temp.meetup_assert(has_function_privilege('service_role','public.connection_meetup(uuid,uuid,text,jsonb,uuid)','EXECUTE'), 'API can execute RPC');
  insert into public.connection_requests(request_id,requester_user_id,recipient_user_id,requester_profile_version_id,recipient_profile_version_id,requester_decision,recipient_decision,expires_at)
    values(rid,a,b,'40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','accept','pending',now()+interval '1 hour');
  result := public.connection_meetup(a,rid,'start',p);
  perform pg_temp.meetup_assert(result->>'status'='unavailable' and result->'peer'='null', 'pending connection cannot share');
  perform pg_temp.meetup_assert(not exists(select 1 from public.connection_location_shares where request_id=rid), 'pending start writes no location');
  update public.connection_requests set recipient_decision='accept' where request_id=rid;
  result := public.connection_meetup(a,rid);
  perform pg_temp.meetup_assert(result->>'status'='off' and result->'peer'='null', 'acceptance is not location consent');
  begin
    perform public.connection_meetup(outsider,rid);
    raise exception 'Outsider unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  result := public.connection_meetup(a,rid,'start',p);
  lease := (result->>'share_id')::uuid;
  expiry := (result->>'sharing_until')::timestamptz;
  perform pg_temp.meetup_assert(result->>'status'='waiting' and result->'me'='null' and result->'peer'='null', 'one-sided consent reveals no coordinates');
  other_result := public.connection_meetup(b,rid);
  perform pg_temp.meetup_assert(other_result->>'status'='off' and other_result->'peer'='null', 'non-sharing peer cannot see consenting user');
  other_result := public.connection_meetup(b,rid,'start',p || jsonb_build_object('latitude',40.714));
  result := public.connection_meetup(a,rid);
  perform pg_temp.meetup_assert(result->>'status'='sharing' and (result->'peer'->>'latitude')::numeric=40.714, 'mutual consent returns peer point');
  perform pg_temp.meetup_assert(other_result->'peer' = result->'me', 'each direction receives correctly labelled points');
  perform pg_temp.meetup_assert((result->>'valid_until')::timestamptz <= now()+interval '20 seconds', 'client cache is bounded');
  perform pg_temp.meetup_assert(expiry = now()+interval '15 minutes', 'opt-in is limited to fifteen minutes');
  begin
    perform public.connection_meetup(a,rid,'update',p,gen_random_uuid());
    raise exception 'Wrong lease unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  perform public.connection_meetup(a,rid,'update',p || jsonb_build_object('observed_at',now()-interval '1 second','latitude',10),lease);
  result := public.connection_meetup(a,rid);
  perform pg_temp.meetup_assert((result->'me'->>'latitude')::numeric=40.7128 and (result->>'sharing_until')::timestamptz=expiry, 'out-of-order update cannot replace latest fix or extend opt-in');
  begin
    perform public.connection_meetup(a,rid,'update',p || jsonb_build_object('observed_at',now()-interval '61 seconds'),lease);
    raise exception 'Stale point unexpectedly allowed';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.connection_meetup(a,rid,'update',p || jsonb_build_object('observed_at',now()+interval '6 seconds'),lease);
    raise exception 'Future point unexpectedly allowed';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.connection_meetup(a,rid,'update',p || jsonb_build_object('accuracy_m',251),lease);
    raise exception 'Inaccurate point unexpectedly allowed';
  exception when check_violation then null; end;
  update public.connection_location_shares set observed_at=now()-interval '121 seconds' where request_id=rid and user_id=b;
  result := public.connection_meetup(a,rid);
  perform pg_temp.meetup_assert(result->>'status'='stale' and result->'peer'='null', 'stale peer is not rendered');
  perform public.connection_meetup(b,rid,'update',p,(other_result->>'share_id')::uuid);
  perform public.connection_meetup(a,rid,'stop',null,lease);
  result := public.connection_meetup(b,rid);
  perform pg_temp.meetup_assert(result->>'status'='waiting' and result->'peer'='null', 'stop hides point for the other person');
  begin
    perform public.connection_meetup(a,rid,'update',p,lease);
    raise exception 'Late refresh unexpectedly restarted stopped sharing';
  exception when insufficient_privilege then null; end;
  old_lease := lease;
  result := public.connection_meetup(a,rid,'start',p);
  lease := (result->>'share_id')::uuid;
  result := public.connection_meetup(a,rid,'stop',null,old_lease);
  perform pg_temp.meetup_assert(result->>'status'='sharing' and (result->>'share_id')::uuid=lease, 'late stop cannot cancel a newer opt-in');
  update public.connection_location_shares set started_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute' where request_id=rid and user_id=b;
  result := public.connection_meetup(a,rid);
  perform pg_temp.meetup_assert(result->>'status'='waiting' and result->'peer'='null', 'expired opt-in hides coordinates');
  perform pg_temp.meetup_assert(not exists(select 1 from public.connection_location_shares where request_id=rid and user_id=b), 'read purges expired opt-in');
  perform public.connection_meetup(b,rid,'start',p);
  update public.connection_requests set recipient_decision='revoke' where request_id=rid;
  perform pg_temp.meetup_assert(not exists(select 1 from public.connection_location_shares where request_id=rid), 'revoke trigger deletes shares immediately');
  update public.connection_requests set recipient_decision='accept' where request_id=rid;
  result := public.connection_meetup(a,rid);
  perform pg_temp.meetup_assert(result->>'status'='off', 'reaccepting cannot restore old location opt-in');
  perform public.connection_meetup(a,rid,'start',p);
  perform public.connection_meetup(b,rid,'start',p);
  insert into public.user_blocks(blocker_user_id,blocked_user_id) values(b,a);
  perform pg_temp.meetup_assert(not exists(select 1 from public.connection_location_shares where request_id=rid), 'blocking deletes shares');
  delete from public.user_blocks where blocker_user_id=b and blocked_user_id=a;
  update public.connection_requests set requester_decision='accept',recipient_decision='accept' where request_id=rid;
  perform public.connection_meetup(a,rid,'start',p);
  update public.consent_receipts set revoked_at=now() where user_id=b and purpose='personal_matching';
  perform pg_temp.meetup_assert(not exists(select 1 from public.connection_location_shares where request_id=rid), 'revoking matching consent deletes shares');
  update public.consent_receipts set revoked_at=null where user_id=b and purpose='personal_matching';
  update public.connection_requests set requester_decision='accept',recipient_decision='accept' where request_id=rid;
  perform public.connection_meetup(a,rid,'start',p);
  update public.profiles set available=false where user_id=b;
  perform pg_temp.meetup_assert(not exists(select 1 from public.connection_location_shares where request_id=rid), 'unavailability deletes shares');
  update public.profiles set available=true where user_id=b;
  perform public.connection_meetup(a,rid,'start',p);
  update public.profiles set current_profile_version_id=null where user_id=b;
  perform pg_temp.meetup_assert(not exists(select 1 from public.connection_location_shares where request_id=rid), 'profile change deletes shares');
  update public.profiles set current_profile_version_id='40000000-0000-4000-8000-000000000002' where user_id=b;
  perform public.connection_meetup(a,rid,'start',p);
  update public.connection_requests set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where request_id=rid;
  result := public.connection_meetup(a,rid);
  perform pg_temp.meetup_assert(result->>'status'='unavailable' and result->'peer'='null', 'expired connection cannot share');
end $$;
