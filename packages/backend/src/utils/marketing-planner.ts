/**
 * marketing-planner.ts — 마케팅 플래너 CT (★ 2026-08-12 Phase 1 · 설계서 = docs/2026-08-12-ax-marketing-planner-design.md)
 *
 * 이 파일이 소유하는 것 = 플래너의 **판정 규칙 전부**:
 *   행사 입력 검증 · 터치포인트(채널×시점) 검증 · 발송 예정일 계산(순수) · 예상 제작 크레딧 산식.
 * 라우트(routes/marketing-planner.ts)는 이 CT를 부르기만 한다 — 인라인 판정 금지.
 *
 * ⛔ 불변 (설계서 §1·§4)
 *   - 혜택은 고객사 기입 verbatim — 여기서 생성·보정하지 않는다.
 *   - 예상 크레딧은 **소재 제작분만** 센다. 문자·알림톡 문안은 실행 축(당일 생성·검수 대행) 과금이라
 *     여기서 0으로 두되 화면이 "실행 시 별도"로 말한다 — 0을 "공짜"로 읽히게 두지 않는다.
 *   - 단가의 진실 = `getCreditCost`(ai-credit-calc) 하나. 여기 숫자를 쓰지 않는다.
 */
import { getCreditCost } from './ai-credit-calc';

// ── 채널 축 ──────────────────────────────────────────────────────────
export const PLANNER_CHANNELS = ['sms', 'alimtalk', 'email', 'dm', 'inapp'] as const;
export type PlannerChannel = (typeof PLANNER_CHANNELS)[number];

export const PLANNER_CHANNEL_LABEL: Record<PlannerChannel, string> = {
  sms: '메시징(문자)',
  alimtalk: '알림톡(정보성 안내)',
  email: '이메일 브로마이드',
  dm: '모바일 DM',
  inapp: '인앱 메시지',
};

// ── 시점 규칙 ────────────────────────────────────────────────────────
/** 시점 앵커 — 행사 시작일 / 종료일 / 시작 D-N일(사전 안내). */
export type TimingAnchor = 'start' | 'end' | 'before_start';

export interface TimingRule {
  anchor: TimingAnchor;
  /** before_start일 때만 의미. 1~30. */
  offsetDays?: number;
}

/**
 * (순수) 터치포인트 발송 예정일 — 'YYYY-MM-DD' 문자열 연산만 한다.
 * Date 타임존 변환을 섞으면 KST 자정 경계에서 하루가 밀린다(문자열 in → 문자열 out).
 */
export function computeTouchpointDate(rule: TimingRule, startsOn: string, endsOn: string): string {
  if (rule.anchor === 'end') return endsOn;
  if (rule.anchor === 'before_start') {
    const d = new Date(`${startsOn}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (rule.offsetDays || 0));
    return d.toISOString().slice(0, 10);
  }
  return startsOn;
}

// ── 예상 제작 크레딧 ─────────────────────────────────────────────────
/**
 * 채널별 소재 제작 크레딧(승인 화면 표시용 — 설계서 §3-2 단가표의 코드판).
 * null = "실행 시 별도 과금"(문자 당일 생성·알림톡 검수 대행) — 0과 다르다.
 */
export function estimateChannelCredits(channel: PlannerChannel): number | null {
  switch (channel) {
    case 'email':
      return getCreditCost('email-campaign-complete');
    case 'dm':
      // AI 생성 + 발행이 한 세트다(설계서 §3-2 — 5 + 100).
      return getCreditCost('dm-ai-generate') + getCreditCost('dm-builder');
    case 'inapp':
      return getCreditCost('inapp-publish');
    case 'sms':
    case 'alimtalk':
      return null;
  }
}

/** (순수) 터치포인트 목록의 예상 제작 크레딧 합계 — null(실행 축)은 합계에 안 들어간다. */
export function sumEstimatedCredits(channels: PlannerChannel[]): number {
  return channels.reduce((sum, ch) => sum + (estimateChannelCredits(ch) ?? 0), 0);
}

// ── 입력 검증 ────────────────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

export interface PlannerEventInput {
  title: string;
  startsOn: string;
  endsOn: string;
  benefitText: string | null;
  /** 상품명 목록(Phase 1 = 수동 기입. 몰 피커 연결은 제작 단계 §4-2) */
  products: Array<{ name: string }>;
  touchpoints: Array<{ channel: PlannerChannel; timing: TimingRule; format: string | null }>;
}

export type ParseResult = { ok: true; value: PlannerEventInput; planMonth: string } | { ok: false; error: string };

/** 행사 + 터치포인트 입력 전체 검증. 실패는 사용자에게 그대로 보일 문장으로 돌려준다. */
export function parsePlannerEventInput(body: any): ParseResult {
  const title = String(body?.title ?? '').trim();
  if (!title) return { ok: false, error: '행사명을 입력해 주세요.' };
  if (title.length > 120) return { ok: false, error: '행사명은 120자 이내로 입력해 주세요.' };

  const startsOn = String(body?.startsOn ?? '').trim();
  const endsOn = String(body?.endsOn ?? '').trim();
  if (!DATE_RE.test(startsOn) || !DATE_RE.test(endsOn)) {
    return { ok: false, error: '행사 기간을 선택해 주세요.' };
  }
  if (endsOn < startsOn) return { ok: false, error: '종료일이 시작일보다 빠릅니다.' };

  const benefitRaw = String(body?.benefitText ?? '').trim();
  if (benefitRaw.length > 300) return { ok: false, error: '혜택 문구는 300자 이내로 입력해 주세요.' };

  const productsRaw = Array.isArray(body?.products) ? body.products : [];
  const products = productsRaw
    .map((p: any) => ({ name: String(p?.name ?? p ?? '').trim().slice(0, 120) }))
    .filter((p: { name: string }) => p.name.length > 0)
    .slice(0, 30);

  const tpRaw = Array.isArray(body?.touchpoints) ? body.touchpoints : [];
  if (tpRaw.length === 0) return { ok: false, error: '채널을 1개 이상 선택해 주세요.' };
  if (tpRaw.length > 20) return { ok: false, error: '터치포인트는 20개 이내로 구성해 주세요.' };

  const touchpoints: PlannerEventInput['touchpoints'] = [];
  for (const t of tpRaw) {
    const channel = String(t?.channel ?? '').trim() as PlannerChannel;
    if (!PLANNER_CHANNELS.includes(channel)) {
      return { ok: false, error: '지원하지 않는 채널이 있습니다.' };
    }
    const anchor = String(t?.timing?.anchor ?? '').trim() as TimingAnchor;
    if (!['start', 'end', 'before_start'].includes(anchor)) {
      return { ok: false, error: '발송 시점을 선택해 주세요.' };
    }
    let offsetDays: number | undefined;
    if (anchor === 'before_start') {
      offsetDays = Math.floor(Number(t?.timing?.offsetDays));
      if (!Number.isFinite(offsetDays) || offsetDays < 1 || offsetDays > 30) {
        return { ok: false, error: '사전 안내는 시작 1~30일 전 사이로 선택해 주세요.' };
      }
    }
    touchpoints.push({
      channel,
      timing: { anchor, ...(offsetDays ? { offsetDays } : {}) },
      format: t?.format ? String(t.format).trim().slice(0, 30) : null,
    });
  }

  // 같은 채널·같은 시점 중복 = 이중 발송 예약 — 기입 단계에서 막는다.
  const seen = new Set<string>();
  for (const t of touchpoints) {
    const key = `${t.channel}:${t.timing.anchor}:${t.timing.offsetDays || 0}`;
    if (seen.has(key)) return { ok: false, error: '같은 채널의 같은 시점이 중복 선택됐습니다.' };
    seen.add(key);
  }

  return {
    ok: true,
    value: { title, startsOn, endsOn, benefitText: benefitRaw || null, products, touchpoints },
    planMonth: startsOn.slice(0, 7),
  };
}

/** 월 파라미터 검증 — 어긋나면 null(전체 조회로 떨어뜨리지 않는다 — 플래너는 월 단위 화면이다). */
export function parsePlanMonth(v: any): string | null {
  const s = String(v ?? '').trim();
  return MONTH_RE.test(s) ? s : null;
}
