// routes/sync.ts
// Sync Agent API — FIELD_MAP 기반 동적 전환 (D39+ 반영)
// 하드코딩 금지. standard-field-map.ts가 유일한 기준.

import { Request, Response, Router } from 'express';
import { query } from '../config/database';
import { TIMEOUTS, RATE_LIMITS, BATCH_SIZES } from '../config/defaults';
import { normalizePhone, normalizeRegion, normalizeDate, normalizeCustomFieldValue } from '../utils/normalize';
import {
  FIELD_MAP,
  CATEGORY_LABELS,
  getColumnFields,
  getCustomFields,
  upsertCustomFieldDefinitions,
} from '../utils/standard-field-map';
import { callAiMapping, AiMappingQuotaExceeded, AiMappingUnavailable, SupportedDbType, MappingTarget } from '../utils/ai-mapping';
import { createCustomerUpsertBuilder } from '../utils/customer-upsert';

const router = Router();

// ============================================
// Rate Limit & 동시 동기화 제한 (인메모리)
// ============================================

// --- IP별 인증 실패 카운트 (C-1: 브루트포스 방어) ---
const ipFailures = new Map<string, { count: number; resetAt: number }>();

// --- 회사별 요청 카운트 (C-1: 인증 성공 후 분당 60회) ---
const companyRequests = new Map<string, { count: number; resetAt: number }>();

// --- 회사별 동시 full sync 진행 추적 (C-2) ---
const activeSyncs = new Map<string, { syncType: string; startedAt: number }>();

// 만료 레코드 정리 (5분 주기, 메모리 누수 방지)
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of ipFailures) {
    if (now > val.resetAt) ipFailures.delete(key);
  }
  for (const [key, val] of companyRequests) {
    if (now > val.resetAt) companyRequests.delete(key);
  }
  // activeSyncs: 30분 이상 stuck된 항목 정리 (Agent 크래시 대비)
  for (const [key, val] of activeSyncs) {
    if (now - val.startedAt > TIMEOUTS.syncStaleThreshold) {
      console.warn(`[Sync RateLimit] Stale activeSyncs removed: company=${key}, type=${val.syncType}`);
      activeSyncs.delete(key);
    }
  }
}, TIMEOUTS.syncCleanupInterval);

/** IP 실패 카운트 증가 (syncAuth에서 호출) */
function recordIpFailure(ip: string) {
  const now = Date.now();
  const entry = ipFailures.get(ip);
  if (entry && now < entry.resetAt) {
    entry.count++;
  } else {
    ipFailures.set(ip, { count: 1, resetAt: now + RATE_LIMITS.windowMs });
  }
}

/** IP Rate Limit 미들웨어 — syncAuth 앞에서 차단 */
function ipRateLimit(req: Request, res: Response, next: Function) {
  const ip = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
  const entry = ipFailures.get(ip);
  if (entry && Date.now() < entry.resetAt && entry.count >= RATE_LIMITS.ipFailThreshold) {
    console.warn(`[Sync RateLimit] IP blocked (auth failures): ${ip} (${entry.count} failures)`);
    return res.status(429).json({
      success: false,
      error: 'Too many authentication failures. Try again later.',
      retry_after_seconds: Math.ceil((entry.resetAt - Date.now()) / 1000)
    });
  }
  next();
}

/** 회사 Rate Limit 미들웨어 — syncAuth 뒤에서 적용 */
function companyRateLimit(req: SyncAuthRequest, res: Response, next: Function) {
  const companyId = req.companyId;
  if (!companyId) return next(); // syncAuth 통과 못했으면 skip

  const now = Date.now();
  const entry = companyRequests.get(companyId);
  if (entry && now < entry.resetAt) {
    if (entry.count >= RATE_LIMITS.companyMaxPerMinute) {
      console.warn(`[Sync RateLimit] Company rate limited: ${req.companyName} (${entry.count} req/min)`);
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. Maximum 60 requests per minute.',
        retry_after_seconds: Math.ceil((entry.resetAt - now) / 1000)
      });
    }
    entry.count++;
  } else {
    companyRequests.set(companyId, { count: 1, resetAt: now + 60_000 });
  }
  next();
}


// ============================================
// 미들웨어: Sync API 인증 (X-Sync-ApiKey / X-Sync-Secret)
// ============================================
interface SyncAuthRequest extends Request {
  companyId?: string;
  companyName?: string;
}

async function syncAuth(req: SyncAuthRequest, res: Response, next: Function) {
  try {
    const apiKey = req.headers['x-sync-apikey'] as string;
    const apiSecret = req.headers['x-sync-secret'] as string;

    if (!apiKey || !apiSecret) {
      const ip = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
      recordIpFailure(ip);
      return res.status(401).json({
        success: false,
        error: 'Missing X-Sync-ApiKey or X-Sync-Secret header'
      });
    }

    const result = await query(
      `SELECT id, name, company_name, status, use_db_sync 
       FROM companies 
       WHERE api_key = $1 AND api_secret = $2`,
      [apiKey, apiSecret]
    );

    if (result.rows.length === 0) {
      const ip = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
      recordIpFailure(ip);
      return res.status(401).json({
        success: false,
        error: 'Invalid API credentials'
      });
    }

    const company = result.rows[0];

    if (company.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: 'Company account is not active'
      });
    }

    if (!company.use_db_sync) {
      return res.status(403).json({
        success: false,
        error: 'DB sync is not enabled for this company'
      });
    }

    req.companyId = company.id;
    req.companyName = company.company_name || company.name;
    next();
  } catch (error) {
    console.error('[Sync Auth Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
}

// 모든 sync 라우트에 인증 + rate limit 적용
router.use(ipRateLimit, syncAuth, companyRateLimit);

// ============================================
// 공통 헬퍼 — 설정 응답 + 수신거부 3단 배정
// ============================================

/**
 * Agent 응답용 config 조회 — 설정 폴링 제거 대체 (설계서 10-2).
 * 응답의 config 필드에 포함되어 Agent가 버전 비교 후 스케줄러 재시작.
 *
 * 우선순위:
 *   1. sync_agents.config JSONB (슈퍼관리자가 sys.hanjullo.com에서 수정한 값)
 *   2. sync_agents.sync_interval_customers / sync_interval_purchases (레거시)
 *   3. v1.5.0 기본값 (고객 360분, 구매 360분, Heartbeat 60분, 큐재전송 30분)
 */
async function getSyncConfigForAgent(companyId: string): Promise<{
  syncIntervalCustomers: number;
  syncIntervalPurchases: number;
  heartbeatInterval: number;
  queueRetryInterval: number;
  version: string;
}> {
  const res = await query(
    `SELECT id, config, sync_interval_customers, sync_interval_purchases, updated_at
     FROM sync_agents
     WHERE company_id = $1 AND status = 'active'
     ORDER BY updated_at DESC LIMIT 1`,
    [companyId]
  );
  const agent = res.rows[0];
  const config = agent?.config || {};
  return {
    syncIntervalCustomers: Number(config.sync_interval_customers ?? agent?.sync_interval_customers ?? 360),
    syncIntervalPurchases: Number(config.sync_interval_purchases ?? agent?.sync_interval_purchases ?? 360),
    heartbeatInterval: Number(config.heartbeat_interval ?? 60),
    queueRetryInterval: Number(config.queue_retry_interval ?? 30),
    version: agent?.updated_at ? new Date(agent.updated_at).toISOString() : new Date().toISOString(),
  };
}

/**
 * sms_opt_in=false 고객 → unsubscribes 3단 배정.
 * upload.ts admin 경로(:829-889) 패턴을 복제:
 *   1. 시스템 가상 user (is_system=true)에게 INSERT
 *   2. 회사의 admin user들에게 INSERT (관리 가시성)
 *   3. store_code 담당 company_user들에게 INSERT (브랜드별 필터링)
 *
 * ⚠️ 이 로직은 sync.ts 외부에서 복제 금지. 싱크 경로의 유일한 수신거부 진입점.
 */
async function registerSyncUnsubscribes(companyId: string, companyName?: string): Promise<void> {
  try {
    // 1. 시스템 user 조회 (없으면 즉시 생성 — 마이그레이션 누락 방어)
    let sysUserRes = await query(
      `SELECT id FROM users WHERE company_id = $1 AND is_system = true LIMIT 1`,
      [companyId]
    );
    let systemUserId: string | null = sysUserRes.rows[0]?.id || null;
    if (!systemUserId) {
      try {
        const created = await query(
          `INSERT INTO users (id, company_id, login_id, user_type, name, is_active, is_system, password_hash, status)
           VALUES (gen_random_uuid(), $1, 'system_sync_' || $1::text, 'system', '싱크에이전트 (시스템)', true, true, '', 'active')
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [companyId]
        );
        systemUserId = created.rows[0]?.id || null;
        if (!systemUserId) {
          // 경합으로 이미 생성된 경우 재조회
          const re = await query(
            `SELECT id FROM users WHERE company_id = $1 AND is_system = true LIMIT 1`,
            [companyId]
          );
          systemUserId = re.rows[0]?.id || null;
        }
        if (systemUserId) {
          console.log(`[Sync] 시스템 user 자동 생성/조회 (company: ${companyName}, userId: ${systemUserId})`);
        }
      } catch (sysErr) {
        console.error('[Sync] 시스템 user 생성 실패 (is_system 컬럼 미적용 가능성):', sysErr);
      }
    }

    // 2. 시스템 user에게 INSERT (source='sync')
    if (systemUserId) {
      const r1 = await query(
        `INSERT INTO unsubscribes (company_id, user_id, phone, source)
         SELECT $1, $2, phone, 'sync'
         FROM customers
         WHERE company_id = $1 AND sms_opt_in = false AND is_active = true
           AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $2 AND u.phone = customers.phone)
         ON CONFLICT (user_id, phone) DO NOTHING`,
        [companyId, systemUserId]
      );
      if (r1.rowCount && r1.rowCount > 0) {
        console.log(`[Sync] 수신거부 자동등록(system): ${r1.rowCount}건 (company: ${companyName})`);
      }
    }

    // 3. 회사 admin user들에게 INSERT (관리 가시성)
    const r2 = await query(
      `INSERT INTO unsubscribes (company_id, user_id, phone, source)
       SELECT c.company_id, u.id, c.phone, 'sync'
       FROM customers c
       JOIN users u ON u.company_id = c.company_id AND u.user_type = 'admin' AND COALESCE(u.is_system, false) = false
       WHERE c.company_id = $1 AND c.sms_opt_in = false AND c.is_active = true
       ON CONFLICT (user_id, phone) DO NOTHING`,
      [companyId]
    );
    if (r2.rowCount && r2.rowCount > 0) {
      console.log(`[Sync] 수신거부 자동등록(admin): ${r2.rowCount}건 (company: ${companyName})`);
    }

    // 4. company_user들에게 INSERT — getStoreScope(CT-02)와 동일 판정 기준
    // ★ D136 (2026-04-22) 재작성:
    //   기존 `c.store_code = ANY(u.store_codes)` 단일 조건은 다음 두 케이스를 모두 놓침.
    //     - (A) suran 케이스: store_codes=NULL → ANY(NULL) → 매칭 0건
    //     - (B) gwchae/sgbaek 케이스: 브랜드 체계 없는 회사(customer_stores 0건)에
    //           수동 store_codes 배정 → customers.store_code NULL이라 매칭 0건
    //   해결: getStoreScope의 4단계 판정을 SQL에 그대로 이식.
    //     - no_filter  : customer_stores 없음 OR store_codes 배정됐으나 실존 매칭 0 → 전체 고객
    //     - filtered   : customer_stores 있음 AND store_codes 실존 매칭 → 해당 store 고객
    //     - blocked    : customer_stores 있음 AND store_codes 미배정/빈 배열 → 스킵
    const r3 = await query(
      `INSERT INTO unsubscribes (company_id, user_id, phone, source)
       SELECT c.company_id, u.id, c.phone, 'sync'
       FROM customers c
       JOIN users u ON u.company_id = c.company_id
         AND u.user_type = 'user'
         AND COALESCE(u.is_active, true) = true
       WHERE c.company_id = $1
         AND c.sms_opt_in = false
         AND c.is_active = true
         AND (
           -- (no_filter-1) 회사에 customer_stores 체계 없음 → 전체 고객 매칭
           NOT EXISTS (SELECT 1 FROM customer_stores cs WHERE cs.company_id = $1)
           OR
           -- (no_filter-2) store_codes 배정됐으나 customer_stores 실존 매칭 0 → 유령 배정, 전체 고객 매칭
           (u.store_codes IS NOT NULL
            AND array_length(u.store_codes, 1) > 0
            AND NOT EXISTS (SELECT 1 FROM customer_stores cs
                             WHERE cs.company_id = $1
                               AND cs.store_code = ANY(u.store_codes)))
           OR
           -- (filtered) customer_stores 실존 매칭 있음 → 해당 store_code 고객만
           (u.store_codes IS NOT NULL
            AND array_length(u.store_codes, 1) > 0
            AND c.store_code = ANY(u.store_codes)
            AND EXISTS (SELECT 1 FROM customer_stores cs
                         WHERE cs.company_id = $1
                           AND cs.store_code = ANY(u.store_codes)))
         )
       ON CONFLICT (user_id, phone) DO NOTHING`,
      [companyId]
    );
    if (r3.rowCount && r3.rowCount > 0) {
      console.log(`[Sync] 수신거부 자동등록(company_user, CT-02 판정): ${r3.rowCount}건 (company: ${companyName})`);
    }
  } catch (unsubError) {
    console.error('[Sync] 수신거부 자동등록 실패:', unsubError);
  }
}

// ============================================
// POST /api/sync/register - Agent 최초 등록
// ============================================
router.post('/register', async (req: SyncAuthRequest, res: Response) => {
  try {
    const { agentName, agentVersion, osInfo, dbType } = req.body;
    const companyId = req.companyId!;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] as string || '';

    if (!agentName) {
      return res.status(400).json({
        success: false,
        error: 'agentName is required'
      });
    }

    // 이미 등록된 Agent가 있으면 업데이트, 없으면 생성
    const existing = await query(
      `SELECT id FROM sync_agents WHERE company_id = $1 AND agent_name = $2`,
      [companyId, agentName]
    );

    let agentId: string;

    if (existing.rows.length > 0) {
      // 기존 Agent 업데이트
      agentId = existing.rows[0].id;
      await query(
        `UPDATE sync_agents 
         SET agent_version = $1, os_info = $2, db_type = $3, 
             status = 'active', ip_address = $4, updated_at = NOW()
         WHERE id = $5`,
        [agentVersion, osInfo, dbType, ipAddress, agentId]
      );
    } else {
      // 새 Agent 등록
      const insertResult = await query(
        `INSERT INTO sync_agents (company_id, agent_name, agent_version, os_info, db_type, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [companyId, agentName, agentVersion, osInfo, dbType, ipAddress]
      );
      agentId = insertResult.rows[0].id;
    }

    // 회사 설정 조회 (Agent에 전달할 config)
    const configResult = await query(
      `SELECT setting_key, setting_value 
       FROM company_settings 
       WHERE company_id = $1 AND setting_key LIKE 'sync_%'`,
      [companyId]
    );
    const config: Record<string, string> = {};
    configResult.rows.forEach((row: any) => {
      config[row.setting_key] = row.setting_value;
    });

    console.log(`[Sync] Agent registered: ${agentName} (company: ${req.companyName}, id: ${agentId})`);

    return res.json({
      success: true,
      data: {
        agentId,
        companyId,
        companyName: req.companyName,
        config
      }
    });
  } catch (error) {
    console.error('[Sync Register Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to register agent'
    });
  }
});

// ============================================
// POST /api/sync/heartbeat - Agent 상태 보고
// ============================================
router.post('/heartbeat', async (req: SyncAuthRequest, res: Response) => {
  try {
    const {
      agentId, agentVersion, status, osInfo, dbType,
      lastSyncAt, totalCustomersSynced, queuedItems, uptime
    } = req.body;

    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: 'agentId is required'
      });
    }

    // Agent 존재 & 소유권 확인
    const agent = await query(
      `SELECT id FROM sync_agents WHERE id = $1 AND company_id = $2`,
      [agentId, req.companyId]
    );

    if (agent.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found'
      });
    }

    // ★ D131 후속(2026-04-21): heartbeat 응답에 pending commands 전달 + 전달 후 큐에서 제거.
    //   기존엔 commands를 싱크 응답(customers/purchases POST)에서만 전달했으나,
    //   Agent가 변경분 0건이면 POST 자체를 안 보내 명령이 영영 수신 안 되는 케이스 발생.
    //   heartbeat 응답으로도 commands 전달하여 pause/resume/restart를 안정적으로 전달.
    const { rows: configRows } = await query(
      `UPDATE sync_agents
       SET agent_version = COALESCE($1, agent_version),
           status = COALESCE($2, status),
           os_info = COALESCE($3, os_info),
           db_type = COALESCE($4, db_type),
           last_heartbeat_at = NOW(),
           last_sync_at = COALESCE($5, last_sync_at),
           total_customers_synced = COALESCE($6, total_customers_synced),
           queued_items = COALESCE($7, queued_items),
           uptime = COALESCE($8, uptime),
           updated_at = NOW()
       WHERE id = $9
       RETURNING config`,
      [agentVersion, status, osInfo, dbType, lastSyncAt,
       totalCustomersSynced, queuedItems, uptime, agentId]
    );

    const currentConfig = configRows[0]?.config || {};
    const pendingCommands: any[] = Array.isArray(currentConfig.commands) ? currentConfig.commands : [];

    // commands 전달할 게 있으면 큐 비워서 중복 실행 방지 (At-Most-Once 의도)
    if (pendingCommands.length > 0) {
      const newConfig = { ...currentConfig, commands: [] };
      await query(
        `UPDATE sync_agents SET config = $1::jsonb WHERE id = $2`,
        [JSON.stringify(newConfig), agentId]
      );
    }

    return res.json({
      success: true,
      data: { acknowledged: true },
      remoteConfig: pendingCommands.length > 0 ? { commands: pendingCommands } : undefined,
    });
  } catch (error) {
    console.error('[Sync Heartbeat Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process heartbeat'
    });
  }
});

// ============================================
// POST /api/sync/customers - 고객 데이터 벌크 UPSERT
// ============================================

router.post('/customers', async (req: SyncAuthRequest, res: Response) => {
  const companyId = req.companyId!;
  const mode = req.body.mode;

  // C-2: full sync 동시 실행 제한
  if (mode === 'full') {
    const existing = activeSyncs.get(companyId);
    if (existing) {
      return res.status(429).json({
        success: false,
        error: `Full sync already in progress (${existing.syncType}). Please wait for completion.`,
        code: 'SYNC_IN_PROGRESS'
      });
    }
    activeSyncs.set(companyId, { syncType: 'customers', startedAt: Date.now() });
  }

  try {
    const { customers, batchIndex, totalBatches } = req.body;

    if (!customers || !Array.isArray(customers) || customers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'customers array is required and must not be empty'
      });
    }

    // 배치 크기 제한 (한 번에 최대 5000건)
    if (customers.length > BATCH_SIZES.syncCustomer) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 5000 customers per batch'
      });
    }

    // 요금제 고객 수 제한 체크
    const limitCheck = await query(`
      SELECT
        p.max_customers,
        p.plan_name,
        (SELECT COUNT(*) FROM customers WHERE company_id = c.id AND is_active = true) as current_count
      FROM companies c
      LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.id = $1
    `, [companyId]);

    if (limitCheck.rows.length > 0) {
      const { max_customers, current_count, plan_name } = limitCheck.rows[0];
      const newTotal = Number(current_count) + customers.length;
      if (max_customers && newTotal > max_customers) {
        const available = Number(max_customers) - Number(current_count);
        return res.status(403).json({
          success: false,
          error: '최대 고객 관리 DB를 초과합니다. 플랜을 업그레이드하세요.',
          code: 'PLAN_LIMIT_EXCEEDED',
          planName: plan_name,
          maxCustomers: max_customers,
          currentCount: Number(current_count),
          requestedCount: customers.length,
          availableCount: available > 0 ? available : 0
        });
      }
    }

    // agentId 조회 (heartbeat 기록용)
    const agentResult = await query(
      `SELECT id FROM sync_agents WHERE company_id = $1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1`,
      [companyId]
    );
    const agentId = agentResult.rows[0]?.id;

    let upsertedCount = 0;
    let failedCount = 0;
    const failures: Array<{ phone: string; reason: string }> = [];

    // ── FIELD_MAP 기반 동적 컬럼 목록 (하드코딩 금지) ──
    const columnFieldDefs = getColumnFields();    // 고정 21개 (storageType='column')
    const customFieldDefs = getCustomFields();    // 커스텀 15개 (storageType='custom_fields' — custom_1~15)
    const columnNames = columnFieldDefs.map(f => f.columnName);
    const currentYear = new Date().getFullYear();

    // 1단계: JS에서 phone validation + normalize + 파생 필드 계산
    const validRows: Array<Record<string, any>> = [];

    for (const c of customers) {
      if (!c.phone) {
        failedCount++;
        failures.push({ phone: c.phone || 'empty', reason: 'phone is required' });
        continue;
      }
      const phone = normalizePhone(c.phone);
      if (!phone) {
        failedCount++;
        failures.push({ phone: c.phone, reason: 'invalid phone format' });
        continue;
      }

      // ── 파생 필드 계산 (upload.ts와 동일 로직) ──
      let derivedBirthYear: number | null = null;
      let derivedBirthMonthDay: string | null = null;
      let derivedAge: number | null = null;
      let derivedRegion: string | null = null;
      let birthDateValue: string | null = c.birth_date || null;

      // birth_date → birth_year, birth_month_day, age
      // ★ B17-09: Date 객체가 올 경우 String()하면 영문 형식 → normalizeDate 먼저 호출
      if (birthDateValue && (birthDateValue as any) instanceof Date) {
        birthDateValue = normalizeDate(birthDateValue) || null;
      }
      if (birthDateValue) {
        const bd = String(birthDateValue).trim();
        if (/^\d{4}$/.test(bd) && parseInt(bd) >= 1900 && parseInt(bd) <= 2099) {
          derivedBirthYear = parseInt(bd);
          derivedAge = currentYear - derivedBirthYear;
          birthDateValue = null; // date 타입에 연도만 넣으면 에러
        } else {
          const normalized = normalizeDate(bd);
          if (normalized) {
            birthDateValue = normalized;
            derivedBirthYear = parseInt(normalized.substring(0, 4));
            derivedBirthMonthDay = normalized.substring(5, 10);
            derivedAge = currentYear - derivedBirthYear;
          }
        }
      }

      // birth_year 직접 전송 (birth_date가 없을 때)
      if (c.birth_year && !derivedBirthYear) {
        const by = parseInt(String(c.birth_year));
        if (!isNaN(by) && by >= 1900 && by <= 2099) {
          derivedBirthYear = by;
          derivedAge = currentYear - by;
        }
      }

      // age: 파생값 우선, 없으면 Agent 전송값
      const finalAge = derivedAge ?? (c.age ? parseInt(String(c.age)) : null);

      // region: 직접 전송값 우선, 없으면 address에서 파생
      if (c.region) {
        derivedRegion = normalizeRegion(c.region);
      } else if (c.address && typeof c.address === 'string') {
        const firstToken = c.address.split(/[\s,]/)[0];
        if (firstToken) derivedRegion = normalizeRegion(firstToken);
      }

      // ── FIELD_MAP 기반 동적 row 구성 ──
      const row: Record<string, any> = { phone };

      for (const field of columnFieldDefs) {
        if (field.fieldKey === 'phone') {
          row.phone = phone; // 이미 정규화됨
        } else if (field.fieldKey === 'birth_date') {
          row.birth_date = birthDateValue;
        } else if (field.fieldKey === 'age') {
          row.age = finalAge;
        } else if (field.fieldKey === 'sms_opt_in') {
          const val = c[field.fieldKey];
          row.sms_opt_in = val !== null && val !== undefined ? val : true;
        } else {
          row[field.columnName] = c[field.fieldKey] ?? c[field.columnName] ?? null;
        }
      }

      // 파생 컬럼
      row.birth_year = derivedBirthYear;
      row.birth_month_day = derivedBirthMonthDay;
      row.region = derivedRegion ?? row.region ?? null;

      // custom_fields JSONB 빌드
      const customObj: Record<string, any> = {};
      // Agent가 이미 구성한 custom_fields 객체
      if (c.custom_fields && typeof c.custom_fields === 'object') {
        Object.assign(customObj, c.custom_fields);
      }
      // 또는 custom_1~15 개별 키로 전송한 경우
      for (const cf of customFieldDefs) {
        if (c[cf.fieldKey] != null && c[cf.fieldKey] !== '') {
          customObj[cf.columnName] = normalizeCustomFieldValue(c[cf.fieldKey]);
        }
      }
      row.custom_fields = Object.keys(customObj).length > 0 ? JSON.stringify(customObj) : null;

      validRows.push(row);
    }

    // 2단계: 벌크 UPSERT (500건씩 청크) — customer-upsert.ts 컨트롤타워 사용
    // ★ 2026-04-21: 기존 인라인 INSERT 구성이 'region' 중복으로 PostgreSQL "multiple assignments"
    //   에러를 유발 → full sync 전건 실패. 컨트롤타워로 통합해서 구조적으로 재발 차단.
    const upsertBuilder = createCustomerUpsertBuilder({
      source: 'sync',
      includeUploadedBy: false,
    });
    const CHUNK_SIZE = 500;

    for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
      const chunk = validRows.slice(i, i + CHUNK_SIZE);
      try {
        const { sql, values } = upsertBuilder.buildBatch(companyId, chunk);
        const result = await query(sql, values);
        upsertedCount += result.rowCount || chunk.length;

        // customer_stores 벌크 처리 (sync 경로 전용 — upload.ts는 별도 매핑 로직 사용)
        const storeRows = chunk.filter((r: any) => r.store_code);
        if (storeRows.length > 0) {
          const storeValues: any[] = [];
          const storeValueClauses: string[] = [];
          for (let j = 0; j < storeRows.length; j++) {
            const offset = j * 3;
            storeValueClauses.push(`($${offset+1}, (SELECT id FROM customers WHERE company_id = $${offset+1} AND phone = $${offset+2} LIMIT 1), $${offset+3})`);
            storeValues.push(companyId, storeRows[j].phone, storeRows[j].store_code);
          }
          await query(
            `INSERT INTO customer_stores (company_id, customer_id, store_code)
             VALUES ${storeValueClauses.join(',')}
             ON CONFLICT (customer_id, store_code) DO NOTHING`,
            storeValues
          );
        }
      } catch (chunkError: any) {
        failedCount += chunk.length;
        for (const r of chunk) {
          failures.push({ phone: r.phone, reason: chunkError.message || 'Bulk insert failed' });
        }
      }
    }

    // sync_logs 기록
    if (agentId) {
      await query(
        `INSERT INTO sync_logs (agent_id, company_id, sync_type, mode, batch_index, total_batches, total_count, success_count, fail_count, failures, completed_at)
         VALUES ($1, $2, 'customers', $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [agentId, companyId, mode || 'full', batchIndex || 1, totalBatches || 1,
         customers.length, upsertedCount, failedCount, JSON.stringify(failures)]
      );

      // Agent 통계 업데이트
      await query(
        `UPDATE sync_agents
         SET total_customers_synced = total_customers_synced + $1,
             last_sync_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [upsertedCount, agentId]
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ★ D136 (D1-2 근본): customer_field_definitions 자동 UPSERT 안전망 (2026-04-22)
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // 배경:
    //   - Sync Agent가 POST /api/sync/field-definitions를 건너뛰거나 실패하면
    //     `customer_field_definitions` 0건 상태로 `custom_fields` JSONB만 저장됨.
    //   - suran(인비토) 경로 실사례: customer_field_definitions 0건, JSONB는 정상 → 화면/다운로드에서 라벨 누락.
    //
    // 방어:
    //   1. 이번 배치의 `custom_fields` JSONB에 실제로 등장한 key 수집
    //   2. DB에 정의 없는 key만 "key 자체를 라벨로" 기본 UPSERT (기존 라벨 보호)
    //   3. Agent가 나중에 /field-definitions 호출하면 EXCLUDED로 라벨이 자동 갱신됨.
    //
    // ⚠️ 원칙: Agent 측 버그/누락에도 한줄로 측 데이터가 완결되도록 하는 "서버 측 안전망".
    //        sync 전체 실패로 전파되지 않도록 try/catch 격리.
    try {
      const customFieldKeys = new Set<string>();
      for (const row of validRows) {
        if (!row.custom_fields) continue;
        const parsed = typeof row.custom_fields === 'string'
          ? JSON.parse(row.custom_fields)
          : row.custom_fields;
        if (parsed && typeof parsed === 'object') {
          for (const k of Object.keys(parsed)) {
            if (k.startsWith('custom_')) customFieldKeys.add(k);
          }
        }
      }

      if (customFieldKeys.size > 0) {
        const keyArr = Array.from(customFieldKeys);
        const existing = await query(
          `SELECT field_key FROM customer_field_definitions
            WHERE company_id = $1 AND field_key = ANY($2::text[])`,
          [companyId, keyArr]
        );
        const existingSet = new Set(existing.rows.map((r: any) => r.field_key));
        const missing = keyArr.filter(k => !existingSet.has(k));
        if (missing.length > 0) {
          // 라벨 = key 자체 (Agent가 나중에 /field-definitions로 정식 라벨 보내면 EXCLUDED로 갱신)
          const defs = missing.map(key => ({ fieldKey: key, label: key }));
          const upsertedDefs = await upsertCustomFieldDefinitions(companyId, defs);
          console.log(
            `[Sync customers] customer_field_definitions 안전망 자동 UPSERT: ${upsertedDefs}건 `
            + `(company=${req.companyName}, missing=[${missing.join(',')}])`
          );
        }
      }
    } catch (autoErr) {
      // 안전망 실패는 sync 정상 완료를 막지 않음
      console.warn('[Sync customers] customer_field_definitions 안전망 실패 (sync 정상 완료):', (autoErr as any)?.message);
    }

    // ===== sms_opt_in=false 고객 → unsubscribes 3단 배정 (system + admin + store_code user) =====
    await registerSyncUnsubscribes(companyId, req.companyName);

    // ===== Agent 설정 응답 (설정 폴링 제거 대체) =====
    const agentConfig = await getSyncConfigForAgent(companyId);

    console.log(`[Sync] Customers: ${upsertedCount} upserted, ${failedCount} failed (company: ${req.companyName})`);

    return res.json({
      success: true,
      data: {
        upsertedCount,
        failedCount,
        failures: failures.slice(0, 50) // 최대 50건만 리턴
      },
      config: agentConfig
    });
  } catch (error) {
    console.error('[Sync Customers Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process customers'
    });
  } finally {
    // C-2: full sync 완료 시 activeSyncs에서 제거
    if (mode === 'full') {
      activeSyncs.delete(companyId);
    }
  }
});

// ============================================
// POST /api/sync/purchases - 구매내역 벌크 INSERT
// ============================================
router.post('/purchases', async (req: SyncAuthRequest, res: Response) => {
  const companyId = req.companyId!;
  const mode = req.body.mode;

  // C-2: full sync 동시 실행 제한
  if (mode === 'full') {
    const existing = activeSyncs.get(companyId);
    if (existing) {
      return res.status(429).json({
        success: false,
        error: `Full sync already in progress (${existing.syncType}). Please wait for completion.`,
        code: 'SYNC_IN_PROGRESS'
      });
    }
    activeSyncs.set(companyId, { syncType: 'purchases', startedAt: Date.now() });
  }

  try {
    const { purchases, batchIndex, totalBatches } = req.body;

    if (!purchases || !Array.isArray(purchases) || purchases.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'purchases array is required and must not be empty'
      });
    }

    if (purchases.length > BATCH_SIZES.syncPurchase) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 5000 purchases per batch'
      });
    }

    // agentId 조회
    const agentResult = await query(
      `SELECT id FROM sync_agents WHERE company_id = $1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1`,
      [companyId]
    );
    const agentId = agentResult.rows[0]?.id;

    let insertedCount = 0;
    let failedCount = 0;
    const failures: Array<{ phone: string; reason: string }> = [];

    // 1단계: JS에서 phone validation + normalize 먼저 필터링
    const validPurchases: Array<{
      phone: string; purchase_date: string | null;
      store_code: string | null; store_name: string | null;
      product_code: string | null; product_name: string | null;
      quantity: number | null; unit_price: number | null; total_amount: number | null;
    }> = [];

    for (const p of purchases) {
      if (!p.customer_phone) {
        failedCount++;
        failures.push({ phone: p.customer_phone || 'empty', reason: 'customer_phone is required' });
        continue;
      }
      const phone = normalizePhone(p.customer_phone);
      if (!phone) {
        failedCount++;
        failures.push({ phone: p.customer_phone, reason: 'invalid phone format' });
        continue;
      }
      validPurchases.push({
        phone, purchase_date: p.purchase_date || null,
        store_code: p.store_code || null, store_name: p.store_name || null,
        product_code: p.product_code || null, product_name: p.product_name || null,
        quantity: p.quantity || null, unit_price: p.unit_price || null, total_amount: p.total_amount || null
      });
    }

    // 2단계: 전체 phone 목록으로 customer_id 벌크 조회
    const allPhones = [...new Set(validPurchases.map(r => r.phone))];
    const phoneToCustomerId: Record<string, string | null> = {};

    if (allPhones.length > 0) {
      const cidResult = await query(
        `SELECT id, phone FROM customers WHERE company_id = $1 AND phone = ANY($2)`,
        [companyId, allPhones]
      );
      for (const row of cidResult.rows) {
        phoneToCustomerId[row.phone] = row.id;
      }
    }

    // 3단계: 벌크 INSERT (500건씩 청크)
    const P_CHUNK = 500;
    for (let i = 0; i < validPurchases.length; i += P_CHUNK) {
      const chunk = validPurchases.slice(i, i + P_CHUNK);
      try {
        const COLS = 11; // 파라미터 개수 per row
        const values: any[] = [];
        const valueClauses: string[] = [];

        for (let j = 0; j < chunk.length; j++) {
          const offset = j * COLS;
          valueClauses.push(`($${offset+1},$${offset+2},$${offset+3},$${offset+4},$${offset+5},$${offset+6},$${offset+7},$${offset+8},$${offset+9},$${offset+10},$${offset+11},NOW())`);
          const r = chunk[j];
          values.push(
            companyId, phoneToCustomerId[r.phone] || null, r.phone,
            r.purchase_date, r.store_code, r.store_name,
            r.product_code, r.product_name,
            r.quantity, r.unit_price, r.total_amount
          );
        }

        const result = await query(
          `INSERT INTO purchases (
            company_id, customer_id, customer_phone, purchase_date,
            store_code, store_name, product_code, product_name,
            quantity, unit_price, total_amount, created_at
          ) VALUES ${valueClauses.join(',')}`,
          values
        );

        insertedCount += result.rowCount || chunk.length;
      } catch (chunkError: any) {
        failedCount += chunk.length;
        for (const r of chunk) {
          failures.push({ phone: r.phone, reason: chunkError.message || 'Bulk insert failed' });
        }
      }
    }

    // sync_logs 기록
    if (agentId) {
      await query(
        `INSERT INTO sync_logs (agent_id, company_id, sync_type, mode, batch_index, total_batches, total_count, success_count, fail_count, failures, completed_at)
         VALUES ($1, $2, 'purchases', $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [agentId, companyId, mode || 'full', batchIndex || 1, totalBatches || 1,
         purchases.length, insertedCount, failedCount, JSON.stringify(failures)]
      );

      // Agent 통계 업데이트
      await query(
        `UPDATE sync_agents 
         SET total_purchases_synced = total_purchases_synced + $1, 
             last_sync_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [insertedCount, agentId]
      );
    }

    // ===== Agent 설정 응답 (설정 폴링 제거 대체) =====
    const agentConfig = await getSyncConfigForAgent(companyId);

    console.log(`[Sync] Purchases: ${insertedCount} inserted, ${failedCount} failed (company: ${req.companyName})`);

    return res.json({
      success: true,
      data: {
        insertedCount,
        failedCount,
        failures: failures.slice(0, 50)
      },
      config: agentConfig
    });
  } catch (error) {
    console.error('[Sync Purchases Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process purchases'
    });
  } finally {
    // C-2: full sync 완료 시 activeSyncs에서 제거
    if (mode === 'full') {
      activeSyncs.delete(companyId);
    }
  }
});
// ============================================================================
// sync.ts 하단에 추가할 라우트 3개
// POST /log, GET /config, GET /version
//
// 주의: router.use(syncAuth)가 이미 전역 적용되어 있으므로
//       개별 라우트에 syncAuth 파라미터 불필요
// ============================================================================


// ============================================
// POST /api/sync/log — 동기화 로그 전송
// ============================================
router.post('/log', async (req: SyncAuthRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const {
      agent_id,
      sync_type,
      sync_mode,
      total_count,
      success_count,
      fail_count,
      duration_ms,
      error_message,
      started_at,
      completed_at
    } = req.body;

    // 필수 필드 검증
    if (!agent_id || !sync_type || !sync_mode) {
      return res.status(400).json({
        success: false,
        error: 'agent_id, sync_type, sync_mode는 필수입니다.'
      });
    }

    // sync_type 검증
    if (!['customers', 'purchases'].includes(sync_type)) {
      return res.status(400).json({
        success: false,
        error: 'sync_type은 customers 또는 purchases여야 합니다.'
      });
    }

    // sync_mode 검증
    if (!['incremental', 'full'].includes(sync_mode)) {
      return res.status(400).json({
        success: false,
        error: 'sync_mode는 incremental 또는 full이어야 합니다.'
      });
    }

    // agent_id 소유권 확인
    const agentCheck = await query(
      'SELECT id FROM sync_agents WHERE id = $1 AND company_id = $2',
      [agent_id, companyId]
    );
    if (agentCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '해당 Agent를 찾을 수 없습니다.'
      });
    }

    // sync_logs INSERT (sync_mode → mode 컬럼 매핑)
    const result = await query(
      `INSERT INTO sync_logs (
        agent_id, company_id, sync_type, mode,
        total_count, success_count, fail_count,
        duration_ms, error_message,
        started_at, completed_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      RETURNING id`,
      [
        agent_id, companyId, sync_type, sync_mode,
        total_count || 0, success_count || 0, fail_count || 0,
        duration_ms ?? null, error_message || null,
        started_at || null, completed_at || null
      ]
    );

    // sync_agents.last_sync_at 업데이트
    await query(
      'UPDATE sync_agents SET last_sync_at = NOW(), updated_at = NOW() WHERE id = $1',
      [agent_id]
    );

    console.log(`[Sync] Log recorded: ${sync_type}/${sync_mode} - ${success_count}/${total_count} (company: ${req.companyName})`);

    return res.status(201).json({
      success: true,
      log_id: result.rows[0].id
    });
  } catch (error) {
    console.error('[Sync Log Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to record sync log'
    });
  }
});


// ============================================
// GET /api/sync/config — Agent 설정 원격 조회
// ============================================
router.get('/config', async (req: SyncAuthRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const agentId = req.query.agent_id as string;

    if (!agentId) {
      return res.status(400).json({
        success: false,
        error: 'agent_id query parameter is required'
      });
    }

    // agent 조회 (company_id 소유권 확인 포함)
    const result = await query(
      `SELECT id, config, sync_interval_customers, sync_interval_purchases
       FROM sync_agents
       WHERE id = $1 AND company_id = $2`,
      [agentId, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found'
      });
    }

    const agent = result.rows[0];
    const config = agent.config || {};

    return res.json({
      success: true,
      config: {
        sync_interval_customers: config.sync_interval_customers ?? agent.sync_interval_customers ?? 60,
        sync_interval_purchases: config.sync_interval_purchases ?? agent.sync_interval_purchases ?? 30,
        batch_size: config.batch_size ?? BATCH_SIZES.syncCustomer,
        column_mapping: config.column_mapping ?? null,
        commands: config.commands ?? []
      }
    });
  } catch (error) {
    console.error('[Sync Config Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve config'
    });
  }
});


// ============================================
// GET /api/sync/version — 버전 확인 (자동 업데이트)
// ============================================
router.get('/version', async (req: SyncAuthRequest, res: Response) => {
  try {
    const currentVersion = req.query.current_version as string;
    const agentId = req.query.agent_id as string;
    const companyId = req.companyId!;

    if (!currentVersion) {
      return res.status(400).json({
        success: false,
        error: 'current_version query parameter is required'
      });
    }

    // Agent의 agent_version 업데이트
    if (agentId) {
      await query(
        'UPDATE sync_agents SET agent_version = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3',
        [currentVersion, agentId, companyId]
      );
    }

    // 최신 활성 릴리스 조회
    const result = await query(
      `SELECT version, download_url, checksum, release_notes, force_update, released_at
       FROM sync_releases
       WHERE is_active = true
       ORDER BY released_at DESC
       LIMIT 1`
    );

    // 릴리스가 없으면 업데이트 없음 응답
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        latest_version: currentVersion,
        current_version: currentVersion,
        update_available: false
      });
    }

    const latest = result.rows[0];
    const updateAvailable = compareSemver(latest.version, currentVersion) > 0;

    return res.json({
      success: true,
      latest_version: latest.version,
      current_version: currentVersion,
      update_available: updateAvailable,
      ...(updateAvailable && {
        force_update: latest.force_update,
        download_url: latest.download_url,
        checksum: latest.checksum,
        release_notes: latest.release_notes,
        released_at: latest.released_at
      })
    });
  } catch (error) {
    console.error('[Sync Version Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check version'
    });
  }
});


// ============================================
// POST /api/sync/field-definitions — 커스텀 필드 라벨 등록
// Sync Agent가 최초 동기화 시 커스텀 필드 매핑 결과를 서버에 등록
// ============================================
router.post('/field-definitions', async (req: SyncAuthRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const { definitions } = req.body;

    if (!definitions || !Array.isArray(definitions) || definitions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'definitions array is required and must not be empty'
      });
    }

    // 최대 15개 (커스텀 슬롯 제한)
    if (definitions.length > 15) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 15 custom field definitions allowed'
      });
    }

    // 유효성 검증: custom_1~custom_15만 허용
    const validKeys = new Set(getCustomFields().map(f => f.fieldKey));
    for (const def of definitions) {
      if (!def.field_key || !validKeys.has(def.field_key)) {
        return res.status(400).json({
          success: false,
          error: `Invalid field_key: ${def.field_key}. Only custom_1~custom_15 allowed.`
        });
      }
      if (!def.field_label || typeof def.field_label !== 'string') {
        return res.status(400).json({
          success: false,
          error: `field_label is required for ${def.field_key}`
        });
      }
    }

    // CT-07 컨트롤타워 사용
    const mapped = definitions.map((def: any) => ({
      fieldKey: def.field_key,
      label: def.field_label,
      fieldType: def.field_type || 'VARCHAR',
    }));
    const upsertedCount = await upsertCustomFieldDefinitions(companyId, mapped);

    // ★ D131 후속(2026-04-21): 전부 실패하면 success=false로 응답 (Agent 재시도 유도).
    //   기존 코드는 upsertedCount=0 이어도 success:true → Agent가 재시도 안 함 → 라벨 영구 미등록.
    if (mapped.length > 0 && upsertedCount === 0) {
      return res.status(500).json({
        success: false,
        error: 'All field definitions failed to upsert',
        detail: '서버 로그에서 [CT-07] 실패 상세 확인 필요',
      });
    }

    // ===== M-3: customer_schema 자동 갱신 (upload.ts 동일 로직) =====
    try {
      await query(`
        UPDATE companies SET customer_schema = (
          SELECT jsonb_build_object(
            'genders', (SELECT array_agg(DISTINCT gender) FROM customers WHERE company_id = $1 AND gender IS NOT NULL),
            'grades', (SELECT array_agg(DISTINCT grade) FROM customers WHERE company_id = $1 AND grade IS NOT NULL),
            'custom_field_keys', (SELECT array_agg(DISTINCT k) FROM customers, jsonb_object_keys(custom_fields) k WHERE company_id = $1),
            'store_codes', (SELECT array_agg(DISTINCT store_code) FROM customer_stores WHERE company_id = $1)
          )
        ) WHERE id = $1
      `, [companyId]);
    } catch (schemaErr) {
      console.error('[Sync] customer_schema 갱신 실패:', schemaErr);
    }

    return res.json({
      success: true,
      data: { upsertedCount }
    });
  } catch (error) {
    // ★ D131 후속(2026-04-21): Agent 로그에서 원인 추적 가능하도록 에러 메시지를 응답에 포함.
    //   (stack은 보안상 서버 console에만, 메시지는 운영에서도 공개 OK)
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Sync Field Definitions Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to register field definitions',
      detail: errorMsg,
    });
  }
});

// ============================================
// POST /api/sync/ai-mapping — Claude Opus 4.7 컬럼 자동 매핑 (설계서 §5)
// ============================================
// Agent 설치 마법사 Step 4에서 호출.
// 컬럼명 목록만 전송(PII 금지). 서버 환경변수 ANTHROPIC_API_KEY 사용.
// 쿼터: 회사당 월 10회 (plans.ai_mapping_monthly_quota).
router.post('/ai-mapping', async (req: SyncAuthRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const { target, tableName, dbType, columns } = req.body as {
      target?: MappingTarget;
      tableName?: string;
      dbType?: SupportedDbType;
      columns?: string[];
    };

    if (!target || !['customers', 'purchases'].includes(target)) {
      return res.status(400).json({
        success: false,
        error: 'target은 customers 또는 purchases여야 합니다.'
      });
    }
    if (!columns || !Array.isArray(columns) || columns.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'columns 배열이 필요합니다.'
      });
    }
    if (!dbType || !['mssql', 'mysql', 'oracle', 'postgres', 'excel', 'csv'].includes(dbType)) {
      return res.status(400).json({
        success: false,
        error: 'dbType은 mssql/mysql/oracle/postgres/excel/csv 중 하나여야 합니다.'
      });
    }

    const result = await callAiMapping(companyId, {
      target,
      tableName: tableName || '',
      dbType,
      columns,
    });

    return res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    if (error instanceof AiMappingQuotaExceeded) {
      return res.status(429).json({
        success: false,
        error: error.message,
        code: error.code,
        limit: error.limit,
        used: error.used,
      });
    }
    if (error instanceof AiMappingUnavailable) {
      return res.status(503).json({
        success: false,
        error: error.message,
        code: 'AI_MAPPING_UNAVAILABLE',
      });
    }
    console.error('[Sync AI Mapping Error]', error);
    return res.status(500).json({
      success: false,
      error: 'AI 매핑 처리 실패'
    });
  }
});

// ============================================
// GET /api/sync/field-map — FIELD_MAP 동적 전달 (M-4)
// Agent가 서버 FIELD_MAP 정의를 최신으로 수신.
// 설치 시 1회 호출 + config.enc 캐시.
// ============================================
router.get('/field-map', async (_req: SyncAuthRequest, res: Response) => {
  try {
    return res.json({
      success: true,
      data: {
        fieldMap: FIELD_MAP.map(f => ({
          fieldKey: f.fieldKey,
          category: f.category,
          displayName: f.displayName,
          aliases: f.aliases || [],
          dataType: f.dataType,
          storageType: f.storageType,
          columnName: f.columnName,
          normalizeFunction: f.normalizeFunction || null,
          sortOrder: f.sortOrder,
        })),
        categoryLabels: CATEGORY_LABELS,
        version: new Date().toISOString(),
      }
    });
  } catch (error) {
    console.error('[Sync Field Map Error]', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve field map'
    });
  }
});


// Semver 비교 헬퍼 (외부 라이브러리 없이)
// 반환: 양수 (a > b), 0 (a == b), 음수 (a < b)
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export default router;
