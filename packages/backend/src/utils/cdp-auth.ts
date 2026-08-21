/**
 * ★ CT-19: 한줄로 CDP (Customer Data Platform) 인증 컨트롤타워 — D172 (2026-05-19)
 *
 * 🎯 목적
 *   자사몰 → 한줄로AI sync API 인증의 유일한 진입점.
 *   - companies.cdp_api_key (public) + companies.cdp_api_secret_hash (bcrypt) 저장
 *   - 기존 companies.api_key / api_secret (싱크에이전트 인증)와 영역 분리
 *   - requireCdpApiKey 미들웨어로 routes/cdp.ts + routes/cafe24.ts 인증 공용
 *
 * 🔑 발급 흐름 (한 번만 노출)
 *   1. CdpSettingsPage에서 '발급' 클릭
 *   2. issueCdpKeyPair() — key prefix 'hjl_' + 32 random bytes hex / secret prefix 'sk_' + 32 random bytes hex
 *   3. companies.cdp_api_key에 key, cdp_api_secret_hash에 bcrypt(secret) 저장
 *   4. 응답에 raw secret 1회 노출 → 사용자가 자사몰에 복사해 붙여넣음
 *   5. DB에는 hash만 보관 (raw 추출 불가)
 *
 * 🔐 인증 흐름
 *   - Header: X-Hanjullo-Key (public key) + X-Hanjullo-Secret (raw secret)
 *   - DB SELECT companies WHERE cdp_api_key = $1 → companies row + cdp_api_secret_hash
 *   - bcrypt.compare(secret, hash) 통과 시 회사 식별
 *   - 인증 실패 시 401 + IP 실패 카운터 (sync-agent와 동일 정책)
 *
 * 🛡 안전장치
 *   - public key 없음/포맷 불일치 → 400
 *   - 회사 status != 'active' → 403
 *   - 요금제 = FREE(미가입) → 403 + 'PLAN_FEATURE_LOCKED' (종량제 전환 Phase 3: 전 유료 개방)
 *   - 월 호출 한도 초과 → 429 (cdp_api_call_log 누적 vs plans.cdp_events_per_month)
 */

import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import { query } from '../config/database';
import { guardMachineOrigin } from './geo-access';
import { loadPlanContext } from './plan-guard';
import { isAllowedAppId } from './cdp-app-id';

// ═══════════════════════════════════════════════════════════
// 인증/한도 캐시 (2026-06-10 — 호출당 bcrypt 비교 + 월 SUM 풀스캔 부하 완화)
//   - bcrypt 성공 캐시: 같은 key+secret 조합은 5분간 sha256 비교로 단축 (재발급 시 즉시 무효화)
//   - 월 한도 캐시: 회사별 60초 TTL (한도 초과 인지가 최대 60초 늦는 오차는 허용 범위)
// ═══════════════════════════════════════════════════════════

const AUTH_CACHE_TTL_MS = 5 * 60 * 1000;
const LIMIT_CACHE_TTL_MS = 60 * 1000;

interface AuthCacheEntry {
  secretSha256: string;
  companyId: string;
  companyName: string;
  expiresAt: number;
}
const authCache = new Map<string, AuthCacheEntry>();
const limitCache = new Map<string, { over: boolean; expiresAt: number }>();

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 키 재발급/폐기 시 인증 캐시 즉시 무효화 */
export function invalidateCdpAuthCache(cdpApiKey?: string): void {
  if (cdpApiKey) authCache.delete(cdpApiKey);
  else authCache.clear();
}

// ═══════════════════════════════════════════════════════════
// 타입
// ═══════════════════════════════════════════════════════════

export interface CdpAuthContext {
  companyId: string;
  companyName: string;
  source: string; // 'sdk' / 'webhook' / 'admin' — 후속 로직에서 cdp_events.source에 기록하는 용도
}

export interface CdpKeyPair {
  cdpApiKey: string;       // public — DB 저장 + 사용자에게 영구 노출
  cdpApiSecret: string;    // raw secret — 발급 시 1회만 응답, DB에는 hash만 저장
  issuedAt: Date;
}

// Request에 companyId 넣는 확장 (다른 라우트도 동일 패턴 사용 중)
declare module 'express-serve-static-core' {
  interface Request {
    cdpAuth?: CdpAuthContext;
  }
}

// ═══════════════════════════════════════════════════════════
// 발급 / 재발급
// ═══════════════════════════════════════════════════════════

/**
 * 신규 public key + raw secret 생성 (DB 저장은 호출부에서 담당).
 * - key: 'hjl_' + 64 hex (총 68자, varchar(100) 안전)
 * - secret: 'sk_' + 64 hex (총 67자)
 */
export function generateCdpKeyPair(): { cdpApiKey: string; cdpApiSecret: string } {
  const cdpApiKey = `hjl_${randomBytes(32).toString('hex')}`;
  const cdpApiSecret = `sk_${randomBytes(32).toString('hex')}`;
  return { cdpApiKey, cdpApiSecret };
}

/**
 * 회사에 신규 CDP key pair 발급 + DB 저장.
 * - 기존 키가 있어도 덮어쓰기 (재발급)
 * - raw secret은 응답으로만 1회 노출
 */
export async function issueCdpKeyPair(companyId: string): Promise<CdpKeyPair> {
  const { cdpApiKey, cdpApiSecret } = generateCdpKeyPair();
  const cdpApiSecretHash = await bcrypt.hash(cdpApiSecret, 10);
  const issuedAt = new Date();

  // 재발급 시 이전 키의 인증 캐시 즉시 무효화 (이전 키 5분 잔존 차단)
  const prev = await query(`SELECT cdp_api_key FROM companies WHERE id = $1::uuid`, [companyId]);
  if (prev.rows[0]?.cdp_api_key) invalidateCdpAuthCache(prev.rows[0].cdp_api_key);

  await query(
    `UPDATE companies
     SET cdp_api_key = $1,
         cdp_api_secret_hash = $2,
         cdp_api_key_issued_at = $3,
         updated_at = NOW()
     WHERE id = $4::uuid`,
    [cdpApiKey, cdpApiSecretHash, issuedAt, companyId]
  );

  return { cdpApiKey, cdpApiSecret, issuedAt };
}

// ═══════════════════════════════════════════════════════════
// 미들웨어 — requireCdpApiKey
// ═══════════════════════════════════════════════════════════

/**
 * 헤더에서 CDP key pair 추출 + 회사 식별 + plans 게이팅.
 * 통과 시 req.cdpAuth에 담음, 실패 시 401/403/429.
 */
export async function requireCdpApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cdpApiKey = (req.headers['x-hanjullo-key'] || req.headers['X-Hanjullo-Key']) as string | undefined;
    const cdpApiSecret = (req.headers['x-hanjullo-secret'] || req.headers['X-Hanjullo-Secret']) as string | undefined;

    if (!cdpApiKey || !cdpApiSecret) {
      res.status(401).json({
        success: false,
        error: 'X-Hanjullo-Key 또는 X-Hanjullo-Secret 헤더가 누락되었습니다.',
        code: 'MISSING_CREDENTIALS',
      });
      return;
    }

    if (!cdpApiKey.startsWith('hjl_') || !cdpApiSecret.startsWith('sk_')) {
      res.status(400).json({
        success: false,
        error: 'CDP API 키 포맷이 올바르지 않습니다.',
        code: 'INVALID_KEY_FORMAT',
      });
      return;
    }

    // bcrypt 성공 캐시 — 같은 key+secret 조합은 5분간 sha256 비교로 단축 (호출당 ~100ms CPU 차단)
    const cached = authCache.get(cdpApiKey);
    let company: { id: string; company_name: string; status: string; cdp_api_secret_hash?: string };
    if (cached && cached.expiresAt > Date.now() && cached.secretSha256 === sha256Hex(cdpApiSecret)) {
      const statusRow = await query(`SELECT status FROM companies WHERE id = $1::uuid`, [cached.companyId]);
      if (statusRow.rows.length === 0) {
        authCache.delete(cdpApiKey);
        res.status(401).json({ success: false, error: 'CDP 인증에 실패했습니다.', code: 'INVALID_CREDENTIALS' });
        return;
      }
      company = { id: cached.companyId, company_name: cached.companyName, status: statusRow.rows[0].status };
    } else {
      const result = await query(
        `SELECT id, company_name, status, cdp_api_secret_hash
         FROM companies
         WHERE cdp_api_key = $1`,
        [cdpApiKey]
      );

      if (result.rows.length === 0) {
        res.status(401).json({
          success: false,
          error: 'CDP 인증에 실패했습니다.',
          code: 'INVALID_CREDENTIALS',
        });
        return;
      }

      company = result.rows[0];
      const hashOk = await bcrypt.compare(cdpApiSecret, company.cdp_api_secret_hash || '');
      if (!hashOk) {
        res.status(401).json({
          success: false,
          error: 'CDP 인증에 실패했습니다.',
          code: 'INVALID_CREDENTIALS',
        });
        return;
      }
      authCache.set(cdpApiKey, {
        secretSha256: sha256Hex(cdpApiSecret),
        companyId: company.id,
        companyName: company.company_name,
        expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
      });
    }

    if (company.status !== 'active') {
      res.status(403).json({
        success: false,
        error: `회사 상태가 ${company.status} 입니다. 발송을 진행할 수 없습니다.`,
        code: 'COMPANY_INACTIVE',
      });
      return;
    }

    // 요금제 게이팅 (cdp_enabled)
    const planCtx = await loadPlanContext(company.id);
    if (!planCtx) {
      res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.', code: 'COMPANY_NOT_FOUND' });
      return;
    }
    const cdpEnabled = await isCdpEnabledForPlan(company.id);
    if (!cdpEnabled) {
      res.status(403).json({
        success: false,
        error: '한줄로 CDP는 유료 요금제 가입 후 이용 가능합니다.',
        code: 'PLAN_FEATURE_LOCKED',
      });
      return;
    }

    // 월 호출 한도 게이팅 (cdp_events_per_month)
    const overLimit = await isOverMonthlyCdpLimit(company.id);
    if (overLimit) {
      res.status(429).json({
        success: false,
        error: '이번 달 CDP API 호출 한도를 초과했습니다. 요금제 업그레이드 또는 다음 달 재시도 부탁드립니다.',
        code: 'MONTHLY_LIMIT_EXCEEDED',
      });
      return;
    }

    // ★ 2026-08-19 전송자격인증 2.2 — 서버 대 서버 연동의 출발지 통제.
    //   ⛔ 브라우저 SDK 경로(requireCdpBrowserOrigin·requireCdpAppId)에는 걸지 않는다.
    //      그쪽은 쇼핑객 단말에서 오는 호출이라 회사 출발지 대역으로 막으면 수집이 통째로 죽는다.
    if (!(await guardMachineOrigin(req, res, company.id, 'company_api'))) return;

    req.cdpAuth = {
      companyId: company.id,
      companyName: company.company_name,
      source: 'sdk', // 기본 — 카페24/Shopify 등 webhook receiver는 source 별도 지정
    };
    next();
  } catch (err: any) {
    console.error('[CDP Auth] 인증 처리 실패:', err);
    res.status(500).json({ success: false, error: 'CDP 인증 처리 중 오류가 발생했습니다.' });
  }
}

/**
 * 브라우저 SDK 전용 인증 — public key + 등록 도메인(Origin) 검증 (secret 미요구).
 *   secret을 브라우저 <script>에 두면 view-source 탈취 → 회사 사칭 사고.
 *   따라서 브라우저 수집 경로는 cdp_allowed_origins(등록 도메인)이 보안 경계.
 *   서버-투-서버(identify/order 등)는 requireCdpApiKey(secret) 그대로 사용.
 */
export async function requireCdpBrowserOrigin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cdpApiKey = (req.headers['x-hanjullo-key'] || req.headers['X-Hanjullo-Key']) as string | undefined;
    if (!cdpApiKey || !cdpApiKey.startsWith('hjl_')) {
      res.status(401).json({ success: false, error: 'X-Hanjullo-Key 누락 또는 포맷 오류입니다.', code: 'MISSING_KEY' });
      return;
    }

    const result = await query(
      `SELECT id, company_name, status, cdp_allowed_origins
       FROM companies
       WHERE cdp_api_key = $1`,
      [cdpApiKey],
    );
    if (result.rows.length === 0) {
      res.status(401).json({ success: false, error: 'CDP 인증에 실패했습니다.', code: 'INVALID_KEY' });
      return;
    }

    const company = result.rows[0];
    if (company.status !== 'active') {
      res.status(403).json({ success: false, error: `회사 상태가 ${company.status} 입니다.`, code: 'COMPANY_INACTIVE' });
      return;
    }
    if (!(await isCdpEnabledForPlan(company.id))) {
      res.status(403).json({ success: false, error: '한줄로 CDP는 유료 요금제 가입 후 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
      return;
    }
    if (await isOverMonthlyCdpLimit(company.id)) {
      res.status(429).json({ success: false, error: '이번 달 CDP API 호출 한도를 초과했습니다.', code: 'MONTHLY_LIMIT_EXCEEDED' });
      return;
    }

    // 등록 도메인(Origin) 검증 — 정규화(소문자 + trailing slash 제거 + www. 제거) 후 일치
    // www/non-www는 같은 사이트 — 고객사 접속 도메인이 제각각이라 동일 취급(다른 서브도메인은 그대로 구분)
    const norm = (o: string) => o.trim().toLowerCase().replace(/\/+$/, '').replace(/^(https?:\/\/)www\./, '$1');
    const origin = norm((req.headers['origin'] as string) || '');
    const allowed: string[] = Array.isArray(company.cdp_allowed_origins) ? company.cdp_allowed_origins.map(norm) : [];
    if (!origin || !allowed.includes(origin)) {
      res.status(403).json({
        success: false,
        error: '등록되지 않은 도메인입니다. 관리자 → CDP 설정에서 도메인을 먼저 등록해주세요.',
        code: 'ORIGIN_NOT_ALLOWED',
      });
      return;
    }

    req.cdpAuth = { companyId: company.id, companyName: company.company_name, source: 'sdk' };
    next();
  } catch (err: any) {
    // db_alter_safety_net — cdp_allowed_origins 미마이그레이션 시 503
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      res.status(503).json({ success: false, error: 'DB 마이그레이션 필요: companies.cdp_allowed_origins ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
      return;
    }
    console.error('[CDP BrowserAuth] 인증 처리 실패:', err);
    res.status(500).json({ success: false, error: 'CDP 브라우저 인증 처리 중 오류가 발생했습니다.' });
  }
}

/**
 * 네이티브 앱 인증 — public key + 등록 번들ID(X-Hanjullo-App-Id) 검증 (secret·Origin 미요구).
 *   네이티브 앱(React Native 등)은 브라우저 Origin을 못 보내므로(RN fetch는 Origin 미전송 → 도메인 검증 불가),
 *   등록 번들ID(companies.cdp_allowed_app_ids)가 보안 경계. 시크릿은 앱 바이너리 추출 위험이라 미요구.
 *   cdp_allowed_origins(웹)의 앱 버전. plan·월 한도 게이팅은 브라우저 경로와 동일.
 */
export async function requireCdpAppId(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cdpApiKey = (req.headers['x-hanjullo-key'] || req.headers['X-Hanjullo-Key']) as string | undefined;
    if (!cdpApiKey || !cdpApiKey.startsWith('hjl_')) {
      res.status(401).json({ success: false, error: 'X-Hanjullo-Key 누락 또는 포맷 오류입니다.', code: 'MISSING_KEY' });
      return;
    }
    const appId = (req.headers['x-hanjullo-app-id'] || req.headers['X-Hanjullo-App-Id']) as string | undefined;

    const result = await query(
      `SELECT id, company_name, status, cdp_allowed_app_ids
       FROM companies
       WHERE cdp_api_key = $1`,
      [cdpApiKey],
    );
    if (result.rows.length === 0) {
      res.status(401).json({ success: false, error: 'CDP 인증에 실패했습니다.', code: 'INVALID_KEY' });
      return;
    }

    const company = result.rows[0];
    if (company.status !== 'active') {
      res.status(403).json({ success: false, error: `회사 상태가 ${company.status} 입니다.`, code: 'COMPANY_INACTIVE' });
      return;
    }
    if (!(await isCdpEnabledForPlan(company.id))) {
      res.status(403).json({ success: false, error: '한줄로 CDP는 유료 요금제 가입 후 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
      return;
    }
    if (await isOverMonthlyCdpLimit(company.id)) {
      res.status(429).json({ success: false, error: '이번 달 CDP API 호출 한도를 초과했습니다.', code: 'MONTHLY_LIMIT_EXCEEDED' });
      return;
    }

    // 등록 번들ID 검증 — cdp_allowed_app_ids (웹 cdp_allowed_origins의 앱 버전)
    if (!isAllowedAppId(company.cdp_allowed_app_ids, appId || '')) {
      res.status(403).json({
        success: false,
        error: '등록되지 않은 앱입니다. 관리자 → 자사몰 연동에서 앱(번들ID)을 먼저 등록해주세요.',
        code: 'APP_NOT_ALLOWED',
      });
      return;
    }

    req.cdpAuth = { companyId: company.id, companyName: company.company_name, source: 'sdk' };
    next();
  } catch (err: any) {
    // db_alter_safety_net — cdp_allowed_app_ids 미마이그레이션 시 503
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      res.status(503).json({ success: false, error: 'DB 마이그레이션 필요: companies.cdp_allowed_app_ids ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
      return;
    }
    console.error('[CDP AppAuth] 인증 처리 실패:', err);
    res.status(500).json({ success: false, error: 'CDP 앱 인증 처리 중 오류가 발생했습니다.' });
  }
}

// ═══════════════════════════════════════════════════════════
// 헬퍼 — 요금제 게이팅
// ═══════════════════════════════════════════════════════════

export async function isCdpEnabledForPlan(companyId: string): Promise<boolean> {
  // 종량제 전환(Phase 3, 2026-06-02): CDP(자사몰/이메일/네이버 연동) = 전 유료 플랜 개방.
  //   기존 cdp_enabled 플래그(BUSINESS+) 게이팅 폐지 → FREE(미가입)만 차단.
  //   월 호출 한도(cdp_events_per_month)는 isOverMonthlyCdpLimit이 별도 통제(유지).
  const result = await query(
    `SELECT UPPER(COALESCE(p.plan_code, 'FREE')) AS plan_code
     FROM companies c
     LEFT JOIN plans p ON c.plan_id = p.id
     WHERE c.id = $1::uuid`,
    [companyId]
  );
  if (result.rows.length === 0) return false;
  return result.rows[0].plan_code !== 'FREE';
}

/**
 * 이번 달(KST 기준) cdp_api_call_log의 call_count 합 vs plans.cdp_events_per_month 비교.
 * - 한도 = NULL → 무제한 (ENTERPRISE)
 * - 한도 초과 시 true 반환 → 429 차단
 */
export async function isOverMonthlyCdpLimit(companyId: string): Promise<boolean> {
  // 60초 캐시 — 호출마다 cdp_api_call_log 한 달치 SUM 풀스캔하던 부하 완화
  const cachedLimit = limitCache.get(companyId);
  if (cachedLimit && cachedLimit.expiresAt > Date.now()) {
    return cachedLimit.over;
  }
  const result = await query(
    `SELECT
        p.cdp_events_per_month AS monthly_limit,
        COALESCE((
          SELECT SUM(call_count) FROM cdp_api_call_log
          WHERE company_id = c.id
            AND occurred_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'
        ), 0) AS used
     FROM companies c
     LEFT JOIN plans p ON c.plan_id = p.id
     WHERE c.id = $1::uuid`,
    [companyId]
  );
  if (result.rows.length === 0) return true; // 회사 없음 = 차단
  const limit = result.rows[0].monthly_limit;
  const used = parseInt(result.rows[0].used || '0');
  const over = (limit === null || limit === undefined) ? false : used >= parseInt(limit);
  limitCache.set(companyId, { over, expiresAt: Date.now() + LIMIT_CACHE_TTL_MS });
  return over;
}

// ═══════════════════════════════════════════════════════════
// 겸용 미들웨어 — requireCdpKeyOrBrowserOrigin (2026-06-10)
//   브라우저 기능(인앱/웹푸시/여정 변이 트래킹) endpoint용.
//   - X-Hanjullo-Secret 헤더가 오면: 서버-투-서버 = requireCdpApiKey (secret 검증)
//   - 없으면: 브라우저 = requireCdpBrowserOrigin (public key + 등록 도메인 검증)
//   이전에는 이 endpoint들이 secret을 요구해 브라우저에 secret을 넣어야만 동작했고,
//   그것은 cdp-auth 설계 주석 스스로 금지한 방식이었다 (view-source 탈취 = 회사 사칭).
// ═══════════════════════════════════════════════════════════

export async function requireCdpKeyOrBrowserOrigin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const hasSecret = !!(req.headers['x-hanjullo-secret'] || req.headers['X-Hanjullo-Secret']);
  if (hasSecret) {
    return requireCdpApiKey(req, res, next);
  }
  // 네이티브 앱(X-Hanjullo-App-Id 헤더) — 시크릿·Origin 없이 public key + 등록 번들ID 검증
  const hasAppId = !!(req.headers['x-hanjullo-app-id'] || req.headers['X-Hanjullo-App-Id']);
  if (hasAppId) {
    return requireCdpAppId(req, res, next);
  }
  return requireCdpBrowserOrigin(req, res, next);
}

// ═══════════════════════════════════════════════════════════
// 호출 누적 (cdp_api_call_log)
// ═══════════════════════════════════════════════════════════

/**
 * CDP API 호출 1건을 cdp_api_call_log에 기록 (요금제 한도 집계용).
 * - fire-and-forget 방식 (실패해도 응답 차단 X)
 */
export async function recordCdpApiCall(
  companyId: string,
  endpoint: 'identify' | 'event' | 'order' | 'bulk-import',
  statusCode: number,
  callCount: number = 1
): Promise<void> {
  try {
    await query(
      `INSERT INTO cdp_api_call_log (company_id, endpoint, call_count, status_code, occurred_at)
       VALUES ($1::uuid, $2, $3, $4, NOW())`,
      [companyId, endpoint, callCount, statusCode]
    );
  } catch (err) {
    console.warn('[CDP Auth] recordCdpApiCall 실패 (응답 차단 X):', err);
  }
}
