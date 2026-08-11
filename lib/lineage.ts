/**
 * 가족 체인(부→조부→증조부→고조부) 기반 후손 branch 매칭.
 *
 * 핵심 신호는 "체인 정렬": 입력한 조상 A가 후손 계보의 어떤 노드와 이름이
 * 일치할 때, A의 한 세대 위 입력(부모)이 그 노드의 경로상 부모 이름과도
 * 일치하면 조합 확률이 급감하므로 강한 가점을 준다 (설계 §5 구조 신호).
 */

export const RELATIONS = ['부친', '조부', '증조부', '고조부'] as const;
export type Relation = (typeof RELATIONS)[number];

/** 세대 거리: 본인 기준 1=부친 … 4=고조부 */
export const GENERATION: Record<Relation, number> = {
  부친: 1,
  조부: 2,
  증조부: 3,
  고조부: 4,
};

export interface AncestorInput {
  relation: Relation;
  name: string;
  hanja?: string;
  birthEra?: number;
}

export interface DescendantRow {
  person_name_ko: string;
  person_name_hanja: string | null;
  person_birth_year: number | null;
  person_death_year: number | null;
  depth: number;
  path_names: string[];
  link_confidence: number;
  root_name_ko: string;
  root_name_hanja: string | null;
  root_category: string | null;
  root_decision_round: number | null;
  root_evidence_url: string | null;
  root_list_tags: string[];
}

export interface BranchMapping {
  ancestor_relation: Relation;
  person: {
    name_ko: string;
    name_hanja: string | null;
    birth_year: number | null;
    death_year: number | null;
  };
  root: {
    name_ko: string;
    name_hanja: string | null;
    category: string | null;
    decision_round: number | null;
    evidence_url: string | null;
    list_tags: string[];
  };
  depth: number;
  path_names: string[];
  match_fields: string[];
  conflicts: string[];
  chain: boolean;
  confidence: number;
  grade: 'strong' | 'weak';
}

/** 한 조상 입력에 대한 후손 노드 매칭 스코어링 */
export function scoreBranchRows(
  ancestor: AncestorInput,
  allInputs: AncestorInput[],
  rows: DescendantRow[],
): BranchMapping[] {
  const out: BranchMapping[] = [];
  const gen = GENERATION[ancestor.relation];

  for (const row of rows) {
    const matchFields: string[] = [];
    const conflicts: string[] = [];
    let confidence = 0;
    let chain = false;

    const koExact = row.person_name_ko === ancestor.name;
    const hanjaExact = !!ancestor.hanja && row.person_name_hanja === ancestor.hanja;

    if (koExact) {
      matchFields.push('한글 성명 일치');
      confidence += 0.25;
    }
    if (hanjaExact) {
      matchFields.push('한자 성명 일치');
      confidence += 0.45;
    } else if (ancestor.hanja && row.person_name_hanja && row.person_name_hanja !== ancestor.hanja) {
      conflicts.push('한자 성명 불일치');
      confidence *= 0.25;
    }

    // 체인 정렬: 경로상 부모 이름이 한 세대 위 입력과 일치하는가
    const parentName = row.path_names.length >= 2 ? row.path_names[row.path_names.length - 2] : null;
    const parentInput = allInputs.find((a) => GENERATION[a.relation] === gen + 1);
    if (parentName && parentInput && parentInput.name === parentName) {
      matchFields.push(`부자 체인 일치 (${parentInput.relation}→${ancestor.relation})`);
      confidence += 0.25;
      chain = true;
      // 두 세대 체인까지 성립하면 추가 가점
      const grandName =
        row.path_names.length >= 3 ? row.path_names[row.path_names.length - 3] : null;
      const grandInput = allInputs.find((a) => GENERATION[a.relation] === gen + 2);
      if (grandName && grandInput && grandInput.name === grandName) {
        matchFields.push('2세대 체인 일치');
        confidence += 0.1;
      }
    }

    if (ancestor.birthEra && row.person_birth_year) {
      const gap = Math.abs(row.person_birth_year - (ancestor.birthEra + 5));
      if (gap <= 10) {
        matchFields.push('출생연대 부합');
        confidence += 0.15;
      } else if (gap > 25) {
        conflicts.push('출생연대 불일치');
        confidence *= 0.3;
      }
    }

    confidence *= row.link_confidence; // 계보 간선 자체의 신뢰도 전파 (설계 §5)
    if (matchFields.length === 0 || confidence < 0.05) continue;

    out.push({
      ancestor_relation: ancestor.relation,
      person: {
        name_ko: row.person_name_ko,
        name_hanja: row.person_name_hanja,
        birth_year: row.person_birth_year,
        death_year: row.person_death_year,
      },
      root: {
        name_ko: row.root_name_ko,
        name_hanja: row.root_name_hanja,
        category: row.root_category,
        decision_round: row.root_decision_round,
        evidence_url: row.root_evidence_url,
        list_tags: row.root_list_tags,
      },
      depth: row.depth,
      path_names: row.path_names,
      match_fields: matchFields,
      conflicts,
      chain,
      confidence: Math.min(Math.round(confidence * 100) / 100, 0.95),
      grade: (hanjaExact || chain) && conflicts.length === 0 ? 'strong' : 'weak',
    });
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}
