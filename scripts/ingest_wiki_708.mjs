#!/usr/bin/env node
/**
 * 위키백과 "친일파 708인 명단"(2002, 국회 민족정기모임+광복회)을 Supabase에 적재.
 * Tier 2 명단 — 정부 확정(1,006명)과 분리 집계된다 (list_key: assembly708).
 *
 * 명단이 분야별 하위 문서("친일파 708인 명단 - 조선귀족" 등)에 나뉘어 있어,
 * 본문서에서 하위 문서 링크를 자동 발견해 순회한다.
 *
 * 사용법:
 *   node scripts/ingest_wiki_708.mjs           # 미리보기
 *   node scripts/ingest_wiki_708.mjs --debug   # 문서별 진단
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/ingest_wiki_708.mjs --yes   # 실제 적재
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { splitRounds, extractNames, dedupe } from './ingest_wiki_1006.mjs';

const ROOT_PAGE = '친일파 708인 명단';
const WRITE = process.argv.includes('--yes');
const DEBUG = process.argv.includes('--debug');

const SKIP_SECTIONS =
  /같이 보기|각주|주해|외부 링크|참고|개요|경과|경위|배경|평가|논란|반응|이의|소송|취소|역사|발표/;

async function fetchWikitext(page) {
  const api = `https://ko.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
    page,
  )}&prop=wikitext&format=json&formatversion=2`;
  const res = await fetch(api, {
    headers: { 'User-Agent': 'maeguk-search-ingest/0.2 (personal research tool)' },
  });
  if (!res.ok) throw new Error(`위키 API 오류 (${page}): ${res.status}`);
  const json = await res.json();
  const wt = json?.parse?.wikitext;
  if (!wt) throw new Error(`wikitext를 찾을 수 없습니다: ${page}`);
  return wt;
}

function extractFromPage(wikitext, category) {
  const out = [];
  for (const s of splitRounds(wikitext)) {
    if (s.title === '(intro)' || SKIP_SECTIONS.test(s.title)) continue;
    for (const n of extractNames(s.body)) {
      out.push({ ...n, category: category ?? s.title });
    }
  }
  return out;
}

async function main() {
  console.log(`위키 문서 가져오는 중… (${ROOT_PAGE})`);
  const rootText = await fetchWikitext(ROOT_PAGE);

  // 하위 문서 자동 발견: [[친일파 708인 명단 - 분야명]]
  const subPages = new Set();
  const reSub = /\[\[(친일파 708인 명단 - [^\]|]+?)(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = reSub.exec(rootText)) !== null) subPages.add(m[1].trim());
  console.log(`하위 문서 ${subPages.size}개 발견:`, [...subPages].join(' / ') || '(없음)');

  const all = [];
  // 본문서 자체에도 명단이 있을 수 있음
  for (const n of extractFromPage(rootText, null)) all.push(n);

  for (const page of subPages) {
    const category = page.split(' - ')[1]?.trim() ?? null;
    console.log(`위키 문서 가져오는 중… (${page})`);
    const text = await fetchWikitext(page);
    const names = extractFromPage(text, category);
    console.log(`  → ${names.length}명 추출`);
    if (DEBUG) {
      for (const s of splitRounds(text)) {
        console.log(`    - "${s.title}": ${s.body.length}자, 추출 ${extractNames(s.body).length}명`);
      }
    }
    all.push(...names);
  }

  const people = dedupe(all);
  console.log(`\n추출된 인명: ${people.length}명 (기대치: 약 708명 + 별도 발표 16명)`);
  console.log(
    '샘플 20명:',
    people
      .slice(0, 20)
      .map((p) => (p.name_hanja ? `${p.name_ko}(${p.name_hanja})` : p.name_ko))
      .join(', '),
  );

  writeFileSync(
    'extracted_names_708.txt',
    people
      .map((p) => `${p.category ?? '?'}\t${p.name_ko}${p.name_hanja ? `(${p.name_hanja})` : ''}`)
      .join('\n') + '\n',
  );
  console.log('전체 추출 목록을 extracted_names_708.txt 에 저장했습니다.');

  if (Math.abs(people.length - 708) > 120) {
    console.warn('\n⚠ 추출 수가 기대치와 크게 다릅니다. --debug 로 문서 구조를 확인하세요.');
    if (WRITE) {
      console.error('안전을 위해 적재를 중단합니다.');
      process.exit(1);
    }
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
    category: p.category,
    list_key: 'assembly708',
    list_tags: ['assembly708'],
    evidence_url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(ROOT_PAGE)}`,
    data_source: 'wiki_ingest',
  }));

  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await db.from('historical_persons').upsert(chunk, {
      onConflict: 'name_ko,name_hanja,birth_year,list_key',
      ignoreDuplicates: true,
    });
    if (error) throw new Error(`적재 실패 (${i}~): ${error.message}`);
    console.log(`적재 ${Math.min(i + 200, rows.length)}/${rows.length}`);
  }

  const { count } = await db
    .from('historical_persons')
    .select('*', { count: 'exact', head: true })
    .eq('list_key', 'assembly708');
  console.log(`완료. assembly708 명단 총 ${count}건.`);
}

const isDirectRun = process.argv[1]?.endsWith('ingest_wiki_708.mjs');
if (isDirectRun) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
