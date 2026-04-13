/**
 * POS Agent 주기적 작업 스케줄러
 *
 * - 판매: N분 간격 (config 동적)
 * - 회원: N분 간격 (config 동적)
 * - 재고: N분 간격 (config 동적)
 * - 하트비트: 1분 간격
 * - 서버 설정 갱신: 10분 간격
 *
 * ⚠️ 에러 카운트: KST 자정 기준 리셋
 * ⚠️ 하트비트 연속 실패 시 경고 로그
 */

import cron from 'node-cron';
import { getConfig } from './config';
import { sendHeartbeat, fetchConfig } from './server-client';
import { extractAndPushSales, extractAndPushMembers, extractAndPushInventory } from './data-extractor';
import { isConnected, connect } from './db-connector';
import { logger } from './logger';

let heartbeatTask: cron.ScheduledTask | null = null;
let salesTask: cron.ScheduledTask | null = null;
let membersTask: cron.ScheduledTask | null = null;
let inventoryTask: cron.ScheduledTask | null = null;
let configTask: cron.ScheduledTask | null = null;
let resetTask: cron.ScheduledTask | null = null;

let schemaMapping: any = null;
let errorCount24h = 0;
let heartbeatFailCount = 0;

export function setSchemaMapping(mapping: any) {
  schemaMapping = mapping;
}

/** 모든 스케줄러 시작 */
export function startScheduler(): void {
  const config = getConfig();
  logger.info('스케줄러 시작');

  // 하트비트: 매 1분
  heartbeatTask = cron.schedule('* * * * *', async () => {
    try {
      await sendHeartbeat({
        last_sync_at: config.lastSalesSync || new Date().toISOString(),
        pending_count: 0,
        error_count_24h: errorCount24h,
      });
      if (heartbeatFailCount > 0) {
        logger.info(`서버 연결 복구 (연속 ${heartbeatFailCount}회 실패 후)`);
        heartbeatFailCount = 0;
      }
    } catch (err: any) {
      heartbeatFailCount++;
      if (heartbeatFailCount <= 3 || heartbeatFailCount % 10 === 0) {
        logger.error(`하트비트 실패 (연속 ${heartbeatFailCount}회): ${err.message}`);
      }
      if (heartbeatFailCount === 10) {
        logger.warn('서버 연결 10분 이상 끊김 — 인터넷 연결을 확인하세요.');
      }
    }
  });

  // 판매 데이터: config 동적
  salesTask = cron.schedule(`*/${config.sync.salesIntervalMinutes} * * * *`, async () => {
    if (!schemaMapping) return;
    if (!isConnected()) { await tryReconnect(); if (!isConnected()) return; }
    try {
      await extractAndPushSales(schemaMapping);
    } catch (err: any) {
      errorCount24h++;
      logger.error('판매 추출 스케줄 실패:', err.message);
    }
  });

  // 회원 데이터: config 동적
  membersTask = cron.schedule(`*/${config.sync.membersIntervalMinutes} * * * *`, async () => {
    if (!schemaMapping) return;
    if (!isConnected()) { await tryReconnect(); if (!isConnected()) return; }
    try {
      await extractAndPushMembers(schemaMapping);
    } catch (err: any) {
      errorCount24h++;
      logger.error('회원 추출 스케줄 실패:', err.message);
    }
  });

  // 재고 스냅샷: config 동적 (하드코딩 제거)
  inventoryTask = cron.schedule(`*/${config.sync.inventoryIntervalMinutes} * * * *`, async () => {
    if (!schemaMapping) return;
    if (!isConnected()) { await tryReconnect(); if (!isConnected()) return; }
    try {
      await extractAndPushInventory(schemaMapping);
    } catch (err: any) {
      errorCount24h++;
      logger.error('재고 추출 스케줄 실패:', err.message);
    }
  });

  // 서버 설정 갱신: 매 10분
  configTask = cron.schedule('*/10 * * * *', async () => {
    try {
      const res = await fetchConfig();
      if (res.ok && res.data?.schemaMapping) {
        schemaMapping = res.data.schemaMapping;
      }
    } catch (err: any) {
      logger.warn('설정 갱신 실패:', err.message);
    }
  });

  // 24시간마다 에러 카운트 리셋 — KST 자정 (UTC 15:00)
  resetTask = cron.schedule('0 15 * * *', () => {
    logger.info(`에러 카운트 리셋 (오늘 ${errorCount24h}건)`);
    errorCount24h = 0;
  });

  logger.info(`스케줄: 판매=${config.sync.salesIntervalMinutes}분, 회원=${config.sync.membersIntervalMinutes}분, 재고=${config.sync.inventoryIntervalMinutes}분`);
}

/** DB 재연결 시도 */
async function tryReconnect(): Promise<void> {
  logger.warn('DB 연결 끊김 — 재연결 시도');
  try {
    await connect();
  } catch (err: any) {
    logger.error('DB 재연결 실패:', err.message);
  }
}

/** 모든 스케줄러 중지 */
export function stopScheduler(): void {
  heartbeatTask?.stop();
  salesTask?.stop();
  membersTask?.stop();
  inventoryTask?.stop();
  configTask?.stop();
  resetTask?.stop();
  logger.info('스케줄러 중지');
}
