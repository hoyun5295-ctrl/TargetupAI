/**
 * utils/staging-sweeper.ts — 발송 스테이징 미연결 적재분 정리 + commit 만료 판정 (★2026-09-26 한줄로 전수점검 S1-H08)
 *
 * 직접발송·알림톡 창은 발송 버튼마다 확인 창 **전에** 수신자 전체를 새 stagingId로 적재한다(/direct-send/stage).
 * 확인 창 취소·재클릭·청크 도중 실패분은 캠페인이 생기지 않아 아무도 지우지 않았다.
 * 0926 운영 실측(M-12) = 1,218건 · 240만 행(863MB) 전량이 연결 캠페인 없음. 전화번호·이름이 기한 없이 남았다.
 * 시각 컬럼·인덱스는 0530 대량 발송 설계(created_at · idx_css_company_created)가 만들어 두었고 정리 작업만 없었다.
 *
 * ⛔ 기간계에 닿지 않는다 — 만료 기준을 이 파일 하나가 소유하고, 정리와 commit이 같은 기준을 본다:
 *   ① 캠페인이 가리키는 적재분(campaigns.staging_id)은 고르지도 지우지도 않는다 = 발송 중·예약·대행 시도는 전부 제외.
 *   ② 적재분은 **통째로만** 지운다(모든 행이 24시간 지난 것). 일부만 지운 적재분이 발송으로 접수되면 나머지가
 *      조용히 빠진 채 정상 발송으로 끝난다(Codex 1R high) — 행 단위 배치를 쓰지 않는 이유다.
 *   ③ commit은 가장 오래된 행이 23시간을 넘은 적재분을 만료로 거절한다(resolveStagingCommitState). 정리가 고르는
 *      적재분은 24시간+라 결코 commit되지 않는다. 1시간 여유 = commit이 판정 뒤 캠페인을 만들기까지의 시간(수 초)보다 넉넉하다.
 *      자동 경로(플래너·AI 운영자·대행·DM)는 적재 직후 같은 흐름에서 캠페인을 만든다(0926 코드 확인) — 이 판정을 거치지 않는다.
 *   ④ 운영 DB는 디스크 하나를 PG·MySQL이 나눠 쓴다(SERVERS.md) — 야간(KST 01~03시)에만 적재분 하나씩 쉬어 가며 지운다.
 *      03시에는 백업 크론(pg·mysql 덤프 → 암호화)이 돈다. 겹치면 같은 디스크 IO가 부딪히고, 덤프가 쥔 긴 트랜잭션 때문에
 *      지운 행의 공간 회수(vacuum)도 밀린다 → 백업 전에 끝낸다.
 * 지워도 파일은 줄지 않는다(공간 재사용만 · 이후 적재가 빈 공간을 다시 쓴다). VACUUM FULL은 적재·워커를 막으므로 하지 않는다(Codex 1R medium).
 */

import { query as dbQuery } from '../config/database';
import { withKeyedLock, uuidLockKey } from './keyed-lock';
import { kstHour } from './ai-credit-calc';

/** 이보다 오래된 미연결 적재분만 지운다. */
export const STAGING_ORPHAN_AGE_HOURS = 24;
/** commit이 받는 적재분의 최대 나이 — 정리 기준보다 짧아야 한다(정리가 고르는 적재분은 commit될 수 없다). */
export const STAGING_COMMIT_MAX_AGE_HOURS = 23;
/** 한 회차 상한(행 수) — 나머지는 다음 회차(1시간 뒤)로 넘긴다. */
export const STAGING_SWEEP_MAX_PER_RUN = 1_000_000;
/** 적재분 사이 쉬는 시간 — 같은 디스크를 쓰는 발송 큐에 틈을 준다. */
export const STAGING_SWEEP_PAUSE_MS = 200;
/** 야간 창(KST) — [start, end) */
export const STAGING_SWEEP_WINDOW_KST = { start: 1, end: 3 };

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const LOG = '[staging-sweeper]';

/**
 * 다음 후보 적재분 하나. $1 = 경과 시간(시) · $2 = 이번 회차에 지우지 못한 staging_id 목록(uuid[]).
 * ⛔ id 커서를 쓰지 않는다 — 동시 적재로 적재분끼리 id가 섞이면(A={1,6} · B={2,5}) 한 적재분의 마지막 id로 건너뛰는 순간
 *   사이의 다른 적재분을 빠뜨린다(Codex 2R). 지운 적재분은 사라지므로 처음부터 다시 골라도 같은 것을 고르지 않고,
 *   지우지 못한 적재분(24시간 안 된 행이 섞임)만 제외 목록으로 건너뛴다.
 */
export const STAGING_PICK_SQL = `SELECT s.staging_id
  FROM campaign_send_staging s
 WHERE s.created_at < NOW() - ($1::int * INTERVAL '1 hour')
   AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.staging_id = s.staging_id)
   AND NOT (s.staging_id = ANY($2::uuid[]))
 ORDER BY s.id
 LIMIT 1`;

/**
 * 적재분 통째 삭제. $1 = staging_id · $2 = 경과 시간(시).
 * 고른 뒤 사이에 캠페인이 생겼거나 새 행이 붙었으면 지우지 않도록 조건을 **같은 문장 안에서** 다시 건다.
 */
export const STAGING_DELETE_SQL = `DELETE FROM campaign_send_staging d
 WHERE d.staging_id = $1
   AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.staging_id = $1)
   AND NOT EXISTS (
     SELECT 1 FROM campaign_send_staging y
      WHERE y.staging_id = $1
        AND y.created_at >= NOW() - ($2::int * INTERVAL '1 hour')
   )`;

type QueryFn = (sql: string, params: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

const defaultQuery: QueryFn = (sql, params) => dbQuery(sql, params) as any;

export function isStagingSweepWindow(now: Date): boolean {
  const h = kstHour(now);
  return h >= STAGING_SWEEP_WINDOW_KST.start && h < STAGING_SWEEP_WINDOW_KST.end;
}

/**
 * commit이 이 적재분을 받아도 되는가. 행이 없거나(정리됨) 가장 오래된 행이 23시간을 넘으면 'expired'.
 * ⛔ 건수 확정·차감·캠페인 생성보다 먼저 부른다 — 만료면 돈이 움직이지 않는다.
 */
export async function resolveStagingCommitState(
  stagingId: string,
  companyId: string,
  q: QueryFn = defaultQuery,
): Promise<'ok' | 'expired'> {
  const r = await q(
    `SELECT COUNT(*)::int AS n,
            MIN(created_at) < NOW() - ($3::int * INTERVAL '1 hour') AS stale
       FROM campaign_send_staging
      WHERE staging_id = $1 AND company_id = $2`,
    [stagingId, companyId, STAGING_COMMIT_MAX_AGE_HOURS],
  );
  const row = r.rows[0] || {};
  if (!(Number(row.n) > 0)) return 'expired';
  return row.stale === true ? 'expired' : 'ok';
}

export type StagingSweepStop = 'window' | 'drained' | 'cap' | 'error';

export interface StagingSweepDeps {
  query: QueryFn;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  maxPerRun?: number;
}

const defaultDeps: StagingSweepDeps = {
  query: defaultQuery,
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** 한 회차 — 창 밖이면 DB를 부르지 않는다. 오류는 던지지 않고 멈춘다(다음 회차가 이어 간다). */
export async function runStagingSweepOnce(
  deps: StagingSweepDeps = defaultDeps,
): Promise<{ deleted: number; stagings: number; stopped: StagingSweepStop }> {
  const cap = deps.maxPerRun ?? STAGING_SWEEP_MAX_PER_RUN;
  let deleted = 0;
  let stagings = 0;
  const skip: string[] = [];
  let first = true;
  for (;;) {
    if (!isStagingSweepWindow(deps.now())) return { deleted, stagings, stopped: 'window' };
    if (deleted >= cap) return { deleted, stagings, stopped: 'cap' };
    if (!first) await deps.sleep(STAGING_SWEEP_PAUSE_MS);
    first = false;
    try {
      const picked = await deps.query(STAGING_PICK_SQL, [STAGING_ORPHAN_AGE_HOURS, [...skip]]);
      if (picked.rows.length === 0) return { deleted, stagings, stopped: 'drained' };
      const stagingId = String(picked.rows[0].staging_id);
      const del = await deps.query(STAGING_DELETE_SQL, [stagingId, STAGING_ORPHAN_AGE_HOURS]);
      const n = Number(del.rowCount) || 0;
      if (n > 0) {
        deleted += n;
        stagings += 1;
      } else {
        // 고른 뒤 캠페인이 생겼거나 24시간 안 된 행이 섞였다 — 이번 회차에서는 다시 고르지 않는다(무한 반복 방지).
        skip.push(stagingId);
      }
    } catch (err: any) {
      console.error(`${LOG} 정리 실패(다음 회차가 이어 간다):`, err?.message || err);
      return { deleted, stagings, stopped: 'error' };
    }
  }
}

let running = false;

async function tick(): Promise<void> {
  if (running) return; // 앞 회차가 길어지면 겹치지 않는다
  running = true;
  try {
    const r = await runStagingSweepOnce();
    // 창 밖 회차는 조용히 넘긴다. 창 안 회차는 0건이어도 남긴다(돌았다는 흔적).
    if (r.stopped !== 'window' || r.stagings > 0) {
      console.log(`${LOG} 미연결 적재분 ${r.stagings}건 · ${r.deleted}행 정리 · 종료=${r.stopped}`);
    }
  } finally {
    running = false;
  }
}

/** app.ts 기동 — 1시간 주기. 야간 창 안의 회차만 실제로 지운다. */
export function startStagingSweeper(): void {
  if (process.env.VITEST) return;
  console.log(`${LOG} 시작 (1시간 주기 · KST ${STAGING_SWEEP_WINDOW_KST.start}~${STAGING_SWEEP_WINDOW_KST.end}시 · ${STAGING_ORPHAN_AGE_HOURS}시간 지난 미연결 적재분 통째)`);
  setTimeout(() => { void tick(); }, 2 * 60 * 1000);
  setInterval(() => { void tick(); }, SWEEP_INTERVAL_MS);
}

/**
 * ★ 2026-09-26 한줄로 V2 F38 — 같은 준비분(staging_id)에 대한 작업을 직렬화한다.
 * stage의 "커밋 여부 검사 → INSERT"와 commit의 "만료 확인 → 집계 → 캠페인 생성"이 섞이면, 검사를 통과한 늦은 INSERT가
 * 커밋 뒤에 들어가 집계되지 않은 수신자가 발송될 수 있었다(Codex 3차 1R high). 둘을 이 잠금 안에서 돌리면 순서가 하나로 선다.
 *
 * ⛔ 프로세스 안 키별 뮤텍스다(3차 2R high 2건 정정). DB advisory 잠금 연결을 쥔 채 본문이 풀 연결을 또 빌리면 동시 요청이
 *   풀(20)을 채워 교착됐다 — 여기는 기다리는 동안 DB 연결을 전혀 쥐지 않는다.
 *   전제: 백엔드는 PM2 fork **단일 프로세스**다(ecosystem.config.js targetup-backend instances 1 · exec_mode fork).
 *   클러스터로 바꾸면 이 잠금은 프로세스끼리 보이지 않는다 — 그때는 이 함수만 바꾸면 된다(호출부 불변).
 * 키 = UUID 16진수 32자리 소문자 — 대소문자·하이픈·중괄호 표기가 달라도 PostgreSQL에선 같은 uuid이므로 같은 잠금이어야 한다.
 * ★ 2026-09-26 (Codex 4차 2R) 뮤텍스 본체는 공용 CT(keyed-lock.ts)로 옮겼다 — 캠페인 발송 시작 잠금과 한 벌. 동작 불변.
 */
export async function withStagingLock<T>(stagingId: string, fn: () => Promise<T>): Promise<T> {
  return withKeyedLock('staging', uuidLockKey(stagingId), fn);
}
