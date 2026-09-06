/**
 * ★ 2026-09-06 AI 영업 아웃리치 S1 — 렌더 크롤 워커(별도 PM2 프로세스 · DB 자격 없음 · 동시 1건)
 * 설계 = docs/2026-09-06-campaign-engine-design.md §S1 · 운영 = status/OPS.md §2-2-E ⑧
 *
 * 왜 별도 프로세스인가: 크롬이 메모리를 물고 죽어도 backend(발송 잠금·CAS·sweeper)가 같이 죽지 않는다.
 * 이 프로세스는 DB를 모른다. URL 하나를 받아 렌더 결과(HTML·텍스트·계측·선택 스크린샷)를 돌려주는 순수 함수 역할만 한다.
 *
 * SSRF 가드(불변 7): 크롬은 이 프로세스 안의 로컬 CONNECT/HTTP 프록시 뒤에서만 나간다.
 *  - 프록시가 목적지 호스트를 resolvePublicAddress(dm-brand-extractor · 유일 판정기)로 해석해 사설·예약이면 거절하고,
 *    그 검증 IP로만 소켓을 연다(pinnedLookup). 크롬 자체 DNS 0 → 재바인딩 창 0. 포트는 80·443·8080·8443 만.
 *  - page.on('request') 의 resourceType 차단·같은 사이트 문서 이동 판정은 보조층(sales-outreach-render-guard · 순수).
 *  - 다운로드 거부(Browser.setDownloadBehavior deny) · 잡당 바이트·벽시계 상한 · 렌더 중이 아닐 때 프록시는 전부 403.
 *
 * 프로세스 규율: 브라우저 1개 재사용 · 잡마다 BrowserContext 생성→종료 · 종료가 5초 안에 안 끝나면 SIGKILL 후 재기동 ·
 *  잡 시작마다 옛 프로필 디렉터리를 단 크롬 고아 프로세스(300초 초과) 수거.
 * HTTP API(127.0.0.1 만): POST /render {url, deadlineMs?, screenshot?} → {ok, ...} · 다른 렌더 진행 중이면 409 · GET /health.
 */
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import puppeteer, { type Browser, type BrowserContext, type HTTPRequest } from 'puppeteer';
import { resolvePublicAddress, pinnedLookup } from '../utils/dm/dm-brand-extractor';
import {
  decideRequest, parseConnectTarget, isAllowedProxyPort, clampDeadline, isSameSite, RENDER_DEFAULTS, type RenderMeta,
} from '../utils/sales-outreach-render-guard';

const LOG = '[outreach-render]';
const PORT = Number(process.env.OUTREACH_RENDER_PORT || 4317);
const PROFILE_MARK = 'outreach-render-profile';
const USER_AGENT = process.env.OUTREACH_RENDER_UA
  || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const FORCE_NO_SANDBOX = process.env.OUTREACH_RENDER_NO_SANDBOX === '1';
const CONTEXT_CLOSE_GRACE_MS = 5_000;
const ORPHAN_AGE_SEC = 300;

// ===== 잡 상태(동시 1건) =====

interface ActiveJob {
  initialHost: string;
  bytes: number;
  maxBytes: number;
  blocked: number;
  overBudget: boolean;
}
let active: ActiveJob | null = null;

// ===== 로컬 프록시(크롬 → 여기 → 검증 IP) =====

function denyConnect(socket: net.Socket): void {
  try { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); } catch { /* 이미 닫힘 */ }
}

const proxy = http.createServer((req, res) => {
  void (async () => {
    if (!active) { res.writeHead(403); res.end(); return; }
    let u: URL;
    try { u = new URL(req.url || ''); } catch { res.writeHead(400); res.end(); return; }
    const port = u.port ? Number(u.port) : 80;
    if (u.protocol !== 'http:' || !isAllowedProxyPort(port)) { active.blocked++; res.writeHead(403); res.end(); return; }
    const pinned = await resolvePublicAddress(u.hostname.toLowerCase()).catch(() => null);
    if (!pinned) { active.blocked++; res.writeHead(403); res.end(); return; }
    const headers: Record<string, string | string[] | undefined> = { ...req.headers };
    delete headers['proxy-connection']; delete headers['proxy-authorization'];
    const up = http.request(
      { host: u.hostname, port, path: `${u.pathname}${u.search}` || '/', method: req.method, headers, lookup: pinnedLookup(pinned) as never, timeout: 15_000 },
      (ur) => {
        res.writeHead(ur.statusCode || 502, ur.headers);
        ur.on('data', (c: Buffer) => { if (active) { active.bytes += c.length; if (active.bytes > active.maxBytes) { active.overBudget = true; ur.destroy(); res.destroy(); } } });
        ur.pipe(res);
      },
    );
    up.on('timeout', () => up.destroy(new Error('timeout')));
    up.on('error', () => { try { res.writeHead(502); res.end(); } catch { /* 닫힘 */ } });
    req.pipe(up);
  })();
});

proxy.on('connect', (req, clientSocket: net.Socket, head: Buffer) => {
  void (async () => {
    if (!active) { denyConnect(clientSocket); return; }
    const target = parseConnectTarget(req.url || '');
    if (!target || !isAllowedProxyPort(target.port)) { active.blocked++; denyConnect(clientSocket); return; }
    const pinned = await resolvePublicAddress(target.host).catch(() => null);
    if (!pinned || !active) { if (active) active.blocked++; denyConnect(clientSocket); return; }
    const upstream = net.connect({ host: pinned.address, port: target.port, family: pinned.family as 4 | 6 });
    upstream.setTimeout(15_000, () => upstream.destroy());
    upstream.on('connect', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('data', (c: Buffer) => {
      if (!active) return;
      active.bytes += c.length;
      if (active.bytes > active.maxBytes) { active.overBudget = true; upstream.destroy(); clientSocket.destroy(); }
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
    clientSocket.on('close', () => upstream.destroy());
  })();
});

// ===== 브라우저 수명 =====

let browser: Browser | null = null;
let browserSandbox = true;
let launchSeq = 0;
let currentProfileDir: string | null = null;

async function launchBrowser(proxyPort: number): Promise<Browser> {
  launchSeq++;
  const profileDir = path.join(os.tmpdir(), `${PROFILE_MARK}-${process.pid}-${launchSeq}`);
  const baseArgs = [
    `--proxy-server=http://127.0.0.1:${proxyPort}`,
    '--proxy-bypass-list=<-loopback>',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--mute-audio',
    '--lang=ko-KR',
  ];
  const tryLaunch = (noSandbox: boolean) => puppeteer.launch({
    headless: true,
    userDataDir: profileDir,
    args: noSandbox ? [...baseArgs, '--no-sandbox', '--disable-setuid-sandbox'] : baseArgs,
    protocolTimeout: 60_000,
  });
  let b: Browser;
  if (FORCE_NO_SANDBOX) {
    b = await tryLaunch(true); browserSandbox = false;
  } else {
    try {
      b = await tryLaunch(false); browserSandbox = true;
    } catch (e: any) {
      // Ubuntu 24.04 계열은 비특권 사용자 네임스페이스를 막아 sandbox 기동이 실패한다. 트래픽은 프록시가 가두므로 --no-sandbox 로 재시도하고 그 사실을 남긴다.
      console.warn(`${LOG} sandbox 기동 실패 → --no-sandbox 재시도: ${String(e?.message || e).slice(0, 160)}`);
      b = await tryLaunch(true); browserSandbox = false;
    }
  }
  currentProfileDir = profileDir;
  try {
    const session = await b.target().createCDPSession();
    await session.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    await session.detach().catch(() => undefined);
  } catch (e: any) {
    console.warn(`${LOG} 다운로드 거부 설정 실패(계속): ${String(e?.message || e).slice(0, 120)}`);
  }
  b.on('disconnected', () => { if (browser === b) browser = null; });
  console.log(`${LOG} 크롬 기동 (sandbox=${browserSandbox} · 프로필 ${profileDir})`);
  return b;
}

async function ensureBrowser(proxyPort: number): Promise<Browser> {
  if (browser && browser.connected) return browser;
  browser = await launchBrowser(proxyPort);
  return browser;
}

function killBrowser(reason: string): void {
  const b = browser;
  browser = null;
  if (!b) return;
  console.warn(`${LOG} 크롬 강제 종료: ${reason}`);
  try { b.process()?.kill('SIGKILL'); } catch { /* 이미 종료 */ }
}

/** 옛 프로필을 단 크롬 고아 프로세스 수거(Linux) — 현재 살아 있는 프로필은 건드리지 않는다. */
function reapOrphans(): number {
  if (process.platform !== 'linux') return 0;
  let killed = 0;
  try {
    const out = execSync(`pgrep -af -- ${PROFILE_MARK} || true`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of out.split('\n')) {
      const m = line.match(/^(\d+)\s+(.*)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      const cmd = m[2];
      if (pid === process.pid) continue;
      if (currentProfileDir && cmd.includes(currentProfileDir)) continue;
      let age = 0;
      try { age = Number(execSync(`ps -o etimes= -p ${pid}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 0); } catch { continue; }
      if (age < ORPHAN_AGE_SEC) continue;
      try { process.kill(pid, 'SIGKILL'); killed++; } catch { /* 이미 없음 */ }
    }
  } catch { /* pgrep 부재 등 — 수거 없이 진행 */ }
  if (killed) console.warn(`${LOG} 고아 크롬 ${killed}개 수거`);
  return killed;
}

// ===== 렌더 1건 =====

interface RenderRequest { url: string; deadlineMs?: number; screenshot?: boolean; viewportWidth?: number }
interface RenderOk {
  ok: true; finalUrl: string; html: string; text: string; screenshotBase64: string | null; meta: RenderMeta;
}
interface RenderFail { ok: false; reason: 'blocked' | 'timeout' | 'error'; detail: string; meta?: Partial<RenderMeta> }

async function renderOnce(input: RenderRequest, proxyPort: number): Promise<RenderOk | RenderFail> {
  const t0 = Date.now();
  let target: URL;
  try { target = new URL(input.url); } catch { return { ok: false, reason: 'blocked', detail: 'URL 형식 불명' }; }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return { ok: false, reason: 'blocked', detail: 'http(s) 아님' };
  const initialHost = target.hostname.toLowerCase();
  const pinned = await resolvePublicAddress(initialHost).catch(() => null);
  if (!pinned) return { ok: false, reason: 'blocked', detail: '호스트가 공인 주소로 해석되지 않음' };
  const deadlineMs = clampDeadline(input.deadlineMs);
  const wantShot = !!input.screenshot;
  // ★ S3 모바일 폭 캡처(375) — DM 채점은 사람이 보는 폭으로 본다 · 기본 1280
  const viewportWidth = Math.min(1920, Math.max(320, Math.floor(Number(input.viewportWidth) || 1280)));

  reapOrphans();
  const b = await ensureBrowser(proxyPort);
  active = { initialHost, bytes: 0, maxBytes: RENDER_DEFAULTS.maxBytes, blocked: 0, overBudget: false };
  let context: BrowserContext | null = null;
  let navigations = 0;
  let timedOut = false;
  const remaining = () => Math.max(500, deadlineMs - (Date.now() - t0));
  try {
    context = await b.createBrowserContext();
    const page = await context.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: viewportWidth, height: 900, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('dialog', (d) => { d.dismiss().catch(() => undefined); });
    page.on('request', (req: HTTPRequest) => {
      const isMain = req.frame() === page.mainFrame();
      const type = req.resourceType();
      if (type === 'document' && isMain) navigations++;
      const decision = navigations > RENDER_DEFAULTS.maxNavigations
        ? 'abort'
        : decideRequest({ resourceType: type, url: req.url(), initialHost, isMainFrame: isMain });
      if (decision === 'abort') { if (active) active.blocked++; req.abort('blockedbyclient').catch(() => undefined); return; }
      req.continue().catch(() => undefined);
    });

    try {
      await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: Math.min(remaining(), 30_000) });
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/net::ERR_BLOCKED_BY_CLIENT|ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY/i.test(msg)) return { ok: false, reason: 'blocked', detail: `이동 차단: ${msg.slice(0, 120)}` };
      if (/Timeout/i.test(msg)) timedOut = true; else return { ok: false, reason: 'error', detail: msg.slice(0, 160) };
    }
    if (!timedOut) await page.waitForNetworkIdle({ idleTime: 800, timeout: Math.min(remaining(), 12_000) }).catch(() => { timedOut = true; });
    const finalUrl = page.url();
    let finalHost = '';
    try { finalHost = new URL(finalUrl).hostname.toLowerCase(); } catch { finalHost = ''; }
    if (!finalHost || !isSameSite(initialHost, finalHost)) return { ok: false, reason: 'blocked', detail: `최종 호스트 이탈: ${finalHost || finalUrl.slice(0, 80)}` };

    // 지연 로딩 이미지 확보 — 끝까지 훑는다(예산 안에서)
    if (remaining() > 2_500) {
      // 문자열 평가 — 백엔드 tsconfig 에 DOM 타입이 없어 페이지 쪽 코드는 문자열로 넘긴다(전역 타입 오염 0)
      await page.evaluate(`(async () => {
        const step = 500;
        const max = Math.min(document.documentElement.scrollHeight + step, 30000);
        for (let y = 0; y < max; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
        window.scrollTo(0, 0);
      })()`).catch(() => undefined);
      await new Promise((r) => setTimeout(r, Math.min(1_200, remaining() - 500)));
    }
    if (active?.overBudget) return { ok: false, reason: 'error', detail: `바이트 상한 초과(${active.maxBytes})` };

    const maxHtml = RENDER_DEFAULTS.maxHtmlChars;
    const maxText = RENDER_DEFAULTS.maxTextChars;
    const dom = (await page.evaluate(`(() => {
      const html = document.documentElement ? document.documentElement.outerHTML : '';
      const text = (document.body && document.body.innerText) || '';
      const imgs = Array.from(document.images);
      return {
        html: html.slice(0, ${maxHtml}),
        text: text.slice(0, ${maxText}),
        imgCount: imgs.length,
        imgWide: imgs.filter((i) => i.naturalWidth >= 600).length,
        scrollHeight: document.documentElement.scrollHeight,
      };
    })()`)) as { html: string; text: string; imgCount: number; imgWide: number; scrollHeight: number };

    let screenshotBase64: string | null = null;
    if (wantShot && remaining() > 1_500) {
      try {
        const h = Math.min(Math.max(900, dom.scrollHeight), RENDER_DEFAULTS.maxScreenshotHeight);
        const shot = await page.screenshot({ type: 'jpeg', quality: 60, clip: { x: 0, y: 0, width: viewportWidth, height: h }, captureBeyondViewport: true });
        screenshotBase64 = Buffer.from(shot).toString('base64');
      } catch (e: any) {
        console.warn(`${LOG} 스크린샷 실패(계속): ${String(e?.message || e).slice(0, 120)}`);
      }
    }
    const meta: RenderMeta = {
      engine: 'chrome',
      elapsedMs: Date.now() - t0,
      bytes: active?.bytes || 0,
      blockedRequests: active?.blocked || 0,
      navigations,
      textChars: dom.text.length,
      imgCount: dom.imgCount,
      imgWide: dom.imgWide,
      sandbox: browserSandbox,
      timedOut,
    };
    return { ok: true, finalUrl, html: dom.html, text: dom.text, screenshotBase64, meta };
  } catch (e: any) {
    return { ok: false, reason: 'error', detail: String(e?.message || e).slice(0, 160), meta: { elapsedMs: Date.now() - t0, blockedRequests: active?.blocked || 0 } };
  } finally {
    active = null;
    if (context) {
      const closed = await Promise.race([
        context.close().then(() => true).catch(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), CONTEXT_CLOSE_GRACE_MS)),
      ]);
      if (!closed) killBrowser('컨텍스트 종료 5초 초과');
    }
  }
}

// ===== HTTP API(127.0.0.1) =====

function readJson(req: http.IncomingMessage, limit = 65_536): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}

let busy = false;

async function main(): Promise<void> {
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', () => resolve()));
  const proxyPort = (proxy.address() as AddressInfo).port;

  const api = http.createServer((req, res) => {
    void (async () => {
      const url = req.url || '/';
      if (req.method === 'GET' && url === '/health') {
        send(res, 200, { ok: true, busy, browser: !!(browser && browser.connected), sandbox: browserSandbox, proxyPort });
        return;
      }
      if (req.method === 'POST' && url === '/render') {
        if (busy) { send(res, 409, { ok: false, reason: 'busy' }); return; }
        busy = true;
        try {
          const body = (await readJson(req)) as RenderRequest;
          if (!body || typeof body.url !== 'string') { send(res, 400, { ok: false, reason: 'error', detail: 'url 필요' }); return; }
          const out = await renderOnce(body, proxyPort);
          if (out.ok) console.log(`${LOG} 렌더 ok ${body.url} · ${out.meta.elapsedMs}ms · ${out.meta.bytes}B · 차단 ${out.meta.blockedRequests} · 텍스트 ${out.meta.textChars}자`);
          else console.warn(`${LOG} 렌더 실패 ${body.url} · ${out.reason} · ${out.detail}`);
          send(res, 200, out);
        } catch (e: any) {
          send(res, 500, { ok: false, reason: 'error', detail: String(e?.message || e).slice(0, 160) });
        } finally {
          busy = false;
        }
        return;
      }
      send(res, 404, { ok: false, reason: 'error', detail: 'not found' });
    })();
  });
  api.requestTimeout = 90_000;
  api.headersTimeout = 20_000;
  await new Promise<void>((resolve) => api.listen(PORT, '127.0.0.1', () => resolve()));
  console.log(`${LOG} 시작 (포트 ${PORT} · 프록시 ${proxyPort} · 동시 1 · sandbox 강제해제=${FORCE_NO_SANDBOX})`);

  const shutdown = (sig: string) => {
    console.log(`${LOG} 종료 신호 ${sig}`);
    try { api.close(); } catch { /* 무시 */ }
    try { proxy.close(); } catch { /* 무시 */ }
    const b = browser; browser = null;
    if (b) b.close().catch(() => { try { b.process()?.kill('SIGKILL'); } catch { /* 무시 */ } });
    setTimeout(() => process.exit(0), 1_500).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error(`${LOG} 기동 실패:`, e?.message || e);
  process.exit(2);
});
