/**
 * 알림톡 성공 결과별 집계 (★2026-09-26 한줄로 V2 F01·F04)
 *
 * 선불 알림톡 정산이 결과별 차액을 돌려주려면 성공을 셋으로 나눠 세야 한다:
 * 알림톡 성공(K 1800) · SMS 대체(K 7830 + 대체 S행 성공) · LMS 대체(K 7831 + 대체 L행 성공).
 *
 * 못 박는 것
 *   1. 결과(성공)는 이력에서만 센다 — smsCampaignCountsSafe와 같은 테이블 분류(classifyResultTables).
 *      이력 짝이 있는 라이브 큐를 섞으면 이동 중인 행이 두 번 잡힌다(과대 = 과환불).
 *   2. 대체 행 판정식은 통계 엑셀(aggregateSmsChannelSplitByCampaign)과 같은 식 — 운영에서 쓰이는 식이다.
 *   3. 테이블이나 캠페인이 없으면 조회하지 않는다(부하 0).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mysqlQuery = vi.fn();
vi.mock('../../config/database', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
  query: vi.fn(async () => ({ rows: [] })),
  mysqlQuery: (...a: any[]) => (mysqlQuery as any)(...a),
}));

import { smsKakaoResultAgg, smsCampaignSubRowCounts } from '../sms-queue';

beforeEach(() => mysqlQuery.mockReset());
// ★ 2026-11-06 C107F ② 집계 앞에 친구 칸 표 목록(information_schema · 5분 캐시)을 읽는다 — 집계 문장은 내용으로 찾는다
const aggSql = () => String(mysqlQuery.mock.calls.map((c: any[]) => String(c[0])).find((s: string) => s.includes('_grp')) || '');

describe('smsKakaoResultAgg', () => {
  it('이력 테이블과 이력 짝 없는 라이브만 읽고, 캠페인별로 합산한다', async () => {
    mysqlQuery.mockImplementation(async (sql: string) => (/information_schema/.test(sql) ? [{ TABLE_NAME: 'SMSQ_SEND_13' }] : [
      { _grp: 'camp-1', kakao: 3, inRowSms: 0, inRowLms: 0, subSms: 0, subLms: 1, sub: 1, friendKakao: 2 },
      { _grp: 'camp-1', kakao: 1, inRowSms: 0, inRowLms: 0, subSms: 0, subLms: 1, sub: 1, friendKakao: 0 },
    ]));
    const out = await smsKakaoResultAgg(['SMSQ_SEND_1', 'SMSQ_SEND_1_202609', 'SMSQ_SEND_13'], ['camp-1']);
    const sql = aggSql();
    expect(sql).toContain('FROM SMSQ_SEND_1_202609 WHERE');
    expect(sql).toContain('FROM SMSQ_SEND_13 WHERE');
    expect(sql).not.toContain('FROM SMSQ_SEND_1 WHERE');
    expect(out.get('camp-1')).toEqual({ kakao: 4, inRowSms: 0, inRowLms: 0, subSms: 0, subLms: 2, sub: 2, friendKakao: 2 });
    // ★ 2026-11-06 C107F ② 친구 칸이 있는 표(13)만 친구 성공 식 · 없는 표(이력) = 0(칸 없는 표에 쓰면 쿼리 전체가 죽는다)
    const parts = sql.split(' UNION ALL ');
    const p13 = parts.find((s: string) => s.includes('FROM SMSQ_SEND_13 WHERE')) || '';
    const pLog = parts.find((s: string) => s.includes('FROM SMSQ_SEND_1_202609 WHERE')) || '';
    expect(p13).toContain("k_friend_yn = 'Y'");
    expect(pLog).not.toContain('k_friend_yn');
    expect(pLog.replace(/\s+/g, ' ')).toContain('0 AS friendKakao');
  });

  it('결과별 식 — 카카오(알림톡 K · ★1105 C107 브랜드 F) 1800 · 7830/7831 · 대체 행(통계와 같은 판정식) 성공', async () => {
    mysqlQuery.mockResolvedValue([]);
    await smsKakaoResultAgg(['SMSQ_SEND_1_202609'], ['camp-1']);
    const sql = aggSql().replace(/\s+/g, ' ');
    expect(sql).toContain("msg_type IN ('K', 'F') AND status_code = 1800");
    expect(sql).toContain("msg_type IN ('K', 'F') AND status_code = 7830");
    expect(sql).toContain("msg_type IN ('K', 'F') AND status_code = 7831");
    expect(sql).toContain("msg_type = 'S' AND k_oriseq IS NOT NULL AND k_oriseq > 0 AND status_code IN (6,1000,1800,7830,7831)");
    expect(sql).toContain("msg_type = 'L' AND k_oriseq IS NOT NULL AND k_oriseq > 0 AND status_code IN (6,1000,1800,7830,7831)");
    expect(sql).toContain('WHEN k_oriseq IS NOT NULL AND k_oriseq > 0 THEN 1 ELSE 0 END) AS sub');
  });

  it('테이블이나 캠페인이 없으면 조회하지 않는다', async () => {
    expect((await smsKakaoResultAgg([], ['camp-1'])).size).toBe(0);
    expect((await smsKakaoResultAgg(['SMSQ_SEND_1_202609'], [])).size).toBe(0);
    expect(mysqlQuery).not.toHaveBeenCalled();
  });
});

/**
 * ★ 2026-09-26 Codex 3R(F05·F06·F11) — 여정 알림톡의 수신자 기준 실패 = 행 실패 − 대체 행 수.
 * 대체 행은 smsCampaignCountsSafe와 **같은 가시성 규칙**으로 세야 뺄셈이 맞는다:
 * 이력(결과 테이블) 전체 + 이력 짝 있는 라이브의 대기(100/104)·만료 실패(비성공·비대기 + mobsend_time NULL).
 */

describe('smsCampaignSubRowCounts', () => {
  it('이력은 대체 행 전체, 라이브는 대기·만료 실패만 — 캠페인별로 더한다', async () => {
    mysqlQuery
      .mockResolvedValueOnce([{ _grp: 'camp-1', sub: 2 }])
      .mockResolvedValueOnce([{ _grp: 'camp-1', lsub: 1 }]);
    const out = await smsCampaignSubRowCounts(['SMSQ_SEND_1', 'SMSQ_SEND_1_202609'], ['camp-1']);
    expect(out.get('camp-1')).toBe(3);
    const logSql = String(mysqlQuery.mock.calls[0][0]).replace(/\s+/g, ' ');
    const liveSql = String(mysqlQuery.mock.calls[1][0]).replace(/\s+/g, ' ');
    expect(logSql).toContain('FROM SMSQ_SEND_1_202609 WHERE');
    expect(logSql).not.toContain('FROM SMSQ_SEND_1 WHERE');
    expect(logSql).toContain('SUM(CASE WHEN k_oriseq IS NOT NULL AND k_oriseq > 0 THEN 1 ELSE 0 END) AS sub');
    expect(liveSql).toContain('FROM SMSQ_SEND_1 WHERE');
    expect(liveSql).toContain('k_oriseq IS NOT NULL AND k_oriseq > 0 AND (status_code IN (100,104) OR (status_code NOT IN (6,1000,1800,7830,7831,100,104) AND mobsend_time IS NULL))');
  });

  it('테이블이나 캠페인이 없으면 조회하지 않는다', async () => {
    expect((await smsCampaignSubRowCounts([], ['camp-1'])).size).toBe(0);
    expect((await smsCampaignSubRowCounts(['SMSQ_SEND_1_202609'], [])).size).toBe(0);
    expect(mysqlQuery).not.toHaveBeenCalled();
  });
});
