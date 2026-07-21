-- Atomic game create: sets precise_location from the venue, stores the
-- server-computed fuzzed public_location, adds the host to the roster.
-- SECURITY DEFINER + granted ONLY to service_role so a client cannot call it
-- and inject an un-fuzzed public_location.
create or replace function create_game(
  p_game_id uuid,
  p_host_id uuid,
  p_venue_id uuid,
  p_title text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_skill_band skill_band,
  p_format game_format,
  p_max_players integer,
  p_min_players_to_confirm integer,
  p_is_women_only boolean,
  p_price_cents integer,
  p_public_lat double precision,
  p_public_lng double precision
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location geography;
begin
  select location into v_location
  from venues
  where id = p_venue_id and is_verified = true;

  if v_location is null then
    raise exception 'venue % is not a verified venue', p_venue_id;
  end if;

  insert into games (
    id, host_id, venue_id, title, description, starts_at, ends_at,
    skill_band, format, max_players, price_cents, status,
    min_players_to_confirm, is_women_only, precise_location, public_location
  ) values (
    p_game_id, p_host_id, p_venue_id, p_title, p_description, p_starts_at, p_ends_at,
    p_skill_band, p_format, p_max_players, p_price_cents, 'open',
    p_min_players_to_confirm, p_is_women_only,
    v_location,
    st_makepoint(p_public_lng, p_public_lat)::geography
  );

  insert into game_players (game_id, player_id, role, status)
  values (p_game_id, p_host_id, 'host', 'joined');

  return p_game_id;
end;
$$;

-- Supabase's default ACLs grant EXECUTE on new public-schema functions to
-- anon/authenticated (not just PUBLIC), so those must be revoked explicitly
-- too, or a client could call this directly and inject an un-fuzzed
-- public_location.
revoke execute on function create_game(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, skill_band,
  game_format, integer, integer, boolean, integer, double precision, double precision
) from public, anon, authenticated;
grant execute on function create_game(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, skill_band,
  game_format, integer, integer, boolean, integer, double precision, double precision
) to service_role;
