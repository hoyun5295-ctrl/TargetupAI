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
import { LOG_DIR, readMaskedSince } from './index';

const MAX_READ_BYTES = 2 * 1024 * 1024; // 파일 끝 2MB
const MAX_LINES = 1000;
const MAX_LINE_CHARS = 2000;

/**
 * 로그 파일 이름. ★2026-09-13(3) 크기 회전 파일(`sync-YYYY-MM-DD.log.1` · `.2` …)도 받는다(싱크 등재분 ⑨).
 * 하루 20MB를 넘으면 file-stream-rotator가 이름 뒤에 `.N`을 붙여 새 파일에 쓴다(FileStreamRotator.js `logfile + "." + fileCount`).
 * 종전 정규식은 그 파일을 못 보고 기본 파일의 옛 줄을 올렸다.
 */
const LOG_FILE_RE = /^sync-\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/;

/** logs/ 안에서 **가장 최근에 쓰인** sync 로그 파일 경로 (없으면 null) */
function latestLogFile(): string | null {
  try {
    let best: { file: string; mtime: number } | null = null;
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!LOG_FILE_RE.test(f)) continue;
      const full = path.join(LOG_DIR, f);
      const mtime = fs.statSync(full).mtimeMs;
      if (!best || mtime > best.mtime) best = { file: full, mtime };
    }
    return best ? best.file : null;
  } catch {
    return null;
  }
}

/** 파일 포맷 줄의 시각(`"timestamp":"YYYY-MM-DD HH:mm:ss.SSS"` · 로컬 시각)을 epoch ms로. 없으면 null */
function lineTime(line: string): number | null {
  const m = /"timestamp":"(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})"/.exec(line);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi, s, ms).getTime();
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
    // ★2026-09-13(3) 마스킹이 동작하는 빌드가 쓰기 시작한 시각 이전 줄은 올리지 않는다(싱크 등재분 ⑦ · index.ts `markMaskedSince`).
    //   새 빌드를 깐 당일 파일에는 옛 빌드(마스킹 미동작)가 쓴 원문 줄이 섞여 있다. 시각을 읽을 수 없는 줄도 올리지 않는다.
    const since = readMaskedSince();
    const all = buf.toString('utf8').split(/\r?\n/).filter((l) => {
      if (l.trim().length === 0) return false;
      const t = lineTime(l);
      return t !== null && t >= since;
    });
    return {
      file: path.basename(file),
      lines: all.slice(-n).map((l) => (l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS)}…` : l)),
    };
  } catch {
    return { file: path.basename(file), lines: [] };
  }
}
