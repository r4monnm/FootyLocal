-- Phase 1b: game detail (precise + roster gated to on-roster callers),
-- race-safe join, leave. All SECURITY DEFINER, self-gated on auth.uid().

-- Single-game detail. precise_* and roster are null unless the caller is on
-- the roster (status='joined').
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
      where gp.game_id = p_game_id
        and gp.player_id = auth.uid()
        and gp.status = 'joined'
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
  where g.id = p_game_id;
$$;

grant execute on function game_detail(uuid) to anon, authenticated;

-- Race-safe join. Only inserts auth.uid()'s own roster row.
create or replace function join_game(p_game_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player uuid := auth.uid();
  v_status game_status;
  v_max integer;
  v_count integer;
  v_verified boolean;
begin
  if v_player is null then raise exception 'not authenticated'; end if;

  -- Lock the game row so concurrent joins can't oversell the last spot.
  select status, max_players into v_status, v_max
  from games where id = p_game_id for update;
  if not found then raise exception 'game not found'; end if;
  if v_status <> 'open' then raise exception 'this game is not open for joining'; end if;

  select phone_verified into v_verified from profiles where id = v_player;
  if not coalesce(v_verified, false) then
    raise exception 'you must verify your phone to join';
  end if;

  if exists (
    select 1 from game_players
    where game_id = p_game_id and player_id = v_player and status = 'joined'
  ) then
    raise exception 'you are already on this roster';
  end if;

  select count(*) into v_count
  from game_players where game_id = p_game_id and status = 'joined';
  if v_count >= v_max then raise exception 'this game is full'; end if;

  insert into game_players (game_id, player_id, role, status)
  values (p_game_id, v_player, 'player', 'joined')
  on conflict (game_id, player_id) do update set status = 'joined', role = 'player';

  return 'joined';
end;
$$;

grant execute on function join_game(uuid) to authenticated;

-- Leave (cancel the caller's roster row). Host cannot leave their own game.
create or replace function leave_game(p_game_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player uuid := auth.uid();
  v_role player_role;
begin
  if v_player is null then raise exception 'not authenticated'; end if;

  select role into v_role
  from game_players
  where game_id = p_game_id and player_id = v_player and status = 'joined';
  if not found then raise exception 'you are not on this roster'; end if;
  if v_role = 'host' then raise exception 'the host cannot leave their own game'; end if;

  update game_players set status = 'cancelled'
  where game_id = p_game_id and player_id = v_player;

  return 'left';
end;
$$;

grant execute on function leave_game(uuid) to authenticated;
