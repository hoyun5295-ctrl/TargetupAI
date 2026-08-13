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
 *  - 풀분석 300 / 여정 생성 3·저장 150 / 자동마케팅 저장 200·발송 3 / DM 생성 5·발행 30 / 인앱 생성 3·게시 15 / 문안·분석 5 / 다듬기·질문·매핑 1.
 *  - orchestrate·continuous-operator는 진입점 1회만 차감, 내부 sub 호출은 호출측이 creditCost:0 명시(묶음 회피).
 *  - 미등록 source는 getCreditCost가 0 반환(차감 안 함) — 신규 작업 추가 시 여기 등록 의무.
 *  - ★ 기준점 (Harold 명시 2026-07-02): 사용자 버튼 트리거 + 20크레딧 이상 = frontend CONFIRM_CREDIT_COSTS
 *    등록 + 트리거 지점 CreditConfirmModal 의무. 자동/백그라운드 차감은 설정 화면 안내로 고지.
 *  - frontend constants/credit.ts CREDIT_TASK_COSTS와 1:1 일치 유지 (한쪽만 바꾸지 말 것).
 */
export const CREDIT_COST_MAP: Record<string, number> = {
  // 풀분석 (300) — 기간 성과 리포트(매출·ROI·채널 종합 분석 + PDF). orchestrate source가 그 자리.
  'orchestrate': 300,
  'orchestrateWithAI': 300,
  // AI Operator 한줄 입력 (타겟추출+문안 일회성 제안) = 문안·분석 5. 풀분석과 분리.
  'ai-operator-propose': 5,
  // 꾸미기 3 — AI Operator 추천 메시지에 회사 데이터 컬럼(%변수%)을 녹여 재작성. 다듬기(1)보다 위(데이터 적용). operator-message-decorator 인라인 creditCost 제거 후 이 map이 진실.
  'ai-operator-decorate': 3,
  // 여정 생성(돌려보기) 3 — 자연어→여정 패키지 생성. 호출(돌려보기)마다 3. 저장은 'journey-activate' 150 별도.
  'journey-ai-generate': 3,
  'journey-builder-custom': 3,
  // 여정 설계 저장(활성화) 200 — draft→active 최초 1회만 차감(멱등키=journeyId). paused→active 재개는 0. 자동마케팅 활성화(200)와 통일.
  'journey-activate': 200,
  // 여정·자동마케팅 운영 과금 10 — 활성 여정이 발송하는 날 1회(멱등키=journey-operation:journeyId:YYYYMMDD). 동일 여정 하루 1회 상한. 음수 허용군(P4).
  'journey-operation': 10,
  // 자동 마케팅 저장(활성화) 200 — operator 최초 생성·활성화 1회(멱등키 operatorId). 여정 activate(150) 대응. 매일 제안서 생성(orchestrate)은 0(묶음).
  'continuous-operator': 200,
  // 자동 마케팅 발송 문안 3 — 제안서 발송 확정(수동 승인/자동 실행) 시 문안 1건당. 멱등키 proposalId. 스팸 재생성은 묶음 0.
  'continuous-operator-send': 10,
  // ★ 2026-07-02 (Harold 명시): 마케팅 캘린더 1년 설계 50 — 생성·재생성 매회 차감(Email 완성 50과 동급). 등록은 'continuous-operator' 200 별도.
  'marketing-calendar': 50,
  // ★ 2026-07-05: 캘린더 한 달만 다시 설계 10 — 12×10>50이라 부분 재생성으로 전체(50) 우회 불가. 성공 반환 시에만 차감.
  'marketing-calendar-month': 10,
  // ★ 2026-08-13 마케팅 플래너 월간 대행 1000 (Phase 2 — 설계서 §3-1) — AI 호출 원가가 아니라 **대행 가치**다
  //   (한 달치 마케팅 스케줄링·제작·발송 대행). 월간 승인 시 1회, 멱등키 = planner:{회사}:{YYYY-MM}.
  //   제작물 크레딧(이메일 완성·DM 발행·인앱 게시)은 각 제작 시점에 기존 단가로 별도 차감된다 — 축을 섞지 않는다.
  //   ⛔ OPERATION_SOURCES에 넣지 않는다: 마이너스 허용 금지가 이 축의 확정 정책이다(설계서 §3-4).
  'planner-monthly-agency': 1000,
  // ★ 2026-08-13 마케팅 플래너 당일 문안 10 (Phase 3) — 자동마케팅 발송 문안(10)과 같은 원가 축.
  //   행사 당일 문자·DM 안내 문안을 생성해 실제로 발송을 접수한 뒤 1회(멱등키 planner-send:{터치포인트}).
  //   ⛔ OPERATION_SOURCES에 넣지 않는다 — 플래너는 마이너스·자동충전 금지가 확정 정책이라
  //   잔액이 없으면 그 터치포인트만 보류되고 통지가 나가야 한다(조용한 증발 금지).
  'planner-touchpoint-send': 10,
  // 예측 자동 분석 (3) — 연동 회사(싱크에이전트/SDK) 매일 1회 예측 점수 갱신. 회사+날짜 멱등.
  'predictive-daily': 3,
  // 모바일 DM 생성(돌려보기) 5 — 자연어→sections + 슬라이드 분할 + 전 섹션 카피까지 생성(범위 넓음). 호출마다 5. 발행은 'dm-builder' 30 별도.
  'dm-ai-generate': 5,
  // 모바일 DM 발행(확정) 30 — 단축URL 발행 최초 1회만(멱등키=dm-publish:dmId). test-send 자동발행은 미과금.
  'dm-builder': 100,
  // 인터랙션 캠페인 발행(룰렛/추첨/투표/설문/이메일수집 등) 50 — 일반 발행보다 높게(F 안1 정액). 발행 최초 1회만(멱등키=dm-publish:dmId). 당첨 통보 발송은 기존 발송 크레딧 별도(발송은 발송대로). 베타 동안 하향 조정 가능(config가 진실).
  'dm-interaction-publish': 120,
  // 인앱 생성(돌려보기) 3 — 자연어→완성 메시지. 호출마다 3. 게시는 'inapp-publish' 15 별도.
  'inapp-ai-generator': 3,
  // Email 생성(돌려보기) 3 — 자연어/시나리오→제목3안+본문 HTML. 호출마다 3. 캠페인 완성은 'email-campaign-complete' 50 별도.
  'email-ai-generate': 3,
  // ★ 2026-07-08 행사 캠페인 이미지 판독 3 — 업로드 이미지(스샷)에서 행사 내용(브랜드·상품·정가·할인율·판매가·기간·혜택)을 전사해 행사 내용 텍스트 반환(vision). 성공 시에만 차감. 20 미만이라 확인 모달 비대상.
  'event-image-extract': 3,
  // ★ 2026-07-02 Harold 확정 — Email 캠페인 완성 50: AI/수동/템플릿 불문 "완성 저장" 시 1회(멱등키 email-campaign-complete:campaignId).
  //   임시저장 무료(발송·PC 미리보기 잠금) / 발송·수신/오픈/클릭 이력 = 무료(고객 SMTP) / 환불 없음.
  'email-campaign-complete': 50,
  // (구) Email AI 캠페인 발송 확정 — 2026-07-02부터 미사용(완성 요금으로 대체). 과거 거래 멱등키 인정용으로 키만 유지.
  'email-ai-publish': 50,
  // 인앱 게시(확정) 15 — status=active 저장 최초 1회만(멱등키=inapp-publish:messageId).
  'inapp-publish': 100,
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
  // ★ 2026-07-10 고객사 자체 URL 단축(hlj.kr) — 박성용 신기능(Harold 100 확정). AI 호출 0 —
  //   가치 과금(우리 도메인 상시 서빙 + 클릭 추적). 발급 성공 후 멱등 차감(키=링크 id).
  'dm-custom-short-link': 100,
  // ★ 2026-07-19 P4 이미지 스튜디오 (AI 오퍼레이터 스튜디오 — 1크레딧=500원, 전부 20 미만 = CreditConfirmModal 비대상).
  //   생성 1회 = Pro 2K 후보 2장 = 2 (부분 성공 1장 = 호출측이 cost 1 override). 같은 구도 4K 격상 = +2. 배경·무드 AI 편집 = 1.
  //   누끼·서버 합성(/compose)·타이포 오버레이·MMS 변환은 무료(CREDIT_COST_MAP 미등록 = 0).
  //   frontend constants/credit.ts CREDIT_SOURCE_LABELS와 1:1 유지 (한쪽만 바꾸지 말 것).
  'image-studio-generate': 2,
  'image-studio-4k': 2,
  'image-studio-edit': 1,
};

/** source → 크레딧 비용. 미등록·미전달 source는 0 (차감 안 함). */
export function getCreditCost(source: string | undefined | null): number {
  if (!source) return 0;
  return CREDIT_COST_MAP[source] ?? 0;
}

/**
 * DB 규모 일일 분석 차감 (연동 회사 매일 1회). 1크레딧=500원. (크레딧 모델 v2 2026-06-30)
 *  - 10만블록 = ceil(고객수/10만). 매일 = round(3 + (블록−1)×1.5) — 정수 반올림(홀수 블록 정확, 짝수 블록 +0.5).
 *  - 0명 = 0(차감 없음). 예: 10만 3 / 20만 5 / 30만 6 / 80만 14 / 100만 17 / 300만 47.
 */
export function dailyDbAnalysisCredits(customerCount: number): number {
  const n = Math.max(0, Math.floor(Number(customerCount) || 0));
  if (n === 0) return 0;
  const blocks = Math.ceil(n / 100000);
  return Math.round(3 + (blocks - 1) * 1.5);
}

/** 운영(반복) 발송 source — 마이너스 허용 대상(활성 여정·자동마케팅 실행). 그 외는 0에서 차단. (v2 2026-06-30) */
const OPERATION_SOURCES = new Set(['journey-operation', 'continuous-operator-send']);
export function isOperationSource(source: string | undefined | null): boolean {
  return !!source && OPERATION_SOURCES.has(source);
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

/**
 * 이번달 순사용량 = deduct 합 − refund 합 (순수). reset/grant/admin_deduct는 제외.
 * ★ 2026-08-13: 환불 축(대행 취소) 신설에 맞춰 순액으로. DB판(getMonthlyUsage)과 같은 정의다.
 */
export function sumDeductRows(rows: Array<{ type: string; amount: number | string }>): number {
  return rows.reduce((sum, r) => {
    if (r.type === 'deduct') return sum + (Number(r.amount) || 0);
    if (r.type === 'refund') return sum - (Number(r.amount) || 0);
    return sum;
  }, 0);
}
