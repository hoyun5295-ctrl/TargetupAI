/**
 * 스팸 검사·맞춤법 사용 기록 상세 모달 (★2026-09-28 Harold 지시 · ceo 전용 · 읽기만)
 *
 * 요구: "최근 사용 기록"의 한 줄을 누르면 어떤 문안을 썼고 무엇이 어떻게 고쳐졌는지(맞춤법) · 통신사별 결과(스팸 검사)를 본다.
 * 원천:
 *   - 스팸 검사 = spam_filter_tests(문안·회신번호) + spam_filter_test_results(통신사·종류별 결과) — 지난 기록도 전부 있다
 *   - 맞춤법 대행 = agency_send_requests(current_content · spell_check) — 검사 뒤 문안을 고치면 결과가 지워진다
 *   - 맞춤법 직접발송 = spell_check_uses 에 **새로 저장**(checked_text · issues · 0928 ALTER) — 그 전 기록은 개수만 있다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();
vi.mock('../../config/database', () => ({
  default: { connect: vi.fn() },
  query: (...a: any[]) => (queryMock as any)(...a),
}));

import {
  parsePrecheckDetailQuery, precheckDetailType, buildSpamResultGrid, readStoredSpellIssues, loadPrecheckDetail,
} from '../precheck-usage';
import { recordSpellDetail, DIRECT_SPELL_SOURCE } from '../spell-check-quota';

const src = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
const front = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', rel), 'utf8');

const UUID = '11111111-2222-4333-8444-555555555555';
const issue = { id: 'i1', start: 13, end: 17, before: '됬습니다', after: '됐습니다', kind: 'typo', reason: '준말' };

beforeEach(() => { queryMock.mockReset(); });

describe('상세 조회 조건', () => {
  it('목록 줄의 종류·구분 → 상세 종류', () => {
    expect(precheckDetailType('spam', 'manual')).toBe('spam');
    expect(precheckDetailType('spam', 'auto_ai')).toBe('spam');
    expect(precheckDetailType('spell', 'direct')).toBe('spell_direct');
    expect(precheckDetailType('spell', 'agency')).toBe('spell_agency');
  });

  it('스팸·대행 = uuid · 직접발송 = 숫자 id · 그 밖은 거절(null)', () => {
    expect(parsePrecheckDetailQuery({ type: 'spam', ref: UUID })).toEqual({ type: 'spam', ref: UUID });
    expect(parsePrecheckDetailQuery({ type: 'spell_agency', ref: UUID })).toEqual({ type: 'spell_agency', ref: UUID });
    expect(parsePrecheckDetailQuery({ type: 'spell_direct', ref: '123' })).toEqual({ type: 'spell_direct', ref: '123' });
    expect(parsePrecheckDetailQuery({ type: 'spam', ref: '123' })).toBeNull();
    expect(parsePrecheckDetailQuery({ type: 'spell_direct', ref: UUID })).toBeNull();
    expect(parsePrecheckDetailQuery({ type: 'spell_direct', ref: '1; DROP' })).toBeNull();
    expect(parsePrecheckDetailQuery({ type: 'other', ref: UUID })).toBeNull();
    expect(parsePrecheckDetailQuery({})).toBeNull();
  });
});

describe('스팸 검사 통신사별 결과표', () => {
  it('통신사 순서 SKT·KT·LGU · 종류 SMS·LMS · 이름표는 결과 CT(getSpamResultLabel) 그대로', () => {
    const g = buildSpamResultGrid([
      { carrier: 'LGU', message_type: 'SMS', received: false, received_at: null, result: 'blocked' },
      { carrier: 'SKT', message_type: 'LMS', received: true, received_at: '2026-09-28T02:47:33Z', result: 'pass' },
      { carrier: 'SKT', message_type: 'SMS', received: true, received_at: '2026-09-28T02:47:21Z', result: 'pass' },
      { carrier: 'KT', message_type: 'SMS', received: false, received_at: null, result: null },
    ]);
    expect(g.types).toEqual(['SMS', 'LMS']);
    expect(g.rows.map((r) => r.carrier)).toEqual(['SKT', 'KT', 'LGU']);
    expect(g.rows[0].cells.SMS).toEqual({ label: '정상', tone: 'pass', receivedAt: '2026-09-28T02:47:21Z' });
    expect(g.rows[1].cells.SMS).toEqual({ label: '대기', tone: 'pending', receivedAt: null });
    expect(g.rows[1].cells.LMS).toBeNull();
    expect(g.rows[2].cells.SMS).toEqual({ label: '차단', tone: 'blocked', receivedAt: null });
    expect(g.total).toBe(4);
    expect(g.pass).toBe(2);
    expect(g.blocked).toBe(1);
  });

  it('단문만 검사했으면 장문 열이 없다', () => {
    const g = buildSpamResultGrid([{ carrier: 'KT', message_type: 'SMS', received: true, received_at: null, result: 'pass' }]);
    expect(g.types).toEqual(['SMS']);
  });
});

describe('저장된 고칠 곳 읽기', () => {
  it('배열 안의 올바른 항목만 · 배열이 아니면 null', () => {
    expect(readStoredSpellIssues([issue, { before: 1 }, null])).toEqual([issue]);
    expect(readStoredSpellIssues(JSON.stringify([issue]))).toEqual([issue]);
    expect(readStoredSpellIssues(null)).toBeNull();
    expect(readStoredSpellIssues({ a: 1 })).toBeNull();
  });
});

describe('직접발송 맞춤법: 검사 내용 저장', () => {
  it('문안·고칠 곳을 그 기록 행에 싣는다(jsonb = JSON.stringify)', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await recordSpellDetail(7, '출고 됬습니다', [issue as any]);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/UPDATE spell_check_uses SET checked_text = \$2, issues = \$3::jsonb\s+WHERE id = \$1/);
    expect(params).toEqual([7, '출고 됬습니다', JSON.stringify([issue])]);
  });

  it('기록 id가 없으면(표 없는 무제한 회사) 아무것도 안 한다', async () => {
    await recordSpellDetail(null, 'x', []);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('칸이 아직 없거나 저장이 실패해도 던지지 않는다(검사 결과는 그대로 나간다)', async () => {
    queryMock.mockRejectedValueOnce(Object.assign(new Error('column "checked_text" does not exist'), { code: '42703' }));
    await expect(recordSpellDetail(7, 'x', [])).resolves.toBeUndefined();
    queryMock.mockRejectedValueOnce(new Error('connection reset'));
    await expect(recordSpellDetail(7, 'x', [])).resolves.toBeUndefined();
  });

  it('검사 라우트: 성공한 검사만 · 기록을 마친 뒤 · 응답을 기다리게 하지 않는다', () => {
    const s = src('routes/send-checks.ts');
    const body = s.slice(s.indexOf("router.post('/spell'"));
    const fin = body.indexOf('const recorded = await finishSpellUse(');
    const rec = body.indexOf('void recordSpellDetail(');
    expect(rec).toBeGreaterThan(fin);
    expect(body.slice(fin, rec)).toContain('if (recorded && !r.failed)');
  });
});

describe('상세 불러오기', () => {
  it('스팸 검사: 문안·회신번호 + 결과표', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ callback_number: '18000000', message_content_sms: '(광고)가', message_content_lms: null, subject: null, status: 'completed' }] })
      .mockResolvedValueOnce({ rows: [{ carrier: 'SKT', message_type: 'SMS', received: true, received_at: null, result: 'pass' }] });
    const d: any = await loadPrecheckDetail({ type: 'spam', ref: UUID });
    expect(d.type).toBe('spam');
    expect(d.callbackNumber).toBe('18000000');
    expect(d.sms).toBe('(광고)가');
    expect(d.lms).toBeNull();
    expect(d.status).toBe('completed');
    expect(d.grid.pass).toBe(1);
    expect(queryMock.mock.calls[0][1]).toEqual([UUID]);
  });

  it('직접발송: 저장된 문안·고칠 곳 · 옛 기록은 stored=false', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ status: 'done', issue_count: 1, checked_text: '출고 됬습니다', issues: [issue] }] });
    const d: any = await loadPrecheckDetail({ type: 'spell_direct', ref: '7' });
    expect(d).toMatchObject({ type: 'spell_direct', stored: true, text: '출고 됬습니다', issueCount: 1, status: 'done' });
    expect(d.issues).toEqual([issue]);
    expect(queryMock.mock.calls[0][0]).toMatch(/FROM spell_check_uses WHERE id = \$1::bigint AND source = \$2/);
    expect(queryMock.mock.calls[0][1]).toEqual(['7', DIRECT_SPELL_SOURCE]);

    queryMock.mockResolvedValueOnce({ rows: [{ status: 'done', issue_count: 2, checked_text: null, issues: null }] });
    const old: any = await loadPrecheckDetail({ type: 'spell_direct', ref: '8' });
    expect(old).toMatchObject({ stored: false, text: null, issues: null, issueCount: 2 });
  });

  it('대행: 지금 문안의 결과만(버전 같고 실패 아님) · 아니면 이유', async () => {
    const base = { message_type: 'LMS', subject: '제목', current_content: '본문', content_version: 3 };
    queryMock.mockResolvedValueOnce({ rows: [{ ...base, spell_check: { version: 3, checkedAt: 't', issues: [issue], failed: false } }] });
    expect(await loadPrecheckDetail({ type: 'spell_agency', ref: UUID })).toMatchObject({ state: 'ok', issues: [issue], checkedAt: 't', text: '본문' });
    queryMock.mockResolvedValueOnce({ rows: [{ ...base, spell_check: { version: 2, checkedAt: 't', issues: [issue], failed: false } }] });
    expect(await loadPrecheckDetail({ type: 'spell_agency', ref: UUID })).toMatchObject({ state: 'changed', issues: null });
    queryMock.mockResolvedValueOnce({ rows: [{ ...base, spell_check: { version: 3, checkedAt: 't', issues: [], failed: true } }] });
    expect(await loadPrecheckDetail({ type: 'spell_agency', ref: UUID })).toMatchObject({ state: 'failed', issues: null });
    queryMock.mockResolvedValueOnce({ rows: [{ ...base, spell_check: null }] });
    expect(await loadPrecheckDetail({ type: 'spell_agency', ref: UUID })).toMatchObject({ state: 'missing', issues: null });
  });

  it('없는 기록 = null', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await loadPrecheckDetail({ type: 'spell_agency', ref: UUID })).toBeNull();
  });
});

describe('목록 → 상세 연결 · 게이트 · 화면', () => {
  it('목록 줄에 상세 종류와 기록 번호를 싣는다', () => {
    const s = src('utils/precheck-usage.ts');
    expect(s).toContain('SELECT ev.kind, ev.sub, ev.status, ev.issues, ev.created_at, ev.ref_id,');
    expect(s).toContain('detailType: precheckDetailType(r.kind, r.sub),');
    expect(s).toContain('ref: r.ref_id ? String(r.ref_id) : null,');
  });

  it('서버: ceo 판정 CT를 통과해야만 · 칸 부재 = 503 DB_MIGRATION_PENDING', () => {
    const a = src('routes/admin.ts');
    const body = a.slice(a.indexOf("router.get('/precheck-usage/detail', authenticate, requireSuperAdmin,"));
    expect(body.length).toBeLessThan(a.length);
    const gate = body.indexOf('isPrecheckUsageViewer(req.user?.userId)');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(body.indexOf('loadPrecheckDetail('));
    expect(body.slice(0, body.indexOf('loadPrecheckDetail('))).toContain('res.status(403)');
    const end = body.indexOf('\n});');
    expect(body.slice(0, end)).toContain("migrationPendingBody('spell_check_uses ALTER (checked_text · issues)')");
  });

  it('화면: 줄을 누르면 상세 창 · 배경 클릭으로 닫히지 않는다 · native dialog·모델명 0', () => {
    const tab = front('components/admin/PrecheckUsageTab.tsx');
    expect(tab).toContain('<PrecheckUsageDetailModal');
    expect(tab).toMatch(/onClick=\{\(\) => setDetailRow\(r\)\}/);
    const m = front('components/admin/PrecheckUsageDetailModal.tsx');
    expect(m).toContain('/api/admin/precheck-usage/detail?');
    expect(m).not.toMatch(/\b(alert|confirm|prompt)\(/);
    expect(m).not.toMatch(/Opus|Sonnet|Haiku|Claude|GPT|Anthropic/);
    // 오버레이(가장 바깥 fixed)에는 닫기 트리거가 없다 — X·닫기·ESC만
    const overlay = m.slice(m.indexOf('fixed inset-0'), m.indexOf('>', m.indexOf('fixed inset-0')));
    expect(overlay).not.toMatch(/onClick|onMouseDown/);
    expect(m).toContain("e.key === 'Escape'");
  });
});
