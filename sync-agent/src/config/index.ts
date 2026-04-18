/**
 * 설정 로드/저장 관리
 *
 * 우선순위:
 *   1. 환경변수 (.env)                    — 개발/테스트용
 *   2. 암호화된 설정 (data/config.enc)     — 프로덕션 (agent.key로 복호화)
 *   3. 평문 설정 (data/config.json)        — 설치 마법사 직후 (자동 마이그레이션 대상)
 *
 * 보안 흐름:
 *   설치 마법사 → config.enc + agent.key 생성 (평문 JSON 저장 안 함)
 *   Agent 시작 → agent.key 로드 → config.enc 복호화 → 실행
 *   기존 config.json 발견 시 → 자동으로 config.enc로 마이그레이션 + json 삭제
 *
 * 변경사항 (2026-02-11):
 *   - 암호화 키 자동 로드 (data/agent.key)
 *   - config.json → config.enc 자동 마이그레이션
 *   - saveConfigEncrypted(): 마법사에서 직접 암호화 저장
 *
 * 변경사항 (2026-02-25):
 *   - loadConfigDecrypted(): config.enc 복호화 → AgentConfig 반환 (edit-config용)
 *   - updateConfigEncrypted(): 부분 수정 후 재암호화 저장 (edit-config용)
 */

import fs from 'node:fs';
import path from 'node:path';
import { AgentConfigSchema, type AgentConfig, DEFAULT_DB_PORTS } from './schema';
import {
  encrypt,
  decrypt,
  loadKey,
  loadOrCreateKey,
  hasKeyFile,
  migrateJsonToEncrypted,
} from './encryption';
import { ZodError } from 'zod';

// ─── 경로 상수 ──────────────────────────────────────────

const DATA_DIR = path.resolve(process.cwd(), 'data');
const CONFIG_ENC_PATH = path.join(DATA_DIR, 'config.enc');
const CONFIG_JSON_PATH = path.join(DATA_DIR, 'config.json');

// ─── 설정 소스 타입 ─────────────────────────────────────

export type ConfigSource = 'env' | 'encrypted' | 'json' | 'none';

export interface LoadConfigResult {
  config: AgentConfig;
  source: ConfigSource;
}

// ─── 설정 파일 존재 여부 확인 ────────────────────────────

/**
 * 사용 가능한 설정이 있는지 확인합니다.
 * main.ts에서 설정 없으면 자동으로 마법사를 실행하는 데 사용.
 */
export function hasConfigFile(): { exists: boolean; source: ConfigSource } {
  if (hasEnvConfig()) {
    return { exists: true, source: 'env' };
  }
  if (fs.existsSync(CONFIG_ENC_PATH) && hasKeyFile()) {
    return { exists: true, source: 'encrypted' };
  }
  if (fs.existsSync(CONFIG_JSON_PATH)) {
    return { exists: true, source: 'json' };
  }
  return { exists: false, source: 'none' };
}

/**
 * 환경변수에 최소 필수 설정이 있는지 확인
 */
function hasEnvConfig(): boolean {
  return !!(
    process.env.SYNC_API_KEY &&
    process.env.SYNC_API_SECRET &&
    process.env.DB_HOST &&
    process.env.DB_NAME
  );
}

// ─── 설정 로드 ──────────────────────────────────────────

/**
 * 설정을 로드하고 검증합니다.
 * 암호화 키는 data/agent.key에서 자동 로드.
 *
 * config.json이 있고 config.enc가 없으면 → 자동 마이그레이션
 */
export function loadConfig(): LoadConfigResult {
  let rawConfig: Record<string, unknown>;
  let source: ConfigSource;

  // 0) config.json → config.enc 자동 마이그레이션
  if (fs.existsSync(CONFIG_JSON_PATH) && !fs.existsSync(CONFIG_ENC_PATH)) {
    const migrated = migrateJsonToEncrypted();
    if (migrated) {
      // 마이그레이션 성공 → enc로 로드
    }
  }

  // 1) 환경변수 — .env가 있고 필수 값이 세팅되어 있으면 우선 (개발/테스트용)
  if (hasEnvConfig()) {
    rawConfig = buildConfigFromEnv();
    source = 'env';
  }
  // 2) 암호화된 설정 파일 (프로덕션)
  else if (fs.existsSync(CONFIG_ENC_PATH)) {
    const encryptionKey = loadKey();
    if (!encryptionKey) {
      throw new Error(
        '암호화된 설정(config.enc)이 있지만 키 파일(agent.key)을 찾을 수 없습니다.\n' +
        'data/agent.key 파일이 삭제되었거나 이동되었습니다.\n' +
        'sync-agent --setup 으로 재설정해주세요.'
      );
    }

    try {
      const ciphertext = fs.readFileSync(CONFIG_ENC_PATH, 'utf8');
      const plaintext = decrypt(ciphertext, encryptionKey);
      rawConfig = JSON.parse(plaintext);
      source = 'encrypted';
    } catch (error) {
      throw new Error(
        '설정 파일 복호화 실패 — 키가 일치하지 않거나 파일이 손상되었습니다.\n' +
        'sync-agent --setup 으로 재설정해주세요.'
      );
    }
  }
  // 3) 평문 설정 파일 (마이그레이션 실패 시 폴백)
  else if (fs.existsSync(CONFIG_JSON_PATH)) {
    const content = fs.readFileSync(CONFIG_JSON_PATH, 'utf8');
    rawConfig = JSON.parse(content);
    source = 'json';

    if (rawConfig.mapping === undefined) {
      rawConfig.mapping = { customers: {}, purchases: {} };
    }
  }
  // 4) 설정 없음
  else {
    throw new Error(
      '설정을 찾을 수 없습니다.\n' +
      '다음 중 하나를 준비해주세요:\n' +
      '  1. sync-agent --setup 으로 설치 마법사 실행\n' +
      '  2. .env 파일에 환경변수 설정\n' +
      '  3. data/config.json 직접 작성'
    );
  }

  // Zod 검증
  try {
    const config = AgentConfigSchema.parse(rawConfig);
    return { config, source };
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues.map(
        (i) => `  - ${i.path.join('.')}: ${i.message}`
      ).join('\n');
      throw new Error(
        `설정 검증 실패 (소스: ${source}):\n${issues}\n\n` +
        'sync-agent --setup 으로 설치 마법사를 다시 실행해주세요.'
      );
    }
    throw error;
  }
}

// ─── 설정 복호화 (edit-config용) ────────────────────────

/**
 * config.enc를 복호화하여 AgentConfig 객체로 반환합니다.
 * --edit-config에서 현재 설정을 읽을 때 사용.
 *
 * @throws config.enc/agent.key가 없거나 복호화 실패 시
 */
export function loadConfigDecrypted(): AgentConfig {
  if (!fs.existsSync(CONFIG_ENC_PATH)) {
    throw new Error(
      'config.enc 파일이 없습니다.\n' +
      'sync-agent --setup 으로 먼저 설치를 진행해주세요.'
    );
  }

  const encryptionKey = loadKey();
  if (!encryptionKey) {
    throw new Error(
      'agent.key 파일이 없습니다.\n' +
      'data/agent.key 파일이 삭제되었거나 이동되었습니다.'
    );
  }

  const ciphertext = fs.readFileSync(CONFIG_ENC_PATH, 'utf8');
  const plaintext = decrypt(ciphertext, encryptionKey);
  const rawConfig = JSON.parse(plaintext);

  return AgentConfigSchema.parse(rawConfig);
}

/**
 * 기존 config.enc를 부분 수정하여 재암호화 저장합니다.
 * --edit-config에서 수정된 config를 저장할 때 사용.
 *
 * @param updater 현재 config를 받아서 수정된 config를 반환하는 함수
 * @returns 저장된 config
 */
export function updateConfigEncrypted(
  updater: (current: AgentConfig) => AgentConfig
): AgentConfig {
  const current = loadConfigDecrypted();
  const updated = updater(current);

  // Zod 재검증
  const validated = AgentConfigSchema.parse(updated);

  // 재암호화 저장
  const key = loadKey();
  if (!key) {
    throw new Error('agent.key를 찾을 수 없습니다.');
  }

  const plaintext = JSON.stringify(validated, null, 2);
  const ciphertext = encrypt(plaintext, key);
  fs.writeFileSync(CONFIG_ENC_PATH, ciphertext, 'utf8');

  return validated;
}

// ─── 설정 저장 ──────────────────────────────────────────

/**
 * 설정을 암호화하여 저장합니다. (프로덕션)
 * 키를 자동 생성하거나 기존 키를 사용합니다.
 */
export function saveConfigEncrypted(config: AgentConfig): { keyPath: string; encPath: string } {
  ensureDataDir();
  const key = loadOrCreateKey();
  const plaintext = JSON.stringify(config, null, 2);
  const ciphertext = encrypt(plaintext, key);
  fs.writeFileSync(CONFIG_ENC_PATH, ciphertext, 'utf8');

  // 평문 config.json이 남아있으면 삭제
  if (fs.existsSync(CONFIG_JSON_PATH)) {
    fs.unlinkSync(CONFIG_JSON_PATH);
  }

  return {
    keyPath: path.join(DATA_DIR, 'agent.key'),
    encPath: CONFIG_ENC_PATH,
  };
}

/**
 * 설정을 암호화하여 저장합니다. (직접 키 지정)
 */
export function saveConfig(config: AgentConfig, encryptionKey: string): void {
  ensureDataDir();
  const plaintext = JSON.stringify(config, null, 2);
  const ciphertext = encrypt(plaintext, encryptionKey);
  fs.writeFileSync(CONFIG_ENC_PATH, ciphertext, 'utf8');
}

/**
 * 설정을 평문 JSON으로 저장합니다. (개발용 — 프로덕션에서는 사용 금지)
 */
export function saveConfigJson(config: AgentConfig): void {
  ensureDataDir();
  fs.writeFileSync(CONFIG_JSON_PATH, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * config.json 경로 반환
 */
export function getConfigJsonPath(): string {
  return CONFIG_JSON_PATH;
}

/**
 * config.enc 경로 반환
 */
export function getConfigEncPath(): string {
  return CONFIG_ENC_PATH;
}

// ─── 환경변수 → 설정 변환 ──────────────────────────────

function buildConfigFromEnv(): Record<string, unknown> {
  const env = process.env;
  const dbType = env.DB_TYPE || 'mssql';

  return {
    server: {
      baseUrl: env.SYNC_SERVER_URL || 'https://hanjul.ai',
      apiKey: env.SYNC_API_KEY || '',
      apiSecret: env.SYNC_API_SECRET || '',
    },
    database: {
      type: dbType,
      host: env.DB_HOST || 'localhost',
      port: parseInt(env.DB_PORT || String(DEFAULT_DB_PORTS[dbType] || 1433), 10),
      database: env.DB_NAME || '',
      username: env.DB_USER || '',
      password: env.DB_PASSWORD || '',
      queryTimeout: parseInt(env.DB_QUERY_TIMEOUT || '30000', 10),
    },
    sync: {
      customerInterval: parseInt(env.SYNC_CUSTOMER_INTERVAL || '60', 10),
      purchaseInterval: parseInt(env.SYNC_PURCHASE_INTERVAL || '30', 10),
      batchSize: parseInt(env.SYNC_BATCH_SIZE || '4000', 10),
      customerTable: env.SYNC_CUSTOMER_TABLE || 'CUSTOMER',
      purchaseTable: env.SYNC_PURCHASE_TABLE || 'PURCHASE',
      timestampColumn: env.SYNC_TIMESTAMP_COLUMN || 'updated_at',
      fallbackToFullSync: true,
    },
    mapping: {
      customers: {},
      purchases: {},
    },
    agent: {
      name: env.AGENT_NAME || 'sync-agent-001',
      version: '0.1.0',
    },
    log: {
      level: env.LOG_LEVEL || 'info',
    },
  };
}

// ─── 유틸 ───────────────────────────────────────────────

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export { AgentConfigSchema, type AgentConfig, getTimestampColumns } from './schema';
