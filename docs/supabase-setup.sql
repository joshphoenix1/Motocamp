-- ===== MotorCamp Supabase Schema =====
-- Run this in your Supabase SQL editor after creating a project.
-- Then update SUPABASE_URL and SUPABASE_ANON_KEY in js/auth.js.

-- Saved routes
create table routes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  data jsonb not null,
  created_at timestamptz default now()
);

-- Favourite locations
create table favourites (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  lat double precision not null,
  lon double precision not null,
  name text not null,
  type text, -- campsite, viewpoint, etc.
  created_at timestamptz default now()
);

-- User preferences (vehicle type, units, default layers, etc.)
create table preferences (
  user_id uuid references auth.users(id) on delete cascade primary key,
  data jsonb not null default '{}',
  updated_at timestamptz default now()
);

-- Row-level security: users can only access their own data
alter table routes enable row level security;
alter table favourites enable row level security;
alter table preferences enable row level security;

create policy "Users see own routes" on routes
  for all using (auth.uid() = user_id);

create policy "Users see own favourites" on favourites
  for all using (auth.uid() = user_id);

create policy "Users see own preferences" on preferences
  for all using (auth.uid() = user_id);

-- Indexes
create index idx_routes_user on routes(user_id);
create index idx_favourites_user on favourites(user_id);

-- Optional: subscription tiers (for future billing)
-- create table subscriptions (
--   user_id uuid references auth.users(id) on delete cascade primary key,
--   tier text not null default 'free', -- free, pro, lifetime
--   stripe_customer_id text,
--   stripe_subscription_id text,
--   expires_at timestamptz,
--   created_at timestamptz default now()
-- );
-- alter table subscriptions enable row level security;
-- create policy "Users see own subscription" on subscriptions
--   for select using (auth.uid() = user_id);
