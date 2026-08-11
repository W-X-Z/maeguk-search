-- 적용됨: Supabase 프로젝트 vjcyzuionucesmizhffp (레퍼런스 사본)
-- 계보 그래프: 명단 인물의 후손 전개 (설계 §3-1, §6)
create table public.persons (
  id bigint generated always as identity primary key,
  name_ko text not null,
  name_hanja text,
  birth_year smallint,
  death_year smallint,
  wikidata_id text unique,
  data_source text not null default 'seed_sample',
  created_at timestamptz not null default now(),
  constraint persons_birth_cutoff check (birth_year is null or birth_year <= 1930)
);
create index persons_name_ko_trgm on public.persons using gin (name_ko gin_trgm_ops);

create table public.relationships (
  parent_id bigint not null references public.persons(id) on delete cascade,
  child_id bigint not null references public.persons(id) on delete cascade,
  confidence real not null default 1.0,
  data_source text not null default 'seed_sample',
  primary key (parent_id, child_id)
);

create table public.descendant_links (
  root_id bigint not null references public.historical_persons(id) on delete cascade,
  person_id bigint not null references public.persons(id) on delete cascade,
  depth smallint not null,
  path_names text[] not null,
  confidence real not null default 1.0,
  primary key (root_id, person_id)
);
create index descendant_links_person on public.descendant_links(person_id);

alter table public.persons enable row level security;
alter table public.relationships enable row level security;
alter table public.descendant_links enable row level security;
create policy "public read persons" on public.persons for select using (true);
create policy "public read relationships" on public.relationships for select using (true);
create policy "public read descendant_links" on public.descendant_links for select using (true);

create or replace function public.search_descendants(q_name text, q_hanja text default null)
returns table (
  person_name_ko text, person_name_hanja text,
  person_birth_year smallint, person_death_year smallint,
  depth smallint, path_names text[], link_confidence real,
  root_name_ko text, root_name_hanja text, root_category text,
  root_decision_round smallint, root_evidence_url text, root_list_tags text[]
)
language sql stable
as $$
  select p.name_ko, p.name_hanja, p.birth_year, p.death_year,
         dl.depth, dl.path_names, dl.confidence,
         hp.name_ko, hp.name_hanja, hp.category,
         hp.decision_round, hp.evidence_url, hp.list_tags
  from public.descendant_links dl
  join public.persons p on p.id = dl.person_id
  join public.historical_persons hp on hp.id = dl.root_id
  where p.name_ko = q_name
     or (q_hanja is not null and p.name_hanja = q_hanja)
  limit 50;
$$;

create or replace function public.closure_stats()
returns table (roots_covered bigint, persons_total bigint)
language sql stable
as $$
  select (select count(distinct root_id) from public.descendant_links),
         (select count(*) from public.persons);
$$;
