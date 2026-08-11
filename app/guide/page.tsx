import Link from 'next/link';

export const metadata = {
  title: '조상 정보 찾는 법 — 매국서치',
};

export default function Guide() {
  return (
    <main>
      <div className="brand">매국서치</div>
      <h1>조상 정보(한자·본관·계대) 찾는 법</h1>

      <p style={{ fontSize: 14.5, marginBottom: 16 }}>
        한글 이름만으로는 동명이인이 많아 대조 결과의 변별력이 낮습니다. 아래 순서로 조상의
        <b> 정확한 한자 성명과 출생연도</b>를 확인한 뒤 입력하면 결과 신뢰도가 크게 올라갑니다.
      </p>

      <div className="card">
        <h2>1. 제적등본 확인 (가장 정확)</h2>
        <p style={{ fontSize: 14 }}>
          직계 조상의 한자 성명·생몰년이 공적으로 기록된 문서입니다. 정부24 또는 주민센터에서
          <b> 제적등본</b>을 발급받으면 조부모·증조부모까지의 기록을 확인할 수 있습니다 (직계
          후손만 발급 가능).
        </p>
      </div>

      <div className="card">
        <h2>2. 문중 족보 열람 사이트</h2>
        <ul style={{ fontSize: 14, paddingLeft: 18, lineHeight: 1.9 }}>
          <li>
            <a href="http://www.xn--3e0bm80a8yhwdw5c209b.com/" target="_blank" rel="noreferrer">
              한국인의족보
            </a>{' '}
            — 회원가입 후 성씨·본관으로 문중 전자족보 열람
          </li>
          <li>
            <a href="https://jokbo.skku.edu/" target="_blank" rel="noreferrer">
              성균관대 한국족보자료시스템
            </a>{' '}
            — 1910년 이전 간행 족보를 인명으로 검색 (조상 윗세대 확인에 유용)
          </li>
          <li>
            <a href="https://www.familysearch.org/ko/korea/" target="_blank" rel="noreferrer">
              FamilySearch
            </a>{' '}
            — 한국 족보 원문 이미지 최대 규모 (무료 계정 필요)
          </li>
          <li>
            <a href="https://www.rootsinfo.co.kr/" target="_blank" rel="noreferrer">
              뿌리를 찾아서
            </a>{' '}
            — 성씨·본관 유래, 파(派)와 항렬 정보
          </li>
        </ul>
      </div>

      <div className="card">
        <h2>3. 종친회(대종회) 문의</h2>
        <p style={{ fontSize: 14 }}>
          성씨·본관의 대종회 사무국에 연락해 파(派)와 항렬자를 문의하면 정확한 계대(系代)를
          확인할 수 있습니다. 항렬자를 알면 같은 문중 안에서 세대 위치를 특정할 수 있어 가장
          강력한 단서가 됩니다.
        </p>
      </div>

      <div className="notice" style={{ marginTop: 16 }}>
        <strong>주의</strong>
        <ul>
          <li>여기서 확인하는 것은 본인 가족의 기록입니다. 타인의 계보를 조회하는 데 사용하지 마세요.</li>
          <li>확인한 정보는 이 서비스에 저장되지 않으며, 대조에만 일회성으로 사용됩니다.</li>
        </ul>
      </div>

      <Link href="/" style={{ color: 'var(--accent)', fontSize: 14 }}>
        ← 대조 화면으로
      </Link>
    </main>
  );
}
