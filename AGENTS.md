# AGENTS.md — 한줄로(TargetUp) 외부 에이전트 온보딩 (Codex 리뷰 판정 기준)

> Codex CLI 등 외부 에이전트가 세션 시작 시 자동 정독하는 문서. 리뷰·진단 시 아래 불변식을 판정 기준으로 삼는다.
> 사람·내부 AI용 전체 룰은 CLAUDE.md(소유 문서)에 있다 — 이 문서는 리뷰에 필요한 축약판만 담는다.

## 프로젝트 정체
- SMS/LMS/MMS·카카오·이메일·인앱 마케팅 자동화 SaaS "한줄로". **운영 중인 기간계(고객사 6,000+)** — 결함 = 실발송·과금 사고로 직결된다.
- 모노레포: `packages/backend`(Express+TS, PostgreSQL 메인 + MySQL 발송큐) / `packages/frontend`·`packages/company-frontend`(React+TS+Tailwind) / `packages/sdk-js`(자사몰 삽입 인앱 SDK — 순수 브라우저 번들, backend import 물리 불가).

## 절대 보호 (발송·돈 파이프라인 — 이 파일들의 diff는 최우선 정밀 리뷰)
`campaigns.ts`(직접발송 포함) · `spam-filter.ts` · `messageUtils.ts` · `results.ts` · `billing.ts`
— 발송/정산/결과조회의 핵심. 여기 닿는 변경은 실측 1건 시나리오 없이는 안전 판정 금지.

## 도메인 불변식 (위반 = 결함으로 보고)
1. **AI 임의 혜택 금지** — 생성물에 구체 혜택(%/원/무료/쿠폰/증정) 수치 창작 금지. placeholder(`[직접 작성해주세요]` 계열)만 허용. 행사 원문에 실존하는 혜택만 verbatim 허용.
2. **모델명 사용자 노출 금지** — frontend UI·AI 응답·안내문에 Opus/Sonnet/GPT/Claude 등 모델명 출력 금지(backend 호출 파라미터·코드 주석·서버 로그만 허용).
3. **native dialog 금지** — alert/confirm/prompt 0건. ConfirmModal + useToast 사용.
4. **0건 타겟 자동완화 금지** — 발송 대상 0건이면 안내만. 예측 점수를 발송 대상 선정(WHERE/필터)에 쓰면 위반(추천·개인화·발송시각에만 허용).
5. **fail-closed** — 테마 키·구도(treatment)·블록 타입은 화이트리스트 밖 값이면 기본값으로 강등. 디자인 미설정 = 기존 렌더와 바이트 동일(기존 발행물 회귀 0 — 골든 스냅샷이 고정).
6. **디자인 값의 소유 = `backend/src/utils/design-core/`** — FE·SDK는 물리 격리 때문에 값을 미러하며, backend vitest(`design-core-mirror.test.ts`)가 기계 대조한다. 미러 한쪽만 고치는 변경 = 결함.
7. **이중 진실 금지** — 같은 사실을 두 저장소에 쓰지 않는다(예: 브랜드 자산 = `companies.brand_kit` 단일). PG↔MySQL처럼 진실이 두 곳이면 자동 대조 워커 동반 의무.
8. **tsc 통과 ≠ SQL 유효** — SQL 문자열 안 컬럼명은 컴파일러가 못 잡는다. 신규 컬럼/테이블/JOIN 참조는 information_schema 실검증이 관행 — 미검증 참조 발견 시 지적.
9. **신규 컬럼 소비 endpoint** — catch에서 `column does not exist` → 503 `DB_MIGRATION_PENDING` 분기 의무(500 노출 금지).
10. **SMS/LMS 본문 = EUC-KR 제약** — 유니코드 이모지가 발송 본문 생성 경로에 유입되면 수신 깨짐 = 결함(허용 특수문자 화이트리스트 별도).
11. **크레딧** — 사전 확인 → 성공 후 차감(`deductCreditSafe` 계열), 화면 표시 금액 = 실차감 금액. 불일치 = 결함.
12. **멀티테넌트 격리** — 모든 조회/쓰기에 `company_id`(+필요 시 `store_code`·`user_id`) 필수. 누락 = 치명 결함.
13. **공통 로직 = `utils/` 컨트롤타워 1곳** — 라우트 파일 안 인라인 헬퍼 중복 정의 = 결함.
14. **외부 URL fetch(og/브랜드 추출 등)** — 검증된 IP로 연결 고정 + 크기/시간 상한(SSRF 방어 공용 CT 경유). 신규 fetch 경로가 이를 우회하면 결함.

## 검증 명령
- backend: `cd packages/backend && npx tsc --noEmit && npx vitest run`
- frontend: `cd packages/frontend && npx tsc --noEmit`
- sdk-js: `cd packages/sdk-js && npx tsc --noEmit && npx vitest run`
- 디자인 회귀: backend의 `design4-golden`·`design-core` 테스트가 3채널 렌더 출력을 스냅샷으로 동결 — 스냅샷 변화 = 회귀 신호.

## 리뷰 우선순위
돈·크레딧·환불 > 발송 경로·타겟 선정 > DB 쓰기 원자성(TOCTOU·read-modify-write) > XSS/SSRF(발행물 HTML·SDK DOM·외부 fetch) > 렌더 회귀(미설정=불변) > 성능.
