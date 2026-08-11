#!/usr/bin/env node
/**
 * Wikidata에서 생몰년을 찾아 생몰년이 비어 있는 인물 행을 보강한다.
 * 보수적으로만 적용한다:
 *  - 한글 라벨이 정확히 일치하는 Wikidata 인물(Q5) 중 출생 1820~1935년인 항목만 후보
 *  - 후보가 여럿이면 zh 라벨(한자 표기)로 DB의 한자명과 대조해 특정
 *  - 특정되지 않으면 건드리지 않는다 (오적용 방지)
 *
 * 사용법:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/enrich_wikidata.mjs           # 미리보기
 *     node scripts/enrich_wikidata.mjs --yes     # 실제 반영
 */

import { createClient } from '@supabase/supabase-js';

const WRITE = process.argv.includes('--yes');
const SPARQL = 'https://query.wikidata.org/sparql';
const BATCH = 40;

async function sparql(names) {
  const values = names.map((n) => `"${n.replace(/"/g, '')}"@ko`).join(' ');
  const q = `
SELECT ?name ?item ?birth ?death ?zh WHERE {
  VALUES ?name { ${values} }
  ?item rdfs:label ?name .
  ?item wdt:P31 wd:Q5 .
  ?item wdt:P569 ?birth .
  OPTIONAL { ?item wdt:P570 ?death }
  OPTIONAL { ?item rdfs:label ?zh . FILTER(LANG(?zh) = "zh") }
}`;
  const res = await fetch(`${SPARQL}?format=json&query=${encodeURIComponent(q)}`, {
    headers: { 'User-Agent': 'maeguk-search-enrich/0.1 (personal research tool)' },
  });
  if (!res.ok) throw new Error(`SPARQL 오류: ${res.status}`);
  const json = await res.json();
  return json.results.bindings.map((b) => ({
    name: b.name.value,
    item: b.item.value,
    birth: Number(b.birth.value.slice(0, 4)) * (b.birth.value.startsWith('-') ? -1 : 1),
    death: b.death ? Number(b.death.value.slice(0, 4)) : null,
    zh: b.zh?.value ?? null,
  }));
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: targets, error } = await db
    .from('historical_persons')
    .select('id, name_ko, name_hanja, list_key')
    .is('birth_year', null)
    .order('id');
  if (error) throw new Error(error.message);
  console.log(`생몰년 미보유: ${targets.length}명`);

  const byName = new Map();
  for (const t of targets) {
    if (!byName.has(t.name_ko)) byName.set(t.name_ko, []);
    byName.get(t.name_ko).push(t);
  }
  const names = [...byName.keys()];

  let applied = 0;
  let ambiguous = 0;
  let notFound = 0;
  const updates = [];

  for (let i = 0; i < names.length; i += BATCH) {
    const chunk = names.slice(i, i + BATCH);
    const rows = await sparql(chunk);
    // 이름별로 근대 인물 후보 그룹화 (항목별 중복 바인딩 병합)
    const byLabel = new Map();
    for (const r of rows) {
      if (r.birth < 1820 || r.birth > 1935) continue;
      if (!byLabel.has(r.name)) byLabel.set(r.name, new Map());
      const items = byLabel.get(r.name);
      if (!items.has(r.item)) items.set(r.item, r);
      else if (r.zh && !items.get(r.item).zh) items.get(r.item).zh = r.zh;
    }

    for (const name of chunk) {
      const dbRows = byName.get(name);
      const candidates = [...(byLabel.get(name)?.values() ?? [])];
      if (candidates.length === 0) {
        notFound += dbRows.length;
        continue;
      }
      for (const dbRow of dbRows) {
        // 한자명으로 특정 시도
        let match = null;
        if (dbRow.name_hanja) {
          const hanjaHits = candidates.filter((c) => c.zh === dbRow.name_hanja);
          if (hanjaHits.length === 1) match = hanjaHits[0];
        }
        // 한자 특정 실패 시: 후보와 DB 행이 모두 하나일 때만
        if (!match && candidates.length === 1 && dbRows.length === 1) match = candidates[0];
        if (!match) {
          ambiguous++;
          continue;
        }
        updates.push({ id: dbRow.id, birth_year: match.birth, death_year: match.death });
        applied++;
      }
    }
    console.log(
      `조회 ${Math.min(i + BATCH, names.length)}/${names.length} — 적용 대상 ${applied}, 모호 ${ambiguous}, 미발견 ${notFound}`,
    );
    await new Promise((r) => setTimeout(r, 1100)); // Wikidata rate limit 예의
  }

  console.log(`\n결과: 적용 가능 ${applied}건 / 모호(건너뜀) ${ambiguous}건 / 미발견 ${notFound}건`);
  console.log('적용 샘플:', updates.slice(0, 10).map((u) => `#${u.id}:${u.birth_year}`).join(', '));

  if (!WRITE) {
    console.log('\n미리보기 모드입니다. 반영하려면 --yes 를 붙여 다시 실행하세요.');
    return;
  }
  for (const u of updates) {
    const { error: e } = await db
      .from('historical_persons')
      .update({ birth_year: u.birth_year, death_year: u.death_year })
      .eq('id', u.id)
      .is('birth_year', null);
    if (e) console.warn(`#${u.id} 반영 실패: ${e.message}`);
  }
  console.log(`완료. ${updates.length}건 반영.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
