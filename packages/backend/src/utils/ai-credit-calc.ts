/**
 * utils/ai-credit-calc.ts — AI 크레딧 차감 순수 계산 (DB/IO 의존 0)
 *
 * 종량제 토대 (D227+ 2026-05-31). CT인 ai-credit.ts가 import해서 사용한다.
 * 여기에는 DB·시간 부수효과를 두지 않는다 — 모든 함수는 입력만으로 결과가 정해진다.
 * 그래서 node:assert + ts-node 로 단위 검증할 수 있다 (테스트 러너 미설치 프로젝트 대응).
 */

/** KST(UTC+9) 기준 연*12+월 절대값. 월 비교 전용 (0-indexed month). */
export function kstYearMonth(d: Date): number {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCFullYear() * 12 + kst.getUTCMonth();
}

/** KST 기준 'YYYYMM' 태그. 월 리셋 idempotency key 용도. */
export function kstMonthTag(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

/** KST 기준 'YYYYMMDD' 태그. 일 단위 idempotency key 용도(예: 예측 매일 1회 차감). */
export function kstDateTag(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** KST 기준 시(0~23). cron worker 시간대 판별용. */
export function kstHour(d: Date): number {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
}

/**
 * 월 리셋 필요 판단.
 *  - resetAt 없음(최초 가입/미설정) → true
 *  - resetAt의 KST 월 < now의 KST 월 → true
 */
export function needsMonthlyReset(resetAt: Date | null, now: Date): boolean {
  if (!resetAt) return true;
  return kstYearMonth(resetAt) < kstYearMonth(now);
}

/**
 * 2버킷 분배 — base(월 기본분) 먼저, 부족분을 purchased(구매분)에서.
 * 그래도 모자라면 shortfall(부족분)으로 반환 (호출측이 차단/충전 처리).
 * 음수·소수 입력은 0 이상 정수로 방어 보정한다.
 */
export function splitDeduction(
  base: number,
  purchased: number,
  cost: number
): { fromBase: number; fromPurchased: number; shortfall: number } {
  const b = Math.max(0, Math.floor(base || 0));
  const p = Math.max(0, Math.floor(purchased || 0));
  const c = Math.max(0, Math.floor(cost || 0));
  const fromBase = Math.min(b, c);
  const afterBase = c - fromBase;
  const fromPurchased = Math.min(p, afterBase);
  const shortfall = afterBase - fromPurchased;
  return { fromBase, fromPurchased, shortfall };
}

/**
 * idempotency key — 같은 AI 호출의 재시도가 중복 차감되지 않도록 한다.
 *  - aiCallLogId 있으면 `${source}:${aiCallLogId}` (최대 150자)
 *  - 없으면 null (중복 차단 미적용 — 호출측이 별도 key를 부여할 수 있음)
 */
export function buildIdempotencyKey(source: string, aiCallLogId?: string | null): string | null {
  if (!aiCallLogId) return null;
  return `${source}:${aiCallLogId}`.slice(0, 150);
}

/**
 * 작업 source → 크레딧 비용 (가치 기반 재설계 — 2026-06-01, 1크레딧 = 500원).
 *  - 풀분석 300 / 여정 생성 3·저장 150 / 자동마케팅 저장 200·발송 3 / DM 생성 3·발행 30 / 인앱 생성 3·게시 15 / 문안·분석 5 / 다듬기·질문·매핑 1.
 *  - orchestrate·continuous-operator는 진입점 1회만 차감, 내부 sub 호출은 호출측이 creditCost:0 명시(묶음 회피).
 *  - 미등록 source는 getCreditCost가 0 반환(차감 안 함) — 신규 작업 추가 시 여기 등록 의무.
 *  - frontend constants/credit.ts CREDIT_TASK_COSTS와 1:1 일치 유지 (한쪽만 바꾸지 말 것).
 */
export const CREDIT_COST_MAP: Record<string, number> = {
  // 풀분석 (300) — 기간 성과 리포트(매출·ROI·채널 종합 분석 + PDF). orchestrate source가 그 자리.
  'orchestrate': 300,
  'orchestrateWithAI': 300,
  // AI Operator 한줄 입력 (타겟추출+문안 일회성 제안) = 문안·분석 5. 풀분석과 분리.
  'ai-operator-propose': 5,
  // 여정 생성(돌려보기) 3 — 자연어→여정 패키지 생성. 호출(돌려보기)마다 3. 저장은 'journey-activate' 150 별도.
  'journey-ai-generate': 3,
  'journey-builder-custom': 3,
  // 여정 설계 저장(활성화) 150 — draft→active 최초 1회만 차감(멱등키=journeyId). paused→active 재개는 0.
  'journey-activate': 150,
  // 자동 마케팅 저장(활성화) 200 — operator 최초 생성·활성화 1회(멱등키 operatorId). 여정 activate(150) 대응. 매일 제안서 생성(orchestrate)은 0(묶음).
  'continuous-operator': 200,
  // 자동 마케팅 발송 문안 3 — 제안서 발송 확정(수동 승인/자동 실행) 시 문안 1건당. 멱등키 proposalId. 스팸 재생성은 묶음 0.
  'continuous-operator-send': 3,
  // 예측 자동 분석 (3) — 연동 회사(싱크에이전트/SDK) 매일 1회 예측 점수 갱신. 회사+날짜 멱등.
  'predictive-daily': 3,
  // 모바일 DM 생성(돌려보기) 3 — 자연어→sections 생성. 호출(돌려보기)마다 3. 발행은 'dm-builder' 30 별도.
  'dm-ai-generate': 3,
  // 모바일 DM 발행(확정) 30 — 단축URL 발행 최초 1회만(멱등키=dm-publish:dmId). test-send 자동발행은 미과금.
  'dm-builder': 30,
  // 인앱 생성(돌려보기) 3 — 자연어→완성 메시지. 호출마다 3. 게시는 'inapp-publish' 15 별도.
  'inapp-ai-generator': 3,
  // Email 생성(돌려보기) 3 — 자연어/시나리오→제목3안+본문 HTML. 호출마다 3. AI 캠페인 발송 확정은 'email-ai-publish' 30 별도.
  'email-ai-generate': 3,
  // Email AI 캠페인 발송 확정(ai_generated) 30 — 최초 발송 1회만(멱등키 email-ai-publish:campaignId). 수동 작성 캠페인 발송은 0.
  'email-ai-publish': 30,
  // 인앱 게시(확정) 15 — status=active 저장 최초 1회만(멱등키=inapp-publish:messageId).
  'inapp-publish': 15,
  // 문안 생성·분석·추천 (5)
  'generate-messages': 5,
  'generate-custom-messages': 5,
  'recommend-target': 5,
  'recommend-next-campaign': 5,
  'variant-generator': 5,
  'performance-explainer': 5,
  'performance-quick-action': 5,
  'next-action-advisor': 5,
  'multi-goal-decisioning': 5,
  'cdp-fusion-explainer': 5,
  'voice-inbound': 5,
  'dm-event-recommender': 5,
  // Email 발송 후 성과 진단 5 — 실측 오픈/클릭 기반 topInsight + 개선 제안. 이벤트 0건 시 호출 차단(차감 0).
  'email-performance-insight': 5,
  // Email 발송 시간 추천 5 — 자사 오픈 실측 분포. 표본 30건 미만 = insufficient_data(차감 0).
  'email-send-time-recommend': 5,
  // 다듬기·진단·질문·매핑 (1) — 스팸필터는 크레딧 비대상(현금/후불 청구)
  'refine-direct': 1,
  'journey-ai-refine': 1,
  'journey-step-diagnosis': 1,
  // Email 다듬기 1 — 제목·본문 부분 수정. 호출마다 1.
  'email-refine': 1,
  // Email 발송 전 진단 1 — 스팸 위험 분석(AI). 광고 표기 등 기계 체크는 코드(0크레딧).
  'email-precheck': 1,
  'dm-quick-action-refine': 1,
  'dm-self-diagnosis': 1,
  'inapp-explainer': 1,
  'inapp-quick-action': 1,
  'alimtalk-matcher': 1,
  'ai-memory-search': 1,
  'ai-usage-search': 1,
  'ai-segment-generator': 1,
  'ai-column-mapper': 1,
  'brand-voice-extract': 1,
  'parse-briefing': 1,
};

/** source → 크레딧 비용. 미등록·미전달 source는 0 (차감 안 함). */
export function getCreditCost(source: string | undefined | null): number {
  if (!source) return 0;
  return CREDIT_COST_MAP[source] ?? 0;
}

// ── 크레딧 충전 단가 (D229+ 종량제 — Harold 확정) ─────────────────
/** 1 크레딧당 단가(VAT 별도). 가치 기반 재설계 — 다듬기 1크레딧 = 500원 기준. 화면 단가 노출 금지. */
export const CREDIT_UNIT_PRICE = 500;
export const CREDIT_VAT_RATE = 0.1;

/** 충전 크레딧 수량 → 결제 금액(공급가/부가세/합계). 보너스 없음. */
export function calcRechargeAmount(credits: number): { credits: number; supply: number; vat: number; total: number } {
  const c = Math.max(0, Math.floor(Number(credits) || 0));
  const supply = c * CREDIT_UNIT_PRICE;
  const vat = Math.round(supply * CREDIT_VAT_RATE);
  return { credits: c, supply, vat, total: supply + vat };
}

/** 이번달 사용량 = type 'deduct' 행의 amount 합 (순수). reset/grant/admin_deduct는 제외. */
export function sumDeductRows(rows: Array<{ type: string; amount: number | string }>): number {
  return rows.reduce((sum, r) => sum + (r.type === 'deduct' ? (Number(r.amount) || 0) : 0), 0);
}
