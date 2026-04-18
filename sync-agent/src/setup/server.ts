/**
 * 설치 마법사 로컬 웹 서버
 *
 * 실행: sync-agent.exe --setup
 * 동작:
 *   1. Express 서버 시작 (localhost:9876)
 *   2. 브라우저 자동 열기
 *   3. 설정 완료 → config.enc (암호화) 저장 → 서버 종료
 *   4. (선택) Agent 자동 시작
 *
 * 보안:
 *   - 기본: AES-256-GCM 암호화 저장 (config.enc + agent.key)
 *   - 개발: DEV_MODE=true 시 평문 저장 (config.json)
 *
 * 변경사항 (2026-02-11):
 *   - 기본 저장 방식을 암호화(config.enc)로 변경
 *   - DEV_MODE 환경변수로 개발 모드 전환
 *   - 저장 시 보안 정보 로깅 (키 경로, enc 경로)
 */

import express from 'express';
import { createDbConnector, type IDbConnector } from '../db';
import type { DbConnectionConfig, ColumnInfo } from '../db/types';
import {
  saveConfigEncrypted,
  saveConfigJson,
  AgentConfigSchema,
  type AgentConfig,
} from '../config';
import { getLogger, initLogger } from '../logger';
import { ZodError } from 'zod';
import { SETUP_HTML } from './setup-html';

const PORT = 9876;
const DEV_MODE = process.env.DEV_MODE === 'true';

export interface SetupWizardOptions {
  /** 마법사 완료 후 Agent 자동 시작 여부 (기본: false) */
  autoLaunchAgent?: boolean;
}

export async function startSetupWizard(
  options: SetupWizardOptions = {}
): Promise<void> {
  const { autoLaunchAgent = false } = options;

  // 기본 로거 초기화
  initLogger({ level: 'info', maxFiles: 30, maxSize: '20m' });
  const logger = getLogger('setup');

  const app = express();
  app.use(express.json());

  // ─── API: DB 접속 테스트 ────────────────────────────────
  app.post('/api/setup/test-db', async (req, res) => {
    const t0 = Date.now();
    const { type, host, port, database, username, password } = req.body;
    logger.info('[api:test-db] ← 요청', { type, host, port, database, username });

    try {
      const config: DbConnectionConfig = {
        type, host,
        port: parseInt(port, 10),
        database, username, password,
        queryTimeout: 10000,
      };

      const connector = createDbConnector(config);
      const ok = await connector.testConnection();
      await connector.disconnect();

      const ms = Date.now() - t0;
      if (ok) {
        logger.info('[api:test-db] → 성공', { ms });
        res.json({ success: true, message: 'DB 연결 성공' });
      } else {
        logger.warn('[api:test-db] → 실패(false)', { ms });
        res.json({ success: false, message: 'DB 연결 실패' });
      }
    } catch (error) {
      const ms = Date.now() - t0;
      const msg = error instanceof Error ? error.message : 'DB 연결 오류';
      logger.error('[api:test-db] ✗ 예외', { ms, error: msg });
      res.json({ success: false, message: msg });
    }
  });

  // ─── API: 테이블 목록 조회 ──────────────────────────────
  app.post('/api/setup/tables', async (req, res) => {
    const t0 = Date.now();
    const { type, host, port, database, username, password } = req.body;
    logger.info('[api:tables] ← 요청', { type, host, database, username });

    try {
      const config: DbConnectionConfig = {
        type, host,
        port: parseInt(port, 10),
        database, username, password,
        queryTimeout: 10000,
      };

      const connector = createDbConnector(config);
      await connector.testConnection();
      const tables = await connector.getTables();
      await connector.disconnect();

      const ms = Date.now() - t0;
      logger.info('[api:tables] → 성공', { count: tables.length, ms });
      if (tables.length === 0) {
        logger.warn('[api:tables] 테이블이 0개 반환됨 — 계정 권한(db_datareader) 확인 필요');
      }
      res.json({ success: true, tables });
    } catch (error) {
      const ms = Date.now() - t0;
      const msg = error instanceof Error ? error.message : '테이블 조회 실패';
      logger.error('[api:tables] ✗ 예외', { ms, error: msg });
      res.json({ success: false, message: msg });
    }
  });

  // ─── API: 컬럼 목록 조회 ───────────────────────────────
  app.post('/api/setup/columns', async (req, res) => {
    const t0 = Date.now();
    const { type, host, port, database, username, password, tableName } = req.body;
    logger.info('[api:columns] ← 요청', { type, host, database, tableName });

    try {
      const config: DbConnectionConfig = {
        type, host,
        port: parseInt(port, 10),
        database, username, password,
        queryTimeout: 10000,
      };

      const connector = createDbConnector(config);
      await connector.testConnection();
      const columns = await connector.getColumns(tableName);
      await connector.disconnect();

      const ms = Date.now() - t0;
      logger.info('[api:columns] → 성공', { tableName, count: columns.length, ms });
      res.json({ success: true, columns });
    } catch (error) {
      const ms = Date.now() - t0;
      const msg = error instanceof Error ? error.message : '컬럼 조회 실패';
      logger.error('[api:columns] ✗ 예외', { tableName, ms, error: msg });
      res.json({ success: false, message: msg });
    }
  });

  // ─── API: 자동 매핑 추천 (로컬 키워드 규칙 기반) ─────────
  app.post('/api/setup/auto-mapping', async (req, res) => {
    const { columns, target } = req.body as {
      columns: string[];
      target: 'customers' | 'purchases';
    };

    try {
      const { autoSuggestMapping } = await import('../mapping/templates');
      const suggestion = autoSuggestMapping(columns, target);

      res.json({
        success: true,
        mapping: suggestion.mapping,
        matchedCount: suggestion.matchedCount,
        unmapped: suggestion.unmapped,
        details: suggestion.details,
      });
    } catch (error) {
      res.json({
        success: false,
        message: error instanceof Error ? error.message : '자동 매핑 실패',
      });
    }
  });

  // ─── API: AI 자동 매핑 (v1.5.0 — Claude Opus 4.7) ───────
  // 사용자가 입력한 서버 접속정보(apiKey/apiSecret)로 서버 /api/sync/ai-mapping 호출.
  // 실패 시 로컬 autoSuggestMapping 폴백.
  app.post('/api/setup/ai-mapping', async (req, res) => {
    const { serverUrl, apiKey, apiSecret, columns, target, tableName, dbType } = req.body as {
      serverUrl: string;
      apiKey: string;
      apiSecret: string;
      columns: string[];
      target: 'customers' | 'purchases';
      tableName: string;
      dbType: 'mssql' | 'mysql' | 'oracle' | 'postgres' | 'excel' | 'csv';
    };

    try {
      if (!serverUrl || !apiKey || !apiSecret) {
        return res.json({
          success: false,
          message: '서버 URL / API Key / API Secret이 필요합니다. 먼저 Step 1을 완료하세요.',
        });
      }

      const { suggestMappingWithAI } = await import('../mapping');
      const result = await suggestMappingWithAI({
        serverUrl,
        credentials: { apiKey, apiSecret },
        target,
        tableName,
        dbType,
        sourceColumns: columns,
      });

      res.json({
        success: true,
        mapping: result.mapping,
        customFieldLabels: result.customFieldLabels,
        overflowColumns: result.overflowColumns,
        unmappedColumns: result.unmappedColumns,
        modelUsed: result.modelUsed,
        fallbackUsed: result.fallbackUsed,
        fallbackReason: result.fallbackReason,
        cacheHit: result.cacheHit,
        tokensUsed: result.tokensUsed,
        costEstimate: result.costEstimate,
      });
    } catch (error) {
      logger.error('[api:ai-mapping] ✗ 예외', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.json({
        success: false,
        message: error instanceof Error ? error.message : 'AI 매핑 실패',
      });
    }
  });

  // ─── API: 설정 저장 ────────────────────────────────────
  app.post('/api/setup/save', async (req, res) => {
    const { config } = req.body as { config: AgentConfig };

    // 1) Zod 검증
    try {
      AgentConfigSchema.parse(config);
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map(
          (i) => `${i.path.join('.')}: ${i.message}`
        ).join(', ');
        res.json({
          success: false,
          message: `설정 검증 실패: ${issues}`,
        });
        return;
      }
    }

    // 2) 저장
    try {
      if (DEV_MODE) {
        // 개발 모드: 평문 JSON
        saveConfigJson(config);
        logger.info('⚠️  설정 저장 완료 (평문 JSON — 개발 모드)');
        res.json({
          success: true,
          message: '설정 저장 완료 (개발 모드 — 평문)',
          encrypted: false,
          configPath: 'data/config.json',
        });
      } else {
        // 프로덕션: AES-256-GCM 암호화
        const { keyPath, encPath } = saveConfigEncrypted(config);
        logger.info('🔒 설정 암호화 저장 완료');
        logger.info(`   암호화 설정: ${encPath}`);
        logger.info(`   암호화 키: ${keyPath}`);
        res.json({
          success: true,
          message: '설정 저장 완료 (AES-256-GCM 암호화)',
          encrypted: true,
          configPath: 'data/config.enc',
          keyPath: 'data/agent.key',
        });
      }

      // 3) 저장 후 Express 서버 닫고 → Agent 시작
      setTimeout(() => {
        // Express 서버 먼저 종료 (포트 9876 해제)
        server.close(() => {
          logger.info('설치 마법사 웹 서버 종료');

          if (autoLaunchAgent) {
            logger.info('Agent 자동 시작...');
            console.log('');
            console.log('╔══════════════════════════════════════════════════╗');
            console.log('║  ✅ 설정 완료! Agent를 시작합니다...              ║');
            if (!DEV_MODE) {
              console.log('║  🔒 설정은 AES-256-GCM으로 암호화 저장됨          ║');
            }
            console.log('╚══════════════════════════════════════════════════╝');
            console.log('');

            import('../index').catch((err) => {
              logger.error('Agent 시작 실패', { error: err });
              console.error('❌ Agent 시작 실패:', err);
              process.exit(1);
            });
          } else {
            console.log('');
            console.log('╔══════════════════════════════════════════════════╗');
            console.log('║  ✅ 설정 완료!                                   ║');
            if (!DEV_MODE) {
              console.log('║  🔒 설정은 AES-256-GCM으로 암호화 저장됨          ║');
            }
            console.log('║  이제 sync-agent.exe 를 실행하면 동기화가         ║');
            console.log('║  시작됩니다.                                     ║');
            console.log('╚══════════════════════════════════════════════════╝');
            console.log('');
            process.exit(0);
          }
        });
      }, 2000);
    } catch (error) {
      res.json({
        success: false,
        message: error instanceof Error ? error.message : '설정 저장 실패',
      });
    }
  });
  // ─── API: 서버 상태 확인 ────────────────────────────────
  app.get('/api/setup/ping', (_req, res) => {
    res.json({ ok: true, devMode: DEV_MODE });
  });

  // ─── HTML 서빙 (인라인 — pkg exe 호환) ─────────────────
  // esbuild→pkg 번들링 시 파일시스템의 HTML이 포함되지 않으므로
  // HTML을 JS 문자열로 임베드하여 직접 응답
  app.get('/', (_req, res) => {
    res.type('html').send(SETUP_HTML);
  });
  app.get('/{*splat}', (_req, res) => {
    res.type('html').send(SETUP_HTML);
  });

  // ─── 서버 시작 ─────────────────────────────────────────
  const server = app.listen(PORT, () => {
    logger.info(`설치 마법사 시작: http://localhost:${PORT}`);
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║   Sync Agent 설치 마법사                  ║');
    console.log(`║   http://localhost:${PORT}                  ║`);
    console.log('║   브라우저가 자동으로 열립니다              ║');
    if (DEV_MODE) {
      console.log('║   ⚠️  개발 모드 — 평문 저장                ║');
    } else {
      console.log('║   🔒 프로덕션 — AES-256 암호화 저장        ║');
    }
    console.log('╚══════════════════════════════════════════╝');
    if (autoLaunchAgent) {
      console.log('  ℹ️  설정 완료 후 Agent가 자동으로 시작됩니다.');
    }
    console.log('');

    // 브라우저 자동 열기
    openBrowser(`http://localhost:${PORT}`);
  });
}

// ─── 브라우저 열기 (크로스플랫폼) ──────────────────────────

async function openBrowser(url: string): Promise<void> {
  try {
    const { exec } = await import('node:child_process');
    const platform = process.platform;
    if (platform === 'win32') {
      exec(`start ${url}`);
    } else if (platform === 'darwin') {
      exec(`open ${url}`);
    } else {
      exec(`xdg-open ${url}`);
    }
  } catch {
    console.log(`브라우저에서 열어주세요: ${url}`);
  }
}
