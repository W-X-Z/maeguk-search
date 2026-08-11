-- 적용됨: Supabase 프로젝트 vjcyzuionucesmizhffp (레퍼런스 사본)
-- 명단(Tier)별 행 공존 지원: 같은 인물이 여러 명단에 있으면 명단별 행으로 분리 집계
alter table public.historical_persons add column list_key text not null default 'gov1006';
update public.historical_persons set list_key = coalesce(list_tags[1], 'gov1006');

alter table public.historical_persons
  drop constraint historical_persons_name_ko_name_hanja_birth_year_key;
alter table public.historical_persons
  add constraint historical_persons_identity
  unique nulls not distinct (name_ko, name_hanja, birth_year, list_key);
