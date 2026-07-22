-- Phase 1c: post-game ratings, computed profile stats, my games, and
-- bidirectional host-level block invisibility in games_near/game_detail.

-- Rate a co-participant of a PAST game you were on. Anonymous; upsert.
create or replace function submit_rating(
  p_game_id uuid,
  p_ratee_id uuid,
  p_skill_score jsonb,
  p_reliability_up boolean,
  p_is_host_rating boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rater uuid := auth.uid();
  v_ends timestamptz;
begin
  if v_rater is null then raise exception 'not authenticated'; end if;
  if v_rater = p_ratee_id then raise exception 'you cannot rate yourself'; end if;

  select ends_at into v_ends from games where id = p_game_id;
  if not found then raise exception 'game not found'; end if;
  if v_ends >= now() then raise exception 'you can only rate a past game'; end if;

  if not exists (
    select 1 from game_players
    where game_id = p_game_id and player_id = v_rater and status = 'joined'
  ) then raise exception 'you were not on this game roster'; end if;

  if not exists (
    select 1 from game_players
    where game_id = p_game_id and player_id = p_ratee_id and status = 'joined'
  ) then raise exception 'that player was not on this game roster'; end if;

  insert into ratings (game_id, rater_id, ratee_id, skill_score, reliability_up, is_host_rating)
  values (p_game_id, v_rater, p_ratee_id, p_skill_score, p_reliability_up, p_is_host_rating)
  on conflict (game_id, rater_id, ratee_id) do update
    set skill_score = excluded.skill_score,
        reliability_up = excluded.reliability_up,
        is_host_rating = excluded.is_host_rating;

  return 'rated';
end;
$$;

grant execute on function submit_rating(uuid, uuid, jsonb, boolean, boolean) to authenticated;

-- Computed public profile stats (no stored counter; preserves rater anonymity).
create or replace function profile_stats(p_user_id uuid)
returns table (
  games_played bigint,
  karma bigint,
  avg_skill numeric,
  ratings_count bigint
)
language sql
security definer
set search_path = public
as $$
  select
    (select count(distinct gp.game_id)
       from game_players gp join games g on g.id = gp.game_id
       where gp.player_id = p_user_id and gp.status = 'joined' and g.ends_at < now()),
    (select count(*) from ratings where ratee_id = p_user_id and reliability_up),
    (select avg((skill_score->>'skill')::numeric)
       from ratings where ratee_id = p_user_id and skill_score ? 'skill'),
    (select count(*) from ratings where ratee_id = p_user_id);
$$;

grant execute on function profile_stats(uuid) to anon, authenticated;

-- The caller's roster games (upcoming + past), for the My Games tab.
-- drop-first so the replay stays re-runnable after 0014 changes my_games'
-- return shape (adds status/player_status columns).
drop function if exists my_games();
create or replace function my_games()
returns table (
  id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  venue_name text,
  role player_role,
  is_past boolean
)
language sql
security definer
set search_path = public
as $$
  select g.id, g.title, g.starts_at, g.ends_at, ve.name, gp.role, (g.ends_at < now())
  from game_players gp
  join games g on g.id = gp.game_id
  join venues ve on ve.id = g.venue_id
  where gp.player_id = auth.uid() and gp.status = 'joined'
  order by g.starts_at;
$$;

grant execute on function my_games() to authenticated;

-- Rebuild games_near: add bidirectional host block exclusion. Same return shape
-- as 0007, so CREATE OR REPLACE is valid.
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
  max_players integer,
  joined_count bigint,
  host_name text,
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
    g.id, g.title, g.skill_band, g.format, g.price_cents, g.starts_at, g.is_women_only,
    g.max_players,
    (select count(*) from game_players gp2
       where gp2.game_id = g.id and gp2.status = 'joined') as joined_count,
    (select display_name from profiles p where p.id = g.host_id) as host_name,
    st_y(g.public_location::geometry) as public_lat,
    st_x(g.public_location::geometry) as public_lng,
    case when joined.player_id is not null
         then st_y(g.precise_location::geometry) end as precise_lat,
    case when joined.player_id is not null
         then st_x(g.precise_location::geometry) end as precise_lng,
    st_distance(g.public_location, st_makepoint(lng, lat)::geography) as distance_meters
  from games g
  left join game_players joined
    on joined.game_id = g.id
   and joined.player_id = auth.uid()
   and joined.status = 'joined'
  where g.status in ('open', 'confirmed')
    and st_dwithin(g.public_location, st_makepoint(lng, lat)::geography, radius_meters)
    and (filters->>'skill_band' is null or g.skill_band = (filters->>'skill_band')::skill_band)
    and (filters->>'women_only' is null or g.is_women_only = (filters->>'women_only')::boolean)
    and (filters->>'format' is null or g.format = (filters->>'format')::game_format)
    and (filters->>'price_max_cents' is null or g.price_cents <= (filters->>'price_max_cents')::integer)
    and (filters->>'starts_after' is null or g.starts_at >= (filters->>'starts_after')::timestamptz)
    and (filters->>'starts_before' is null or g.starts_at <= (filters->>'starts_before')::timestamptz)
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = g.host_id)
         or (b.blocker_id = g.host_id  and b.blocked_id = auth.uid())
    )
  order by distance_meters asc;
$$;

grant execute on function games_near(double precision, double precision, integer, jsonb)
  to anon, authenticated;

-- Rebuild game_detail: add the same host block exclusion (blocked host's game
-- returns no row). drop-first so the replay stays re-runnable after 0014
-- changes game_detail's return shape.
drop function if exists game_detail(uuid);
create or replace function game_detail(p_game_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  skill_band skill_band,
  format game_format,
  price_cents integer,
  starts_at timestamptz,
  ends_at timestamptz,
  is_women_only boolean,
  max_players integer,
  min_players_to_confirm integer,
  status game_status,
  host_id uuid,
  host_name text,
  venue_name text,
  venue_address text,
  surface_type surface_type,
  public_lat double precision,
  public_lng double precision,
  joined_count bigint,
  viewer_joined boolean,
  precise_lat double precision,
  precise_lng double precision,
  roster jsonb
)
language sql
security definer
set search_path = public
as $$
  with v as (
    select exists (
      select 1 from game_players gp
      where gp.game_id = p_game_id and gp.player_id = auth.uid() and gp.status = 'joined'
    ) as joined
  )
  select
    g.id, g.title, g.description, g.skill_band, g.format,
    g.price_cents, g.starts_at, g.ends_at, g.is_women_only,
    g.max_players, g.min_players_to_confirm, g.status,
    g.host_id, hp.display_name as host_name,
    ve.name as venue_name, ve.address as venue_address, ve.surface_type,
    st_y(g.public_location::geometry) as public_lat,
    st_x(g.public_location::geometry) as public_lng,
    (select count(*) from game_players gp2
       where gp2.game_id = g.id and gp2.status = 'joined') as joined_count,
    v.joined as viewer_joined,
    case when v.joined then st_y(g.precise_location::geometry) end as precise_lat,
    case when v.joined then st_x(g.precise_location::geometry) end as precise_lng,
    case when v.joined then (
      select jsonb_agg(
        jsonb_build_object('player_id', p.id, 'name', p.display_name, 'role', gp3.role)
        order by gp3.role
      )
      from game_players gp3 join profiles p on p.id = gp3.player_id
      where gp3.game_id = g.id and gp3.status = 'joined'
    ) end as roster
  from games g
  join profiles hp on hp.id = g.host_id
  join venues ve on ve.id = g.venue_id
  cross join v
  where g.id = p_game_id
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = g.host_id)
         or (b.blocker_id = g.host_id  and b.blocked_id = auth.uid())
    );
$$;

grant execute on function game_detail(uuid) to anon, authenticated;
