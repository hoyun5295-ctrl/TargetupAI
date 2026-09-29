/**
 * 플랫폼 기본값 설정 (중앙 관리)
 *
 * 원칙: 고객사 DB 값 우선 → 없을 경우 환경변수 → 없을 경우 아래 기본값
 * 하드코딩 방지: 모든 파일에서 이 모듈을 import하여 사용
 * 수정 시 이 파일 하나만 변경하면 전체 반영됨
 */

import Redis from 'ioredis';
import { normalizeUnitPriceBasis, toVatIncludedPrice, pickBrandPriceRaw } from '../utils/unit-price';

// ============================================================
// Redis 공통 인스턴스
// ============================================================
export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
// ★ 2026-07-14 테스트(vitest)에선 lazyConnect로 연결 시도 자체를 안 함 — 로컬 게이트 연결 에러 로그 차단. 운영(VITEST 미설정)은 즉시 연결(기존 동일).
export const redis = new Redis(REDIS_URL, process.env.VITEST ? { lazyConnect: true } : {});
redis.on('error', (err) => console.error('[Redis] 연결 에러:', err.message));

// ============================================================
// AI 모델명 (환경변수로 모델 업그레이드 시 .env만 수정)
// ============================================================
export const AI_MODELS = {
  // ★ 2026-07-01 (Harold 명시): 문안=Sonnet 5(대량·비용), 오퍼레이터 정밀=Opus 4.8(검수·타겟).
  //   - 문안 생성 전체(generate/refine/email/dm/inapp, model 미지정/'sonnet') = Sonnet 5
  //     → $3/$15(도입가 $2/$10), 신세대 품질, 대량 발생이라 비용 절감 큼.
  //   - AI Operator(target/compliance/message/orchestrator, model:'opus') = Opus 4.8
  //     → 정밀 검수·타겟은 본문 한 줄까지 꼼꼼히 읽는 정확도가 핵심이라 최신 Opus 유지.
  //       (Sonnet 5 thinking-off 검수 오탐 = 무료거부 있는데 누락으로 잡음 → Opus 4.8로 정정.
  //        오퍼레이터는 저빈도라 단가 영향 작음.)
  //   - ★ 두 모델 모두 adaptive-only 표면: temperature/top_p/top_k 보내면 400, thinking은 adaptive/disabled만.
  //     Sonnet 5는 thinking 생략 시 adaptive 자동 ON → max_tokens 잠식·문안 잘림. Anthropic 직접 호출부는
  //     claudeRequestShape()로 분기(★0930 — 모델별 temperature · thinking · effort 형태를 한 곳이 정한다) + resolveMaxTokens 여유.
  //   - 필드 매핑(ai-mapping.ts)은 별도 env CLAUDE_MAPPING_MODEL — 범위 밖.
  //   ※ 서버 .env에 CLAUDE_MODEL / CLAUDE_OPUS_MODEL 설정 시 그 값 우선 → 함께 변경 필요.
  // ★ 2026-09-30 (Harold 결정 B) 문안 = Sonnet 5.5 · 정밀(검수·타겟) = Opus 5.5 — 07-01 분리 유지.
  //   요청 형태는 claudeRequestShape 가 모델별로 정한다(운영 키 실측 0930: 둘 다 thinking disabled · temperature 400).
  //   되돌리기 = .env 에 CLAUDE_MODEL=claude-sonnet-5 · CLAUDE_OPUS_MODEL=claude-opus-4-8 두 줄 + pm2 restart --update-env(배포 불요).
  claude: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',                // 문안 생성 — Sonnet 5.5
  opus: process.env.CLAUDE_OPUS_MODEL || 'claude-opus-5-5',               // AI Operator 정밀(검수·타겟) — Opus 5.5
  // ★ 2026-09-30 (Harold) GPT 대체도 최신 = gpt-6-luna(문안 · AI Operator 둘 다). 운영 키 실측: 기본 · JSON 응답 모드 OK · temperature 0.3 = 400(기본 1만).
  //   temperature 는 gptRequestShape 가 모델별로 정한다. 되돌리기 = .env GPT_MODEL · GPT_OPERATOR_MODEL + pm2 restart --update-env.
  gpt: process.env.GPT_MODEL || 'gpt-6-luna',                            // 문안 흐름 GPT 대체
  gptOperator: process.env.GPT_OPERATOR_MODEL || 'gpt-6-luna',           // AI Operator GPT 대체
};

/**
 * ★ 2026-09-30 Claude 모델별 요청 형태 — **temperature · thinking · effort 를 정하는 유일한 자리**(직접 호출 9곳 · 공통 CT 전부 이것만 본다).
 *   옛: `isAdaptiveOnlyModel` 정규식(sonnet-5|opus-4-7|opus-4-8) 두 갈래 — 새 모델(Sonnet 5.5 · Opus 5.5)은 판정이 틀리거나
 *   "생각 끄기 = disabled" 가 400 이라, .env 만 바꾸면 전 호출이 실패 → 조용히 GPT 대체로 넘어갔다.
 *   운영 키 실측(0930 Harold 서버 · API 원문):
 *     - Sonnet 5.5: thinking disabled 400("between_tools 로 보내라") · between_tools OK(생각 0) · adaptive OK · temperature 400(deprecated)
 *     - Opus 5.5: thinking disabled 400(미지원 · adaptive + output_config.effort 로 조절) · adaptive+low OK(생각 35) · adaptive+high OK(생각 93) · temperature 400
 *   ⛔ 모르는 모델은 새 모델이 모두 받는 형태(adaptive · temperature 없음)로 보낸다 — 틀려도 400 이 아니라 생각 토큰을 더 쓰는 쪽(허용 목록 원칙).
 */
/**
 * ★ 2026-09-30 GPT 대체 요청 형태 — temperature 를 보낼지 정하는 유일한 자리(허용 목록).
 *   운영 키 실측(0930): gpt-6-luna · gpt-6-astra · gpt-6-sol · gpt-6.1-sol · gpt-5.6-luna 모두 temperature 0.3 = 400("기본 1만") ·
 *   옛 코드는 "두 GPT 변수 값이 같은가"로 우연히 안 보내고 있었다(값이 갈리면 문안 흐름에만 보내 400 → 대체까지 실패).
 *   옛 계열(gpt-3.5 · gpt-4 계열)만 temperature 를 싣는다 · 그 밖(모르는 모델 포함) = 안 보냄.
 */
export function gptRequestShape(modelName: string, opts: { temperature?: number } = {}): { temperature?: number } {
  const m = (modelName || '').toLowerCase().trim();
  if (typeof opts.temperature === 'number' && /^gpt-(3\.5|4)(o|\.|-|$)/.test(m)) return { temperature: opts.temperature };
  return {};
}

export type ClaudeModelFamily = 'legacy' | 'adaptive_v1' | 'sonnet_5_5' | 'opus_5_5' | 'unknown';

export function claudeModelFamily(modelName: string): ClaudeModelFamily {
  const m = (modelName || '').toLowerCase().trim();
  if (/^claude-sonnet-5-5(-|$)/.test(m)) return 'sonnet_5_5';
  if (/^claude-opus-5-5(-|$)/.test(m)) return 'opus_5_5';
  // 지금 운영(0930 전) — Sonnet 5 · Opus 4.7 · 4.8: temperature 400 · thinking adaptive/disabled
  if (/^claude-sonnet-5(-20\d{6})?$/.test(m) || /^claude-opus-4-[78](-|$)/.test(m)) return 'adaptive_v1';
  // temperature · enabled+budget 를 받는 옛 모델(확인된 것만 · 허용 목록)
  if (/^claude-(sonnet-4-[0-6]|haiku-4-5|opus-4-[0-6])(-|$)/.test(m) || /^claude-3/.test(m)) return 'legacy';
  return 'unknown';
}

export interface ClaudeRequestShape {
  temperature?: number;
  thinking?: { type: 'enabled'; budget_tokens: number } | { type: 'adaptive' | 'disabled' | 'between_tools' };
  output_config?: { effort: 'low' | 'high' };
}

/**
 * 모델이 받는 모양으로 temperature · thinking · effort 조각을 만든다(요청 객체에 펼쳐 넣는다).
 *   thinking = 호출부가 생각을 원하는가(검수 등). temperature = 옛 모델에만 실린다(생각 켜면 1 · API 제약).
 */
export function claudeRequestShape(
  modelName: string,
  opts: { temperature?: number; thinking?: boolean; thinkingBudget?: number } = {},
): ClaudeRequestShape {
  const want = opts.thinking === true;
  switch (claudeModelFamily(modelName)) {
    case 'legacy': {
      const out: ClaudeRequestShape = {};
      if (typeof opts.temperature === 'number') out.temperature = want ? 1 : opts.temperature;
      if (want) out.thinking = { type: 'enabled', budget_tokens: opts.thinkingBudget || 5000 };
      return out;
    }
    case 'adaptive_v1':
      // 생략하면 adaptive 가 자동으로 켜져 출력 한도를 잠식한다 → 끄기를 명시(0701 이래 동작 그대로).
      return { thinking: want ? { type: 'adaptive' } : { type: 'disabled' } };
    case 'sonnet_5_5':
      return { thinking: want ? { type: 'adaptive' } : { type: 'between_tools' } };
    case 'opus_5_5':
      // 생각을 끌 수 없다 — 원치 않으면 effort 를 낮춘다.
      return want ? { thinking: { type: 'adaptive' } } : { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } };
    default:
      return { thinking: { type: 'adaptive' } };
  }
}

/**
 * 출력 한도 여유 — 상한일 뿐 모델이 더 길게 쓰게 만들지 않는다(정상 출력은 그대로 · 잘림만 막는 무비용 여유 · 상한 16000 = 비스트리밍 HTTP 타임아웃 안전 한계).
 *   - adaptive_v1 · sonnet_5_5: 1.5배(Sonnet 5 토크나이저 ~30%↑ 대응 · 0701 근거 그대로 · 5.5 는 같은 계열로 둔다).
 *   - opus_5_5 · unknown: 생각을 끌 수 없어 생각 토큰이 같은 한도를 쓴다 → 2배와 +1024 중 큰 값.
 *   - legacy: 그대로.
 */
export function resolveMaxTokens(baseMaxTokens: number, modelName: string): number {
  const fam = claudeModelFamily(modelName);
  if (fam === 'legacy') return baseMaxTokens;
  if (fam === 'adaptive_v1' || fam === 'sonnet_5_5') return Math.min(Math.ceil(baseMaxTokens * 1.5), 16000);
  return Math.min(Math.max(baseMaxTokens * 2, baseMaxTokens + 1024), 16000);
}

// ============================================================
// 서비스 기본 단가 (원) — 고객사 DB 미설정 시 폴백
// ★ 이 값들은 **부가세 포함가**다(9.9 = 9 × 1.1). 화면 표시·예상 비용 추정에만 쓰이고
//   청구서에는 절대 들어가지 않는다 — 단가 미설정 회사는 발행이 422로 막힌다(WEB_UNIT_PRICE_UNSET).
// ============================================================
export const DEFAULT_COSTS = {
  sms: parseFloat(process.env.DEFAULT_COST_SMS || '9.9'),
  lms: parseFloat(process.env.DEFAULT_COST_LMS || '27'),
  mms: parseFloat(process.env.DEFAULT_COST_MMS || '50'),
  kakao: parseFloat(process.env.DEFAULT_COST_KAKAO || '7.5'),
  // ★ 2026-07-31 브랜드메시지는 `cost_per_brand`로 차감·청구되는데(BILLING_TYPES BRAND) 표시 축에만
  //   단가가 없어, 화면이 알림톡 단가로 계산하고 있었다. 미설정 폴백은 알림톡과 같은 값으로 둔다.
  brand: parseFloat(process.env.DEFAULT_COST_BRAND || process.env.DEFAULT_COST_KAKAO || '7.5'),
};

/**
 * 고객사 단가 조회 헬퍼 — **고객이 실제로 지불하는 건별 금액(부가세 포함)**을 돌려준다.
 *
 * ★ 2026-07-26: 이 함수의 소비처는 전부 "화면에 보이는 비용"과 "예상 비용 추정"이다
 *   (발송결과 비용·대시보드·여정 시뮬레이터·AI 제안·캠페인 대행 제안서).
 *   고객에게 보이는 금액은 청구서 합계와 같은 축이어야 하므로 부가세 포함가가 맞다.
 *   청구서 공급가액은 이 함수가 아니라 `resolveBillingUnitPricesDetailed`가 담당한다.
 *
 *   `company.unit_price_basis`가 SELECT에 없으면 전환 전(`vat_included`)으로 해석돼
 *   저장값을 그대로 돌려준다 = 오늘과 같은 값. 전환한 회사에서만 ×1.1이 붙는다.
 */
export function getCompanyCosts(company: Record<string, any>) {
  const basis = normalizeUnitPriceBasis(company?.unit_price_basis);
  // ★ 2026-07-26 **명시적 0원은 0원 그대로** 둔다(Codex #8). 미설정(null·빈값·비수치)만 기본 단가로 폴백.
  //   청구·차감 경로는 이미 0원 계약을 보존하는데 표시 경로만 기본 단가로 되돌리면
  //   "무료 계약인데 화면엔 9.9원"이 되어 화면과 청구서가 갈린다.
  const pick = (raw: any, fallback: number) => {
    if (raw === null || raw === undefined || String(raw).trim() === '') return fallback;
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return fallback;
    return toVatIncludedPrice(v, basis) ?? fallback;
  };
  return {
    sms: pick(company?.cost_per_sms, DEFAULT_COSTS.sms),
    lms: pick(company?.cost_per_lms, DEFAULT_COSTS.lms),
    mms: pick(company?.cost_per_mms, DEFAULT_COSTS.mms),
    kakao: pick(company?.cost_per_kakao, DEFAULT_COSTS.kakao),
    brand: pick(company?.cost_per_brand, DEFAULT_COSTS.brand),
    // ★ 2026-09-13 비친구 브랜드(M·N·미지정) — 비친구 칸이 비면 친구 단가를 따른다(순서표 = unit-price.ts).
    brandNonfriend: pick(pickBrandPriceRaw(company, { targeting: 'N' }), DEFAULT_COSTS.brand),
  };
}

// ============================================================
// 타임아웃 (밀리초)
// ============================================================
export const TIMEOUTS = {
  /** 슈퍼관리자 세션 타임아웃 — 30분 */
  superAdminSessionMinutes: Number(process.env.SUPER_ADMIN_SESSION_MINUTES) || 30,
  /** 세션 활동 갱신 주기 — 5분 */
  activityUpdate: 5 * 60 * 1000,
  /** 스팸필터 테스트 최종 안전장치 타임아웃 — 60초 (정상 시 QTmsg 성공 후 10초에 판정 완료) */
  spamFilterTest: 60 * 1000,
  /** 스팸필터 안전 강제종료 — 90초 */
  spamFilterSafety: 90 * 1000,
  /** ★ 2026-09-27 한줄로 V2 m008 — 이니시스 승인·망취소 API 호출 시간 제한 30초(넘으면 승인 실패 흐름 = 망취소 · 리턴 요청이 매달리지 않게) */
  inicisApi: 30 * 1000,
  /** 업로드 파일 정리 주기 — 1시간 */
  uploadCleanup: 60 * 60 * 1000,
  /** 동기화 중단 정리 기준 — 30분 */
  syncStaleThreshold: 30 * 60 * 1000,
  /** 동기화 정리 주기 — 5분 */
  syncCleanupInterval: 5 * 60 * 1000,
  /** AI 재시도 대기 — 2초 */
  aiRetryDelay: 2000,
};

// ============================================================
// 배치 사이즈 (건수)
// ============================================================
export const BATCH_SIZES = {
  /** 고객 업로드 DB insert 배치 (원래 4000 → 500 으로 축소된 이력 있음, 복원) */
  customerUpload: 2000,
  /** SMS/LMS/MMS MySQL 큐 INSERT 배치 (max_allowed_packet 64MB 기준, LMS 건당 ~2KB → 5000건=10MB) */
  smsSend: 5000,
  /** 발송 메시지 업데이트 배치 */
  messageUpdate: 1000,
  /** 동기화 API 고객 배치 */
  syncCustomer: 5000,
  /** 동기화 API 구매 배치 */
  syncPurchase: 5000,
  /** 고객 세그멘테이션 기본 한도 */
  customerSegment: 10000,
};

// ============================================================
// 캐시 TTL (초)
// ============================================================
export const CACHE_TTL = {
  /** 라인그룹 캐시 — 60초 (밀리초 아님 주의: campaigns.ts에서 ms로 변환) */
  lineGroup: 60,
  /** 고객 통계 — 60초 */
  customerStats: 60,
  /** 업로드 메타데이터 — 10분 */
  uploadMeta: 600,
  /** 업로드 진행상태 — 1시간 */
  uploadProgress: 3600,
  /** 메시지 편집 진행상태 — 10분 */
  messageEditProgress: 600,
  /** 발송결과 차트 데이터 — 진행중 5분 / 완료 24시간 */
  resultChartActive: 300,
  resultChartCompleted: 86400,
};

// ============================================================
// Rate Limit
// ============================================================
export const RATE_LIMITS = {
  /** Rate limit 윈도우 — 1분 */
  windowMs: 60_000,
  /** IP 차단 기준 실패 횟수 */
  ipFailThreshold: 10,
  /** 회사별 분당 최대 요청 */
  companyMaxPerMinute: 60,
};

// ============================================================
// AI 토큰 한도
// ============================================================
export const AI_MAX_TOKENS = {
  /** 필드 매핑 (upload.ts) */
  fieldMapping: 1024,
  /** 브랜드 메시지 생성 */
  brandMessage: 2048,
  /** 타겟 추천 */
  targeting: 1024,
  /** 브리핑 파싱 */
  briefingParse: 1024,
  /** 맞춤 메시지 생성 */
  customMessage: 2048,
  /** 분석 인사이트 */
  analysis: 4096,
  /** AI 인라인 다듬기 (D152+) — 긴 LMS(2000B) 다듬기 시 출력 잘림 차단. D152 운영 진단으로 2048 → 4096 증가. */
  refineMessage: 4096,
};

// ============================================================
// 발송 허용 시간대 (분할발송 오버플로우 방지)
// ============================================================
/**
 * ★ 2026-09-28 한줄로 V2(Harold 지적) — 로그성 기록의 최소 보관 일수. 전송자격인증 4.1(이용자 로그: 접속·인증·발송·과금)·
 * 4.2(시스템 로그: 관리자 행위·장애·개인정보 처리·DB·인증·API) = **1년 이상** 보관(docs/2026-08-18-transmission-qualification-cert.md).
 * 13개월(1년 + 한 달 여유 · 심사 시점 여유). 로그를 기간으로 지우는 정리 작업은 이 값보다 일찍 지우지 않는다.
 */
export const LOG_RETENTION_DAYS = 395;

export const SEND_HOURS = {
  /** 발송 시작 시각 (24시간제) — 이 시간 이전에는 발송하지 않음 */
  start: Number(process.env.SEND_START_HOUR) || 8,
  /** 발송 종료 시각 (24시간제) — 이 시간 이후에는 다음날 start로 이월 */
  end: Number(process.env.SEND_END_HOUR) || 21,
};

/**
 * ★ 2026-09-27 한줄로 V2 m126(Codex NIGHT 1R) — 대량 광고 묶음 적재의 여유 시간.
 * 묶음 시작 판정을 통과해도 조회·적재(1만 건 = 5천 건씩 순차 INSERT)가 창 끝을 넘길 수 있어,
 * 즉시 적재는 「지금 + 이 값」이 창 안일 때만 시작한다. 한 묶음은 보통 수 초라 1분이면 넉넉하다.
 */
export const NIGHT_AD_LOAD_LEAD_MS = 60_000;

/**
 * 브랜드메시지 발송 가능 시간 (KST, 분 단위) — IMC-Agent 매뉴얼 v2.3.1 §3.9.1
 * "친구톡/브랜드메시지는 20:50 ~ 08:00 심야 발송이 불가합니다."
 *
 * 창 밖으로 나간 건은 카카오가 3022(광고 메시지 발송 가능 시간이 아님)로 폐기하는데
 * 그 시점엔 이미 차감이 끝나 있다 — 그래서 적재 전에 막는다.
 * SEND_HOURS(문자 축)와 종료가 10분 다르고 분 단위가 필요해 별도 축으로 둔다.
 */
const BRAND_WINDOW_START_MIN = 8 * 60;        // 08:00 — 포함
const BRAND_WINDOW_END_MIN = 20 * 60 + 50;    // 20:50 — 미포함(마지막 발송 가능 분 = 20:49)

export const BRAND_SEND_WINDOW = {
  /** 08:00 — 포함(이 시각부터 발송 가능) */
  startMinuteOfDay: BRAND_WINDOW_START_MIN,
  /** 20:50 — **미포함**(이 시각부터 금지 구간 시작. 마지막 발송 가능 분은 20:49) */
  endMinuteOfDay: BRAND_WINDOW_END_MIN,
  /**
   * 즉시 발송의 마감 여유(분). 조립 시점에 창 안이어도 **차감·큐 적재를 지나는 동안** 20:50을 넘길 수 있다.
   * 그 사이에 넘기면 문자만 나가고 브랜드는 금지 시각에 적재되므로, 마감 직전 요청은 아예 받지 않는다.
   * 소비처는 이 값을 그대로 쓴다 — 각자 정리하면 근접 판정과 창 판정이 갈린다(0818 7R).
   */
  immediateMarginMinutes: normalizeMarginMinutes(process.env.BRAND_SEND_MARGIN_MIN, 2),
};

/**
 * 마감 여유 정규화 — **안전장치가 조용히 꺼지거나, 채널이 조용히 닫히지 않게** 한다(0818 8R).
 *
 *  · 정확히 `0`만 해제로 본다. `0.5` 같은 양수 소수를 내림하면 **보호가 사라진다** — 올림한다.
 *  · 창 길이(770분) 이상은 `start <= x < end - margin`을 영영 만족 못 시켜 **즉시 발송이 전부 거절**된다.
 *    사용자에게는 "발송 시각을 조정하라"로만 보여 설정이 원인이라는 걸 못 찾는다 → 강등하고 로그로 드러낸다.
 *  · 그 밖(빈값·문자·음수·Infinity)은 기본값.
 */
function normalizeMarginMinutes(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = String(raw).trim();
  if (trimmed === '') return fallback;
  // 해제 판정은 **문자열 단계**에서만 한다 — 숫자로 바꾼 뒤 0을 보면 `-0`과 `1e-999`(underflow)가
  // 양수 표기인데도 보호를 꺼 버린다(0818 9R).
  if (trimmed === '0') return 0;               // 운영자의 명시 해제
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const minutes = Math.ceil(n);                // 양수는 올림 — 0.5를 0으로 깎으면 보호가 없어진다
  const windowLength = BRAND_WINDOW_END_MIN - BRAND_WINDOW_START_MIN;
  if (minutes >= windowLength) {
    console.error(`[설정] BRAND_SEND_MARGIN_MIN=${raw} — 발송 창(${windowLength}분) 이상이라 즉시 발송이 전부 막힌다. 기본값 ${fallback}분으로 강등한다.`);
    return fallback;
  }
  return minutes;
}

// ============================================================
// 기타 제한값
// ============================================================
export const LIMITS = {
  /** Express JSON body 최대 크기 */
  requestBodySize: '50mb',
  /** MMS 이미지 파일 최대 크기 (bytes) */
  mmsImageSize: 300 * 1024,
  /** MMS 이미지 최대 장수 */
  mmsImageCount: 3,
  /** JWT 토큰 만료 */
  jwtExpiry: '24h',
};

// ============================================================
// 공급자(인비토) 사업자 정보 — 청구서·정산서 PDF/이메일에 사용
// ============================================================
export const INVITO_INFO = {
  /** 상호 */
  companyName: process.env.INVITO_COMPANY_NAME || '주식회사 인비토 (INVITO corp.)',
  /** 대표자명 */
  ceoName: process.env.INVITO_CEO_NAME || '유 호 윤',
  /** 사업자등록번호 */
  bizNumber: process.env.INVITO_BIZ_NUMBER || '667-86-00578',
  /** 업태/종목 */
  bizType: process.env.INVITO_BIZ_TYPE || '서비스 / 소프트웨어및앱개발 공급',
  /** 주소 */
  address: process.env.INVITO_ADDRESS || '서울시 송파구 오금로 36길46, 4층',
  /** 대표 연락처 */
  phone: process.env.INVITO_PHONE || '1800-8125',
  /** 대표 이메일 */
  email: process.env.INVITO_EMAIL || 'mobile@invitocorp.com',
};
