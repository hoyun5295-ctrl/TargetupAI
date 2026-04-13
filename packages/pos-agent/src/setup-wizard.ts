/**
 * ★ POS Agent 설치 마법사
 *
 * exe 첫 실행 시 또는 --setup 옵션으로 실행.
 * CLI 인터랙티브로 설정을 입력받아 agent-config.json 생성.
 *
 * 단계:
 *  1. 환영 + Agent Key 입력
 *  2. DB 종류 선택 (MSSQL / MySQL / SQLite)
 *  3. DB 연결 정보 입력
 *  4. 연결 테스트
 *  5. 서버 등록 테스트
 *  6. 설정 저장 + 완료
 */

import readline from 'readline';
import { saveConfig, loadConfig, AgentConfig } from './config';
import { testConnection, connect, disconnect } from './db-connector';
import { logger } from './logger';

// ============================================================
// 콘솔 스타일링 (ANSI 색상)
// ============================================================

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  // 색상
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  // 배경
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgCyan: '\x1b[46m',
};

function line(char = '─', len = 52): string {
  return char.repeat(len);
}

function box(lines: string[], color = C.cyan): string {
  const w = 50;
  const top = `${color}┌${line('─', w)}┐${C.reset}`;
  const bot = `${color}└${line('─', w)}┘${C.reset}`;
  const rows = lines.map(l => {
    const stripped = l.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, w - stripped.length);
    return `${color}│${C.reset} ${l}${' '.repeat(pad - 1)}${color}│${C.reset}`;
  });
  return [top, ...rows, bot].join('\n');
}

function step(num: number, total: number, title: string): void {
  const bar = Array.from({ length: total }, (_, i) =>
    i < num ? `${C.green}●${C.reset}` : `${C.dim}○${C.reset}`
  ).join(' ');
  console.log(`\n  ${bar}  ${C.bold}Step ${num}/${total}${C.reset} — ${title}\n`);
}

function success(msg: string): void {
  console.log(`  ${C.green}✓${C.reset} ${msg}`);
}

function fail(msg: string): void {
  console.log(`  ${C.red}✗${C.reset} ${msg}`);
}

function info(msg: string): void {
  console.log(`  ${C.cyan}ℹ${C.reset} ${msg}`);
}

// ============================================================
// readline 유틸
// ============================================================

let rl: readline.Interface;

function createRl(): void {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(question: string, defaultVal?: string): Promise<string> {
  const prompt = defaultVal
    ? `  ${C.white}${question}${C.reset} ${C.dim}(${defaultVal})${C.reset}: `
    : `  ${C.white}${question}${C.reset}: `;
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

function askPassword(question: string): Promise<string> {
  return new Promise(resolve => {
    const prompt = `  ${C.white}${question}${C.reset}: `;
    process.stdout.write(prompt);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();

    let password = '';
    const onData = (ch: Buffer) => {
      const c = ch.toString('utf8');
      if (c === '\n' || c === '\r') {
        if (stdin.setRawMode) stdin.setRawMode(wasRaw || false);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password);
      } else if (c === '\u007F' || c === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (c === '\u0003') {
        process.exit(0);
      } else {
        password += c;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function choose(question: string, options: Array<{ key: string; label: string }>): Promise<string> {
  console.log(`  ${C.white}${question}${C.reset}`);
  options.forEach((opt, i) => {
    console.log(`    ${C.cyan}${i + 1}${C.reset}) ${opt.label}`);
  });
  const answer = await ask('선택', '1');
  const idx = parseInt(answer) - 1;
  return (idx >= 0 && idx < options.length) ? options[idx].key : options[0].key;
}

// ============================================================
// 메인 마법사
// ============================================================

export async function runSetupWizard(): Promise<boolean> {
  createRl();
  const TOTAL_STEPS = 5;

  // ── 환영
  console.clear();
  console.log('\n' + box([
    '',
    `${C.bold}${C.cyan}   한줄전단 POS Agent${C.reset}`,
    `${C.bold}${C.cyan}   설치 마법사${C.reset}`,
    '',
    `${C.dim}   매장 POS 데이터를 자동으로 수집하여${C.reset}`,
    `${C.dim}   전단지 제작에 활용합니다.${C.reset}`,
    '',
    `${C.dim}   hanjul-flyer.kr${C.reset}`,
    '',
  ]));

  console.log(`\n  ${C.dim}Ctrl+C로 언제든 취소할 수 있습니다.${C.reset}`);

  try {
    // ── Step 1: Agent Key
    step(1, TOTAL_STEPS, 'Agent Key 입력');
    info('슈퍼관리자가 매장 등록 시 발급한 키를 입력하세요.');
    const agentKey = await ask('Agent Key (FPA-XXXXXXXX-...)');
    if (!agentKey || !agentKey.startsWith('FPA-')) {
      fail('Agent Key는 FPA-로 시작해야 합니다.');
      rl.close();
      return false;
    }
    success(`Agent Key: ${agentKey.slice(0, 12)}...`);

    // ── Step 2: DB 종류 선택
    step(2, TOTAL_STEPS, 'POS DB 종류 선택');
    info('매장에 설치된 POS 프로그램의 DB 종류를 선택하세요.');
    const dbType = await choose('DB 종류', [
      { key: 'mssql', label: `MS-SQL Server ${C.dim}(포스뱅크, OKPOS, 투게더스 등)${C.reset}` },
      { key: 'mysql', label: `MySQL ${C.dim}(일부 소형 POS)${C.reset}` },
      { key: 'sqlite', label: `SQLite ${C.dim}(파일 기반 POS)${C.reset}` },
    ]) as 'mssql' | 'mysql' | 'sqlite';
    success(`선택: ${dbType.toUpperCase()}`);

    // ── Step 3: DB 연결 정보
    step(3, TOTAL_STEPS, 'DB 연결 정보 입력');

    let dbConfig: any = { type: dbType };

    if (dbType === 'sqlite') {
      info('SQLite DB 파일 경로를 입력하세요.');
      info('예: C:\\POS\\data\\pos.db');
      dbConfig.filePath = await ask('DB 파일 경로');
      dbConfig.host = 'localhost';
      dbConfig.port = 0;
      dbConfig.database = '';
      dbConfig.username = '';
      dbConfig.password = '';
    } else {
      const defaultPort = dbType === 'mssql' ? '1433' : '3306';
      dbConfig.host = await ask('DB 호스트', 'localhost');
      dbConfig.port = parseInt(await ask('DB 포트', defaultPort));
      dbConfig.database = await ask('DB 이름');
      dbConfig.username = await ask('DB 사용자', dbType === 'mssql' ? 'sa' : 'root');
      dbConfig.password = await askPassword('DB 비밀번호');
    }

    success('연결 정보 입력 완료');

    // ── Step 4: 연결 테스트
    step(4, TOTAL_STEPS, '연결 테스트');

    // 임시 설정 저장 (testConnection이 config를 읽으므로)
    saveConfig({
      agentKey,
      db: dbConfig,
    } as Partial<AgentConfig>);

    // 설정 다시 로드
    loadConfig();

    info('DB 연결 테스트 중...');
    const testResult = await testConnection();

    if (!testResult.ok) {
      fail(`DB 연결 실패: ${testResult.error}`);
      console.log(`\n  ${C.yellow}DB 설정을 확인하고 다시 시도해주세요.${C.reset}`);
      console.log(`  ${C.dim}설정 파일: agent-config.json${C.reset}`);
      disconnect();
      rl.close();
      return false;
    }

    success('DB 연결 성공!');
    disconnect();

    // ── Step 5: 서버 연결 테스트
    step(5, TOTAL_STEPS, '서버 연결 확인');
    info('한줄전단 서버와 통신을 확인합니다...');

    try {
      const fetch = require('node-fetch');
      const config = loadConfig();
      const res = await fetch(`${config.serverUrl}/api/flyer/pos/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-key': agentKey,
        },
        body: JSON.stringify({ last_sync_at: new Date().toISOString() }),
      });

      if (res.ok) {
        success('서버 연결 성공!');
      } else if (res.status === 401) {
        fail('Agent Key가 유효하지 않습니다. 슈퍼관리자에게 확인하세요.');
        rl.close();
        return false;
      } else {
        fail(`서버 응답 오류: ${res.status}`);
        rl.close();
        return false;
      }
    } catch (err: any) {
      fail(`서버 연결 실패: ${err.message}`);
      console.log(`  ${C.yellow}인터넷 연결을 확인해주세요.${C.reset}`);
      rl.close();
      return false;
    }

    // ── 완료
    console.log('\n' + box([
      '',
      `${C.bold}${C.green}   설치 완료!${C.reset}`,
      '',
      `${C.white}   POS Agent가 정상적으로 설정되었습니다.${C.reset}`,
      `${C.white}   이제 Agent를 시작합니다...${C.reset}`,
      '',
      `${C.dim}   설정 변경: agent-config.json 수정 후 재시작${C.reset}`,
      '',
    ], C.green));

    rl.close();
    return true;

  } catch (err: any) {
    if (err.message === 'readline was closed') {
      console.log(`\n  ${C.yellow}설치가 취소되었습니다.${C.reset}`);
    } else {
      fail(`오류: ${err.message}`);
    }
    try { rl.close(); } catch {}
    return false;
  }
}

/**
 * 설정 파일이 없거나 agentKey가 비어있으면 마법사 실행 필요
 */
export function needsSetup(): boolean {
  try {
    const config = loadConfig();
    return !config.agentKey || config.agentKey === '';
  } catch {
    return true;
  }
}
