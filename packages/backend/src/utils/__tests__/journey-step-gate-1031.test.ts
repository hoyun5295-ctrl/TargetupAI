/**
 * 여정 칸 관문 · 담당자 안내(★ 2026-10-31 · 설계서 docs/2026-10-31-journey-step-gate-notice-design.md §5 · 뿌리 R30)
 *
 * 손으로 정한 기대(독립 출처 = 설계서 문장):
 *   - 알림 기본값 = 첫 메시지 칸 · 마지막 메시지 칸(기다림 칸이 앞에 있어도) · 서버 · 화면 같은 답
 *   - 결과 안내 = 오늘은 예정분이 다 나가고 대기 0 · 지난 날은 08시 뒤 · 첫 안내 뒤 더 보낸 날만 하루 합계
 *   - 미룰 시각 = 지금 + 10분 · 21시를 넘으면 다음 날 08시
 *   - 날짜 기준 = 보낼 시각 2시간 전부터 같은 날에만 만든다
 *   - 안내 쓰기 = 시도 잡기 → 적재 → 기록(적재 실패 = 기록 0)
 *   - 상한 있는 MySQL = 넘기면 그 연결 destroy · 늦게 온 연결 destroy · 공용 풀을 쌓아 막지 않는다
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { isStepNotifyOn } from '../journey-step-notify';
import { isStepNotifyOn as isStepNotifyOnScreen } from '../../../../frontend/src/utils/journey-step-notify';
import { decideResultNotice, buildResultNoticeBody, type ResultNoticeFacts } from '../journey-result-notice';
import { buildPretestLmsBody, IMMEDIATE_STEP_NOTICE_LINE, PRETEST_LEAD_HOURS, pretestDoneSql } from '../journey-pretest-notifier';
import { isImmediateStep, groupPretestBundles } from '../journey-pretest-scan';
import { anchorDispatchDue } from '../journey-anchor-scheduler';
import { pretestHoldUntil, trackGateHold, clearGateHold, GATE_HOLD_ALERT_MINUTES } from '../journey-executor';
import { sendNoticeOnce } from '../journey-notice-once';
import { withBoundedMysql } from '../../config/database';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');
/** KST 벽시계 → Date */
const kst = (s: string) => new Date(`${s}+09:00`);

describe('알림 기본값 = 첫 · 마지막 메시지 칸(서버 · 화면 같은 함수)', () => {
  const cases: Array<[boolean | null, number, number | null, number | null, boolean]> = [
    [null, 2, 2, 3, true],   // 1 기다림 · 2 문자 · 3 문자 → 2 켬(옛 2시간 전 안내 = 끔)
    [null, 3, 2, 3, true],   // 3 켬(옛 결과 안내 · 화면 = 끔)
    [null, 1, 1, 1, true],   // 문자 칸 하나
    [null, 2, 1, 3, false],  // 1 · 2 · 3 문자 중간
    [true, 2, 1, 3, true],
    [false, 1, 1, 3, false],
    [null, 1, null, null, false],
  ];
  it.each(cases)('flag=%s step=%s first=%s last=%s → %s', (flag, o, f, l, want) => {
    expect(isStepNotifyOn(flag, o, f, l)).toBe(want);
    expect(isStepNotifyOnScreen(flag, o, f, l)).toBe(want);
  });
  it('스캔 묶음의 알림 = 같은 함수(옛 「모든 칸 수」 판정 0)', () => {
    const [b] = groupPretestBundles([{
      execution_id: 'e', journey_id: 'j', company_id: 'c', created_by: null, next_run_at: kst('2026-10-31T10:00:00'),
      step_id: 's', channel: 'lms', is_ad: true, subject: null, notify_manager_on_pretest: null, step_order: 2,
      first_message_order: 2, last_message_order: 3, start_kind: 'event', delay_mode: 'relative', delay_hours: 0,
    }]);
    expect(b.notifyManager).toBe(true);
    expect(b.immediate).toBe(true);
    expect(read('journey-pretest-scan.ts')).not.toContain('total_steps');
  });
});

describe('바로 보내는 칸 판정', () => {
  it('단발 아님 + relative 0시간 = 바로', () => {
    expect(isImmediateStep('event', 'relative', 0)).toBe(true);
    expect(isImmediateStep('standing', null, null)).toBe(true);
    expect(isImmediateStep('event', 'relative', 24)).toBe(false);
    expect(isImmediateStep('event', 'specific_hour', 0)).toBe(false);
    expect(isImmediateStep('date_anchor', 'relative', 0)).toBe(false);
    expect(isImmediateStep('one_shot', 'relative', 0)).toBe(false);
  });
});

describe('발송 전 안내 본문(§2-4)', () => {
  const at = kst('2026-10-31T10:10:00');
  it('제목 = [발송 전 안내] · 바로 칸이면 이어서 나간다는 줄', () => {
    const b = buildPretestLmsBody({ journeyName: '여정', stepOrder: 1, scheduledSendAt: at, messagePreview: '미리', pauseUrl: 'https://app.hanjul.ai/c/x', mode: 'pretest_pass', immediate: true });
    expect(b.startsWith('[발송 전 안내]')).toBe(true);
    expect(b).toContain(IMMEDIATE_STEP_NOTICE_LINE);
    expect(b).toContain('즉시 정지: https://app.hanjul.ai/c/x');
    expect(b).not.toContain('2시간');
  });
  it('늦은 칸 · 정지 안내 = 바로 칸 줄 없음', () => {
    expect(buildPretestLmsBody({ journeyName: '여정', stepOrder: 1, scheduledSendAt: at, messagePreview: '', pauseUrl: null, mode: 'pretest_pass', immediate: false })).not.toContain(IMMEDIATE_STEP_NOTICE_LINE);
    expect(buildPretestLmsBody({ journeyName: '여정', stepOrder: 1, scheduledSendAt: at, messagePreview: '', pauseUrl: null, mode: 'pretest_paused', immediate: true })).not.toContain(IMMEDIATE_STEP_NOTICE_LINE);
  });
  it('멈춤 사유 · 경보 문장에 「2시간 전」 0(바로 칸은 2시간 전이 아니다)', () => {
    expect(read('journey-pretest-notifier.ts')).not.toMatch(/'발송 2시간 전 스팸|`여정 발송 2시간 전|\[발송 2시간 전 안내\]/);
  });
});

describe('결과 안내 판정(§2-6)', () => {
  const base: ResultNoticeFacts = {
    notifyOn: true, sendDay: '2026-10-31', todayKst: '2026-10-31', kstHour: 14, sendStartHour: 8,
    noticed: false, sentCount: 18, noticedSent: 0, stillDue: false, countsKnown: true, pending: 0,
  };
  const cases: Array<[string, Partial<ResultNoticeFacts>, string]> = [
    ['오늘 · 진행 중 0 · 대기 0 = 첫 안내', {}, 'first'],
    ['오늘 · 진행 중 남음 = 기다림', { stillDue: true }, 'wait'],
    ['오늘 · 대기 남음 = 기다림', { pending: 2 }, 'wait'],
    ['오늘 · 셀 수 없음 = 기다림', { countsKnown: false }, 'wait'],
    ['어제 · 기록 없음 · 09시 = 첫 안내(대기 밝힘)', { sendDay: '2026-10-30', kstHour: 9, pending: 3, stillDue: true }, 'first'],
    ['어제 · 기록 없음 · 07시 = 기다림', { sendDay: '2026-10-30', kstHour: 7 }, 'wait'],
    ['어제 · 첫 안내 뒤 더 보냄 · 09시 = 하루 합계', { sendDay: '2026-10-30', kstHour: 9, noticed: true, noticedSent: 1, sentCount: 37 }, 'day_total'],
    ['하루 합계 07시 = 기다림', { sendDay: '2026-10-30', kstHour: 7, noticed: true, noticedSent: 1 }, 'wait'],
    ['오늘 · 첫 안내 뒤 더 보냄 = 하루가 닫힐 때까지 기다림', { noticed: true, noticedSent: 1 }, 'wait'],
    ['더 안 보냄 = 할 일 없음', { noticed: true, noticedSent: 18 }, 'wait'],
    ['알림 꺼짐 = 보내지 않고 기록만', { notifyOn: false }, 'record_only'],
    ['알림 꺼짐 · 어제 · 07시 = 기록만(날짜 판정보다 먼저 · Codex 구현 2R ②)', { notifyOn: false, sendDay: '2026-10-30', kstHour: 7 }, 'record_only'],
    ['알림 꺼짐 · 오늘 · 진행 중 남음 = 기록만', { notifyOn: false, stillDue: true }, 'record_only'],
  ];
  it.each(cases)('%s', (_n, over, want) => {
    expect(decideResultNotice({ ...base, ...over })).toBe(want);
  });
  it('본문 = 칸 · 날짜 · 보낸 수 · 성공/실패/대기 · 하루 합계 줄 · 마지막 칸', () => {
    const b = buildResultNoticeBody({ journeyName: '생일 축하', stepOrder: 1, messageSteps: 2, isLast: false, sendDay: '2026-10-30', sentCount: 18, countsKnown: true, success: 0, fail: 18, pending: 0, dayTotal: true });
    expect(b).toContain('step 1 / 2');
    expect(b).toContain('날짜: 10월 30일');
    expect(b).toContain('보낸 수: 18건');
    expect(b).toContain('성공: 0건 / 실패: 18건');
    expect(b).toContain('10월 30일 하루 합계입니다.');
    expect(b).toContain('다음 칸은 정한 때에 이어서 나갑니다.');
    expect(buildResultNoticeBody({ journeyName: 'x', stepOrder: 2, messageSteps: 2, isLast: true, sendDay: '2026-11-01', sentCount: 1, countsKnown: false, success: 0, fail: 0, pending: 0, dayTotal: false }))
      .toContain('결과 집계 전');
  });
});

describe('실행기 관문 미룰 시각 · 묶음 경보(§2-2)', () => {
  it('지금 + 10분 · 창 밖이면 다음 날 08시', () => {
    expect(pretestHoldUntil(kst('2026-10-31T13:00:00')).toISOString()).toBe(kst('2026-10-31T13:10:00').toISOString());
    expect(pretestHoldUntil(kst('2026-10-31T20:49:00')).toISOString()).toBe(kst('2026-10-31T20:59:00').toISOString());
    expect(pretestHoldUntil(kst('2026-10-31T20:54:00')).toISOString()).toBe(kst('2026-11-01T08:00:00').toISOString());
  });
  it('같은 묶음 29분 = 0 · 31분 = 1회 · 지나면 지움', () => {
    const key = 'j:s:2026-10-31';
    const t0 = kst('2026-10-31T10:00:00').getTime();
    expect(trackGateHold(key, t0)).toBe(false);
    expect(trackGateHold(key, t0 + 29 * 60_000)).toBe(false);
    expect(trackGateHold(key, t0 + 31 * 60_000)).toBe(true);
    expect(trackGateHold(key, t0 + 40 * 60_000)).toBe(false);
    clearGateHold(key);
    expect(trackGateHold(key, t0 + 41 * 60_000)).toBe(false);
    expect(GATE_HOLD_ALERT_MINUTES).toBe(30);
  });
});

describe('날짜 기준 = 2시간 앞서 만든다(§2-3)', () => {
  it('runAt 10:00 · 같은 날 08:00 부터', () => {
    const runAt = kst('2026-10-31T10:00:00');
    expect(PRETEST_LEAD_HOURS).toBe(2);
    expect(anchorDispatchDue(runAt, kst('2026-10-31T07:59:00'))).toBe(false);
    expect(anchorDispatchDue(runAt, kst('2026-10-31T08:00:00'))).toBe(true);
    expect(anchorDispatchDue(runAt, kst('2026-10-31T10:30:00'))).toBe(true);
    expect(anchorDispatchDue(runAt, kst('2026-10-30T22:00:00'))).toBe(false);
  });
});

describe('안내 쓰기 한 꼴(§2-8)', () => {
  it('시도 잡기 → 적재 → 기록 · 잡지 못하면 적재 0 · 적재 실패 · 오류 = 기록 0', async () => {
    const order: string[] = [];
    const steps = (claim: boolean, enqueue: boolean | 'throw') => ({
      claim: async () => { order.push('claim'); return claim; },
      enqueue: async () => { order.push('enqueue'); if (enqueue === 'throw') throw new Error('x'); return enqueue; },
      finalize: async () => { order.push('finalize'); return true; },
    });
    expect(await sendNoticeOnce(steps(true, true))).toBe('sent');
    expect(order).toEqual(['claim', 'enqueue', 'finalize']);
    order.length = 0;
    expect(await sendNoticeOnce(steps(false, true))).toBe('not_claimed');
    expect(order).toEqual(['claim']);
    order.length = 0;
    expect(await sendNoticeOnce(steps(true, false))).toBe('enqueue_failed');
    expect(await sendNoticeOnce(steps(true, 'throw'))).toBe('enqueue_failed');
    expect(order).not.toContain('finalize');
  });
});

describe('상한 있는 MySQL 연결(§2-8 · withBoundedMysql)', () => {
  /** 연결 n 개짜리 가짜 풀(빌린 연결이 돌아오지 않으면 다음 요청이 기다린다 = waitForConnections) */
  function fakePool(size: number, mode: 'hang' | 'ok') {
    let free = size;
    const waiters: Array<() => void> = [];
    const stats = { destroyed: 0, released: 0 };
    const give = () => {
      free--;
      return {
        query: () => (mode === 'hang' ? new Promise<any>(() => undefined) : Promise.resolve([[{ ok: 1 }], []])),
        release: () => { stats.released++; free++; waiters.shift()?.(); },
        destroy: () => { stats.destroyed++; free++; waiters.shift()?.(); },
      };
    };
    return {
      stats,
      setMode: (m: 'hang' | 'ok') => { mode = m; },
      getConnection: () => (free > 0 ? Promise.resolve(give()) : new Promise<any>((res) => waiters.push(() => res(give())))),
    };
  }
  it('끝나지 않는 실행 = 상한 뒤 던짐 · 그 연결 destroy 1 · release 0', async () => {
    const pool = fakePool(2, 'hang');
    await expect(withBoundedMysql(30, (run) => run('INSERT 1'), pool as any)).rejects.toThrow(/상한/);
    expect(pool.stats).toEqual({ destroyed: 1, released: 0 });
  });
  it('정상 = rows · release 1', async () => {
    const pool = fakePool(2, 'ok');
    expect(await withBoundedMysql(1000, (run) => run('SELECT 1'), pool as any)).toEqual([{ ok: 1 }]);
    expect(pool.stats).toEqual({ destroyed: 0, released: 1 });
  });
  it('연결 10개짜리 풀에서 멈춘 안내 12번 뒤에도 다른 요청이 연결을 받는다', async () => {
    const pool = fakePool(10, 'hang');
    for (let i = 0; i < 12; i++) await withBoundedMysql(10, (run) => run('INSERT'), pool as any).catch(() => undefined);
    pool.setMode('ok');
    expect(await withBoundedMysql(1000, (run) => run('SELECT 1'), pool as any)).toEqual([{ ok: 1 }]);
  });
  it('연결이 상한 안에 안 오면 던지고 · 늦게 온 연결은 받자마자 destroy', async () => {
    let late: (c: any) => void = () => undefined;
    const destroy = vi.fn();
    const pool = { getConnection: () => new Promise<any>((res) => { late = res; }) };
    await expect(withBoundedMysql(10, (run) => run('INSERT'), pool as any)).rejects.toThrow(/연결 받기/);
    late({ query: vi.fn(), release: vi.fn(), destroy });
    await new Promise((r) => setTimeout(r, 0));
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('소스 계약', () => {
  it('실행기 = 재검사 전 관문 → 발송 시간 판정 한 번(창 밖 = 바로 끝) → 조건 없는 칸 관문 → 변이 고르기 → 발송 표식(Codex 구현 1R ①)', () => {
    const ex = read('journey-executor.ts');
    const hours = ex.indexOf('if (!isWithinSendHours()) {');
    const gate = ex.indexOf("if (['sms', 'lms', 'mms'].includes(String(step.channel))) {");
    expect(ex.lastIndexOf('if (!isWithinSendHours()) {')).toBe(hours);
    expect(ex.match(/isWithinSendHours\(\)/g)).toHaveLength(1);
    expect(ex.slice(hours, gate)).toContain("return 'skipped_hours';");
    expect(hours).toBeGreaterThan(ex.indexOf('if (pendingSnapshotAt && ['));
    expect(gate).toBeGreaterThan(hours);
    expect(gate).toBeLessThan(ex.indexOf('let activeVariantId: string | null = null;'));
    expect(gate).toBeLessThan(ex.indexOf("gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, NOW(), 'sending', $4"));
    expect(ex).toContain("${pretestDoneSql('$3::uuid', '$4::uuid', `(NOW() AT TIME ZONE 'Asia/Seoul')::date`)} AS checked_today");
    expect(ex).toContain('[exec.execution_id, pendingSnapshotAt, exec.journey_id, step.id]');
    expect(ex).toContain('pretestHoldUntil()]');
  });
  it('그날 마침 판정 = notified · cancelled 만', () => {
    const sql = pretestDoneSql('$1', '$2', '$3');
    expect(sql).toContain("ps_done.status IN ('notified', 'cancelled')");
    expect(sql).not.toMatch(/'pending'|'paused'/);
  });
  it('날짜 기준 = 판정 함수 · 앞보기 창 상수 · 옛 「now < runAt」 0', () => {
    const a = read('journey-anchor-scheduler.ts');
    expect(a).toContain('if (!anchorDispatchDue(runAt, now)) continue;');
    expect(a).toContain("import { PRETEST_LEAD_HOURS } from './journey-pretest-notifier';");
    expect(a).not.toContain('if (now.getTime() < runAt.getTime()) continue;');
  });
  it('결과 안내 = 동기화 워커는 CT 만 부른다 · 실행 완료 후보 0', () => {
    const w = read('campaign-sync-worker.ts');
    expect(w).toContain('await notifyJourneyStepResults();');
    // Codex 구현 1R ③ — 사이클마다(대상 회사 0 의 조기 종료 · 오류와 무관) = finally 안 · _running 해제 앞
    const fin = w.indexOf('} finally {', w.indexOf("log('대상 회사 0개 → 종료');"));
    expect(w.indexOf('await notifyJourneyStepResults();')).toBeGreaterThan(fin);
    expect(w.indexOf('await notifyJourneyStepResults();')).toBeLessThan(w.indexOf('_running = false;', fin));
    expect(w).not.toMatch(/notifyJourneyResultsToManagers|result_notified_at|e\.status = 'completed'/);
    const r = read('journey-result-notice.ts');
    expect(r).not.toMatch(/status = 'completed'/);
    expect(r).toContain("EXISTS (SELECT 1 ${dueExecutionsSql('jsc.journey_id', 'jsc.step_id', 'jsc.send_date')}) AS still_due");
    // Codex 구현 2R ② — 후보 SQL 은 판정을 베끼지 않는다(판정 = decideResultNotice 한 곳 · 진행 중 실행 조각은 SELECT 칸 하나뿐 · 시각 거름 0)
    expect(r.match(/dueExecutionsSql\(/g)).toHaveLength(1);
    expect(r).not.toMatch(/AT TIME ZONE 'Asia\/Seoul'\) >= \$|result_notice_at IS NULL/);
  });
  it('문안 수정의 기록 지우기 = 스냅숏과 같은 트랜잭션(run)', () => {
    const jb = read('journey-builder.ts');
    const at = jb.indexOf('await createStepSnapshot(companyId, journeyId, stepId, run);');
    expect(jb.indexOf('await run(`DELETE FROM journey_pretest_schedules WHERE journey_id = $1::uuid AND step_id = $2::uuid`, [journeyId, stepId]);')).toBeGreaterThan(at);
    expect(jb.indexOf('}, { keepMarker })) ?? { rows: [] as any[] };')).toBeGreaterThan(at);
  });
  it('화면 문구 = 실제 시점 · 채널별 머리 · 옛 약속 0 · 모델명 · native dialog · 줄표 0', () => {
    const fe = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', ...p), 'utf8');
    const toggle = fe('components', 'journey', 'JourneyStepNotifyToggle.tsx');
    const act = fe('components', 'journey', 'JourneyActivationConfirmModal.tsx');
    const edit = fe('components', 'journey', 'JourneyMessageEditModal.tsx');
    expect(toggle).toContain("{isText ? '담당자 알림(보내기 전 · 보낸 결과)' : '담당자 알림(보낸 결과)'}");
    expect(toggle).toContain('바로 보내는 칸은 그날 첫 발송 전에 스팸 검사를 하느라 그날 첫 발송이 10~20분 늦어지고');
    expect(toggle).toContain('isStepNotifyOn(null, stepOrder, firstMessageOrder, lastMessageOrder)');
    expect(toggle).not.toContain('보내기 2시간 전 · 보낸 결과');
    expect(act).not.toContain('보내기 2시간 전에는 담당자에게 확인 문자를 보내요.');
    expect(act).toContain('바로 보내는 칸은 그날 첫 발송 10~20분 전');
    expect(edit).not.toContain('2시간 이내로 예정된 발송에는');
    for (const src of [toggle, act, edit]) {
      const strings = [...src.matchAll(/['"`]([^'"`\n]*[가-힣][^'"`\n]*)['"`]/g)].map((m) => m[1]).join('\n');
      expect(strings).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic/);
      expect(src).not.toMatch(/\b(window\.)?(alert|confirm|prompt)\(/);
    }
    for (const line of toggle.split('\n').filter((l) => /바로 보내는 칸|보낸 결과는|기본은 첫 메시지/.test(l))) expect(line).not.toContain('—');
  });
});
