# 이메일 마케팅 브레이즈급 Phase 1 — 확정 설계 (2026-06-28, Harold 합의)

> 2026-06-28 brainstorming으로 우선순위 확정. 후보 7개 중 Harold 선택 = **비주얼 에디터 강화 + 템플릿 갤러리 + 개인화(변수+조건부)** 세 가지. 분석 대시보드 / A/B 테스트 / 세그먼트 타겟은 다음 최적화 페이즈로 이연.

## 0. 현황 (구현 직전 재확인 대상)

- 비주얼 에디터 `components/email/EmailVisualEditor.tsx` 이미 존재 — 좌(AI 입력 + 블록 리스트 + 위/아래 화살표 + 블록 추가), 중(`SectionPropsEditor` 속성 편집 + 이미지 업로드), 우(실시간 미리보기 = 백엔드 `POST /api/email/render-preview`).
- 블록 모델 = DM과 공용 `Section[]` (`utils/dm-section-defaults`). 이메일 화이트리스트 12종(`utils/email/email-blocks.ts`).
- 렌더러 = `utils/email/email-section-renderer.ts` (`renderEmailSections` — table 인라인 스타일, 변수 치환 없음).
- 발송 = `utils/email-channel.ts` `sendEmailCampaign`. 발송 루프에 수신자별 `{{key}}` 치환 슬롯이 이미 존재(현재 `recipient.substitutions`로 `name`만 공급). 캠페인은 `sections`(jsonb)와 렌더 산출물 `html_body`를 둘 다 보관, 발송은 `html_body` 기준.
- 예약 발송 = `utils/email-send-sweeper.ts` (target_spec 기반). **개인화 적용 시 즉시 발송 + 예약 발송 두 경로 모두 갱신 필요(6원칙 ④ 라우팅 축 영향표).**
- 개인화 인프라(재사용 대상):
  - `utils/liquid-templating.ts` (CT-50) — Liquid 엔진(`{{ }}`, `{% if/elsif/else %}`, `{% for %}`, `{% case %}`, 비교/and/or/contains, `default`/`format_number` 필터). 안전 sandbox.
  - `utils/inapp-personalization.ts` (CT-79) — `renderTextForCustomer(text, customer)` = Liquid `{{ customer.X }}` + 기존 `%고객명%` 동시 처리, `buildPreviewCustomers(companyId)` = VIP/일반/신규 실데이터 샘플 3건, `listAvailableVariables()` = UI 드롭다운용 변수 목록.
  - `utils/dm/dm-variable-resolver.ts` — `Section[]` 텍스트 필드 치환 + 조건부 섹션 숨김(`shouldHideSection`) 패턴.

## 1. Feature 1 — 비주얼 에디터 강화

기존 에디터 위에 더한다(새로 짓지 않음).
- **드래그앤드롭 순서 변경**: 좌측 블록 리스트에 네이티브 HTML5 드래그(라이브러리 추가 금지 — `components/dm/panels/SectionList.tsx`의 기존 `draggable`/`onDragStart`/`onDragOver`/`onDrop` 패턴 재사용). 위/아래 화살표는 모바일 대비로 유지.
- **블록 복제**: 선택 블록 헤더에 복제 버튼(같은 type + props 깊은 복사 + 새 id/order).
- 이미지 업로드·스타일 편집은 `SectionPropsEditor`에 이미 있으므로 변경 없음.
- 디자인: 현 에디터 톤(`bg-slate-900` + violet) 유지. 모바일 반응형.

## 2. Feature 2 — 템플릿 갤러리

AI 빠른 시작(3크레딧, 브랜드보이스 생성)과 별개로 **즉시·무료**로 완성 골격을 불러오는 경로.
- 신규 프리셋 파일 `utils/email-templates.ts`(frontend) — `Section[]` 프리셋 6~8종. 시나리오/업종 결이 빠른 시작과 같게(장바구니·휴면·VIP 감사·신상·재구매·생일·뉴스레터 등).
- 각 프리셋: 고유 아이콘 + 이름 + 한 줄 + 작은 미리보기(백엔드 render-preview로 모달 진입 시 렌더). 혜택 문구는 `[직접 작성해주세요]` 자리표시(임의 혜택 금지 룰).
- UI: 이메일 페이지 헤더에 "템플릿에서 시작" 버튼 → **갤러리 모달**(카드 그리드 2~3열, 가로 긴 띠 버튼 X) → 선택 → 비주얼 에디터로 `Section[]` 즉시 로드(1클릭, 크레딧 0).
- 모달 = 커스텀 다크(`bg-slate-900` + `border-white/10` + `rounded-2xl`), native dialog 0.

## 3. Feature 3 — 개인화 (변수 + 조건부)

핵심: 신규 인라인 치환을 만들지 않고 기존 컨트롤타워를 재사용한다.

### 3-1. 작성(에디터)
- **변수 칩 팔레트**: 텍스트 필드 옆에 `listAvailableVariables()` 토큰 칩(회원명/등급/포인트/지역/직전 상품/장바구니 수/마지막 구매 N일 전/구매 횟수/LTV). 클릭 = 커서 위치에 `{{ customer.X }}` 삽입. 사용자는 Liquid 문법 몰라도 됨.
- **조건부 표시**: 블록별 "조건부 표시" 토글 → 필드·연산자·값 선택 UI(예: 등급 == VIP, 포인트 > 0). 사용자가 Liquid를 직접 타이핑하지 않는다. 조건은 구조화 데이터로 `Section`에 보관(신규 optional 필드 `display_condition`).
- **미리보기 샘플 토글**: 미리보기 상단에 VIP/일반/신규 + "변수 그대로" 토글(`buildPreviewCustomers` 실데이터). 선택 시 그 샘플 고객으로 치환·조건 평가한 미리보기.

### 3-2. 렌더/발송 (★ 발송·돈 경로 — 0611 6원칙)
접근: **발송 시 수신자별로 `Section[]`을 렌더**(사전 렌더 html_body에 Liquid를 얹는 방식은 esc() 따옴표 충돌로 제외).
- 신규 CT `utils/email/email-personalization.ts`:
  - `resolveEmailSectionsForCustomer(sections, customer)` — ① 텍스트 필드를 `renderTextForCustomer`(inapp CT, Liquid + 기존 % 동시)로 치환, ② `display_condition` 불충족 블록 제외. 반환 = 치환·필터된 `Section[]`.
- 발송 분기(`sendEmailCampaign` + sweeper 양쪽):
  - 캠페인에 `sections` 있음 → 수신자별 `resolveEmailSectionsForCustomer` → `renderEmailSections` → 광고 footer + `applyTracking` → 발송.
  - `sections` 없음(수동 HTML) → **기존 html_body + substitutions 경로 그대로(무회귀)**.
- `resolveCustomerRecipients` 확장: 기존 `{email, name}` + 화이트리스트 고객 필드 객체(`customer`) 동봉 → 발송 루프가 치환에 사용. 화이트리스트 = inapp `INAPP_BROWSER_VAR_WHITELIST` 결과 재사용(연락처 식별정보 제외).
- 미리보기 endpoint `render-preview`: optional `sampleCustomer` 받으면 resolve 후 렌더.

### 3-3. 6원칙 적용
- ① 전수 grep: 발송 경로 2곳(`sendEmailCampaign` 즉시 + sweeper 예약) 모두 개인화 적용 확인, 증거 첨부.
- ② 효과 검증: 발송 후 실제 치환 결과(샘플 1건) 확인 후 성공 표시.
- ④ 라우팅 축 영향표: 즉시/예약 두 경로 + 미리보기 + 저장 모두 점검.
- ⑤ 발송·돈 실측 1건: 테스트 발송 1건으로 변수·조건 치환 정상 확인 시나리오 보고.
- ⑥ 수정 전 승인.

## 4. 신규/수정 파일 요약

신규:
- `utils/email/email-personalization.ts` (백엔드, 얇은 CT — inapp/liquid 재사용)
- `utils/email-templates.ts` (frontend, 갤러리 프리셋 `Section[]`)
- 갤러리 모달 컴포넌트(이메일 페이지 내부 또는 `components/email/`)

수정:
- `components/email/EmailVisualEditor.tsx` (드래그앤드롭 + 복제 + 변수 칩 + 조건부 토글 + 샘플 미리보기 토글)
- `pages/EmailCampaignsPage.tsx` ("템플릿에서 시작" 버튼 + 갤러리 모달 연결)
- `utils/email-channel.ts` (`resolveCustomerRecipients` 고객 필드 동봉 + `sendEmailCampaign` 섹션 캠페인 수신자별 렌더 분기)
- `utils/email-send-sweeper.ts` (예약 발송도 동일 개인화 분기)
- `Section` 타입에 optional `display_condition` 추가 — `sections`는 이미 jsonb 컬럼이라 DB ALTER 불필요(섹션 객체 안에 보관). 리졸버/렌더러가 이 필드를 소비.
- render-preview endpoint(`routes/email.ts`) — `sampleCustomer` optional 처리

## 5. 영구 원칙 준수

- 디자인: [[feedback_design_modal_first_simplicity]](버튼+모달, 가로 긴 띠 X, 데이터 적응) + Journey 동급.
- 모델명 UI 0 / native dialog 0 / AI 임의 혜택 0(`[직접 작성해주세요]`) / 모바일 반응형 / Source caption.
- 인라인 치환 신설 0 — `liquid-templating`·`inapp-personalization`·`dm-variable-resolver` 재사용.
- 발송·돈 경로 = 0611 6원칙.

## 6. 승리 공식 적용 — 편리함 + AI 풍부 활용 ([[feedback_braze_win_formula]])

각 기능은 단순 폼·모달화에서 그치지 않고, 한 클릭 편리함과 AI 자율 활용을 동시에 담는다.
- **템플릿 갤러리** = 전체 나열만이 아니라, 상단에 AI가 이 회사(브랜드보이스·업종)에 맞는 1~2개를 먼저 추천 → 1클릭 적용.
- **비주얼 에디터** = 1클릭 "AI로 개선"(제목·본문·블록 다듬기, 기존 email-ai 재사용) + 발송 전 AI 자율 진단 카드(스팸·가독성·길이, 기존 진단 재사용)를 에디터 안에 노출.
- **개인화** = 사용자가 변수·조건을 손으로 짜기 전에, AI가 세그먼트 기반으로 "VIP엔 이 블록·휴면엔 이 블록" 조건부를 제안 → 1클릭 적용(혜택 문구는 placeholder 유지, 임의 생성 X).
- **이메일 메인 진입** = AI 자율 진단 카드(오픈율 낮은 캠페인 → 1클릭 개선 제안)는 기존 InsightModal·미오픈 SMS 흐름과 연결.
- 자가 질의 2개(구현 직전): ① 충분히 편리한가(클릭 최소·AI 자동·추가 입력 0)? ② AI를 충분히 풍부하게 쓰는가(진단·생성·추천·1클릭 액션)?

## 7. 검증

- backend tsc 0 + frontend tsc 0.
- 신규 CT `email-personalization.ts` = 순수 함수 단위 verify(변수 치환 + 조건 분기 + 빈 고객 fallback).
- 자가 grep: 모델명/native dialog/박-단어 0.
- 발송 실측 1건 시나리오(테스트 발송으로 변수·조건 치환 확인).
