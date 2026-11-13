/**
 * C132 접수 넷 — 한줄로 쪽 계약(★ 2026-11-13 · 설계서 docs/2026-11-13-c132-four-tickets-design.md §6)
 *   ④ 이메일 대행 = 문안 그대로(표기 정책 = 접수 때 행에 고정 · ad_text) · T4-1 · T4-2 · T4-4 · T4-5
 *   ② 발신번호 사용 범위 = 발송 판정과 같은 조각 · T2-1(소스)
 *   ③ 발송ID 브랜드 비친구 단가 = 비면 친구 단가 · T3-1
 *   동작(조립기 · 표본)은 c132-adtext-send.test.ts · 실 PG 는 c132-four-tickets.pg.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import { agencyAdTextApplies, agencyAdTextForSource } from '../agency-send-optout';
import { adTextOn, buildDirectSendCampaignParams } from '../direct-send-spec';
import { priceBillingRows, type BillingUsageRow } from '../send-usage-aggregation';
import { BILLING_TYPES, BRAND_NONFRIEND_AGENT_CODE, type AgentUnitPriceRow } from '../billing-types';

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const files = (readdirSync(SRC, { recursive: true }) as string[])
  .map((f) => String(f).replace(/\\/g, '/'))
  .filter((f) => /\.ts$/.test(f) && !/__tests__\//.test(f) && !/\.test\.ts$/.test(f));
const sfCache = new Map<string, ts.SourceFile>();
const sf = (f: string) => {
  let s = sfCache.get(f);
  if (!s) { s = ts.createSourceFile(f, read(f), ts.ScriptTarget.Latest, true); sfCache.set(f, s); }
  return s;
};
const callsOf = (name: string) => {
  const out: Array<{ file: string; node: ts.CallExpression }> = [];
  for (const f of files) {
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) out.push({ file: f, node: n });
      ts.forEachChild(n, walk);
    };
    walk(sf(f));
  }
  return out;
};
const prop = (call: ts.CallExpression, name: string): ts.Expression | null => {
  const arg = call.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
  for (const p of arg.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === name) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name;
  }
  return null;
};
const where = (c: { file: string; node: ts.Node }) => `${c.file}:${sf(c.file).getLineAndCharacterOfPosition(c.node.getStart()).line + 1}`;

describe('T4-1 표기 정책 값 범위', () => {
  it('agencyAdTextApplies = 광고이고 행 정책이 false 가 아니다(NULL · undefined = 종전 표기)', () => {
    expect(agencyAdTextApplies({ isAd: true, adText: true })).toBe(true);
    expect(agencyAdTextApplies({ isAd: true, adText: null })).toBe(true);
    expect(agencyAdTextApplies({ isAd: true, adText: undefined })).toBe(true);
    expect(agencyAdTextApplies({ isAd: true, adText: false })).toBe(false);
    expect(agencyAdTextApplies({ isAd: false, adText: true })).toBe(false);
    expect(agencyAdTextApplies({ isAd: null, adText: null })).toBe(false);
  });
  it('접수 경로 → 행 값: 이메일만 false', () => {
    expect(agencyAdTextForSource('email')).toBe(false);
    for (const s of ['screen', 'one_step', null, undefined, 'link']) expect(agencyAdTextForSource(s as any)).toBe(true);
  });
  it('발송 설정 판정 adTextOn = 광고이고 표식이 false 가 아니다', () => {
    expect(adTextOn(true, undefined)).toBe(true);
    expect(adTextOn(true, false)).toBe(false);
    expect(adTextOn(false, undefined)).toBe(false);
    expect(adTextOn(undefined, true)).toBe(false);
  });
});

describe('T4-4 발송 설정 = 끌 때만 싣는다(다른 캠페인의 send_config 글자 그대로)', () => {
  const base = { stagingId: 's', campaignName: 'c', msgType: 'SMS', total: 1, message: 'm', adEnabled: true } as any;
  const cfgOf = (spec: any) => JSON.parse(buildDirectSendCampaignParams(spec, { companyId: 'co', userId: 'u' }).find((v: any) => typeof v === 'string' && v.startsWith('{"msgType"')));
  it('대행 이메일(adTextApplies false) = adText false', () => {
    expect(cfgOf({ ...base, adTextApplies: false }).adText).toBe(false);
  });
  it('넘기지 않음 · true · 광고 아님 = 키 없음(종전 JSON)', () => {
    expect('adText' in cfgOf(base)).toBe(false);
    expect('adText' in cfgOf({ ...base, adTextApplies: true })).toBe(false);
    expect('adText' in cfgOf({ ...base, adEnabled: false, adTextApplies: false })).toBe(false);
  });
});

describe('T4-2 대행 표기 자리 전수 = 행 정책 CT 를 지난다(구문 트리)', () => {
  it('표본 · 미리보기 · 바이트(agency-send-preview) = prepareSendMessage 의 isAd 가 CT 값', () => {
    const calls = callsOf('prepareSendMessage').filter((c) => c.file === 'utils/agency-send-preview.ts');
    expect(calls.length).toBe(2);
    const src = read('utils/agency-send-preview.ts');
    expect(src).toMatch(/const adText = agencyAdTextApplies\(\{ isAd: row\.is_ad, adText: row\.ad_text \}\);/);
    expect(src).toMatch(/const adText = agencyAdTextApplies\(\{ isAd: input\.isAd, adText: input\.adText \}\);/);
    for (const c of calls) {
      const opts = c.node.arguments[3] as ts.ObjectLiteralExpression;
      const isAd = opts.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === 'isAd') as ts.PropertyAssignment;
      expect(['ctx.adText', 'adText'], where(c)).toContain(isAd.initializer.getText());
    }
  });

  it('바이트 재기 호출부 전부 adText 를 넘긴다(접수 코어 = 넣는 값과 같은 함수)', () => {
    const calls = callsOf('measureAgencyMaxSmsBytes');
    expect(calls.length).toBe(3);
    for (const c of calls) expect(prop(c.node, 'adText'), where(c)).not.toBeNull();
    const intake = read('utils/agency-send-intake.ts');
    expect(intake).toMatch(/adText: await agencyAdTextValue\(pool, source\)/);
    expect(intake).toMatch(/adTextValue = await agencyAdTextValue\(client, source\);/);
    expect(intake).toMatch(/extraCols\.push\('ad_text'\);/);
  });

  it('수신거부 겹침 안내 전부 = CT 를 지난 뒤에만 표기 있음으로 판정', () => {
    const calls = [...callsOf('agencyOptOutNotice'), ...callsOf('agencyOptOutSmsLine')].filter((c) => c.file !== 'utils/agency-send-optout.ts');
    expect(calls.length).toBe(10);
    for (const c of calls) {
      const isAd = prop(c.node, 'isAd')!;
      const viaCt = isAd.getText().includes('agencyAdTextApplies');
      let guarded = false;
      for (let p: ts.Node | undefined = c.node.parent; p; p = p.parent) {
        if (ts.isConditionalExpression(p) && p.condition.getText().includes('agencyAdTextApplies')) { guarded = true; break; }
        if (ts.isFunctionLike(p)) break;
      }
      expect(viaCt || (guarded && isAd.getText() === 'true'), where(c)).toBe(true);
    }
  });

  it('스팸 검사 표본(대행) = CT 값 · 080 도 그때만', () => {
    const src = read('utils/agency-send-worker.ts');
    expect(src).toMatch(/const adText = agencyAdTextApplies\(\{ isAd: row\.is_ad, adText: row\.ad_text \}\);\n\s+const rejectNumber = adText \?/);
    const call = callsOf('autoSpamTestWithRegenerate').filter((c) => c.file === 'utils/agency-send-worker.ts');
    expect(call.length).toBe(1);
    expect(prop(call[0].node, 'isAd')!.getText()).toBe('adText');
  });

  it('T4-5 표기 끔(adTextApplies)을 넘기는 곳 = 대행 발송 워커 하나', () => {
    const owners: string[] = [];
    for (const f of files) {
      const walk = (n: ts.Node): void => {
        if (ts.isPropertyAssignment(n) && n.name.getText() === 'adTextApplies') owners.push(f);
        ts.forEachChild(n, walk);
      };
      walk(sf(f));
    }
    expect(owners).toEqual(['utils/agency-send-worker.ts']);
  });

  it('발송 조립 · 예약 문안 고치기 · 발송 전 스팸 차단 = adTextOn 한 식', () => {
    expect(read('utils/direct-send-worker.ts')).toMatch(/const adText = adTextOn\(cfg\.adEnabled, cfg\.adText\);\n\s+const opt080 = adText && !skipLoad/);
    expect(read('utils/direct-send-worker.ts')).toMatch(/finalIsAd, adText, opt080,/);
    expect(read('utils/direct-send-processor.ts').split('isAd: adTextOn(p.finalIsAd, p.adText)').length - 1).toBe(2);   // 문자 조립 · 브랜드 대체 문자
    expect(read('routes/campaigns.ts')).toMatch(/const adText = adTextOn\(adEnabled, campaign\.rows\[0\]\.send_config\?\.adText\);/);
    const core = read('utils/direct-send-core.ts');
    expect(core.split('isAd: adTextOn(spec.adEnabled, spec.adTextApplies)').length - 1).toBe(2);
  });

  it('화면 접수 입구는 경로를 본문에서 받지 않는다(source = screen 고정)', () => {
    expect(read('routes/agency-send.ts')).toMatch(/createRequestCore\(auth, \{ \.\.\.\(req\.body \|\| \{\}\), source: 'screen' \}\)/);
  });
});

describe('T2-1 발신번호 사용 범위 = 발송 판정과 같은 부품(소스 · 값 범위)', () => {
  it('「전체」 조건 = SQL callbackScopeAllSql 하나 · 규격 숫자 = registeredDigits 하나(발송 판정 · 화면 둘 다)', () => {
    const cf = read('utils/callback-filter.ts');
    expect(cf.split("assignment_scope = 'all'").length - 1).toBe(1);   // SQL 함수 정의 한 곳
    expect(cf).toMatch(/\$\{callbackScopeAllSql\('cn'\)\}\n\s+OR EXISTS \(\n\s+SELECT 1 FROM callback_number_assignments cna/);
    expect(cf).toMatch(/return registeredDigits\(\(registeredResult\.rows as any\[\]\)\.map\(\(r\) => r\.phone\)\);/);
    expect(cf.split('checkCallbackSpec(').length - 1).toBe(3);   // registeredDigits · describeCallbackUsage 지정 행 · fixedCallbackRejectReason(단건)
    const admin = read('routes/admin.ts');
    expect(admin.split('describeCallbackUsage(').length - 1).toBe(1);
    expect(admin).not.toMatch(/CALLBACK_USAGE_SCOPE_SQL/);
    // 옛 스키마(칸 · 배정 표 없음) = 범위 없는 SELECT 로 한 번 더(발송 판정의 try/catch 와 같은 답 = 전체) · 그래도 없으면 503(Codex 구현 2R)
    const route = admin.slice(admin.indexOf("router.get('/callback-numbers'"), admin.indexOf("router.post('/callback-numbers'"));
    expect(route).toMatch(/if \(scopeErr\?\.code !== '42703' && scopeErr\?\.code !== '42P01'\) throw scopeErr;\n\s+result = await query\(listSql\(false\)\);/);
    expect(route).toContain("code: 'DB_MIGRATION_PENDING'");
  });
  it('JS 판 「전체」 = SQL 판과 같은 값 범위(all · NULL · 칸 없음 = 전체)', async () => {
    const { callbackScopeIsAll } = await import('../callback-filter');
    expect(callbackScopeIsAll('all')).toBe(true);
    expect(callbackScopeIsAll(null)).toBe(true);
    expect(callbackScopeIsAll(undefined)).toBe(true);
    expect(callbackScopeIsAll('assigned')).toBe(false);
    expect(callbackScopeIsAll('')).toBe(false);
  });
});

describe('T3-1 발송ID 브랜드 비친구 단가 = 비면 친구 단가 · 둘 다 비면 막음', () => {
  const r = (o: Partial<BillingUsageRow>): BillingUsageRow => ({
    channel: 'agent', itemDate: '2026-11-13', typeKey: 'BRAND_NF', userId: null, agentSendId: 'V0099',
    total: 0, success: 0, fail: 0, pending: 0, ...o,
  });
  const ap = (o: Partial<AgentUnitPriceRow>): AgentUnitPriceRow => ({
    id: 'cai-1', agent_send_id: 'V0099', cost_per_sms: null, cost_per_lms: null, cost_per_mms: null, cost_per_kakao: null,
    cost_per_brand: null, cost_per_brand_nonfriend: null, ...o,
  });
  it('표 = BRAND_NF 발송ID 칸 · 코드 GN', () => {
    const nf = BILLING_TYPES.find((t) => t.key === 'BRAND_NF')!;
    expect(nf.agentPriceColumn).toBe('cost_per_brand_nonfriend');
    expect(nf.agentCode).toBe(BRAND_NONFRIEND_AGENT_CODE);
    expect(BRAND_NONFRIEND_AGENT_CODE).toBe('GN');
  });
  it('비친구 칸 있음 = 그 값 · 비면 친구 · 0원은 설정값 · 둘 다 비면 미설정', () => {
    const price = (row: AgentUnitPriceRow) => priceBillingRows([r({ success: 10 })], {}, [row], 'vat_excluded');
    expect(price(ap({ cost_per_brand: 20, cost_per_brand_nonfriend: 25 })).items[0].amount).toBe(250);
    expect(price(ap({ cost_per_brand: 20 })).items[0].amount).toBe(200);
    expect(price(ap({ cost_per_brand: 20, cost_per_brand_nonfriend: 0 })).items[0].amount).toBe(0);
    const unset = price(ap({}));
    expect(unset.missingAgentPrices).toEqual([{ agentSendId: 'V0099', typeKey: 'BRAND_NF', success: 10 }]);
  });
  it('친구(BRAND)는 비친구 칸을 보지 않는다', () => {
    const out = priceBillingRows([r({ typeKey: 'BRAND', success: 10 })], {}, [ap({ cost_per_brand: 20, cost_per_brand_nonfriend: 99 })], 'vat_excluded');
    expect(out.items[0].amount).toBe(200);
  });
});
