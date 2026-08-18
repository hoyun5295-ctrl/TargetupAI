/**
 * ★ CT: `campaigns.send_type` 축의 단일 정의 (순수 파일 — 2026-07-31 신설)
 *
 * 신설 이유 = 이 컬럼을 읽는 곳들이 "`'direct'`냐 아니냐" 이분법을 각자 적어 두고 있었다.
 * 그래서 자동발송(`'auto'`)과 여정이 전부 **AI**로 뭉개졌다:
 *   · 발송결과 유형 필터(`routes/results.ts`)가 `send_type <> 'direct'`를 AI로 취급
 *   · 학습 통지 라벨(`utils/mysql-refund-sweeper.ts`)이 `direct` 아니면 'AI추천'
 *   · 화면 6곳이 같은 삼항식 복제 (`frontend/src/utils/campaign-axis.ts`로 통합)
 * 반대로 `routes/admin.ts`만 3분기로 제대로 돼 있었다 — 나머지가 틀린 쪽이었다.
 *
 * 값을 쓰는 곳(INSERT)도 이 파일이 기준이다:
 *   direct   = `POST /direct-send`·`/direct-send/commit`·`/brand-send`
 *   ai       = `POST /campaigns`(타겟 조건 캠페인) — 컬럼 DEFAULT도 'ai'다
 *   auto     = `utils/auto-campaign-worker.ts`
 *   journey  = `utils/journey-step-campaign.ts`
 *   operator = AI 오퍼레이터 제안 승인 발송(`pages/AiOperatorPage` → `POST /direct-send`)
 *
 * ★ 2026-08-18 `operator` 신설 (Harold 접수 "AI 오퍼레이터로 보냈는데 직접발송으로 뜬다").
 *   원인 = 오퍼레이터 화면이 `POST /direct-send`를 부르는데 그 INSERT가 `send_type`을 리터럴 `'direct'`로
 *   박고 캠페인명도 서버가 `직접발송 {일시}`로 조립했다(`routes/campaigns.ts` /direct-send INSERT).
 *
 *   **왜 `'ai'`를 재사용하지 않는가** — `'ai'`는 `campaign_runs` 행을 갖는 타겟 조건 캠페인의 값이고,
 *   결과 동기화·환불이 그 runs를 순회하는 분기(`campaign-lifecycle` 1번)가 처리한다.
 *   오퍼레이터 발송은 runs가 없어 그 분기에 안 걸리고, 2번 분기를 `'ai'`까지 넓히면 기존 AI 캠페인이
 *   **양쪽에서 처리돼 이중 환불**이 된다. 그래서 겹치지 않는 새 값을 쓴다.
 *
 * ⚠ `campaigns.send_type`에는 CHECK 제약이 없다(2026-07-31 `pg_constraint` 실측 —
 *   campaigns의 CHECK는 `message_type`·`status` 2건뿐). 값을 늘려도 INSERT는 깨지지 않지만,
 *   **여기 등재하지 않으면 그 발송이 화면에서 조용히 원값으로 노출된다.** 새 경로를 만들면 여기 먼저 추가한다.
 *
 * 순수 데이터라 DB import 0으로 둔다 — 무거운 모듈 안에 두면 그걸 쓰려는 쪽이
 * 의존을 끌어오기 싫어 다시 리터럴을 복제한다(`billing-types.ts`와 같은 이유).
 */

export const SEND_TYPES = ['direct', 'ai', 'auto', 'journey', 'operator'] as const;
export type SendType = (typeof SEND_TYPES)[number];

/** 표시명 — 화면 CT(`frontend/src/utils/campaign-axis.ts` `SEND_TYPE_LABEL`)와 같은 값이어야 한다. */
export const SEND_TYPE_LABEL: Record<string, string> = {
  direct: '직접발송',
  ai: 'AI 추천',
  auto: '자동발송',
  journey: '여정',
  operator: 'AI 오퍼레이터',
};

/**
 * **직접발송 배관을 탄 캠페인의 send_type 집합** — `POST /direct-send`가 만드는 행들.
 *
 * 이 집합이 왜 CT에 있어야 하는가: 결과 동기화·환불·사용량 집계 3곳이 각자
 * `send_type = 'direct'`를 적어 두고 있었다. `operator`가 늘어난 순간 그 3곳을 같이 고치지 않으면
 * 오퍼레이터 발송이 **결과 집계도 환불도 청구도 안 되는 유령**이 된다(돈에 닿는다).
 * 값은 여기 한 곳이 소유하고 쿼리는 이름만 부른다.
 *
 * ⛔ 여기에 `'ai'`를 넣지 마라 — 그쪽은 `campaign_runs` 분기가 이미 처리한다(위 주석 참조).
 */
export const DIRECT_PIPELINE_SEND_TYPES = ['direct', 'operator'] as const;
export type DirectPipelineSendType = (typeof DIRECT_PIPELINE_SEND_TYPES)[number];

/** 위 집합의 SQL 리터럴 — `send_type IN (...)` 자리에 그대로 넣는다(파라미터 번호를 늘리지 않는다). */
export const DIRECT_PIPELINE_SEND_TYPES_SQL = DIRECT_PIPELINE_SEND_TYPES.map((v) => `'${v}'`).join(', ');

/**
 * **이 배관이 만들어도 되는 값인가** — 직접발송 INSERT의 출처 게이트.
 *
 * ★ 2026-08-18 (Codex 적대 검토 high #1): 처음엔 `isSendTypeFilter`를 이 자리에 썼는데 그건
 *   **화면 필터가 아는 값인가**를 묻는 함수다. 두 물음은 다르다 —
 *   `ai`·`auto`·`journey`는 화면 필터에는 있지만 각자 다른 배관(`campaign_runs`·워커·여정 실행기)이
 *   만드는 값이다. 필터 함수를 재사용한 탓에 호출자가 `sendType: 'journey'`를 실으면
 *   `/direct-send`가 그대로 적재했고, 그 행은 `campaign_runs`가 없어 run 축에도 안 잡히고
 *   청구 선택기(direct·operator만)에도 안 걸려 **실발송이 청구에서 사라질 수 있었다**.
 *
 * 물음이 다르면 함수도 달라야 한다. 새 배관이 생기면 그 배관의 집합을 따로 만든다.
 */
export function isDirectPipelineSendType(v: any): v is DirectPipelineSendType {
  return typeof v === 'string' && (DIRECT_PIPELINE_SEND_TYPES as readonly string[]).includes(v);
}

/** 모르는 값은 지어내지 않고 그대로 — 새 경로가 조용히 'AI'로 뭉개지지 않게 한다. */
export function sendTypeLabel(sendType: any): string {
  const v = String(sendType ?? '').trim();
  return SEND_TYPE_LABEL[v] || v || '직접발송';
}

/** 화면 유형 필터가 보내는 값인가 (`'all'`·빈값 = 무필터라 여기 해당하지 않는다) */
export function isSendTypeFilter(v: any): v is SendType {
  return typeof v === 'string' && (SEND_TYPES as readonly string[]).includes(v);
}
