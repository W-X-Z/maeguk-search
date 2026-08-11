import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { scoreCandidates, type PersonRow, type Mapping } from '@/lib/match';
import {
  RELATIONS,
  scoreBranchRows,
  type AncestorInput,
  type BranchMapping,
  type DescendantRow,
  type Relation,
} from '@/lib/lineage';

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

interface RawAncestor {
  relation?: string;
  name?: string;
  hanja?: string;
  birthEra?: number;
}

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

  const { consent, ancestors } = (body ?? {}) as { consent?: boolean; ancestors?: RawAncestor[] };

  if (consent !== true) {
    return NextResponse.json({ error: '이용 동의가 필요합니다.' }, { status: 400 });
  }
  if (!Array.isArray(ancestors) || ancestors.length === 0 || ancestors.length > 4) {
    return NextResponse.json({ error: '조상 정보를 1명 이상 입력해주세요.' }, { status: 400 });
  }

  const inputs: AncestorInput[] = [];
  for (const a of ancestors) {
    const relation = a.relation as Relation;
    if (!RELATIONS.includes(relation)) {
      return NextResponse.json({ error: '관계 값이 올바르지 않습니다.' }, { status: 400 });
    }
    const name = a.name?.trim() ?? '';
    if (!HANGUL_NAME.test(name)) {
      return NextResponse.json(
        { error: `${relation} 성명을 한글 2~5자로 입력해주세요.` },
        { status: 400 },
      );
    }
    const hanja = a.hanja?.trim() || undefined;
    if (hanja && !HANJA_NAME.test(hanja)) {
      return NextResponse.json(
        { error: `${relation} 한자 성명 형식이 올바르지 않습니다.` },
        { status: 400 },
      );
    }
    if (inputs.some((x) => x.relation === relation)) {
      return NextResponse.json({ error: '같은 관계를 중복 입력할 수 없습니다.' }, { status: 400 });
    }
    const birthEra =
      typeof a.birthEra === 'number' && a.birthEra >= 1840 && a.birthEra <= 1930
        ? a.birthEra
        : undefined;
    inputs.push({ relation, name, hanja, birthEra });
  }

  // 입력 성명은 저장·로깅하지 않는다 (설계 §10).
  const [metaRes, statsRes, ...perAncestor] = await Promise.all([
    supabase.from('dataset_meta').select('value').eq('key', 'coverage').single(),
    supabase.rpc('closure_stats'),
    ...inputs.flatMap((a) => [
      supabase.rpc('search_persons', { q_name: a.name, q_hanja: a.hanja ?? null }),
      supabase.rpc('search_descendants', { q_name: a.name, q_hanja: a.hanja ?? null }),
    ]),
  ]);

  const directMappings: (Mapping & { ancestor_relation: Relation })[] = [];
  const branchMappings: BranchMapping[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const a = inputs[i];
    const personsRes = perAncestor[i * 2];
    const descRes = perAncestor[i * 2 + 1];
    if (personsRes.error || descRes.error) {
      return NextResponse.json({ error: '검색 처리 중 오류가 발생했습니다.' }, { status: 500 });
    }
    const direct = scoreCandidates(
      { name: a.name, hanja: a.hanja, birthEra: a.birthEra },
      (personsRes.data ?? []) as PersonRow[],
    );
    for (const m of direct) directMappings.push({ ...m, ancestor_relation: a.relation });
    branchMappings.push(...scoreBranchRows(a, inputs, (descRes.data ?? []) as DescendantRow[]));
  }

  branchMappings.sort((a, b) => b.confidence - a.confidence);
  const byTag = (tag: string) => directMappings.filter((m) => m.list_tags.includes(tag));
  const stats = Array.isArray(statsRes.data) ? statsRes.data[0] : statsRes.data;

  return NextResponse.json({
    input_echo: {
      ancestors: inputs.map((a) => ({
        relation: a.relation,
        name: a.name,
        hanja: a.hanja ?? null,
        birth_era: a.birthEra ?? null,
      })),
    },
    // 근현대인물자료 미적재 단계라 동명이인 풀 산정 불가 — null로 정직하게 표기 (설계 §1-1)
    homonym_pool: null,
    branch_mappings: branchMappings, // 후손 branch 매핑 (경로·체인 정렬 포함)
    mappings: {
      chinil_direct: byTag('gov1006'), // Tier 1: 조상 본인이 명단에 있는 경우
      chinil_other_lists: byTag('assembly708'), // Tier 2
      independence_activist: byTag('independence'), // 교차 참조
    },
    coverage: metaRes.data?.value ?? null,
    closure_stats: stats ?? null,
    verdict: null, // 항상 null — 판정 필드를 두지 않는다
  });
}
