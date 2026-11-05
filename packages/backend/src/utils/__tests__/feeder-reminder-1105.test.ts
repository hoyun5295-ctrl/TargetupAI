/**
 * ★2026-11-05 상시 로드 감축 · 피더 문서 분리 — 훅(scripts/hooks/feeder-reminder.mjs)이
 * 전문을 피더 문서로 옮긴 룰을 그 작업이 시작되는 순간 세션당 한 번 알리는가 · 실제로 배선돼 있는가.
 * 실제 스크립트를 node 로 띄워 훅 JSON 을 그대로 넣는다(Claude Code 가 하는 그대로).
 * Codex 1R: 옵션이 앞선 설치 명령 · html 수정 · 표식 뒤 출력 실패 = 빠짐 → 판정을 꼴 나열에서 뒤집음.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const HOOK = join(ROOT, 'scripts', 'hooks', 'feeder-reminder.mjs');
const PROJ = 'C:\\Users\\dev\\proj';
let dir = '';

const envOf = (projectDir: string | undefined) => {
  const env: Record<string, string | undefined> = { ...process.env, FEEDER_REMINDER_DIR: dir, CLAUDE_PROJECT_DIR: projectDir };
  if (projectDir === undefined) delete env.CLAUDE_PROJECT_DIR;
  return env as NodeJS.ProcessEnv;
};
function run(input: unknown, opts: { raw?: string; projectDir?: string | null } = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: opts.raw ?? JSON.stringify(input),
    env: envOf(opts.projectDir === null ? undefined : (opts.projectDir ?? PROJ)),
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout, ctx: r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string : '' };
}
const edit = (sid: string | undefined, file_path: string, tool = 'Edit') => ({ ...(sid ? { session_id: sid } : {}), tool_name: tool, tool_input: { file_path } });
const bash = (sid: string, command: string) => ({ session_id: sid, tool_name: 'Bash', tool_input: { command } });

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'feeder-reminder-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('피더 룰 알림 훅 · 파일 수정', () => {
  it('frontend 첫 수정 = Codex + 디자인 절 · 같은 세션 두 번째 = 조용', () => {
    const a = run(edit('s1', `${PROJ}\\packages\\frontend\\src\\pages\\A.tsx`));
    expect(a.code).toBe(0);
    expect(a.ctx).toContain('codex_review_after_code_change');
    expect(a.ctx).toContain('LESSONS_FRONTEND.md');
    const b = run(edit('s1', `${PROJ}\\packages\\frontend\\src\\pages\\B.tsx`, 'Write'));
    expect(b.code).toBe(0);
    expect(b.out).toBe('');
  });

  it('html · 설정 · 스크립트도 코드 = Codex(나열 밖 꼴도 빠지지 않는다) · frontend 밑이면 디자인 절도', () => {
    const html = run(edit('s1', `${PROJ}\\packages\\frontend\\index.html`));
    expect(html.ctx).toContain('codex_review_after_code_change');
    expect(html.ctx).toContain('LESSONS_FRONTEND.md');
    expect(run(edit('s2', `${PROJ}\\.claude\\settings.json`)).ctx).toContain('CODEX-RUNBOOK.md');
    const sh = run(edit('s3', 'c:/users/dev/proj/scripts/harness-check.sh'));   // 대소문자 · 슬래시가 달라도 같은 프로젝트
    expect(sh.ctx).toContain('codex_review_after_code_change');
    expect(sh.ctx).not.toContain('LESSONS_FRONTEND');
  });

  it('문서 · 프로젝트 밖 파일 = 조용', () => {
    expect(run(edit('s1', `${PROJ}\\docs\\FEATURE-JOURNEY.md`)).out).toBe('');
    expect(run(edit('s1', `${PROJ}\\packages\\frontend\\README.md`)).out).toBe('');
    expect(run(edit('s1', `${PROJ}\\docs\\staff-sheet.xlsx`)).out).toBe('');
    expect(run(edit('s1', 'C:\\Users\\dev\\AppData\\Local\\Temp\\scratch\\patch.py')).out).toBe('');
    expect(run(edit('s1', 'C:\\Users\\dev\\proj-other\\packages\\a.ts')).out).toBe('');   // 이름이 앞부분만 같은 다른 폴더
  });

  it('상대 경로 = 훅 입력 cwd 기준으로 붙여 판정(Codex 2R)', () => {
    const rel = (sid: string, file_path: string, cwd?: string) => run({ session_id: sid, ...(cwd ? { cwd } : {}), tool_name: 'Edit', tool_input: { file_path } });
    const a = rel('r1', 'packages/frontend/src/A.tsx', PROJ);
    expect(a.ctx).toContain('codex_review_after_code_change');
    expect(a.ctx).toContain('LESSONS_FRONTEND.md');
    expect(rel('r2', './scripts/x.sh', PROJ).ctx).toContain('codex');
    expect(rel('r3', 'packages\\backend\\src\\a.ts').ctx).toContain('codex');          // cwd 없음 = 프로젝트 폴더 기준
    expect(rel('r4', 'docs/a.md', PROJ).out).toBe('');
  });

  it('프로젝트 경로를 모르면 넓게 알린다(빠짐보다 오탐)', () => {
    expect(run(edit('s1', 'D:\\x\\y.py'), { projectDir: null }).ctx).toContain('codex');
  });
});

describe('피더 룰 알림 훅 · 명령', () => {
  const ext = (cmd: string, sid = 'b1') => run(bash(sid, cmd)).ctx.includes('external_code_adoption_gate');
  it('설치 · 복제 = 외부 코드 관문(옵션 · 경로 · .cmd · 환경 변수 · 이어 붙인 명령이 끼어도)', () => {
    expect(ext('cd packages/backend && npm install left-pad', 'b1')).toBe(true);
    expect(ext('npm --prefix packages/backend install left-pad', 'b2')).toBe(true);
    expect(ext('pnpm --filter frontend add zod', 'b3')).toBe(true);
    expect(ext('npx --yes skills add some/skill', 'b4')).toBe(true);
    expect(ext('"C:\\Program Files\\nodejs\\npm.cmd" i left-pad', 'b5')).toBe(true);
    expect(ext('FOO=1 npm i x', 'b6')).toBe(true);
    expect(ext('python -m pip install requests', 'b7')).toBe(true);
    expect(ext('ls; git clone https://example.invalid/r.git', 'b8')).toBe(true);
    expect(ext('claude plugin install x', 'b9')).toBe(true);
    expect(ext('npm \\\n  --prefix packages/backend \\\n  install left-pad', 'b10')).toBe(true);   // 줄 연속(Codex 2R)
    expect(ext('NPM INSTALL x', 'b11')).toBe(true);
  });
  it('그 밖 명령 = 조용', () => {
    for (const [i, c] of ['npm ci', 'npx vitest run', 'npm --prefix packages/backend run build', 'node scripts/x.mjs', 'git --no-optional-locks status'].entries()) {
      expect(run(bash(`q${i}`, c)).out).toBe('');
    }
  });
});

describe('피더 룰 알림 훅 · 표식', () => {
  it('session_id 가 없으면 매번 알린다', () => {
    expect(run(edit(undefined, `${PROJ}\\packages\\backend\\src\\a.ts`)).ctx).toContain('codex');
    expect(run(edit(undefined, `${PROJ}\\packages\\backend\\src\\a.ts`)).ctx).toContain('codex');
  });

  it('표식은 알림을 내보낸 뒤에 남는다 · 표식을 못 남기면 다음에 다시 알린다', () => {
    run(edit('m1', `${PROJ}\\packages\\backend\\src\\a.ts`));
    expect(existsSync(join(dir, 'm1.codex'))).toBe(true);
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, '');                                  // 표식 폴더 자리에 파일 → 폴더를 못 만든다
    const keep = dir;
    dir = join(blocker, 'sub');
    try {
      expect(run(edit('m2', `${PROJ}\\packages\\backend\\src\\a.ts`)).ctx).toContain('codex');
      expect(run(edit('m2', `${PROJ}\\packages\\backend\\src\\a.ts`)).ctx).toContain('codex');
    } finally { dir = keep; }
  });

  it('알림 내보내기가 실패하면(출력 파이프가 닫힘) 표식을 남기지 않고 다음 호출에서 다시 알린다', async () => {
    await new Promise<void>((resolve) => {
      const p = spawn(process.execPath, [HOOK], { env: envOf(PROJ) });
      p.stdout.destroy();                                        // 읽는 쪽을 먼저 닫는다 → 훅의 쓰기가 실패한다
      p.on('close', () => resolve());
      p.stdin.end(JSON.stringify(edit('e1', `${PROJ}\\packages\\backend\\src\\a.ts`)));
    });
    expect(existsSync(join(dir, 'e1.codex'))).toBe(false);
    expect(run(edit('e1', `${PROJ}\\packages\\backend\\src\\a.ts`)).ctx).toContain('codex_review_after_code_change');
  });

  it('병렬 두 호출 = 적어도 하나는 알린다(빠짐 0)', async () => {
    const one = () => new Promise<string>((resolve) => {
      const p = spawn(process.execPath, [HOOK], { env: envOf(PROJ) });
      let out = '';
      p.stdout.on('data', (c) => { out += c; });
      p.on('close', () => resolve(out));
      p.stdin.end(JSON.stringify(edit('p1', `${PROJ}\\packages\\backend\\src\\a.ts`)));
    });
    const outs = await Promise.all([one(), one()]);
    expect(outs.filter((o) => o.includes('codex_review_after_code_change')).length).toBeGreaterThanOrEqual(1);
  });

  it('깨진 입력 = 작업을 막지 않는다(종료 0 · 출력 0)', () => {
    const r = run(null, { raw: 'not json' });
    expect(r.code).toBe(0);
    expect(r.out).toBe('');
  });
});

describe('배선 · 포인터 계약', () => {
  it('settings.json PostToolUse 가 Edit · Write · Bash 에서 이 스크립트를 부른다', () => {
    const cfg = JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8'));
    const hit = (cfg.hooks.PostToolUse as any[]).filter((h) => h.hooks.some((x: any) => String(x.command).includes('scripts/hooks/feeder-reminder.mjs')));
    expect(hit).toHaveLength(1);
    for (const t of ['Edit', 'Write', 'Bash']) expect(hit[0].matcher.split('|')).toContain(t);
  });

  it('알림이 가리키는 피더 문서에 그 룰 전문 블록이 있다', () => {
    const has = (p: string, id: string) => existsSync(join(ROOT, p)) && readFileSync(join(ROOT, p), 'utf8').includes(`<RULE id="${id}"`);
    expect(has('status/CODEX-RUNBOOK.md', 'codex_review_after_code_change')).toBe(true);
    expect(has('status/lessons/LESSONS_FRONTEND.md', 'design_quality_minimum_ceiling_free')).toBe(true);
    expect(has('status/lessons/LESSONS_FRONTEND.md', 'marketing_user_ux_priority')).toBe(true);
    expect(has('status/COLLAB.md', 'external_code_adoption_gate')).toBe(true);
    expect(has('status/lessons/LESSONS_DB.md', 'db_column_verify_before_code')).toBe(true);
  });
});
