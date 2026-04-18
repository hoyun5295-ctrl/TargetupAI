/**
 * 로깅 모듈 (winston 기반)
 *
 * - 콘솔 + 파일 동시 출력
 * - 일별 로테이션 (30일 보관)
 * - 민감정보 자동 마스킹
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'node:path';
import { maskSensitiveData } from './masking';

// ─── 포맷 ───────────────────────────────────────────────

const LOG_DIR = path.resolve(process.cwd(), 'logs');

/** 민감정보 마스킹 포맷 */
const maskingFormat = winston.format((info) => {
  // meta 객체 내 민감정보 마스킹
  if (info.meta && typeof info.meta === 'object') {
    info.meta = maskSensitiveData(info.meta as Record<string, unknown>);
  }
  return info;
});

/** 콘솔 출력 포맷 */
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, module, ...rest }) => {
    const mod = module ? `[${module}]` : '';
    const extra = Object.keys(rest).length > 0
      ? ` ${JSON.stringify(rest)}`
      : '';
    return `${timestamp} ${level} ${mod} ${message}${extra}`;
  }),
);

/** 파일 출력 포맷 */
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.json(),
);

// ─── 로거 생성 ──────────────────────────────────────────

export interface LoggerConfig {
  level?: string;
  maxFiles?: number;
  maxSize?: string;
}

let rootLogger: winston.Logger | null = null;

/**
 * 루트 로거를 초기화합니다.
 * 애플리케이션 시작 시 1회 호출.
 */
export function initLogger(config: LoggerConfig = {}): winston.Logger {
  const { level = 'info', maxFiles = 30, maxSize = '20m' } = config;

  rootLogger = winston.createLogger({
    level,
    format: winston.format.combine(
      maskingFormat(),
      winston.format.errors({ stack: true }),
    ),
    transports: [
      // 콘솔
      new winston.transports.Console({
        format: consoleFormat,
      }),
      // 일별 로테이션 파일
      new DailyRotateFile({
        dirname: LOG_DIR,
        filename: 'sync-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxFiles: `${maxFiles}d`,
        maxSize,
        format: fileFormat,
      }),
      // 에러 전용 파일
      new DailyRotateFile({
        dirname: LOG_DIR,
        filename: 'error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxFiles: `${maxFiles}d`,
        maxSize,
        format: fileFormat,
      }),
    ],
  });

  return rootLogger;
}

/**
 * 모듈별 하위 로거를 생성합니다.
 * @param moduleName 모듈명 (예: 'db', 'sync', 'api')
 */
export function getLogger(moduleName: string): winston.Logger {
  if (!rootLogger) {
    initLogger(); // 초기화 안 됐으면 기본값으로
  }

  return rootLogger!.child({ module: moduleName });
}

export { maskSensitiveData, maskPhone, maskEmail, maskApiKey } from './masking';
