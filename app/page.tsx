'use client';

import { useState } from 'react';

const RELATIONS = ['부친', '조부', '증조부', '고조부'] as const;
type Relation = (typeof RELATIONS)[number];

const ERAS = [1840, 1850, 1860, 1870, 1880, 1890, 1900, 1910, 1920];

interface PersonInfo {
  name_ko: string;
  name_hanja: string | null;
  birth_year: number | null;
  death_year: number | null;
}

interface RootInfo extends PersonInfo {
  category: string | null;
  decision_round: number | null;
  summary?: string | null;
  evidence_url: string | null;
  list_tags?: string[];
}

interface BranchMapping {
  ancestor_relation: Relation;
  person: PersonInfo;
  root: RootInfo;
  depth: number;
  path_names: string[];
  match_fields: string[];
  conflicts: string[];
  chain: boolean;
  confidence: number;
  grade: 'strong' | 'weak';
}

interface DirectMapping {
  ancestor_relation: Relation;
  person: RootInfo;
  match_fields: string[];
  conflicts: string[];
  confidence: number;
  grade: 'strong' | 'weak';
}

interface SearchResult {
  input_echo: {
    ancestors: { relation: Relation; name: string; hanja: string | null; birth_era: number | null }[];
  };
  homonym_pool: number | null;
  branch_mappings: BranchMapping[];
  mappings: {
    chinil_direct: DirectMapping[];
    chinil_other_lists: DirectMapping[];
    independence_activist: DirectMapping[];
  };
  coverage: { total_official: number; loaded: number; stage: string } | null;
  closure_stats: { roots_covered: number; persons_total: number } | null;
}

interface AncestorForm {
  name: string;
  hanja: string;
  birthEra: string;
}

const emptyForm = (): AncestorForm => ({ name: '', hanja: '', birthEra: '' });

export default function Home() {
  const [consent, setConsent] = useState(false);
  const [forms, setForms] = useState<Record<Relation, AncestorForm>>({
    부친: emptyForm(),
    조부: emptyForm(),
    증조부: emptyForm(),
    고조부: emptyForm(),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);

  const filled = RELATIONS.filter((r) => forms[r].name.trim().length >= 2);

  function update(rel: Relation, field: keyof AncestorForm, value: string) {
    setForms((f) => ({ ...f, [rel]: { ...f[rel], [field]: value } }));
  }

  async function submit() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const ancestors = filled.map((r) => ({
        relation: r,
        name: forms[r].name.trim(),
        hanja: forms[r].hanja.trim() || undefined,
        birthEra: forms[r].birthEra ? Number(forms[r].birthEra) : undefined,
      }));
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent, ancestors }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '오류가 발생했습니다.');
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  const branch = result?.branch_mappings ?? [];
  const direct = result?.mappings.chinil_direct ?? [];
  const other = result?.mappings.chinil_other_lists ?? [];
  const indep = result?.mappings.independence_activist ?? [];

  function Tags({ fields, conflicts }: { fields: string[]; conflicts: string[] }) {
    return (
      <div className="tags">
        {fields.map((f) => (
          <span key={f} className="tag hit">
            {f}
          </span>
        ))}
        {conflicts.map((c) => (
          <span key={c} className="tag conflict">
            {c}
          </span>
        ))}
      </div>
    );
  }

  function ConfBar({ value }: { value: number }) {
    return (
      <>
        <div className="confbar">
          <div style={{ width: `${Math.round(value * 100)}%` }} />
        </div>
        <div className="conflabel">
          기록 일치 가능성 {Math.round(value * 100)}% — 동일인 여부 판정 아님
        </div>
      </>
    );
  }

  return (
    <main>
      <div className="brand">매국서치</div>
      <h1>가족 계보, 친일반민족행위자 후손 branch 기록과 대조하기</h1>

      {!result && (
        <>
          <div className="notice">
            <strong>시작 전에 꼭 읽어주세요</strong>
            <ul>
              <li>본인의 직계 조상에 대해서만 조회할 수 있습니다. 타인 가족의 성명 입력은 금지됩니다.</li>
              <li>결과는 공개 명단·계보 기록과 <b>일치할 수 있는 경우의 수</b>이며, 사실 판정이 아닙니다.</li>
              <li>여러 세대를 함께 입력할수록 (부자 체인 대조) 결과의 변별력이 올라갑니다.</li>
              <li>입력한 성명은 서버에 저장되지 않습니다.</li>
            </ul>
          </div>

          <div className="card">
            <h2>조상 정보 입력 <span className="opt" style={{ fontWeight: 400, fontSize: 13 }}>(아는 만큼만, 최소 1명)</span></h2>
            <p style={{ fontSize: 13, color: 'var(--sub)', marginTop: 4 }}>
              한자·출생연대까지 입력하면 정확도가 크게 올라갑니다.{' '}
              <a href="/guide" style={{ color: 'var(--accent)' }}>
                조상 한자명·본관 찾는 법 →
              </a>
            </p>
            {RELATIONS.map((rel) => (
              <div key={rel} className="ancestor-row">
                <div className="ancestor-label">{rel}</div>
                <div className="ancestor-fields">
                  <input
                    type="text"
                    value={forms[rel].name}
                    onChange={(e) => update(rel, 'name', e.target.value)}
                    placeholder="이름 (한글)"
                    maxLength={5}
                  />
                  <input
                    type="text"
                    value={forms[rel].hanja}
                    onChange={(e) => update(rel, 'hanja', e.target.value)}
                    placeholder="한자 (선택)"
                    maxLength={6}
                  />
                  <select
                    value={forms[rel].birthEra}
                    onChange={(e) => update(rel, 'birthEra', e.target.value)}
                  >
                    <option value="">출생연대?</option>
                    {ERAS.map((y) => (
                      <option key={y} value={y}>
                        {y}년대
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}

            <div className="consent">
              <input
                id="consent"
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <label htmlFor="consent">
                본인의 직계 조상에 대한 조회이며, 결과가 사실 판정이 아님을 이해했습니다.
              </label>
            </div>

            <button
              className="primary"
              onClick={submit}
              disabled={!consent || filled.length === 0 || loading}
            >
              {loading ? '대조 중…' : `계보 대조하기 (${filled.length}명 입력됨)`}
            </button>
            {error && <p className="error">{error}</p>}
          </div>
        </>
      )}

      {result && (
        <>
          <div className="coverage">
            {result.coverage && (
              <>
                명단 {result.coverage.total_official.toLocaleString()}명 중{' '}
                <b>{result.coverage.loaded.toLocaleString()}명</b> 적재
              </>
            )}
            {result.closure_stats && (
              <>
                {' · '}후손 계보 데이터: 명단 인물 <b>{result.closure_stats.roots_covered}명</b> 분
                구축 (노드 {result.closure_stats.persons_total}명) — 구축 초기 단계라 “매핑 없음”이
                “무관함”을 뜻하지 않습니다.
              </>
            )}
          </div>

          <div className="headline">
            후손 branch 매핑: <span className="num">{branch.length}건</span>
          </div>
          <div className="subline">
            입력한 조상 이름이 명단 인물의 후손 계보 기록과 일치할 수 있는 경우의 수입니다.
            {result.homonym_pool === null &&
              ' 동명이인 규모 데이터가 아직 없어, 일치가 곧 동일인을 의미하지 않습니다.'}
          </div>

          {branch.length === 0 && (
            <div className="card empty">
              현재 구축된 후손 계보 기록 중에는 입력과 일치하는 branch가 없습니다.
              <br />
              (계보 데이터 구축 범위 밖과는 대조되지 않았습니다)
            </div>
          )}

          {branch.map((m, i) => (
            <div key={`b${i}`} className={`match ${m.grade}`}>
              <div className="path">
                {m.path_names.map((n, j) => (
                  <span key={j}>
                    {j > 0 && <span className="path-arrow"> → </span>}
                    <span className={j === 0 ? 'path-root' : j === m.path_names.length - 1 ? 'path-hit' : ''}>
                      {n}
                    </span>
                  </span>
                ))}
                <span className="path-input"> ← {m.ancestor_relation} 입력</span>
              </div>
              <div className="meta">
                명단 인물: {m.root.name_ko}
                {m.root.name_hanja ? `(${m.root.name_hanja})` : ''}
                {m.root.decision_round ? ` · 제${m.root.decision_round}기 결정` : ''}
                {m.root.category ? ` · ${m.root.category}` : ''}
                {' · '}
                {m.depth}대손 위치의 기록
              </div>
              <div className="meta">
                일치 노드: {m.person.name_ko}
                {m.person.name_hanja ? `(${m.person.name_hanja})` : ''} {m.person.birth_year ?? '?'}
                –{m.person.death_year ?? '?'}
              </div>
              <Tags fields={m.match_fields} conflicts={m.conflicts} />
              <ConfBar value={m.confidence} />
              {m.root.evidence_url && (
                <a href={m.root.evidence_url} target="_blank" rel="noreferrer">
                  근거 자료 보기 →
                </a>
              )}
            </div>
          ))}

          <div className="headline" style={{ marginTop: 24 }}>
            조상 본인이 명단에 있는 경우: <span className="num">{direct.length}건</span>
          </div>
          <div className="subline">
            입력한 조상 성명 자체가 정부 확정 명단(1,006명)과 일치할 수 있는 경우입니다.
          </div>
          {direct.length === 0 && (
            <div className="card empty">정부 확정 명단과 일치 가능한 경우가 없습니다.</div>
          )}
          {direct.map((m, i) => (
            <div key={`d${i}`} className={`match ${m.grade}`}>
              <div className="name">
                {m.person.name_ko}
                {m.person.name_hanja ? `(${m.person.name_hanja})` : ''}
                <span className="rel-badge">{m.ancestor_relation} 입력</span>
              </div>
              <div className="meta">
                {m.person.birth_year ?? '?'}–{m.person.death_year ?? '?'}
                {m.person.category ? ` · ${m.person.category}` : ''}
                {m.person.decision_round ? ` · 제${m.person.decision_round}기 결정` : ''}
              </div>
              {m.person.summary && <div style={{ fontSize: 14 }}>{m.person.summary}</div>}
              <Tags fields={m.match_fields} conflicts={m.conflicts} />
              <ConfBar value={m.confidence} />
              {m.person.evidence_url && (
                <a href={m.person.evidence_url} target="_blank" rel="noreferrer">
                  근거 자료 보기 →
                </a>
              )}
            </div>
          ))}

          {other.length > 0 && (
            <>
              <div className="headline" style={{ marginTop: 24 }}>
                그 외 공개 명단: <span className="num">{other.length}건</span>
              </div>
              <div className="subline">
                친일파 708인 명단(2002, 국회·광복회 발표)과의 대조 결과입니다. 법적 절차로 확정된
                정부 명단과는 성격이 다른 공적 발표 자료입니다.
              </div>
              {other.map((m, i) => (
                <div key={`o${i}`} className={`match ${m.grade}`}>
                  <div className="name">
                    {m.person.name_ko}
                    {m.person.name_hanja ? `(${m.person.name_hanja})` : ''}
                    <span className="rel-badge">{m.ancestor_relation} 입력</span>
                  </div>
                  <div className="meta">
                    {m.person.birth_year ?? '?'}–{m.person.death_year ?? '?'}
                    {m.person.category ? ` · ${m.person.category}` : ''}
                  </div>
                  <Tags fields={m.match_fields} conflicts={m.conflicts} />
                  <ConfBar value={m.confidence} />
                </div>
              ))}
            </>
          )}

          {indep.length > 0 && (
            <>
              <div className="headline" style={{ marginTop: 24 }}>
                독립유공자 명단 매핑: <span className="num">{indep.length}건</span>
              </div>
              <div className="subline">
                같은 성명이 국가보훈부 독립유공자 명단과도 일치합니다. 동명이인 가능성을 함께
                보여주는 교차 참조입니다.
              </div>
              {indep.map((m, i) => (
                <div key={`i${i}`} className={`match ${m.grade}`}>
                  <div className="name">
                    {m.person.name_ko}
                    {m.person.name_hanja ? `(${m.person.name_hanja})` : ''}
                    <span className="rel-badge">{m.ancestor_relation} 입력</span>
                  </div>
                  <div className="meta">
                    {m.person.birth_year ?? '?'}–{m.person.death_year ?? '?'}
                    {m.person.category ? ` · ${m.person.category}` : ''}
                  </div>
                  <Tags fields={m.match_fields} conflicts={m.conflicts} />
                  <ConfBar value={m.confidence} />
                </div>
              ))}
            </>
          )}

          <button className="ghost" onClick={() => setResult(null)}>
            다시 조회하기
          </button>

          <footer className="caveat">
            이 서비스는 공개된 명단·계보 자료와의 성명 대조 결과만 제공합니다. 어떤 개인에 대한
            사실 판정도 하지 않으며, 결과 화면은 검색엔진에 색인되지 않고 조회 내용은 저장되지
            않습니다. <a href="/about" style={{ color: 'var(--accent)' }}>데이터 출처와 원칙 →</a>
          </footer>
        </>
      )}
    </main>
  );
}
