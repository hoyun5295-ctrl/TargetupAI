/**
 * ★ CT: 청구 유형 축의 단일 정의 (2026-07-29 신설 → 2026-07-29 순수 파일로 분리)
 *
 * 유형키·표시명·단가컬럼·큐 코드가 `send-usage-aggregation.ts`에 7군데,
 * `billing-invoice-lines.ts`에 2군데 — 모두 9군데에 복제돼 있었다.
 * 하나를 빠뜨리면 그 유형이 조용히 0원이 되거나 발행이 통째로 차단된다:
 *   · 2026-07-25 `M`·`K` 미변환으로 청구 합산에서 빠짐
 *   · 2026-07-29 브랜드메시지 `G` 미등재로 여미지 발행 차단
 *
 * 축 정의는 **순수 데이터**라 여기 홀로 둔다. 집계 모듈(DB·MySQL 의존) 안에 두면
 * 순수 모듈이 그걸 쓰려고 무거운 의존을 끌어오게 되고, 그러면 결국 우회 복제가 다시 생긴다.
 *
 * ⚠ 표의 **순서가 곧 청구서 항목 인쇄 순서**다.
 */

/**
 * 브랜드메시지로 나가는 캠페인 채널값.
 *
 * ★ `kakao`는 **역사적 이름이고 실체가 브랜드메시지**다.
 *   ★ 2026-07-30 재구축: 발송은 알림톡과 같은 SMSQ 라인 테이블에 `msg_type='F'`로 적재된다
 *   (옛 `IMC_BM_FREE_BIZ_MSG` 적재는 테이블 미실재로 폐기 — 정산·집계는 SMSQ msg_type 축이 담당).
 *   `kakao_brand`는 전용 발송(`POST /brand-send`)이 쓰는 값이고, `both`는 문자와 함께 나가는 캠페인이라
 *   그 안에 브랜드 발송분이 섞여 있다.
 *
 * 이 목록이 **차감·환불·발송결과 채널 분기가 공유하는 유일한 판정**이다.
 * 리터럴로 흩어져 있던 탓에 전용 발송(`kakao_brand`)이 집계 두 곳 모두에서 빠져 0건이 됐고,
 * 일자축만 유형을 바꾸고 상세축을 안 바꿔 축 불일치로 발행이 422로 막혔다(2026-07-29 적대검증).
 */
export const BRAND_CAMPAIGN_CHANNELS = ['kakao', 'kakao_brand', 'both'] as const;

/** 위 목록의 SQL IN 절. 집계 두 축이 **같은 문자열**을 써야 수량이 갈라지지 않는다. */
export const BRAND_CHANNEL_SQL_IN = BRAND_CAMPAIGN_CHANNELS.map((c) => `'${c}'`).join(', ');

/**
 * 이 채널의 발송이 **전량 브랜드메시지인가** = 선불 차감·환불 유형이 `BRAND`인가.
 * `both`는 문자가 섞여 있어 여기 해당하지 않는다(문자분은 `message_type`으로 차감된다).
 */
export function isBrandOnlyChannel(sendChannel: any): boolean {
  const v = String(sendChannel || '').trim();
  return v === 'kakao' || v === 'kakao_brand';
}

/**
 * ★ 발송 채널 축 — **파이프라인마다 실제로 적재할 수 있는 채널** (2026-08-17 신설)
 *
 * 차감은 채널을 안 보고 먼저 일어나는데 적재는 채널로 분기한다. 그래서 그 파이프라인이 처리하지 못하는
 * 채널값이 들어오면 **캠페인 레코드 생성 + 선불 차감 + 발송 0건**으로 끝나고 응답은 성공이 된다.
 *
 * ⚠ **전역 목록 하나로는 못 막는다**(Codex 적대검토 critical — 1차 시도의 결함).
 *   같은 이름의 채널이라도 문마다 처리 능력이 다르기 때문이다. 실측 —
 *     · `direct`  = `/direct-send`·`/direct-send/commit` — sms·both / kakao·both / alimtalk 적재
 *     · `campaign`= AI 캠페인 `/:id/send` — sms·both / kakao·both 적재(**알림톡 분기가 없다**)
 *     · `brand`   = `/brand-send` 전용 — 자체 적재
 *   전역 목록을 쓰면 `alimtalk` 캠페인이 `campaign` 문을 통과해 차감만 되고, `kakao_brand`가
 *   `direct` 문을 통과해 BRAND로 차감된 뒤 한 건도 안 나간다.
 *
 * ⚠ RCS는 어느 파이프라인에도 **아직 없다**. 게이트웨이 적재 경로가 열리는 시점에 그 파이프라인에만
 *   등재한다(설계 = `docs/2026-08-17-rcs-integration-design.md`). 미리 넣으면 그 순간 이 구멍이 되살아난다.
 */
export const PIPELINE_SEND_CHANNELS = {
  direct: ['sms', 'both', 'kakao', 'alimtalk'],
  campaign: ['sms', 'both', 'kakao'],
  brand: ['kakao_brand'],
} as const;

export type SendPipeline = keyof typeof PIPELINE_SEND_CHANNELS;

export type SendChannel = (typeof PIPELINE_SEND_CHANNELS)[SendPipeline][number];

/**
 * 시스템이 아는 채널 전부 = 파이프라인 목록의 합집합. **별도로 나열하지 않는다** —
 * 두 벌을 두면 한쪽만 늘어나고, 그 순간 "목록엔 있는데 적재는 없는" 채널이 다시 생긴다.
 */
export const SEND_CHANNELS: readonly SendChannel[] = Object.freeze([
  ...new Set(Object.values(PIPELINE_SEND_CHANNELS).flat()),
]) as readonly SendChannel[];

export type ChannelResolution =
  | { ok: true; channel: SendChannel }
  | { ok: false; reason: string };

/**
 * 발송 채널을 **판정하고 정규화해서 돌려준다.** 차감·캠페인 INSERT·실행 행 생성보다 **앞**에서 부른다.
 *
 * ⛔ **불리언 검사로 만들지 마라 — 그것이 1차 시도의 결함이었다**(Codex 적대검토 high).
 *   검사만 하고 호출부가 원본을 계속 쓰면, `['sms']` 같은 값이 `String()` 강제변환으로 게이트를 통과한 뒤
 *   적재 분기의 `=== 'sms'`에는 빗나가 차감만 남는다(`[]`는 빈 문자열로 보여 통과하는데 `[] || 'sms'`는
 *   빈 배열이 truthy라 그대로 흘러간다). **호출부는 반드시 여기서 돌려준 `channel`을 쓴다.**
 *
 * 판정 규칙
 *   · 미지정(`null`·`undefined`·`''`) = `'sms'`로 확정한다 — 기본값을 호출부의 `|| 'sms'`에 맡기지 않는다.
 *   · 문자열이 아니면 거절한다(배열·객체·숫자·불리언). 강제변환하지 않는다.
 *   · 공백이 섞인 값도 거절한다 — 적재 분기가 원문을 비교하므로 다듬어 통과시키면 같은 사고가 난다.
 */
export function resolveSendChannel(pipeline: SendPipeline, raw: unknown): ChannelResolution {
  if (raw === null || raw === undefined || raw === '') return { ok: true, channel: 'sms' };
  if (typeof raw !== 'string') return { ok: false, reason: '발송 채널 형식이 올바르지 않습니다.' };
  const allowed = PIPELINE_SEND_CHANNELS[pipeline] as readonly string[];
  if (!allowed.includes(raw)) return { ok: false, reason: '이 발송 경로가 지원하지 않는 발송 채널입니다.' };
  return { ok: true, channel: raw as SendChannel };
}

/**
 * ★ 과금 메시지 유형 축 (2026-08-17 신설)
 *
 * 캠페인 발송이 차감에 넘기는 `message_type`이다. **채널과 별개 축**이라 채널 게이트로는 안 걸린다
 * (Codex 적대검토 high — AI 추천값이 그대로 `messageType`이 되는 경로가 실재했다).
 *
 * 막는 사고: 목록 밖 유형은 `MESSAGE_TYPE_PRICE_COLUMN`에 없어 `unknownType`이 되고,
 * `unit-price.ts`는 그걸 **막지 않고 0원으로 통과**시킨다(의도된 fail-open — 예상 못 한 유형 하나로
 * 발송이 전부 서는 편이 더 나쁘다는 판단). 그 결과 **요금 0원으로 나가는 발송**이 만들어진다.
 * ⇒ fail-open을 뒤집지 않고, **입구에서** 유형을 확정한다.
 */
export const CHARGEABLE_MESSAGE_TYPES = ['SMS', 'LMS', 'MMS'] as const;

export type ChargeableMessageType = (typeof CHARGEABLE_MESSAGE_TYPES)[number];

export type MessageTypeResolution =
  | { ok: true; messageType: ChargeableMessageType }
  | { ok: false; reason: string };

/** 채널 resolver와 같은 계약 — 판정하고 정규화된 값을 돌려준다. 기본값 없음(유형은 필수 입력이다). */
export function resolveChargeMessageType(raw: unknown): MessageTypeResolution {
  if (typeof raw !== 'string') return { ok: false, reason: '메시지 유형 형식이 올바르지 않습니다.' };
  if (!(CHARGEABLE_MESSAGE_TYPES as readonly string[]).includes(raw)) {
    return { ok: false, reason: '지원하지 않는 메시지 유형입니다.' };
  }
  return { ok: true, messageType: raw as ChargeableMessageType };
}

/**
 * ★ 2026-07-30 환불·정산 축 — 캠페인 하나의 차감이 어느 유형 축으로 갈라져 있는가.
 * 브랜드가 SMSQ(msg_type='F')로 합류하면서, MySQL 실측(fail·pending)을 환불로 되돌릴 때
 * 그 건수가 **어느 차감 원장**(BRAND vs message_type)의 몫인지를 행 단위로 갈라야 한다.
 *   - 브랜드 전용(kakao·kakao_brand): 전 행이 F → BRAND 축 하나 (scope 'all')
 *   - both: 문자(message_type) + 브랜드(BRAND) 두 축 — smsCampaignCountsSafe의 msgTypeScope로 분리
 *   - 그 외: message_type 축 하나 (기존 동작 그대로)
 * 차감을 넣는 쪽(campaigns.ts deductType·both 이중 차감)과 같은 판정을 쓴다 — 갈라지면 회계가 어긋난다.
 */
export interface RefundAxis {
  /** prepaidDeduct/prepaidRefund에 넘긴 message_type 축 */
  type: string;
  /** smsCampaignCountsSafe msgTypeScope — 이 축이 소유하는 MySQL 행 범위 */
  scope: 'all' | 'brand' | 'nonBrand';
}

export function resolveRefundAxes(sendChannel: any, messageType: any): RefundAxis[] {
  if (isBrandOnlyChannel(sendChannel)) return [{ type: 'BRAND', scope: 'all' }];
  if (String(sendChannel || '').trim() === 'both') {
    return [
      { type: String(messageType || 'SMS'), scope: 'nonBrand' },
      { type: 'BRAND', scope: 'brand' },
    ];
  }
  return [{ type: String(messageType || 'SMS'), scope: 'all' }];
}

/**
 * ★ CT: **청구 수량**의 단일 정의 (2026-08-05 신설)
 *
 * `성공 건수 − 요금제 무료 제공 공제분`. 이 한 줄이 네 곳에 흩어져 있었고 **네 번 다 갈렸다** —
 * 장 헤더 수량·청구서 항목줄·수량 조정 음수 판정·정산 미리보기가 각자 계산하다가
 * 표시가 청구와 어긋났다(0805 Codex 3R·4R + 자체 발견). 판정 축은 언제나 **인쇄되는 줄의 축**이어야 한다.
 *
 * ⛔ **0 하한을 걸지 않는다.** 조정 행은 `success`가 음수이고, 행마다 잘라내면 그 행이 통째로 사라져
 *   수량에서만 조정이 빠지고 금액에는 남는다(`수량 × 단가 = 금액`이 깨진다). 그룹 합이 음수인 발행은
 *   `findNegativeAdjustedTypes`가 422로 막으므로 통과한 발행의 합은 언제나 0 이상이다.
 *   (절사를 항목줄에서 1회만 하는 것과 같은 원칙 — 0730 Harold 정정)
 */
export function billableQuantity(row: { success?: any; freeCount?: any; success_count?: any; free_count?: any }): number {
  const success = Number(row?.success ?? row?.success_count) || 0;
  const free = Math.max(0, Number(row?.freeCount ?? row?.free_count) || 0);
  return success - free;
}

/** `company_agent_ids` 단가 행 — 발송ID별 단가는 회사 단가와 별개 축이다 */
export interface AgentUnitPriceRow {
  id: string;
  agent_send_id: string;
  cost_per_sms: any;
  cost_per_lms: any;
  cost_per_mms: any;
  cost_per_kakao: any;
  /** ★ 2026-07-29 브랜드메시지(구 친구톡). 게이트웨이 MsgType `G` */
  cost_per_brand: any;
}

/**
 * 발송ID 단가 컬럼명 — 위 행의 `cost_per_*` 키만 뽑는다.
 *
 * ★ 단순 `string`으로 두면 오타가 tsc를 통과하고, 잘못된 컬럼 조회는 `undefined`가 되어
 *   성공 발송이 통째로 `missingAgentPrices`로 분류돼 **발행이 차단된다**(Codex 적대검증 수용).
 *   `keyof AgentUnitPriceRow`만으로는 `id`·`agent_send_id`까지 통과하므로 접두로 좁힌다.
 *   컬럼을 추가할 땐 위 인터페이스에만 넣으면 여기가 자동으로 넓어진다 — 목록을 두 벌 두지 않는다.
 */
export type AgentPriceColumn = Extract<keyof AgentUnitPriceRow, `cost_per_${string}`>;

export interface BillingTypeDef {
  /** 청구 유형키 — `billing_items.message_type`에 그대로 들어간다 */
  key: string;
  /** 사용자 표시명 (엑셀·청구서). 웹·에이전트가 같은 이름을 써야 피벗이 갈라지지 않는다 */
  label: string;
  /** 회사 단가 컬럼(`companies`). null = 회사 축에서 직접 청구하지 않는 유형(테스트·스팸은 별도 규칙) */
  companyPriceColumn: string | null;
  /** 발송ID 단가 컬럼(`company_agent_ids`). null = 에이전트 축에 없는 유형 */
  agentPriceColumn: AgentPriceColumn | null;
  /** SMSQ `msg_type`(웹 일반발송 큐). null = 그 큐로 나가지 않는 유형 */
  smsqCode: string | null;
  /** 게이트웨이 `RSRM_SalesStts.MsgType`(에이전트). null = 에이전트 발송이 없는 유형 */
  agentCode: string | null;
}

export const BILLING_TYPES: readonly BillingTypeDef[] = [
  { key: 'SMS',      label: 'SMS',           companyPriceColumn: 'cost_per_sms',      agentPriceColumn: 'cost_per_sms',   smsqCode: 'S',  agentCode: 'S' },
  { key: 'LMS',      label: 'LMS',           companyPriceColumn: 'cost_per_lms',      agentPriceColumn: 'cost_per_lms',   smsqCode: 'L',  agentCode: 'L' },
  { key: 'MMS',      label: 'MMS',           companyPriceColumn: 'cost_per_mms',      agentPriceColumn: 'cost_per_mms',   smsqCode: 'M',  agentCode: 'M' },
  // ★ 2026-07-25 '카카오' → '카카오알림톡'. 같은 엑셀의 에이전트 행이 '카카오알림톡'이라
  //   한 '유형' 컬럼에 알림톡이 두 이름으로 갈리면 피벗에서 두 줄이 되어 정산 대조가 깨진다.
  { key: 'KAKAO',    label: '카카오알림톡',    companyPriceColumn: 'cost_per_kakao',    agentPriceColumn: 'cost_per_kakao', smsqCode: 'K',  agentCode: 'K' },
  // ★ 2026-07-29 브랜드메시지(구 친구톡).
  //   ★ 2026-07-30 재구축: 웹도 SMSQ 큐에 `msg_type='F'`로 적재된다 — smsqCode 'F' 등재로
  //   일자·상세 정산 두 축의 유형키 맵(MSG_TYPE_TO_USAGE_KEY)이 자동 확장된다(전용 IMC arm 폐기).
  { key: 'BRAND',    label: '브랜드메시지',    companyPriceColumn: 'cost_per_brand',    agentPriceColumn: 'cost_per_brand', smsqCode: 'F',  agentCode: 'G' },
  { key: 'TEST_SMS', label: '테스트 SMS',     companyPriceColumn: 'cost_per_test_sms', agentPriceColumn: null,             smsqCode: null, agentCode: null },
  { key: 'TEST_LMS', label: '테스트 LMS',     companyPriceColumn: 'cost_per_test_lms', agentPriceColumn: null,             smsqCode: null, agentCode: null },
  // 스팸테스트는 전용 단가가 없고 일반 SMS/LMS 단가를 그대로 쓴다(D16) — 그래서 컬럼이 없다.
  { key: 'SPAM_SMS', label: '스팸테스트 SMS', companyPriceColumn: null,                agentPriceColumn: null,             smsqCode: null, agentCode: null },
  { key: 'SPAM_LMS', label: '스팸테스트 LMS', companyPriceColumn: null,                agentPriceColumn: null,             smsqCode: null, agentCode: null },
];
