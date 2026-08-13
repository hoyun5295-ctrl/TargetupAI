/**
 * 콘솔 인코딩 자가 설정 (★ 2026-08-13 아난티) — "코드페이지가 실제로 바뀌는가"를 실콘솔로 고정한다.
 *
 * 왜 실행 검증인가: 처음 구현이 spawnSync에 windowsHide:true를 줬는데, 그 플래그는
 * CREATE_NO_WINDOW라 자식 chcp가 콘솔 없이 떠서 exit 0인데 코드페이지는 949 그대로였다.
 * 코드만 봐서는 통과처럼 보였고 실행해야만 잡혔다 — 그래서 이 테스트는 흉내(mock)가 아니라
 * 실제 cmd 콘솔에서 949로 시작해 65001로 바뀌는지를 본다.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { needsConsoleCodepageFix } from './console-encoding';

describe('needsConsoleCodepageFix — 플랫폼 판정(순수)', () => {
  it('Windows만 대상이다', () => {
    expect(needsConsoleCodepageFix('win32')).toBe(true);
    expect(needsConsoleCodepageFix('linux')).toBe(false);
    expect(needsConsoleCodepageFix('darwin')).toBe(false);
  });
});

describe.runIf(process.platform === 'win32')('ensureUtf8Console — 실콘솔 코드페이지 전환', () => {
  it('CP949 콘솔에서 실행하면 65001로 바뀐다', () => {
    // 새 cmd 콘솔을 949로 만들고, 그 안에서 ensureUtf8Console을 실행한 뒤 chcp를 읽는다.
    const script = [
      `const { ensureUtf8Console } = require(${JSON.stringify(path.resolve(__dirname, 'console-encoding.ts').replace(/\\/g, '/'))});`,
      `ensureUtf8Console();`,
      `const { execSync } = require('node:child_process');`,
      `process.stdout.write(execSync('chcp', { shell: 'cmd.exe' }).toString());`,
    ].join(' ');
    const tsxCmd = path.resolve(__dirname, '../../node_modules/.bin/tsx.cmd');
    const out = execSync(
      `cmd /c "chcp 949 >nul & "${tsxCmd}" -e ${JSON.stringify(script)}"`,
      { encoding: 'utf8', timeout: 60000 },
    );
    expect(out).toContain('65001');
  });
});
