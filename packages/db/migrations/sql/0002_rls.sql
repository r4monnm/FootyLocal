-- Enable RLS on every table and add baseline policies.
alter table profiles          enable row level security;
alter table venues            enable row level security;
alter table games             enable row level security;
alter table game_players      enable row level security;
alter table ratings           enable row level security;
alter table reports           enable row level security;
alter table blocks            enable row level security;
alter table tournaments       enable row level security;
alter table tournament_teams  enable row level security;
alter table tournament_matches enable row level security;
alter table standings         enable row level security;
alter table trusted_contacts  enable row level security;

-- profiles: anyone can read; users write only their own row.
create policy profiles_read on profiles for select using (true);
create policy profiles_write_own on profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);
create policy profiles_insert_own on profiles for insert
  with check (auth.uid() = id);

-- venues: verified venues readable by all; no client writes (seeded by service role).
create policy venues_read_verified on venues for select using (is_verified = true);

-- games: open games readable by all (precise column protected by RPC, not here);
-- hosts manage only their own games.
create policy games_read_open on games for select
  using (status in ('open','confirmed','completed'));
create policy games_host_all on games for all
  using (auth.uid() = host_id) with check (auth.uid() = host_id);

-- game_players: a player sees rosters of games they're on; writes only own rows.
create policy game_players_read on game_players for select
  using (
    auth.uid() = player_id
    or exists (
      select 1 from game_players gp
      where gp.game_id = game_players.game_id and gp.player_id = auth.uid()
    )
  );
create policy game_players_write_own on game_players for all
  using (auth.uid() = player_id) with check (auth.uid() = player_id);

-- ratings: raters manage their own ratings; ratees can read ratings about them.
create policy ratings_rw_own on ratings for all
  using (auth.uid() = rater_id) with check (auth.uid() = rater_id);
create policy ratings_read_about_me on ratings for select
  using (auth.uid() = ratee_id);

-- reports: reporters manage their own reports.
create policy reports_rw_own on reports for all
  using (auth.uid() = reporter_id) with check (auth.uid() = reporter_id);

-- blocks: users manage their own block list.
create policy blocks_rw_own on blocks for all
  using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- tournaments: readable by all; hosts manage their own.
create policy tournaments_read on tournaments for select using (true);
create policy tournaments_host_all on tournaments for all
  using (auth.uid() = host_id) with check (auth.uid() = host_id);
create policy tournament_teams_read on tournament_teams for select using (true);
create policy tournament_matches_read on tournament_matches for select using (true);
create policy standings_read on standings for select using (true);

-- trusted_contacts: strictly private to the owner.
create policy trusted_contacts_rw_own on trusted_contacts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
