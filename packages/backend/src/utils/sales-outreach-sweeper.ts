/**
 * ★ 2026-08-24 AI 영업 아웃리치 — 경량 sweeper (설계 = docs/2026-07-31-ai-sales-outreach-design.md §15-6)
 *
 * 하는 일은 둘뿐이다(회의 확정 · 자동 재시도 0 · 자동 발송 0 · 자동 재생성 0):
 *  ① 좀비 잡 정직 종결 — heartbeat(lock_at) 기준 15분 초과한 producing·crawling 잡을 failed로.
 *     시작 시각이 아니라 마지막 heartbeat 기준(H9 — 살아 있는 긴 단계를 죽이지 않는다).
 *     재시도 가능 상태로 되돌리지 않는다(H·0813 lease 교훈) — 재시도는 화면 버튼만.
 *  ② 만료 파기 — 공개 수명(OUTREACH_PREVIEW_DAYS · 기산 = 전달 표시/발송 성공/생성 시각) 경과 건의
 *     포스터 공개 파일 삭제 + purged_at 스탬프(공개 페이지 즉시 차단). Harold 확정 ③(미회신 파기) 이행.
 *     temp 중간물(원본·누끼)은 스튜디오 7일 스윕이 이미 지운다. 삭제 실패 = purged_at 롤백(다음 회차 재수거 · H7).
 *
 * 주기(10분) < 최단 임계(15분) — H10. 다중 프로세스 대비: 종결·파기 모두 조건부 UPDATE 선점이라
 * 두 프로세스가 겹쳐도 한쪽만 1행을 잡는다(파일 삭제는 멱등 — 없으면 무시 · H11).
 */
import * as fs from 'fs';
import * as path from 'path';
import { query } from '../config/database';
import { OUTREACH_PREVIEW_DAYS } from './sales-outreach-produce';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const ZOMBIE_MINUTES = 15;

// routes/cdp.ts INAPP_IMAGE_BASE와 동일 정의 미러(단일 env 소스 — utils/assets.ts와 같은 관례)
const INAPP_IMAGE_BASE = process.env.INAPP_IMAGE_PATH || path.resolve('./uploads/inapp');

async function sweepZombies(): Promise<void> {
  try {
    const r = await query(
      `UPDATE sales_outreach_jobs
          SET stage = 'failed', fail_stage = stage,
              fail_reason = '처리 시간이 초과되어 중단되었습니다. 재시도 버튼으로 다시 시작할 수 있습니다.',
              lock_token = NULL
        WHERE stage IN ('queued','crawling','analyzing','producing_copy','producing_image','producing_dm','producing_email')
          AND COALESCE(lock_at, created_at) < NOW() - ($1 || ' minutes')::interval
        RETURNING id, fail_stage`,
      [ZOMBIE_MINUTES],
    );
    for (const row of r.rows) {
      console.log('[sales-outreach-sweeper] 좀비 잡 종결:', row.id, row.fail_stage);
    }
  } catch (err: any) {
    // 기록 실패가 순회를 멈추지 않는다(H13)
    console.error('[sales-outreach-sweeper] 좀비 회수 실패:', err?.message);
  }
}

async function sweepExpired(): Promise<void> {
  try {
    const candidates = await query(
      `SELECT id FROM sales_outreach_jobs
        WHERE purged_at IS NULL
          AND COALESCE(forwarded_at, mail_sent_at, created_at) < NOW() - ($1 || ' days')::interval
        LIMIT 20`,
      [OUTREACH_PREVIEW_DAYS],
    );
    for (const row of candidates.rows) {
      // 선점 — 다중 프로세스에서도 한쪽만 파기 작업을 잡는다
      const claimed = await query(
        `UPDATE sales_outreach_jobs SET purged_at = NOW()
          WHERE id = $1 AND purged_at IS NULL RETURNING id`,
        [row.id],
      );
      if (claimed.rows.length === 0) continue;
      try {
        const assets = await query(
          `SELECT payload FROM sales_outreach_assets WHERE job_id = $1 AND kind = 'studio_image'`,
          [row.id],
        );
        for (const a of assets.rows) {
          const url = String(a.payload?.url || '');
          // /api/cdp/inapp/image/{companyId}/{filename} → 파일시스템 경로. 형식 밖 URL은 건너뜀.
          const m = url.match(/\/api\/cdp\/inapp\/image\/([0-9a-f-]{36})\/([A-Za-z0-9._-]+)$/i);
          if (!m) continue;
          const filePath = path.join(INAPP_IMAGE_BASE, m[1], m[2]);
          try {
            fs.unlinkSync(filePath);
          } catch (e: any) {
            if (e?.code !== 'ENOENT') throw e; // 없음 = 이미 지워짐(멱등) · 그 외 = 실패로 취급
          }
        }
        console.log('[sales-outreach-sweeper] 만료 파기:', row.id);
      } catch (err: any) {
        // 삭제 실패 = 스탬프 롤백 → 다음 회차가 다시 집는다(H7 — 조용히 넘기지 않는다)
        console.error('[sales-outreach-sweeper] 파기 실패(다음 회차 재시도):', row.id, err?.message);
        await query(`UPDATE sales_outreach_jobs SET purged_at = NULL WHERE id = $1`, [row.id]).catch(() => {});
      }
    }
  } catch (err: any) {
    console.error('[sales-outreach-sweeper] 만료 파기 순회 실패:', err?.message);
  }
}

/** 끊긴 발송 선점(sending) 복구 — 프로세스가 발송 도중 죽으면 sending이 남아 발송 버튼이 영구 잠긴다.
 *  발송 여부는 알 수 없으므로 'unknown'으로 정직하게 복구한다(발송을 대신 하지 않는다 · 판단은 사람). */
async function sweepStuckSending(): Promise<void> {
  try {
    const r = await query(
      `UPDATE sales_outreach_jobs SET mail_result = 'unknown'
        WHERE stage = 'ready' AND mail_result = 'sending'
          AND lock_at < NOW() - ($1 || ' minutes')::interval
        RETURNING id`,
      [ZOMBIE_MINUTES],
    );
    for (const row of r.rows) {
      console.log('[sales-outreach-sweeper] 끊긴 발송 선점 복구(unknown):', row.id);
    }
  } catch (err: any) {
    console.error('[sales-outreach-sweeper] 발송 선점 복구 실패:', err?.message);
  }
}

async function sweepOnce(): Promise<void> {
  await sweepZombies();
  await sweepStuckSending();
  await sweepExpired();
}

/** app.ts 부팅 등재 — 등재 여부는 계약 테스트가 고정한다(선언은 의도이고 워커가 사실이다). */
export function startSalesOutreachSweeper(): void {
  setInterval(() => {
    sweepOnce().catch((err: any) => console.error('[sales-outreach-sweeper] 순회 예외:', err?.message));
  }, SWEEP_INTERVAL_MS);
  console.log('[sales-outreach-sweeper] 시작 (주기 10분 · 좀비 15분 · 파기 ' + OUTREACH_PREVIEW_DAYS + '일)');
}
