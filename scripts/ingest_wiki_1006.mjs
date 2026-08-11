#!/usr/bin/env node
/**
 * 위키백과 "대한민국 정부 발표 친일반민족행위자 명단" 문서에서
 * 1,006명 명단(한글명·한자명)을 추출해 Supabase에 적재한다.
 *
 * 사용법 (로컬 환경, 일반 인터넷 필요):
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/ingest_wiki_1006.mjs          # 추출 미리보기 (쓰기 없음)
 *     node scripts/ingest_wiki_1006.mjs --yes    # 실제 적재
 *
 * 주의:
 * - service role 키는 이 스크립트에서만 사용하고 절대 커밋/배포 환경에 넣지 않는다.
 * - 위키 문서 구조가 바뀌면 추출 수가 달라질 수 있으므로, 반드시 미리보기로
 *   추출 결과(총원 ~1,006명)를 확인한 뒤 --yes 로 적재한다.
 */

import { createClient } from '@supabase/supabase-js';

const PAGE = '대한민국 정부 발표 친일반민족행위자 명단';
const API = `https://ko.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
  PAGE,
)}&prop=wikitext&format=json&formatversion=2`;

const WRITE = process.argv.includes('--yes');

async function fetchWikitext() {
  const res = await fetch(API, {
    headers: { 'User-Agent': 'maeguk-search-ingest/0.1 (personal research tool)' },
  });
  if (!res.ok) throw new Error(`위키 API 오류: ${res.status}`);
  const json = await res.json();
  const wt = json?.parse?.wikitext;
  if (!wt) throw new Error('wikitext를 찾을 수 없습니다.');
  return wt;
}

/** 회차 섹션(== 1기 == 등)을 나눠 decision_round를 붙인다. */
function splitRounds(wikitext) {
  const parts = [];
  const re = /==+\s*([^=]+?)\s*==+/g;
  let lastIdx = 0;
  let lastTitle = null;
  let m;
  while ((m = re.exec(wikitext)) !== null) {
    if (lastTitle !== null) parts.push({ title: lastTitle, body: wikitext.slice(lastIdx, m.index) });
    lastTitle = m[1];
    lastIdx = re.lastIndex;
  }
  if (lastTitle !== null) parts.push({ title: lastTitle, body: wikitext.slice(lastIdx) });
  return parts.map((p) => {
    let round = null;
    if (/1기|2006/.test(p.title)) round = 1;
    else if (/2기|2007/.test(p.title)) round = 2;
    else if (/3기|2009/.test(p.title)) round = 3;
    return { ...p, round };
  });
}

/** "홍길동(洪吉童)" 및 "[[홍길동]](洪吉童)" 패턴에서 인명 추출 */
function extractNames(body) {
  const out = [];
  const re = /(?:\[\[)?([가-힣]{2,4})(?:\]\])?\s*[（(]([㐀-鿿]{2,5})[）)]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out.push({ name_ko: m[1], name_hanja: m[2] });
  }
  return out;
}

const STOPWORDS = new Set(['조선총독', '중추원', '친일파', '반민족', '위원회', '보고서']);

async function main() {
  console.log('위키 문서 가져오는 중…');
  const wikitext = await fetchWikitext();
  const sections = splitRounds(wikitext);

  const seen = new Map(); // key: ko|hanja
  for (const s of sections) {
    for (const n of extractNames(s.body)) {
      if (STOPWORDS.has(n.name_ko)) continue;
      const key = `${n.name_ko}|${n.name_hanja}`;
      if (!seen.has(key)) seen.set(key, { ...n, decision_round: s.round });
    }
  }
  const people = [...seen.values()];

  console.log(`추출된 인명: ${people.length}명 (기대치: 약 1,006명)`);
  console.log('샘플 20명:', people.slice(0, 20).map((p) => `${p.name_ko}(${p.name_hanja})`).join(', '));

  if (Math.abs(people.length - 1006) > 150) {
    console.warn(
      '⚠ 추출 수가 기대치와 크게 다릅니다. 문서 구조가 바뀌었을 수 있으니 추출 로직을 점검하세요.',
    );
  }
  if (!WRITE) {
    console.log('\n미리보기 모드입니다. 적재하려면 --yes 를 붙여 다시 실행하세요.');
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  const db = createClient(url, key, { auth: { persistSession: false } });

  const rows = people.map((p) => ({
    name_ko: p.name_ko,
    name_hanja: p.name_hanja,
    decision_round: p.decision_round,
    list_tags: ['gov1006'],
    evidence_url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(PAGE)}`,
    data_source: 'wiki_ingest',
  }));

  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await db
      .from('historical_persons')
      .upsert(chunk, { onConflict: 'name_ko,name_hanja,birth_year', ignoreDuplicates: true });
    if (error) throw new Error(`적재 실패 (${i}~): ${error.message}`);
    console.log(`적재 ${Math.min(i + 200, rows.length)}/${rows.length}`);
  }

  const { count } = await db
    .from('historical_persons')
    .select('*', { count: 'exact', head: true });
  await db.from('dataset_meta').upsert({
    key: 'coverage',
    value: {
      total_official: 1006,
      loaded: count ?? rows.length,
      stage: 'wiki_ingest',
      note: '위키백과 공개 명단 기준 적재. 생몰년·이명 보강 전 단계.',
    },
    updated_at: new Date().toISOString(),
  });
  console.log(`완료. historical_persons 총 ${count}건.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
