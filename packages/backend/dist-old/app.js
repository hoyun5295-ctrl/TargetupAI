"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
// ★ 보안: dotenv를 최우선 로딩 — 이후 모듈들이 환경변수에 의존하므로 반드시 첫 줄
dotenv_1.default.config();
const ai_1 = __importDefault(require("./routes/ai"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const sync_1 = __importDefault(require("./routes/sync"));
// 라우트 import
const auth_1 = __importDefault(require("./routes/auth"));
const companies_1 = __importDefault(require("./routes/companies"));
const plans_1 = __importDefault(require("./routes/plans"));
const customers_1 = __importDefault(require("./routes/customers"));
const campaigns_1 = __importDefault(require("./routes/campaigns"));
const results_1 = __importDefault(require("./routes/results"));
const upload_1 = __importDefault(require("./routes/upload"));
const unsubscribes_1 = __importDefault(require("./routes/unsubscribes"));
const address_books_1 = __importDefault(require("./routes/address-books"));
const balance_1 = __importDefault(require("./routes/balance"));
const test_contacts_1 = __importDefault(require("./routes/test-contacts"));
const billing_1 = __importDefault(require("./routes/billing"));
const admin_sync_1 = __importDefault(require("./routes/admin-sync"));
const admin_1 = __importDefault(require("./routes/admin"));
const sms_templates_1 = __importDefault(require("./routes/sms-templates"));
const mms_images_1 = __importDefault(require("./routes/mms-images"));
const spam_filter_1 = __importDefault(require("./routes/spam-filter"));
const analysis_1 = __importDefault(require("./routes/analysis"));
const auto_campaigns_1 = __importDefault(require("./routes/auto-campaigns"));
const saved_segments_1 = __importDefault(require("./routes/saved-segments"));
// ★ D130: 휴머스온 IMC 알림톡/브랜드메시지 관리
const alimtalk_1 = __importDefault(require("./routes/alimtalk"));
const auto_campaign_worker_1 = require("./utils/auto-campaign-worker");
const sms_queue_1 = require("./utils/sms-queue");
const spam_test_queue_1 = require("./utils/spam-test-queue");
const alimtalk_jobs_1 = require("./utils/alimtalk-jobs");
// ★ CT-17: 30일 PRO 무료체험 자동 강등 Cron (2026-04-22)
const trial_downgrade_worker_1 = require("./utils/trial-downgrade-worker");
// 공용 관리 라우트 (슈퍼관리자 + 고객사관리자)
const manage_users_1 = __importDefault(require("./routes/manage-users"));
const manage_callbacks_1 = __importDefault(require("./routes/manage-callbacks"));
const manage_scheduled_1 = __importDefault(require("./routes/manage-scheduled"));
const manage_stats_1 = __importDefault(require("./routes/manage-stats"));
const sender_registration_1 = __importDefault(require("./routes/sender-registration"));
// 전단AI 라우트 (기존)
const flyers_1 = __importDefault(require("./routes/flyer/flyers"));
const short_urls_1 = __importDefault(require("./routes/flyer/short-urls"));
// ★ 모바일 DM 빌더 (한줄로 AI 프로 기능)
const dm_1 = require("./routes/dm");
// ★ D112: 전단AI 완전 분리 라우트 (flyer_* 테이블 기반)
const switch_service_1 = __importDefault(require("./routes/admin/switch-service"));
const flyer_admin_1 = __importDefault(require("./routes/admin/flyer-admin"));
const auth_2 = __importDefault(require("./routes/flyer/auth"));
const companies_2 = __importDefault(require("./routes/flyer/companies"));
const customers_2 = __importDefault(require("./routes/flyer/customers"));
const campaigns_2 = __importDefault(require("./routes/flyer/campaigns"));
const unsubscribes_2 = __importDefault(require("./routes/flyer/unsubscribes"));
const balance_2 = __importDefault(require("./routes/flyer/balance"));
const stats_1 = __importDefault(require("./routes/flyer/stats"));
const catalog_1 = __importDefault(require("./routes/flyer/catalog"));
const address_books_2 = __importDefault(require("./routes/flyer/address-books"));
const sender_registration_2 = __importDefault(require("./routes/flyer/sender-registration"));
const pos_1 = __importDefault(require("./routes/flyer/pos"));
const business_types_1 = __importDefault(require("./routes/flyer/business-types"));
const coupons_1 = __importStar(require("./routes/flyer/coupons"));
const carts_1 = __importDefault(require("./routes/flyer/carts"));
const orders_1 = __importDefault(require("./routes/flyer/orders"));
const flyer_pos_auto_1 = require("./utils/flyer/pos/flyer-pos-auto");
// DB 연결
require("./config/database");
const defaults_1 = require("./config/defaults");
const path_1 = __importDefault(require("path"));
const app = (0, express_1.default)();
// ★ trust proxy: 'loopback'(127.0.0.1)만 신뢰 → Nginx가 앞단에 있어 여기만 허용
//   이전 true 설정은 모든 프록시 신뢰로 X-Forwarded-For 헤더 위조 시 rate limit 우회 가능
app.set('trust proxy', 'loopback');
const PORT = process.env.PORT || 3000;
// ★ 전단AI 공개 페이지 — helmet(CSP) 전에 마운트 (인라인 스크립트 필요)
app.use('/api/flyer/p', short_urls_1.default);
// ★ 모바일 DM 공개 뷰어 — helmet 전에 마운트 (인라인 스크립트 필요)
app.use('/api/dm/v', dm_1.dmPublicRouter);
app.use('/api/flyer/q', coupons_1.publicRouter);
// ★ Phase 3: 장바구니 공개 API (인증 불필요 — phone 기반)
app.use('/api/flyer/cart', carts_1.default);
// 미들웨어
app.use((0, helmet_1.default)());
// ★ CORS 화이트리스트 — CORS_ORIGIN 환경변수의 도메인만 허용 (운영)
// 안전장치: CORS_ORIGIN 미설정이면 기존 동작(전면 허용) 유지 → 서비스 무중단 보장
//   운영 배포 후 .env에 운영 도메인을 명시적으로 추가하면 자동으로 strict 모드 전환
const corsAllowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
if (corsAllowedOrigins.length === 0) {
    console.warn('[CORS] CORS_ORIGIN 미설정 — 전 origin 허용 중. 운영 배포 시 .env에 운영 도메인 추가 필수');
}
app.use((0, cors_1.default)({
    origin: (origin, cb) => {
        if (corsAllowedOrigins.length === 0)
            return cb(null, true); // fallback: 전면 허용
        if (process.env.NODE_ENV !== 'production')
            return cb(null, true);
        if (!origin)
            return cb(null, true); // curl / same-origin / server-to-server
        if (corsAllowedOrigins.includes(origin))
            return cb(null, true);
        cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
}));
app.use((0, morgan_1.default)('dev'));
// ★ D130: 휴머스온 IMC 웹훅은 HMAC 검증을 위해 raw body 필요
//    express.json()이 먼저 파싱하면 rawBody 손실되므로 이 경로만 선처리
app.use('/api/alimtalk/webhook', express_1.default.raw({ type: '*/*', limit: '10mb' }));
app.use(express_1.default.json({ limit: defaults_1.LIMITS.requestBodySize }));
app.use('/api/upload', upload_1.default);
app.use('/api/sync', sync_1.default);
app.use('/api/spam-filter', spam_filter_1.default);
// 헬스체크
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// API 라우트
app.get('/api', (req, res) => {
    res.json({
        message: 'Target-UP API Server',
        version: '1.0.0',
        endpoints: {
            ai: '/api/ai',
            auth: '/api/auth',
            companies: '/api/companies',
            plans: '/api/plans',
            customers: '/api/customers',
            campaigns: '/api/campaigns',
        }
    });
});
// 라우트 등록
app.use('/api/auth', auth_1.default);
app.use('/api/companies', companies_1.default);
app.use('/api/plans', plans_1.default);
app.use('/api/customers', customers_1.default);
app.use('/api/campaigns', campaigns_1.default);
app.use('/api/ai', ai_1.default);
app.use('/api/analysis', analysis_1.default);
app.use('/api/v1/results', results_1.default);
app.use('/api/unsubscribes', unsubscribes_1.default);
app.use('/api/address-books', address_books_1.default);
app.use('/api/balance', balance_1.default);
app.use('/api/admin/billing', billing_1.default);
app.use('/api/admin/sync', admin_sync_1.default);
app.use('/api/admin', admin_1.default);
app.use('/api/test-contacts', test_contacts_1.default);
app.use('/api/sms-templates', sms_templates_1.default);
app.use('/api/mms-images', mms_images_1.default);
app.use('/api/auto-campaigns', auto_campaigns_1.default);
app.use('/api/saved-segments', saved_segments_1.default);
// ★ D130: 알림톡/브랜드메시지 IMC 연동 (발신프로필/템플릿/검수/웹훅/이미지/알림수신자)
app.use('/api/alimtalk', alimtalk_1.default);
app.use('/api/dm', dm_1.dmRouter);
// 공용 관리 라우트 (슈퍼관리자 + 고객사관리자)
app.use('/api/manage/users', manage_users_1.default);
app.use('/api/manage/callbacks', manage_callbacks_1.default);
app.use('/api/manage/scheduled', manage_scheduled_1.default);
app.use('/api/manage/stats', manage_stats_1.default);
app.use('/api/sender-registration', sender_registration_1.default);
// ★ D112: 슈퍼관리자 서비스 스위처 + 전단AI 관리
app.use('/api/admin/switch-service', switch_service_1.default);
app.use('/api/admin/flyer', flyer_admin_1.default);
// ★ D112: 전단AI 완전 분리 라우트 (flyer_* 테이블 기반)
app.use('/api/flyer/auth', auth_2.default);
app.use('/api/flyer/companies', companies_2.default);
app.use('/api/flyer/customers', customers_2.default);
app.use('/api/flyer/campaigns', campaigns_2.default);
app.use('/api/flyer/unsubscribes', unsubscribes_2.default);
app.use('/api/flyer/balance', balance_2.default);
app.use('/api/flyer/stats', stats_1.default);
app.use('/api/flyer/catalog', catalog_1.default);
app.use('/api/flyer/address-books', address_books_2.default);
app.use('/api/flyer/companies/sender-registration', sender_registration_2.default);
app.use('/api/flyer/pos', pos_1.default);
app.use('/api/flyer/business-types', business_types_1.default);
app.use('/api/flyer/coupons', coupons_1.default);
// ★ Phase 3: 주문 관리 (인증 필요)
app.use('/api/flyer/orders', orders_1.default);
// ★ 카탈로그 이미지 공개 서빙 (인증 불필요 — static)
app.use('/api/flyer/catalog-images', express_1.default.static(path_1.default.join(process.cwd(), 'uploads', 'catalog-images')));
// 전단AI 기존 라우트 (전단지 CRUD + 공개 페이지)
app.use('/api/flyer/flyers', flyers_1.default);
// ★ /api/flyer/p, /api/flyer/q는 helmet 전에 마운트됨 (상단 참조)
// 404 처리
app.use((req, res) => {
    res.status(404).json({ error: '요청한 리소스를 찾을 수 없습니다.' });
});
// 에러 핸들러
app.use((err, req, res, next) => {
    console.error('서버 에러:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});
// ============================================================
// 프로세스 레벨 에러 핸들러 (PM2 자동 재시작 연계)
// ============================================================
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ [unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
    console.error('❌ [uncaughtException]', err);
    // PM2가 자동 재시작하므로 로깅 후 프로세스 종료
    process.exit(1);
});
// 서버 시작
app.listen(PORT, () => {
    console.log('');
    console.log('🚀 ================================');
    console.log(`🚀  Target-UP API Server`);
    console.log(`🚀  Port: ${PORT}`);
    console.log(`🚀  http://localhost:${PORT}`);
    console.log('🚀 ================================');
    console.log('');
    // ★ D106: 로그 테이블 자동 생성 (당월+다음달 — 202604 미생성 사고 재발 방지)
    (0, sms_queue_1.ensureMonthlyLogTables)().catch(err => console.error('[QTmsg] 로그 테이블 자동 생성 실패:', err));
    // ★ D69: 자동발송 워커 시작 (매 1시간 체크)
    (0, auto_campaign_worker_1.startAutoCampaignScheduler)();
    // ★ D78: 스팸테스트 큐 워커 시작 (3초 간격)
    (0, spam_test_queue_1.startSpamTestQueueWorker)();
    // ★ Phase 4: POS 자동 전단 생성 워커 시작 (5분 간격)
    (0, flyer_pos_auto_1.startAutoFlyerWorker)();
    // ★ D130: 알림톡 배치 스케줄러 (카테고리=매일 03:00 KST, 템플릿상태=5분, 발신프로필=1시간)
    (0, alimtalk_jobs_1.startAlimtalkScheduler)();
    // ★ CT-17: 30일 PRO 무료체험 자동 강등 (매일 04:00 KST)
    (0, trial_downgrade_worker_1.startTrialDowngradeWorker)();
});
exports.default = app;
//# sourceMappingURL=app.js.map