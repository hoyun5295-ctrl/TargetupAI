# 0915 세션 인계: 로그인 세션 만료·인증 창 막힘(B-0915-1) · AI Operator 요금제 미가입 개방 + 요금제 공통 안내 창 · AI 자동제작 전 회사 개방 (2026-09-15 작성) · 2세션 = AI 자동제작 흰 CTA(B-0915-2)·고객 전용 채우기 · 이메일 리뷰 별점(B-0915-3) → §5

> 이 문서는 **다음 세션이 이어받을 자리와 Harold님 실측 순서**만 담는다. 사실·경위의 소유 문서는 아래 링크가 가진다.
> 이 세션 작업은 **전량 배포완료**(Harold 0915). 착수 첫 명령은 현재 상태 확인이다(§4). 명령마다 실행 위치를 적었다. 한 번에 하나씩 실행하고 결과를 본 뒤 다음으로 간다.

## 0. 먼저 읽을 것

1. 이 문서 전체
2. [BUGS.md](../status/BUGS.md) B-0915-1(원인 3 · 수정 · 배포 직후 로그인 실패 판정)
3. [DECISIONS.md](../status/DECISIONS.md) D90(AI Operator 요금제 개방 · 공통 안내 창) · D91(MFA IP 대역 재인증 유지)
4. AI 자동제작 축이면 [FEATURE-AI-AUTO-BUILD.md](FEATURE-AI-AUTO-BUILD.md) §4·§6·§7
5. 2세션(같은 날 이어서) = §5 · [BUGS.md](../status/BUGS.md) B-0915-2·B-0915-3

## 1. 이번 세션에서 한 것

| 축 | 무엇 | 상태 | 소유 문서 |
|---|---|---|---|
| B-0915-1 로그인 | 세션 생성 만료 = 회사 `session_timeout_minutes`(24시간 폐기) · `/auth/mfa/verify` 409 응답에 신뢰 기기 토큰 동봉 · 인증번호 창이 409를 기존 인계 창으로 넘김 | **배포완료(restart 693) · 실측 대기** | BUGS B-0915-1 |
| MFA IP 대역 재인증 | 가이드라인 원문 대조(3.4 유지 조건 없음 · 3.5 "필요시 자체 기준") → Harold "규칙대로 유지" · 코드 무변경 | **결정 완료** | DECISIONS D91 |
| AI 자동제작 개방 | `aiAutoBuildEnabled`에 `*` = 전 회사 · 차감 경로 코드 점검(엔진 AI 호출 자체 차감 0 · 멱등키 102자 · 크레딧제 미적용 = 0) | **배포완료 · ENV `*` 적용 · 직원 노출 확인(Harold)** | FEATURE-AI-AUTO-BUILD §6 |
| AI Operator 요금제 개방 | 대시보드 진입 무조건(구독 만료·정지만 차단) · 허브 카드·[생성]·[이미지] = 잠김이면 공통 안내 창 · 기능 21종 원장 `constants/plan-feature-intros.ts` · 옛 PlanUpgradeModal 삭제 · 대시보드 진단 위저드·5단계 안내 분기 제거 | **배포완료 · 실측 대기** | DECISIONS D90 |
| 후속 4건 | 기능 화면 입구 `PlanGate`(15경로 · 잠김 = `/ai-operator?intro=기능id`) · 첫 진입 안내 마지막 장 "요금제 안내" · `BetaFeatureModal`·헤더 죽은 콜백 삭제 · 도움말 카탈로그 `quick-campaign` = AI 자동제작 기준 | **배포완료(Harold 빌드·reload) · 실측 대기** | DECISIONS D90 |

검증(마지막 실행): backend tsc 0 · vitest 304파일 4,702건 · frontend tsc 0 · build:safe 양쪽 · 계약 테스트 `login-issue` 3 · `login-mfa-takeover-contract` 7 · `plan-feature-modal-contract` 14 · 카탈로그 불변식 11 · 디자인 검출기(공통 안내 창 0 · 첫 진입 안내 모달은 기존 그라데이션 2 · 무변경) · harness-check 통과. Codex = UI·노출 게이트 변경이라 대상 제외(돈 경로 코드 무변경).

## 2. 실측 순서 (Harold님 · 한 번에 하나)

1. **세션 만료**: 로그인 직후(5분 안) 창 닫기 → 회사 세션 시간 + 5분 뒤 같은 브라우저로 로그인 → "사용 중" 없이 진행.
2. **인증번호 창 접속 중**: 서로 다른 네트워크의 두 브라우저에서 같은 아이디 → 뒤 브라우저 인증번호 입력 → "이미 접속 중" 창 → "기존 접속 종료하고 로그인" → 인증번호 재입력 없이 로그인 · 앞 브라우저 강제 로그아웃. 이어서 뒤 브라우저 로그아웃 후 재로그인 → 인증번호 묻지 않음.
3. **FREE 계정 허브**: 대시보드 "AI Operator" → 허브 열림 · 카드마다 "스타터부터" · 카드 누르면 그 기능 안내 창 · [요금제 보기] → 요금제 화면.
4. **FREE 계정 주소 직접**: `hanjul.ai/dm-builder` → 허브로 넘어가며 "모바일 DM" 안내 창.
5. **스타터 이상 계정**: 카드·주소 모두 표시·안내 없이 바로 이동.
6. **AI 자동제작 차감(직원 테스트 뒤)**: 새 멱등키 형태가 누를 때마다 1행.

▶ 실행 위치: .62 (한줄로 서버) · administrator 셸
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI:SS') AS kst, company_id, amount, source, left(idempotency_key, 80) AS idem_key FROM ai_credit_transactions WHERE idempotency_key LIKE 'quick%' AND created_at >= '2026-09-15 00:00:00+09' ORDER BY created_at DESC LIMIT 20;"
```
새 형태 = `quick:{회사}:dm:{시도토큰}:{지문16}`(이메일은 `:email:`) · 사진만 올린 경우 `quick-read:` 1행 추가. 옛 형태 `quick:{초안id}`만 계속 쌓이면 옛 화면 경로다(ENV·재기동 재확인).

7. **도움말 봇**: "AI 자동제작 어떻게 써요?" → 행사 재료·상품·[AI 자동제작]·다시 만들기 순서로 답.

## 3. 범위 밖 · 추가 과제 (착수 판단 = Harold)

- 고객사 사용자 활동 갱신이 회사 세션 시간과 무관하게 30분 고정(`middlewares/auth.ts:104`) · 세션 시간이 30분보다 긴 회사는 서버 만료가 화면 타이머보다 먼저 온다(B-0915-1 이전부터 동일).
- MFA 근거 인용 부정확: 설계서 [§4-B:155](2026-08-18-transmission-qualification-cert.md) · `utils/mfa.ts` 머리 주석(:14)·`isTrustedDevice` 주석(:150) · SCHEMA.md `mfa_trusted_devices` 행이 "3.5가 접속환경 변경 시 재인증을 명시"라고 적었으나 원문은 발신 인증의 "필요시 자체 기준" 예시(D91). 동작 영향 0.
- 삭제된 `PlanUpgradeModal`을 가리키는 주석 2줄 잔존: `components/BrandSendModal.tsx:13` · `components/DirectSendPanel.tsx:113`. 동작 영향 0 · 계약 테스트는 주석을 지운 뒤 검사해 못 잡는다.
- 요금제 표기 잔재(0915 plans 실측 = FREE만 잠김 · `auto_campaign_enabled`만 ENTERPRISE·STAFF): `utils/plan-guard.ts:435` 스팸테스트 자동화 오류 문구 "프로 요금제 이상"(실제 STARTER부터 · 받는 쪽은 FREE뿐) · `:50` 주석 "auto_campaign — PRO+"(판정은 FREE 여부) · 요금제 추천(`plan-recommend.ts:101`)이 `auto_campaign_enabled`를 요구하는 활성 진단 문항이 있으면 ENTERPRISE를 추천(활성 문항 여부 미확인).
- 전체 테스트 첫 실행에서 `__tests__/audit-action-labels.test.ts` 1건 실패(recordAuditLog 추출 0) · 단독·전체 재실행 통과 · 원인 미확인.
- 0914 3세션 미실측(알림톡 예약·취소·분할 · 주소록 0) = [0914 인계 §6](2026-09-14-session-handoff.md).

## 4. 다음 세션 첫 명령 (현재 상태 확인)

▶ 실행 위치: .62 (한줄로 서버) · administrator 셸
```bash
cd /home/administrator/targetup-app && git log --oneline -3; grep -c "expiresInMinutes: sessionTimeoutMinutes" packages/backend/src/utils/login-issue.ts; grep -c "list.includes('\*')" packages/backend/src/utils/ai-auto-build-materials.ts; grep -c "PlanGate featureId" packages/frontend/src/App.tsx; grep '^AI_AUTO_BUILD_COMPANY_IDS=' packages/backend/.env
```
기대 = 1 · 1 · 15 · `AI_AUTO_BUILD_COMPANY_IDS=*`.

## 5. 2세션(같은 날 이어서): AI 자동제작 흰 CTA·고객 전용 채우기 · 이메일 리뷰 별점

### 5-1. 한 것

| 축 | 무엇 | 상태 | 소유 문서 |
|---|---|---|---|
| 인계 문서 정정 | 1세션 인계 대조 정정 6건(FEATURE-AI-AUTO-BUILD §5·§7 · SOT-INDEX · 메모리 · STATUS · 이 문서 §3 · SCHEMA plans 실측) | 완료(문서) | 각 문서 |
| 브랜드 메시지 단가 | 자유형·기본형은 같은 단가 · 친구·비친구만 다름 → 0913 배포분 서버 확인 · 문서만 정정 | 완료(코드 무변경) | FEATURE-BILLING · GW 브랜드메시지 문서 · 메모리 친구 단가 축 |
| B-0915-2 흰 CTA | AI 자동제작이 회사 킷 주색(인비토 `#ffffff`)을 보정 없이 실음 → `readableCustomerBrandKit` · 이메일 `design.palette.primary` 저장 | **배포완료 · 실측 대기** | BUGS B-0915-2 |
| 고객 전용 채우기 | 아웃리치 V3 채우기를 빌려 사용자 재료를 버리던 것 → `campaign-customer-fill.ts`(카드 3장 · 짧은 제목 · 자기 링크 · 상품 전부 · 차단기 직접 판정 · 섹션 상한 12 · 빠진 것 사유 문장) · 상품 칩 1개 이상 · 적대 검토 2라운드(상한 도달) | **배포완료 · 실측 대기** | FEATURE-AI-AUTO-BUILD §6·§7 |
| B-0915-3 리뷰 별점 | 별점 색 `star_color`(DM 발행·편집 캔버스·이메일 공용) · 이메일 평균 별점 줄 + 표시 설정 소비 · 영향 = 리뷰 블록 이메일 `draft` 2건뿐(Harold 실측) | **배포완료 · 실측 = 0916 직원** | BUGS B-0915-3 |

검증(마지막 실행): backend tsc 0 · vitest 305파일 4,750건 · frontend tsc 0 · `campaign-customer-fill` 27 · `email-editor-parity`+`dm-editor-parity` 237 · harness-check 통과(상시 로드 경고 유지). Codex = 돈·DDL 경로 아님이라 대상 제외 · 채우기는 자체 적대 검토 2라운드(검토 + 반박 검증 · 읽기 전용).

### 5-2. 실측 순서 (한 번에 하나)

1. **B-0915-3 리뷰 별점(0916 직원)**: 별이 안 보이던 이메일 캠페인 리뷰 블록 → "별점 색" 지정 → 미리보기 별이 그 색 · "평균 별점 표시" 미사용 → 평균 줄만 사라지고 리뷰별 별은 남음 · DM 편집기 리뷰 블록에서도 별점 색이 캔버스·발행물에 반영.
2. **B-0915-2 흰 CTA · DM**: 흰 킷 회사(인비토)로 AI 자동제작 DM 1건 → 편집기·미리보기에서 버튼 글자가 보인다. 저장값:

▶ 실행 위치: .62 (한줄로 서버) · administrator 셸
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI') AS kst, title, brand_kit->>'primary_color' AS primary_color, jsonb_array_length(sections) AS n, (SELECT string_agg(s->>'type', ',') FROM jsonb_array_elements(sections) s) AS types FROM dm_pages WHERE title LIKE '[AI 자동제작]%' ORDER BY created_at DESC LIMIT 5;"
```
기대 = 배포 뒤 행의 `primary_color` = `#1f2937`(흰 킷) · `n` 12 이하(쿠폰 칩을 켜면 13) · `types`에 사용자 카드 수만큼 `text_card`·`cta`가 선다.

3. **B-0915-2 흰 CTA · 이메일**: 같은 회사로 이메일 1건 → 미리보기 버튼 글자가 보인다. 저장값:

▶ 실행 위치: .62 (한줄로 서버) · administrator 셸
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI') AS kst, name, design->'palette'->>'primary' AS primary_color, design->>'preheader' AS preheader FROM email_campaigns WHERE name LIKE 'AI 자동제작 ·%' ORDER BY created_at DESC LIMIT 5;"
```
기대 = 배포 뒤 행의 `primary_color` = `#1f2937`(흰 킷).

4. **고객 전용 채우기 결과물(직원 테스트 겸)**: 행사 카드 3장(카드2는 사진 없이 "전 품목 40% 할인"만) + 이미지 있는 몰 상품 1개 + 쿠폰 칩만 켜기 → 카드2 빠짐 · 태그만 남은 카드 0 · 상품 슬라이드에 가격 · 결과 바에 빠진 것 사유.
5. **인비토 흰 초안 2건**: 0915 13:25·13:50 초안은 저장값이라 흰색 그대로 → 직원이 다시 만든다(운영 DB 직접 수정 없음).

### 5-3. 범위 밖 · Harold 결정 대기

- AI 자동제작 품질에서 뺀 것 ①375폭 캡처 채점 + 자동 보정 ②서버 타이포 포스터 ③옛 재료 경로(DM 편집기 재료 패널)는 V3 채우기 그대로 ④제목이 비고 첫 줄이 18자를 넘으면 헤드라인·본문 첫 줄 겹침 ⑤상품명에 '1+1'·'할인'이 들면 상품 버튼 라벨이 '자세히 보기' = [FEATURE §7](FEATURE-AI-AUTO-BUILD.md).
- 흰 킷 같은 패턴(옛 재료 경로 이메일 · 템플릿 DM · 플래너 이메일 · 이메일 편집기 새 캠페인 · 회사 킷 저장·색 추출 흰색 무검증 · 이메일 테마 초기화가 palette 삭제) = FEATURE §7 · 인비토 회사 킷 주색 `#ffffff` 자체.
- `sales-outreach-produce.ts:1447` 주석("세일·할인 같은 낱말은 차단기도 걷지 않는다")이 실제 차단기와 다르다.
- 이메일 속성 원장 전 섹션 대조(리뷰 누락 부류 · B-0915-3).

### 5-4. 다음 세션 첫 명령 (배포본 확인)

▶ 실행 위치: .62 (한줄로 서버) · administrator 셸
```bash
cd /home/administrator/targetup-app && git log --oneline -3; grep -c "sanitizedPropsOf" packages/backend/src/utils/campaign-customer-fill.ts; grep -c "readableCustomerBrandKit" packages/backend/src/utils/campaign-quick.ts; grep -c "star_color" packages/backend/src/utils/email/email-section-renderer.ts; grep -c "mallWithImage >= 1" packages/frontend/src/utils/ai-build.ts; grep -c "star_color" packages/frontend/src/components/dm/panels/editors/ReviewsEditor.tsx
```
기대 = 4 · 3 · 2 · 1 · 1.

## 6. 3세션(같은 날 이어서): 카탈로그 보기(PC 책 펼침) · 코드 완료 · 배포 대기

### 6-1. 한 것
- 접수(Harold · 참고 = 메이크뷰 `jessi.makevu.me/26win-1/jn109/5`): 완성 이미지 슬라이드 DM(`hlj.kr/uFKZAtH` · 34장)이 PC에서 430px 한 열이라 카탈로그 느낌이 없다. 목업(`~/Downloads/2026-09-15-dm-catalog-view-mock.html`) Harold 승인 뒤 구현. 메이크뷰 실측·비교·제안 3축 = memory `project_2026_0915_catalog_dm_review`.
- 신규 CT `packages/backend/src/utils/dm/dm-viewer-catalog.ts`(순수 · DB import 0 · 7 export): 게이트 `isCatalogDm`(slides · 펼친 뒤 전 장 `isSwipeImagePage` · 2장 이상) · og 메타(상호 - 제목 · 첫 장 절대 URL · `HANJUL_BASE_URL` 폴백 hanjul.ai) · 핀치 허용 viewport · CSS/HTML/스크립트 조각(접두 `dm-cat-`).
- `dm-viewer.ts renderPagesHtml`(+12/-8): 게이트 on 일 때만 삽입 = viewport 교체 · og · CSS · `body[data-dm-catalog="1"]` · 띠 왼쪽 전체보기 버튼 · 마크업 · 스크립트 · 기존 ←/→ 핸들러 가드 `if (dmCatalogOn) return;`. **조건 밖 DM 출력 = 바이트 동일**(삽입 전부 빈 문자열).
- 화면: PC(폭 768 이상 · 터치형 1024 이상) = 표지 단독 → 2쪽 펼침 · 낱장 넘김(동작 축소 설정은 크로스페이드) · 전체보기 썸네일 · 처음/마지막 · 확대(폭 맞춤 · 더블클릭) · 한쪽/두쪽 · 전체화면 · 안내 모달 · 방향키·휠·드래그 · 3초 뒤 컨트롤 흐림. 모바일 = 현행 무대 그대로 + 띠 왼쪽 전체보기 + 두 손가락 확대.
- 추적 무변경: 책이 쪽을 보일 때 기존 `updateCurrent`(도달 장·진행률)·`bumpSection`(장별 조회)을 호출. 비콘 본문·주기(sendTrack) 그대로. PC에서 기존 `.dm-viewer`는 `display:none`이라 IntersectionObserver 이중 집계 0.
- 검증: `dm-viewer-catalog.test.ts` 10건(게이트 on/off · 펼침 뒤 판정 · og 절대 URL · viewport · 추적 배선·키보드 가드 · PC 판정 규칙 · 구성 요소 · 문구 금지어) · backend tsc 0 · vitest **306파일 4,760건** · 실물 렌더(7장 픽스처 · 운영 이미지 URL)를 로컬 정적 서버로 열어 PC 책·키보드 1단계 이동·전체보기 강조·마지막 100%·모바일 복귀(현재 장 정렬 · 이미지 375×539 top 114 = 운영과 동일)·스크립트 오류 0 확인.
- 운영 규모(Harold SQL 0915): 게이트에 드는 슬라이드 DM **published 19 / total 22**. 배포 즉시 그 19건의 PC 화면이 바뀐다(모바일 무변경). 박성용 재확인 중인 `uFKZAtH` 포함.
- Codex 대상 아님(돈·DDL·쓰기 경로 아님) · DDL 0 · ENV 신설 0 · 프론트 0.
- 부수: `.claude/launch.json`에 `mockups-static`(python http.server · 127.0.0.1:8791 · docs/mockups 만) 추가 = 목업·렌더 확인용. 남겨도 무해.

### 6-2. 배포 (OPS §2-2 · 단계별)

▶ 실행 위치: 로컬 PowerShell
```powershell
tp-push "0915 모바일 DM 카탈로그 보기(PC 책 펼침) 신설 · dm-viewer-catalog CT + renderPagesHtml 게이트 삽입(조건 밖 바이트 동일) · og 메타·핀치 허용 · 테스트 10건 (backend tsc 0 · 306/4,760 · DDL 0)"
```

▶ 실행 위치: .62 (한줄로 서버) · administrator 셸
```bash
cd /home/administrator/targetup-app && git pull
```
```bash
cd /home/administrator/targetup-app/packages/backend && npm run build:safe
```
```bash
pm2 reload targetup-backend && pm2 status
```

### 6-3. 실측 순서 (한 번에 하나)
1. 배포본 확인 ▶ .62 · administrator 셸
```bash
cd /home/administrator/targetup-app && git log --oneline -1; grep -c "isCatalogDm" packages/backend/src/utils/dm/dm-viewer.ts; grep -c "dmCatalogOn" packages/backend/src/utils/dm/dm-viewer.ts; ls packages/backend/dist/utils/dm/dm-viewer-catalog.js
```
기대 = 3 · 1 · 파일 존재.
2. PC 크롬 `https://hlj.kr/uFKZAtH`: 어두운 무대에 표지 단독 → 화살표 또는 → 키로 2·3 펼침(낱장 넘김) → 전체보기 34장(현재 쪽 강조) → 확대(폭 맞춤) → 전체화면 → 마지막 34 단독 · 진행 막대 100%.
3. 같은 DM 발송 추적 탭 [공용 링크] 축: 열람 +1 · 평균 스크롤에 도달 장이 반영(34장 중 5장이면 15% 근처).
4. 삼성 인터넷 실기기: 현행 무대 그대로(상하 중앙 · 아래 띠) + 띠 왼쪽 전체보기 버튼 + 두 손가락 확대가 된다.
5. 카카오톡 나에게 보내기로 `hlj.kr/uFKZAtH`: 첫 장 미리보기가 뜨는지(og · hlj.kr 302 경유 스크래퍼 동작은 미검증).
6. 게이트 밖 DM 1건(섹션형 slides 또는 scroll)을 PC에서 열어 현행 그대로인지.

### 6-4. 범위 밖 · 추가 과제 (착수 판단 = Harold)
- 2축 장별 체류·열람 순서(`section_interactions` jsonb 확장 · DDL 0) · 3축 이미지 위 핫스팟 레이어(편집기 축) · og 메타를 전 DM으로 확대 · 발행 모달에 "PC에서는 책처럼 보입니다" 안내.
- 갤러리 N장 펼침 DM은 장 섹션 id에 `-sN-img` 접미가 붙어 수신자 상세 "섹션 여정"에 "(삭제된 섹션)"으로 나오고 이탈 집계에서 빠진다(`extractFlatSectionsFromDm` 원본만 · `dm.ts recipient-detail`). 이번 34장 DM(장마다 섹션)은 해당 없음. 기록만.
- 메이크뷰 "좌우 맞춤"이 한 쪽 보기에서 확대로 동작하는지 미검증.

### 6-5. 되돌리기
- 커밋 revert → `build:safe` → `pm2 reload`. 발행물은 요청 시 렌더라 즉시 원복. DB 무접촉.
