/**
 * 로그 요청 명령(report_logs)의 tail 계약 (★2026-09-13(3) · 싱크 등재분 ⑦⑨)
 *
 *  ⑦ 마스킹이 동작하는 빌드가 쓰기 시작한 시각 이전 줄(옛 빌드의 원문 줄)은 올리지 않는다
 *  ⑨ 하루 20MB를 넘어 회전된 파일(`sync-YYYY-MM-DD.log.N`)이 있으면 그 파일을 읽는다(기본 파일의 옛 줄이 아니라)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
const line = (d: Date, message: string) => JSON.stringify({ level: 'info', message, timestamp: stamp(d) });

describe('readRecentLogLines', () => {
  let dir: string;
  let cwd: string;

  beforeEach(() => {
    cwd = process.cwd();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-tail-'));
    fs.mkdirSync(path.join(dir, 'logs'));
    process.chdir(dir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('기준 시각 이전 줄과 시각을 읽을 수 없는 줄은 올리지 않는다', async () => {
    const since = new Date(2026, 8, 13, 10, 0, 0, 0);
    fs.writeFileSync(path.join(dir, 'logs', '.masked-since'), String(since.getTime()));
    fs.writeFileSync(path.join(dir, 'logs', 'sync-2026-09-13.log'), [
      line(new Date(2026, 8, 13, 9, 59, 59, 999), '옛 빌드 원문 01000001234'),
      '시각 없는 줄',
      line(new Date(2026, 8, 13, 10, 0, 0, 0), '새 빌드 첫 줄'),
      line(new Date(2026, 8, 13, 10, 5, 0, 0), '새 빌드 둘째 줄'),
    ].join('\n'));
    const { readRecentLogLines } = await import('./tail');
    const r = readRecentLogLines(200);
    expect(r.lines.join('\n')).not.toContain('옛 빌드');
    expect(r.lines.join('\n')).not.toContain('시각 없는 줄');
    expect(r.lines).toHaveLength(2);
  });

  it('기준 파일이 없으면 이 프로세스 시작 이전 줄은 올리지 않는다', async () => {
    fs.writeFileSync(path.join(dir, 'logs', 'sync-2026-09-13.log'), [
      line(new Date(Date.now() - 60 * 60 * 1000), '한 시간 전 줄'),
    ].join('\n'));
    const { readRecentLogLines } = await import('./tail');
    const later = line(new Date(Date.now() + 1000), '지금 이후 줄');
    fs.appendFileSync(path.join(dir, 'logs', 'sync-2026-09-13.log'), `\n${later}`);
    const r = readRecentLogLines(200);
    expect(r.lines.join('\n')).not.toContain('한 시간 전');
    expect(r.lines.join('\n')).toContain('지금 이후');
  });

  it('크기 회전된 파일(.N)이 가장 최근에 쓰였으면 그 파일을 읽는다', async () => {
    fs.writeFileSync(path.join(dir, 'logs', '.masked-since'), '1');
    const base = path.join(dir, 'logs', 'sync-2026-09-13.log');
    const rotated = path.join(dir, 'logs', 'sync-2026-09-13.log.1');
    fs.writeFileSync(base, line(new Date(2026, 8, 13, 9, 0, 0, 0), '기본 파일 옛 줄'));
    fs.writeFileSync(rotated, line(new Date(2026, 8, 13, 23, 0, 0, 0), '회전 파일 최신 줄'));
    const old = new Date(2026, 8, 13, 9, 0, 0);
    fs.utimesSync(base, old, old);
    const { readRecentLogLines } = await import('./tail');
    const r = readRecentLogLines(200);
    expect(r.file).toBe('sync-2026-09-13.log.1');
    expect(r.lines.join('\n')).toContain('회전 파일 최신 줄');
  });

  it('기준 파일은 한 번만 만든다(재시작이 기준을 밀지 않는다) · 로거 초기화가 그 함수를 부른다', async () => {
    // 파일 전송을 여는 initLogger 대신 기준 함수를 직접 부른다(열린 로그 파일이 임시 폴더 정리를 막는다)
    const { markMaskedSince, readMaskedSince, MASKED_SINCE_FILE } = await import('./index');
    fs.rmSync(path.join(dir, 'logs'), { recursive: true, force: true });
    markMaskedSince();
    const first = fs.readFileSync(MASKED_SINCE_FILE, 'utf8');
    expect(Number(first)).toBeGreaterThan(0);
    fs.writeFileSync(MASKED_SINCE_FILE, '12345');
    markMaskedSince();
    expect(fs.readFileSync(MASKED_SINCE_FILE, 'utf8')).toBe('12345');
    expect(readMaskedSince()).toBe(12345);
    const src = fs.readFileSync(path.join(cwd, 'src', 'logger', 'index.ts'), 'utf8');
    const init = src.slice(src.indexOf('export function initLogger('), src.indexOf('rootLogger = winston.createLogger('));
    expect(init).toContain('markMaskedSince();');
  });
});
