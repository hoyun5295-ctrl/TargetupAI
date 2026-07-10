/**
 * 로그 tail 유틸 (v1.6.1 — 원격 report_logs 명령용, 2026-07-10 원격 관리 전수 점검 P2-7)
 *
 * 최신 로그 파일(sync-YYYY-MM-DD.log — winston DailyRotateFile)의 마지막 N줄을 읽는다.
 * 원격 지원(TeamViewer) 없이 슈퍼관리자가 에이전트 로그를 열람하는 유일한 통로.
 * 파일은 이미 masking.ts로 민감정보가 마스킹된 상태로 기록된다 — 추가 마스킹 불요.
 *
 * 부하 가드: 파일 끝 최대 2MB만 읽고, 줄 수 상한 1000·줄 길이 상한 2000자로 자른다
 * (heartbeat 본문에 실려 가므로 payload 폭주 차단).
 */

import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR } from './index';

const MAX_READ_BYTES = 2 * 1024 * 1024; // 파일 끝 2MB
const MAX_LINES = 1000;
const MAX_LINE_CHARS = 2000;

/** logs/ 안 최신 sync-*.log 경로 (없으면 null) */
function latestLogFile(): string | null {
  try {
    const files = fs
      .readdirSync(LOG_DIR)
      .filter((f) => /^sync-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort(); // 파일명 날짜 포맷이라 사전순 = 시간순
    if (files.length === 0) return null;
    return path.join(LOG_DIR, files[files.length - 1]);
  } catch {
    return null;
  }
}

/**
 * 최신 로그 파일 마지막 N줄 반환. 파일 없음/읽기 실패 = 빈 배열.
 * @param lines 요청 줄 수 (10~1000으로 클램프)
 */
export function readRecentLogLines(lines: number): { file: string | null; lines: string[] } {
  const n = Math.max(10, Math.min(MAX_LINES, Math.floor(Number(lines)) || 200));
  const file = latestLogFile();
  if (!file) return { file: null, lines: [] };
  try {
    const stat = fs.statSync(file);
    const readBytes = Math.min(stat.size, MAX_READ_BYTES);
    const buf = Buffer.alloc(readBytes);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buf, 0, readBytes, stat.size - readBytes);
    } finally {
      fs.closeSync(fd);
    }
    const all = buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim().length > 0);
    return {
      file: path.basename(file),
      lines: all.slice(-n).map((l) => (l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS)}…` : l)),
    };
  } catch {
    return { file: path.basename(file), lines: [] };
  }
}
