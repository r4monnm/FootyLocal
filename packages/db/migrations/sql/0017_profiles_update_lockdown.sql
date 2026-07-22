-- SECURITY: RLS profiles_write_own (0002) grants own-row UPDATE but RLS is
-- row-level, not column-level, so an authenticated user could PATCH their own
-- id_verified / photo_verified / verification_level / stripe_charges_enabled and
-- forge verification (defeating the paid-host ID gate). Restrict UPDATE to the
-- columns a user may legitimately edit; all verification/payment/stat columns are
-- writable only by SECURITY DEFINER RPCs or the service-role client.
revoke update on profiles from anon, authenticated;
grant update (display_name, avatar_url, self_reported_skill, preferred_position)
  on profiles to authenticated;
