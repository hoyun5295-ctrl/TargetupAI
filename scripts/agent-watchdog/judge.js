'use strict';
// 비토 에이전트 감시 — 판정부(순수 함수 · 시험 대상)
// 설계 = docs/2026-10-25-agent-watchdog-design.md §5-A · 경보 규칙 §5-B
//
// 2026-10-25 hanjul03: SIGSEGV 뒤 프로세스가 덤프를 찍다 끝나지 않아 58분 동안 systemd 는 active 로 봤고
// SMSQ_SEND_15 에 8,949건이 쌓였다. 여기서 정하는 것은 「언제 멈춘 것으로 보고 끊는가」와
// 「언제 끊지 않고 사람을 부르는가」다. 시간 · 로그 · systemd 상태는 전부 인자로 받는다.

const MIN = 60 * 1000;

// 에이전트가 찍는 문구(bito-gateway cmd/agent/main.go · internal/agent/poller/poller.go).
// 바뀌면 판정이 조용히 죽는다 → bito-gateway cmd/agent/watchdog_phrases_test.go 와 같은 목록이어야 한다(설계 §5-D).
const PHRASES = Object.freeze({
  STATUS: 'Poller 상태',
  GW_OK: 'GW 연결 성공, 폴링 시작',
  GW_FAIL: 'GW 연결 실패, 재시도 대기',
  GW_LOST: 'GW 연결 끊김 감지, 폴링 중지 후 재연결',
  CONTRACT: '발급계정 메시지별 직접입력 계약 불충족, 폴링 시작 차단',
  AGENT_START: '=== 비토 Agent 시작 ===',
  HANDOFF: '안전 업데이트 handoff 종료 요청',
  QUIESCE_HOLD: '업데이트 상태 재조정 필요; quiesce 상태 유지',
});

const LIMITS = Object.freeze({
  WINDOW_MS: 20 * MIN,      // 매 회차 읽는 로그 창(표지는 상태 파일로 이어 붙인다)
  GRACE_MS: 3 * MIN,        // 기동 · 자식 교체 뒤 판정 유예
  SILENT_MS: 3 * MIN,       // 로그 0줄 = 동결 · 상태 줄 0 = 폴링 교착(정상은 상태 줄 1분마다)
  GW_DOWN_MS: 10 * MIN,     // 상태 줄 없이 재연결만 이만큼 → 경보(재시작으로 안 풀림)
  PAUSED_MS: 9 * MIN,       // paused 가 이만큼 이어짐 → 경보(상태 줄이 1분 간격이라 10분 창에 9분)
  HANDOFF_MS: 15 * MIN,     // 업데이트 교대 중에는 끊지 않는다
  STOPPED_MS: 10 * MIN,     // 손으로 멈춘 유닛이 이만큼 꺼져 있으면 경보
  RESTART_WINDOW_MS: 60 * MIN,
  RESTART_CAP: 3,           // 60분에 재시작 3회가 이미 있으면 더 끊지 않고 사람을 부른다
  COMMON_CAUSE_UNITS: 3,    // 같은 회차에 3개 이상 끊기 판정 = 공통 원인 → 끊지 않는다
  REMIND_MS: 30 * MIN,      // 안 나으면 한 번 더
  RETRY_MS: 5 * MIN,        // 경보 보내기 실패 → 다시 시도 간격
  RECOVERY_GIVEUP_MS: 2 * 60 * MIN, // 복구 문자를 이만큼 못 보내면 포기
  STATE_DAYS_MS: 2 * 24 * 60 * MIN, // 재시작 기록 보관
});

const KIND_TEXT = Object.freeze({
  frozen: '로그 3분 0줄(동결)',
  poll_stuck: '폴링 상태 줄 3분 0줄(폴링 교착)',
  gw_down: '게이트웨이 재연결 실패 10분 이상',
  contract: '발급계정 계약 불충족으로 폴링 차단(설정 확인 필요)',
  paused: '폴러 일시정지 10분 이상',
  update_stuck: '원격 업데이트가 멈춘 상태(quiesce 유지)',
  failed: 'systemd failed 상태(기동 실패 반복 · 자동 재시작 멈춤)',
  stopped: '유닛이 꺼져 있음',
  crash_loop: '1시간에 재시작 3회 초과(반복 크래시)',
  halted: '재시작 상한 도달 · 자동 조치 멈춤(사람 확인 필요)',
  common_cause: '3개 이상 동시 멈춤 판정(공통 원인 · 끊지 않음)',
  journald: '감시 자기 점검 실패(journald 기록이 안 보임 · 판정 중단)',
  probe_unit: 'systemctl · journalctl 조회 실패',
  state_write: '감시 상태 파일 쓰기 실패(자동 조치 멈춤)',
  state_corrupt: '감시 상태 파일 손상(새로 시작 · 이번 회차 조치 없음)',
  kill_failed: '강제 종료 명령 실패',
});

/** journal 한 줄(JSON 이면 msg · 아니면 덤프 같은 날 줄) → { ts, kind, paused } */
function classify(entry) {
  let msg = null;
  let paused = false;
  const text = String(entry.text || '');
  if (text.startsWith('{')) {
    try {
      const o = JSON.parse(text);
      if (o && typeof o.msg === 'string') msg = o.msg;
      paused = o && o.paused === true;
    } catch (_) { /* JSON 이 아니면 그냥 줄 */ }
  }
  let kind = 'other';
  for (const [k, phrase] of Object.entries(PHRASES)) {
    if (msg === phrase) { kind = k; break; }
  }
  return { ts: entry.ts, kind, paused };
}

const lastTs = (lines, kinds) => {
  let best = null;
  for (const l of lines) if (kinds.includes(l.kind) && (best === null || l.ts > best)) best = l.ts;
  return best;
};
const maxOf = (...xs) => xs.reduce((a, b) => (b === null || b === undefined ? a : (a === null ? b : Math.max(a, b))), null);

/** 이번 기동 표지(상태 파일) 를 창의 줄로 갱신. 기동이 바뀌면 표지를 비운다(재시작 기록 · 상한은 유지). */
function mergeMarks(prev, snap, lines) {
  const same = prev && prev.invocationId === snap.invocationId;
  const m = same ? { ...prev.marks } : {};
  const pick = (key, kinds) => { m[key] = maxOf(m[key] ?? null, lastTs(lines, kinds)); };
  pick('agentStartAt', ['AGENT_START']);
  pick('statusAt', ['STATUS']);
  pick('gwOkAt', ['GW_OK']);
  pick('gwFailAt', ['GW_FAIL', 'GW_LOST']);
  pick('contractAt', ['CONTRACT']);
  pick('handoffAt', ['HANDOFF']);
  pick('quiesceHoldAt', ['QUIESCE_HOLD']);
  return m;
}

/** systemd 재시작 횟수(NRestarts) 증가분 → 재시작 기록. 손으로 재시작하면 0 으로 돌아가므로 그때는 기준만 옮긴다. */
function mergeRestarts(prev, snap, now) {
  const events = (prev && Array.isArray(prev.restartEvents) ? prev.restartEvents : []).filter((t) => now - t < LIMITS.STATE_DAYS_MS);
  let added = 0;
  const base = prev && Number.isFinite(prev.lastNRestarts) ? prev.lastNRestarts : null;
  if (Number.isFinite(snap.nRestarts) && base !== null && snap.nRestarts > base) {
    added = snap.nRestarts - base;
    for (let i = 0; i < added; i++) events.push(now);
  }
  return { events, added, lastNRestarts: Number.isFinite(snap.nRestarts) ? snap.nRestarts : base };
}

/**
 * 유닛 하나 판정.
 * snap = { unit, activeState, invocationId, activeEnterMs, inactiveEnterMs, nRestarts, lines: [{ts, text}] }
 * prev = 상태 파일의 그 유닛 칸(없으면 null)
 * 돌려줌 = { phase: 'judged'|'grace'|'skip', findings: [{kind, action}], healthy, next(새 유닛 칸), restartsAdded }
 */
function judgeUnit(snap, prev, now) {
  const lines = (snap.lines || []).map(classify).filter((l) => Number.isFinite(l.ts));
  const r = mergeRestarts(prev, snap, now);
  const marks = mergeMarks(prev, snap, lines);
  const next = {
    invocationId: snap.invocationId,
    marks,
    restartEvents: r.events,
    lastNRestarts: r.lastNRestarts,
    halted: !!(prev && prev.halted),
    haltedAt: prev && prev.haltedAt ? prev.haltedAt : null,
  };
  const recentRestarts = r.events.filter((t) => now - t < LIMITS.RESTART_WINDOW_MS).length;
  const out = (phase, findings = [], healthy = false) => ({ phase, findings, healthy, next, restartsAdded: r.added });

  if (snap.activeState === 'failed') return out('judged', [{ kind: 'failed', action: 'alert' }]);
  if (snap.activeState === 'inactive') {
    if (Number.isFinite(snap.inactiveEnterMs) && now - snap.inactiveEnterMs >= LIMITS.STOPPED_MS) {
      return out('judged', [{ kind: 'stopped', action: 'alert' }]);
    }
    return out('skip');
  }
  if (snap.activeState !== 'active' || !Number.isFinite(snap.activeEnterMs)) return out('skip');

  const findings = [];
  if (recentRestarts > LIMITS.RESTART_CAP) findings.push({ kind: 'crash_loop', action: 'alert' });
  if (next.halted) findings.push({ kind: 'halted', action: 'alert' });

  const since = maxOf(snap.activeEnterMs, marks.agentStartAt);
  if (now - since < LIMITS.GRACE_MS) return out('grace', findings);

  // 업데이트: 교대 요청 뒤 새 자식이 아직 안 떴으면 기다린다 · quiesce 유지 = 사람
  if (marks.quiesceHoldAt && !(marks.gwOkAt > marks.quiesceHoldAt) && !(marks.agentStartAt > marks.quiesceHoldAt)) {
    findings.push({ kind: 'update_stuck', action: 'alert' });
    return out('judged', findings);
  }
  if (marks.handoffAt && !(marks.agentStartAt > marks.handoffAt) && now - marks.handoffAt < LIMITS.HANDOFF_MS) {
    return out('grace', findings);
  }
  // 계약 불충족 = 재시작해도 그대로 → 끊지 않는다
  if (marks.contractAt && !(marks.gwOkAt > marks.contractAt)) {
    findings.push({ kind: 'contract', action: 'alert' });
    return out('judged', findings);
  }

  const recent = lines.filter((l) => now - l.ts < LIMITS.SILENT_MS);
  const statusRecent = recent.some((l) => l.kind === 'STATUS');
  const failRecent = recent.some((l) => l.kind === 'GW_FAIL' || l.kind === 'GW_LOST');

  if (recent.length === 0) {
    findings.push({ kind: 'frozen', action: 'kill' });
  } else if (!statusRecent) {
    if (failRecent) {
      if (now - maxOf(marks.statusAt, since) >= LIMITS.GW_DOWN_MS) findings.push({ kind: 'gw_down', action: 'alert' });
    } else {
      findings.push({ kind: 'poll_stuck', action: 'kill' });
    }
  } else {
    const statuses = lines.filter((l) => l.kind === 'STATUS' && now - l.ts < LIMITS.PAUSED_MS + MIN);
    if (statuses.length > 0 && statuses.every((l) => l.paused) && now - statuses[0].ts >= LIMITS.PAUSED_MS) {
      findings.push({ kind: 'paused', action: 'alert' });
    }
  }

  // 상한: 이미 60분에 3회 재시작했으면 끊지 않고 멈춘다
  for (const f of findings) {
    if (f.action !== 'kill') continue;
    if (next.halted || recentRestarts >= LIMITS.RESTART_CAP) {
      f.action = 'alert';
      if (!next.halted) { next.halted = true; next.haltedAt = now; }
      if (!findings.some((x) => x.kind === 'halted')) findings.push({ kind: 'halted', action: 'alert' });
    }
  }
  const healthy = statusRecent && findings.length === 0;
  return out('judged', findings, healthy);
}

/**
 * 회차 전체 판정.
 * input = { now, probeOk, snapshots: [snap|{unit, error}], state }
 * 돌려줌 = { units: {unit: 결과}, global: [finding], kills: [unit], nextUnits }
 */
function judgeAll(input) {
  const { now, probeOk, snapshots } = input;
  const prevUnits = (input.state && input.state.units) || {};
  const units = {};
  const global = [];
  if (!probeOk) {
    global.push({ kind: 'journald', action: 'alert' });
    return { units, global, kills: [], nextUnits: prevUnits };
  }
  const nextUnits = { ...prevUnits };
  for (const snap of snapshots) {
    if (snap.error) {
      units[snap.unit] = { phase: 'judged', findings: [{ kind: 'probe_unit', action: 'alert' }], healthy: false, restartsAdded: 0 };
      continue;
    }
    const res = judgeUnit(snap, prevUnits[snap.unit] || null, now);
    units[snap.unit] = res;
    nextUnits[snap.unit] = res.next;
  }
  let kills = Object.entries(units).filter(([, u]) => u.findings.some((f) => f.action === 'kill')).map(([unit]) => unit);
  if (kills.length >= LIMITS.COMMON_CAUSE_UNITS) {
    for (const unit of kills) for (const f of units[unit].findings) if (f.action === 'kill') f.action = 'alert';
    global.push({ kind: 'common_cause', action: 'alert' });
    kills = [];
  }
  return { units, global, kills, nextUnits };
}

/**
 * 경보 계획(사건 = 유닛 + 판정 종류): 첫 감지 1통 · 안 나으면 30분 뒤 1통 · 그 뒤 침묵 · 복구 1통.
 * 보낸 횟수(sent)는 **성공했을 때만** 올린다 — 실패 · 시험 모드는 횟수를 쓰지 않고, 실패는 5분 간격으로 다시 시도한다.
 * 사건은 그 유닛이 **정상 판정**(상태 줄 있음 · 판정 없음)일 때만 닫는다(끊은 뒤 재연결이 안 되는 동안 「복구」를 보내지 않게).
 * 닫힌 사건 중 알린 적 있는 것은 복구 대기(recoveries)로 옮겨 복구 문자가 나갈 때까지 다시 시도한다(2시간 뒤 포기).
 *
 * alerts = { incidents, recoveries } (상태 파일)
 * 돌려줌 = { messages, onSent, onFailed, onSkipped } — 실행부가 보낸 결과에 맞는 것을 저장한다.
 */
function planAlerts(alerts, judged, now, { killed = [], dryRun = false } = {}) {
  const prevIncidents = (alerts && alerts.incidents) || {};
  const prevRecoveries = (alerts && alerts.recoveries) || {};
  const incidents = {};
  const recoveries = { ...prevRecoveries };
  const messages = [];
  const current = new Map();
  for (const [unit, u] of Object.entries(judged.units)) for (const f of u.findings) current.set(`${unit}:${f.kind}`, { unit, ...f });
  for (const f of judged.global) current.set(`*:${f.kind}`, { unit: '*', ...f });
  const retryOk = (inc) => !inc.lastAttemptAt || now - inc.lastAttemptAt >= LIMITS.RETRY_MS;

  for (const [key, f] of current) {
    const action = f.action === 'kill' ? (killed.includes(f.unit) ? 'killed' : (dryRun ? 'dry_kill' : 'kill_pending')) : f.action;
    const inc = prevIncidents[key] || { firstAt: now, kind: f.kind, unit: f.unit, sent: 0, lastAttemptAt: null };
    delete recoveries[key]; // 다시 생겼으면 복구 문자는 보내지 않는다
    incidents[key] = inc;
    if (inc.sent === 0 && retryOk(inc)) messages.push({ key, type: 'start', kind: f.kind, unit: f.unit, action });
    // 다시 알림 = 처음 경보가 실제로 나간 때부터 30분(처음 경보가 늦게 성공해도 간격을 지킨다 · Codex 4R)
    else if (inc.sent === 1 && now - (inc.firstSentAt || inc.firstAt) >= LIMITS.REMIND_MS && retryOk(inc)) {
      messages.push({ key, type: 'remind', kind: f.kind, unit: f.unit, action, sinceMs: now - inc.firstAt });
    }
  }
  // 판정 축이 안 보였던 회차(journald 이상)에는 다른 사건을 닫지 않는다
  const blind = current.has('*:journald');
  for (const [key, inc] of Object.entries(prevIncidents)) {
    if (current.has(key)) continue;
    const u = inc.unit === '*' ? null : judged.units[inc.unit];
    const closable = !(blind && key !== '*:journald') && (inc.unit === '*' || (u && u.healthy === true));
    if (!closable) { incidents[key] = inc; continue; }
    if (inc.sent > 0) recoveries[key] = { kind: inc.kind, unit: inc.unit, firstAt: inc.firstAt, closedAt: now, lastAttemptAt: null };
  }
  for (const [key, r] of Object.entries(recoveries)) {
    if (now - r.closedAt > LIMITS.RECOVERY_GIVEUP_MS) { delete recoveries[key]; continue; }
    if (retryOk(r)) messages.push({ key, type: 'recovered', kind: r.kind, unit: r.unit, sinceMs: r.closedAt - r.firstAt });
  }

  const sentKeys = new Set(messages.map((m) => m.key));
  const stamp = (map, ok) => {
    const out = {};
    for (const [key, v] of Object.entries(map)) {
      if (!sentKeys.has(key)) { out[key] = v; continue; }
      const firstSend = ok && v.sent === 0;
      out[key] = { ...v, lastAttemptAt: now, ...(ok && v.sent !== undefined ? { sent: v.sent + 1 } : {}), ...(firstSend ? { firstSentAt: now } : {}) };
    }
    return out;
  };
  const sentRecoveries = {};
  for (const [key, r] of Object.entries(recoveries)) if (!sentKeys.has(key)) sentRecoveries[key] = r;
  return {
    messages,
    onSent: { incidents: stamp(incidents, true), recoveries: sentRecoveries },
    onFailed: { incidents: stamp(incidents, false), recoveries: stamp(recoveries, false) },
    // 시험 모드 · 보내지 않음: 횟수 · 시도 시각을 쓰지 않는다(실제 전환 뒤 첫 경보가 나가게)
    onSkipped: { incidents, recoveries },
  };
}

/** KST 날짜 · 시(서버 시간대와 무관하게 고정) */
function kstParts(now) {
  const d = new Date(now + 9 * 60 * MIN);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), hm: d.toISOString().slice(11, 16) };
}

/** 매일 요약을 보낼 차례인가 */
function summaryDue(state, now, summaryHour) {
  const { date, hour } = kstParts(now);
  return hour >= summaryHour && (!state || state.lastSummaryDate !== date);
}

const minutes = (ms) => `${Math.max(0, Math.round((ms || 0) / MIN))}분`;

/** 경보 문구(한 회차의 메시지를 한 통으로) */
function renderMessages(messages, now) {
  const { hm } = kstParts(now);
  const line = (m) => {
    const who = m.unit === '*' ? '전체' : m.unit;
    const what = KIND_TEXT[m.kind] || m.kind;
    if (m.type === 'recovered') return `복구 ${who}: ${what} 해소(${minutes(m.sinceMs)} 만)`;
    const act = m.action === 'killed' ? ' → 강제 종료함(systemd 가 5초 뒤 재기동)'
      : m.action === 'dry_kill' ? ' → 시험 모드라 끊지 않음'
        : m.action === 'kill_pending' ? ' → 강제 종료 못 함'
          : '';
    const head = m.type === 'remind' ? `계속 ${who}(${minutes(m.sinceMs)}째)` : `감지 ${who}`;
    return `${head}: ${what}${act}`;
  };
  const urgent = messages.some((m) => m.type !== 'recovered');
  const subject = `[비토 감시] ${urgent ? '이상' : '복구'} ${hm} ${messages.length}건`;
  return { subject, body: messages.map(line).join('\n') };
}

/** 매일 요약 문구 */
function renderSummary(counters, state, now) {
  const { date } = kstParts(now);
  const units = Object.keys((state && state.units) || {}).sort();
  const c = counters || {};
  const rows = units.map((u) => {
    const s = state.units[u] || {};
    const k = (c.kills || {})[u] || 0;
    const r = (c.restarts || {})[u] || 0;
    const h = (c.healthyTicks || {})[u] || 0;
    return `${u}: 정상 판정 ${h}/${c.ticks || 0}회 · 강제 종료 ${k} · systemd 재시작 ${r}${s.halted ? ' · 자동 조치 멈춤(reset 필요)' : ''}`;
  });
  const open = Object.values((state && state.incidents) || {}).map((i) => `${i.unit === '*' ? '전체' : i.unit} ${KIND_TEXT[i.kind] || i.kind}`);
  return {
    subject: `[비토 감시] 매일 요약 ${date}`,
    body: [
      `모드 ${c.mode || '?'} · 회차 ${c.ticks || 0} · 경보 ${c.alerts || 0}통 · 시험 모드 끊기 판정 ${c.dryKills || 0}`,
      ...rows,
      open.length ? `열린 사건: ${open.join(' / ')}` : '열린 사건 없음',
    ].join('\n'),
  };
}

module.exports = {
  PHRASES, LIMITS, KIND_TEXT,
  classify, judgeUnit, judgeAll, planAlerts, summaryDue, kstParts, renderMessages, renderSummary,
};
