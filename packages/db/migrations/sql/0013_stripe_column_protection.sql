-- stripe_account_id is used only by server-side code (service client). The
-- permissive profiles_read policy (using(true)) + default table SELECT grant
-- would otherwise make it world-readable (RLS is row-level, not column-level).
-- Revoke table SELECT and re-grant every column EXCEPT stripe_account_id.
revoke select on profiles from anon, authenticated;
grant select (
  id, display_name, avatar_url, phone_verified, photo_verified, id_verified,
  verification_level, self_reported_skill, hidden_mmr, mmr_rd, mmr_volatility,
  karma, games_played, no_shows, preferred_position, is_18_plus,
  created_at, updated_at, stripe_charges_enabled
) on profiles to anon, authenticated;
