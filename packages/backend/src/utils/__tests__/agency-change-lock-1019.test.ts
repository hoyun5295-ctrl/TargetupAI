/**
 * agency-change-lock-1019.test.ts — 보낼 시각 15분 전 사람 조작 잠금(★ 2026-10-19 Harold)
 *   「직접발송이나 뭐든 예약 걸린 건 15분 이내면 취소 불가 · 그 로직대로 대행발송 승인 및 취소 수정 링크도 · 승인까지 포함해서 전부 막는다」
 *   판정 한 곳 = campaign-validation `isInSendChangeLock`(0분 초과 15분 미만) · 직접발송 두 곳 · 대행 승인 리드타임 · 조작 판정 · 효과 CT 3개.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isInSendChangeLock, SEND_CHANGE_LOCK_MINUTES, sendChangeLockFreeSql } from '../campaign-validation';
import { checkApproval, isApprovalExpired, requiredLeadMinutes, AGENCY_SEND_LOCK_REASON } from '../agency-send-state';
import { agencyActions } from '../agency-send-actions';

const NOW = new Date('2026-10-20T03:00:00.000Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60000);
const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

describe('판정 한 곳 — 0분 초과 15분 미만', () => {
  it('경계', () => {
    expect(SEND_CHANGE_LOCK_MINUTES).toBe(15);
    expect(isInSendChangeLock(at(14.9), NOW)).toBe(true);
    expect(isInSendChangeLock(at(1), NOW)).toBe(true);
    expect(isInSendChangeLock(at(15), NOW)).toBe(false);
    expect(isInSendChangeLock(at(0), NOW)).toBe(false);
    expect(isInSendChangeLock(at(-5), NOW)).toBe(false);   // 지난 시각은 잠그지 않는다
    expect(isInSendChangeLock(null, NOW)).toBe(false);
    expect(isInSendChangeLock('잘못된 값', NOW)).toBe(false);
  });
});

describe('대행 승인 리드타임 = 잠금보다 짧지 않다 · 만료도 같은 경계', () => {
  it('승인 대기 · 재승인 = 15분 이상 · 승인된 건 적재 여유 = 그대로 10분', () => {
    expect(requiredLeadMinutes('reapproval')).toBe(15);
    expect(requiredLeadMinutes('awaiting_approval', true)).toBe(15);
    expect(requiredLeadMinutes('awaiting_approval')).toBe(120);
    expect(requiredLeadMinutes('approved', true)).toBe(10);
  });
  it('재승인 12분 전 = 승인 거절(잠금 문장) · 16분 전 = 승인', () => {
    const base = { status: 'reapproval' as const, revision: 3, requestedAt: at(12), finalTestedAt: null, approvalRequestedAt: null };
    const r = checkApproval(base, 3, NOW);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TOO_LATE');
    expect(r.error).toContain('15분 전부터는 승인할 수 없습니다');
    expect(checkApproval({ ...base, requestedAt: at(16) }, 3, NOW).ok).toBe(true);
  });
  it('만료 = 승인과 같은 경계(재승인 14분 전 만료 · 16분 전 아님) · 승인된 건 12분 전은 만료 아님(적재로 간다)', () => {
    expect(isApprovalExpired('reapproval', at(14), NOW)).toBe(true);
    expect(isApprovalExpired('reapproval', at(16), NOW)).toBe(false);
    expect(isApprovalExpired('approved', at(12), NOW, NOW)).toBe(false);
  });
});

describe('조작 판정(링크 버튼 = 서버 가드)', () => {
  const row = (min: number, extra: Record<string, unknown> = {}) => ({
    status: 'reapproval', revision: 2, requested_at: at(min).toISOString(), final_test_at: NOW.toISOString(), approval_requested_at: null,
    campaign_id: null, spell_check: { issues: [{ id: 'a', blocked: false }] }, ...extra,
  });
  it('10분 전 = 승인 · 취소 · 시각 · 맞춤법 · 문안 전부 막힘(잠금 문장)', () => {
    const a = agencyActions('link', row(10), NOW);
    expect(a.approve.ok).toBe(false);
    expect(a.cancel).toEqual({ ok: false, reason: AGENCY_SEND_LOCK_REASON });
    expect(a.reschedule).toEqual({ ok: false, reason: AGENCY_SEND_LOCK_REASON });
    expect(a.spellFix.ok).toBe(false);
    expect(agencyActions('user', row(10), NOW).editText).toEqual({ ok: false, reason: AGENCY_SEND_LOCK_REASON });
  });
  it('30분 전 = 취소 · 시각 변경 · 승인 열림', () => {
    const a = agencyActions('link', row(30), NOW);
    expect(a.cancel.ok).toBe(true);
    expect(a.reschedule.ok).toBe(true);
    expect(a.approve.ok).toBe(true);
  });
  it('지난 시각의 만료 건 = 잠그지 않는다(새 시각으로 살리는 길)', () => {
    const a = agencyActions('user', row(-30, { status: 'expired' }), NOW);
    expect(a.reschedule.ok).toBe(true);
  });
  it('끝난 건은 상태 사유가 먼저(이미 취소 · 발송)', () => {
    expect(agencyActions('link', row(10, { status: 'cancelled' }), NOW).cancel.reason).toBe('이미 취소된 건이에요.');
  });
});

describe('효과 CT · 직접발송 = 같은 판정(소스 계약)', () => {
  it('SQL 조건 한 벌 = 같은 경계(DB 시계)', () => {
    // 시각 = clock_timestamp()(문장이 실제로 도는 순간 · NOW() = 트랜잭션 시작이라 잠금을 기다린 트랜잭션이 옛 시각으로 판정 · Codex L2)
    expect(sendChangeLockFreeSql('prev.requested_at', 6)).toBe(" AND NOT (prev.requested_at > clock_timestamp() AND prev.requested_at < clock_timestamp() + ($6::int * INTERVAL '1 minute'))");
  });
  it('취소 CT = 잡는 UPDATE 조건에 잠금 · 거절 사유 SEND_CHANGE_LOCKED', () => {
    const c = src('agency-send-cancel.ts');
    expect(c).toContain('SELECT id, status, revision, requested_at FROM agency_send_requests');
    expect(c).toContain("${sendChangeLockFreeSql('prev.requested_at', 6)}");
    expect(c).toContain("code: 'SEND_CHANGE_LOCKED', tooLate: true, error: AGENCY_SEND_LOCK_REASON");
  });
  it('문안 수정 · 시각 변경 CT = 상태 판정 뒤 잠금 + 저장 UPDATE 조건에도(판정과 저장 사이 경계 · Codex L1) · 0행 = 잠금 사유', () => {
    const c = src('agency-send-change.ts');
    expect((c.match(/isAgencySendLocked\(row\.requested_at/g) || []).length).toBe(2);
    expect(c).toContain("${sendChangeLockFreeSql('agency_send_requests.requested_at', 7)}");
    expect(c).toContain("${sendChangeLockFreeSql('agency_send_requests.requested_at', 8)}");
    expect((c.match(/return staleFail\(input\.requestId, input\.companyId\)/g) || []).length).toBe(2);
    // Codex L3 — 두 CT 모두 행 잠금(FOR UPDATE)을 쥔 뒤 UPDATE(잠금을 기다린 UPDATE 는 조건을 다시 보지 않는다)
    const lockSql = 'SELECT 1 FROM agency_send_requests WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE';
    expect((c.match(/SELECT 1 FROM agency_send_requests WHERE id = \$1::uuid AND company_id = \$2::uuid FOR UPDATE/g) || []).length).toBe(2);
    const edit = c.slice(c.indexOf('export async function editAgencyContentTx('), c.indexOf('export async function findBlockingTwinRequest('));
    expect(edit.indexOf(lockSql)).toBeLessThan(edit.indexOf('UPDATE agency_send_requests'));
    const resch = c.slice(c.indexOf('export async function rescheduleAgencyRequestTx('));
    expect(resch.indexOf("await client.query('BEGIN');")).toBeLessThan(resch.indexOf(lockSql));
    expect(resch.indexOf(lockSql)).toBeLessThan(resch.indexOf('UPDATE agency_send_requests'));
  });
  it('워커 재승인 두 자리 = 승인이 안 통하면 실물 · 링크 대신 시각 확인 요청(Codex L1)', () => {
    const w = src('agency-send-worker.ts');
    expect((w.match(/if \(await reapprovalWindowMissed\(/g) || []).length).toBe(2);
    const body = w.slice(w.indexOf('async function reapprovalWindowMissed('), w.indexOf('// ────────────── C. 만료'));
    expect(body).toContain("isApprovalExpired('reapproval'");
    expect(body).toContain('buildTooTightNotify');
    // 판정 직전 지금 행 · 재승인이 아니면 멈춘다(Codex L2)
    expect(body).toContain('SELECT status, requested_at, final_test_at FROM agency_send_requests WHERE id = $1::uuid');
    expect(body).toContain("if (!cur || cur.status !== 'reapproval') return true;");
  });
  it('직접발송 두 곳 = 같은 함수(인라인 15 0)', () => {
    const l = src('campaign-lifecycle.ts');
    expect(l).toContain('if (!skipTimeCheck && isInSendChangeLock(camp.scheduled_at)) {');
    expect(l).not.toContain('diffMinutes < 15');
    const r = src('..', 'routes', 'campaigns.ts');
    expect(r).toContain('if (isInSendChangeLock(campaign.scheduled_at)) {');
    expect(r).not.toContain('timeUntilSend < 15 * 60 * 1000');
  });
  it('화면 미러 값 = 백엔드 값', () => {
    const fe = readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'components', 'agency', 'agency-send-api.ts'), 'utf8');
    const m = fe.match(/export const SEND_CHANGE_LOCK_MINUTES = (\d+);/);
    expect(Number(m?.[1])).toBe(SEND_CHANGE_LOCK_MINUTES);
  });
});
