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
  type AgentConfig,
} from '../config';

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

// ─── 마스킹 유틸 ────────────────────────────────────────

function mask(value: string, showFirst: number = 4): string {
  if (!value || value.length <= showFirst) return '****';
  return value.substring(0, showFirst) + '*'.repeat(Math.min(value.length - showFirst, 20));
}

// ─── 현재 설정 출력 ─────────────────────────────────────

function printConfig(config: AgentConfig, showSecrets: boolean = false): void {
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
  console.log(`  │  API Key:     ${showSecrets ? s.apiKey : mask(s.apiKey)}`);
  console.log(`  │  API Secret:  ${showSecrets ? s.apiSecret : mask(s.apiSecret)}`);
  console.log('  └───────────────────────────────────────────────┘');

  // ② DB
  console.log('');
  console.log('  ┌── [2] DB 접속 ────────────────────────────────┐');
  console.log(`  │  DB 종류:     ${d.type}`);
  console.log(`  │  호스트:      ${d.host}:${d.port}`);
  console.log(`  │  DB 이름:     ${d.database}`);
  console.log(`  │  사용자:      ${d.username}`);
  console.log(`  │  비밀번호:    ${showSecrets ? d.password : mask(d.password)}`);
  console.log(`  │  쿼리 타임아웃: ${d.queryTimeout}ms`);
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
  const customLabels = m.customFieldLabels || {};
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
  const apiKey = await ask('API Key', config.server.apiKey);
  const apiSecret = await ask('API Secret', config.server.apiSecret);

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
  const password = await ask('비밀번호', d.password);

  return {
    ...config,
    database: {
      ...d,
      host,
      port: parseInt(portStr, 10) || d.port,
      database,
      username,
      password,
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
    { name: '🤖 AI 자동 매핑 재실행 (Claude Opus 4.7, 월 10회)', value: 'aiRemap' },
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
        : `${ai.modelUsed}${ai.cacheHit ? ' · 캐시적중' : ''}`;
      console.log(`  ✅ AI 재매핑 완료 — ${Object.keys(ai.mapping).length}개 컬럼 / ${tag}`);
      const nextMapping = {
        ...config.mapping,
        [scope]: ai.mapping,
        customFieldLabels: {
          ...(config.mapping.customFieldLabels || {}),
          ...ai.customFieldLabels,
        },
      };
      return { ...config, mapping: nextMapping };
    } catch (e: any) {
      console.log(`  ⚠  AI 매핑 실패: ${e?.message || e}`);
      return config;
    }
  }

  // ── 커스텀 필드 라벨 편집 ──
  if (target === 'customLabels') {
    const labels = { ...(config.mapping.customFieldLabels || {}) };
    const entries = Object.entries(labels);

    if (entries.length === 0) {
      console.log('  ⚠  커스텀 필드 라벨이 없습니다.');
      const addNew = await askConfirm('새 라벨을 추가하시겠습니까?', false);
      if (addNew) {
        for (let i = 1; i <= 15; i++) {
          const slot = `custom_${i}`;
          const label = await ask(`${slot} 라벨 (빈칸=스킵)`);
          if (label) labels[slot] = label;
        }
      }
    } else {
      console.log('');
      console.log('  현재 커스텀 필드 라벨:');
      entries.forEach(([slot, label], i) => {
        console.log(`    ${i + 1}) ${slot} → ${label}`);
      });

      for (const [slot, currentLabel] of entries) {
        const newLabel = await ask(`${slot} 라벨`, currentLabel);
        labels[slot] = newLabel;
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
  } else {
    updatedMapping.purchases = currentMapping;
  }

  return { ...config, mapping: updatedMapping };
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
    printConfig(config, false);
    process.exit(0);
  }

  // 3) 대화형 편집 모드
  initReadline();

  try {
    while (true) {
      printConfig(config, false);

      const section = await askSelect('수정할 섹션을 선택하세요:', [
        { name: '[1] 서버 연결 (URL, API Key/Secret)', value: 'server' },
        { name: '[2] DB 접속 (호스트, 포트, 계정)', value: 'database' },
        { name: '[3] 동기화 설정 (테이블, timestamp, 주기)', value: 'sync' },
        { name: '[4] 컬럼 매핑 (고객/구매)', value: 'mapping' },
        { name: '[5] Agent 정보 (이름)', value: 'agent' },
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
          console.log('     Windows: net stop SyncAgent && net start SyncAgent');
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
      }

      console.log('');
      console.log('  ✅ 수정 완료 (아직 저장되지 않음)');
    }
  } finally {
    rl?.close();
  }
}
