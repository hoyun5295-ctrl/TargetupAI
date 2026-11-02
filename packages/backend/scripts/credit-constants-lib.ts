/**
 * 프론트 크레딧 상수 파일(frontend/src/constants/credit.generated.ts)을 크레딧 CT 에서 만든다(★ 2026-11-01 설계서 §16-2 · D1).
 *   값 = 단가표(CREDIT_COST_MAP) · 충전 단가 · 부가세 · 원장 type 표 / 함수 = 일일 분석 식 · 충전 금액 · 원장 증감(ai-credit-calc.ts 의 그 함수 글자 그대로 ·
 *   구문 나무로 잘라 온다 · 다시 쓰지 않는다). 쓰는 곳 = scripts/gen-credit-constants.ts · 대조 = credit-constants-generated.test.ts(손 수정 · 백엔드만 바꿈 = 빨간불).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import { CREDIT_COST_MAP, CREDIT_UNIT_PRICE, CREDIT_VAT_RATE, CREDIT_TX_TYPES } from '../src/utils/ai-credit-calc';

export const GENERATED_PATH = join(__dirname, '..', '..', 'frontend', 'src', 'constants', 'credit.generated.ts');
const CALC_PATH = join(__dirname, '..', 'src', 'utils', 'ai-credit-calc.ts');
/** 프론트로 그대로 옮기는 함수(자기 완결 · 이 파일의 상수만 부른다) */
const FUNCTIONS = ['dailyDbAnalysisCredits', 'calcRechargeAmount', 'creditTxDelta'];

export function renderFrontendCreditConstants(): string {
  const src = readFileSync(CALC_PATH, 'utf8').replace(/\r\n/g, '\n');
  const sf = ts.createSourceFile('ai-credit-calc.ts', src, ts.ScriptTarget.Latest, true);
  const fn = (name: string): string => {
    const d = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);
    if (!d) throw new Error(`ai-credit-calc.ts 에 함수 ${name} 이 없다`);
    return d.getText(sf);
  };
  const costs = Object.keys(CREDIT_COST_MAP).sort().map((k) => `  '${k}': ${CREDIT_COST_MAP[k]},`).join('\n');
  return [
    '// 자동 생성 — 손으로 고치지 않는다. 원본 = 백엔드 크레딧 CT packages/backend/src/utils/ai-credit-calc.ts',
    '// 다시 만들기 = packages/backend 에서 `npx ts-node scripts/gen-credit-constants.ts` · 시험(credit-constants-generated.test.ts)이 다시 만든 글자와 대조한다.',
    '',
    '/** 원천 → 작업당 크레딧(백엔드 CREDIT_COST_MAP) */',
    `export const CREDIT_COSTS: Readonly<Record<string, number>> = {\n${costs}\n};`,
    '',
    `export const CREDIT_UNIT_PRICE = ${CREDIT_UNIT_PRICE};`,
    `export const CREDIT_VAT_RATE = ${CREDIT_VAT_RATE};`,
    `export const CREDIT_TX_TYPES: readonly string[] = [${[...CREDIT_TX_TYPES].map((t) => `'${t}'`).join(', ')}];`,
    '',
    ...FUNCTIONS.flatMap((n) => [fn(n), '']),
  ].join('\n');
}
