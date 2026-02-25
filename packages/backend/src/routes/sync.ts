// routes/sync.ts
// Sync Agent API - Phase 1
// 기존 코드 수정 없음. 독립 모듈.

import { Request, Response, Router } from 'express';
import { query } from '../config/database';
import { normalizePhone } from '../utils/normalize';

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
    if (now - val.startedAt > 30 * 60 * 1000) {
      console.warn(`[Sync RateLimit] Stale activeSyncs removed: company=${key}, type=${val.syncType}`);
      activeSyncs.delete(key);
    }
  }
}, 5 * 60 * 1000);

/** IP 실패 카운트 증가 (syncAuth에서 호출) */
function recordIpFailure(ip: string) {
  const now = Date.now();
  const entry = ipFailures.get(ip);
  if (entry && now < entry.resetAt) {
    entry.count++;
  } else {
    ipFailures.set(ip, { count: 1, resetAt: now + 60_000 });
  }
}

/** IP Rate Limit 미들웨어 — syncAuth 앞에서 차단 */
function ipRateLimit(req: Request, res: Response, next: Function) {
  const ip = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
  const entry = ipFailures.get(ip);
  if (entry && Date.now() < entry.resetAt && entry.count >= 10) {
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
    if (entry.count >= 60) {
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

    await query(
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
       WHERE id = $9`,
      [agentVersion, status, osInfo, dbType, lastSyncAt,
       totalCustomersSynced, queuedItems, uptime, agentId]
    );

    return res.json({
      success: true,
      data: { acknowledged: true }
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
    if (customers.length > 5000) {
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

    // 1단계: JS에서 phone validation + normalize 먼저 필터링
    const validRows: Array<{
      phone: string; name: string | null; gender: string | null;
      birth_date: string | null; birth_year: number | null; age: number | null;
      email: string | null; address: string | null; region: string | null;
      grade: string | null; points: number | null;
      store_code: string | null; store_name: string | null;
      recent_purchase_date: string | null; recent_purchase_amount: number | null;
      total_purchase_amount: number | null; purchase_count: number | null;
      custom_fields: string | null;
    }> = [];

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
      validRows.push({
        phone, name: c.name || null, gender: c.gender || null,
        birth_date: c.birth_date || null, birth_year: c.birth_year || null, age: c.age || null,
        email: c.email || null, address: c.address || null, region: c.region || null,
        grade: c.grade || null, points: c.points || null,
        store_code: c.store_code || null, store_name: c.store_name || null,
        recent_purchase_date: c.recent_purchase_date || null, recent_purchase_amount: c.recent_purchase_amount || null,
        total_purchase_amount: c.total_purchase_amount || null, purchase_count: c.purchase_count || null,
        custom_fields: c.custom_fields ? JSON.stringify(c.custom_fields) : null
      });
    }

    // 2단계: 벌크 UPSERT (500건씩 청크)
    const CHUNK_SIZE = 500;
    for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
      const chunk = validRows.slice(i, i + CHUNK_SIZE);
      try {
        const COLS = 19; // 파라미터 개수 per row
        const values: any[] = [];
        const valueClauses: string[] = [];

        for (let j = 0; j < chunk.length; j++) {
          const offset = j * COLS;
          valueClauses.push(`($${offset+1},$${offset+2},$${offset+3},$${offset+4},$${offset+5},$${offset+6},$${offset+7},$${offset+8},$${offset+9},$${offset+10},$${offset+11},$${offset+12},$${offset+13},$${offset+14},$${offset+15},$${offset+16},$${offset+17},$${offset+18},$${offset+19},'sync',NOW(),NOW())`);
          const r = chunk[j];
          values.push(
            companyId, r.phone, r.name, r.gender, r.birth_date, r.birth_year, r.age,
            r.email, r.address, r.region, r.grade, r.points,
            r.store_code, r.store_name,
            r.recent_purchase_date, r.recent_purchase_amount,
            r.total_purchase_amount, r.purchase_count,
            r.custom_fields
          );
        }

        const result = await query(
          `INSERT INTO customers (
            company_id, phone, name, gender, birth_date, birth_year, age,
            email, address, region, grade, points,
            store_code, store_name,
            recent_purchase_date, recent_purchase_amount,
            total_purchase_amount, purchase_count,
            custom_fields, source, created_at, updated_at
          ) VALUES ${valueClauses.join(',')}
          ON CONFLICT (company_id, COALESCE(store_code, '__NONE__'), phone) DO UPDATE SET
            name = COALESCE(EXCLUDED.name, customers.name),
            gender = COALESCE(EXCLUDED.gender, customers.gender),
            birth_date = COALESCE(EXCLUDED.birth_date, customers.birth_date),
            birth_year = COALESCE(EXCLUDED.birth_year, customers.birth_year),
            age = COALESCE(EXCLUDED.age, customers.age),
            email = COALESCE(EXCLUDED.email, customers.email),
            address = COALESCE(EXCLUDED.address, customers.address),
            region = COALESCE(EXCLUDED.region, customers.region),
            grade = COALESCE(EXCLUDED.grade, customers.grade),
            points = COALESCE(EXCLUDED.points, customers.points),
            store_code = COALESCE(EXCLUDED.store_code, customers.store_code),
            store_name = COALESCE(EXCLUDED.store_name, customers.store_name),
            recent_purchase_date = COALESCE(EXCLUDED.recent_purchase_date, customers.recent_purchase_date),
            recent_purchase_amount = COALESCE(EXCLUDED.recent_purchase_amount, customers.recent_purchase_amount),
            total_purchase_amount = COALESCE(EXCLUDED.total_purchase_amount, customers.total_purchase_amount),
            purchase_count = COALESCE(EXCLUDED.purchase_count, customers.purchase_count),
            custom_fields = COALESCE(EXCLUDED.custom_fields, customers.custom_fields),
            source = 'sync',
            updated_at = NOW()`,
          values
        );

        upsertedCount += result.rowCount || chunk.length;

        // customer_stores 벌크 처리
        const storeRows = chunk.filter(r => r.store_code);
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
        // 청크 실패 시 개별 건으로 폴백하지 않고 전체 실패 처리
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

    // ===== sms_opt_in=false 고객 → unsubscribes 자동 등록 =====
    try {
      const userForUnsub = await query(
        `SELECT id FROM users WHERE company_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1`,
        [companyId]
      );
      const syncUserId = userForUnsub.rows[0]?.id;
      if (syncUserId) {
        const unsubResult = await query(`
          INSERT INTO unsubscribes (company_id, user_id, phone, source)
          SELECT $1, $2, phone, 'sync'
          FROM customers
          WHERE company_id = $1 AND sms_opt_in = false AND is_active = true
            AND NOT EXISTS (
              SELECT 1 FROM unsubscribes u WHERE u.company_id = $1 AND u.phone = customers.phone
            )
          ON CONFLICT (user_id, phone) DO NOTHING
        `, [companyId, syncUserId]);
        if (unsubResult.rowCount && unsubResult.rowCount > 0) {
          console.log(`[Sync] 수신거부 자동등록: ${unsubResult.rowCount}건 (company: ${req.companyName})`);
        }
      }
    } catch (unsubError) {
      console.error('[Sync] 수신거부 자동등록 실패:', unsubError);
    }

    console.log(`[Sync] Customers: ${upsertedCount} upserted, ${failedCount} failed (company: ${req.companyName})`);

    return res.json({
      success: true,
      data: {
        upsertedCount,
        failedCount,
        failures: failures.slice(0, 50) // 최대 50건만 리턴
      }
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

    if (purchases.length > 5000) {
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

    console.log(`[Sync] Purchases: ${insertedCount} inserted, ${failedCount} failed (company: ${req.companyName})`);

    return res.json({
      success: true,
      data: {
        insertedCount,
        failedCount,
        failures: failures.slice(0, 50)
      }
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
        batch_size: config.batch_size ?? 5000,
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
