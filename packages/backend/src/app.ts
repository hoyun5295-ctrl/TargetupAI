import aiRoutes from './routes/ai';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
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
import adminRoutes from './routes/admin';

// 공용 관리 라우트 (슈퍼관리자 + 고객사관리자)
import manageUsersRoutes from './routes/manage-users';
import manageCallbacksRoutes from './routes/manage-callbacks';
import manageScheduledRoutes from './routes/manage-scheduled';
import manageStatsRoutes from './routes/manage-stats';

// DB 연결
import './config/database';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use('/api/upload', uploadRoutes);
app.use('/api/sync', syncRoutes);

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
app.use('/api/v1/results', resultsRoutes);
app.use('/api/unsubscribes', unsubscribesRoutes);
app.use('/api/address-books', addressBooksRoutes);
app.use('/api/balance', balanceRoutes);
app.use('/api/admin/billing', billingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/test-contacts', testContactsRoutes);

// 공용 관리 라우트 (슈퍼관리자 + 고객사관리자)
app.use('/api/manage/users', manageUsersRoutes);
app.use('/api/manage/callbacks', manageCallbacksRoutes);
app.use('/api/manage/scheduled', manageScheduledRoutes);
app.use('/api/manage/stats', manageStatsRoutes);

// 404 처리
app.use((req, res) => {
  res.status(404).json({ error: '요청한 리소스를 찾을 수 없습니다.' });
});

// 에러 핸들러
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('서버 에러:', err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
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
});

export default app;
