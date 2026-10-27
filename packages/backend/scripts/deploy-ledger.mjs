// node scripts/deploy-ledger.mjs — 배포 원장 계산(★ 2026-10-27 설계서 §3 · 읽기 전용)
// 원장을 쓸 때마다 · 「배포 시작하자」 때 AI 가 돌린다. git 은 설계서 D4 의 읽기 세 명령(log · merge-base · status)만 부른다.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLedger, headHash, requiredSteps, advanceDeployedHead, recomputeCards, EVIDENCE } from './deploy-ledger-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const isAncestorOf = (head) => (commit) => {
  try { git('merge-base', '--is-ancestor', commit, head); return true; } catch { return false; }
};

const ledger = parseLedger(readFileSync(join(ROOT, 'status', 'DEPLOY-LEDGER.md'), 'utf8'));
const pulled = headHash(ledger.head['pulled_head']);
const deployed = headHash(ledger.head['deployed_head']);
if (!pulled || !deployed) throw new Error('원장 머리에 pulled_head · deployed_head 해시가 없다');

/** 범위의 바뀐 파일 · 새 process.env 이름 */
function rangeChanges(from, to) {
  if (from === to) return { commits: [], changedFiles: [], newEnvNames: [] };
  const commits = git('log', '--format=%h %s', `${from}..${to}`).split('\n').filter(Boolean);
  const changedFiles = [...new Set(git('log', '--name-only', '--format=', `${from}..${to}`).split('\n').filter(Boolean))];
  // 보수 쪽 판정: 범위 안에서 더한 줄에 나온 env 이름은 전부 「새 이름 후보」(지운 줄과 차감하지 않는다 · 여러 커밋이 같은 줄을 고치면
  // 새 이름이 차감으로 사라졌다 · Codex 구현 R1 #4). 과대 = restart --update-env 를 요구할 뿐(reload 와 같은 끊김 · env 를 다시 읽음).
  const patch = git('log', '-p', '--format=', `${from}..${to}`, '--', 'packages/backend/src');
  const added = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
  const newEnvNames = [...new Set([...added.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]))];
  return { commits, changedFiles, newEnvNames };
}

const hasEnvItem = ledger.items.some((it) => it.fields['단계'] === 'ENV');
const evidence = (ledger.head['이번 창 확인 출력'] || '').split(/[,\s·]+/).filter((t) => t && t !== '(없음)');
const dirty = git('--no-optional-locks', 'status', '--short').split('\n').filter(Boolean);
const notRunning = rangeChanges(deployed, pulled);
const toPull = rangeChanges(pulled, 'origin/main');

const print = (s = '') => console.log(s);
print(`[원장] 작업 트리 미커밋 ${dirty.length}파일${dirty.length ? ' · 다른 세션 tp-push 가 전부 실을 수 있다' : ''}`);
print(`[원장] 대기 항목 ${ledger.items.length} · DDL 블록 ${ledger.blocks.filter((b) => b.section === 'pending' && b.kind === 'ddl').length}`);
if (notRunning.commits.length) {
  const req = requiredSteps({ ...notRunning, hasEnvItem });
  const adv = advanceDeployedHead(req, evidence);
  print(`[받았지만 아직 안 도는 것] ${deployed}..${pulled} · 커밋 ${notRunning.commits.length}`);
  print(`  필요한 단계 = ${req.join(' → ') || '없음'}`);
  print(`  받은 확인 = ${evidence.join(' → ') || '없음'} · 올림 = ${adv.advance ? '가능(deployed_head = pulled_head)' : '아직'}`);
  if (adv.missing.length) print(`  빠진 단계 = ${adv.missing.join(', ')}`);
  for (const p of adv.problems) print(`  문제 = ${p}`);
}
const toPullSteps = requiredSteps({ ...toPull, hasEnvItem });
print(`[이번 pull 에 딸려 가는 것] ${pulled}..origin/main · 커밋 ${toPull.commits.length}`);
for (const c of toPull.commits) print(`  ${c}`);
print(`  필요한 단계 = ${toPullSteps.join(' → ') || '없음'}${toPullSteps.some((s) => s.startsWith('restart')) ? ' · 재시작 = 고객 화면 10~15초 끊김' : ''}`);
if (toPull.newEnvNames.length) print(`  새 env 이름 = ${toPull.newEnvNames.join(', ')}`);
print('[카드]');
for (const c of recomputeCards(ledger, isAncestorOf(deployed))) print(`  ${c.card} = ${c.text}`);
print(`(확인 꼬리표 = ${EVIDENCE.join(' · ')})`);
