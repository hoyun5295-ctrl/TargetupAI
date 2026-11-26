// replaces: none
/**
 * 대행발송 통신사 스팸 막힘 「그대로 보내기」(★ 2026-11-24 · 설계서 docs/2026-11-24-agency-spam-override-design.md §4) — 판정(순수) · 배선(소스 계약).
 *   실행 트랜잭션 = agency-spam-override-1124.pg.test.ts(실 PG).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { spamOverrideOf, agencyActions } from '../agency-send-actions';
import { buildPassedNotify, buildTooTightNotify } from '../agency-send-notify';
import { stripComments } from './helpers/producer-scan';

const BE = join(__dirname, '..', '..');
const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const be = (rel: string) => stripComments(read(join(BE, rel)));

const NOW = new Date('2026-11-25T03:00:00Z');   // KST 12:00
const kst = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h - 9, mi));
function row(o: Record<string, any> = {}) {
  return {
    status: 'test_failed', content_version: 3, revision: 7, campaign_id: null,
    requested_at: kst(2026, 11, 27, 10),
    last_test_result: { round: 3, spamOverridable: { version: 3, submitted: '(광고) 겨울 행사 안내', checkedAt: NOW.toISOString(), submittedTested: true } },
    ...o,
  };
}

describe('판정 spamOverrideOf', () => {
  it('통신사 막힘 · 버전 같음 · 다른 날 = 허용 · 보낼 글 = 표식 글 · 당일 검사 끝 없음', () => {
    const o = spamOverrideOf(row(), NOW);
    expect(o).toMatchObject({ ok: true, text: '(광고) 겨울 행사 안내', retime: false });
    expect(o.finalTestedAt).toBeNull();
  });
  it('막힘 아닌 상태 · 표식 없음 · 버전 다름 · 글 없음 · 이미 적재 = 불가', () => {
    expect(spamOverrideOf(row({ status: 'awaiting_approval' }), NOW).ok).toBe(false);
    expect(spamOverrideOf(row({ last_test_result: { round: 3 } }), NOW).ok).toBe(false);
    expect(spamOverrideOf(row({ last_test_result: null }), NOW).ok).toBe(false);
    expect(spamOverrideOf(row({ content_version: 4 }), NOW).ok).toBe(false);
    expect(spamOverrideOf(row({ last_test_result: { spamOverridable: { version: 3, submitted: '  ', checkedAt: NOW.toISOString() } } }), NOW).ok).toBe(false);
    expect(spamOverrideOf(row({ campaign_id: 'c1' }), NOW).ok).toBe(false);
  });
  it('당일 막힘(2시간 안쪽 · 15분 밖) = 허용 · 당일 검사 끝 = 막힌 시각(설계 1R #1 · 2R #1)', () => {
    const checkedAt = kst(2026, 11, 25, 11, 30);
    const o = spamOverrideOf(row({ requested_at: kst(2026, 11, 25, 13, 0), last_test_result: { spamOverridable: { version: 3, submitted: '글', checkedAt: checkedAt.toISOString(), submittedTested: true } } }), NOW);
    expect(o.ok).toBe(true);
    expect(o.finalTestedAt?.getTime()).toBe(checkedAt.getTime());
  });
  it('당일 막힘이어도 보낼 글 자체를 검사하지 않았으면(다듬은 글만 막힘 · 옛 표식) 당일 검사 끝 없음 · 2시간 안쪽 = 시각 변경(Codex 구현 1R #2)', () => {
    const checkedAt = kst(2026, 11, 25, 11, 30);
    for (const tested of [false, undefined]) {
      const far = spamOverrideOf(row({ requested_at: kst(2026, 11, 25, 18, 0), last_test_result: { spamOverridable: { version: 3, submitted: '글', checkedAt: checkedAt.toISOString(), submittedTested: tested } } }), NOW);
      expect(far.ok).toBe(true);
      expect(far.finalTestedAt).toBeNull();
      const near = spamOverrideOf(row({ requested_at: kst(2026, 11, 25, 13, 0), last_test_result: { spamOverridable: { version: 3, submitted: '글', checkedAt: checkedAt.toISOString(), submittedTested: tested } } }), NOW);
      expect(near).toMatchObject({ ok: false, retime: true });
    }
  });
  it('다른 날 막힘 + 보낼 시각까지 2시간 안쪽 = 불가 · 시각 변경 안내(retime)', () => {
    const o = spamOverrideOf(row({ requested_at: kst(2026, 11, 25, 13, 0), last_test_result: { spamOverridable: { version: 3, submitted: '글', checkedAt: kst(2026, 11, 24, 18).toISOString() } } }), NOW);
    expect(o).toMatchObject({ ok: false, retime: true });
    expect(o.reason).toMatch(/시각을 먼저 바꿔/);
  });
  it('보낼 시각 15분 전 잠금 = 불가 · retime', () => {
    const o = spamOverrideOf(row({ requested_at: kst(2026, 11, 25, 12, 10) }), NOW);
    expect(o).toMatchObject({ ok: false, retime: true });
  });
  it('조작 주체 = 로그인 화면만(링크 · 운영 불가)', () => {
    expect(agencyActions('user', row(), NOW).spamOverride.ok).toBe(true);
    expect(agencyActions('link', row(), NOW).spamOverride.ok).toBe(false);
    expect(agencyActions('staff', row(), NOW).spamOverride.ok).toBe(false);
  });
});

describe('배선(소스 계약)', () => {
  const worker = be('utils/agency-send-worker.ts');
  it('setStatus = 표식 기본 삭제 · 넘긴 결과 칸에서도 뺌 · 막힘 갈래만 얹음', () => {
    const fn = worker.slice(worker.indexOf('async function setStatus('), worker.indexOf('const NOTIFY_TIMEOUT_MS'));
    expect(fn).toContain("col === 'last_test_result' ? `${col} = ($${i}::jsonb) - 'spamOverridable'`");
    expect(fn).toContain("jsonb_set(COALESCE(last_test_result, '{}'::jsonb), '{spamOverridable}', $${i}::jsonb)");
    expect(fn).toContain("last_test_result = last_test_result - 'spamOverridable'");
  });
  it('표식을 넘기는 setStatus = 1차 · 2시간 전 막힘 둘뿐(★ 2026-11-26 C164 — 「주소를 바꿔 주세요」로 멈추던 4a 는 없앴다 = 진단 트랜잭션의 표식 UPDATE 0)', () => {
    const calls = worker.match(/spamOverridable: /g) || [];
    expect(calls.length).toBe(2);
    const diag = be('utils/agency-spam-diag.ts');
    expect(worker).toContain("setStatus(row.id, 'test_failed', { ...RELEASE }, token, { spamOverridable: marker })");
    expect(worker).toContain("setStatus(target.id, 'test_failed', { ...RELEASE }, token, { spamOverridable: finalMarker })");
    expect(worker).toContain("const submitted = String(row.original_content || '');");
    // ★ Codex 구현 1R #2 — 보낼 글을 이 주기 첫 회차에서 새로 검사했을 때만 당일 근거(진단 T 이어 보기 = null)
    // ★ 1R ~ 4R 같은 뿌리의 구조 답 — 당일 근거 = 보낼 글을 본 검사 행의 시각(셋 다 같은 함수 · 짐작 0)
    expect(worker).toContain('const marker = spamOverrideMarker(savedVersion, submitted, firstTest);');
    expect(worker).toContain('const finalMarker = spamOverrideMarker(version, finalSubmitted, firstTest);');
    expect(diag).not.toMatch(/settleAgencyDiag4a|kind: '4a'/);
    expect(worker).not.toMatch(/settleDiag4a|addressCause/);
    const fnAt = diag.indexOf('export function spamOverrideMarker(');
    expect(fnAt).toBeGreaterThan(0);
    const fn = diag.slice(fnAt, diag.indexOf('\n}\n', fnAt) + 3);
    expect(fn.length).toBeGreaterThan(100);
    expect(fn).not.toMatch(/await|query\(|readDiagParent|pool\./);   // 표식 = 순수(따로 읽기 0)
    expect(worker).toContain('if (firstTest === undefined) { const vid = Object.keys(result.testIds ?? {})[0]; firstTest = vid ? { content, createdAt: result.testCreatedAt?.[vid] ?? null } : null; }');
    const q = be('utils/spam-test-queue.ts');
    expect(q).not.toMatch(/reused\[variantId\]|spamTestCreatedAt/);   // 덧댄 장치 · 따로 읽기는 지웠다
    expect(q).toContain('SELECT status, created_at FROM spam_filter_tests WHERE id = $1');
    expect(q).toContain('if (seen && test.rows[0]?.created_at) seen.createdAt = new Date(test.rows[0].created_at);');
    expect((q.match(/testIds,\n\s+testCreatedAt,/g) || []).length).toBe(2);   // 두 반환 모두
    expect(worker).toContain("return { verdict: 'blocked', passed: false, finalContent: content, rounds, detail, firstTest: firstTest ?? null };");

  });
  it('2시간 전 재검사 = 고른 버전이면 한 차례 · 막힘이면 당일 검사 받아들이기(한 트랜잭션) 뒤에만 적재', () => {
    const fn = worker.slice(worker.indexOf('async function finalTestRow('), worker.indexOf('async function dispatchToPipeline('));
    expect(fn).toContain('runSpamRound(target, overridden ? MAX_TEST_ROUNDS - 1 : 0)');
    const acc = fn.indexOf('acceptOverriddenFinalBlock(target.id, token');
    const disp = fn.indexOf("await dispatchToPipeline(target, String(target.current_content || ''), token);");
    expect(acc).toBeGreaterThan(0);
    expect(disp).toBeGreaterThan(acc);
    const tx = worker.slice(worker.indexOf('async function acceptOverriddenFinalBlock('), worker.indexOf('// ────────────── A. 1차 검사'));
    expect(tx).toContain("await client.query('BEGIN');");
    expect(tx).toContain('WHERE id = $1::uuid AND lock_token = $2::uuid');
    expect(tx).toContain("'spam_override_final'");
    expect(tx).toContain("if ((u.rowCount || 0) === 0) { await client.query('ROLLBACK'); return false; }");
  });
  it('막힘 문자 둘 = 승인 토큰 발급 0(perPhoneTexts · buildApproveTexts 를 싣지 않는다 · 설계 2R #2)', () => {
    const notifyBlocks = worker.split('text: buildTestFailedNotify(').slice(1).map((b) => b.slice(0, 300));
    expect(notifyBlocks.length).toBe(2);   // ★ 1126 C164 — 1차 · 2시간 전 막힘 둘(4a 문자는 없앴다)
    for (const b of notifyBlocks) expect(b.split('});')[0]).not.toMatch(/perPhoneTexts|buildApproveTexts/);
  });
  it('입구 = 로그인 화면 라우트 하나(소유자 술어) · 링크 라우트에 그대로 보내기 0', () => {
    const route = be('routes/agency-send.ts');
    const blk = route.slice(route.indexOf("router.post('/:id/spam-override'"), route.indexOf("router.post('/:id/reschedule'"));
    expect(blk).toContain('ownerUserId: ownerParam(auth)');
    expect(blk).toContain('sendAgencyApprovalRequest(String(out.row.id), { withTest: true, version: Number(out.row.content_version) })');
    // ★ Codex 구현 1R #1 — 발신 인증 = 승인과 같은 관문 · 같은 403 몸통
    expect(blk).toContain("if ('senderAuth' in out) return res.status(403).json(senderAuthRejection(out.senderAuth));");
    expect(blk).toContain('req: { ip: req.ip, headers: req.headers }');
    expect(be('routes/agency-approve.ts')).not.toMatch(/spam-override|overrideSpamBlockTx/);
  });
  it('발신 인증 관문 = 승인 · 그대로 보내기가 같은 함수 · 그대로 보내기는 트랜잭션 앞에서(막히면 상태 변경 0 · Codex 구현 1R #1)', () => {
    const approve = be('utils/agency-send-approve.ts');
    expect(approve).toContain('const gate = await agencySenderAuthGate(preRow, approverUserId, opts.req);');
    expect((approve.match(/checkSenderAuthGate\(/g) || []).length).toBe(1);   // 관문 호출 = 공용 함수 한 곳
    const change = be('utils/agency-send-change.ts');
    const fn = change.slice(change.indexOf('export async function overrideSpamBlockTx('));
    const gate = fn.indexOf('const gate = await agencySenderAuthGate(row, input.actorUserId, input.req);');
    expect(gate).toBeGreaterThan(0);
    expect(fn.indexOf('const client = await pool.connect();')).toBeGreaterThan(gate);
    expect(fn.indexOf('const pre = spamOverrideOf(row')).toBeLessThan(gate);   // 판정을 지난 건에만 인증번호
  });
  it('승인 요청 문자 = 부른 쪽이 커밋한 버전만 · 링크도 같은 버전 · 시각 · 상태일 때만(Codex 구현 1R #3)', () => {
    const fn = worker.slice(worker.indexOf('export async function sendAgencyApprovalRequest('));
    expect(fn).toContain('if (opts.version !== undefined && Number(row.content_version) !== opts.version) return;');
    const test = fn.indexOf('await sendManagerTest(');
    const guard = fn.indexOf("if (!linkRow || linkRow.status !== 'awaiting_approval' || Number(linkRow.content_version) !== Number(row.content_version)");
    expect(guard).toBeGreaterThan(test);
    expect(fn.indexOf('buildApproveTexts(')).toBeGreaterThan(guard);
    expect(fn).toContain('new Date(linkRow.requested_at).getTime() !== new Date(row.requested_at).getTime()');
    expect(worker).toContain('`SELECT content_version, requested_at, manager_phones, manager_phone, status FROM agency_send_requests WHERE id = $1::uuid`');
  });
  it('그대로 보내기 버전 = 「통과」라고 쓰지 않는다 · 판정 한 곳(isSpamOverriddenVersion)을 문자 · 상세 · 링크가 같이 쓴다(Codex 구현 1R #4)', () => {
    const ctx = { label: '겨울 행사', whenText: '11월 27일 10:00', count: 3 };
    for (const t of [buildPassedNotify({ ...ctx, overridden: true }), buildPassedNotify({ ...ctx, overridden: true, originalWhenText: '11월 27일 09:00' }), buildTooTightNotify({ ...ctx, overridden: true })]) {
      expect(t).not.toMatch(/통과/);
      expect(t).toMatch(/그대로 보내기로/);
    }
    expect(buildPassedNotify(ctx)).toMatch(/스팸 검사를 통과했습니다/);   // 고르지 않은 버전 = 지금 문장 그대로
    expect(buildTooTightNotify(ctx)).toMatch(/검사를 통과했지만/);
    const fn = worker.slice(worker.indexOf('export async function sendAgencyApprovalRequest('));
    expect(fn).toContain('const overridden = await isSpamOverriddenVersion(String(row.id), Number(row.content_version));');
    // ★ 2026-11-25 승인 요청 두 문장에 빈 자리 줄(blankLine)이 붙는다(설계서 docs/2026-11-25-agency-intake-slip-multisheet-design.md §5-4)
    expect((fn.match(/overridden(?:, blankLine)? \}\)/g) || []).length).toBe(3);   // 촉박 · 승인 요청 본문 · 담당자별 링크 문장
    expect(worker).toContain('const overridden = await isSpamOverriddenVersion(target.id, Number(target.content_version));');
    const route = be('routes/agency-send.ts');
    expect(route).toContain('const spamOverridden = await isSpamOverriddenVersion(String(row.id), Number(row.content_version)).catch(() => null);');
    const link = be('routes/agency-approve.ts');
    expect(link).toContain('spamOverridden: await isSpamOverriddenVersion(String(row.id), Number(row.content_version)).catch(() => null)');
    expect(link).not.toMatch(/loadCallbackKinds\(/);
    const detail = read(join(FE, 'components/agency/AgencySendDetail.tsx'));
    expect(detail).toContain('{req.spamOverridden === true');
    expect(detail).toContain("(req.spamOverridden === false ? ' 검사는 이미 통과했으니");   // null = 확인 못 함 = 통과 문구 0
    expect(detail).toContain('{req.finalTestRequired && req.spamOverridden === false ?');
    expect(detail).toContain('if (senderAuth.handleResponse(e?.data, () => { void doSpamOverride(); })) return;');
    const page = read(join(FE, 'pages/AgencyApprovePage.tsx'));
    expect(page).toContain('...(r.spamOverridden === true ? [{ tone: ');
    expect(page).toContain('overridden: r.spamOverridden === true, finalTested: r.finalTested === true });');
    expect(page).toContain("r.spamOverridden === false ? '검사를 통과한 문안 그대로");
  });
  it('사건 이름 = 화면 문장 등재(미등재 kind 는 화면에서 문장이 뭉개진다)', () => {
    const log = read(join(FE, 'components/agency/AgencyEventLog.tsx'));
    expect(log).toContain("spam_override: '스팸 검사 결과와 관계없이 그대로 보내기로 했습니다'");
    expect(log).toContain("spam_override_final: '발송 직전 검사에 걸렸지만 담당자 선택대로 진행합니다'");
    expect(log).toContain("approval_request_skipped: ");
  });
});
