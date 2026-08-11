import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { scoreCandidates, type PersonRow } from '@/lib/match';

export const runtime = 'nodejs';

// 베스트에포트 레이트리밋 (서버리스 인스턴스 단위). 설계 §10.
const hits = new Map<string, { count: number; reset: number }>();
const LIMIT = 20;
const WINDOW_MS = 60 * 60 * 1000;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.reset < now) {
    hits.set(ip, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > LIMIT;
}

const HANGUL_NAME = /^[가-힣]{2,5}$/;
const HANJA_NAME = /^[㐀-鿿]{1,6}$/;

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const { name, hanja, birthEra, consent } = (body ?? {}) as {
    name?: string;
    hanja?: string;
    birthEra?: number;
    consent?: boolean;
  };

  if (consent !== true) {
    return NextResponse.json({ error: '이용 동의가 필요합니다.' }, { status: 400 });
  }
  const trimmedName = name?.trim() ?? '';
  if (!HANGUL_NAME.test(trimmedName)) {
    return NextResponse.json({ error: '조상 성명을 한글 2~5자로 입력해주세요.' }, { status: 400 });
  }
  const trimmedHanja = hanja?.trim() || undefined;
  if (trimmedHanja && !HANJA_NAME.test(trimmedHanja)) {
    return NextResponse.json({ error: '한자 성명 형식이 올바르지 않습니다.' }, { status: 400 });
  }
  const era =
    typeof birthEra === 'number' && birthEra >= 1840 && birthEra <= 1930 ? birthEra : undefined;

  // 입력 성명은 저장·로깅하지 않는다 (설계 §10).
  const [rpcRes, metaRes] = await Promise.all([
    supabase.rpc('search_persons', { q_name: trimmedName, q_hanja: trimmedHanja ?? null }),
    supabase.from('dataset_meta').select('value').eq('key', 'coverage').single(),
  ]);

  if (rpcRes.error) {
    return NextResponse.json({ error: '검색 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }

  const mappings = scoreCandidates(
    { name: trimmedName, hanja: trimmedHanja, birthEra: era },
    (rpcRes.data ?? []) as PersonRow[],
  );

  const direct = mappings.filter((m) => m.list_tags.includes('gov1006'));
  const other = mappings.filter((m) => !m.list_tags.includes('gov1006'));

  return NextResponse.json({
    input_echo: { name: trimmedName, hanja: trimmedHanja ?? null, birth_era: era ?? null },
    // 근현대인물자료 미적재 단계라 동명이인 풀 산정 불가 — null로 정직하게 표기 (설계 §1-1)
    homonym_pool: null,
    mappings: {
      chinil_direct: direct,
      chinil_other_lists: other,
      chinil_descendant: [], // descendant_closure 미구축 단계
      independence_activist: [], // 교차 참조 미구축 단계
    },
    coverage: metaRes.data?.value ?? null,
    verdict: null, // 항상 null — 판정 필드를 두지 않는다
  });
}
