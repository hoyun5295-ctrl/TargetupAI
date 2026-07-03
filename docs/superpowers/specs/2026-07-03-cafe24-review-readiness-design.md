# 카페24 심사 신청 준비 완주 — 설계 문서 (2026-07-03)

> 목표: **다음 세션 종료 시점 = 개발자센터 "심사요청" 클릭.** 질질 끌지 않는다 — 이 문서만으로 재조사 없이 구현 완료 가능하게 작성.
> 전제(오늘 완료): 앱 설정(권한 9종+웹훅 5종) + 수신부 실측 정정(X-API-Key+event_no) + 테스트몰 gyunoo83 실주문 3종 웹훅 완주 + 금액 파싱 fix. 상세 = memory/project_2026_0703_cafe24_app_store_integration.md

## 완료 기준 (Definition of Done)
1. 심사위원 동선(테스트몰에서 앱 실행 → 한줄로 확인)이 끊기지 않고 동작
2. 카페24 몰 = 연동 1클릭으로 SDK까지 자동 삽입(행동 수집 개통)
3. 판매정보·결제 방식·심사 답변 자료 등록 완료
4. "심사요청" 클릭

---

## A. 앱 실행 랜딩 (심사 반려 1순위 방어)

### A-0. 파라미터 실측 (구현 첫 스텝 — 추측 금지)
카페24가 "앱 실행" 시 App URL로 붙이는 쿼리 파라미터(mall_id, user_id, timestamp, hmac 등으로 알려짐)는 공개 문서가 SPA라 사전 확정 불가. **개발자센터 "테스트 실행"(gyunoo83)을 누르고 우리 쪽에서 실제 쿼리를 로그로 캡처해 확정한다.**
- 방법: 랜딩 라우트를 먼저 만들고 `console.log(location.search)` 수준의 수신 확인 → 파라미터 확정 후 활용 범위 결정.
- hmac 서명 검증은 파라미터 실측 후 2차 적용(클라이언트 시크릿 기반 — backend 검증 endpoint 추가 여부 그때 판단). v1은 mall_id를 "편의 프리필"로만 쓰므로 서명 없어도 보안 문제 없음(연동 자체는 로그인+OAuth 동의 필수).

### A-1. 라우트·진입
- 신규 프론트 라우트: **`/cafe24/launch`** (frontend App 라우터 등록).
- 개발자센터 App URL 변경: `https://app.hanjul.ai` → **`https://app.hanjul.ai/cafe24/launch`** (Harold 1분, 저장만).
- 루트(`/`)로 mall_id 쿼리가 들어오는 과거 케이스 대비: 루트에서 `?mall_id=` 감지 시 `/cafe24/launch`로 쿼리 보존 리다이렉트 1줄 추가.

### A-2. 화면 시나리오 (3분기)
공통: 다크 슬레이트 + violet, 카페24 배지, 몰 ID 큰 표기. 클릭 1회 원칙.
1. **로그인 + 회사관리자 + 미연동**: "〔mall_id〕 몰을 한줄로에 연결" 카드 1장 + [카페24 연결] 버튼 → 기존 `GET /api/cafe24/oauth/authorize?mall_id=` 재사용(새 창 동의) → 완료 후 자사몰연동 상태 화면으로.
2. **로그인 + 이미 연동됨**: "이미 연결된 몰입니다" + [자사몰연동 현황 보기] / [대시보드] 버튼.
3. **비로그인**: "한줄로 계정으로 로그인하면 이 몰 연결이 이어집니다" + 로그인 버튼(returnTo=`/cafe24/launch?mall_id=...` 보존) + "아직 계정이 없다면 가입" 링크. 로그인/가입 완료 후 자동 복귀.
- returnTo 보존은 기존 로그인 흐름의 리다이렉트 파라미터 방식 재사용(구현 시 LoginPage의 기존 returnTo 처리 grep 후 동일 패턴 — 없으면 sessionStorage에 mall_id 보관 후 로그인 성공 시 복귀).

### A-3. 심사위원 요금제 게이트 (결정 대기 — Harold)
현행: `isCdpEnabledForPlan` = FREE(미가입)만 차단, 전 유료 개방. **심사위원은 신규 가입(FREE) 상태라 연동 버튼에서 403 → 반려 위험.**
- 제안(정답 1개): **FREE 계정도 카페24 연동 1몰까지 허용** — 월 이벤트 한도(`isOverMonthlyCdpLimit`)가 이미 별도로 통제하므로 남용 방어는 유지되고, 무료 가입자가 몰부터 붙이는 온보딩(데이터 축적)에도 유리. 구현 = isCdpEnabledForPlan의 FREE 차단을 카페24 OAuth 경로에 한해 해제(또는 전면 해제) — 1곳 수정.
- Harold 결정 후 반영(돈·정책이라 임의 진행 안 함). 거부 시 대안 없이 반려 위험이 남는다는 점만 명시.

---

## B. scripttags — SDK 자동 삽입 (연동 = 행동 수집 개통)

### B-1. scope 추가
- OAuth 요청 scope(DEFAULT_SCOPE, cafe24-client.ts)에 **`mall.write_application`** 추가 (scripttags 리소스는 앱(Application) 분류 — 개발자센터 권한은 이미 "읽기+쓰기"로 확보되어 있어 앱 설정 변경 불필요).
- 기존 연동 몰(gyunoo83)은 scope 변경으로 **재동의 필요** → 구현 후 재연동 1회(disconnect 없이 authorize 재실행이면 upsert 갱신 — saveCafe24Integration ON CONFLICT).

### B-2. 신규 CT `utils/cafe24-scripttag.ts`
- `ensureCafe24ScriptTag(companyId, mallId)`:
  1. 회사 SDK public_key 확보 — 기존 키 발급 체계 재사용(CdpSettingsPage 발급 endpoint의 백엔드 함수 — 구현 시 grep으로 함수명 확정). 키 없으면 자동 발급.
  2. `GET /api/v2/admin/scripttags` (기존 cafe24ApiCall wrapper 재사용)로 우리 src 존재 확인 — 멱등.
  3. 없으면 `POST /api/v2/admin/scripttags` — `src = https://app.hanjul.ai/sdk/v0.3.7/hanjul.min.js?k={public_key}`, `display_location: ["ALL"]`(정확 필드는 Admin API scripttags 문서로 구현 시 확정 — developers.cafe24.com/docs/api/admin/#scripttags).
  4. 성공 시 `company_integrations.meta`에 `{ scripttag_no, scripttag_src }` 기록(신규 컬럼 0 — jsonb 병합).
- 호출 지점: OAuth callback 성공 직후 fire-and-forget(실패해도 연동은 성공 — 로그만). 재시도는 status 화면의 "스크립트 재설치" 버튼(선택 구현, 시간 남으면).
- `removeCafe24ScriptTag`: disconnect 시 meta의 scripttag_no로 DELETE(실패 무시).

### B-3. SDK 키 수신 보강 (필수 선행 확인)
현행 스니펫은 `data-hjl-key` 속성으로 키 전달. scripttags는 src만 등록하므로 **SDK가 `?k=` 쿼리에서도 키를 읽는지 확인** — 안 읽으면 SDK에 `document.currentScript.src`의 `k` 파라미터 fallback 3~5줄 추가 + 버전 bump(v0.3.8) + 빌드. (packages/sdk — 기존 배포 방식 그대로.)

### B-4. 실측 (완료 기준 2 검증)
gyunoo83 재연동 → 몰 앞면 페이지 소스에서 hanjul.min.js 스크립트 자동 삽입 확인 → cdp_events에 page_view 수신 확인.

---

## C. 판매정보 상세페이지 (스토어 게시물)

### C-1. 앱 소개문 초안 (그대로 붙여넣기용 — 등록 화면 글자수 제한에 맞춰 절단)
> **한줄로AI — 쇼핑몰 데이터로 움직이는 AI 마케팅 자동화**
>
> 카페24 쇼핑몰을 연결하면, 회원·주문·장바구니 데이터가 한줄로에 자동으로 쌓이고 AI가 마케팅을 대신 움직입니다.
>
> **이런 것이 자동으로 됩니다**
> - 회원·주문·장바구니 실시간 수집 (설치 후 설정 0건)
> - 고객 등급·구매 이력 기반 타겟 자동 추출
> - AI 문안 생성 + 문자(SMS/LMS/MMS)·카카오 알림톡 발송
> - 장바구니 이탈·재구매 시점 등 고객 여정 자동화
> - 발송 후 실제 구매까지 이어졌는지 성과 리포트로 확인
>
> **요금**: 앱 설치와 카페24 연동은 무료입니다. 메시지 발송·AI 기능은 한줄로 요금제(hanjul.ai)에 따릅니다.
> **지원**: 고객센터 및 이메일 문의 — 연동·수집·발송 전 과정을 안내해 드립니다.
- 금지 점검: 모델명 0 / 미래 로드맵 0 / 과장 수치 0 — 위 초안 준수.

### C-2. 스크린샷 5장 (직원 협업 — 캡처 목록)
1. 자사몰연동 화면(카페24 연동됨 상태) 2. 대시보드 3. AI 문안 생성 화면 4. 성과 리포트 5. 여정(자동화) 빌더. 캡처 시 실고객사 데이터 노출 금지 — hoyun 테스트 계정으로.

### C-3. 기타 등록 항목
카테고리(마케팅), 검색 키워드(문자발송/알림톡/CRM/타겟마케팅/AI마케팅), 언어관리 = 한국어만.

---

## D. 결제 방식 (자체결제 신고)
- 방향(확정): **앱 무료 + 과금은 한줄로 구독(자체결제)**.
- 절차: Harold가 개발자센터 로그인 상태에서 출시가이드 [결제 안내 > 자체결제 관리](developers.cafe24.com/app/front/app/launch/payment/external) 페이지를 **HTML 저장**(오늘 방식) → 비토가 파싱해 신고 항목·요건 정리 → 판매정보의 가격 항목과 함께 설정.
- 유의: 자체결제 수수료·신고 의무가 있으면 그 수치 그대로 따름(추측 금지 — 문서 확보 후 확정).

---

## E. 심사 답변서 초안 (시스템 및 정보보안)
등록 화면 질문 형식은 심사 신청 화면에서 확정하되, 아래 재료로 즉답 가능:
- **수집 데이터**: 회원(이름·연락처·이메일·등급), 주문(금액·상품·상태), 장바구니 — 몰 운영자가 앱 설치·권한 동의로 허용한 범위만.
- **전송·보관**: 전 구간 HTTPS(TLS). OAuth 토큰은 서버 DB에 보관, 화면 재노출 없음. 웹훅은 X-API-Key 검증 + 중복 차단(idempotency).
- **개인정보 처리**: 이용약관 제14조(비식별 데이터 활용·opt-out)·개인정보처리방침 게시. 고객사별 데이터 격리(company_id), AI 학습은 비식별 처리 후.
- **연동 해제 시**: 토큰 즉시 폐기(disconnect, status='revoked') + 스크립트 제거(B-2). ※ 해제 시 기수집 데이터 삭제 정책은 문안으로 정의 필요 — "고객사 요청 시 삭제" 명시(약관 제14조 3항과 일치).
- **장애 대응**: 웹훅 유실 대비 로그 조회 API 보완(카페24 권장) — 심사 답변에는 "웹훅 + 주기 대사(sync) 병행 예정"으로 기재.

---

## F. 개인정보(Privacy) 권한 문의 문안 (회원 웹훅용 — 별도 트랙)
개발자센터 어드민 > 개발지원 > 개발사고객지원에 그대로 제출:
> 안녕하세요, 앱 "한줄로AI"(client_id: iQ5aZtcSANPlrl1yJB68rD) 개발사입니다.
> 회원 관련 웹훅(90032 신규가입, 90080 회원정보 변경, 90144 등급 변경)을 수신하려면 권한분류에 회원(Customer)·개인화정보(Personal)와 함께 "개인정보(Privacy)"가 필요한 것으로 확인했습니다. 그런데 개발자센터 앱 권한 설정 화면의 권한 목록에는 개인정보(Privacy) 항목이 없습니다.
> 개인정보(Privacy) 권한은 어떤 절차로 신청·부여받을 수 있는지 안내 요청드립니다. (앱 용도: 쇼핑몰 운영자가 동의한 범위에서 회원·주문 데이터를 CRM 마케팅에 활용 — 이용약관·개인정보처리방침 게시 완료)

---

## G. 구현 순서 (다음 세션 체크리스트 — 이 순서 그대로)
1. [비토] `/cafe24/launch` 라우트+화면(A-2 골격) → 배포 → [Harold] App URL 변경 → "테스트 실행" → 파라미터 실측 확정(A-0)
2. [Harold 결정] A-3 FREE 계정 카페24 연동 허용 → [비토] 반영
3. [비토] scope에 mall.write_application 추가 + SDK ?k= fallback 확인/보강(B-3) + cafe24-scripttag CT(B-2) + callback 훅
4. [Harold] gyunoo83 재연동 → 몰 소스에서 SDK 자동 삽입 + page_view 수신 실측(B-4)
5. [Harold] 자체결제 관리 문서 HTML 저장 → [비토] 분석 → 결제 방식 설정(D)
6. [직원] 스크린샷 5장(C-2) / [Harold] 판매정보 등록(C-1 소개문 붙여넣기)
7. [비토] 심사 답변(E) 실제 질문 항목에 맞춰 최종화 → [Harold] **심사요청 클릭**
8. (병행) Privacy 문의(F) 제출 — 심사와 무관하게 진행 가능

## 검증·안전 원칙
- 발송·돈 경로 0줄. 기존 OAuth/웹훅 회귀 0(추가형). scripttags 실패는 연동 성공에 영향 없음(fire-and-forget).
- backend/frontend tsc 0 + 자가 grep(모델명·native dialog·박-단어) + gyunoo83 실측 각 단계 1건.
- DB 신규 컬럼 0(meta jsonb만). SQL 신규 참조 발생 시 information_schema 선검증.
