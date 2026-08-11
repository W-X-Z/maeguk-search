#!/usr/bin/env node
/**
 * 위키백과 "대한민국 정부 발표 친일반민족행위자 명단" 문서에서
 * 1,006명 명단을 추출해 Supabase에 적재한다.
 *
 * 사용법 (로컬 환경, 일반 인터넷 필요):
 *   node scripts/ingest_wiki_1006.mjs              # 미리보기 (쓰기 없음)
 *   node scripts/ingest_wiki_1006.mjs --debug      # 문서 구조 진단 출력
 *   node scripts/ingest_wiki_1006.mjs --dump       # wikitext를 파일로 저장
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/ingest_wiki_1006.mjs --yes      # 실제 적재
 *
 * 추출이 계속 실패하면 --dump 로 wikitext를 저장해 구조를 확인하거나,
 * 뉴스타파 CSV + scripts/ingest_csv.mjs 경로를 사용한다 (README 참고).
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const PAGE = process.argv.find((a) => a.startsWith('--page='))?.slice(7)
  ?? '대한민국 정부 발표 친일반민족행위자 명단';
const WRITE = process.argv.includes('--yes');
const DEBUG = process.argv.includes('--debug');
const DUMP = process.argv.includes('--dump');

async function fetchWikitext(page) {
  const api = `https://ko.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
    page,
  )}&prop=wikitext&format=json&formatversion=2`;
  const res = await fetch(api, {
    headers: { 'User-Agent': 'maeguk-search-ingest/0.2 (personal research tool)' },
  });
  if (!res.ok) throw new Error(`위키 API 오류: ${res.status}`);
  const json = await res.json();
  const wt = json?.parse?.wikitext;
  if (!wt) throw new Error(`wikitext를 찾을 수 없습니다: ${page}`);
  return wt;
}

/** 섹션 헤딩 기준으로 나누고 회차(1~3기)를 추정 */
export function splitRounds(wikitext) {
  const parts = [];
  const re = /^==+\s*(.+?)\s*==+\s*$/gm;
  let lastIdx = 0;
  let lastTitle = '(intro)';
  let m;
  while ((m = re.exec(wikitext)) !== null) {
    parts.push({ title: lastTitle, body: wikitext.slice(lastIdx, m.index) });
    lastTitle = m[1];
    lastIdx = re.lastIndex;
  }
  parts.push({ title: lastTitle, body: wikitext.slice(lastIdx) });

  let currentRound = null;
  return parts.map((p) => {
    if (/1[기차]|2006/.test(p.title)) currentRound = 1;
    else if (/2[기차]|2007/.test(p.title)) currentRound = 2;
    else if (/3[기차]|2009/.test(p.title)) currentRound = 3;
    return { ...p, round: currentRound };
  });
}

// 명단이 아닌 섹션 (서두·부록류) — 산문 속 인물 링크 오탐 방지
const SKIP_SECTIONS =
  /같이 보기|각주|주해|외부 링크|참고|개요|경과|경위|배경|평가|논란|반응|이의|소송|취소|역사/;

// 분야명 등 명단에 섞이는 비인명 토큰
const STOPWORDS = new Set([
  '명단', '분야', '부문', '개요', '경과', '발표', '결정', '위원회', '보고서',
  '각주', '외부', '링크', '같이', '보기', '참고', '문헌', '역사', '평가',
  '매국', '수작', '습작', '중추원', '관료', '경찰', '군인', '사법', '헌병',
  '밀정', '종교', '언론', '교육', '문화', '예술', '경제', '사회', '단체',
  '학술', '친일', '유족', '이의', '신청', '소송', '취소',
]);

/**
 * 인명 추출. 처리하는 형식:
 *  - 홍길동(洪吉童) / 홍길동 (洪吉童)
 *  - [[홍길동]] / [[홍길동 (정치인)|홍길동]] / [[홍길동]](洪吉童)
 *  - 목록/표 안에서 · , 、 | 로 구분된 한글 2~4자 토큰
 */
export function extractNames(body) {
  const out = [];

  // 패스 1: 한자 병기 (링크 여부 무관)
  const reHanja =
    /(?:\[\[(?:[^\]|]*\|)?([가-힣]{2,4})\]\]|(?<![가-힣])([가-힣]{2,4}))\s*[（(]\s*([㐀-鿿]{2,6})\s*[）)]/g;
  let m;
  let stripped = body;
  while ((m = reHanja.exec(body)) !== null) {
    const ko = m[1] ?? m[2];
    if (!STOPWORDS.has(ko)) out.push({ name_ko: ko, name_hanja: m[3] });
  }
  stripped = body.replace(reHanja, ' ');

  // 패스 2: 링크 표기 [[문서명|표시명]] — 표시명이 한글 2~4자면 인명 후보
  const reLink = /\[\[([^\]|#]+?)(?:\|([^\]]+?))?\]\]/g;
  while ((m = reLink.exec(stripped)) !== null) {
    const display = (m[2] ?? m[1]).replace(/\s*\([^)]*\)\s*/g, '').trim();
    if (/^[가-힣]{2,4}$/.test(display) && !STOPWORDS.has(display)) {
      out.push({ name_ko: display, name_hanja: null });
    }
  }
  stripped = stripped.replace(reLink, ' ');

  // 패스 3: 링크 없는 일반 텍스트 목록 — 목록성 라인에서 구분자로 나눈 토큰
  for (const rawLine of stripped.split('\n')) {
    const line = rawLine.trim();
    // 목록/표 라인이거나 구분자가 여러 개인 라인만 (산문 오탐 방지)
    const isListLike =
      /^[*#|:;]/.test(line) || (line.match(/[·,、]/g)?.length ?? 0) >= 2;
    if (!isListLike) continue;
    const cleaned = line.replace(/^[*#|:;!\s]+/, '').replace(/'''?|\{\{[^}]*\}\}|<[^>]+>/g, ' ');
    for (const token of cleaned.split(/[·,、|]/)) {
      const t = token.trim();
      // 3~4자는 그대로, 2자는 한자 병기 없이는 오탐이 많아 제외
      if (/^[가-힣]{3,4}$/.test(t) && !STOPWORDS.has(t)) {
        out.push({ name_ko: t, name_hanja: null });
      }
    }
  }

  return out;
}

export function dedupe(entries) {
  // 같은 한글명은 한자 있는 항목을 우선해 병합
  const byKey = new Map();
  for (const e of entries) {
    const key = e.name_hanja ? `${e.name_ko}|${e.name_hanja}` : e.name_ko;
    const existing = byKey.get(key);
    if (!existing || (!existing.name_hanja && e.name_hanja)) byKey.set(key, e);
  }
  // 한자 없는 항목이 같은 한글명의 한자 있는 항목과 중복이면 제거
  const withHanjaNames = new Set(
    [...byKey.values()].filter((e) => e.name_hanja).map((e) => e.name_ko),
  );
  return [...byKey.values()].filter((e) => e.name_hanja || !withHanjaNames.has(e.name_ko));
}

async function main() {
  console.log(`위키 문서 가져오는 중… (${PAGE})`);
  const wikitext = await fetchWikitext(PAGE);

  if (DUMP) {
    writeFileSync('wikitext_dump.txt', wikitext);
    console.log(`wikitext ${wikitext.length}자를 wikitext_dump.txt 에 저장했습니다.`);
  }

  const sections = splitRounds(wikitext);

  if (DEBUG) {
    console.log(`\n[진단] wikitext 길이: ${wikitext.length}자, 섹션 ${sections.length}개`);
    for (const s of sections) {
      const names = extractNames(s.body);
      console.log(
        `  - "${s.title}" (round=${s.round ?? '?'}): ${s.body.length}자, 추출 ${names.length}명`,
      );
    }
    const biggest = sections.reduce((a, b) => (b.body.length > a.body.length ? b : a));
    console.log(`\n[진단] 최대 섹션 "${biggest.title}" 앞부분 800자:\n`);
    console.log(biggest.body.slice(0, 800));
    console.log('\n');
  }

  const all = [];
  for (const s of sections) {
    // 회차가 특정되기 전(서두)이거나 비명단 섹션이면 건너뜀 — 산문 속 인물 링크 오탐 방지
    if (!s.round || SKIP_SECTIONS.test(s.title)) continue;
    for (const n of extractNames(s.body)) {
      all.push({ ...n, decision_round: s.round });
    }
  }
  const people = dedupe(all);

  console.log(`추출된 인명: ${people.length}명 (기대치: 약 1,006명)`);
  console.log(
    '샘플 20명:',
    people
      .slice(0, 20)
      .map((p) => (p.name_hanja ? `${p.name_ko}(${p.name_hanja})` : p.name_ko))
      .join(', '),
  );

  if (Math.abs(people.length - 1006) > 150) {
    console.warn(
      '\n⚠ 추출 수가 기대치와 크게 다릅니다.\n' +
        '  1) --debug 로 섹션별 추출 수와 문서 구조를 확인하세요.\n' +
        '  2) 명단이 별도 하위 문서에 있다면 --page="문서명" 으로 지정하세요.\n' +
        '  3) 가장 확실한 방법: 뉴스타파 CSV를 받아 scripts/ingest_csv.mjs 로 적재 (README 참고).',
    );
    if (WRITE) {
      console.error('안전을 위해 적재를 중단합니다. 추출 수를 확인한 뒤 다시 실행하세요.');
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

const isDirectRun = process.argv[1]?.endsWith('ingest_wiki_1006.mjs');
if (isDirectRun) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
