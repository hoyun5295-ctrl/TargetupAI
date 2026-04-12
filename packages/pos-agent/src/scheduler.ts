/**
 * POS Agent 주기적 작업 스케줄러
 *
 * - 판매: 5분 간격
 * - 회원: 30분 간격
 * - 재고: 60분 간격
 * - 하트비트: 1분 간격
 */

import cron from 'node-cron';
import { getConfig } from './config';
import { sendHeartbeat, fetchConfig } from './server-client';
import { extractAndPushSales, extractAndPushMembers, extractAndPushInventory } from './data-extractor';
import { isConnected } from './db-connector';
import { logger } from './logger';

let heartbeatTask: cron.ScheduledTask | null = null;
let salesTask: cron.ScheduledTask | null = null;
let membersTask: cron.ScheduledTask | null = null;
let inventoryTask: cron.ScheduledTask | null = null;
let configTask: cron.ScheduledTask | null = null;

let schemaMapping: any = null;
let errorCount24h = 0;

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
    } catch (err: any) {
      logger.error('하트비트 실패:', err.message);
    }
  });

  // 판매 데이터: 매 5분
  salesTask = cron.schedule(`*/${config.sync.salesIntervalMinutes} * * * *`, async () => {
    if (!isConnected() || !schemaMapping) return;
    try {
      await extractAndPushSales(schemaMapping);
    } catch (err: any) {
      errorCount24h++;
      logger.error('판매 추출 스케줄 실패:', err.message);
    }
  });

  // 회원 데이터: 매 30분
  membersTask = cron.schedule(`*/${config.sync.membersIntervalMinutes} * * * *`, async () => {
    if (!isConnected() || !schemaMapping) return;
    try {
      await extractAndPushMembers(schemaMapping);
    } catch (err: any) {
      errorCount24h++;
      logger.error('회원 추출 스케줄 실패:', err.message);
    }
  });

  // 재고 스냅샷: 매 60분
  inventoryTask = cron.schedule('0 * * * *', async () => {
    if (!isConnected() || !schemaMapping) return;
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

  // 24시간마다 에러 카운트 리셋
  cron.schedule('0 0 * * *', () => { errorCount24h = 0; });

  logger.info(`스케줄: 판매=${config.sync.salesIntervalMinutes}분, 회원=${config.sync.membersIntervalMinutes}분, 재고=${config.sync.inventoryIntervalMinutes}분`);
}

/** 모든 스케줄러 중지 */
export function stopScheduler(): void {
  heartbeatTask?.stop();
  salesTask?.stop();
  membersTask?.stop();
  inventoryTask?.stop();
  configTask?.stop();
  logger.info('스케줄러 중지');
}
