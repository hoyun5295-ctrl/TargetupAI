"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSchemaMapping = exports.saveSchemaMapping = exports.analyzeSchema = exports.getPosAgentStatusList = exports.getTopSellingProducts = exports.updateAgentHeartbeat = exports.ingestPromotions = exports.ingestMembers = exports.ingestInventory = exports.ingestSales = exports.verifyPosAgent = exports.batchAutoMatchImages = exports.autoMatchImage = exports.downloadAndSaveImage = exports.searchNaverShopping = exports.renderTemplate = exports.upsertCatalogItem = exports.touchCatalogUsage = exports.getCatalogItems = exports.refundFlyerPrepaid = exports.deductFlyerPrepaid = exports.canFlyerStoreSend = exports.canFlyerCompanySend = exports.recordFlyerMonthlyBilling = exports.aggregateFlyerMonthlyUsage = exports.sendFlyerCampaign = exports.deduplicateWithStats = exports.deduplicateFlyerRecipients = exports.resolveFlyerCallback = exports.getFlyerCallbackNumbers = exports.prepareFlyerSendMessage = exports.stripFlyerAdParts = exports.buildFlyerAdMessage = exports.replaceFlyerVariables = exports.selectFlyerCustomers = exports.countFlyerCustomers = exports.buildFlyerCustomerFilter = exports.filterOutFlyerUnsubscribed = exports.deleteFlyerUnsubscribes = exports.getFlyerUnsubscribes = exports.isFlyerUnsubscribed = exports.registerFlyerUnsubscribe = exports.buildFlyerUnsubscribeFilter = exports.getAuthSmsTable = exports.getTestSmsTables = exports.insertTestSmsQueue = exports.bulkInsertSmsQueue = exports.toQtmsgType = exports.invalidateFlyerLineGroupCache = exports.getFlyerCompanySmsTables = void 0;
exports.invalidateBusinessTypeCache = exports.TEMPLATE_REGISTRY = exports.getAllBusinessTypes = exports.getAvailableTemplates = exports.getCategoryPresets = exports.getBusinessType = exports.getBusinessTypes = exports.getRfmSegmentCounts = exports.recalculateAllRfm = exports.calculateCustomerRfm = exports.getFlyerCampaignResults = exports.getFlyerDashboardStats = exports.getCouponDashboard = exports.buildCouponSmsMessage = exports.renderCouponPage = exports.generateQrDataUrl = exports.listCoupons = exports.getCouponStats = exports.lookupCouponsByPhone = exports.redeemCoupon = exports.claimCoupon = exports.getCampaignByQrCode = exports.disableCouponCampaign = exports.updateCouponCampaign = exports.getCouponCampaign = exports.listCouponCampaigns = exports.createCouponCampaign = exports.detectPhoneFormat = void 0;
// ═══════════════════════════════════════════
// send/ — 발송 도메인
// ═══════════════════════════════════════════
// CT-F01: SMS 큐
var flyer_sms_queue_1 = require("./send/flyer-sms-queue");
Object.defineProperty(exports, "getFlyerCompanySmsTables", { enumerable: true, get: function () { return flyer_sms_queue_1.getFlyerCompanySmsTables; } });
Object.defineProperty(exports, "invalidateFlyerLineGroupCache", { enumerable: true, get: function () { return flyer_sms_queue_1.invalidateFlyerLineGroupCache; } });
Object.defineProperty(exports, "toQtmsgType", { enumerable: true, get: function () { return flyer_sms_queue_1.toQtmsgType; } });
Object.defineProperty(exports, "bulkInsertSmsQueue", { enumerable: true, get: function () { return flyer_sms_queue_1.bulkInsertSmsQueue; } });
Object.defineProperty(exports, "insertTestSmsQueue", { enumerable: true, get: function () { return flyer_sms_queue_1.insertTestSmsQueue; } });
Object.defineProperty(exports, "getTestSmsTables", { enumerable: true, get: function () { return flyer_sms_queue_1.getTestSmsTables; } });
Object.defineProperty(exports, "getAuthSmsTable", { enumerable: true, get: function () { return flyer_sms_queue_1.getAuthSmsTable; } });
// CT-F02: 수신거부
var flyer_unsubscribe_helper_1 = require("./send/flyer-unsubscribe-helper");
Object.defineProperty(exports, "buildFlyerUnsubscribeFilter", { enumerable: true, get: function () { return flyer_unsubscribe_helper_1.buildFlyerUnsubscribeFilter; } });
Object.defineProperty(exports, "registerFlyerUnsubscribe", { enumerable: true, get: function () { return flyer_unsubscribe_helper_1.registerFlyerUnsubscribe; } });
Object.defineProperty(exports, "isFlyerUnsubscribed", { enumerable: true, get: function () { return flyer_unsubscribe_helper_1.isFlyerUnsubscribed; } });
Object.defineProperty(exports, "getFlyerUnsubscribes", { enumerable: true, get: function () { return flyer_unsubscribe_helper_1.getFlyerUnsubscribes; } });
Object.defineProperty(exports, "deleteFlyerUnsubscribes", { enumerable: true, get: function () { return flyer_unsubscribe_helper_1.deleteFlyerUnsubscribes; } });
Object.defineProperty(exports, "filterOutFlyerUnsubscribed", { enumerable: true, get: function () { return flyer_unsubscribe_helper_1.filterOutFlyerUnsubscribed; } });
// CT-F04: 고객 필터
var flyer_customer_filter_1 = require("./send/flyer-customer-filter");
Object.defineProperty(exports, "buildFlyerCustomerFilter", { enumerable: true, get: function () { return flyer_customer_filter_1.buildFlyerCustomerFilter; } });
Object.defineProperty(exports, "countFlyerCustomers", { enumerable: true, get: function () { return flyer_customer_filter_1.countFlyerCustomers; } });
Object.defineProperty(exports, "selectFlyerCustomers", { enumerable: true, get: function () { return flyer_customer_filter_1.selectFlyerCustomers; } });
// CT-F05: 메시지 치환 + 광고
var flyer_message_1 = require("./send/flyer-message");
Object.defineProperty(exports, "replaceFlyerVariables", { enumerable: true, get: function () { return flyer_message_1.replaceFlyerVariables; } });
Object.defineProperty(exports, "buildFlyerAdMessage", { enumerable: true, get: function () { return flyer_message_1.buildFlyerAdMessage; } });
Object.defineProperty(exports, "stripFlyerAdParts", { enumerable: true, get: function () { return flyer_message_1.stripFlyerAdParts; } });
Object.defineProperty(exports, "prepareFlyerSendMessage", { enumerable: true, get: function () { return flyer_message_1.prepareFlyerSendMessage; } });
// CT-F06: 회신번호
var flyer_callback_filter_1 = require("./send/flyer-callback-filter");
Object.defineProperty(exports, "getFlyerCallbackNumbers", { enumerable: true, get: function () { return flyer_callback_filter_1.getFlyerCallbackNumbers; } });
Object.defineProperty(exports, "resolveFlyerCallback", { enumerable: true, get: function () { return flyer_callback_filter_1.resolveFlyerCallback; } });
// CT-F07: 중복제거
var flyer_deduplicate_1 = require("./send/flyer-deduplicate");
Object.defineProperty(exports, "deduplicateFlyerRecipients", { enumerable: true, get: function () { return flyer_deduplicate_1.deduplicateFlyerRecipients; } });
Object.defineProperty(exports, "deduplicateWithStats", { enumerable: true, get: function () { return flyer_deduplicate_1.deduplicateWithStats; } });
// CT-F08: 발송 오케스트레이터 (★ 발송 도메인 유일한 외부 진입점)
var flyer_send_1 = require("./send/flyer-send");
Object.defineProperty(exports, "sendFlyerCampaign", { enumerable: true, get: function () { return flyer_send_1.sendFlyerCampaign; } });
// ═══════════════════════════════════════════
// billing/ — 과금 도메인
// ═══════════════════════════════════════════
// CT-F03: 과금/결제
var flyer_billing_1 = require("./billing/flyer-billing");
Object.defineProperty(exports, "aggregateFlyerMonthlyUsage", { enumerable: true, get: function () { return flyer_billing_1.aggregateFlyerMonthlyUsage; } });
Object.defineProperty(exports, "recordFlyerMonthlyBilling", { enumerable: true, get: function () { return flyer_billing_1.recordFlyerMonthlyBilling; } });
Object.defineProperty(exports, "canFlyerCompanySend", { enumerable: true, get: function () { return flyer_billing_1.canFlyerCompanySend; } });
Object.defineProperty(exports, "canFlyerStoreSend", { enumerable: true, get: function () { return flyer_billing_1.canFlyerStoreSend; } });
Object.defineProperty(exports, "deductFlyerPrepaid", { enumerable: true, get: function () { return flyer_billing_1.deductFlyerPrepaid; } });
Object.defineProperty(exports, "refundFlyerPrepaid", { enumerable: true, get: function () { return flyer_billing_1.refundFlyerPrepaid; } });
// ═══════════════════════════════════════════
// product/ — 상품/전단 도메인
// ═══════════════════════════════════════════
// CT-F11: 카탈로그
var flyer_catalog_1 = require("./product/flyer-catalog");
Object.defineProperty(exports, "getCatalogItems", { enumerable: true, get: function () { return flyer_catalog_1.getCatalogItems; } });
Object.defineProperty(exports, "touchCatalogUsage", { enumerable: true, get: function () { return flyer_catalog_1.touchCatalogUsage; } });
Object.defineProperty(exports, "upsertCatalogItem", { enumerable: true, get: function () { return flyer_catalog_1.upsertCatalogItem; } });
// CT-F14: 템플릿 렌더링 엔진
var flyer_templates_1 = require("./product/flyer-templates");
Object.defineProperty(exports, "renderTemplate", { enumerable: true, get: function () { return flyer_templates_1.renderTemplate; } });
// CT-F17: 네이버 쇼핑 이미지 검색
var flyer_naver_search_1 = require("./product/flyer-naver-search");
Object.defineProperty(exports, "searchNaverShopping", { enumerable: true, get: function () { return flyer_naver_search_1.searchNaverShopping; } });
Object.defineProperty(exports, "downloadAndSaveImage", { enumerable: true, get: function () { return flyer_naver_search_1.downloadAndSaveImage; } });
Object.defineProperty(exports, "autoMatchImage", { enumerable: true, get: function () { return flyer_naver_search_1.autoMatchImage; } });
Object.defineProperty(exports, "batchAutoMatchImages", { enumerable: true, get: function () { return flyer_naver_search_1.batchAutoMatchImages; } });
// ═══════════════════════════════════════════
// pos/ — POS 도메인
// ═══════════════════════════════════════════
// CT-F12: POS 데이터 수신
var flyer_pos_ingest_1 = require("./pos/flyer-pos-ingest");
Object.defineProperty(exports, "verifyPosAgent", { enumerable: true, get: function () { return flyer_pos_ingest_1.verifyPosAgent; } });
Object.defineProperty(exports, "ingestSales", { enumerable: true, get: function () { return flyer_pos_ingest_1.ingestSales; } });
Object.defineProperty(exports, "ingestInventory", { enumerable: true, get: function () { return flyer_pos_ingest_1.ingestInventory; } });
Object.defineProperty(exports, "ingestMembers", { enumerable: true, get: function () { return flyer_pos_ingest_1.ingestMembers; } });
Object.defineProperty(exports, "ingestPromotions", { enumerable: true, get: function () { return flyer_pos_ingest_1.ingestPromotions; } });
Object.defineProperty(exports, "updateAgentHeartbeat", { enumerable: true, get: function () { return flyer_pos_ingest_1.updateAgentHeartbeat; } });
Object.defineProperty(exports, "getTopSellingProducts", { enumerable: true, get: function () { return flyer_pos_ingest_1.getTopSellingProducts; } });
Object.defineProperty(exports, "getPosAgentStatusList", { enumerable: true, get: function () { return flyer_pos_ingest_1.getPosAgentStatusList; } });
// CT-F16: POS AI 스키마 분석
var flyer_pos_ai_1 = require("./pos/flyer-pos-ai");
Object.defineProperty(exports, "analyzeSchema", { enumerable: true, get: function () { return flyer_pos_ai_1.analyzeSchema; } });
Object.defineProperty(exports, "saveSchemaMapping", { enumerable: true, get: function () { return flyer_pos_ai_1.saveSchemaMapping; } });
Object.defineProperty(exports, "getSchemaMapping", { enumerable: true, get: function () { return flyer_pos_ai_1.getSchemaMapping; } });
Object.defineProperty(exports, "detectPhoneFormat", { enumerable: true, get: function () { return flyer_pos_ai_1.detectPhoneFormat; } });
// ═══════════════════════════════════════════
// coupon/ — 쿠폰 도메인
// ═══════════════════════════════════════════
// CT-F15: QR 쿠폰
var flyer_coupons_1 = require("./coupon/flyer-coupons");
Object.defineProperty(exports, "createCouponCampaign", { enumerable: true, get: function () { return flyer_coupons_1.createCouponCampaign; } });
Object.defineProperty(exports, "listCouponCampaigns", { enumerable: true, get: function () { return flyer_coupons_1.listCouponCampaigns; } });
Object.defineProperty(exports, "getCouponCampaign", { enumerable: true, get: function () { return flyer_coupons_1.getCouponCampaign; } });
Object.defineProperty(exports, "updateCouponCampaign", { enumerable: true, get: function () { return flyer_coupons_1.updateCouponCampaign; } });
Object.defineProperty(exports, "disableCouponCampaign", { enumerable: true, get: function () { return flyer_coupons_1.disableCouponCampaign; } });
Object.defineProperty(exports, "getCampaignByQrCode", { enumerable: true, get: function () { return flyer_coupons_1.getCampaignByQrCode; } });
Object.defineProperty(exports, "claimCoupon", { enumerable: true, get: function () { return flyer_coupons_1.claimCoupon; } });
Object.defineProperty(exports, "redeemCoupon", { enumerable: true, get: function () { return flyer_coupons_1.redeemCoupon; } });
Object.defineProperty(exports, "lookupCouponsByPhone", { enumerable: true, get: function () { return flyer_coupons_1.lookupCouponsByPhone; } });
Object.defineProperty(exports, "getCouponStats", { enumerable: true, get: function () { return flyer_coupons_1.getCouponStats; } });
Object.defineProperty(exports, "listCoupons", { enumerable: true, get: function () { return flyer_coupons_1.listCoupons; } });
Object.defineProperty(exports, "generateQrDataUrl", { enumerable: true, get: function () { return flyer_coupons_1.generateQrDataUrl; } });
Object.defineProperty(exports, "renderCouponPage", { enumerable: true, get: function () { return flyer_coupons_1.renderCouponPage; } });
Object.defineProperty(exports, "buildCouponSmsMessage", { enumerable: true, get: function () { return flyer_coupons_1.buildCouponSmsMessage; } });
var flyer_coupons_2 = require("./coupon/flyer-coupons");
Object.defineProperty(exports, "getCouponDashboard", { enumerable: true, get: function () { return flyer_coupons_2.getCouponDashboard; } });
// ═══════════════════════════════════════════
// analytics/ — 분석 도메인
// ═══════════════════════════════════════════
// CT-F09: 통계
var flyer_stats_1 = require("./analytics/flyer-stats");
Object.defineProperty(exports, "getFlyerDashboardStats", { enumerable: true, get: function () { return flyer_stats_1.getFlyerDashboardStats; } });
Object.defineProperty(exports, "getFlyerCampaignResults", { enumerable: true, get: function () { return flyer_stats_1.getFlyerCampaignResults; } });
// CT-F10: RFM (Phase B)
var flyer_rfm_1 = require("./analytics/flyer-rfm");
Object.defineProperty(exports, "calculateCustomerRfm", { enumerable: true, get: function () { return flyer_rfm_1.calculateCustomerRfm; } });
Object.defineProperty(exports, "recalculateAllRfm", { enumerable: true, get: function () { return flyer_rfm_1.recalculateAllRfm; } });
Object.defineProperty(exports, "getRfmSegmentCounts", { enumerable: true, get: function () { return flyer_rfm_1.getRfmSegmentCounts; } });
// ═══════════════════════════════════════════
// config/ — 설정 도메인
// ═══════════════════════════════════════════
// CT-F13: 업종 레지스트리
var flyer_business_types_1 = require("./config/flyer-business-types");
Object.defineProperty(exports, "getBusinessTypes", { enumerable: true, get: function () { return flyer_business_types_1.getBusinessTypes; } });
Object.defineProperty(exports, "getBusinessType", { enumerable: true, get: function () { return flyer_business_types_1.getBusinessType; } });
Object.defineProperty(exports, "getCategoryPresets", { enumerable: true, get: function () { return flyer_business_types_1.getCategoryPresets; } });
Object.defineProperty(exports, "getAvailableTemplates", { enumerable: true, get: function () { return flyer_business_types_1.getAvailableTemplates; } });
Object.defineProperty(exports, "getAllBusinessTypes", { enumerable: true, get: function () { return flyer_business_types_1.getAllBusinessTypes; } });
Object.defineProperty(exports, "TEMPLATE_REGISTRY", { enumerable: true, get: function () { return flyer_business_types_1.TEMPLATE_REGISTRY; } });
Object.defineProperty(exports, "invalidateBusinessTypeCache", { enumerable: true, get: function () { return flyer_business_types_1.invalidateBusinessTypeCache; } });
//# sourceMappingURL=index.js.map