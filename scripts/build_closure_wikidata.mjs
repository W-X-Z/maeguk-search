#!/usr/bin/env node
/**
 * 명단 인물(gov1006)의 후손 계보(descendant_closure)를 Wikidata에서 구축한다.
 * 설계 §3-1: 후손 전개는 2~3세대, 출생 1930년 이전(사실상 전원 고인)까지만.
 *
 * 절차:
 *  1) historical_persons(gov1006)를 Wikidata 항목에 매핑 (ko 라벨 + zh 라벨(한자) + 생년 대조)
 *  2) 매핑된 항목에서 자식(P40)을 최대 3세대 전개
 *  3) persons / relationships / descendant_links 적재 (경로·confidence 포함)
 *
 * 컷오프 규칙:
 *  - depth 1: 출생 미상 허용 (루트가 1850~1900년생이므로 자식은 사실상 고인)
 *  - depth 2+: 출생연도가 확인되고 1930년 이전인 경우만
 *
 * 사용법:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/build_closure_wikidata.mjs           # 미리보기
 *     node scripts/build_closure_wikidata.mjs --yes     # 실제 적재
 */

import { createClient } from '@supabase/supabase-js';

const WRITE = process.argv.includes('--yes');
const SPARQL = 'https://query.wikidata.org/sparql';
const BATCH = 30;
const MAX_DEPTH = 3;

async function sparql(query) {
  const res = await fetch(`${SPARQL}?format=json&query=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'maeguk-search-closure/0.1 (personal research tool)' },
  });
  if (!res.ok) throw new Error(`SPARQL 오류: ${res.status}`);
  const json = await res.json();
  return json.results.bindings;
}

const yearOf = (v) => (v ? Number(v.slice(0, 4)) : null);
const qidOf = (uri) => uri.split('/').pop();

/** 1단계: 명단 인물 → Wikidata QID 매핑 (보수적) */
async function resolveRoots(rootRows) {
  const resolved = new Map(); // hp.id → {qid, name_ko}
  for (let i = 0; i < rootRows.length; i += BATCH) {
    const chunk = rootRows.slice(i, i + BATCH);
    const values = chunk.map((r) => `"${r.name_ko.replace(/"/g, '')}"@ko`).join(' ');
    const rows = await sparql(`
SELECT ?name ?item ?birth ?zh WHERE {
  VALUES ?name { ${values} }
  ?item rdfs:label ?name .
  ?item wdt:P31 wd:Q5 .
  OPTIONAL { ?item wdt:P569 ?birth }
  OPTIONAL { ?item rdfs:label ?zh . FILTER(LANG(?zh) = "zh") }
}`);
    const byName = new Map();
    for (const b of rows) {
      const name = b.name.value;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({
        qid: qidOf(b.item.value),
        birth: yearOf(b.birth?.value),
        zh: b.zh?.value ?? null,
      });
    }
    for (const r of chunk) {
      const cands = (byName.get(r.name_ko) ?? []).filter(
        (c) => c.birth === null || (c.birth >= 1830 && c.birth <= 1910),
      );
      if (cands.length === 0) continue;
      // 한자 일치 우선, 다음 생년 일치, 그래도 여럿이면 건너뜀 (오매핑 방지)
      let pick = null;
      const hanjaHits = r.name_hanja ? cands.filter((c) => c.zh === r.name_hanja) : [];
      if (hanjaHits.length === 1) pick = hanjaHits[0];
      else if (r.birth_year) {
        const birthHits = cands.filter((c) => c.birth === r.birth_year);
        if (birthHits.length === 1) pick = birthHits[0];
      }
      if (!pick && cands.length === 1) pick = cands[0];
      if (pick) resolved.set(r.id, { qid: pick.qid, name_ko: r.name_ko });
    }
    console.log(`루트 매핑 ${Math.min(i + BATCH, rootRows.length)}/${rootRows.length} — 확정 ${resolved.size}`);
    await new Promise((s) => setTimeout(s, 1100));
  }
  return resolved;
}

/** 2단계: QID 집합의 자식 전개 (한 세대) */
async function fetchChildren(qids) {
  const out = new Map(); // parentQid → [{qid, name, hanja, birth, death}]
  for (let i = 0; i < qids.length; i += BATCH) {
    const chunk = qids.slice(i, i + BATCH);
    const values = chunk.map((q) => `wd:${q}`).join(' ');
    const rows = await sparql(`
SELECT ?parent ?child ?childLabel ?zh ?birth ?death WHERE {
  VALUES ?parent { ${values} }
  ?parent wdt:P40 ?child .
  ?child wdt:P31 wd:Q5 .
  OPTIONAL { ?child wdt:P569 ?birth }
  OPTIONAL { ?child wdt:P570 ?death }
  OPTIONAL { ?child rdfs:label ?zh . FILTER(LANG(?zh) = "zh") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ko" . }
}`);
    for (const b of rows) {
      const pq = qidOf(b.parent.value);
      const name = b.childLabel?.value ?? '';
      if (!/^[가-힣]{2,5}$/.test(name)) continue; // 한글 라벨 없는 항목 제외
      if (!out.has(pq)) out.set(pq, new Map());
      const cq = qidOf(b.child.value);
      if (!out.get(pq).has(cq)) {
        out.get(pq).set(cq, {
          qid: cq,
          name_ko: name,
          name_hanja: b.zh?.value && /^[㐀-鿿]{2,6}$/.test(b.zh.value) ? b.zh.value : null,
          birth: yearOf(b.birth?.value),
          death: yearOf(b.death?.value),
        });
      }
    }
    await new Promise((s) => setTimeout(s, 1100));
  }
  return new Map([...out.entries()].map(([k, v]) => [k, [...v.values()]]));
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: roots, error } = await db
    .from('historical_persons')
    .select('id, name_ko, name_hanja, birth_year')
    .eq('list_key', 'gov1006')
    .order('id');
  if (error) throw new Error(error.message);
  console.log(`명단 인물: ${roots.length}명 — Wikidata 매핑 시작`);

  const resolved = await resolveRoots(roots);
  console.log(`\nWikidata 항목 확정: ${resolved.size}/${roots.length}명`);

  // 세대별 전개
  const closure = []; // {root_hp_id, person:{...}, depth, path_names, confidence}
  let frontier = [...resolved.entries()].map(([hpId, r]) => ({
    hpId,
    qid: r.qid,
    path: [r.name_ko],
    confidence: 1.0,
  }));

  for (let depth = 1; depth <= MAX_DEPTH && frontier.length > 0; depth++) {
    const childrenMap = await fetchChildren([...new Set(frontier.map((f) => f.qid))]);
    const next = [];
    for (const f of frontier) {
      for (const c of childrenMap.get(f.qid) ?? []) {
        // 컷오프: depth 1은 출생 미상 허용, depth 2+는 1930년 이전 확인 필수
        if (depth >= 2 && (c.birth === null || c.birth > 1930)) continue;
        if (c.birth !== null && c.birth > 1930) continue;
        const conf = f.confidence * 0.9; // Wikidata 간선 신뢰도
        closure.push({
          root_hp_id: f.hpId,
          person: c,
          depth,
          path_names: [...f.path, c.name_ko],
          confidence: conf,
        });
        next.push({ hpId: f.hpId, qid: c.qid, path: [...f.path, c.name_ko], confidence: conf });
      }
    }
    console.log(`${depth}세대 전개: +${closure.length}건 누적, 다음 프런티어 ${next.length}`);
    frontier = next;
  }

  const rootsCovered = new Set(closure.map((c) => c.root_hp_id)).size;
  console.log(`\n결과: 후손 링크 ${closure.length}건, 루트 커버 ${rootsCovered}명`);
  console.log(
    '샘플:',
    closure.slice(0, 8).map((c) => c.path_names.join('→')).join(' | '),
  );

  if (!WRITE) {
    console.log('\n미리보기 모드입니다. 적재하려면 --yes 를 붙여 다시 실행하세요.');
    return;
  }

  // persons upsert (wikidata_id 기준) → id 회수 → descendant_links upsert
  const uniquePersons = new Map();
  for (const c of closure) uniquePersons.set(c.person.qid, c.person);
  const personRows = [...uniquePersons.values()].map((p) => ({
    name_ko: p.name_ko,
    name_hanja: p.name_hanja,
    birth_year: p.birth !== null && p.birth <= 1930 ? p.birth : null,
    death_year: p.death,
    wikidata_id: p.qid,
    data_source: 'wikidata',
  }));
  for (let i = 0; i < personRows.length; i += 200) {
    const { error: e } = await db
      .from('persons')
      .upsert(personRows.slice(i, i + 200), { onConflict: 'wikidata_id' });
    if (e) throw new Error(`persons 적재 실패: ${e.message}`);
  }
  const { data: idRows, error: e2 } = await db
    .from('persons')
    .select('id, wikidata_id')
    .not('wikidata_id', 'is', null);
  if (e2) throw new Error(e2.message);
  const idByQid = new Map(idRows.map((r) => [r.wikidata_id, r.id]));

  const linkRows = closure
    .filter((c) => idByQid.has(c.person.qid))
    .map((c) => ({
      root_id: c.root_hp_id,
      person_id: idByQid.get(c.person.qid),
      depth: c.depth,
      path_names: c.path_names,
      confidence: Math.round(c.confidence * 100) / 100,
    }));
  for (let i = 0; i < linkRows.length; i += 200) {
    const { error: e } = await db
      .from('descendant_links')
      .upsert(linkRows.slice(i, i + 200), { onConflict: 'root_id,person_id' });
    if (e) throw new Error(`descendant_links 적재 실패: ${e.message}`);
  }
  console.log(`완료. persons ${personRows.length}건, descendant_links ${linkRows.length}건 적재.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
