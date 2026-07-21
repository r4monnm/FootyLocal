-- Fix game_players_read: the original policy's EXISTS subquery referenced
-- game_players from inside game_players' own policy, causing Postgres 42P17
-- "infinite recursion detected in policy" on any direct SELECT, AND (once
-- leave_game creates 'cancelled' rows) would have let a departed player still
-- satisfy the check and enumerate the roster.
--
-- Roster VIEWING is served entirely by the game_detail / games_near
-- SECURITY DEFINER RPCs (which gate the roster to on-roster callers and bypass
-- table RLS). No app code reads game_players directly as an authenticated user
-- (only the service-role seed does, which bypasses RLS). So the direct-table
-- policy only needs to let a user read their OWN roster rows — which removes the
-- self-reference, fixing the recursion and closing the enumeration path.
drop policy if exists game_players_read on game_players;
create policy game_players_read on game_players for select
  using (auth.uid() = player_id);
