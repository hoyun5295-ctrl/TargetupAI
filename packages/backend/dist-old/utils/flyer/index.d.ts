/**
 * ★ 전단AI 컨트롤타워 인덱스
 *
 * 도메인별 분리 구조 (D118):
 *   send/     — 발송 도메인 (CT-F01~F08)
 *   product/  — 상품/전단 도메인 (CT-F11, CT-F14, CT-F17 + 보조)
 *   pos/      — POS 도메인 (CT-F12, CT-F16)
 *   coupon/   — 쿠폰 도메인 (CT-F15)
 *   billing/  — 과금 도메인 (CT-F03)
 *   analytics/ — 분석 도메인 (CT-F09, CT-F10)
 *   config/   — 설정 도메인 (CT-F13)
 *
 * 라우트에서 import 시:
 *   import { sendFlyerCampaign, getFlyerDashboardStats } from '../../utils/flyer';
 *
 * ⚠️ 전단AI 라우트는 이 CT를 통해야 한다. 인라인 로직 금지.
 * ⚠️ 한줄로 코드(utils/ 루트) 절대 건드리지 않음.
 */
export { getFlyerCompanySmsTables, invalidateFlyerLineGroupCache, toQtmsgType, bulkInsertSmsQueue, insertTestSmsQueue, getTestSmsTables, getAuthSmsTable, } from './send/flyer-sms-queue';
export { buildFlyerUnsubscribeFilter, registerFlyerUnsubscribe, isFlyerUnsubscribed, getFlyerUnsubscribes, deleteFlyerUnsubscribes, filterOutFlyerUnsubscribed, } from './send/flyer-unsubscribe-helper';
export { buildFlyerCustomerFilter, countFlyerCustomers, selectFlyerCustomers, } from './send/flyer-customer-filter';
export type { FlyerFilterInput } from './send/flyer-customer-filter';
export { replaceFlyerVariables, buildFlyerAdMessage, stripFlyerAdParts, prepareFlyerSendMessage, } from './send/flyer-message';
export { getFlyerCallbackNumbers, resolveFlyerCallback, } from './send/flyer-callback-filter';
export { deduplicateFlyerRecipients, deduplicateWithStats, } from './send/flyer-deduplicate';
export { sendFlyerCampaign } from './send/flyer-send';
export type { FlyerSendParams, FlyerSendResult } from './send/flyer-send';
export { aggregateFlyerMonthlyUsage, recordFlyerMonthlyBilling, canFlyerCompanySend, canFlyerStoreSend, deductFlyerPrepaid, refundFlyerPrepaid, } from './billing/flyer-billing';
export { getCatalogItems, touchCatalogUsage, upsertCatalogItem, } from './product/flyer-catalog';
export { renderTemplate } from './product/flyer-templates';
export type { FlyerRenderData, FlyerRenderItem } from './product/flyer-templates';
export { searchNaverShopping, downloadAndSaveImage, autoMatchImage, batchAutoMatchImages, } from './product/flyer-naver-search';
export type { NaverShopItem, ImageSearchResult } from './product/flyer-naver-search';
export { verifyPosAgent, ingestSales, ingestInventory, ingestMembers, ingestPromotions, updateAgentHeartbeat, getTopSellingProducts, getPosAgentStatusList, } from './pos/flyer-pos-ingest';
export { analyzeSchema, saveSchemaMapping, getSchemaMapping, detectPhoneFormat, } from './pos/flyer-pos-ai';
export type { PosRawSchema, SchemaMapping, PosTableInfo, PosColumnInfo } from './pos/flyer-pos-ai';
export { createCouponCampaign, listCouponCampaigns, getCouponCampaign, updateCouponCampaign, disableCouponCampaign, getCampaignByQrCode, claimCoupon, redeemCoupon, lookupCouponsByPhone, getCouponStats, listCoupons, generateQrDataUrl, renderCouponPage, buildCouponSmsMessage, } from './coupon/flyer-coupons';
export type { CouponCampaign, CouponStats, ClaimResult, RedeemResult, CouponDashboardData } from './coupon/flyer-coupons';
export { getCouponDashboard } from './coupon/flyer-coupons';
export { getFlyerDashboardStats, getFlyerCampaignResults, } from './analytics/flyer-stats';
export { calculateCustomerRfm, recalculateAllRfm, getRfmSegmentCounts, } from './analytics/flyer-rfm';
export { getBusinessTypes, getBusinessType, getCategoryPresets, getAvailableTemplates, getAllBusinessTypes, TEMPLATE_REGISTRY, invalidateBusinessTypeCache, } from './config/flyer-business-types';
export type { BusinessType, TemplateInfo } from './config/flyer-business-types';
//# sourceMappingURL=index.d.ts.map