# 알림톡 정보알림 여정 분기 + 변수 매핑 품질 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans` (인라인, Phase별 체크포인트). 운영 기간계이므로 `subagent-driven`(다중 병렬) 금지 — CLAUDE.md `no_parallel_tasks`.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여정/자동마케팅에 알림톡 정보알림 분기를 추가하고, 전 채널 변수 매핑 품질(소스 완전·빈 값 안전·토글 미리보기)을 끌어올린다.

**Architecture:** 진입에서 목적(마케팅/정보알림)을 분기 — 빌더 UI만 갈라지고 여정 엔진·트리거·통계는 공유. 변수 치환을 `customer + event` 병합 + 매핑별 대체값(default)으로 강화.

**Tech Stack:** Node/Express + React/TS, PostgreSQL + MySQL(QTmsg), 자체 Liquid 엔진, 알림톡 IMC.

---

## 실행 원칙 (운영 안전 — 매 Phase 의무)

각 Phase는 아래 순서를 지킨다. 라인 단위 완전 코드는 **이 단계에서 대상 파일 정독 후 TDD로 작성**한다(미리 박은 추측 코드 금지 — no_guess).

1. 대상 파일 정독 → 변경 지점 grep 전수 리스트업 → Harold 컨펌
2. TDD (RED → GREEN), 인라인 헬퍼 금지(utils 컨트롤타워에 정의 — no_inline_duplication)
3. 동일 falsy/조건/패턴 전 경로 grep (full_pattern_grep_required)
4. tsc 0 + 자가 grep(모델명/박-단어/native dialog 0건)
5. 발송·치환 변경은 실측 1건 시나리오(스펙 §8) + 효과 검증
6. 신규 컬럼/테이블/JOIN은 작성 직전 `information_schema` 검증(db_column_verify) — SCHEMA.md 추측 신뢰 금지
7. 빌드 `npm run build:safe`. git/배포는 Harold.

설계 근거: [2026-06-22-alimtalk-journey-info-alert-design.md](../specs/2026-06-22-alimtalk-journey-info-alert-design.md)

---

## File Structure (touch 예정)

**Backend**
- `utils/messageUtils.ts` — `replaceVariables` 매핑 대체값 인자
- `utils/liquid-templating.ts` (+ frontend 미러) — 매핑 대체값 주입
- `utils/journey-executor.ts` — `replaceAlimtalkVars` `customer+event` 병합 + 대체값
- `utils/journey-trigger-watcher.ts` — execution에 트리거 이벤트 properties 전달
- `utils/journey-builder.ts` — 정보알림 trigger/스텝 검증
- `utils/enabled-fields.ts` / `utils/standard-field-map.ts` — 변수 후보 소스 확장
- `routes/journeys.ts`(해당 route) — 변수 후보 통합 API, 목적 분기 생성
- 자사몰 연동 판단 소스(배송 게이팅) — 구현 시 코드·information_schema로 확정

**Frontend**
- `pages/JourneysPage.tsx` — 진입 분기, 정보알림 빌더, 타임라인 적용
- `components/journey/JourneyMessageEditModal.tsx` — 토글 미리보기 실매핑 반영
- `components/alimtalk/AlimtalkChannelPanel.tsx` — 재사용(변경 최소)
- 신규 `components/journey/JourneyPurposePicker.tsx` — 목적 선택
- 신규 `components/journey/JourneyTimeline.tsx` — 세로 타임라인
- `utils/highlightVars.ts` / `utils/liquid-templating.ts`(미러) — 미리보기 치환

---

## Phase 1 — 빈 값 안전 (전 채널 치환 대체값) [발송 안전 최우선]

**목표:** 변수 매핑에 대체값을 받아 치환 시 자동 적용. 값 누락 시 줄이 사라지지 않고 대체값으로 채움.

**Files:** `messageUtils.ts`, `liquid-templating.ts`(+ frontend 미러), `journey-executor.ts`(replaceAlimtalkVars)

- [ ] 대상 함수 정독 + 호출부 전수 grep (`replaceVariables` / `replaceAlimtalkVars` / `renderLiquid`)
- [ ] RED: 값 누락 고객 → 매핑 대체값으로 치환 + 줄 유지 테스트(대체값 없으면 기존 동작 유지)
- [ ] GREEN: 치환 함수에 `fieldDefaults`(매핑별 대체값) 인자 추가. `{{ }}` `default` 없을 때 매핑 대체값 적용, `%변수%`·`@@키@@` 동일
- [ ] 발송 5경로 + 여정 호출부 회귀 0 확인(grep 증거)
- [ ] 실측 1건: 빈 값 고객 발송 미리보기 = 대체값 치환

**위험:** 발송 공통 함수 — 기존 동작 회귀 절대 0. 호출부 전수 점검.

---

## Phase 2 — 변수 소스 완전화 + 변수 후보 통합 API

**목표:** 변수 후보를 고객 직접컬럼 + 커스텀필드(`custom_1~15`) + CDP 이벤트 키 + 싱크에이전트 필드 한 목록으로.

**Files:** `enabled-fields.ts`, `standard-field-map.ts`, 해당 route

- [ ] `enabled-fields` / `standard-field-map` 정독 — 현재 노출 소스 확인
- [ ] RED: 통합 목록에 커스텀필드·이벤트키·싱크필드 노출 테스트
- [ ] GREEN: 회사별 활성 필드 통합 조회 + endpoint
- [ ] 검증: API 응답에 싱크에이전트 커스텀 필드 포함

**의존:** Phase 4·6의 변수 매핑 UI가 이 목록을 소비.

---

## Phase 3 — 이벤트 데이터 변수

**목표:** 이벤트 트리거로 진입한 실행건에 트리거 이벤트 `properties`(주문번호·상품명)를 실어, 치환이 `customer + event` 둘 다 참조.

**Files:** `journey-trigger-watcher.ts`(processCdpCursorJourney), `journey-executor.ts`, (execution 이벤트 데이터 보존 스키마)

- [ ] `processCdpCursorJourney` + execution enqueue 경로 정독
- [ ] `information_schema` 검증 — 이벤트 데이터 보존 컬럼 유무 → 필요 시 ALTER 설계
- [ ] RED: 주문완료 이벤트 properties → 알림톡 변수 치환 테스트
- [ ] GREEN: 트리거 이벤트 row properties를 execution에 보존 → 실행 시 병합 치환
- [ ] 실측 1건: `cdp.purchase` → 주문번호 변수 채워진 알림톡 큐 1건

**위험:** 스키마 변경 + 커서 경로(정확히 1회). db_verify 필수.

---

## Phase 4 — 진입 분기 + 정보알림 빌더 골격 (프론트)

**목표:** 만들기 진입에서 목적 선택 → 정보알림 빌더(거래 이벤트 트리거 + 알림톡 승인 템플릿).

**Files:** `JourneysPage.tsx`, 신규 `JourneyPurposePicker.tsx`, `AlimtalkChannelPanel` 재사용

- [ ] `JourneysPage` view/생성 흐름 정독 (main/review)
- [ ] 목적 선택 컴포넌트(마케팅/정보알림) — 다크 톤 + ConfirmModal/Toast, native dialog 0
- [ ] 정보알림 빌더: 트리거 선택 + 알림톡 스텝(`channel='kakao'`) 생성 + AlimtalkChannelPanel 마운트
- [ ] 검증: 정보알림 여정 생성 → kakao 스텝 저장 + 발송 동작

**의존:** Phase 1~3(치환·변수·이벤트) 위에서 발송 정확.

---

## Phase 5 — 스텝 타임라인 가시성 (프론트)

**목표:** 카드 나열 → 세로 타임라인(번호·채널 배지·지연 노드 + 사이 '○시간/일 대기' 커넥터). 첫스텝-다음스텝 붙음 해소.

**Files:** 신규 `JourneyTimeline.tsx`, `JourneysPage.tsx`

- [ ] 현재 검토화면 스텝 렌더 정독
- [ ] 타임라인 컴포넌트(마케팅·정보알림 공용) — 모바일 반응형
- [ ] 검증: 스텝 간 간격/커넥터/선택 강조 표시

---

## Phase 6 — 토글 미리보기 실매핑 반영 (프론트)

**목표:** 정적 샘플 1명 → 실제 매핑·대체값 기준 치환 결과.

**Files:** `JourneyMessageEditModal.tsx`, `highlightVars.ts`, `liquid-templating.ts`(미러)

- [ ] 현재 `viewMode`/`SAMPLE_CUSTOMERS`/`mergeAndHighlightVars` 정독
- [ ] 미리보기 치환을 실매핑(Phase 2 목록) + 대체값(Phase 1) 기준으로 교체
- [ ] 검증: 토글 시 변수 적용 결과가 매핑·대체값 반영

---

## Phase 7 — 배송 트리거 게이팅

**목표:** 자사몰(CDP) 연동 시에만 배송 트리거 선택 가능. 미연동 → disabled + "자사몰 연동 시 사용 가능" 안내.

**Files:** `JourneysPage.tsx`(정보알림 빌더), 연동 판단 소스(구현 시 확정)

- [ ] 자사몰 연동 활성 판단 소스 확인(provider 연결) — 추측 금지, 코드·information_schema
- [ ] 게이팅: 미연동 트리거 disabled + 안내(plan-guard 패턴)
- [ ] 검증: 미연동 회사 → 배송 트리거 disabled + 안내

---

## 자가 리뷰 (스펙 커버리지)

| 스펙 | Phase |
|---|---|
| A 진입 분기 | 4 |
| B 변수 매핑 품질 (빈 값/소스/토글) | 1, 2, 6 |
| C 스텝 가시성 | 5 |
| §4 이벤트 데이터 변수 | 3 |
| §5 배송 게이팅 | 7 |
| §8 검증 시나리오 | 각 Phase 검증 단계 |

갭 없음. 권장 실행 순서 = Phase 번호 순(백엔드 발송 토대 → 프론트 빌더/가시성). 단 Harold 우선순위에 따라 Phase 4(진입 분기 골격)를 먼저 가시화할 수 있으며, 그 경우 발송 정확성은 Phase 1~3 완료 후 보장.
