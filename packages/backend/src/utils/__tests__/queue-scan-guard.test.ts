/**
 * 한줄로 C131 · 뿌리 R94 — 큐 표 전체 훑기 지킴이 판정(설계서 docs/2026-11-13-c131-bito-line-scan-report-speed-design.md §6-2 (가))
 *   판정 자리 = 실제로 나가는 SQL 글. 공용 큐 함수가 만드는 글은 통과 · 반례는 위반 · 지킴이는 던지지 않는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { format } from 'mysql2/promise';

const calls: Array<{ sql: string; params?: any[] }> = [];
vi.mock('../../config/database', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  pool: { connect: vi.fn() },
  mysqlPool: { getConnection: vi.fn() },
  mysqlQuery: vi.fn(async (sql: string, params?: any[]) => { calls.push({ sql, params }); return [{ total: 0, min_val: null }]; }),
}));

import { queueScanVerdict, noteQueueSql, setQueueScanReporter, ABNORMAL_STATUS_FLOOR } from '../queue-scan-guard';
import { ABNORMAL_STATUS_MIN, SUCCESS_CODES } from '../sms-result-map';
import { smsCountAll, smsAggAll, smsSelectAll, smsSelectPagedAll, smsMinAll, smsGroupByAll, smsBatchAggByGroup, smsExecAll } from '../sms-queue';

const T = ['SMSQ_SEND_13', 'SMSQ_SEND_14', 'SMSQ_SEND_15', 'SMSQ_SEND_16'];
const ok = (sql: string, params?: any[]) => expect(queueScanVerdict(params ? format(sql, params) : sql), sql).toBeNull();
const bad = (sql: string, params?: any[]) => expect(queueScanVerdict(params ? format(sql, params) : sql), sql).not.toBeNull();

describe('C131 R94 지킴이 — 운영 SQL 은 통과', () => {
  it('이상값 경계 = 결과 코드 표의 이상값 시작과 같다', () => {
    expect(ABNORMAL_STATUS_FLOOR).toBe(ABNORMAL_STATUS_MIN);
  });

  it('공용 큐 함수가 실제로 만드는 글(UNION ALL · 하위 쿼리 · 페이지 · 묶음 집계 · 갱신 · 삭제)', async () => {
    calls.length = 0;
    const camp = '7c1f0000-0000-4000-8000-000000000001';
    await smsCountAll(T, 'app_etc1 = ? AND status_code = 100', [camp]);
    await smsCountAll(T, 'WHERE app_etc1 IN (?, ?)', [camp, 'x']);
    await smsAggAll(T, 'COUNT(*) AS total, SUM(CASE WHEN status_code IN (6, 1000) THEN 1 ELSE 0 END) AS success', 'app_etc1 = ?', [camp]);
    await smsSelectAll(T, 'seqno as idx, dest_no, status_code', 'app_etc1 = ? AND dest_no = ?', [camp, '01000000000'], 'ORDER BY seqno DESC LIMIT 20');
    await smsSelectPagedAll(T, (t) => `seqno, dest_no, '${t}' AS src`, 'app_etc1 = ?', [camp], 'seqno DESC', 50, 100);
    await smsMinAll(T, 'sendreq_time', 'app_etc1 = ? AND status_code = 100', [camp]);
    await smsGroupByAll(T, 'app_etc1', `status_code >= ${ABNORMAL_STATUS_MIN} AND mobsend_time IS NULL AND sendreq_time < NOW() - INTERVAL 48 HOUR`, []);
    await smsBatchAggByGroup(T, 'app_etc1', 'COUNT(*) AS total', [camp, 'y', 'z'], "msg_type = 'F'");
    await smsExecAll(T, 'DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100', [camp]);
    await smsExecAll(T, `UPDATE SMSQ_SEND SET status_code = 9999 WHERE app_etc1 = ? AND status_code NOT IN (${SUCCESS_CODES.join(',')}) AND status_code != 100 AND status_code != 9999`, [camp]);
    await smsExecAll(T, `UPDATE SMSQ_SEND SET status_code = 4000, repmsg_recvtm = NOW() WHERE status_code >= ${ABNORMAL_STATUS_MIN} AND mobsend_time IS NULL AND sendreq_time < NOW() - INTERVAL 48 HOUR AND app_etc1 IN (?, ?)`, [camp, 'y']);
    expect(calls.length).toBeGreaterThanOrEqual(11 + 3 * T.length - 3);
    for (const c of calls) ok(c.sql, c.params);
  });

  it('감시 · 정리 워커 · 로그 표 확인 · 넣기 · 정의', () => {
    ok(`SELECT COUNT(*) AS cnt, MIN(sendreq_time) AS oldest FROM SMSQ_SEND_15 WHERE status_code >= ${ABNORMAL_STATUS_MIN} AND mobsend_time IS NULL`);
    ok(`SELECT app_etc1, COUNT(*) AS cnt,
          TIMESTAMPDIFF(MINUTE, MIN(sendreq_time), NOW()) AS oldest_min
         FROM SMSQ_SEND_1
        WHERE status_code = 100
          AND sendreq_time < NOW() - INTERVAL 60 MINUTE
        GROUP BY app_etc1`);
    ok('SELECT 1 FROM SMSQ_SEND_1_202611 LIMIT 0');
    ok('INSERT INTO SMSQ_SEND_13 (dest_no, msg_contents) VALUES (?, ?), (?, ?)', ['01000000000', "a'b", '01000000001', 'c']);
    ok('CREATE TABLE IF NOT EXISTS SMSQ_SEND_17 LIKE SMSQ_SEND_13');
    ok("SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'SMSQ_SEND%'");
    ok('SHOW INDEX FROM SMSQ_SEND_15');
    ok('SELECT * FROM `smsdb`.`SMSQ_SEND_13` WHERE `status_code` = 100 AND seqno BETWEEN 1 AND 9 FOR UPDATE');
    // 이름 자리표시자로 표를 넘겨도 채운 뒤 판정
    ok('SELECT COUNT(*) FROM ?? WHERE app_etc1 = ?', ['SMSQ_SEND_13', 'c']);
  });
});

describe('C131 R94 지킴이 — 반례는 위반', () => {
  it('조건 없음 · 범위만 · OR · 경계 밑 · 판정 못 하는 글', () => {
    bad('SELECT COUNT(*) FROM SMSQ_SEND_15');
    bad('SELECT * FROM SMSQ_SEND_15 WHERE seqno > 0 ORDER BY seqno LIMIT 100');
    bad('SELECT * FROM SMSQ_SEND_15 WHERE mobsend_time IS NULL');
    bad('SELECT * FROM SMSQ_SEND_15 WHERE status_code >= 100 AND mobsend_time IS NULL');
    bad('SELECT * FROM SMSQ_SEND_15 WHERE app_etc1 = ? OR 1 = 1', ['c']);
    // AND 가 OR 보다 먼저 묶인다 = (app_etc1 AND status) OR 참 → 표 전체
    bad('SELECT * FROM SMSQ_SEND_15 WHERE app_etc1 = ? AND status_code = 100 OR 1 = 1', ['c']);
    bad('SELECT * FROM SMSQ_SEND_15 WHERE app_etc1 = ? AND status_code = 100 || 1', ['c']);
    bad('SELECT * FROM SMSQ_SEND_15 WHERE app_etc1 = ? || 1', ['c']);
    bad('SELECT * FROM SMSQ_SEND_15 WHERE (app_etc1 = ? OR seqno > 0)', ['c']);
    bad('SELECT * FROM SMSQ_SEND_15 WHERE app_etc1 = ? XOR 1', ['c']);
    bad('SELECT * FROM SMSQ_SEND_15 WHERE status_code = 100 IS NOT TRUE');
    bad('SELECT * FROM SMSQ_SEND_15 WHERE NOT (app_etc1 = ?)', ['c']);
    bad('SELECT * FROM SMSQ_SEND_15 WHERE seqno IN (SELECT seqno FROM SMSQ_SEND_15 WHERE app_etc1 = ?)', ['c']);
    bad('SELECT * FROM SMSQ_SEND_15 s WHERE s.app_etc1 = ?', ['c']);
    bad('/*!50000 SELECT * FROM SMSQ_SEND_15 */');
    bad("SELECT * FROM SMSQ_SEND_15 WHERE app_etc1 = 'open");
    bad('TABLE SMSQ_SEND_15');
    bad('CHECKSUM TABLE SMSQ_SEND_15');
    bad('SET @n = (SELECT COUNT(*) FROM SMSQ_SEND_15)');
    bad('EXPLAIN ANALYZE SELECT * FROM SMSQ_SEND_15');
    bad('INSERT INTO SMSQ_SEND_16 SELECT * FROM SMSQ_SEND_15');
    bad('INSERT INTO SMSQ_SEND_16 TABLE SMSQ_SEND_15');
    bad('CREATE TABLE x AS SELECT * FROM SMSQ_SEND_15');
    bad('DELETE FROM SMSQ_SEND_15 WHERE sendreq_time < NOW()');
    bad('UPDATE LOW_PRIORITY SMSQ_SEND_15 SET status_code = 9999');
    bad('SELECT * FROM t, SMSQ_SEND_15 WHERE t.a = 1');
    bad('SELECT * FROM t JOIN SMSQ_SEND_15 ON 1 = 1');
    bad('SELECT 1 FROM SMSQ_SEND_15 LIMIT 0, 10');
    bad('SELECT COUNT(*) FROM SMSQ_SEND_15 GROUP BY app_etc1');
    bad('SELECT * FROM ?? WHERE seqno > ?', ['SMSQ_SEND_15', 0]);
  });

  it('Codex 구현 1R — 이름 · 변수 안의 키워드 · CASE 안 AND · LIMIT 0 의 다른 꼴', () => {
    bad('SELECT SQL_CALC_FOUND_ROWS seqno FROM SMSQ_SEND_15 WHERE LENGTH(msg_contents) > 0 LIMIT 0');
    bad('SELECT SQL_CALC_FOUND_ROWS seqno FROM SMSQ_SEND_15 LIMIT 0');
    bad('SELECT seqno FROM SMSQ_SEND_15 WHERE seqno > 0 LIMIT 0');
    bad('SELECT * FROM SMSQ_SEND_15 WHERE status_code = 100 AND @limit = 1 OR 1 = 1');
    bad("SELECT * FROM SMSQ_SEND_15 WHERE status_code = 100 AND @'limit' = 1 OR 1 = 1");
    bad('SELECT * FROM SMSQ_SEND_15 WHERE status_code = 100 AND `limit` = 1 OR 1 = 1');
    bad('SELECT * FROM SMSQ_SEND_15 t WHERE status_code = 100 AND t.limit = 1 OR 1 = 1');
    bad('SELECT * FROM SMSQ_SEND_15 WHERE status_code = 100 AND `union` = 1 OR 1 = 1');
    bad('SELECT * FROM SMSQ_SEND_15 WHERE CASE WHEN 0 AND status_code = 100 AND 0 THEN 0 ELSE 1 END');
    bad('SELECT * FROM SMSQ_SEND_15 WHERE (CASE WHEN status_code = 100 AND 1 THEN 1 ELSE 1 END)');
    // Codex 구현 2R — 숫자 끝 소수점 · 이름 안의 CASE/END · 깊이 어긋남
    bad('SELECT * FROM SMSQ_SEND_15 WHERE status_code = 100 AND 0. OR 1 = 1');
    bad('SELECT * FROM SMSQ_SEND_15 WHERE status_code = 100 AND 1.e3 OR 1 = 1');
    bad('SELECT * FROM SMSQ_SEND_15 AS q$END WHERE status_code = 100 AND q$END.status_code = 100 OR 1 = 1');
    bad('SELECT * FROM SMSQ_SEND_15 AS q$CASE WHERE q$CASE.seqno > 0 OR status_code = 100 AND app_etc1 = ?', ['c']);
    bad('SELECT * FROM SMSQ_SEND_15 WHERE status_code = 100 AND end = 1 OR 1 = 1');
    // 중간에 깊이가 음수로 내려갔다 0 으로 돌아오는 꼴(끝 깊이만 보면 놓친다)
    bad('SELECT * FROM SMSQ_SEND_15 WHERE status_code = 100 AND end = 1 OR 1 = 1 AND CASE WHEN 1 THEN 1 ELSE 1');
    bad('SELECT * FROM SMSQ_SEND_15 WHERE status_code = 100 AND 1abc = 1 OR 1 = 1');
    bad('SELECT * FROM SMSQ_SEND_15 WHERE status_code = 100 AND x.`or` = 1 OR 1 = 1');
    // Codex 구현 3R — 모르는 꼴 = 위반(ASCII 밖 이름 · 집합 연산 · CREATE … AS TABLE · 모르는 문장 종류)
    bad('SELECT * FROM SMSQ_SEND_15 AS q€LIMIT WHERE status_code = 100 AND q€LIMIT.seqno > 0 OR 1 = 1');
    bad('SELECT * FROM SMSQ_SEND_15 AS 큐 WHERE status_code = 100');
    // Codex 구현 4R — ASCII 아닌 공백(NBSP · 전각 공백)도 따옴표 밖이면 판정 불가
    bad('SELECT * FROM SMSQ_SEND_15 AS q LIMIT WHERE status_code = 100 AND q LIMIT.seqno > 0 OR 1 = 1');
    bad('SELECT * FROM SMSQ_SEND_15 WHERE status_code = 100　AND app_etc1 = 1');
    // --NBSP 는 MySQL 에서 주석이 아니다(뒤 OR 를 실행) — 주석으로 보면 OR 를 숨긴다
    bad('SELECT * FROM SMSQ_SEND_15 WHERE status_code = 100 --  OR 1 = 1');
    bad("SELECT seqno FROM SMSQ_SEND_15 EXCEPT SELECT seqno FROM SMSQ_SEND_15 WHERE app_etc1 = 'c'");
    bad("SELECT seqno FROM SMSQ_SEND_15 INTERSECT SELECT seqno FROM SMSQ_SEND_15 WHERE app_etc1 = 'c'");
    // 모르는 집합 연산 뒤 다른 갈래의 좁힘을 빌려 오는 꼴 = 블록 안 다른 문장 = 판정 불가
    bad("SELECT seqno FROM SMSQ_SEND_15 WHERE seqno > 0 MINUS SELECT seqno FROM t WHERE x = 1 AND app_etc1 = 'c'");
    bad("SELECT seqno FROM SMSQ_SEND_15 WHERE seqno > 0 EXCEPT SELECT seqno FROM t WHERE x = 1 AND app_etc1 = 'c'");
    // 양쪽 갈래가 다 좁히는 EXCEPT · INTERSECT = 통과(갈래 경계)
    ok("SELECT seqno FROM SMSQ_SEND_15 WHERE app_etc1 = 'c' EXCEPT SELECT seqno FROM SMSQ_SEND_15 WHERE app_etc1 = 'd'");
    ok("SELECT seqno FROM SMSQ_SEND_15 WHERE app_etc1 = 'c' INTERSECT SELECT seqno FROM SMSQ_SEND_16 WHERE status_code = 100");
    bad('CREATE TABLE queue_backup AS TABLE smsdb.SMSQ_SEND_15');
    bad('CREATE TABLE queue_backup SELECT * FROM SMSQ_SEND_15 WHERE app_etc1 = 1');
    bad('HANDLER SMSQ_SEND_15 READ FIRST');
    bad("PREPARE st FROM 'SELECT * FROM SMSQ_SEND_15'");
    bad('SELECT * FROM SMSQ_SEND_15 \\ WHERE app_etc1 = 1');
    // 정상 꼴은 그대로
    ok('SELECT 1 FROM SMSQ_SEND_15 LIMIT 0');
    ok('CREATE TABLE IF NOT EXISTS smsdb.SMSQ_SEND_17 LIKE smsdb.SMSQ_SEND_13');
    ok("SELECT * FROM SMSQ_SEND_15 WHERE app_etc1 = '한글 캠페인 €' AND msg_contents LIKE '%[광고]%'");
    ok('SELECT COUNT(*) /* 한글 주석 */ FROM SMSQ_SEND_15 WHERE app_etc1 = ? -- 끝 주석\n', ['c']);
    ok('SELECT * FROM SMSQ_SEND_15 WHERE status_code = 100 AND sendreq_time < NOW() - INTERVAL 1.5 HOUR');
    ok('SELECT * FROM SMSQ_SEND_15 WHERE app_etc1 = ? AND CASE WHEN msg_type = ? THEN 1 ELSE 0 END = 1', ['c', 'S']);
    ok('SELECT `limit`.seqno FROM SMSQ_SEND_15 WHERE `status_code` = 100');
  });

  it('UNION 한 갈래 · 바깥이 좁혀도 안쪽 블록마다', () => {
    bad('SELECT * FROM SMSQ_SEND_13 WHERE app_etc1 = ? UNION ALL SELECT * FROM SMSQ_SEND_14', ['c']);
    bad('SELECT * FROM (SELECT * FROM SMSQ_SEND_13) AS u WHERE app_etc1 = ?', ['c']);
    bad('(SELECT * FROM SMSQ_SEND_13 WHERE seqno > 0 LIMIT 5) UNION ALL (SELECT * FROM SMSQ_SEND_14 WHERE app_etc1 = ? LIMIT 5)', ['c']);
  });

  it('주석 · 문자열 · 이스케이프로 조건을 꾸민 글', () => {
    bad('SELECT * FROM SMSQ_SEND_15 # WHERE app_etc1 = 1');
    bad('SELECT * FROM SMSQ_SEND_15 -- WHERE app_etc1 = 1');
    bad('SELECT * FROM SMSQ_SEND_15 /* WHERE app_etc1 = 1 */');
    bad("SELECT 'FROM x WHERE app_etc1 = 1' AS a FROM SMSQ_SEND_15");
    bad('SELECT "WHERE app_etc1 = 1" AS a FROM SMSQ_SEND_15');
    // 이스케이프된 따옴표 · 겹친 따옴표 = 문자열 안(서버도 그렇게 읽음) → 값 하나 = 좁힘
    ok("SELECT * FROM SMSQ_SEND_15 WHERE dest_no = 'a\\' OR 1=1 -- '");
    ok("SELECT * FROM SMSQ_SEND_15 WHERE app_etc1 = 'a'' OR ''1'");
    // 역빗금 자체를 이스케이프하면 문자열은 거기서 끝 → 뒤의 OR 는 조건
    bad("SELECT * FROM SMSQ_SEND_15 WHERE dest_no = 'a\\\\' OR 1=1");
    bad('SELECT * FROM SMSQ_SEND_15 WHERE dest_no = "a\\\\" OR 1=1');
  });

  it('반례마다 정말 위반으로 나온다(값을 채운 꼴)', () => {
    expect(queueScanVerdict(format('SELECT * FROM SMSQ_SEND_15 WHERE dest_no = ? OR 1', ["x' OR 1=1 -- "]))).not.toBeNull();
    // 값을 채운 뒤에도 좁힘 하나 = 통과(값 안의 OR 는 글이 아님)
    expect(queueScanVerdict(format('SELECT * FROM SMSQ_SEND_15 WHERE dest_no = ?', ["x' OR 1=1 -- "]))).toBeNull();
  });
});

describe('C131 R94 지킴이 — noteQueueSql', () => {
  const seen: any[] = [];
  beforeEach(() => {
    seen.length = 0;
    setQueueScanReporter((v) => { seen.push(v); });
  });

  it('던지지 않는다 · 보고가 던지거나 거절해도', async () => {
    setQueueScanReporter(() => { throw new Error('보고 실패'); });
    expect(() => noteQueueSql('t', 'SELECT * FROM SMSQ_SEND_15')).not.toThrow();
    setQueueScanReporter(async () => { throw new Error('늦은 실패'); });
    expect(() => noteQueueSql('t', 'SELECT * FROM SMSQ_SEND_14')).not.toThrow();
    expect(() => noteQueueSql('t', { sql: 'SELECT * FROM SMSQ_SEND_13', values: [] })).not.toThrow();
    expect(() => noteQueueSql('t', undefined)).not.toThrow();
    expect(() => noteQueueSql('t', 'SELECT * FROM ?? WHERE app_etc1 = ?', [{ toString: () => { throw new Error('x'); } }])).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('같은 모양 = 한 번 보고 · 값이 달라도 같은 모양 · 고객 값은 모양에 없음', async () => {
    noteQueueSql('mysqlQuery', 'SELECT * FROM SMSQ_SEND_15 WHERE dest_no LIKE ?', ['01012345678']);
    noteQueueSql('mysqlQuery', 'SELECT * FROM SMSQ_SEND_13 WHERE dest_no LIKE ?', ['01099998888']);
    noteQueueSql('mysqlQuery', "SELECT * FROM SMSQ_SEND_15 WHERE dest_no LIKE '01055556666'");
    // 따옴표 없는 숫자 = 숫자 모양 N(다른 모양 · 값은 역시 지워짐)
    noteQueueSql('mysqlQuery', 'SELECT * FROM SMSQ_SEND_15 WHERE dest_no LIKE 01077776666');
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(2);
    expect(seen.map((v) => v.shape)).toEqual(['SELECT * FROM SMSQ_SEND_n WHERE dest_no LIKE ?', 'SELECT * FROM SMSQ_SEND_n WHERE dest_no LIKE N']);
    expect(seen[0].via).toBe('mysqlQuery');
    expect(JSON.stringify(seen)).not.toMatch(/0101234|0109999|0105555|0107777/);
  });

  it('값을 채운 글로 판정 — 이름 자리표시자 · 객체 값', async () => {
    noteQueueSql('a', 'SELECT * FROM ?? WHERE seqno > ?', ['SMSQ_SEND_15', 0]);
    // mysql2(sql-escaper) 는 WHERE 자리 객체를 글 하나('[object Object]')로 채운다 = 연결이 보내는 글과 같은 판정 = 값 하나 · 좁힘 아님
    noteQueueSql('a', 'SELECT * FROM SMSQ_SEND_13 WHERE ?', [{ app_etc1: 'c' }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen.map((v) => v.shape)).toEqual(['SELECT * FROM SMSQ_SEND_n WHERE seqno > N', 'SELECT * FROM SMSQ_SEND_n WHERE ?']);
  });

  it('빠른 길 · 통과 글 = 보고 0', async () => {
    noteQueueSql('a', 'SELECT 1');
    noteQueueSql('a', 'INSERT INTO SMSQ_SEND_13 (a) VALUES (?)', ['x']);
    noteQueueSql('a', 'SELECT * FROM SMSQ_SEND_13 WHERE app_etc1 = ?', ['c']);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(0);
  });

  it('모양 상한 = 200 넘으면 보고 멈춤(로그 한 줄)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (let i = 0; i < 230; i++) noteQueueSql(`via${i}`, 'SELECT * FROM SMSQ_SEND_15');
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(200);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('모양 상한'))).toHaveLength(1);
    warn.mockRestore();
  });
});
