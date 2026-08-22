/**
 * 크레딧 라벨 1:1 계약 (★ 2026-08-22 신설)
 *
 * `ai-credit-calc.ts`의 `CREDIT_COST_MAP`에 있는 모든 source는 프론트 `constants/credit.ts`의
 * `CREDIT_SOURCE_LABELS`에 한국어 라벨을 가져야 한다. 없으면 고객의 크레딧 사용 내역에
 * "AI 작업"이라는 이름 없는 줄로 뜬다(`getCreditLabel`의 폴백).
 *
 * 왜 테스트로 잠그는가:
 *   두 파일 모두 머리 주석에 "1:1 일치해야 함, 한쪽만 바꾸지 말 것"이라고 적혀 있었지만
 *   2026-08-22 실측에서 `dm-custom-short-link` 하나가 실제로 빠져 있었다(2026-07-10 신설분).
 *   **사람이 지키기로 약속한 계약은 약속만으로는 지켜지지 않는다.** 새 AI 기능에 단가를 매기면서
 *   라벨을 잊으면 여기서 걸린다.
 *
 * ⛔ 이 테스트는 두 파일을 **소스 텍스트로** 읽는다. 프론트를 import하면 백엔드 빌드가 프론트에 묶인다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const BACKEND_SRC = resolve(__dirname, '../ai-credit-calc.ts');
const FRONTEND_SRC = resolve(__dirname, '../../../../frontend/src/constants/credit.ts');

/** 이름 뒤 첫 `{`부터 짝이 맞는 `}`까지의 본문 */
function objectBody(src: string, anchor: string): string {
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error(`앵커를 찾지 못했다: ${anchor}`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`닫는 괄호를 찾지 못했다: ${anchor}`);
}

/**
 * 객체 본문에서 키를 전부 뽑는다.
 * ⛔ 줄 단위 정규식으로 세지 않는다 — 이 두 파일은 한 줄에 키를 여러 개 적는 형태라
 *   `^\s*'key':` 로 세면 뒤쪽 키를 통째로 놓치고 "30건 누락" 같은 거짓 결과가 나온다(2026-08-22 실측 오류 경위).
 */
function keysOf(body: string): Set<string> {
  const out = new Set<string>();
  const re = /(?:^|[,{\s])'?([A-Za-z][A-Za-z0-9_-]*)'?\s*:\s*(?:'[^']*'|"[^"]*"|\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    // 주석 줄에 적힌 예시는 세지 않는다
    const before = body.slice(Math.max(0, m.index - 200), m.index);
    const lineHead = before.slice(before.lastIndexOf('\n') + 1).trim();
    if (lineHead.startsWith('//') || lineHead.startsWith('*')) continue;
    out.add(m[1]);
  }
  return out;
}

describe('크레딧 라벨 1:1 계약 (백엔드 단가 ↔ 프론트 라벨)', () => {
  const costKeys = keysOf(objectBody(readFileSync(BACKEND_SRC, 'utf8'), 'CREDIT_COST_MAP'));
  const labelKeys = keysOf(objectBody(readFileSync(FRONTEND_SRC, 'utf8'), 'CREDIT_SOURCE_LABELS'));

  it('단가가 있는 모든 source는 화면 라벨을 갖는다(없으면 사용 내역에 "AI 작업"으로 뜬다)', () => {
    const missing = [...costKeys].filter((k) => !labelKeys.has(k));
    expect(missing, `프론트 constants/credit.ts CREDIT_SOURCE_LABELS에 라벨을 추가하라: ${missing.join(', ')}`).toEqual([]);
  });

  it('추출 자체가 죽지 않았는지 본다(정규식이 0건을 돌려주면 이 테스트는 늘 통과한다)', () => {
    // 2026-08-22 기준 백엔드 59 · 프론트 58. 파일이 분할되거나 형태가 바뀌어 파싱이 깨지면 여기서 걸린다.
    expect(costKeys.size).toBeGreaterThanOrEqual(50);
    expect(labelKeys.size).toBeGreaterThanOrEqual(50);
  });
});
