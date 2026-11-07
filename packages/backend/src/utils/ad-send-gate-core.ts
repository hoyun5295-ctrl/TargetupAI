/**
 * CT: ad-send-gate-core.ts — 광고 관문 순수 규칙(★ 2026-11-06 C110 · 설계서 docs/2026-11-06-c110-effect-proof-priority-design.md §3)
 *
 * DB import 0 — 갈래 이름 표 · 회사 순서 정규화 · 순위 · 대조군 비율 정규화 · 추첨 하한(D11)을 한 곳에 둔다.
 * 화면 사본 = frontend/src/utils/ad-branch.ts(갈래 키 · 이름 · 기본 순서 · 대조 시험 c110-contract-1106).
 */

/** 광고 갈래 — 기본 순서(D8 · 회사가 켤 때 처음 값) */
export const AD_BRANCHES = ['journey', 'planner', 'agency', 'automarketing', 'ai', 'dm', 'direct'] as const;
export type AdBranch = (typeof AD_BRANCHES)[number];

export const AD_BRANCH_LABEL: Record<AdBranch, string> = {
  journey: '여정',
  planner: '마케팅 플래너',
  agency: '대행 발송',
  automarketing: '자동 마케팅',
  ai: 'AI 캠페인',
  dm: 'DM 발송',
  direct: '직접 발송',
};

export function isAdBranch(v: unknown): v is AdBranch {
  return typeof v === 'string' && (AD_BRANCHES as readonly string[]).includes(v);
}

/** 직접 발송 배관(/direct-send · commit)의 갈래 — 'operator'(AI 한줄로 · 오퍼레이터 화면) = AI 캠페인 · 그 밖 = 직접 발송(§4) */
export function branchOfDirect(sendType: unknown): AdBranch {
  return sendType === 'operator' ? 'ai' : 'direct';
}

/**
 * 회사 순서 정규화 — 일곱 갈래가 정확히 한 번씩일 때만 켜짐(배열 그대로) · 그 밖(NULL · 빠짐 · 중복 · 모르는 값) = null(꺼짐).
 * 저장 때(routes/companies.ts)도 같은 함수로 거른다 — 반쯤 맞는 순서가 판정에 들어가지 않게.
 */
export function normalizePriorityOrder(raw: unknown): AdBranch[] | null {
  if (!Array.isArray(raw) || raw.length !== AD_BRANCHES.length) return null;
  const seen = new Set<string>();
  for (const v of raw) {
    if (!isAdBranch(v) || seen.has(v)) return null;
    seen.add(v);
  }
  return raw as AdBranch[];
}

/** 회사 순서에서 branch 보다 **더 높은**(앞의) 갈래들 */
export function higherBranches(order: readonly AdBranch[], branch: AdBranch): AdBranch[] {
  const i = order.indexOf(branch);
  return i <= 0 ? [] : order.slice(0, i);
}

/** 전체 대조군 비율 1 ~ 10 · 발송별 1 ~ 30 · 그 밖 = 0(꺼짐 · DDL CHECK 와 같은 범위) */
export function normalizeHoldoutPct(raw: unknown, max: 10 | 30): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  const i = Math.floor(n);
  return i >= 1 && i <= max ? i : 0;
}

/**
 * 회사 설정 저장 문장(★ 구현 1R #1 · 순수 · 보낸 칸만) — 전체 대조군 비율이 바뀌면 새 비교 기간(since = 지금 · 끄면 NULL · D3).
 * 순서 값이 틀리면 throw(라우트가 400) · 보낸 칸이 없으면 null.
 */
export function buildAdGateSettingsUpdate(companyId: string, body: { global_holdout_pct?: unknown; campaign_holdout_pct?: unknown; send_priority_order?: unknown }, onlyIf?: string)
  : { sql: string; params: unknown[] } | null {
  const sets: string[] = [];
  const params: unknown[] = [companyId];
  if (body.global_holdout_pct !== undefined) {
    params.push(normalizeHoldoutPct(body.global_holdout_pct, 10) || null);
    const i = params.length;
    sets.push(`global_holdout_since = CASE WHEN $${i}::smallint IS NULL THEN NULL WHEN global_holdout_pct IS DISTINCT FROM $${i}::smallint THEN NOW() ELSE global_holdout_since END`);
    sets.push(`global_holdout_pct = $${i}::smallint`);
  }
  if (body.campaign_holdout_pct !== undefined) {
    params.push(normalizeHoldoutPct(body.campaign_holdout_pct, 30) || null);
    sets.push(`campaign_holdout_pct = $${params.length}::smallint`);
  }
  if (body.send_priority_order !== undefined) {
    let order: AdBranch[] | null = null;
    if (body.send_priority_order !== null) {
      order = normalizePriorityOrder(body.send_priority_order);
      if (!order) throw new Error('INVALID_PRIORITY_ORDER');
    }
    params.push(order);
    sets.push(`send_priority_order = $${params.length}::text[]`);
  }
  if (sets.length === 0) return null;
  // onlyIf = 같은 문장의 조건(별칭 c · ★ C113 구현 1R #7 요금제 판정을 쓰는 순간에)
  return { sql: `UPDATE companies c SET ${sets.join(', ')}, updated_at = NOW() WHERE c.id = $1${onlyIf ? ` AND ${onlyIf}` : ''}`, params };
}

/** D11 — 발송별 대조군은 (적격 번호 수 × pct ≥ 3000 = 기대 대조군 30명)일 때만 뽑는다 */
export const CAMPAIGN_HOLDOUT_MIN_CONTROL = 30;
export function campaignHoldoutDrawable(eligibleCount: number, pct: number): boolean {
  return pct > 0 && eligibleCount * pct >= CAMPAIGN_HOLDOUT_MIN_CONTROL * 100;
}

/**
 * 관문이 빼는 이유 = 새 기능 셋뿐(★ 2026-11-07 C113 D23 · 피로도는 입구마다 HEAD 피로도 블록이 그대로 한다 · 관문은 피로도를 보지 않는다).
 * 원장 종류 목록의 원천 = DDL CHECK(배포 원장 C110-DDL-1) · 'fatigue' 종류는 DDL 에 남지만 쓰는 곳 0.
 */
export type AdExcludeReason = 'global_holdout' | 'priority' | 'campaign_holdout';

/** 고객 이력 · 안내 문구(§6-6 · 같은 말 한 곳 · ★ C113 D17 가운뎃점 0) */
export const AD_EXCLUDE_LABEL: Record<AdExcludeReason, string> = {
  global_holdout: '광고 제외(전체 대조군)',
  campaign_holdout: '광고 제외(이 발송 대조군)',
  priority: '광고 제외(같은 날 더 높은 순위 광고)',
};

export interface AdGateCounts { global_holdout: number; priority: number; campaign_holdout: number }
export function emptyAdGateCounts(): AdGateCounts {
  return { global_holdout: 0, priority: 0, campaign_holdout: 0 };
}
export function totalExcluded(c: AdGateCounts): number {
  return c.global_holdout + c.priority + c.campaign_holdout;
}

/** 발송 안내 한 줄(§4 알림) — 빠진 수 0 = 빈 문자열 · 이음 = 쉼표(★ C113 D17) */
export function adGateNotice(c: AdGateCounts): string {
  const parts: string[] = [];
  if (c.global_holdout + c.campaign_holdout > 0) parts.push(`대조군 ${c.global_holdout + c.campaign_holdout}명`);
  if (c.priority > 0) parts.push(`우선순위 ${c.priority}명`);
  return parts.length === 0 ? '' : `${parts.join(', ')}을 뺐습니다.`;
}

/** 예약의 살아 있음 — 확정 전 수명(§3-4) */
export const AD_RESERVATION_UNCONFIRMED_HOURS = 2;

/** KST 날짜 목록(span 의 날 전부 · 오름차순 · 잠금 순서 = 이 순서) */
export function kstDaysInSpan(from: string, to: string): string[] {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to) || from > to) return re.test(from) ? [from] : [];
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 31) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
