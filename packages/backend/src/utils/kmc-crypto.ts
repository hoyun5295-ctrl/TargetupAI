/**
 * kmc-crypto.ts — 한국모바일인증(KMC) 암호화 모듈 호출 (★2026-10-06 본인확인 연동 · 전송자격인증 2.1 ①-1 · 3.4 ②)
 *
 * KMC 가 고객사 ID 마다 따로 발급하는 실행 파일(리눅스 `KmcCrypto`)을 한 번 띄워 두고 한 줄씩 주고받는다.
 * 규약은 KMC 예제 `kmcis_web_sample_crypto.js` 그대로다.
 *   보냄 = `모드:번호^*값\n`(모드 = enc 암호화 · dec 복호화 · msg 위변조 검사값)
 *   받음 = `번호:결과\n`(결과 글자 = EUC-KR — Node 기본 TextDecoder 로 푼다 · 새 의존성 0)
 *
 * ⛔ 실행 파일은 고객사별 열쇠가 든 파일이라 저장소에 넣지 않는다 — 서버 경로를 ENV `KMC_CRYPTO_PATH` 로 받는다.
 * ⛔ 값에 줄바꿈이 섞이면 규약이 깨져 다른 요청의 답을 가로챌 수 있다 — 넘기기 전에 막는다(바깥 값은 `isKmcToken` 으로 먼저 거른다).
 * ⛔ 죽은 파일에 쓰면 입력 통로가 오류를 내는데, 받는 쪽이 없으면 서버 전체가 내려간다 — 입력 통로 오류를 반드시 받는다.
 * 파일이 내려가면 기다리던 요청을 전부 실패시키고 다음 호출 때 다시 띄운다(예제의 자동 재기동 타이머는 두지 않는다).
 * 10초 안에 답이 없으면 그 파일을 멈춘 것으로 보고 내린다.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

export type KmcMode = 'enc' | 'dec' | 'msg';
export interface KmcCommand { file: string; args?: string[] }

const TIMEOUT_MS = 10_000;
const MAX_INPUT_LENGTH = 8_192;
const MODES: readonly KmcMode[] = ['enc', 'dec', 'msg'];
const eucKr = new TextDecoder('euc-kr');

/** 인증 창 · KMC 가 돌려준 암호문 모양 — 영문 · 숫자 · `+/=_-` 만(길이 상한 = KMC 결과 최대 5000 + 여유) */
export function isKmcToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9+/=_-]{1,6000}$/.test(value);
}

interface Pending { resolve: (v: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

let worker: ChildProcessWithoutNullStreams | null = null;
let workerKey = '';
let buffer = Buffer.alloc(0);
let seq = 0;
const pending = new Map<number, Pending>();

function stopWorker(reason: string): void {
  const w = worker;
  worker = null;
  workerKey = '';
  buffer = Buffer.alloc(0);
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    pending.delete(id);
    p.reject(new Error(reason));
  }
  if (w && w.exitCode === null) {
    try { w.kill(); } catch { /* 이미 내려갔다 */ }
  }
}

function onData(chunk: Buffer): void {
  buffer = Buffer.concat([buffer, chunk]);
  let nl: number;
  while ((nl = buffer.indexOf(0x0a)) >= 0) {
    let line = buffer.subarray(0, nl);
    buffer = buffer.subarray(nl + 1);
    if (line.length > 0 && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1);
    const sep = line.indexOf(0x3a);
    if (sep < 0) continue;
    const id = Number(line.subarray(0, sep).toString('ascii'));
    const p = pending.get(id);
    if (!p) continue;
    clearTimeout(p.timer);
    pending.delete(id);
    p.resolve(eucKr.decode(line.subarray(sep + 1)));
  }
}

function ensureWorker(cmd: KmcCommand): ChildProcessWithoutNullStreams {
  const key = [cmd.file, ...(cmd.args || [])].join('\u0000');
  if (worker && workerKey === key) return worker;
  if (worker) stopWorker('KMC_CRYPTO_RESTART');
  const w = spawn(cmd.file, cmd.args || [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  worker = w;
  workerKey = key;
  // ⛔ 오류 · 종료를 받는 곳은 통로를 만지기 **전에** 건다(★Codex 1R high) — 파일 기술자가 바닥나면(EMFILE) 통로 없이 실패하는데,
  //    그때 통로부터 만지면 여기서 던지고 뒤따르는 error 이벤트를 받을 곳이 없어 서버 전체가 내려간다.
  w.on('error', (e: Error) => { console.error('[kmc-crypto] 실행 실패:', e.message); if (worker === w) stopWorker('KMC_CRYPTO_SPAWN_FAILED'); });
  w.on('close', (code: number | null) => { if (worker === w) stopWorker(`KMC_CRYPTO_EXITED_${code}`); });
  if (!w.stdin || !w.stdout || !w.stderr) {
    stopWorker('KMC_CRYPTO_SPAWN_FAILED');
    throw new Error('KMC_CRYPTO_SPAWN_FAILED');
  }
  w.stdout.on('data', (c: Buffer) => { if (worker === w) onData(c); });
  w.stderr.on('data', (c: Buffer) => console.error('[kmc-crypto] stderr:', String(c).slice(0, 200)));
  w.stdin.on('error', (e: Error) => { console.error('[kmc-crypto] 입력 통로 오류:', e.message); if (worker === w) stopWorker('KMC_CRYPTO_STDIN'); });
  return w;
}

/** 모듈 한 번 호출 — 결과 글자를 돌려준다(빈 글자 = 모듈이 처리하지 못함 · 판정은 호출부) */
export function kmcCrypto(cmd: KmcCommand, mode: KmcMode, input: string): Promise<string> {
  if (!MODES.includes(mode)) return Promise.reject(new Error('KMC_CRYPTO_MODE'));
  if (typeof input !== 'string' || !input || input.length > MAX_INPUT_LENGTH || /[\r\n]/.test(input)) {
    return Promise.reject(new Error('KMC_CRYPTO_INPUT'));
  }
  let w: ChildProcessWithoutNullStreams;
  try {
    w = ensureWorker(cmd);
  } catch (e: any) {
    return Promise.reject(new Error(String(e?.message || '').startsWith('KMC_CRYPTO_') ? e.message : 'KMC_CRYPTO_SPAWN_FAILED'));
  }
  return new Promise<string>((resolve, reject) => {
    seq = (seq + 1) % 1_000_000_000;
    const id = seq;
    const timer = setTimeout(() => {
      if (!pending.delete(id)) return;
      reject(new Error('KMC_CRYPTO_TIMEOUT'));
      if (worker === w) stopWorker('KMC_CRYPTO_TIMEOUT');
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    w.stdin.write(`${mode}:${id}^*${input}\n`, 'utf8');
  });
}

/** 시험 전용 — 띄워 둔 파일을 내린다 */
export function __resetKmcCryptoForTest(): void {
  stopWorker('KMC_CRYPTO_RESET');
  seq = 0;
}
