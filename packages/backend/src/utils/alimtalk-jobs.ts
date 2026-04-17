/**
 * 알림톡/브랜드메시지 관련 배치 작업
 *
 * ALIMTALK-DESIGN.md §5-7 기준. 스케줄러 3종.
 *
 *   1) syncCategoriesJob       — 매일 03:00 KST, 발신프로필/템플릿 카테고리 캐시 갱신
 *   2) syncPendingTemplatesJob — 5분 주기, 검수중/승인대기 상태 폴링 (웹훅 누락 시 fallback)
 *   3) syncSenderStatusJob     — 1시간 주기, 발신프로필 상태 폴링
 *
 * 운영 원칙:
 *   - IMC env(API_KEY/BASE_URL) 미설정 시 전부 no-op (Phase 0 대응)
 *   - 개별 호출 실패는 로그만 남기고 다음 주기 계속 (배치 전체가 중단되지 않도록)
 *   - 기존 `auto-campaign-worker.ts` / `spam-test-queue.ts` 패턴(setInterval 기반) 준수
 */

import { query } from '../config/database';
import * as imc from './alimtalk-api';

// ════════════════════════════════════════════════════════════
// 공통 유틸
// ════════════════════════════════════════════════════════════

function envReady(): boolean {
  const env = process.env.IMC_ENV || 'STG';
  const key =
    env === 'PRD' ? process.env.IMC_API_KEY : process.env.IMC_API_KEY_SANDBOX;
  const url =
    env === 'PRD' ? process.env.IMC_BASE_URL_PRD : process.env.IMC_BASE_URL_STG;
  return !!key && !!url;
}

function log(tag: string, ...args: any[]) {
  console.log(`[alimtalk-jobs][${tag}]`, ...args);
}

function logErr(tag: string, err: any) {
  console.error(`[alimtalk-jobs][${tag}] 실패`, err?.message || err);
}

// ════════════════════════════════════════════════════════════
// 1) 카테고리 일일 동기화 (매일 03:00 KST)
// ════════════════════════════════════════════════════════════

export async function syncCategoriesJob(): Promise<void> {
  if (!envReady()) {
    log('categorySync', 'env 미설정 — skip');
    return;
  }

  // ── 발신프로필 카테고리 (3단 트리, code 11자리)
  try {
    const senderRes = await imc.listSenderCategories();
    if (senderRes.code === '0000' && Array.isArray(senderRes.data)) {
      for (const node of senderRes.data) {
        await query(
          `INSERT INTO kakao_sender_categories (category_code, parent_code, level, name, active_yn, synced_at)
           VALUES ($1, $2, $3, $4, 'Y', now())
           ON CONFLICT (category_code) DO UPDATE SET
             parent_code = EXCLUDED.parent_code,
             level       = EXCLUDED.level,
             name        = EXCLUDED.name,
             active_yn   = 'Y',
             synced_at   = now()`,
          [node.code, node.parentCode ?? null, node.level, node.name],
        );
      }
      log('categorySync', `sender 카테고리 ${senderRes.data.length}건 동기화`);
    }
  } catch (err) {
    logErr('categorySync-sender', err);
  }

  // ── 템플릿 카테고리 (flat, code 6자리)
  try {
    const tplRes = await imc.listTemplateCategories();
    if (tplRes.code === '0000' && Array.isArray(tplRes.data)) {
      for (const c of tplRes.data) {
        await query(
          `INSERT INTO kakao_template_categories (category_code, name, active_yn, synced_at)
           VALUES ($1, $2, 'Y', now())
           ON CONFLICT (category_code) DO UPDATE SET
             name      = EXCLUDED.name,
             active_yn = 'Y',
             synced_at = now()`,
          [c.code, c.name],
        );
      }
      log('categorySync', `template 카테고리 ${tplRes.data.length}건 동기화`);
    }
  } catch (err) {
    logErr('categorySync-template', err);
  }
}

// ════════════════════════════════════════════════════════════
// 2) 검수중 템플릿 상태 폴링 (5분 주기, 웹훅 누락 fallback)
// ════════════════════════════════════════════════════════════

export async function syncPendingTemplatesJob(): Promise<void> {
  if (!envReady()) {
    log('pendingTemplateSync', 'env 미설정 — skip');
    return;
  }

  let rows: Array<{
    id: string;
    company_id: string;
    profile_key: string;
    template_code: string;
    status: string;
  }> = [];

  try {
    const res = await query(
      `SELECT t.id,
              t.company_id,
              p.profile_key,
              t.template_code,
              t.status
         FROM kakao_templates t
         JOIN kakao_sender_profiles p ON p.id = t.profile_id
        WHERE t.status IN ('REQUESTED','REVIEWING','REQ','REV')
          AND (t.last_synced_at IS NULL OR t.last_synced_at < now() - INTERVAL '5 minutes')
        LIMIT 100`,
    );
    rows = res.rows;
  } catch (err) {
    logErr('pendingTemplateSync-fetch', err);
    return;
  }

  if (rows.length === 0) return;

  let updated = 0;
  for (const row of rows) {
    try {
      const res = await imc.getAlimtalkTemplate(
        row.profile_key,
        row.template_code,
      );
      if (res.code !== '0000' || !res.data) continue;

      const latestStatus = (res.data as any).status;
      if (!latestStatus) continue;

      await query(
        `UPDATE kakao_templates
            SET status          = $1,
                reject_reason   = $2,
                last_synced_at  = now(),
                updated_at      = now()
          WHERE id = $3`,
        [latestStatus, (res.data as any).rejectReason ?? null, row.id],
      );
      updated++;
    } catch (err) {
      logErr(`pendingTemplateSync-${row.template_code}`, err);
      // 개별 템플릿 실패해도 계속
    }
  }
  log('pendingTemplateSync', `${updated}/${rows.length}건 상태 갱신`);
}

// ════════════════════════════════════════════════════════════
// 3) 발신프로필 상태 폴링 (1시간 주기)
// ════════════════════════════════════════════════════════════

export async function syncSenderStatusJob(): Promise<void> {
  if (!envReady()) {
    log('senderStatusSync', 'env 미설정 — skip');
    return;
  }

  let rows: Array<{ id: string; profile_key: string; status: string }> = [];
  try {
    const res = await query(
      `SELECT id, profile_key, status
         FROM kakao_sender_profiles
        WHERE profile_key IS NOT NULL
          AND COALESCE(status, 'PENDING') NOT IN ('DELETED')
        LIMIT 200`,
    );
    rows = res.rows;
  } catch (err) {
    logErr('senderStatusSync-fetch', err);
    return;
  }

  if (rows.length === 0) return;

  let updated = 0;
  for (const row of rows) {
    try {
      const res = await imc.getSender(row.profile_key);
      if (res.code !== '0000' || !res.data) continue;

      const latestStatus = res.data.status;
      if (!latestStatus || latestStatus === row.status) continue;

      await query(
        `UPDATE kakao_sender_profiles
            SET status     = $1,
                updated_at = now()
          WHERE id = $2`,
        [latestStatus, row.id],
      );
      updated++;
    } catch (err) {
      logErr(`senderStatusSync-${row.profile_key}`, err);
    }
  }
  log('senderStatusSync', `${updated}/${rows.length}건 상태 갱신`);
}

// ════════════════════════════════════════════════════════════
// 스케줄러 부트스트랩
// ════════════════════════════════════════════════════════════

let _scheduled = false;
let _categoryTimer: NodeJS.Timeout | null = null;
let _templateTimer: NodeJS.Timeout | null = null;
let _senderTimer: NodeJS.Timeout | null = null;

function nextKst03(): number {
  // 지금(UTC) → KST(+9h) → 다음 03:00 KST까지 ms
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const targetKst = new Date(kstNow);
  targetKst.setUTCHours(3, 0, 0, 0);
  if (targetKst.getTime() <= kstNow.getTime()) {
    targetKst.setUTCDate(targetKst.getUTCDate() + 1);
  }
  return targetKst.getTime() - kstNow.getTime();
}

function scheduleCategorySync() {
  const wait = nextKst03();
  _categoryTimer = setTimeout(async () => {
    try {
      await syncCategoriesJob();
    } catch (err) {
      logErr('categorySync-tick', err);
    }
    // 이후 24h 주기
    _categoryTimer = setInterval(() => {
      syncCategoriesJob().catch((e) => logErr('categorySync-interval', e));
    }, 24 * 60 * 60 * 1000);
  }, wait);
}

/**
 * 알림톡 배치 스케줄러 시작. app.ts listen 콜백에서 1회 호출.
 */
export function startAlimtalkScheduler(): void {
  if (_scheduled) return;
  _scheduled = true;

  // 1) 카테고리 — 다음 03:00 KST 첫 실행 + 이후 24h
  scheduleCategorySync();

  // 2) 검수중 템플릿 — 5분 주기
  _templateTimer = setInterval(() => {
    syncPendingTemplatesJob().catch((e) =>
      logErr('pendingTemplateSync-interval', e),
    );
  }, 5 * 60 * 1000);

  // 3) 발신프로필 — 1시간 주기
  _senderTimer = setInterval(() => {
    syncSenderStatusJob().catch((e) => logErr('senderStatusSync-interval', e));
  }, 60 * 60 * 1000);

  log('scheduler', 'started (category=daily 03:00 KST, template=5m, sender=1h)');
}

/** 테스트/재시작용 */
export function stopAlimtalkScheduler(): void {
  if (_categoryTimer) clearTimeout(_categoryTimer);
  if (_categoryTimer) clearInterval(_categoryTimer as any);
  if (_templateTimer) clearInterval(_templateTimer);
  if (_senderTimer) clearInterval(_senderTimer);
  _categoryTimer = _templateTimer = _senderTimer = null;
  _scheduled = false;
}
