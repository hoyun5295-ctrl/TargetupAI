/**
 * c105-s0-individual-callback-diff.ts — 여정 「개별회신번호로 보내기」 규칙 바뀜 배포 전 실측(★ 2026-11-05 C105-S0 · 설계서 docs/2026-11-05-c105-out-of-scope-five-design.md §4 H2).
 *
 * 왜: 여정 store 모드(callback_mode='store')의 고객별 회신번호가 옛 규칙(매장 전화번호 → 여정 번호 → 고객 회신번호)에서
 *     직접발송과 같은 새 규칙(회신번호 → 비면 매장 전화번호 · 숫자 있는 값 · 없으면 여정 번호)으로 바뀐다. 바뀌는 고객 수를 배포 전에 본다.
 *
 * 지킴:
 *   - 읽기만(쓰기 0 · REPEATABLE READ 한 트랜잭션 · 끝에 ROLLBACK)
 *   - 대상 = store 모드 켜진 · 멈춘 여정마다 그 회사 고객 전원(실행기가 회사 · 고객 id 로만 고객을 읽으므로 참 상한) + 그중 그 여정 진행 중 실행 고객(부분 수)
 *   - 등록 판정 = 실행기와 같은 함수(getRegisteredCallbackSet(회사, 여정 만든 계정) = isCallbackRegistered 와 같은 집합)
 *   - 옛 규칙 = 지운 실행기 식의 사진(세 줄 · 아래 oldOutcome) · 새 규칙 = CT individualCallbackOf(실행기와 같은 함수)
 *   - 출력 = 여정마다 전이 수만(번호 · 개인정보 출력 0)
 *
 * 실행(운영 서버 · packages/backend · pull 뒤 build 전):
 *   npx ts-node scripts/c105-s0-individual-callback-diff.ts
 */
import 'dotenv/config';
import pool from '../src/config/database';
import { getRegisteredCallbackSet, individualCallbackOf } from '../src/utils/callback-filter';
import { normalizePhone } from '../src/utils/normalize-phone';

type Outcome = { kind: 'send'; number: string } | { kind: 'fail' } | { kind: 'pause' };

/** 옛 실행기 식(journey-executor 810-813 · C105 앞) 사진 */
function oldOutcome(c: any, journeyNumber: string, reg: Set<string>): Outcome {
  const store = String(c.store_phone || '').trim();
  if (store && !reg.has(normalizePhone(store))) return { kind: 'fail' };
  const n = String(store || journeyNumber || c.callback || '').trim();
  return n ? { kind: 'send', number: normalizePhone(n) || n } : { kind: 'pause' };
}

/** 새 실행기 식(C105 H2 · journey-executor individualOf 와 같은 판정) */
function newOutcome(c: any, journeyNumber: string, reg: Set<string>): Outcome {
  const v = String(individualCallbackOf(c) || '').trim();
  const individual = normalizePhone(v) ? v : '';
  if (individual && !reg.has(normalizePhone(individual))) return { kind: 'fail' };
  const n = String(individual || journeyNumber || '').trim();
  return n ? { kind: 'send', number: normalizePhone(n) || n } : { kind: 'pause' };
}

function transition(a: Outcome, b: Outcome): string {
  if (a.kind === 'send' && b.kind === 'send') return a.number === b.number ? '바뀜 없음' : '번호만 바뀜';
  if (a.kind === b.kind) return '바뀜 없음';
  return `${a.kind === 'send' ? '발송' : a.kind === 'fail' ? '실패' : '멈춤'} → ${b.kind === 'send' ? '발송' : b.kind === 'fail' ? '실패' : '멈춤'}`;
}

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const js = await client.query(
      `SELECT id, company_id, created_by, status, COALESCE(callback_number, '') AS callback_number
         FROM journeys WHERE callback_mode = 'store' AND status IN ('active', 'paused') ORDER BY company_id, id`,
    );
    console.log(`[C105-S0] store 모드 켜진 · 멈춘 여정 ${js.rows.length}개`);
    for (const j of js.rows) {
      const reg = await getRegisteredCallbackSet(String(j.company_id), j.created_by ? String(j.created_by) : undefined);
      const cs = await client.query(
        `SELECT c.id, c.callback, c.store_phone,
                EXISTS (SELECT 1 FROM journey_executions e WHERE e.journey_id = $2::uuid AND e.customer_id = c.id AND e.status = 'active') AS in_progress
           FROM customers c WHERE c.company_id = $1::uuid`,
        [j.company_id, j.id],
      );
      const all = new Map<string, number>();
      const prog = new Map<string, number>();
      for (const c of cs.rows) {
        const t = transition(oldOutcome(c, String(j.callback_number), reg), newOutcome(c, String(j.callback_number), reg));
        all.set(t, (all.get(t) || 0) + 1);
        if (c.in_progress) prog.set(t, (prog.get(t) || 0) + 1);
      }
      const fmt = (m: Map<string, number>) => [...m.entries()].sort().map(([k, v]) => `${k} ${v}`).join(' · ') || '0';
      console.log(`[C105-S0] 여정 ${j.id} (${j.status}) 회사 고객 ${cs.rows.length}명 = ${fmt(all)} | 진행 중 = ${fmt(prog)}`);
    }
    await client.query('ROLLBACK');
  } finally {
    client.release();
    await pool.end();
  }
}

main().then(() => process.exit(0), (e) => { console.error('[C105-S0] 실패:', e?.message || e); process.exit(1); });   // R26 = 성공해도 스스로 끝난다
