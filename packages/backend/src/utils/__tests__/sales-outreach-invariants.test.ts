/**
 * AI 영업 아웃리치 불변식 (2026-08-24 신설 — docs/2026-07-31-ai-sales-outreach-design.md §15-6, 회의 H11·H17·H18)
 *
 * 잠그는 것
 *  1. 모델명 0 — 아웃리치 축 파일 전체(주석 포함)에 모델명 문자열이 없다. 이 축은 메일·공개 페이지로
 *     외부에 나가는 문자열을 만드는 곳이라 파일 지정 전수 0을 계약으로 건다(D190→D214+ 재발 이력).
 *  2. 라우트 err 원문 미노출 — err?.message(원문)는 console 줄에서만 쓴다. 응답은 분류 오류의 안전 문구만.
 *  3. sweeper 부팅 등재 — app.ts에 startSalesOutreachSweeper() 호출이 실재한다(선언은 의도, 워커가 사실).
 *  4. 발송 경로 유일 — sendOutreachProposalMail 호출은 잡 CT의 사람 클릭 함수 1곳뿐. sweeper는 발송 능력이 없다.
 *  5. 내부 URL 미주입 — 메일 조립 파일은 내부 API 경로(/api/sales-outreach)를 모른다(H2 — 손에 없으면 샐 수 없다).
 *  6. 게이트 fail-closed — 아웃리치 축에 super_admin 무조건 통과 분기가 없다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');

const OUTREACH_FILES = [
  'utils/sales-outreach-jobs.ts',
  'utils/sales-outreach-produce.ts',
  'utils/sales-outreach-style.ts',
  'utils/sales-outreach-sweeper.ts',
  'utils/outreach-mailer.ts',
  'routes/sales-outreach.ts',
  'routes/outreach-public.ts',
];

describe('sales-outreach invariants', () => {
  it('모델명 0 — 축 전체 파일(주석 포함)', () => {
    for (const f of OUTREACH_FILES) {
      const src = read(f);
      expect(src, `${f}에 모델명 문자열`).not.toMatch(/sonnet|opus|haiku|claude|anthropic|gpt-/i);
    }
  });

  it('라우트 err 원문 미노출 — err?.message는 console 줄에서만', () => {
    // 공허 통과 방지 — 관리 라우트에는 분류 오류 처리(OutreachError)가 실재해야 한다(공개 라우트는 고정 문구만이라 대상 아님)
    expect(read('routes/sales-outreach.ts')).toContain('OutreachError');
    for (const f of ['routes/sales-outreach.ts', 'routes/outreach-public.ts']) {
      const src = read(f);
      for (const line of src.split('\n')) {
        if (line.includes('err?.message') && !line.includes('console.')) {
          // 주석 줄은 허용
          if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue;
          throw new Error(`${f}: err?.message(원문)가 console 밖에서 쓰였다 — ${line.trim()}`);
        }
      }
    }
  });

  it('sweeper 부팅 등재 — app.ts 실배선', () => {
    const app = read('app.ts');
    expect(app.indexOf('startSalesOutreachSweeper()')).toBeGreaterThan(-1);
  });

  it('발송 경로 유일 — 사람 클릭 함수 1곳, sweeper는 발송 능력 0', () => {
    const jobs = read('utils/sales-outreach-jobs.ts');
    // 여는 괄호까지 매칭 = 호출부만(임포트 줄은 괄호가 없다). 존재부터 단정(공허 통과 방지).
    const calls = jobs.match(/sendOutreachProposalMail\(/g) || [];
    expect(calls.length, '발송 함수 호출부는 sendOutreachMailForJob 1곳이어야 한다').toBe(1);

    const sweeper = read('utils/sales-outreach-sweeper.ts');
    expect(sweeper).not.toMatch(/sendOutreachProposalMail|sendMail|runOutreachJob|runProduction/);
  });

  it('메일 조립 파일은 내부 API 경로를 모른다(H2)', () => {
    const produce = read('utils/sales-outreach-produce.ts');
    expect(produce).toContain('buildProposalEmail'); // 공허 통과 방지
    expect(produce).not.toContain('/api/sales-outreach');
  });

  it('게이트 fail-closed — super_admin 무조건 통과 분기 없음', () => {
    for (const f of ['utils/sales-outreach-jobs.ts', 'routes/sales-outreach.ts']) {
      const src = read(f);
      expect(src, `${f}에 super_admin 우회 분기`).not.toMatch(/userType\s*===\s*'super_admin'\s*\)\s*return\s+true/);
    }
    // 판정은 fail-closed 코어(audit-log isSuperAdminAllowed 계열)를 쓴다
    expect(read('utils/sales-outreach-jobs.ts')).toContain('isSalesOutreachOperator');
  });
});
