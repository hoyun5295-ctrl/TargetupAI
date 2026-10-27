/**
 * 배포 원장 계산 함수(★ 2026-10-27 설계서 §3-2 · §3-5 · DB 없음)
 *   advanceDeployedHead = 필요한 단계의 확인 출력이 받은 순서로 다 있을 때만 deployed_head 를 올린다
 *   cardState · recomputeCards = 카드 표시는 원장의 계산값(원장을 쓸 때마다 전 카드 재계산)
 */
import { describe, it, expect } from 'vitest';
import { requiredSteps, advanceDeployedHead, cardState, recomputeCards, parseLedger } from '../../../scripts/deploy-ledger-lib.mjs';

const BE = ['packages/backend/src/utils/a.ts'];
const FE = ['packages/frontend/src/b.tsx'];

describe('필요한 단계 = 범위의 누적 변경', () => {
  it('백엔드만 · 프론트만 · 둘 다 · 의존성 · env · 문서만', () => {
    expect(requiredSteps({ changedFiles: BE })).toEqual(['backend-build', 'restart', 'uptime']);
    expect(requiredSteps({ changedFiles: FE })).toEqual(['frontend-build']);
    expect(requiredSteps({ changedFiles: [...BE, ...FE] })).toEqual(['backend-build', 'frontend-build', 'restart', 'uptime']);
    expect(requiredSteps({ changedFiles: ['packages/backend/package.json'] })).toEqual(['backend-install', 'backend-build', 'restart', 'uptime']);
    expect(requiredSteps({ changedFiles: BE, newEnvNames: ['X_ID'] })).toEqual(['backend-build', 'restart-env', 'uptime']);
    expect(requiredSteps({ changedFiles: ['docs/a.md'], hasEnvItem: true })).toEqual(['restart-env', 'uptime']);
    expect(requiredSteps({ changedFiles: ['docs/a.md', 'status/STATUS.md'] })).toEqual([]);
  });
});

describe('advanceDeployedHead', () => {
  const req = (files: string[], extra: any = {}) => requiredSteps({ changedFiles: files, ...extra });
  it('pull 출력만(확인 없음) = 안 오름', () => {
    expect(advanceDeployedHead(req(BE), []).advance).toBe(false);
  });
  it('백엔드만 = build + reload + uptime 이면 오름(프론트 빌드 「해당 없음」)', () => {
    expect(advanceDeployedHead(req(BE), ['backend-build', 'reload', 'uptime'])).toEqual({ advance: true, missing: [], problems: [] });
  });
  it('프론트만 = 프론트 build 면 오름', () => {
    expect(advanceDeployedHead(req(FE), ['frontend-build']).advance).toBe(true);
  });
  it('env 바뀐 범위 = reload 는 인정 안 함 · restart --update-env 면 오름', () => {
    const r = req(BE, { newEnvNames: ['X'] });
    const bad = advanceDeployedHead(r, ['backend-build', 'reload', 'uptime']);
    expect(bad.advance).toBe(false);
    expect(bad.problems.join()).toMatch(/update-env/);
    expect(advanceDeployedHead(r, ['backend-build', 'restart-env', 'uptime']).advance).toBe(true);
  });
  it('package.json 바뀜 = install 출력 없으면 안 오름 · install 이 build 뒤면 문제', () => {
    const r = req(['packages/backend/package.json']);
    expect(advanceDeployedHead(r, ['backend-build', 'reload', 'uptime']).missing).toContain('backend-install');
    expect(advanceDeployedHead(r, ['backend-build', 'backend-install', 'reload', 'uptime']).problems.join()).toMatch(/뒤에 왔다/);
    expect(advanceDeployedHead(r, ['backend-install', 'backend-build', 'reload', 'uptime']).advance).toBe(true);
  });
  it('재시작이 백엔드 build 보다 먼저 = 안 오름(옛 코드로 뜬 것)', () => {
    const out = advanceDeployedHead(req(BE), ['reload', 'uptime', 'backend-build']);
    expect(out.advance).toBe(false);
    expect(out.problems.join()).toMatch(/먼저/);
  });
  it('uptime 이 재시작 앞에만 있으면 빠진 것', () => {
    expect(advanceDeployedHead(req(BE), ['backend-build', 'uptime', 'reload']).missing).toEqual(['uptime']);
  });
  it('문서만 바뀐 범위 = 확인 없이 오름 · 모르는 꼬리표 = 문제', () => {
    expect(advanceDeployedHead([], []).advance).toBe(true);
    expect(advanceDeployedHead([], ['pm2-ok']).problems.join()).toMatch(/모르는/);
  });
});

describe('cardState · recomputeCards', () => {
  const anc = (set: string[]) => (c: string) => set.includes(c);
  it('세 값', () => {
    expect(cardState({ commits: ['a1'], isAncestor: anc([]), openItems: 0 }).state).toBe('배포 대기');
    expect(cardState({ commits: ['a1'], isAncestor: anc(['a1']), openItems: 2 }).text).toBe('코드 반영(a1) · 남은 단계 2');
    expect(cardState({ commits: ['a1'], isAncestor: anc(['a1']), openItems: 0 }).state).toBe('배포 완료');
    expect(cardState({ commits: [], isAncestor: anc([]), openItems: 0 }).text).toBe('배포 대기 · 미커밋');
  });
  it('커밋 둘 중 하나만 조상 + 열린 항목 0 = 「배포 대기 · 일부 반영 1/2」(완료 아님)', () => {
    const s = cardState({ commits: ['a1', 'b2'], isAncestor: anc(['a1']), openItems: 0 });
    expect([s.state, s.text]).toEqual(['배포 대기', '배포 대기 · 일부 반영 1/2']);
  });
  const ledger = (cardCommits: string, items: string) => parseLedger(
    `# 배포 원장\n\n## 머리\n\n- pulled_head: aaaaaa1 · x\n- deployed_head: aaaaaa1 · x\n\n## §0 카드\n\n| 카드 | 커밋 |\n|---|---|\n| C1 | ${cardCommits} |\n\n## §1 대기\n\n${items}`,
  );
  it('항목을 나중에 닫으면(원장 쓰기) 「코드 반영」 → 「배포 완료」', () => {
    const open = recomputeCards(ledger('aaaaaa1', '### X-1 · a\n- 카드: C1\n'), anc(['aaaaaa1']));
    const closed = recomputeCards(ledger('aaaaaa1', ''), anc(['aaaaaa1']));
    expect(open[0].state).toBe('코드 반영');
    expect(closed[0].state).toBe('배포 완료');
  });
  it('「배포 완료」 카드의 §0 에 미배포 커밋을 더하면(head · 항목 그대로) 「배포 대기 · 일부 반영 1/2」', () => {
    const before = recomputeCards(ledger('aaaaaa1', ''), anc(['aaaaaa1']));
    const after = recomputeCards(ledger('aaaaaa1 · bbbbbb2', ''), anc(['aaaaaa1']));
    expect(before[0].text).toBe('배포 완료');
    expect(after[0].text).toBe('배포 대기 · 일부 반영 1/2');
  });
});
