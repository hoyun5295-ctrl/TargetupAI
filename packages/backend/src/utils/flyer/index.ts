/**
 * ★ 전단AI 컨트롤타워 인덱스 (CT-F01 ~ CT-F12)
 *
 * 라우트에서 import 시:
 *   import { sendFlyerCampaign, getFlyerDashboardStats } from '../../utils/flyer';
 *
 * ⚠️ 전단AI 라우트는 이 CT를 통해야 한다. 인라인 로직 금지.
 */

// CT-F01: SMS 큐
export {
  getFlyerCompanySmsTables,
  invalidateFlyerLineGroupCache,
  toQtmsgType,
  bulkInsertSmsQueue,
  insertTestSmsQueue,
  getTestSmsTables,
  getAuthSmsTable,
} from './flyer-sms-queue';

// CT-F02: 수신거부
export {
  buildFlyerUnsubscribeFilter,
  registerFlyerUnsubscribe,
  isFlyerUnsubscribed,
  getFlyerUnsubscribes,
  deleteFlyerUnsubscribes,
  filterOutFlyerUnsubscribed,
} from './flyer-unsubscribe-helper';

// CT-F03: 과금/결제
export {
  aggregateFlyerMonthlyUsage,
  recordFlyerMonthlyBilling,
  canFlyerCompanySend,
} from './flyer-billing';

// CT-F04: 고객 필터
export {
  buildFlyerCustomerFilter,
  countFlyerCustomers,
  selectFlyerCustomers,
} from './flyer-customer-filter';
export type { FlyerFilterInput } from './flyer-customer-filter';

// CT-F05: 메시지 치환 + 광고
export {
  replaceFlyerVariables,
  buildFlyerAdMessage,
  stripFlyerAdParts,
  prepareFlyerSendMessage,
} from './flyer-message';

// CT-F06: 회신번호
export {
  getFlyerCallbackNumbers,
  resolveFlyerCallback,
} from './flyer-callback-filter';

// CT-F07: 중복제거
export {
  deduplicateFlyerRecipients,
  deduplicateWithStats,
} from './flyer-deduplicate';

// CT-F08: 발송 오케스트레이터
export { sendFlyerCampaign } from './flyer-send';
export type { FlyerSendParams, FlyerSendResult } from './flyer-send';

// CT-F09: 통계
export {
  getFlyerDashboardStats,
  getFlyerCampaignResults,
} from './flyer-stats';

// CT-F10: RFM (Phase B)
export {
  calculateCustomerRfm,
  recalculateAllRfm,
  getRfmSegmentCounts,
} from './flyer-rfm';

// CT-F11: 카탈로그 (Phase A)
export {
  getCatalogItems,
  touchCatalogUsage,
  upsertCatalogItem,
} from './flyer-catalog';

// CT-F12: POS 데이터 수신 (Phase B)
export {
  verifyPosAgent,
  ingestSales,
  ingestInventory,
  ingestMembers,
  updateAgentHeartbeat,
} from './flyer-pos-ingest';
