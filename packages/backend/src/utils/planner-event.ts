/**
 * planner-event.ts — 플래너 행사 원장 접근 + 화면 상태 판정 CT (★ 2026-10-04 보강 · 설계서 §5-1 · §6-1 · §8)
 *
 * 이 파일이 소유하는 것:
 *   행사 1건 읽기(meta 포함) · 회사·작성자 범위 · 재료 정규화 · 재료 지문 · 리비전 · **화면 상태(displayState)와 editable** 판정.
 * 화면은 상태를 스스로 계산하지 않는다 — 서버가 행사마다 `displayState`·`editable`을 준다(설계서 §5-1 · F5 · F10).
 *
 * ⛔ meta(jsonb)는 배포 뒤 DDL이다. 읽기·쓰기는 호출부가 `requirePlannerMeta()`로 먼저 확인한다(없으면 503).
 * ⛔ 상태는 DB CHECK 안에서만 움직인다(DDL 0) — 행사 draft·briefed·approved·scheduled·done·reported·cancelled(+옛 producing·re_brief).
 */
import { createHash } from 'crypto';
import { pool, query } from '../config/database';
import { isCompanyImageUrl, isBuildMallProvider, AI_AUTO_BUILD_CARD_IMAGES, AI_AUTO_BUILD_PRODUCTS_MAX } from './ai-auto-build-materials';
import { computeTouchpointDate, estimateChannelCredits, PlannerChannel, PlannerEventInput, TimingRule } from './marketing-planner';
import { timingKey } from './planner-execution';

// ── 재료 ─────────────────────────────────────────────────────────────
export interface PlannerMaterialImage { url: string; width: number | null; height: number | null }
export interface PlannerMaterialProduct {
  source: 'mall' | 'manual';
  provider: string | null;
  code: string | null;
  name: string;
  price: number | null;
  salePrice: number | null;
  discountRate: number | null;
  url: string | null;
  imageUrl: string | null;
}
/** 모바일 DM·메일이 함께 쓰는 재료 1벌(설계서 §5-2) — 사진·글(이 문구 그대로 쓰기)·몰/글줄 상품. */
export interface PlannerMaterials {
  images: PlannerMaterialImage[];
  text: string;
  licensed: boolean;
  products: PlannerMaterialProduct[];
}

export const PLANNER_MATERIAL_TEXT_MAX = 2000;

const int = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};
const str = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

/**
 * (순수) 재료 정규화 — 화면 값을 그대로 저장하지 않는다.
 * 사진 = 이 회사 서빙 경로만(엔진 계약과 같은 판정) · 상품 = 몰(허용 공급자) 또는 글줄 · 상한 = 엔진 상한과 같은 값.
 * 실패는 사용자 문장. 빈 재료는 유효하다(재료 없이 담고 나중에 넣을 수 있다 = "재료만 담기").
 */
export function normalizePlannerMaterials(raw: unknown, companyId: string): { ok: true; value: PlannerMaterials } | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const imagesRaw = Array.isArray(r.images) ? r.images : [];
  const images: PlannerMaterialImage[] = [];
  for (const im of imagesRaw) {
    const url = str((im as any)?.url, 500);
    if (!url) continue;
    if (!isCompanyImageUrl(url, companyId)) return { ok: false, error: '사진은 이 화면에서 올린 사진만 쓸 수 있습니다. 다시 올려 주세요.' };
    if (images.some((x) => x.url === url)) continue;
    images.push({ url, width: int((im as any)?.width), height: int((im as any)?.height) });
  }
  if (images.length > AI_AUTO_BUILD_CARD_IMAGES) return { ok: false, error: `사진은 ${AI_AUTO_BUILD_CARD_IMAGES}장까지 넣을 수 있습니다.` };
  const text = str(r.text, PLANNER_MATERIAL_TEXT_MAX + 1);
  if (text.length > PLANNER_MATERIAL_TEXT_MAX) return { ok: false, error: `글은 ${PLANNER_MATERIAL_TEXT_MAX.toLocaleString()}자까지 적을 수 있습니다.` };
  const productsRaw = Array.isArray(r.products) ? r.products : [];
  const products: PlannerMaterialProduct[] = [];
  for (const p of productsRaw) {
    const name = str((p as any)?.name, 120);
    if (!name) continue;
    const provider = str((p as any)?.provider, 120);
    const isMall = String((p as any)?.source) === 'mall' && !!provider && isBuildMallProvider(provider);
    products.push({
      source: isMall ? 'mall' : 'manual',
      provider: isMall ? provider : null,
      code: isMall ? str((p as any)?.code, 60) || null : null,
      name,
      price: int((p as any)?.price),
      salePrice: int((p as any)?.salePrice),
      discountRate: int((p as any)?.discountRate),
      url: str((p as any)?.url, 500) || null,
      // 상품 사진은 몰 사진만(엔진 불변 — 글줄 상품의 사진 주소는 버린다)
      imageUrl: isMall ? (str((p as any)?.imageUrl, 500) || null) : null,
    });
  }
  if (products.length > AI_AUTO_BUILD_PRODUCTS_MAX) return { ok: false, error: `상품은 ${AI_AUTO_BUILD_PRODUCTS_MAX}개까지 담을 수 있습니다.` };
  return { ok: true, value: { images, text, licensed: r.licensed === true && text.length > 0, products } };
}

/** (순수) 재료가 하나라도 있는가 — 비면 완성본을 만들 수 없다(재료 필요). */
export function hasAnyMaterial(m: PlannerMaterials | null | undefined): boolean {
  return !!m && (m.images.length > 0 || m.text.trim().length > 0 || m.products.length > 0);
}

/** (순수) 재료 지문 — 재료가 바뀌면 이미 만든 완성본은 낡은 것이다(다시 만들기 대상). */
export function plannerMaterialsHash(m: PlannerMaterials | null | undefined): string {
  const canon = m ? {
    i: m.images.map((x) => x.url),
    t: m.text,
    l: m.licensed,
    p: m.products.map((x) => [x.source, x.provider, x.code, x.name, x.price, x.salePrice, x.discountRate, x.url, x.imageUrl]),
  } : null;
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex').slice(0, 32);
}

/**
 * (순수) 완성본 입력 지문(★ 2026-10-04 Codex 1R H9) — 재료 + 행사 사실(행사명 · 기간 · 혜택).
 * 생성 엔진의 첫 카드가 행사 행 원본으로 조립되므로, 행사 사실만 고쳐도 이미 만든 완성본은 옛 내용이다(다시 만들기 대상).
 * 생성 기록(meta.build[채널].materialsHash)과 낡음 판정(staleBuildChannels)이 이 함수 하나를 쓴다.
 */
export function plannerBuildInputHash(
  ev: Pick<PlannerEventRow, 'title' | 'startsOn' | 'endsOn' | 'benefitText'>,
  m: PlannerMaterials | null | undefined,
): string {
  return createHash('sha256')
    .update(JSON.stringify([plannerMaterialsHash(m), ev.title, ev.startsOn, ev.endsOn, ev.benefitText || '']))
    .digest('hex').slice(0, 32);
}

// ── meta ─────────────────────────────────────────────────────────────
export interface PlannerBuildRecord { token: string; draftId: string; materialsHash: string; builtAt: string }
export interface PlannerPreviewRecord { tokenHash: string; revision: number; issuedAt: string; expiresAt: string; remindedAt?: string | null }
export interface PlannerEventMeta {
  materials?: PlannerMaterials | null;
  build?: Partial<Record<'dm' | 'email', PlannerBuildRecord>>;
  /** 완성본을 만드는 중(채널·시작 시각) — 창을 닫아도 캘린더가 "제작 중"을 말한다. 10분 넘으면 낡은 표식으로 본다. */
  building?: { channels: string[]; at: string } | null;
  /** 내용이 바뀔 때마다 오른다 — 확인 링크·승인 지문의 기준 */
  revision?: number;
  preview?: PlannerPreviewRecord | null;
  approved?: { hash: string; at: string; by: string | null; revision: number } | null;
  /** 1회 안내(결재 방식 전환) 등 그 밖의 표식 */
  [key: string]: unknown;
}

export interface PlannerEventRow {
  id: string;
  companyId: string;
  planMonth: string;
  title: string;
  startsOn: string;
  endsOn: string;
  benefitText: string | null;
  products: Array<{ name: string }>;
  status: string;
  createdBy: string | null;
  meta: PlannerEventMeta;
}

export function mapEventRow(r: any): PlannerEventRow {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    planMonth: String(r.plan_month),
    title: String(r.title),
    startsOn: String(r.starts_on).slice(0, 10),
    endsOn: String(r.ends_on).slice(0, 10),
    benefitText: r.benefit_text ?? null,
    products: Array.isArray(r.products) ? r.products : [],
    status: String(r.status),
    createdBy: r.created_by ? String(r.created_by) : null,
    meta: (r.meta && typeof r.meta === 'object') ? r.meta : {},
  };
}

const EVENT_COLS = `id, company_id, plan_month, title, starts_on::text AS starts_on, ends_on::text AS ends_on,
            benefit_text, products, status, created_by, meta`;

/**
 * 행사 1건(회사 경계 + 작성자 범위). `ownerId` = null이면 회사 전체(관리자) · 값이면 그 계정이 만든 행사만(담당자 · §3-10).
 * ⛔ meta 칸이 없으면 42703으로 던진다 — 호출부가 requirePlannerMeta()로 먼저 거른다.
 */
export async function loadPlannerEvent(companyId: string, eventId: string, ownerId: string | null = null): Promise<PlannerEventRow | null> {
  const params: any[] = [eventId, companyId];
  let owner = '';
  if (ownerId) {
    params.push(ownerId);
    owner = ` AND created_by::text = $3::text`;
  }
  const r = await query(`SELECT ${EVENT_COLS} FROM planner_events WHERE id = $1::uuid AND company_id = $2::uuid${owner}`, params);
  return r.rows[0] ? mapEventRow(r.rows[0]) : null;
}

/** 그 달 행사(취소 포함 · 화면이 "취소됨"으로 그린다 · 무슨 일이 있었는지 남긴다) — 작성자 범위 같은 규칙. */
export async function listPlannerEvents(companyId: string, planMonth: string, ownerId: string | null): Promise<PlannerEventRow[]> {
  const params: any[] = [companyId, planMonth];
  let owner = '';
  if (ownerId) {
    params.push(ownerId);
    owner = ` AND created_by::text = $3::text`;
  }
  const r = await query(
    `SELECT ${EVENT_COLS} FROM planner_events
      WHERE company_id = $1::uuid AND plan_month = $2${owner}
      ORDER BY starts_on ASC, created_at ASC`,
    params,
  );
  return (r.rows as any[]).map(mapEventRow);
}

/**
 * meta 병합(조건부) — 효과(RETURNING)로만 성공 판정. `fromStatuses`가 있으면 그 상태일 때만 쓴다(조용한 덮어쓰기 금지).
 * `nullKeys` = 지울 키(예: preview 폐기).
 */
export async function patchEventMeta(input: {
  companyId: string;
  eventId: string;
  patch?: Record<string, unknown>;
  nullKeys?: string[];
  fromStatuses?: string[];
  status?: string;
  bumpRevision?: boolean;
}): Promise<PlannerEventRow | null> {
  const params: any[] = [input.eventId, input.companyId, JSON.stringify(input.patch || {}), input.nullKeys || []];
  const sets = [
    `meta = (COALESCE(meta, '{}'::jsonb) - $4::text[]) || $3::jsonb${input.bumpRevision ? ` || jsonb_build_object('revision', COALESCE((meta->>'revision')::int, 0) + 1)` : ''}`,
    'updated_at = NOW()',
  ];
  if (input.status) {
    params.push(input.status);
    sets.push(`status = $${params.length}`);
  }
  let guard = '';
  if (input.fromStatuses && input.fromStatuses.length > 0) {
    params.push(input.fromStatuses);
    guard = ` AND status = ANY($${params.length})`;
  }
  const r = await query(
    `UPDATE planner_events SET ${sets.join(', ')}
      WHERE id = $1::uuid AND company_id = $2::uuid${guard}
      RETURNING ${EVENT_COLS}`,
    params,
  );
  return r.rows[0] ? mapEventRow(r.rows[0]) : null;
}

// ── 화면 상태 ─────────────────────────────────────────────────────────
/** 소재(완성본)를 만드는 채널 — 문자는 문안을 워커가 만든다. */
export const PLANNER_BUILD_CHANNELS: Array<'dm' | 'email'> = ['dm', 'email'];
export function isBuildChannel(ch: string): ch is 'dm' | 'email' {
  return ch === 'dm' || ch === 'email';
}

export type PlannerDisplayState = 'material' | 'making' | 'review' | 'approved' | 'done' | 'hold' | 'cancelled';

export interface DisplayTouchpoint {
  id: string;
  channel: PlannerChannel;
  timing: TimingRule;
  status: string;
  assetRef: string | null;
  execMeta: Record<string, any>;
}

const BUILDING_STALE_MS = 10 * 60 * 1000;

/** (순수) 완성본을 만드는 중인가 — 표식이 10분을 넘으면 낡은 것(요청이 끊겼다)으로 본다. */
export function isBuilding(meta: PlannerEventMeta, now: Date = new Date()): boolean {
  const b = meta.building;
  if (!b || !b.at) return false;
  const t = new Date(String(b.at)).getTime();
  return Number.isFinite(t) && now.getTime() - t < BUILDING_STALE_MS;
}

/** (순수) 소재 채널 중 완성본이 없거나 재료가 바뀌어 낡은 채널 — 비면 소재 준비 끝. */
export function staleBuildChannels(ev: Pick<PlannerEventRow, 'meta' | 'title' | 'startsOn' | 'endsOn' | 'benefitText'>, tps: DisplayTouchpoint[]): Array<'dm' | 'email'> {
  const out: Array<'dm' | 'email'> = [];
  const materialsHash = plannerBuildInputHash(ev, ev.meta.materials || null);
  for (const ch of PLANNER_BUILD_CHANNELS) {
    const mine = tps.filter((t) => t.channel === ch && t.status !== 'skipped');
    if (mine.length === 0) continue;
    const rec = ev.meta.build?.[ch];
    const attached = mine.every((t) => !!t.assetRef && (!rec || t.assetRef === rec.draftId));
    if (!rec || !attached || rec.materialsHash !== materialsHash) out.push(ch);
  }
  return out;
}

/**
 * (순수) 행사 화면 상태 — 상태 사전 1벌의 키(설계서 §5-1).
 *  재료 필요(material) · 제작 중(making = 완성본·문안 준비) · 확인 대기(review) · 승인됨(approved) · 발송 완료(done) · 보류(hold) · 취소(cancelled).
 *  할 일 = material · review · hold(앰버).
 */
export function computeDisplayState(ev: Pick<PlannerEventRow, 'status' | 'meta' | 'title' | 'startsOn' | 'endsOn' | 'benefitText'>, tps: DisplayTouchpoint[], now: Date = new Date()): PlannerDisplayState {
  const s = ev.status;
  if (s === 'cancelled') return 'cancelled';
  if (s === 'done' || s === 'reported') return 'done';
  const held = tps.some((t) => t.status === 'hold_credit' || t.status === 'locked');
  if (s === 'approved' || s === 'scheduled' || s === 'producing') return held ? 'hold' : 'approved';
  if (held) return 'hold';
  if (s === 'briefed') return 'review';
  // draft · re_brief(옛 값) — 소재가 없으면 재료 필요, 만드는 중이거나 소재가 다 있으면(문안 준비) 제작 중
  if (isBuilding(ev.meta, now)) return 'making';
  return staleBuildChannels(ev, tps).length > 0 ? 'material' : 'making';
}

/** (순수) 고칠 수 있는가 — 승인 뒤에는 읽기 전용(F10 · 서버가 판정하고 화면은 따른다). */
export function isEventEditable(status: string): boolean {
  return status === 'draft' || status === 'briefed' || status === 're_brief';
}

/** (순수) 남은 첫 발송일 — 아직 나가지 않은 접점(생략·발송 완료 제외) 예정일 중 가장 이른 날. 없으면 null. 승인 마감·링크 발급의 기준. */
export function firstSendDate(ev: Pick<PlannerEventRow, 'startsOn' | 'endsOn'>, tps: Array<Pick<DisplayTouchpoint, 'timing' | 'status'>>): string | null {
  const dates = tps.filter((t) => t.status !== 'skipped' && t.status !== 'sent').map((t) => computeTouchpointDate(t.timing, ev.startsOn, ev.endsOn)).sort();
  return dates[0] || null;
}

// ── 저장(행사 + 접점 upsert) ─────────────────────────────────────────
export class PlannerEventWriteError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'PlannerEventWriteError';
  }
}

/** (순수) 접점 동일성 키 = 채널 + 시점(앵커·오프셋·대상) — 같은 키면 같은 접점이다(완성본·문안·각인을 잃지 않는다). */
export function touchpointKey(channel: string, timing: TimingRule | null | undefined): string {
  return `${channel}:${timingKey(timing)}`;
}

/** (순수) 행사 내용 지문 — 행사명·기간·혜택·상품·접점 구성. 바뀌면 리비전이 오르고 확인 링크가 폐기된다. */
export function eventContentHash(v: Pick<PlannerEventInput, 'title' | 'startsOn' | 'endsOn' | 'benefitText' | 'products' | 'touchpoints'>): string {
  const canon = {
    t: v.title, s: v.startsOn, e: v.endsOn, b: v.benefitText || '',
    p: (v.products || []).map((x) => x.name),
    c: v.touchpoints.map((t) => touchpointKey(t.channel, t.timing)).sort(),
  };
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex').slice(0, 32);
}

/**
 * 행사 저장 — 한 트랜잭션(행사만 남고 접점이 유실되는 반쪽 저장 차단).
 * ★ 2026-10-04 §6-2 — 접점은 **(채널·시점) 기준 upsert**다. 옛 DELETE+INSERT는 수정할 때마다 접점 id가 바뀌어
 *   붙어 있던 완성본(asset_ref)·문안·생성비 기록을 잃었다. 사라진 접점만 지우고, 새 접점은 그 채널의 현재 완성본을 함께 쓴다(DM 여러 시점 = 같은 DM).
 * 승인 뒤(approved~)는 고칠 수 없다(NOT_EDITABLE · F10). 내용·재료가 바뀌면 리비전을 올리고 확인 링크를 폐기하며 확인 대기 → 재료 단계로 되돌린다.
 * `materials` undefined = 재료는 그대로(행사 정보만 고침).
 */
export async function savePlannerEvent(input: {
  companyId: string;
  userId: string | null;
  ownerId: string | null;
  value: PlannerEventInput;
  planMonth: string;
  materials?: PlannerMaterials;
  eventId?: string;
}): Promise<{ id: string; changed: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const v = input.value;
    let eventId = input.eventId || '';
    let changed = true;
    let meta: PlannerEventMeta = {};
    if (eventId) {
      const params: any[] = [eventId, input.companyId];
      let owner = '';
      if (input.ownerId) { params.push(input.ownerId); owner = ' AND created_by::text = $3::text'; }
      const cur = await client.query(
        `SELECT ${EVENT_COLS} FROM planner_events WHERE id = $1::uuid AND company_id = $2::uuid${owner} FOR UPDATE`,
        params,
      );
      if (!cur.rows[0]) throw new PlannerEventWriteError(404, 'NOT_FOUND', '행사를 찾을 수 없습니다.');
      const ev = mapEventRow(cur.rows[0]);
      if (!isEventEditable(ev.status)) {
        throw new PlannerEventWriteError(409, 'NOT_EDITABLE', '승인한 행사는 고칠 수 없습니다. 바꾸려면 먼저 승인을 풀어 주세요.');
      }
      // ★ 2026-10-04 Codex 1R H8 — 완성본을 만드는 중에는 고치지 않는다(만든 완성본이 붙을 접점이 사라지면 생성비만 남는다)
      if (isBuilding(ev.meta)) throw new PlannerEventWriteError(409, 'BUILDING', '완성본을 만드는 중이에요. 다 만든 뒤 고쳐 주세요.');
      // ★ 2026-10-04 Codex 1R H3 — 발송 이력이 있는 행사는 다른 달로 옮기지 않는다(그 달 발송 실적이 사라져 쓴 대행료가 환불되는 길)
      if (input.planMonth !== ev.planMonth) {
        const attempted = await client.query(
          `SELECT 1 FROM planner_touchpoints
            WHERE event_id = $1::uuid AND company_id = $2::uuid
              AND (status IN ('sent', 'producing') OR exec_ref IS NOT NULL OR (exec_meta ? 'send_started_at'))
            LIMIT 1`,
          [eventId, input.companyId],
        );
        if (attempted.rows.length > 0) {
          throw new PlannerEventWriteError(409, 'MONTH_LOCKED', '이미 발송이 나간 행사는 다른 달로 옮길 수 없어요. 다른 달 행사는 새로 담아 주세요.');
        }
      }
      meta = ev.meta;
      const tpCur = await client.query(
        `SELECT channel, timing_rule FROM planner_touchpoints WHERE event_id = $1::uuid AND company_id = $2::uuid`,
        [eventId, input.companyId],
      );
      const before = eventContentHash({
        title: ev.title, startsOn: ev.startsOn, endsOn: ev.endsOn, benefitText: ev.benefitText, products: ev.products,
        touchpoints: (tpCur.rows as any[]).map((t) => ({ channel: t.channel, timing: t.timing_rule, format: null })),
      });
      const materialsChanged = input.materials !== undefined && plannerMaterialsHash(input.materials) !== plannerMaterialsHash(meta.materials || null);
      changed = before !== eventContentHash(v) || materialsChanged;
      const patch: Record<string, unknown> = {};
      if (input.materials !== undefined) patch.materials = input.materials;
      if (changed) patch.revision = (Number(meta.revision) || 0) + 1;
      await client.query(
        `UPDATE planner_events
            SET title = $3, starts_on = $4, ends_on = $5, benefit_text = $6, products = $7, plan_month = $8,
                meta = (COALESCE(meta, '{}'::jsonb) - $9::text[]) || $10::jsonb,
                status = CASE WHEN $11 AND status = 'briefed' THEN 'draft' ELSE status END,
                updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $2::uuid`,
        [eventId, input.companyId, v.title, v.startsOn, v.endsOn, v.benefitText, JSON.stringify(v.products), input.planMonth,
          changed ? ['preview'] : [], JSON.stringify(patch), changed],
      );
    } else {
      meta = { materials: input.materials || null, revision: 1 };
      const ins = await client.query(
        `INSERT INTO planner_events (company_id, plan_month, title, starts_on, ends_on, benefit_text, products, status, created_by, meta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9::jsonb)
         RETURNING id`,
        [input.companyId, input.planMonth, v.title, v.startsOn, v.endsOn, v.benefitText, JSON.stringify(v.products), input.userId, JSON.stringify(meta)],
      );
      eventId = String(ins.rows[0].id);
    }

    // 접점 upsert — 같은 (채널·시점)은 그대로 두고, 사라진 것만 지우고, 새 것만 넣는다.
    const existing = await client.query(
      `SELECT id, channel, timing_rule FROM planner_touchpoints WHERE event_id = $1::uuid AND company_id = $2::uuid`,
      [eventId, input.companyId],
    );
    const wanted = new Map(v.touchpoints.map((t) => [touchpointKey(t.channel, t.timing), t]));
    const have = new Map((existing.rows as any[]).map((r) => [touchpointKey(r.channel, r.timing_rule), String(r.id)]));
    const removeIds = Array.from(have.entries()).filter(([k]) => !wanted.has(k)).map(([, id]) => id);
    if (removeIds.length > 0) {
      await client.query(
        `DELETE FROM planner_touchpoints WHERE id = ANY($1::uuid[]) AND company_id = $2::uuid AND status = 'planned'`,
        [removeIds, input.companyId],
      );
    }
    for (const [k, t] of wanted) {
      if (have.has(k)) continue;
      // 그 채널의 현재 완성본을 함께 쓴다(모바일 DM 여러 시점 = 같은 DM · 재료가 바뀌었으면 화면이 "다시 만들기"로 안내한다).
      const built = isBuildChannel(t.channel) ? meta.build?.[t.channel]?.draftId || null : null;
      await client.query(
        `INSERT INTO planner_touchpoints (event_id, company_id, channel, timing_rule, format, est_credits, status, asset_ref)
         VALUES ($1, $2, $3, $4, $5, $6, 'planned', $7::uuid)`,
        [eventId, input.companyId, t.channel, JSON.stringify(t.timing), t.format, estimateChannelCredits(t.channel) ?? 0, built],
      );
    }
    await client.query('COMMIT');
    return { id: eventId, changed };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    throw err;
  } finally {
    client.release();
  }
}
