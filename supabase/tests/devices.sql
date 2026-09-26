-- Run only with synthetic seed fixtures in a disposable/rollback transaction.
create function pg_temp.device_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Device assertion: %',message; end if; end $$;
do $$
declare
 a uuid:='10000000-0000-4000-8000-000000000001'; b uuid:='10000000-0000-4000-8000-000000000002';
 h uuid:=gen_random_uuid(); badge uuid:=gen_random_uuid(); expired uuid:=gen_random_uuid(); rid uuid:=gen_random_uuid();
 obs jsonb:='{"worn_reported":true,"app_foreground":true,"ar_enabled":true,"camera_ready":true,"tracker_ready":true}';
 first_lease timestamptz; first_session timestamptz; result jsonb; rev bigint;
begin
 perform pg_temp.device_assert(not has_table_privilege('authenticated','public.headset_devices','SELECT'),'headsets private');
 perform pg_temp.device_assert(not has_table_privilege('anon','public.device_pairings','SELECT'),'pairings private');
 perform pg_temp.device_assert(not has_function_privilege('authenticated','public.claim_device_pairing(uuid,text,text,text)','EXECUTE'),'no client-forged owners');
 perform pg_temp.device_assert(not has_function_privilege('anon','public.authorize_headset_target(uuid,text,text,integer,integer)','EXECUTE'),'no public marker resolver');
 perform public.approve_device_pairing(a,h,repeat('a',64),'quest','Fixture Quest');
 begin
  perform public.claim_device_pairing(h,repeat('f',64),repeat('b',64),repeat('c',64));
  raise exception 'Wrong pairing secret accepted';
 exception when insufficient_privilege then null; end;
 perform public.claim_device_pairing(h,repeat('a',64),repeat('b',64),repeat('c',64));
 perform pg_temp.device_assert((select user_id=a from public.headset_devices where device_id=h),'owner derived from approval');
 begin
  perform public.claim_device_pairing(h,repeat('a',64),repeat('b',64),repeat('c',64));
  raise exception 'Pairing replay accepted';
 exception when insufficient_privilege then null; end;
 perform public.approve_device_pairing(b,badge,repeat('a',64),'core2','Fixture Charm');
 perform public.claim_device_pairing(badge,repeat('a',64),repeat('d',64),repeat('e',64));
 perform public.approve_device_pairing(a,expired,repeat('a',64),'quest','Expired');
 update public.device_pairings set expires_at=clock_timestamp()-interval '1 second' where pairing_id=expired;
 begin
  perform public.claim_device_pairing(expired,repeat('a',64),repeat('b',64),repeat('e',64));
  raise exception 'Expired pairing accepted';
 exception when insufficient_privilege then null; end;
 perform public.report_headset_state(h,repeat('c',64),1,obs);
 select lease_expires_at into first_lease from public.headset_devices where device_id=h;
 perform public.report_headset_state(h,repeat('c',64),1,obs);
 perform pg_temp.device_assert((select lease_expires_at=first_lease from public.headset_devices where device_id=h),'heartbeat replay cannot renew lease');
 begin
  perform public.report_headset_state(h,repeat('c',64),1,obs||'{"worn_reported":false}');
  raise exception 'Conflicting replay accepted';
 exception when sqlstate 'PT409' then null; end;
 perform public.renew_headset_owner_lease(a,h);
 begin
  perform public.renew_headset_owner_lease(b,h);
  raise exception 'Wrong owner lease accepted';
 exception when insufficient_privilege then null; end;
 perform public.report_badge_session(badge,repeat('d',64),1,'available','0011223344556677',487,203,120);
 select session_expires_at into first_session from public.badge_devices where device_id=badge;
 perform public.report_badge_session(badge,repeat('d',64),2,'available','0011223344556677',487,203,120);
 perform pg_temp.device_assert((select session_expires_at=first_session from public.badge_devices where device_id=badge),'same session cannot extend rotation deadline');
 insert into public.connection_requests(request_id,requester_user_id,recipient_user_id,requester_profile_version_id,recipient_profile_version_id,requester_decision,recipient_decision,expires_at)
 values(rid,a,b,'40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','accept','pending',now()+interval '1 hour');
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('c',64),'0011223344556677',487,203) is null,'invitation is not mutual acceptance');
 begin
  perform public.connection_display_permission(a,rid,true,0);
  raise exception 'Pending connection display accepted';
 exception when insufficient_privilege then null; end;
 update public.connection_requests set recipient_decision='accept' where request_id=rid;
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('c',64),'0011223344556677',487,203) is null,'acceptance is not AR permission');
 perform public.connection_display_permission(a,rid,true,0);
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('c',64),'0011223344556677',487,203) is null,'one-sided AR permission cannot reveal');
 perform public.connection_display_permission(b,rid,true,0);
 result:=public.authorize_headset_target(h,repeat('c',64),'0011223344556677',487,203);
 perform pg_temp.device_assert(result->>'wearer_id'=b::text and result->>'viewer_id'=a::text,'viewer and wearer stay distinct');
 perform pg_temp.device_assert((result->>'valid_until')::timestamptz<=clock_timestamp()+interval '5 seconds','authorization lease bounded');
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('c',64),'0011223344556677',488,203) is null,'wrong marker rejected');
 perform public.report_headset_state(h,repeat('c',64),2,obs||'{"worn_reported":false}');
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('c',64),'0011223344556677',487,203) is null,'headset removal clears');
 perform public.report_headset_state(h,repeat('c',64),3,obs||'{"app_foreground":false}');
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('c',64),'0011223344556677',487,203) is null,'background clears');
 perform public.report_headset_state(h,repeat('c',64),4,obs);
 perform public.report_badge_session(badge,repeat('d',64),3,'available','1122334455667788',488,203,120);
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('c',64),'0011223344556677',487,203) is null,'rotation invalidates previous mapping');
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('c',64),'1122334455667788',488,203) is not null,'new session retains authenticated owner');
 begin
  perform public.report_badge_session(badge,repeat('d',64),2,'available','0011223344556677',487,203,120);
  raise exception 'Old badge report restored mapping';
 exception when sqlstate 'PT409' then null; end;
 perform public.report_badge_state(badge,repeat('d',64),4,'paused');
 perform pg_temp.device_assert((select session_token is null from public.badge_devices where device_id=badge),'pause clears marker association');
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('c',64),'1122334455667788',488,203) is null,'paused charm cannot reveal');
 perform public.report_badge_session(badge,repeat('d',64),5,'available','2233445566778899',489,203,120);
 perform public.connection_display_permission(b,rid,false,1);
 begin
  perform public.connection_display_permission(b,rid,true,1);
  raise exception 'Delayed permission resurrected grant';
 exception when sqlstate 'PT409' then null; end;
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('c',64),'2233445566778899',489,203) is null,'explicit display revoke clears');
 perform public.connection_display_permission(b,rid,true,2);
 update public.connection_display_permissions set active_until=clock_timestamp()-interval '1 second' where request_id=rid and user_id=b;
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('c',64),'2233445566778899',489,203) is null,'offline wearer phone expires');
 perform public.connection_display_permission(b,rid);
 update public.headset_devices set owner_lease_expires_at=clock_timestamp()-interval '1 second' where device_id=h;
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('c',64),'2233445566778899',489,203) is null,'headset cannot renew owner lease');
 perform public.renew_headset_owner_lease(a,h);
 insert into public.user_blocks(blocker_user_id,blocked_user_id) values(b,a);
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('c',64),'2233445566778899',489,203) is null,'wearer blocks viewer');
 delete from public.user_blocks where blocker_user_id=b and blocked_user_id=a;
 update public.connection_requests set requester_decision='accept',recipient_decision='accept' where request_id=rid;
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('c',64),'2233445566778899',489,203) is null,'unblock does not restore old display opt-in');
 select revision into rev from public.connection_display_permissions where request_id=rid and user_id=a;
 perform public.connection_display_permission(a,rid,true,rev);
 select revision into rev from public.connection_display_permissions where request_id=rid and user_id=b;
 perform public.connection_display_permission(b,rid,true,rev);
 insert into public.user_blocks(blocker_user_id,blocked_user_id) values(a,b);
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('c',64),'2233445566778899',489,203) is null,'viewer blocks wearer');
 delete from public.user_blocks where blocker_user_id=a and blocked_user_id=b;
 perform public.end_device_sessions(a);
 begin
  perform public.report_headset_state(h,repeat('c',64),5,obs);
  raise exception 'Signed-out headset revived';
 exception when insufficient_privilege then null; end;
 perform pg_temp.device_assert((select available from public.profiles where user_id=a),'hardware signout leaves phone availability untouched');
 perform pg_temp.device_assert(public.matching_consent(a),'hardware signout leaves matching consent untouched');
end $$;

-- Independent expiry, collision, consent and profile invalidation cases.
do $$
declare
 a uuid:='10000000-0000-4000-8000-000000000001'; b uuid:='10000000-0000-4000-8000-000000000002';
 outsider uuid:='10000000-0000-4000-8000-000000000003';
 h uuid:=gen_random_uuid(); badge uuid:=gen_random_uuid(); collision uuid:=gen_random_uuid(); rid uuid:=gen_random_uuid();
 obs jsonb:='{"worn_reported":true,"app_foreground":true,"ar_enabled":true,"camera_ready":true,"tracker_ready":true}';
 rev bigint;
begin
 insert into public.headset_devices(device_id,user_id,label,token_hash) values(h,a,'Expiry fixture',repeat('1',64));
 insert into public.badge_devices(device_id,user_id,label,token_hash) values(badge,b,'Expiry fixture',repeat('2',64));
 perform public.report_headset_state(h,repeat('1',64),1,obs);
 perform public.renew_headset_owner_lease(a,h);
 perform public.report_badge_session(badge,repeat('2',64),1,'available','3344556677889900',500,203,120);
 insert into public.connection_requests(request_id,requester_user_id,recipient_user_id,requester_profile_version_id,recipient_profile_version_id,requester_decision,recipient_decision,expires_at)
 values(rid,a,b,'40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','accept','accept',now()+interval '1 hour');
 perform public.connection_display_permission(a,rid,true,0);
 perform public.connection_display_permission(b,rid,true,0);
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('1',64),'3344556677889900',500,203) is not null,'baseline authorization');
 insert into public.badge_devices(device_id,user_id,label,token_hash) values(collision,outsider,'Collision fixture',repeat('3',64));
 perform public.report_badge_session(collision,repeat('3',64),1,'available','4455667788990011',500,203,120);
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('1',64),'3344556677889900',500,203) is null,'same tag different owner is ambiguous');
 perform public.revoke_badge(outsider,collision);
 update public.badge_devices set session_expires_at=clock_timestamp()-interval '1 second' where device_id=badge;
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('1',64),'3344556677889900',500,203) is null,'session expires');
 perform public.report_badge_session(badge,repeat('2',64),2,'available','5566778899001122',501,203,120);
 update public.badge_devices set last_seen_at=now()-interval '46 seconds',lease_expires_at=now()-interval '1 second' where device_id=badge;
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('1',64),'5566778899001122',501,203) is null,'badge heartbeat expires');
 perform public.report_badge_session(badge,repeat('2',64),3,'available','5566778899001122',501,203,120);
 update public.headset_devices set lease_expires_at=clock_timestamp()-interval '1 second' where device_id=h;
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('1',64),'5566778899001122',501,203) is null,'headset heartbeat expires');
 perform public.report_headset_state(h,repeat('1',64),2,obs);
 update public.connection_display_permissions set expires_at=clock_timestamp()-interval '1 second' where request_id=rid and user_id=b;
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('1',64),'5566778899001122',501,203) is null,'display permission expires');
 perform public.connection_display_permission(b,rid,true,1);
 update public.consent_receipts set revoked_at=now() where user_id=b and purpose='personal_matching' and revoked_at is null;
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('1',64),'5566778899001122',501,203) is null,'matching consent revoke clears');
 update public.consent_receipts set revoked_at=null where user_id=b and purpose='personal_matching';
 update public.connection_requests set requester_decision='accept',recipient_decision='accept' where request_id=rid;
 select revision into rev from public.connection_display_permissions where request_id=rid and user_id=a;
 perform public.connection_display_permission(a,rid,true,rev);
 select revision into rev from public.connection_display_permissions where request_id=rid and user_id=b;
 perform public.connection_display_permission(b,rid,true,rev);
 update public.profiles set current_profile_version_id=null where user_id=b;
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('1',64),'5566778899001122',501,203) is null,'profile change clears');
 update public.profiles set current_profile_version_id='40000000-0000-4000-8000-000000000002' where user_id=b;
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('1',64),'5566778899001122',501,203) is null,'restoring version does not revive old AR opt-in');
 select revision into rev from public.connection_display_permissions where request_id=rid and user_id=a;
 perform public.connection_display_permission(a,rid,true,rev);
 select revision into rev from public.connection_display_permissions where request_id=rid and user_id=b;
 perform public.connection_display_permission(b,rid,true,rev);
 update public.connection_requests set recipient_decision='decline' where request_id=rid;
 perform pg_temp.device_assert(public.authorize_headset_target(h,repeat('1',64),'5566778899001122',501,203) is null,'decline clears');
 rid:=gen_random_uuid();
 insert into public.connection_requests(request_id,requester_user_id,recipient_user_id,requester_profile_version_id,recipient_profile_version_id,requester_decision,recipient_decision,expires_at)
 values(rid,a,b,'40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','accept','accept',now()+interval '1 hour');
 perform public.end_device_sessions(b);
 begin
  perform public.connection_display_permission(b,rid,true,0);
  raise exception 'Delayed first permission survived signout';
 exception when sqlstate 'PT409' then null; end;
end $$;
