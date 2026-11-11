#!/usr/bin/env node
'use strict';
/**
 * ★ 2026-11-11 백엔드 자동 복구 감시 (뿌리 R88) — administrator crontab 에서 1분마다 돈다.
 *
 * 경위: 11-10 22:47 깨진 판(dist)으로 재시작 → pm2 가 errored 로 포기 → 08:38 까지 아무도 몰랐다.
 *   백엔드 안의 감시(system-monitor)는 백엔드와 같이 죽는다. 이 감시는 백엔드 밖(cron)에서 돈다.
 *
 * 하는 일 — pm2 상태가 errored(= pm2 가 재시작을 포기 · 프로세스 없음)일 때만 움직인다:
 *   · 죽은 프로세스가 「지금 dist」로 시작했고(판을 끼운 시각 <= 기동 시각) 그 판이 돌던 판이 아니며,
 *     dist-old 가 「이 감시가 5분 이상 도는 것을 직접 본 판」(돌던 판)일 때만 → 그 판으로 되돌려 켠다.
 *     되돌림 대상은 돌던 판 하나뿐이다 — 어느 판이 실패했는지를 시각으로 짐작해 적지 않는다(Codex 2R).
 *   · 그 밖(돌던 판이 죽음 = 판 문제 아님 · 죽은 뒤에 새 판이 끼워짐 · 돌던 판이 남아 있지 않음)이면 → 그대로 다시 켠다.
 *   · 어느 쪽이든 공용 경보 ops-alert(문자 + 메일)로 알린다(같은 상태는 30분에 한 번).
 * 하지 않는 일 — online 인 프로세스는 느려도 건드리지 않는다(적재 중 발송을 끊지 않는다) · stopped(사람이 멈춤)는 건드리지 않는다.
 * 빌드와의 순서 — safe-build.sh 와 같은 커널 잠금(flock · .dist.lock)을 회차 내내 쥔다. 빌드가 쥐고 있으면 이번 회차는 건너뛰고,
 *   이 감시가 판을 읽고 옮기는 사이에는 빌드가 판을 끼우지 못한다(Codex 1R — 따로 보면 방금 끼운 수리 판을 실패한 판으로 옮긴다).
 *
 * 설치(서버 administrator · 한 번):
 *   * * * * * PATH=/usr/local/bin:/usr/bin:/bin node /home/administrator/targetup-app/packages/backend/scripts/backend-watchdog.js >> /home/administrator/backend-watchdog.log 2>&1
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const APP = process.env.WATCHDOG_APP || 'targetup-backend';
const BACKEND_DIR = process.env.WATCHDOG_BACKEND_DIR || path.resolve(__dirname, '..');
const STATE_FILE = process.env.WATCHDOG_STATE || path.join(os.homedir(), '.hanjul-backend-watchdog.json');
const OPS_ALERT = process.env.OPS_ALERT || '/usr/local/bin/ops-alert';
const PM2 = process.env.WATCHDOG_PM2 || 'pm2';

const PROVEN_UPTIME_MS = Number(process.env.WATCHDOG_PROVEN_MS || 5 * 60 * 1000); // 이만큼 online 이면 그 판은 「돌던 판」(리허설만 줄인다)
const ALERT_EVERY_MS = 30 * 60 * 1000; // 같은 상태 경보 간격
const DIST_LOCK = path.join(BACKEND_DIR, '.dist.lock'); // safe-build.sh 와 같은 커널 잠금 파일
const LOCK_BUSY = 75; // flock -E — 잠금을 못 쥠(빌드 중 · 앞 회차가 아직 돎)
const SETTLE_MS = Number(process.env.WATCHDOG_SETTLE_MS || 20 * 1000); // 다시 켠 뒤 상태를 보는 대기(시험만 줄인다)
/** 판을 끼운 시각 표식 — safe-build.sh 가 끼우기 직전에, 이 감시가 되돌린 직후에 찍는다 */
const INSTALLED_MARK = '.installed';

/**
 * 판정 — 부수효과 없음(시험 대상).
 * @param {{proc: null | {status: string, startedAt: number}, dist: null | {id: string, installedAt: number}, distOld: null | {id: string}, state: object, now: number}} i
 * @returns {{action: 'none'|'rollback'|'restart', alert: string|null, state: object}}
 */
function decide(i) {
  const prev = i.state || {};
  const state = { provenDistId: prev.provenDistId || null, lastAlertAt: Number(prev.lastAlertAt) || 0, lastAlertKind: prev.lastAlertKind || null };
  const alertOnce = (kind, msg) => {
    if (state.lastAlertKind === kind && i.now - state.lastAlertAt < ALERT_EVERY_MS) return null;
    state.lastAlertKind = kind;
    state.lastAlertAt = i.now;
    return msg;
  };
  if (!i.proc) {
    return { action: 'none', alert: alertOnce('missing', `pm2 목록에 ${APP} 가 없습니다. 서버에서 pm2 status 를 확인하세요.`), state };
  }
  // 이 프로세스가 「지금 dist」로 시작했는가 — 빌드만 하고 아직 다시 켜지 않은 새 판, 죽은 뒤에 끼운 판은 아니다.
  const loaded = !!i.dist && i.dist.installedAt <= i.proc.startedAt;
  if (i.proc.status === 'online') {
    if (loaded && i.now - i.proc.startedAt >= PROVEN_UPTIME_MS) state.provenDistId = i.dist.id;
    state.lastAlertKind = null; // 회복 — 다음 장애는 바로 알린다
    return { action: 'none', alert: null, state };
  }
  if (i.proc.status !== 'errored') return { action: 'none', alert: null, state }; // stopped · launching · stopping = 건드리지 않음
  const isProven = !!i.dist && i.dist.id === state.provenDistId;
  // 되돌림 = 죽은 프로세스가 이 판으로 시작했고 · 이 판은 돌던 판이 아니고 · dist-old 가 바로 그 돌던 판일 때만.
  if (loaded && !isProven && i.distOld && state.provenDistId && i.distOld.id === state.provenDistId) {
    state.lastAlertKind = 'rollback';
    state.lastAlertAt = i.now;
    return { action: 'rollback', alert: `${APP} 새 판이 부팅에 실패했습니다(errored). 돌던 직전 판으로 되돌려 다시 켭니다.`, state };
  }
  const why = !loaded ? '죽은 뒤에 새 판이 끼워져 있어 그 판으로' : isProven ? '판 문제로 보이지 않아' : '되돌릴 돌던 판이 남아 있지 않아';
  return { action: 'restart', alert: alertOnce('restart', `${APP} 가 errored 입니다. ${why} 그대로 다시 켭니다 — 계속되면 pm2 logs ${APP} --err 확인.`), state };
}

/** 서버 시각(KST) 글자 — 기록 · 실패한 판 폴더 이름에 쓴다 */
const ts = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const log = (m) => console.log(`[${ts()}] ${m}`);
const firstLine = (e) => String((e && e.message) || e).split('\n')[0];

function readProc() {
  const list = JSON.parse(execFileSync(PM2, ['jlist'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000 }));
  const p = list.find((x) => x && x.name === APP);
  return p ? { status: String((p.pm2_env || {}).status || ''), startedAt: Number((p.pm2_env || {}).pm_uptime || 0) } : null;
}

function distInfo(dir) {
  try {
    const st = fs.statSync(path.join(dir, 'app.js'));
    let installedAt = st.mtimeMs;
    try {
      installedAt = Math.max(installedAt, fs.statSync(path.join(dir, INSTALLED_MARK)).mtimeMs);
    } catch {
      /* 표식 없는 옛 판 = 빌드 시각으로 본다 */
    }
    return { id: `${st.size}-${Math.floor(st.mtimeMs)}`, installedAt };
  } catch {
    return null;
  }
}

function sendAlert(msg) {
  log(`경보: ${msg}`);
  try {
    fs.accessSync(OPS_ALERT, fs.constants.X_OK);
    execFileSync(OPS_ALERT, ['한줄로 백엔드 감시', msg], { stdio: 'ignore', timeout: 30000 });
  } catch (e) {
    log(`경보 발송 실패(${OPS_ALERT}) — ${firstLine(e)}`);
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STATE_FILE);
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function run() {
  const now = Date.now();
  const dist = path.join(BACKEND_DIR, 'dist');
  const distOld = path.join(BACKEND_DIR, 'dist-old');
  let proc;
  try {
    proc = readProc();
  } catch (e) {
    log(`pm2 jlist 실패 — ${firstLine(e)}`);
    return;
  }
  const d = decide({ proc, dist: distInfo(dist), distOld: distInfo(distOld), state: loadState(), now });
  saveState(d.state);
  if (d.alert) sendAlert(d.alert);
  if (d.action !== 'rollback' && d.action !== 'restart') return;

  // 움직이기 직전에 다시 본다 — 판정 · 경보(최대 30초) 사이 사람이 켰으면(상태 · 기동 시각이 바뀜) 손대지 않는다(Codex 1R).
  //   판 폴더는 이 회차가 잠금을 쥐고 있어 그 사이 빌드가 바꾸지 못한다.
  let again = null;
  try {
    again = readProc();
  } catch {
    /* 아래에서 멈춘다 */
  }
  if (!again || again.status !== 'errored' || again.startedAt !== proc.startedAt) {
    log(`${d.action} 취소 — 판정 뒤 상태가 바뀜(${again ? again.status : '모름'})`);
    return;
  }

  let failedDir = null;
  if (d.action === 'rollback') {
    failedDir = path.join(BACKEND_DIR, `dist-failed-${ts().replace(/[-: ]/g, '')}`);
    try {
      fs.renameSync(dist, failedDir);
    } catch (e) {
      sendAlert(`실패한 판을 옮기지 못했습니다(${firstLine(e)}). 사람 조치가 필요합니다.`);
      return;
    }
    try {
      fs.renameSync(distOld, dist);
    } catch (e) {
      fs.renameSync(failedDir, dist); // 직전 판을 못 옮기면 원래대로 — dist 없는 상태로 두지 않는다
      sendAlert(`직전 판으로 되돌리지 못했습니다(${firstLine(e)}). 사람 조치가 필요합니다.`);
      return;
    }
    try {
      fs.writeFileSync(path.join(dist, INSTALLED_MARK), `${ts()} watchdog rollback\n`);
    } catch {
      /* 표식이 없어도 빌드 시각으로 판정한다 */
    }
    log(`되돌림 — 실패한 판 = ${failedDir}`);
  }
  try {
    execFileSync(PM2, ['restart', APP], { stdio: 'ignore', timeout: 60000 });
  } catch (e) {
    log(`pm2 restart 실패 — ${firstLine(e)}`);
  }
  sleep(SETTLE_MS);
  let after = null;
  try {
    after = readProc();
  } catch {
    /* 아래에서 모름으로 알린다 */
  }
  const status = after ? after.status : '모름';
  log(`${d.action} 뒤 상태 = ${status}`);
  if (d.action === 'rollback') {
    sendAlert(
      status === 'online'
        ? `직전 판으로 되돌려 정상 기동했습니다. 새 판은 실행되고 있지 않습니다 — 실패한 판 = ${path.basename(failedDir)} · 원인 확인 뒤 다시 빌드.`
        : `직전 판으로 되돌렸지만 상태가 ${status} 입니다. 사람 조치가 필요합니다.`,
    );
  }
}

/**
 * 판 잠금(flock)을 쥔 채로 한 회차를 돈다 — 자기 자신을 flock 아래에서 다시 실행한다.
 *   -n = 못 쥐면 기다리지 않는다(빌드 중이면 이번 회차는 건너뜀) · -o = 잠금 파일을 자식에게 물려주지 않는다(pm2 가 띄우는 것이 잠금을 쥐고 남지 않게)
 *   서버(Linux)에 flock 이 없으면 돌지 않는다. 개발 PC(Windows · 시험)에는 빌드와 겹칠 일이 없어 잠금 없이 돈다.
 */
function main() {
  if (process.env.WATCHDOG_LOCKED === '1') return run();
  const probe = spawnSync('flock', ['--version'], { stdio: 'ignore' });
  if (probe.error || probe.status !== 0) {
    if (process.platform === 'linux') {
      log('flock 이 없어 감시를 돌리지 않습니다(util-linux 확인)');
      process.exitCode = 1;
      return;
    }
    return run();
  }
  const r = spawnSync('flock', ['-n', '-o', '-E', String(LOCK_BUSY), DIST_LOCK, process.execPath, __filename], {
    stdio: 'inherit',
    env: { ...process.env, WATCHDOG_LOCKED: '1' },
  });
  process.exitCode = r.status === LOCK_BUSY ? 0 : r.status == null ? 1 : r.status;
}

module.exports = { decide, PROVEN_UPTIME_MS, ALERT_EVERY_MS };

if (require.main === module) main();
