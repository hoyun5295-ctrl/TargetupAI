/**
 * diagnose-woo-headers.ts — 우커머스 몰의 "인증된" REST 응답 헤더 크기 실측 (1회성 · 읽기 전용)
 *
 * 왜: 연결 확인 1콜(GET /wp-json/wc/v3/orders?per_page=1)이 HPE_HEADER_OVERFLOW 로 떨어진다.
 *     = 몰 응답 헤더가 Node 수신 상한(기본 16,384 bytes)을 넘는다. 키 없이 재면 1KB대라 인증 응답에서만 커진다.
 *     어느 헤더가 몇 바이트인지 알아야 wooRequest 수신 상한을 얼마로 올릴지 정할 수 있다.
 *
 * 실행(운영 서버):
 *   cd packages/backend && npx ts-node scripts/diagnose-woo-headers.ts iroirotokyo.net
 *   (비인증 기준선만: … www.iroirotokyo.net --anon  — DB·키를 쓰지 않는다)
 *   (--consent 를 붙이면 최근 주문 20건·최근 가입 회원 20명의 동의 관련 메타키와 값 분포·회원 역할 분포를 집계한다 · 개인정보 출력 없음)
 *   (--timing 을 붙이면 백필과 같은 호출 6개(회원·주문 × per_page 1·20·100)의 소요 시간·본문 크기·전체 건수를 잰다 · GET 뿐)
 *
 * 하는 일: company_integrations 에서 그 몰 행을 SELECT 1회 → 저장된 REST 키로 같은 주소를 2번 GET
 *   ① 기본 상한 그대로(운영과 같은 조건 · 오류 재현 확인)  ② 상한 1MB(헤더 전부 받아 이름·길이 집계)
 * 안 하는 일: DB 쓰기 0 · 몰 쪽 변경 0(GET per_page=1 뿐) · 키·쿠키·헤더 "값" 출력 0(이름과 길이만).
 *
 * ⛔ src/utils/woocommerce-* 를 import 하지 않는다 — config/database 가 따라 올라와 PG 풀(20)·MySQL 연결까지 연다.
 *    진단이 운영 자원을 잡으면 안 되므로 pg Client 1개만 쓴다. 기준 주소 산출은 woocommerce-client.ts wooRestBase 와 같은 규칙이다.
 */
import 'dotenv/config';
import * as http from 'http';
import * as https from 'https';
import { Client } from 'pg';

const USER_AGENT = 'Hanjullo-CDP/1.0'; // woocommerce-client.ts 와 같은 값(몰이 UA 로 응답을 달리할 수 있다)
const TIMEOUT_MS = 20000;
const WIDE_LIMIT = 1024 * 1024;

interface Row { company_id: string; mall_id: string; status: string; meta: any }

/** woocommerce-client.ts wooRestBase 와 같은 규칙 — 저장 주소의 호스트(www 뗀 값)가 몰 식별자와 같을 때만 그 호스트를 쓴다 */
function restBase(row: Row): string {
  const saved = String(row.meta?.woo_site_url || '').trim();
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(saved) ? saved : `https://${saved}`).hostname.toLowerCase();
    if (host.replace(/^www\./, '') === row.mall_id) return `https://${host}`;
  } catch { /* 아래 폴백 */ }
  return `https://${row.mall_id}`;
}

interface Probe { ok: boolean; status?: number; rawHeaders?: string[]; errorCode?: string }

function probe(url: string, auth: string | null, maxHeaderSize?: number): Promise<Probe> {
  return new Promise((resolve) => {
    const req = https.request(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...(auth ? { Authorization: auth } : {}) },
      timeout: TIMEOUT_MS,
      ...(maxHeaderSize ? { maxHeaderSize } : {}),
    }, (res) => {
      res.resume(); // 본문은 버린다(주문 내용 출력 금지)
      res.on('end', () => resolve({ ok: true, status: res.statusCode, rawHeaders: res.rawHeaders }));
      res.on('error', (e: any) => resolve({ ok: false, errorCode: e?.code || e?.message }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e: any) => resolve({ ok: false, errorCode: e?.code || e?.message }));
    req.end();
  });
}

// ── --timing: 백필이 부르는 것과 같은 호출의 소요 시간 실측(★0921 · 회원 100명 1페이지가 20초 제한에 걸린 건) ──
const TIMING_TIMEOUT_MS = 90000;

interface Timed { ok: boolean; ms: number; status?: number; bodyBytes?: number; total?: string; totalPages?: string; errorCode?: string }

function timed(url: string, auth: string | null): Promise<Timed> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = https.request(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...(auth ? { Authorization: auth } : {}) },
      timeout: TIMING_TIMEOUT_MS,
      maxHeaderSize: WIDE_LIMIT,
    }, (res) => {
      let bodyBytes = 0;
      res.on('data', (c: Buffer) => { bodyBytes += c.length; }); // 크기만 센다(본문 출력 금지)
      res.on('end', () => resolve({
        ok: true, ms: Date.now() - t0, status: res.statusCode, bodyBytes,
        total: String(res.headers['x-wp-total'] ?? '-'), totalPages: String(res.headers['x-wp-totalpages'] ?? '-'),
      }));
      res.on('error', (e: any) => resolve({ ok: false, ms: Date.now() - t0, errorCode: e?.code || e?.message }));
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${TIMING_TIMEOUT_MS}ms`)));
    req.on('error', (e: any) => resolve({ ok: false, ms: Date.now() - t0, errorCode: e?.code || e?.message }));
    req.end();
  });
}

async function timingSeries(label: string, urls: { name: string; url: string }[], auth: string | null): Promise<void> {
  console.log(`\n[소요 시간 · ${label} · 호출당 제한 ${TIMING_TIMEOUT_MS / 1000}초 · 운영 코드 제한 = 20초]`);
  console.log('ms\tHTTP\t본문bytes\t전체건수\t전체쪽수\t호출');
  for (const u of urls) {
    const r = await timed(u.url, auth);
    console.log(r.ok
      ? `${r.ms}\t${r.status}\t${r.bodyBytes}\t${r.total}\t${r.totalPages}\t${u.name}`
      : `${r.ms}\t오류 ${r.errorCode}\t-\t-\t-\t${u.name}`);
  }
}

/** 백필과 같은 파라미터(woocommerce-client.ts backfillWooCustomers · backfillWooOrders) — per_page 만 1 · 20 · 100 으로 바꿔 잰다 */
function backfillUrls(base: string): { name: string; url: string }[] {
  const after = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '');
  const out: { name: string; url: string }[] = [];
  for (const n of [1, 20, 100]) out.push({ name: `customers per_page=${n}`, url: `${base}/wp-json/wc/v3/customers?per_page=${n}&orderby=registered_date&order=desc&page=1` });
  // ★0921 실측: 위 호출(역할 기본값)의 전체건수가 0 이었다 → 역할을 가리지 않으면 몇 명인지 건수만 본다(본문 출력 없음)
  out.push({ name: 'customers role=all per_page=1', url: `${base}/wp-json/wc/v3/customers?per_page=1&role=all&orderby=registered_date&order=desc&page=1` });
  for (const n of [1, 20, 100]) out.push({ name: `orders(90일) per_page=${n}`, url: `${base}/wp-json/wc/v3/orders?per_page=${n}&after=${encodeURIComponent(after)}&dates_are_gmt=true&orderby=date&order=asc&page=1` });
  return out;
}

// ── --consent: 수신동의 메타키가 REST 응답에 실제로 오는지 · 값이 무슨 모양인지 집계(★0921) ──
//    출력 = 키 · 값(24자까지) · 건수 · 회원 역할 분포. 이름·전화·이메일·주문 내용은 출력하지 않는다.
const CONSENT_KEY_RE = /agree|consent|mssms|marketing|optin|opt_in|수신|동의/i;

function fetchJson(url: string, auth: string): Promise<{ ok: boolean; status?: number; data?: any; errorCode?: string }> {
  return new Promise((resolve) => {
    const req = https.request(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, Authorization: auth },
      timeout: TIMING_TIMEOUT_MS,
      maxHeaderSize: WIDE_LIMIT,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try { resolve({ ok: true, status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { resolve({ ok: false, status: res.statusCode, errorCode: 'JSON 아님' }); }
      });
      res.on('error', (e: any) => resolve({ ok: false, errorCode: e?.code || e?.message }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e: any) => resolve({ ok: false, errorCode: e?.code || e?.message }));
    req.end();
  });
}

function tallyConsent(label: string, items: any[], extra?: (it: any, bump: (k: string) => void) => void): void {
  const counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) || 0) + 1);
  let withAny = 0;
  for (const it of items) {
    let hit = false;
    for (const m of Array.isArray(it?.meta_data) ? it.meta_data : []) {
      const key = String(m?.key ?? '');
      if (!CONSENT_KEY_RE.test(key)) continue;
      hit = true;
      const v = m?.value;
      const shown = (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)).slice(0, 24);
      bump(`${key} = "${shown}"`);
    }
    if (hit) withAny++;
    if (extra) extra(it, bump);
  }
  console.log(`\n[수신동의 집계 · ${label} · 표본 ${items.length}건 · 동의 관련 키가 하나라도 있는 건 ${withAny}]`);
  if (counts.size === 0) { console.log('(동의 관련 키 없음)'); return; }
  console.log('건수\t키 = "값"');
  [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, n]) => console.log(`${n}\t${k}`));
}

async function consentSeries(base: string, auth: string): Promise<void> {
  const o = await fetchJson(`${base}/wp-json/wc/v3/orders?per_page=20&orderby=date&order=desc`, auth);
  if (o.ok && Array.isArray(o.data)) {
    tallyConsent('최근 주문', o.data, (it, bump) => bump(`(주문) 회원 주문 여부 = "${Number(it?.customer_id) > 0 ? '회원' : '비회원'}"`));
  } else console.log(`\n[수신동의 집계 · 최근 주문] 실패 HTTP ${o.status ?? '-'} ${o.errorCode ?? ''}`);

  const c = await fetchJson(`${base}/wp-json/wc/v3/customers?per_page=20&role=all&orderby=registered_date&order=desc`, auth);
  if (c.ok && Array.isArray(c.data)) {
    tallyConsent('최근 가입 회원(역할 무관)', c.data, (it, bump) => bump(`(회원) role = "${String(it?.role ?? '')}"`));
  } else console.log(`\n[수신동의 집계 · 최근 가입 회원] 실패 HTTP ${c.status ?? '-'} ${c.errorCode ?? ''}`);
}

/** 헤더 1줄이 전선에서 차지하는 크기 = "이름: 값\r\n" */
const lineBytes = (name: string, value: string): number => Buffer.byteLength(`${name}: ${value}\r\n`);

function report(rawHeaders: string[]): void {
  const lines: { name: string; label: string; bytes: number }[] = [];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    const name = rawHeaders[i];
    const value = rawHeaders[i + 1];
    // Set-Cookie 는 쿠키 "이름"까지만(값은 세션일 수 있다) · 그 밖은 헤더 이름만
    const label = /^set-cookie$/i.test(name) ? `${name} [${value.split('=')[0].slice(0, 60)}]` : name;
    lines.push({ name, label, bytes: lineBytes(name, value) });
  }
  const total = lines.reduce((s, l) => s + l.bytes, 0);
  console.log(`헤더 줄 수 = ${lines.length} · 헤더 합계 = ${total} bytes (Node 기본 상한 = ${http.maxHeaderSize})`);

  // 이름 묶음 — 번호만 다른 헤더(x-foo-1, x-foo-2 …)는 한 묶음으로
  const groups = new Map<string, { count: number; bytes: number }>();
  for (const l of lines) {
    const key = l.name.toLowerCase().replace(/\d+/g, '#');
    const g = groups.get(key) || { count: 0, bytes: 0 };
    g.count++; g.bytes += l.bytes;
    groups.set(key, g);
  }
  console.log('\n[이름 묶음별 합계 · 큰 순 15]');
  console.log('bytes\t줄수\t이름');
  [...groups.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 15)
    .forEach(([k, g]) => console.log(`${g.bytes}\t${g.count}\t${k}`));

  console.log('\n[단일 헤더 · 큰 순 15]');
  console.log('bytes\t이름');
  [...lines].sort((a, b) => b.bytes - a.bytes).slice(0, 15).forEach((l) => console.log(`${l.bytes}\t${l.label}`));
}

async function main(): Promise<number> {
  const rawHost = String(process.argv[2] || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const mallId = rawHost.replace(/^www\./, '');
  if (!mallId) { console.error('사용법: npx ts-node scripts/diagnose-woo-headers.ts <몰 식별자 예: iroirotokyo.net> [--anon]'); return 2; }

  console.log(`node ${process.version} · http.maxHeaderSize(이 셸 기준) = ${http.maxHeaderSize} · NODE_OPTIONS = ${process.env.NODE_OPTIONS || '(없음)'}`);

  // --anon = DB·키 없이 같은 주소를 잰다(비인증 기준선 · 집계 코드 점검용). 주소는 입력한 호스트 그대로(www 유지).
  if (process.argv.includes('--anon')) {
    const url = `https://${rawHost}/wp-json/wc/v3/orders?per_page=1`;
    console.log(`GET ${url} (키 없음)`);
    const r = await probe(url, null, WIDE_LIMIT);
    if (!r.ok) { console.log(`오류 ${r.errorCode}`); return 1; }
    console.log(`HTTP ${r.status}`);
    report(r.rawHeaders || []);
    // 키가 없으니 공개 Store API 로 시간 재는 코드만 점검한다
    if (process.argv.includes('--timing')) {
      await timingSeries('공개 상품(키 없음)', [1, 20, 100].map((n) => ({ name: `store products per_page=${n}`, url: `https://${rawHost}/wp-json/wc/store/v1/products?per_page=${n}` })), null);
    }
    return 0;
  }
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL 이 없습니다. packages/backend 에서 실행했는지 확인해주세요.'); return 2; }

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let rows: Row[];
  try {
    const r = await db.query(
      `SELECT company_id, mall_id, status, meta FROM company_integrations
       WHERE provider = 'woocommerce' AND mall_id = $1 AND status <> 'revoked'
       ORDER BY created_at ASC`,
      [mallId],
    );
    rows = r.rows;
  } finally {
    await db.end();
  }
  if (rows.length === 0) { console.error(`몰 행이 없습니다(해제 제외): ${mallId}`); return 1; }

  for (const row of rows) {
    const ck = String(row.meta?.woo_consumer_key || '');
    const cs = String(row.meta?.woo_consumer_secret || '');
    console.log(`\n════ company=${row.company_id} mall=${row.mall_id} status=${row.status} 키보유=${!!(ck && cs)} 권한=${row.meta?.woo_key_permissions || '(직접 입력)'}`);
    console.log(`기록된 오류 = ${row.meta?.woo_sync_error_code || '-'} @ ${row.meta?.woo_sync_error_at || '-'}`);
    if (!ck || !cs) { console.log('REST 키가 없어 건너뜁니다.'); continue; }

    const url = `${restBase(row)}/wp-json/wc/v3/orders?per_page=1`;
    const auth = 'Basic ' + Buffer.from(`${ck}:${cs}`).toString('base64');
    console.log(`GET ${url}`);

    const a = await probe(url, auth);
    console.log(`① 기본 상한: ${a.ok ? `HTTP ${a.status}` : `오류 ${a.errorCode}`}`);

    const b = await probe(url, auth, WIDE_LIMIT);
    if (!b.ok) { console.log(`② 상한 ${WIDE_LIMIT}: 오류 ${b.errorCode}`); continue; }
    console.log(`② 상한 ${WIDE_LIMIT}: HTTP ${b.status}`);
    report(b.rawHeaders || []);
    if (process.argv.includes('--timing')) await timingSeries('백필과 같은 호출', backfillUrls(restBase(row)), auth);
    if (process.argv.includes('--consent')) {
      console.log(`\n한줄로에 저장된 수신동의 키 = ${row.meta?.woo_consent_meta_key || '(미설정)'}`);
      await consentSeries(restBase(row), auth);
    }
  }
  return 0;
}

main().then((code) => process.exit(code)).catch((e) => { console.error('진단 실패:', e?.message || e); process.exit(1); });
