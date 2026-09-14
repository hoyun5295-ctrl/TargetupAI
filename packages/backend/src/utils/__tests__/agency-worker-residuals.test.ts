/**
 * ★2026-09-13(3) 대행발송 남은 항목 계약 — "남은 것이 남지 않게"
 *
 *  ⓕ 상태 변경이 실패했는데 상태 문장(이벤트·안내)을 남기던 자리
 *  · 행·단계 격리(한 행·한 단계 예외가 같은 tick의 나머지를 통째로 건너뛰던 것)
 *  · B-0825-7 tick 단계 겹침
 *  · 멈춘 시도(끝나지 않는 대기) → 복구·만료 안내가 영영 없던 것 · 담당자 안내 대기 상한 · 멈춘 슬롯
 *  · 복구 확인과 상태 변경 사이 틈(복구 표시)
 *  · 예약 도중 예외 뒤 살아 있는 캠페인을 approved로 되돌려 만료·회수되던 것
 *  · 대조 중화 회차 기록 폭주·30일 창 고착 · 멈춘 캠페인을 "이미 발송"으로 되돌리던 것 · 이미 취소된 캠페인에서 취소가 갇히던 것
 *  · 수정·재예약 라우트의 진행 중 안내·UPDATE 조건
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// 줄바꿈을 LF로 맞춘다(작업 트리가 CRLF여도 '\n}\n' 경계가 같은 뜻이 되게)
const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf8').replace(/\r\n/g, '\n');
const src = read('../agency-send-worker.ts');
const route = read('../../routes/agency-send.ts');
const cancelCt = read('../agency-send-cancel.ts');
const campaignCt = read('../agency-send-campaign.ts');
const eventLog = read('../../../../frontend/src/components/agency/AgencyEventLog.tsx');
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + 1);
  expect(i, a).toBeGreaterThanOrEqual(0);
  expect(j, b).toBeGreaterThan(i);
  return s.slice(i, j);
};

describe('상태 변경 결과를 본 뒤에만 상태 문장을 남긴다(ⓕ)', () => {
  it('결과를 버리는 setStatus 문장이 없다', () => {
    expect(src).not.toMatch(/^\s*await setStatus\(/m);
    expect(src).not.toMatch(/setStatus\([^;]*\)\.catch\(\(\) => \{\}\)/);
  });

  it('ATTEMPT_BUSY 두 곳은 상태가 바뀐 때만 다시 시도한다고 적는다', () => {
    const hits = src.match(/if \(await setStatus\(row\.id, 'approved', \{ \.\.\.RELEASE \}, token\)\) \{\s*await logEvent\(row\.id, 'dispatch_retry', \{ code: 'ATTEMPT_BUSY' \}\);/g) || [];
    expect(hits).toHaveLength(2);
  });

  it('예약 완료·이미 예약됨·복구·재시도 기록은 상태가 바뀐 때만', () => {
    expect(src).toMatch(/if \(await setStatus\(row\.id, 'queued', \{ \.\.\.RELEASE, campaign_id: campaignId, queued_at: new Date\(\) \}, token\)\) \{\s*await logEvent\(row\.id, 'queued'/);
    expect(src).toMatch(/if \(await setStatus\(row\.id, 'queued', \{ \.\.\.RELEASE, campaign_id: prior\.id, queued_at: new Date\(\) \}, token\)\) \{\s*await logEvent\(row\.id, 'queued_already'/);
    expect(src).toMatch(/if \(await setStatus\(row\.id, 'queued', \{ \.\.\.RELEASE, campaign_id: made\.id, queued_at: new Date\(\) \}, token\)\) \{\s*await logEvent\(row\.id, 'dispatch_recovered'/);
    expect(src).toMatch(/if \(await setStatus\(row\.id, 'approved', \{ \.\.\.RELEASE \}, token\)\) \{\s*await logEvent\(row\.id, 'dispatch_retry', \{ code, message/);
  });

  it('만료·문안 확인 분기 다섯 곳은 상태가 바뀌지 않았으면 안내하지 않는다', () => {
    for (const kind of ['dispatch_no_owner', 'dispatch_var_overflow', 'dispatch_no_recipient', 'dispatch_callback_unregistered', 'dispatch_zero_after_filter']) {
      const at = src.indexOf(`notifyFailed('${kind}'`);
      expect(at, kind).toBeGreaterThan(0);
      const before = src.slice(src.lastIndexOf('setStatus(', at) - 30, at);
      expect(before, kind).toMatch(/if \(!await setStatus\(/);
    }
  });

  it('캠페인이 더 나가지 않음이 조회로 확정된 두 분기는 상태 변경 결과와 무관하게 알린다', () => {
    for (const kind of ['dispatch_incomplete', 'dispatch_rejected']) {
      const at = src.indexOf(`notifyFailed('${kind}'`);
      const seg = src.slice(src.lastIndexOf('const closed = await setStatus(', at), at);
      expect(seg.length, kind).toBeGreaterThan(0);
      expect(seg).not.toMatch(/if \(!?closed\)\s*return/);
    }
  });

  it('1차 검사 실패 되돌림은 성공했을 때만 오류 기록을 남긴다', () => {
    expect(src).toMatch(/const reverted = await setStatus\(row\.id, 'received', \{ \.\.\.RELEASE \}, token\)\.catch\(\(\) => false\);\s*if \(reverted\) await logEvent\(row\.id, 'first_test_error'/);
  });
});

describe('예약 도중 예외 뒤 되돌리기: 살아 있는 예약을 approved로 돌리지 않는다', () => {
  it('되돌리기 CT는 이 시도 키로 캠페인을 찾아 살아 있으면 queued로 맞춘다', () => {
    const fn = between(src, 'async function revertAfterDispatchError(', '\n}\n');
    expect(fn).toMatch(/SELECT dispatch_key FROM agency_send_requests WHERE id = \$1::uuid AND lock_token = \$2::uuid/);
    // 반환 타입에도 'approved'가 있어 되돌리는 호출 자체와 비교한다
    expect(fn.indexOf('inspectAttemptCampaign(')).toBeGreaterThan(0);
    expect(fn.indexOf('inspectAttemptCampaign(')).toBeLessThan(fn.indexOf("setStatus(requestId, 'approved'"));
    expect(fn).toMatch(/found\.kind === 'live'[\s\S]*'queued'/);
  });

  it('당일 재검사의 두 catch가 이 CT를 쓴다', () => {
    const body = between(src, 'async function runFinalTest(', 'async function dispatchToPipeline(');
    expect((body.match(/await revertAfterDispatchError\(/g) || []).length).toBe(2);
    expect(body).not.toMatch(/setStatus\([^)]*'approved'[^)]*\)\.catch/);
  });
});

describe('행·단계 격리', () => {
  it('lock 복구·만료·당일 재검사 루프는 행마다 try로 격리하고 catch에서 상태를 되돌리지 않는다', () => {
    for (const [a, b] of [
      ['async function runLockRecovery(', '// ────────────── 진입'],
      ['async function runExpire(', '// ────────────── D. 대조'],
      ['async function runFinalTest(', 'async function dispatchToPipeline('],
    ] as const) {
      const body = between(src, a, b);
      expect(body, a).toMatch(/for \(const row of [\w.]+\) \{\s*(?:\/\/[^\n]*\n\s*)*try \{/);
    }
    const rec = between(src, 'async function runLockRecovery(', '// ────────────── 진입');
    const lastCatch = rec.slice(rec.lastIndexOf('} catch'));
    expect(lastCatch).not.toMatch(/setStatus\(|UPDATE agency_send_requests/);
  });

  it('일곱 단계가 순서대로 단계 가드를 지나고, 한 단계 예외는 다음 단계를 막지 않는다(마이그레이션 전만 tick을 끝낸다)', () => {
    const entry = between(src, 'export async function runAgencySendWorker(', 'export function triggerAgencySendDispatch(');
    let last = -1;
    for (const name of ['cancelSweep', 'markDelivered', 'lockRecovery', 'firstTest', 'finalTest', 'expire', 'reconcile']) {
      const at = entry.indexOf(`['${name}',`);
      expect(at, name).toBeGreaterThan(last);
      last = at;
    }
    expect(entry).toMatch(/await tickStages\.run\(name, run\)/);
    expect(entry).toMatch(/isMissingSchemaError\(err\)/);
    expect(src.indexOf('const tickStages = createStageGuard(')).toBeGreaterThan(src.indexOf('// ────────────── 진입'));
  });

  it('즉시 진입점(승인·접수 직후)은 단계 가드를 보지 않는다', () => {
    const triggers = between(src, 'export function triggerAgencySendDispatch(', 'export function startAgencySendWorker(');
    expect(triggers).toContain('runFinalTest(requestId)');
    expect(triggers).toContain('runFirstTest(requestId)');
    expect(triggers).not.toContain('tickStages');
  });
});

describe('멈춘 시도·안내 대기·멈춘 슬롯', () => {
  it('복구는 예약 시각이 30분 넘게 지난 진행 중 final_testing만 인수 트랜잭션으로 넘기고, 나머지 복구는 시도 잠금이 빈 때만 바꾼다', () => {
    const rec = between(src, 'async function runLockRecovery(', '// ────────────── 진입');
    expect(rec).toMatch(/SELECT [^`]*requested_at[^`]*FROM agency_send_requests/);
    expect(rec).toMatch(/const inFlight = isRequestInFlight\(String\(row\.id\)\);/);
    expect(rec).toMatch(/const stuck = inFlight && row\.status === 'final_testing' && isAttemptStuck\(/);
    expect(rec).toMatch(/if \(inFlight && !stuck\) continue;/);
    expect(rec).toMatch(/if \(stuck\) \{\s*const taken = await takeOverStuckAttempt\(row\);\s*if \(!taken\) continue;/);
    expect(rec.indexOf('takeOverStuckAttempt(row)')).toBeLessThan(rec.indexOf('inspectAttemptCampaign('));
    expect((rec.match(/row\.lock_token, \{ onlyIfAttemptIdle: true \}\)/g) || []).length).toBe(2);
    expect(src).not.toMatch(/stuckAttempt|purgeStuckAttemptStaging/);
  });

  it('담당자 안내와 테스트 문자는 대기 상한을 지난다', () => {
    const notify = between(src, 'export async function notifyManager(', 'const managerPhonesOf');
    expect(notify).toMatch(/withNotifyTimeout\(/);
    expect(notify).toMatch(/'timeout'/);
    const test = between(src, 'async function sendManagerTest(', '// ★2026-08-28 buildSample');
    expect(test).toMatch(/withNotifyTimeout\(insertTestSmsQueue\(/);
  });

  it('슬롯은 시도와 잠금 연결이 끝난 뒤에만 반납한다(시간으로 먼저 반납하지 않는다 · Codex 적대 1R high)', () => {
    const wrap = between(src, 'async function dispatchToPipeline(', '/** 이 프로세스에서 지금 돌고 있는 시도 키');
    expect(wrap).not.toMatch(/slotWatch|setTimeout/);
    expect(src).not.toMatch(/SLOT_HOLD_STUCK_MINUTES/);
    expect(wrap).toMatch(/if \(slotHeld\) releaseDispatchSlot\(\);/);
    expect(between(src, 'async function acquireDispatchSlot(', 'function releaseDispatchSlot(')).not.toMatch(/setTimeout/);
  });
});

describe('복구 확인과 상태 변경 사이 틈(복구 표시)', () => {
  it('복구는 바꾸는 동안 표시를 쥐고(동기로 켜고 finally에서 끈다), 시도는 표시가 풀릴 때까지 기다린 뒤 진행 중 표시를 켠다', () => {
    const ss = between(src, 'async function setStatus(', 'export async function notifyManager(');
    expect(ss).toMatch(/if \(recoveringRequests\.has\(requestId\)\) return false;\s*endRecovery = beginRecovery\(requestId\);/);
    expect(ss.indexOf('beginRecovery(requestId)')).toBeLessThan(ss.indexOf('const r = await query('));
    expect(ss).toMatch(/finally \{\s*endRecovery\?\.\(\);/);
    const wrap = between(src, 'async function dispatchToPipeline(', '/** 이 프로세스에서 지금 돌고 있는 시도 키');
    const w = wrap.indexOf('while (recoveringRequests.has(String(row.id)))');
    expect(w).toBeGreaterThan(wrap.indexOf('RETURNING dispatch_key'));
    expect(w).toBeLessThan(wrap.indexOf('inFlightAttempts.has(stagingId)'));
  });
});

// 모듈을 테스트 안에서 처음 불러온다. 전체 스위트 부하(pre-push)에서 첫 import가 5초를 넘길 수 있어 상한을 넉넉히 둔다
describe('대조·취소 마무리·취소 CT', { timeout: 30_000 }, () => {
  it('중화 회차는 막은 것이 있거나 실패한 때만 기록하고, 캐시는 비어 있을 때만 채운다(30일 창 고착 방지)', () => {
    const rec = between(src, 'async function runReconcile(', '// ────────────── F. 취소 마무리');
    expect(rec).toMatch(/if \(!ok \|\| !alreadySent \|\| !row\.campaign_id\) \{\s*await logEvent\(row\.id, ok \? 'reconciled_neutralize' : 'reconciled_neutralize_failed'/);
    const one = between(rec, 'if (mustNotSend && found.kind === \'live\')', '// ② ');
    expect(one).toMatch(/WHERE id = \$1::uuid AND campaign_id IS NULL/);
    expect(one).not.toMatch(/COALESCE\(campaign_id/);
  });

  it('활성화 전(preparing) 캠페인만 "이미 발송"에서 뺀다 · 일부 발송됐을 수 있는 failed는 뺀지 않는다(취소 마무리·취소 CT · Codex 적대 1R medium)', async () => {
    expect(src).toMatch(/if \(ok && alreadySent && campaignMayHaveSent\(found\)\)/);
    expect(cancelCt).toMatch(/result\.success && result\.alreadySent && campaignMayHaveSent\(attempt\)/);
    const { campaignMayHaveSent } = await import('../agency-send-campaign');
    expect(campaignMayHaveSent({ id: 'c', phase: 'preparing' })).toBe(false);
    expect(campaignMayHaveSent({ id: 'c', phase: 'failed' })).toBe(true);
    expect(campaignMayHaveSent({ id: 'c', phase: 'queued' })).toBe(true);
    expect(campaignMayHaveSent({ id: null, phase: null })).toBe(false);
  });

  it('이미 취소된 캠페인은 막을 것이 없는 성공으로 본다(취소가 갇히지 않게)', () => {
    expect(campaignCt).toMatch(/status === 'cancelled'\) return \{ ok: true, error: '', alreadySent: false \}/);
    expect(cancelCt).toMatch(/attempt\.status === 'cancelled'/);
    expect(campaignCt).toMatch(/status: string \| null/);
  });

  it('이미 발송 되돌림은 UPDATE가 된 경우에만 기록하고, 취소 CT 되돌림은 캐시를 채운다', () => {
    const seg = between(src, 'if (ok && alreadySent && campaignMayHaveSent(found))', "'cancel_already_sent'");
    expect(seg).toMatch(/RETURNING id/);
    expect(cancelCt).toMatch(/campaign_id = COALESCE\(campaign_id, \$5::uuid\)/);
  });
});

describe('수정·재예약 라우트', () => {
  it('진행 중 시도는 400 "새로 접수"가 아니라 409 처리 중 안내다', () => {
    expect(route).toMatch(/campaignId === 'in_flight'/);
    expect(route).toMatch(/ATTEMPT_IN_PROGRESS/);
    const fn = between(src, 'export async function attemptBlocksChange(', '\n}\n');
    expect(fn).toMatch(/return 'campaign'/);
    expect(fn).toMatch(/\? 'in_flight' : null/);
  });

  for (const marker of ["router.post('/:id/content'", "router.post('/:id/reschedule'"]) {
    it(`${marker}: 캐시가 채워졌거나 시도 키 캠페인이 이미 커밋됐으면 0행이고, 잠금 조각 번호 = params 길이`, () => {
      const s = route.indexOf(marker);
      const seg = route.slice(s, route.indexOf('router.', s + marker.length));
      const upd = seg.slice(seg.indexOf('const updated = await query('), seg.indexOf('if (updated.rows.length === 0)'));
      expect(upd).toMatch(/AND campaign_id IS NULL/);
      expect(upd).toMatch(/AND NOT EXISTS \(SELECT 1 FROM campaigns c WHERE c\.staging_id = agency_send_requests\.dispatch_key AND c\.company_id = agency_send_requests\.company_id\)/);
      const n = Number(upd.match(/attemptIdleSql\((\d+)\)/)?.[1]);
      const arr = upd.slice(upd.lastIndexOf('['), upd.lastIndexOf(']') + 1);
      const items = arr.slice(1, -1).split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);
      expect(n).toBe(items.length);
      expect(items[items.length - 1]).toBe('ATTEMPT_LOCK_PREFIX');
    });
  }
});

describe('진행 기록 문장표', () => {
  it('새로 쓰거나 이미 쓰던 kind가 모두 등재돼 있다', () => {
    for (const kind of ['dispatch_stuck_recovered', 'reconciled_neutralize_failed', 'cancel_already_sent']) {
      expect(eventLog, kind).toMatch(new RegExp(`${kind}: '`));
    }
  });
});

// 워커 모듈을 매번 새로 불러온다(resetModules). 전체 스위트 부하에서 첫 import가 5초를 넘길 수 있어 상한을 넉넉히 둔다
describe('행위: 격리·안내 상한(DB는 흉내)', { timeout: 30_000 }, () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../../config/database');
    vi.doUnmock('../sms-queue');
  });

  it('한 단계 첫 조회가 던져도 같은 tick의 만료·대조는 돈다', async () => {
    vi.resetModules();
    const seen: string[] = [];
    vi.doMock('../../config/database', () => ({
      query: async (sql: string) => {
        if (/status IN \('testing','final_testing'\)/.test(sql)) { seen.push('lock-recovery'); throw new Error('테스트: 일시 오류'); }
        if (/status IN \('awaiting_approval','reapproval','approved'\)/.test(sql)) seen.push('expire');
        if (/WHERE dispatch_key IS NOT NULL/.test(sql)) seen.push('reconcile');
        return { rows: [], rowCount: 0 };
      },
      mysqlQuery: async () => [],
      pool: { connect: async () => { throw new Error('연결 없음'); } },
      default: { connect: async () => { throw new Error('연결 없음'); } },
    }));
    const w = await import('../agency-send-worker');
    await w.runAgencySendWorker();
    expect(seen).toEqual(['lock-recovery', 'expire', 'reconcile']);
  });

  it('마이그레이션 전 오류는 tick을 조용히 끝낸다(종전 그대로)', async () => {
    vi.resetModules();
    let calls = 0;
    vi.doMock('../../config/database', () => ({
      query: async () => { calls += 1; throw Object.assign(new Error('relation "agency_send_requests" does not exist'), { code: '42P01' }); },
      mysqlQuery: async () => [],
      pool: { connect: async () => { throw new Error('x'); } },
      default: { connect: async () => { throw new Error('x'); } },
    }));
    const w = await import('../agency-send-worker');
    await w.runAgencySendWorker();
    expect(calls).toBe(1);
  });

  it('만료 단계에서 한 행의 UPDATE가 던져도 다음 행을 만료시킨다', async () => {
    vi.resetModules();
    const past = new Date(Date.now() - 60000).toISOString();
    const claimed: string[] = [];
    vi.doMock('../sms-queue', () => ({
      getAuthSmsTable: async () => 'T', bulkInsertSmsQueue: async (_t: any, rows: any[]) => rows.length,
      insertTestSmsQueue: async () => {}, toKoreaTimeStr: () => '',
    }));
    vi.doMock('../../config/database', () => ({
      query: async (sql: string, p?: any[]) => {
        if (/status IN \('awaiting_approval','reapproval','approved'\)/.test(sql)) {
          return { rows: [
            { id: 'r1', status: 'awaiting_approval', revision: 1, requested_at: past, final_test_at: null, manager_phones: [] },
            { id: 'r2', status: 'awaiting_approval', revision: 1, requested_at: past, final_test_at: null, manager_phones: [] },
          ] };
        }
        if (/SET status = 'expired', expired_at = NOW\(\)/.test(sql)) {
          if (p?.[0] === 'r1') throw new Error('테스트: 행 오류');
          claimed.push(p?.[0]);
          return { rows: [{ id: p?.[0] }] };
        }
        return { rows: [], rowCount: 0 };
      },
      mysqlQuery: async () => [],
      pool: { connect: async () => { throw new Error('x'); } },
      default: { connect: async () => { throw new Error('x'); } },
    }));
    const w = await import('../agency-send-worker');
    await w.runAgencySendWorker();
    expect(claimed).toEqual(['r2']);
  });

  it('담당자 안내 적재가 끝나지 않아도 상한 뒤 notify_failed(timeout)를 남기고 돌아온다', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const events: any[] = [];
    vi.doMock('../sms-queue', () => ({
      getAuthSmsTable: async () => 'T', bulkInsertSmsQueue: () => new Promise(() => {}),
      insertTestSmsQueue: async () => {}, toKoreaTimeStr: () => '',
    }));
    vi.doMock('../../config/database', () => ({
      query: async (sql: string, p: any[]) => {
        if (sql.includes('agency_send_events')) events.push(p);
        return { rows: [], rowCount: 0 };
      },
      mysqlQuery: async () => [],
      pool: { connect: async () => { throw new Error('x'); } },
      default: { connect: async () => { throw new Error('x'); } },
    }));
    const w = await import('../agency-send-worker');
    const p = w.notifyManager({
      companyId: '00000000-0000-0000-0000-000000000001', requestId: '00000000-0000-0000-0000-000000000002',
      phones: ['01000001111'], callback: '0500000000', text: 't', title: 't',
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(p).resolves.toBeUndefined();
    expect(events.some((e) => e[1] === 'notify_failed' && String(e[2]).includes('timeout'))).toBe(true);
  });
});
