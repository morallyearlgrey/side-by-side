-- Run after runtime.sql in the same rollback-only test transaction.
create function pg_temp.expect_badge_error(statement text, expected_code text, message text)
returns void language plpgsql as $$
declare actual_code text;
begin
  begin execute statement;
  exception when others then get stacked diagnostics actual_code = returned_sqlstate;
  end;
  if actual_code is distinct from expected_code then
    raise exception 'BADGE ERROR ASSERTION FAILED: % (expected %, got %)', message, expected_code, actual_code;
  end if;
end;
$$;

insert into auth.users(id,aud,role,email,created_at,updated_at) values
  ('91000000-0000-4000-8000-000000000001','authenticated','authenticated','synthetic-badge-owner@sidebyside.invalid',now(),now()),
  ('91000000-0000-4000-8000-000000000002','authenticated','authenticated','synthetic-badge-other@sidebyside.invalid',now(),now());
update public.profiles set available=false where user_id='91000000-0000-4000-8000-000000000001';
insert into public.badge_devices(device_id,user_id,token_hash,label) values
  ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001',repeat('c',64),'Synthetic Core2');

select pg_temp.expect_badge_error($q$insert into public.badge_devices(user_id,token_hash,label)
  values('91000000-0000-4000-8000-000000000001',repeat('d',64),repeat('x',65))$q$,'23514','label bounded');
select pg_temp.expect_badge_error($q$insert into public.badge_devices(user_id,token_hash,label)
  values('91000000-0000-4000-8000-000000000001',repeat('d',64),'  ')$q$,'23514','blank label rejected');
select pg_temp.expect_badge_error($q$insert into public.badge_devices(user_id,token_hash)
  values('91000000-0000-4000-8000-000000000001','raw-bearer-secret')$q$,'23514','only hashes stored');
select pg_temp.expect_badge_error($q$insert into public.badge_devices(user_id,token_hash)
  values('91000000-0000-4000-8000-000000000001',repeat('c',64))$q$,'23505','credential unique');
select pg_temp.expect_badge_error($q$update public.badge_devices set user_id='91000000-0000-4000-8000-000000000002'
  where device_id='92000000-0000-4000-8000-000000000001'$q$,'23514','device cannot move to another owner');
select pg_temp.expect_badge_error($q$update public.badge_devices set token_hash=repeat('d',64)
  where device_id='92000000-0000-4000-8000-000000000001'$q$,'23514','credential cannot be silently replaced');

do $$
declare device public.badge_devices; duplicate public.badge_devices; profile_before jsonb; invalidation_before bigint;
begin
  select to_jsonb(p) into profile_before from public.profiles p where user_id='91000000-0000-4000-8000-000000000001';
  select revision into invalidation_before from public.matching_invalidations where user_id='91000000-0000-4000-8000-000000000001';
  device := public.report_badge_state('92000000-0000-4000-8000-000000000001',repeat('c',64),1,'paused');
  perform pg_temp.assert_true(device.reported_state='paused' and device.last_sequence=1 and device.last_seen_at is not null
    and device.lease_expires_at=device.last_seen_at+interval '45 seconds','first pause persisted with bounded server lease');
  device := public.report_badge_state(device.device_id,repeat('c',64),2,'available');
  perform pg_temp.assert_true(device.reported_state='available' and device.last_sequence=2,'new report advances state');
  duplicate := public.report_badge_state(device.device_id,repeat('c',64),2,'available');
  perform pg_temp.assert_true(to_jsonb(device)=to_jsonb(duplicate),'exact retry does not renew last seen or lease');
  perform pg_temp.expect_badge_error(format('select public.report_badge_state(%L,%L,1,%L)',device.device_id,repeat('c',64),'paused'),
    'PT409','delayed pause cannot overwrite newer state');
  perform pg_temp.expect_badge_error(format('select public.report_badge_state(%L,%L,2,%L)',device.device_id,repeat('c',64),'paused'),
    'PT409','same sequence with conflicting state rejected');
  perform pg_temp.expect_badge_error(format('select public.report_badge_state(%L,%L,3,%L)',device.device_id,repeat('d',64),'paused'),
    '42501','wrong device credential rejected');
  perform pg_temp.expect_badge_error(format('select public.report_badge_state(%L,%L,3,%L)',
    '92000000-0000-4000-8000-000000000002',repeat('c',64),'paused'),'42501','credential cannot choose another device');
  perform pg_temp.expect_badge_error(format('select public.report_badge_state(%L,%L,0,%L)',device.device_id,repeat('c',64),'available'),
    '22023','zero sequence rejected');
  perform pg_temp.expect_badge_error(format('select public.report_badge_state(%L,%L,9007199254740992,%L)',device.device_id,repeat('c',64),'available'),
    '22023','sequence capped at safe integer');
  perform pg_temp.expect_badge_error(format('select public.report_badge_state(%L,%L,null,%L)',device.device_id,repeat('c',64),'available'),
    '22023','null sequence rejected');
  perform pg_temp.expect_badge_error(format('select public.report_badge_state(%L,%L,3,%L)',device.device_id,repeat('c',64),'unknown'),
    '22023','unknown state rejected');
  perform pg_temp.expect_badge_error(format('select public.report_badge_state(%L,%L,3,null)',device.device_id,repeat('c',64)),
    '22023','null state rejected');
  perform pg_temp.assert_true((select to_jsonb(d)=to_jsonb(device) from public.badge_devices d where device_id=device.device_id),
    'rejected reports do not mutate persisted state');
  perform pg_temp.assert_true((select to_jsonb(p)=profile_before from public.profiles p where user_id=device.user_id),
    'badge resume cannot enable account availability, discovery, bluetooth, or change profile');
  perform pg_temp.assert_true(not exists(select 1 from public.consent_receipts where user_id=device.user_id),
    'badge report never grants matching consent');
  perform pg_temp.assert_true((select revision=invalidation_before from public.matching_invalidations where user_id=device.user_id),
    'status-only heartbeat does not churn matching caches');

  -- Move this synthetic lease into the past without sleeping; replay stays stale.
  update public.badge_devices set last_seen_at=now()-interval '1 minute', lease_expires_at=now()-interval '15 seconds'
    where device_id=device.device_id;
  duplicate := public.report_badge_state(device.device_id,repeat('c',64),2,'available');
  perform pg_temp.assert_true(duplicate.lease_expires_at < clock_timestamp(),'expired duplicate cannot restore effective availability');
  device := public.report_badge_state(device.device_id,repeat('c',64),3,'available');
  perform pg_temp.assert_true(device.lease_expires_at > clock_timestamp() and device.last_sequence=3,'new heartbeat renews expired lease');
end;
$$;

-- RLS and grants close direct PostgREST access for both public and app tokens.
set local role anon;
select pg_temp.expect_badge_error('select * from public.badge_devices','42501','anonymous registry read forbidden');
select pg_temp.expect_badge_error($q$select public.report_badge_state('92000000-0000-4000-8000-000000000001',repeat('c',64),4,'paused')$q$,
  '42501','anonymous cannot invoke credential RPC');
reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='91000000-0000-4000-8000-000000000001';
select pg_temp.expect_badge_error('select * from public.badge_devices','42501','owner cannot read credential registry directly');
select pg_temp.expect_badge_error($q$insert into public.badge_devices(user_id,token_hash)
  values('91000000-0000-4000-8000-000000000001',repeat('d',64))$q$,'42501','app cannot provision directly');
select pg_temp.expect_badge_error($q$select public.report_badge_state('92000000-0000-4000-8000-000000000001',repeat('c',64),4,'paused')$q$,
  '42501','app cannot invoke credential RPC');
select pg_temp.expect_badge_error($q$select public.revoke_badge('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001')$q$,
  '42501','app cannot supply an arbitrary owner to revoke RPC');
reset role;
set local role service_role;
select pg_temp.assert_true((public.report_badge_state('92000000-0000-4000-8000-000000000001',repeat('c',64),4,'paused')).reported_state='paused',
  'backend role can invoke report RPC');
reset role;

do $$
declare device public.badge_devices; repeated public.badge_devices;
begin
  device := public.report_badge_state('92000000-0000-4000-8000-000000000001',repeat('c',64),5,'available');
  perform pg_temp.expect_badge_error(format('select public.revoke_badge(%L,%L)',
    '91000000-0000-4000-8000-000000000002',device.device_id),'42501','foreign owner cannot revoke');
  device := public.revoke_badge(device.user_id,device.device_id);
  perform pg_temp.assert_true(device.revoked_at is not null and device.lease_expires_at is null
    and device.reported_state='available' and device.last_sequence=5,'revocation clears active lease while preserving last report');
  repeated := public.revoke_badge(device.user_id,device.device_id);
  perform pg_temp.assert_true(to_jsonb(device)=to_jsonb(repeated),'revocation is idempotent');
  perform pg_temp.expect_badge_error(format('select public.report_badge_state(%L,%L,5,%L)',device.device_id,repeat('c',64),'available'),
    '42501','revoked credential cannot replay');
  perform pg_temp.expect_badge_error(format('select public.report_badge_state(%L,%L,6,%L)',device.device_id,repeat('c',64),'available'),
    '42501','revoked credential cannot send a newer report');
  perform pg_temp.expect_badge_error(format('update public.badge_devices set revoked_at=null where device_id=%L',device.device_id),
    '23514','revocation cannot be cleared');
end;
$$;

-- Multiple separately provisioned devices are allowed; counters remain per device.
insert into public.badge_devices(device_id,user_id,token_hash) values
  ('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001',repeat('d',64));
select pg_temp.assert_true((public.report_badge_state('92000000-0000-4000-8000-000000000002',repeat('d',64),9007199254740991,'paused')).last_sequence=9007199254740991,
  'largest supported firmware sequence preserved exactly');
delete from auth.users where id in ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002');
select pg_temp.assert_true(not exists(select 1 from public.badge_devices where user_id='91000000-0000-4000-8000-000000000001'),
  'account erasure cascades through badge credentials and state');
select pg_temp.expect_badge_error($q$select public.report_badge_state('92000000-0000-4000-8000-000000000002',repeat('d',64),9007199254740991,'paused')$q$,
  '42501','erased credential cannot replay');
select 'All badge database assertions passed.' as result;
