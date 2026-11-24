/**
 * 확인 문자 정리 주기 = 한 줄씩(★ 2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md · 배포 2 Codex 5R · 6R 구조)
 *   뒤 줄 쓰기가 던져도 ① 앞 줄의 단말 경보 · 셈은 이미 났다 ② 횟수를 올린 앞 줄은 그 자리에서 다시 보냈다(마지막 기회가 보내기 없이 소진되지 않는다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ fail: new Set<string>(), alerts: [] as string[], queued: [] as string[] }));

vi.mock('../../config/database', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    const s = String(sql);
    if (s.includes('information_schema.tables')) return { rows: [{ probes: 1, body: 1 }] };
    if (s.includes("SELECT id FROM spam_test_probes WHERE status = 'sent' AND deadline_at < NOW() ORDER BY id")) return { rows: [{ id: 'e1' }, { id: 'e2' }] };
    if (s.includes('WITH p AS')) {
      const id = params[params.length - 2];
      if (h.fail.has(id)) throw new Error('row write failed');
      return { rows: [{ result_id: `r-${id}`, phone: `p-${id}`, carrier: 'KT', closed: true }] };
    }
    if (s.includes("WHERE status = 'claimed' AND attempts <")) return { rows: [{ id: 'c1' }, { id: 'c2' }] };
    if (s.includes('SET attempts = p.attempts + 1')) {
      if (h.fail.has(params[0])) throw new Error('row write failed');
      return { rows: [{ id: params[0], phone: '01000000000', nonce: 'AAAAAA', callback_number: '0200000000' }] };
    }
    if (s.includes('SELECT t.id AS test_id, t.source')) return { rows: [{ test_id: 't1', source: 'manual', company_id: 'c', user_id: 'u', created_at: new Date(), diag_of: null }] };
    return { rows: [] };
  });
  return { default: { query, connect: vi.fn() }, query, mysqlQuery: vi.fn(async () => []) };
});
vi.mock('../sms-queue', () => ({ insertTestSmsQueue: vi.fn(async (_phone: string, _cb: string, _text: string, _type: string, probeId: string) => { h.queued.push(probeId); }) }));
vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async (a: any) => { h.alerts.push(String(a.dedupKey)); return 1; }) }));

import { runSpamProbeCycle, resetSpamProbeSchemaCache } from '../spam-probe';

beforeEach(() => {
  h.fail.clear();
  h.alerts.length = 0;
  h.queued.length = 0;
  resetSpamProbeSchemaCache();
});

describe('정리 주기 한 줄씩 · 뒤 줄 실패', () => {
  it('① 기한 지남 — 둘째 줄이 던져도 첫 줄의 단말 경보 · 주기 기록(기한 지남 1)은 남았다(★ Codex 7R)', async () => {
    h.fail.add('e2');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(runSpamProbeCycle()).rejects.toThrow('row write failed');
      expect(h.alerts).toEqual(['spam-probe-device:KT:p-e1']);
      expect(log.mock.calls.map((c) => String(c[0]))).toContain('[spam-probe] 주기 — 보냄 0 · 단말 확인 불가 0 · 기한 지남 1');
    } finally {
      log.mockRestore();
    }
  });

  it('② 다시 보내기 — 둘째 줄 횟수 올리기가 던져도 첫 줄은 이미 다시 보냈다', async () => {
    h.fail.add('c2');
    await expect(runSpamProbeCycle()).rejects.toThrow('row write failed');
    expect(h.queued).toEqual(['c1']);
  });
});
