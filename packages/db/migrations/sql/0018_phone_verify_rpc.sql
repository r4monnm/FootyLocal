-- Phone verification for clients without a server action (the native app).
-- 0017 made phone_verified non-client-writable; web flips it via a service-role
-- server action, which the app can't do. Phone verification is a DEV STUB (code
-- 000000, anyone can enter it), so an authenticated user setting their OWN
-- phone_verified is consistent with the current threat model. Uses auth.uid()
-- (self only) and never downgrades an existing photo/id verification_level.
-- id_verified/photo_verified remain writable ONLY by the service-role webhook
-- via mark_identity_verified — unchanged. Replaced by real SMS OTP later.
create or replace function mark_phone_verified()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
     set phone_verified = true,
         verification_level = case when verification_level = 'none' then 'phone' else verification_level end,
         updated_at = now()
   where id = auth.uid();
end;
$$;

revoke execute on function mark_phone_verified() from public, anon;
grant execute on function mark_phone_verified() to authenticated;
