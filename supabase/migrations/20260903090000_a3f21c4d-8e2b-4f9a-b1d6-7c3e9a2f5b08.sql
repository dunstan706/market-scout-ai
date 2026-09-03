-- Profiles for authenticated users, and briefs generated for them.
-- Dashboard reads/writes flow through RLS with the user's JWT
-- (the user-scoped client from requireSupabaseAuth), so no service-role
-- key is needed for these tables.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_name text,
  business_type text not null default 'salon' check (business_type in ('salon', 'spa', 'other')),
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null,
  business_type text not null default 'salon' check (business_type in ('salon', 'spa', 'other')),
  location text not null,
  brief jsonb not null,
  created_at timestamptz not null default now()
);

create index briefs_user_created_idx on public.briefs (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.briefs enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles
  for update using ((select auth.uid()) = id);

create policy "briefs_select_own" on public.briefs
  for select using ((select auth.uid()) = user_id);
create policy "briefs_insert_own" on public.briefs
  for insert with check ((select auth.uid()) = user_id);

grant all on public.profiles to service_role;
grant all on public.profiles to authenticated;
grant all on public.briefs to service_role;
grant all on public.briefs to authenticated;
