-- Paid join, called by the Stripe webhook (service role) after a Checkout hold.
-- Race-safe (row lock); records the held payment_intent_id with paid=false.
-- Returns 'joined' | 'full' | 'closed' | 'dup' so the webhook can cancel the
-- hold when the player couldn't be added.
create or replace function join_paid(
  p_game_id uuid,
  p_player_id uuid,
  p_payment_intent_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status game_status;
  v_max integer;
  v_count integer;
begin
  select status, max_players into v_status, v_max
  from games where id = p_game_id for update;
  if not found then return 'closed'; end if;
  if v_status <> 'open' then return 'closed'; end if;

  if exists (
    select 1 from game_players
    where game_id = p_game_id and player_id = p_player_id and status = 'joined'
  ) then return 'dup'; end if;

  select count(*) into v_count
  from game_players where game_id = p_game_id and status = 'joined';
  if v_count >= v_max then return 'full'; end if;

  insert into game_players (game_id, player_id, role, status, paid, payment_intent_id)
  values (p_game_id, p_player_id, 'player', 'joined', false, p_payment_intent_id)
  on conflict (game_id, player_id) do update
    set status = 'joined', role = 'player', paid = false,
        payment_intent_id = excluded.payment_intent_id;

  return 'joined';
end;
$$;

revoke execute on function join_paid(uuid, uuid, text) from public, anon, authenticated;
grant execute on function join_paid(uuid, uuid, text) to service_role;
