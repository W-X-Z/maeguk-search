-- 적용됨: Supabase 프로젝트 vjcyzuionucesmizhffp (레퍼런스 사본)
create extension if not exists pg_trgm;

create table public.historical_persons (
  id bigint generated always as identity primary key,
  name_ko text not null,
  name_hanja text,
  aliases jsonb not null default '[]'::jsonb,
  birth_year smallint,
  death_year smallint,
  decision_round smallint,
  category text,
  list_tags text[] not null default '{gov1006}',
  summary text,
  evidence_url text,
  data_source text not null default 'seed_sample',
  created_at timestamptz not null default now(),
  unique (name_ko, name_hanja, birth_year)
);

create index historical_persons_name_ko_trgm on public.historical_persons using gin (name_ko gin_trgm_ops);
create index historical_persons_name_hanja on public.historical_persons (name_hanja);

alter table public.historical_persons enable row level security;
create policy "public read" on public.historical_persons for select using (true);

create table public.dataset_meta (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.dataset_meta enable row level security;
create policy "public read meta" on public.dataset_meta for select using (true);
