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
