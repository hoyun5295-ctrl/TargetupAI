/**
 * campaign-split-rules.ts — 나눠 보내기(일회성 캠페인 2단계 배분)의 판정 (★ 2026-11-14 C133 F4)
 *   설계서 docs/2026-11-13-hanjul-v3-design.md §6 · §18 「배포 C-3 — 나눠 보내기(F4) 구현 전 흐름 표와 정한 것」
 *
 * DB 를 읽지 않는 판정만 둔다(문안 자격 · 인원 나누기 · 시각 · 승자). 받는 사람 · 발송 · 상태는 campaign-split.ts.
 *   문안 자격 = 화면의 토글 잠금 이유와 서버의 시작 관문이 같은 함수(화면은 서버의 답을 그대로 보여 준다 = 판정 두 벌 0).
 */
import { FIELD_MAP } from './standard-field-map';
import { findVarTokens } from './var-tokens';
import { detectLiquidSyntax } from './liquid-templating';
import { computeBetaCredibleInterval } from './bandit-optimizer';
import { sendableAt } from './send-time-util';
import { listUrlsForTracking } from './short-url';
import { eucKrByteLength, SMS_MAX_BYTES, LMS_MAX_BYTES } from './message-byte';

/** 먼저 보낼 몫(%) · 기다릴 시간 — 담당자가 고른다(기본값 없음 · 설계서 §6-1) */
export const SPLIT_PCTS = [10, 20, 30] as const;
export type SplitPct = (typeof SPLIT_PCTS)[number];
export const SPLIT_WAITS = ['1h', '3h', '6h', 'nextday'] as const;
export type SplitWait = (typeof SPLIT_WAITS)[number];
const WAIT_HOURS: Record<SplitWait, number> = { '1h': 1, '3h': 3, '6h': 6, nextday: 24 };
export const SPLIT_WAIT_LABEL: Record<SplitWait, string> = { '1h': '1시간 뒤', '3h': '3시간 뒤', '6h': '6시간 뒤', nextday: '다음 날 같은 시각' };

export const SPLIT_MIN_VARIANTS = 2;
export const SPLIT_MAX_VARIANTS = 3;
/** 문자 유형 — MMS 는 다루지 않는다(설계서 §6-1) */
export const SPLIT_MSG_TYPES = ['SMS', 'LMS'] as const;
export type SplitMsgType = (typeof SPLIT_MSG_TYPES)[number];

export const isSplitPct = (v: unknown): v is SplitPct => (SPLIT_PCTS as readonly unknown[]).includes(v);
export const isSplitWait = (v: unknown): v is SplitWait => (SPLIT_WAITS as readonly unknown[]).includes(v);
export const isSplitMsgType = (v: unknown): v is SplitMsgType => (SPLIT_MSG_TYPES as readonly unknown[]).includes(v);

/** 문안 이름표(화면 · 캠페인 이름 · 알림이 같은 글자) */
export const splitVariantLabel = (index: number): string => `문안 ${String.fromCharCode(65 + index)}`;

/**
 * 쓸 수 있는 고객 변수 = 이름 변수뿐(정한 것 3).
 *   직접발송 워커는 이 이름들만 적재 표의 이름 칸(고정한 그 고객의 이름)으로 채운다(messageUtils 0단계 · 그 목록의 주인 = FIELD_MAP name ·
 *   계약 시험 direct-send-uploaded-name-1111 이 두 곳을 묶는다). 그 밖의 변수는 번호로 고객을 다시 찾아 넣어 어느 고객의 값인지 정해지지 않는다.
 */
export function splitNameVarNames(): string[] {
  const f = FIELD_MAP.find((x) => x.fieldKey === 'name');
  return f ? [f.displayName, ...(f.aliases || [])] : [];
}

/** 주소 안의 `%XX%` 꼴 가운데 퍼센트 인코딩(16진수 두 자리)은 변수가 아니다 */
const isPercentEncoding = (name: string): boolean => /^[0-9A-Fa-f]{2}$/.test(name);

export interface SplitVariantInput { text: string; subject?: string | null }
export interface SplitIssue { code: string; message: string }

/**
 * 문안 하나가 나눠 보내기에 쓸 수 있는가 — 못 쓰면 이유(첫 하나). 화면의 잠금 이유 = 이 글자 그대로.
 *   ① 본문 있음 ② LMS 면 제목 ③ 조건문 · {{ }} 표기 없음 ④ 본문은 이름 변수만 · 제목은 변수 0 ⑤ 주소가 하나 이상 ⑥ 모든 주소를 새로 줄일 수 있다
 *   (이미 줄인 주소 = 누름을 따로 셀 수 없다) ⑦ 주소 안에 고객 변수가 없다(줄일 때 원문 주소에 박혀 받는 사람마다 채워지지 않는다).
 */
export function splitVariantIssue(v: SplitVariantInput, msgType: SplitMsgType): SplitIssue | null {
  const text = String(v?.text ?? '');
  const subject = String(v?.subject ?? '');
  if (!text.trim()) return { code: 'EMPTY', message: '문안이 비어 있어요.' };
  if (msgType === 'LMS' && !subject.trim()) return { code: 'SUBJECT_REQUIRED', message: 'LMS는 제목이 있어야 해요.' };
  if (detectLiquidSyntax(text) || detectLiquidSyntax(subject)) {
    return { code: 'LIQUID', message: '조건문이나 {{ }} 표기가 든 문안은 나눠 보낼 수 없어요.' };
  }
  const urls = listUrlsForTracking(text);
  const inUrl = (start: number, end: number) => urls.some((u) => start >= u.start && end <= u.end);
  const allowed = new Set(splitNameVarNames());
  // 제목 = 변수 0(직접발송 배관은 제목에 광고 표기만 붙이고 변수를 채우지 않는다 = 이름 변수도 글자 그대로 나간다)
  if (findVarTokens(subject).length > 0) return { code: 'VARS_SUBJECT', message: '제목에는 변수를 쓸 수 없어요. 제목에서 변수를 빼 주세요.' };
  const outside = findVarTokens(text).filter((t) => !inUrl(t.start, t.end));
  const others = [...new Set(outside.filter((t) => !allowed.has(t.name)).map((t) => `%${t.name}%`))];
  if (others.length > 0) {
    return { code: 'VARS', message: `나눠 보내기에는 이름 변수만 쓸 수 있어요. 이 변수를 빼 주세요: ${others.join(', ')}` };
  }
  if (urls.length === 0) return { code: 'NO_LINK', message: '문안에 링크가 있어야 해요. 누른 기기 수로 반응을 재요.' };
  if (urls.some((u) => u.kind !== 'plain')) {
    return { code: 'SHORT_LINK', message: '이미 줄인 주소는 문안별로 따로 셀 수 없어요. 원래 주소를 넣어 주세요.' };
  }
  const varInUrl = findVarTokens(text).some((t) => inUrl(t.start, t.end) && !isPercentEncoding(t.name));
  if (varInUrl || urls.some((u) => u.url.includes('{{') || u.url.includes('{%'))) {
    return { code: 'VAR_IN_LINK', message: '주소 안에 고객 변수가 있으면 나눠 보낼 수 없어요. 주소에서 변수를 빼 주세요.' };
  }
  return null;
}

/**
 * 받는 글의 바이트 한도 — sentText = 광고 표기 · 무료거부 꼬리 · 줄인 주소가 다 들어간 글(이름 변수는 글자 그대로 둔 채 = 결과 창의 바이트 표시와 같은 기준).
 *   SMS 90 · LMS 2000(통신 규격 · message-byte). 넘으면 이유.
 */
export function splitBytesIssue(sentText: string, msgType: SplitMsgType, label: string): SplitIssue | null {
  const bytes = eucKrByteLength(String(sentText ?? ''));
  const max = msgType === 'SMS' ? SMS_MAX_BYTES : LMS_MAX_BYTES;
  if (bytes <= max) return null;
  return msgType === 'SMS'
    ? { code: 'BYTES', message: `${label}: SMS는 ${max}바이트까지예요. 광고 표기와 줄인 주소를 넣으면 ${bytes}바이트예요. 문안을 줄이거나 LMS로 바꿔 주세요.` }
    : { code: 'BYTES', message: `${label}: LMS는 ${max.toLocaleString()}바이트까지예요. 지금 ${bytes.toLocaleString()}바이트예요.` };
}

/** 문안 묶음의 자격 — 개수(2 ~ 3) · 문안마다의 자격 · 같은 글 금지(같은 글끼리는 비교할 것이 없다) */
export function splitVariantsIssue(variants: readonly SplitVariantInput[], msgType: SplitMsgType): { index: number | null; issue: SplitIssue } | null {
  if (!Array.isArray(variants) || variants.length < SPLIT_MIN_VARIANTS || variants.length > SPLIT_MAX_VARIANTS) {
    return { index: null, issue: { code: 'COUNT', message: `문안을 ${SPLIT_MIN_VARIANTS} ~ ${SPLIT_MAX_VARIANTS}개 골라 주세요.` } };
  }
  for (let i = 0; i < variants.length; i += 1) {
    const issue = splitVariantIssue(variants[i], msgType);
    if (issue) return { index: i, issue };
  }
  const seen = new Set<string>();
  for (let i = 0; i < variants.length; i += 1) {
    const key = `${String(variants[i].subject ?? '').trim()}\u0000${String(variants[i].text).trim()}`;
    if (seen.has(key)) return { index: i, issue: { code: 'SAME_COPY', message: '같은 문안이 두 번 들어 있어요.' } };
    seen.add(key);
  }
  return null;
}

export interface SplitSizes { perVariant: number; testTotal: number; rest: number }

/**
 * 인원 나누기 — 먼저 보낼 몫을 문안별로 균등하게(내림) · 나머지 = 그 밖 전부.
 *   문안마다 1명 이상 + 나머지 1명 이상이 안 되면 null(나눌 수 없는 수 · 그 밖의 최소 기준은 두지 않는다 = 정한 것 10).
 */
export function splitSizes(total: number, pct: SplitPct, variantCount: number): SplitSizes | null {
  if (!Number.isInteger(total) || total <= 0 || !isSplitPct(pct)) return null;
  if (!Number.isInteger(variantCount) || variantCount < SPLIT_MIN_VARIANTS || variantCount > SPLIT_MAX_VARIANTS) return null;
  // 정수끼리의 나눗셈 한 번 = 받는 사람을 고정하는 SQL(campaign-split SPLIT_MEMBERS_SQL)의 정수 나눗셈과 같은 값
  const perVariant = Math.floor((total * pct) / (100 * variantCount));
  const testTotal = perVariant * variantCount;
  const rest = total - testTotal;
  return perVariant >= 1 && rest >= 1 ? { perVariant, testTotal, rest } : null;
}

/**
 * 판정 시각 = 시험 묶음이 나가는 시각 + 기다림 · 광고면 발송 창 밖일 때 다음 창의 시작으로(설계서 §6-2 · 판정 = 나머지 발송).
 *   창 판정 = 여정이 쓰는 함수(send-time-util sendableAt) 그대로.
 */
export function splitDecideAt(startAt: Date, wait: SplitWait, isAd: boolean): Date {
  return sendableAt(new Date(startAt.getTime() + WAIT_HOURS[wait] * 3600 * 1000), !isAd);
}

export type SplitVerdict = 'winner' | 'no_difference' | 'not_ready';
export interface SplitArmResult { sent: number | null; devices: number }
export interface SplitJudgement { verdict: SplitVerdict; winnerIndex: number; rates: Array<number | null> }

/**
 * 승자 판정(설계서 §6-1 · 정한 것 1) — 문안마다 누른 기기 수 ÷ 발송 성공 수의 신뢰 구간(밴딧 CT 의 계산 · 사전값 1 · 1)이
 *   **다른 모든 문안과 겹치지 않을 때만** 가장 높은 문안이 이긴다. 아니면 첫 문안(담당자가 맨 앞에 둔 것).
 *   발송 성공 수를 아직 모르는 문안이 하나라도 있으면(결과 확정 전 · 0) 재지 않는다(not_ready). 지어낸 최소 건수 기준은 없다.
 *   누른 기기 수가 발송 성공 수보다 많으면(한 사람의 여러 기기 · 전달) 성공 수로 본다.
 */
export function judgeSplit(arms: readonly SplitArmResult[]): SplitJudgement {
  const rates = arms.map((a) => (a.sent && a.sent > 0 ? Math.min(a.devices, a.sent) / a.sent : null));
  if (arms.length < SPLIT_MIN_VARIANTS || arms.some((a) => !a.sent || a.sent <= 0)) return { verdict: 'not_ready', winnerIndex: 0, rates };
  const ci = arms.map((a) => {
    const hits = Math.max(0, Math.min(a.devices, a.sent as number));
    return computeBetaCredibleInterval(1 + hits, 1 + ((a.sent as number) - hits));
  });
  let best = 0;
  for (let i = 1; i < ci.length; i += 1) if (ci[i].mean > ci[best].mean) best = i;
  const clear = ci.every((c, i) => i === best || ci[best].lower95 > c.upper95);
  return clear ? { verdict: 'winner', winnerIndex: best, rates } : { verdict: 'no_difference', winnerIndex: 0, rates };
}

// ─────────────────────────────────────────────────────────────────────────────
// 화면이 버린 시작 id 의 기억(프로세스 안 · utils/campaign-split discardSplitStart 가 쓴다)
// ─────────────────────────────────────────────────────────────────────────────

/** 닫은 id 를 기억하는 시간 */
export const SPLIT_CLOSED_KEEP_MS = 60 * 60 * 1000;
/** 최대 건수 — 넘치면 가장 먼저 적힌 것부터 잊는다(로그인한 계정이 버리기를 쏟아부어도 기억이 끝없이 자라지 않는다) */
export const SPLIT_CLOSED_MAX = 10_000;

export function rememberClosedStart(closed: Map<string, number>, key: string, at: number): void {
  for (const [k, t] of closed) if (at - t > SPLIT_CLOSED_KEEP_MS || closed.size >= SPLIT_CLOSED_MAX) closed.delete(k);
  closed.set(key, at);
}
