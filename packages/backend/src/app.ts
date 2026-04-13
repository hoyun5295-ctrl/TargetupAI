import dotenv from 'dotenv';
// ★ 보안: dotenv를 최우선 로딩 — 이후 모듈들이 환경변수에 의존하므로 반드시 첫 줄
dotenv.config();

import aiRoutes from './routes/ai';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import syncRoutes from './routes/sync';

// 라우트 import
import authRoutes from './routes/auth';
import companiesRoutes from './routes/companies';
import plansRoutes from './routes/plans';
import customersRoutes from './routes/customers';
import campaignsRoutes from './routes/campaigns';
import resultsRoutes from './routes/results';
import uploadRoutes from './routes/upload'
import unsubscribesRoutes from './routes/unsubscribes';
import addressBooksRoutes from './routes/address-books';
import balanceRoutes from './routes/balance';
import testContactsRoutes from './routes/test-contacts';
import billingRoutes from './routes/billing';
import adminSyncRoutes from './routes/admin-sync';
import adminRoutes from './routes/admin';
import smsTemplatesRoutes from './routes/sms-templates';
import mmsImagesRoutes from './routes/mms-images';
import spamFilterRoutes from './routes/spam-filter';
import analysisRoutes from './routes/analysis';
import autoCampaignsRoutes from './routes/auto-campaigns';
import savedSegmentsRoutes from './routes/saved-segments';
import { startAutoCampaignScheduler } from './utils/auto-campaign-worker';
import { ensureMonthlyLogTables } from './utils/sms-queue';
import { startSpamTestQueueWorker } from './utils/spam-test-queue';

// 공용 관리 라우트 (슈퍼관리자 + 고객사관리자)
import manageUsersRoutes from './routes/manage-users';
import manageCallbacksRoutes from './routes/manage-callbacks';
import manageScheduledRoutes from './routes/manage-scheduled';
import manageStatsRoutes from './routes/manage-stats';
import senderRegistrationRoutes from './routes/sender-registration';

// 전단AI 라우트 (기존)
import flyerRoutes from './routes/flyer/flyers';
import flyerPublicRoutes from './routes/flyer/short-urls';
// ★ 모바일 DM 빌더 (한줄로 AI 프로 기능)
import { dmPublicRouter, dmRouter } from './routes/dm';

// ★ D112: 전단AI 완전 분리 라우트 (flyer_* 테이블 기반)
import switchServiceRoutes from './routes/admin/switch-service';
import flyerAdminRoutes from './routes/admin/flyer-admin';
import flyerAuthRoutes from './routes/flyer/auth';
import flyerCompaniesRoutes from './routes/flyer/companies';
import flyerCustomersRoutes from './routes/flyer/customers';
import flyerCampaignsRoutes from './routes/flyer/campaigns';
import flyerUnsubscribesRoutes from './routes/flyer/unsubscribes';
import flyerBalanceRoutes from './routes/flyer/balance';
import flyerStatsRoutes from './routes/flyer/stats';
import flyerCatalogRoutes from './routes/flyer/catalog';
import flyerAddressBooksRoutes from './routes/flyer/address-books';
import flyerSenderRegistrationRoutes from './routes/flyer/sender-registration';
import flyerPosRoutes from './routes/flyer/pos';
import flyerBusinessTypesRoutes from './routes/flyer/business-types';
import flyerCouponsRoutes, { publicRouter as flyerCouponPublicRoutes } from './routes/flyer/coupons';

// DB 연결
import './config/database';
import { LIMITS } from './config/defaults';
import path from 'path';

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;

// ★ 전단AI 공개 페이지 — helmet(CSP) 전에 마운트 (인라인 스크립트 필요)
app.use('/api/flyer/p', flyerPublicRoutes);
// ★ 모바일 DM 공개 뷰어 — helmet 전에 마운트 (인라인 스크립트 필요)
app.use('/api/dm/v', dmPublicRouter);
app.use('/api/flyer/q', flyerCouponPublicRoutes);

// 미들웨어
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: LIMITS.requestBodySize }));
app.use('/api/upload', uploadRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/spam-filter', spamFilterRoutes);

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
app.use('/api/auth', authRoutes);
app.use('/api/companies', companiesRoutes);
app.use('/api/plans', plansRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/v1/results', resultsRoutes);
app.use('/api/unsubscribes', unsubscribesRoutes);
app.use('/api/address-books', addressBooksRoutes);
app.use('/api/balance', balanceRoutes);
app.use('/api/admin/billing', billingRoutes);
app.use('/api/admin/sync', adminSyncRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/test-contacts', testContactsRoutes);
app.use('/api/sms-templates', smsTemplatesRoutes);
app.use('/api/mms-images', mmsImagesRoutes);
app.use('/api/auto-campaigns', autoCampaignsRoutes);
app.use('/api/saved-segments', savedSegmentsRoutes);
app.use('/api/dm', dmRouter);

// 공용 관리 라우트 (슈퍼관리자 + 고객사관리자)
app.use('/api/manage/users', manageUsersRoutes);
app.use('/api/manage/callbacks', manageCallbacksRoutes);
app.use('/api/manage/scheduled', manageScheduledRoutes);
app.use('/api/manage/stats', manageStatsRoutes);
app.use('/api/sender-registration', senderRegistrationRoutes);

// ★ D112: 슈퍼관리자 서비스 스위처 + 전단AI 관리
app.use('/api/admin/switch-service', switchServiceRoutes);
app.use('/api/admin/flyer', flyerAdminRoutes);

// ★ D112: 전단AI 완전 분리 라우트 (flyer_* 테이블 기반)
app.use('/api/flyer/auth', flyerAuthRoutes);
app.use('/api/flyer/companies', flyerCompaniesRoutes);
app.use('/api/flyer/customers', flyerCustomersRoutes);
app.use('/api/flyer/campaigns', flyerCampaignsRoutes);
app.use('/api/flyer/unsubscribes', flyerUnsubscribesRoutes);
app.use('/api/flyer/balance', flyerBalanceRoutes);
app.use('/api/flyer/stats', flyerStatsRoutes);
app.use('/api/flyer/catalog', flyerCatalogRoutes);
app.use('/api/flyer/address-books', flyerAddressBooksRoutes);
app.use('/api/flyer/companies/sender-registration', flyerSenderRegistrationRoutes);
app.use('/api/flyer/pos', flyerPosRoutes);
app.use('/api/flyer/business-types', flyerBusinessTypesRoutes);

app.use('/api/flyer/coupons', flyerCouponsRoutes);

// ★ 카탈로그 이미지 공개 서빙 (인증 불필요 — static)
app.use('/api/flyer/catalog-images', express.static(path.join(process.cwd(), 'uploads', 'catalog-images')));

// 전단AI 기존 라우트 (전단지 CRUD + 공개 페이지)
app.use('/api/flyer/flyers', flyerRoutes);
// ★ /api/flyer/p, /api/flyer/q는 helmet 전에 마운트됨 (상단 참조)

// 404 처리
app.use((req, res) => {
  res.status(404).json({ error: '요청한 리소스를 찾을 수 없습니다.' });
});

// 에러 핸들러
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
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
  ensureMonthlyLogTables().catch(err => console.error('[QTmsg] 로그 테이블 자동 생성 실패:', err));

  // ★ D69: 자동발송 워커 시작 (매 1시간 체크)
  startAutoCampaignScheduler();

  // ★ D78: 스팸테스트 큐 워커 시작 (3초 간격)
  startSpamTestQueueWorker();
});

export default app;
