-- SECURITY DEFINER RPC: returns fuzzed public_location to everyone, and the
-- precise_location ONLY for games the caller is on the roster of.
create or replace function games_near(
  lat double precision,
  lng double precision,
  radius_meters integer,
  filters jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  title text,
  skill_band skill_band,
  format game_format,
  price_cents integer,
  starts_at timestamptz,
  is_women_only boolean,
  public_lat double precision,
  public_lng double precision,
  precise_lat double precision,
  precise_lng double precision,
  distance_meters double precision
)
language sql
security definer
set search_path = public
as $$
  select
    g.id,
    g.title,
    g.skill_band,
    g.format,
    g.price_cents,
    g.starts_at,
    g.is_women_only,
    st_y(g.public_location::geometry) as public_lat,
    st_x(g.public_location::geometry) as public_lng,
    case when joined.player_id is not null
         then st_y(g.precise_location::geometry) end as precise_lat,
    case when joined.player_id is not null
         then st_x(g.precise_location::geometry) end as precise_lng,
    st_distance(
      g.public_location,
      st_makepoint(lng, lat)::geography
    ) as distance_meters
  from games g
  left join game_players joined
    on joined.game_id = g.id
   and joined.player_id = auth.uid()
   and joined.status = 'joined'
  where g.status in ('open', 'confirmed')
    and st_dwithin(
      g.public_location,
      st_makepoint(lng, lat)::geography,
      radius_meters
    )
    and (filters->>'skill_band' is null
         or g.skill_band = (filters->>'skill_band')::skill_band)
    and (filters->>'women_only' is null
         or g.is_women_only = (filters->>'women_only')::boolean)
  order by distance_meters asc;
$$;

grant execute on function games_near(double precision, double precision, integer, jsonb)
  to anon, authenticated;
