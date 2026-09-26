-- A delayed first AR opt-in (revision zero) must also lose to signout.
-- Retain a tombstone for every existing connection, even before its first opt-in.
create or replace function public.end_device_sessions(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.profiles where user_id=p_user_id for update;
  update public.device_pairings set cancelled_at=coalesce(cancelled_at,clock_timestamp())
    where user_id=p_user_id and consumed_at is null;
  update public.headset_devices set revoked_at=clock_timestamp(),lease_expires_at=null,owner_lease_expires_at=null
    where user_id=p_user_id and revoked_at is null;
  insert into public.connection_display_permissions(request_id,user_id,revision,granted)
    select request_id,p_user_id,1,false from public.connection_requests
    where p_user_id in (requester_user_id,recipient_user_id)
    on conflict(request_id,user_id) do update set granted=false,expires_at=null,active_until=null,
      revision=connection_display_permissions.revision+1;
end $$;
