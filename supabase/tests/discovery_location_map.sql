-- Fictional seed users only, on a disposable database / rollback transaction.
savepoint location_map_tests;
create or replace function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',message; end if; end;
$$;
delete from public.user_blocks where blocker_user_id::text like '10000000-0000-4000-8000-00000000000_'
  and blocked_user_id::text like '10000000-0000-4000-8000-00000000000_';
update public.profiles set available=true,discoverable=true,bluetooth_enabled=true,
  settings='{"discovery_radius_m":3218.688}'::jsonb
  where user_id in('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
update public.profile_previews set enabled=true where user_id in
  ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
update public.consent_receipts set revoked_at=null where user_id in
  ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002') and purpose='personal_matching';
update public.presence set observed_at=now(),expires_at=now()+interval '5 minutes',accuracy_m=10,
  latitude=case user_id when '10000000-0000-4000-8000-000000000001' then 40.7128 else 40.713 end,
  longitude=-74.006 where user_id in
  ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');

do $$
declare result jsonb; peer jsonb; a uuid:='10000000-0000-4000-8000-000000000001';
  b uuid:='10000000-0000-4000-8000-000000000002';
begin
  result:=public.discovery_location_map(a); peer:=result->'items'->0;
  perform pg_temp.assert_true(result->>'status'='ready' and jsonb_array_length(result->'items')=1,'both fresh locations appear');
  perform pg_temp.assert_true(result#>>'{me,latitude}'<>'40.7128' and peer#>>'{area,latitude}'<>'40.713',
    'exact latitude is never returned');
  perform pg_temp.assert_true(result#>>'{me,longitude}'<>'-74.006' and peer#>>'{area,longitude}'<>'-74.006',
    'exact longitude is never returned');
  perform pg_temp.assert_true((result#>>'{me,uncertainty_m}')::numeric>=250
    and (peer#>>'{area,uncertainty_m}')::numeric>=250,'privacy uncertainty included for both');
  perform pg_temp.assert_true(result=public.discovery_location_map(a),'repeated polling cannot average away privacy rounding');
  perform pg_temp.assert_true(not (peer ?| array['preview','profile_version','facts','rssi','session_id']),
    'map discloses only approved name and coarse estimate');
  perform pg_temp.assert_true(jsonb_array_length(public.discovery_location_map('10000000-0000-4000-8000-000000000099')->'items')=0,
    'unknown account cannot read another map');

  update public.profile_previews set enabled=false where user_id=b;
  perform pg_temp.assert_true(jsonb_array_length(public.discovery_location_map(a)->'items')=0,'peer preview opt-out clears map');
  update public.profile_previews set enabled=true where user_id=b;
  update public.profiles set settings='{"discovery_radius_m":160.9344}'::jsonb where user_id=a;
  update public.presence set latitude=40.7178 where user_id=b;
  perform pg_temp.assert_true(jsonb_array_length(public.discovery_location_map(a)->'items')=0,'map respects viewer discovery radius');
  update public.profiles set settings='{"discovery_radius_m":3218.688}'::jsonb where user_id=a;
  update public.presence set latitude=40.713 where user_id=b;
  insert into public.user_blocks(blocker_user_id,blocked_user_id) values(b,a);
  perform pg_temp.assert_true(jsonb_array_length(public.discovery_location_map(a)->'items')=0,'reverse block clears map');
  delete from public.user_blocks where blocker_user_id=b and blocked_user_id=a;
  update public.presence set accuracy_m=300 where user_id=b;
  perform pg_temp.assert_true(jsonb_array_length(public.discovery_location_map(a)->'items')=0,'imprecise peer location hidden');
  update public.presence set accuracy_m=10,observed_at=now()-interval '6 minutes',expires_at=now()+interval '4 minutes' where user_id=b;
  perform pg_temp.assert_true(jsonb_array_length(public.discovery_location_map(a)->'items')=0,'overlong lease cannot extend five-minute location freshness');
  update public.presence set observed_at=now()+interval '6 seconds',expires_at=now()+interval '5 minutes' where user_id=b;
  perform pg_temp.assert_true(jsonb_array_length(public.discovery_location_map(a)->'items')=0,'future location hidden');
  update public.presence set observed_at=now(),expires_at=now()+interval '5 minutes' where user_id=b;

  insert into public.phone_ble_sessions(session_id,user_id,token_hash,issued_at,expires_at) values
    ('58000000-0000-4000-8000-000000000001',a,repeat('8',64),now()-interval '1 minute',now()+interval '3 minutes'),
    ('58000000-0000-4000-8000-000000000002',b,repeat('9',64),now()-interval '1 minute',now()+interval '3 minutes');
  insert into public.encounters(observer_user_id,observed_user_id,observed_session_id,observed_at,rssi)
    values(a,b,'58000000-0000-4000-8000-000000000002',now(),-60);
  perform pg_temp.assert_true(jsonb_array_length(public.discovery_location_map(a)->'items')=1,
    'a peer detected by both sources is not duplicated');
  update public.profiles set discoverable=false where user_id=b;
  result:=public.discovery_location_map(a); peer:=result->'items'->0;
  perform pg_temp.assert_true(peer->>'source'='bluetooth' and peer->>'proximity'='nearby','BLE-only peer represented as radio estimate');
  perform pg_temp.assert_true(peer#>>'{area,latitude}'=result#>>'{me,latitude}'
    and peer#>>'{area,longitude}'=result#>>'{me,longitude}',
    'BLE area uses observer center, never a fabricated peer bearing');
  perform pg_temp.assert_true((peer#>>'{area,uncertainty_m}')::numeric>(result#>>'{me,uncertainty_m}')::numeric,
    'BLE uncertainty includes observer location rounding and rough radio range');
  update public.profiles set discoverable=false where user_id=a;
  result:=public.discovery_location_map(a); peer:=result->'items'->0;
  perform pg_temp.assert_true(result->>'status'='location_unavailable' and result->'me'='null'::jsonb
    and peer->'area'='null'::jsonb,'BLE works without revealing stored opted-out GPS or inventing 0,0');
  perform pg_temp.assert_true(jsonb_array_length(public.discovery_location_map(b)->'items')=0,
    'one-way radio observation never invents a reverse detection');
  update public.phone_ble_sessions set revoked_at=now() where session_id='58000000-0000-4000-8000-000000000002';
  perform pg_temp.assert_true(jsonb_array_length(public.discovery_location_map(a)->'items')=0,'revoked radio token clears location estimates');
  update public.phone_ble_sessions set revoked_at=null where session_id='58000000-0000-4000-8000-000000000002';
  update public.phone_ble_sessions set expires_at=now()-interval '10 seconds' where session_id='58000000-0000-4000-8000-000000000002';
  perform pg_temp.assert_true(jsonb_array_length(public.discovery_location_map(a)->'items')=0,'expired observed token clears estimates even if another peer session exists');
  update public.phone_ble_sessions set expires_at=now()+interval '3 minutes' where session_id='58000000-0000-4000-8000-000000000002';
  update public.encounters set observed_at=now()-interval '3 minutes' where observer_user_id=a and observed_user_id=b;
  perform pg_temp.assert_true(jsonb_array_length(public.discovery_location_map(a)->'items')=0,'stale radio sightings hidden');
  update public.encounters set observed_at=now() where observer_user_id=a and observed_user_id=b;
  update public.profiles set bluetooth_enabled=false where user_id=b;
  perform pg_temp.assert_true(jsonb_array_length(public.discovery_location_map(a)->'items')=0,'Bluetooth opt-out clears estimates');
  update public.profiles set bluetooth_enabled=true where user_id=b;
  update public.profile_previews set enabled=false where user_id=b;
  perform pg_temp.assert_true(jsonb_array_length(public.discovery_location_map(a)->'items')=0,'preview opt-out also hides radio detections');
  update public.profile_previews set enabled=true where user_id=b;
  update public.consent_receipts set revoked_at=now() where user_id=b and purpose='personal_matching';
  perform pg_temp.assert_true(jsonb_array_length(public.discovery_location_map(a)->'items')=0,'revoking consent hides radio estimates');
  update public.consent_receipts set revoked_at=now() where user_id=a and purpose='personal_matching';
  result:=public.discovery_location_map(a);
  perform pg_temp.assert_true(result->>'status'='off' and result->'me'='null'::jsonb
    and jsonb_array_length(result->'items')=0,'viewer revoking consent clears the entire map');
end;
$$;
select pg_temp.assert_true(not has_function_privilege('anon','public.discovery_location_map(uuid)','execute')
  and not has_function_privilege('authenticated','public.discovery_location_map(uuid)','execute'),
  'only authenticated backend can select the actor; clients cannot enumerate another account');
rollback to savepoint location_map_tests;
