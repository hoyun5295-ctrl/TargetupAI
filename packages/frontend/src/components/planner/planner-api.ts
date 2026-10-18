/**
 * planner-api.ts — 마케팅 플래너 화면 공용 타입 · 요청 도우미 (★ 2026-10-04 보강)
 *
 * 타입은 서버 CT의 응답과 거울이다(서버가 진실): 캘린더 = utils/planner-calendar.ts · 확인 본문 = utils/planner-confirm.ts ·
 * 견적 = utils/planner-build.ts. 화면은 판정하지 않고 서버 값을 그린다.
 */
import type { PlannerDisplayState, PlannerSendKind } from '../../constants/planner-status';
import type { LineLayout, LineTemplateId } from '../../utils/one-line';

export type PlannerChannelKey = 'sms' | 'dm' | 'email';
export type Anchor = 'start' | 'end' | 'before_start';
export interface TimingRule { anchor: Anchor; offsetDays?: number; /** ★ 2026-10-18 미룬 날(서버만 쓴다 · 있으면 앵커보다 먼저) */ on?: string }

export interface CalendarTouchpoint {
  id: string; channel: PlannerChannelKey; label: string; timing: TimingRule; scheduledOn: string; status: string;
  lockReason: string | null; approved: boolean; resumable: boolean; sentCount: number | null;
  /** ★ 2026-10-18 쌍 재확인 중(서버 planner-calendar) */
  recheck: { round: number; date: string } | null;
}

/** ★ 2026-10-18 쌍 재확인 화면 본문(서버 utils/planner-recheck.ts buildRecheckView 의 거울 · 링크 · PC 할 일 같은 값) */
export interface RecheckActionState { ok: boolean; reason: string | null }
export interface RecheckView {
  event: { id: string; title: string; startsOn: string; endsOn: string; status: string; companyName: string };
  pair: { carrierId: string; dmId: string | null; round: number; date: string; origin: 'send_day' | 'post_approval' | 'deferred'; deferredFrom: string | null };
  today: string;
  deadline: { date: string; hour: number };
  sendsAt: 'now' | 'morning' | 'date';
  current: { text: string; subject: string; edited: boolean; state: 'blocked' | 'pending' | 'pass' | 'fail' | 'stale' | 'missing'; hash: string | null; rawText: string };
  proposal: { state: 'ready' | 'preparing' | 'failed' | 'unsafe'; text: string; subject: string; hash: string | null };
  dm: { html: string | null } | null;
  recipients: { state: 'known' | 'blocked' | 'error'; count: number | null };
  copyCost: number;
  deferDates: string[];
  nextSend: string | null;
  remaining: Array<{ date: string; label: string }>;
  actions: { approve: RecheckActionState; edit: RecheckActionState; skip: RecheckActionState; defer: RecheckActionState; cancel: RecheckActionState };
  auth: { required: boolean; alive: boolean; maskedPhone: string | null } | null;
  dataSource: string;
}
export type RecheckAction =
  | { kind: 'approve'; choice: 'proposal' | 'current' }
  | { kind: 'edit'; text: string; subject: string }
  | { kind: 'skip' }
  | { kind: 'defer'; toDate: string }
  | { kind: 'cancel' };
export interface PlannerMaterialImage { url: string; width: number | null; height: number | null }
export interface PlannerMaterialProduct {
  source: 'mall' | 'manual'; provider: string | null; code: string | null; name: string;
  price: number | null; salePrice: number | null; discountRate: number | null; url: string | null; imageUrl: string | null;
}
/** ★ 2026-10-18 v2-1 — template = 고른 템플릿(없으면 옛 엔진) · link = 버튼을 누르면 갈 행사 페이지(서버가 http(s)만 받는다) */
export interface PlannerMaterials {
  images: PlannerMaterialImage[]; text: string; licensed: boolean; products: PlannerMaterialProduct[];
  template?: { id: LineTemplateId; layout: LineLayout } | null; link?: string | null;
}
/** ★ 2026-10-18 받는 사람(서버 planner-event PlannerAudience 와 같은 모양 · 없음 = 전체) */
export type PlannerAudience =
  | { kind: 'all' }
  | { kind: 'product_buyers'; door: 'mall' | 'ledger'; keys: string[]; names: string[]; since: string | null };
/** ★ 2026-10-18 한 줄 읽기 결과(서버 planner-line-read · 전부 제안 · 사람이 확인해야 칸이 채워진다) */
export interface PlannerLineRead {
  title: string | null;
  period: { startsOn: string; endsOn: string } | null;
  periodNote: string | null;
  benefit: string | null;
  productTerms: string[];
  audience: { kind: 'all' } | { kind: 'product_buyers'; terms: string[]; allTime: boolean } | { kind: 'unread'; raw: string } | null;
  channels: Array<'sms' | 'dm' | 'email'>;
  unsupported: string[];
}
export interface ObservedProduct { key: string; name: string; buyers: number; orders: number; lastAt: string | null }
export interface AudienceCountState { state: 'known' | 'blocked' | 'error'; count: number | null; reason?: string }
export interface CalendarEvent {
  id: string; title: string; startsOn: string; endsOn: string; benefitText: string | null; status: string;
  displayState: PlannerDisplayState; editable: boolean; todo: boolean; revision: number;
  materials: PlannerMaterials | null; audience?: PlannerAudience | null; staleChannels: Array<'dm' | 'email'>; building: boolean;
  firstSend: string | null; deadline: { date: string; hour: number } | null; notice: string | null;
  closedReason: string | null; migrated: boolean; touchpoints: CalendarTouchpoint[];
}
export interface Holiday { date: string; name: string }
export interface PlannerCalendar {
  month: string; events: CalendarEvent[]; kpi: { todo: number; events: number; balance: number | null };
  migratedTodo: number; holidays: Holiday[]; holidaysReady: boolean;
  /** ★ 2026-10-18 한 줄 입력 · 상품 구매자 대상이 열린 회사 */
  lineEnabled?: boolean;
}

export interface AudienceCount { state: 'known' | 'blocked' | 'error'; count: number | null }
export interface ConfirmSend {
  key: string; scheduledOn: string; kind: PlannerSendKind; why: string; touchpointIds: string[]; status: string; lockReason: string | null;
  recipients: AudienceCount;
  sms: { text: string; subject: string; linkPending: boolean; spam: 'pass' | 'pending' | 'fail' | 'missing'; checkedAt: string | null; error: string | null; edited: boolean; editable: boolean; rawText: string } | null;
  dm: { dmId: string; html: string | null } | null;
  email: { campaignId: string; subject: string; fromName: string; html: string | null } | null;
  result: { sentAt: string | null; sentCount: number | null; successCount: number | null; openCount: number | null; clickCount: number | null } | null;
}
export interface ApprovalQuote {
  total: number; parts: Array<{ key: string; label: string; cost: number }>; creditEnabled: boolean;
  agency: { cycle: number; key: string; paid: boolean; cost: number };
  dm: { dmId: string; source: string; cost: number; charged: boolean } | null;
  email: { campaignId: string; cost: number; completed: boolean } | null;
}
export interface ConfirmView {
  event: { id: string; title: string; startsOn: string; endsOn: string; benefitText: string | null; status: string; displayState: PlannerDisplayState; editable: boolean; revision: number; companyName: string; template?: { id: string; label: string } | null; audience?: { kind: 'all' | 'product_buyers' | 'invalid'; label: string; note: string } };
  firstSend: string | null; sendHour: number; deadline: { date: string; hour: number; daysLeft: number } | null;
  sends: ConfirmSend[]; quote: ApprovalQuote | null; copyCostPerSend: number; carrierCount: number; buildPaid: number;
  balance: number | null; fingerprint: string; approved: { at: string; by: string | null } | null;
  preview: { issuedAt: string; expiresAt: string } | null; dataSource: string;
}
export interface BuildQuote { channel: 'dm' | 'email'; total: number; parts: Array<{ key: string; label: string; cost: number }>; gate: { ok: boolean; missing?: string[] }; creditEnabled: boolean }
export interface Availability { channel: PlannerChannelKey; label: string; available: boolean; reason: string | null; code?: string | null; settingsPath?: string | null; estCredits: number | null }

export interface ApiResult<T = any> { ok: boolean; status: number; data: T & { error?: string; code?: string } }

/**
 * 플래너 API 요청 — 로그인 토큰을 싣고 본문을 JSON으로 받는다(실패해도 던지지 않는다 · 상태로 판정).
 * 경로는 `/api/marketing-planner/…` 전체를 그대로 쓴다(AI 존 기능 보존 검사가 호출처를 글자로 센다).
 */
export async function plannerApi<T = any>(path: string, init?: { method?: string; body?: unknown; auth?: boolean }): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init?.auth !== false) {
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  try {
    const r = await fetch(path, {
      method: init?.method || (init?.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: '네트워크 문제로 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' } as any };
  }
}

/** 오류 응답 → 화면 문장(서버 문장 우선 · 준비 중 · 네트워크) */
export function plannerErrorText(r: ApiResult, fallback: string): string {
  if (r.status === 503 && r.data?.code === 'DB_MIGRATION_PENDING') return '플래너 준비 작업이 진행 중이에요. 몇 분 뒤 다시 시도해 주세요.';
  return String(r.data?.error || fallback);
}

export const won = (n: number) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
