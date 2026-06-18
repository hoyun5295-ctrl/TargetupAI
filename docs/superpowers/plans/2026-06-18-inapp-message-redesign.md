# 인앱 메시지 디자인·카피 전면 개선 — 구현 계획

> 설계서: `docs/superpowers/specs/2026-06-18-inapp-message-redesign-design.md`
> 실행: inline 순차 (CLAUDE.md `no_parallel_tasks` — 하나씩 세심하게). 비토 직접 구현.

**Goal:** 인앱 모달·미리보기를 이미지 주인공 디자인으로 격상하고, AI 카피를 짧고 강렬하게 + 시나리오별 색·뱃지 다양화, 편집 모달을 3탭으로 심플화한다.

**Architecture:** badge_text 컬럼 1개 추가(ALTER 검증 선행) → AI 생성기 프롬프트·시나리오 매핑 → SDK 모달 렌더러 → 미리보기 정합 → 편집 모달 3탭. 디자인은 SDK가 단일 진실, 미리보기는 1:1 추종.

**Tech Stack:** TypeScript, Express(ts-node), React, PostgreSQL, sdk-js(rollup+vitest)

---

## Task 1: badge_text 컬럼 + image_url UPDATE 버그 fix

**Files:**
- Verify/ALTER: `cdp_inapp_messages` (Harold 실행)
- Modify: `packages/backend/src/utils/inapp-message.ts`
- Modify: `status/SCHEMA.md`

- [ ] **Step 1: 컬럼 존재 검증 SQL Harold 제공** (db_column_verify_before_code)

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'cdp_inapp_messages' AND column_name = 'badge_text';
```
Expected: 0행 (신규) → Step 2. 이미 있으면 Step 2 생략.

- [ ] **Step 2: ALTER (Harold 실행)**

```sql
ALTER TABLE cdp_inapp_messages ADD COLUMN IF NOT EXISTS badge_text varchar(20);
```

- [ ] **Step 3: `CreateInAppMessageInput`에 `badge_text?: string | null` 추가** (snake 키, image_url 옆)

- [ ] **Step 4: INSERT에 badge_text 추가** — 컬럼 목록·VALUES·파라미터 배열 3곳, `input.badge_text || null`

- [ ] **Step 5: UPDATE에 badge_text + image_url 버그 fix**
  - `badge_text = COALESCE($N, badge_text)` 추가
  - `image_url = $16` → `image_url = COALESCE($16, image_url)` (재업로드 안 하면 기존 이미지 보존). 단 명시적 삭제(null 의도)는 별도 sentinel 불필요 — 프론트가 항상 전체 editing 전송하므로 COALESCE로 보존이 안전.
  - mapRowToMessageDetail / FULL_COLUMNS에 badge_text 반영

- [ ] **Step 6: SCHEMA.md cdp_inapp_messages에 badge_text varchar(20) 실측 기록 (2026-06-18)**

- [ ] **Step 7: backend tsc 0 확인**

Run: `cd packages/backend && npx tsc --noEmit`

---

## Task 2: AI 생성기 — 카피 축소 + 시나리오 매핑

**Files:**
- Modify: `packages/backend/src/utils/inapp-ai-generator.ts`

- [ ] **Step 1: 카피 길이 지침 교체**
  - 시스템 프롬프트 "✗ 단순 안녕하세요 수준 X — 풍성한 본문 의무 (200~400자)" → "✓ 짧고 강렬하게 — 제목 18자 안, 본문 1~2문장(40~70자). 한 호흡에 읽히게. 군더더기 X"
  - 응답 JSON 예시 body 주석 "200~400자 권장" → "40~70자, 1~2문장"
  - userMessage "본문 200~400자 풍성하게" → "본문 40~70자 짧고 강렬"
  - 혜택 placeholder 룰 그대로 유지

- [ ] **Step 2: 시나리오 매핑 상수 추가** (QUICK_START_SEEDS 확장 or 신규 맵)

```ts
const SCENARIO_STYLE: Record<QuickStartScenario, { badge: string; preset: string }> = {
  cart_recovery:    { badge: '장바구니',     preset: 'sunset' },
  new_welcome:      { badge: 'WELCOME',      preset: 'forest' },
  dormant_recovery: { badge: '오랜만이에요', preset: 'midnight' },
  new_product:      { badge: 'NEW',          preset: 'candy' },
  vip_appreciation: { badge: 'VIP',          preset: 'goldlux' },
  checkout_abandon: { badge: '거의 다 왔어요', preset: 'sunset' },
  repeat_purchase:  { badge: '다시 만나요',   preset: 'ocean' },
};
```

- [ ] **Step 3: GeneratedInAppMessage에 badge_text 추가 + 프롬프트에 badge 생성 지침**
  - 시스템 프롬프트에 "badge_text: 8자 안 짧은 라벨 (NEW / VIP / 오랜만이에요 등). 구체 혜택·수치 X" 추가
  - 응답 JSON에 `"badge_text": "NEW"` 추가
  - templateHint 있으면 SCENARIO_STYLE.badge를 기본값으로, AI가 자연어에 맞게 덮어쓰기 허용
  - background_color는 SCENARIO_STYLE.preset 프리셋 hex로 기본 제안 (사용자 변경 가능)

- [ ] **Step 4: 응답 파싱에 badge_text 검증** — `String(parsed.badge_text || '').slice(0, 20)`

- [ ] **Step 5: backend tsc 0 + grep 0** (모델명·박단어)

Run: `cd packages/backend && npx tsc --noEmit`

---

## Task 3: SDK 모달 렌더러 디자인 격상

**Files:**
- Modify: `packages/sdk-js/src/inapp.ts`
- Test: `packages/sdk-js/src/__tests__/inapp-enhancements.test.ts`

- [ ] **Step 1: InAppMessageSdk에 badge_text 추가**
- [ ] **Step 2: renderCenterModal 이미지 4:3**
  - hero `height:'190px'` 제거 → `aspectRatio:'4/3', width:'100%', objectFit:'cover'`
- [ ] **Step 3: 뱃지 렌더 헬퍼** — content 상단에 badge pill (badge_text 있을 때). 반투명 흰 배경 + 메시지 textColor.
- [ ] **Step 4: 이미지 없을 때 분기** — hero 없으면 content 상단 패딩 키우고 뱃지·제목 강조
- [ ] **Step 5: appendTextBlock clampMap modal 8 → 3**
- [ ] **Step 6: vitest — badge 렌더 + 4:3 케이스 추가**

Run: `cd packages/sdk-js && npx vitest run`
Expected: 전체 PASS

- [ ] **Step 7: sdk-js tsc 0**

---

## Task 4: 미리보기 정합

**Files:**
- Modify: `packages/frontend/src/components/InAppMessagePreview.tsx`

- [ ] **Step 1: props에 badge 추가**
- [ ] **Step 2: modal hero 118px → aspectRatio 4/3**
- [ ] **Step 3: 뱃지 pill 렌더 (CardInner)**
- [ ] **Step 4: clampMap modal 8 → 3**
- [ ] **Step 5: frontend tsc 0**

---

## Task 5: 편집 모달 3탭 심플화

**Files:**
- Modify: `packages/frontend/src/pages/InAppMessagesPage.tsx`

- [ ] **Step 1: EditModal에 activeTab state ('content'|'design'|'target')**
- [ ] **Step 2: 탭 바 (내용/디자인/타겟·시점) — violet 밑줄 활성**
- [ ] **Step 3: 기존 섹션을 탭별로 분배**
  - content: 제목·본문·badge_text 입력·CTA·혜택경고
  - design: 표시형태·프리셋8종·이미지
  - target: 세그먼트·트리거·시간/요일·빈도 (기존 showAdvanced 접기 제거, 이 탭으로 흡수)
- [ ] **Step 4: badge_text 입력 필드 추가 (content 탭, 20자 maxLength)**
- [ ] **Step 5: 미리보기에 badge 전달**
- [ ] **Step 6: handleSave payload에 badge_text 포함 (...editing이라 자동, 타입만 확인)**
- [ ] **Step 7: native dialog grep 0 + frontend tsc 0**

---

## Task 6: 전체 검증

- [ ] backend / frontend / sdk-js `tsc --noEmit` 0
- [ ] sdk-js `vitest run` 전체 PASS
- [ ] grep 0건: 박-단어 / 모델명(Opus·Sonnet·GPT·Claude) / native dialog(alert·confirm·prompt)
- [ ] 디자인 자가점검: 7 시나리오 색·뱃지·카피 다양 + 편집 3탭 + 이미지 4:3
- [ ] 표준 종료 멘트 (배포는 Harold)

---

## Self-Review

- 스펙 5개 항목(badge 컬럼/AI/SDK/미리보기/편집) → Task 1~5 매핑 완료
- 타입 일관성: badge_text 컬럼명 전 task 통일, image_url UPDATE COALESCE 일관
- 비범위(이미지 저장 디버깅·모바일 DM) 미포함 확인
