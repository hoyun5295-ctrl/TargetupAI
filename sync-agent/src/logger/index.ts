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

// ★ v1.6.1: report_logs 명령(logger/tail.ts)이 같은 경로를 읽도록 export (경로 상수 단일 소스)
export const LOG_DIR = path.resolve(process.cwd(), 'logs');

/**
 * 민감정보 마스킹 포맷
 *
 * ★2026-09-12 **한 번도 동작하지 않던 것을 살렸다.** 종전에는 `info.meta`만 마스킹했는데,
 *   호출부는 전부 `logger.info(메시지, { ... })` 형태이고 winston은 그 객체를 **info 최상위에 병합**한다.
 *   `info.meta`는 어디에서도 만들어지지 않아 마스킹이 늘 건너뛰어졌다(실행 확인: `password`가 평문 기록).
 *   같은 형태로 넘기는 호출이 소스 전체에 0건이었다 = 있으나 마나 한 안전망이었다.
 *
 * ⛔ **새 객체로 바꿔치지 않는다.** winston은 `Symbol.for('level')`·`Symbol.for('message')`·splat 같은
 *   심볼 키로 동작하는데, `Object.entries`로 만든 새 객체에는 그것들이 없어 transport가 깨진다.
 *   제자리에서 **값만** 바꾼다 = 키·구조·순서 무변경(로그를 줄 단위로 읽는 `tail.ts`도 영향 없다).
 * ⛔ 마스킹 대상은 `masking.ts`의 `SENSITIVE_KEYS`가 소유한다. 여기서 키 목록을 다시 만들지 않는다.
 */
const maskingFormat = winston.format((info) => {
  const masked = maskSensitiveData(info as unknown as Record<string, unknown>);
  for (const key of Object.keys(masked)) {
    (info as unknown as Record<string, unknown>)[key] = masked[key];
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
