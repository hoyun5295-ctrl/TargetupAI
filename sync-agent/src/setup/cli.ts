/**
 * CLI 설치 마법사 (터미널 대화형)
 *
 * 리눅스 헤드리스 서버 등 브라우저 없는 환경에서 사용
 * 웹 마법사(server.ts)와 동일한 설정 흐름을 터미널에서 처리
 *
 * ⚠️ 외부 의존성 없음 — Node.js 내장 readline만 사용 (pkg exe 호환)
 *
 * 흐름:
 *   Step 1: 한줄로 API 연결 정보
 *   Step 2: DB 접속 정보 + 테스트
 *   Step 3: 테이블 선택 + 테이블별 timestamp 컬럼 지정
 *   Step 4: 컬럼 매핑 (자동 추천 + 수동 수정)
 *   Step 5: 동기화 설정
 *   → config.enc 암호화 저장 → Agent 시작
 *
 * 변경사항 (2026-02-25):
 *   - Step 3: 테이블별 timestamp 컬럼 개별 선택 (BUG-010)
 *   - config 저장 시 customerTimestampColumn / purchaseTimestampColumn 반영
 */

import * as readline from 'node:readline';
import { createDbConnector } from '../db';
import type { DbConnectionConfig } from '../db/types';
import { autoSuggestMapping, assignCustomFieldSlots } from '../mapping/templates';
import {
  saveConfigEncrypted,
  saveConfigJson,
  type AgentConfig,
} from '../config';
import { initLogger, getLogger } from '../logger';

const DEV_MODE = process.env.DEV_MODE === 'true';

// ─── readline 유틸 ──────────────────────────────────────

let rl: readline.Interface;

function initReadline(): void {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function askPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`  ${question} (입력 시 표시됨): `, (answer) => {
      resolve(answer.trim());
    });
  });
}

function askSelect(question: string, choices: { name: string; value: any }[]): Promise<any> {
  return new Promise((resolve) => {
    console.log('');
    console.log(`  ${question}`);
    console.log('');
    choices.forEach((c, i) => {
      console.log(`    ${i + 1}) ${c.name}`);
    });
    console.log('');

    const doAsk = () => {
      rl.question(`  번호 선택 (1-${choices.length}): `, (answer) => {
        const num = parseInt(answer.trim(), 10);
        if (num >= 1 && num <= choices.length) {
          resolve(choices[num - 1].value);
        } else {
          console.log(`  ⚠  1~${choices.length} 사이 번호를 입력해주세요.`);
          doAsk();
        }
      });
    };
    doAsk();
  });
}

function askConfirm(question: string, defaultYes: boolean = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  return new Promise((resolve) => {
    rl.question(`  ${question} (${hint}): `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === '') resolve(defaultYes);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

// ─── 한줄로 표준 필드 목록 ──────────────────────────────

const CUSTOMER_STANDARD_FIELDS = [
  'phone', 'name', 'gender', 'birth_date', 'birth_year', 'birth_month_day',
  'age', 'email', 'address', 'region', 'grade', 'points',
  'store_code', 'store_name', 'store_phone', 'registered_store', 'registered_store_number',
  'registration_type', 'recent_purchase_date', 'recent_purchase_amount',
  'recent_purchase_store', 'last_purchase_date', 'total_purchase_amount',
  'total_purchase', 'purchase_count', 'avg_order_value', 'ltv_score',
  'wedding_anniversary', 'is_married', 'sms_opt_in', 'is_opt_out', 'is_active',
  // 커스텀 슬롯 (v1.4.0)
  'custom_1', 'custom_2', 'custom_3', 'custom_4', 'custom_5',
  'custom_6', 'custom_7', 'custom_8', 'custom_9', 'custom_10',
  'custom_11', 'custom_12', 'custom_13', 'custom_14', 'custom_15',
];

const PURCHASE_STANDARD_FIELDS = [
  'customer_phone', 'purchase_date', 'store_code', 'store_name',
  'product_code', 'product_name', 'quantity', 'unit_price', 'total_amount',
];

// ─── 출력 유틸 ──────────────────────────────────────────

function printHeader(): void {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║                                                  ║');
  console.log('║        Sync Agent 설치 마법사 (CLI)               ║');
  console.log('║        INVITO — 한줄로 데이터 동기화              ║');
  console.log('║                                                  ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
}

function printStep(step: number, total: number, title: string): void {
  console.log('');
  console.log(`━━━ Step ${step}/${total}: ${title} ${'━'.repeat(Math.max(0, 40 - title.length))}`);
  console.log('');
}

function printMappingTable(
  mapping: Record<string, string>,
  unmapped: string[],
  columns: string[]
): void {
  const mapped = Object.entries(mapping);
  if (mapped.length > 0) {
    console.log('');
    console.log('  ┌─────────────────────────┬─────────────────────────┐');
    console.log('  │  DB 컬럼                 │  한줄로 필드             │');
    console.log('  ├─────────────────────────┼─────────────────────────┤');
    for (const [src, dst] of mapped) {
      const srcPad = src.padEnd(23);
      const dstPad = dst.padEnd(23);
      console.log(`  │  ${srcPad}│  ${dstPad}│`);
    }
    console.log('  └─────────────────────────┴─────────────────────────┘');
  }

  if (unmapped.length > 0) {
    console.log('');
    console.log(`  ⚠  미매핑 컬럼 (${unmapped.length}개): ${unmapped.join(', ')}`);
    console.log('     → custom_1~15 슬롯에 자동 배정됩니다.');
  }

  console.log('');
  console.log(`  ✅ 자동 매핑: ${mapped.length}개 / 전체 ${columns.length}개`);
}

// ─── Step 1: API 연결 정보 ──────────────────────────────

async function stepApiConnection(): Promise<{
  serverUrl: string;
  apiKey: string;
  apiSecret: string;
}> {
  printStep(1, 5, '한줄로 API 연결');

  const serverUrl = await ask('서버 URL', 'https://hanjul.ai');

  let apiKey = '';
  while (!apiKey) {
    apiKey = await ask('API Key');
    if (!apiKey) console.log('  ⚠  API Key를 입력해주세요.');
  }

  let apiSecret = '';
  while (!apiSecret) {
    apiSecret = await askPassword('API Secret');
    if (!apiSecret) console.log('  ⚠  API Secret을 입력해주세요.');
  }

  console.log('');
  console.log(`  ✅ API 연결 정보 입력 완료`);
  console.log(`     서버: ${serverUrl}`);
  console.log(`     API Key: ${apiKey.substring(0, 8)}...`);

  return { serverUrl, apiKey, apiSecret };
}

// ─── Step 2: DB 접속 ────────────────────────────────────

async function stepDbConnection(): Promise<{
  dbConfig: DbConnectionConfig;
}> {
  printStep(2, 5, 'DB 접속 설정');

  const dbType = await askSelect('DB 종류를 선택하세요:', [
    { name: 'MySQL / MariaDB', value: 'mysql' },
    { name: 'Microsoft SQL Server', value: 'mssql' },
    { name: 'Oracle', value: 'oracle' },
    { name: 'PostgreSQL', value: 'postgres' },
    { name: 'Excel / CSV 파일', value: 'excel' },
  ]);

  // Excel/CSV
  if (dbType === 'excel') {
    let filePath = '';
    while (!filePath) {
      filePath = await ask('파일 경로 (Excel/CSV)');
      if (!filePath) console.log('  ⚠  파일 경로를 입력해주세요.');
    }

    const dbConfig: DbConnectionConfig = {
      type: 'excel',
      host: '',
      port: 0,
      database: filePath,
      username: '',
      password: '',
      queryTimeout: 30000,
    };

    return { dbConfig };
  }

  const defaultPorts: Record<string, number> = {
    mysql: 3306,
    mssql: 1433,
    oracle: 1521,
    postgres: 5432,
  };

  const host = await ask('호스트', 'localhost');
  const portStr = await ask('포트', String(defaultPorts[dbType] || 3306));

  let database = '';
  while (!database) {
    database = await ask('DB 이름');
    if (!database) console.log('  ⚠  DB 이름을 입력해주세요.');
  }

  let username = '';
  while (!username) {
    username = await ask('사용자');
    if (!username) console.log('  ⚠  사용자를 입력해주세요.');
  }

  const dbPassword = await askPassword('비밀번호');

  const dbConfig: DbConnectionConfig = {
    type: dbType as DbConnectionConfig['type'],
    host,
    port: parseInt(portStr, 10),
    database,
    username,
    password: dbPassword,
    queryTimeout: 30000,
  };

  // 접속 테스트
  console.log('');
  console.log('  🔄 DB 접속 테스트 중...');

  try {
    const connector = createDbConnector(dbConfig);
    const ok = await connector.testConnection();
    await connector.disconnect();

    if (ok) {
      console.log('  ✅ DB 연결 성공!');
    } else {
      console.log('  ❌ DB 연결 실패.');
      const retry = await askConfirm('다시 입력하시겠습니까?', true);
      if (retry) return stepDbConnection();
      process.exit(1);
    }
  } catch (error) {
    console.log(`  ❌ DB 연결 오류: ${error instanceof Error ? error.message : error}`);
    const retry = await askConfirm('다시 입력하시겠습니까?', true);
    if (retry) return stepDbConnection();
    process.exit(1);
  }

  return { dbConfig };
}

// ─── Step 3: 테이블 선택 + 테이블별 timestamp ────────────

async function stepTableSelection(dbConfig: DbConnectionConfig): Promise<{
  customerTable: string;
  purchaseTable: string;
  customerColumns: string[];
  purchaseColumns: string[];
  customerTimestampColumn: string;
  purchaseTimestampColumn: string;
}> {
  printStep(3, 5, '테이블 선택');

  console.log('  🔄 테이블 목록 조회 중...');

  const connector = createDbConnector(dbConfig);
  await connector.testConnection();
  const tables = await connector.getTables();

  console.log(`  📋 ${tables.length}개 테이블 감지됨`);

  const tableChoices = tables.map((t) => ({ name: t, value: t }));

  const customerTable = await askSelect('고객 테이블을 선택하세요:', tableChoices);
  const purchaseTable = await askSelect('구매 테이블을 선택하세요:', tableChoices);

  // 컬럼 조회
  console.log('');
  console.log('  🔄 컬럼 정보 조회 중...');

  const customerCols = await connector.getColumns(customerTable);
  const purchaseCols = await connector.getColumns(purchaseTable);
  await connector.disconnect();

  const customerColumns = customerCols.map((c) => c.name);
  const purchaseColumns = purchaseCols.map((c) => c.name);

  console.log(`  📋 고객 테이블 (${customerTable}): ${customerColumns.length}개 컬럼`);
  console.log(`  📋 구매 테이블 (${purchaseTable}): ${purchaseColumns.length}개 컬럼`);

  // ─── 테이블별 timestamp 컬럼 선택 ──────────────────────

  const timestampKeywords = ['upd_dt', 'updated_at', 'modify_dt', 'mod_dt', 'modified_at', 'last_modified', 'chg_dt', 'changed_at', 'ord_dt', 'reg_dt'];

  // 고객 테이블 timestamp
  console.log('');
  console.log(`  🕐 고객 테이블 (${customerTable}) — 증분 동기화 기준 컬럼`);
  const customerTimestampColumn = await detectOrAskTimestamp(
    customerColumns, timestampKeywords, `고객 (${customerTable})`
  );

  // 구매 테이블 timestamp
  console.log('');
  console.log(`  🕐 구매 테이블 (${purchaseTable}) — 증분 동기화 기준 컬럼`);
  const purchaseTimestampColumn = await detectOrAskTimestamp(
    purchaseColumns, timestampKeywords, `구매 (${purchaseTable})`
  );

  console.log('');
  console.log('  ✅ 테이블 설정 완료');
  console.log(`     고객: ${customerTable} (timestamp: ${customerTimestampColumn || '없음'})`);
  console.log(`     구매: ${purchaseTable} (timestamp: ${purchaseTimestampColumn || '없음'})`);

  return {
    customerTable,
    purchaseTable,
    customerColumns,
    purchaseColumns,
    customerTimestampColumn,
    purchaseTimestampColumn,
  };
}

/**
 * 테이블의 컬럼 목록에서 timestamp 컬럼 자동 감지 → 확인/수동 선택
 */
async function detectOrAskTimestamp(
  columns: string[],
  keywords: string[],
  label: string
): Promise<string> {
  const candidates = columns.filter((col) =>
    keywords.some((kw) => col.toLowerCase() === kw.toLowerCase())
  );

  if (candidates.length === 1) {
    console.log(`     자동 감지: ${candidates[0]}`);
    const useDetected = await askConfirm(`"${candidates[0]}"을(를) 사용할까요?`, true);
    if (useDetected) return candidates[0];
    return await askTimestampColumn(columns, label);
  }

  if (candidates.length > 1) {
    console.log(`     후보 ${candidates.length}개 감지됨`);
    return await askSelect(`${label} 증분 동기화 기준 컬럼:`,
      candidates.map((c) => ({ name: c, value: c }))
    );
  }

  console.log('     ⚠  자동 감지 실패');
  return await askTimestampColumn(columns, label);
}

/**
 * 타임스탬프 컬럼 수동 선택
 */
async function askTimestampColumn(columns: string[], label: string): Promise<string> {
  const dateKeywords = ['dt', 'date', 'time', 'stamp', 'upd', 'mod', 'chg', 'reg', 'ord'];
  const sorted = [...columns].sort((a, b) => {
    const aScore = dateKeywords.some((kw) => a.toLowerCase().includes(kw)) ? 0 : 1;
    const bScore = dateKeywords.some((kw) => b.toLowerCase().includes(kw)) ? 0 : 1;
    return aScore - bScore;
  });

  const choices = [
    { name: '⏭  없음 (전체 동기화만 사용)', value: '__none__' },
    ...sorted.map((c) => ({ name: c, value: c })),
  ];

  const selected = await askSelect(`${label} 증분 동기화 기준 컬럼:`, choices);
  return selected === '__none__' ? '' : selected;
}

// ─── Step 4: 컬럼 매핑 ──────────────────────────────────

interface ColumnMappingStepContext {
  /** v1.5.0: AI 매핑용 서버 URL (serverUrl + credentials 전달 시 Opus 4.7 호출) */
  serverUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  dbType?: 'mssql' | 'mysql' | 'oracle' | 'postgres' | 'excel' | 'csv';
  customerTableName?: string;
  purchaseTableName?: string;
}

async function stepColumnMapping(
  customerColumns: string[],
  purchaseColumns: string[],
  ctx: ColumnMappingStepContext = {},
): Promise<{
  customerMapping: Record<string, string>;
  purchaseMapping: Record<string, string>;
  customFieldLabels: Record<string, string>;
}> {
  printStep(4, 5, '컬럼 매핑');

  // v1.5.0: AI 자동 매핑 선택 (Opus 4.7)
  const canUseAi = !!(ctx.serverUrl && ctx.apiKey && ctx.apiSecret && ctx.dbType);
  let useAi = false;
  if (canUseAi) {
    useAi = await askConfirm('🤖 AI 자동 매핑 (Claude Opus 4.7)을 사용하시겠습니까?', true);
  }

  let customerResult: { mapping: Record<string, string>; unmapped: string[] };
  let aiLabelsFromApi: Record<string, string> = {};
  if (useAi && canUseAi) {
    console.log('  🤖 Claude Opus 4.7 호출 중... (1회당 ~$0.075, 월 10회 쿼터)');
    try {
      const { suggestMappingWithAI } = await import('../mapping');
      const ai = await suggestMappingWithAI({
        serverUrl: ctx.serverUrl!,
        credentials: { apiKey: ctx.apiKey!, apiSecret: ctx.apiSecret! },
        target: 'customers',
        tableName: ctx.customerTableName || '',
        dbType: ctx.dbType!,
        sourceColumns: customerColumns,
      });
      customerResult = {
        mapping: ai.mapping,
        unmapped: ai.unmappedColumns,
      };
      aiLabelsFromApi = ai.customFieldLabels;
      const tag = ai.fallbackUsed
        ? `로컬 폴백 (${ai.fallbackReason || 'AI 호출 실패'})`
        : `${ai.modelUsed}${ai.cacheHit ? ' · 캐시적중' : ''}`;
      console.log(`  ✅ AI 매핑 완료 — ${tag}`);
    } catch (e: any) {
      console.log(`  ⚠  AI 매핑 호출 실패 → 로컬 규칙 기반 매핑으로 대체 (${e?.message || e})`);
      customerResult = autoSuggestMapping(customerColumns, 'customers');
    }
  } else {
    console.log('  📊 고객 테이블 자동 매핑 분석 중...');
    customerResult = autoSuggestMapping(customerColumns, 'customers');
  }

  console.log('');
  console.log('  [ 고객 테이블 매핑 결과 ]');
  printMappingTable(customerResult.mapping, customerResult.unmapped, customerColumns);

  let customerMapping = { ...customerResult.mapping };

  const editCustomer = await askConfirm('고객 매핑을 수정하시겠습니까?', false);
  if (editCustomer) {
    customerMapping = await editMapping(
      customerMapping,
      customerColumns,
      CUSTOMER_STANDARD_FIELDS,
      '고객'
    );
  }

  // ── 커스텀 필드 자동 배정 (v1.4.0) ──
  // 표준 필드에 매핑 안 된 컬럼 → custom_1~custom_15 슬롯
  // v1.5.0: AI가 이미 custom_N을 배정한 경우 그 라벨 유지
  const mappedCustomerCols = new Set(Object.keys(customerMapping));
  const unmappedForCustom = customerColumns.filter((col) => !mappedCustomerCols.has(col));
  let customFieldLabels: Record<string, string> = { ...aiLabelsFromApi };

  if (unmappedForCustom.length > 0) {
    console.log('');
    console.log(`  📋 미매핑 컬럼 ${unmappedForCustom.length}개 → 커스텀 필드 슬롯 자동 배정`);

    const customResult = assignCustomFieldSlots(customerMapping, unmappedForCustom);
    customerMapping = customResult.mapping;
    // AI 라벨 + 로컬 배정 라벨 병합 (AI 우선)
    customFieldLabels = { ...customResult.customFieldLabels, ...aiLabelsFromApi, ...customFieldLabels };

    if (Object.keys(customFieldLabels).length > 0) {
      console.log('');
      console.log('  [ 커스텀 필드 배정 결과 ]');
      console.log('  ┌─────────────────────────┬──────────┬─────────────────────┐');
      console.log('  │  DB 컬럼                 │  슬롯     │  라벨               │');
      console.log('  ├─────────────────────────┼──────────┼─────────────────────┤');
      for (const [slot, label] of Object.entries(customFieldLabels)) {
        // 역으로 소스 컬럼 찾기
        const srcCol = Object.entries(customerMapping).find(([, v]) => v === slot)?.[0] || '';
        console.log(`  │  ${srcCol.padEnd(23)}│  ${slot.padEnd(8)}│  ${label.padEnd(19)}│`);
      }
      console.log('  └─────────────────────────┴──────────┴─────────────────────┘');
    }

    if (customResult.overflowColumns.length > 0) {
      console.log(`  ⚠  슬롯 초과 (무시됨): ${customResult.overflowColumns.join(', ')}`);
    }

    // 커스텀 라벨 수정 기회
    const editLabels = await askConfirm('커스텀 필드 라벨을 수정하시겠습니까?', false);
    if (editLabels) {
      for (const [slot, currentLabel] of Object.entries(customFieldLabels)) {
        const newLabel = await ask(`  ${slot} 라벨`, currentLabel);
        customFieldLabels[slot] = newLabel;
      }
      console.log('  ✅ 커스텀 필드 라벨 수정 완료');
    }
  }

  // 구매 테이블 자동 매핑
  console.log('');
  let purchaseResult: { mapping: Record<string, string>; unmapped: string[] };
  if (useAi && canUseAi && purchaseColumns.length > 0) {
    console.log('  🤖 구매 테이블 AI 매핑 호출 중...');
    try {
      const { suggestMappingWithAI } = await import('../mapping');
      const ai = await suggestMappingWithAI({
        serverUrl: ctx.serverUrl!,
        credentials: { apiKey: ctx.apiKey!, apiSecret: ctx.apiSecret! },
        target: 'purchases',
        tableName: ctx.purchaseTableName || '',
        dbType: ctx.dbType!,
        sourceColumns: purchaseColumns,
      });
      purchaseResult = { mapping: ai.mapping, unmapped: ai.unmappedColumns };
      const tag = ai.fallbackUsed ? `로컬 폴백` : ai.modelUsed;
      console.log(`  ✅ 구매 AI 매핑 완료 — ${tag}`);
    } catch (e: any) {
      console.log(`  ⚠  구매 AI 매핑 실패 → 로컬 폴백 (${e?.message || e})`);
      purchaseResult = autoSuggestMapping(purchaseColumns, 'purchases');
    }
  } else {
    console.log('  📊 구매 테이블 자동 매핑 분석 중...');
    purchaseResult = autoSuggestMapping(purchaseColumns, 'purchases');
  }

  console.log('');
  console.log('  [ 구매 테이블 매핑 결과 ]');
  printMappingTable(purchaseResult.mapping, purchaseResult.unmapped, purchaseColumns);

  let purchaseMapping = { ...purchaseResult.mapping };

  const editPurchase = await askConfirm('구매 매핑을 수정하시겠습니까?', false);
  if (editPurchase) {
    purchaseMapping = await editMapping(
      purchaseMapping,
      purchaseColumns,
      PURCHASE_STANDARD_FIELDS,
      '구매'
    );
  }

  return { customerMapping, purchaseMapping, customFieldLabels };
}

/**
 * 매핑 수정 대화형 인터페이스
 */
async function editMapping(
  currentMapping: Record<string, string>,
  columns: string[],
  standardFields: string[],
  label: string
): Promise<Record<string, string>> {
  const mapping = { ...currentMapping };

  console.log('');
  console.log(`  🔧 ${label} 매핑 수정 모드`);
  console.log('  수정할 컬럼 번호를 입력하세요. 0을 입력하면 완료됩니다.');

  while (true) {
    console.log('');
    columns.forEach((col, i) => {
      const mapped = mapping[col];
      const arrow = mapped ? `→ ${mapped}` : '→ (미매핑)';
      console.log(`    ${i + 1}) ${col}  ${arrow}`);
    });
    console.log(`    0) ✅ 수정 완료`);
    console.log('');

    const numStr = await ask(`수정할 컬럼 번호 (${label})`);
    const num = parseInt(numStr, 10);

    if (num === 0) break;
    if (num < 1 || num > columns.length) {
      console.log(`  ⚠  0~${columns.length} 사이 번호를 입력해주세요.`);
      continue;
    }

    const selectedCol = columns[num - 1];

    // 사용 가능한 필드 목록
    const usedFields = new Set(Object.values(mapping));
    const availableFields = standardFields.filter(
      (f) => !usedFields.has(f) || mapping[selectedCol] === f
    );

    const fieldChoices = [
      { name: '🚫 매핑 제거 (custom_fields로)', value: '__remove__' },
      ...availableFields.map((f) => ({
        name: mapping[selectedCol] === f ? `${f} (현재)` : f,
        value: f,
      })),
    ];

    const selectedField = await askSelect(
      `"${selectedCol}" 을(를) 어디에 매핑할까요?`,
      fieldChoices
    );

    if (selectedField === '__remove__') {
      delete mapping[selectedCol];
      console.log(`  ❌ ${selectedCol} 매핑 제거됨`);
    } else {
      mapping[selectedCol] = selectedField;
      console.log(`  ✅ ${selectedCol} → ${selectedField}`);
    }
  }

  // 최종 결과
  console.log('');
  console.log(`  [ ${label} 최종 매핑 ]`);
  const unmapped = columns.filter((c) => !mapping[c]);
  printMappingTable(mapping, unmapped, columns);

  return mapping;
}

// ─── Step 5: 동기화 설정 ─────────────────────────────────

async function stepSyncSettings(): Promise<{
  customerInterval: number;
  purchaseInterval: number;
  agentName: string;
}> {
  printStep(5, 5, '동기화 설정');

  const customerInterval = await askSelect('고객 동기화 주기:', [
    { name: '5분', value: 5 },
    { name: '15분', value: 15 },
    { name: '30분', value: 30 },
    { name: '1시간 (권장)', value: 60 },
    { name: '3시간', value: 180 },
    { name: '6시간', value: 360 },
    { name: '12시간', value: 720 },
    { name: '24시간', value: 1440 },
  ]);

  const purchaseInterval = await askSelect('구매 동기화 주기:', [
    { name: '5분', value: 5 },
    { name: '15분', value: 15 },
    { name: '30분 (권장)', value: 30 },
    { name: '1시간', value: 60 },
    { name: '3시간', value: 180 },
    { name: '6시간', value: 360 },
    { name: '12시간', value: 720 },
  ]);

  const agentName = await ask('Agent 이름 (식별용)', `sync-agent-${Date.now().toString(36)}`);

  console.log('');
  console.log('  ✅ 동기화 설정 완료');
  console.log(`     고객 주기: ${customerInterval}분`);
  console.log(`     구매 주기: ${purchaseInterval}분`);
  console.log(`     Agent 이름: ${agentName}`);

  return { customerInterval, purchaseInterval, agentName };
}

// ─── 메인 실행 ──────────────────────────────────────────

export async function startSetupCli(
  options: { autoLaunchAgent?: boolean } = {}
): Promise<void> {
  const { autoLaunchAgent = true } = options;

  initLogger({ level: 'info', maxFiles: 30, maxSize: '20m' });
  const logger = getLogger('setup-cli');

  initReadline();
  printHeader();

  try {
    // Step 1: API 연결
    const { serverUrl, apiKey, apiSecret } = await stepApiConnection();

    // Step 2: DB 접속
    const { dbConfig } = await stepDbConnection();

    // Step 3: 테이블 선택 + 테이블별 timestamp
    const {
      customerTable,
      purchaseTable,
      customerColumns,
      purchaseColumns,
      customerTimestampColumn,
      purchaseTimestampColumn,
    } = await stepTableSelection(dbConfig);

    // Step 4: 컬럼 매핑 (v1.5.0: AI 매핑 ctx 전달)
    const { customerMapping, purchaseMapping, customFieldLabels } =
      await stepColumnMapping(customerColumns, purchaseColumns, {
        serverUrl, apiKey, apiSecret,
        dbType: dbConfig.type as any,
        customerTableName: customerTable,
        purchaseTableName: purchaseTable,
      });

    // Step 5: 동기화 설정
    const { customerInterval, purchaseInterval, agentName } =
      await stepSyncSettings();

    // ─── 최종 확인 ──────────────────────────────────────

    console.log('');
    console.log('━━━ 설정 요약 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log(`  서버: ${serverUrl}`);
    console.log(`  DB: ${dbConfig.type} (${dbConfig.host}:${dbConfig.port}/${dbConfig.database})`);
    console.log(`  고객 테이블: ${customerTable} (매핑 ${Object.keys(customerMapping).length}개)`);
    console.log(`  구매 테이블: ${purchaseTable} (매핑 ${Object.keys(purchaseMapping).length}개)`);
    if (Object.keys(customFieldLabels).length > 0) {
      console.log(`  커스텀 필드: ${Object.keys(customFieldLabels).length}개 슬롯 배정`);
    }
    console.log(`  고객 timestamp: ${customerTimestampColumn || '없음 (전체 동기화만)'}`);
    console.log(`  구매 timestamp: ${purchaseTimestampColumn || '없음 (전체 동기화만)'}`);
    console.log(`  동기화 주기: 고객 ${customerInterval}분 / 구매 ${purchaseInterval}분`);
    console.log(`  Agent 이름: ${agentName}`);
    console.log('');

    const doSave = await askConfirm('이 설정으로 저장하시겠습니까?', true);

    if (!doSave) {
      console.log('  ❌ 설정이 취소되었습니다.');
      rl.close();
      process.exit(0);
    }

    // ─── 설정 저장 ──────────────────────────────────────

    const config: AgentConfig = {
      server: {
        baseUrl: serverUrl,
        apiKey,
        apiSecret,
      },
      database: {
        type: dbConfig.type,
        host: dbConfig.host || '',
        port: dbConfig.port || 3306,
        database: dbConfig.database,
        username: dbConfig.username || '',
        password: dbConfig.password || '',
        queryTimeout: dbConfig.queryTimeout || 30000,
        delimiter: dbConfig.delimiter || ',',
        encoding: dbConfig.encoding || 'utf-8',
        watchMode: dbConfig.watchMode || false,
        filePath: dbConfig.filePath,
        sheetName: dbConfig.sheetName,
      },
      sync: {
        customerInterval,
        purchaseInterval,
        batchSize: 4000,
        customerTable,
        purchaseTable,
        timestampColumn: customerTimestampColumn || 'updated_at',
        customerTimestampColumn: customerTimestampColumn || undefined,
        purchaseTimestampColumn: purchaseTimestampColumn || undefined,
        fallbackToFullSync: true,
      },
      mapping: {
        customers: customerMapping,
        purchases: purchaseMapping,
        customFieldLabels,
      },
      agent: {
        name: agentName,
        version: '1.4.0',
      },
      log: {
        level: 'info',
        maxFiles: 30,
        maxSize: '20m',
      },
    };

    if (DEV_MODE) {
      saveConfigJson(config);
      console.log('');
      console.log('  ⚠️  설정 저장 완료 (개발 모드 — 평문 JSON)');
    } else {
      const { keyPath, encPath } = saveConfigEncrypted(config);
      console.log('');
      console.log('  🔒 설정 암호화 저장 완료 (AES-256-GCM)');
      console.log(`     설정 파일: ${encPath}`);
      console.log(`     암호화 키: ${keyPath}`);
    }

    // ─── Agent 시작 ─────────────────────────────────────

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  ✅ 설치 완료!                                   ║');
    if (!DEV_MODE) {
      console.log('║  🔒 설정은 AES-256-GCM으로 암호화 저장됨          ║');
    }
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');

    // readline 닫기 (Agent 시작 전 필수)
    rl.close();

    if (autoLaunchAgent) {
      const startNow = await new Promise<boolean>((resolve) => {
        // rl이 닫혔으므로 새로 생성
        const rl2 = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        rl2.question('  지금 바로 동기화를 시작하시겠습니까? (Y/n): ', (answer) => {
          rl2.close();
          const a = answer.trim().toLowerCase();
          resolve(a === '' || a === 'y' || a === 'yes');
        });
      });

      if (startNow) {
        console.log('  🚀 Agent를 시작합니다...');
        console.log('');
        await import('../index');
      } else {
        console.log('');
        console.log('  다음 명령으로 실행할 수 있습니다:');
        console.log('    ./sync-agent');
        console.log('');
        console.log('  서비스로 등록하려면:');
        console.log('    sudo ./sync-agent --install-service');
        console.log('');
        process.exit(0);
      }
    } else {
      process.exit(0);
    }
  } catch (error) {
    rl?.close();
    logger.error('CLI 설치 마법사 오류', { error });
    console.error('');
    console.error(`  ❌ 오류 발생: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
