/**
 * ★2026-09-13 대행발송 적대검토(Codex high 3건) 회귀 계약.
 *
 * ① 컬럼 탐지 조회가 실패하면 "컬럼 없음"으로 굳히지 않는다. 굳히면 컬럼이 있어도 고객별 회신번호를 빼고 접수·적재한다.
 * ② 재접수용 수신자 조회가 고객별 회신번호를 싣는다. 빼면 재접수가 대표 번호 하나로 나간다.
 * ③ 같은 시도 키의 조회·적재·캠페인 생성은 advisory lock 을 쥔 채로만 돈다. lock 만료 뒤 다음 tick이
 *    앞 실행의 캠페인이 읽는 staging 을 지우고 다시 쓰던 경합을 막는다.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// 모듈을 매번 새로 불러온다(resetModules). 전체 스위트 부하에서 첫 import가 5초를 넘길 수 있어 상한을 넉넉히 둔다
describe('hasAgencyColumn: 조회 실패를 "컬럼 없음"으로 캐시하지 않는다', { timeout: 30_000 }, () => {
  it('실패는 던지고, 다음 호출이 다시 조회해 컬럼이 있음을 본다', async () => {
    vi.resetModules();
    const { hasAgencyColumn } = await import('../agency-send-intake');
    let calls = 0;
    const client = {
      async query() {
        calls++;
        if (calls === 1) throw new Error('connection timeout');
        return { rows: [{ ok: 1 }] };
      },
    };
    await expect(hasAgencyColumn(client, 'callback', 'agency_send_recipients')).rejects.toThrow('connection timeout');
    await expect(hasAgencyColumn(client, 'callback', 'agency_send_recipients')).resolves.toBe(true);
    expect(calls).toBe(2);
  });

  it('컬럼이 정말 없으면 없음이다(DDL 후행 안전은 그대로)', async () => {
    vi.resetModules();
    const { hasAgencyColumn } = await import('../agency-send-intake');
    const client = { async query() { return { rows: [] }; } };
    await expect(hasAgencyColumn(client, 'callback', 'agency_send_recipients')).resolves.toBe(false);
  });
});

describe('재접수 수신자 조회가 고객별 회신번호를 싣는다', () => {
  const route = fs.readFileSync(path.join(__dirname, '../../routes/agency-send.ts'), 'utf8');
  const seg = route.slice(route.indexOf("router.get('/:id/recipients'"), route.indexOf("router.get('/:id/preview'"));

  it('컬럼 탐지 뒤 callback 을 SELECT 에 넣는다', () => {
    expect(seg.length).toBeGreaterThan(0);
    expect(seg).toMatch(/hasAgencyColumn\(pool, 'callback', 'agency_send_recipients'\)/);
    expect(seg).toMatch(/SELECT phone, vars\$\{hasCallback \? ', callback' : ''\}/);
  });
});

describe('시도 키 잠금: 조회·적재·캠페인 생성은 잠금 안에서만 돈다', () => {
  const src = fs.readFileSync(path.join(__dirname, '../agency-send-worker.ts'), 'utf8');
  const wrapStart = src.indexOf('async function dispatchToPipeline(');
  const attemptStart = src.indexOf('async function dispatchAttempt(');
  const attemptEnd = src.indexOf('// ────────────── C. 만료');

  it('감싸는 함수는 잠금을 잡은 뒤에만 시도 본문을 부르고 반드시 푼다', () => {
    expect(wrapStart).toBeGreaterThan(0);
    expect(attemptStart).toBeGreaterThan(wrapStart);
    const wrapper = src.slice(wrapStart, attemptStart);
    expect(wrapper).toMatch(/pg_try_advisory_lock/);
    expect(wrapper.indexOf('pg_try_advisory_lock')).toBeLessThan(wrapper.indexOf('await dispatchAttempt('));
    expect(wrapper).toMatch(/finally \{[\s\S]*pg_advisory_unlock[\s\S]*lockClient\.release\(/);
  });

  it('잠금 연결은 동시 상한 안에서만 쥐고, 상한에 걸리면 연결 없이 기다린다(풀 고갈 방지 · Codex 2R high · 3R high)', () => {
    const wrapper = src.slice(wrapStart, attemptStart);
    expect(wrapper.indexOf('await acquireDispatchSlot()')).toBeGreaterThan(0);
    expect(wrapper.indexOf('await acquireDispatchSlot()')).toBeLessThan(wrapper.indexOf('pool.connect()'));
    // 기다린 뒤 소유권을 다시 확인한다
    expect(wrapper.indexOf('stillOwned')).toBeGreaterThan(wrapper.indexOf('await acquireDispatchSlot()'));
    expect(wrapper).toMatch(/finally \{\s*if \(slotHeld\) releaseDispatchSlot\(\);\s*inFlightAttempts\.delete\(stagingId\);/);
    // 상한에 걸려 approved 로 되돌리고 넘기는 옛 분기가 없다
    expect(src).not.toContain("'DISPATCH_CONCURRENCY'");
  });

  it('잠금 연결에 오류 수신자를 달고 반납 전에 뗀다(끊김이 프로세스를 내리지 않게 · 적대검토 2R)', () => {
    const wrapper = src.slice(wrapStart, attemptStart);
    expect(wrapper).toMatch(/lockClient\.on\('error', onLockClientError\)/);
    expect(wrapper.indexOf("removeListener('error', onLockClientError)")).toBeLessThan(wrapper.indexOf('lockClient.release('));
    expect(wrapper.indexOf('inFlightAttempts.has(stagingId)')).toBeLessThan(wrapper.indexOf('pool.connect()'));
  });

  it('캠페인을 만드는 자리에서 예약 시각이 지났는지 DB 시각으로 보고, 지났으면 만들지 않고 만료 단계로 넘긴다(등재분 ⑦ · Codex 1R high 2건)', () => {
    const attempt = src.slice(attemptStart, attemptEnd);
    const priorAt = attempt.indexOf('inspectAttemptCampaign(row.company_id, stagingId)');
    const checkAt = attempt.indexOf('requested_at <= NOW() AS passed');
    const createAt = attempt.indexOf('createDirectSendCampaign(');
    expect(priorAt).toBeGreaterThan(0);
    // 기존 시도 캠페인 확인 **뒤**(앞이면 살아 있는 예약을 못 찾고 회수한다 · Codex 1R high 2)
    expect(checkAt).toBeGreaterThan(priorAt);
    // 오래 걸리는 적재·정제 집계 **뒤**, 캠페인 생성 **앞**
    expect(checkAt).toBeGreaterThan(attempt.indexOf('countStagingFiltered('));
    expect(checkAt).toBeLessThan(createAt);
    const branch = attempt.slice(checkAt, createAt);
    // 판정 조회는 소유권을 함께 본다(워크플로 2R). lock 복구·수정·재예약으로 잃었으면 옛 시도 키로 캠페인을 만들지 않는다
    //   (수정·재예약은 dispatch_key를 비워 대조가 그 캠페인을 못 찾는다 = 두 벌 발송)
    //   인자 순서까지 잠근다(뒤바뀌면 행을 못 찾아 모든 발송이 조용히 멈춘다 · 워크플로 3R low)
    expect(attempt).toMatch(/SELECT requested_at <= NOW\(\) AS passed FROM agency_send_requests WHERE id = \$1::uuid AND lock_token = \$2::uuid`,\s*\[row\.id, token\],/);
    // 소유권을 잃은 분기는 staging만 지우고 돌아간다. 상태·이력·캠페인을 건드리지 않는다
    const lostStart = branch.indexOf('if (due.rows.length === 0) {');
    expect(lostStart).toBeGreaterThanOrEqual(0);
    const lost = branch.slice(lostStart, branch.indexOf('return;', lostStart) + 'return;'.length);
    expect(lost).toContain('DELETE FROM campaign_send_staging');
    expect(lost).not.toMatch(/setStatus\(|logEvent\(|notifyFailed\(|createDirectSendCampaign\(/);
    // 상태가 실제로 바뀐 때만 기록한다(소유권을 잃었으면 이력에 거짓 줄을 남기지 않는다 · 워크플로 1R low)
    expect(branch).toMatch(/if \(await setStatus\(row\.id, 'approved', \{ \.\.\.RELEASE \}, token\)\) \{\s*await logEvent\(row\.id, 'dispatch_deadline_passed'/);
    expect(branch).toMatch(/\breturn;/);
    // 기다린 건만 보던 1차 분기는 없다 — 늦어진 길(대기·긴 적재·오래된 후보 목록)과 무관하게 한 자리에서 본다(Codex 1R high 1)
    const wrapper = src.slice(wrapStart, attemptStart);
    expect(wrapper).not.toContain('dispatch_deadline_passed');
    expect(src).toMatch(/async function acquireDispatchSlot\(\): Promise<void>/);
  });

  it('lock 복구는 시도 키 잠금이 비어 있을 때만 되돌린다 — 살아 있는 시도의 소유권 확인과 캠페인 생성 사이에 끼어들지 않는다(Codex 3R medium · 워크플로 3R medium 2건)', () => {
    const recStart = src.indexOf('async function runLockRecovery(');
    const recEnd = src.indexOf('// ────────────── 진입');
    expect(recStart).toBeGreaterThan(0);
    expect(recEnd).toBeGreaterThan(recStart);
    const rec = src.slice(recStart, recEnd);
    // 같은 프로세스에서 이 시도 키가 아직 돌고 있으면 **캠페인 조회·상태 변경 전에** 건너뛴다(Codex 4R medium · 워크플로 4R).
    //   잠금 연결만 끊기면 세션 잠금은 풀리지만 본문은 계속 돈다 → 잠금 조건만으로는 살아 있는 시도를 못 알아본다
    //   ★5R: 바뀔 수 있는 dispatch_key 스냅샷이 아니라 **접수 id**로 본다
    //   (조회 때 키가 비어 있던 건이 복구가 앞 행을 처리하는 사이 시도를 시작해도 잡힌다 · Codex 5R medium)
    //   ★(3) 진행 중이면 건너뛰되, 예약 시각이 30분 넘게 지난 final_testing(멈춘 시도)만 인수 트랜잭션으로 넘긴다
    expect(rec).toMatch(/const inFlight = isRequestInFlight\(String\(row\.id\)\);/);
    expect(rec).toMatch(/if \(inFlight && !stuck\) continue;/);
    expect(rec.indexOf('isRequestInFlight(')).toBeLessThan(rec.indexOf('inspectAttemptCampaign('));
    expect(rec).not.toContain('inFlightAttempts.has(');
    // 시도는 시작할 때 접수 id를 올리고 끝날 때 내린다(한 접수에 시도가 겹칠 수 있어 개수로 센다)
    const wrap = src.slice(wrapStart, attemptStart);
    expect(wrap).toMatch(/inFlightAttempts\.add\(stagingId\);\s*markRequestInFlight\(String\(row\.id\)\);/);
    expect(wrap).toMatch(/inFlightAttempts\.delete\(stagingId\);\s*unmarkRequestInFlight\(String\(row\.id\)\);/);
    expect(src).toMatch(/const inFlightRequests = new Map<string, number>\(\);/);
    // 복구의 상태 변경 두 곳(캠페인 있음 · 없음) 모두 "시도 키 잠금이 비었을 때만"을 켠다
    //   (캠페인 있음 쪽도: 과금 중 preparing 을 멈춘 것으로 보고 만료시키면 대조가 살아난 캠페인을 회수한다 · 워크플로 3R)
    expect(rec).toContain('setStatus(row.id, to, extra, row.lock_token, { onlyIfAttemptIdle: true })');
    expect(rec).toContain('setStatus(row.id, back, { ...RELEASE }, row.lock_token, { onlyIfAttemptIdle: true })');
    expect(rec).not.toMatch(/setStatus\([^)]*row\.lock_token\)\)/);
    // setStatus 는 그 옵션일 때 **같은 UPDATE 한 문장 안에서** 행의 현재 시도 키로 트랜잭션 잠금을 시도한다
    const ss = src.slice(src.indexOf('async function setStatus('), src.indexOf('export async function notifyManager('));
    expect(ss.length).toBeGreaterThan(0);
    //   조건 문장은 복구와 수정·재예약 라우트가 **같은 조립 함수 하나**를 쓴다(대행 ⓔ · 따로 적으면 글자가 갈린다)
    expect(ss).toContain('idleSql = attemptIdleSql(i + 1);');
    expect(ss).toContain('params.push(ATTEMPT_LOCK_PREFIX)');
    const idleFn = src.slice(src.indexOf('export function attemptIdleSql('), src.indexOf('export function attemptIdleSql(') + 600);
    expect(idleFn).toMatch(/AND \(dispatch_key IS NULL OR pg_try_advisory_xact_lock\(hashtext\(\$\$\{prefixParam\}::text \|\| dispatch_key::text\)\)\)/);
    // 상태를 바꾸기 **직전**에 같은 프로세스의 진행 중 접수도 다시 본다 — 두 생존 신호(진행 중 접수 · DB 잠금)를 한 자리에서
    //   (복구가 캠페인을 조회하는 사이 이미 소유권을 쥔 워커가 시도를 시작한 경우 · 워크플로 5R low)
    expect(ss).toMatch(/if \(opts\.onlyIfAttemptIdle && isRequestInFlight\(requestId\)\) return false;/);
    expect(ss.indexOf('isRequestInFlight(requestId)')).toBeLessThan(ss.indexOf('UPDATE agency_send_requests SET'));
    // 확인과 UPDATE 사이에 다른 대기를 끼우지 않는다(끼우면 그 사이 시작된 시도를 못 보는 창이 넓어진다 · 워크플로 6R low)
    const checkIdx = ss.indexOf('isRequestInFlight(requestId)');
    const between = ss.slice(checkIdx, ss.indexOf('const r = await query(', checkIdx));
    expect(between.length).toBeGreaterThan(0);
    expect(between).not.toMatch(/\bawait\b/);
    // 수를 센다: 먼저 끝난 시도가 항목을 통째로 지우면 아직 도는 시도를 쉬는 건으로 본다(워크플로 6R low)
    const helpers = src.slice(src.indexOf('function markRequestInFlight('), src.indexOf('function isRequestInFlight('));
    expect(helpers).toMatch(/inFlightRequests\.set\(requestId, \(inFlightRequests\.get\(requestId\) \|\| 0\) \+ 1\)/);
    expect(helpers).toMatch(/if \(n > 0\) inFlightRequests\.set\(requestId, n\);\s*else inFlightRequests\.delete\(requestId\);/);
    // 시도 쪽과 같은 접두어 상수 하나를 쓴다(글자가 갈리면 서로 다른 잠금이 되어 아무것도 막지 못한다)
    expect(src).toMatch(/const ATTEMPT_LOCK_PREFIX = 'agency-dispatch:';/);
    const wrapper = src.slice(wrapStart, attemptStart);
    expect(wrapper).toMatch(/const lockKey = `\$\{ATTEMPT_LOCK_PREFIX\}\$\{stagingId\}`;/);
    expect(src).not.toContain('`agency-dispatch:${');
  });

  it('새 이벤트는 진행 기록 문장표에 등재한다(미등재 kind는 고객 화면 문장이 뭉개진다)', () => {
    const log = fs.readFileSync(path.join(__dirname, '../../../../frontend/src/components/agency/AgencyEventLog.tsx'), 'utf8');
    expect(log).toMatch(/dispatch_deadline_passed: '/);
  });

  it('staging 쓰기·캠페인 생성·시도 캠페인 조회는 시도 본문 안에만 있다', () => {
    const attempt = src.slice(attemptStart, attemptEnd);
    const wrapper = src.slice(wrapStart, attemptStart);
    for (const needle of ['INSERT INTO campaign_send_staging', 'createDirectSendCampaign(', 'inspectAttemptCampaign(row.company_id, stagingId)']) {
      expect(attempt).toContain(needle);
      expect(wrapper).not.toContain(needle);
    }
  });
});

/**
 * ★2026-09-13(3) 대행 ⓔ 두 벌 발송: 문안 수정·시각 변경이 "이미 발송 준비됨"을 `campaign_id` 캐시로만 막고 `dispatch_key`를 비웠다.
 *   이 축의 진실은 시도 키다. 캠페인은 있는데 캐시가 아직 빈 틈(원장 기록 실패 → 대조 전)에 고치면, 대조가 옛 캠페인을
 *   못 찾고 새 시도가 한 벌 더 만든다. 그래서 두 라우트는 ①시도 키로 캠페인을 직접 찾고 ②같은 프로세스의 진행 중 시도를 보고
 *   ③UPDATE 한 문장 안에서 시도 키 잠금을 시도한다(lock 복구와 같은 두 신호 · 같은 조립 함수).
 */
describe('문안 수정·시각 변경은 시도 키 캠페인·진행 중 시도를 확인하고 시도 잠금과 직렬화한다(대행 ⓔ)', { timeout: 30_000 }, () => {
  const route = fs.readFileSync(path.join(__dirname, '../../routes/agency-send.ts'), 'utf8');
  const segOf = (marker: string) => {
    const s = route.indexOf(marker);
    return route.slice(s, route.indexOf('router.', s + marker.length));
  };

  for (const [name, marker] of [['문안 수정', "router.post('/:id/content'"], ['시각 변경', "router.post('/:id/reschedule'"]] as const) {
    it(`${name}: 시도 키를 읽고, UPDATE 바로 앞에서 차단 판정을 하고, UPDATE에 시도 잠금 조건을 건다`, () => {
      const seg = segOf(marker);
      expect(seg.length).toBeGreaterThan(0);
      expect(seg).toMatch(/SELECT [^`]*dispatch_key[^`]*FROM agency_send_requests/);
      const call = 'await attemptBlocksChange(auth.companyId, req.params.id, r.rows[0].dispatch_key)';
      const callAt = seg.indexOf(call);
      const updAt = seg.indexOf('const updated = await query(');
      expect(callAt).toBeGreaterThan(0);
      expect(callAt).toBeLessThan(updAt);
      // 판정과 UPDATE 사이에 다른 대기를 끼우지 않는다(끼우면 그 사이 생긴 캠페인·시도를 못 본다)
      expect((seg.slice(callAt, updAt).match(/\bawait\b/g) || []).length).toBe(1);
      const upd = seg.slice(updAt, seg.indexOf('if (updated.rows.length === 0)', updAt));
      expect(upd).toContain('${attemptIdleSql(');
      expect(upd).toContain('ATTEMPT_LOCK_PREFIX');
    });
  }

  it('차단 판정: 시도 키 캠페인이 있으면(나갔든 멈췄든) 막고, 키가 없거나 캠페인이 없으면 통과한다', async () => {
    vi.resetModules();
    let rows: any[] = [];
    vi.doMock('../../config/database', () => ({
      query: async () => ({ rows }),
      mysqlQuery: async () => [],
      pool: { connect: async () => { throw new Error('테스트: 연결 없음'); } },
      default: { connect: async () => { throw new Error('테스트: 연결 없음'); } },
    }));
    const w = await import('../agency-send-worker');
    //   ★(3) 막는 이유를 돌려준다: 'campaign'(새로 접수 안내) · 'in_flight'(처리 중 · 잠시 후 다시) · null(통과)
    rows = [];
    expect(await w.attemptBlocksChange('00000000-0000-0000-0000-000000000001', 'req-a', null)).toBeNull();
    expect(await w.attemptBlocksChange('00000000-0000-0000-0000-000000000001', 'req-a', 'key-a')).toBeNull();
    rows = [{ id: 'camp-1', status: 'cancelled', send_phase: 'failed' }];
    expect(await w.attemptBlocksChange('00000000-0000-0000-0000-000000000001', 'req-a', 'key-a')).toBe('campaign');
    rows = [{ id: 'camp-2', status: 'scheduled', send_phase: 'queued' }];
    expect(await w.attemptBlocksChange('00000000-0000-0000-0000-000000000001', 'req-a', 'key-a')).toBe('campaign');
    vi.doUnmock('../../config/database');
  });

  it('차단 판정은 진행 중 시도를 캠페인 조회 **뒤**에 본다(조회 대기 사이에 생긴 시도까지 · UPDATE 직전 동기 확인)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../agency-send-worker.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function attemptBlocksChange('), src.indexOf('export async function attemptBlocksChange(') + 1200);
    expect(fn.indexOf('await inspectAttemptCampaign(')).toBeGreaterThan(0);
    expect(fn.indexOf('return isRequestInFlight(String(requestId))')).toBeGreaterThan(fn.indexOf('await inspectAttemptCampaign('));
  });
});

describe('접수 적재: 수신자 값은 저장형(문자열)으로 넣는다(적대검토 등재분 ⑤)', () => {
  it('createRequestCore 가 vars 를 toStoredVars 로 바꾼 뒤 INSERT 한다', () => {
    const intake = fs.readFileSync(path.join(__dirname, '../agency-send-intake.ts'), 'utf8');
    const seg = intake.slice(intake.indexOf('// ── 수신자'), intake.indexOf('INSERT INTO agency_send_recipients'));
    expect(seg.length).toBeGreaterThan(0);
    expect(seg).toMatch(/vars: toStoredVars\(raw\?\.vars\)/);
  });
});

describe('화면 접수: 고객별 회신번호도 접수 때 등록을 확인한다(적대검토 2R)', () => {
  it('등록되지 않은 고객별 번호가 섞이면 DB에 닿기 전에 반려한다', async () => {
    vi.resetModules();
    const { createRequestCore } = await import('../agency-send-intake');
    const r = await createRequestCore(
      { companyId: '00000000-0000-0000-0000-000000000001', userId: '00000000-0000-0000-0000-000000000002' },
      {
        messageType: 'SMS', content: '고객별 회신번호 등록 확인 테스트', callbackNumber: '0500000000',
        managerPhones: ['01000001111'], requestedAt: new Date(Date.now() + 200 * 60000).toISOString(),
        recipients: [
          { phone: '01000002222', vars: {}, callback: '0500000000' },
          { phone: '01000003333', vars: {}, callback: '0500000009' },
        ],
      },
      undefined,
      { registeredSet: new Set(['0500000000']), window: { startHour: 0, endHour: 24 } as { startHour: number | null; endHour: number | null } },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('0500000009');
  });
});
