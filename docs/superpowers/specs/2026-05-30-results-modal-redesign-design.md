# 발송결과 모달 재설계 — 흰 톤 모던 + 알림톡 템플릿 정보 (2026-05-30)

> 발송결과 모달(`ResultsModal.tsx`)이 대시보드 대비 평면적·구식. 대시보드 흰 톤 모던으로 전면 재설계 + 캠페인 상세 컴포넌트 분리 + 알림톡 캠페인에 템플릿코드/명/검수상태 표시.

## 1. 배경 / 목표

- 현재 발송결과 요약 모달(5 메트릭 색박스 + 기본 테이블) + 캠페인 상세(기본 카드 + 폰 미리보기)가 대시보드(흰 베이스 + 둥근 카드 + 그라데이션 액센트)와 격차가 큼.
- Harold 결정 3건(brainstorming 컨펌):
  1. 톤 = **대시보드 흰 톤 모던** (다크 보라 X)
  2. 범위 = **비주얼 + 정보위계 재구성** (비주얼만 X)
  3. 알림톡 = **템플릿코드 + 템플릿명 + 검수상태** 표시

## 2. 현황 (코드 확인 완료)

- 파일: `packages/frontend/src/components/ResultsModal.tsx` 단일 — 요약 탭 + 캠페인 상세 모달 + 발송내역 팝업 + 테스트 발송 탭 전부 포함(비대).
- endpoint (변경 최소화):
  - `GET /api/v1/results/summary` — 5 메트릭(총발송/성공/실패/성공률/예상비용).
  - `GET /api/v1/results/campaigns?...&limit=2000` — 채널통합조회 목록.
  - `GET /api/v1/results/campaigns/:id` — `campaignDetail.charts { successFail{success,fail,clicks}, carriers, errors }`.
  - `GET /api/v1/results/campaigns/:id/messages` — 발송내역 + `alimtalkTemplateInfo {code, name}` (D225+).
  - `GET /api/v1/results/campaigns/:id/export`.
- 알림톡 코드·명은 D225+에서 이미 표시 중(ResultsModal ~876-930). **새로 추가할 것 = 검수상태(status)** + 전면 비주얼·위계 재설계.

## 3. 설계

### 3-1. 셸 / 톤 (공통)
- 흰 베이스(`bg-white`), 모달 컨테이너 `rounded-2xl`, sticky 헤더(제목 + 닫기 X), 본문 여백 강화.
- 카드 = `rounded-2xl` + `border border-slate-200` + `shadow-sm`. 아이콘 칩 = `10x10 rounded-xl` 그라데이션(대시보드 패턴).
- 팔레트: violet(주) / emerald(성공) / rose(실패) / amber(비용) / slate(중립). 그라데이션은 아이콘 칩·강조 요소에만(과용 금지).
- 타이포: 숫자 `text-2xl~3xl font-bold`, 라벨 `text-xs text-slate-500`.

### 3-2. 요약 탭 — 메트릭 5 카드
- 현재 평면 색박스(`bg-violet-50` 등) → 대시보드 DB현황 카드형(아이콘 칩 + 라벨 + 큰 숫자).
- 총발송 violet / 성공 emerald / 실패 rose / 성공률 violet(+ 미니 프로그레스바) / 예상비용 amber(₩).
- 레이아웃 `grid-cols-2 md:grid-cols-5 gap-3`.
- 필터 바(기간/유형/발송자/캘린더) = 동일 톤 정리(rounded input, violet 캘린더 버튼 유지). 기존 동작·파라미터 유지.

### 3-3. 채널통합조회 테이블
- `rounded-2xl` 컨테이너 + border. sticky thead(`bg-slate-50`). hover row.
- 채널 = 색 chip(SMS slate / LMS·MMS violet / 알림톡 emerald / 카카오 yellow). 유형 = badge(수동/AI). 상태 = pill(완료 emerald / 발송중 amber / 예약 blue / 실패 rose).
- 성공/실패/대기 = 색 숫자. 성공률 = 미니 프로그레스바 + %.
- "상세" 버튼 → 캠페인 상세 모달.
- 모바일: md 미만 카드형 행(주요 필드 스택), md 이상 table.

### 3-4. 캠페인 상세 — `CampaignDetailModal.tsx` 분리 (파일 비대 해소)
- 신규 컴포넌트 `packages/frontend/src/components/CampaignDetailModal.tsx`. ResultsModal에서 `selectedCampaign` / `campaignDetail` / `alimtalkTemplateInfo` + 콜백(onClose, onShowMessages, onExport)을 props로 전달.
- 헤더: 캠페인명 + 채널 chip + 상태 badge + 발송일시.
- 상단 요약: 성공률 / 클릭률 + 전송·성공·실패·대기 compact 카드(기존 `charts.successFail` 활용).
- 2열(md): 좌 = 폰 미리보기(기존 유지 + 카드 모던화), 우 = 캠페인 정보(key-value 클린) + 통신사별 분포(모던 바) + 실패사유 분포(모던 바). 차트 하단 Source caption(`text-[10px] text-slate-400 italic`).
- **알림톡 전용 카드**(`send_channel === 'alimtalk'`): emerald 액센트 카드 — 템플릿명(굵게) + 템플릿코드(mono) + **검수상태 badge**(승인 emerald / 검수중 amber / 반려 rose).
- 발송 내역 보기 버튼(모던) → 기존 발송내역 팝업(동일 톤 정리).

### 3-5. 알림톡 검수상태 데이터 (backend 소폭)
- `alimtalkTemplateInfo`에 `status` 필드 추가. 출처 = `kakao_templates`의 검수상태 컬럼. messages endpoint(`routes/results.ts`)가 이미 code/name를 JOIN으로 가져오므로 거기에 status 추가.
- ★ **구현 시 db_column_verify 의무**: `information_schema`로 `kakao_templates`의 status 컬럼명 + JOIN 키(`kakao_template_id` 등) 검증 후 SQL 작성. (D143 기준 status는 대문자 풀네임 — `APPROVED`/`REQUESTED`/`REJECTED` 등 8개 CHECK. 실제 값 grep/검증 후 badge 매핑 확정.)
- status → badge: 승인계열 emerald / 검수중·요청계열 amber / 반려계열 rose / 기타 slate.

### 3-6. 테스트 발송 탭
- 동일 흰 톤 카드/테이블로 정리(구조·데이터 유지).

## 4. 규칙 준수 (자가검증 체크)
- native dialog 0건(ConfirmModal/useToast). 모델명(Opus/Sonnet/GPT/Claude) 노출 0건. 모바일 반응형(`flex-wrap` + `md:`/grid 분기). 차트·카드 Source caption. 인라인 헬퍼 정의 금지(`formatDate.ts` 등 컨트롤타워 활용). 박-단어/옛/정합/매트릭스 0건.
- 흰 톤이라 design_quality_minimum_journey_level 룰의 다크 요소(bg-slate-950 등)는 **흰-대시보드 맥락으로 적응** — 모던 카드 + 그라데이션 아이콘 칩 + 정보위계 + 반응형 + Source caption + ConfirmModal/useToast는 유지.

## 5. 구현 task (다음 세션 — writing-plans로 분해)
1. **backend**: `routes/results.ts` `:id/messages`의 `alimtalkTemplateInfo`에 status 추가 (information_schema 검증 먼저 → Harold 실행 → 코드).
2. **frontend**: `CampaignDetailModal.tsx` 분리 + 상세 전면 재설계(알림톡 전용 카드 포함).
3. **frontend**: ResultsModal 요약 탭 — 메트릭 5 카드 + 채널통합조회 테이블 재설계 + 필터 바 정리.
4. **frontend**: 테스트 발송 탭 톤 정리.
5. **검증**: backend tsc 0 + frontend tsc 0 + 자가 grep(박-단어/모델명/native dialog 0) + 배포 후 실데이터 화면 확인(Harold/직원).
6. **codex**: `/codex:review` (UI 신설/재작성 — 5분+ 작업).

## 6. 범위 밖 / 후속
- endpoint 신규·구조 변경 X(messages에 status 추가만). 집계 로직 X.
- **발송결과 속도 H1~H6**(별도 — `docs/superpowers/specs/2026-05-30-result-cache-design.md` 후속, getCampaignResultCounts CT 확산). 본 작업과 무관, 병행 X(no_parallel — 하나씩).
- **event-admin SPA 토큰 만료 UX**(별 시스템 invitobiz — `memory/reference_event_admin_invitobiz_cert_token.md`).

## 7. 다음 세션 진입 절차
1. 본 spec 정독 + `status/lessons/LESSONS_FRONTEND.md` 정독.
2. db_column_verify: `kakao_templates` status 컬럼 + JOIN 키 information_schema 검증 SQL을 Harold님께 제공 → 결과 확인.
3. `superpowers:writing-plans`로 구현 계획 작성 → task 1~6 순차 구현.
