/**
 * ★ 2026-08-24 AI 영업 아웃리치 — 경량 sweeper (설계 = docs/2026-07-31-ai-sales-outreach-design.md §15-6 · ★2026-09-05 B-4·B-5·C-3)
 *
 * 하는 일은 넷뿐이다(회의 확정 · 자동 재시도 0 · 자동 발송 0 · 자동 재생성 0):
 *  ① 좀비 잡 정직 종결 — heartbeat(lock_at) 기준 15분 초과한 producing·crawling·analyzing 잡을 failed로(markFailed 단일 함수).
 *     시작 시각이 아니라 마지막 heartbeat 기준(H9 — 살아 있는 긴 단계를 죽이지 않는다).
 *     재시도 가능 상태로 되돌리지 않는다(H·0813 lease 교훈) — 재시도는 화면 버튼만.
 *  ② 대기 초과 종결 — 미선점 queued가 2시간 넘게 시작되지 못하면(서버 재시작 등) failed(queued)로. 재시도 버튼이 크롤부터 다시.
 *  ③ 끊긴 발송 선점(sending) 복구 — unknown으로(발송 여부는 모른다 · 판단은 사람).
 *  ④ 만료 파기 — 공개 수명(OUTREACH_PREVIEW_DAYS · 기산 = 전달 표시/발송 성공/생성 시각) 경과 건의
 *     포스터·재료 사본 공개 파일 삭제 + **DM 발행 중지(stopDm · 불변 23)** + purged_at 스탬프(공개 페이지 즉시 차단).
 *     삭제·중지 실패 = purged_at 롤백(다음 회차 재수거 · H7). 회사 컨텍스트가 없으면 회차 전체를 스탬프 없이 건너뛴다(영구 누락 방지).
 *
 * 주기(10분) < 최단 임계(15분) — H10. 다중 프로세스 대비: 종결·파기 모두 조건부 UPDATE 선점이라
 * 두 프로세스가 겹쳐도 한쪽만 1행을 잡는다(파일 삭제는 멱등 — 없으면 무시 · H11).
 */
import { query } from '../config/database';
import { OUTREACH_PREVIEW_DAYS, getOutreachContext } from './sales-outreach-produce';
import { markFailed } from './sales-outreach-jobs';
// ★ 2026-09-06 S4 파기 본문은 공용(사람 삭제와 같은 함수 · 두 갈래 금지)
import { purgeOutreachJobArtifacts } from './sales-outreach-purge';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const ZOMBIE_MINUTES = 15;
const STALE_QUEUED_HOURS = 2;

async function sweepZombies(): Promise<void> {
  try {
    const r = await query(
      `SELECT id, stage FROM sales_outreach_jobs
        WHERE stage IN ('crawling','analyzing','producing_copy','producing_image','producing_dm','producing_email')
          AND COALESCE(lock_at, created_at) < NOW() - ($1 || ' minutes')::interval
        LIMIT 50`,
      [ZOMBIE_MINUTES],
    );
    for (const row of r.rows) {
      const ok = await markFailed(String(row.id), String(row.stage),
        '처리 시간이 초과되어 중단되었습니다. 재시도 버튼으로 다시 시작할 수 있습니다.',
        { allowStages: [String(row.stage)], detail: `heartbeat ${ZOMBIE_MINUTES}분 초과` });
      if (ok) console.log('[sales-outreach-sweeper] 좀비 잡 종결:', row.id, row.stage);
    }
  } catch (err: any) {
    // 기록 실패가 순회를 멈추지 않는다(H13)
    console.error('[sales-outreach-sweeper] 좀비 회수 실패:', err?.message);
  }
}

/** ★ B-5 미선점 queued 대기 초과 — 시작되지 못한 건을 정직하게 종결(재시도 버튼이 회수 축) */
async function sweepStaleQueued(): Promise<void> {
  try {
    const r = await query(
      `SELECT id FROM sales_outreach_jobs
        WHERE stage = 'queued' AND lock_token IS NULL
          AND COALESCE(lock_at, created_at) < NOW() - ($1 || ' hours')::interval
        LIMIT 50`,
      [STALE_QUEUED_HOURS],
    );
    for (const row of r.rows) {
      const ok = await markFailed(String(row.id), 'queued',
        '시작되지 못했습니다(서버 재시작 등). 재시도 버튼으로 다시 시작할 수 있습니다.',
        { allowStages: ['queued'], detail: `대기 ${STALE_QUEUED_HOURS}시간 초과` });
      if (ok) console.log('[sales-outreach-sweeper] 대기 초과 종결:', row.id);
    }
  } catch (err: any) {
    console.error('[sales-outreach-sweeper] 대기 초과 회수 실패:', err?.message);
  }
}

async function sweepExpired(): Promise<void> {
  // ★ C-3 회사 컨텍스트 판정은 후보 질의 **전** — null이면 회차 전체를 스탬프 없이 건너뛴다(스탬프 뒤 건너뛰기 = 영구 누락)
  const ctx = getOutreachContext();
  if (!ctx) return;
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
        // DM 중지(not_published = 멱등 성공 · 그 밖 block = 실패 → 롤백 · 다음 회차) + 포스터·배너·재료 사본 파일 삭제 — 공용 본문
        const r = await purgeOutreachJobArtifacts(String(row.id), ctx.companyId);
        console.log('[sales-outreach-sweeper] 만료 파기:', row.id, `DM ${r.dmsStopped} · 파일 ${r.filesDeleted}`);
      } catch (err: any) {
        // 삭제·중지 실패 = 스탬프 롤백 → 다음 회차가 다시 집는다(H7 — 조용히 넘기지 않는다)
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
  await sweepStaleQueued();
  await sweepStuckSending();
  await sweepExpired();
}

/** app.ts 부팅 등재 — 등재 여부는 계약 테스트가 고정한다(선언은 의도이고 워커가 사실이다). */
export function startSalesOutreachSweeper(): void {
  setInterval(() => {
    sweepOnce().catch((err: any) => console.error('[sales-outreach-sweeper] 순회 예외:', err?.message));
  }, SWEEP_INTERVAL_MS);
  console.log('[sales-outreach-sweeper] 시작 (주기 10분 · 좀비 15분 · 대기 초과 ' + STALE_QUEUED_HOURS + '시간 · 파기 ' + OUTREACH_PREVIEW_DAYS + '일)');
}
