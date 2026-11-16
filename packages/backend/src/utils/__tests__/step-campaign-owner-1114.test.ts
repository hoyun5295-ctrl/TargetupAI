/**
 * C134(B-1114-1 · 뿌리 R96) — 여정의 단계 캠페인은 여정만 닫는다 · 계약 시험(★ 2026-11-14)
 *   (설계서 docs/2026-11-14-journey-step-campaign-owner-design.md §4 · 흐름 표 docs/2026-11-14-journey-step-campaign-seam-ledger.md)
 *
 * 뿌리 R96 = 공용 표(campaigns)의 행을 그 행의 주인이 아닌 코드가 종결시킨다.
 *   옛: 캠페인 목록 조회 두 곳이 「결과가 다 왔다」며 열린 날의 여정 단계 캠페인을 completed 로 바꿨다 → 여정의 확정 문장이 트리거에 막혔다.
 *
 * 1. 기계 추출 — 운영 코드 전 파일에서 campaigns 를 쓰는 문장을 뽑고, 여정 소유 파일 밖에서 **일생 칸(상태 · 굳힘 · 대상 수 · 발송 수)을 쓰는**
 *    문장 전부가 아래 표(파일 + 문장 지문 → 여정 단계 캠페인에 닿지 않는 이유)에 있어야 한다. 지문 = 공백을 접은 문장 글의 해시.
 *    새 문장이 생기거나 있던 문장의 글이 바뀌면 빨간불 = 「이 문장이 여정 단계 캠페인에 닿는가」를 다시 판정하고 표에 이유를 적는다.
 *    글자 조건이 있는지로 통과시키지 않는다(send_type 이라는 글자가 있어도 여정을 고르는 조건일 수 있다 · Codex 설계 1R).
 * 2. 고정 — 여정 밖 네 곳(목록 둘 · 굳힘 · 재대조)의 보호 조건과 여정 쪽 장치(닫기 · 다시 열기 · 고르기)가 문장 · 호출 순서에 있다.
 * 3. 순수 판정의 값 범위.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  isStepCampaignDayClosed, isOpenJourneyStepCampaign, stepCampaignSentWritten, stepCampaignCloseBefore,
  NOT_JOURNEY_STEP_SQL, JOURNEY_STEP_SEND_TYPE, STEP_CAMPAIGN_CLOSE_GRACE_MS, CLOSE_FINISHED_STEP_CAMPAIGNS_SQL,
} from '../journey-step-campaign';
import { listEffectiveStatus, autoCompleteTargetIds, LIST_AUTO_COMPLETE_SQL } from '../campaign-list-autocomplete';
import { MARK_FINAL_SQL, RECONCILE_WRITE_SQL, RECONCILE_BENCHMARK_SQL } from '../campaign-sync-worker';
import { zeroStreak, sumViolations, addKstDays, kstYmd, FAULT_REASON_SQL, STUCK_CLAIM_AGE_SEC, ERRORED_ON_DAY_SQL } from '../journey-selfcheck';
import { CLAIM_PROOF_LIMIT_SEC } from '../journey-send-claim';

const SRC = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

// ───── 기계 추출 ─────
const HEAD = /\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+campaigns\b(?![_\w])/gi;
/** 여정이 주인인 파일(단계 캠페인을 만들고 · 확정하고 · 닫는 CT 둘) */
const OWNER_FILES = new Set(['utils/journey-step-campaign.ts', 'utils/journey-send-claim.ts']);
/** 일생 칸 = 상태 · 굳힘 · 대상 수 · 발송 수 */
const LIFE = /\b(status|result_final|target_count|sent_count)\s*=/i;

function productionFiles(): string[] {
  const out: string[] = [];
  (function walk(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p); }
      else if (/\.ts$/.test(e.name) && !/\.(test|sanity)\.ts$/.test(e.name)) out.push(p);
    }
  })(SRC);
  return out.sort();
}
/** idx 가 든 문자열 리터럴의 글(백틱 덩이는 여러 줄 · 따옴표는 그 줄 안). 리터럴 밖이면 그 줄. */
function literalAt(src: string, idx: number): string {
  let inside = false; let start = -1;
  for (let i = 0; i < idx; i++) if (src[i] === '`' && src[i - 1] !== '\\') { inside = !inside; start = i; }
  if (inside) { const end = src.indexOf('`', idx); return src.slice(start + 1, end < 0 ? idx + 400 : end); }
  const ls = src.lastIndexOf('\n', idx) + 1; const le = src.indexOf('\n', idx);
  const line = src.slice(ls, le < 0 ? src.length : le);
  const col = idx - ls;
  for (const q of ["'", '"']) {
    const open = line.lastIndexOf(q, col);
    if (open >= 0) { const close = line.indexOf(q, col); if (close > open) return line.slice(open + 1, close); }
  }
  return line;
}
const norm = (s: string) => s.replace(/\$\{[^}]*\}/g, '${}').replace(/\s+/g, ' ').trim();
const fingerprint = (s: string) => crypto.createHash('sha1').update(norm(s)).digest('hex').slice(0, 10);
/** (순수) 문장 글 하나의 분류 — 새 행 · 일생 칸을 쓰는가. */
export function classifyCampaignWrite(text: string): { kind: 'INSERT' | 'UPDATE' | 'DELETE'; life: boolean } {
  const m = /\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+campaigns\b/i.exec(text);
  const kind = !m ? 'UPDATE' : /^INSERT/i.test(m[1]) ? 'INSERT' : /^DELETE/i.test(m[1]) ? 'DELETE' : 'UPDATE';
  if (kind === 'INSERT') return { kind, life: false };
  if (kind === 'DELETE') return { kind, life: true };   // 행을 지우는 것 = 일생의 끝
  const set = /\bSET\b([\s\S]*?)(\bWHERE\b|$)/i.exec(text);
  return { kind, life: LIFE.test(set ? set[1] : text) };
}
interface Stmt { file: string; line: number; text: string; fp: string; kind: string; life: boolean }
function extractCampaignWrites(): Stmt[] {
  const rows: Stmt[] = [];
  for (const f of productionFiles()) {
    const src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    const rel = path.relative(SRC, f).replace(/\\/g, '/');
    const re = new RegExp(HEAD.source, 'gi'); let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const ls = src.lastIndexOf('\n', m.index) + 1;
      const lineText = src.slice(ls, src.indexOf('\n', m.index));
      if (/^\s*(\/\/|\*|\/\*)/.test(lineText)) continue;   // 주석 줄
      const text = literalAt(src, m.index);
      const c = classifyCampaignWrite(text);
      rows.push({ file: rel, line: src.slice(0, m.index).split('\n').length, text, fp: fingerprint(text), kind: c.kind, life: c.life });
    }
  }
  return rows;
}

/**
 * 여정 소유 파일 밖에서 일생 칸을 쓰는 문장 = 「파일#지문」 → [문장 수, 여정 단계 캠페인에 닿지 않는 이유].
 *   이유의 근거 = 이음매 원장 §2(묶음 이름을 그대로 적는다). 문장을 고치면 지문이 바뀐다 → 이유가 여전히 맞는지 보고 지문을 새로 적는다.
 *   면제 목록이 아니다: 닿는 문장(목록 CT · 굳힘 · 재대조 · 스위퍼)도 여기 있고, 그 보호 조건은 아래 「고정」과 실 PG 시험이 따로 잡는다.
 */
const NON_OWNER_LIFECYCLE_WRITES: Record<string, [number, string]> = {
  // ── 사용자가 id 를 주는 주소 — 관문이 발송 뒤 상태를 거절한다(여정 행 = sending · completed 는 통과 못 함 · 원장 §2-3)
  'routes/campaigns.ts#2692d42034': [1, 'POST /:id/send 적재 끝 — 관문 = 발송 뒤 상태 거절(:786)'],
  'routes/campaigns.ts#61a5a77a12': [1, 'POST /:id/send 종결 — 같은 관문'],
  'routes/campaigns.ts#f3dccb3d91': [1, '수신자 삭제 — 관문 = status scheduled'],
  'routes/campaigns.ts#227ff39ca4': [1, '수신자 한 명 삭제 — 관문 = status scheduled'],
  'routes/campaigns.ts#524828f567': [1, '초안 삭제 — 문장 조건 status draft(여정 행은 draft 가 아니다)'],
  // ── 같은 요청이 방금 만든 id(직접 · 브랜드 · 자동 발송 캠페인 · 원장 §2-3)
  'routes/campaigns.ts#4ebd113e6e': [3, 'POST /:id/send 실패 종결 1 + 직접발송이 방금 만든 캠페인 실패 종결 2'],
  'routes/campaigns.ts#e92ccad482': [2, '직접발송이 방금 만든 캠페인 삭제(차감 실패 · 0건)'],
  'routes/campaigns.ts#1768af2c4d': [1, '직접발송이 방금 만든 캠페인 적재 끝'],
  'routes/campaigns.ts#fff3ecfff9': [1, '직접발송이 방금 만든 캠페인 완료'],
  'routes/campaigns.ts#df4875ea6f': [1, '브랜드 직접발송이 방금 만든 캠페인 실패'],
  'routes/campaigns.ts#a75c62d637': [1, '브랜드 직접발송이 방금 만든 캠페인 종결'],
  'utils/auto-campaign-worker.ts#04248ff664': [1, '자동발송이 방금 만든 캠페인 실패'],
  'utils/auto-campaign-worker.ts#af0430cfc5': [1, '자동발송이 방금 만든 캠페인 종결'],
  'utils/brand-message.ts#89a6f02301': [1, '브랜드 발송 종결 — 부르는 곳 = 직접발송이 방금 만든 id 하나(campaigns.ts)'],
  'utils/direct-send-core.ts#e92ccad482': [1, '직접발송 CT 가 방금 만든 캠페인 삭제'],
  'utils/direct-send-core.ts#0115c613d4': [2, '직접발송 CT 가 방금 만든 캠페인 실패(send_phase 를 가진 행)'],
  'utils/direct-send-worker.ts#e0bf6df582': [1, '직접발송 워커 적재 끝 — 대상 = send_phase 를 가진 행(여정 행은 send_phase 없음)'],
  // ── 예약 · 취소 · 결과 동기화(원장 §2-3)
  'utils/campaign-lifecycle.ts#9c13fa2dcf': [1, '예약 종결 — 문장 조건 status scheduled'],
  'utils/campaign-lifecycle.ts#eb1c6a4a33': [2, '결과 동기화 — 실행 행이 있는 AI 캠페인 · 발송 종류 direct · operator 집합(여정 행은 둘 다 밖)'],
  'utils/cancel-settle.ts#fe8cee8f3b': [1, '취소 정산 — 취소 관문 = scheduled · draft · 대행발송 자기 id'],
  'utils/cancel-settle.ts#2da188e230': [1, '취소 — 같은 관문'],
  'utils/cancel-settle.ts#27fd9edfcc': [1, '취소 — 문장 조건 status scheduled'],
  'utils/refund-pending.ts#36cfe9eba1': [1, '환불 의무 실패 종결 — 부르는 곳 = 자동 · 브랜드 · 직접 · 스위퍼의 적재 0 고착(여정 제외 refund-calc)'],
  // ── 여정 단계 캠페인에 닿는 문장(보호 조건 = 아래 「고정」 + 실 PG 시험)
  'utils/campaign-list-autocomplete.ts#73717a9f3c': [1, '목록 자동 완료 CT — 문장에 NOT_JOURNEY_STEP_SQL(여정 행 제외)'],
  'utils/campaign-sync-worker.ts#cd150cff22': [1, '굳힘 — 후보에서 열린 날의 여정 행 제외 + 문장에 상태 조건(다시 열린 행 제외)'],
  'utils/campaign-sync-worker.ts#d0ba8a5c3d': [1, '재대조 — 여정 행은 상태 · 발송 수를 쓰지 않음 + 읽은 상태와 같을 때만'],
  'utils/mysql-refund-sweeper.ts#0896f935fa': [1, '선불 정산의 화면 보조 — 여정 행은 발송 수를 안 올림(loaded = 지금 값) · 회수는 닫힌 날만'],
};

describe('R96 — campaigns 의 일생 칸을 쓰는 문장은 전부 판정돼 있다(기계 추출)', () => {
  const stmts = extractCampaignWrites();

  it('추출이 살아 있다 — 문장 수 · 여정 소유 문장 · 새 행 문장이 뽑힌다', () => {
    expect(stmts.length).toBeGreaterThanOrEqual(80);
    expect(stmts.filter((s) => OWNER_FILES.has(s.file)).length).toBeGreaterThanOrEqual(8);
    expect(stmts.filter((s) => s.kind === 'INSERT').length).toBeGreaterThanOrEqual(6);
    expect(stmts.some((s) => s.file === 'utils/journey-send-claim.ts' && /target_count = target_count \+/.test(s.text))).toBe(true);   // 확정 문장
  });

  it('여정 소유 파일 밖에서 일생 칸을 쓰는 문장 = 표와 글자까지 같다(새 문장 · 바뀐 문장 = 빨간불 · 다시 판정)', () => {
    const found = new Map<string, number>();
    const where = new Map<string, string[]>();
    for (const s of stmts) {
      if (OWNER_FILES.has(s.file) || !s.life) continue;
      const k = `${s.file}#${s.fp}`;
      found.set(k, (found.get(k) || 0) + 1);
      where.set(k, [...(where.get(k) || []), `${s.file}:${s.line}`]);
    }
    const unknown = [...found.keys()].filter((k) => !NON_OWNER_LIFECYCLE_WRITES[k]).map((k) => `${k} @ ${where.get(k)!.join(', ')}`);
    expect(unknown, '표에 없는 문장 — 여정 단계 캠페인에 닿는지 판정하고 NON_OWNER_LIFECYCLE_WRITES 에 이유를 적는다(이음매 원장 §2)').toEqual([]);
    const stale = Object.keys(NON_OWNER_LIFECYCLE_WRITES).filter((k) => !found.has(k));
    expect(stale, '표에만 있는 줄 — 문장이 없어졌거나 글이 바뀌었다(지문을 새로 적는다)').toEqual([]);
    const miscount = [...found.entries()].filter(([k, n]) => NON_OWNER_LIFECYCLE_WRITES[k][0] !== n).map(([k, n]) => `${k} 표 ${NON_OWNER_LIFECYCLE_WRITES[k][0]} · 실제 ${n} @ ${where.get(k)!.join(', ')}`);
    expect(miscount, '같은 글의 문장 수가 다르다 — 늘어난 자리를 판정한다').toEqual([]);
  });

  it('분류는 글자 조건이 있는지로 통과시키지 않는다 — 여정을 고르는 조건 · OR 로 넓힌 조건 · 새 삭제 문장도 판정 대상이다', () => {
    const cases = [
      `UPDATE campaigns SET status = 'completed' WHERE id = $1 AND send_type = 'journey'`,
      `UPDATE campaigns SET status = 'completed' WHERE id = ANY($1) AND (status = 'scheduled' OR status = 'sending')`,
      `UPDATE campaigns SET result_final = true WHERE send_phase IS NULL`,
      `UPDATE campaigns SET sent_count = $2 WHERE id = $1`,
      `DELETE FROM campaigns WHERE id = $1`,
    ];
    for (const sql of cases) expect(classifyCampaignWrite(sql).life, sql).toBe(true);
    // 표에 없는 글이면 위 시험이 빨간불을 낸다(같은 지문이 표에 없다는 것만 여기서 확인)
    for (const sql of cases.slice(0, 4)) expect(Object.keys(NON_OWNER_LIFECYCLE_WRITES).some((k) => k.endsWith('#' + fingerprint(sql)))).toBe(false);
    // 일생 칸을 안 쓰는 문장 · 새 행은 대상이 아니다
    expect(classifyCampaignWrite(`UPDATE campaigns SET result_synced_at = NOW() WHERE id = $1`).life).toBe(false);
    expect(classifyCampaignWrite(`UPDATE campaigns SET send_config = jsonb_set(send_config, '{x}', '1') WHERE id = $1 AND status = 'sending'`).life).toBe(false);
    expect(classifyCampaignWrite(`INSERT INTO campaigns (id, status) VALUES ($1, 'sending')`)).toEqual({ kind: 'INSERT', life: false });
  });
});

describe('R96 고정 — 여정 밖 네 곳의 보호 조건', () => {
  const userList = read('routes/campaigns.ts');
  const adminList = read('routes/admin.ts');
  const worker = read('utils/campaign-sync-worker.ts');

  it('목록 두 곳 = CT 를 부른다 · 인라인 완료 문장 0 · 보이는 상태도 CT · 발송 종류를 넘긴다', () => {
    for (const [name, src] of [['사용자 목록', userList], ['관리자 목록', adminList]] as const) {
      expect(src.includes(`SET status = 'completed', updated_at = NOW()\n         WHERE id = ANY($1::uuid[]) AND status = 'sending'`), name).toBe(false);
      expect((src.match(/autoCompleteTargetIds\(result\.rows, /g) || []).length, name).toBe(1);
      expect((src.match(/applyListAutoComplete\(/g) || []).length, name).toBe(1);
      expect((src.match(/listEffectiveStatus\(c\.status, \w+, c\.send_type\)/g) || []).length, name).toBe(1);
      expect(/effectiveStatus = 'completed'/.test(src), name).toBe(false);
    }
    expect(/c\.status, c\.message_type, c\.send_type,/.test(userList)).toBe(true);     // 목록 SELECT 가 발송 종류를 읽는다
    expect(/c\.status, c\.send_type, c\.send_channel, c\.created_at,/.test(adminList)).toBe(true);
  });

  it('목록 CT 문장 = 보내는 중 + 여정 아님 · 여정 조건은 한 값에서 온다', () => {
    expect(NOT_JOURNEY_STEP_SQL).toBe(`send_type IS DISTINCT FROM '${JOURNEY_STEP_SEND_TYPE}'`);
    expect(JOURNEY_STEP_SEND_TYPE).toBe('journey');
    expect(norm(LIST_AUTO_COMPLETE_SQL)).toBe(`UPDATE campaigns SET status = 'completed', updated_at = NOW() WHERE id = ANY($1::uuid[]) AND status = 'sending' AND send_type IS DISTINCT FROM 'journey'`);
  });

  it('사용자 목록의 exclude_journey = 값을 실을 때만 여정 행을 뺀다(없으면 종전) · 조인 표와 안 겹치게 별칭', () => {
    expect(/if \(req\.query\.exclude_journey === '1'\) \{\s*whereClause \+= ` AND \$\{NOT_JOURNEY_STEP_SQL\}`;/.test(userList)).toBe(true);
    expect(userList.includes(`.replace(/\\bsend_type\\b/g, 'c.send_type')`)).toBe(true);
    const strip = fs.readFileSync(path.resolve(SRC, '..', '..', 'frontend', 'src', 'components', 'dashboard', 'LiveAutomationStrip.tsx'), 'utf8');
    expect(strip.includes(`get('/api/campaigns?status=sending&limit=1&exclude_journey=1')`)).toBe(true);
  });

  it('굳힘 = 후보에서 열린 날의 여정 행을 빼고 · 문장에 상태 조건(읽은 뒤 다시 열린 행을 굳히지 않는다)', () => {
    const fn = worker.slice(worker.indexOf('async function markFinalizedCampaigns('), worker.indexOf('const RECONCILE_BATCH'));
    expect(/SELECT id, status, success_count, fail_count, sent_count, target_count, send_type,/.test(fn)).toBe(true);
    expect(fn.indexOf('!isOpenJourneyStepCampaign(c.send_type, Number(c.send_base_ms) || 0, now)')).toBeGreaterThan(0);
    expect(fn.indexOf('!isOpenJourneyStepCampaign(')).toBeLessThan(fn.indexOf('shouldFinalizeCampaign({'));
    expect(fn.includes('await query(MARK_FINAL_SQL, [ids])')).toBe(true);
    expect(norm(MARK_FINAL_SQL)).toBe(`UPDATE campaigns SET result_final = true, result_synced_at = NOW() WHERE id = ANY($1::uuid[]) AND result_final = false AND status IN ('completed', 'failed')`);
  });

  it('재대조 = 열린 날의 여정 행을 건너뛰고 · 여정 행의 상태 · 발송 수를 쓰지 않고 · 읽은 상태와 같을 때만 쓴다', () => {
    const fn = worker.slice(worker.indexOf('async function reconcileFinalizedCampaigns('), worker.indexOf('export function startCampaignSyncWorker'));
    expect(/SELECT id, company_id, created_by, status, result_final, success_count, fail_count, sent_count, send_type,/.test(fn)).toBe(true);
    const skip = fn.indexOf('if (isOpenJourneyStepCampaign(camp.send_type, camp.send_base)) {');
    expect(skip).toBeGreaterThan(0);
    expect(skip).toBeLessThan(fn.indexOf('resolveCampaignTableGroups('));          // 큐를 읽기 전에 건너뛴다
    expect(fn.includes('stepCampaignSentWritten(camp.send_type, Number(camp.sent_count || 0), sentCount)')).toBe(true);
    expect(fn.includes('await query(RECONCILE_WRITE_SQL, [camp.id, newStatus, sentCount, successCount, failCount, finalize, camp.status])')).toBe(true);
    expect(fn.includes('if (!wrote.rowCount) {')).toBe(true);
    expect(fn.includes('${RECONCILE_BENCHMARK_SQL})')).toBe(true);                   // 굳은 행을 다시 고르는 기준
    const w = norm(RECONCILE_WRITE_SQL);
    expect(w.includes(`SET status = CASE WHEN send_type = 'journey' THEN status ELSE $2::text END`)).toBe(true);
    expect(w.includes(`sent_count = CASE WHEN send_type = 'journey' THEN sent_count ELSE GREATEST(COALESCE(sent_count, 0), $3::int) END`)).toBe(true);
    expect(w.includes(`to_jsonb(GREATEST(COALESCE(NULLIF(send_config->>'reconRows', '')::int, 0), $3::int))`)).toBe(true);
    expect(w.endsWith(`WHERE id = $1 AND status = $7::text`)).toBe(true);
    expect(RECONCILE_BENCHMARK_SQL).toBe(`GREATEST(sent_count, COALESCE(NULLIF(send_config->>'reconRows', '')::int, 0))`);
  });

  it('여정이 닫는 문장은 주기 맨 앞(굳힘 · 재대조보다 먼저)에서 불린다', () => {
    const run = worker.slice(worker.indexOf('async function runOnce('), worker.indexOf('export const MARK_FINAL_SQL'));
    const close = run.indexOf('await closeFinishedStepCampaigns()');
    expect(close).toBeGreaterThan(0);
    expect(close).toBeLessThan(run.indexOf('await markFinalizedCampaigns()'));
    expect(run.indexOf('await markFinalizedCampaigns()')).toBeLessThan(run.indexOf('await reconcileFinalizedCampaigns()'));
  });
});

describe('R96 고정 — 여정 쪽 장치(닫기 · 다시 열기 · 고르기)', () => {
  const step = read('utils/journey-step-campaign.ts');
  const claim = read('utils/journey-send-claim.ts');

  it('닫는 문장의 조건 넷이 한 문장 안에 있다 · 빈 캠페인만 닫으면서 굳힌다', () => {
    const s = norm(CLOSE_FINISHED_STEP_CAMPAIGNS_SQL);
    expect(s.includes(`WHERE c.send_type = 'journey' AND c.status = 'sending'`)).toBe(true);
    expect(s.includes(`(COALESCE(c.scheduled_at, c.sent_at, c.created_at) AT TIME ZONE 'Asia/Seoul')::date < $1::date`)).toBe(true);
    expect(s.includes(`AND NOT (COALESCE(c.send_config, '{}'::jsonb) ? 'loadUnit')`)).toBe(true);
    expect(s.includes(`AND NOT EXISTS (SELECT 1 FROM journey_step_logs l WHERE l.campaign_id = c.id AND l.status = 'sending')`)).toBe(true);
    expect(s.includes(`result_final = CASE WHEN COALESCE(c.sent_count, 0) = 0 AND NOT EXISTS (SELECT 1 FROM journey_step_logs l WHERE l.campaign_id = c.id AND (l.status = 'sent' OR (l.status = 'failed' AND l.error_reason = 'load_unprovable'))) THEN true ELSE c.result_final END`)).toBe(true);
    expect(step.includes('await query(CLOSE_FINISHED_STEP_CAMPAIGNS_SQL, [stepCampaignCloseBefore(now)])')).toBe(true);
  });

  it('다시 열기 = 여정 행 · 완료 · 그 표식 중 미확정이 있을 때만 · 굳힘도 푼다 · 확정 문장 앞에서 불린다', () => {
    const fn = step.slice(step.indexOf('export async function reopenStepCampaignForConfirm('), step.indexOf('* `campaigns.message_type` CHECK'));
    const s = norm(fn);
    expect(s.includes(`UPDATE campaigns c SET status = 'sending', result_final = false, updated_at = NOW() WHERE c.id = $1::uuid AND c.send_type = '\${}' AND c.status = 'completed' AND EXISTS (SELECT 1 FROM journey_step_logs l WHERE l.campaign_id = c.id AND l.id = ANY($2::uuid[]) AND l.status = 'sending')`)).toBe(true);
    expect(fn.includes(`dedupKey: \`journey-step-campaign-reopened:\${campaignId}\``)).toBe(true);   // 열었으면 경보(주인 아닌 쓰기의 신호)
    const confirm = claim.slice(claim.indexOf('export async function confirmLoadUnit('), claim.indexOf('export interface PendingClaim'));
    const reopenAt = confirm.indexOf('await reopenStepCampaignForConfirm(campaignId, claimIds);');
    expect(reopenAt).toBeGreaterThan(0);
    expect(reopenAt).toBeLessThan(confirm.indexOf('WITH confirmed AS ('));
    expect((claim.match(/reopenStepCampaignForConfirm\(/g) || []).length).toBe(1);   // 부르는 자리 = 확정 문장 하나
  });

  it('고르기 = 오늘 행의 상태를 읽고 · sending 일 때만 이어 쓴다(두 갈래 모두)', () => {
    const fn = step.slice(step.indexOf('export async function pickStepCampaignForUnits('), step.indexOf('async function createStepCampaignRow('));
    expect(/::int AS seq, c\.status,/.test(fn)).toBe(true);
    expect(fn.includes(`const open = String(row.status) === 'sending';`)).toBe(true);
    expect(fn.includes('if (open && !row.sealed && sameShape && row.protocol === LOAD_PROTOCOL_UNIT) return')).toBe(true);
    expect(fn.includes('if (open && !row.sealed && sameShape && row.protocol !== LOAD_PROTOCOL_UNIT) {')).toBe(true);
    expect((fn.match(/!row\.sealed && sameShape/g) || []).length).toBe(2);   // 이어 쓰는 갈래는 이 둘뿐
  });
});

describe('순수 판정의 값 범위', () => {
  const NOW = new Date('2026-11-14T15:00:00+09:00');

  it('열린 날의 여정 단계 캠페인 = 여정이고 그날이 안 닫힘 · 기준 시각을 모르면 열린 것(건드리지 않는 쪽)', () => {
    expect(isOpenJourneyStepCampaign('journey', '2026-11-14T00:00:01+09:00', NOW)).toBe(true);
    expect(isOpenJourneyStepCampaign('journey', '2026-11-13T23:59:59+09:00', NOW)).toBe(false);
    expect(isOpenJourneyStepCampaign('journey', new Date('2026-11-14T09:00:00+09:00').getTime(), NOW)).toBe(true);   // 밀리초(굳힘 후보)
    expect(isOpenJourneyStepCampaign('journey', new Date('2026-11-10T09:00:00+09:00').getTime(), NOW)).toBe(false);
    expect(isOpenJourneyStepCampaign('journey', null, NOW)).toBe(true);
    expect(isOpenJourneyStepCampaign('journey', 0, NOW)).toBe(true);
    expect(isOpenJourneyStepCampaign('journey', 'not-a-date', NOW)).toBe(true);
    for (const t of ['direct', 'ai', 'auto', 'operator', 'agency', null, undefined, '']) expect(isOpenJourneyStepCampaign(t, '2026-11-14T10:00:00+09:00', NOW)).toBe(false);
    expect(isStepCampaignDayClosed('2026-11-13T23:59:59+09:00', NOW)).toBe(true);   // 같은 판정 한 벌
  });

  it('닫을 수 있는 날의 끝 = (지금 − 유예 10분)의 KST 날짜', () => {
    expect(STEP_CAMPAIGN_CLOSE_GRACE_MS).toBe(10 * 60 * 1000);
    expect(stepCampaignCloseBefore(new Date('2026-11-14T00:09:59+09:00'))).toBe('2026-11-13');   // 어제 것은 아직 못 닫는다
    expect(stepCampaignCloseBefore(new Date('2026-11-14T00:10:00+09:00'))).toBe('2026-11-14');   // 이제 어제 것까지
    expect(stepCampaignCloseBefore(new Date('2026-11-14T23:59:59+09:00'))).toBe('2026-11-14');
  });

  it('재대조가 쓸 발송 수 = 여정은 지금 값 · 그 밖은 올리기만', () => {
    expect(stepCampaignSentWritten('journey', 100, 110)).toBe(100);
    expect(stepCampaignSentWritten('journey', 100, 0)).toBe(100);
    expect(stepCampaignSentWritten('direct', 100, 110)).toBe(110);
    expect(stepCampaignSentWritten('direct', 742, 274)).toBe(742);   // 읽기로 내리지 않는다(R37)
    expect(stepCampaignSentWritten(null, 3, 5)).toBe(5);
    expect(stepCampaignSentWritten('ai', Number.NaN as any, -1)).toBe(0);
  });

  it('목록에 보일 상태 = 여정 행은 저장된 상태 그대로 · 그 밖은 종전 판정', () => {
    const done = { success: 3, fail: 0, pending: 0 };
    expect(listEffectiveStatus('sending', done, 'journey')).toBe('sending');
    expect(listEffectiveStatus('completed', done, 'journey')).toBe('completed');
    expect(listEffectiveStatus('sending', done, 'direct')).toBe('completed');
    expect(listEffectiveStatus('sending', done)).toBe('completed');
    expect(listEffectiveStatus('sending', done, null)).toBe('completed');
    expect(listEffectiveStatus('sending', { success: 0, fail: 2, pending: 0 }, 'ai')).toBe('completed');
    expect(listEffectiveStatus('sending', { success: 3, fail: 0, pending: 1 }, 'direct')).toBe('sending');
    expect(listEffectiveStatus('sending', { success: 0, fail: 0, pending: 0 }, 'direct')).toBe('sending');
    expect(listEffectiveStatus('scheduled', done, 'direct')).toBe('scheduled');
    expect(listEffectiveStatus('failed', done, 'direct')).toBe('failed');
  });

  it('DB 를 닫는 대상 = 완료로 보이는 보내는 중 캠페인 가운데 여정이 아닌 것(여정 아닌 행은 종전과 같은 대상)', () => {
    const rows = [
      { id: 'j', status: 'sending', send_type: 'journey' },
      { id: 'd', status: 'sending', send_type: 'direct' },
      { id: 'n', status: 'sending', send_type: null },
      { id: 'u', status: 'sending' },
      { id: 'p', status: 'sending', send_type: 'direct' },
      { id: 'c', status: 'completed', send_type: 'direct' },
      { id: 's', status: 'scheduled', send_type: 'ai' },
    ];
    const counts: Record<string, { success: number; fail: number; pending: number }> = { p: { success: 1, fail: 0, pending: 2 } };
    const ids = autoCompleteTargetIds(rows, (id) => counts[id] || { success: 2, fail: 1, pending: 0 });
    expect(ids).toEqual(['d', 'n', 'u']);
    // 종전 인라인 판정(보내는 중 + 대기 0 + 결과 > 0)과 견주면 빠진 것 = 여정 행뿐
    const legacy = rows.filter((c) => { const k = counts[c.id] || { success: 2, fail: 1, pending: 0 }; return c.status === 'sending' && k.pending === 0 && (k.success > 0 || k.fail > 0); }).map((c) => c.id);
    expect(legacy.filter((id) => !ids.includes(id))).toEqual(['j']);
  });

  it('연속 0 일수 = 어제부터 거슬러 「기록이 있고 위반 0」인 날 수 · 기록이 없는 날에서 끊긴다', () => {
    const today = '2026-11-14';
    const m = (pairs: Array<[number, number]>) => new Map(pairs.map(([back, v]) => [addKstDays(today, -back), v]));
    expect(zeroStreak(today, m([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0]]))).toBe(7);
    expect(zeroStreak(today, m([[1, 0], [2, 0], [3, 4], [4, 0]]))).toBe(2);
    expect(zeroStreak(today, m([[1, 0], [2, 0], [4, 0]]))).toBe(2);        // 사흘 전 기록 없음 = 못 본 날
    expect(zeroStreak(today, m([[2, 0], [3, 0]]))).toBe(0);                 // 어제 기록 없음
    expect(zeroStreak(today, m([[1, 1]]))).toBe(0);
    expect(zeroStreak(today, new Map())).toBe(0);
    expect(zeroStreak(today, m([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0]]))).toBe(7);   // 위쪽 끝 = 7
    expect(addKstDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(kstYmd(new Date('2026-11-13T15:00:00Z'))).toBe('2026-11-14');     // KST 자정
    expect(kstYmd(new Date('2026-11-13T14:59:59Z'))).toBe('2026-11-13');
  });

  it('위반 합 = 여섯 항목 · 시스템 탓 사유만 센다 · 안 풀린 표식의 나이 = 증명 상한 + 10분', () => {
    expect(sumViolations({ failedExecutions: 1, erroredExecutions: 2, stuckClaims: 3, faultLogs: 4, unclosedCampaigns: 5, countMismatch: 6 })).toBe(21);
    expect(STUCK_CLAIM_AGE_SEC).toBe(CLAIM_PROOF_LIMIT_SEC + 600);
    for (const r of ['queue_insert_failed%', 'condition_eval_db_error%', 'unknown_step_type', 'condition_branch_target_missing']) expect(FAULT_REASON_SQL.includes(`'${r}'`), r).toBe(true);
    for (const r of ['insufficient_balance', 'not_met', 'order_cancelled', 'waiting_event', 'load_unprovable']) expect(FAULT_REASON_SQL.includes(r), r).toBe(false);
  });
});

describe('자동 판정이 실제로 불린다(부품만 있고 안 불리는 검사가 아니다)', () => {
  it('합성 데이터 워커 tick 이 「실제 회사처럼」 도는 합성 회사로 자동 판정 tick 을 부른다 · 흉내는 목록과 같은 CT 를 쓴다', () => {
    const demo = read('utils/demo-data.ts');
    expect((demo.match(/await journeySelfcheckTick\(realism, now\);/g) || []).length).toBe(1);
    expect(/const \{ journeySelfcheckTick \} = await import\('\.\/journey-selfcheck'\);/.test(demo)).toBe(true);
    const self = read('utils/journey-selfcheck.ts');
    const mimic = self.slice(self.indexOf('export async function runListOpenMimic('), self.indexOf('export async function judgeJourneyDay('));
    expect(mimic.includes('autoCompleteTargetIds(r.rows, ')).toBe(true);
    expect(mimic.includes(`applyListAutoComplete(ids, '[journey-selfcheck][list]')`)).toBe(true);
    const tick = self.slice(self.indexOf('export async function journeySelfcheckTick('));
    expect(tick.indexOf('await runListOpenMimic(companyId);')).toBeGreaterThan(0);
    expect(tick.indexOf('await runListOpenMimic(companyId);')).toBeLessThan(tick.indexOf('await runJourneySelfcheck(companyId, now);'));
  });
});

describe('사유 값은 실행기가 쓰는 값이다(판정이 없는 글자를 세지 않게)', () => {
  it('시스템 탓 사유 넷이 실행기 소스에 있다', () => {
    const ex = read('utils/journey-executor.ts');
    for (const r of ['queue_insert_failed', 'condition_eval_db_error', 'unknown_step_type', 'condition_branch_target_missing', 'load_unprovable']) expect(ex.includes(`'${r}`), r).toBe(true);
  });
  it('오류 기록(error_log)의 항목 가운데 오류가 아닌 것 = 적재 시도 기록 하나 — 판정이 빼는 값과 실행기가 쓰는 값이 같다', () => {
    const ex = read('utils/journey-executor.ts');
    // 실행기가 error_log 에 넣는 reason 값(글자 그대로 넣는 자리) = 오류 셋 + 적재 시도 · 처리 예외는 stage 'process_execution' 에 사유 글
    expect(ex.includes(`jsonb_build_object('reason', 'load_attempt', 'step_id', $2::text, 'campaign_id', $3::text, 'at', NOW())`)).toBe(true);
    expect(ex.includes(`WHERE fl->>'reason' = 'load_attempt' AND fl->>'step_id' = \${stepParam}::text)`)).toBe(true);   // 실행기도 같은 값으로 가른다
    const reasons = new Set(Array.from(ex.matchAll(/\{ at: new Date\(\)\.toISOString\(\), (?:stage: 'process_execution', )?reason: (?:'(\w+)'|reason\.slice)/g), (m) => m[1] || 'process_execution'));
    expect([...reasons].sort()).toEqual(['condition_eval_db_error', 'process_execution', 'queue_insert_failed', 'queue_insert_unknown']);
    expect(norm(ERRORED_ON_DAY_SQL).includes(`WHERE x->>'reason' IS DISTINCT FROM 'load_attempt' AND CASE WHEN x->>'at' ~`)).toBe(true);
    const num = (name: string) => Number((ex.match(new RegExp(`export const ${name} = (\\d+);`)) || [])[1]);
    expect(num('EXECUTION_ERROR_MAX')).toBeGreaterThan(0);
    expect(num('EXECUTION_ERROR_LOG_KEEP')).toBeGreaterThanOrEqual(num('EXECUTION_ERROR_MAX'));   // 한 실행의 처리 오류가 전부 기록에 남는다(20 ≥ 12)
  });
});
