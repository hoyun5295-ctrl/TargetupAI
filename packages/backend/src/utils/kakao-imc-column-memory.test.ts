/**
 * ★2026-10-21 전송자격인증 실사 준비 S5 — imc_template_status 「컬럼 없음」 실패 기반 기억
 *
 * 지키는 것
 *   ① 실제 「컬럼 없음」 실패가 난 뒤에만 기억한다(사전 탐지 없음 · LESSONS_BACKEND 2026-09-12)
 *   ② 기억하는 동안은 그 컬럼을 넣은 SQL 을 보내지 않는다 = 운영 DB 로그에 같은 오류가 쌓이지 않는다
 *   ③ 대체 경로의 결과는 지금과 같다(가드 null · 검수상태 동기화 계속)
 *   ④ 다른 오류는 기억하지 않는다 · 기억이 풀리면 다시 시도한다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/database', () => ({ query: vi.fn() }));
vi.mock('./alimtalk-api', () => ({ listAlimtalkTemplates: vi.fn() }));

import { query } from '../config/database';
import * as imc from './alimtalk-api';
import {
  getImcTemplateStatusSafe,
  getImcTemplateStatusByIdSafe,
  isImcStatusColumnKnownMissing,
  isImcStatusColumnMissingError,
  resetImcStatusColumnMemory,
  IMC_STATUS_COLUMN_MISSING_TTL_MS,
} from './kakao-template-guard';
import { syncTemplateStatuses } from './kakao-template-sync';

const q = query as unknown as ReturnType<typeof vi.fn>;
const list = imc.listAlimtalkTemplates as unknown as ReturnType<typeof vi.fn>;

function columnMissingError(): any {
  const err: any = new Error('column "imc_template_status" does not exist');
  err.code = '42703';
  return err;
}

/** imc_template_status 를 넣은 SQL 만 컬럼 없음으로 실패하는 DB */
function wireColumnMissing() {
  q.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (/imc_template_status/.test(s)) throw columnMissingError();
    if (/FROM kakao_templates/i.test(s)) return { rows: [{ id: 'r1', template_key: 'K1', template_code: 'C1', status: 'REQUESTED', reject_reason: null }] };
    return { rows: [], rowCount: 0 };
  });
}

const imcSqlCalls = () => q.mock.calls.filter(([sql]: any[]) => /imc_template_status/.test(String(sql))).length;

beforeEach(() => {
  q.mockReset();
  list.mockReset();
  list.mockResolvedValue({ code: '0000', data: { list: [] } });
  resetImcStatusColumnMemory();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('실패 기반 기억', () => {
  it('★처음에는 기억이 없다 — 사전 탐지로 갈래를 정하지 않는다', () => {
    expect(isImcStatusColumnKnownMissing()).toBe(false);
  });

  it('★실제 컬럼 없음 실패 뒤에만 기억하고, 그 뒤로는 그 컬럼 SQL 을 보내지 않는다', async () => {
    wireColumnMissing();
    expect(await getImcTemplateStatusSafe('co', 'T1')).toBeNull();
    expect(imcSqlCalls()).toBe(1);
    expect(isImcStatusColumnKnownMissing()).toBe(true);

    expect(await getImcTemplateStatusSafe('co', 'T1')).toBeNull();
    expect(await getImcTemplateStatusByIdSafe('00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(imcSqlCalls(), '기억하는 동안 같은 실패 SQL 을 다시 보냈다').toBe(1);
  });

  it('★다른 오류는 기억하지 않는다(가드는 지금처럼 null 로 통과)', async () => {
    q.mockRejectedValue(new Error('connection terminated unexpectedly'));
    expect(await getImcTemplateStatusSafe('co', 'T1')).toBeNull();
    expect(isImcStatusColumnKnownMissing()).toBe(false);
  });

  it('★다른 컬럼 부재는 이 기억의 대상이 아니다', () => {
    expect(isImcStatusColumnMissingError(new Error('column "foo_bar" does not exist'))).toBe(false);
    expect(isImcStatusColumnMissingError(columnMissingError())).toBe(true);
  });

  it('★기억이 풀리면 다시 한 번 시도한다(ALTER 뒤에는 그때부터 컬럼을 쓴다)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T12:00:00+09:00'));
    wireColumnMissing();
    await getImcTemplateStatusSafe('co', 'T1');
    expect(imcSqlCalls()).toBe(1);

    vi.setSystemTime(new Date(Date.now() + IMC_STATUS_COLUMN_MISSING_TTL_MS + 1000));
    q.mockReset();
    q.mockResolvedValue({ rows: [{ imc_template_status: 'A' }] });
    expect(await getImcTemplateStatusSafe('co', 'T1')).toBe('A');
    expect(imcSqlCalls()).toBe(1);
  });
});

describe('[소스 검사] 웹 푸시 구독 조회는 실제 열(status)을 쓴다', () => {
  it('★cdp_push_subscriptions 조회에 없는 열 is_active 가 다시 들어오지 않는다', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const f of ['source-aware-channel-selector.ts', 'unified-customer-profile.ts', 'web-push.ts']) {
      const src = readFileSync(resolve(__dirname, f), 'utf8');
      for (const m of src.matchAll(/FROM cdp_push_subscriptions[\s\S]{0,160}/g)) {
        expect(m[0], `${f} — cdp_push_subscriptions 에 is_active 조건`).not.toMatch(/is_active/);
      }
    }
  });
});

describe('30분 목록 동기화와 기억', () => {
  it('★기억하는 동안 목록 동기화는 컬럼 없는 SELECT 로 곧바로 간다 — 검수상태 동기화는 그대로 돈다', async () => {
    wireColumnMissing();
    const first = await syncTemplateStatuses();
    expect(first.skipped).toBe(false);
    expect(imcSqlCalls(), '첫 회차는 실제로 한 번 시도해 실패를 본다').toBe(1);

    q.mockClear();
    const second = await syncTemplateStatuses();
    expect(second.skipped).toBe(false);
    expect(second.scanned).toBe(1);
    expect(imcSqlCalls(), '기억하는 동안 컬럼 SELECT 를 다시 보냈다').toBe(0);
  });
});
