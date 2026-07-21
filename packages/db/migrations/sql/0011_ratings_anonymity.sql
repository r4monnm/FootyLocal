-- Anonymity fix: a ratee could read rater_id via a direct SELECT under the
-- ratings_read_about_me policy, defeating anonymous ratings. Drop it — ratees
-- get only aggregates via profile_stats (SECURITY DEFINER). ratings_rw_own still
-- lets a rater read/write their OWN ratings (rater_id = auth.uid()).
drop policy if exists ratings_read_about_me on ratings;

-- Harden submit_rating: validate skill_score server-side (the web Zod bounds are
-- not a security boundary for an authenticated-granted RPC).
create or replace function submit_rating(
  p_game_id uuid, p_ratee_id uuid, p_skill_score jsonb,
  p_reliability_up boolean, p_is_host_rating boolean
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_rater uuid := auth.uid();
  v_ends timestamptz;
begin
  if v_rater is null then raise exception 'not authenticated'; end if;
  if v_rater = p_ratee_id then raise exception 'you cannot rate yourself'; end if;
  select ends_at into v_ends from games where id = p_game_id;
  if not found then raise exception 'game not found'; end if;
  if v_ends >= now() then raise exception 'you can only rate a past game'; end if;
  if not exists (select 1 from game_players where game_id = p_game_id and player_id = v_rater and status = 'joined')
    then raise exception 'you were not on this game roster'; end if;
  if not exists (select 1 from game_players where game_id = p_game_id and player_id = p_ratee_id and status = 'joined')
    then raise exception 'that player was not on this game roster'; end if;
  if jsonb_typeof(p_skill_score->'skill') <> 'number'
     or jsonb_typeof(p_skill_score->'sportsmanship') <> 'number'
     or (p_skill_score->>'skill')::numeric not between 1 and 5
     or (p_skill_score->>'sportsmanship')::numeric not between 1 and 5
     or (p_skill_score->>'skill')::numeric <> floor((p_skill_score->>'skill')::numeric)
     or (p_skill_score->>'sportsmanship')::numeric <> floor((p_skill_score->>'sportsmanship')::numeric)
    then raise exception 'invalid skill_score (skill and sportsmanship must be integers 1..5)'; end if;
  insert into ratings (game_id, rater_id, ratee_id, skill_score, reliability_up, is_host_rating)
  values (p_game_id, v_rater, p_ratee_id, p_skill_score, p_reliability_up, p_is_host_rating)
  on conflict (game_id, rater_id, ratee_id) do update
    set skill_score = excluded.skill_score, reliability_up = excluded.reliability_up, is_host_rating = excluded.is_host_rating;
  return 'rated';
end;
$$;
grant execute on function submit_rating(uuid, uuid, jsonb, boolean, boolean) to authenticated;

-- Harden profile_stats avg against any malformed/poisoned skill values.
create or replace function profile_stats(p_user_id uuid)
returns table (games_played bigint, karma bigint, avg_skill numeric, ratings_count bigint)
language sql security definer set search_path = public as $$
  select
    (select count(distinct gp.game_id) from game_players gp join games g on g.id = gp.game_id
       where gp.player_id = p_user_id and gp.status = 'joined' and g.ends_at < now()),
    (select count(*) from ratings where ratee_id = p_user_id and reliability_up),
    (select avg((skill_score->>'skill')::numeric) from ratings
       where ratee_id = p_user_id and jsonb_typeof(skill_score->'skill') = 'number'
         and (skill_score->>'skill')::numeric between 1 and 5),
    (select count(*) from ratings where ratee_id = p_user_id);
$$;
grant execute on function profile_stats(uuid) to anon, authenticated;
