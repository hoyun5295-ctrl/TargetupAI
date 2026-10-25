#!/usr/bin/env node
'use strict';
// 비토 에이전트 감시 — 실행부(systemd timer 가 1분마다 `run`)
// 설계 = docs/2026-10-25-agent-watchdog-design.md §5-A · 판정 = ./judge.js
//
// 사용:
//   agent-watchdog.js run            한 회차(판정 → 상태 저장 → 강제 종료 → 경보)
//   agent-watchdog.js reset <유닛>   상한으로 멈춘 유닛의 자동 조치를 다시 켠다(all = 전부 + 상태 손상 차단 해제)
//                                    (회차와 겹치지 않게 flock /run/bito-watchdog.lock node … reset <유닛> 으로 부른다)
//   agent-watchdog.js status         상태 파일 요약
//   agent-watchdog.js test-alert     경보 두 길(문자 · 메일) 실수신 시험
//
// 순서가 중요하다: 상태를 먼저 저장하고(재시작 상한 기록) 그 다음에 끊는다. 저장이 안 되면 끊지 않는다(실패하면 닫힘).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const judge = require('./judge');

const CONFIG_FILE = process.env.BITO_WATCHDOG_CONFIG || '/etc/bito-watchdog.env';
const CMD_TIMEOUT_MS = 20000;
const ALERT_TIMEOUT_MS = 45000;

function readConfig() {
  const cfg = {
    MODE: 'dry-run',
    UNITS: 'bito-agent bito-agent-hanjul02 bito-agent-hanjul03 bito-agent-hanjul-04',
    SUMMARY_HOUR: '9',
    OPS_ALERT: '/usr/local/bin/ops-alert',
    STATE_DIR: '/var/lib/bito-watchdog',
    ALERT_IN_DRY_RUN: 'no',
    RUN_DIR: '/run',
  };
  const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    cfg[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  if (cfg.MODE !== 'dry-run' && cfg.MODE !== 'active') throw new Error(`MODE 는 dry-run 또는 active (지금 ${cfg.MODE})`);
  const units = cfg.UNITS.split(/\s+/).filter(Boolean);
  if (units.length === 0 || units.some((u) => !/^[A-Za-z0-9@._-]+$/.test(u))) throw new Error('UNITS 형식 오류');
  const hour = Number(cfg.SUMMARY_HOUR);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('SUMMARY_HOUR 는 0~23');
  return { mode: cfg.MODE, units, summaryHour: hour, opsAlert: cfg.OPS_ALERT, stateDir: cfg.STATE_DIR, alertInDryRun: cfg.ALERT_IN_DRY_RUN === 'yes', runDir: cfg.RUN_DIR };
}

const run = (cmd, args, timeout = CMD_TIMEOUT_MS) => execFileSync(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const log = (msg) => console.log(`[bito-watchdog] ${msg}`);

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/** 자기 점검: logger 로 쓴 줄이 journal 에서 바로 읽히는가(안 보이면 4개를 한꺼번에 오판할 수 있다) */
function probeJournald(now, exec = run) {
  const nonce = `probe-${now}-${process.pid}`;
  try {
    exec('logger', ['-t', 'bito-watchdog', nonce]);
    for (let i = 0; i < 6; i++) {
      const out = exec('journalctl', ['-t', 'bito-watchdog', '--since', `@${Math.floor(now / 1000) - 120}`, '-o', 'cat', '--no-pager']);
      if (out.includes(nonce)) return true;
      sleepMs(300);
    }
  } catch (e) {
    log(`자기 점검 실패: ${e.message}`);
  }
  return false;
}

function parseShow(out) {
  const o = {};
  for (const line of out.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) o[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return o;
}
const unixMs = (v) => (typeof v === 'string' && /^@\d+$/.test(v) ? Number(v.slice(1)) * 1000 : NaN);

function journalMessage(e) {
  const m = e.MESSAGE;
  if (typeof m === 'string') return m;
  if (Array.isArray(m)) return Buffer.from(m).toString('utf8');
  return '';
}

function snapshotUnit(unit, now, exec = run) {
  try {
    const show = parseShow(exec('systemctl', ['show', unit, '--timestamp=unix', '-p', 'ActiveState,SubState,InvocationID,ActiveEnterTimestamp,InactiveEnterTimestamp,NRestarts,LoadState']));
    if (show.LoadState !== 'loaded') return { unit, error: `LoadState=${show.LoadState}` };
    const snap = {
      unit,
      activeState: show.ActiveState,
      invocationId: show.InvocationID || '',
      activeEnterMs: unixMs(show.ActiveEnterTimestamp),
      inactiveEnterMs: unixMs(show.InactiveEnterTimestamp),
      nRestarts: Number(show.NRestarts),
      lines: [],
    };
    if (snap.activeState === 'active' && snap.invocationId) {
      const sinceSec = Math.floor((now - judge.LIMITS.WINDOW_MS) / 1000);
      const out = exec('journalctl', [`_SYSTEMD_INVOCATION_ID=${snap.invocationId}`, '--since', `@${sinceSec}`, '-o', 'json', '--no-pager']);
      for (const line of out.split('\n')) {
        if (!line) continue;
        try {
          const e = JSON.parse(line);
          snap.lines.push({ ts: Math.floor(Number(e.__REALTIME_TIMESTAMP) / 1000), text: journalMessage(e) });
        } catch (_) { /* 깨진 줄은 건너뛴다 */ }
      }
    }
    return snap;
  } catch (e) {
    return { unit, error: e.message };
  }
}

function statePath(cfg) { return path.join(cfg.stateDir, 'state.json'); }

/**
 * 상태 읽기. 손상이면 회차(run)는 빈 상태로 판정하되 **원본은 그 자리에 둔다**(복사본만 남긴다) —
 * 새 상태(자동 조치 차단 기록 포함)가 저장되기 전까지는 다음 회차도 손상으로 읽어 차단이 이어진다.
 * 조회(status · reset)는 손상이면 멈춘다.
 */
function loadState(cfg, { tolerateCorrupt = false } = {}) {
  const p = statePath(cfg);
  if (!fs.existsSync(p)) return { state: {}, corrupt: false };
  try {
    const s = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('객체 아님');
    return { state: s, corrupt: false };
  } catch (e) {
    if (!tolerateCorrupt) throw new Error(`상태 파일 손상: ${e.message}`);
    const copy = `${p}.corrupt-${Date.now()}`;
    try { fs.copyFileSync(p, copy); } catch (_) { /* 복사본을 못 남겨도 판정은 차단으로 간다 */ }
    pruneCorruptCopies(cfg.stateDir, 5);
    log(`상태 파일 손상(${e.message}) → 복사본 ${copy} · 자동 조치 차단`);
    return { state: {}, corrupt: true };
  }
}

/** 손상 복사본은 최근 몇 개만 남긴다(저장이 계속 실패하면 회차마다 하나씩 쌓인다 · Codex 3R) */
function pruneCorruptCopies(dir, keep) {
  try {
    const copies = fs.readdirSync(dir).filter((f) => /^state\.json\.corrupt-\d+$/.test(f)).sort((x, y) => Number(x.split('-').pop()) - Number(y.split('-').pop()));
    for (const f of copies.slice(0, Math.max(0, copies.length - keep))) fs.rmSync(path.join(dir, f), { force: true });
  } catch (_) { /* 정리 실패는 판정과 무관 */ }
}

/** 원자 저장(임시 파일 → fsync → rename). 실패하면 throw. */
function saveState(cfg, state) {
  fs.mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 });
  const p = statePath(cfg);
  const tmp = `${p}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(state));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, p);
}

function sendAlert(cfg, subject, body, exec = run) {
  try {
    const out = exec(cfg.opsAlert, [subject, body], ALERT_TIMEOUT_MS);
    log(`경보 보냄: ${subject}${out ? ` (${out.trim().replace(/\s+/g, ' ')})` : ''}`);
    return true;
  } catch (e) {
    log(`경보 실패: ${subject} — ${e.message}`);
    return false;
  }
}

function bump(map, key, n = 1) { map[key] = (map[key] || 0) + n; }

function freshCounters(mode) { return { mode, ticks: 0, alerts: 0, dryKills: 0, kills: {}, restarts: {}, healthyTicks: {} }; }

/** KILL 직전 재확인: 판정한 그 기동이 아직 떠 있는가(그사이 스스로 재기동했으면 새 정상 프로세스를 끊지 않는다) */
function sameInvocation(exec, unit, snap) {
  const show = parseShow(exec('systemctl', ['show', unit, '-p', 'ActiveState,InvocationID']));
  return show.ActiveState === 'active' && !!snap.invocationId && show.InvocationID === snap.invocationId;
}

/** 한 회차. 시험은 exec(명령 실행) · now · cfg 를 넣는다. */
function tick({ exec = run, now = Date.now(), cfg = readConfig() } = {}) {
  const dryRun = cfg.mode === 'dry-run';
  const { state: prev, corrupt } = loadState(cfg, { tolerateCorrupt: true });
  const probeOk = probeJournald(now, exec);
  const snapshots = probeOk ? cfg.units.map((u) => snapshotUnit(u, now, exec)) : [];
  const judged = judge.judgeAll({ now, probeOk, snapshots, state: prev });

  // 상태 손상 = 재시작 기록 · 상한이 사라졌다 → reset 전까지 자동 조치를 막아 둔다(이번 회차만이 아니다)
  const blockedAt = corrupt ? now : (prev.actionsBlockedAt || null);
  if (blockedAt) judged.global.push({ kind: 'state_corrupt', action: 'alert' });
  let kills = blockedAt ? [] : judged.kills;

  const counters = prev.counters && prev.counters.mode === cfg.mode ? prev.counters : freshCounters(cfg.mode);
  counters.ticks += 1;
  for (const [unit, u] of Object.entries(judged.units)) {
    if (u.healthy) bump(counters.healthyTicks, unit);
    if (u.restartsAdded) bump(counters.restarts, unit, u.restartsAdded);
  }

  // 1) 상태 먼저 저장(끊을 유닛의 재시작 상한 기록이 남아야 한다). 저장 실패 = 끊지 않는다.
  let state = { ...prev, units: judged.nextUnits, counters, mode: cfg.mode, lastTickAt: now, actionsBlockedAt: blockedAt };
  let saved = true;
  try {
    saveState(cfg, state);
  } catch (e) {
    saved = false;
    log(`상태 저장 실패: ${e.message}`);
    judged.global.push({ kind: 'state_write', action: 'alert' });
    kills = [];
  }

  // 2) 강제 종료(KILL 만 · 다시 띄우기는 Restart=always 가 한다 · 감시가 restart 까지 하면 한 사건이 두 번 세어진다)
  const killed = [];
  const snapOf = Object.fromEntries(snapshots.map((x) => [x.unit, x]));
  for (const unit of kills) {
    if (dryRun) { counters.dryKills += 1; log(`[dry-run] 끊었을 유닛: ${unit}`); continue; }
    try {
      if (!sameInvocation(exec, unit, snapOf[unit])) {
        log(`강제 종료 취소: ${unit} — 판정 뒤 다시 기동했음`);
        judged.units[unit].findings = judged.units[unit].findings.filter((f) => f.action !== 'kill');
        continue;
      }
      exec('systemctl', ['kill', '-s', 'KILL', unit]);
      killed.push(unit);
      bump(counters.kills, unit);
      log(`강제 종료: ${unit}`);
    } catch (e) {
      log(`강제 종료 실패: ${unit} — ${e.message}`);
      judged.units[unit].findings.push({ kind: 'kill_failed', action: 'alert' });
    }
  }

  for (const [unit, u] of Object.entries(judged.units)) {
    log(`${unit} ${u.phase}${u.findings.length ? ` ${u.findings.map((f) => `${f.kind}:${f.action}`).join(',')}` : ''}${u.healthy ? ' 정상' : ''}`);
  }
  for (const f of judged.global) log(`전체 ${f.kind}:${f.action}`);

  // 확정 못 한 발송 = 표지 하나(메모리 파일시스템 · Codex 3R · 4R). 보내기 **전에** 찍고 확정 저장이 되면 지운다 —
  // 저장 실패든 보낸 직후 프로세스가 죽든 표지가 남고, 표지가 30분 안이면 경보 · 요약을 보내지 않는다.
  const unconfirmedMark = path.join(cfg.runDir || '/run', 'bito-watchdog-unconfirmed-send');
  const holdSends = markerFresh(unconfirmedMark, now, judge.LIMITS.REMIND_MS);
  let marked = false;
  const markBeforeSend = () => {
    if (marked) return;
    marked = true;
    try { fs.writeFileSync(unconfirmedMark, String(now)); } catch (_) { /* /run 도 못 쓰면 막을 길이 없다 */ }
  };

  // 3) 경보 — 시도 시각을 먼저 저장해 두고 성공했을 때만 보낸 횟수를 올린다
  const plan = judge.planAlerts({ incidents: prev.incidents, recoveries: prev.recoveries }, judged, now, { killed, dryRun });
  const send = !dryRun || cfg.alertInDryRun;
  if (plan.messages.length === 0 || !send || holdSends) {
    state = { ...state, ...plan.onSkipped };
    if (plan.messages.length > 0) {
      const why = !send ? '시험 모드 · 보내지 않음' : '30분 안에 확정 못 한 발송이 있어 보류';
      log(`경보 대상 ${plan.messages.length}건(${why}): ${judge.renderMessages(plan.messages, now).body.replace(/\n/g, ' / ')}`);
    }
  } else {
    const msg = judge.renderMessages(plan.messages, now);
    log(`경보 대상 ${plan.messages.length}건: ${msg.body.replace(/\n/g, ' / ')}`);
    state = { ...state, ...plan.onFailed };
    if (saved) trySave(cfg, state);
    markBeforeSend();
    if (sendAlert(cfg, msg.subject, msg.body, exec)) {
      counters.alerts += 1;
      state = { ...state, ...plan.onSent };
    }
  }

  // 4) 매일 요약 — 시도 시각을 먼저 저장 · 실패하면 30분 뒤 다시 · 보낸 날은 성공했을 때만
  const summaryRetryOk = !prev.summaryAttemptAt || now - prev.summaryAttemptAt >= judge.LIMITS.REMIND_MS;
  if (saved && !holdSends && summaryRetryOk && judge.summaryDue(prev, now, cfg.summaryHour)) {
    state = { ...state, summaryAttemptAt: now };
    if (trySave(cfg, state)) {
      const sum = judge.renderSummary(counters, state, now);
      markBeforeSend();
      if (sendAlert(cfg, sum.subject, sum.body, exec)) {
        state = { ...state, lastSummaryDate: judge.kstParts(now).date, counters: freshCounters(cfg.mode), summaryAttemptAt: null };
      }
    }
  }

  // 5) 확정 저장 — 되면 표지를 지운다 · 안 되면(첫 저장부터 실패한 회차 포함) 표지가 남아 30분 묶음
  const confirmed = saved && trySave(cfg, state);
  if (marked && confirmed) {
    try { fs.rmSync(unconfirmedMark, { force: true }); } catch (_) { /* 못 지우면 30분 묶음이 될 뿐 */ }
  }
}

/** 표지 파일 시각이 간격 안인가(없으면 false) */
function markerFresh(file, now, intervalMs) {
  try {
    const last = Number(fs.readFileSync(file, 'utf8'));
    return Number.isFinite(last) && now - last < intervalMs;
  } catch (_) {
    return false;
  }
}

function trySave(cfg, state) {
  try { saveState(cfg, state); return true; } catch (e) { log(`상태 저장 실패: ${e.message}`); return false; }
}

function reset(unit) {
  const cfg = readConfig();
  const { state } = loadState(cfg);
  const all = unit === 'all';
  const names = all ? Object.keys(state.units || {}) : [unit];
  if (!all && !(state.units && state.units[unit])) { console.log(`${unit}: 상태 없음`); return; }
  for (const name of names) {
    const u = state.units[name];
    u.halted = false;
    u.haltedAt = null;
    u.restartEvents = [];
    for (const key of Object.keys(state.incidents || {})) if (key.startsWith(`${name}:`)) delete state.incidents[key];
  }
  if (all) {
    // 상태 손상으로 막아 둔 자동 조치도 푼다
    state.actionsBlockedAt = null;
    if (state.incidents) delete state.incidents['*:state_corrupt'];
  }
  saveState(cfg, state);
  try { run('logger', ['-t', 'bito-watchdog', `reset ${unit} (자동 조치 다시 켬)`]); } catch (_) { /* 기록 실패해도 해제는 끝났다 */ }
  console.log(`${unit}: 자동 조치 다시 켬 · 재시작 기록 · 열린 사건 비움${all ? ' · 상태 손상 차단 해제' : ''}`);
}

function status() {
  const cfg = readConfig();
  const { state } = loadState(cfg);
  console.log(JSON.stringify({ mode: cfg.mode, lastTickAt: state.lastTickAt ? new Date(state.lastTickAt).toISOString() : null, lastSummaryDate: state.lastSummaryDate || null, actionsBlockedAt: state.actionsBlockedAt ? new Date(state.actionsBlockedAt).toISOString() : null, counters: state.counters || null, incidents: state.incidents || {}, recoveries: state.recoveries || {}, units: Object.fromEntries(Object.entries(state.units || {}).map(([k, v]) => [k, { halted: v.halted, restartsLastHour: (v.restartEvents || []).filter((t) => Date.now() - t < judge.LIMITS.RESTART_WINDOW_MS).length, marks: v.marks }])) }, null, 2));
}

function testAlert() {
  const cfg = readConfig();
  const { hm } = judge.kstParts(Date.now());
  const ok = sendAlert(cfg, `[비토 감시] 시험 ${hm}`, '경보 길 시험입니다. 문자와 메일이 모두 오면 정상입니다.');
  process.exitCode = ok ? 0 : 1;
}

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === 'run') tick();
    else if (cmd === 'reset' && arg) reset(arg);
    else if (cmd === 'status') status();
    else if (cmd === 'test-alert') testAlert();
    else { console.error('사용: agent-watchdog.js run | reset <유닛> | status | test-alert'); process.exitCode = 2; }
  } catch (e) {
    console.error(`[bito-watchdog] 실행 실패: ${e.stack || e.message}`);
    process.exitCode = 1; // systemd OnFailure= 가 경보를 낸다
  }
}

module.exports = { parseShow, unixMs, journalMessage, tick };
