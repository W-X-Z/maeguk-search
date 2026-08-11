export interface PersonRow {
  id: number;
  name_ko: string;
  name_hanja: string | null;
  aliases: { type?: string; name_ko?: string; name_hanja?: string }[];
  birth_year: number | null;
  death_year: number | null;
  decision_round: number | null;
  category: string | null;
  list_tags: string[];
  summary: string | null;
  evidence_url: string | null;
  data_source: string;
  name_sim: number;
}

export interface SearchInput {
  name: string;
  hanja?: string;
  /** 추정 출생연대의 시작 연도 (예: 1870 = 1870년대) */
  birthEra?: number;
}

export interface Mapping {
  person: {
    name_ko: string;
    name_hanja: string | null;
    birth_year: number | null;
    death_year: number | null;
    decision_round: number | null;
    category: string | null;
    summary: string | null;
    evidence_url: string | null;
  };
  match_fields: string[];
  conflicts: string[];
  confidence: number;
  grade: 'strong' | 'weak';
  list_tags: string[];
}

/**
 * 후보별 일치도 산정. 판정이 아니라 "일치 가능한 기록의 존재"를 집계한다.
 * 설계 원칙(§1-1): verdict 필드는 만들지 않는다.
 */
export function scoreCandidates(input: SearchInput, rows: PersonRow[]): Mapping[] {
  const name = input.name.trim();
  const hanja = input.hanja?.trim() || undefined;

  const mappings: Mapping[] = [];

  for (const row of rows) {
    const matchFields: string[] = [];
    const conflicts: string[] = [];
    let confidence = 0;

    const koExact = row.name_ko === name;
    const aliasKo = row.aliases?.some((a) => a.name_ko === name);
    const hanjaExact = !!hanja && row.name_hanja === hanja;
    const aliasHanja = !!hanja && row.aliases?.some((a) => a.name_hanja === hanja);

    if (koExact) {
      matchFields.push('한글 성명 일치');
      confidence += 0.25;
    } else if (aliasKo) {
      matchFields.push('이명(異名) 한글 일치');
      confidence += 0.2;
    } else if (row.name_sim >= 0.45) {
      matchFields.push('한글 성명 유사');
      confidence += 0.1 * row.name_sim;
    }

    if (hanjaExact || aliasHanja) {
      matchFields.push('한자 성명 일치');
      confidence += 0.45;
    } else if (hanja && row.name_hanja && row.name_hanja !== hanja) {
      conflicts.push('한자 성명 불일치');
      confidence *= 0.25;
    }

    if (input.birthEra && row.birth_year) {
      const gap = Math.abs(row.birth_year - (input.birthEra + 5));
      if (gap <= 10) {
        matchFields.push('출생연대 부합');
        confidence += 0.2;
      } else if (gap > 25) {
        conflicts.push('출생연대 불일치');
        confidence *= 0.3;
      }
    }

    if (matchFields.length === 0 || confidence < 0.05) continue;

    mappings.push({
      person: {
        name_ko: row.name_ko,
        name_hanja: row.name_hanja,
        birth_year: row.birth_year,
        death_year: row.death_year,
        decision_round: row.decision_round,
        category: row.category,
        summary: row.summary,
        evidence_url: row.evidence_url,
      },
      match_fields: matchFields,
      conflicts,
      confidence: Math.min(Math.round(confidence * 100) / 100, 0.95),
      grade: (hanjaExact || aliasHanja) && conflicts.length === 0 ? 'strong' : 'weak',
      list_tags: row.list_tags,
    });
  }

  return mappings.sort((a, b) => b.confidence - a.confidence);
}
