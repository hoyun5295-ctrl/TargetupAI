// feeder-reminder.mjs — 전문을 피더 문서로 옮긴 CLAUDE.md 룰을, 그 룰이 걸리는 작업이 시작되는 순간 알린다.
// ★2026-11-05 Harold 「상시 로드 대폭 줄이기 · 피더 문서로 분리 · 필요하면 바로 피더 문서 확인」.
// 쓰임 = .claude/settings.json PostToolUse 훅(Edit · Write · MultiEdit · Bash). 입력 = 훅 JSON(stdin).
// 갈래마다 세션당 한 번만 알린다(같은 말을 매 수정마다 넣으면 줄인 상시 로드를 다시 먹는다).
// 빠짐이 오탐보다 나쁘다(빠지면 「분리 = 미적용」) — 그래서:
//   · 코드 = 「프로젝트 안의 문서가 아닌 파일 전부」(확장자를 나열하지 않는다 · 나열은 새 꼴을 늘 놓친다 · Codex 1R)
//   · frontend = 그 코드 중 packages/frontend 밑(코드 판정과 갈라질 수 없게 같은 판정에서 나온다)
//   · 설치 = 명령 글자에 도구 이름과 설치 동사가 단어로 함께 있다(옵션 · 경로 · .cmd · 줄 연속이 끼어도 · Codex 1R · 2R)
//   · 상대 경로 = 훅 입력 cwd 기준으로 붙여 판정(Codex 2R)
//   · 표식 = 알림을 내보낸 뒤에만 남긴다(내보내기 실패 = 다음에 다시 알림) · 병렬이면 두 번 갈 수 있다(빠짐보다 낫다)
//   · session_id 를 못 읽으면 매번 알린다 · 입력이 깨지면 출력 0 · 종료 0(훅은 작업을 막지 않는다)
// DB 컬럼 룰은 settings.json 의 기존 routes · utils 훅이 알린다(여기서 두 번 말하지 않는다).
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const DOC_FILE = /\.(md|markdown|txt|csv|tsv|xlsx|xls|docx|doc|pptx|pdf|png|jpe?g|gif|webp|ico)$/i;
const INSTALL_VERBS = {
  npm: ['install', 'i', 'add'], pnpm: ['install', 'i', 'add'], yarn: ['install', 'add'], bun: ['install', 'i', 'add'],
  pip: ['install'], pip3: ['install'], uv: ['add', 'install'], git: ['clone'],
  claude: ['plugin', 'mcp'], npx: ['skills', 'skill', '-y', '--yes'],
};

const MESSAGES = {
  codex: '[피더 룰 codex_review_after_code_change] 이 세션에 코드 변경이 생겼다 = 작업 종결 직전 Codex 적대 리뷰 approve 까지. 첫 요청문을 쓰기 전에 status/CODEX-RUNBOOK.md §0-0 · §1 · §2 를 연다.',
  frontend: '[피더 룰 design_quality_minimum_ceiling_free · marketing_user_ux_priority] frontend 수정 = status/lessons/LESSONS_FRONTEND.md 「디자인 최소 기준」 절(룰 전문 + 체크리스트)을 연다 · 수정 뒤 모델명 노출 grep(no_model_name_ui_exposure) · native dialog 0.',
  external: '[피더 룰 external_code_adoption_gate] 설치 · 복제 명령 = 외부 코드 접목이면 접목 전에 status/COLLAB.md §4 대로 네트워크 · 비밀값 · 자동 실행 grep 증거를 보고하고 Harold님 동의 전 접목 0.',
};

const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

// 설치 = 명령 글자에 「도구 이름」과 「그 도구의 설치 동사」가 단어로 함께 있다(위치 · 구분자 · 줄 연속 · 옵션을 보지 않는다).
// 셸 문장을 손으로 해석하면 새 꼴이 늘 빠진다(Codex 1R 옵션 · 2R 줄 연속) — 설치라면 반드시 참인 조건만 본다. 넓은 만큼 오탐은 세션당 한 번.
const hasWord = (text, w) => {
  for (let i = text.indexOf(w); i !== -1; i = text.indexOf(w, i + 1)) {
    const before = i === 0 ? '' : text[i - 1];
    const after = text[i + w.length] ?? '';
    if (!/[a-z0-9_-]/.test(before) && !/[a-z0-9_-]/.test(after)) return true;
  }
  return false;
};
function isInstallCommand(cmd) {
  const text = String(cmd).toLowerCase();
  return Object.entries(INSTALL_VERBS).some(([tool, verbs]) => hasWord(text, tool) && verbs.some((v) => hasWord(text, v)));
}

// 상대 경로 = 훅 입력의 cwd(없으면 프로젝트 폴더) 기준으로 붙인다 · 기준도 없으면 그대로(넓게 판정된다).
// ponytail: '..' 는 접지 않는다 — Edit · Write 는 절대 경로를 넘기고, 상대 경로는 드문 꼴이다.
const isAbs = (p) => /^([a-z]:)?\//i.test(p);
function absPath(p, base) {
  const f = norm(p).replace(/^(\.\/)+/, '');
  return isAbs(f) || !base ? f : norm(base) + '/' + f;
}

// 훅 입력 하나 → 알릴 갈래 키 목록(세션당 한 번 거르기 전)
function reminderKeys(input, projectDir) {
  const keys = [];
  const tool = input?.tool_name;
  const ti = input?.tool_input ?? {};
  if (EDIT_TOOLS.has(tool) && typeof ti.file_path === 'string') {
    const f = absPath(ti.file_path, input?.cwd || projectDir);
    const root = projectDir ? norm(projectDir) + '/' : '';
    const inProject = root ? f.startsWith(root) : true;   // 프로젝트 경로를 모르면 넓게(빠짐보다 오탐)
    if (inProject && !DOC_FILE.test(f)) {
      keys.push('codex');
      if (root ? f.startsWith(root + 'packages/frontend/') : f.includes('/packages/frontend/')) keys.push('frontend');
    }
  }
  if (tool === 'Bash' && typeof ti.command === 'string' && isInstallCommand(ti.command)) keys.push('external');
  return keys;
}

{
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(raw);
      const dir = process.env.FEEDER_REMINDER_DIR || join(tmpdir(), 'hanjul-feeder-reminder');
      const sid = String(input.session_id ?? '').replace(/[^A-Za-z0-9_-]/g, '');
      const mark = (k) => join(dir, `${sid}.${k}`);
      const keys = reminderKeys(input, process.env.CLAUDE_PROJECT_DIR).filter((k) => !sid || !existsSync(mark(k)));
      if (!keys.length) process.exit(0);
      const out = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: keys.map((k) => MESSAGES[k]).join(' ') } });
      process.stdout.write(out, (err) => {
        // ponytail: 표식 파일은 지우지 않는다(세션당 최대 3개 · 0바이트) · 쌓이는 게 문제가 되면 오래된 것 정리를 붙인다.
        if (!err && sid) { try { mkdirSync(dir, { recursive: true }); for (const k of keys) writeFileSync(mark(k), ''); } catch { /* 표식 실패 = 다음에 다시 알림 */ } }
        process.exit(0);
      });
    } catch (e) {
      process.stderr.write(`[feeder-reminder] ${e?.message ?? e}\n`);   // 훅은 작업을 막지 않는다
      process.exit(0);
    }
  });
}
