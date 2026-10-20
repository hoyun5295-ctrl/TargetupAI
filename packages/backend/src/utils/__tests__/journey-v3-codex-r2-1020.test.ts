/**
 * 여정 V.3 — Codex 적대 2라운드 정정 고정(2026-10-20)
 *
 * 서버(A 2R · 1R A1 과 같은 뿌리 = 판정 · 차감 한 지점으로는 「무과금 발송 0」 과 「보낸 날만 과금」을 함께 못 지킨다)
 *   → 보내기 전 차감 = 그날 몫을 잡아 두기 · 하루가 끝난 뒤 그 계보 · 그 날짜에 실제 발송 0건이면 되돌린다(journey-operation-release).
 * 화면(B 2R)
 *   - 결과를 못 받은 칸 넣기 = 칸 수가 아니라 보낸 내용 지문으로 서버에서 찾는다 · 못 찾으면 표시만 남기고 다시 넣지 않는다
 *   - 다시 읽기(sync) = 이전 기준 대비 내가 고친 키만 새 서버 값 위에(rebaseForm · 칸 초안도 같은 규칙)
 *   - 담당자 알림 뒤 다시 읽기 = sync · 저장 중 = inert + 함수 잠금
 *   - 창 겹침 = 공용 껍데기가 화면 맨 위 창만 키를 받는다 · 켜기 확인 창도 그 껍데기로
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf-8');
const FE = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', rel), 'utf-8');

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../ai-credit', () => ({ refundCredit: vi.fn() }));
vi.mock('../journey-lineage', () => ({ lineageColumnsReady: vi.fn(async () => true) }));

describe('운영 크레딧 잡아 둔 날 되돌리기', () => {
  let db: any; let credit: any;
  beforeEach(async () => {
    db = await import('../../config/database');
    credit = await import('../ai-credit');
    db.query.mockReset(); credit.refundCredit.mockReset();
  });
  it('후보 = 지난 날(KST) 운영 차감 · 아직 안 되돌림 · 그 계보 · 그 날짜 발송(sent · sending) 0건', async () => {
    const { releaseCandidatesSql } = await import('../journey-operation-release');
    const sql = releaseCandidatesSql('COALESCE(j.lineage_id, j.id)');
    expect(sql).toContain("t.source = 'journey-operation' AND t.type = 'deduct'");
    expect(sql).toContain("split_part(t.idempotency_key, ':', 3) < to_char((NOW() AT TIME ZONE 'Asia/Seoul')::date, 'YYYYMMDD')");
    expect(sql).toContain("r.idempotency_key = 'release:' || t.idempotency_key");
    expect(sql).toContain("l.status IN ('sent', 'sending')");   // 결과 모름 표식 = 보낸 것으로(모르면 돌려주지 않는다)
    expect(sql).toContain("to_char((l.sent_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYYMMDD') = split_part(t.idempotency_key, ':', 3)");
    // 키 둘째 마디 = 계보 뿌리(V.3) 또는 옛 판 여정 id(V.3 전) — 둘 다 그 계보의 발송
    expect(sql).toContain("(j.id::text = split_part(t.idempotency_key, ':', 2) OR (COALESCE(j.lineage_id, j.id))::text = split_part(t.idempotency_key, ':', 2))");
    expect(sql).toContain('j.company_id = t.company_id');
  });
  it('후보마다 원 차감 키로 되돌림(멱등 키 release: · 금액 = 원 차감 크기)', async () => {
    db.query.mockResolvedValue({ rows: [{ company_id: 'c1', idempotency_key: 'journey-operation:root1:20261019', amount: -10 }] });
    credit.refundCredit.mockResolvedValue({ refunded: true, amount: 10 });
    const { releaseUnusedOperationCredits } = await import('../journey-operation-release');
    const r = await releaseUnusedOperationCredits();
    expect(r.released).toBe(1);
    expect(credit.refundCredit).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'c1', amount: 10, source: 'journey-operation',
      idempotencyKey: 'release:journey-operation:root1:20261019', originalIdempotencyKey: 'journey-operation:root1:20261019',
    }));
  });
  it('한 건 실패가 나머지를 막지 않는다', async () => {
    db.query.mockResolvedValue({ rows: [{ company_id: 'c1', idempotency_key: 'k1', amount: 10 }, { company_id: 'c2', idempotency_key: 'k2', amount: 10 }] });
    credit.refundCredit.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ refunded: true, amount: 10 });
    const { releaseUnusedOperationCredits } = await import('../journey-operation-release');
    expect((await releaseUnusedOperationCredits()).released).toBe(1);
  });
  it('발송 뒤 확정 차감 날짜 = 표식 시각(자정을 넘겨도 잡아 둔 날과 같은 판정 축 · 한 발송에 두 날 차감 0)', () => {
    const ex = SRC('journey-executor.ts');
    expect(ex).toContain('RETURNING id, sent_at`');
    expect(ex).toContain('claimAt = claim.rows[0]?.sent_at ? new Date(claim.rows[0].sent_at) : null;');
    expect(ex).toContain('await chargeJourneyOperationCredit(exec, claimAt ?? new Date());');
    expect(ex).not.toContain('await chargeJourneyOperationCredit(exec, new Date());');
  });
  it('10분 작업자 체인에 붙어 있다', () => {
    expect(SRC('ai-usage-threshold-alert.ts')).toContain('.then(async () => { await releaseUnusedOperationCredits(); })');
  });
});

describe('다시 읽기 병합(rebaseForm)', () => {
  it('내가 고친 키만 새 서버 값 위에 · 다른 사람이 바꾼 키는 서버 값 · 이미 같은 값은 버림 · 양쪽이 바꾼 키 = 충돌(내 값)', async () => {
    const { rebaseForm } = await import('../../../../frontend/src/utils/journey-start-form');
    const oldInit = { thresholdRecipients: 500, budgetMonthly: null, holdoutPct: 0, goalKind: 'purchase' };
    const current = { thresholdRecipients: 500, budgetMonthly: 30000, holdoutPct: 10, goalKind: 'click' };   // 내가 예산 · 대조군 · 목표 종류를 고침
    const server = { thresholdRecipients: 50, budgetMonthly: 30000, holdoutPct: 5, goalKind: 'purchase' };   // 다른 사람이 최대 인원 · 대조군을 바꿈 · 예산은 내가 이미 저장
    const r = rebaseForm(oldInit, current, server);
    expect(r.form.thresholdRecipients).toBe(50);        // 내가 안 건드린 키 = 서버 값(되돌리지 않음)
    expect(r.form.budgetMonthly).toBe(30000);           // 이미 서버와 같음
    expect(r.form.goalKind).toBe('click');              // 내가 바꾸고 서버는 그대로 = 내 값
    expect(r.form.holdoutPct).toBe(10);                 // 양쪽이 바꿈 = 내 값 · 충돌
    expect(r.conflicts).toBe(1);
  });
});

describe('화면 B 2R', () => {
  const ws = FE('components/journey/workspace/JourneyWorkspace.tsx');
  it('결과를 못 받은 칸 넣기 = 칸 수 · 내용 지문으로 추측하지 않는다(3R 에서 서버 멱등으로 · journey-v3-codex-r3-1020)', () => {
    expect(ws).not.toContain('countSteps');
    expect(ws).not.toContain('landedIn');
    expect(ws).not.toContain('studioSig');
  });
  it('sync = rebaseForm · 칸 초안도 이전 칸 대비 고친 키만 새 칸 위에', () => {
    expect(ws).toContain('const rebased = rebaseForm(initialFormRef.current, formRef.current, f);');
    expect(ws).toContain('for (const k of Object.keys(diffPatch(os, dr))) {');
  });
  it('담당자 알림 뒤 다시 읽기 = sync · 저장 중 = inert + 편집 함수 잠금', () => {
    expect(ws).toContain("onChange={() => { if (journeyId) void load(journeyId, false, 'sync'); }}");
    expect(ws).toContain("const inertProps: Record<string, string> = blocking ? { inert: '' } : {};");
    expect((ws.match(/\{\.\.\.inertProps\}/g) || []).length).toBe(4);
    expect(ws).toContain("if (id === 'start' || editLockRef.current) return;");
    expect(ws).toContain("setField={(k, v) => { if (!editLockRef.current) setForm((f) => ({ ...f, [k]: v })); }}");
  });
  it('공용 창 껍데기 = 화면 맨 위 창만 Esc · Tab · 켜기 확인 창도 그 껍데기(자체 키 처리 · 포털 없음)', () => {
    const shell = FE('components/journey/JourneyModalShell.tsx');
    expect(shell).toContain("if ((e.key === 'Escape' || e.key === 'Tab') && !isTop()) return;");
    expect(shell).toContain('document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)');
    expect(shell).toContain('ref={rootRef}');
    const act = FE('components/journey/JourneyActivationConfirmModal.tsx');
    expect(act).toContain('<JourneyModalShell open onClose={onClose} labelledBy="jact-title"');
    expect(act).toContain("disableDismiss={phase === 'activating'}");
    expect(act).not.toContain('createPortal');
    expect(act).not.toContain("window.addEventListener('keydown'");
  });
});
