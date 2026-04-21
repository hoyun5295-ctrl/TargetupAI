// ============================================================================
// admin-sync.ts — 슈퍼관리자 Sync Agent 관리 API
//
// 설치:
//   1. packages/backend/src/routes/admin-sync.ts 로 저장
//   2. app.ts에 추가:
//      import adminSyncRoutes from './routes/admin-sync';
//      app.use('/api/admin/sync', adminSyncRoutes);
// ============================================================================

import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import { query } from '../config/database';

const router = Router();


// ----------------------------------------------------------------------------
// 온라인 상태 판정 헬퍼
// ----------------------------------------------------------------------------
// ★ 2026-04-21 Harold님 지시 A안: Agent heartbeat 주기(60분)에 맞춰 판정 기준 완화
//   근거: sync-agent/src/scheduler/index.ts:125 `cron.schedule('0 * * * *', ...)` = 매 정각 1회
//   문제: 이전 10분/30분 기준은 60분 주기 Agent를 "정상"인데도 하루의 1/3 시간 동안 "지연"으로 표시
//   수정: online=1주기+여유(70분), delayed=2주기+여유(130분), offline=2주기 초과
function getOnlineStatus(lastHeartbeatAt: string | null): 'online' | 'delayed' | 'offline' {
  if (!lastHeartbeatAt) return 'offline';
  const diffMinutes = (Date.now() - new Date(lastHeartbeatAt).getTime()) / (1000 * 60);
  if (diffMinutes <= 70) return 'online';    // 1주기(60분) + 10분 여유
  if (diffMinutes <= 130) return 'delayed';  // 2주기(120분) + 10분 여유 — 한 번 놓침 허용
  return 'offline';                          // 2주기 초과 = 확실한 이상
}


// ----------------------------------------------------------------------------
// GET /api/admin/sync/agents — Agent 목록
// ----------------------------------------------------------------------------
router.get('/agents', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { rows: agents } = await query(`
      SELECT
        sa.id,
        sa.company_id,
        c.company_name,
        sa.agent_name,
        sa.agent_version,
        sa.db_type,
        sa.status,
        sa.last_heartbeat_at,
        sa.last_sync_at,
        sa.total_customers_synced,
        sa.created_at
      FROM sync_agents sa
      LEFT JOIN companies c ON c.id = sa.company_id
      ORDER BY sa.created_at DESC
    `);

    // Agent가 없으면 빈 배열 반환
    if (agents.length === 0) {
      return res.json({ success: true, agents: [], total: 0 });
    }

    // 각 Agent별 오늘 동기화 건수, 최근 24시간 에러 건수 집계
    const agentIds = agents.map((a: any) => a.id);
    let todaySyncMap: Record<string, number> = {};
    let errorCountMap: Record<string, number> = {};

    // 오늘 동기화 건수
    const { rows: todayRows } = await query(`
      SELECT agent_id, COUNT(*)::int as cnt
      FROM sync_logs
      WHERE started_at >= CURRENT_DATE
        AND agent_id = ANY($1)
      GROUP BY agent_id
    `, [agentIds]);
    todayRows.forEach((r: any) => { todaySyncMap[r.agent_id] = r.cnt; });

    // 최근 24시간 에러 건수
    const { rows: errorRows } = await query(`
      SELECT agent_id, COUNT(*)::int as cnt
      FROM sync_logs
      WHERE started_at >= NOW() - INTERVAL '24 hours'
        AND fail_count > 0
        AND agent_id = ANY($1)
      GROUP BY agent_id
    `, [agentIds]);
    errorRows.forEach((r: any) => { errorCountMap[r.agent_id] = r.cnt; });

    const result = agents.map((a: any) => {
      const onlineStatus = getOnlineStatus(a.last_heartbeat_at);
      return {
        id: a.id,
        company_id: a.company_id,
        company_name: a.company_name,
        agent_name: a.agent_name,
        agent_version: a.agent_version,
        db_type: a.db_type,
        status: a.status,
        is_online: onlineStatus === 'online',
        online_status: onlineStatus,
        last_heartbeat_at: a.last_heartbeat_at,
        last_sync_at: a.last_sync_at,
        total_customers_synced: a.total_customers_synced || 0,
        today_sync_count: todaySyncMap[a.id] || 0,
        recent_error_count: errorCountMap[a.id] || 0,
        created_at: a.created_at
      };
    });

    res.json({
      success: true,
      agents: result,
      total: result.length
    });
  } catch (error) {
    console.error('Sync Agent 목록 조회 실패:', error);
    res.status(500).json({ success: false, error: 'Sync Agent 목록 조회 실패' });
  }
});


// ----------------------------------------------------------------------------
// GET /api/admin/sync/agents/:agentId — Agent 상세
// ----------------------------------------------------------------------------
router.get('/agents/:agentId', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;

    // Agent 기본 정보
    const { rows } = await query(`
      SELECT
        sa.*,
        c.company_name
      FROM sync_agents sa
      LEFT JOIN companies c ON c.id = sa.company_id
      WHERE sa.id = $1
    `, [agentId]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent를 찾을 수 없습니다.' });
    }

    const agent = rows[0];
    const onlineStatus = getOnlineStatus(agent.last_heartbeat_at);

    // 최근 동기화 로그 20건
    const { rows: recentLogs } = await query(`
      SELECT
        id, sync_type, mode, batch_index, total_batches,
        total_count, success_count, fail_count,
        duration_ms, error_message,
        started_at, completed_at
      FROM sync_logs
      WHERE agent_id = $1
      ORDER BY started_at DESC
      LIMIT 20
    `, [agentId]);

    // 오늘 통계
    const { rows: statsRows } = await query(`
      SELECT
        COUNT(*)::int as total_syncs_today,
        COALESCE(SUM(CASE WHEN fail_count > 0 THEN 1 ELSE 0 END), 0)::int as total_errors_today,
        COALESCE(AVG(duration_ms), 0)::int as avg_sync_duration_ms
      FROM sync_logs
      WHERE agent_id = $1 AND started_at >= CURRENT_DATE
    `, [agentId]);

    const stats = statsRows[0];

    res.json({
      success: true,
      agent: {
        id: agent.id,
        company_id: agent.company_id,
        company_name: agent.company_name,
        agent_name: agent.agent_name,
        agent_version: agent.agent_version,
        os_info: agent.os_info,
        db_type: agent.db_type,
        status: agent.status,
        is_online: onlineStatus === 'online',
        online_status: onlineStatus,
        sync_interval_customers: agent.sync_interval_customers ?? 60,
        sync_interval_purchases: agent.sync_interval_purchases ?? 30,
        last_heartbeat_at: agent.last_heartbeat_at,
        last_sync_at: agent.last_sync_at,
        total_customers_synced: agent.total_customers_synced || 0,
        total_purchases_synced: agent.total_purchases_synced || 0,
        config: agent.config || {},
        created_at: agent.created_at
      },
      recent_logs: recentLogs,
      stats: {
        total_syncs_today: stats.total_syncs_today,
        total_errors_today: stats.total_errors_today,
        total_customers: agent.total_customers_synced || 0,
        total_purchases: agent.total_purchases_synced || 0,
        avg_sync_duration_ms: stats.avg_sync_duration_ms
      }
    });
  } catch (error) {
    console.error('Sync Agent 상세 조회 실패:', error);
    res.status(500).json({ success: false, error: 'Sync Agent 상세 조회 실패' });
  }
});


// ----------------------------------------------------------------------------
// PUT /api/admin/sync/agents/:agentId/config — 원격 설정 변경
// ----------------------------------------------------------------------------
router.put('/agents/:agentId/config', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { sync_interval_customers, sync_interval_purchases, column_mapping } = req.body;

    // 최소 주기 검증 (서버 과부하 방지)
    const MIN_INTERVAL = 5;
    if (sync_interval_customers !== undefined && sync_interval_customers < MIN_INTERVAL) {
      return res.status(400).json({
        success: false,
        error: `고객 동기화 주기는 최소 ${MIN_INTERVAL}분 이상이어야 합니다.`
      });
    }
    if (sync_interval_purchases !== undefined && sync_interval_purchases < MIN_INTERVAL) {
      return res.status(400).json({
        success: false,
        error: `구매 동기화 주기는 최소 ${MIN_INTERVAL}분 이상이어야 합니다.`
      });
    }

    // Agent 존재 확인
    const { rows } = await query(
      'SELECT id, config FROM sync_agents WHERE id = $1',
      [agentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent를 찾을 수 없습니다.' });
    }

    const currentConfig = rows[0].config || {};

    // 설정 병합 (기존 config에 새 값 덮어쓰기)
    const newConfig = {
      ...currentConfig,
      ...(sync_interval_customers !== undefined && { sync_interval_customers }),
      ...(sync_interval_purchases !== undefined && { sync_interval_purchases }),
      ...(column_mapping !== undefined && { column_mapping })
    };

    // config jsonb + sync_interval 컬럼 둘 다 업데이트
    // ?? null 사용 (0도 유효한 값으로 취급)
    await query(`
      UPDATE sync_agents SET
        config = $1,
        sync_interval_customers = COALESCE($2, sync_interval_customers),
        sync_interval_purchases = COALESCE($3, sync_interval_purchases),
        updated_at = NOW()
      WHERE id = $4
    `, [
      JSON.stringify(newConfig),
      sync_interval_customers ?? null,
      sync_interval_purchases ?? null,
      agentId
    ]);

    res.json({
      success: true,
      message: '설정이 저장되었습니다. Agent가 다음 config 조회 시 반영됩니다.'
    });
  } catch (error) {
    console.error('Sync Agent 설정 변경 실패:', error);
    res.status(500).json({ success: false, error: 'Sync Agent 설정 변경 실패' });
  }
});


// ----------------------------------------------------------------------------
// POST /api/admin/sync/agents/:agentId/command — 수동 명령 등록
// ----------------------------------------------------------------------------
router.post('/agents/:agentId/command', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { type } = req.body;

    // ★ D131 후속(2026-04-21): pause/resume 추가 — 원격 동기화 중단/재개 지원
    //   pause: Agent 스케줄러 stop (heartbeat 유지), resume: 재개
    const ALLOWED_COMMAND_TYPES = ['full_sync', 'restart', 'pause', 'resume'] as const;
    if (!type || !ALLOWED_COMMAND_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `type은 ${ALLOWED_COMMAND_TYPES.join(' | ')} 중 하나여야 합니다.`
      });
    }

    // Agent 존재 확인 + 현재 config 조회
    const { rows } = await query(
      'SELECT id, config FROM sync_agents WHERE id = $1',
      [agentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent를 찾을 수 없습니다.' });
    }

    const currentConfig = rows[0].config || {};
    const commands = currentConfig.commands || [];

    // 새 명령 추가
    const commandId = randomUUID();
    const newCommand = {
      id: commandId,
      type,
      params: {},
      created_at: new Date().toISOString()
    };

    commands.push(newCommand);

    // ★ D131 후속(2026-04-21): pause/resume 명령 등록 시 sync_agents.status도 즉시 업데이트.
    //   이유: UI가 DB status 기반으로 재개/일시정지 버튼 활성화를 판단하는데
    //   heartbeat 주기(최대 60분)로 인한 시차 때문에 "실제 Agent는 paused인데 UI는 active"
    //   모순 발생 → 사용자가 재개 못 누르는 UX 결함. 명령 등록 = 의도된 상태로 DB 선반영.
    //   Agent가 heartbeat self-report 시 덮어쓰기 구조라 최종 일관성 유지됨.
    const intendedStatus: Record<string, string> = {
      pause: 'paused',
      resume: 'active',
    };
    const nextStatus = intendedStatus[type];
    if (nextStatus) {
      await query(
        `UPDATE sync_agents
         SET config = jsonb_set(COALESCE(config, '{}'), '{commands}', $1::jsonb),
             status = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [JSON.stringify(commands), nextStatus, agentId]
      );
    } else {
      await query(
        `UPDATE sync_agents SET config = jsonb_set(COALESCE(config, '{}'), '{commands}', $1::jsonb), updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(commands), agentId]
      );
    }

    res.json({
      success: true,
      command_id: commandId,
      message: '명령이 등록되었습니다. Agent가 다음 config 조회 시 실행합니다.',
      statusUpdated: nextStatus || null,
    });
  } catch (error) {
    console.error('Sync Agent 명령 등록 실패:', error);
    res.status(500).json({ success: false, error: 'Sync Agent 명령 등록 실패' });
  }
});


// ----------------------------------------------------------------------------
// DELETE /api/admin/sync/agents/:agentId — Agent 레코드 삭제
// ★ D131 후속(2026-04-21): 버려진/중복 Agent 정리용
//   활성(online) Agent는 기본 차단 → force=true 쿼리로 강제 삭제 가능.
//   sync_logs는 FK CASCADE로 함께 삭제됨 (스키마 DDL 기준).
// ----------------------------------------------------------------------------
router.delete('/agents/:agentId', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const force = req.query.force === 'true';

    // Agent 존재 + heartbeat 최신성 확인
    const agentResult = await query(
      `SELECT id, agent_name, company_id, status, last_heartbeat_at,
              EXTRACT(EPOCH FROM (NOW() - last_heartbeat_at)) / 60 AS minutes_since_heartbeat
       FROM sync_agents WHERE id = $1`,
      [agentId]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent를 찾을 수 없습니다.' });
    }

    const agent = agentResult.rows[0];
    const minutesSinceHeartbeat = Number(agent.minutes_since_heartbeat ?? 99999);

    // 활성 Agent(30분 이내 heartbeat) 삭제 방지 — force=true일 때만 허용
    if (!force && minutesSinceHeartbeat < 30) {
      return res.status(409).json({
        success: false,
        error: `Agent가 활성 상태입니다 (마지막 heartbeat ${Math.round(minutesSinceHeartbeat)}분 전). 먼저 일시정지/중지한 뒤 삭제하거나 ?force=true 로 강제 삭제하세요.`,
        code: 'AGENT_ACTIVE',
      });
    }

    // 삭제 (sync_logs는 FK CASCADE)
    const deleteResult = await query(
      `DELETE FROM sync_agents WHERE id = $1 RETURNING id, agent_name`,
      [agentId]
    );

    console.log(`[Admin Sync] Agent 삭제: ${agent.agent_name} (id=${agentId}, company=${agent.company_id}, force=${force})`);

    return res.json({
      success: true,
      deleted: deleteResult.rows[0],
      forced: force,
    });
  } catch (error) {
    console.error('[Admin Sync] Agent 삭제 실패:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: 'Agent 삭제 실패', detail: msg });
  }
});


// ----------------------------------------------------------------------------
// GET /api/admin/sync/agents/:agentId/logs — 동기화 로그 (페이지네이션)
// ----------------------------------------------------------------------------
router.get('/agents/:agentId/logs', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const syncType = req.query.sync_type as string;
    const offset = (page - 1) * limit;

    // Agent 존재 확인
    const agentCheck = await query(
      'SELECT id FROM sync_agents WHERE id = $1',
      [agentId]
    );
    if (agentCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent를 찾을 수 없습니다.' });
    }

    // 필터 조건 빌드
    let whereClause = 'WHERE agent_id = $1';
    const params: any[] = [agentId];
    let paramIndex = 2;

    if (syncType && ['customers', 'purchases'].includes(syncType)) {
      whereClause += ` AND sync_type = $${paramIndex}`;
      params.push(syncType);
      paramIndex++;
    }

    // 총 건수
    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int as total FROM sync_logs ${whereClause}`,
      params
    );

    // 로그 조회
    const { rows: logs } = await query(
      `SELECT
        id, sync_type, mode, batch_index, total_batches,
        total_count, success_count, fail_count,
        duration_ms, error_message,
        started_at, completed_at, created_at
      FROM sync_logs
      ${whereClause}
      ORDER BY started_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      logs,
      pagination: {
        page,
        limit,
        total: countRows[0].total
      }
    });
  } catch (error) {
    console.error('Sync Agent 로그 조회 실패:', error);
    res.status(500).json({ success: false, error: 'Sync Agent 로그 조회 실패' });
  }
});


export default router;
