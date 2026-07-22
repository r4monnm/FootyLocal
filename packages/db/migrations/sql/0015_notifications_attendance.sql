-- Phase 2c: in-app notifications (RLS + writes inside state-change RPCs),
-- host attendance marking, and reliability stats.

-- RLS: users read/update only their own; only the SECURITY DEFINER RPCs insert.
alter table notifications enable row level security;
drop policy if exists notifications_read_own on notifications;
create policy notifications_read_own on notifications for select using (auth.uid() = user_id);
drop policy if exists notifications_update_own on notifications;
create policy notifications_update_own on notifications for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists notifications_user_read_idx
  on notifications (user_id, read, created_at desc);

-- try_confirm_game: notify all joined players on the open->confirmed transition.
create or replace function try_confirm_game(p_game_id uuid)
returns table (payment_intent_id text)
language plpgsql security definer set search_path = public as $$
declare v_status game_status; v_min integer; v_count integer;
begin
  select status, min_players_to_confirm into v_status, v_min from games where id = p_game_id for update;
  if not found then return; end if;
  select count(*) into v_count from game_players where game_id = p_game_id and status = 'joined';
  if v_status = 'open' and v_count >= v_min then
    update games set status = 'confirmed' where id = p_game_id;
    v_status := 'confirmed';
    insert into notifications (user_id, type, game_id, title, body)
    select gp.player_id, 'game_confirmed', p_game_id, 'Game confirmed',
           'Your game has enough players — it''s on.'
    from game_players gp where gp.game_id = p_game_id and gp.status = 'joined';
  end if;
  if v_status = 'confirmed' then
    return query select gp.payment_intent_id from game_players gp
      where gp.game_id = p_game_id and gp.status = 'joined'
        and gp.paid = false and gp.payment_intent_id is not null;
  end if;
  return;
end;
$$;
revoke execute on function try_confirm_game(uuid) from public, anon, authenticated;
grant execute on function try_confirm_game(uuid) to service_role;

-- promote_waitlist: notify the promoted player.
create or replace function promote_waitlist(p_game_id uuid)
returns table (payment_intent_id text, game_confirmed boolean)
language plpgsql security definer set search_path = public as $$
declare v_status game_status; v_max integer; v_count integer; v_promote uuid; v_pi text;
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
  insert into notifications (user_id, type, game_id, title, body)
  values (v_promote, 'spot_opened', p_game_id, 'You''re in!',
          'A spot opened and you were moved off the waitlist.');
  return query select v_pi, (v_status = 'confirmed');
end;
$$;
revoke execute on function promote_waitlist(uuid) from public, anon, authenticated;
grant execute on function promote_waitlist(uuid) to service_role;

-- cancel_game: notify all cancelled players (host-only, null-guarded).
create or replace function cancel_game(p_game_id uuid)
returns table (payment_intent_id text, paid boolean)
language plpgsql security definer set search_path = public as $$
declare v_host uuid;
begin
  select host_id into v_host from games where id = p_game_id for update;
  if not found then raise exception 'game not found'; end if;
  if auth.uid() is null or v_host <> auth.uid() then
    raise exception 'only the host can cancel this game';
  end if;
  update games set status = 'cancelled' where id = p_game_id;
  insert into notifications (user_id, type, game_id, title, body)
  select gp.player_id, 'game_cancelled', p_game_id, 'Game cancelled',
         'The host cancelled this game. Any payment is refunded.'
  from game_players gp where gp.game_id = p_game_id and gp.status in ('joined','waitlisted');
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

-- mark_attendance: host-only, past-game-only; flip joined -> attended/no_show.
create or replace function mark_attendance(p_game_id uuid, p_attended uuid[], p_no_show uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_host uuid; v_ends timestamptz;
begin
  select host_id, ends_at into v_host, v_ends from games where id = p_game_id for update;
  if not found then raise exception 'game not found'; end if;
  if auth.uid() is null or v_host <> auth.uid() then
    raise exception 'only the host can mark attendance';
  end if;
  if v_ends >= now() then raise exception 'attendance can only be marked after the game ends'; end if;
  update game_players set status = 'attended'
    where game_id = p_game_id and status = 'joined' and player_id = any(p_attended);
  update game_players set status = 'no_show'
    where game_id = p_game_id and status = 'joined' and player_id = any(p_no_show);
end;
$$;
grant execute on function mark_attendance(uuid, uuid[], uuid[]) to authenticated;

-- profile_stats: add attended / no_shows / reliability. Return shape changes → drop first.
drop function if exists profile_stats(uuid);
create function profile_stats(p_user_id uuid)
returns table (
  games_played bigint, karma bigint, avg_skill numeric, ratings_count bigint,
  attended bigint, no_shows bigint, reliability numeric
)
language sql security definer set search_path = public as $$
  select
    (select count(distinct gp.game_id) from game_players gp join games g on g.id = gp.game_id
       where gp.player_id = p_user_id and gp.status = 'joined' and g.ends_at < now()),
    (select count(*) from ratings where ratee_id = p_user_id and reliability_up),
    (select avg((skill_score->>'skill')::numeric) from ratings
       where ratee_id = p_user_id and jsonb_typeof(skill_score->'skill') = 'number'
         and (skill_score->>'skill')::numeric between 1 and 5),
    (select count(*) from ratings where ratee_id = p_user_id),
    (select count(*) from game_players where player_id = p_user_id and status = 'attended'),
    (select count(*) from game_players where player_id = p_user_id and status = 'no_show'),
    (select round(
       count(*) filter (where status = 'attended')::numeric
         / nullif(count(*) filter (where status in ('attended','no_show')), 0), 2)
     from game_players where player_id = p_user_id);
$$;
grant execute on function profile_stats(uuid) to anon, authenticated;
