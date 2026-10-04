/**
 * planner-confirm.ts — 플래너 확인 화면 본문 · 지문 · 승인 견적 · 확인 링크 CT (★ 2026-10-04 보강 B3·B4 · 설계서 §5-3 · §5-4 · §6-4 · §6-5)
 *
 * 담당자 휴대폰 확인 화면(공개 · 로그인 없음)과 PC 행사 상세(로그인)는 **같은 본문**을 그린다 — 그 본문을 이 파일 하나가 조립한다
 * (목업 v2 = `PlannerConfirmView` 공유 · 화면 두 벌이 갈리지 않게).
 *
 * ⛔ 불변
 *   - **승인한 것 = 나가는 것**(§3-2). 접점마다 내용 지문을 만들고(문자 문안 · DM 섹션·쪽 내용 · 메일 제목·본문·광고 · 대상 축 · 예정일),
 *     승인은 화면이 본 행사 지문(seenHash)과 지금 지문을 맞춘 뒤 접점 지문을 각인한다. 실행부는 같은 함수로 다시 계산해 대조한다.
 *   - 확인 링크 토큰은 원문을 저장하지 않는다(sha256만 · meta.preview) · 리비전당 1개 · 만료 = min(발급 + 7일, 첫 발송일 20시) ·
 *     승인·내용 변경 시 폐기 · **열어 본다고 사라지지 않는다**(D2 · 문자 앱 미리보기).
 *   - 토큰은 미리보기 권한일 뿐 **승인 권한이 아니다**(Q4 · D3). 승인은 로그인한 계정만.
 *   - 공개 화면은 잔액을 싣지 않는다(로그인 화면만).
 *   - 미리보기 HTML은 렌더러 출력 그대로 내보내고 화면이 sandbox iframe(스크립트 0 · 열람 비콘 0)으로 그린다.
 */
import { createHash, randomBytes } from 'crypto';
import { query } from '../config/database';
import { SEND_HOURS } from '../config/defaults';
import { getCreditCost } from './ai-credit-calc';
import { getCreditState, isCreditEnabledStrict } from './ai-credit';
import { buildAdMessage, getOpt080Number } from './messageUtils';
import { getDmDetail } from './dm/dm-builder';
import { renderDmViewerHtml } from './dm/dm-viewer';
import { dmPublishFeeSourceOf, isDmPublishFeeCharged } from './dm/dm-publish-gate';
import { isEmailCampaignCompleted } from './email/email-completion';
import { countCustomerEmailRecipients, withEmailPreviewAdFooter, resolveEmailSender } from './email-channel';
import { loadAgencyPaymentState, PLANNER_AGENCY_SOURCE } from './planner-approval';
import { PLANNER_SEND_SOURCE, appendDmLink, describeTiming, kstDateString } from './planner-execution';
import { PlannerTouchpointRow, loadEventTouchpoints } from './planner-touchpoint';
import {
  PlannerEventRow, computeDisplayState, isEventEditable, firstSendDate, mapEventRow, PlannerDisplayState,
} from './planner-event';
import { carrierGroups } from './planner-copy';
import { countEventSmsAudience, PlannerAudienceCount } from './planner-audience';

/** 승인 마감 시각(첫 발송일 · KST) — 발송 창이 21시에 닫히므로 한 시간 앞에서 끊는다(설계서 Q5 · §6-4). */
export const PLANNER_APPROVAL_DEADLINE_HOUR = 20;
/** 확인 링크 최대 수명(D2). */
export const PLANNER_PREVIEW_MAX_DAYS = 7;
/** DM 링크 자리(승인 전 · 실주소는 승인 때 정해진다) — 화면이 이 자리에 "승인 뒤 정해지는 주소"를 그린다. */
export const PLANNER_DM_LINK_SENTINEL = '[[DM_LINK]]';

const sha = (v: unknown) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');

// ── 지문 ─────────────────────────────────────────────────────────────
/** DM 내용 지문 — status·short_code·updated_at 등 발행 상태는 빼고 사람이 보는 내용만(발행해도 지문이 바뀌지 않는다). */
export async function dmContentHash(companyId: string, dmId: string | null): Promise<string | null> {
  if (!dmId) return null;
  const dm = await getDmDetail(dmId, companyId);
  if (!dm) return null;
  return sha({
    t: dm.title ?? null, s: dm.sections ?? null, p: dm.pages ?? null, l: dm.layout_mode ?? null,
    b: dm.brand_kit ?? null, h: dm.header_data ?? null, f: dm.footer_data ?? null, g: dm.settings ?? null,
  }).slice(0, 40);
}

/** 메일 내용 지문 — 제목 · 본문 · 광고 여부. */
export async function emailContentHash(companyId: string, campaignId: string | null): Promise<string | null> {
  if (!campaignId) return null;
  const r = await query(
    `SELECT subject, html_body, is_ad FROM email_campaigns WHERE id = $1::uuid AND company_id = $2::uuid`,
    [campaignId, companyId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return sha({ s: row.subject, h: row.html_body, a: !!row.is_ad }).slice(0, 40);
}

type FpTouchpoint = Pick<PlannerTouchpointRow, 'id' | 'channel' | 'timing' | 'scheduledOn' | 'status' | 'assetRef' | 'execMeta' | 'companyId'>;

/**
 * 접점별 내용 지문 — 승인 각인과 실행 대조가 같은 함수를 쓴다(두 벌 금지).
 * 문자(캐리어)는 문안 + 실을 DM 내용까지 · DM은 DM 내용 + 실어 갈 문자의 문안까지(쌍 중 하나만 바뀌어도 둘 다 어긋난다 · H5) · 메일은 메일 내용.
 */
export async function computeTouchpointFingerprints(companyId: string, tps: FpTouchpoint[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const dmHash = new Map<string, string | null>();
  const dmOf = async (id: string | null) => {
    if (!id) return null;
    if (!dmHash.has(id)) dmHash.set(id, await dmContentHash(companyId, id));
    return dmHash.get(id) || null;
  };
  const live = tps.filter((t) => t.status !== 'skipped');
  const groups = carrierGroups(live);
  for (const { carrier, dm } of groups) {
    const copy = carrier.execMeta?.copy || null;
    const copyPart = copy ? { x: copy.text, j: copy.subject } : null;
    const carriedDm = carrier.channel === 'dm' ? carrier : dm;
    const dmPart = carriedDm ? await dmOf(carriedDm.assetRef) : null;
    const base = (t: FpTouchpoint) => ({ c: t.channel, d: t.scheduledOn, a: (t.timing as any)?.audience === 'participants' ? 'participants' : 'all' });
    out.set(carrier.id, sha({ ...base(carrier), copy: copyPart, dm: dmPart }).slice(0, 40));
    if (dm) out.set(dm.id, sha({ ...base(dm), copy: copyPart, dm: dmPart }).slice(0, 40));
  }
  for (const t of live.filter((x) => x.channel === 'email')) {
    out.set(t.id, sha({ c: 'email', d: t.scheduledOn, m: await emailContentHash(companyId, t.assetRef) }).slice(0, 40));
  }
  return out;
}

/** 행사 지문(화면이 본 것) — 행사 사실 + 리비전 + 접점 지문 전부. */
export function eventFingerprint(ev: Pick<PlannerEventRow, 'id' | 'title' | 'startsOn' | 'endsOn' | 'benefitText' | 'meta'>, tpFps: Map<string, string>): string {
  const parts = Array.from(tpFps.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return sha({ i: ev.id, t: ev.title, s: ev.startsOn, e: ev.endsOn, b: ev.benefitText || '', r: Number(ev.meta.revision) || 0, p: parts }).slice(0, 48);
}

// ── 승인 견적 ─────────────────────────────────────────────────────────
export interface ApprovalQuotePart { key: 'agency' | 'dm-publish' | 'email-complete'; label: string; cost: number }
export interface ApprovalQuote {
  total: number;
  parts: ApprovalQuotePart[];
  creditEnabled: boolean;
  agency: { cycle: number; key: string; paid: boolean; cost: number };
  dm: { dmId: string; source: string; cost: number; charged: boolean } | null;
  email: { campaignId: string; cost: number; completed: boolean } | null;
}

/**
 * 승인 때 빠지는 크레딧(D1) — 그 달 첫 승인이면 대행료(회차 키) + 모바일 DM 발행비(참여형 120 · 일반 100 · 이미 냈으면 0) + 메일 완성비(이미 완성이면 0).
 * 크레딧제 미적용 회사 = 0. 조회 실패는 던진다(모르는 금액을 0으로 접지 않는다 · 라우트 503).
 */
export async function quoteEventApproval(ev: Pick<PlannerEventRow, 'companyId' | 'planMonth'>, tps: FpTouchpoint[]): Promise<ApprovalQuote> {
  const creditEnabled = await isCreditEnabledStrict(ev.companyId);
  const pay = await loadAgencyPaymentState(ev.companyId, ev.planMonth);
  const agencyCost = creditEnabled && !pay.paid ? getCreditCost(PLANNER_AGENCY_SOURCE) : 0;
  // 남은 접점만(승인이 발행·완성하는 대상과 같은 집합 · planner-approve)
  const live = tps.filter((t) => t.status !== 'skipped' && t.status !== 'sent');
  const dmId = live.find((t) => t.channel === 'dm' && t.assetRef)?.assetRef || null;
  const emailId = live.find((t) => t.channel === 'email' && t.assetRef)?.assetRef || null;
  let dm: ApprovalQuote['dm'] = null;
  if (dmId) {
    const fee = await dmPublishFeeSourceOf(ev.companyId, dmId);
    const charged = await isDmPublishFeeCharged(ev.companyId, dmId);
    dm = { dmId, source: fee.source, cost: creditEnabled && !charged ? fee.cost : 0, charged };
  }
  let email: ApprovalQuote['email'] = null;
  if (emailId) {
    const completed = await isEmailCampaignCompleted(ev.companyId, emailId);
    email = { campaignId: emailId, cost: creditEnabled && !completed ? getCreditCost('email-campaign-complete') : 0, completed };
  }
  const parts: ApprovalQuotePart[] = [];
  if (agencyCost > 0) parts.push({ key: 'agency', label: '이달 대행료', cost: agencyCost });
  if (dm && dm.cost > 0) parts.push({ key: 'dm-publish', label: '모바일 DM 발행', cost: dm.cost });
  if (email && email.cost > 0) parts.push({ key: 'email-complete', label: '메일 완성', cost: email.cost });
  return {
    total: parts.reduce((s, p) => s + p.cost, 0),
    parts,
    creditEnabled,
    agency: { cycle: pay.cycle, key: pay.key, paid: pay.paid, cost: agencyCost },
    dm,
    email,
  };
}

// ── 확인 링크 ─────────────────────────────────────────────────────────
export function hashPreviewToken(token: string): string {
  return sha(String(token || '')).slice(0, 64);
}

/** (순수) 링크 만료 = min(발급 + 7일, 첫 발송일 20시 KST). */
export function previewExpiry(issuedAt: Date, firstSend: string | null): Date {
  const max = new Date(issuedAt.getTime() + PLANNER_PREVIEW_MAX_DAYS * 24 * 60 * 60 * 1000);
  if (!firstSend || !/^\d{4}-\d{2}-\d{2}$/.test(firstSend)) return max;
  const [y, m, d] = firstSend.split('-').map(Number);
  const deadline = new Date(Date.UTC(y, m - 1, d, PLANNER_APPROVAL_DEADLINE_HOUR - 9, 0, 0));
  return deadline.getTime() < max.getTime() ? deadline : max;
}

/** 확인 링크(절대 주소) — 토큰은 주소의 # 뒤(서버 접근 로그·Referer로 새지 않는다 · useApproveToken과 같은 축). */
export function buildPlannerConfirmLink(token: string): string {
  const base = String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');
  return `${base}/planner-confirm#t=${token}`;
}

/**
 * 링크 발급 — 행사가 확인 대기(briefed)이고 리비전이 그대로일 때만(조건부 한 문장). 새 링크를 내면 옛 링크는 무효(리비전당 1개).
 * 반환 = 원문 토큰(문자에만 싣는다 · 저장하지 않는다) 또는 null(상태가 바뀌었다).
 */
export async function issuePlannerPreviewToken(ev: PlannerEventRow, firstSend: string | null, opts?: { reminder?: boolean }): Promise<{ token: string; expiresAt: Date } | null> {
  const token = randomBytes(32).toString('hex');
  const issuedAt = new Date();
  const expiresAt = previewExpiry(issuedAt, firstSend);
  if (expiresAt.getTime() <= issuedAt.getTime()) return null;
  const revision = Number(ev.meta.revision) || 0;
  const record = {
    tokenHash: hashPreviewToken(token),
    revision,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ...(opts?.reminder ? { remindedAt: issuedAt.toISOString() } : { remindedAt: (ev.meta.preview as any)?.remindedAt || null }),
  };
  const r = await query(
    `UPDATE planner_events
        SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('preview', $4::jsonb), updated_at = NOW()
      WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'briefed'
        AND COALESCE((meta->>'revision')::int, 0) = $3
      RETURNING id`,
    [ev.id, ev.companyId, revision, JSON.stringify(record)],
  );
  return r.rows.length > 0 ? { token, expiresAt } : null;
}

/** (순수) 링크가 지금 유효한가 — 해시 일치 · 같은 리비전 · 만료 전. */
export function isPreviewValid(ev: Pick<PlannerEventRow, 'meta'>, tokenHash: string, now: Date = new Date()): boolean {
  const p = ev.meta.preview;
  if (!p || p.tokenHash !== tokenHash) return false;
  if ((Number(p.revision) || 0) !== (Number(ev.meta.revision) || 0)) return false;
  return new Date(String(p.expiresAt)).getTime() > now.getTime();
}

/** 토큰 → 행사(유효할 때만 · 확인 대기 상태만). 열람으로 소비하지 않는다(D2). */
export async function resolvePlannerPreviewToken(token: string): Promise<PlannerEventRow | null> {
  const t = String(token || '').trim();
  if (!/^[a-f0-9]{64}$/.test(t)) return null;
  const h = hashPreviewToken(t);
  const r = await query(
    `SELECT id, company_id, plan_month, title, starts_on::text AS starts_on, ends_on::text AS ends_on,
            benefit_text, products, status, created_by, meta
       FROM planner_events
      WHERE status = 'briefed' AND meta->'preview'->>'tokenHash' = $1
      LIMIT 1`,
    [h],
  );
  if (!r.rows[0]) return null;
  const ev = mapEventRow(r.rows[0]);
  return isPreviewValid(ev, h) ? ev : null;
}

// ── 확인 화면 본문 ────────────────────────────────────────────────────
export interface ConfirmSend {
  key: string;
  scheduledOn: string;
  /** 'sms' = 문자 · 'smsdm' = 문자 1통 + DM 링크 · 'dm' = DM 링크를 실은 문자(문자 접점 없음) · 'email' = 메일 */
  kind: 'sms' | 'smsdm' | 'dm' | 'email';
  why: string;
  touchpointIds: string[];
  status: string;
  lockReason: string | null;
  recipients: PlannerAudienceCount;
  /** spam = pass(검사 통과) · pending(고친 문안 검사 중) · fail(고친 문안이 걸림) · missing(문안 준비 전) · edited = 담당자가 고친 문안 · editable = [고치기] 가능(승인 전) */
  sms: { text: string; subject: string; linkPending: boolean; spam: 'pass' | 'pending' | 'fail' | 'missing'; checkedAt: string | null; error: string | null; edited: boolean; editable: boolean; rawText: string } | null;
  dm: { dmId: string; html: string | null } | null;
  email: { campaignId: string; subject: string; fromName: string; html: string | null } | null;
  result: { sentAt: string | null; sentCount: number | null; successCount: number | null; openCount: number | null; clickCount: number | null } | null;
}

export interface ConfirmView {
  event: {
    id: string; title: string; startsOn: string; endsOn: string; benefitText: string | null; status: string;
    displayState: PlannerDisplayState; editable: boolean; revision: number; companyName: string;
  };
  firstSend: string | null;
  sendHour: number;
  deadline: { date: string; hour: number; daysLeft: number } | null;
  sends: ConfirmSend[];
  quote: ApprovalQuote | null;
  copyCostPerSend: number;
  carrierCount: number;
  buildPaid: number;
  balance: number | null;
  fingerprint: string;
  approved: { at: string; by: string | null } | null;
  preview: { issuedAt: string; expiresAt: string } | null;
  dataSource: string;
}

async function loadCompanyName(companyId: string): Promise<string> {
  const r = await query(`SELECT COALESCE(NULLIF(brand_name, ''), company_name) AS name FROM companies WHERE id = $1::uuid`, [companyId]);
  return String(r.rows[0]?.name || '').trim();
}

/** 완성본을 만들 때 낸 크레딧(생성 · 판독) — 원장 키로 직접 센다(사본 표식 0). */
async function loadBuildPaid(ev: PlannerEventRow): Promise<number> {
  const tokens = Object.values(ev.meta.build || {}).map((b) => b?.token).filter((t): t is string => !!t);
  if (tokens.length === 0) return 0;
  const likes = tokens.flatMap((t) => [`quick:${ev.companyId}:%:${t}:%`, `quick-read:${ev.companyId}:${t}:%`]);
  const r = await query(
    `SELECT COALESCE(SUM(amount), 0)::int AS paid FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND type = 'deduct' AND idempotency_key LIKE ANY($2::text[])`,
    [ev.companyId, likes],
  );
  return Number(r.rows[0]?.paid) || 0;
}

/**
 * 확인 화면 본문 — 공개(휴대폰 · 잔액 없음)와 로그인(행사 상세 · 잔액 포함)이 같은 함수.
 * 보낼 순서대로: 캐리어 묶음(문자 · 문자+DM · DM 단독) + 메일. 결과(발송 뒤)는 원장 실측만.
 */
export async function buildConfirmView(ev: PlannerEventRow, opts: { mode: 'public' | 'member' }): Promise<ConfirmView> {
  const tps = await loadEventTouchpoints(ev.companyId, ev.id);
  const fps = await computeTouchpointFingerprints(ev.companyId, tps);
  const fingerprint = eventFingerprint(ev, fps);
  const first = firstSendDate(ev, tps);
  const [companyName, opt080, smsAudience, emailCount, quote, buildPaid, balance] = await Promise.all([
    loadCompanyName(ev.companyId),
    getOpt080Number(ev.createdBy || null, ev.companyId).catch(() => ''),
    tps.some((t) => (t.channel === 'sms' || t.channel === 'dm') && t.status !== 'skipped')
      ? countEventSmsAudience({ companyId: ev.companyId, createdBy: ev.createdBy, eventId: ev.id })
      : Promise.resolve({ state: 'known', count: 0 } as PlannerAudienceCount),
    tps.some((t) => t.channel === 'email' && t.status !== 'skipped')
      ? countCustomerEmailRecipients(ev.companyId).then((n) => ({ state: 'known', count: n } as PlannerAudienceCount)).catch(() => ({ state: 'error', count: null } as PlannerAudienceCount))
      : Promise.resolve({ state: 'known', count: 0 } as PlannerAudienceCount),
    ['briefed', 'draft'].includes(ev.status) ? quoteEventApproval(ev, tps).catch(() => null) : Promise.resolve(null),
    loadBuildPaid(ev).catch(() => 0),
    opts.mode === 'member' ? getCreditState(ev.companyId).then((s) => (s.creditEnabled ? s.total : null)).catch(() => null) : Promise.resolve(null),
  ]);

  const sends: ConfirmSend[] = [];
  const resultOf = async (t: PlannerTouchpointRow): Promise<ConfirmSend['result']> => {
    if (t.status !== 'sent') return null;
    const sentCount = Number.isFinite(Number(t.execMeta?.sent_count)) ? Number(t.execMeta.sent_count) : null;
    let successCount: number | null = null, openCount: number | null = null, clickCount: number | null = null;
    if (t.channel === 'email' && t.assetRef) {
      const r = await query(`SELECT open_count, click_count FROM email_campaigns WHERE id = $1::uuid AND company_id = $2::uuid`, [t.assetRef, ev.companyId]).catch(() => null);
      openCount = r?.rows[0] ? Number(r.rows[0].open_count) || 0 : null;
      clickCount = r?.rows[0] ? Number(r.rows[0].click_count) || 0 : null;
    } else if (t.execRef) {
      const r = await query(`SELECT success_count FROM campaigns WHERE id = $1::uuid AND company_id = $2::uuid`, [t.execRef, ev.companyId]).catch(() => null);
      successCount = r?.rows[0] && r.rows[0].success_count != null ? Number(r.rows[0].success_count) : null;
    }
    return { sentAt: t.execMeta?.sent_at || null, sentCount, successCount, openCount, clickCount };
  };

  for (const { carrier, dm } of carrierGroups(tps)) {
    const copy = carrier.execMeta?.copy || null;
    const dmTp = carrier.channel === 'dm' ? carrier : dm;
    const realUrl = String(carrier.execMeta?.dm_url || dmTp?.execMeta?.dm_url || '');
    const link = dmTp ? (realUrl || PLANNER_DM_LINK_SENTINEL) : '';
    let dmHtml: string | null = null;
    if (dmTp?.assetRef) {
      const row = await getDmDetail(dmTp.assetRef, ev.companyId).catch(() => null);
      dmHtml = row ? (() => { try { return renderDmViewerHtml(row, '/api/dm/v'); } catch { return null; } })() : null;
    }
    sends.push({
      key: carrier.id,
      scheduledOn: carrier.scheduledOn,
      kind: carrier.channel === 'dm' ? 'dm' : dm ? 'smsdm' : 'sms',
      why: describeTiming(carrier.timing),
      touchpointIds: [carrier.id, ...(dm ? [dm.id] : [])],
      status: carrier.status,
      lockReason: carrier.lockReason ?? null,
      recipients: smsAudience,
      sms: copy
        ? {
          text: buildAdMessage(appendDmLink(String(copy.text), link), 'LMS', true, opt080),
          subject: String(copy.subject || ''),
          linkPending: !!dmTp && !realUrl,
          spam: copy.spam === 'pending' || copy.spam === 'fail' ? copy.spam : 'pass',
          checkedAt: copy.checkedAt || null,
          error: carrier.execMeta?.copy_error?.reason || null,
          edited: !!copy.edited,
          editable: carrier.status === 'planned' && (ev.status === 'briefed' || ev.status === 'draft'),
          rawText: String(copy.text),
        }
        : {
          text: '', subject: '', linkPending: !!dmTp, spam: 'missing', checkedAt: null, error: carrier.execMeta?.copy_error?.reason || null,
          edited: false, editable: false, rawText: '',
        },
      dm: dmTp?.assetRef ? { dmId: dmTp.assetRef, html: dmHtml } : null,
      email: null,
      result: await resultOf(carrier),
    });
  }
  for (const t of tps.filter((x) => x.channel === 'email' && x.status !== 'skipped')) {
    let email: ConfirmSend['email'] = null;
    if (t.assetRef) {
      const r = await query(
        `SELECT subject, html_body, is_ad, from_name, from_email FROM email_campaigns WHERE id = $1::uuid AND company_id = $2::uuid`,
        [t.assetRef, ev.companyId],
      ).catch(() => null);
      const row = r?.rows[0];
      if (row) {
        const isAd = !!row.is_ad;
        const subject = isAd && !/^\s*[(（]\s*광고\s*[)）]/.test(String(row.subject || '')) ? `(광고) ${row.subject}` : String(row.subject || '');
        const sender = await resolveEmailSender(ev.companyId, { fromName: row.from_name, fromEmail: row.from_email }).catch(() => ({ name: companyName, email: '' }));
        const html = await withEmailPreviewAdFooter(String(row.html_body || ''), ev.companyId, isAd, { fromName: row.from_name, fromEmail: row.from_email }).catch(() => String(row.html_body || ''));
        email = { campaignId: t.assetRef, subject, fromName: sender.name || companyName, html };
      }
    }
    sends.push({
      key: t.id,
      scheduledOn: t.scheduledOn,
      kind: 'email',
      why: describeTiming(t.timing),
      touchpointIds: [t.id],
      status: t.status,
      lockReason: t.lockReason ?? null,
      recipients: emailCount,
      sms: null,
      dm: null,
      email,
      result: await resultOf(t),
    });
  }
  sends.sort((a, b) => a.scheduledOn.localeCompare(b.scheduledOn) || (a.kind === 'email' ? -1 : 1));

  const today = kstDateString();
  const deadline = first
    ? { date: first, hour: PLANNER_APPROVAL_DEADLINE_HOUR, daysLeft: Math.round((Date.parse(`${first}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) }
    : null;
  const approved = ev.meta.approved ? { at: String(ev.meta.approved.at), by: ev.meta.approved.by || null } : null;
  const preview = ev.meta.preview ? { issuedAt: String(ev.meta.preview.issuedAt), expiresAt: String(ev.meta.preview.expiresAt) } : null;
  return {
    event: {
      id: ev.id, title: ev.title, startsOn: ev.startsOn, endsOn: ev.endsOn, benefitText: ev.benefitText, status: ev.status,
      displayState: computeDisplayState(ev, tps), editable: isEventEditable(ev.status), revision: Number(ev.meta.revision) || 0, companyName,
    },
    firstSend: first,
    sendHour: SEND_HOURS.start,
    deadline,
    sends,
    quote,
    copyCostPerSend: getCreditCost(PLANNER_SEND_SOURCE),
    carrierCount: sends.filter((s) => s.kind !== 'email').length,
    buildPaid,
    balance,
    fingerprint,
    approved,
    preview,
    dataSource: '받는 사람 수는 수신거부·발송 조건을 적용한 오늘 기준 실조회, 문안·모바일 DM·메일은 실제로 나갈 내용 그대로, 비용은 서버 견적, 결과는 실제 발송 기록입니다.',
  };
}
