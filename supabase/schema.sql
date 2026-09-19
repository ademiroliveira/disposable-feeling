-- Disposable Feeling — Supabase schema.
--
-- Two tables and three buckets. The shape follows the expiry rule rather than
-- the other way round: audio_path and poster_path are nullable because they
-- are *expected* to become null after seven days, while the mood vector, the
-- title and the thumbnail are never deleted. That is what keeps storage flat
-- and the archive complete at the same time.
--
--   psql "$SUPABASE_DB_URL" -f supabase/schema.sql

create table if not exists public.emissions (
  date             date primary key,
  title            text        not null,
  -- The whole mood vector, including provenance. Denormalized on purpose:
  -- the contract changes shape between phases and the archive should keep
  -- whatever shape a day was actually made with.
  mood             jsonb       not null,
  -- What the generators chose. Survives expiry so a deleted day can still be
  -- explained, and it is what the Phase 0 variance gate reads.
  render           jsonb,
  audio_path       text,
  poster_path      text,
  thumbnail_path   text,
  duration_seconds numeric     not null default 0,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null
);

comment on column public.emissions.audio_path is
  'Null once the seven-day window has passed and the audio was deleted.';

create index if not exists emissions_expires_at_idx
  on public.emissions (expires_at)
  where audio_path is not null;

create index if not exists emissions_date_desc_idx
  on public.emissions (date desc);

-- The rolling baseline lives here, not in a CI cache.
--
-- Every mood vector is scored as a deviation from the previous thirty days, so
-- losing this table does not raise an error — it silently scores every
-- dimension at zero and publishes a month of characterless days. A GitHub
-- Actions cache is evicted after seven days unused, which makes it exactly the
-- wrong place to keep something whose absence is invisible.
create table if not exists public.signals (
  date       date primary key,
  -- One row per day: every reading, in each metric's own units. Normalization
  -- against the baseline happens in synthesis, so raw values are what has to
  -- survive.
  readings   jsonb       not null,
  -- Sources that were asked and did not answer, with the reason. Kept because
  -- "no weather" and "average weather" are different facts.
  missing    jsonb       not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

create table if not exists public.eps (
  id                text primary key,
  from_date         date        not null,
  to_date           date        not null,
  audio_path        text,
  duration_seconds  numeric     not null default 0,
  -- Sequenced for contrast, not by date, so the order has to be stored.
  tracks            jsonb       not null,
  assembled_at      timestamptz not null default now()
);

-- Read is public; everything is written by the pipeline with the service role,
-- which bypasses RLS.
alter table public.emissions enable row level security;
alter table public.eps       enable row level security;
alter table public.signals   enable row level security;

drop policy if exists "emissions are public" on public.emissions;
create policy "emissions are public"
  on public.emissions for select
  using (true);

drop policy if exists "eps are public" on public.eps;
create policy "eps are public"
  on public.eps for select
  using (true);

-- Readable so the archive can show what a day was made from; written only by
-- the pipeline's service role.
drop policy if exists "signals are public" on public.signals;
create policy "signals are public"
  on public.signals for select
  using (true);

-- Storage. Public buckets: the site links straight at them, and nothing here
-- is private. Objects in emission-audio and emission-posters are removed by
-- `npm run expire`; emission-thumbnails is never swept.
insert into storage.buckets (id, name, public)
values
  ('emission-audio',      'emission-audio',      true),
  ('emission-posters',    'emission-posters',    true),
  ('emission-thumbnails', 'emission-thumbnails', true),
  ('ep-audio',            'ep-audio',            true)
on conflict (id) do nothing;

drop policy if exists "emission media is public" on storage.objects;
create policy "emission media is public"
  on storage.objects for select
  using (
    bucket_id in (
      'emission-audio', 'emission-posters', 'emission-thumbnails', 'ep-audio'
    )
  );
