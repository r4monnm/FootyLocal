-- Phase 2b: confirmation/capture, cancel/refund, leave-with-deadline, waitlists.
-- RPCs FOR UPDATE the game row and return PaymentIntent lists for the app layer
-- to capture/void/refund via Stripe.

-- join_game: waitlist when full instead of rejecting. Joinable while open/confirmed.
create or replace function join_game(p_game_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_player uuid := auth.uid();
  v_status game_status;
  v_max integer;
  v_count integer;
  v_verified boolean;
  v_new player_status;
begin
  if v_player is null then raise exception 'not authenticated'; end if;
  select status, max_players into v_status, v_max from games where id = p_game_id for update;
  if not found then raise exception 'game not found'; end if;
  if v_status not in ('open', 'confirmed') then raise exception 'this game is not open for joining'; end if;
  select phone_verified into v_verified from profiles where id = v_player;
  if not coalesce(v_verified, false) then raise exception 'you must verify your phone to join'; end if;
  if exists (select 1 from game_players where game_id = p_game_id and player_id = v_player and status in ('joined','waitlisted')) then
    raise exception 'you are already on this roster';
  end if;
  select count(*) into v_count from game_players where game_id = p_game_id and status = 'joined';
  v_new := case when v_count < v_max then 'joined' else 'waitlisted' end;
  insert into game_players (game_id, player_id, role, status)
  values (p_game_id, v_player, 'player', v_new)
  on conflict (game_id, player_id) do update set status = v_new, role = 'player';
  return v_new::text;
end;
$$;
grant execute on function join_game(uuid) to authenticated;

-- join_paid: waitlist when full; keep the hold. Returns joined|waitlisted|closed|dup.
create or replace function join_paid(p_game_id uuid, p_player_id uuid, p_payment_intent_id text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_status game_status;
  v_max integer;
  v_count integer;
  v_new player_status;
begin
  select status, max_players into v_status, v_max from games where id = p_game_id for update;
  if not found then return 'closed'; end if;
  if v_status not in ('open', 'confirmed') then return 'closed'; end if;
  if exists (select 1 from game_players where game_id = p_game_id and player_id = p_player_id and status in ('joined','waitlisted')) then
    return 'dup';
  end if;
  select count(*) into v_count from game_players where game_id = p_game_id and status = 'joined';
  v_new := case when v_count < v_max then 'joined' else 'waitlisted' end;
  insert into game_players (game_id, player_id, role, status, paid, payment_intent_id)
  values (p_game_id, p_player_id, 'player', v_new, false, p_payment_intent_id)
  on conflict (game_id, player_id) do update
    set status = v_new, role = 'player', paid = false, payment_intent_id = excluded.payment_intent_id;
  return v_new::text;
end;
$$;
revoke execute on function join_paid(uuid, uuid, text) from public, anon, authenticated;
grant execute on function join_paid(uuid, uuid, text) to service_role;

-- try_confirm_game: confirm at min; return uncaptured joined holds (whether it just
-- confirmed or was already confirmed — so joins after confirmation also capture).
create or replace function try_confirm_game(p_game_id uuid)
returns table (payment_intent_id text)
language plpgsql security definer set search_path = public as $$
declare
  v_status game_status;
  v_min integer;
  v_count integer;
begin
  select status, min_players_to_confirm into v_status, v_min from games where id = p_game_id for update;
  if not found then return; end if;
  select count(*) into v_count from game_players where game_id = p_game_id and status = 'joined';
  if v_status = 'open' and v_count >= v_min then
    update games set status = 'confirmed' where id = p_game_id;
    v_status := 'confirmed';
  end if;
  if v_status = 'confirmed' then
    return query
      select gp.payment_intent_id from game_players gp
      where gp.game_id = p_game_id and gp.status = 'joined'
        and gp.paid = false and gp.payment_intent_id is not null;
  end if;
  return;
end;
$$;
revoke execute on function try_confirm_game(uuid) from public, anon, authenticated;
grant execute on function try_confirm_game(uuid) to service_role;

-- mark_captured: idempotent flip to paid=true.
create or replace function mark_captured(p_payment_intent_id text)
returns void language sql security definer set search_path = public as $$
  update game_players set paid = true where payment_intent_id = p_payment_intent_id and paid = false;
$$;
revoke execute on function mark_captured(text) from public, anon, authenticated;
grant execute on function mark_captured(text) to service_role;

-- cancel_game: host-only; cancel game + rows; return PIs to void/refund.
create or replace function cancel_game(p_game_id uuid)
returns table (payment_intent_id text, paid boolean)
language plpgsql security definer set search_path = public as $$
declare v_host uuid;
begin
  select host_id into v_host from games where id = p_game_id for update;
  if not found then raise exception 'game not found'; end if;
  if v_host <> auth.uid() then raise exception 'only the host can cancel this game'; end if;
  update games set status = 'cancelled' where id = p_game_id;
  return query
    with c as (
      update game_players set status = 'cancelled'
      where game_id = p_game_id and status in ('joined','waitlisted')
      returning game_players.payment_intent_id as pi, game_players.paid as pd
    )
    select c.pi, c.pd from c where c.pi is not null;
end;
$$;
grant execute on function cancel_game(uuid) to authenticated;

-- leave_game: cancel the caller's row; return their PI info + was_joined.
-- Return shape changed (text -> table); CREATE OR REPLACE can't alter that, so drop first.
drop function if exists leave_game(uuid);
create or replace function leave_game(p_game_id uuid)
returns table (payment_intent_id text, paid boolean, starts_at timestamptz, was_joined boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_player uuid := auth.uid();
  v_role player_role;
  v_status player_status;
  v_pi text;
  v_paid boolean;
  v_starts timestamptz;
begin
  if v_player is null then raise exception 'not authenticated'; end if;
  select gp.role, gp.status, gp.payment_intent_id, gp.paid, g.starts_at
    into v_role, v_status, v_pi, v_paid, v_starts
  from game_players gp join games g on g.id = gp.game_id
  where gp.game_id = p_game_id and gp.player_id = v_player and gp.status in ('joined','waitlisted');
  if not found then raise exception 'you are not on this roster'; end if;
  if v_role = 'host' then raise exception 'the host cannot leave their own game'; end if;
  update game_players set status = 'cancelled' where game_id = p_game_id and player_id = v_player;
  return query select v_pi, v_paid, v_starts, (v_status = 'joined');
end;
$$;
grant execute on function leave_game(uuid) to authenticated;

-- promote_waitlist: on a freed spot, promote the earliest waitlisted to joined.
create or replace function promote_waitlist(p_game_id uuid)
returns table (payment_intent_id text, game_confirmed boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_status game_status;
  v_max integer;
  v_count integer;
  v_promote uuid;
  v_pi text;
begin
  select status, max_players into v_status, v_max from games where id = p_game_id for update;
  if not found then return; end if;
  select count(*) into v_count from game_players where game_id = p_game_id and status = 'joined';
  if v_count >= v_max then return; end if;
  select player_id, game_players.payment_intent_id into v_promote, v_pi
  from game_players where game_id = p_game_id and status = 'waitlisted'
  order by joined_at asc limit 1;
  if v_promote is null then return; end if;
  update game_players set status = 'joined' where game_id = p_game_id and player_id = v_promote;
  return query select v_pi, (v_status = 'confirmed');
end;
$$;
revoke execute on function promote_waitlist(uuid) from public, anon, authenticated;
grant execute on function promote_waitlist(uuid) to service_role;

-- game_detail: add viewer_status (joined|waitlisted|null). precise/roster still
-- gated on viewer_joined (= joined). Keep the block exclusion + all columns.
-- Column list changed (adds viewer_status); CREATE OR REPLACE can't alter that, so drop first.
drop function if exists game_detail(uuid);
create or replace function game_detail(p_game_id uuid)
returns table (
  id uuid, title text, description text, skill_band skill_band, format game_format,
  price_cents integer, starts_at timestamptz, ends_at timestamptz, is_women_only boolean,
  max_players integer, min_players_to_confirm integer, status game_status,
  host_id uuid, host_name text, venue_name text, venue_address text, surface_type surface_type,
  public_lat double precision, public_lng double precision, joined_count bigint,
  viewer_joined boolean, viewer_status text,
  precise_lat double precision, precise_lng double precision, roster jsonb
)
language sql security definer set search_path = public as $$
  with v as (
    select (select status from game_players gp
            where gp.game_id = p_game_id and gp.player_id = auth.uid()
              and gp.status in ('joined','waitlisted') limit 1)::text as vstatus
  )
  select
    g.id, g.title, g.description, g.skill_band, g.format,
    g.price_cents, g.starts_at, g.ends_at, g.is_women_only,
    g.max_players, g.min_players_to_confirm, g.status,
    g.host_id, hp.display_name, ve.name, ve.address, ve.surface_type,
    st_y(g.public_location::geometry), st_x(g.public_location::geometry),
    (select count(*) from game_players gp2 where gp2.game_id = g.id and gp2.status = 'joined'),
    coalesce(v.vstatus = 'joined', false), v.vstatus,
    case when v.vstatus = 'joined' then st_y(g.precise_location::geometry) end,
    case when v.vstatus = 'joined' then st_x(g.precise_location::geometry) end,
    case when v.vstatus = 'joined' then (
      select jsonb_agg(jsonb_build_object('player_id', p.id, 'name', p.display_name, 'role', gp3.role) order by gp3.role)
      from game_players gp3 join profiles p on p.id = gp3.player_id
      where gp3.game_id = g.id and gp3.status = 'joined'
    ) end
  from games g
  join profiles hp on hp.id = g.host_id
  join venues ve on ve.id = g.venue_id
  cross join v
  where g.id = p_game_id
    and not exists (select 1 from blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = g.host_id)
         or (b.blocker_id = g.host_id and b.blocked_id = auth.uid()));
$$;
grant execute on function game_detail(uuid) to anon, authenticated;

-- my_games: include waitlisted games; return game status + player status.
-- Column list changed (adds status, player_status); CREATE OR REPLACE can't alter that, so drop first.
drop function if exists my_games();
create or replace function my_games()
returns table (
  id uuid, title text, starts_at timestamptz, ends_at timestamptz,
  venue_name text, role player_role, is_past boolean,
  status game_status, player_status player_status
)
language sql security definer set search_path = public as $$
  select g.id, g.title, g.starts_at, g.ends_at, ve.name, gp.role, (g.ends_at < now()),
    g.status, gp.status
  from game_players gp
  join games g on g.id = gp.game_id
  join venues ve on ve.id = g.venue_id
  where gp.player_id = auth.uid() and gp.status in ('joined','waitlisted')
  order by g.starts_at;
$$;
grant execute on function my_games() to authenticated;
