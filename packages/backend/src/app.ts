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
// ★ D184 (2026-05-20): 이니시스 표준결제 라우트 (레거시 invitobiz.com → 한줄로 이전)
import paymentsRoutes from './routes/payments';
import testContactsRoutes from './routes/test-contacts';
import billingRoutes from './routes/billing';
import adminSyncRoutes from './routes/admin-sync';
import adminRoutes from './routes/admin';
import smsTemplatesRoutes from './routes/sms-templates';
import internalAlertRoutes from './routes/internal-alert'; // ★ D145 (2026-05-07): 시스템 알림 SMS (localhost 전용)
import mmsImagesRoutes from './routes/mms-images';
import spamFilterRoutes from './routes/spam-filter';
import analysisRoutes from './routes/analysis';
import autoCampaignsRoutes from './routes/auto-campaigns';
import savedSegmentsRoutes from './routes/saved-segments';
// ★ D130: IMC 알림톡/브랜드메시지 관리
import alimtalkRoutes from './routes/alimtalk';
// ★ D172 (2026-05-19): 한줄로 CDP — 자사몰 sync API (identify/event/order/bulk-import)
import cdpRoutes from './routes/cdp';
// ★ D172-B (2026-05-19): 카페24 OAuth + Webhook receiver
import cafe24Routes, { cafe24CallbackRouter } from './routes/cafe24';
// ★ D178 (2026-05-19): 네이버 스마트스토어 (커머스 API) OAuth + Webhook
import naverCommerceRoutes, { naverCommerceCallbackRouter } from './routes/naver-commerce';
// ★ D178 (2026-05-19): 인바운드 AI 음성 응답 (Naver Clova STT/TTS + Opus 4.7)
import voiceRoutes from './routes/voice';
// ★ D180 (2026-05-19): Email 채널 (SendGrid Web API v3)
import emailRoutes from './routes/email';
import shortUrlRoutes from './routes/short-url';  // D183: 단축 URL redirect (/c/:hash) — 공개 endpoint
import { startAutoCampaignScheduler } from './utils/auto-campaign-worker';
import { ensureMonthlyLogTables } from './utils/sms-queue';
import { startSpamTestQueueWorker } from './utils/spam-test-queue';
import { startAlimtalkScheduler } from './utils/alimtalk-jobs';
// ★ CT-17: 30일 PRO 무료체험 자동 강등 Cron (2026-04-22)
import { startTrialDowngradeWorker } from './utils/trial-downgrade-worker';
// ★ D151 (2026-05-11): 캠페인 결과 자동 sync 워커 (5분 주기, 환불 누락 영구 차단)
import { startCampaignSyncWorker } from './utils/campaign-sync-worker';
// ★ D153 (2026-05-13): MySQL 진실 원천 환불 sweep 워커 (5분 주기, PG fail_count 의존 X 뿌리뽑기)
import { startMysqlRefundSweeper } from './utils/mysql-refund-sweeper';
// ★ D176 (2026-05-19): Continuous Agentic Operator — 매일 09:00 KST 활성 Operator 제안서 박는 worker (5분 주기 due check)
import { startContinuousOperatorScheduler } from './utils/continuous-operator';
// ★ D187 (2026-05-20): Journey Builder Lite — 5분 주기 due execution 처리 + 5분 주기 trigger 매칭
import { startJourneyExecutor } from './utils/journey-executor';
import { startJourneyTriggerWatcher } from './utils/journey-trigger-watcher';

// 공용 관리 라우트 (슈퍼관리자 + 고객사관리자)
import manageUsersRoutes from './routes/manage-users';
import manageCallbacksRoutes from './routes/manage-callbacks';
import manageScheduledRoutes from './routes/manage-scheduled';
import manageStatsRoutes from './routes/manage-stats';
import senderRegistrationRoutes from './routes/sender-registration';

// ★ 모바일 DM 빌더 (한줄로 AI 프로 기능 — hanjulDM 분리 후 한줄AI 본진 자체 유지)
import { dmPublicRouter, dmRouter } from './routes/dm';

// ★ D145 P0 (2026-05-07): 슈퍼관리자 로그인 차단 관리
import loginBlocksRoutes from './routes/admin/login-blocks';

// ★ D152 (2026-05-12): 전단AI(hanjulDM) 완전 분리 — flyer 관련 라우트/유틸/미들웨어 모두 hanjulDM/으로 이전됨.
//    여기서는 import/마운트/워커 시작 라인 모두 제거. 한줄AI는 hanjulDM 코드 의존 0건.

// DB 연결
import './config/database';
import { LIMITS } from './config/defaults';

const app = express();
// ★ trust proxy: 'loopback'(127.0.0.1)만 신뢰 → Nginx가 앞단에 있어 여기만 허용
//   이전 true 설정은 모든 프록시 신뢰로 X-Forwarded-For 헤더 위조 시 rate limit 우회 가능
app.set('trust proxy', 'loopback');
const PORT = process.env.PORT || 3000;

// ★ 모바일 DM 공개 뷰어 — helmet 전에 마운트 (인라인 스크립트 필요)
app.use('/api/dm/v', dmPublicRouter);

// 미들웨어
app.use(helmet());

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
app.use(cors({
  origin: (origin, cb) => {
    if (corsAllowedOrigins.length === 0) return cb(null, true); // fallback: 전면 허용
    if (process.env.NODE_ENV !== 'production') return cb(null, true);
    if (!origin) return cb(null, true); // curl / same-origin / server-to-server
    if (corsAllowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

app.use(morgan('dev'));
// ★ D130: IMC 웹훅은 HMAC 검증을 위해 raw body 필요
//    express.json()이 먼저 파싱하면 rawBody 손실되므로 이 경로만 선처리
app.use('/api/alimtalk/webhook', express.raw({ type: '*/*', limit: '10mb' }));
app.use(express.json({ limit: LIMITS.requestBodySize }));
app.use('/api/upload', uploadRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/spam-filter', spamFilterRoutes);
// D183 (2026-05-20): 단축 URL redirect — 공개 endpoint (/c/:hash) — SMS/카톡 수신자 클릭 트래킹
app.use('/', shortUrlRoutes);

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
// ★ D184: 이니시스 표준결제 (prepare/return/close/list/detail)
app.use('/api/payments', paymentsRoutes);
app.use('/api/admin/billing', billingRoutes);
app.use('/api/admin/sync', adminSyncRoutes);
// ★ D145 P0: 더 구체적 경로 먼저 등록 (/api/admin 와일드카드 위에)
app.use('/api/admin/login-blocks', loginBlocksRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/test-contacts', testContactsRoutes);
app.use('/api/sms-templates', smsTemplatesRoutes);
app.use('/api/internal', internalAlertRoutes); // ★ D145: localhost 전용 시스템 알림
app.use('/api/mms-images', mmsImagesRoutes);
app.use('/api/auto-campaigns', autoCampaignsRoutes);
app.use('/api/saved-segments', savedSegmentsRoutes);
app.use('/api/cdp', cdpRoutes); // ★ D172: 한줄로 CDP — 자사몰 → 한줄로 sync
// ★ D172-B: 카페24 OAuth callback (authenticate 우회 — 카페24가 브라우저 redirect로 호출) → cafe24Routes보다 먼저 등록
app.use('/api/cafe24', cafe24CallbackRouter);
app.use('/api/cafe24', cafe24Routes);
// ★ D178: 네이버 스마트스토어 OAuth callback (authenticate 우회) → naverCommerceRoutes보다 먼저 등록
app.use('/api/naver-commerce', naverCommerceCallbackRouter);
app.use('/api/naver-commerce', naverCommerceRoutes);
// ★ D178: 인바운드 AI 음성 응답 (통신사 webhook + 회사 admin 토글/이력)
app.use('/api/voice', voiceRoutes);
// ★ D180: Email 채널 (SendGrid Event Webhook + 회사 admin 캠페인 CRUD/발송)
app.use('/api/email', emailRoutes);
// ★ D130: 알림톡/브랜드메시지 IMC 연동 (발신프로필/템플릿/검수/웹훅/이미지/알림수신자)
app.use('/api/alimtalk', alimtalkRoutes);
app.use('/api/dm', dmRouter);

// 공용 관리 라우트 (슈퍼관리자 + 고객사관리자)
app.use('/api/manage/users', manageUsersRoutes);
app.use('/api/manage/callbacks', manageCallbacksRoutes);
app.use('/api/manage/scheduled', manageScheduledRoutes);
app.use('/api/manage/stats', manageStatsRoutes);
app.use('/api/sender-registration', senderRegistrationRoutes);

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

  // ★ D130: 알림톡 배치 스케줄러 (카테고리=매일 03:00 KST, 템플릿상태=5분, 발신프로필=1시간)
  startAlimtalkScheduler();

  // ★ CT-17: 30일 PRO 무료체험 자동 강등 (매일 04:00 KST)
  startTrialDowngradeWorker();

  // ★ D151 (2026-05-11): 캠페인 결과 자동 sync (5분 주기) — fire-and-forget 사용자 진입 의존 → 백그라운드 자동
  startCampaignSyncWorker();

  // ★ D153 (2026-05-13): MySQL 진실 원천 환불 sweep (5분 주기) — PG fail_count 의존 X
  //   balance_transactions 회계 진실 + MySQL status_code 직접 카운트로 차액 환불 보정
  //   기존 syncCampaignResults가 `target > success+fail` 조건으로 SELECT 누락된 캠페인까지 sweep
  startMysqlRefundSweeper();

  // ★ D176 (2026-05-19): Continuous Operator — 5분 주기 due Operator 체크 + 매일 09:00 KST 제안서 박음
  //   AI 단독 실행 X 영구 원칙 — 제안서만 박고 사용자 승인 대기. ENT 자동 실행 옵션은 default OFF + 임계값 통과 시만
  startContinuousOperatorScheduler();

  // ★ D187 (2026-05-20): Journey Builder Lite — 5분 주기 due execution 발송 + 5분 주기 trigger 매칭
  //   7 표준 여정 (가입/재구매/휴면/장바구니/생일/예약/Custom) + 회사 자유 임계값 + 광고 자동 검증 4건
  //   AI_OPERATOR_ALLOWED_USERS=hoyun 게이팅 (routes/ai.ts 영역)
  startJourneyExecutor();
  startJourneyTriggerWatcher();
});

export default app;
