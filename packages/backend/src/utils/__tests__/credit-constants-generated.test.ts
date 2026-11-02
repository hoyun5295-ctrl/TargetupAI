/**
 * 프론트 크레딧 상수 = 백엔드 크레딧 CT 에서 만든 파일(★ 2026-11-01 설계서 §16-2 · D1 · Harold 「여러곳에서 사용할 기능은 컨트롤타워화」)
 *   ① 생성 파일 = 지금 CT 로 다시 만든 글자(손 수정 · 백엔드 단가만 바꿈 = 빨간불 → `npx ts-node scripts/gen-credit-constants.ts`)
 *   ② constants/credit.ts 에 단가 숫자 0 · 함수 사본 0(생성 파일을 다시 내보낸다)
 *   ③ 화면 표 셋(작은 생성 · 확인 창 · 요금 요약)의 키 = 서버 단가표 키(없으면 화면에 0크레딧)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GENERATED_PATH, renderFrontendCreditConstants } from '../../../scripts/credit-constants-lib';
import { CREDIT_COST_MAP } from '../ai-credit-calc';

const FE_CREDIT = join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'constants', 'credit.ts');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

describe('프론트 크레딧 상수 = 크레딧 CT 생성 파일', () => {
  it('① 생성 파일 = 지금 CT 로 다시 만든 글자(다르면 npx ts-node scripts/gen-credit-constants.ts)', () => {
    expect(read(GENERATED_PATH)).toBe(renderFrontendCreditConstants());
  });

  it('② constants/credit.ts = 단가 숫자 0 · 함수 · 상수 사본 0(생성 파일을 다시 내보낸다)', () => {
    const fe = stripComments(read(FE_CREDIT));
    expect(fe.match(/\b(?:cost|credits)\s*:\s*\d/g) || []).toEqual([]);
    expect(fe.match(/^\s*'[a-z0-9-]+'\s*:\s*\d/gm) || []).toEqual([]);
    for (const name of ['dailyDbAnalysisCredits', 'calcRechargeAmount', 'creditTxDelta']) expect(fe).not.toMatch(new RegExp(`function ${name}\\b`));
    for (const name of ['CREDIT_UNIT_PRICE', 'CREDIT_VAT_RATE', 'CREDIT_TX_TYPES']) expect(fe).not.toMatch(new RegExp(`const ${name}\\b`));
    expect(fe).toContain("from './credit.generated';");
  });

  it('③ 화면 표 셋의 키 = 서버 단가표 키(작은 생성 · 확인 창 = pickCosts 키 목록 · 요금 요약 = source)', () => {
    const fe = stripComments(read(FE_CREDIT));
    const listOf = (name: string) => {
      const at = fe.indexOf(`export const ${name}: Record<string, number> = pickCosts([`);
      expect(at, name).toBeGreaterThan(0);
      return [...fe.slice(at, fe.indexOf(']);', at)).matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    };
    const keys = [...listOf('AI_GENERATE_COSTS'), ...listOf('CONFIRM_CREDIT_COSTS')];
    expect(keys.length).toBeGreaterThan(30);
    const task = fe.slice(fe.indexOf('export const CREDIT_TASK_COSTS'), fe.indexOf(".map((t) => ({ ...t, cost: CREDIT_COSTS[t.source] ?? 0 }))"));
    const sources = [...task.matchAll(/source:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
    expect(sources.length).toBeGreaterThan(10);
    expect([...keys, ...sources].filter((k) => !(k in CREDIT_COST_MAP))).toEqual([]);
  });
});
