/**
 * 설정 편집 CLI (--edit-config)
 *
 * config.enc 복호화 → 현재 설정 표시 → 섹션별 수정 → 재암호화 저장
 *
 * ⚠️ 외부 의존성 없음 — Node.js 내장 readline만 사용 (pkg exe 호환)
 *
 * v1.4.0:
 *   - 커스텀 필드 라벨(customFieldLabels) 표시 + 편집 지원
 *
 * 변경사항 (2026-02-25):
 *   - 최초 작성
 *   - 섹션별 편집: 서버, DB, 동기화, 매핑, Agent
 *   - 테이블별 timestamp 컬럼 개별 수정 지원 (BUG-010)
 */

import * as readline from 'node:readline';
import {
  loadConfigDecrypted,
  saveConfigEncrypted,
  updateConfigEncrypted,
  type AgentConfig,
} from '../config';
// ★2026-09-13(3) 싱크 ⓑ 가리는 모양은 masking.ts 한 곳이 정한다(키 = 앞뒤 4자 · 시크릿·비밀번호 = 전부)
import { maskApiKey, maskPassword } from '../logger/masking';
import { customSlotSources, resolveCustomFieldLabels } from '../mapping/templates';
import { createDbConnector } from '../db';
import { resolveValueMaps, valueMapSourceOf, VALUE_MAP_FIELDS } from '../normalize';
import { runValueCheck, judgementLabel } from './value-check';

// ─── readline 유틸 ──────────────────────────────────────

let rl: readline.Interface;

function initReadline(): void {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue !== undefined ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || (defaultValue ?? ''));
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

// ─── 비밀값 입력 ────────────────────────────────────────

/**
 * 비밀값 입력(★2026-09-13(3) 싱크 ⓑ). 종전 ask는 현재 값 **원문 전체**를 기본값 괄호에 보였다.
 * 현재 값은 화면에 싣지 않고, 부르는 쪽이 masking.ts 규칙으로 만든 힌트만 보인다. Enter = 현재 값 유지(ask와 같은 결과).
 */
function askSecret(question: string, currentValue: string, hint: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`  ${question} (${hint} · Enter=유지): `, (answer) => {
      resolve(answer.trim() || currentValue);
    });
  });
}

function secretStateHint(value: string): string {
  return value ? '설정됨' : '미설정';
}

// ─── 현재 설정 출력 ─────────────────────────────────────

/** ⛔ 원문 보기 인자를 되살리지 마라(켜는 호출처가 없었고, 켜는 순간 콘솔에 원문이 나간다) */
export function printConfig(config: AgentConfig): void {
  const s = config.server;
  const d = config.database;
  const y = config.sync;
  const m = config.mapping;
  const a = config.agent;

  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║            현재 Sync Agent 설정                   ║');
  console.log('╚══════════════════════════════════════════════════╝');

  // ① 서버
  console.log('');
  console.log('  ┌── [1] 서버 연결 ──────────────────────────────┐');
  console.log(`  │  서버 URL:    ${s.baseUrl}`);
  console.log(`  │  API Key:     ${maskApiKey(s.apiKey)}`);
  console.log(`  │  API Secret:  ${maskPassword(s.apiSecret)}`);
  console.log('  └───────────────────────────────────────────────┘');

  // ② DB
  console.log('');
  console.log('  ┌── [2] DB 접속 ────────────────────────────────┐');
  console.log(`  │  DB 종류:     ${d.type}`);
  console.log(`  │  호스트:      ${d.host}:${d.port}`);
  console.log(`  │  DB 이름:     ${d.database}`);
  console.log(`  │  사용자:      ${d.username}`);
  console.log(`  │  비밀번호:    ${maskPassword(d.password)}`);
  console.log(`  │  쿼리 타임아웃: ${d.queryTimeout}ms`);
  console.log(`  │  암호화(TLS): ${d.ssl ? (d.sslCaPath ? '사용 (인증서 검증)' : '사용 (검증 안 함)') : '사용 안 함'}`);
  if (d.type === 'oracle') console.log(`  │  Oracle 모드:  ${d.oracleClient === 'thin' ? '12c 이상 (thin)' : d.oracleClient === 'thick' ? '11g 이하 (동봉 클라이언트)' : '미지정 (동봉 클라이언트 있으면 11g 이하 방식)'}`);
  console.log('  └───────────────────────────────────────────────┘');

  // ③ 동기화
  const custTs = y.customerTimestampColumn || y.timestampColumn;
  const purTs = y.purchaseTimestampColumn || y.timestampColumn;

  console.log('');
  console.log('  ┌── [3] 동기화 설정 ────────────────────────────┐');
  console.log(`  │  고객 테이블:       ${y.customerTable}`);
  console.log(`  │  구매 테이블:       ${y.purchaseTable}`);
  console.log(`  │  고객 timestamp:    ${custTs}${y.customerTimestampColumn ? '' : ' (공통)'}`);
  console.log(`  │  구매 timestamp:    ${purTs}${y.purchaseTimestampColumn ? '' : ' (공통)'}`);
  console.log(`  │  고객 동기화 주기:  ${y.customerInterval}분`);
  console.log(`  │  구매 동기화 주기:  ${y.purchaseInterval}분`);
  console.log(`  │  배치 크기:         ${y.batchSize}건`);
  console.log(`  │  전체 동기화 폴백:  ${y.fallbackToFullSync ? '사용' : '미사용'}`);
  console.log('  └───────────────────────────────────────────────┘');

  // ④ 매핑
  const custMapCount = Object.keys(m.customers).length;
  const purMapCount = Object.keys(m.purchases).length;
  // ★ 2026-10-15 표시 = 기동 시 서버에 등록되는 라벨(CT) — 저장 라벨이 없는 슬롯은 원본 컬럼명
  const customLabels = resolveCustomFieldLabels(m.customers, m.customFieldLabels);
  const customLabelCount = Object.keys(customLabels).length;

  console.log('');
  console.log('  ┌── [4] 컬럼 매핑 ──────────────────────────────┐');
  console.log(`  │  고객 매핑: ${custMapCount}개 컬럼`);
  if (custMapCount > 0) {
    for (const [src, dst] of Object.entries(m.customers)) {
      console.log(`  │    ${src} → ${dst}`);
    }
  }
  console.log(`  │  구매 매핑: ${purMapCount}개 컬럼`);
  if (purMapCount > 0) {
    for (const [src, dst] of Object.entries(m.purchases)) {
      console.log(`  │    ${src} → ${dst}`);
    }
  }
  if (customLabelCount > 0) {
    console.log(`  │  커스텀 필드 라벨: ${customLabelCount}개`);
    for (const [slot, label] of Object.entries(customLabels)) {
      console.log(`  │    ${slot} → ${label}`);
    }
  }
  console.log('  └───────────────────────────────────────────────┘');

  // ★ 2026-10-28 설치별 값 분류(P2) — 지금 고객 매핑과 컬럼이 다르면 쓰이지 않는다(normalize resolveValueMaps 한 곳)
  if (config.valueMaps) {
    const effective = resolveValueMaps(config.valueMaps, m.customers, { table: y.customerTable, source: valueMapSourceOf(d) }) || {};
    console.log('');
    console.log('  ┌── [6] 값 분류 (설치 때 분류) ─────────────────┐');
    for (const field of VALUE_MAP_FIELDS) {
      const entry = config.valueMaps[field];
      if (!entry) continue;
      const pairs = Object.entries(entry.values as Record<string, boolean | 'M' | 'F'>)
        .map(([raw, v]) => `"${raw}" → ${judgementLabel(field, v)}`).join(', ');
      console.log(`  │  ${field} (${entry.table} · ${entry.column}): ${pairs}${effective[field] ? '' : '  ⚠ 지금 매핑 · 테이블 · DB 와 달라 쓰이지 않음 → [6] 으로 다시 확인'}`);
    }
    console.log('  └───────────────────────────────────────────────┘');
  }

  // ⑤ Agent
  console.log('');
  console.log('  ┌── [5] Agent 정보 ─────────────────────────────┐');
  console.log(`  │  Agent ID:    ${a.id || '(미등록)'}`);
  console.log(`  │  Agent 이름:  ${a.name}`);
  console.log(`  │  버전:        ${a.version}`);
  console.log('  └───────────────────────────────────────────────┘');
  console.log('');
}

// ─── 섹션별 편집 함수 ───────────────────────────────────

async function editServer(config: AgentConfig): Promise<AgentConfig> {
  console.log('');
  console.log('  🔧 서버 연결 설정 수정');
  console.log('  (Enter를 누르면 현재 값 유지)');
  console.log('');

  const baseUrl = await ask('서버 URL', config.server.baseUrl);
  const apiKey = await askSecret('API Key', config.server.apiKey, maskApiKey(config.server.apiKey));
  const apiSecret = await askSecret('API Secret', config.server.apiSecret, secretStateHint(config.server.apiSecret));

  return {
    ...config,
    server: { baseUrl, apiKey, apiSecret },
  };
}

async function editDatabase(config: AgentConfig): Promise<AgentConfig> {
  console.log('');
  console.log('  🔧 DB 접속 설정 수정');
  console.log('  (Enter를 누르면 현재 값 유지)');
  console.log('');

  const d = config.database;

  const host = await ask('호스트', d.host);
  const portStr = await ask('포트', String(d.port));
  const database = await ask('DB 이름', d.database);
  const username = await ask('사용자', d.username);
  const password = await askSecret('비밀번호', d.password, secretStateHint(d.password));
  // ★ 2026-07-27 클라우드 DB(Aurora/RDS·Azure)는 암호화 연결만 허용하는 경우가 있다(MySQL 3159).
  const ssl = await askConfirm('암호화(TLS) 연결을 사용할까요? (클라우드 DB면 예)', d.ssl === true);
  const sslCaPath = ssl
    ? (await ask('CA 인증서 파일 경로 (Enter=검증 없이 암호화만)', d.sslCaPath || '')).trim() || undefined
    : undefined;

  return {
    ...config,
    database: {
      ...d,
      host,
      port: parseInt(portStr, 10) || d.port,
      database,
      username,
      password,
      ssl,
      sslCaPath,
    },
  };
}

async function editSync(config: AgentConfig): Promise<AgentConfig> {
  console.log('');
  console.log('  🔧 동기화 설정 수정');
  console.log('  (Enter를 누르면 현재 값 유지)');

  const y = config.sync;

  const syncField = await askSelect('수정할 항목:', [
    { name: '고객 테이블명', value: 'customerTable' },
    { name: '구매 테이블명', value: 'purchaseTable' },
    { name: '고객 timestamp 컬럼', value: 'customerTimestamp' },
    { name: '구매 timestamp 컬럼', value: 'purchaseTimestamp' },
    { name: '고객 동기화 주기', value: 'customerInterval' },
    { name: '구매 동기화 주기', value: 'purchaseInterval' },
    { name: '배치 크기', value: 'batchSize' },
    { name: '전체 항목 수정', value: 'all' },
  ]);

  const updated = { ...y };

  if (syncField === 'customerTable' || syncField === 'all') {
    updated.customerTable = await ask('고객 테이블명', y.customerTable);
  }

  if (syncField === 'purchaseTable' || syncField === 'all') {
    updated.purchaseTable = await ask('구매 테이블명', y.purchaseTable);
  }

  if (syncField === 'customerTimestamp' || syncField === 'all') {
    const currentCustTs = y.customerTimestampColumn || y.timestampColumn;
    const newCustTs = await ask('고객 timestamp 컬럼', currentCustTs);
    updated.customerTimestampColumn = newCustTs;
  }

  if (syncField === 'purchaseTimestamp' || syncField === 'all') {
    const currentPurTs = y.purchaseTimestampColumn || y.timestampColumn;
    const newPurTs = await ask('구매 timestamp 컬럼', currentPurTs);
    updated.purchaseTimestampColumn = newPurTs;
  }

  if (syncField === 'customerInterval' || syncField === 'all') {
    const val = await ask('고객 동기화 주기 (분)', String(y.customerInterval));
    updated.customerInterval = parseInt(val, 10) || y.customerInterval;
  }

  if (syncField === 'purchaseInterval' || syncField === 'all') {
    const val = await ask('구매 동기화 주기 (분)', String(y.purchaseInterval));
    updated.purchaseInterval = parseInt(val, 10) || y.purchaseInterval;
  }

  if (syncField === 'batchSize' || syncField === 'all') {
    const val = await ask('배치 크기', String(y.batchSize));
    updated.batchSize = parseInt(val, 10) || y.batchSize;
  }

  return { ...config, sync: updated };
}

async function editMapping(config: AgentConfig): Promise<AgentConfig> {
  const target = await askSelect('어느 매핑을 수정할까요?', [
    { name: '🤖 AI 자동 매핑 재실행 (월 10회)', value: 'aiRemap' },
    { name: '고객 매핑', value: 'customers' },
    { name: '구매 매핑', value: 'purchases' },
    { name: '커스텀 필드 라벨', value: 'customLabels' },
  ]);

  // ── v1.5.0: AI 매핑 재실행 ──
  if (target === 'aiRemap') {
    const scope = await askSelect('어느 테이블을 AI로 다시 매핑할까요?', [
      { name: '고객 테이블', value: 'customers' },
      { name: '구매 테이블', value: 'purchases' },
    ]);
    const existingMap = scope === 'customers' ? config.mapping.customers : config.mapping.purchases;
    const sourceColumns = Object.keys(existingMap || {});
    if (sourceColumns.length === 0) {
      console.log('  ⚠  기존 매핑에 컬럼이 없습니다. --setup-cli로 재설정이 필요합니다.');
      return config;
    }
    console.log(`  🤖 AI 매핑 호출 중 (${scope}, ${sourceColumns.length}개 컬럼)...`);
    try {
      const { suggestMappingWithAI } = await import('../mapping');
      const tableName = scope === 'customers' ? config.sync.customerTable : config.sync.purchaseTable;
      const ai = await suggestMappingWithAI({
        serverUrl: config.server.baseUrl,
        credentials: { apiKey: config.server.apiKey, apiSecret: config.server.apiSecret },
        target: scope,
        tableName,
        dbType: config.database.type as any,
        sourceColumns,
      });
      const tag = ai.fallbackUsed
        ? `로컬 폴백 (${ai.fallbackReason || ''})`
        : `AI 모델${ai.cacheHit ? ' · 캐시적중' : ''}`;
      console.log(`  ✅ AI 재매핑 완료 — ${Object.keys(ai.mapping).length}개 컬럼 / ${tag}`);
      // ★ 2026-10-15 라벨은 고객 슬롯 전용(서버 고객 필드 정의). 고객을 다시 매핑하면 소스 컬럼이 그대로인 슬롯만
      //   저장 라벨을 잇고 나머지는 원본 컬럼명. 옛: 구매 재매핑의 슬롯 라벨까지 섞어 고객 필드 이름으로 올렸다.
      const nextMapping = {
        ...config.mapping,
        [scope]: ai.mapping,
        customFieldLabels: scope === 'customers'
          ? resolveCustomFieldLabels(ai.mapping, config.mapping.customFieldLabels, config.mapping.customers)
          : config.mapping.customFieldLabels,
      };
      return { ...config, mapping: nextMapping };
    } catch (e: any) {
      console.log(`  ⚠  AI 매핑 실패: ${e?.message || e}`);
      return config;
    }
  }

  // ── 커스텀 필드 라벨 편집 ──
  //   ★ 2026-07-01: 매핑에 실제 쓰인 custom 슬롯 전부를 라벨링 대상으로 삼는다.
  //     (기존: customFieldLabels에 이미 있는 항목만 수정 가능 → 새로 추가한 custom 슬롯에
  //      라벨을 못 달던 문제. isae 고객 custom 15개 라벨 지정 불가로 발견 2026-07-01.)
  //     기본값 = 현재 라벨 또는 소스 컬럼명이라, Enter만 눌러도 컬럼명으로 라벨이 붙는다.
  //   ★ 2026-10-15 대상 = 고객 매핑의 custom 슬롯만(라벨은 서버 고객 필드 정의로 올라간다).
  //     옛: 구매 매핑 슬롯까지 모아, 고객이 안 쓰는 번호에 구매 컬럼 이름이 고객 필드 라벨로 붙었다.
  if (target === 'customLabels') {
    const labels = resolveCustomFieldLabels(config.mapping.customers, config.mapping.customFieldLabels);
    const slotSource = customSlotSources(config.mapping.customers);

    if (slotSource.size === 0) {
      console.log('  ⚠  고객 매핑에 custom 슬롯이 없습니다.');
    } else {
      console.log('');
      console.log('  custom 슬롯 라벨 지정 (Enter = 현재값/컬럼명 유지):');
      for (const [slot, src] of slotSource) {
        const newLabel = await ask(`${slot} (${src}) 라벨`, labels[slot]);
        if (newLabel) labels[slot] = newLabel;
      }
    }

    return {
      ...config,
      mapping: { ...config.mapping, customFieldLabels: labels },
    };
  }

  // ── 기존 고객/구매 매핑 편집 ──

  const currentMapping = { ...(target === 'customers' ? config.mapping.customers : config.mapping.purchases) };
  const entries = Object.entries(currentMapping);

  if (entries.length === 0) {
    console.log('  ⚠  매핑이 비어있습니다. --setup-cli로 재설정을 권장합니다.');
    return config;
  }

  console.log('');
  console.log(`  현재 ${target === 'customers' ? '고객' : '구매'} 매핑:`);
  entries.forEach(([src, dst], i) => {
    console.log(`    ${i + 1}) ${src} → ${dst}`);
  });
  console.log(`    0) ✅ 수정 완료`);

  while (true) {
    const numStr = await ask('수정할 번호 (0=완료)');
    const num = parseInt(numStr, 10);

    if (num === 0) break;
    if (num < 1 || num > entries.length) {
      console.log(`  ⚠  0~${entries.length} 사이 번호를 입력해주세요.`);
      continue;
    }

    const [srcCol, currentDst] = entries[num - 1];
    const action = await askSelect(`"${srcCol}" (현재: ${currentDst})`, [
      { name: '매핑 대상 변경', value: 'change' },
      { name: '매핑 삭제', value: 'delete' },
      { name: '취소', value: 'cancel' },
    ]);

    if (action === 'change') {
      const newDst = await ask(`"${srcCol}" → 새 대상 필드`, currentDst);
      currentMapping[srcCol] = newDst;
      entries[num - 1] = [srcCol, newDst];
      console.log(`  ✅ ${srcCol} → ${newDst}`);
    } else if (action === 'delete') {
      delete currentMapping[srcCol];
      entries.splice(num - 1, 1);
      console.log(`  ❌ ${srcCol} 매핑 삭제됨`);
    }
  }

  // 새 매핑 추가
  const addNew = await askConfirm('새 매핑을 추가하시겠습니까?', false);
  if (addNew) {
    while (true) {
      const srcCol = await ask('DB 컬럼명 (빈칸=종료)');
      if (!srcCol) break;
      const dstField = await ask(`"${srcCol}" → 한줄로 필드명`);
      if (dstField) {
        currentMapping[srcCol] = dstField;
        console.log(`  ✅ ${srcCol} → ${dstField} 추가`);
      }
    }
  }

  const updatedMapping = { ...config.mapping };
  if (target === 'customers') {
    updatedMapping.customers = currentMapping;
    // ★ 2026-10-15 슬롯을 옮기거나 지우면 라벨도 따라간다 — 소스 컬럼이 그대로인 슬롯만 저장 라벨 유지(CT)
    updatedMapping.customFieldLabels = resolveCustomFieldLabels(
      currentMapping, config.mapping.customFieldLabels, config.mapping.customers,
    );
  } else {
    updatedMapping.purchases = currentMapping;
  }

  return { ...config, mapping: updatedMapping };
}

/**
 * ★ 2026-10-28 P2 값 확인 — 저장된 접속 · 고객 표 · 고객 매핑으로 마법사와 같은 CT(setup/value-check.ts)를 돌려 valueMaps 를 새로 쓴다.
 * 웹 마법사로 설치한 곳 · 매핑을 바꾼 뒤 · 설치 뒤 다시 확인할 때의 길.
 * 결과는 **최신 설정 파일에 valueMaps 만 합쳐 바로 저장**한다(Codex 설계 1R) — 대화 중 서비스의 원격 매핑 갱신을 이 편집기의 옛 사본이 덮지 않게.
 * 확인에 쓴 매핑 · 테이블 · 접속이 최신 파일과 다르면(그새 원격 갱신 · 이 편집기의 저장 안 한 수정) 저장하지 않는다.
 * 분류가 바뀌면 다음 기동에서 고객 커서가 폐기돼 고객 전량이 새 분류로 다시 나간다(engine cursorFingerprint).
 */
async function editValueMaps(config: AgentConfig): Promise<AgentConfig> {
  console.log('');
  console.log('  🔧 수신동의 · 탈퇴 · 성별 값 확인 (저장된 DB 접속 · 고객 테이블 · 고객 매핑으로)');
  const target = { table: config.sync.customerTable, source: valueMapSourceOf(config.database) };
  const checkedMapping = JSON.stringify(config.mapping.customers);
  let valueMaps: AgentConfig['valueMaps'];
  const connector = createDbConnector(config.database);
  try {
    await connector.testConnection();
    valueMaps = await runValueCheck(connector, target, config.mapping.customers, config.valueMaps, {
      log: (line) => console.log(line),
      askSelect,
    });
  } catch (e: any) {
    console.log(`  ⚠  DB 접속 실패 (${e?.message || e}). 값 분류를 바꾸지 않습니다.`);
    return config;
  } finally {
    await connector.disconnect().catch(() => { /* 종료 경로 */ });
  }

  let stale = false;
  try {
    const saved = updateConfigEncrypted((latest) => {
      if (latest.sync.customerTable !== target.table
        || valueMapSourceOf(latest.database) !== target.source
        || JSON.stringify(latest.mapping.customers) !== checkedMapping) {
        stale = true;
        throw new Error('설정이 확인 뒤 바뀌었습니다');
      }
      return { ...latest, valueMaps };
    });
    console.log('  ✅ 값 분류를 바로 저장했습니다. 에이전트를 재시작하면 고객 전체를 새 분류로 다시 보냅니다.');
    return { ...config, valueMaps: saved.valueMaps };
  } catch (e: any) {
    console.log(stale
      ? '  ⚠  저장되지 않은 수정이 있거나 그사이 설정이 바뀌어 값 분류를 저장하지 않았습니다. [저장하고 종료] 뒤 다시 열어 값 확인을 해 주세요.'
      : `  ⚠  값 분류 저장 실패 (${e?.message || e}).`);
    return config;
  }
}

async function editAgent(config: AgentConfig): Promise<AgentConfig> {
  console.log('');
  console.log('  🔧 Agent 정보 수정');
  console.log('');

  const name = await ask('Agent 이름', config.agent.name);

  return {
    ...config,
    agent: { ...config.agent, name },
  };
}

// ─── 메인 실행 ──────────────────────────────────────────

export async function startEditConfig(
  options: { showOnly?: boolean } = {}
): Promise<void> {
  const { showOnly = false } = options;

  // 1) 현재 설정 로드
  let config: AgentConfig;
  try {
    config = loadConfigDecrypted();
  } catch (error) {
    console.error('');
    console.error(`  ❌ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // 2) 조회 전용 모드
  if (showOnly) {
    printConfig(config);
    process.exit(0);
  }

  // 3) 대화형 편집 모드
  initReadline();

  try {
    while (true) {
      printConfig(config);

      const section = await askSelect('수정할 섹션을 선택하세요:', [
        { name: '[1] 서버 연결 (URL, API Key/Secret)', value: 'server' },
        { name: '[2] DB 접속 (호스트, 포트, 계정)', value: 'database' },
        { name: '[3] 동기화 설정 (테이블, timestamp, 주기)', value: 'sync' },
        { name: '[4] 컬럼 매핑 (고객/구매)', value: 'mapping' },
        { name: '[5] Agent 정보 (이름)', value: 'agent' },
        { name: '[6] 수신동의 · 탈퇴 · 성별 값 확인', value: 'values' },
        { name: '💾 저장하고 종료', value: 'save' },
        { name: '❌ 저장하지 않고 종료', value: 'exit' },
      ]);

      if (section === 'save') {
        // 변경 사항 요약
        console.log('');
        console.log('  📋 변경된 설정을 저장합니다...');

        try {
          saveConfigEncrypted(config);
          console.log('');
          console.log('  ✅ 설정이 암호화 저장되었습니다 (AES-256-GCM)');
          console.log('');
          console.log('  💡 변경사항을 적용하려면 Agent를 재시작하세요:');
          console.log('     Windows: schtasks /End /TN SyncAgent && schtasks /Run /TN SyncAgent');
          console.log('     Linux:   sudo systemctl restart sync-agent');
          console.log('');
        } catch (error) {
          console.error(`  ❌ 저장 실패: ${error instanceof Error ? error.message : error}`);
        }
        break;
      }

      if (section === 'exit') {
        const confirmExit = await askConfirm('저장하지 않고 종료할까요?', false);
        if (confirmExit) {
          console.log('  ❌ 변경사항이 저장되지 않았습니다.');
          break;
        }
        continue;
      }

      // 섹션별 편집
      switch (section) {
        case 'server':
          config = await editServer(config);
          break;
        case 'database':
          config = await editDatabase(config);
          break;
        case 'sync':
          config = await editSync(config);
          break;
        case 'mapping':
          config = await editMapping(config);
          break;
        case 'agent':
          config = await editAgent(config);
          break;
        case 'values':
          config = await editValueMaps(config);
          break;
      }

      console.log('');
      console.log('  ✅ 수정 완료 (아직 저장되지 않음)');
    }
  } finally {
    rl?.close();
  }
}
