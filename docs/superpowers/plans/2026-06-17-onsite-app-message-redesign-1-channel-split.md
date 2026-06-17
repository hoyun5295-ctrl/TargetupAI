# 인앱 메시지(웹/앱 채널 분리) 1단계 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans` (inline, 한 세션 순차 — CLAUDE.md `no_parallel_tasks` 준수, subagent 병렬 금지). Steps use checkbox (`- [ ]`).
> **설계서**: `docs/superpowers/specs/2026-06-17-onsite-app-message-redesign-design.md`

**Goal:** 현 "인앱 메시지"를 웹/앱 채널로 명확히 분리한다. 웹은 즉시 실동작(확실한 4종), 앱은 화면·형태가 준비된 채 2단계 SDK가 들어오면 켜지는 상태로 만든다.

**Architecture:** `cdp_inapp_messages`에 `channel` 컬럼을 더해 메시지를 web/app로 가른다. 서버 서빙(`/cdp/inapp/active`)은 web만 SDK에 내려 기존 웹 동작을 보호한다. 프론트 진입을 웹/앱으로 분기하고 각 채널 전용 형태만 노출한다. 메시지 정의·AI·개인화·A/B·과금은 이미 채널 무관 공통이라 재사용한다.

**Tech Stack:** PostgreSQL, Node/Express(`routes/cdp.ts`, `utils/inapp-*`), React(`InAppMessagesPage.tsx`), `@hanjullo/sdk`(`sdk-js`).

> **공통 원칙 (매 task)**: ① 코드 수정 전 해당 파일 정독 ② DB는 information_schema 선검증(tsc 통과 ≠ SQL 유효) ③ 새 컬럼 endpoint catch에 `column does not exist` → 503 분기 ④ 매 task 종료 시 작동 검증(tsc 0 + 관련 grep 0 + 실제 동작) — **"제대로 작동이 첫 번째 원칙"(Harold 명시)** ⑤ 모델명/native dialog/박-단어 grep 0.

---

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `status/SCHEMA.md` | 스키마 기록 | `channel` 컬럼 추가 반영 |
| `packages/backend/src/routes/cdp.ts` | inapp CRUD + 서빙 | 생성/목록/조회/서빙에 channel 반영, active는 web 필터 |
| `packages/frontend/src/pages/InAppMessagesPage.tsx` | 인앱 화면(목록+편집 모달) | 진입 웹/앱 분기 + 채널별 형태 선택 + 앱 목업 미리보기 |
| `packages/frontend/src/App.tsx` | 라우팅/메뉴 | 메뉴 라벨 "인앱 메시지"→확정 이름, 진입 동선 |
| (메뉴 컴포넌트 — 정독 후 특정) | 사이드/대시보드 메뉴 | 라벨 교체 |

> 이름(메뉴 라벨)은 Harold 확정 대기. 확정 전까지 코드 라벨은 잠정값 + 한 곳(상수)에서 관리해 일괄 교체 가능하게 둔다.

---

## Task 1: DB channel 토대

**Files:**
- 검증 SQL 제공(Harold 실행) → `status/SCHEMA.md` 기록

- [ ] **Step 1: 기존 컬럼 확인 SQL을 Harold께 제공**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'cdp_inapp_messages' ORDER BY ordinal_position;
```
Expected: `channel` 컬럼이 없음을 확인(설계서 §0 기준 32컬럼).

- [ ] **Step 2: 미존재 확인 후 ALTER SQL 제공 (Harold 직접 실행)**

```sql
ALTER TABLE cdp_inapp_messages
  ADD COLUMN IF NOT EXISTS channel varchar(10) NOT NULL DEFAULT 'web';
CREATE INDEX IF NOT EXISTS idx_inapp_channel
  ON cdp_inapp_messages(company_id, channel, status);
```
기존 데이터(현 1건) = `web` default로 자동 분류.

- [ ] **Step 3: SCHEMA.md에 channel 컬럼 기록 (2026-06-17, web/app)**

- [ ] **Step 4: 검증** — Harold ALTER 후 `SELECT channel, count(*) FROM cdp_inapp_messages GROUP BY channel;` = 기존 건 web.

---

## Task 2: 백엔드 channel 반영 (서빙 보호가 핵심)

**Files:**
- Modify: `packages/backend/src/routes/cdp.ts` (inapp 생성/목록/조회/active)

- [ ] **Step 1: cdp.ts inapp 생성(POST /inapp)·목록(GET /inapp)·active(GET /inapp/active) 현재 코드 정독**

- [ ] **Step 2: 생성 시 `channel` 저장** (body.channel, 기본 'web', 'web'|'app'만 허용 — 그 외 422)

- [ ] **Step 3: `GET /inapp/active`에 `channel='web'` 필터 추가** — 웹 SDK는 web 메시지만 받는다(앱 메시지가 웹에 유출되는 사고 차단). 가장 중요한 안전 장치.

- [ ] **Step 4: 목록/통계 응답에 channel 포함 + channel 쿼리 필터 지원**

- [ ] **Step 5: 새 컬럼 catch 503 분기 확인** (이미 `handleDbMigrationError(err, res, 'cdp_inapp_messages')` 존재 — channel 미반영 환경 대비 유지)

- [ ] **Step 6: 검증** — backend tsc 0 / `web` 메시지가 `/inapp/active`로 내려오고 `app` 메시지는 안 내려옴(임시 app 1건으로 확인).

---

## Task 3: 메뉴 이름 + 진입 웹/앱 분기

**Files:**
- Modify: `packages/frontend/src/pages/InAppMessagesPage.tsx` (진입 분기)
- Modify: `packages/frontend/src/App.tsx` + 메뉴 컴포넌트(정독 후 특정) — 라벨

- [ ] **Step 1: InAppMessagesPage 현재 구조(목록/통계/편집 모달/형태 선택) 정독**

- [ ] **Step 2: 진입 시 채널 선택 상태 추가** — 첫 화면에서 웹/앱 두 카드 클릭 → 선택된 채널 화면. (다크+violet 톤, ConfirmModal/useToast 정합, Source caption 유지)

- [ ] **Step 3: 메뉴 라벨 상수화 + 확정 이름으로 교체** (Harold 확정 후 1곳 수정으로 반영)

- [ ] **Step 4: 검증** — frontend tsc 0 / 진입 시 웹·앱 분기 노출 / 모델명·native dialog·박-단어 grep 0.

---

## Task 4: 웹 채널 화면 (확실한 4종)

**Files:**
- Modify: `packages/frontend/src/pages/InAppMessagesPage.tsx` (웹 편집)

- [ ] **Step 1: 현재 8종 형태 선택 UI 정독**

- [ ] **Step 2: 웹 채널 형태를 4종으로 제한** — 중앙 모달 / 슬라이드 인 / 토스트 / 플로팅 버튼. (배제 4종은 코드 렌더러는 보존, 웹 선택지에서만 숨김)

- [ ] **Step 3: 저장 시 `channel='web'`** + 기존 편집(제목/본문/이미지/CTA/세그먼트/트리거/미리보기) 재사용

- [ ] **Step 4: 검증** — 웹 메시지 생성 → `/inapp/active` 수신 → 실제 브라우저에서 4종 렌더 동작(기존 sdk-js 경로). 작동이 첫 원칙.

---

## Task 5: 앱 채널 화면 (형태 정의 + 목업 미리보기)

**Files:**
- Modify: `packages/frontend/src/pages/InAppMessagesPage.tsx` (앱 편집)

- [ ] **Step 1: 앱 채널 형태 선택 UI 구현** — 모달 / 전면 인앱 / 인앱 배너(상·하단) / 토스트·슬라이드

- [ ] **Step 2: 앱 미리보기 = 폰 프레임 목업 렌더** (실제 SDK 렌더는 2단계 — "앱 SDK 준비 시 작동" 안내 배지)

- [ ] **Step 3: 저장 시 `channel='app'`** + "현재 미리보기는 목업, 실제 표시는 앱 SDK 연동 후" 명시

- [ ] **Step 4: 검증** — 앱 메시지 저장 → 목록 app 분류 → `/inapp/active`(web 필터)로 안 새는지 재확인 → frontend tsc 0.

---

## Task 6: 통계 채널 구분

**Files:**
- Modify: `packages/backend/src/routes/cdp.ts` (inapp stats) + `InAppMessagesPage.tsx` (요약)

- [ ] **Step 1: 통계 집계에 channel 구분** (웹/앱 분리 impression·CTR)

- [ ] **Step 2: 요약 카드에 채널 표시** + Source caption 유지

- [ ] **Step 3: 검증** — backend/frontend tsc 0 / 채널별 수치 분리 노출.

---

## Task 7: 1단계 통합 검증

- [ ] **Step 1:** backend + frontend tsc 0 errors
- [ ] **Step 2:** grep 0 — 모델명(Opus/Sonnet/GPT/Claude) / native dialog(alert/confirm/prompt) / 박-단어
- [ ] **Step 3:** 웹 채널 = 실제 렌더·클릭 기록(`/track`) 동작 (기존 경로 회귀 없음)
- [ ] **Step 4:** 앱 채널 = 편집·목업·web 유출 차단 확인
- [ ] **Step 5:** 표준 종료 멘트 → Harold 배포 (DB ALTER 선행 순서 안내)

---

## Self-Review (작성자 점검)

- **Spec 커버리지**: §3 진입(Task 3) / §4 채널모델(Task 1·2) / §5 웹 4종(Task 4) / §6 앱 형태(Task 5) / §7 작업범위(Task 1~6) / §9 검증(Task 7) — 전 항목 task 대응됨.
- **1단계 경계 준수**: 앱은 목업까지(Task 5), 실 네이티브 렌더는 본 plan 범위 밖(2단계). 명시됨.
- **위험 지점**: Task 2 Step 3(web 필터)이 누락되면 앱 메시지가 웹에 노출 → 최우선 검증 항목으로 고정.
- **미정 의존**: 이름(메뉴 라벨)은 Harold 확정 대기 — 상수화로 분리해 진행 가능.
