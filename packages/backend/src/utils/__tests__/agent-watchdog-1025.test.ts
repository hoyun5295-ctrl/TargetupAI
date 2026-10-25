/**
 * 비토 에이전트 감시 판정 시험 (★ 2026-10-25 · 설계 = docs/2026-10-25-agent-watchdog-design.md)
 *
 * 10-25 10:10:08 hanjul03 = SIGSEGV 뒤 프로세스가 덤프를 찍다 끝나지 않아 58분 동안 systemd 는 active 로 봤다.
 * 여기서 지키는 것 = 「언제 끊는가」(동결 · 폴링 교착) · 「언제 끊지 않고 사람을 부르는가」(GW 끊김 · 계약 · 업데이트 · 상한 · 공통 원인)
 * · 경보는 사건당 1통 · 30분 뒤 1통 · 복구 1통.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { join } from 'path';

const req = createRequire(__filename);
const ROOT = join(__dirname, '..', '..', '..', '..', '..');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const judge = req(join(ROOT, 'scripts', 'agent-watchdog', 'judge.js'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cli = req(join(ROOT, 'scripts', 'agent-watchdog', 'agent-watchdog.js'));

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 25, 1, 0, 0); // 10:00 KST
const P = judge.PHRASES;
const j = (msg: string, extra: Record<string, unknown> = {}) => JSON.stringify({ time: 'x', level: 'INFO', msg, ...extra });
const statusLines = (from: number, to: number, paused = false) => {
  const out: Array<{ ts: number; text: string }> = [];
  for (let t = from; t <= to; t += MIN) out.push({ ts: t, text: j(P.STATUS, { table: 'SMSQ_SEND_15', paused }) });
  return out;
};
const snap = (over: Record<string, unknown> = {}) => ({
  unit: 'bito-agent-hanjul03', activeState: 'active', invocationId: 'inv-1',
  activeEnterMs: T0 - 60 * MIN, inactiveEnterMs: NaN, nRestarts: 0, lines: [] as Array<{ ts: number; text: string }>, ...over,
});

describe('판정 — 끊는가', () => {
  it('정상: 상태 줄이 1분마다 → 정상 · 판정 없음', () => {
    const now = T0;
    const r = judge.judgeUnit(snap({ lines: statusLines(now - 19 * MIN, now - 20_000) }), null, now);
    expect(r.phase).toBe('judged');
    expect(r.findings).toEqual([]);
    expect(r.healthy).toBe(true);
  });

  it('1025 재현: 10:09:33 마지막 상태 줄 · 10:10:08 덤프(JSON 아닌 줄) 뒤 0줄 → 상태 줄 3분 0줄에서 끊기', () => {
    const lastStatus = T0 + 9 * MIN + 33_000;
    const crash = T0 + 10 * MIN + 8_000;
    const lines = [
      ...statusLines(lastStatus - 14 * MIN, lastStatus),
      { ts: crash, text: 'unexpected fault address 0x22822eb5fa1c' },
      { ts: crash, text: 'fatal error: fault' },
      { ts: crash, text: 'goroutine 3811867 gp=0x2282089bda40 m=11 mp=0x228207d4f008 [running]:' },
    ];
    const at = (now: number) => judge.judgeUnit(snap({ lines: lines.filter((l) => l.ts <= now) }), null, now);
    expect(at(lastStatus + 2 * MIN + 55_000).findings).toEqual([]); // 상태 줄 3분 안 = 아직 기다린다
    expect(at(lastStatus + 3 * MIN + 5_000).findings).toEqual([{ kind: 'poll_stuck', action: 'kill' }]); // 10:12:38 (덤프 줄은 있으나 상태 줄 없음)
    expect(at(crash + 3 * MIN + 5_000).findings).toEqual([{ kind: 'frozen', action: 'kill' }]); // 덤프 줄도 3분 지나면 동결
  });

  it('폴링 교착: GW 연결 성공 뒤 다른 줄은 찍히는데 상태 줄이 3분 0줄 → 끊기', () => {
    const now = T0;
    const lines = [{ ts: now - 6 * MIN, text: j(P.GW_OK) }, { ts: now - MIN, text: j('Agent 통계') }];
    expect(judge.judgeUnit(snap({ lines }), null, now).findings).toEqual([{ kind: 'poll_stuck', action: 'kill' }]);
  });

  it('기동 3분 유예 · 자식 교체(Agent 시작) 뒤 3분 유예', () => {
    const now = T0;
    expect(judge.judgeUnit(snap({ activeEnterMs: now - 2 * MIN }), null, now).phase).toBe('grace');
    const lines = [{ ts: now - 2 * MIN, text: j(P.AGENT_START) }];
    expect(judge.judgeUnit(snap({ lines }), null, now).phase).toBe('grace');
  });
});

describe('판정 — 끊지 않고 사람을 부른다', () => {
  it('GW 끊김: 재시도 Warn 만 → 10분 전에는 대기 · 10분 넘으면 경보(끊지 않는다)', () => {
    const down = T0 - 12 * MIN;
    const lines = [...statusLines(down - 5 * MIN, down - MIN), { ts: down, text: j(P.GW_LOST) }];
    for (let t = down + MIN; t <= T0; t += 60_000) lines.push({ ts: t, text: j(P.GW_FAIL) });
    const at = (now: number) => judge.judgeUnit(snap({ lines: lines.filter((l) => l.ts <= now) }), null, now);
    expect(at(down + 5 * MIN).findings).toEqual([]);
    expect(at(T0).findings).toEqual([{ kind: 'gw_down', action: 'alert' }]);
  });

  it('계약 불충족: 차단 줄 뒤 0줄이어도 끊지 않는다 · 창이 지나도 표지로 기억한다', () => {
    const t1 = T0;
    const first = judge.judgeUnit(snap({ lines: [{ ts: t1 - 5 * MIN, text: j(P.CONTRACT) }] }), null, t1);
    expect(first.findings).toEqual([{ kind: 'contract', action: 'alert' }]);
    const t2 = t1 + 40 * MIN; // 그 줄은 창(20분) 밖
    const later = judge.judgeUnit(snap({ lines: [] }), first.next, t2);
    expect(later.findings).toEqual([{ kind: 'contract', action: 'alert' }]);
  });

  it('기동이 바뀌면 표지를 비운다(계약 기억이 새 기동으로 넘어가지 않는다)', () => {
    const first = judge.judgeUnit(snap({ lines: [{ ts: T0 - 5 * MIN, text: j(P.CONTRACT) }] }), null, T0);
    const now = T0 + 10 * MIN;
    const r = judge.judgeUnit(snap({ invocationId: 'inv-2', activeEnterMs: now - 10 * MIN, lines: statusLines(now - 8 * MIN, now - 30_000) }), first.next, now);
    expect(r.findings).toEqual([]);
    expect(r.next.marks.contractAt).toBeNull();
  });

  it('업데이트 교대: handoff 요청 뒤 새 자식 전까지 끊지 않는다 · quiesce 유지 = 경보', () => {
    const now = T0;
    const handoff = judge.judgeUnit(snap({ lines: [{ ts: now - 5 * MIN, text: j(P.HANDOFF) }] }), null, now);
    expect(handoff.phase).toBe('grace');
    expect(handoff.findings).toEqual([]);
    const hold = judge.judgeUnit(snap({ lines: [{ ts: now - 5 * MIN, text: j(P.QUIESCE_HOLD) }] }), null, now);
    expect(hold.findings).toEqual([{ kind: 'update_stuck', action: 'alert' }]);
  });

  it('paused 10분 → 경보', () => {
    const now = T0;
    const r = judge.judgeUnit(snap({ lines: statusLines(now - 10 * MIN, now - 20_000, true) }), null, now);
    expect(r.findings).toEqual([{ kind: 'paused', action: 'alert' }]);
  });

  it('systemd 상태: failed = 경보 · 손으로 멈춤 10분 = 경보 · activating = 건너뜀', () => {
    expect(judge.judgeUnit(snap({ activeState: 'failed' }), null, T0).findings).toEqual([{ kind: 'failed', action: 'alert' }]);
    expect(judge.judgeUnit(snap({ activeState: 'inactive', inactiveEnterMs: T0 - 11 * MIN }), null, T0).findings).toEqual([{ kind: 'stopped', action: 'alert' }]);
    expect(judge.judgeUnit(snap({ activeState: 'inactive', inactiveEnterMs: T0 - 2 * MIN }), null, T0).phase).toBe('skip');
    expect(judge.judgeUnit(snap({ activeState: 'activating' }), null, T0).phase).toBe('skip');
  });
});

describe('상한 · 공통 원인 · 자기 점검', () => {
  it('NRestarts 증가 = 재시작 기록 · 손 재시작(0 으로 돌아감) = 기준만 옮김', () => {
    const a = judge.judgeUnit(snap({ nRestarts: 2 }), null, T0);
    expect(a.restartsAdded).toBe(0); // 첫 회차 = 기준
    const b = judge.judgeUnit(snap({ nRestarts: 4 }), a.next, T0 + MIN);
    expect(b.restartsAdded).toBe(2);
    expect(b.next.restartEvents).toHaveLength(2);
    const c = judge.judgeUnit(snap({ nRestarts: 0 }), b.next, T0 + 2 * MIN);
    expect(c.restartsAdded).toBe(0);
    expect(c.next.lastNRestarts).toBe(0);
  });

  it('60분에 재시작 3회가 이미 있으면 동결이어도 끊지 않고 멈춤(halted) · 경보', () => {
    const now = T0;
    const prev = { invocationId: 'inv-1', marks: {}, restartEvents: [now - 50 * MIN, now - 30 * MIN, now - 10 * MIN], lastNRestarts: 3, halted: false, haltedAt: null };
    const r = judge.judgeUnit(snap({ nRestarts: 3, lines: [] }), prev, now);
    expect(r.findings).toEqual([{ kind: 'frozen', action: 'alert' }, { kind: 'halted', action: 'alert' }]);
    expect(r.next.halted).toBe(true);
    // 멈춘 뒤에는 정상이 돼도 reset 전까지 halted 경보가 남는다
    const again = judge.judgeUnit(snap({ nRestarts: 3, lines: statusLines(now + 5 * MIN, now + 19 * MIN) }), r.next, now + 19 * MIN + 10_000);
    expect(again.findings).toEqual([{ kind: 'halted', action: 'alert' }]);
  });

  it('1시간에 재시작 3회 초과 = 반복 크래시 경보', () => {
    const now = T0;
    const prev = { invocationId: 'inv-1', marks: {}, restartEvents: [now - 40 * MIN, now - 30 * MIN, now - 20 * MIN, now - 10 * MIN], lastNRestarts: 4, halted: false, haltedAt: null };
    const r = judge.judgeUnit(snap({ nRestarts: 4, lines: statusLines(now - 9 * MIN, now - 20_000) }), prev, now);
    expect(r.findings).toEqual([{ kind: 'crash_loop', action: 'alert' }]);
  });

  it('같은 회차 3개 이상 끊기 판정 = 공통 원인 → 아무것도 끊지 않는다', () => {
    const units = ['a', 'b', 'c', 'd'];
    const out = judge.judgeAll({ now: T0, probeOk: true, state: {}, snapshots: units.map((u, i) => snap({ unit: u, lines: i < 3 ? [] : statusLines(T0 - 5 * MIN, T0 - 20_000) })) });
    expect(out.kills).toEqual([]);
    expect(out.global).toEqual([{ kind: 'common_cause', action: 'alert' }]);
    expect(out.units.a.findings).toEqual([{ kind: 'frozen', action: 'alert' }]);
  });

  it('둘까지는 끊는다', () => {
    const out = judge.judgeAll({ now: T0, probeOk: true, state: {}, snapshots: ['a', 'b', 'c'].map((u, i) => snap({ unit: u, lines: i < 2 ? [] : statusLines(T0 - 5 * MIN, T0 - 20_000) })) });
    expect(out.kills).toEqual(['a', 'b']);
  });

  it('자기 점검 실패(journald) = 판정 중단 · 아무것도 끊지 않는다 · 유닛 기록 유지', () => {
    const state = { units: { a: { invocationId: 'x', marks: {}, restartEvents: [1], lastNRestarts: 1, halted: false } } };
    const out = judge.judgeAll({ now: T0, probeOk: false, state, snapshots: [] });
    expect(out.kills).toEqual([]);
    expect(out.global).toEqual([{ kind: 'journald', action: 'alert' }]);
    expect(out.nextUnits).toBe(state.units);
  });

  it('유닛 조회 실패 = 그 유닛만 경보', () => {
    const out = judge.judgeAll({ now: T0, probeOk: true, state: {}, snapshots: [{ unit: 'a', error: 'timeout' }] });
    expect(out.units.a.findings).toEqual([{ kind: 'probe_unit', action: 'alert' }]);
  });
});

describe('경보 — 사건당 1통 · 30분 뒤 1통 · 복구 1통', () => {
  const judgedWith = (findings: Array<{ kind: string; action: string }>, phase = 'judged') => ({ units: { u: { phase, findings, healthy: phase === 'judged' && findings.length === 0 } }, global: [] as Array<{ kind: string; action: string }> });

  const types = (p: { messages: Array<{ type: string }> }) => p.messages.map((m) => m.type);
  // 실행부가 하는 일: 보냄 → onSent · 실패 → onFailed · 시험 모드 → onSkipped
  const after = (p: any, outcome: 'sent' | 'failed' | 'skipped') => (outcome === 'sent' ? p.onSent : outcome === 'failed' ? p.onFailed : p.onSkipped);

  it('처음 = 1통 · 같은 회차 반복 = 0 · 30분 = 1통 · 그 뒤 침묵 · 해소 = 복구 1통', () => {
    const f = [{ kind: 'gw_down', action: 'alert' }];
    let p = judge.planAlerts({}, judgedWith(f), T0);
    expect(types(p)).toEqual(['start']);
    p = judge.planAlerts(after(p, 'sent'), judgedWith(f), T0 + 5 * MIN);
    expect(p.messages).toEqual([]);
    p = judge.planAlerts(after(p, 'sent'), judgedWith(f), T0 + 30 * MIN);
    expect(types(p)).toEqual(['remind']);
    p = judge.planAlerts(after(p, 'sent'), judgedWith(f), T0 + 90 * MIN);
    expect(p.messages).toEqual([]);
    p = judge.planAlerts(after(p, 'sent'), judgedWith([]), T0 + 95 * MIN);
    expect(types(p)).toEqual(['recovered']);
    const done = after(p, 'sent');
    expect(done.incidents).toEqual({});
    expect(done.recoveries).toEqual({});
  });

  it('보내기 실패 = 보낸 횟수를 쓰지 않는다 · 5분 안에는 다시 안 보냄 · 5분 뒤 다시 처음 경보', () => {
    const f = [{ kind: 'gw_down', action: 'alert' }];
    let p = judge.planAlerts({}, judgedWith(f), T0);
    let st = after(p, 'failed');
    expect(st.incidents['u:gw_down'].sent).toBe(0);
    p = judge.planAlerts(st, judgedWith(f), T0 + 2 * MIN);
    expect(p.messages).toEqual([]);
    p = judge.planAlerts(after(p, 'failed'), judgedWith(f), T0 + 5 * MIN);
    expect(types(p)).toEqual(['start']);
    st = after(p, 'sent');
    expect(st.incidents['u:gw_down'].sent).toBe(1);
  });

  it('시험 모드(보내지 않음) = 횟수 · 시도 기록 0 → 실제 전환 뒤 첫 회차에 처음 경보가 나간다', () => {
    const f = [{ kind: 'frozen', action: 'kill' }];
    let p = judge.planAlerts({}, judgedWith(f), T0, { dryRun: true });
    const st = after(p, 'skipped');
    expect(st.incidents['u:frozen']).toMatchObject({ sent: 0, lastAttemptAt: null });
    p = judge.planAlerts(st, judgedWith(f), T0 + MIN, { killed: ['u'] });
    expect(types(p)).toEqual(['start']);
    expect(p.messages[0].action).toBe('killed');
  });

  it('정상 판정 전에는 닫지 않는다 — 끊은 뒤 유예 · 재연결 실패(판정 없음 · 정상 아님) 동안 「복구」 0', () => {
    let p = judge.planAlerts({}, judgedWith([{ kind: 'frozen', action: 'kill' }]), T0, { killed: ['u'] });
    let st = after(p, 'sent');
    p = judge.planAlerts(st, judgedWith([], 'grace'), T0 + MIN);
    expect(p.messages).toEqual([]);
    st = after(p, 'sent');
    const notHealthy = { units: { u: { phase: 'judged', findings: [], healthy: false } }, global: [] };
    p = judge.planAlerts(st, notHealthy, T0 + 6 * MIN);
    expect(p.messages).toEqual([]);
    expect(Object.keys(after(p, 'sent').incidents)).toEqual(['u:frozen']);
    p = judge.planAlerts(after(p, 'sent'), judgedWith([]), T0 + 8 * MIN);
    expect(types(p)).toEqual(['recovered']);
  });

  it('복구 문자도 실패하면 다시 시도 · 2시간 뒤 포기 · 알린 적 없는 사건은 복구 문자 0', () => {
    let p = judge.planAlerts({}, judgedWith([{ kind: 'gw_down', action: 'alert' }]), T0);
    p = judge.planAlerts(after(p, 'sent'), judgedWith([]), T0 + 20 * MIN);
    expect(types(p)).toEqual(['recovered']);
    let st = after(p, 'failed');
    expect(Object.keys(st.recoveries)).toEqual(['u:gw_down']);
    p = judge.planAlerts(st, judgedWith([]), T0 + 26 * MIN);
    expect(types(p)).toEqual(['recovered']);
    p = judge.planAlerts(after(p, 'failed'), judgedWith([]), T0 + 20 * MIN + 121 * MIN);
    expect(p.messages).toEqual([]);
    expect(after(p, 'failed').recoveries).toEqual({});
    // 시험 모드에서만 있었던 사건(알린 적 없음)은 닫혀도 복구 문자를 보내지 않는다
    p = judge.planAlerts({}, judgedWith([{ kind: 'gw_down', action: 'alert' }]), T0, { dryRun: true });
    p = judge.planAlerts(after(p, 'skipped'), judgedWith([]), T0 + MIN);
    expect(p.messages).toEqual([]);
  });

  it('journald 이상 회차에는 다른 사건을 닫지 않는다', () => {
    let p = judge.planAlerts({}, judgedWith([{ kind: 'gw_down', action: 'alert' }]), T0);
    p = judge.planAlerts(after(p, 'sent'), { units: {}, global: [{ kind: 'journald', action: 'alert' }] }, T0 + MIN);
    expect(Object.keys(after(p, 'sent').incidents).sort()).toEqual(['*:journald', 'u:gw_down']);
    expect(types(p)).toEqual(['start']);
  });

  it('문구: 끊음 · 시험 모드 · 끊기 실패가 갈린다', () => {
    const base = { key: 'u:frozen', type: 'start', kind: 'frozen', unit: 'bito-agent-hanjul03' };
    expect(judge.renderMessages([{ ...base, action: 'killed' }], T0).body).toContain('강제 종료함');
    expect(judge.renderMessages([{ ...base, action: 'dry_kill' }], T0).body).toContain('시험 모드라 끊지 않음');
    expect(judge.renderMessages([{ ...base, action: 'kill_pending' }], T0).body).toContain('강제 종료 못 함');
    expect(judge.renderMessages([{ ...base, action: 'killed' }], T0).subject).toBe('[비토 감시] 이상 10:00 1건');
  });

  it('매일 요약: KST 09시부터 · 그날 한 번', () => {
    const at = (h: number, m = 0) => Date.UTC(2026, 9, 25, h - 9, m);
    expect(judge.summaryDue({}, at(8, 59), 9)).toBe(false);
    expect(judge.summaryDue({}, at(9, 0), 9)).toBe(true);
    expect(judge.summaryDue({ lastSummaryDate: '2026-10-25' }, at(15, 0), 9)).toBe(false);
    const s = judge.renderSummary({ mode: 'active', ticks: 1440, alerts: 2, dryKills: 0, kills: { a: 1 }, restarts: { a: 1 }, healthyTicks: { a: 1430 } }, { units: { a: { halted: false } }, incidents: {} }, at(9, 0));
    expect(s.subject).toBe('[비토 감시] 매일 요약 2026-10-25');
    expect(s.body).toContain('a: 정상 판정 1430/1440회 · 강제 종료 1 · systemd 재시작 1');
  });
});

describe('문구 · 입력 해석', () => {
  it('감시가 찾는 에이전트 문구(= bito-gateway cmd/agent/watchdog_phrases_test.go 목록)', () => {
    expect(Object.values(P).sort()).toEqual([
      '=== 비토 Agent 시작 ===',
      'GW 연결 끊김 감지, 폴링 중지 후 재연결',
      'GW 연결 성공, 폴링 시작',
      'GW 연결 실패, 재시도 대기',
      'Poller 상태',
      '발급계정 메시지별 직접입력 계약 불충족, 폴링 시작 차단',
      '안전 업데이트 handoff 종료 요청',
      '업데이트 상태 재조정 필요; quiesce 상태 유지',
    ].sort());
  });

  it('JSON 이 아닌 줄 = other · paused 필드를 읽는다', () => {
    expect(judge.classify({ ts: 1, text: 'fatal error: fault' }).kind).toBe('other');
    expect(judge.classify({ ts: 1, text: j(P.STATUS, { paused: true }) })).toEqual({ ts: 1, kind: 'STATUS', paused: true });
    expect(judge.classify({ ts: 1, text: '{깨진' }).kind).toBe('other');
  });

  it('systemctl show · 유닉스 시각 · journal MESSAGE 바이트 배열', () => {
    const s = cli.parseShow('ActiveState=active\nActiveEnterTimestamp=@1761354517\nInvocationID=abc\n');
    expect(s.ActiveState).toBe('active');
    expect(cli.unixMs(s.ActiveEnterTimestamp)).toBe(1761354517000);
    expect(Number.isNaN(cli.unixMs('Sun 2026-10-25 05:18:37 KST'))).toBe(true);
    expect(cli.journalMessage({ MESSAGE: Array.from(Buffer.from('fatal error: fault')) })).toBe('fatal error: fault');
  });
});

describe('실행 순서 — 상태 먼저 저장 · 그다음 끊기 · 경보 한 통', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = req('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = req('os');
  const NOW = T0 + 30 * MIN;
  type Call = { cmd: string; args: string[] };
  function fakeExec(units: Record<string, { lines: Array<{ ts: number; text: string }>; nRestarts?: number }>, calls: Call[], opts: { probe?: boolean } = {}) {
    let nonce = '';
    return (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      if (cmd === 'logger') { nonce = args[args.length - 1]; return ''; }
      if (cmd === 'journalctl' && args[0] === '-t') return opts.probe === false ? '' : `${nonce}\n`;
      if (cmd === 'systemctl' && args[0] === 'show') {
        const u = args[1];
        return `LoadState=loaded\nActiveState=active\nSubState=running\nInvocationID=inv-${u}\nActiveEnterTimestamp=@${Math.floor((NOW - 60 * MIN) / 1000)}\nInactiveEnterTimestamp=\nNRestarts=${units[u].nRestarts ?? 0}\n`;
      }
      if (cmd === 'journalctl' && args[0].startsWith('_SYSTEMD_INVOCATION_ID=')) {
        const u = args[0].slice('_SYSTEMD_INVOCATION_ID=inv-'.length);
        return units[u].lines.map((l) => JSON.stringify({ __REALTIME_TIMESTAMP: String(l.ts * 1000), MESSAGE: l.text })).join('\n');
      }
      if (cmd === 'systemctl' && args[0] === 'kill') return '';
      if (cmd === 'ops') return 'ok';
      throw new Error(`unexpected ${cmd} ${args.join(' ')}`);
    };
  }
  const healthy = () => ({ lines: statusLines(NOW - 19 * MIN, NOW - 20_000) });
  const frozen = () => ({ lines: statusLines(NOW - 19 * MIN, NOW - 5 * MIN) });
  const cfgFor = (mode: string, stateDir: string) => ({ mode, units: ['a', 'b', 'c'], summaryHour: 23, opsAlert: 'ops', stateDir, alertInDryRun: false, runDir: fs.mkdtempSync(join(os.tmpdir(), 'wd-run-')) });
  const tmp = () => fs.mkdtempSync(join(os.tmpdir(), 'wd-'));

  it('active: 멈춘 유닛만 KILL · 경보 1통(강제 종료함) · 상태에 사건 기록 · 다음 회차 같은 사건은 조용', () => {
    const dir = tmp();
    const calls: Call[] = [];
    const base = fakeExec({ a: frozen(), b: healthy(), c: healthy() }, calls);
    let savedBeforeKill = false;
    const exec = (cmd: string, args: string[]) => {
      if (cmd === 'systemctl' && args[0] === 'kill') savedBeforeKill = fs.existsSync(join(dir, 'state.json'));
      return base(cmd, args);
    };
    cli.tick({ exec, now: NOW, cfg: cfgFor('active', dir) });
    expect(savedBeforeKill).toBe(true);
    const kills = calls.filter((c) => c.cmd === 'systemctl' && c.args[0] === 'kill');
    expect(kills.map((c) => c.args)).toEqual([['kill', '-s', 'KILL', 'a']]);
    const alerts = calls.filter((c) => c.cmd === 'ops');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].args[1]).toContain('감지 a: 로그 3분 0줄(동결) → 강제 종료함');
    const state = JSON.parse(fs.readFileSync(join(dir, 'state.json'), 'utf8'));
    expect(Object.keys(state.incidents)).toEqual(['a:frozen']);
    expect(state.counters.kills).toEqual({ a: 1 });
    const calls2: Call[] = [];
    cli.tick({ exec: fakeExec({ a: frozen(), b: healthy(), c: healthy() }, calls2), now: NOW + MIN, cfg: cfgFor('active', dir) });
    expect(calls2.filter((c) => c.cmd === 'ops')).toHaveLength(0);
  });

  it('dry-run: 끊지 않는다 · 사건 경보도 보내지 않는다 · 시험 모드 끊기 판정 수를 센다', () => {
    const dir = tmp();
    const calls: Call[] = [];
    cli.tick({ exec: fakeExec({ a: frozen(), b: healthy(), c: healthy() }, calls), now: NOW, cfg: cfgFor('dry-run', dir) });
    expect(calls.filter((c) => c.cmd === 'systemctl' && c.args[0] === 'kill')).toEqual([]);
    expect(calls.filter((c) => c.cmd === 'ops')).toEqual([]);
    expect(JSON.parse(fs.readFileSync(join(dir, 'state.json'), 'utf8')).counters.dryKills).toBe(1);
  });

  it('상태를 저장할 수 없으면 끊지 않는다(실패하면 닫힘)', () => {
    const dir = tmp();
    const blocked = join(dir, 'not-a-dir');
    fs.writeFileSync(blocked, 'x'); // 폴더 자리에 파일 → mkdir · 쓰기 실패
    const calls: Call[] = [];
    cli.tick({ exec: fakeExec({ a: frozen(), b: healthy(), c: healthy() }, calls), now: NOW, cfg: cfgFor('active', blocked) });
    expect(calls.filter((c) => c.cmd === 'systemctl' && c.args[0] === 'kill')).toEqual([]);
  });

  it('자기 점검 실패 = 유닛 조회 · 끊기 0', () => {
    const dir = tmp();
    const calls: Call[] = [];
    cli.tick({ exec: fakeExec({ a: frozen(), b: frozen(), c: frozen() }, calls, { probe: false }), now: NOW, cfg: cfgFor('active', dir) });
    expect(calls.some((c) => c.cmd === 'systemctl')).toBe(false);
    const alerts = calls.filter((c) => c.cmd === 'ops');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].args[1]).toContain('감시 자기 점검 실패');
  });

  it('셋 다 멈춤 = 공통 원인 · 끊기 0', () => {
    const dir = tmp();
    const calls: Call[] = [];
    cli.tick({ exec: fakeExec({ a: frozen(), b: frozen(), c: frozen() }, calls), now: NOW, cfg: cfgFor('active', dir) });
    expect(calls.filter((c) => c.cmd === 'systemctl' && c.args[0] === 'kill')).toEqual([]);
    expect(calls.filter((c) => c.cmd === 'ops')[0].args[1]).toContain('공통 원인');
  });

  it('판정 뒤 스스로 재기동했으면(기동 ID 바뀜) 끊지 않는다', () => {
    const dir = tmp();
    const calls: Call[] = [];
    const base = fakeExec({ a: frozen(), b: healthy(), c: healthy() }, calls);
    let shows = 0;
    const exec = (cmd: string, args: string[]) => {
      if (cmd === 'systemctl' && args[0] === 'show' && args[1] === 'a' && ++shows === 2) {
        calls.push({ cmd, args });
        return ['ActiveState=active', 'InvocationID=inv-new', ''].join(String.fromCharCode(10));
      }
      return base(cmd, args);
    };
    cli.tick({ exec, now: NOW, cfg: cfgFor('active', dir) });
    expect(calls.filter((c) => c.cmd === 'systemctl' && c.args[0] === 'kill')).toEqual([]);
    expect(calls.filter((c) => c.cmd === 'ops')).toEqual([]);
  });

  it('상태 손상 = 다음 회차에도 자동 조치를 막는다(reset all 전까지) · 경보는 나간다', () => {
    const dir = tmp();
    fs.writeFileSync(join(dir, 'state.json'), '{깨진');
    const calls: Call[] = [];
    cli.tick({ exec: fakeExec({ a: frozen(), b: healthy(), c: healthy() }, calls), now: NOW, cfg: cfgFor('active', dir) });
    expect(calls.filter((c) => c.cmd === 'systemctl' && c.args[0] === 'kill')).toEqual([]);
    expect(calls.filter((c) => c.cmd === 'ops')[0].args[1]).toContain('감시 상태 파일 손상');
    const calls2: Call[] = [];
    cli.tick({ exec: fakeExec({ a: frozen(), b: healthy(), c: healthy() }, calls2), now: NOW + 5 * MIN, cfg: cfgFor('active', dir) });
    expect(calls2.filter((c) => c.cmd === 'systemctl' && c.args[0] === 'kill')).toEqual([]);
    expect(JSON.parse(fs.readFileSync(join(dir, 'state.json'), 'utf8')).actionsBlockedAt).toBe(NOW);
  });

  it('경보가 실패하면 1분 뒤 다시 안 보내고(시도 기록 저장) 5분 뒤 다시 보낸다', () => {
    const dir = tmp();
    const failingOps = (calls: Call[]) => {
      const base = fakeExec({ a: { lines: [] }, b: healthy(), c: healthy() }, calls);
      return (cmd: string, args: string[]) => { if (cmd === 'ops') { calls.push({ cmd, args }); throw new Error('both failed'); } return base(cmd, args); };
    };
    const at = (now: number) => { const calls: Call[] = []; cli.tick({ exec: failingOps(calls), now, cfg: { ...cfgFor('active', dir), units: ['a', 'b', 'c'] } }); return calls.filter((c) => c.cmd === 'ops').length; };
    expect(at(NOW)).toBe(1);
    expect(at(NOW + MIN)).toBe(0);
    expect(at(NOW + 5 * MIN)).toBe(1);
    expect(JSON.parse(fs.readFileSync(join(dir, 'state.json'), 'utf8')).incidents['a:frozen'].sent).toBe(0);
  });

  it('★2R 손상 뒤 첫 저장이 실패해도 원본이 그대로라 다음 회차도 차단 · 저장되면 차단 기록이 남는다', () => {
    const dir = tmp();
    fs.writeFileSync(join(dir, 'state.json'), '{깨진');
    const blocker = join(dir, `state.json.tmp-${process.pid}`);
    fs.mkdirSync(blocker); // 임시 파일 자리에 폴더 → 저장 실패
    const kills = (now: number) => {
      const calls: Call[] = [];
      cli.tick({ exec: fakeExec({ a: frozen(), b: healthy(), c: healthy() }, calls), now, cfg: cfgFor('active', dir) });
      return calls.filter((c) => c.cmd === 'systemctl' && c.args[0] === 'kill').length;
    };
    expect(kills(NOW)).toBe(0);
    expect(fs.readFileSync(join(dir, 'state.json'), 'utf8')).toBe('{깨진'); // 원본을 옮기지 않았다
    fs.rmdirSync(blocker);
    expect(kills(NOW + MIN)).toBe(0); // 여전히 손상으로 읽음 → 차단 · 이번엔 저장 성공
    expect(JSON.parse(fs.readFileSync(join(dir, 'state.json'), 'utf8')).actionsBlockedAt).toBe(NOW + MIN);
    expect(kills(NOW + 10 * MIN)).toBe(0); // 저장된 차단이 이어진다
  });

  it('★2R 보낸 뒤 성공 확정 저장이 실패하면 같은 경보를 30분에 한 번으로 묶는다', () => {
    const dir = tmp();
    const cfg = cfgFor('active', dir);
    const blocker = join(dir, `state.json.tmp-${process.pid}`);
    const at = (now: number, breakFinalSave: boolean) => {
      const calls: Call[] = [];
      const base = fakeExec({ a: { lines: [] }, b: healthy(), c: healthy() }, calls);
      const exec = (cmd: string, args: string[]) => {
        const out = base(cmd, args);
        if (cmd === 'ops' && breakFinalSave) fs.mkdirSync(blocker); // 보낸 직후부터 저장 실패
        return out;
      };
      cli.tick({ exec, now, cfg });
      if (fs.existsSync(blocker)) fs.rmdirSync(blocker);
      return calls.filter((c) => c.cmd === 'ops').length;
    };
    expect(at(NOW, true)).toBe(1); // 보냄 · 확정 저장 실패(상태엔 sent 0 · 시도 시각만)
    expect(at(NOW + 6 * MIN, false)).toBe(0); // 5분 재시도 때가 됐지만 30분 묶음 안
    expect(at(NOW + 31 * MIN, false)).toBe(1); // 묶음이 끝나 한 번 더(사건이 계속되는 동안) · 이번엔 확정
    expect(at(NOW + 36 * MIN, false)).toBe(0); // ★4R 다시 알림은 실제로 나간 때(31분)부터 30분
    expect(at(NOW + 61 * MIN, false)).toBe(1);
    expect(at(NOW + 70 * MIN, false)).toBe(0); // 그 뒤 침묵
  });

  it('★4R 표지는 보내기 전에 찍는다(보낸 직후 프로세스가 죽어도 남는다) · 확정되면 지운다', () => {
    const dir = tmp();
    const cfg = cfgFor('active', dir);
    const mark = join(cfg.runDir, 'bito-watchdog-unconfirmed-send');
    let markedDuringSend = false;
    const calls: Call[] = [];
    const base = fakeExec({ a: { lines: [] }, b: healthy(), c: healthy() }, calls);
    const exec = (cmd: string, args: string[]) => { if (cmd === 'ops') markedDuringSend = fs.existsSync(mark); return base(cmd, args); };
    cli.tick({ exec, now: NOW, cfg });
    expect(markedDuringSend).toBe(true);
    expect(fs.existsSync(mark)).toBe(false);
  });

  it('★3R 섞인 실패 순서(확정 저장 실패 → 30분 뒤 첫 저장부터 실패한 회차에 발송 → 다음 회차 저장 복구)도 30분에 한 통', () => {
    const dir = tmp();
    const cfg = cfgFor('active', dir);
    const blocker = join(dir, `state.json.tmp-${process.pid}`);
    const at = (now: number, mode: 'ok' | 'breakFinal' | 'breakAll') => {
      const calls: Call[] = [];
      const base = fakeExec({ a: { lines: [] }, b: healthy(), c: healthy() }, calls);
      if (mode === 'breakAll') fs.mkdirSync(blocker);
      const exec = (cmd: string, args: string[]) => {
        const out = base(cmd, args);
        if (cmd === 'ops' && mode === 'breakFinal') fs.mkdirSync(blocker);
        return out;
      };
      cli.tick({ exec, now, cfg });
      if (fs.existsSync(blocker)) fs.rmdirSync(blocker);
      return calls.filter((c) => c.cmd === 'ops').length;
    };
    expect(at(NOW, 'breakFinal')).toBe(1);
    expect(at(NOW + 31 * MIN, 'breakAll')).toBe(1); // 묶음이 끝났으니 1통 · 이번에도 확정 못 함 → 표지 갱신
    expect(at(NOW + 32 * MIN, 'ok')).toBe(0); // 저장은 돌아왔지만 방금 확정 못 한 발송이 있다
    expect(at(NOW + 62 * MIN, 'ok')).toBe(1);
  });

  it('★3R 손상 복사본은 최근 5개만 남는다', () => {
    const dir = tmp();
    fs.writeFileSync(join(dir, 'state.json'), '{깨진');
    for (let i = 1; i <= 7; i++) fs.writeFileSync(join(dir, `state.json.corrupt-${i}`), 'x');
    cli.tick({ exec: fakeExec({ a: healthy(), b: healthy(), c: healthy() }, []), now: NOW, cfg: cfgFor('active', dir) });
    const copies = fs.readdirSync(dir).filter((f: string) => f.startsWith('state.json.corrupt-'));
    expect(copies.length).toBe(5);
    expect(copies).not.toContain('state.json.corrupt-1');
  });
});
