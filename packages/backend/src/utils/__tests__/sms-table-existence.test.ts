/**
 * sms-table-existence.test.ts — 실존 LIVE 판정은 env 가 아니라 MySQL 이 소유한다 (2026-09-10)
 *
 * ⛔ 0910 리스킨_대행 18,005건: 발송도 결과 기록도 정상인데(SMSQ_SEND_14 에 status_code 6 이
 * 17,065건) 화면 성공·실패·대기가 전부 0 이었다. 원인은 getAllSmsTablesWithLogs 의 LIVE 축이
 * env(SMS_TABLES)였던 것. env 에 없는 비토 라인(SMSQ_SEND_14)이 MySQL 에 실존하는데도 "미실존"
 * 판정을 받아, resolveCampaignTableGroups 가 캠페인의 send_config.sentTables 기록을 통째로
 * 버리고 현재 라인그룹 fallback 으로 떨어졌다. 그 라인에는 해당 캠페인 행이 한 건도 없다.
 *
 * env 는 "발송 대상 라인 풀"을 정하는 축이고 실존 목록이 아니다. 두 축이 다시 섞이면 같은 사고다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const { mysqlQueryMock } = vi.hoisted(() => {
  // ALL_SMS_TABLES 는 모듈 로드 시점에 env 를 읽는다 — import 보다 먼저 세워야 한다.
  process.env.SMS_TABLES = 'SMSQ_SEND_1,SMSQ_SEND_2';
  return { mysqlQueryMock: vi.fn() };
});

vi.mock('../../config/database', () => ({
  mysqlQuery: mysqlQueryMock,
  query: vi.fn(async () => ({ rows: [] })),
  pool: { connect: vi.fn() },
  default: { connect: vi.fn(), query: vi.fn() },
}));

// 모듈 안 5분 캐시를 비우려면 모듈을 새로 로드해야 한다(캐시 초기화 수단을 밖에 내지 않는다).
async function freshModule() {
  vi.resetModules();
  return await import('../sms-queue');
}

// mock 이 DB 보다 관대하면 결함을 덮는다 — information_schema 가 실제로 돌려주는 모양 그대로.
// LIKE 'SMSQ_SEND_%' 는 LIVE·LOG 를 섞어 주고, 패턴 밖 이름도 걸린다(언더스코어는 LIKE 와일드카드).
const ROWS = [
  { TABLE_NAME: 'SMSQ_SEND_1' },
  { TABLE_NAME: 'SMSQ_SEND_1_202609' },
  { TABLE_NAME: 'SMSQ_SEND_2' },
  { TABLE_NAME: 'SMSQ_SEND_14' },       // 비토 라인 — env 에는 없다
  { TABLE_NAME: 'SMSQ_SEND_ARCHIVE' },  // LIVE 도 LOG 도 아니다
];

describe('getAllSmsTablesWithLogs — 실존 LIVE 는 MySQL 이 소유', () => {
  beforeEach(() => {
    mysqlQueryMock.mockReset();
    mysqlQueryMock.mockResolvedValue(ROWS);
  });

  it('env 에 없어도 실존하는 LIVE 를 포함하고, LOG 는 종전대로 붙이고, 패턴 밖은 뺀다', async () => {
    const { getAllSmsTablesWithLogs } = await freshModule();
    const tables = await getAllSmsTablesWithLogs();

    // 이 한 줄이 0910 회귀다. env(SMSQ_SEND_1,2)에 없는 14 가 실존하므로 반드시 들어와야 한다.
    expect(tables).toContain('SMSQ_SEND_14');
    expect(tables).toContain('SMSQ_SEND_1');
    expect(tables).toContain('SMSQ_SEND_1_202609');
    expect(tables).not.toContain('SMSQ_SEND_ARCHIVE');
  });

  it('실측이 비면 env 로 물러선다 — 종전 동작과 같아질 뿐 악화하지 않는다', async () => {
    mysqlQueryMock.mockResolvedValue([]);
    const { getAllSmsTablesWithLogs } = await freshModule();
    const tables = await getAllSmsTablesWithLogs();
    expect(tables).toEqual(['SMSQ_SEND_1', 'SMSQ_SEND_2']);
  });
});

describe('ensureMonthlyLogTables — env 축을 유지해야 한다', () => {
  it('월별 LOG 자동 생성은 ALL_SMS_TABLES(env) 만 돈다', () => {
    const src = readFileSync(resolve(__dirname, '..', 'sms-queue.ts'), 'utf-8');
    const from = src.indexOf('export async function ensureMonthlyLogTables');
    expect(from).toBeGreaterThan(-1);
    const fn = src.slice(from, src.indexOf('\n}\n', from));

    // ⛔ 이 축을 실측으로 바꾸면 비토 라인(13·14·15)에 LOG 가 생긴다. 그 순간
    //    classifyResultTables 가 그 LIVE 를 대기 전용으로 강등하고, 결과는 LOG 에서만 세는데
    //    비토는 QTmsg 의 rsv1=5 이관을 쓰지 않아 LOG 가 영영 비어 성공이 다시 0 이 된다.
    expect(fn).toContain('of ALL_SMS_TABLES');
    expect(fn).not.toContain('loadSmsTableSets');
  });
});
