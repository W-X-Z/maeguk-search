#!/usr/bin/env node
/**
 * CSV로 친일반민족행위자 명단을 Supabase에 적재한다.
 * 뉴스타파 데이터포털의 "친일반민족행위자결정 1006명 명단" CSV 사용을 권장.
 * (https://data.newstapa.org 에서 다운로드)
 *
 * 사용법:
 *   node scripts/ingest_csv.mjs 명단.csv                 # 미리보기 (컬럼 매핑 확인)
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/ingest_csv.mjs 명단.csv --yes         # 실제 적재
 *
 * 컬럼 자동 감지가 틀리면 수동 매핑:
 *   node scripts/ingest_csv.mjs 명단.csv --map "name_ko=성명,name_hanja=한자성명,birth_year=출생년도"
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const WRITE = process.argv.includes('--yes');

/** 따옴표 처리를 포함한 최소 CSV 파서 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

// 필드별 자동 감지 후보 헤더 (부분 일치, 대소문자 무시)
const FIELD_CANDIDATES = {
  name_ko: ['한글명', '한글이름', '성명', '이름', 'name_ko', 'name'],
  name_hanja: ['한자명', '한자성명', '한자', '漢字', 'name_hanja', 'hanja'],
  birth_year: ['출생년', '출생연도', '생년', '출생', 'birth'],
  death_year: ['사망년', '사망연도', '몰년', '사망', 'death'],
  decision_round: ['기수', '회차', '결정회차', '차수', 'round'],
  category: ['분야', '부문', '유형', '직역', 'category'],
  summary: ['행적', '주요행적', '비고', '설명', 'summary'],
};

export function detectMapping(headers, manualMap) {
  const mapping = {};
  for (const [field, candidates] of Object.entries(FIELD_CANDIDATES)) {
    for (const cand of candidates) {
      const idx = headers.findIndex((h) => h.trim().toLowerCase().includes(cand.toLowerCase()));
      if (idx !== -1) {
        mapping[field] = idx;
        break;
      }
    }
  }
  if (manualMap) {
    for (const pair of manualMap.split(',')) {
      const [field, header] = pair.split('=').map((s) => s.trim());
      const idx = headers.findIndex((h) => h.trim() === header);
      if (idx === -1) throw new Error(`--map: 헤더 "${header}"를 찾을 수 없습니다.`);
      mapping[field] = idx;
    }
  }
  return mapping;
}

function toYear(v) {
  const m = String(v ?? '').match(/1[89]\d{2}/);
  return m ? Number(m[0]) : null;
}

function toRound(v) {
  const m = String(v ?? '').match(/[123]/);
  return m ? Number(m[0]) : null;
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('사용법: node scripts/ingest_csv.mjs <파일.csv> [--yes] [--map "..."]');
    process.exit(1);
  }
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV에 데이터가 없습니다.');

  const headers = rows[0];
  const manualMap = process.argv.find((a) => a.startsWith('--map'))
    ? process.argv[process.argv.findIndex((a) => a.startsWith('--map')) + (process.argv.includes('--map') ? 1 : 0)]?.replace(/^--map=?/, '') ||
      process.argv.find((a) => a.startsWith('--map='))?.slice(6)
    : undefined;
  const mapping = detectMapping(headers, manualMap);

  console.log('감지된 헤더:', headers.join(' | '));
  console.log(
    '컬럼 매핑:',
    Object.entries(mapping)
      .map(([f, i]) => `${f}←"${headers[i]}"`)
      .join(', ') || '(없음)',
  );
  if (mapping.name_ko === undefined) {
    throw new Error('이름 컬럼을 찾지 못했습니다. --map "name_ko=실제헤더명" 으로 지정하세요.');
  }

  const people = [];
  for (const r of rows.slice(1)) {
    const name_ko = r[mapping.name_ko]?.trim();
    if (!name_ko || !/^[가-힣]{2,5}$/.test(name_ko)) continue;
    people.push({
      name_ko,
      name_hanja: mapping.name_hanja !== undefined ? r[mapping.name_hanja]?.trim() || null : null,
      birth_year: mapping.birth_year !== undefined ? toYear(r[mapping.birth_year]) : null,
      death_year: mapping.death_year !== undefined ? toYear(r[mapping.death_year]) : null,
      decision_round:
        mapping.decision_round !== undefined ? toRound(r[mapping.decision_round]) : null,
      category: mapping.category !== undefined ? r[mapping.category]?.trim() || null : null,
      summary: mapping.summary !== undefined ? r[mapping.summary]?.trim() || null : null,
    });
  }

  console.log(`\n유효 레코드: ${people.length}명 (기대치: 약 1,006명)`);
  console.log('샘플 10명:');
  for (const p of people.slice(0, 10)) {
    console.log(
      `  ${p.name_ko}${p.name_hanja ? `(${p.name_hanja})` : ''} ${p.birth_year ?? '?'}–${
        p.death_year ?? '?'
      } ${p.category ?? ''} ${p.decision_round ? `${p.decision_round}기` : ''}`,
    );
  }

  if (!WRITE) {
    console.log('\n미리보기 모드입니다. 매핑이 맞으면 --yes 를 붙여 적재하세요.');
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  const db = createClient(url, key, { auth: { persistSession: false } });

  const dataRows = people.map((p) => ({
    ...p,
    list_tags: ['gov1006'],
    data_source: 'newstapa_csv',
  }));

  for (let i = 0; i < dataRows.length; i += 200) {
    const chunk = dataRows.slice(i, i + 200);
    const { error } = await db
      .from('historical_persons')
      .upsert(chunk, { onConflict: 'name_ko,name_hanja,birth_year', ignoreDuplicates: true });
    if (error) throw new Error(`적재 실패 (${i}~): ${error.message}`);
    console.log(`적재 ${Math.min(i + 200, dataRows.length)}/${dataRows.length}`);
  }

  // CSV(생몰년 포함)와 이름+한자가 같은 시드/위키 행은 중복이므로 제거 (CSV 우선)
  const { data: existing } = await db
    .from('historical_persons')
    .select('name_ko, name_hanja')
    .in('data_source', ['seed_sample', 'wiki_ingest']);
  const csvKeys = new Set(dataRows.map((p) => `${p.name_ko}|${p.name_hanja ?? ''}`));
  for (const e of existing ?? []) {
    if (!e.name_hanja || !csvKeys.has(`${e.name_ko}|${e.name_hanja}`)) continue;
    await db
      .from('historical_persons')
      .delete()
      .in('data_source', ['seed_sample', 'wiki_ingest'])
      .eq('name_ko', e.name_ko)
      .eq('name_hanja', e.name_hanja);
  }

  const { count } = await db.from('historical_persons').select('*', { count: 'exact', head: true });
  await db.from('dataset_meta').upsert({
    key: 'coverage',
    value: {
      total_official: 1006,
      loaded: count ?? dataRows.length,
      stage: 'csv_ingest',
      note: 'CSV 명단 적재 완료.',
    },
    updated_at: new Date().toISOString(),
  });
  console.log(`완료. historical_persons 총 ${count}건.`);
}

const isDirectRun = process.argv[1]?.endsWith('ingest_csv.mjs');
if (isDirectRun) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
