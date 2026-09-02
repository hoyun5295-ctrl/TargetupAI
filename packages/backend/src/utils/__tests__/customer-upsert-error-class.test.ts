/**
 * isRowLevelDbError 분류 계약 — 배치 실패 시 "단건 폴백을 돌릴 오류인가"를 가른다.
 *
 * ★ 2026-09-02 신설. 경위: `21000`(cannot affect row a second time)이 계통 오류로 분류돼
 *   단건 폴백이 생략됐고, 배치 안 중복 1건 때문에 청크 500건이 통째로 버려졌다
 *   (아난티 최근 24시간 25,244건 · 53청크). 실측 SQLSTATE 21000 확인 후 행 수준으로 편입.
 *
 * 이 판정은 sync·upload·manual 세 경로가 공유한다. 분류가 틀리면 한 경로의 실수가
 * 전 경로의 데이터 손실이 되므로, 양방향(폴백 대상 / 폴백 금지)을 모두 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { isRowLevelDbError } from '../customer-upsert';

describe('isRowLevelDbError — 단건 폴백을 돌려야 하는 오류', () => {
  it('21000(cardinality_violation) = 배치 안 중복이라 단건으로 쪼개면 풀린다', () => {
    // 이 한 줄이 25,244건 손실의 분기점이었다
    expect(isRowLevelDbError({ code: '21000' })).toBe(true);
  });

  it('22xxx(데이터 형식) — 그 행만 실패시키면 나머지는 산다', () => {
    for (const code of ['22001', '22007', '22008', '22P02']) {
      expect(isRowLevelDbError({ code }), `${code}`).toBe(true);
    }
  });

  it('23xxx(무결성 위반) — 중복 키·FK 위반은 행 격리가 정답', () => {
    for (const code of ['23502', '23503', '23505', '23514']) {
      expect(isRowLevelDbError({ code }), `${code}`).toBe(true);
    }
  });
});

describe('isRowLevelDbError — 폴백을 돌리면 안 되는 계통 오류', () => {
  it('연결·구문·자원·운영자 개입은 false (폴백 시 장애 중인 DB에 부하 증폭)', () => {
    for (const code of ['08006', '08003', '42601', '42P01', '53300', '53200', '57014', '57P01']) {
      expect(isRowLevelDbError({ code }), `${code}`).toBe(false);
    }
  });

  it('코드가 없거나 오류 객체가 아니면 false (알 수 없는 것에 폴백을 돌리지 않는다)', () => {
    expect(isRowLevelDbError(undefined)).toBe(false);
    expect(isRowLevelDbError(null)).toBe(false);
    expect(isRowLevelDbError({})).toBe(false);
    expect(isRowLevelDbError(new Error('boom'))).toBe(false);
  });

  it('21000 외의 21xxx는 편입하지 않는다 (2100x 전체를 연 것이 아니다)', () => {
    expect(isRowLevelDbError({ code: '21999' })).toBe(false);
  });
});
