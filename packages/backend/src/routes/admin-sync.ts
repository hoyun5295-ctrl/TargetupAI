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
import { PLATFORMS, OS_TIERS, DB_OPTIONS, VERIFIED_COMBOS, resolveAgentBuild, buildReleaseDownloadUrl, isPackageKeyVerified, PlatformId } from '../utils/agent-build-tiers';
// ★ 2026-07-10 원격 관리: 진단 명령 버전 게이트 (v1.6.1+ ACK 전용)
import { isAgentVersionGte, ACK_MIN_AGENT_VERSION } from '../utils/agent-protocol';
import path from 'path';
import fs from 'fs';

const router = Router();


// ----------------------------------------------------------------------------
// 싱크에이전트 배포 위저드 — 빌드 티어 룰표 제공 (CT: utils/agent-build-tiers)
// 서수란 팀장이 OS를 평범한 말로 고르면 내보낼 빌드를 알려준다. 룰표는 CT 1곳만.
// ----------------------------------------------------------------------------

// 산출물 다운로드 폴더 — 빌드 머신에서 만든 zip을 여기로 업로드. 없으면 startup에 자동 생성.
const AGENT_BUILDS_DIR = process.env.AGENT_BUILDS_DIR || path.join(__dirname, '..', '..', 'agent-builds');
try { fs.mkdirSync(AGENT_BUILDS_DIR, { recursive: true }); } catch { /* 권한 등 — 다운로드 시점에 다시 판정 */ }

// GET /api/admin/sync/build-tiers — 위저드 부트스트랩(플랫폼/OS/DB 목록)
//   verifiedCombos = 실연결 스모크 통과 조합(`<osTierId>__<dbId>`) — verified 배지 판단용.
router.get('/build-tiers', authenticate, requireSuperAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, platforms: PLATFORMS, osTiers: OS_TIERS, dbOptions: DB_OPTIONS, verifiedCombos: Array.from(VERIFIED_COMBOS) });
});

// GET /api/admin/sync/build-tiers/resolve?platform=&osTier=&db= — 내보낼 빌드 1건
router.get('/build-tiers/resolve', authenticate, requireSuperAdmin, (req: Request, res: Response) => {
  const platform = String(req.query.platform || '') as PlatformId;
  const osTier = String(req.query.osTier || '');
  const db = String(req.query.db || '');
  if (platform !== 'windows' && platform !== 'linux') {
    res.status(400).json({ success: false, error: 'platform 값이 올바르지 않습니다.' });
    return;
  }
  res.json({ success: true, result: resolveAgentBuild(platform, osTier, db) });
});

// GET /api/admin/sync/build-tiers/download/:packageKey — 빌드 산출물 zip 다운로드
// packageKey = `<buildTier>-<driver>` (예: win-legacy-oracle). 산출물은 빌드 머신에서 만들어
// 서버에 업로드(기본 packages/backend/agent-builds/, 또는 ENV AGENT_BUILDS_DIR).
// 서버는 sync-agent-<packageKey>.zip 만 서빙한다.
const BUILD_DRIVERS = ['oracle', 'mssql', 'mysql', 'pg'] as const;
const VALID_PACKAGE_KEYS = new Set<string>(
  OS_TIERS.flatMap((t) => (t.buildTier ? BUILD_DRIVERS.map((d) => `${t.buildTier}-${d}`) : [])),
);
router.get('/build-tiers/download/:packageKey', authenticate, requireSuperAdmin, (req: Request, res: Response) => {
  const packageKey = req.params.packageKey;
  if (!VALID_PACKAGE_KEYS.has(packageKey)) {
    res.status(400).json({ success: false, error: '알 수 없는 빌드 패키지입니다.' });
    return;
  }
  // ★ 2026-08-03: 검증된 조합만 내보낸다(런북 §1) — 현 버전 세대 verified 0건이면 전부 닫힘.
  //   화면 잠금이 아니라 이 길목이 게이트다. 미검증 조합은 담당자가 확인 후 개별 전달한다.
  if (!isPackageKeyVerified(packageKey)) {
    res.status(403).json({
      success: false,
      code: 'AGENT_BUILD_NOT_VERIFIED',
      error: '이 조합은 현재 버전에서 아직 검증되지 않았습니다. 담당자 확인 후 개별 전달합니다.',
    });
    return;
  }
  const file = path.join(AGENT_BUILDS_DIR, `sync-agent-${packageKey}.zip`);
  if (!fs.existsSync(file)) {
    res.status(404).json({
      success: false,
      code: 'AGENT_BUILD_NOT_UPLOADED',
      error: `이 패키지 산출물이 아직 서버에 없습니다. 빌드 후 sync-agent-${packageKey}.zip 을 서버 ${AGENT_BUILDS_DIR} 에 업로드하세요.`,
    });
    return;
  }
  res.download(file, `sync-agent-${packageKey}.zip`);
});


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
    // ★ 2026-06-13: failures(실패 행 상세 jsonb) 포함 — 어떤 행이 왜 실패했는지 화면에서 확인 가능하게
    //   (인비토 매시 1건 고정 실패가 식별 불가였던 구멍). started_at NULL 행도 밀리지 않게 정렬 보강.
    const { rows: recentLogs } = await query(`
      SELECT
        id, sync_type, mode, batch_index, total_batches,
        total_count, success_count, fail_count,
        duration_ms, error_message, failures,
        started_at, completed_at
      FROM sync_logs
      WHERE agent_id = $1
      ORDER BY COALESCE(started_at, completed_at) DESC
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
        created_at: agent.created_at,
        // ★ 2026-07-10 원격 관리: 에이전트 자기 보고 사본 + 명령 이력 — 매핑 모달 프리필/드롭다운·명령 결과 UI 원천.
        //   reported 없음 = 구버전(v1.6.1 미만) 또는 신버전 첫 heartbeat 전 — 프론트는 "보고 대기" 정직 안내.
        reported: (agent.config && agent.config.reported) || null,
        command_results: (agent.config && agent.config.command_results) || [],
        pending_commands: (agent.config && agent.config.commands) || [],
        supports_ack: isAgentVersionGte(agent.agent_version, ACK_MIN_AGENT_VERSION),
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
    const { type, mapping } = req.body;

    // ★ D131 후속(2026-04-21): pause/resume 추가 — 원격 동기화 중단/재개 지원
    //   pause: Agent 스케줄러 stop (heartbeat 유지), resume: 재개
    // ★ 2026-07-01: update_config 추가 — 슈퍼관리자에서 컬럼 매핑을 원격 갱신(재설치 없이)
    // ★ 2026-07-10 원격 관리 P2: 진단 3종 추가 — report_logs(최근 로그 업로드)·test_connection(소스 DB 연결 테스트)·
    //   mapping_dryrun(매핑을 소스 1행에 적용한 미리보기 — 저장/적용 없음). 결과는 ACK로 config.command_results에 수신.
    const ALLOWED_COMMAND_TYPES = ['full_sync', 'restart', 'pause', 'resume', 'update_config', 'report_logs', 'test_connection', 'mapping_dryrun'] as const;
    if (!type || !ALLOWED_COMMAND_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `type은 ${ALLOWED_COMMAND_TYPES.join(' | ')} 중 하나여야 합니다.`
      });
    }

    // ★ 2026-07-01: update_config는 매핑 payload 필수. 빈 명령으로 불필요한 full_sync 유발 차단.
    if (type === 'update_config') {
      const hasMapping = mapping && typeof mapping === 'object' &&
        (mapping.customers || mapping.purchases || mapping.customFieldLabels);
      if (!hasMapping) {
        return res.status(400).json({
          success: false,
          error: 'update_config에는 customers/purchases/customFieldLabels 중 하나 이상의 mapping이 필요합니다.'
        });
      }
    }
    // ★ 2026-07-10: mapping_dryrun도 매핑 필수 (빈 dry-run 무의미)
    if (type === 'mapping_dryrun') {
      const hasMapping = mapping && typeof mapping === 'object' && (mapping.customers || mapping.purchases);
      if (!hasMapping) {
        return res.status(400).json({
          success: false,
          error: 'mapping_dryrun에는 customers/purchases 중 하나 이상의 mapping이 필요합니다.'
        });
      }
    }

    // Agent 존재 확인 + 현재 config 조회
    const { rows } = await query(
      'SELECT id, config, agent_version FROM sync_agents WHERE id = $1',
      [agentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Agent를 찾을 수 없습니다.' });
    }

    // ★ 2026-07-10: 진단 3종은 v1.6.1+(ACK 지원) 전용 — 구버전은 "알 수 없는 명령"으로 버리고 결과 회신도 없다.
    //   등록만 되고 조용히 사라지는 가짜 성공을 사전 차단(정직 안내).
    const ACK_ONLY_TYPES = ['report_logs', 'test_connection', 'mapping_dryrun'];
    if (ACK_ONLY_TYPES.includes(type) && !isAgentVersionGte(rows[0].agent_version, ACK_MIN_AGENT_VERSION)) {
      return res.status(400).json({
        success: false,
        error: `이 명령은 에이전트 v${ACK_MIN_AGENT_VERSION} 이상에서만 지원됩니다. (현재 v${rows[0].agent_version || '알 수 없음'}, 버전 배포 후 사용)`,
        code: 'AGENT_VERSION_TOO_OLD',
      });
    }

    // 새 명령 추가 — ★ 2026-07-10 Codex 지적 정정: 옛 read-modify-write(JS push 후 전체 배열 덮어쓰기)는
    //   heartbeat의 config 갱신과 겹치면 명령이 유실될 수 있다 → 단일 UPDATE 원자 append(||)로 전환.
    const commandId = randomUUID();
    const newCommand: Record<string, unknown> = {
      id: commandId,
      type,
      created_at: new Date().toISOString()
    };
    // ★ 2026-07-01: update_config는 매핑을 payload로 전달 (에이전트가 cmd.payload로 수신).
    //   그 외 명령은 기존대로 빈 params 유지(하위호환).
    // ★ 2026-07-10: mapping_dryrun도 매핑 payload / report_logs는 lines 옵션.
    if (type === 'update_config' || type === 'mapping_dryrun') {
      newCommand.payload = { mapping };
    } else if (type === 'report_logs') {
      const lines = Number(req.body?.lines);
      newCommand.payload = { lines: Number.isFinite(lines) && lines > 0 ? Math.min(1000, Math.floor(lines)) : 200 };
    } else {
      newCommand.params = {};
    }

    // ★ 2026-07-10 Codex 지적 정정: 큐 추가 = 단일 UPDATE 원자 append(기존 배열 || 새 명령 1건).
    //   heartbeat의 config 갱신(조건부 UPDATE)과 겹쳐도 이 append는 유실되지 않는다.
    const appendJson = JSON.stringify([newCommand]);

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
         SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{commands}', COALESCE(config->'commands', '[]'::jsonb) || $1::jsonb),
             status = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [appendJson, nextStatus, agentId]
      );
    } else {
      await query(
        `UPDATE sync_agents SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{commands}', COALESCE(config->'commands', '[]'::jsonb) || $1::jsonb), updated_at = NOW() WHERE id = $2`,
        [appendJson, agentId]
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
// POST /api/admin/sync/releases — 자동 업데이트 릴리즈 등록 (박스 무선 교체 트리거)
// ★ 2026-07-01: sync_releases에 새 버전 등록 → 박스가 매시간 GET /version에서 감지 → 자동 다운로드/교체.
//   exe는 서버 agent-releases/sync-agent-<version>.exe 에 업로드돼 있어야 함 (GET /api/sync/download).
//   컬럼 실측(information_schema): version(NOT NULL)·download_url·checksum·release_notes·force_update·is_active.
// ----------------------------------------------------------------------------
router.post('/releases', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { version, checksum, force_update, release_notes, tier } = req.body;
    if (!version || typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
      return res.status(400).json({ success: false, error: 'version은 x.y.z 형식이어야 합니다.' });
    }
    // tier 검증 — buildTier 5종만 허용(비우면 전역, 하위호환). 잘못된 티어 = 오배포 위험이라 차단.
    const VALID_TIERS = ['win-legacy', 'win-mid', 'win-modern', 'linux-legacy', 'linux-modern'];
    if (tier && !VALID_TIERS.includes(tier)) {
      return res.status(400).json({ success: false, error: `tier는 ${VALID_TIERS.join(' | ')} 중 하나이거나 비워야 합니다.` });
    }
    // ★ 2026-07-01: 같은 티어의 기존 활성만 해제 (다른 티어 릴리스는 유지 — 티어별 독립).
    //   GET /version이 티어 매칭으로 조회하므로, 티어마다 활성 릴리스가 따로 존재해야 한다.
    if (tier) {
      await query(`UPDATE sync_releases SET is_active = false WHERE is_active = true AND tier = $1`, [tier]);
    } else {
      await query(`UPDATE sync_releases SET is_active = false WHERE is_active = true AND tier IS NULL`);
    }
    // download_url = 서버 서빙 라우트(에이전트 baseURL 기준 상대경로). released_at/created_at은 default now().
    //   ★ 2026-07-03: 티어별 릴리즈는 티어를 인코딩(/download/<version>-<tier>) → 티어마다 다른 exe 무선 서빙.
    //   서버 파일 = agent-releases/sync-agent-<version>-<tier>.exe (전역이면 sync-agent-<version>.exe).
    const { rows } = await query(
      `INSERT INTO sync_releases (version, download_url, checksum, release_notes, force_update, is_active, tier)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       RETURNING id, version, tier, download_url, force_update, is_active, released_at`,
      [version, buildReleaseDownloadUrl(version, tier || null), checksum || null, release_notes || null, force_update ?? true, tier || null]
    );
    res.json({ success: true, release: rows[0] });
  } catch (error) {
    console.error('Sync 릴리즈 등록 실패:', error);
    res.status(500).json({ success: false, error: 'Sync 릴리즈 등록 실패' });
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
