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
 *   direct  = `POST /direct-send`·`/direct-send/commit`·`/brand-send`
 *   ai      = `POST /campaigns`(타겟 조건 캠페인) — 컬럼 DEFAULT도 'ai'다
 *   auto    = `utils/auto-campaign-worker.ts`
 *   journey = `utils/journey-step-campaign.ts`
 *
 * ⚠ `campaigns.send_type`에는 CHECK 제약이 없다(2026-07-31 `pg_constraint` 실측 —
 *   campaigns의 CHECK는 `message_type`·`status` 2건뿐). 값을 늘려도 INSERT는 깨지지 않지만,
 *   **여기 등재하지 않으면 그 발송이 화면에서 조용히 원값으로 노출된다.** 새 경로를 만들면 여기 먼저 추가한다.
 *
 * 순수 데이터라 DB import 0으로 둔다 — 무거운 모듈 안에 두면 그걸 쓰려는 쪽이
 * 의존을 끌어오기 싫어 다시 리터럴을 복제한다(`billing-types.ts`와 같은 이유).
 */

export const SEND_TYPES = ['direct', 'ai', 'auto', 'journey'] as const;
export type SendType = (typeof SEND_TYPES)[number];

/** 표시명 — 화면 CT(`frontend/src/utils/campaign-axis.ts` `SEND_TYPE_LABEL`)와 같은 값이어야 한다. */
export const SEND_TYPE_LABEL: Record<string, string> = {
  direct: '직접발송',
  ai: 'AI 추천',
  auto: '자동발송',
  journey: '여정',
};

/** 모르는 값은 지어내지 않고 그대로 — 새 경로가 조용히 'AI'로 뭉개지지 않게 한다. */
export function sendTypeLabel(sendType: any): string {
  const v = String(sendType ?? '').trim();
  return SEND_TYPE_LABEL[v] || v || '직접발송';
}

/** 화면 유형 필터가 보내는 값인가 (`'all'`·빈값 = 무필터라 여기 해당하지 않는다) */
export function isSendTypeFilter(v: any): v is SendType {
  return typeof v === 'string' && (SEND_TYPES as readonly string[]).includes(v);
}
