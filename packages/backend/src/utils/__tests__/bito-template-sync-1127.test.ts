// replaces: none
/**
 * 한줄로 승인 알림톡 템플릿 → 비토 등록부 자동 연결(★2026-11-27 · 설계서 docs/2026-11-27-bito-template-auto-link-design.md §3-1 · §6 한줄로)
 *   결과 꼴 검사 · 경보 고르기(종류 둘 고정 → 공용 주기 경보 문자에 둘 다 실림) · 입구 · 배선. 목록 SQL = bito-template-sync-1127.pg.test.ts(실 PG).
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { readFileSync } from 'fs';
import { join } from 'path';

/** 경보 원장 표 흉내(system_alert_pending · alert-pass-failures-1101.test.ts 와 같은 꼴) · 그 밖 SQL = 빈 결과 */
const ledger = new Map<string, any>();
let seq = 0;
vi.mock('../internal-company', () => ({ isInternalCompany: vi.fn(async () => false) }));
vi.mock('../../config/database', () => ({
  query: vi.fn(async (sql: string, params: any[] = []) => {
    if (!sql.includes('system_alert_pending')) return { rows: [] };
    if (sql.startsWith('INSERT')) {
      const [pass, keys, cos, errs, title, action, total] = params;
      keys.forEach((k: string, i: number) => {
        const id = `${pass}\u0001${k}`;
        if (!ledger.has(id)) ledger.set(id, { pass, item_key: k, company_id: cos[i], error: errs[i], title, action, total, seq: seq++ });
      });
      return { rows: [] };
    }
    if (sql.includes('SELECT DISTINCT pass')) return { rows: [] };
    if (sql.startsWith('SELECT')) return { rows: [...ledger.values()].filter((r) => r.pass === params[0]).sort((a, b) => a.seq - b.seq) };
    if (sql.startsWith('DELETE')) { for (const k of params[1]) ledger.delete(`${params[0]}\u0001${k}`); return { rows: [] }; }
    return { rows: [] };
  }),
  default: { connect: vi.fn() },
  pool: { connect: vi.fn() },
}));

import express from 'express';
import {
  parseBitoTemplateResults, bitoTemplateAlertFailures, BITO_TEMPLATE_ALERT_KIND, BITO_TEMPLATE_OUTCOMES, BITO_TEMPLATE_ACCOUNT_OUTCOMES,
} from '../bito-template-sync';
import { isImcInternalTemplateKey } from '../kakao-template-guard-core';
import { alertPassFailures } from '../system-alert';
import bitoSyncRouter from '../../routes/bito-sync';
import { stripComments } from './helpers/producer-scan';

const BE = join(__dirname, '..', '..');
const src = (rel: string) => stripComments(readFileSync(join(BE, rel), 'utf8').replace(/\r\n/g, '\n'));
const GW = '58.227.193.65';
const TOKEN = 't'.repeat(40);
const CO = '11111111-2222-3333-4444-555555555555';
const TP = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const acc = (outcome: string) => ({ companyId: CO, agentSendId: 'V0012', outcome, reason: null });
const tpl = (outcome: string, templateId = TP) => ({ companyId: CO, agentSendId: 'V0012', templateId, templateCode: 'B_IV_013_02_80287', outcome, reason: null });
const ALERT_TEMPLATE = ['conflict_existing', 'code_ambiguous', 'invalid', 'sync_error', 'profile_missing'];
const QUIET_TEMPLATE = ['registered', 'same', 'profile_inactive', 'busy'];
const QUIET_ACCOUNT = ['ok', 'unmapped', 'agent_inactive', 'no_sender_account', 'no_registry'];

describe('내부 키 판정', () => {
  it('Tm 으로 시작 = 내부 키 · 진짜 코드 · 소문자 = 아님', () => {
    for (const c of ['Tmp_0001', 'Tmo12', 'Tmq_x']) expect(isImcInternalTemplateKey(c)).toBe(true);
    for (const c of ['B_IV_013_02_80287', 'tmp_1', 'XTm', '']) expect(isImcInternalTemplateKey(c)).toBe(false);
  });
});

describe('결과 꼴 검사', () => {
  it('맞는 꼴 = 그대로 · 빈 배열도 받는다', () => {
    const body = { accounts: [acc('ok')], templates: [tpl('registered')] };
    expect(parseBitoTemplateResults(body)).toEqual(body);
    expect(parseBitoTemplateResults({ accounts: [], templates: [] })).toEqual({ accounts: [], templates: [] });
  });
  it('하나라도 틀리면 통째로 null', () => {
    for (const bad of [
      {},
      { accounts: [] },
      { templates: [] },
      { accounts: [{ ...acc('ok'), companyId: 'x' }], templates: [] },
      { accounts: [{ ...acc('ok'), agentSendId: 'B0015' }], templates: [] },
      { accounts: [acc('registered')], templates: [] },
      { accounts: [{ ...acc('ok'), reason: 3 }], templates: [] },
      { accounts: [], templates: [{ ...tpl('same'), templateId: 'x' }] },
      { accounts: [], templates: [{ ...tpl('same'), templateCode: 7 }] },
      { accounts: [], templates: [{ ...tpl('same'), templateCode: 'x'.repeat(201) }] },
      { accounts: [], templates: [tpl('ok')] },
      { accounts: [], templates: [tpl('would_register')] },
      { accounts: [], templates: [{ ...tpl('same'), agentSendId: 'v0012' }] },
    ]) expect(parseBitoTemplateResults(bad)).toBeNull();
  });
  it('결과 이름 = 설계 §3-1 그대로', () => {
    expect([...BITO_TEMPLATE_ACCOUNT_OUTCOMES].sort()).toEqual([...QUIET_ACCOUNT, 'mapping_conflict'].sort());
    expect([...BITO_TEMPLATE_OUTCOMES].sort()).toEqual([...ALERT_TEMPLATE, ...QUIET_TEMPLATE].sort());
  });
});

describe('경보 고르기', () => {
  it('경보 대상 여섯만 · 종류 이름 둘 · 항목 키 · 글에 숫자 · V · 코드 0', () => {
    const r = {
      accounts: [...QUIET_ACCOUNT.map(acc), acc('mapping_conflict')],
      templates: [...QUIET_TEMPLATE.map((o) => tpl(o)), ...ALERT_TEMPLATE.map((o, i) => tpl(o, TP.replace(/e$/, String(i))))],
    } as any;
    const f = bitoTemplateAlertFailures(r);
    expect(f).toHaveLength(6);
    expect(f[0]).toEqual({ companyId: CO, key: 'V0012|-|mapping_conflict', error: BITO_TEMPLATE_ALERT_KIND.account });
    expect(f.slice(1).map((x) => x.error)).toEqual(Array(5).fill(BITO_TEMPLATE_ALERT_KIND.template));
    expect(f.slice(1).map((x) => x.key)).toEqual(ALERT_TEMPLATE.map((o, i) => `V0012|${TP.replace(/e$/, String(i))}|${o}`));
    for (const k of Object.values(BITO_TEMPLATE_ALERT_KIND)) expect(k).not.toMatch(/\d|V0|B_/);
  });
  it('경보 대상이 한 번에 다 와도 공용 주기 경보 문자 본문에 종류 둘이 다 실린다', async () => {
    ledger.clear();
    const sent: any[] = [];
    const r = { accounts: [acc('mapping_conflict')], templates: ALERT_TEMPLATE.map((o, i) => tpl(o, TP.replace(/e$/, String(i)))) } as any;
    const n = await alertPassFailures({ pass: 'bito-template-sync-test', title: 't', failures: bitoTemplateAlertFailures(r), total: 6, action: 'a' }, async (p: any) => { sent.push(p); return 1; });
    expect(n).toBe(1);
    const body = sent[0].details.join('\n');
    expect(body).toContain(`오류 5곳: ${BITO_TEMPLATE_ALERT_KIND.template}`);
    expect(body).toContain(`오류 1곳: ${BITO_TEMPLATE_ALERT_KIND.account}`);
  });
});

describe('입구(nginx 뒤 · 운영과 같은 trust proxy)', () => {
  let server: Server;
  let base = '';
  const saved = { t: process.env.BITO_SENDER_SYNC_TOKEN, i: process.env.BITO_SENDER_SYNC_IPS };
  beforeAll(async () => {
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(express.json());
    app.use('/api/bito-sync', bitoSyncRouter);
    server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/bito-sync`;
  });
  beforeEach(() => { process.env.BITO_SENDER_SYNC_TOKEN = TOKEN; process.env.BITO_SENDER_SYNC_IPS = GW; });
  afterEach(() => { process.env.BITO_SENDER_SYNC_TOKEN = TOKEN; process.env.BITO_SENDER_SYNC_IPS = GW; });
  afterAll(() => new Promise<void>((done) => server.close(() => done())));
  afterAll(() => {
    if (saved.t === undefined) delete process.env.BITO_SENDER_SYNC_TOKEN; else process.env.BITO_SENDER_SYNC_TOKEN = saved.t;
    if (saved.i === undefined) delete process.env.BITO_SENDER_SYNC_IPS; else process.env.BITO_SENDER_SYNC_IPS = saved.i;
  });
  const hdr = (xff: string, token = TOKEN) => ({ 'content-type': 'application/json', 'x-forwarded-for': xff, 'x-bito-sync-token': token });
  const post = (body: any, xff = GW, token = TOKEN) => fetch(`${base}/kakao-templates/results`, { method: 'POST', headers: hdr(xff, token), body: JSON.stringify(body) });

  it('목록 = 비토 출발지 + 토큰 200 · 꾸민 출발지 403 · 토큰 틀림 401 · ENV 없음 503', async () => {
    const get = (xff: string, token = TOKEN) => fetch(`${base}/kakao-templates`, { headers: hdr(xff, token) });
    const ok = await get(GW);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ companies: [] });   // V 회사 0(가짜 DB)
    expect((await get(`${GW}, 1.2.3.4`)).status).toBe(403);
    expect((await get(GW, 'x'.repeat(40))).status).toBe(401);
    delete process.env.BITO_SENDER_SYNC_TOKEN;
    expect((await get(GW)).status).toBe(503);
  });
  it('결과 = 같은 입구 판정 · 몸통 틀림 400 · 맞으면 200 받은 수', async () => {
    expect((await post({ accounts: [], templates: [] }, `${GW}, 1.2.3.4`)).status).toBe(403);
    expect((await post({ accounts: [], templates: [] }, GW, 'x'.repeat(40))).status).toBe(401);
    expect((await post({ accounts: 'x', templates: [] })).status).toBe(400);
    const r = await post({ accounts: [acc('ok')], templates: [tpl('same')] });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ received: 2 });
  });
});

describe('배선(소스 계약)', () => {
  it('목록 SQL = 승인 · 같은 회사 프로필 · 사용 중(NULL 제외) · 중지 상태 상수 · V 판정 · 내부 키 판정은 함수 한 곳', () => {
    const ct = src('utils/bito-template-sync.ts');
    expect(ct).toContain("AND t.status = 'APPROVED'");
    expect(ct).toContain('JOIN kakao_sender_profiles p ON p.id = t.profile_id AND p.company_id = t.company_id');
    expect(ct).toContain('AND p.is_active IS TRUE');
    expect(ct).toContain('AND p.status IS DISTINCT FROM $2');
    expect(ct).toContain('SENDER_PROFILE_DISABLED_STATUS');
    expect(ct).toContain('await loadBitoAgentIds()');
    expect(ct).toContain('isImcInternalTemplateKey(code)');
    expect(ct).not.toMatch(/'Tm|"Tm|LIKE/);
    expect(ct).not.toMatch(/console\.\w+\([^)]*senderKey|console\.\w+\([^)]*profile_key/);   // 키 원문 로그 0
  });
  it('결과 입구 = 저장 0 · 응답 뒤 경보', () => {
    const route = src('routes/bito-sync.ts');
    expect(route).toMatch(/res\.json\(\{ received: [^}]+\}\);\s*reportBitoTemplateResults\(parsed\)\.catch\(/);
    expect(src('utils/bito-template-sync.ts')).not.toMatch(/INSERT|UPDATE|DELETE/);
  });
  it('kakao-template-sync 의 내부 키 판정 = 같은 함수', () => {
    const s = src('utils/kakao-template-sync.ts');
    expect(s).toContain('if (isImcInternalTemplateKey(imcCode)) return { updated: false };');
    expect(s).toContain('if (!isImcInternalTemplateKey(oldCode)) return { updated: false };');
    expect(s).not.toContain("startsWith('Tm')");
  });
});
