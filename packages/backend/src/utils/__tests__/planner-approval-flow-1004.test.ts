/**
 * planner-approval-flow-1004.test.ts — 행사별 확인·승인 흐름 계약 (★ 2026-10-04 보강 B4~B6 · 설계서 §6-4~§6-9)
 *
 * 고정하는 계약:
 *  ① 승인 마감 = 남은 첫 발송일 20시(KST) · 지난 발송은 첫 발송 계산에서 빠진다.
 *  ② 승인 트랜잭션 순서 = 월 원장 잠금 → 행사 잠금 → 회차(잠금 안) → 대행 차감 → 메일 완성 코어 → DM 발행 코어 → 각인 → 커밋(C1·C3).
 *     승인 = 행사 단위 · 남은 접점은 전부 planned여야 하고 전부 같은 지문으로 각인된다.
 *  ③ 되돌림 = 월 원장 → 행사 → 접점 잠금 순서 · 선점 행은 producing에서만 · 발송 여부를 모르는 행은 건드리지 않는다.
 *  ④ 공개 확인 화면 = POST 본문 토큰 · 인증 앞 · Referrer-Policy · 잔액 없음 · 승인 권한 없음.
 *  ⑤ 캘린더 화면 상태·할 일·마감·[다시 시작] 가능 여부는 서버가 판정한다.
 *  ⑥ 고객에게 보이는 문장에 줄표(—)가 없다.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('../../config/database', () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  return { default: { query }, query, mysqlQuery: vi.fn(), pool: { query, connect: vi.fn() } };
});

import { isPastApprovalDeadline } from '../planner-approve';
import { daysBetween, formatPlannerDay, PLANNER_LINK_LEAD_DAYS } from '../planner-review';
import { toCalendarEvent, PLANNER_TODO_STATES } from '../planner-calendar';
import { firstSendDate } from '../planner-event';

const read = (f: string) => readFileSync(path.join(__dirname, '..', f), 'utf8');

const EV = (status: string, meta: Record<string, unknown> = {}) => ({
  id: 'e1', companyId: 'c1', planMonth: '2026-10', title: '가을 행사', startsOn: '2026-10-10', endsOn: '2026-10-12',
  benefitText: '10% 할인', products: [], status, createdBy: 'u1', meta: { revision: 1, ...meta },
});
const TP = (id: string, channel: string, status: string, execMeta: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id, eventId: 'e1', companyId: 'c1', channel, channelLabel: channel, timing: { anchor: 'start' }, status,
  assetRef: null, execRef: null, execMeta, lockReason: null, scheduledOn: '2026-10-10', planMonth: '2026-10',
  title: '가을 행사', startsOn: '2026-10-10', endsOn: '2026-10-12', benefitText: null, products: [], createdBy: 'u1', eventStatus: 'approved',
  ...extra,
}) as any;

describe('① 승인 마감 · 남은 첫 발송', () => {
  it('첫 발송일 20시(KST) 전까지만 승인한다', () => {
    expect(isPastApprovalDeadline(null)).toBe(false);
    expect(isPastApprovalDeadline('2026-10-07', new Date('2026-10-06T23:00:00Z'))).toBe(false); // KST 10/7 08:00
    expect(isPastApprovalDeadline('2026-10-07', new Date('2026-10-07T10:59:00Z'))).toBe(false); // KST 19:59
    expect(isPastApprovalDeadline('2026-10-07', new Date('2026-10-07T11:00:00Z'))).toBe(true); // KST 20:00
    expect(isPastApprovalDeadline('2026-10-06', new Date('2026-10-06T16:00:00Z'))).toBe(true); // KST 10/7 01:00 = 지난 날
    expect(isPastApprovalDeadline('2026-10-09', new Date('2026-10-07T12:00:00Z'))).toBe(false);
  });

  it('첫 발송일은 아직 나가지 않은 접점만 본다(발송 완료·생략 제외)', () => {
    const ev = { startsOn: '2026-10-10', endsOn: '2026-10-12' };
    const tps = [
      { timing: { anchor: 'before_start', offsetDays: 3 }, status: 'sent' },
      { timing: { anchor: 'start' }, status: 'skipped' },
      { timing: { anchor: 'end' }, status: 'planned' },
    ] as any;
    expect(firstSendDate(ev, tps)).toBe('2026-10-12');
    expect(firstSendDate(ev, tps.slice(0, 2))).toBeNull();
  });

  it('날짜 표기 · 날수 · 링크 발송 시점', () => {
    expect(formatPlannerDay('2026-10-07')).toBe('10/7(수)');
    expect(formatPlannerDay('2026-11-02')).toBe('11/2(월)');
    expect(daysBetween('2026-10-04', '2026-10-07')).toBe(3);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(PLANNER_LINK_LEAD_DAYS).toBe(3);
  });
});

describe('② 승인 트랜잭션(C1 · C2 · C3)', () => {
  const src = read('planner-approve.ts');
  const fn = src.slice(src.indexOf('export async function approvePlannerEvent'), src.indexOf('export async function unapprovePlannerEvent'));

  it('확인(지문 · 마감 · 문안 · 준비 · 대상 · 견적 · 잔액)은 트랜잭션 앞 · 생략 분기 없이 언제나 한다', () => {
    const order = [
      "pending.some((t) => t.status !== 'planned')",
      'isPastApprovalDeadline(first)',
      'eventFingerprint(ev, fps) !== String(input.seenHash',
      'isCopyValid(carrier.execMeta, copyInputHash(ev',
      'await firstBlockedChannel(pending.map',
      'await countEventSmsAudience(',
      'quote.total > (Number(input.shownTotal) || 0)',
      'await checkCredit(ev.companyId, quote.total)',
      "await client.query('BEGIN')",
    ].map((k) => fn.indexOf(k));
    order.forEach((i) => expect(i).toBeGreaterThan(-1));
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });

  it('잠금(월 원장 → 행사 → 접점) → 잠금 안 견적 재계산 → 막을 사유 먼저 → DM 발행 · 메일 완성 → 각인 → 대행료(같은 트랜잭션) → 월 원장 → 커밋', () => {
    const order = [
      'ON CONFLICT (company_id, plan_month) DO NOTHING',
      'FROM planner_monthly_approvals WHERE company_id = $1::uuid AND plan_month = $2 FOR UPDATE',
      "meta->'building' AS building FROM planner_events",
      'FROM planner_touchpoints WHERE event_id = $1::uuid AND company_id = $2::uuid FOR UPDATE',
      'const lockedQuote = await quoteEventApproval(ev, pending);',
      'lockedQuote.total > (Number(input.shownTotal) || 0)',
      'await emailCompleteBlockOf(',
      'await dmPublishBlockOf(',
      'await publishDmCore(',
      'await completeEmailCampaignCore(',
      "SET status = 'ready', lock_reason = NULL",
      "SET status = 'approved',\n              meta = (COALESCE(meta, '{}'::jsonb) - 'preview')",
      'await _deductWithClient(client, {',
      'UPDATE planner_monthly_approvals',
      "await client.query('COMMIT')",
    ].map((k) => fn.indexOf(k));
    order.forEach((i, n) => expect(i, `순서 ${n}`).toBeGreaterThan(-1));
    for (let i = 1; i < order.length; i++) expect(order[i], `순서 ${i}`).toBeGreaterThan(order[i - 1]);
    // 대행료는 승인 트랜잭션 안(Codex 1R H1) · 키는 잠금 안 견적의 회차 키(H2) · 월 상태로 선점하지 않는다(C1)
    expect(fn).toContain("}, new Date(), { manageTx: false });");
    expect(fn).toContain('idempotencyKey: lockedQuote.agency.key');
    expect(fn).not.toContain('await deductCredit(');
    expect(fn).not.toContain("status = 'approving'");
    expect(fn).toContain('expectedFee: lockedQuote.dm?.cost ?? 0');
    // 생성 중이면 승인하지 않는다(H8) · 각인은 남은 접점(planned)에서만 · 효과로 판정
    expect(fn).toContain("throw new PlannerApproveError(409, 'BUILDING'");
    expect(fn).toContain("WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'planned'");
  });

  it('승인 풀기 · 행사 취소도 같은 잠금 순서(월 원장 → 행사) · 진행 중이면 거절', () => {
    const un = src.slice(src.indexOf('export async function unapprovePlannerEvent'), src.indexOf('export async function cancelPlannerEvent'));
    expect(un.indexOf('planner_monthly_approvals')).toBeLessThan(un.indexOf('FROM planner_events WHERE id'));
    expect(un).toContain("status IN ('producing', 'sent') OR exec_ref IS NOT NULL OR (exec_meta ? 'send_started_at')");
    expect(un).toContain("- 'approved' - 'post_approval_spam'");
    const cancel = src.slice(src.indexOf('export async function cancelPlannerEvent'));
    expect(cancel.indexOf('planner_monthly_approvals')).toBeLessThan(cancel.indexOf("SET status = 'skipped'"));
    expect(cancel).toContain("AND status = 'producing' LIMIT 1");
    expect(cancel).toContain("status IN ('planned', 'ready', 'hold_credit', 'locked')");
  });

  it('행사 승인 견적과 승인이 발행·완성하는 대상이 같은 집합(남은 접점)이다', () => {
    expect(fn).toContain("pending.find((t) => t.channel === 'email' && t.assetRef)");
    expect(fn).toContain("pending.find((t) => t.channel === 'dm' && t.assetRef)");
    const confirm = read('planner-confirm.ts');
    const quote = confirm.slice(confirm.indexOf('export async function quoteEventApproval'));
    expect(quote).toContain("tps.filter((t) => t.status !== 'skipped' && t.status !== 'sent')");
  });
});

describe('③ 확인 대기로 되돌림(planner-review)', () => {
  const src = read('planner-review.ts');
  const fn = src.slice(src.indexOf('export async function revertEventToReview'), src.indexOf('export function kickPlannerReview'));
  it('월 원장 → 행사 → 접점 · 선점 행은 producing에서만 · 모르는 발송은 그대로', () => {
    const iMonth = fn.indexOf('FROM planner_monthly_approvals WHERE company_id = $1::uuid AND plan_month = $2 FOR UPDATE');
    const iEvent = fn.indexOf('FROM planner_events WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE');
    const iTp = fn.indexOf("SET status = 'planned'");
    expect(iMonth).toBeGreaterThan(-1);
    expect(iMonth).toBeLessThan(iEvent);
    expect(iEvent).toBeLessThan(iTp);
    expect(fn).toContain("(id = ANY($6::uuid[]) AND status = 'producing')");
    expect(fn).toContain("AND NOT ((exec_meta ? 'send_started_at') AND exec_ref IS NULL)");
    expect(fn).toContain("- 'approved' - 'post_approval_spam'");
    // 행사는 승인을 잃고 새 리비전(옛 확인 링크 폐기)
    expect(fn).toContain("(COALESCE(meta, '{}'::jsonb) - 'approved' - 'preview')");
    expect(fn).toContain("COALESCE((meta->>'revision')::int, 0) + 1");
  });

  it('링크는 통지가 실패하면 발급을 되돌린다 · 승인 직후 스팸은 재생성 없이 실주소로', () => {
    expect(src).toContain("meta->'preview'->>'tokenHash' = $3");
    const spam = src.slice(src.indexOf('async function checkCarrierAfterApproval'));
    expect(spam).toContain('regenerate: false');
    expect(spam).toContain('const body = appendDmLink(String(copy.text), url);');
    expect(spam).toContain('dropCopy: true');
  });
});

describe('④ 공개 확인 화면 · 라우트', () => {
  const route = read('../routes/marketing-planner.ts');
  it('POST 본문 토큰 · 인증 앞 · 링크 유출 차단 · GET 토큰 경로 없음', () => {
    const iView = route.indexOf("router.post('/confirm-view'");
    const iAuth = route.indexOf('router.use(authenticate);');
    expect(iView).toBeGreaterThan(-1);
    expect(iView).toBeLessThan(iAuth);
    const view = route.slice(iView, iAuth);
    expect(view).toContain("res.setHeader('Referrer-Policy', 'no-referrer')");
    expect(view).toContain("buildConfirmView(ev, { mode: 'public' })");
    expect(view).toContain("String(req.body?.token || '')");
    expect(route).not.toMatch(/router\.get\('\/confirm-view/);
    // 공개 본문은 잔액을 싣지 않는다
    const confirm = read('planner-confirm.ts');
    expect(confirm).toContain("opts.mode === 'member' ? getCreditState(ev.companyId)");
  });

  it('승인은 로그인 뒤 · 화면이 본 지문과 금액을 싣는다 · 월 대행 취소는 관리자만 · 옛 결재 경로 없음', () => {
    const approve = route.slice(route.indexOf("router.post('/events/:id/approve'"));
    expect(route.indexOf("router.post('/events/:id/approve'")).toBeGreaterThan(route.indexOf('router.use(authenticate);'));
    expect(approve).toContain("seenHash: String(req.body?.seenHash || '')");
    expect(approve).toContain('shownTotal: Number(req.body?.shownTotal) || 0');
    const monthCancel = route.slice(route.indexOf("router.post('/brief/:month/cancel'"));
    expect(monthCancel).toContain("code: 'ADMIN_ONLY'");
    for (const gone of ["router.get('/brief'", "'/brief/:month/submit'", "'/brief/:month/approve'", "'/dm/:dmId/carry-check'", 'runPlannerProductionPass']) {
      expect(route, gone).not.toContain(gone);
    }
  });
});

describe('⑤ 캘린더 판정(서버)', () => {
  it('재료 필요 · 확인 대기(마감) · 승인됨 · 보류([다시 시작]) · 취소', () => {
    const material = toCalendarEvent(EV('draft') as any, [TP('t1', 'dm', 'planned')]);
    expect(material.displayState).toBe('material');
    expect(material.todo).toBe(true);
    expect(material.editable).toBe(true);
    expect(material.staleChannels).toEqual(['dm']);

    const review = toCalendarEvent(EV('briefed') as any, [TP('t1', 'sms', 'planned')]);
    expect(review.displayState).toBe('review');
    expect(review.deadline).toEqual({ date: '2026-10-10', hour: 20 });

    const approved = toCalendarEvent(EV('approved') as any, [TP('t1', 'sms', 'ready', { approved: { hash: 'h' } })]);
    expect(approved.displayState).toBe('approved');
    expect(approved.editable).toBe(false);
    expect(approved.todo).toBe(false);

    const held = toCalendarEvent(EV('approved') as any, [TP('t1', 'sms', 'hold_credit', { approved: { hash: 'h' } })]);
    expect(held.displayState).toBe('hold');
    expect(held.touchpoints[0].resumable).toBe(true);
    const unknown = toCalendarEvent(EV('approved') as any, [TP('t1', 'sms', 'locked', { approved: { hash: 'h' }, send_started_at: 'x' })]);
    expect(unknown.touchpoints[0].resumable).toBe(false);

    const cancelled = toCalendarEvent(EV('cancelled', { closedReason: 'not_approved' }) as any, []);
    expect(cancelled.displayState).toBe('cancelled');
    expect(cancelled.todo).toBe(false);
    expect(cancelled.closedReason).toBe('not_approved');
    expect(PLANNER_TODO_STATES).toEqual(['material', 'review', 'hold']);
  });
});

describe('⑥ 고객 문장', () => {
  it('플래너 새 흐름 파일의 한글 문자열(로그 제외)에 줄표(—)가 없다', () => {
    const files = ['planner-approve.ts', 'planner-review.ts', 'planner-executor.ts', 'planner-calendar.ts', '../routes/marketing-planner.ts', 'planner-copy.ts', 'planner-reconcile.ts'];
    for (const f of files) {
      const lines = read(f).split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !l.includes('console.')).map((l) => l.replace(/\s\/\/.*$/, ''));
      for (const l of lines) {
        const strs = l.match(/(['`])(?:(?!\1).)*[가-힣](?:(?!\1).)*\1/g) || [];
        for (const s of strs) expect(s, `${f}: ${s}`).not.toContain('—');
      }
    }
  });
});

describe('⑧ Codex 1R 구조 정정(돈 원자성 · 실행 소유권 · 행사 변경 가드)', () => {
  it('차감 CT는 호출부 트랜잭션 모드에서 BEGIN·COMMIT·ROLLBACK을 하지 않는다(중복·미적용 반환도 호출부 트랜잭션을 건드리지 않는다)', async () => {
    const { _deductWithClient } = await import('../ai-credit-tx');
    const mk = (dup: boolean) => {
      const calls: string[] = [];
      return {
        calls,
        async query(sql: string) {
          const s = sql.trim();
          calls.push(s.split(/\s+/)[0]);
          if (/FOR UPDATE OF c/.test(s)) return { rows: [{ base: 100, purchased: 0, cap: null, reset_at: '2026-10-01T00:00:00Z', plan_credits: 800 }] };
          if (/SELECT 1 FROM ai_credit_transactions/.test(s)) return { rows: dup ? [{ ok: 1 }] : [] };
          return { rows: [], rowCount: 1 };
        },
      };
    };
    const NOW = new Date('2026-10-04T03:00:00Z');
    const a = mk(false);
    const r1 = await _deductWithClient(a, { companyId: 'c1', cost: 10, source: 'planner-monthly-agency', idempotencyKey: 'k1' }, NOW, { manageTx: false });
    expect(r1.deducted).toBe(true);
    expect(a.calls.filter((c) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(c))).toEqual([]);
    const b = mk(true);
    const r2 = await _deductWithClient(b, { companyId: 'c1', cost: 10, source: 'planner-monthly-agency', idempotencyKey: 'k1' }, NOW, { manageTx: false });
    expect(r2.skipReason).toBe('duplicate');
    expect(b.calls.filter((c) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(c))).toEqual([]);
    // 기본값(관리) = 종전 그대로
    const c = mk(false);
    await _deductWithClient(c, { companyId: 'c1', cost: 10, source: 'orchestrate', idempotencyKey: 'k2' }, NOW);
    expect(c.calls[0]).toBe('BEGIN');
    expect(c.calls[c.calls.length - 1]).toBe('COMMIT');
  });

  it('실행: 선점 토큰 · 선점 뒤 다시 읽기 · 소유 확인 조건부 시도 표식(문자·DM·메일) · 지문 대조는 선점 때 각인까지 본다', () => {
    const exec = read('planner-executor.ts');
    expect(exec).toContain("if (!(await claimTouchpointUnderPlanLock(tp, ['ready'], 'claimed_at', companions, token))) return 'not_due';");
    const iClaim = exec.indexOf('claimTouchpointUnderPlanLock(tp, [');
    const iReload = exec.indexOf('const owned = await loadTouchpointById(tp.companyId, tp.id);');
    expect(iReload).toBeGreaterThan(iClaim);
    expect(exec).toContain("row.execMeta?.claim_token === token");
    expect(exec).toContain('stamped === claim.hashes.get(row.id)');
    expect(exec).toContain('return stampSendAttemptOwned(tp.companyId, [tp.id], claim.token, at);');
    // 메일도 보내기 전에 시도 표식(H4)
    const mail = exec.slice(exec.indexOf('async function executeEmail('));
    expect(mail.indexOf('await stampSendAttempt(tp, claim, { email_campaign_id: campaignId })')).toBeLessThan(mail.indexOf('await sendEmailCampaign('));
    // 시도 표식은 producing + 같은 토큰일 때만 · 쌍은 한 트랜잭션
    const tp = read('planner-touchpoint.ts');
    const owned = tp.slice(tp.indexOf('export async function stampSendAttemptOwned('));
    expect(owned).toContain("AND status = 'producing' AND exec_meta->>'claim_token' = $3");
    expect(owned).toContain('if (r.rows.length !== ids.length) {');
    // 선점 SQL이 발송 여부 모르는 문자·DM을 다시 집지 않는다(H6) · 메일은 이어 보내기 가능
    const claim = tp.slice(tp.indexOf('export async function claimTouchpointUnderPlanLock'));
    expect((claim.match(/AND NOT \(channel IN \('sms', 'dm'\) AND \(exec_meta \? 'send_started_at'\) AND exec_ref IS NULL\)/g) || []).length).toBe(2);
    expect(exec).toContain("if (tp.execMeta?.send_started_at && !tp.execRef && tp.channel !== 'email') return 'unresumable';");
  });

  it('후보 전수(H7) · 완료 판정 한 벌(M11)', () => {
    const exec = read('planner-executor.ts');
    expect(exec).toContain("const rows = await loadAllLiveTouchpoints({ statuses: ['ready'], scheduledFrom: today, scheduledTo: today, requireApproved: true }");
    expect(exec).not.toMatch(/loadLiveTouchpoints\(\{ statuses: \['ready'\][^)]*limit: 200/);
    const rec = read('planner-reconcile.ts');
    expect((rec.match(/await loadAllLiveTouchpoints\(/g) || []).length).toBe(2);
    const tp = read('planner-touchpoint.ts');
    const all = tp.slice(tp.indexOf('export async function loadAllLiveTouchpoints('));
    expect(all).toContain('if (rows.length < pageSize) break;');
    expect(all).not.toContain('maxPages'); // 2R H7 — 상한은 매 주기 같은 앞쪽만 읽어 뒤쪽 당일 행을 굶긴다
    const mark = exec.slice(exec.indexOf('async function markSent('), exec.indexOf('// ── 문자·DM 쌍 마감'));
    expect(mark).toContain("await settleEventIfFinished(tp.companyId, tp.eventId, 'missed')");
    expect(mark).not.toContain("'locked'].includes(s)");
  });

  it('행사 변경 가드: 생성 중 = CAS 잠금(H8) · 발송 이력 있는 행사 월 이동 금지(H3) · 완성본 지문에 행사 사실(H9) · 문안 CAS(M10)', () => {
    const build = read('planner-build.ts');
    const run = build.slice(build.indexOf('export async function runPlannerBuild('));
    const iMark = run.indexOf("jsonb_build_object('building'");
    const iEngine = run.indexOf('await generateFromBuildMaterials(');
    expect(iMark).toBeGreaterThan(-1);
    expect(iMark).toBeLessThan(iEngine);
    expect(run).toContain("AND status IN ('draft', 'briefed', 're_brief')");
    expect(run).toContain('if (marked.rows.length === 0) {');
    expect(run).toContain('materialsHash: plannerBuildInputHash(ev, materials)');
    const evSrc = read('planner-event.ts');
    expect(evSrc).toContain("if (isBuilding(ev.meta)) throw new PlannerEventWriteError(409, 'BUILDING'");
    expect(evSrc).toContain("throw new PlannerEventWriteError(409, 'MONTH_LOCKED'");
    expect(evSrc).toContain('const materialsHash = plannerBuildInputHash(ev, ev.meta.materials || null);');
    const route = read('../routes/marketing-planner.ts');
    const del = route.slice(route.indexOf("router.delete('/events/:id'"));
    expect(del).toContain("e.meta->'building' IS NULL");
    const copy = read('planner-copy.ts');
    expect(copy).not.toContain('setTouchpointState(');
    expect((copy.match(/setTouchpointMetaIfCopyIs\(companyId, carrier\.id, (before|cur),/g) || []).length).toBe(5);
    const edit = copy.slice(copy.indexOf('export async function editPlannerCopy('), copy.indexOf('export async function runPlannerCopyPass('));
    expect(edit.indexOf("FOR UPDATE")).toBeLessThan(edit.indexOf("UPDATE planner_touchpoints SET exec_meta"));
    expect(edit).toContain("await client.query('COMMIT');");
  });

  it('완성본 지문 = 재료 + 행사 사실(순수) — 혜택만 바꿔도 다른 값', async () => {
    const { plannerBuildInputHash } = await import('../planner-event');
    const m = { images: [], text: '가을 신상', licensed: false, products: [] };
    const a = plannerBuildInputHash({ title: '가을', startsOn: '2026-10-10', endsOn: '2026-10-12', benefitText: '10%' }, m);
    expect(plannerBuildInputHash({ title: '가을', startsOn: '2026-10-10', endsOn: '2026-10-12', benefitText: '10%' }, m)).toBe(a);
    expect(plannerBuildInputHash({ title: '가을', startsOn: '2026-10-10', endsOn: '2026-10-12', benefitText: '15%' }, m)).not.toBe(a);
    expect(plannerBuildInputHash({ title: '가을', startsOn: '2026-10-11', endsOn: '2026-10-12', benefitText: '10%' }, m)).not.toBe(a);
  });
});

describe('⑦ 화면 계약(상태 사전 · 로그인 복귀 · 공개 고지)', () => {
  const FRONT = path.join(__dirname, '../../../../frontend/src');
  const front = (f: string) => readFileSync(path.join(FRONT, f), 'utf8');

  it('상태 사전 키 = 서버 PlannerDisplayState(한 벌 · 사전에 없는 값은 그리지 않는다)', () => {
    const server = read('planner-event.ts').match(/export type PlannerDisplayState = ([^;]+);/)![1];
    const client = front('constants/planner-status.ts').match(/export type PlannerDisplayState = ([^;]+);/)![1];
    const keys = (s: string) => Array.from(s.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]).sort();
    expect(keys(client)).toEqual(keys(server));
    expect(front('constants/planner-status.ts')).toContain('export const PLANNER_STATE: Record<PlannerDisplayState, PlannerStateStyle>');
    // 옛 DM 단계 사전은 남아 있지 않다
    expect(() => front('constants/planner-dm.ts')).toThrow();
  });

  it('로그인 복귀 = 허용 경로만 · 보호 경로 진입과 로그인 성공 분기 두 곳이 같은 키를 쓴다', () => {
    const util = front('utils/login-return.ts');
    expect(util).toContain('isLoginReturnAllowed(path)');
    expect(util).toContain(String.raw`/^\/marketing-planner\/events\/`);
    expect(front('App.tsx')).toContain('rememberLoginReturn(`${location.pathname}${location.search}`)');
    const login = front('pages/LoginPage.tsx');
    // ★ 2026-10-09 비밀번호 변경 뒤에는 새 비밀번호로 다시 로그인한다(서버가 변경 전 세션을 주지 않는다) → 성공 분기 1곳만 복귀 키를 쓴다
    expect((login.match(/takeLoginReturn\(\) \|\| '\/dashboard'/g) || []).length).toBe(1);
  });

  it('무로그인 화면 3종 공통 고지 · 확인 화면 토큰은 # 뒤에서 읽고 본문으로만 보낸다', () => {
    const notice = '이 화면은 입력을 받지 않습니다. 로그인은 hanjul.ai 로그인 화면에서만 합니다.';
    for (const f of ['pages/AgencyApprovePage.tsx', 'pages/ChargeApprovePage.tsx', 'pages/PlannerConfirmPage.tsx']) {
      expect(front(f), f).toContain(notice);
      expect(front(f), f).not.toContain('로그인·비밀번호·결제정보를 묻는 비슷한 화면은 가짜');
    }
    const page = front('pages/PlannerConfirmPage.tsx');
    expect(page).toContain('useApproveToken()');
    expect(page).toContain("'/api/marketing-planner/confirm-view', { body: { token }, auth: false }");
  });

  it('토스트 값은 고정이다(F3 · toast를 훅 의존성에 둔 화면의 재조회 반복 차단)', () => {
    expect(front('components/ToastProvider.tsx')).toContain('const value = useMemo<ToastContextValue>(() => ({');
  });
});

describe('⑨ Codex 2R — 선점 뒤 쓰기 = 소유 조건 · 예정일 재확인 · 생성 잠금 입력 대조 · 문안 고치기 리비전', () => {
  it('실행 워커의 producing 쓰기는 전부 선점 토큰을 조건으로 건다(옛 실행이 새 주인의 행을 덮거나 되돌리지 않는다)', () => {
    const exec = read('planner-executor.ts');
    const hits = [...exec.matchAll(/\['producing'\]/g)].map((m) => exec.slice(m.index!, m.index! + 160));
    expect(hits.length).toBeGreaterThanOrEqual(8);
    for (const h of hits) expect(h).toMatch(/claimToken|claim\.token|\btoken\b/);
    const back = exec.slice(exec.indexOf('async function backToReview('), exec.indexOf('/** 예외(throw) 뒤 동반 DM 정리'));
    expect(back).toContain('claimToken: claim.token');
    expect(back).toContain("return out === 'cancelled' ? 'skipped' : 'not_due';");
    const tp = read('planner-touchpoint.ts');
    expect(tp).toContain("guard += ` AND exec_meta->>'claim_token' = $${params.length}`;");
    expect(tp).toContain("AND ($8::text IS NULL OR t.exec_meta->>'claim_token' = $8)");
    const rv = read('planner-review.ts');
    const revert = rv.slice(rv.indexOf('export async function revertEventToReview('), rv.indexOf('export function kickPlannerReview('));
    const iOwn = revert.indexOf("AND status = 'producing' AND exec_meta->>'claim_token' = $3");
    expect(iOwn).toBeGreaterThan(revert.indexOf('FOR UPDATE')); // 월 → 행사 잠금 뒤
    expect(revert.slice(iOwn, iOwn + 80)).toContain('FOR UPDATE');
    expect(revert).toContain("return 'lost';");
    expect(iOwn).toBeLessThan(revert.indexOf("UPDATE planner_touchpoints SET status = 'skipped'"));
  });

  it('예정일 재확인(H5) — 선점 전 최신 행 · 선점 뒤 최신 행 둘 다 오늘인지 보고, 아니면 내 토큰으로 선점을 놓는다', () => {
    const exec = read('planner-executor.ts');
    const run = exec.slice(exec.indexOf('export async function executeTouchpoint('), exec.indexOf('export type ResumeOutcome'));
    const iFresh = run.indexOf("if (classifyExecutionWindow(fresh.scheduledOn, today) !== 'due') return 'not_due';");
    expect(iFresh).toBeGreaterThan(-1);
    expect(iFresh).toBeLessThan(run.indexOf('claimTouchpointUnderPlanLock('));
    const iSlot = run.indexOf('let sameSlot = owned!.scheduledOn === tp.scheduledOn');
    expect(iSlot).toBeGreaterThan(run.indexOf('const owned = await loadTouchpointById('));
    expect(iSlot).toBeLessThan(run.indexOf('const claim: ClaimCtx'));
    expect(run.slice(iSlot, iSlot + 1200)).toContain("['producing'], token,");
    // 3R — 선점 뒤 쌍을 같은 판정 함수로 다시 보고, 선점한 묶음(동반 DM id)과 정확히 같아야 보낸다
    expect(run).toContain('const { decision, siblings } = await decidePair(tp, null);');
    expect(run.slice(iSlot)).toContain("const post = (await decidePair(owned!, token)).decision;");
    expect(run.slice(iSlot)).toContain("sameSlot = post.action === 'send' && (post.attach?.id ?? null) === (link.dm?.id ?? null);");
    expect(exec).toContain("status: ownToken && s.status === 'producing' && s.execMeta?.claim_token === ownToken ? 'ready' : s.status,");
    // 3R — 발송 마감 보완 기록도 소유 조건(주인을 잃었으면 새 실행의 행에 쓰지 않는다)
    const mark = exec.slice(exec.indexOf('async function markSent('), exec.indexOf('// ── 문자·DM 쌍 마감'));
    expect(mark).toContain('{ ...r.execMetaPatch, mark_sent_conflict: true }, claimToken)');
    expect(read('planner-touchpoint.ts')).toContain("AND ($4::text IS NULL OR exec_meta->>'claim_token' = $4)`,");
  });

  it('생성 잠금(H8) = 읽은 리비전 + 그 채널의 승인 전 접점이 그대로일 때만 · 문안 고치기(M10) = 잠금 안 리비전 재확인', () => {
    const build = read('planner-build.ts');
    const run = build.slice(build.indexOf('export async function runPlannerBuild('));
    const iCas = run.indexOf("jsonb_build_object('building'");
    const cas = run.slice(iCas, run.indexOf('RETURNING id', iCas));
    expect(cas).toContain("AND COALESCE((meta->>'revision')::int, 0) = $4");
    expect(cas).toContain("AND t.channel = $3 AND t.status = 'planned'");
    expect(run).toContain('[ev.id, ev.companyId, input.channel, Number(ev.meta.revision) || 0]');
    const copy = read('planner-copy.ts');
    const edit = copy.slice(copy.indexOf('export async function editPlannerCopy('), copy.indexOf('export async function runPlannerCopyPass('));
    const iRev = edit.indexOf('if (Number(lockEv.rows[0]?.revision) !== (Number(ev.meta.revision) || 0)) {');
    expect(iRev).toBeGreaterThan(edit.indexOf('FOR UPDATE'));
    expect(iRev).toBeLessThan(edit.indexOf('UPDATE planner_touchpoints SET exec_meta'));
  });
});
