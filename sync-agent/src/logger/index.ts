/**
 * 로깅 모듈 (winston 기반)
 *
 * - 콘솔 + 파일 동시 출력
 * - 일별 로테이션 (30일 보관)
 * - 민감정보 자동 마스킹
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import fs from 'node:fs';
import path from 'node:path';
import { maskSensitiveData } from './masking';

// ─── 포맷 ───────────────────────────────────────────────

// ★ v1.6.1: report_logs 명령(logger/tail.ts)이 같은 경로를 읽도록 export (경로 상수 단일 소스)
export const LOG_DIR = path.resolve(process.cwd(), 'logs');

/**
 * 마스킹이 동작하는 빌드가 이 설치에서 **처음** 로그를 쓰기 시작한 시각(★2026-09-13(3) · 싱크 등재분 ⑦).
 * 1.5.7·1.7.1은 마스킹이 동작하지 않던 빌드라, 새 빌드를 깐 당일 파일에는 그 전에 쓰인 원문 줄이 섞여 있다.
 * 로그 요청 명령(tail.ts)은 이 시각 이전 줄을 올리지 않는다.
 * ⛔ 이미 있으면 덮지 않는다(첫 기록 시각이 기준이다 · 재시작마다 덮으면 정상 줄까지 숨는다).
 */
export const MASKED_SINCE_FILE = path.join(LOG_DIR, '.masked-since');
const PROCESS_STARTED_AT = Date.now();

export function markMaskedSince(): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(MASKED_SINCE_FILE, String(PROCESS_STARTED_AT), { flag: 'wx' });
  } catch {
    // 이미 있거나 쓸 수 없다. 읽을 수 없으면 readMaskedSince가 이 프로세스 시작 시각으로 대신한다
  }
}

/** 기준 시각(epoch ms). 파일이 없거나 읽을 수 없으면 이 프로세스 시작 시각(이 빌드가 쓴 줄만 남는다) */
export function readMaskedSince(): number {
  try {
    const v = Number(fs.readFileSync(MASKED_SINCE_FILE, 'utf8').trim());
    return Number.isFinite(v) && v > 0 ? v : PROCESS_STARTED_AT;
  } catch {
    return PROCESS_STARTED_AT;
  }
}

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
export const maskingFormat = winston.format((info) => {
  const target = info as unknown as Record<string, unknown>;
  try {
    const masked = maskSensitiveData(target);
    for (const key of Object.keys(masked)) {
      target[key] = masked[key];
    }
  } catch {
    // ⛔ 마스킹이 실패해도 로그 호출이 예외를 던지면 안 된다(★2026-09-13). winston은 포맷 예외를 호출부로 다시 던지고,
    //   그 호출부 뒤에 등록 실패 시 로컬 모드 계속·오프라인 큐 저장이 있다. 원문을 흘리지도 않는다:
    //   메시지·레벨·모듈만 남기고 나머지 필드는 비운다.
    for (const key of Object.keys(target)) {
      if (key !== 'level' && key !== 'message' && key !== 'module') delete target[key];
    }
    target.maskError = 'masking_failed';
  }
  return info;
});

/** 콘솔 출력 포맷 */
export const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, module, ...rest }) => {
    const mod = module ? `[${module}]` : '';
    // ★2026-09-13 순환 참조가 남은 값이면 JSON.stringify가 던진다. 출력 한 줄 때문에 로그 호출이 죽지 않게 필드만 생략한다
    //   (파일 포맷은 winston json이 순환을 스스로 처리한다).
    let extra = '';
    if (Object.keys(rest).length > 0) {
      try {
        extra = ` ${JSON.stringify(rest)}`;
      } catch {
        extra = ' [직렬화할 수 없는 필드 생략]';
      }
    }
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
  markMaskedSince();

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
