# AI 모델 최신화 · 프롬프트 품질 점검 (2026-09-30~)

> 이 문서가 소유하는 것 = 한줄로 AI 호출의 **모델 전환 기록**과 **프롬프트 전수 점검 장부**(진행표 · 자리별 판정 · 처방).
> 모델 값의 코드 진실 = `packages/backend/src/config/defaults.ts`(`AI_MODELS` · `claudeRequestShape`). 여기에 값을 복사하지 않는다.

## 1) Harold 결정 (0930)

- **옛 모델을 기본값으로 쓰는 곳 0 · 전부 최신 모델 · 퀄리티를 끌어올린다.**
- 안 B: 문안(대량) = Sonnet 5.5 · 정밀(검수 · 타겟 · AI Operator) = Opus 5.5 — 07-01 분리 결정 유지(그때 Sonnet 5 가 "무료거부 문구가 있는데 누락으로 잡는" 검수 오판을 내 Opus 로 올렸다).
- 순서: 모델 전환 → 새 모델 기준 프롬프트 점검(옛 모델 기준으로 먼저 다듬으면 두 번 본다).

## 2) 모델 전환

### 2-1. 운영 키 실측 (0930 · Harold 서버 · API 원문)

| 모델 | temperature | 생각 끄기 | 생각 켜기 | 조합 |
|---|---|---|---|---|
| Sonnet 5.5 | 400 `deprecated` | `disabled` 400 → `between_tools` OK(생각 0) | `adaptive` OK | 시스템 캐시 + 이미지 OK |
| Opus 5.5 | 400(적응형에선 1만) | 끌 수 없음(`disabled` 400) → `adaptive` + `output_config.effort: low` OK(생각 35) | `adaptive` OK(`high` 생각 93) | 시스템 캐시 + 도구 2회 루프 OK · 인용 OK |

- 전환 전 운영 = 코드 기본값(서버 .env · pm2 설정에 모델 키 없음 · Gemini 이미지만). 문안 `claude-sonnet-5` · 정밀 `claude-opus-4-8`.
- **.env 만 바꿨다면** 두 모델 모두 "생각 끄기"가 400 → 모든 호출이 실패하고 조용히 GPT 대체(`services/ai.ts` catch)로 넘어갔다.
- Opus 5.5 는 시스템 지시 없는 짧은 요청에 굵은 글씨 · "다른 표현" 목록을 덧붙였다 → 프롬프트 점검 기준 ⑤(출력 형식 통제).

### 2-2. 코드 (0930)

- 요청 형태 CT `claudeRequestShape`(모델 계열 판정 = 허용 목록 · 모르는 모델 = adaptive · temperature 없음) · `resolveMaxTokens`(Opus 5.5 · 모르는 모델 = 생각 토큰 몫). 옛 두 갈래 `isAdaptiveOnlyModel` 폐기.
- 직접 호출 10곳 전부 CT 경유: `services/ai.ts`(공통 CT · 다듬기) · `services/ai-orchestrator.ts` · `routes/analysis.ts` · `routes/upload.ts` · `utils/agency-send-refine.ts` · `utils/ai-mapping.ts` · `utils/batch-ai.ts` · `utils/citations.ts` · `utils/help-answer.ts`.
- 기본값: 문안 `claude-sonnet-5-5` · 정밀 `claude-opus-5-5` · 싱크 매핑 대체 = 정밀 모델(옛 Sonnet 4.5 고정값 폐기).
- 불변식 테스트: 직접 호출 파일 = CT 동반 · 옛 판정 · 손으로 적은 끄기 형태 재유입 금지(`ai-call-invariants.test.ts`) · 실측 형태 고정(`claude-request-shape-0930.test.ts`).
- **되돌리기(배포 불요)**: 서버 `packages/backend/.env` 에 `CLAUDE_MODEL=claude-sonnet-5` · `CLAUDE_OPUS_MODEL=claude-opus-4-8` 두 줄 → `pm2 restart targetup-backend --update-env`. CT 가 옛 모델 형태도 그대로 안다.

### 2-2-B. GPT 대체도 최신 (0930 Harold "GPT6-Luna")

- 운영 OpenAI 키 모델 목록(0930): `gpt-5.6-luna` · `gpt-6-astra` · `gpt-6-luna` · `gpt-6-sol` · `gpt-6.1-sol`. 다섯 모두 기본 · JSON 응답 모드 OK · temperature 0.3 = 400("기본 1만").
- 기본값: 문안 흐름 · AI Operator GPT 대체 둘 다 `gpt-6-luna`(옛 `gpt-5.5`).
- temperature 판정 CT `gptRequestShape`(옛 gpt-3.5 · gpt-4 계열만 싣는다 · 모르는 모델 = 안 보냄). 옛 코드는 "두 GPT 변수 값이 같은가"로 우연히 안 보내고 있었다(값이 갈리면 문안 흐름만 400).
- 로그 · 상태 문구의 옛 모델명(`gpt-5.1`) 정리. 되돌리기 = .env `GPT_MODEL` · `GPT_OPERATOR_MODEL`.

### 2-3. 배포 뒤 확인

- pm2 로그: 실제 응답 모델(`Claude 호출 성공 · <모델>`) 분포 · GPT 대체(`Claude 실패`) 건수 — 전환 전과 비교.
- 배치 API(비동기 결과) · PDF 입력은 사전 실측 밖 → 첫 사용 로그로 확인.

### 2-4. 범위 밖(기록)

- `targetup-ai/`(옛 MVP 파이썬 · 기본 `claude-sonnet-4-20250514`) — 저장소 pm2 설정에 없음(운영 경로 아님 · 서버 별도 실행 여부 미검증). 정리 여부 = Harold.
- Gemini 이미지 `gemini-3-pro-image` — Claude · GPT 밖. 최신 값 미검증.

## 3) 프롬프트 전수 점검

### 3-1. 방식

- 에이전트 · 워크플로 없이 직접 읽는다(메모리 `feedback_no_agents_for_audit_direct_inspection`). 진행은 이 장부 3-4 표에 남긴다.
- 이전 소스 점검(`2026-09-25-hanjul-source-audit.md`)에서 닫은 AI 항목(혜택 차단기 · 날씨 지시문 · 진단 수치 등)은 다시 보지 않는다.
- 묶음마다 자리별 판정표 → Harold 동의 → 수정 → 서버 샘플 비교(운영 검증 = Harold).

### 3-2. 판정 기준 (새 모델 기준)

1. **temperature 의존** — 새 모델은 temperature 를 받지 않는다(0930 실측). "0 = 매번 같게" · "0.7 = 다양하게" 기대는 프롬프트 지시 + 서버 검증으로 옮긴다(A/B/C 서로 다르게 등).
2. **출력 계약** — JSON 추출 CT(`utils/ai-json.ts`)가 있는데 파일마다 복사본 10개(0930 grep) → CT 하나로. 규약 밖 응답 처리 · 재요청.
3. **규칙 중복** — 광고 표기 · 080 · 혜택 금지 · 바이트 한도 문장이 프롬프트마다 따로 → 공통 블록 CT.
4. **서버 경계** — 프롬프트 지시로만 막는 규칙이 서버 검사로도 막히는가(프롬프트는 경계가 아니다).
5. **출력 형식 통제** — 굵은 글씨 · 덧붙인 대안 · 머리말 없이 계약 모양만(Opus 5.5 실측).
6. **옛 모델 전제** — 한도 · 문장 · 주석이 옛 모델을 가정하는가.
7. **문안 품질** — 자연 한국어 · AI 티 표면 신호 · 줄표 금지 · 모델명 0 · 브랜드 보이스 · 회사 기억 · 데이터 프로필 주입의 일관성.

### 3-3. 대상 (0930 grep · 약 77 호출 · 45 파일)

공통 CT(`callAIWithFallback`) 경유 약 70곳 + 직접 호출 7개 파일. 묶음 순서 = 고객에게 나가는 양:
1. 문안 생성 — 기본 · 맞춤 · 다듬기(`services/ai.ts`) · 이메일(`email-ai.ts`) · DM(`dm/*`) · 인앱 · SNS · 변형 · 여정 생성/수정
2. 정밀 — 검수 · 타겟 · 브리핑 해석 · 오케스트레이터
3. 설명 · 추천 — 성과 설명 · 다음 수 · 브리핑 · 진단
4. 추출 · 매핑 — 사업자등록증 · 이미지 추출 · 컬럼 매핑 · 알림톡 매칭 · 맞춤법

### 3-4. 진행표

| 묶음 | 상태 | 판정표 | 처방 |
|---|---|---|---|
| 1 문안 생성 | 대기(모델 전환 배포 뒤 착수) | | |
| 2 정밀 | 대기 | | |
| 3 설명 · 추천 | 대기 | | |
| 4 추출 · 매핑 | 대기 | | |
