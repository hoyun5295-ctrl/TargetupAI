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
  }
  return 0;
}

main().then((code) => process.exit(code)).catch((e) => { console.error('진단 실패:', e?.message || e); process.exit(1); });
