-- Create a profiles row automatically when an auth user is created, carrying
-- the 18+ attestation captured at signup (passed in user metadata).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_id_fkey'
  ) then
    alter table profiles
      add constraint profiles_id_fkey
      foreign key (id) references auth.users(id) on delete cascade
      not valid;
  end if;
end $$;

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, is_18_plus)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'is_18_plus')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
