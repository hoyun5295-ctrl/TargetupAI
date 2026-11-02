/**
 * 배포 원장 — 결과 칸이 빈 「배포 앞」 항목 = 먼저 실행(★ 2026-11-01 크레딧 컨트롤타워 설계서 §16-7 · B)
 * C90 은 배포 앞 DDL-1 이 코드보다 늦게 실행돼 1일 지급 패스가 회사마다 멈췄다(경보 100통) → 원장이 [먼저 실행]을 맨 위에 찍고 실패 코드.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLedger, pendingPreDeploy } from '../../../scripts/deploy-ledger-lib.mjs';

const L = (body: string) =>
  `# 배포 원장\n\n## 머리\n\n- pulled_head: abc1234 · 2026-11-01\n- deployed_head: abc1234 · 2026-11-01\n\n## §0 카드\n\n| 카드 | 커밋 |\n|---|---|\n| C1 | 미커밋 |\n\n## §1 대기\n\n${body}`;

describe('결과가 빈 「배포 앞」 항목', () => {
  it('머리에 배포 앞 + 결과 빈칸 = 먼저 실행 · 결과가 있거나 배포 뒤 항목은 아니다', () => {
    const l = parseLedger(L([
      '### A-1 · 칸 추가 · ★ 배포 앞\n- 카드: C1\n- 단계: DDL\n- 결과:\n',
      '### A-2 · 표 추가 · ★ 배포 앞\n- 카드: C1\n- 단계: DDL\n- 결과: 1101 실행 · 한 줄\n',
      '### A-3 · 채움(배포 뒤)\n- 카드: C1\n- 단계: 코드 배포 뒤\n- 결과:\n',
      '### A-4 · 색인 · ★ 배포 앞\n- 카드: C1\n- 단계: DDL\n',
    ].join('\n')));
    expect(pendingPreDeploy(l).map((it: any) => it.id)).toEqual(['A-1', 'A-4']);
  });

  it('배포 원장 실행기가 이 판정으로 맨 위에 찍고 실패 코드로 끝난다(다른 출력보다 먼저)', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'deploy-ledger.mjs'), 'utf8');
    const at = src.indexOf('const firstRun = pendingPreDeploy(ledger);');
    expect(at).toBeGreaterThan(0);
    expect(src).toContain('if (firstRun.length) process.exitCode = 1;');
    expect(at).toBeLessThan(src.indexOf('print(`[원장] 작업 트리 미커밋'));
  });
});
