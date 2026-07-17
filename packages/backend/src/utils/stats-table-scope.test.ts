import { describe, it, expect } from 'vitest';
import { recordedLiveTables, logTablesForLive } from './stats-table-scope';

const BASE = { id: 'c1', company_id: 'co1', created_by: 'u1' };

describe('recordedLiveTables — sentTables 축소 게이트 (라인 축)', () => {
  it('유효 LIVE 기록만 추출 + 중복 제거', () => {
    expect(
      recordedLiveTables({
        ...BASE,
        send_config: { sentTables: ['SMSQ_SEND_4', 'SMSQ_SEND_4', 'SMSQ_SEND_13'] },
      }),
    ).toEqual(['SMSQ_SEND_4', 'SMSQ_SEND_13']);
  });

  it('LOG 테이블명·비문자열·형식 밖 문자열은 기록으로 취급하지 않음', () => {
    expect(
      recordedLiveTables({
        ...BASE,
        send_config: { sentTables: ['SMSQ_SEND_4_202607', null, 42, '', 'DROP TABLE x', 'SMSQ_SEND_'] },
      }),
    ).toEqual([]);
  });

  it('기록 없음 = 빈 배열 (fallback 경로) — send_config 부재/빈 배열/배열 아님', () => {
    expect(recordedLiveTables({ ...BASE })).toEqual([]);
    expect(recordedLiveTables({ ...BASE, send_config: { sentTables: [] } })).toEqual([]);
    expect(recordedLiveTables({ ...BASE, send_config: { sentTables: 'SMSQ_SEND_4' } })).toEqual([]);
  });

  it('SELECT에 send_config를 안 담는 기존 소비처(results/admin/querySendStats) = 전부 fallback', () => {
    expect(recordedLiveTables({ ...BASE, sent_at: '2026-07-17' })).toEqual([]);
  });
});

describe('logTablesForLive — 라인별 전 LOG 선별 (시간 창 가정 없음)', () => {
  const ALL = [
    'SMSQ_SEND_1',
    'SMSQ_SEND_1_202606',
    'SMSQ_SEND_1_202607',
    'SMSQ_SEND_13',
    'SMSQ_SEND_13_202607',
    'SMSQ_SEND_4',
    'SMSQ_SEND_4_202602',
    'SMSQ_SEND_4_202608',
  ];

  it('해당 라인의 월별 LOG 전부 반환 — 몇 달 떨어진 LOG도 포함(장기 분할 발송 대비)', () => {
    expect(logTablesForLive('SMSQ_SEND_4', ALL)).toEqual(['SMSQ_SEND_4_202602', 'SMSQ_SEND_4_202608']);
  });

  it('언더스코어 경계 — SMSQ_SEND_1이 SMSQ_SEND_13_202607을 잡지 않음', () => {
    expect(logTablesForLive('SMSQ_SEND_1', ALL)).toEqual(['SMSQ_SEND_1_202606', 'SMSQ_SEND_1_202607']);
    expect(logTablesForLive('SMSQ_SEND_13', ALL)).toEqual(['SMSQ_SEND_13_202607']);
  });

  it('LIVE 자신·6자리 월 형식 밖은 제외', () => {
    expect(logTablesForLive('SMSQ_SEND_4', ['SMSQ_SEND_4', 'SMSQ_SEND_4_backup', 'SMSQ_SEND_4_20260'])).toEqual([]);
  });
});
