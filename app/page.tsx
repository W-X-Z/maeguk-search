'use client';

import { useState } from 'react';

interface Mapping {
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
}

interface SearchResult {
  input_echo: { name: string; hanja: string | null; birth_era: number | null };
  homonym_pool: number | null;
  mappings: {
    chinil_direct: Mapping[];
    chinil_other_lists: Mapping[];
    chinil_descendant: Mapping[];
    independence_activist: Mapping[];
  };
  coverage: { total_official: number; loaded: number; stage: string; note: string } | null;
}

const ERAS = [1840, 1850, 1860, 1870, 1880, 1890, 1900, 1910, 1920];

export default function Home() {
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState('');
  const [hanja, setHanja] = useState('');
  const [birthEra, setBirthEra] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          hanja: hanja || undefined,
          birthEra: birthEra ? Number(birthEra) : undefined,
          consent,
        }),
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

  const direct = result?.mappings.chinil_direct ?? [];

  return (
    <main>
      <div className="brand">매국서치</div>
      <h1>내 조상 성명, 친일반민족행위자 결정 명단 기록과 대조하기</h1>

      {!result && (
        <>
          <div className="notice">
            <strong>시작 전에 꼭 읽어주세요</strong>
            <ul>
              <li>본인 및 직계 조상에 대해서만 조회할 수 있습니다. 타인 또는 타인 가족의 성명을 입력하는 것은 금지됩니다.</li>
              <li>결과는 정부 결정 명단 기록과 <b>성명이 일치할 수 있는 경우의 수</b>이며, 특정인이 귀하의 조상이라는 판정이 아닙니다.</li>
              <li>동명이인이 매우 흔하므로, 한글 이름만으로는 어떤 결론도 내릴 수 없습니다.</li>
              <li>입력한 성명은 서버에 저장되지 않습니다.</li>
            </ul>
          </div>

          <div className="card">
            <h2>조상 정보 입력</h2>
            <label className="field">조상 성명 (한글)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 김철수"
              maxLength={5}
            />
            <label className="field">
              한자 성명 <span className="opt">(선택 — 알면 정확도가 크게 올라갑니다)</span>
            </label>
            <input
              type="text"
              value={hanja}
              onChange={(e) => setHanja(e.target.value)}
              placeholder="예: 金哲洙"
              maxLength={6}
            />
            <label className="field">
              추정 출생연대 <span className="opt">(선택)</span>
            </label>
            <select value={birthEra} onChange={(e) => setBirthEra(e.target.value)}>
              <option value="">모름</option>
              {ERAS.map((y) => (
                <option key={y} value={y}>
                  {y}년대
                </option>
              ))}
            </select>

            <div className="consent">
              <input
                id="consent"
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <label htmlFor="consent">
                본인 또는 본인의 직계 조상에 대한 조회이며, 결과가 사실 판정이 아님을 이해했습니다.
              </label>
            </div>

            <button className="primary" onClick={submit} disabled={!consent || !name || loading}>
              {loading ? '대조 중…' : '기록 대조하기'}
            </button>
            {error && <p className="error">{error}</p>}
          </div>
        </>
      )}

      {result && (
        <>
          {result.coverage && (
            <div className="coverage">
              현재 대조 범위: 정부 결정 명단 {result.coverage.total_official.toLocaleString()}명 중{' '}
              <b>{result.coverage.loaded.toLocaleString()}명</b> 적재
              {result.coverage.stage === 'seed_sample' && ' (대표 인물 샘플 단계)'}
              {' — '}미적재 인물과는 대조되지 않으므로 “매핑 없음”이 “무관함”을 뜻하지 않습니다.
            </div>
          )}

          <div className="headline">
            매핑되는 경우의 수: <span className="num">{direct.length}건</span>
          </div>
          <div className="subline">
            입력({result.input_echo.name}
            {result.input_echo.hanja ? ` / ${result.input_echo.hanja}` : ''}
            {result.input_echo.birth_era ? ` / ${result.input_echo.birth_era}년대생` : ''}
            )과 성명이 일치할 수 있는 명단 기록의 수입니다.{' '}
            {result.homonym_pool === null &&
              '동명이인 규모 데이터가 아직 없어, 일치가 곧 동일인을 의미하지 않습니다.'}
          </div>

          {direct.length === 0 && (
            <div className="card empty">
              현재 적재된 기록 중에는 입력과 일치 가능한 경우가 없습니다.
              <br />
              (적재 범위 밖 인물과는 대조되지 않았습니다)
            </div>
          )}

          {direct.map((m, i) => (
            <div key={i} className={`match ${m.grade}`}>
              <div className="name">
                {m.person.name_ko}
                {m.person.name_hanja ? `(${m.person.name_hanja})` : ''}
              </div>
              <div className="meta">
                {m.person.birth_year ?? '?'}–{m.person.death_year ?? '?'}
                {m.person.category ? ` · ${m.person.category}` : ''}
                {m.person.decision_round ? ` · 제${m.person.decision_round}기 결정` : ''}
              </div>
              {m.person.summary && <div style={{ fontSize: 14 }}>{m.person.summary}</div>}
              <div className="tags">
                {m.match_fields.map((f) => (
                  <span key={f} className="tag hit">
                    {f}
                  </span>
                ))}
                {m.conflicts.map((c) => (
                  <span key={c} className="tag conflict">
                    {c}
                  </span>
                ))}
              </div>
              <div className="confbar">
                <div style={{ width: `${Math.round(m.confidence * 100)}%` }} />
              </div>
              <div className="conflabel">
                기록 일치 가능성 {Math.round(m.confidence * 100)}% — 동일인 여부 판정 아님
              </div>
              {m.person.evidence_url && (
                <a href={m.person.evidence_url} target="_blank" rel="noreferrer">
                  근거 자료 보기 →
                </a>
              )}
            </div>
          ))}

          <button className="ghost" onClick={() => setResult(null)}>
            다시 조회하기
          </button>

          <footer className="caveat">
            이 서비스는 친일반민족행위진상규명위원회가 법적 절차에 따라 결정한 1,006명 명단(공개
            자료)과의 성명 대조 결과만 제공합니다. 어떤 개인에 대한 사실 판정도 하지 않으며, 결과
            화면은 검색엔진에 색인되지 않고 조회 내용은 저장되지 않습니다.
          </footer>
        </>
      )}
    </main>
  );
}
