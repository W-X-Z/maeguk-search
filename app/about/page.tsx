import Link from 'next/link';

export const metadata = {
  title: '서비스 안내 — 매국서치',
};

export default function About() {
  return (
    <main>
      <div className="brand">매국서치</div>
      <h1>서비스 안내</h1>

      <div className="card">
        <h2>이 서비스가 하는 일</h2>
        <p style={{ fontSize: 14.5 }}>
          입력한 조상 성명이 공개된 친일반민족행위자 명단의 기록과 <b>일치할 수 있는 경우의 수</b>가
          있는지 대조합니다. 특정인이 누구의 조상이라는 판정은 하지 않으며, 할 수도 없습니다.
          동명이인이 매우 흔하기 때문에 한글 이름만의 일치는 거의 아무것도 증명하지 않습니다.
        </p>
      </div>

      <div className="card">
        <h2>대조 기준 데이터</h2>
        <ul style={{ fontSize: 14, paddingLeft: 18, lineHeight: 1.9 }}>
          <li>
            <b>정부 확정 명단(1,006명)</b> — 대통령 소속 친일반민족행위진상규명위원회가
            2006·2007·2009년 법적 절차에 따라 결정한 명단. 이 서비스의 기본 대조 기준입니다.
          </li>
          <li>
            <b>친일파 708인 명단(2002)</b> — 국회 민족정기를 세우는 국회의원모임과 광복회가
            발표한 명단. 법적 확정이 아닌 공적 발표 자료로, 별도 구분해 표시합니다.
          </li>
          <li>
            <b>독립유공자 명단(국가보훈부)</b> — 교차 참조용. 같은 이름이 독립유공자 명단과도
            일치하는 경우를 함께 보여줍니다.
          </li>
        </ul>
      </div>

      <div className="card">
        <h2>지키는 원칙</h2>
        <ul style={{ fontSize: 14, paddingLeft: 18, lineHeight: 1.9 }}>
          <li>본인·직계 조상 외 타인에 대한 조회 금지</li>
          <li>입력한 성명은 저장·로깅하지 않음</li>
          <li>결과 화면은 검색엔진에 색인되지 않고, 공유 URL을 제공하지 않음</li>
          <li>모든 결과에 근거 자료 출처를 표시하고, 이진 판정 문구를 사용하지 않음</li>
          <li>과도한 반복 조회 제한</li>
        </ul>
      </div>

      <Link href="/" style={{ color: 'var(--accent)', fontSize: 14 }}>
        ← 대조 화면으로
      </Link>
    </main>
  );
}
