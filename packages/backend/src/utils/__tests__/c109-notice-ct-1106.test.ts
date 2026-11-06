/**
 * C109 K6(P6) — 안내 문자 적재 CT insertNoticeSms(★ 2026-11-06 설계서 docs/2026-11-06-b1106-1-unsupported-char-design.md §3 D6 · §9 K6)
 *   표 = CT 안에서 고른다 · 본문 · 제목 정리 뒤 적재 · 실행 함수(상한 연결) 그대로 넘긴다 · 호출부 행은 바꾸지 않는다.
 *   기계 추출 = 인증 라인 표를 고르는 곳(getAuthSmsTable 호출) = sms-queue(정의 · 내부) · sms-notice · 예외 account-action(인증번호)뿐.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const order: string[] = [];
const boundedRun = async () => [];
const bulk = vi.fn(async (_tables: string[], rows: any[][], _useNow?: boolean, _ctx?: any, _opts?: any) => { order.push('bulk'); return rows.length; });
vi.mock('../sms-queue', () => ({
  getAuthSmsTable: async () => { order.push('table'); return 'SMSQ_AUTH_T'; },
  bulkInsertSmsQueue: (...a: any[]) => (bulk as any)(...a),
}));
vi.mock('../../config/database', () => ({
  withBoundedMysql: async (ms: number, work: (run: any) => Promise<any>) => { order.push(`bounded:${ms}`); return work(boundedRun); },
}));

import { insertNoticeSms } from '../sms-notice';
import { unsupportedSmsCharCodes } from '../sms-charset';

describe('K6 insertNoticeSms', () => {
  it('표 = 인증 라인(CT 안) · 본문 · 제목 정리 · 행 순서 · 다른 칸 그대로 · 상한 연결 = 표 조회 뒤 CT 안 · 반환 = 적재 건수', async () => {
    bulk.mockClear();
    order.length = 0;
    const rows = [
      ['01000000000', '0212345678', "여름 세일😊 café\n'캠페인​' 안내", 'L', '[결과] 세일🎉', null, '', 'c1', '', '', ''],
      ['01000000001', '0212345678', '보낼 수 있는 글', 'S', null, null, '', 'c1', '', '', ''],
    ];
    const original = JSON.stringify(rows);
    const n = await insertNoticeSms(rows, true, undefined, { boundedMs: 20000 });
    expect(n).toBe(2);
    // ★ Codex 구현 1R #4 — 표 조회(PG 캐시)를 끝낸 뒤에 상한 연결을 받는다(연결을 쥔 채 PG 를 기다리지 않는다)
    expect(order).toEqual(['table', 'bounded:20000', 'bulk']);
    const [tables, sent, useNow, ctx, opts] = bulk.mock.calls[0];
    expect(tables).toEqual(['SMSQ_AUTH_T']);
    expect(useNow).toBe(true);
    expect(ctx).toBeUndefined();
    expect(opts.run).toBe(boundedRun);
    expect(sent[0][2]).toBe("여름 세일 caf\n'캠페인' 안내");
    expect(sent[0][4]).toBe('[결과] 세일');
    expect(sent[1][2]).toBe('보낼 수 있는 글');
    expect(sent[1][4]).toBeNull();
    for (const r of sent) expect(unsupportedSmsCharCodes(String(r[2]), String(r[4] ?? ''))).toEqual([]);
    expect(sent[0].slice(5)).toEqual(rows[0].slice(5));
    expect(JSON.stringify(rows)).toBe(original);   // 호출부 행을 바꾸지 않는다(사본)
    // 상한 없는 호출(대행 · 자동발송 · 운영 경보 등) = 공용 풀 · run 없음
    bulk.mockClear(); order.length = 0;
    await insertNoticeSms([rows[1]], true);
    expect(order).toEqual(['table', 'bulk']);
    expect(bulk.mock.calls[0][4]).toBeUndefined();
  });

  it('여정 안내 셋 = CT 의 boundedMs 로(호출부가 상한 연결을 먼저 열지 않는다)', () => {
    for (const f of ['journey-pretest-notifier', 'journey-result-notice', 'manager-weekly-digest']) {
      const s = readFileSync(join(__dirname, '..', `${f}.ts`), 'utf8');
      expect(s, f).toContain('{ boundedMs: NOTICE_ENQUEUE_TIMEOUT_MS }');
      expect(s, f).not.toMatch(/withBoundedMysql\([^)]*insertNoticeSms/);
    }
  });

  it('기계 추출 — getAuthSmsTable( 을 부르는 곳 = sms-queue · sms-notice · account-action(인증번호 예외)뿐', () => {
    const root = join(__dirname, '..', '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { if (f !== '__tests__' && f !== 'node_modules') walk(p); continue; }
        if (!/\.ts$/.test(f) || /\.test\.ts$/.test(f)) continue;
        const code = readFileSync(p, 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
        if (/getAuthSmsTable\(\)/.test(code.replace(/export async function getAuthSmsTable\(\)/, ''))) hits.push(relative(root, p).replace(/\\/g, '/'));
      }
    };
    walk(root);
    expect(hits.sort()).toEqual(['utils/account-action.ts', 'utils/sms-notice.ts', 'utils/sms-queue.ts']);
  });

  it('안내 아홉 파일 = insertNoticeSms 를 부르고 인증 라인 표로 bulkInsertSmsQueue 를 직접 부르지 않는다', () => {
    const files = ['agency-send-worker', 'auto-campaign-worker', 'continuous-operator', 'journey-pretest-notifier', 'journey-result-notice',
      'manager-weekly-digest', 'alimtalk-jobs', 'charge-approve-link', 'system-alert'];
    for (const f of files) {
      const s = readFileSync(join(__dirname, '..', `${f}.ts`), 'utf8');
      expect(s, f).toContain('insertNoticeSms(');
      expect(s, f).not.toMatch(/bulkInsertSmsQueue\(\[(authTable|table)\]/);
      expect(s, f).not.toMatch(/companyTables = \[await getAuthSmsTable\(\)\]/);
    }
  });
});
