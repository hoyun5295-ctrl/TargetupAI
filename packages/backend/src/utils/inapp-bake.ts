/**
 * inapp-bake.ts — ★ 2026-11-08 C116 인앱 「구워 보내기」 컨트롤타워(열쇠 · 저장 · 대기열 · 굽기 일꾼).
 *   설계서 docs/2026-11-08-c116-inapp-bake-design.md(D2 · D3 · D6 · D7 · D12 · K1 ~ K10).
 *   이미 빌드된 업체 앱(옛 네이티브 렌더러)은 우리 모양(틀 · 띠 · 통짜)을 그릴 코드가 없다 → 서버가 SDK 로 그린 화면을
 *   서버 크롬으로 찍어 그림으로 보내고, 앱은 자기 버튼만 그린다(앱 수정 0).
 *   ⛔ 이 파일은 inapp-message 를 import 하지 않는다(판정 · 사본 = inapp-message 가 소유 · 순환 0).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { servedSdkFilePath } from './sdk-serve';
import { INAPP_WEBVIEW_SDK_VERSION } from './inapp-webview-page';
import { sendSystemAlert } from './system-alert';
import { fitToCanvas, SERVE_MAX_WIDTH } from './image-serve';
import { ASPECT_RATIOS, INAPP_STAGE_HEX } from './image-fit-spec';

/** 굽기 판(그리는 방법을 바꾸면 올린다 → 모든 열쇠가 바뀐다) · ★ C116-B 2 = 최종 정사각 그림(투명 찍기 + 무대 합성) */
export const INAPP_BAKE_VERSION = 3;
/** 서버 크롬 화면(휴대폰 · 1108 시험과 같은 값) */
export const INAPP_BAKE_VIEW = { width: 390, height: 844, deviceScaleFactor: 3 } as const;
/** 옛 열쇠를 지우기 전 남기는 시간(이미 내려보낸 주소 · 그림 캐시 하루 · D12) */
export const INAPP_BAKE_RETAIN_MS = 48 * 3600 * 1000;
/** 건마다 전체 시한(D6) */
export const INAPP_BAKE_JOB_DEADLINE_MS = 45_000;
export const INAPP_BAKE_QUEUE_MAX = 20;
export const INAPP_BAKE_FAIL_COOLDOWN_MS = 10 * 60 * 1000;
const IDLE_CLOSE_MS = 60_000;
/** 받은 바이트 상한(요청 하나 · 건 합) — 길이 헤더와 무관하게 실제 수신량으로 센다(D6 · Codex 설계 2R ④) */
export const INAPP_BAKE_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const INAPP_BAKE_MAX_TOTAL_BYTES = 40 * 1024 * 1024;

// 그림 폴더 = 공개 그림 길(`routes/cdp.ts` /inapp/image/:회사/:파일)과 같은 식(같은 식 6곳 = 설계서 §10 추가 과제 · 환경 변수 하나가 원천)
const INAPP_IMAGE_BASE = process.env.INAPP_IMAGE_PATH || path.resolve('./uploads/inapp');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[0-9a-f]{24}$/;

export interface InAppBakeJob {
  companyId: string;
  messageId: string;
  key: string;
  /** 구울 장 수(서버가 센 그림 있는 장 수 · 장 0 = flat 한 장) — 크롬이 그린 장 수와 다르면 실패 */
  expected: number;
  /** 웹뷰 페이지에 넣는 값 = { message(판 넷 사본 · 그림 = 상대 경로), still: { deadlineText } } */
  payload: Record<string, unknown>;
  /** ★ C116-B 장마다 무대색(#hex · 길이 = expected · 판정 = inapp-message inAppBakePlan) */
  stages: string[];
  /** ★ C118 B2 전부 스튜디오 인앱용 그림 = 여백 0(정사각으로만 맞춤) */
  full?: boolean;
}

/**
 * ★ C116-B D3 찍은 틀 상자(투명 바탕 PNG) → 최종 그림 = 인앱 맞춤 규격(정사각 · 가운데 안전 칸 · 무대색) 그대로 · JPEG(q90).
 *   캔버스 변 = 상자 긴 변 ÷ 안전 칸(내용을 늘리지 않음) · 상한 SERVE_MAX_WIDTH · 맞춤 CT fitToCanvas 하나(대체 길과 같은 함수 · K6).
 */
export async function composeInAppBakeSlide(png: Buffer, stage: string, full = false): Promise<Buffer> {
  const safe = ASPECT_RATIOS.inapp.safe!;
  const meta = await sharp(png).metadata();
  const w = meta.width || 1, h = meta.height || 1;
  if (full) {
    // ★ C118 B2 인앱용(가장자리 10% = 배경만) = 정사각 cover · 여백 0 · 늘리지 않음(짧은 변 기준)
    const side = Math.max(1, Math.min(SERVE_MAX_WIDTH, Math.min(w, h)));
    const bg = INAPP_STAGE_HEX.test(stage) ? stage : safe.fill;
    return sharp(png).resize({ width: side, height: side, fit: 'cover', position: 'centre' }).flatten({ background: bg }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  }
  const side = Math.max(1, Math.min(SERVE_MAX_WIDTH, Math.ceil(Math.max(w / safe.w, h / safe.h))));
  const fill = INAPP_STAGE_HEX.test(stage) ? stage : safe.fill;
  return sharp(await fitToCanvas(png, side, side, 'pad', { ...safe, fill })).flatten({ background: fill }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

interface BakeManifest { v: 1; key: string; messageId: string; count: number; createdAt: string; supersededAt?: string | null }

// ── 열쇠(D2) ─────────────────────────────────────────────────────────────
let sdkFingerprintMemo: { path: string; mtimeMs: number; fp: string } | null = null;
/** 웹뷰 페이지가 부르는 SDK 파일 내용 지문(파일이 바뀌면 = 다시 빌드 = 새 지문) */
export function currentInAppSdkFingerprint(): string {
  const p = servedSdkFilePath(INAPP_WEBVIEW_SDK_VERSION);
  if (!p) return 'sdk-missing';
  try {
    const st = fs.statSync(p);
    if (sdkFingerprintMemo && sdkFingerprintMemo.path === p && sdkFingerprintMemo.mtimeMs === st.mtimeMs) return sdkFingerprintMemo.fp;
    const fp = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);
    sdkFingerprintMemo = { path: p, mtimeMs: st.mtimeMs, fp };
    return fp;
  } catch {
    return 'sdk-unreadable';
  }
}

/** 그림에 영향을 주는 칸만(켜기 · 비중 · 대상 조건 · 버튼은 빠짐 = 정지 그리기는 버튼 칸을 만들지 않는다 · K3) */
const DRAWN_FIELDS = ['id', 'template', 'position', 'design', 'posterSlides', 'title', 'body', 'badgeText',
  'accentColor', 'backgroundColor', 'textColor', 'theme', 'cardStyle', 'imageUrl', 'endAt'] as const;

export function inAppBakeKey(drawn: Record<string, unknown>, sdkFingerprint: string = currentInAppSdkFingerprint()): string {
  const pick: Record<string, unknown> = {};
  for (const k of DRAWN_FIELDS) pick[k] = drawn[k] === undefined ? null : drawn[k];
  const src = JSON.stringify({ v: INAPP_BAKE_VERSION, sdk: sdkFingerprint, view: INAPP_BAKE_VIEW, m: pick });
  return crypto.createHash('sha256').update(src).digest('hex').slice(0, 24);
}

// ── 저장 · 준비 캐시 · 쓸기(D3 · D12 · K1 · K2) ────────────────────────────
let imageBase = INAPP_IMAGE_BASE;
const readyCache = new Map<string, number>(); // `${회사}/${열쇠}` → 장 수
const inflight = new Set<string>();             // 일하는 중인 `${회사}/${열쇠}`
const supersededKeys = new Set<string>();       // supersededAt 을 적은 `${회사}/${열쇠}`(캐시로 다시 읽혀도 지운다 · Codex 구현 1R ②)
// ★ Codex 구현 3R ① = 1R ② · 2R ① 과 같은 부류(지움 유예를 실패할 수 있는 쓰기 · 재시작하면 사라지는 메모리에 기댐)
//   구조 처방 = 닫힌 쪽 기본: 되돌림 표시(supersededAt 지움)를 파일에 확실히 기록한 경우에만 구운 주소를 내보낸다 ·
//   기록 실패 = null(대체 서빙) → 내보낸 주소는 모두 파일 기록으로 보호된다(메모리 보호 장치 0)

const ck = (companyId: string, key: string) => `${companyId}/${key}`;
const dirOf = (companyId: string) => path.join(imageBase, companyId);
export const inAppBakeFileName = (key: string, i: number) => `bake-${key}-${i}.jpg`;
const manifestName = (key: string) => `bake-${key}.json`;
/** 내려보낼 주소(공개 그림 길 · 상대 경로) */
export const inAppBakeImageUrl = (companyId: string, key: string, i: number) => `/api/cdp/inapp/image/${companyId}/${inAppBakeFileName(key, i)}`;

function readManifest(companyId: string, key: string): BakeManifest | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dirOf(companyId), manifestName(key)), 'utf8'));
    if (!raw || raw.key !== key || !Number.isInteger(raw.count) || raw.count < 1) return null;
    return raw as BakeManifest;
  } catch {
    return null;
  }
}

function writeAtomic(file: string, data: Buffer | string): void {
  const tmp = `${file}.tmp-${crypto.randomUUID()}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/**
 * 구운 판이 있으면 장 주소들(상대 경로), 없으면 null.
 *   준비 = json 있음 + 장 수 = 기대 장 수(다르면 준비 안 됨 · K2) · 처음 읽을 때 장 파일도 확인한 뒤에만 캐시(K1)
 *   되돌림(옛 열쇠가 다시 지금 값) = 그 json 의 supersededAt 을 지운다(D12 · 쓸기가 지우지 않게).
 */
export function readInAppBake(companyId: string, key: string, expected: number): string[] | null {
  if (!UUID_RE.test(companyId) || !KEY_RE.test(key) || !(expected >= 1)) return null;
  const c = readyCache.get(ck(companyId, key));
  if (c !== undefined) {
    if (c !== expected) return null;
    // 되돌림 = 캐시 적중이어도 지움 유예를 파일에서 푼다 · 못 풀면 내보내지 않는다(3R ①)
    if (supersededKeys.has(ck(companyId, key)) && !clearSuperseded(companyId, key)) return null;
    return Array.from({ length: c }, (_, i) => inAppBakeImageUrl(companyId, key, i));
  }
  const m = readManifest(companyId, key);
  if (!m || m.count !== expected) return null;
  for (let i = 0; i < m.count; i++) if (!fs.existsSync(path.join(dirOf(companyId), inAppBakeFileName(key, i)))) return null;
  if (m.supersededAt && !clearSuperseded(companyId, key)) return null;   // 못 풀면 캐시 0 · 내보내지 않음 → 다음 읽기에서 다시(3R ①)
  readyCache.set(ck(companyId, key), m.count);
  return Array.from({ length: m.count }, (_, i) => inAppBakeImageUrl(companyId, key, i));
}

/**
 * 되돌림 — 그 열쇠 json 의 supersededAt 을 지운다(쓸기가 지우지 않게 · D12).
 *   참 = 다시 읽어서 표시 없음을 확인한 경우 하나뿐(못 읽음 · 쓰기 실패 · 다시 읽어도 남음 = 거짓 · 추적 유지 · Codex 구현 4R ①).
 */
function clearSuperseded(companyId: string, key: string): boolean {
  const m = readManifest(companyId, key);
  if (!m) return false;
  if (m.supersededAt) {
    try { writeAtomic(path.join(dirOf(companyId), manifestName(key)), JSON.stringify({ ...m, supersededAt: null })); } catch { return false; }
    const v = readManifest(companyId, key);
    if (!v || v.supersededAt) return false;
  }
  supersededKeys.delete(ck(companyId, key));
  return true;
}

/** 장 그림 저장 → json 마지막(반쪽 0) → 캐시 → 같은 메시지 옛 열쇠 쓸기 */
export function writeInAppBake(job: InAppBakeJob, images: Buffer[], now: Date = new Date()): void {
  const dir = dirOf(job.companyId);
  fs.mkdirSync(dir, { recursive: true });
  images.forEach((buf, i) => writeAtomic(path.join(dir, inAppBakeFileName(job.key, i)), buf));
  const m: BakeManifest = { v: 1, key: job.key, messageId: job.messageId, count: images.length, createdAt: now.toISOString(), supersededAt: null };
  writeAtomic(path.join(dir, manifestName(job.key)), JSON.stringify(m));
  readyCache.set(ck(job.companyId, job.key), images.length);
  sweepInAppBakes(job.companyId, job.messageId, job.key, now);
}

/**
 * 같은 메시지의 옛 열쇠 = 처음 만나면 supersededAt 만 · 48시간 지난 것만 지움(지금 열쇠 · 일하는 열쇠 건너뜀) · 지운 열쇠만 캐시에서 뺌(D12 · K1).
 */
export function sweepInAppBakes(companyId: string, messageId: string, currentKey: string, now: Date = new Date()): void {
  const dir = dirOf(companyId);
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    const mm = /^bake-([0-9a-f]{24})\.json$/.exec(name);
    if (!mm) continue;
    const key = mm[1];
    if (key === currentKey || inflight.has(ck(companyId, key))) continue;
    const m = readManifest(companyId, key);
    if (!m || m.messageId !== messageId) continue;
    if (!m.supersededAt) {
      try { writeAtomic(path.join(dir, name), JSON.stringify({ ...m, supersededAt: now.toISOString() })); supersededKeys.add(ck(companyId, key)); } catch { /* 다음 쓸기 */ }
      continue;
    }
    supersededKeys.add(ck(companyId, key));
    if (now.getTime() - Date.parse(m.supersededAt) < INAPP_BAKE_RETAIN_MS) continue;
    readyCache.delete(ck(companyId, key));
    supersededKeys.delete(ck(companyId, key));
    for (let i = 0; i < m.count; i++) { try { fs.unlinkSync(path.join(dir, inAppBakeFileName(key, i))); } catch { /* 없으면 그만 */ } }
    try { fs.unlinkSync(path.join(dir, name)); } catch { /* 없으면 그만 */ }
  }
}

// ── 대기열(D6 · V8) ───────────────────────────────────────────────────────
/** 한 건을 굽는다 — 장마다 JPEG 버퍼 · abort 가 불리면 즉시 그만둬야 한다(크롬 강제 종료) */
export type InAppBakeRunner = (job: InAppBakeJob) => Promise<Buffer[]>;
let runner: InAppBakeRunner = (job) => runWithChrome(job);
let abortCurrent: () => void = () => killChrome();
let jobDeadlineMs = INAPP_BAKE_JOB_DEADLINE_MS;
const queue: InAppBakeJob[] = [];
const failedUntil = new Map<string, number>();
let pumping = false;

export type InAppBakeRequestResult = 'queued' | 'duplicate' | 'full' | 'cooldown' | 'invalid';

/** 굽기 요청(같은 열쇠 한 번 · 상한 20 · 실패 10분 쉼) — 기다리지 않는다(게시 · 서빙이 막히지 않게 · K5) */
export function requestInAppBake(job: InAppBakeJob, now: number = Date.now()): InAppBakeRequestResult {
  if (!UUID_RE.test(job.companyId) || !KEY_RE.test(job.key) || !(job.expected >= 1)) return 'invalid';
  // ★ C116-B 장마다 무대색 = 길이 · 꼴이 맞아야 굽는다(어긋나면 그림 · 무대 짝이 틀어진다 · K5)
  if (!Array.isArray(job.stages) || job.stages.length !== job.expected || !job.stages.every((c) => INAPP_STAGE_HEX.test(String(c)))) return 'invalid';
  const k = ck(job.companyId, job.key);
  if (inflight.has(k) || queue.some((q) => ck(q.companyId, q.key) === k)) return 'duplicate';
  if ((failedUntil.get(k) || 0) > now) return 'cooldown';
  if (queue.length >= INAPP_BAKE_QUEUE_MAX) {
    console.log(`[inapp-bake] 대기열 가득(${INAPP_BAKE_QUEUE_MAX}) · 건너뜀 ${job.messageId}`);
    return 'full';
  }
  queue.push(job);
  void pump();
  return 'queued';
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const k = ck(job.companyId, job.key);
      inflight.add(k);
      const t0 = Date.now();
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        const images = await Promise.race([
          runner(job),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => { abortCurrent(); reject(new Error(`시한 ${jobDeadlineMs}ms 넘음`)); }, jobDeadlineMs);
          }),
        ]);
        if (images.length !== job.expected) throw new Error(`장 수 다름(기대 ${job.expected} · 그림 ${images.length})`);
        writeInAppBake(job, images);
        console.log(`[inapp-bake] 구움 ${job.messageId} 장 ${images.length} ${Date.now() - t0}ms`);
      } catch (e: any) {
        // 굽지 않아야 하는 메시지(글 넘침 등 = 열쇠가 바뀔 때까지 같은 결과) = 다시 굽지 않는다 · 그 밖 = 10분 쉼
        failedUntil.set(k, e?.inAppBakePermanent ? Number.MAX_SAFE_INTEGER : Date.now() + INAPP_BAKE_FAIL_COOLDOWN_MS);
        console.log(`[inapp-bake] 실패 ${job.messageId} · ${String(e?.message || e).slice(0, 200)} · ${Date.now() - t0}ms`);
      } finally {
        if (timer) clearTimeout(timer);
        inflight.delete(k);   // 자리 반환(멈춘 일이 일꾼을 붙잡지 않는다 · D6)
      }
    }
  } finally {
    pumping = false;
  }
}

// ── 서버 크롬 일꾼(D6 · D7) ───────────────────────────────────────────────
let browser: any = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let chromeAlerted = false;

function resolveChrome(): string | undefined {
  for (const c of [process.env.INAPP_BAKE_CHROME, process.env.OUTREACH_RENDER_CHROME, '/opt/hanjul-chrome/current/chrome-linux64/chrome']) {
    if (c && fs.existsSync(c)) return c;
  }
  return undefined; // puppeteer 기본
}

/** 그 크롬 인스턴스를 강제 종료 · 전역 참조는 같은 인스턴스일 때만 비운다(새로 띄운 크롬을 건드리지 않게 · Codex 구현 1R ③) */
function killInstance(b: any): void {
  if (!b) return;
  if (browser === b) browser = null;
  try { b.process?.()?.kill('SIGKILL'); } catch { /* 이미 없음 */ }
}
function killChrome(): void { killInstance(browser); }

async function getBrowser(): Promise<any> {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (browser && browser.connected !== false) return browser;
  try {
    const puppeteer = (await import('puppeteer')).default;
    browser = await puppeteer.launch({
      headless: true,
      executablePath: resolveChrome(),
      args: ['--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--lang=ko-KR'],
    });
    chromeAlerted = false;
    return browser;
  } catch (e: any) {
    // K4 · R14 — 크롬이 안 뜨면 옛 앱은 계속 대체만 받는다 → 사람에게 닿게(6시간 한 번 · 회사 무관)
    if (!chromeAlerted) {
      chromeAlerted = true;
      void sendSystemAlert({ dedupKey: 'inapp-bake:chrome', companyId: null, message: `인앱 굽기 크롬 실행 실패: ${String(e?.message || e).slice(0, 120)}` }).catch(() => {});
    }
    throw e;
  }
}

function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const b = browser;
    if (!b) return;
    browser = null;
    void Promise.resolve(b.close?.()).catch(() => killInstance(b));
  }, IDLE_CLOSE_MS);
}

/** 크롬이 열어도 되는 주소 = 굽기 페이지 출처 + 구글 글꼴 두 곳 + data/blob(D7) */
export function inAppBakeAllowedUrl(url: string, base: string): boolean {
  if (url.startsWith('data:') || url.startsWith('blob:')) return true;
  try {
    const u = new URL(url);
    if (u.origin === new URL(base).origin) return true;
    return u.protocol === 'https:' && (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com');
  } catch {
    return false;
  }
}

/** 받은 바이트 누적(순수 · 시험 V8) — 넘으면 true */
export function inAppBakeBytesOver(per: Map<string, number>, requestId: string, bytes: number, total: { n: number }): boolean {
  const next = (per.get(requestId) || 0) + Math.max(0, bytes);
  per.set(requestId, next);
  total.n += Math.max(0, bytes);
  return next > INAPP_BAKE_MAX_RESPONSE_BYTES || total.n > INAPP_BAKE_MAX_TOTAL_BYTES;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runWithChrome(job: InAppBakeJob): Promise<Buffer[]> {
  const base = process.env.INAPP_BAKE_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`;
  const b = await getBrowser();
  const page = await b.newPage();
  let overflow = false;
  try {
    await page.setViewport(INAPP_BAKE_VIEW);
    await page.setRequestInterception(true);
    page.on('request', (req: any) => { if (inAppBakeAllowedUrl(req.url(), base)) req.continue(); else req.abort(); });
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    const per = new Map<string, number>();
    const total = { n: 0 };
    cdp.on('Network.dataReceived', (e: any) => {
      if (overflow) return;
      if (inAppBakeBytesOver(per, String(e.requestId), Math.max(Number(e.dataLength) || 0, Number(e.encodedDataLength) || 0), total)) {
        overflow = true;
        abortCurrent();
      }
    });
    await page.evaluateOnNewDocument((payload: string) => {
      const w: any = globalThis;
      w.__hjlEvents = [];
      w.ReactNativeWebView = { postMessage: (s: string) => { w.__hjlEvents.push(String(s)); } };
      w.__HJL_INAPP__ = JSON.parse(payload);
    }, JSON.stringify(job.payload));
    await page.goto(`${base}/api/cdp/inapp/webview`, { waitUntil: 'load', timeout: 20_000 });
    // 그리기 끝(ready) · 실패(failed)
    let state = '';
    for (let i = 0; i < 75 && !state; i++) {
      const ev: string[] = await page.evaluate(() => (globalThis as any).__hjlEvents || []);
      if (ev.some((x) => x.includes('"ready"'))) state = 'ready';
      else if (ev.some((x) => x.includes('"failed"'))) state = 'failed';
      else await sleep(200);
    }
    if (state !== 'ready') throw new Error(`그리기 ${state || '시간 초과'}`);
    // 모든 그림 도착(장마다 찍기 전)
    for (let i = 0; i < 50; i++) {
      const done: boolean = await page.evaluate(() => Array.from((globalThis as any).document.images as any[]).every((im: any) => im.complete && im.naturalWidth > 0));
      if (done) break;
      if (i === 49) throw new Error('그림 도착 시간 초과');
      await sleep(200);
    }
    const count: number = await page.evaluate(() => {
      const rail = (globalThis as any).document.querySelector('[data-hjl-carousel]') as any;
      return rail ? rail.children.length : ((globalThis as any).document.querySelector('[data-hjl-frame]') ? 1 : 0);
    });
    if (count !== job.expected) throw new Error(`그린 장 수 다름(기대 ${job.expected} · 그림 ${count})`);
    const out: Buffer[] = [];
    for (let s = 0; s < count; s++) {
      const at: number = await page.evaluate((idx: number) => {
        const rail = (globalThis as any).document.querySelector('[data-hjl-carousel]') as any;
        if (!rail) return 0;
        rail.style.scrollBehavior = 'auto';
        rail.scrollLeft = idx * rail.clientWidth;
        return Math.round(rail.scrollLeft / Math.max(1, rail.clientWidth));
      }, s);
      if (at !== s) throw new Error(`장 넘김 실패(${s} → ${at})`);
      await sleep(150);
      // 글 칸이 넘쳐 스크롤이 필요하면 굽지 않는다(그림으로 찍으면 나머지 글을 못 읽는다 · 대체 = 앱이 글을 얹는다 · Codex 구현 1R ①)
      const overflow: boolean = await page.evaluate((idx: number) => {
        const d: any = (globalThis as any).document;
        const cell = d.querySelector(`[data-hjl-slide="${idx}"]`) || d.querySelector('[data-hjl-frame]');
        if (!cell) return false;
        return Array.from(cell.querySelectorAll('*') as any[]).some((el: any) => {
          const oy = (globalThis as any).getComputedStyle(el).overflowY;
          return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1;
        });
      }, s);
      if (overflow) throw Object.assign(new Error(`글 넘침(장 ${s})`), { inAppBakePermanent: true });
      // 요소 찍기는 넘김을 처음으로 되돌렸다(1108 시험) → 보이는 화면을 틀 상자로 잘라 찍는다
      const frame = await page.$('[data-hjl-frame]');
      const box = frame ? await frame.boundingBox() : null;
      if (!box) throw new Error('틀 상자 없음');
      // ★ C116-B D3 투명 바탕 PNG(둥근 모서리 밖 = 투명 → 무대색 · 흰 귀퉁이 0)
      const buf = await page.screenshot({ type: 'png', omitBackground: true, clip: box, captureBeyondViewport: false });
      out.push(Buffer.from(buf));
    }
    if (overflow) throw new Error('받은 바이트 상한 넘음');
    const finals: Buffer[] = [];
    for (let s = 0; s < out.length; s++) finals.push(await composeInAppBakeSlide(out[s], job.stages[s], !!job.full));
    return finals;
  } finally {
    await page.close().catch(() => {});
    if (browser) scheduleIdleClose();
  }
}

// ── 시험 전용 ─────────────────────────────────────────────────────────────
export const __inAppBakeTest = {
  setRunner(r: InAppBakeRunner, opts: { deadlineMs?: number; abort?: () => void } = {}): void {
    runner = r;
    jobDeadlineMs = opts.deadlineMs ?? INAPP_BAKE_JOB_DEADLINE_MS;
    abortCurrent = opts.abort ?? (() => {});
  },
  setImageBase(dir: string): void { imageBase = dir; },
  reset(): void {
    queue.length = 0; failedUntil.clear(); readyCache.clear(); inflight.clear(); supersededKeys.clear(); pumping = false;
    runner = (job) => runWithChrome(job); abortCurrent = () => killChrome(); jobDeadlineMs = INAPP_BAKE_JOB_DEADLINE_MS;
    imageBase = INAPP_IMAGE_BASE;
  },
  idle(): Promise<void> {
    return new Promise((resolve) => { const t = () => (pumping || queue.length ? setTimeout(t, 5) : resolve()); t(); });
  },
};
