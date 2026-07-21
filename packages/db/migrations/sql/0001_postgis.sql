-- PostGIS extension + geography columns + GiST indexes.
create extension if not exists postgis;

alter table venues add column if not exists location geography(Point, 4326);
alter table games  add column if not exists precise_location geography(Point, 4326);
alter table games  add column if not exists public_location  geography(Point, 4326);

create index if not exists venues_location_gix
  on venues using gist (location);
create index if not exists games_precise_location_gix
  on games using gist (precise_location);
create index if not exists games_public_location_gix
  on games using gist (public_location);
