-- 적용됨: Supabase 프로젝트 vjcyzuionucesmizhffp (레퍼런스 사본)
create or replace function public.search_persons(q_name text, q_hanja text default null)
returns table (
  id bigint, name_ko text, name_hanja text, aliases jsonb,
  birth_year smallint, death_year smallint, decision_round smallint,
  category text, list_tags text[], summary text, evidence_url text,
  data_source text, name_sim real
)
language sql stable
as $$
  select hp.id, hp.name_ko, hp.name_hanja, hp.aliases, hp.birth_year, hp.death_year,
         hp.decision_round, hp.category, hp.list_tags, hp.summary, hp.evidence_url,
         hp.data_source,
         greatest(
           similarity(hp.name_ko, q_name),
           case when q_hanja is not null and hp.name_hanja = q_hanja then 1.0 else 0.0 end
         )::real as name_sim
  from public.historical_persons hp
  where hp.name_ko = q_name
     or (q_hanja is not null and hp.name_hanja = q_hanja)
     or similarity(hp.name_ko, q_name) > 0.45
     or exists (
       select 1 from jsonb_array_elements(hp.aliases) a
       where a->>'name_ko' = q_name
          or (q_hanja is not null and a->>'name_hanja' = q_hanja)
     )
  order by name_sim desc
  limit 50;
$$;
