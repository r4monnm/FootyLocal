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

-- Helper so seeds can set a venue's geography point by lat/lng.
create or replace function set_venue_location(venue_id uuid, lat double precision, lng double precision)
returns void
language sql
security definer
set search_path = public
as $$
  update venues set location = st_makepoint(lng, lat)::geography where id = venue_id;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'venues_name_unique'
  ) then
    alter table venues add constraint venues_name_unique unique (name);
  end if;
end $$;
