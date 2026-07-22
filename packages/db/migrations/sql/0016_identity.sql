-- Phase 3b: identity verification (Stripe Identity).

-- 1) Protected column for the pending Identity session id. Like stripe_account_id,
-- it is server-only (service client). profiles' table SELECT was revoked in 0013
-- and re-granted per-column WITHOUT this column, so it is already excluded from
-- anon/authenticated; this explicit revoke documents and hard-guarantees that.
alter table profiles add column if not exists stripe_identity_session_id text;
revoke select (stripe_identity_session_id) on profiles from anon, authenticated;

-- 2) Flip verification flags on a completed Stripe Identity session. Called only
-- by the webhook (service role). SECURITY DEFINER + service_role-only, like create_game.
create or replace function mark_identity_verified(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
     set photo_verified = true,
         id_verified = true,
         verification_level = 'id',
         updated_at = now()
   where id = p_user_id;
end;
$$;

revoke execute on function mark_identity_verified(uuid) from public, anon, authenticated;
grant execute on function mark_identity_verified(uuid) to service_role;

-- 3) Paid-host ID gate. Redefines create_game from 0006 (same signature / returns uuid,
-- so no drop needed): a host may only create a PAID game if they are ID-verified. This is
-- the authoritative server-side guard behind the app-layer pre-check (never trust client).
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

  if p_price_cents > 0 then
    if not exists (select 1 from profiles where id = p_host_id and id_verified = true) then
      raise exception 'host must be ID-verified to collect payment';
    end if;
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

revoke execute on function create_game(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, skill_band,
  game_format, integer, integer, boolean, integer, double precision, double precision
) from public, anon, authenticated;
grant execute on function create_game(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, skill_band,
  game_format, integer, integer, boolean, integer, double precision, double precision
) to service_role;
