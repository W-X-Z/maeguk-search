# 매국서치 (maeguk-search)

부친·조부·증조부·고조부 이름을 입력하면 **친일반민족행위진상규명위원회 결정
명단(1,006명)** 및 그 **후손 계보(descendant closure)** 기록과 일치할 수 있는
경우의 수를 대조하는 서비스.

- **후손 branch 매칭**: 입력한 조상이 명단 인물의 후손 계보 노드와 일치하는지
  확인하고, 경로(이완용 → 이승구 → 이병길)와 함께 표시
- **부자 체인 정렬**: 연속 세대(조부+증조부)를 함께 입력하면 계보상
  부모-자식 관계와 교차 검증되어 confidence가 크게 올라감 (핵심 변별 신호)
- **직접 매칭**: 입력한 조상 성명 자체가 명단과 일치하는 경우 별도 표시

- 판정 서비스가 아니다. 응답에 `verdict` 필드는 항상 `null`이며, 결과는
  "일치 가능한 기록 N건"이라는 집계로만 표현한다.
- 설계 문서: [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md)

## 구성

- **FE/BE**: Next.js 15 (App Router) 단일 앱 — `app/page.tsx` 입력 위저드,
  `app/api/search/route.ts` 매칭 API
- **DB**: Supabase (프로젝트 `maeguk-search`, ref: `vjcyzuionucesmizhffp`,
  ap-northeast-2) — 스키마 사본은 `supabase/migrations/`
- **매칭**: pg_trgm RPC(`search_persons`)로 후보를 뽑고 `lib/match.ts`에서
  한자·출생연대 가중 스코어링

## 로컬 실행

```bash
cp .env.example .env.local   # 키 채우기 (Supabase 대시보드 → Settings → API)
npm install
npm run dev
```

## 데이터 적재

현재 DB에는 검증된 대표 인물 21명(seed_sample)만 들어 있다. 전체 명단 적재는
일반 인터넷이 되는 로컬에서, 두 경로 중 하나로:

**경로 A (권장) — 뉴스타파 CSV.** 생몰년·분야까지 포함된 구조화 데이터.

```bash
# https://data.newstapa.org 에서 "친일반민족행위자결정 1006명 명단" CSV 다운로드 후
node scripts/ingest_csv.mjs 명단.csv          # 미리보기: 컬럼 매핑·건수 확인
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/ingest_csv.mjs 명단.csv --yes  # 실제 적재
# 컬럼 자동 감지가 틀리면: --map "name_ko=성명,name_hanja=한자성명,..."
```

**경로 B — 위키백과 자동 추출.** 이름·한자·회차만 확보 (생몰년 없음).

```bash
node scripts/ingest_wiki_1006.mjs             # 미리보기: 추출 수 ~1,006명인지 확인
node scripts/ingest_wiki_1006.mjs --debug     # 추출이 안 되면 문서 구조 진단
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/ingest_wiki_1006.mjs --yes     # 실제 적재 (추출 수 이상 시 자동 중단)
```

두 스크립트 모두 미리보기가 기본이고, upsert라 중복 실행해도 안전하다.
service role 키는 스크립트 실행에만 쓰고 커밋·배포 환경에 넣지 않는다.

**추가 명단 (모두 미리보기 → --yes 패턴):**

```bash
# Tier 2: 친일파 708인 명단 (위키 하위 문서 자동 발견) — 결과 화면에 분리 표시됨
node scripts/ingest_wiki_708.mjs

# 교차 참조: 국가보훈부 독립유공자 명단
# 공공데이터포털에서 "국가보훈부_독립유공자 명단" CSV를 받은 뒤:
node scripts/ingest_csv.mjs 독립유공자.csv --tag=independence

# 생몰년 보강: Wikidata 대조 (모호한 경우는 건너뛰는 보수적 적용)
node scripts/enrich_wikidata.mjs

# 후손 계보 구축: 명단 인물을 Wikidata에 매핑하고 자식 관계(P40)를
# 최대 3세대 전개 (출생 1930년 이전 컷오프 — 생존자 원천 배제)
node scripts/build_closure_wikidata.mjs
```

후손 계보의 커버리지는 결과 화면 배너에 표시된다("명단 인물 N명 분 구축").
Wikidata 커버리지가 부족한 문중은 족보 큐레이션·기관 제휴로 확장하는 것이
다음 단계다 (docs/TECHNICAL_DESIGN.md §3-1).

## 배포 (Vercel + 커스텀 도메인)

1. Vercel에서 이 저장소 import → Framework: Next.js (자동 감지)
2. 환경변수 등록: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (publishable key. service role 키는 절대 등록하지 않는다)
3. Vercel 프로젝트 → Settings → Domains에서 커스텀 도메인 추가 →
   안내에 따라 도메인 등록기관에서 A 레코드(`76.76.21.21`) 또는
   CNAME(`cname.vercel-dns.com`) 설정
4. 전체 페이지에 `X-Robots-Tag: noindex` 헤더가 적용되어 있음
   (`next.config.mjs`) — 결과 화면 색인 차단

## 운영 원칙 (코드에 반영된 것)

- 입력 성명 저장·로깅 없음 (`app/api/search/route.ts`)
- 이용 동의(`consent`) 없이는 API가 거부
- IP당 시간당 20회 레이트리밋 (베스트에포트)
- 커버리지 배너: 적재 인원이 1,006명 미만이면 "매핑 없음 ≠ 무관함"을 명시
