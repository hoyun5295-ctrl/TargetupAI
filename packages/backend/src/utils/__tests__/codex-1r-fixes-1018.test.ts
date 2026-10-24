/**
 * ★2026-10-18 Codex 적대 1R 정정 회귀(설계서 docs/2026-10-18-planner-v2-design.md §3-5~3-8)
 *
 *   A 재확인 링크 = 기기 증명 · 토큰 해시 · 마감은 잠금 뒤 · 미루기 날짜 잠금 · 재실행 표시
 *   B 템플릿 생성 = 상품 부족 차단 · 이미 낸 생성비는 잔액 재검사 안 함
 *   C 자동 보정 = 먼저 알리고 바꾼다 · 커밋 뒤 부가 조회 실패 = 실패로 답하지 않는다
 *   D 대행발송 = 쌍둥이 잠금 · 명단 비교 뒤 LIMIT · 막는 집합(끝난 발송 제외) · 처리 중 취소 문장 · 24시간 만료 따로 집기
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { senderAuthDeviceProof } from '../sender-auth';
import { isResumeTwinBlocking, resumeTwinBlockingSql, RESUME_TWIN_DONE } from '../agency-send-state';
import { buildLinkActionNotify } from '../agency-send-notify';
import { linkCancelReason, linkCancelTailOf } from '../agency-send-link';
import { confirmLineAudience, readPlannerLine } from '../planner-line-read';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');
const fnBody = (src: string, head: string) => {
  const s = src.indexOf(head);
  expect(s).toBeGreaterThanOrEqual(0);
  const next = src.indexOf('\nexport ', s + head.length);
  return src.slice(s, next < 0 ? undefined : next);
};
/** 순서 고정 — 앞 표지가 뒤 표지보다 먼저 나온다 */
const inOrder = (seg: string, marks: string[]) => {
  let at = -1;
  for (const m of marks) {
    const i = seg.indexOf(m, at + 1);
    expect(i, `「${m}」 위치`).toBeGreaterThan(at);
    at = i;
  }
};

describe('A 재확인 링크', () => {
  it('기기 증명 = 키 · 인증 행 · 확인 시각에 묶인다 · 키 없음 = 던짐', () => {
    const prev = process.env.JWT_SECRET;
    try {
      process.env.JWT_SECRET = 'k1';
      const a = senderAuthDeviceProof('c1', '2026-10-18T03:00:00.000Z');
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(senderAuthDeviceProof('c1', '2026-10-18T03:00:00.000Z')).toBe(a);
      expect(senderAuthDeviceProof('c2', '2026-10-18T03:00:00.000Z')).not.toBe(a);
      expect(senderAuthDeviceProof('c1', '2026-10-18T03:00:01.000Z')).not.toBe(a);
      process.env.JWT_SECRET = 'k2';
      expect(senderAuthDeviceProof('c1', '2026-10-18T03:00:00.000Z')).not.toBe(a);
      delete process.env.JWT_SECRET;
      expect(() => senderAuthDeviceProof('c1', '2026-10-18T03:00:00.000Z')).toThrow();
    } finally {
      if (prev === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prev;
    }
  });
  it('엄격판 두 입구 = 기기 증명 필수', () => {
    const src = read('../sender-auth.ts');
    expect(fnBody(src, 'export async function checkStrictSenderAuth(')).toContain('deviceProofMatches(');
    expect(fnBody(src, 'export async function isStrictSenderAuthAlive(')).toContain('deviceProofMatches(');
  });
  it('링크 = 토큰 해시 대조 · 승인 · 건너뛰기 · 고치기 · 미루기 모두 잠금 비교 뒤 마감 확인', () => {
    const src = read('../planner-recheck.ts');
    expect(src).toMatch(/actor\.via === 'link' && \(!actor\.tokenHash \|\| String\(p\.recheck\.tokenHash \|\| ''\) !== actor\.tokenHash\)/);
    const pairs = src.split('await lockPairUnchanged(client, p);').slice(1);
    expect(pairs.length).toBe(4);
    for (const seg of pairs) expect(seg.trimStart().startsWith('assertBeforeDeadline(p,')).toBe(true);
  });
  it('미루기 = 날짜 잠금 먼저 → 쌍 잠금 → 마감 → 같은 연결로 날짜 재확인 · 패스 겹침 = 한 번 더 돈다', () => {
    const src = read('../planner-recheck.ts');
    const seg = fnBody(src, 'export async function deferPlannerPairTx(');
    const tx = seg.slice(seg.indexOf('await inTx(async (client) => {'));
    inOrder(tx, ['pg_advisory_xact_lock(hashtext($1))', 'planner-defer:', 'await lockPairUnchanged(client, p);', 'assertBeforeDeadline(p,', 'listDeferDates(p, input.now || new Date(), client)', "'DATE_TAKEN'", 'UPDATE planner_touchpoints']);
    expect(src).toContain('if (recheckRunning) { recheckAgain = true; return out; }');
    const tp = read('../planner-touchpoint.ts');
    expect(tp).toContain('const r = await (input.db ? input.db.query.bind(input.db) : query)(');
  });
  it('토큰 결박 = 다시 읽은 쌍도 요청 토큰의 회차 · 링크 취소 = 취소 트랜잭션 안에서 토큰 대조(소비 · 되돌리기 장치 없음)', () => {
    const src = read('../planner-recheck.ts');
    expect(src).toContain("return pair && safeEq(String(pair.recheck.tokenHash || ''), h) ? { kind: 'open', pair } : null;");
    expect(src).not.toMatch(/consumeRecheckToken|restoreRecheckToken/);
    const route = read('../../routes/planner-recheck-public.ts');
    expect(route).not.toMatch(/consumeRecheckToken|restoreRecheckToken/);
    expect(route).toContain('linkGuard: { touchpointId: p.carrier.id, tokenHash: hash, round: Number(p.recheck.round) },');
    const cancel = fnBody(read('../planner-approve.ts'), 'export async function cancelPlannerEvent(');
    inOrder(cancel, ["client.query('BEGIN')", 'FROM planner_monthly_approvals', 'FROM planner_events', 'if (input.linkGuard) {', "exec_meta->'recheck'->>'tokenHash' = $4", 'FOR UPDATE', "'LINK_EXPIRED'", "status = 'producing'", "SET status = 'skipped'", "client.query('COMMIT')"]);
  });
  it('재확인 패스는 발송 패스 겹침 가드 앞에서 따로 돈다', () => {
    const src = read('../planner-executor.ts');
    inOrder(src, ['void runPlannerRecheckPass()', 'if (passRunning) return']);
  });
  it('링크 화면 = 확인 응답의 기기 증명을 헤더로 싣는다', () => {
    const page = read('../../../../frontend/src/pages/PlannerRecheckPage.tsx');
    expect(page).toContain("'X-Sender-Auth-Device': deviceRef.current");
    expect(read('../../routes/planner-recheck-public.ts')).toContain('out.body.device = senderAuthDeviceProof(verdict.challengeId, verdict.verifiedAt)');
  });
});

describe('B 템플릿 생성', () => {
  it('상품 부족 = MATERIAL_THIN · 이미 낸 생성비 = 잔액 재검사 건너뜀', () => {
    const src = read('../planner-build.ts');
    inOrder(src, ['plannerTemplateProducts(', "'MATERIAL_THIN', '고른 상품이 품절이거나", 'const alreadyPaid = await isChargedByKey(', 'if (!alreadyPaid) {', 'deps.checkCredit(']);
  });
});

describe('B 2R 받는 사람 문형(허용 목록)', () => {
  const NOW = Date.parse('2026-10-18T03:00:00Z');
  const aud = (line: string) => readPlannerLine(line, NOW).audience;
  it('구매 꼴 뒤 부정 · 조건이 붙으면 문형이 깨져 사람이 고른다', () => {
    for (const line of [
      '가을 세일 타겟은 크림 구매하지 못한 고객', '가을 세일 타겟은 크림 구매 안 한 고객', '가을 세일 타겟은 크림 구매 이력 없는 고객',
      '가을 세일 타겟은 크림을 구매한 적 없는 고객', '가을 세일 타겟은 크림 제외 구매 고객', '가을 세일 타겟은 크림 말고 다른 상품 구매 고객',
      '가을 세일 타겟은 크림 미구매 고객', '가을 세일 타겟은 크림 비구매자', '가을 세일 타겟은 크림 한번도 안 산 고객',
      '가을 세일 타겟은 크림 구매자 빼고 전부', '가을 세일 타겟은 크림 노구매 고객', '가을 세일 타겟은 부산 지역 고객 모두',
    ]) expect(aud(line)?.kind, line).toBe('unread');
  });
  it('★ B 4R — 맞는 꼴 + 상품 칸 낱말 하나만 구매자 · 두 낱말 이상 = 사람이 고른다(제외어 · 수식어가 낄 자리 없음)', () => {
    expect(aud('가을 세일 타겟은 기초제품구매했던 모두야')).toEqual({ kind: 'product_buyers', terms: ['기초'], allTime: true });
    expect(aud('가을 세일 타겟은 크림을 구매한 고객')).toEqual({ kind: 'product_buyers', terms: ['크림'], allTime: false });
    for (const line of [
      '가을 세일 타겟은 크림이랑 토너 구매한 고객 모두', '가을 세일 대상은 크림 및 토너 산 고객', '가을 세일 대상은 안티에이징 크림 구매자',
      '가을 세일 대상은 크림 토너 에센스 앰플 세럼 마스크 구매 고객', '가을 세일 타겟은 테이블 외의 상품 구매 고객', '가을 세일 타겟은 모든 피부 타입용 크림 구매 고객',
    ]) expect(aud(line)?.kind, line).toBe('unread');
  });
  it('★ B 5R — 상품 칸과 구매 꼴 사이 경계 필수(붙여 쓴 미구매 · 구매 = 사람) · 「제품 · 을」 경계는 읽는다', () => {
    for (const line of ['가을 세일 타겟은 크림미구매 고객', '가을 세일 타겟은 크림구매한 고객', '가을 세일 타겟은 크림을미구매한 고객', '가을 세일 타겟은 크림제품미구매 고객', '가을 세일 타겟은 크림구매자']) {
      expect(aud(line)?.kind, line).toBe('unread');
    }
    expect(confirmLineAudience(aud('가을 세일 타겟은 크림미구매 고객'), ['보습 크림미스트'])?.kind).toBe('unread');
    expect(aud('가을 세일 타겟은 기초제품구매했던 모두야')).toMatchObject({ kind: 'product_buyers', terms: ['기초'] });
    expect(aud('가을 세일 타겟은 크림을구매한 고객')).toMatchObject({ kind: 'product_buyers', terms: ['크림'] });
    expect(aud('가을 세일 타겟은 크림 산 고객')).toMatchObject({ kind: 'product_buyers', terms: ['크림'] });
  });
  it('★ B 3R — 기록 전체 = 고객 말 앞 「모든」 · 끝 「모두 · 전부 · 전체 · 다」 자리만', () => {
    expect(aud('가을 세일 타겟은 크림 산 모든 고객')).toMatchObject({ kind: 'product_buyers', terms: ['크림'], allTime: true });
    expect(aud('가을 세일 타겟은 크림 산 고객')).toMatchObject({ kind: 'product_buyers', terms: ['크림'], allTime: false });
  });
  it('★ B 3R — 상품 칸 낱말이 하나라도 관측 상품명에 없으면 사람이 고른다 · 목록 없음 · 못 읽음 = 사람', () => {
    const names = ['수분 크림 50ml', '토너 200ml', '기초 3종 세트'];
    expect(confirmLineAudience({ kind: 'product_buyers', terms: ['외의'], allTime: false }, names)?.kind).toBe('unread');
    expect(confirmLineAudience(aud('가을 세일 타겟은 세럼 구매 고객'), names)?.kind).toBe('unread');
    expect(confirmLineAudience(aud('가을 세일 타겟은 기초제품구매했던 모두야'), names)).toEqual({ kind: 'product_buyers', terms: ['기초'], allTime: true });
    expect(confirmLineAudience(aud('가을 세일 타겟은 크림 구매 고객'), [])?.kind).toBe('unread');
    expect(confirmLineAudience(aud('가을 세일 타겟은 크림 구매 고객'), null)?.kind).toBe('unread');
    expect(confirmLineAudience({ kind: 'all' }, null)).toEqual({ kind: 'all' });
    expect(confirmLineAudience(null, names)).toBeNull();
    const route = read('../../routes/marketing-planner.ts');
    // ★ 1024 R9 — 읽기 · 담기가 같은 함수(readLineForCompany)로 확정한다
    inOrder(route, ['async function readLineForCompany(', 'readPlannerLine(line, nowMs)', 'loadPlannerLineAskContext(companyId', 'read.audience = confirmLineAudience(read.audience, ctx.products ? ctx.products.list.map((p) => p.name) : null);']);
    inOrder(route, ["router.post('/line-read', async", 'readLineForCompany(req, companyId, line, Date.now())', 'plannerLineAsk(read, ctx)']);
    // ★ B 4R — 상품 목록 = 대상 CT 한 곳 · 시간 상한 안 · 실패 · 초과 = null(사람이 고름)
    const ct = fnBody(read('../planner-audience.ts'), 'export async function loadPlannerLineAskContext(');
    inOrder(ct, ['Promise.race([', 'listObservedProducts(companyId, door)', 'setTimeout(() => resolve(null), LINE_AUDIENCE_CONFIRM_MS)', '.catch(', 'clearTimeout(timer)']);
  });
});

describe('C 알림 · 정지 결과', () => {
  it('★ C 2R — 알림 성공 = 큐에 실제로 한 건(보낼 것 없음 = 성공 · 적재 0건 = 실패)', () => {
    const src = read('../journey-pretest-notifier.ts');
    const fn = src.slice(src.indexOf('async function notifyManagerForStep('));
    expect(fn).toMatch(/Promise<boolean>/);
    expect(fn).toContain('const inserted = await bulkInsertSmsQueue(');
    expect(fn).toContain('return inserted === 1;');
    expect((fn.slice(0, fn.indexOf('const inserted')).match(/return;/g) || []).length).toBe(0);
    expect(src).toContain('const ok = await notifyManagerForStep(b, preview, mode);');
  });
  it('자동 보정 = 알림 성공 뒤에만 본문 갱신 · 실패 = 여정 정지', () => {
    const src = read('../journey-pretest-notifier.ts');
    const seg = src.slice(src.indexOf('if (r2.enqueueOk && r2.ok) {'));
    inOrder(seg, ["if (!(await safeNotify(b, regenBody, 'pretest_autofixed'))) {", 'await pauseJourney(', 'continue;', 'UPDATE journey_step_snapshots SET message_body']);
  });
  it('정지 커밋 뒤 집계 · 조회 실패 = 실패로 답하지 않는다', () => {
    const src = read('../journey-pause-handler.ts');
    expect(src).toMatch(/countStartedSends\([^)]*\)\.catch\(/);
    expect(src).toMatch(/SELECT status FROM journeys WHERE id = \$1::uuid`, \[payload\.journey_id\]\)\.catch\(\(\) => null\)/);
    const stop = read('../../routes/autosend-stop-public.ts');
    expect(stop.match(/view: await loadAutosendStopView\(p\)\.catch\(\(\) => null\)/g)?.length).toBe(2);
  });
});

describe('D 대행발송', () => {
  const now = new Date('2026-10-18T03:00:00Z');
  it('막는 집합 = 메일 중복 집합에서 끝난 발송(sent)만 뺀다 · SQL 과 판정이 한 벌', () => {
    for (const s of RESUME_TWIN_DONE) expect(isResumeTwinBlocking(s, null, now)).toBe(false);
    for (const s of ['received', 'testing', 'awaiting_approval', 'approved', 'final_testing', 'reapproval', 'test_failed', 'cancelling'] as const) {
      expect(isResumeTwinBlocking(s, null, now)).toBe(true);
    }
    expect(isResumeTwinBlocking('queued', new Date(now.getTime() + 60_000), now)).toBe(true);
    expect(isResumeTwinBlocking('queued', new Date(now.getTime() - 60_000), now)).toBe(false);
    expect(isResumeTwinBlocking('queued', null, now)).toBe(false);
    expect(RESUME_TWIN_DONE).toEqual(['expired', 'cancelled', 'sent']);
    expect(resumeTwinBlockingSql('r')).toBe("(r.status NOT IN ('expired','cancelled','sent') AND NOT (r.status = 'queued' AND r.requested_at <= NOW()))");
  });
  it('쌍둥이 조회 = 명단 비교가 LIMIT 앞(SQL 한 번)', () => {
    const seg = fnBody(read('../agency-send-change.ts'), 'export async function findBlockingTwinRequest(');
    inOrder(seg, ["resumeTwinBlockingSql('r')", 'array_agg(x.phone ORDER BY x.phone)', 'array_agg(y.phone ORDER BY y.phone)', 'LIMIT 1']);
    expect(seg).not.toMatch(/for \(const/);
  });
  it('만료 건 다시 진행 = 같은 연결 · 잠금 → 쌍둥이 확인 → 갱신 → 커밋', () => {
    const seg = fnBody(read('../agency-send-change.ts'), 'export async function rescheduleAgencyRequestTx(');
    inOrder(seg, ["const resuming = row.status === 'expired';", "client.query('BEGIN')", 'pg_advisory_xact_lock(hashtext($1))', 'agency-twin:', 'findBlockingTwinRequest(input.companyId, input.requestId, String(row.original_content || \'\'), q)', 'const updated = await q(', "client.query('COMMIT'); committed = true;", "if (!committed) await client.query('ROLLBACK')", 'client?.release()', 'return afterReschedule(']);   // ★ 1019 Codex L3 늘 한 트랜잭션
    // 쌍둥이 · 차단 갈래에 따로 적은 ROLLBACK 이 없다(되돌림 = finally 한 곳)
    expect(seg.match(/client\.query\('ROLLBACK'\)/g)?.length).toBe(1);
  });
  it('링크 취소 처리 중 = 「취소되었습니다」라고 말하지 않는다 · 확정 뒤 결과를 따로 알린다', () => {
    const pending = buildLinkActionNotify({ label: '가을 세일', action: 'cancel', tail: '5678', pending: true });
    const sent = buildLinkActionNotify({ label: '가을 세일', action: 'cancel', tail: '5678', alreadySent: true });
    expect(pending).toContain('처리하고 있습니다');
    expect(pending).not.toContain('취소되었습니다');
    expect(sent).toContain('취소하지 못했습니다');
    for (const t of [pending, sent]) expect(t).not.toMatch(/[—–]/);
    expect(buildLinkActionNotify({ label: '가을 세일', action: 'cancel', tail: '5678' })).toContain('취소되었습니다');
    expect(read('../../routes/agency-approve.ts')).toContain("afterLinkAction(req, resolved, 'cancel', out.row, { pending: out.pending, ...(out.finalizedElsewhere ? { finalizedElsewhere: true } : {}) });");
    // 워커 F = 확정 · 이미 발송 두 갈래 모두 이번 취소를 잡은 UPDATE 의 cancel_reason 으로 정한다(★ Codex D 2R · 부가 이력에 기대지 않는다)
    const w = read('../agency-send-worker.ts');
    inOrder(w, ["logEvent(row.id, 'cancel_already_sent'", 'await notifyLinkCancelOutcome(row.id, row.cancel_reason, true);', "logEvent(row.id, 'cancel_swept'", 'await notifyLinkCancelOutcome(row.id, row.cancel_reason, false);']);
    expect(w).not.toContain("kind = 'link_cancel'");
    expect(w).toMatch(/SELECT id, company_id, revision, campaign_id, dispatch_key, lock_at, updated_at, cancel_reason\s+FROM agency_send_requests\s+WHERE status = 'cancelling'/);
    expect(read('../../routes/agency-approve.ts')).toContain('reason: linkCancelReason(resolved.phone),');
  });
  it('★ D 3R — 확정 CAS 에서 진 라우트는 결과 문자를 보내지 않는다(워커 F 몫) · 화면은 처리 중 문장', () => {
    const cancel = read('../agency-send-cancel.ts');
    expect(cancel).toContain("return { ok: true, pending: false, row: cur.rows[0], finalizedElsewhere: true };");
    const route = read('../../routes/agency-approve.ts');
    const fn = route.slice(route.indexOf('function afterLinkAction('), route.indexOf('const actorOf'));
    inOrder(fn, ['void logEvent(', 'void recordAuditLog(', 'if (extra.finalizedElsewhere === true) return;', 'void notifyManager(']);
    expect(route).toContain('const pending = out.pending || !!out.finalizedElsewhere;');
  });
  it('링크 취소 표지 = 끝자리 왕복 · 화면 사유 · 빈 값 · 이미 발송 되돌림(NULL) = 링크 아님', () => {
    expect(linkCancelReason('010-1234-5678')).toBe('담당자 링크 취소(끝자리 5678)');
    expect(linkCancelTailOf(linkCancelReason('01012345678'))).toBe('5678');
    for (const r of ['담당자 취소', '담당자 링크 취소', null, undefined, '', '담당자 링크 취소(끝자리 12)']) expect(linkCancelTailOf(r)).toBeNull();
  });
  it('만료 재진행 = 차단 판정도 같은 연결 · 0행 응답의 지금 행은 연결을 돌려준 뒤', () => {
    const seg = fnBody(read('../agency-send-change.ts'), 'export async function rescheduleAgencyRequestTx(');
    expect(seg).toContain('await attemptBlocksChange(input.companyId, input.requestId, row.dispatch_key, q)');
    // ★ 1019 0행 응답 = staleFail(연결을 돌려준 뒤 일반 조회로 지금 행 · 잠금이면 잠금 사유)
    inOrder(seg, ['stale = true;', 'client?.release()', 'if (stale) return staleFail(']);
    const sf = fnBody(read('../agency-send-change.ts'), 'async function staleFail(');
    expect(sf).toContain('await currentRow(requestId, companyId)');
    const tx = seg.slice(seg.indexOf("client.query('BEGIN')"), seg.indexOf('client?.release()'));
    expect(tx).not.toContain('currentRow(');
    expect(read('../agency-send-campaign.ts')).toMatch(/q: \(text: string, params\?: any\[\]\) => Promise<any> = query,\s*\): Promise<\{ id: string \| null; kind: CampaignKind/);
  });
  it('24시간 만료 후보 = 리드타임 후보와 따로 집는다(밀리지 않게)', () => {
    const src = read('../agency-send-worker.ts');
    const seg = src.slice(src.indexOf('const lead = await query('));
    inOrder(seg, ["requested_at < NOW() + INTERVAL '2 hours'", 'LIMIT 20', 'await hasApprovalRequestedColumn()', 'approval_requested_at <= NOW() - INTERVAL', 'ORDER BY approval_requested_at', 'LIMIT 20', 'seenIds']);
  });
});
