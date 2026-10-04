/**
 * planner-build.ts — 플래너 재료 → 완성본(모바일 DM · 메일) 생성 CT (★ 2026-10-04 보강 B2 · 설계서 §5-2 · §6-2 · Q1)
 *
 * 담당자가 행사에 모바일 DM·메일을 고르면 재료(사진·글·몰 상품)를 넣고 [담고 만들기]를 누른다. 그 한 번이
 * **만들기 화면과 같은 AI 자동제작 엔진**(`generateFromBuildMaterials`)을 부른다 — 플래너 전용 생성기를 두지 않는다
 * (옛 oneShotGenerate·generateEmailSections 빈 자리 초안 폐기 · 설계서 §1 구조 사실).
 *
 * ⛔ 불변
 *   - **생성은 사람 클릭으로만**(§3-3). 워커는 이 파일을 부르지 않는다 — 엔진의 금액 결박(expectedTotal)이 전제하는
 *     "금액을 본 사람"을 지킨다. 견적(`quotePlannerBuild`)과 생성이 같은 재료 조립 함수를 쓴다(화면 금액 = 차감 금액).
 *   - **혜택은 고객사 기입 verbatim**(§3-5) — 행사 행 원본(행사명 · 기간 · 혜택)으로 서버가 첫 카드를 "그대로 쓰기"로 고정 조립한다.
 *     화면이 보낸 행사 정보는 쓰지 않는다(재료 카드에는 담당자 사진·글만).
 *   - 돈 단위 = 화면이 누를 때마다 만든 시도 토큰(엔진 계약 그대로 · 같은 토큰 재시도 = 재차감 0).
 *     **같은 토큰으로 이미 붙은 완성본이 있으면 엔진을 다시 부르지 않고 그것을 돌려준다**(재시도 고아 0 · §6-2).
 *   - 회사 단위 동시 생성 잠금은 만들기 화면과 같은 키(엔진 계약 · 같은 회사가 동시에 두 개를 만들지 않는다).
 *   - 완성본은 그 채널의 승인 전 접점(planned)에 붙인다. 승인 뒤에는 다시 만들 수 없다(읽기 전용 · F10).
 */
import { generateFromBuildMaterials, quoteFromBuildMaterials } from './campaign-quick';
import { buildInflightKey, aiAutoBuildEnabled, AI_AUTO_BUILD_CARD_IMAGES } from './ai-auto-build-materials';
import { tryAcquireInflight, releaseInflight } from './inflight-lock';
import { query } from '../config/database';
import {
  PlannerEventRow, PlannerMaterials, loadPlannerEvent, patchEventMeta, plannerBuildInputHash, isEventEditable,
} from './planner-event';
import { checkChannelReadiness } from './planner-channel-gate';

export class PlannerBuildError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
    this.name = 'PlannerBuildError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** (순수) 'YYYY-MM-DD' → 'YYYY.MM.DD' — 연도가 있는 날짜라 엔진이 카운트다운 종료일로 읽을 수 있다. */
function dotted(d: string): string {
  return d.replace(/-/g, '.');
}

/**
 * (순수) 엔진 재료 v1 조립 — 견적과 생성이 같은 함수를 쓴다.
 *  카드1 = 행사 원본(행사명 · 혜택 · 기간)을 "그대로 쓰기"로 고정 + 담당자 사진(첫 사진 = 첫 화면)
 *  카드2 = 담당자 글(있으면 · 담당자가 고른 "이 문구 그대로 쓰기" 그대로)
 *  상품 = 재료의 몰/글줄 상품 · 메일은 광고 표시를 서버가 강제한다(§6-2).
 */
export function buildPlannerEngineMaterials(
  ev: Pick<PlannerEventRow, 'title' | 'benefitText' | 'startsOn' | 'endsOn'>,
  materials: PlannerMaterials,
  channel: 'dm' | 'email',
  attemptToken: string,
  expectedTotal: number,
): Record<string, unknown> {
  const period = ev.startsOn === ev.endsOn ? `기간 ${dotted(ev.startsOn)} 하루` : `기간 ${dotted(ev.startsOn)} ~ ${dotted(ev.endsOn)}`;
  const factLines = [String(ev.benefitText || '').trim(), period].filter(Boolean);
  const cards: Array<Record<string, unknown>> = [{
    id: 'planner-event',
    title: ev.title,
    text: factLines.join('\n'),
    link: null,
    licensed: true,
    images: materials.images.slice(0, AI_AUTO_BUILD_CARD_IMAGES).map((im) => ({ url: im.url, width: im.width, height: im.height })),
  }];
  const text = materials.text.trim();
  if (text) {
    const first = text.split('\n').map((l) => l.trim()).find(Boolean) || '';
    cards.push({ id: 'planner-board', title: first.slice(0, 40), text, link: null, licensed: materials.licensed, images: [] });
  }
  return {
    version: 1,
    attemptToken,
    expectedTotal,
    channel,
    isAd: channel === 'email' ? true : null,
    eventCards: cards,
    products: materials.products.map((p) => ({
      source: p.source, provider: p.provider, code: p.code, name: p.name,
      price: p.price, salePrice: p.salePrice, discountRate: p.discountRate, url: p.url, imageUrl: p.imageUrl,
    })),
    features: null,
    brandName: null,
    catalogImages: [],
    catalogTitle: null,
  };
}

interface TouchpointLite { id: string; channel: string; status: string; asset_ref: string | null; exec_meta: Record<string, any> | null }

async function loadEventTouchpointsLite(companyId: string, eventId: string): Promise<TouchpointLite[]> {
  const r = await query(
    `SELECT id, channel, status, asset_ref, exec_meta FROM planner_touchpoints
      WHERE event_id = $1::uuid AND company_id = $2::uuid ORDER BY created_at ASC`,
    [eventId, companyId],
  );
  return r.rows as TouchpointLite[];
}

/** 재료를 쓸 수 있는가(행사 상태 · 채널 존재 · 준비 판정) — 견적·생성 공통 앞단. */
async function assertBuildable(ev: PlannerEventRow, channel: 'dm' | 'email', tps: TouchpointLite[]): Promise<void> {
  if (!isEventEditable(ev.status)) {
    throw new PlannerBuildError(409, 'NOT_EDITABLE', '승인한 행사는 다시 만들 수 없습니다. 바꾸려면 먼저 승인을 풀어 주세요.');
  }
  if (!tps.some((t) => t.channel === channel && t.status === 'planned')) {
    throw new PlannerBuildError(400, 'CHANNEL_NOT_IN_EVENT', channel === 'dm' ? '이 행사에 모바일 DM이 없습니다.' : '이 행사에 메일이 없습니다.');
  }
  const readiness = await checkChannelReadiness(channel, { companyId: ev.companyId, userId: ev.createdBy, phase: 'plan' });
  if (!readiness.ok) {
    throw new PlannerBuildError(400, 'CHANNEL_LOCKED', readiness.reason || '지금은 이 채널을 만들 수 없습니다.', { settingsPath: readiness.settingsPath });
  }
}

export interface PlannerBuildQuote {
  channel: 'dm' | 'email';
  total: number;
  parts: Array<{ key: string; label: string; cost: number }>;
  gate: { ok: boolean; missing?: string[] };
  creditEnabled: boolean;
}

/** 견적 — 생성과 같은 재료 조립 · 같은 엔진 견적 함수(단일 출처). 차감·AI·초안 0. */
export async function quotePlannerBuild(input: { companyId: string; eventId: string; ownerId: string | null; channels: Array<'dm' | 'email'> }): Promise<PlannerBuildQuote[]> {
  const ev = await loadPlannerEvent(input.companyId, input.eventId, input.ownerId);
  if (!ev) throw new PlannerBuildError(404, 'NOT_FOUND', '행사를 찾을 수 없습니다.');
  if (!aiAutoBuildEnabled(ev.companyId)) throw new PlannerBuildError(403, 'FEATURE_DISABLED', '재료로 완성본을 만드는 기능이 아직 열리지 않았습니다.');
  const materials = ev.meta.materials;
  if (!materials) throw new PlannerBuildError(400, 'MATERIALS_EMPTY', '먼저 재료를 넣어 주세요.');
  const tps = await loadEventTouchpointsLite(ev.companyId, ev.id);
  const out: PlannerBuildQuote[] = [];
  for (const channel of Array.from(new Set(input.channels))) {
    await assertBuildable(ev, channel, tps);
    // 견적은 토큰 값과 무관하다(엔진 계약) — 형식만 맞춘 값을 넣는다.
    const q = await quoteFromBuildMaterials({
      companyId: ev.companyId,
      materials: buildPlannerEngineMaterials(ev, materials, channel, QUOTE_TOKEN, 0),
    });
    out.push({ channel, total: q.quote.total, parts: q.quote.parts, gate: q.gate as any, creditEnabled: q.creditEnabled });
  }
  return out;
}

/** 견적 토큰(엔진 계약상 금액과 무관 · 형식만) */
const QUOTE_TOKEN = '00000000-0000-4000-8000-000000000000';

/**
 * 담기 전 견적 — 기입 창 버튼 금액([담고 만들기 · N크레딧])을 저장 전에도 서버가 정한다(§5-2 · 화면 금액 = 서버 견적).
 * 저장하지 않는다 · 차감·AI·초안 0. 생성은 저장 뒤 행사 행 원본으로 다시 조립하므로 여기 값은 표시 근거일 뿐이다
 * (화면은 저장 뒤 행사 견적과 다르면 금액 확인 창을 띄운다).
 */
export async function quotePlannerDraft(input: {
  companyId: string;
  userId: string | null;
  draft: { title: string; startsOn: string; endsOn: string; benefitText: string | null };
  materials: PlannerMaterials;
  channels: Array<'dm' | 'email'>;
}): Promise<PlannerBuildQuote[]> {
  if (!aiAutoBuildEnabled(input.companyId)) throw new PlannerBuildError(403, 'FEATURE_DISABLED', '재료로 완성본을 만드는 기능이 아직 열리지 않았습니다.');
  const out: PlannerBuildQuote[] = [];
  for (const channel of Array.from(new Set(input.channels))) {
    const readiness = await checkChannelReadiness(channel, { companyId: input.companyId, userId: input.userId, phase: 'plan' });
    if (!readiness.ok) {
      throw new PlannerBuildError(400, 'CHANNEL_LOCKED', readiness.reason || '지금은 이 채널을 만들 수 없습니다.', { settingsPath: readiness.settingsPath, channel });
    }
    const q = await quoteFromBuildMaterials({
      companyId: input.companyId,
      materials: buildPlannerEngineMaterials(input.draft, input.materials, channel, QUOTE_TOKEN, 0),
    });
    out.push({ channel, total: q.quote.total, parts: q.quote.parts, gate: q.gate as any, creditEnabled: q.creditEnabled });
  }
  return out;
}

export interface PlannerBuildResult {
  channel: 'dm' | 'email';
  draftId: string;
  reused: boolean;
  deductOutcome: string | null;
}

/**
 * 생성 — 사람이 [담고 만들기]를 눌렀을 때만(라우트가 부른다). 순서:
 *   행사·채널·준비 판정 → 같은 토큰 완성본 있으면 그대로 → 회사 잠금 → building 표식 → 엔진 → 접점에 붙임 → 생성 기록 → 표식 해제.
 * 엔진 오류(AiAutoBuildError · 잔액 부족)는 그대로 던진다 — 라우트가 엔진 라우트와 같은 매핑으로 답한다.
 */
export async function runPlannerBuild(input: {
  companyId: string;
  userId: string | null;
  ownerId: string | null;
  eventId: string;
  channel: 'dm' | 'email';
  attemptToken: string;
  expectedTotal: number;
}): Promise<PlannerBuildResult> {
  const token = String(input.attemptToken || '').toLowerCase();
  if (!UUID_RE.test(token)) throw new PlannerBuildError(400, 'BAD_TOKEN', '요청 형식이 맞지 않아요. 화면을 새로고침한 뒤 다시 시도해 주세요.');
  const ev = await loadPlannerEvent(input.companyId, input.eventId, input.ownerId);
  if (!ev) throw new PlannerBuildError(404, 'NOT_FOUND', '행사를 찾을 수 없습니다.');
  if (!aiAutoBuildEnabled(ev.companyId)) throw new PlannerBuildError(403, 'FEATURE_DISABLED', '재료로 완성본을 만드는 기능이 아직 열리지 않았습니다.');
  const materials = ev.meta.materials;
  if (!materials) throw new PlannerBuildError(400, 'MATERIALS_EMPTY', '먼저 재료를 넣어 주세요.');
  const tps = await loadEventTouchpointsLite(ev.companyId, ev.id);
  await assertBuildable(ev, input.channel, tps);

  // 같은 토큰으로 이미 붙었다(재시도·더블클릭) — 엔진을 다시 부르지 않는다(초안 행 고아 0 · 재차감 0).
  const prior = ev.meta.build?.[input.channel];
  if (prior && prior.token === token && tps.some((t) => t.channel === input.channel && t.asset_ref === prior.draftId)) {
    return { channel: input.channel, draftId: prior.draftId, reused: true, deductOutcome: null };
  }

  const lockKey = buildInflightKey(ev.companyId);
  if (!tryAcquireInflight(lockKey)) {
    throw new PlannerBuildError(409, 'IN_FLIGHT', '지금 만드는 중이에요. 완성되면 이어서 진행해 주세요.');
  }
  // ★ 2026-10-04 Codex 1R H8 — "만드는 중" 표식은 안내가 아니라 **잠금**이다(조건부 한 문장). 승인 · 고치기 · 지우기가 이 표식을 보고 멈추고,
  //   그 사이 승인됐으면(고칠 수 없는 상태) 여기서 멈춘다 → 엔진을 부르지 않는다(생성비 0).
  const marked = await query(
    `UPDATE planner_events
        SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('building', jsonb_build_object('channels', jsonb_build_array($3::text), 'at', to_jsonb(NOW())))
      WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('draft', 'briefed', 're_brief')
        AND (meta->'building' IS NULL OR jsonb_typeof(meta->'building') <> 'object'
             OR (meta->'building'->>'at')::timestamptz < NOW() - interval '10 minutes')
        -- ★ Codex 2R H8 — 읽은 입력이 그대로일 때만(그 사이 저장이 재료·채널을 바꿨으면 리비전이 올랐다 · 붙일 접점이 없으면 만들지 않는다)
        AND COALESCE((meta->>'revision')::int, 0) = $4
        AND EXISTS (SELECT 1 FROM planner_touchpoints t
                     WHERE t.event_id = planner_events.id AND t.company_id = planner_events.company_id
                       AND t.channel = $3 AND t.status = 'planned')
      RETURNING id`,
    [ev.id, ev.companyId, input.channel, Number(ev.meta.revision) || 0],
  ).catch((e: any) => { releaseInflight(lockKey); throw e; });
  if (marked.rows.length === 0) {
    releaseInflight(lockKey);
    throw new PlannerBuildError(409, 'IN_FLIGHT', '지금 만드는 중이거나 행사 상태가 바뀌었어요. 화면을 새로고침해 주세요.');
  }
  try {
    const r = await generateFromBuildMaterials({
      companyId: ev.companyId,
      userId: input.userId,
      materials: buildPlannerEngineMaterials(ev, materials, input.channel, token, Number(input.expectedTotal) || 0),
      channel: input.channel,
    });
    // 승인 전 접점(planned)에만 붙인다 — 그 사이 승인된 행은 건드리지 않는다(효과로 판정).
    const attached = await query(
      `UPDATE planner_touchpoints
          SET asset_ref = $4::uuid,
              exec_meta = COALESCE(exec_meta, '{}'::jsonb) || jsonb_build_object('build_token', $5::text, 'built_at', to_jsonb(NOW()))
        WHERE event_id = $1::uuid AND company_id = $2::uuid AND channel = $3 AND status = 'planned'
        RETURNING id`,
      [ev.id, ev.companyId, input.channel, r.draftId, token],
    );
    if (attached.rows.length === 0) {
      console.warn(`[planner-build] 완성본을 붙일 접점이 없음(그 사이 승인·삭제) event=${ev.id} ch=${input.channel} draft=${r.draftId}`);
      throw new PlannerBuildError(409, 'STATE_CHANGED', '그 사이 행사 상태가 바뀌어 완성본을 붙이지 못했습니다. 화면을 새로고침해 주세요.');
    }
    // materialsHash = 완성본 입력 지문(재료 + 행사 사실 · plannerBuildInputHash) — 행사 사실만 고쳐도 낡은 완성본으로 본다
    const record = { token, draftId: r.draftId, materialsHash: plannerBuildInputHash(ev, materials), builtAt: new Date().toISOString() };
    // 확인 대기 중 다시 만들었다면 문안·확인 링크도 새로 — 행사를 재료 단계(draft)로 되돌리고 리비전을 올린다.
    await patchEventMeta({
      companyId: ev.companyId,
      eventId: ev.id,
      patch: { build: { ...(ev.meta.build || {}), [input.channel]: record } },
      nullKeys: ['preview'],
      bumpRevision: true,
      status: 'draft',
      fromStatuses: ['draft', 'briefed', 're_brief'],
    });
    console.log(`[planner-build] 완성본 생성 event=${ev.id} ch=${input.channel} draft=${r.draftId} outcome=${r.deductOutcome}`);
    return { channel: input.channel, draftId: r.draftId, reused: false, deductOutcome: r.deductOutcome };
  } finally {
    releaseInflight(lockKey);
    await patchEventMeta({ companyId: ev.companyId, eventId: ev.id, nullKeys: ['building'] }).catch(() => null);
  }
}
