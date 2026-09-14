/**
 * line-reassignment-resilience.test.ts — 라인 재배정 뒤에도 과거 발송이 보여야 한다 (2026-09-14 · B-0914-1)
 *
 * ⛔ 금강제화 9/4 33,346건: SMSQ_SEND_13(비토 1번)에 적재됐는데 회사 라인이 대량발송(2){4,5,6}로 바뀐 뒤
 * "현재 라인 합집합"(getCompanyAllLiveSmsTables)에 13 이 없어졌다. 합집합은 전 bulk 라인을 다 넣으면서
 * bito 라인은 현재 배정분만 넣었다. 재대조 워커가 그 합집합으로 0건을 읽고 PG 카운트를 0/0/0 으로 덮어
 * 굳혔고(9/10 11:57 KST), 그 뒤 목록·채널통합·슈퍼관리자·엑셀·통계가 전부 0 이 됐다.
 *
 * 같은 뿌리 세 번째: 0605 hpio(집계 라인 한정) · 0717 정산(bulk 만 → bulk+bito) · 0910 통계(sentTables 미조회).
 * 이 파일이 고정하는 것 셋 — ①집계 합집합은 활성 bito 라인 전체를 품는다 ②발송 경로는 그대로다
 * ③캠페인 카운트를 읽는 SELECT 는 sentTables 를 싣고, 재대조는 0건 가드를 지난다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const { queryMock } = vi.hoisted(() => {
  process.env.SMS_TABLES = 'SMSQ_SEND_1,SMSQ_SEND_2,SMSQ_SEND_3,SMSQ_SEND_4,SMSQ_SEND_5,SMSQ_SEND_6';
  return { queryMock: vi.fn() };
});

vi.mock('../../config/database', () => ({
  mysqlQuery: vi.fn(async () => []),
  query: queryMock,
  pool: { connect: vi.fn() },
  default: { connect: vi.fn(), query: vi.fn() },
}));

async function freshModule() {
  vi.resetModules();
  return await import('../sms-queue');
}

// 금강제화 9/14 실측 그대로 — 회사 라인 = 대량발송(2) bulk {4,5,6}, 사용자 라인 없음,
// 비토 1번(13)·2번(14)은 활성이지만 이 회사 누구에게도 배정돼 있지 않다.
const COMPANY_LINE = [{ sms_tables: ['SMSQ_SEND_4', 'SMSQ_SEND_5', 'SMSQ_SEND_6'] }];
const ALL_BULK = [
  { sms_tables: ['SMSQ_SEND_1', 'SMSQ_SEND_2', 'SMSQ_SEND_3'] },
  { sms_tables: ['SMSQ_SEND_4', 'SMSQ_SEND_5', 'SMSQ_SEND_6'] },
];
const ALL_BITO = [{ sms_tables: ['SMSQ_SEND_13'] }, { sms_tables: ['SMSQ_SEND_14'] }];

function routeBySql(sql: string): { rows: any[] } {
  if (sql.includes("group_type = 'bito'")) return { rows: ALL_BITO };
  if (sql.includes("group_type = 'bulk'")) return { rows: ALL_BULK };
  if (sql.includes('JOIN companies c ON c.line_group_id')) return { rows: COMPANY_LINE };
  // 사용자 개별 라인(JOIN users u ON u.line_group_id) · 회사 전 사용자 라인(WHERE u.company_id) = 없음
  return { rows: [] };
}

describe('getCompanyAllLiveSmsTables — 집계 합집합은 배정에서 빠진 bito 라인도 품는다', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => routeBySql(String(sql)));
  });

  it('회사 라인이 bulk {4,5,6} 으로 바뀌어도 SMSQ_SEND_13 이 합집합에 남는다 (B-0914-1 회귀)', async () => {
    const { getCompanyAllLiveSmsTables } = await freshModule();
    const tables = await getCompanyAllLiveSmsTables('co-kumkang');
    expect(tables).toContain('SMSQ_SEND_13');
    expect(tables).toContain('SMSQ_SEND_14');
    // 종전 구성원은 그대로 — 현재 회사 라인 + 전 bulk
    for (const t of ['SMSQ_SEND_1', 'SMSQ_SEND_2', 'SMSQ_SEND_3', 'SMSQ_SEND_4', 'SMSQ_SEND_5', 'SMSQ_SEND_6']) {
      expect(tables).toContain(t);
    }
    expect(new Set(tables).size).toBe(tables.length); // 중복 0
  });

  it('userId 를 넘겨도 같다 (사용자 라인 없음 → 회사 라인 fallback + 전 bulk + 전 bito)', async () => {
    const { getCompanyAllLiveSmsTables } = await freshModule();
    const tables = await getCompanyAllLiveSmsTables('co-kumkang', 'u-kumkang4');
    expect(tables).toContain('SMSQ_SEND_13');
    expect(tables).toContain('SMSQ_SEND_4');
  });

  it('비토 라인그룹이 하나도 없으면 종전과 같다 (악화 0)', async () => {
    queryMock.mockImplementation(async (sql: string) =>
      String(sql).includes("group_type = 'bito'") ? { rows: [] } : routeBySql(String(sql)));
    const { getCompanyAllLiveSmsTables } = await freshModule();
    const tables = await getCompanyAllLiveSmsTables('co-kumkang');
    expect(tables).not.toContain('SMSQ_SEND_13');
    expect(tables).toContain('SMSQ_SEND_4');
  });
});

describe('getCompanySmsTables — 발송 경로는 그대로다 (합집합 확장이 발송 라인을 바꾸면 안 된다)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => routeBySql(String(sql)));
  });

  it('회사 라인이 bulk {4,5,6} 이면 발송 대상은 그 셋뿐 — bito 로 새지 않는다', async () => {
    const { getCompanySmsTables } = await freshModule();
    const tables = await getCompanySmsTables('co-kumkang', 'u-kumkang4');
    expect(tables).toEqual(['SMSQ_SEND_4', 'SMSQ_SEND_5', 'SMSQ_SEND_6']);
  });
});

// ---------------------------------------------------------------------------
// 소스 계약 — 캠페인 카운트를 읽는 SELECT 는 sentTables 를 싣는다 (0910 B-0910-1 이 5곳만 고치고 4곳을 남겼다)
// ---------------------------------------------------------------------------
const SENT_TABLES_SELECT = "jsonb_build_object('sentTables', c.send_config->'sentTables') AS send_config";

function routeBody(src: string, routePath: string): string {
  const marker = `router.get('${routePath}'`;
  const from = src.indexOf(marker);
  expect(from, `route ${routePath} not found`).toBeGreaterThan(-1);
  const next = src.indexOf('\nrouter.', from + marker.length);
  return src.slice(from, next === -1 ? undefined : next);
}

describe('결과 카운트 SELECT 계약 — 캠페인을 MySQL 로 세는 SELECT 는 sentTables 를 싣는다', () => {
  const resultsSrc = readFileSync(resolve(__dirname, '..', '..', 'routes', 'results.ts'), 'utf-8');
  const adminSrc = readFileSync(resolve(__dirname, '..', '..', 'routes', 'admin.ts'), 'utf-8');

  it.each(['/summary', '/campaigns', '/campaigns/export'])('results.ts %s', (route) => {
    expect(routeBody(resultsSrc, route)).toContain(SENT_TABLES_SELECT);
  });

  it('results.ts /campaigns 목록 응답은 send_config 를 밖으로 내보내지 않는다 (내부 테이블명 노출 0)', () => {
    const body = routeBody(resultsSrc, '/campaigns');
    // 행 spread(...c) 앞에서 send_config 를 떼어낸다 — 아래 문자열이 그 자리다.
    expect(body).toContain('send_config: _sentTables');
  });

  it('admin.ts /stats/export', () => {
    expect(routeBody(adminSrc, '/stats/export')).toContain(SENT_TABLES_SELECT);
  });
});

describe('재대조 워커 계약 — 0건 가드를 지나고, 판정에 쓸 sentTables 를 SELECT 한다', () => {
  const src = readFileSync(resolve(__dirname, '..', 'campaign-sync-worker.ts'), 'utf-8');
  const from = src.indexOf('async function reconcileFinalizedCampaigns');
  const fn = src.slice(from, src.indexOf('\n}\n', from));

  it('SELECT 가 send_config.sentTables 를 싣는다', () => {
    expect(fn).toContain("jsonb_build_object('sentTables', send_config->'sentTables') AS send_config");
  });
  it('UPDATE 앞에 shouldSkipReconcileWrite 판정이 있다', () => {
    const guardAt = fn.indexOf('shouldSkipReconcileWrite(');
    const updateAt = fn.indexOf('SET status = $2, sent_count = $3');
    expect(guardAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(guardAt);
  });
  it('보류해도 재대조 시각은 찍는다 — 1시간 제한이 걸려 같은 캠페인이 매 배치를 점유하지 않는다 (Codex 1R high)', () => {
    // 가드 블록 = shouldSkipReconcileWrite( 부터 그 다음 continue; 까지.
    const guardAt = fn.indexOf('shouldSkipReconcileWrite(');
    const continueAt = fn.indexOf('continue;', guardAt);
    const block = fn.slice(guardAt, continueAt);
    expect(block).toContain('SET result_synced_at = NOW()');
    // 카운트·result_final 은 그 블록에서 건드리지 않는다.
    expect(block).not.toContain('success_count =');
    expect(block).not.toContain('result_final =');
  });
});
