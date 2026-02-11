// routes/sync.ts
// Sync Agent API - Phase 1
// 기존 코드 수정 없음. 독립 모듈.

import { Router, Request, Response } from 'express';
import { query } from '../config/database';

const router = Router();

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

// 모든 sync 라우트에 인증 적용
router.use(syncAuth);

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

// 전화번호 검증 (숫자만, 10~11자리)
function isValidPhone(phone: string): boolean {
  const cleaned = phone.replace(/[^0-9]/g, '');
  return cleaned.length >= 10 && cleaned.length <= 11;
}

// 전화번호 정규화 (숫자만 추출)
function cleanPhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

router.post('/customers', async (req: SyncAuthRequest, res: Response) => {
  try {
    const { customers, mode, batchIndex, totalBatches } = req.body;
    const companyId = req.companyId!;

    if (!customers || !Array.isArray(customers) || customers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'customers array is required and must not be empty'
      });
    }

    // 배치 크기 제한 (한 번에 최대 1000건)
    if (customers.length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 1000 customers per batch'
      });
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

    // full 모드: 첫 번째 배치에서 기존 sync 데이터 비활성화 (선택적)
    // → 현재는 UPSERT만 수행, 삭제는 하지 않음

    for (const c of customers) {
      try {
        // 전화번호 필수 검증
        if (!c.phone) {
          failedCount++;
          failures.push({ phone: c.phone || 'empty', reason: 'phone is required' });
          continue;
        }

        const phone = cleanPhone(c.phone);
        if (!isValidPhone(phone)) {
          failedCount++;
          failures.push({ phone: c.phone, reason: 'invalid phone format' });
          continue;
        }

        // UPSERT: company_id + phone 기준
        // sms_opt_in, is_opt_out → 기존 값 유지 (EXCLUDED에서 제외)
        await query(
          `INSERT INTO customers (
            company_id, phone, name, gender, birth_date, birth_year, age,
            email, address, region, grade, points,
            store_code, store_name,
            recent_purchase_date, recent_purchase_amount,
            total_purchase_amount, purchase_count,
            custom_fields, source, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12,
            $13, $14,
            $15, $16,
            $17, $18,
            $19, 'sync', NOW(), NOW()
          )
          ON CONFLICT (company_id, phone) DO UPDATE SET
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
          [
            companyId, phone, c.name || null, c.gender || null,
            c.birth_date || null, c.birth_year || null, c.age || null,
            c.email || null, c.address || null, c.region || null,
            c.grade || null, c.points || null,
            c.store_code || null, c.store_name || null,
            c.recent_purchase_date || null, c.recent_purchase_amount || null,
            c.total_purchase_amount || null, c.purchase_count || null,
            c.custom_fields ? JSON.stringify(c.custom_fields) : null
          ]
        );

        upsertedCount++;
      } catch (rowError: any) {
        failedCount++;
        failures.push({
          phone: c.phone || 'unknown',
          reason: rowError.message || 'Unknown error'
        });
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
  }
});

// ============================================
// POST /api/sync/purchases - 구매내역 벌크 INSERT
// ============================================
router.post('/purchases', async (req: SyncAuthRequest, res: Response) => {
  try {
    const { purchases, mode, batchIndex, totalBatches } = req.body;
    const companyId = req.companyId!;

    if (!purchases || !Array.isArray(purchases) || purchases.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'purchases array is required and must not be empty'
      });
    }

    if (purchases.length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 1000 purchases per batch'
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

    for (const p of purchases) {
      try {
        if (!p.customer_phone) {
          failedCount++;
          failures.push({ phone: p.customer_phone || 'empty', reason: 'customer_phone is required' });
          continue;
        }

        const phone = cleanPhone(p.customer_phone);
        if (!isValidPhone(phone)) {
          failedCount++;
          failures.push({ phone: p.customer_phone, reason: 'invalid phone format' });
          continue;
        }

        // customer_id 조회 (company_id + phone 기준)
        const customerResult = await query(
          `SELECT id FROM customers WHERE company_id = $1 AND phone = $2`,
          [companyId, phone]
        );
        const customerId = customerResult.rows[0]?.id || null;

        await query(
          `INSERT INTO purchases (
            company_id, customer_id, customer_phone, purchase_date,
            store_code, store_name, product_code, product_name,
            quantity, unit_price, total_amount, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
          [
            companyId, customerId, phone,
            p.purchase_date || null,
            p.store_code || null, p.store_name || null,
            p.product_code || null, p.product_name || null,
            p.quantity || null, p.unit_price || null, p.total_amount || null
          ]
        );

        insertedCount++;
      } catch (rowError: any) {
        failedCount++;
        failures.push({
          phone: p.customer_phone || 'unknown',
          reason: rowError.message || 'Unknown error'
        });
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
        batch_size: config.batch_size ?? 4000,
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
      `SELECT version, download_url, release_notes, force_update, released_at
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
