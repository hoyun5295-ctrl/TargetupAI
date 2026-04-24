/**
 * Agent 설정 스키마 정의 (Zod)
 *
 * 변경사항 (v1.4.0):
 *   - MappingConfigSchema에 customFieldLabels 추가
 *
 * 변경사항 (2026-02-25):
 *   - customerTimestampColumn / purchaseTimestampColumn 추가 (BUG-010)
 *     → 테이블마다 다른 timestamp 컬럼 지원
 *     → 미지정 시 기존 timestampColumn로 폴백 (하위호환)
 */

import { z } from 'zod';

// ─── 서버 연결 설정 ─────────────────────────────────────

const ServerConfigSchema = z.object({
  baseUrl: z.string().url().default('https://hanjul.ai'),
  apiKey: z.string().min(1, 'API Key는 필수입니다'),
  apiSecret: z.string().min(1, 'API Secret은 필수입니다'),
});

// ─── DB 접속 설정 ───────────────────────────────────────

const DatabaseConfigSchema = z.object({
  type: z.enum(['mssql', 'mysql', 'oracle', 'postgres', 'excel', 'csv']),
  host: z.string().default(''),
  port: z.number().int().positive().default(3306),
  database: z.string().default(''),
  username: z.string().default(''),
  password: z.string().default(''),
  queryTimeout: z.number().int().positive().default(30000), // 30초

  // Excel/CSV 전용 (optional)
  filePath: z.string().optional(),
  sheetName: z.string().optional(),
  delimiter: z.string().default(','),
  encoding: z.string().default('utf-8'),
  watchMode: z.boolean().default(false),
}).refine(
  (data) => {
    // DB 타입이면 host/database 필수
    if (['mssql', 'mysql', 'oracle', 'postgres'].includes(data.type)) {
      return data.host.length > 0 && data.database.length > 0;
    }
    // 파일 타입이면 filePath 또는 database 필수
    if (['excel', 'csv'].includes(data.type)) {
      return (data.filePath && data.filePath.length > 0) || data.database.length > 0;
    }
    return true;
  },
  { message: 'DB 타입에 따라 host/database 또는 filePath가 필수입니다' },
);

// ─── 동기화 설정 ────────────────────────────────────────

const SyncConfigSchema = z.object({
  customerInterval: z.number().int().min(5).max(1440).default(60),     // 분
  purchaseInterval: z.number().int().min(5).max(720).default(30),      // 분
  batchSize: z.number().int().min(100).max(10000).default(4000),
  customerTable: z.string().min(1),
  // ★ v1.4.1: 구매 테이블 옵션화 — 고객사가 구매 이력 없으면 빈 문자열로 전송됨
  // sync engine에서 `if (config.purchaseTable)` 분기로 구매 동기화 자체를 스킵
  purchaseTable: z.string().default(''),

  /** 기본 수정일시 컬럼 (하위호환용 폴백) */
  timestampColumn: z.string().default('updated_at'),

  /** 고객 테이블 전용 수정일시 컬럼 (미지정 시 timestampColumn 사용) */
  customerTimestampColumn: z.string().optional(),

  /** 구매 테이블 전용 수정일시 컬럼 (미지정 시 timestampColumn 사용) */
  purchaseTimestampColumn: z.string().optional(),

  /** updated_at 컬럼이 없을 때 전체 동기화 폴백 여부 */
  fallbackToFullSync: z.boolean().default(true),
});

// ─── 컬럼 매핑 설정 ────────────────────────────────────

const MappingConfigSchema = z.object({
  customers: z.record(z.string()).default({}),   // { "CUST_HP": "phone" }
  purchases: z.record(z.string()).default({}),
  /** 커스텀 슬롯 라벨 { "custom_1": "결혼기념일", ... } — v1.4.0 */
  customFieldLabels: z.record(z.string()).default({}),
});

// ─── Agent 메타 설정 ────────────────────────────────────

const AgentMetaSchema = z.object({
  id: z.string().uuid().nullish(),
  name: z.string().min(1).default('sync-agent-001'),
  version: z.string().default('1.5.2'),
});

// ─── 로깅 설정 ──────────────────────────────────────────

const LogConfigSchema = z.object({
  level: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  maxFiles: z.number().int().default(30),        // 30일 보관
  maxSize: z.string().default('20m'),            // 파일당 최대 크기
});

// ─── 전체 설정 스키마 ───────────────────────────────────

export const AgentConfigSchema = z.object({
  server: ServerConfigSchema,
  database: DatabaseConfigSchema,
  sync: SyncConfigSchema,
  mapping: MappingConfigSchema,
  agent: AgentMetaSchema,
  log: LogConfigSchema.default({}),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ─── 유틸: 테이블별 timestamp 컬럼 조회 ─────────────────

/**
 * 고객/구매 각각의 실제 timestamp 컬럼을 반환합니다.
 * 개별 지정이 있으면 개별값, 없으면 공통 timestampColumn 폴백.
 */
export function getTimestampColumns(sync: AgentConfig['sync']): {
  customer: string;
  purchase: string;
} {
  return {
    customer: sync.customerTimestampColumn || sync.timestampColumn,
    purchase: sync.purchaseTimestampColumn || sync.timestampColumn,
  };
}

// ─── 기본 DB 포트 ───────────────────────────────────────

export const DEFAULT_DB_PORTS: Record<string, number> = {
  mssql: 1433,
  mysql: 3306,
  oracle: 1521,
  postgres: 5432,
  excel: 0,
  csv: 0,
};
