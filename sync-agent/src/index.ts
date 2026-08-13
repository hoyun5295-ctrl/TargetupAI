/**
 * Sync Agent 메인 로직
 *
 * 시작 흐름:
 *   1. 설정 로드 + 검증 (config.enc / config.json / .env)
 *   2. 로거 초기화
 *   3. 알림 모듈 초기화 (Phase 5 추가)
 *   4. 오프라인 큐 초기화
 *   5. DB 커넥터 생성 + 연결 테스트
 *   6. API 클라이언트 생성
 *   7. Agent 서버 등록 (최초 실행 시)
 *   7.5. 커스텀 필드 정의 등록 (v1.4.0)
 *   8. 최초 전체 동기화 (또는 증분)
 *   9. 스케줄러 시작 (자동 증분 동기화 + Heartbeat + 큐 재전송)
 *  10. Graceful Shutdown
 *
 * v1.4.0 변경사항:
 *   - custom_fields JSONB 슬롯 매핑 체계
 *   - field-definitions API 등록 (최초 1회)
 *   - 신규 필드 4개 (store_phone, registration_type, registered_store, recent_purchase_store)
 *
 * 변경사항 (2026-02-25):
 *   - SyncEngineConfig에 customerTimestampColumn / purchaseTimestampColumn 전달 (BUG-010)
 *
 * 환경변수:
 *   USE_MOCK=true    → Mock DB (가짜 데이터)
 *   DRY_RUN=true     → 실제 DB 읽기, API 전송 스킵
 */

import dotenv from 'dotenv';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { loadConfig, updateConfigEncrypted, type AgentConfig, type ConfigSource } from './config';
import { initLogger, getLogger } from './logger';
import { createDbConnector, createMockDbConnector, type IDbConnector } from './db';
import { ApiClient } from './api/client';
import { SyncStateManager } from './sync/state';
import { SyncEngine } from './sync/engine';
import { QueueManager } from './queue';
import { HeartbeatManager } from './heartbeat';
import { Scheduler } from './scheduler';
import { AlertManager, loadAlertConfig } from './alert';
import { AGENT_VERSION } from './version';
import { selfHealBinaries } from './updater';

// ★ v1.5.1: Windows 서비스 실행 시 cwd=C:\Windows\System32 → config/data/logs 경로 틀어짐
//   → 바이너리 실행 경로(process.execPath) 기준으로 cwd 강제 설정
//   (콘솔 실행 시에도 동일하게 동작 — 멱등, 부작용 없음)
try {
  const __execDir = require('path').dirname(process.execPath);
  process.chdir(__execDir);
} catch (err) {
  // chdir 실패는 치명적 아님 — 콘솔 실행 경로에서는 기존 동작 유지
  console.error('[startup] chdir failed:', (err as Error)?.message);
}

// 환경변수 로드 (.env가 있는 경우만)
dotenv.config();

const USE_MOCK = process.env.USE_MOCK === 'true';
const DRY_RUN = process.env.DRY_RUN === 'true' || USE_MOCK;

// ─── 설정 소스 라벨 ─────────────────────────────────────

const SOURCE_LABELS: Record<ConfigSource, string> = {
  env: '환경변수 (.env)',
  encrypted: '🔒 암호화 설정 (data/config.enc)',
  json: '⚠️  평문 설정 (data/config.json)',
  none: '없음',
};

// ─── 메인 ───────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. 설정 로드 (암호화 키는 자동으로 data/agent.key에서 로드)
  let config: AgentConfig;
  let configSource: ConfigSource;

  try {
    const result = loadConfig();
    config = result.config;
    configSource = result.source;
  } catch (error) {
    console.error('❌ 설정 로드 실패:', error instanceof Error ? error.message : error);
    console.error('');
    console.error('💡 sync-agent --setup 으로 설치 마법사를 실행해주세요.');
    process.exit(1);
  }

  // 2. 로거 초기화
  const logger = initLogger(config.log);
  const log = getLogger('main');

  // ★ 2026-07-03: 자기교체 잔여물(.old/.new) 정리 — 원자 스왑 후 교체 스크립트가 정리 전에 죽었을 때 대비 (D-4 안전망)
  try { selfHealBinaries(); } catch { /* 정리 실패는 치명적 아님 */ }

  log.info('========================================');
  // ★ 2026-06-11: 배너/보고 버전은 실행 파일 자신의 버전(AGENT_VERSION)만 사용.
  //   config.enc 저장값을 쓰면 구버전 설정 보존 시 새 exe도 옛 버전으로 표시되는 문제 (인비토 v1.5.1 실측)
  log.info(`Sync Agent v${AGENT_VERSION} 시작`);
  if (config.agent.version && config.agent.version !== AGENT_VERSION) {
    log.info(`설정 파일 기록 버전 v${config.agent.version} — 표시/보고는 실행 파일 v${AGENT_VERSION} 기준`);
  }
  log.info(`설정 소스: ${SOURCE_LABELS[configSource]}`);

  if (configSource === 'json') {
    log.warn('⚠️  평문 설정 파일 사용 중 — 프로덕션에서는 암호화 설정을 권장합니다.');
    log.warn('   sync-agent --setup 으로 재설정하면 자동 암호화됩니다.');
  }

  log.info('');

  if (USE_MOCK) {
    log.info('🧪 MOCK 모드 — 가짜 데이터로 파이프라인 테스트');
  } else if (DRY_RUN) {
    log.info('🧪 DRY RUN 모드 — 실제 DB 읽기, API 전송 스킵');
  }

  log.info(`DB: ${config.database.type} @ ${config.database.host}:${config.database.port}/${config.database.database}`);
  log.info(`서버: ${config.server.baseUrl}`);
  log.info(`Agent: ${config.agent.name}`);

  // 매핑 정보 로깅
  const hasCustomerMapping = Object.keys(config.mapping.customers).length > 0;
  const hasPurchaseMapping = Object.keys(config.mapping.purchases).length > 0;

  if (hasCustomerMapping) {
    log.info(`고객 매핑: ${Object.keys(config.mapping.customers).length}개 컬럼 (설정 파일)`);
  } else {
    log.info('고객 매핑: 기본 템플릿 사용');
  }

  if (hasPurchaseMapping) {
    log.info(`구매 매핑: ${Object.keys(config.mapping.purchases).length}개 컬럼 (설정 파일)`);
  } else {
    log.info('구매 매핑: 기본 템플릿 사용');
  }

  log.info(`동기화 테이블: 고객=${config.sync.customerTable}, 구매=${config.sync.purchaseTable}`);
  log.info(`Timestamp 컬럼: 고객=${config.sync.customerTimestampColumn || config.sync.timestampColumn}, 구매=${config.sync.purchaseTimestampColumn || config.sync.timestampColumn}`);
  log.info(`동기화 주기: 고객 ${config.sync.customerInterval}분, 구매 ${config.sync.purchaseInterval}분`);
  log.info('========================================');

  // 3. 알림 모듈 초기화
  const alertConfig = loadAlertConfig(process.env as Record<string, string | undefined>);
  alertConfig.agentName = config.agent.name;
  const alertManager = new AlertManager(alertConfig);
  await alertManager.initialize();

  // 4. 오프라인 큐 초기화
  const queue = new QueueManager();
  await queue.init();

  // 5. DB 커넥터 생성 + 연결 테스트
  let db: IDbConnector;
  try {
    if (USE_MOCK) {
      db = createMockDbConnector();
    } else {
      db = createDbConnector(config.database);
    }
    const connected = await db.testConnection();
    if (!connected) {
      throw new Error('DB 연결 테스트 실패');
    }
    log.info('✅ DB 연결 성공');
    alertManager.onDbConnectionResult(true);
  } catch (error) {
    log.error('❌ DB 연결 실패', { error });
    alertManager.onDbConnectionResult(false, error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // 6. API 클라이언트
  let apiClient: ApiClient | null = null;
  if (!DRY_RUN) {
    apiClient = new ApiClient(config.server.baseUrl, {
      apiKey: config.server.apiKey,
      apiSecret: config.server.apiSecret,
    });
  }

  // 7. 동기화 상태 로드
  const syncState = new SyncStateManager();
  const state = syncState.getState();

  // 8. Agent 서버 등록 (최초 실행 시)
  if (!DRY_RUN && !state.agentId && apiClient) {
    try {
      const registerResult = await apiClient.register({
        apiKey: config.server.apiKey,
        apiSecret: config.server.apiSecret,
        agentName: config.agent.name,
        agentVersion: AGENT_VERSION,
        osInfo: `${os.platform()} ${os.release()}`,
        dbType: config.database.type,
      });

      syncState.setAgentId(registerResult.agentId);
      log.info(`✅ Agent 등록 완료: ${registerResult.agentId}`);
    } catch (error) {
      log.error('❌ Agent 등록 실패 — 로컬 모드로 계속', { error });
    }
  } else if (state.agentId) {
    log.info(`Agent ID: ${state.agentId}`);
  }

  // 8.5. 커스텀 필드 정의 등록 (v1.4.0 → D137 D10 근본 수정)
  //   ★ D137 D10: customFieldLabels 자동 유도 —
  //     config에 customFieldLabels가 비어있으면 mapping.customers의 `custom_N` 매핑에서
  //     원본 DB 컬럼명을 라벨로 역추출 (setup을 AI 매핑 없이 수동으로 했거나, 이관 계정에서 설정 누락된 경우 보완).
  //     → 한줄로 슈퍼관리자 대시보드 카드 설정에서 `custom_1` 대신 업체 DB 원본 컬럼명이 표시됨.
  const customFieldLabels: Record<string, string> = { ...(config.mapping.customFieldLabels || {}) };
  if (Object.keys(customFieldLabels).length === 0 && config.mapping.customers) {
    for (const [srcCol, destKey] of Object.entries(config.mapping.customers)) {
      if (typeof destKey === 'string' && destKey.startsWith('custom_')) {
        customFieldLabels[destKey] = srcCol;
      }
    }
    if (Object.keys(customFieldLabels).length > 0) {
      log.info(`커스텀 필드 라벨 자동 유도: ${Object.keys(customFieldLabels).length}개 (mapping.customers 역추출)`);
    }
  }
  const hasCustomFieldLabels = Object.keys(customFieldLabels).length > 0;

  if (hasCustomFieldLabels) {
    log.info(`커스텀 필드 라벨: ${Object.keys(customFieldLabels).length}개`);
    for (const [slot, label] of Object.entries(customFieldLabels)) {
      log.info(`  ${slot} → ${label}`);
    }
  }

  // ★ D137 D10 근본: `!isFieldDefinitionsRegistered()` 체크 제거 — Agent 시작 시마다 재등록.
  //   서버 CT-07 upsertCustomFieldDefinitions는 idempotent (ON CONFLICT DO UPDATE) →
  //   중복 호출해도 안전. 라벨 변경/신규 커스텀 필드 추가 시 자동 반영 보장.
  //   (isFieldDefinitionsRegistered state는 하위호환/로깅용으로 남겨둠.)
  if (!DRY_RUN && apiClient && hasCustomFieldLabels) {
    try {
      const definitions = Object.entries(customFieldLabels).map(([key, label]) => ({
        field_key: key,
        field_label: label,
        field_type: 'string' as const,
      }));

      // ★ D131 후속(2026-04-21): api/client.ts의 registerFieldDefinitions는 실패 시 null 반환
      //   (내부 catch로 warn만 찍고 resolve). 이전엔 반환값 무시하고 "✅ 완료" 오기 로그가 찍혔고
      //   실패해도 setFieldDefinitionsRegistered(true)가 설정되어 재시도 기회를 잃었음.
      const result = await apiClient.registerFieldDefinitions({ definitions });
      if (result !== null) {
        syncState.setFieldDefinitionsRegistered(true);
        log.info(`✅ 커스텀 필드 정의 서버 등록 완료 (${definitions.length}개)`);
      } else {
        // result=null: api/client.ts가 이미 warn 로그 찍음. 다음 실행 때 재시도.
        log.warn('커스텀 필드 정의 서버 등록 실패 — 다음 실행 시 재시도');
      }
    } catch (error) {
      log.warn('커스텀 필드 정의 등록 실패 (동기화는 계속 진행)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 9. 동기화 엔진 생성 (alertManager 전달)
  const customerMapping = hasCustomerMapping
    ? config.mapping.customers
    : getDefaultCustomerMapping();

  const purchaseMapping = hasPurchaseMapping
    ? config.mapping.purchases
    : getDefaultPurchaseMapping();

  const engine = new SyncEngine(db, apiClient, syncState, {
    batchSize: config.sync.batchSize,
    customerTable: config.sync.customerTable,
    purchaseTable: config.sync.purchaseTable,
    timestampColumn: config.sync.timestampColumn,
    customerTimestampColumn: config.sync.customerTimestampColumn,
    purchaseTimestampColumn: config.sync.purchaseTimestampColumn,
    // ★ 2026-08-13 뷰 소스 지정 키(마법사가 유일성 실측 후 저장) — 메타 PK 없는 소스의 증분·멱등을 연다
    customerKeyColumns: config.sync.customerKeyColumns,
    purchaseKeyColumns: config.sync.purchaseKeyColumns,
    fallbackToFullSync: config.sync.fallbackToFullSync,
    customerMapping,
    purchaseMapping,
    dryRun: DRY_RUN,
  }, queue, alertManager);

  // 9.5. 타임스탬프 컬럼 실재 검증 (★ 2026-06-11 — 인비토 SyncTest updated_at 부재 실측)
  //   누락이면 여기서 즉시 경고 — 60분 뒤 첫 증분 주기에서야 드러나는 일 차단.
  //   증분 실행 시에는 engine.runIncremental이 전체 동기화로 대체(fallbackToFullSync)한다.
  try {
    await engine.validateTimestampColumnsAtStartup();
  } catch (error) {
    log.warn('타임스탬프 컬럼 기동 검증 실패 (동기화는 계속 진행)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 10. 최초 동기화
  const isFirstRun = !state.lastFullSyncAt;

  if (isFirstRun) {
    log.info('');
    log.info('━━━ 최초 실행 — 전체 동기화 ━━━');
  } else {
    log.info('');
    log.info('━━━ 증분 동기화 ━━━');
  }

  const customerResult = isFirstRun
    ? await engine.runFull('customers')
    : await engine.runIncremental('customers');

  const purchaseResult = isFirstRun
    ? await engine.runFull('purchases')
    : await engine.runIncremental('purchases');

  // 결과 요약
  log.info('');
  log.info('══════════ 동기화 결과 요약 ══════════');
  log.info(`고객: ${customerResult.successCount}/${customerResult.totalCount}건 성공 (${customerResult.durationMs}ms)`);
  log.info(`구매: ${purchaseResult.successCount}/${purchaseResult.totalCount}건 성공 (${purchaseResult.durationMs}ms)`);
  if (customerResult.errors.length + purchaseResult.errors.length > 0) {
    log.warn(`오류: 고객 ${customerResult.errors.length}건, 구매 ${purchaseResult.errors.length}건`);
  }
  log.info('══════════════════════════════════════');

  // 11. 스케줄러 시작
  if (DRY_RUN) {
    log.info('');
    if (USE_MOCK) {
      log.info('🧪 Mock 모드 — 스케줄러 없이 종료');
    } else {
      log.info('🧪 DRY RUN — 스케줄러 없이 종료');
    }
  } else {
    // ★ D131 후속(2026-04-21): HeartbeatManager 생성하되 첫 send()는 나중으로 미룸.
    //   scheduler 생성 + setCommandHandler 등록 후에 전송해야 commands 수신 시 실제 실행됨.
    //   (기존 순서: new Heartbeat → send → new Scheduler → setCommandHandler → 첫 heartbeat가 handler 없이 실행되어 명령 유실)
    let heartbeat: HeartbeatManager | null = null;
    if (apiClient) {
      heartbeat = new HeartbeatManager(apiClient, syncState, queue, config, alertManager);
    }

    // ★ v1.4.1: 구매 테이블 빈 문자열이면 enablePurchase=false (구매 동기화 자체를 스킵)
    const enablePurchase = !!config.sync.purchaseTable;
    const scheduler = new Scheduler(engine, heartbeat, queue, apiClient, {
      customerIntervalMin: config.sync.customerInterval,
      purchaseIntervalMin: config.sync.purchaseInterval,
      enablePurchase,
    }, syncState);

    // v1.5.0: 싱크 응답 config → 스케줄러 재시작 트리거 연결
    if (apiClient) {
      apiClient.setRemoteConfigHandler((remoteConfig) => {
        scheduler.applyRemoteConfig(remoteConfig);
      });
    }

    // ★ 2026-07-01: 원격 update_config 매핑 갱신 → config.enc 영구 저장 + 필드정의 재등록.
    //   engine 런타임 교체는 scheduler가 담당, 여기서는 영속화(재시작해도 유지)와 라벨 재등록만.
    scheduler.setMappingUpdateHandler(async (mapping) => {
      try {
        updateConfigEncrypted((current) => ({
          ...current,
          mapping: {
            customers: mapping.customers ?? current.mapping.customers,
            purchases: mapping.purchases ?? current.mapping.purchases,
            customFieldLabels: mapping.customFieldLabels ?? current.mapping.customFieldLabels,
          },
        }));
        // ★ v1.6.1: 메모리 config도 동기 갱신 — heartbeat 자기 보고(customFieldLabels)가 최신을 반영하도록.
        config.mapping = {
          customers: mapping.customers ?? config.mapping.customers,
          purchases: mapping.purchases ?? config.mapping.purchases,
          customFieldLabels: mapping.customFieldLabels ?? config.mapping.customFieldLabels,
        };
        log.info('원격 매핑 갱신 — config.enc 영구 저장 완료');
      } catch (error) {
        log.error('원격 매핑 config.enc 저장 실패', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      // custom 라벨 변경 시 서버 필드정의 재등록 (화면 표시명 반영)
      if (mapping.customFieldLabels && apiClient) {
        try {
          const definitions = Object.entries(mapping.customFieldLabels).map(([key, label]) => ({
            field_key: key,
            field_label: label,
            field_type: 'string' as const,
          }));
          await apiClient.registerFieldDefinitions({ definitions });
          log.info(`원격 매핑 — 필드정의 재등록 ${definitions.length}건`);
        } catch (error) {
          log.warn('원격 매핑 필드정의 재등록 실패', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });

    // ★ D131 후속(2026-04-21): heartbeat 응답의 commands도 scheduler로 연결.
    //   싱크 요청 0건이면 응답 자체가 없어 명령 수신 못 하는 문제 해결.
    if (heartbeat) {
      heartbeat.setCommandHandler((commands) => {
        scheduler.applyRemoteConfig({ commands });
      });
    }

    // ★ v1.6.1 (P0-1): heartbeat 자기 보고 — 적용 매핑(런타임 진실)+매핑 해시+소스 컬럼(6시간 캐시).
    //   서버가 config.reported에 사본을 저장해 슈퍼관리자 매핑 모달 프리필/드롭다운의 원천이 된다.
    if (heartbeat) {
      const SOURCE_COLUMNS_TTL_MS = 6 * 60 * 60 * 1000;
      let srcColsCache: { at: number; value: { customers?: string[]; purchases?: string[] } } | null = null;
      heartbeat.setReportProvider(async () => {
        const applied = engine.getMapping();
        const appliedMapping = {
          customers: applied.customers || {},
          purchases: applied.purchases || {},
          customFieldLabels: config.mapping.customFieldLabels || {},
        };
        const configVersion = createHash('sha1')
          .update(JSON.stringify(appliedMapping))
          .digest('hex')
          .slice(0, 12);
        if (!srcColsCache || Date.now() - srcColsCache.at > SOURCE_COLUMNS_TTL_MS) {
          srcColsCache = { at: Date.now(), value: await engine.getSourceColumns() };
        }
        return {
          configVersion,
          appliedMapping,
          sourceColumns: srcColsCache.value,
          sourceColumnsAt: new Date(srcColsCache.at).toISOString(),
        };
      });
      // ★ v1.6.1 (P1-6): boost 지시 → 스케줄러 heartbeat 임시 단축
      heartbeat.setBoostHandler((intervalMinutes, until) => {
        scheduler.boostHeartbeat(intervalMinutes, until);
      });
    }

    // ★ D131 후속: 모든 handler 등록 완료 후 첫 heartbeat 전송 (명령 즉시 실행 가능)
    if (heartbeat) {
      await heartbeat.send();
    }

    scheduler.start();

    log.info('');
    log.info('✅ Sync Agent 가동 중 (Ctrl+C로 종료)');
    log.info(`   고객 동기화: 매 ${config.sync.customerInterval}분`);
    log.info(`   구매 동기화: ${enablePurchase ? `매 ${config.sync.purchaseInterval}분` : '미사용 (구매 테이블 미설정)'}`);
    log.info(`   Heartbeat: 매 60분`);
    log.info(`   큐 재전송: 매 30분`);

    // 12. Graceful Shutdown
    const shutdown = async (signal: string) => {
      log.info(`${signal} 수신 — 종료 중...`);
      scheduler.stop();
      queue.close();
      try {
        await db.disconnect();
        log.info('DB 연결 해제 완료');
      } catch (error) {
        log.error('DB 연결 해제 실패', { error });
      }
      log.info('Sync Agent 종료');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}

// ─── 기본 매핑 ──────────────────────────────────────────

function getDefaultCustomerMapping(): Record<string, string> {
  return {
    'CUST_HP': 'phone',
    'CUST_NM': 'name',
    'SEX_CD': 'gender',
    'BIRTH_DT': 'birth_date',
    'GRADE_CD': 'grade',
    'ADDR': 'region',
    'SMS_YN': 'sms_opt_in',
    'EMAIL': 'email',
    'POINT': 'points',
    'STORE_CD': 'store_code',
    'STORE_NM': 'store_name',
    'LAST_BUY_DT': 'recent_purchase_date',
    'LAST_BUY_AMT': 'recent_purchase_amount',
    'TOT_BUY_AMT': 'total_purchase_amount',
    'BUY_CNT': 'purchase_count',
  };
}

function getDefaultPurchaseMapping(): Record<string, string> {
  return {
    'CUST_HP': 'customer_phone',
    'BUY_DT': 'purchase_date',
    'STORE_CD': 'store_code',
    'STORE_NM': 'store_name',
    'PROD_CD': 'product_code',
    'PROD_NM': 'product_name',
    'QTY': 'quantity',
    'UNIT_PRC': 'unit_price',
    'TOT_AMT': 'total_amount',
  };
}

// ─── 실행 ───────────────────────────────────────────────

// ★ D137 D8 근본: Windows 서비스 안정성 강화 —
//   unhandledRejection / uncaughtException 은 로그만 남기고 프로세스 유지.
//   (기존에는 Node 기본 동작으로 크래시 → Windows 서비스 복구 설정이 '아무 작업도 안 함'이면 재시작 안 됨)
//   네트워크/DB 일시 장애에서도 Agent가 계속 돌아가 다음 사이클에 회복됨.
//   치명적 초기화 실패(설정 로드/DB 연결)만 main.catch → process.exit(1).
process.on('unhandledRejection', (reason) => {
  try {
    const log = getLogger('main');
    log.error('Unhandled Rejection (서비스 유지)', { reason: reason instanceof Error ? reason.message : String(reason) });
  } catch {
    console.error('[unhandledRejection]', reason);
  }
});

process.on('uncaughtException', (err) => {
  try {
    const log = getLogger('main');
    log.error('Uncaught Exception (서비스 유지)', { error: err?.message, stack: err?.stack });
  } catch {
    console.error('[uncaughtException]', err);
  }
});

main().catch((error) => {
  console.error('치명적 오류:', error);
  process.exit(1);
});
