-- Returns a verified venue's precise lat/lng for the server-side fuzz input.
-- service_role-only (used by packages/db createGame + seed).
create or replace function venue_latlng(v_id uuid)
returns table (lat double precision, lng double precision)
language sql
security definer
set search_path = public
as $$
  select st_y(location::geometry) as lat, st_x(location::geometry) as lng
  from venues
  where id = v_id and is_verified = true;
$$;

-- Supabase's default ACLs grant EXECUTE on new public-schema functions to
-- anon/authenticated (not just PUBLIC), so those must be revoked explicitly
-- too, or a client could call this and read a venue's precise coordinates.
revoke execute on function venue_latlng(uuid) from public, anon, authenticated;
grant execute on function venue_latlng(uuid) to service_role;
