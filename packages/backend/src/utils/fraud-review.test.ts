/**
 * 부정사용 보류·소명 — 전송자격인증 2.3 (★2026-08-19)
 *
 * 기준이 요구하는 것
 *   "결제정보↔계정 연계 · 명의 불일치 보류/소명 · 처리 결과 계정별 기록"
 *
 * 이 테스트가 지키는 것
 *   1. ★ **자동 거절하지 않는다.** 판정은 보류(사람 확인 대기)까지다 —
 *      입금자명이 배우자·법인 담당자·경리 이름인 정상 사례가 흔하다.
 *   2. ★ **세 상태를 세 값으로 답한다.** match / mismatch / unknown.
 *      대조할 명의가 없는 것을 mismatch로 접으면 명의 미등록 고객사가 전부 보류된다
 *      (LESSONS_BACKEND "두 값으로 세 상태를 답하지 마라").
 *   3. 법인 표기 차이는 흡수한다 — (주)·㈜·주식회사·(유)·유한회사는 같은 이름이다.
 *   4. 은행이 붙이는 꼬리(숫자·지점명)를 이유로 불일치를 만들지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeHolderName, judgePayerName, PayerJudgement } from './fraud-review';

describe('★ 소스 불변식 — 보류는 상태가 아니라 속성이다', () => {
  /**
   * `held`를 새 status 값으로 넣으면 `status='pending'`을 보는 4곳이 조용히 깨진다(0819 영향표 실측) —
   * 중복 신청 판정(balance.ts) · 승인/반려 게이트(admin.ts) · 대기 뱃지(pending-badges.ts) · 목록 WHERE.
   * 그래서 상태는 pending 그대로 두고 `held_reason`으로만 표시한다. 그 선택을 코드로 고정한다.
   */
  const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf-8');

  it("deposit_requests에 status = 'held'를 쓰는 코드가 없다", () => {
    for (const rel of ['../routes/balance.ts', '../routes/admin.ts']) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/status\s*=\s*'held'/);
      expect(src, rel).not.toMatch(/'held'\s*,?\s*NOW\(\)/);
    }
  });

  it('보류 표시는 held_reason으로 하고, 신청 INSERT의 status는 pending 그대로다', () => {
    const src = read('../routes/balance.ts');
    expect(src).toContain('held_reason');
    expect(src).toMatch(/INSERT INTO deposit_requests[\s\S]{0,400}'pending'/);
  });
});

describe('명의 정규화', () => {
  it('법인 표기는 전부 같은 이름으로 접힌다', () => {
    const base = normalizeHolderName('한줄로');
    expect(normalizeHolderName('(주)한줄로')).toBe(base);
    expect(normalizeHolderName('㈜한줄로')).toBe(base);
    expect(normalizeHolderName('주식회사 한줄로')).toBe(base);
    expect(normalizeHolderName('한줄로 주식회사')).toBe(base);
    expect(normalizeHolderName('(유)한줄로')).toBe(base);
    expect(normalizeHolderName('유한회사 한줄로')).toBe(base);
  });

  it('공백·괄호·하이픈·대소문자를 흡수한다', () => {
    expect(normalizeHolderName('  A B - C ')).toBe(normalizeHolderName('abc'));
  });

  it('빈 값은 빈 문자열이다 — 빈 값끼리 일치로 보면 안 된다', () => {
    expect(normalizeHolderName('')).toBe('');
    expect(normalizeHolderName('   ')).toBe('');
    expect(normalizeHolderName('(주)')).toBe('');
  });
});

describe('★ 판정은 세 값이다 — 모르는 것을 불일치로 접지 않는다', () => {
  const holders = { companyName: '(주)한줄로', ceoName: '유호윤' };

  it('회사명과 맞으면 match', () => {
    expect(judgePayerName('주식회사 한줄로', holders).result).toBe<PayerJudgement>('match');
  });

  it('대표자명과 맞아도 match — 대표 개인 계좌 입금은 정상이다', () => {
    expect(judgePayerName('유호윤', holders).result).toBe<PayerJudgement>('match');
  });

  it('어느 쪽과도 다르면 mismatch', () => {
    expect(judgePayerName('김철수', holders).result).toBe<PayerJudgement>('mismatch');
  });

  it('★ 대조할 명의가 하나도 없으면 unknown — mismatch가 아니다', () => {
    expect(judgePayerName('김철수', { companyName: null, ceoName: null }).result).toBe<PayerJudgement>('unknown');
    expect(judgePayerName('김철수', { companyName: '  ', ceoName: '(주)' }).result).toBe<PayerJudgement>('unknown');
  });

  it('★ 입금자명이 비어 있으면 unknown — 판정 불가지 불일치가 아니다', () => {
    expect(judgePayerName('', holders).result).toBe<PayerJudgement>('unknown');
    expect(judgePayerName(null, holders).result).toBe<PayerJudgement>('unknown');
  });

  it('명의가 하나만 있으면 그것으로만 판정한다', () => {
    expect(judgePayerName('유호윤', { companyName: null, ceoName: '유호윤' }).result).toBe<PayerJudgement>('match');
    expect(judgePayerName('유호윤', { companyName: '(주)한줄로', ceoName: null }).result).toBe<PayerJudgement>('mismatch');
  });
});

describe('은행 표기 꼬리로 불일치를 만들지 않는다', () => {
  const holders = { companyName: '한줄로', ceoName: '유호윤' };

  it('뒤에 붙은 숫자는 떼고도 대조한다 — 유호윤0101', () => {
    expect(judgePayerName('유호윤0101', holders).result).toBe<PayerJudgement>('match');
  });

  it('앞뒤 공백·전각 공백을 흡수한다', () => {
    expect(judgePayerName('　유호윤 ', holders).result).toBe<PayerJudgement>('match');
  });

  it('★ 숫자만 적힌 입금자명은 보류다 — unknown으로 두면 그것이 우회 수단이 된다 (0819 Codex)', () => {
    const v = judgePayerName('01012345678', holders);
    expect(v.result).toBe<PayerJudgement>('mismatch');
    expect(v.holdReason).toContain('이름이 없어');
  });

  it('꼬리 숫자를 떼는 것이 남의 이름을 통과시키지 않는다', () => {
    expect(judgePayerName('김철수0101', holders).result).toBe<PayerJudgement>('mismatch');
  });
});

describe('★ 0819 Codex 정정 — 앞자리 몇 글자로 보류를 피할 수 없다', () => {
  const holders = { companyName: '한줄로마케팅', ceoName: '유호윤' };

  it('★ 대표자명은 완전 일치만 인정한다 — "유호"로 "유호윤"을 통과시키지 않는다', () => {
    expect(judgePayerName('유호', holders).result).toBe<PayerJudgement>('mismatch');
    expect(judgePayerName('유호윤', holders).result).toBe<PayerJudgement>('match');
  });

  it('★ 법인명 절단은 4자 이상만 — 두세 글자로는 통과하지 못한다', () => {
    expect(judgePayerName('한줄', holders).result).toBe<PayerJudgement>('mismatch');
    expect(judgePayerName('한줄로마', holders).result).toBe<PayerJudgement>('match');
  });

  it('★ 반대 방향은 인정하지 않는다 — 등록 상호보다 긴 이름은 남의 것이다', () => {
    expect(judgePayerName('한줄로마케팅컴퍼니', { companyName: '한줄로마케팅', ceoName: null }).result)
      .toBe<PayerJudgement>('mismatch');
  });
});

describe('★ 판정은 보류까지다 — 자동 거절 경로가 없다', () => {
  const holders = { companyName: '한줄로', ceoName: '유호윤' };

  it('불일치는 보류 사유를 돌려주되 거절 값은 없다', () => {
    const v = judgePayerName('김철수', holders);
    expect(v.result).toBe<PayerJudgement>('mismatch');
    expect(v.holdReason).toContain('입금자명');
    expect(v).not.toHaveProperty('reject');
    expect(v).not.toHaveProperty('autoReject');
  });

  it('일치·판정불가에는 보류 사유가 없다', () => {
    expect(judgePayerName('유호윤', holders).holdReason).toBeUndefined();
    expect(judgePayerName('', holders).holdReason).toBeUndefined();
  });

  it('보류 사유에 대조 대상 명의를 그대로 싣지 않는다 — 사유는 이력에 남는다', () => {
    const v = judgePayerName('김철수', holders);
    expect(v.holdReason).not.toContain('유호윤');
  });
});

describe('★ 0819 Codex 2R — 이름 없는 표기와 공동대표', () => {
  const holders = { companyName: '한줄로마케팅', ceoName: '유호윤' };

  it('★ 비어 있지 않은데 이름 성분이 없으면 보류다 — unknown으로 통과시키면 우회가 된다', () => {
    for (const bad of ['(주)', '주식회사', '---', '  ㈜  ', '...']) {
      const v = judgePayerName(bad, holders);
      expect(v.result, bad).toBe<PayerJudgement>('mismatch');
      expect(v.holdReason, bad).toContain('이름이 없어');
    }
  });

  it('진짜 미입력만 unknown이다', () => {
    expect(judgePayerName('', holders).result).toBe<PayerJudgement>('unknown');
    expect(judgePayerName('   ', holders).result).toBe<PayerJudgement>('unknown');
    expect(judgePayerName(null, holders).result).toBe<PayerJudgement>('unknown');
  });

  it('★ 공동대표는 나눠서 대조한다 — 합치면 정상 입금이 전부 보류된다', () => {
    const co = { companyName: null, ceoName: '유호윤,김철수' };
    expect(judgePayerName('유호윤', co).result).toBe<PayerJudgement>('match');
    expect(judgePayerName('김철수', co).result).toBe<PayerJudgement>('match');
    expect(judgePayerName('박영희', co).result).toBe<PayerJudgement>('mismatch');
  });

  it('구분자가 슬래시·가운뎃점이어도 나눈다', () => {
    expect(judgePayerName('김철수', { companyName: null, ceoName: '유호윤/김철수' }).result).toBe<PayerJudgement>('match');
    expect(judgePayerName('김철수', { companyName: null, ceoName: '유호윤·김철수' }).result).toBe<PayerJudgement>('match');
  });
});
