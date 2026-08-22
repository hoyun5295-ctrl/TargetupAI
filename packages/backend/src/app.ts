import dotenv from 'dotenv';
// ★ 보안: dotenv를 최우선 로딩 — 이후 모듈들이 환경변수에 의존하므로 반드시 첫 줄
dotenv.config();

import aiRoutes from './routes/ai';
import aiMemoryRoutes from './routes/ai-memory';
import aiUsageRoutes from './routes/ai-usage';
import express from 'express';
import { getCreditEvent } from './utils/request-context';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import syncRoutes from './routes/sync';

// 라우트 import
import authRoutes from './routes/auth';
import companiesRoutes from './routes/companies';
// ★ D219+ Part 2 (2026-05-27): Onboarding Wizard 7 step endpoints
import onboardingRoutes from './routes/onboarding';
import helpRoutes from './routes/help';
// ★ D219+ Part 2 후속 (2026-05-27): 일일 인사이트 API (Performance 카드 + 메일 양쪽 활용)
import insightRoutes from './routes/insight';
import plansRoutes from './routes/plans';
import customersRoutes from './routes/customers';
import campaignsRoutes from './routes/campaigns';
import resultsRoutes from './routes/results';
import uploadRoutes from './routes/upload'
import unsubscribesRoutes from './routes/unsubscribes';
import addressBooksRoutes from './routes/address-books';
import balanceRoutes from './routes/balance';
// ★ 2026-07-27 §5-4: 에이전트 충전 요청(고객사 창구) — 잔액 증액은 §5-3 슈퍼관리자 경로에서만
import agentChargeOrdersRoutes from './routes/agent-charge-orders';
// ★ 2026-08-12 마케팅 플래너 Phase 1 (설계서 = docs/2026-08-12-ax-marketing-planner-design.md)
import marketingPlannerRoutes from './routes/marketing-planner';
// ★ 2026-08-13 원스텝 AI 컨텐츠 생성 (설계서 = docs/2026-08-13-one-step-content-interview-design.md)
import contentInterviewRoutes from './routes/content-interview';
import marketingDiagnosisRoutes from './routes/marketing-diagnosis';
import marketingDiagnosisPublicRoutes from './routes/marketing-diagnosis-public';
import marketingDiagnosisAdminRoutes from './routes/marketing-diagnosis-admin';
// ★ D184 (2026-05-20): 이니시스 표준결제 라우트 (레거시 invitobiz.com → 한줄로 이전)
import paymentsRoutes from './routes/payments';
import testContactsRoutes from './routes/test-contacts';
import billingRoutes from './routes/billing';
// ★ 2026-07-28 거래내역서 공개 확인 페이지 (토큰 인증 — 컨펌·이의신청)
import invoicePublicRoutes from './routes/invoice-public';
import adminSyncRoutes from './routes/admin-sync';
import adminRoutes from './routes/admin';
import smsTemplatesRoutes from './routes/sms-templates';
import internalAlertRoutes from './routes/internal-alert'; // ★ D145 (2026-05-07): 시스템 알림 SMS (localhost 전용)
import mmsImagesRoutes from './routes/mms-images';
import spamFilterRoutes from './routes/spam-filter';
import analysisRoutes from './routes/analysis';
import autoCampaignsRoutes from './routes/auto-campaigns';
import savedSegmentsRoutes from './routes/saved-segments';
import targetsRoutes from './routes/targets';
import campaignAgencyRoutes from './routes/campaign-agency'; // ★ 2026-07-09 CRM 캠페인 대행 (비즈니스+ 전용)
// ★ D130: IMC 알림톡/브랜드메시지 관리
import alimtalkRoutes from './routes/alimtalk';
// ★ 2026-07-20 Track C M2: 게이트웨이 알림톡 매핑 관리 (super_admin 전용)
import gatewayTemplatesRoutes from './routes/gateway-templates';
// ★ 2026-07-20 Track D 접점: PAY(엔진) 고객 ↔ 회사 매핑 시드 (super_admin 전용)
import payMappingsRoutes from './routes/pay-mappings';
// ★ D172 (2026-05-19): 한줄로 CDP — 자사몰 sync API (identify/event/order/bulk-import)
import cdpRoutes from './routes/cdp';
import { serveSdkFile } from './utils/sdk-serve';
// ★ D172-B (2026-05-19): 카페24 OAuth + Webhook receiver
import cafe24Routes, { cafe24CallbackRouter } from './routes/cafe24';
// ★ D178 (2026-05-19): 네이버 스마트스토어 (커머스 API) OAuth + Webhook
import naverCommerceRoutes from './routes/naver-commerce';
import imwebRoutes, { imwebCallbackRouter } from './routes/imweb';
// ★ 2026-06-18: 고도몰(NHN커머스) BYO-키 폴링 커넥터
import godoRoutes from './routes/godo';
import makeshopRoutes from './routes/makeshop';
// ★ 2026-06-25 (gap 7): CDP Provider 등록 단일 출처 — routes import 부수효과 의존 제거
import { registerAllProviders } from './utils/register-providers';
// ★ D178 (2026-05-19): 인바운드 AI 음성 응답 (Naver Clova STT/TTS + Opus 4.7)
import voiceRoutes from './routes/voice';
// ★ D180 (2026-05-19): Email 채널 (SendGrid Web API v3)
import emailRoutes from './routes/email';
import shortUrlRoutes from './routes/short-url';  // D183: 단축 URL redirect (/c/:hash) — 공개 endpoint
import journeyPausePublicRouter from './routes/journey-pause-public';  // ★ D218+: 여정 즉시 정지 페이지 (/journey-pause/:token) — 공개 endpoint
import { startAutoCampaignScheduler } from './utils/auto-campaign-worker';
import { ensureMonthlyLogTables } from './utils/sms-queue';
import { startSpamTestQueueWorker } from './utils/spam-test-queue';
import { startAlimtalkScheduler } from './utils/alimtalk-jobs';
// ★ D218+ (2026-05-26) 여정 발송 2시간 전 담당자 알림 + 7일 KPI 학습 worker
import { startJourneyPretestNotifierWorker } from './utils/journey-pretest-notifier-worker';
import { startAiMemoryAccumulatorWorker } from './utils/ai-memory-accumulator-worker';
import { startCopyLabelSweeperWorker } from './utils/copy-label-sweeper';
import { startPayIngestMonitor } from './utils/pay-ingest-monitor';
// ★ CT-17: 30일 PRO 무료체험 자동 강등 Cron (2026-04-22)
import { startTrialDowngradeWorker } from './utils/trial-downgrade-worker';
import { startFreeMessagingGrantWorker } from './utils/free-messaging-grant-worker';
// ★ 2026-07-28 세금계산서 상태 전이 워커 (pending→due, confirmed·due→ready. 팝빌 연동 전 = ready 정지)
import { startTaxbillWorker } from './utils/taxbill-worker';
// ★ 2026-07-30: 팝빌 세금계산서 웹훅 (공개 — 팝빌 서버 POST 수신)
import popbillWebhookRouter from './routes/popbill-webhook';
// ★ D219+ Part 2 (2026-05-27): AI 오퍼레이션 30일 무료체험 자동 만료 Cron (매일 04:00 KST 로그)
import { startAiOperatorTrialExpireWorker } from './utils/ai-operator-trial-expire-worker';
// ★ D219+ Part 2 (2026-05-27): Wizard 종결 회사 매일 9시 인사이트 메일 (1시간 cron)
import { startDailyInsightMailer } from './utils/daily-insight-mailer';
// ★ D151 (2026-05-11): 캠페인 결과 자동 sync 워커 (5분 주기, 환불 누락 영구 차단)
import { startCampaignSyncWorker } from './utils/campaign-sync-worker';
// ★ D153 (2026-05-13): MySQL 진실 원천 환불 sweep 워커 (5분 주기, PG fail_count 의존 X 뿌리뽑기)
import { startMysqlRefundSweeper } from './utils/mysql-refund-sweeper';
// ★ D176 (2026-05-19): Continuous Agentic Operator — 매일 09:00 KST 활성 Operator 제안서 박는 worker (5분 주기 due check)
import { startContinuousOperatorScheduler } from './utils/continuous-operator';
// ★ D187 (2026-05-20): Journey Builder Lite — 5분 주기 due execution 처리 + 5분 주기 trigger 매칭
import { startJourneyExecutor } from './utils/journey-executor';
import { startJourneyTriggerWatcher } from './utils/journey-trigger-watcher';
import { startJourneyAnchorScheduler } from './utils/journey-anchor-scheduler';
// ★ D197 (2026-05-22) Phase B-2: Predictive Suite — 1시간 주기 cron + 회사 customer 예측 점수 자동 갱신
import { startPredictiveWorker } from './utils/predictive-worker';
// ★ D210+ Phase 3 (2026-05-23 Harold 명시): 자동 재진입 worker — 6시간 주기 + 회사 admin 명시 활성 정합 (default OFF)
import { startJourneyReentryWorker } from './utils/journey-reentry-worker';
// ★ D217+ (2026-05-26 Harold 명시 진단 정정): 카카오 templateCode 동기화 worker — 30분 주기
//   옛 D147 영역 = 검수 통과 후 진정 카카오 templateCode 영역 = 한줄로 안 동기화 누락 사고 (8건 100%) 영구 정정
import { startKakaoTemplateSyncWorker } from './utils/kakao-template-sync-worker';
// ★ 2026-07-20 Track C M2: 게이트웨이 매핑 동기화 워커 — 적재 5분·푸시 1분·대조 6h.
//   이중 env 게이트(GATEWAY_TMPL_SYNC_ENABLED·GATEWAY_TMPL_54_ENABLED 기본 false) — 배포≠가동
import { startGatewayTemplateMappingWorker } from './utils/gateway-template-mapping-worker';
// ★ D227+ (2026-05-28 영업팀장 박성용 신고 fix): 예약 캠페인 자동 정리 worker — 1분 cron
//   옛 흐름 = 응답 영역 직전 동기 호출 → 6만건 안 30~40초 사고 → 백그라운드 영역 분리
import { startScheduledCleanupWorker } from './utils/scheduled-cleanup-worker';
// ★ 대량 발송 파이프라인 (2026-05-30): direct-send-worker — staging 청크 발송 + 진행률 (5초 주기)
import { startDirectSendWorker } from './utils/direct-send-worker';
// ★ 2026-06-11: 취소 잔존 큐 안전망 — 취소됐는데 발송 큐에 남은 행 자동 삭제 (에이치피오 사고 재발 차단)
import { startCancelledQueueSweeper } from './utils/cancelled-queue-sweeper';
// ★ 2026-06-17: 만료 발송요청 안전망 — rsv1=3(서버전송요청완료) 2일+ 결과없음 미발송 발송 차단 (시세이도 늦은 발송 사고 차단)
import { startExpiredPendingSweeper } from './utils/expired-pending-sweeper';
import { startEmailSendSweeper } from './utils/email-send-sweeper';
// ★ 2026-06-14: DM 마감 추첨 워커 (1분 주기) — lucky_draw draw_at 도래 시 등급별 랜덤 추첨
import { startDmDrawWorker } from './utils/dm/dm-draw-worker';
// ★ 2026-06-10: CDP webhook 실패 재처리 + unified profile 자동 재계산
import { startCdpWebhookRetryWorker } from './utils/cdp-webhook-retry-worker';
import { startCdpProfileRecomputeWorker } from './utils/cdp-profile-recompute-worker';
// ★ 2026-08-10: 고도몰 주기 수집 (30분) — 웹훅이 없는 몰이라 당겨오지 않으면 연결 후 신규 주문이 영영 안 들어온다
import { startGodoSyncWorker } from './utils/godo-sync-worker';
// ★ 2026-06-13: 시스템 크리티컬 감지 워커 (발송 큐 지연 정체 + 싱크에이전트 중단 → 운영자 문자 통지)
import { startSystemMonitorWorker } from './utils/system-monitor-worker';
// ★ 2026-07-05: 발송 피로도 보호 — send_fatigue_daily 45일 초과 버킷 프루닝 (6시간 주기)
import { startFatiguePruneWorker } from './utils/fatigue-guard';
// ★ 2026-08-13 마케팅 플래너 실행·대조 워커 (Phase 3·4)
import { startPlannerExecutor } from './utils/planner-executor';
import { startPlannerReconcileWorker } from './utils/planner-reconcile';
// ★ 2026-07-19: P4 이미지 스튜디오 temp 산출물 7일 스윕 (1일 주기)
import { startStudioTempSweeper } from './utils/studio-temp-sweeper';

// 공용 관리 라우트 (슈퍼관리자 + 고객사관리자)
import manageUsersRoutes from './routes/manage-users';
import manageCallbacksRoutes from './routes/manage-callbacks';
import manageScheduledRoutes from './routes/manage-scheduled';
import manageStatsRoutes from './routes/manage-stats';
import senderRegistrationRoutes from './routes/sender-registration';

// ★ 모바일 DM 빌더 (한줄로 AI 프로 기능 — hanjulDM 분리 후 한줄AI 본진 자체 유지)
import { dmPublicRouter, dmRouter } from './routes/dm';

// ★ 2026-07-08 행사 캠페인 — 이미지 판독(vision) + 3채널 생성 초안 DB 임시 보관(소멸 방지)
import { eventCampaignRouter } from './routes/event-campaigns';

// ★ 2026-07-14 디자인 4.0 — 정예 골든 템플릿 조회 (design-core 컴파일, 읽기 전용)
import { designTemplatesRouter } from './routes/design-templates';

// ★ 2026-07-08 연동 몰 상품 조회 (DM 상품 슬라이드 자동 채우기 — 카페24·네이버 raw preview 실측부터)
import { mallProductsRouter } from './routes/mall-products';

// ★ 2026-07-18 P3 에셋 라이브러리 — 회사별 이미지 소재 저장소 (cdp_assets)
import { assetsRouter } from './routes/assets';

// ★ 2026-07-19 P4 AI 이미지 스튜디오 — 상품 누끼 → AI 배경 → 서버 합성 → 라이브러리
import imageStudioRouter from './routes/image-studio';

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

// ★ 2026-07-28 거래내역서 공개 확인 페이지 — DM 뷰어와 같은 이유로 helmet 전에 마운트.
//   (Codex 1R HIGH 수용: helmet 뒤에 두면 CSP script-src가 페이지 인라인 스크립트를 막아
//    컨펌·이의신청 버튼이 동작하지 않는다.) 전역 json 파서보다도 앞이라 라우터가 자체 파서를 쓴다.
app.use('/api/invoice-view', invoicePublicRoutes);

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
// ★ 브라우저 SDK가 고객사 도메인에서 직접 호출하는 CDP 경로 (Origin reflect 허용)
//   2026-06-10 확장: /ingest 단독 → 인앱/웹푸시/여정 변이 트래킹 포함.
//   이전에는 /ingest 외 경로가 CORS 화이트리스트에 막혀 인앱 메시지 표시가 고객 사이트에서 불가능했다.
//   실 보안 경계는 각 endpoint 인증(public key + 등록 도메인 검증)이며 CORS는 통로만 연다.
const CDP_BROWSER_CORS_RE = /^\/api\/cdp\/(ingest|inapp\/active|inapp\/track|push\/vapid-public-key|push\/subscribe|push\/unsubscribe|journey-variants\/[^/]+\/track)$/;

app.use(cors((req, cb) => {
  if (CDP_BROWSER_CORS_RE.test(req.path)) {
    cb(null, {
      origin: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Hanjullo-Key', 'X-Hanjullo-Schema-Version', 'X-Hanjullo-SDK-Version'],
      credentials: false,
      maxAge: 86400,
    });
    return;
  }
  const origin = req.headers.origin as string | undefined;
  if (corsAllowedOrigins.length === 0) return cb(null, { origin: true, credentials: true }); // fallback: 전면 허용
  if (process.env.NODE_ENV !== 'production') return cb(null, { origin: true, credentials: true });
  if (!origin) return cb(null, { origin: true, credentials: true }); // curl / same-origin / server-to-server
  if (corsAllowedOrigins.includes(origin)) return cb(null, { origin: true, credentials: true });
  cb(new Error(`CORS blocked: ${origin}`));
}));

app.use(morgan('dev'));

// ★ 2026-06-10: CDP/자사몰 공개 endpoint 과다 호출 차단 (IP당 분 600회 — webhook 폭주/무차별 시도 완화)
const cdpPublicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.', code: 'RATE_LIMITED' },
});
app.use(['/api/cdp/ingest', '/api/cdp/webhook', '/api/cafe24/webhook', '/api/naver-commerce/webhook', '/api/imweb/webhook'], cdpPublicLimiter);

// ★ D130: IMC 웹훅은 HMAC 검증을 위해 raw body 필요
//    express.json()이 먼저 파싱하면 rawBody 손실되므로 이 경로만 선처리
app.use('/api/alimtalk/webhook', express.raw({ type: '*/*', limit: '10mb' }));
// ★ 2026-06-10: 자사몰 webhook 3경로도 동일 — 전역 json이 먼저 파싱하면 라우트 verify가 실행되지 않아
//    HMAC을 재직렬화 문자열(JSON.stringify)로 계산하던 결함 정정. 서명은 원본 바이트(rawBody) 기준이 정답.
app.use(
  ['/api/cdp/webhook/custom', '/api/cafe24/webhook', '/api/naver-commerce/webhook'],
  express.json({ limit: '1mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } })
);
// ★ 2026-08-16 마케팅 진단 공개 축 — 미인증 입력이라 본문 상한 32kb(전역 상한보다 좁게). 라우터 자체는
//   아래 정상 mount 블록에 있다(여기 두면 공통 미들웨어를 건너뛴다 — 설계서 §4-4). 413은 400으로 변환.
app.use('/api/public/marketing-diagnosis', express.json({ limit: '32kb' }));
app.use('/api/public/marketing-diagnosis', (err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(400).json({ success: false, error: '요청이 너무 큽니다.' });
  }
  return next(err);
});
app.use(express.json({ limit: LIMITS.requestBodySize }));

// ★ 2026-07-17 느린 요청 상시 계측 — 500ms 초과 API 요청을 로깅(경로·소요·회사·상태).
//   이새(13.7만 고객) 대시보드 지연 진단 + 대형 연동사 증가 대비: "무엇이 느린지"를 추측이 아니라
//   PM2 로그로 본다. 쿼리스트링은 남기지 않음(개인정보 URL 파라미터 금지 원칙). 응답 무변경.
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    if (ms >= 500 && req.originalUrl.startsWith('/api/')) {
      const path = req.originalUrl.split('?')[0];
      const companyId = (req as any).user?.companyId || '-';
      console.log(`[SLOW ${ms}ms] ${req.method} ${path} company=${companyId} status=${res.statusCode}`);
    }
  });
  next();
});

// 사후 토스트용 — 크레딧 차감이 일어난 요청의 JSON 응답에 _credit 자동 첨부(호출처 무수정).
app.use((_req, res, next) => {
  const orig = res.json.bind(res);
  res.json = ((body: any) => {
    try {
      const ev = getCreditEvent();
      if (ev && !res.headersSent) {
        res.setHeader('X-Credit-Used', String(ev.used));
        res.setHeader('X-Credit-Balance', String(ev.balance));
        res.setHeader('X-Credit-Source', ev.source);
        res.setHeader('Access-Control-Expose-Headers', 'X-Credit-Used, X-Credit-Balance, X-Credit-Source');
      }
    } catch { /* 헤더 첨부 실패는 무시 */ }
    return orig(body);
  }) as any;
  next();
});

app.use('/api/upload', uploadRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/spam-filter', spamFilterRoutes);
// D183 (2026-05-20): 단축 URL redirect — 공개 endpoint (/c/:hash) — SMS/카톡 수신자 클릭 트래킹
app.use('/', shortUrlRoutes);
// ★ D218+ (2026-05-26): 여정 즉시 정지 페이지 — 공개 endpoint (/journey-pause/:token) — 담당자 LMS 안 단축 URL
app.use('/', journeyPausePublicRouter);
// ★ 2026-07-08 SDK 서빙 (CORS, 공개) — 인앱 SDK를 몰 스토어프론트가 교차출처 로드.
//   /api/cdp/sdk/ = 신규 수동 스니펫(메이크샵·고도몰·아임웹·자체) / /sdk/ = 레거시(nginx가 backend로 넘기면 팝폰 등 옛 스니펫 자동 복구).
//   반드시 /api/cdp 라우터(아래) 앞에 등록 — 그래야 이 공개 SDK 라우트가 우선한다.
app.get('/api/cdp/sdk/:version/hanjul.min.js', serveSdkFile);
app.get('/sdk/:version/hanjul.min.js', serveSdkFile);

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
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/help', helpRoutes); // ★ 2026-08-22 도움말 봇 · 기능 카탈로그(docs/FEATURE-HELP-CATALOG.md)
app.use('/api/insight', insightRoutes);
app.use('/api/plans', plansRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/ai-memory', aiMemoryRoutes);
app.use('/api/ai-usage', aiUsageRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/v1/results', resultsRoutes);
app.use('/api/unsubscribes', unsubscribesRoutes);
app.use('/api/address-books', addressBooksRoutes);
app.use('/api/balance', balanceRoutes);
// ★ 2026-07-27 §5-4: 에이전트 충전 요청 (고객사 접수 — 요청만, 잔액 무접촉)
app.use('/api/agent-charge-orders', agentChargeOrdersRoutes);
// ★ 2026-08-12 마케팅 플래너 Phase 1 — CRUD·가용성만(승인·차감·발송 없음). 테이블 미생성 시 503 DB_MIGRATION_PENDING
app.use('/api/marketing-planner', marketingPlannerRoutes);
// ★ 2026-08-13 원스텝 AI 컨텐츠 생성(인터뷰형) — 세션·견적·생성 확정. 테이블 미생성 시 503 DB_MIGRATION_PENDING
app.use('/api/one-step', contentInterviewRoutes);
// ★ 2026-08-16 AI 마케팅 진단(퍼널 A — 인증) — FREE 진단→TRIAL 7일 자동 지급. 테이블 미생성 시 503 DB_MIGRATION_PENDING
app.use('/api/marketing-diagnosis', marketingDiagnosisRoutes);
// ★ 2026-08-16 AI 마케팅 진단(퍼널 B — 미인증 리드). 본문 파서 32kb 한정은 전역 파서 앞에 선배치됨
app.use('/api/public/marketing-diagnosis', marketingDiagnosisPublicRoutes);
// ★ D184: 이니시스 표준결제 (prepare/return/close/list/detail)
app.use('/api/payments', paymentsRoutes);
app.use('/api/admin/billing', billingRoutes);
app.use('/api/admin/sync', adminSyncRoutes);
// ★ D145 P0: 더 구체적 경로 먼저 등록 (/api/admin 와일드카드 위에)
app.use('/api/admin/login-blocks', loginBlocksRoutes);
// ★ 2026-08-16 신규마케팅진단(ceo 전용 — MARKETING_DIAGNOSIS_VIEWER_IDS) — /api/admin 와일드카드 위
app.use('/api/admin/marketing-diagnosis', marketingDiagnosisAdminRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/test-contacts', testContactsRoutes);
app.use('/api/sms-templates', smsTemplatesRoutes);
app.use('/api/internal', internalAlertRoutes); // ★ D145: localhost 전용 시스템 알림
app.use('/api/mms-images', mmsImagesRoutes);
app.use('/api/auto-campaigns', autoCampaignsRoutes);
app.use('/api/saved-segments', savedSegmentsRoutes);
app.use('/api/targets', targetsRoutes);
app.use('/api/campaign-agency', campaignAgencyRoutes); // ★ 2026-07-09 CRM 캠페인 대행 — 전역 json 파서 뒤 마운트
app.use('/api/cdp', cdpRoutes); // ★ D172: 한줄로 CDP — 자사몰 → 한줄로 sync
// ★ D172-B: 카페24 OAuth callback (authenticate 우회 — 카페24가 브라우저 redirect로 호출) → cafe24Routes보다 먼저 등록
app.use('/api/cafe24', cafe24CallbackRouter);
app.use('/api/cafe24', cafe24Routes);
// ★ D178 / 2026-07-06 재작성: 네이버 커머스 = client_credentials(자격 입력형) — OAuth callback 라우터 폐기
app.use('/api/naver-commerce', naverCommerceRoutes);
// ★ 2026-07-04: 아임웹 OAuth callback (authenticate 우회) → imwebRoutes보다 먼저 등록
app.use('/api/imweb', imwebCallbackRouter);
app.use('/api/imweb', imwebRoutes);
// ★ 2026-07-30: 팝빌 세금계산서 웹훅 (인증 우회 — 팝빌 서버가 POST. 항상 200 "OK" 계약, X-Api-Key 옵션)
app.use('/api/popbill', popbillWebhookRouter);
// ★ 2026-06-18: 고도몰(NHN커머스) BYO-키 폴링 커넥터 (OAuth/Webhook 없음 — callback 라우터 불필요)
app.use('/api/godo', godoRoutes);
// ★ 2026-07-06: 메이크샵 커머스 API 폴링 커넥터 (client_credentials 자격 입력 — OAuth/webhook 없음)
app.use('/api/makeshop', makeshopRoutes);
// ★ D178: 인바운드 AI 음성 응답 (통신사 webhook + 회사 admin 토글/이력)
app.use('/api/voice', voiceRoutes);
// ★ D180: Email 채널 (SendGrid Event Webhook + 회사 admin 캠페인 CRUD/발송)
app.use('/api/email', emailRoutes);
// ★ D130: 알림톡/브랜드메시지 IMC 연동 (발신프로필/템플릿/검수/웹훅/이미지/알림수신자)
app.use('/api/alimtalk', alimtalkRoutes);
// ★ 2026-07-20 Track C M2: 게이트웨이 알림톡 매핑 관리 (super_admin 전용)
app.use('/api/gateway-templates', gatewayTemplatesRoutes);
// ★ 2026-07-20 Track D 접점: PAY 매핑 시드 (super_admin 전용)
app.use('/api/pay-mappings', payMappingsRoutes);
app.use('/api/dm', dmRouter);
// ★ 2026-07-08 행사 캠페인 (이미지 판독 + 생성 초안 임시 보관)
app.use('/api/event-campaigns', eventCampaignRouter);
// ★ 2026-07-14 디자인 4.0 — 정예 골든 템플릿 (3채널 컴파일 조회 전용)
app.use('/api/design', designTemplatesRouter);
// ★ 2026-07-08 연동 몰 상품 조회 (DM 상품 자동 채우기 — preview 실측)
app.use('/api/mall-products', mallProductsRouter);
app.use('/api/assets', assetsRouter); // ★ 2026-07-18 P3 에셋 라이브러리
app.use('/api/image-studio', imageStudioRouter); // ★ 2026-07-19 P4 AI 이미지 스튜디오

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

  // ★ 2026-06-25 (gap 7): CDP Provider registry 부팅 등록 (cafe24·naver·makeshop·godo·imweb·custom)
  registerAllProviders();

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

  // ★ 2026-08-05 요금제 무료 메시징 월 지급 (기동 즉시 1회 + 10분 주기 — 지급이 멱등이라 주기가 곧 복구 경로)
  startFreeMessagingGrantWorker();

  // ★ 2026-07-28 세금계산서 상태 전이 (5분 주기 — 팝빌 연동 전에는 ready에서 정지)
  startTaxbillWorker();

  // ★ D219+ Part 2 (2026-05-27): AI 오퍼레이션 30일 무료체험 자동 만료 로그 (매일 04:00 KST)
  startAiOperatorTrialExpireWorker();

  // ★ D219+ Part 2 (2026-05-27): Wizard 종결 회사 매일 9시 인사이트 메일 (1시간 cron, 9시 정각만 발송)
  startDailyInsightMailer();

  // ★ D151 (2026-05-11): 캠페인 결과 자동 sync (5분 주기) — fire-and-forget 사용자 진입 의존 → 백그라운드 자동
  startCampaignSyncWorker();

  // ★ D153 (2026-05-13): MySQL 진실 원천 환불 sweep (5분 주기) — PG fail_count 의존 X
  //   balance_transactions 회계 진실 + MySQL status_code 직접 카운트로 차액 환불 보정
  //   기존 syncCampaignResults가 `target > success+fail` 조건으로 SELECT 누락된 캠페인까지 sweep
  startMysqlRefundSweeper();

  // ★ D218+ (2026-05-26): 여정 발송 2시간 전 담당자 LMS 자동 발송 (5분 cron)
  startJourneyPretestNotifierWorker();

  // ★ D218+ (2026-05-26): 7일 KPI 누적 + ai_company_memory 자동 학습 (1시간 cron)
  startAiMemoryAccumulatorWorker();

  // ★ D176 (2026-05-19): Continuous Operator — 5분 주기 due Operator 체크 + 매일 09:00 KST 제안서 박음
  //   AI 단독 실행 X 영구 원칙 — 제안서만 박고 사용자 승인 대기. ENT 자동 실행 옵션은 default OFF + 임계값 통과 시만
  startContinuousOperatorScheduler();

  // ★ D187 (2026-05-20): Journey Builder Lite — 5분 주기 due execution 발송 + 5분 주기 trigger 매칭
  //   7 표준 여정 (가입/재구매/휴면/장바구니/생일/예약/Custom) + 회사 자유 임계값 + 광고 자동 검증 4건
  //   AI_OPERATOR_ALLOWED_USERS=hoyun 게이팅 (routes/ai.ts 영역)
  startJourneyExecutor();
  startJourneyTriggerWatcher();
  // ★ 2026-06-30 여정 일반화 — 날짜축 여정(date_anchor) 스케줄러: 지정일 D-N 묶음 발송 + D-0 후 정지/반복.
  startJourneyAnchorScheduler();

  // ★ D217+ (2026-05-26 Harold 명시 진단 정정): 카카오 templateCode 동기화 (30분 주기)
  //   옛 D147 영역 = 검수 통과 후 IMC 안 진정 카카오 templateCode 영역 = 한줄로 안 동기화 누락 사고 정정
  //   운영 환경 8건 100% 사고 (template_code = Tmp_xxx 자체 코드 영구 유지) 영구 안전망
  //   Phase 1 백필 endpoint (POST /api/alimtalk/jobs/sync-template-codes) + Phase 2 getAlimtalkTemplate 영역 분기 정합
  startKakaoTemplateSyncWorker();

  // ★ 2026-07-20 Track C M2: 게이트웨이 매핑 동기화 워커 (desired state 수렴 — 적재 5분·푸시 1분·대조 6h)
  //   GATEWAY_TMPL_SYNC_ENABLED=false(기본)면 자동 주기 전부 무동작(배포≠가동). 테이블 부재 시 조용히 skip.
  startGatewayTemplateMappingWorker();

  // ★ D197 (2026-05-22) Phase B-2: Predictive Suite worker — 1시간 주기 customer 예측 점수 자동 갱신
  //   클릭률 + 이탈 위험 + 구매 가능성 (Logistic Regression + cold start fallback)
  //   24h TTL — 발송 시점 cache 우선 + 없으면 즉시 계산
  startPredictiveWorker();

  // ★ 2026-07-04: 여정·브랜드 KAKAO 학습 라벨 스윕 — 30분 주기(환불·상태·큐 무접촉, 라벨 전용). 발견1(라벨 누수) fix.
  startCopyLabelSweeperWorker();

  // ★ 2026-07-25: 통계DB(pay-ingest-db) 트립와이어 — 10분 주기. 인증실패 급증(스캔) + 적재 정체(게이트웨이 push 중단) 감지.
  //   포트 23388이 0.0.0.0으로 게시돼 외부 TCP 접속이 되는 상태(실측)라 감시를 둔다.
  //   읽기 전용·기존 pay-stats 풀 공유·실패 무해 — 강문희 적재에 영향 0.
  startPayIngestMonitor();

  // ★ D210+ Phase 3 (2026-05-23 Harold 명시): 자동 재진입 worker — 6시간 주기 + 회사 admin 명시 활성 정합
  //   journeys.auto_reentry_enabled = true 영역만 진입 (default OFF — feedback_no_target_auto_relax 정합)
  //   completed 영역 + cooldown 경과 + customer 활성 영역 → 신규 execution INSERT
  startJourneyReentryWorker();

  // ★ D227+ (2026-05-28 영업팀장 박성용 신고 fix): 예약 캠페인 자동 정리 worker — 1분 cron
  //   옛 흐름 = manage-scheduled/admin/campaigns 안 응답 영역 직전 동기 cleanupScheduledCampaigns 호출 → 6만건 안 30~40초 사고
  //   = 백그라운드 1분 cron 영역 분리 → 응답 영역 즉시 + 정리 영역 보장
  startScheduledCleanupWorker();

  // ★ 대량 발송 (2026-05-30): staging 청크 발송 worker — 5초 주기 queued 처리 + commit 즉시 트리거
  startDirectSendWorker();

  // ★ 2026-06-11: 취소 잔존 큐 안전망 (1분 주기) — 취소 경로가 못 지운 발송 대기 행 자동 삭제
  startCancelledQueueSweeper();

  // ★ 2026-06-17: 만료 발송요청 안전망 (1분 주기) — rsv1=3(서버전송요청완료) 2일+ 결과없음 미발송 발송 차단
  startExpiredPendingSweeper();

  // ★ 2026-06-10: CDP webhook 실패 재처리 (5분 주기, 최대 3회) — 일시 오류 데이터 유실 차단
  startCdpWebhookRetryWorker();

  // ★ 2026-06-10: CDP unified profile 자동 재계산 (5분 증분 + 매일 04시 30일 카운터)
  startCdpProfileRecomputeWorker();

  // ★ 2026-08-10: 고도몰 주기 수집 (30분) — 연결 시 백필 1회가 전부였던 것을 정정.
  //   소급분이 발송이 되지 않는 근거 = 여정 발생 시각 창(journey-target-extractor).
  startGodoSyncWorker();

  // ★ 2026-06-13: 시스템 크리티컬 감지 (5분 주기) — 발송 큐 지연 정체 + 싱크에이전트 중단을
  //   운영자 문자(SYSTEM_ALERT_PHONES)로 직접 통지. 톤28 지연 실발송·인비토 동기화 중단 실측 후속.
  startSystemMonitorWorker();

  // ★ 2026-07-05: 발송 피로도 보호 — 일일 버킷 프루닝 (6시간 주기, 42P01 무해)
  startFatiguePruneWorker();

  // ★ 2026-06-13: 예약 Email 발송 + 정체 캠페인 복구 (1분 주기) — scheduled 도래 발송 + sending 30분+ 정체 failed
  startEmailSendSweeper();

  // ★ 2026-06-14: DM 마감 추첨 (1분 주기) — lucky_draw draw_at 도래 시 응모자 풀 등급별 랜덤 추첨
  startDmDrawWorker();

  // ★ 2026-07-19: P4 이미지 스튜디오 temp 산출물 7일 스윕 (1일 주기)
  startStudioTempSweeper();

  // ★ 2026-08-13 마케팅 플래너 Phase 3·4 (docs/FEATURE-MARKETING-PLANNER.md)
  //   실행(10분) = 오늘 예정 터치포인트를 당일 문안 생성 → 스팸 게이트 → 발송/게시.
  //   대조(1시간) = 놓친 실행·producing 고아·취소 잔존·참여 클릭 수집 + 월말 결과 통지.
  //   ⛔ 선언이 아니라 이 호출이 가동의 근거다(계약 테스트가 이 등재를 고정한다).
  //   ⛔ planner_touchpoints.exec_meta ALTER 전에는 두 워커가 통째로 쉰다(부분 실행 금지).
  startPlannerExecutor();
  startPlannerReconcileWorker();
});

export default app;
