/**
 * 빌드 판 검증 + 백엔드 자동 복구 감시 (★ 2026-11-11 · 뿌리 R88)
 *
 * 경위: 11-10 22:46 빌드가 dist/routes/billing.js 에 소스 원문 120줄이 끼어든 판을 냈고(같은 커밋 재빌드는 정상),
 *   옛 관문은 app.js · 폴더만 봐서 그대로 끼워졌다. 운영이 dist 를 직접 실행(11-10~)하므로 22:47 재시작에서 부팅 실패,
 *   pm2 errored 로 08:38 까지 정지. 처방 = 끼우기 전 판 검증(문법 + 두 번 빌드 대조) + 백엔드 밖 감시의 자동 되돌림.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync, statSync, utimesSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
// @ts-ignore — 빌드 밖 일반 스크립트(CommonJS)
import verifyDist from '../../../scripts/verify-dist.js';
// @ts-ignore — 빌드 밖 일반 스크립트(CommonJS)
import watchdog from '../../../scripts/backend-watchdog.js';
// @ts-ignore — pm2 설정(CommonJS)
import ecosystem from '../../../../../ecosystem.config.js';

const { checkSyntax, compareDirs, main } = verifyDist as any;
const { decide, PROVEN_UPTIME_MS, ALERT_EVERY_MS } = watchdog as any;

const BE = join(__dirname, '..', '..', '..');
const ROOT = join(BE, '..', '..');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

let tmp = '';
const mk = (name: string, files: Record<string, string>) => {
  const dir = join(tmp, name);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
};
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dist-gate-'));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const GOOD = '"use strict";\nexports.x = 1;\ntry {\n    f();\n}\ncatch (error) {\n    g();\n}\n';
// 11-10 사고 꼴 — 컴파일 결과 한가운데 소스 원문(형 표기)이 끼어든 줄
const LEAKED = '"use strict";\nasync function h() {\n    try {\n        await f();\n  } catch (error: any) {\n    g();\n  }\n}\n';

describe('판 검증 verify-dist — 문법', () => {
  it('정상 판 = 오류 0 · .js 만 센다(.map · .d.ts 는 문법 대상 아님)', () => {
    const d = mk('ok', { 'app.js': GOOD, 'routes/a.js': GOOD, 'routes/a.js.map': '{"not":"js"', 'routes/a.d.ts': 'export declare const x: number;' });
    expect(checkSyntax(d)).toEqual({ count: 2, errors: [] });
  });

  it('11-10 사고 꼴(소스 원문이 끼어든 .js) = 그 파일 · 그 줄을 짚는다', () => {
    const d = mk('leak', { 'app.js': GOOD, 'routes/billing.js': LEAKED });
    const r = checkSyntax(d);
    expect(r.count).toBe(2);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].file).toBe('routes/billing.js');
    expect(r.errors[0].line).toBe(5);
    expect(r.errors[0].message).toMatch(/Unexpected token/);
  });

  it('모듈 최상위 return · exports · require 는 node 가 읽는 포장 그대로라 오류가 아니다', () => {
    const d = mk('wrap', { 'a.js': 'const p = require("path");\nif (!p) return;\nmodule.exports = { p };\n' });
    expect(checkSyntax(d).errors).toEqual([]);
  });
});

describe('판 검증 verify-dist — 두 번 빌드 대조', () => {
  it('같은 두 판 = 어긋남 0', () => {
    const a = mk('s1', { 'app.js': GOOD, 'u/b.js': GOOD, 'u/b.js.map': '{}' });
    const b = mk('s2', { 'app.js': GOOD, 'u/b.js': GOOD, 'u/b.js.map': '{}' });
    expect(compareDirs(a, b)).toEqual({ count: 3, onlyA: [], onlyB: [], differ: [] });
  });

  it('한 파일 내용이 다르면 그 파일 · 한쪽에만 있는 파일도 양쪽 다 짚는다', () => {
    const a = mk('d1', { 'app.js': GOOD, 'u/b.js': GOOD, 'u/only-a.js': GOOD });
    const b = mk('d2', { 'app.js': GOOD, 'u/b.js': GOOD + '// x\n', 'u/only-b.js': GOOD });
    const r = compareDirs(a, b);
    expect(r.differ).toEqual(['u/b.js']);
    expect(r.onlyA).toEqual(['u/only-a.js']);
    expect(r.onlyB).toEqual(['u/only-b.js']);
  });

  it('문법은 맞지만 한 번만 달라진 산출물(글자 하나) = 대조가 잡는다 · 문법 검사만으로는 못 잡는다', () => {
    const a = mk('v1', { 'app.js': 'exports.rate = 10;\n' });
    const b = mk('v2', { 'app.js': 'exports.rate = 18;\n' });
    expect(checkSyntax(a).errors).toEqual([]);
    expect(compareDirs(a, b).differ).toEqual(['app.js']);
  });

  it('종료 코드 = 통과 0 · 문법 오류 1 · 두 판 다름 1 · 폴더 없음 1 · .js 없음 1', () => {
    const ok1 = mk('m1', { 'app.js': GOOD });
    const ok2 = mk('m2', { 'app.js': GOOD });
    const leak = mk('m3', { 'app.js': GOOD, 'routes/billing.js': LEAKED });
    const leak2 = mk('m4', { 'app.js': GOOD, 'routes/billing.js': LEAKED });
    const diff = mk('m5', { 'app.js': GOOD + '\n' });
    const empty = mk('m6', { 'readme.txt': 'x' });
    const quiet = <T>(fn: () => T): T => {
      const [e, l] = [console.error, console.log];
      console.error = () => {};
      console.log = () => {};
      try {
        return fn();
      } finally {
        console.error = e;
        console.log = l;
      }
    };
    expect(quiet(() => main([ok1, ok2]))).toBe(0);
    expect(quiet(() => main([ok1]))).toBe(0);
    expect(quiet(() => main([leak, leak2]))).toBe(1); // 두 판이 같아도 문법 오류면 실패
    expect(quiet(() => main([ok1, diff]))).toBe(1);
    expect(quiet(() => main([join(tmp, 'nope'), ok1]))).toBe(1);
    expect(quiet(() => main([ok1, join(tmp, 'nope')]))).toBe(1);
    expect(quiet(() => main([empty]))).toBe(1);
    expect(quiet(() => main([]))).toBe(1);
  });
});

describe('자동 복구 감시 backend-watchdog — 판정', () => {
  const NOW = 1_800_000_000_000;
  const DAY = 86_400_000;
  // 새 판 = 10분 전에 끼움 · 돌던 판 = 하루 전에 끼움
  const NEW = { id: 'new', installedAt: NOW - 600_000 };
  const OLD = { id: 'old', installedAt: NOW - DAY };
  const base = { distOld: { id: 'old' }, now: NOW };
  const PROVEN_OLD = { provenDistId: 'old' };
  /** 죽은 프로세스의 마지막 기동 = 새 판을 끼운 뒤(새 판으로 시작했다가 죽음) */
  const DIED_ON_NEW = { status: 'errored', startedAt: NOW - 300_000 };

  it('online = 느리든 방금 켜졌든 아무것도 하지 않는다(적재 중 발송을 끊지 않는다)', () => {
    for (const startedAt of [NOW - 1000, NOW - PROVEN_UPTIME_MS - 1, NOW - DAY]) {
      const r = decide({ ...base, proc: { status: 'online', startedAt }, dist: NEW, state: PROVEN_OLD });
      expect(r.action).toBe('none');
      expect(r.alert).toBeNull();
    }
  });

  it('사람이 멈춘 것(stopped) · 켜지는 중 · 내려가는 중 = 건드리지 않는다', () => {
    for (const status of ['stopped', 'launching', 'stopping', 'waiting restart', '']) {
      const r = decide({ ...base, proc: { status, startedAt: NOW - 300_000 }, dist: NEW, state: PROVEN_OLD });
      expect(r.action).toBe('none');
      expect(r.alert).toBeNull();
    }
  });

  it('돌던 판으로 적는 조건 = 이 프로세스가 그 판으로 시작(끼운 시각 <= 기동) + 5분 이상 online', () => {
    const proven = (dist: any, startedAt: number, state: any = {}) => decide({ ...base, proc: { status: 'online', startedAt }, dist, state }).state.provenDistId;
    expect(proven(OLD, NOW - PROVEN_UPTIME_MS)).toBe('old');
    expect(proven(OLD, NOW - PROVEN_UPTIME_MS + 1)).toBeNull(); // 5분 미만
    // 빌드만 하고 아직 다시 켜지 않은 새 판(끼운 시각이 기동보다 뒤) = 돌고 있는 것은 옛 판이다 — 새 판을 돌던 판으로 적지 않는다(Codex 1R)
    expect(proven(NEW, NOW - 3_600_000, PROVEN_OLD)).toBe('old');
    expect(proven(NEW, NOW - PROVEN_UPTIME_MS, PROVEN_OLD)).toBe('new'); // 새 판으로 시작해 5분 = 돌던 판이 바뀐다
  });

  it('11-10 사고 = 새 판으로 시작했다가 errored + dist-old 가 돌던 판 → 되돌림 · 경보', () => {
    const r = decide({ ...base, proc: DIED_ON_NEW, dist: NEW, state: PROVEN_OLD });
    expect(r.action).toBe('rollback');
    expect(r.alert).toMatch(/돌던 직전 판으로 되돌려/);
    expect(r.state.provenDistId).toBe('old');
  });

  it('되돌림 대상은 돌던 판 하나뿐 — dist-old 가 돌던 판이 아니면(본 적 없는 판 · 실패했을 수 있는 판) 되돌리지 않는다(Codex 2R)', () => {
    for (const distOld of [{ id: 'never-seen' }, null]) {
      const r = decide({ ...base, distOld, proc: DIED_ON_NEW, dist: NEW, state: PROVEN_OLD });
      expect(r.action).toBe('restart');
      expect(r.alert).toMatch(/되돌릴 돌던 판이 남아 있지 않아/);
    }
    // 감시를 막 설치해 돌던 판 기록이 아직 없다 = 되돌리지 않는다
    const fresh = decide({ ...base, proc: DIED_ON_NEW, dist: NEW, state: {} });
    expect(fresh.action).toBe('restart');
  });

  it('Codex 2R 순서 = B 실패(감시가 못 봄) → C 끼움 → C 도 실패: 실패했던 B(dist-old)로 되돌리지 않는다', () => {
    const tB = NOW - 900_000; // B 끼움
    const tC = NOW - 300_000; // C 끼움(dist-old = B · 돌던 판 A 는 빌드가 지움)
    const C = { id: 'C', installedAt: tC };
    // 1회차 — 죽은 프로세스는 B 로 시작했다(B 끼움 < 기동 < C 끼움) → C 는 아직 시도 전 → C 로 켜 본다
    const r1 = decide({ now: NOW, distOld: { id: 'B', installedAt: tB }, proc: { status: 'errored', startedAt: NOW - 600_000 }, dist: C, state: { provenDistId: 'A' } });
    expect(r1.action).toBe('restart');
    expect(r1.alert).toMatch(/죽은 뒤에 새 판이 끼워져 있어/);
    // 2회차 — C 로 시작했다가 죽음 · dist-old = B 는 돌던 판이 아니다 → 되돌리지 않는다
    const r2 = decide({ now: NOW + 60_000, distOld: { id: 'B', installedAt: tB }, proc: { status: 'errored', startedAt: NOW + 1000 }, dist: C, state: r1.state });
    expect(r2.action).toBe('restart');
    expect(r2.state.provenDistId).toBe('A');
  });

  it('돌던 판이 errored = 판 문제가 아님 → 되돌리지 않고 그대로 다시 켠다(되돌린 뒤에도 같다 = 판이 왔다 갔다 하지 않는다)', () => {
    const r = decide({ ...base, distOld: null, proc: { status: 'errored', startedAt: NOW - 1000 }, dist: OLD, state: PROVEN_OLD });
    expect(r.action).toBe('restart');
    expect(r.alert).toMatch(/판 문제로 보이지 않아/);
    // dist-old 에 다른 판이 있어도 돌던 판을 버리지 않는다
    expect(decide({ ...base, distOld: { id: 'x' }, proc: { status: 'errored', startedAt: NOW - 1000 }, dist: OLD, state: PROVEN_OLD }).action).toBe('restart');
  });

  it('죽은 뒤에 끼운 수리 판(끼운 시각 > 마지막 기동)은 되돌리지 않는다 — 그 판은 아직 시도된 적이 없다(Codex 1R)', () => {
    const fix = { id: 'fix', installedAt: NOW - 30_000 };
    const r = decide({ ...base, proc: DIED_ON_NEW, dist: fix, state: PROVEN_OLD });
    expect(r.action).toBe('restart'); // 수리 판으로 켜 본다
    expect(r.alert).toMatch(/죽은 뒤에 새 판이 끼워져 있어/);
  });

  it('같은 상태 경보 = 30분에 한 번 · 회복(online) 뒤 다시 죽으면 바로 알린다', () => {
    const errored = { ...base, proc: { status: 'errored', startedAt: NOW - 1000 }, dist: OLD };
    const a = decide({ ...errored, state: PROVEN_OLD });
    expect(a.alert).not.toBeNull();
    const b = decide({ ...errored, state: a.state, now: NOW + 60_000 });
    expect(b.action).toBe('restart');
    expect(b.alert).toBeNull();
    const c = decide({ ...errored, state: b.state, now: NOW + ALERT_EVERY_MS });
    expect(c.alert).not.toBeNull();
    const up = decide({ ...base, proc: { status: 'online', startedAt: NOW }, dist: OLD, state: c.state, now: NOW + ALERT_EVERY_MS + 60_000 });
    const d = decide({ ...errored, state: up.state, now: NOW + ALERT_EVERY_MS + 120_000 });
    expect(d.alert).not.toBeNull();
  });

  it('pm2 목록에 없음 = 손대지 않고 알리기만', () => {
    const r = decide({ ...base, proc: null, dist: NEW, state: PROVEN_OLD });
    expect(r.action).toBe('none');
    expect(r.alert).toMatch(/pm2 목록에/);
  });
});

describe('자동 복구 감시 backend-watchdog — 실행(가짜 pm2 · 실제 폴더 옮기기)', () => {
  // pm2 자리에 node 를 넣는다 — `node jlist` · `node restart <앱>` 이 작업 폴더의 같은 이름 파일을 실행한다.
  // jlist 는 부를 때마다 횟수를 세고, flipAfter 번째 뒤부터는 flip 값(그 사이 바뀐 상태)을 돌려준다.
  const JLIST = `const fs = require('fs');
const n = (fs.existsSync('jlist-calls.txt') ? Number(fs.readFileSync('jlist-calls.txt', 'utf8')) : 0) + 1;
fs.writeFileSync('jlist-calls.txt', String(n));
let s = JSON.parse(fs.readFileSync('pm2-state.json', 'utf8'));
if (s.flipAfter && n > s.flipAfter) s = s.flip;
process.stdout.write(JSON.stringify([{ name: 'other' }, { name: 'targetup-backend', pm2_env: { status: s.status, pm_uptime: s.startedAt } }]));`;
  const RESTART = `const fs = require('fs');
fs.appendFileSync('restarted.txt', process.argv[2] + '\\n');
fs.writeFileSync('pm2-state.json', JSON.stringify({ status: fs.existsSync('after-restart.txt') ? fs.readFileSync('after-restart.txt', 'utf8') : 'online', startedAt: Date.now() }));`;

  type Scene = { status: string; startedAt?: number; distOld?: boolean; proven?: 'old' | 'none'; flip?: { status: string; startedAt: number }; afterRestart?: string; markAt?: number };
  const scene = (name: string, o: Scene) => {
    // 기본 = 돌던 판(dist-old)이 기록돼 있고 · 새 판을 끼운 뒤에 시작했다가 죽음(기동 시각 = 지금 + 1분 · 판 파일은 방금 만든 것)
    const cwd = mk(name, {
      jlist: JLIST,
      restart: RESTART,
      'pm2-state.json': JSON.stringify({ status: o.status, startedAt: o.startedAt ?? Date.now() + 60_000, flipAfter: o.flip ? 1 : 0, flip: o.flip || null }),
      'be/dist/app.js': '// new\n',
      ...(o.distOld === false ? {} : { 'be/dist-old/app.js': '// old-build\n' }),
      ...(o.afterRestart ? { 'after-restart.txt': o.afterRestart } : {}),
    });
    const be = join(cwd, 'be');
    if (o.markAt) {
      writeFileSync(join(be, 'dist', '.installed'), '');
      utimesSync(join(be, 'dist', '.installed'), o.markAt / 1000, o.markAt / 1000);
    }
    let provenDistId: string | null = null;
    if (o.distOld !== false && o.proven !== 'none') {
      const st = statSync(join(be, 'dist-old', 'app.js'));
      provenDistId = `${st.size}-${Math.floor(st.mtimeMs)}`; // 감시기가 판을 부르는 이름과 같은 꼴
    }
    writeFileSync(join(cwd, 'state.json'), JSON.stringify(provenDistId ? { provenDistId } : {}));
    const r = spawnSync(process.execPath, [join(BE, 'scripts', 'backend-watchdog.js')], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, WATCHDOG_PM2: process.execPath, WATCHDOG_BACKEND_DIR: be, WATCHDOG_STATE: join(cwd, 'state.json'), OPS_ALERT: join(cwd, 'no-alert'), WATCHDOG_SETTLE_MS: '10' },
    });
    return {
      out: String(r.stdout) + String(r.stderr),
      code: r.status,
      dist: readFileSync(join(be, 'dist', 'app.js'), 'utf8'),
      failed: (readdirSync(be) as string[]).filter((f) => f.startsWith('dist-failed-')),
      hasDistOld: existsSync(join(be, 'dist-old')),
      hasMark: existsSync(join(be, 'dist', '.installed')),
      restarts: existsSync(join(cwd, 'restarted.txt')) ? readFileSync(join(cwd, 'restarted.txt'), 'utf8').trim().split('\n') : [],
      state: JSON.parse(readFileSync(join(cwd, 'state.json'), 'utf8')),
      provenDistId,
      failedBody: (dir: string) => readFileSync(join(be, dir, 'app.js'), 'utf8'),
    };
  };
  const untouched = (s: ReturnType<typeof scene>) => {
    expect(s.dist).toBe('// new\n');
    expect(s.failed).toEqual([]);
  };

  it('새 판 errored = 실패한 판을 dist-failed-* 로 옮기고 돌던 판을 dist 로 · 한 번 다시 켠다 · 결과를 알린다', () => {
    const s = scene('e2e-rollback', { status: 'errored' });
    expect(s.code).toBe(0);
    expect(s.dist).toBe('// old-build\n');
    expect(s.failed).toHaveLength(1);
    expect(s.failedBody(s.failed[0])).toBe('// new\n');
    expect(s.hasDistOld).toBe(false);
    expect(s.hasMark).toBe(true); // 되돌린 판에 끼운 시각 표식
    expect(s.restarts).toEqual(['targetup-backend']);
    expect(s.state.provenDistId).toBe(s.provenDistId);
    expect(s.out).toMatch(/돌던 직전 판으로 되돌려 다시 켭니다/);
    expect(s.out).toMatch(/rollback 뒤 상태 = online/);
    expect(s.out).toMatch(/직전 판으로 되돌려 정상 기동했습니다/);
  });

  it('되돌린 판도 못 뜨면 = 사람 조치 경보', () => {
    const s = scene('e2e-rollback-fail', { status: 'errored', afterRestart: 'errored' });
    expect(s.dist).toBe('// old-build\n');
    expect(s.out).toMatch(/되돌렸지만 상태가 errored/);
  });

  it('online = 폴더 · pm2 를 건드리지 않는다 · 출력도 없다', () => {
    const s = scene('e2e-online', { status: 'online' });
    expect(s.code).toBe(0);
    untouched(s);
    expect(s.hasDistOld).toBe(true);
    expect(s.restarts).toEqual([]);
    expect(s.out).toBe('');
  });

  it('사람이 멈춘 것(stopped) = 건드리지 않는다', () => {
    const s = scene('e2e-stopped', { status: 'stopped' });
    untouched(s);
    expect(s.restarts).toEqual([]);
    expect(s.out).toBe('');
  });

  it('판정 뒤 · 움직이기 전에 사람이 켰다(online) = 판도 pm2 도 건드리지 않는다(Codex 1R)', () => {
    const s = scene('e2e-recovered-meanwhile', { status: 'errored', flip: { status: 'online', startedAt: Date.now() + 120_000 } });
    untouched(s);
    expect(s.hasDistOld).toBe(true);
    expect(s.restarts).toEqual([]);
    expect(s.out).toMatch(/rollback 취소 — 판정 뒤 상태가 바뀜\(online\)/);
  });

  it('두 번 다 errored 여도 기동 시각이 다르면(그 사이 누가 켰다가 다시 죽음) 움직이지 않는다 — 판정한 그 죽음이 아니다(Codex 2R)', () => {
    const s = scene('e2e-other-death', { status: 'errored', flip: { status: 'errored', startedAt: Date.now() + 120_000 } });
    untouched(s);
    expect(s.hasDistOld).toBe(true);
    expect(s.restarts).toEqual([]);
    expect(s.out).toMatch(/rollback 취소 — 판정 뒤 상태가 바뀜\(errored\)/);
  });

  it('죽은 뒤에 끼운 판(마지막 기동이 판보다 앞) = 판을 옮기지 않고 그 판으로 다시 켠다', () => {
    const s = scene('e2e-fix-after-death', { status: 'errored', startedAt: Date.now() - 3_600_000 });
    untouched(s);
    expect(s.hasDistOld).toBe(true);
    expect(s.restarts).toEqual(['targetup-backend']);
  });

  it('끼운 시각은 표식(.installed)으로 읽는다 — app.js 는 기동보다 먼저 만들어졌어도 표식이 기동보다 뒤면 아직 시도 전인 판이다(Codex 1R #3 · 2R)', () => {
    // app.js 생성(지금) < 기동(지금 + 1분) < 끼움(지금 + 10분)
    const s = scene('e2e-mark-after-start', { status: 'errored', markAt: Date.now() + 600_000 });
    untouched(s);
    expect(s.hasDistOld).toBe(true);
    expect(s.restarts).toEqual(['targetup-backend']);
    expect(s.out).toMatch(/죽은 뒤에 새 판이 끼워져 있어/);
  });

  it('돌던 판 기록이 없다(감시를 막 설치) = 판은 그대로 두고 다시 켜기만', () => {
    const s = scene('e2e-no-proven', { status: 'errored', proven: 'none' });
    untouched(s);
    expect(s.hasDistOld).toBe(true);
    expect(s.restarts).toEqual(['targetup-backend']);
    expect(s.out).toMatch(/되돌릴 돌던 판이 남아 있지 않아/);
  });

  it('errored · 직전 판 없음 = 판은 그대로 두고 다시 켜기만', () => {
    const s = scene('e2e-no-old', { status: 'errored', distOld: false });
    untouched(s);
    expect(s.restarts).toEqual(['targetup-backend']);
  });
});

describe('R88 실행하는 대상을 바꿨는데 그 대상을 지키는 관문 · 복구가 따라오지 않는다', () => {
  // 대상은 손 등재가 아니라 pm2 설정에서 기계로 뽑는다 — 컴파일본(dist/)을 직접 실행하는 앱 전부.
  const eco = ecosystem as { apps: Array<{ name: string; script: string; cwd?: string }> };
  const distApps = eco.apps.filter((a) => /^dist\//.test(String(a.script)));
  const codeOf = (sh: string) =>
    sh
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');

  it('dist 를 직접 실행하는 앱이 뽑힌다(운영 백엔드 포함)', () => {
    expect(distApps.map((a) => a.name)).toContain('targetup-backend');
  });

  it('그 앱의 패키지마다 = safe-build 가 두 번 빌드하고 verify-dist 를 두 판으로 부른 뒤에만 끼운다', () => {
    for (const app of distApps) {
      const pkg = String(app.cwd || '').replace(/^.*\/targetup-app\//, '');
      expect(pkg, app.name).toMatch(/^packages\/[a-z-]+$/);
      const code = codeOf(read(join(ROOT, pkg, 'scripts', 'safe-build.sh')));
      const first = code.indexOf('npx tsc --outDir dist-new;');
      const second = code.indexOf('npx tsc --outDir dist-new2');
      const verify = code.indexOf('node scripts/verify-dist.js "$DIST_NEW" "$DIST_NEW2"');
      const swap = code.indexOf('mv "$DIST_NEW" "$DIST_DIR"');
      expect(first, app.name).toBeGreaterThan(-1);
      expect(second, app.name).toBeGreaterThan(first);
      expect(verify, app.name).toBeGreaterThan(second);
      expect(swap, app.name).toBeGreaterThan(verify);
      // 검증 실패 갈래 = 끼우기 전에 실패로 끝난다
      const failBranch = code.slice(verify - 'if ! '.length, swap);
      expect(failBranch, app.name).toMatch(/^if ! node scripts\/verify-dist\.js[^\n]*; then[\s\S]*?\n  exit 1\nfi/);
      // 판을 끼우는 mv 는 한 곳뿐(검증을 비켜 가는 다른 끼우기 없음)
      expect(code.split('mv "$DIST_NEW" "$DIST_DIR"').length - 1, app.name).toBe(1);
      expect(code.split(/mv [^\n]*"\$DIST_DIR"\n/).length - 1, app.name).toBe(1);
      expect(read(join(ROOT, pkg, 'scripts', 'verify-dist.js'))).toContain('Module.wrap');
    }
  });

  it('빌드와 감시는 같은 커널 잠금(flock · .dist.lock)을 쓴다 — 빌드 = 첫 빌드 전에 쥠 · 끼운 시각 표식은 끼운 뒤(Codex 1R · 2R)', () => {
    for (const app of distApps) {
      const pkg = String(app.cwd || '').replace(/^.*\/targetup-app\//, '');
      const code = codeOf(read(join(ROOT, pkg, 'scripts', 'safe-build.sh')));
      const lockDef = code.indexOf('DIST_LOCK="$BACKEND_DIR/.dist.lock"');
      const open = code.indexOf('exec 9>"$DIST_LOCK"');
      const take = code.indexOf('if ! flock -w "${DIST_LOCK_WAIT_S:-90}" 9; then');
      const first = code.indexOf('npx tsc --outDir dist-new;');
      const swap = code.indexOf('mv "$DIST_NEW" "$DIST_DIR"');
      const mark = code.indexOf('touch "$DIST_DIR/.installed"');
      expect(lockDef, app.name).toBeGreaterThan(-1);
      expect(open, app.name).toBeGreaterThan(lockDef);
      expect(take, app.name).toBeGreaterThan(open);
      expect(first, app.name).toBeGreaterThan(take);
      expect(mark, app.name).toBeGreaterThan(swap);
      // 잠금을 못 쥐면 · 서버(Linux)에 flock 이 없으면 = 빌드하지 않고 실패로 끝난다
      const lockBlock = code.slice(lockDef, first);
      expect(lockBlock, app.name).toMatch(/if ! flock -w [^\n]* 9; then\n[^\n]*\n    exit 1\n  fi/);
      expect(lockBlock, app.name).toMatch(/elif \[ "\$\(uname -s\)" = "Linux" \]; then\n[^\n]*\n  exit 1\nfi/);
      // 묵은 잠금을 지워서 걷는 코드는 없다(둘이 동시에 걷으면 둘 다 들어간다 · Codex 2R)
      expect(code, app.name).not.toMatch(/rm -rf "\$DIST_LOCK"|mkdir "\$DIST_LOCK"/);
    }
    const wd = read(join(BE, 'scripts', 'backend-watchdog.js'));
    expect(wd).toContain("const DIST_LOCK = path.join(BACKEND_DIR, '.dist.lock');");
    // 자기 자신을 flock 아래에서 다시 실행 — 못 쥐면 건너뜀(-n) · 잠금 파일을 자식에게 물려주지 않음(-o)
    expect(wd).toContain("spawnSync('flock', ['-n', '-o', '-E', String(LOCK_BUSY), DIST_LOCK, process.execPath, __filename]");
    expect(wd).toContain("if (process.env.WATCHDOG_LOCKED === '1') return run();");
    expect(wd).toContain('if (require.main === module) main();');
    expect(wd).not.toMatch(/rmSync\(DIST_LOCK|mkdirSync\(DIST_LOCK/);
    const mainBody = wd.slice(wd.indexOf('function main()'));
    // 서버(Linux)에 flock 이 없으면 잠금 없이 돌지 않는다
    expect(mainBody).toMatch(/if \(process\.platform === 'linux'\) \{[\s\S]*?process\.exitCode = 1;\s*return;\s*\}/);
    expect(wd).toContain("const INSTALLED_MARK = '.installed';");
    // 리허설 스크립트 = 개발 PC 에서 못 도는 두 가지(flock · 실제 pm2)를 서버에서 확인한다
    const reh = read(join(BE, 'scripts', 'dist-gate-rehearsal.sh'));
    for (const must of ['flock 8', 'pm2 start "$W/dist/app.js" --name "$APP"', 'pm2 delete "$APP"', 'backend-watchdog.js', 'safe-build.sh']) expect(reh).toContain(must);
    expect(reh).not.toMatch(/pm2 (delete|restart|stop|reload) (targetup-backend|"\$PROD"|all)/);
  });

  it('감시기는 판정이 고른 되돌림 · 다시 켜기 말고는 pm2 를 움직이지 않는다 · 움직이기 직전 errored 를 다시 확인한다', () => {
    const src = read(join(BE, 'scripts', 'backend-watchdog.js'));
    const runBody = src.slice(src.indexOf('function run()'));
    const gate = runBody.indexOf("if (d.action !== 'rollback' && d.action !== 'restart') return;");
    const recheck = runBody.indexOf("if (!again || again.status !== 'errored' || again.startedAt !== proc.startedAt) {");
    const rollbackAt = runBody.indexOf("if (d.action === 'rollback') {");
    const restartAt = runBody.indexOf("execFileSync(PM2, ['restart', APP]");
    expect(gate).toBeGreaterThan(-1);
    expect(recheck).toBeGreaterThan(gate);
    // 경보(지연될 수 있다)는 다시 확인하기 전에 보낸다 — 다시 확인과 움직임 사이에 느린 일이 없다
    expect(runBody.indexOf('if (d.alert) sendAlert(d.alert);')).toBeLessThan(recheck);
    expect(rollbackAt).toBeGreaterThan(recheck);
    expect(restartAt).toBeGreaterThan(rollbackAt);
    expect(src.split("execFileSync(PM2, ['restart'").length - 1).toBe(1);
    expect(runBody.indexOf('fs.renameSync(')).toBeGreaterThan(rollbackAt);
    // 판정 = errored 가 아니면 none(위 판정 시험이 값으로 본다) — 소스에도 그 한 줄이 있다
    expect(src).toContain("if (i.proc.status !== 'errored') return { action: 'none', alert: null, state };");
  });

  it('새 폴더(dist-new2 · dist-failed-* · .dist.lock)는 저장소에 올라가지 않는다', () => {
    const gi = read(join(ROOT, '.gitignore')).split('\n');
    expect(gi).toContain('dist-new2/');
    expect(gi).toContain('dist-failed-*/');
    expect(gi).toContain('.dist.lock');
  });
});
