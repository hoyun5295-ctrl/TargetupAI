# LESSONS_LEARNED — 인덱스 (도메인 분할 라우팅)

> **⚠️ D215+ 도메인 분할 (2026-05-24)**: 옛 342줄 단일 파일이 비대해져 LLM 컨텍스트 효율 저하. 도메인별 6 파일로 분할.
> **이 파일은 인덱스만**입니다. 실제 사고 이력은 도메인별 LESSONS 파일을 우선 정독하십시오.

---

## 작업 도메인별 우선 정독 라우팅

| 작업 도메인 | 우선 정독 파일 | 핵심 |
|---|---|---|
| **컨트롤타워 / 도메인 흐름 / 작업 진입** | [`lessons/LESSONS_ARCHITECTURE.md`](lessons/LESSONS_ARCHITECTURE.md) | CT 매트릭스 (CT-01~76) + 발송 5경로 + FIELD_MAP + 멀티테넌트 격리 + 작업 진입 자기 점검 |
| **DB / SCHEMA / 돈 / 환불 / 마이그레이션** | [`lessons/LESSONS_DB.md`](lessons/LESSONS_DB.md) | D134 SCHEMA 추측 / D162 42P08 / D182 환불 30분 / D184 ALTER / D214+ customer-upsert GREATEST + active_sources 안전망 |
| **Frontend / UI / 모달 / 모바일 / 모델명 노출** | [`lessons/LESSONS_FRONTEND.md`](lessons/LESSONS_FRONTEND.md) | D186 모바일 @media / D185 대량 업로드 안내 / D211+ native dialog 폐기 / **D214+ Opus 4.7 UI 노출 반복** |
| **Backend / API / Query / 발송 / AI 호출** | [`lessons/LESSONS_BACKEND.md`](lessons/LESSONS_BACKEND.md) | D188 위반 단어 117건 / D152 AI 다듬기 4 사고 / D150 falsy / D110 하드코딩 / 모델 분리 룰 / AI 임의 혜택 금지 |
| **Deploy / SSH / 빌드 / 의존성** | [`lessons/LESSONS_DEPLOY.md`](lessons/LESSONS_DEPLOY.md) | D145 tp-deploy-full (9시간 사고) / D93 SSH 차단 / D151-6 devDependencies / D184-fix vite 의존성 / 표준 출력 형식 |
| **AI 답변 패턴 위반 (매 답변 직전 정독 의무)** | [`lessons/LESSONS_META.md`](lessons/LESSONS_META.md) | 4-1~4-22 옛 위반 패턴 + **신규 4-23 Opus 4.7 UI 노출 반복** + **4-24 박-단어 자기 강화 루프** + **4-25 DB ALTER 안전망 부재** |

---

## 핵심 영구 룰 (전 도메인 공통)

- **CLAUDE.md `MANDATORY_CHECKLIST`** — 코드 수정/검증 명령어 안내 직전 매 턴 출력 의무
- **`feedback_no_bakkeum_usage`** — 박-단어 + 활용형 변형 자가 grep 0건 의무
- **`feedback_ai_operator_model_isolation`** — 모델명 UI 노출 절대 금지 (Frontend grep 0건)
- **`feedback_no_native_browser_dialog`** — alert/confirm/prompt 0건 (ConfirmModal + useToast)
- **`feedback_no_target_auto_relax`** — 0건 타겟 자동완화 X
- **`feedback_ai_no_arbitrary_benefit`** — AI 임의 혜택 (%/원/쿠폰) 0건
- **`feedback_no_preview_verification`** — Claude_Preview MCP 도구 절대 사용 X
- **`feedback_push_and_deploy_commands`** — 표준 출력 형식 + 절대 경로 의무

---

## 최근 Critical 사고 매트릭스 (D211+ ~ D214+)

| 사고 | 도메인 | 상세 파일 |
|---|---|---|
| D214+ Opus 4.7 UI 노출 4건 (CdpSettingsPage 반복) | Frontend + Meta | LESSONS_FRONTEND.md + LESSONS_META.md (4-23) |
| D214+ customer-upsert.ts COALESCE 사고 (RFM GREATEST 강제) | DB | LESSONS_DB.md |
| D214+ active_sources 컬럼 X 에러 (DB ALTER 안전망) | DB + Meta | LESSONS_DB.md + LESSONS_META.md (4-25) |
| D214+ 박-단어 + 영역/본질 단어 자기 강화 루프 | Meta | LESSONS_META.md (4-24) |
| D213+ buildPerformanceSnapshotV2 (D144 정합 — MySQL 큐 직접 집계) | Backend | LESSONS_BACKEND.md |
| D212+ native dialog 영구 폐기 + ConfirmModal/Toast generic | Frontend | LESSONS_FRONTEND.md |
| D188-Phase2B 자동발송 영구 폐기 + 위반 단어 117건 | Backend | LESSONS_BACKEND.md |
| D188 영업팀장 알림톡 14건 (CSS pointer-events 사고) | Frontend + Backend | LESSONS_FRONTEND.md + LESSONS_BACKEND.md |

---

## 작업 진입 표준 흐름 (D215+ 정합)

1. `CLAUDE.md` 정독 — `<MANDATORY_CHECKLIST>` + `<STANDARD_RESPONSES>`
2. **작업 도메인 식별** → 위 라우팅 표 따라 **해당 LESSONS 파일 우선 정독**
3. `LESSONS_META.md` 정독 (매 답변 직전 — 답변 패턴 위반 차단)
4. `status/STATUS.md` CURRENT_TASK 확인
5. DB 관련이면 `status/SCHEMA.md` 정독
6. 수정 대상 파일 현재 코드 read
7. Harold 컨펌 받기 → 구현
