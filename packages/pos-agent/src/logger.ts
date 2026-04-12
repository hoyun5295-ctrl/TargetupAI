/**
 * POS Agent 파일 로깅
 */

import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogPath(): string {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `agent-${today}.log`);
}

function rotateIfNeeded(logPath: string) {
  try {
    const stats = fs.statSync(logPath);
    if (stats.size > MAX_LOG_SIZE) {
      const rotated = logPath.replace('.log', `-${Date.now()}.log`);
      fs.renameSync(logPath, rotated);
    }
  } catch {}
}

function write(level: string, message: string, data?: any) {
  ensureLogDir();
  const logPath = getLogPath();
  rotateIfNeeded(logPath);

  const timestamp = new Date().toISOString();
  let line = `[${timestamp}] [${level}] ${message}`;
  if (data !== undefined) {
    line += ` ${typeof data === 'string' ? data : JSON.stringify(data)}`;
  }
  line += '\n';

  fs.appendFileSync(logPath, line, 'utf-8');

  // 콘솔에도 출력
  if (level === 'ERROR') console.error(line.trim());
  else console.log(line.trim());
}

export const logger = {
  info: (msg: string, data?: any) => write('INFO', msg, data),
  warn: (msg: string, data?: any) => write('WARN', msg, data),
  error: (msg: string, data?: any) => write('ERROR', msg, data),
  debug: (msg: string, data?: any) => write('DEBUG', msg, data),
};
