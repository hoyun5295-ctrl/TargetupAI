/**
 * C113 구현 1R 구조 계약(★ 2026-11-07 Codex 구현 1R 9건)
 *   #3 ~ #5 = 같은 뿌리(입구마다 손으로 적던 예약 쥠 · 넘김 · 해제) → 소유 CT AdHold 하나 · 넘김 = 나갈 수 있는 단계 바로 앞 · 끝정리 = 판정을 감싸는 finally
 *   #1 미가입 길 = 캠페인 표시가 없으면 원장 접근 0 · #2 큐 편집 열쇠 = uuid 정규형 · #6 보관 칸 전원 빠짐 = 옮기지 않음 ·
 *   #7 설정 저장 = 요금제 판정을 쓰는 문장 안 · #8 스키마 조회 오류 = 기억 0 · 장애 갈래 · #9 PDF 줄.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join, relative } from 'path';
import { stripComments } from './helpers/producer-scan';

const calls: Array<{ sql: string; params: any[] }> = [];
const flags = { schemaFails: 0 };
vi.mock('../../config/database', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('information_schema')) {
      if (flags.schemaFails > 0) { flags.schemaFails--; throw new Error('pool timeout'); }
      return { rows: [{ cols: 4, tabs: 2 }] };
    }
    if (sql.includes('AS paid')) return { rows: [{ paid: true, global_holdout_pct: 10, global_holdout_since: new Date(), campaign_holdout_pct: null, send_priority_order: null }] };
    return { rows: [], rowCount: 1 };
  });
  const client = { query: vi.fn(async (sql: string, params: any[] = []) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; }), release: vi.fn() };
  return { query, pool: { connect: vi.fn(async () => client) }, default: { query } };
});

import { AdHold, queueEditKey, campaignAdGateLinked, adGateSchemaReady, resolveAdGateMode, linkAdMarksSafe, resetAdGateSchemaCache } from '../ad-send-gate';
import { tryAcquireInflight, releaseInflight, isInflightUuid } from '../inflight-lock';

const CO = '11111111-2222-4333-8444-555555555555';
const BATCH = '22222222-3333-4444-8555-666666666666';
const CAMP = '33333333-4444-4555-8666-777777777777';
const deletes = () => calls.filter((c) => /DELETE FROM ad_send_marks/.test(c.sql));
const links = () => calls.filter((c) => /UPDATE ad_send_marks m SET campaign_id/.test(c.sql));
const flagsSet = () => calls.filter((c) => /UPDATE campaigns SET send_config = jsonb_set\(COALESCE\(send_config, '\{\}'::jsonb\), '\{adGateLinked\}'/.test(c.sql));
const failures = (branch: string) => calls.filter((c) => c.sql.includes('INSERT INTO ad_gate_failures') && c.sql.includes(`'${branch}'`));

describe('소유 CT AdHold(쥠 · 넘김 · 끝정리)', () => {
  beforeEach(() => { calls.length = 0; flags.schemaFails = 0; resetAdGateSchemaCache(); });

  it('원장을 안 쓴 판정(marked 거짓) = 쥐지 않음 · 끝정리 · 넘김 = DB 0', async () => {
    const h = new AdHold(CO);
    h.take(false, BATCH);
    expect(h.holding).toBe(false);
    await h.settle();
    await h.handoff(CAMP);
    expect(calls).toHaveLength(0);
  });
  it('쥔 채 끝 = 그 묶음의 이어지지 않은 예약 해제 한 번 · 두 번째 끝정리 = 0', async () => {
    const h = new AdHold(CO);
    h.take(true, BATCH);
    expect(h.holding).toBe(true);
    await h.settle(['01012345678']);
    await h.settle();
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0].params.slice(0, 2)).toEqual([CO, BATCH]);
    expect(h.holding).toBe(false);
  });
  it('넘김 = 소유 내려놓고 잇기(캠페인 표시 + 원장 줄 · 한 트랜잭션) · 그 뒤 끝정리 = 해제 0', async () => {
    const h = new AdHold(CO);
    h.take(true, BATCH);
    await h.handoff(CAMP);
    expect(h.holding).toBe(false);
    expect(flagsSet()).toHaveLength(1);
    expect(links()).toHaveLength(1);
    expect(calls.findIndex((c) => c.sql === 'BEGIN')).toBeLessThan(calls.indexOf(flagsSet()[0]));
    expect(calls.indexOf(flagsSet()[0])).toBeLessThan(calls.indexOf(links()[0]));   // 차례 = 캠페인 행 → 원장 줄
    await h.settle();
    expect(deletes()).toHaveLength(0);
  });
  it('공용 입구에 넘김(pass) = 해제 0 · 잇기는 공용 입구가(넘긴 뒤 handoff 도 잇는다)', async () => {
    const h = new AdHold(CO);
    h.take(true, BATCH);
    h.pass();
    await h.settle();
    expect(deletes()).toHaveLength(0);
    await h.handoff(CAMP);
    expect(links()).toHaveLength(1);
  });
});

describe('#8 스키마 조회 오류 = 기억 0 · 정책 장애 갈래 · 원장 쓰기 장애 줄', () => {
  beforeEach(() => { calls.length = 0; flags.schemaFails = 0; resetAdGateSchemaCache(); });

  it('화면 읽기 = 오류면 거짓 · 다음 호출이 다시 본다(5분 꺼짐 0)', async () => {
    flags.schemaFails = 1;
    expect(await adGateSchemaReady()).toBe(false);
    expect(await adGateSchemaReady()).toBe(true);
  });
  it('두 길 판정 = 스키마 조회 오류도 정책 장애(옛 길 + 장애 줄 policy · dry = 0)', async () => {
    flags.schemaFails = 1;
    expect(await resolveAdGateMode(CO)).toEqual({ mode: 'legacy' });
    await new Promise((r) => setTimeout(r, 0));   // 장애 줄 = 기다리지 않는 쓰기
    expect(failures('policy')).toHaveLength(1);
    calls.length = 0;
    flags.schemaFails = 1;
    expect(await resolveAdGateMode(CO, { dry: true })).toEqual({ mode: 'legacy' });
    await new Promise((r) => setTimeout(r, 0));
    expect(failures('policy')).toHaveLength(0);
  });
  it('잇기 = 스키마 조회 오류면 조용히 건너뛰지 않고 장애 줄 link', async () => {
    flags.schemaFails = 1;
    await linkAdMarksSafe(CO, BATCH, CAMP);
    expect(links()).toHaveLength(0);
    expect(failures('link')).toHaveLength(1);
  });
});

describe('#2 큐 편집 열쇠 = uuid 정규형', () => {
  it('대소문자 · 하이픈 · 중괄호가 달라도 같은 열쇠', () => {
    const lower = 'abcdef01-2345-4789-8abc-def012345678';
    expect(queueEditKey(lower.toUpperCase())).toBe(queueEditKey(lower));
    expect(queueEditKey(`{${lower}}`)).toBe(queueEditKey(lower));
    expect(queueEditKey(lower.replace(/-/g, ''))).toBe(queueEditKey(lower));
  });
  it('요청 원문으로 잡힌 수신자 삭제 열쇠 = 표기와 무관하게 보인다 · 놓으면 안 보인다', () => {
    const lower = 'abcdef01-2345-4789-8abc-def012345678';
    const k = `recipient-delete:${lower.toUpperCase()}`;
    expect(tryAcquireInflight(k)).toBe(true);
    expect(isInflightUuid('recipient-delete:', lower)).toBe(true);
    expect(isInflightUuid('recipient-delete:', `{${lower}}`)).toBe(true);
    expect(isInflightUuid('queue-edit:', lower)).toBe(false);
    releaseInflight(k);
    expect(isInflightUuid('recipient-delete:', lower)).toBe(false);
  });
});

describe('#1 캠페인 표시 = 관문 길로 이어진 캠페인만', () => {
  it('표시 = send_config.adGateLinked 참일 때만(없음 · 문자열 · null = 거짓)', () => {
    expect(campaignAdGateLinked({ send_config: { adGateLinked: true } })).toBe(true);
    for (const c of [{ send_config: {} }, { send_config: { adGateLinked: 'true' } }, { send_config: null }, {}, null, undefined]) {
      expect(campaignAdGateLinked(c as any)).toBe(false);
    }
  });
});

// ── 소스 계약 ───────────────────────────────────────────────────────────

const SRC = resolve(__dirname, '../..');
const code = (rel: string) => stripComments(readFileSync(resolve(SRC, rel), 'utf8').replace(/\r\n/g, '\n'));

/** 표식 문장 끝 다음의 첫 await 대상(동적 import 는 건너뜀) */
function nextAwaitAfter(src: string, at: number): string {
  const re = /\bawait\s+([\s\S]{0,120})/g;
  re.lastIndex = src.indexOf(';', at) + 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    re.lastIndex = m.index + 5;   // 잡은 꼬리가 다음 await 를 삼키지 않게
    if (/^import\(/.test(m[1])) continue;
    return m[1];
  }
  return '';
}

describe('구현 1R 구조 — 넘김 = 나갈 수 있는 단계 바로 앞(사이에 기다리는 일 0)', () => {
  const CASES: Array<{ file: string; mark: string; next: RegExp; nth?: number }> = [
    { file: 'routes/campaigns.ts', mark: 'if (aiHold.holding) await aiHold.handoff(id);', next: /^bulkInsertSmsQueue\(/, nth: 0 },
    { file: 'routes/campaigns.ts', mark: 'if (aiHold.holding) await aiHold.handoff(id);', next: /^insertBrandQueue\(/, nth: 1 },
    { file: 'routes/campaigns.ts', mark: 'if (directHold) await directHold.handoff(campaignId);', next: /^bulkInsertSmsQueue\(/, nth: 0 },
    { file: 'routes/campaigns.ts', mark: 'if (directHold) await directHold.handoff(campaignId);', next: /^insertBrandQueue\(/, nth: 1 },
    { file: 'routes/campaigns.ts', mark: 'if (directHold) await directHold.handoff(campaignId);', next: /^insertAlimtalkQueue\(/, nth: 2 },
    { file: 'routes/campaigns.ts', mark: 'if (brandHold) await brandHold.handoff(campaignId);', next: /^sendBrandMessage/ },
    { file: 'routes/campaigns.ts', mark: 'commitHold.pass();', next: /^createDirectSendCampaign\(/ },
    { file: 'routes/dm.ts', mark: 'dmHold.pass();', next: /^createDirectSendCampaign\(/ },
    { file: 'utils/auto-campaign-worker.ts', mark: 'if (adHold.holding) await adHold.handoff(campaignId);', next: /^insertAlimtalkQueue\(/, nth: 0 },
    { file: 'utils/auto-campaign-worker.ts', mark: 'if (adHold.holding) await adHold.handoff(campaignId);', next: /^bulkInsertSmsQueue\(/, nth: 1 },
    { file: 'utils/agency-send-worker.ts', mark: 'adHold.pass();', next: /^createDirectSendCampaign\(/, nth: 1 },
    { file: 'utils/planner-executor.ts', mark: 'adHold.pass();', next: /^createDirectSendCampaign\(/ },
    { file: 'utils/continuous-operator.ts', mark: 'coHold.pass();', next: /^createDirectSendCampaign\(/ },
    { file: 'utils/direct-send-core.ts', mark: 'if (gate) gate.hold.pass();', next: /^query\(\s*`UPDATE campaigns SET send_phase = 'queued'/ },
  ];
  for (const c of CASES) {
    it(`${c.file} · ${c.mark}${c.nth !== undefined ? ` #${c.nth}` : ''}`, () => {
      const src = code(c.file);
      const at: number[] = [];
      for (let i = src.indexOf(c.mark); i >= 0; i = src.indexOf(c.mark, i + 1)) at.push(i);
      expect(at.length).toBeGreaterThan(c.nth ?? 0);
      if (c.nth === undefined) expect(at).toHaveLength(1);
      expect(nextAwaitAfter(src, at[c.nth ?? 0])).toMatch(c.next);
    });
  }
  it('구현 2R #2 채널 갈래 = 관문 입구의 큐 적재 호출마다 바로 앞 문장이 넘김(갈래를 건너뛴 다른 갈래의 기다림이 넘김 뒤에 끼지 않음)', () => {
    const c = code('routes/campaigns.ts');
    const slices: Array<[string, string]> = [
      ['AI', c.slice(c.indexOf("router.post('/:id/send'"), c.indexOf('router.', c.indexOf("router.post('/:id/send'") + 10))],
      ['직접 동기', c.slice(c.indexOf("router.post('/direct-send'"), c.indexOf('router.', c.indexOf("router.post('/direct-send'") + 10))],
    ];
    const auto = code('utils/auto-campaign-worker.ts');
    slices.push(['자동 캠페인', auto.slice(auto.indexOf('const adHold = new AdHold('), auto.indexOf('if (adHold.holding) await adHold.settle();'))]);
    for (const [name, body] of slices) {
      const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
      let n = 0;
      lines.forEach((l, i) => {
        if (!/await (bulkInsertSmsQueue|insertBrandQueue|insertAlimtalkQueue)\(/.test(l)) return;
        n++;
        let j = i - 1;
        while (j > 0 && lines[j] === 'try {') j--;   // 기다리는 일 없는 줄
        expect(lines[j], `${name}: ${l.slice(0, 60)}`).toMatch(/\.handoff\((id|campaignId)\);$/);
      });
      expect(n, name).toBeGreaterThanOrEqual(2);
    }
  });
  it('구현 2R #2 넘김의 잇기 = 한 번(두 번째 넘김 = DB 0)', async () => {
    calls.length = 0;
    resetAdGateSchemaCache();
    const h = new AdHold(CO);
    h.take(true, BATCH);
    await h.handoff(CAMP);
    const first = calls.length;
    await h.handoff(CAMP);
    expect(calls.length).toBe(first);
    expect(links()).toHaveLength(1);
  });
  it('대행 = 소유를 잃은 것이 확인된 출구는 넘김(pass)으로 끝(해제 0)', () => {
    const src = code('utils/agency-send-worker.ts');
    const lost = src.indexOf('캠페인을 만들기 직전 소유권을 잃어 중단한다');
    const block = src.slice(lost, src.indexOf('return;', lost));
    expect(block).toContain('adHold.pass();');
    expect(block).not.toContain('settle(');
  });
});

describe('구현 1R 구조 — 끝정리 = 판정을 감싸는 finally(던짐 포함 모든 출구)', () => {
  const FINALLY: Array<{ file: string; re: RegExp }> = [
    { file: 'routes/campaigns.ts', re: /\} finally \{\s*if \(directHold\) await directHold\.settle\(\);/ },
    { file: 'routes/campaigns.ts', re: /\} finally \{\s*if \(brandHold\) await brandHold\.settle\(\);/ },
    { file: 'routes/campaigns.ts', re: /\} finally \{\s*if \(commitHold\.holding\) await commitHold\.settle\(\);/ },
    { file: 'routes/dm.ts', re: /\} finally \{\s*if \(!accepted\) \{[\s\S]{0,300}?\}\s*if \(dmHold\.holding\) await dmHold\.settle\(\);/ },
    { file: 'utils/auto-campaign-worker.ts', re: /\} finally \{\s*if \(adHold\.holding\) await adHold\.settle\(\);/ },
    { file: 'utils/agency-send-worker.ts', re: /try \{\s*await dispatchAttempt\(row, content, token, stagingId, label, notifyFailed, adHold\);\s*\} finally \{\s*if \(adHold\.holding\) await adHold\.settle\(\);/ },
    { file: 'utils/planner-executor.ts', re: /\}, adHold\);\s*\} catch \(e\) \{[\s\S]{0,200}?\} finally \{\s*if \(adHold\.holding\) await adHold\.settle\(\);/ },
    { file: 'utils/continuous-operator.ts', re: /return await dispatchProposalSendBody\(p, capPath, coHold\);\s*\} finally \{\s*if \(coHold\.holding\) await coHold\.settle\(\);/ },
    { file: 'utils/journey-executor.ts', re: /\} finally \{\s*if \(adRelease\.hold\?\.holding\) await adRelease\.hold\.settle\(\[\.\.\.adRelease\.keep\]\);/ },
    { file: 'utils/direct-send-core.ts', re: /\} finally \{\s*await hold\.settle\(\);/ },
  ];
  for (const f of FINALLY) it(`${f.file} · ${f.re.source.slice(0, 60)}`, () => expect(code(f.file)).toMatch(f.re));

  it('AI = 쥔 동안만 시작 잠금 안 「해제 → 실행 행 실패」 · 실행 행을 못 만든 출구 = 잠금 안 해제', () => {
    const c = code('routes/campaigns.ts');
    expect(c).toMatch(/failRunReleasingAd = \(runId: string, reason: string\) => \(aiHold\.holding\s*\? withCampaignStartLock\(id, async \(\) => \{\s*await aiHold\.settle\(\);\s*await failCampaignRun\(runId, reason\);\s*\}\)\s*: failCampaignRun\(runId, reason\)\);/);
    expect(c).toMatch(/\} catch \(runErr\) \{\s*if \(aiHold\.holding\) await aiHold\.settle\(\);\s*throw runErr;/);
  });

  it('입구마다 따로 적던 소유 장치 · 해제 직접 호출 = 0(소유 CT 하나)', () => {
    const files: Array<{ rel: string; src: string }> = [];
    (function walk(d: string) {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (f === '__tests__' || f === 'node_modules') continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (f.endsWith('.ts') && !f.endsWith('.test.ts')) files.push({ rel: relative(SRC, p).replace(/\\/g, '/'), src: stripComments(readFileSync(p, 'utf8')) });
      }
    })(SRC);
    const bespoke = /\b(adGateOwned|adGateRelease|brandGateRelease|dmGateRelease|releaseDirectOwned|plannerGateRelease|aiAdGateMarked)\b|own\.holding/;
    expect(files.filter((f) => bespoke.test(f.src)).map((f) => f.rel)).toEqual([]);
    expect(files.filter((f) => f.rel !== 'utils/ad-send-gate.ts' && /\breleaseUnlinkedReservations\(/.test(f.src)).map((f) => f.rel)).toEqual([]);
    const holders = files.filter((f) => /new AdHold\(/.test(f.src)).map((f) => f.rel).sort();
    expect(holders).toEqual(['routes/campaigns.ts', 'routes/dm.ts', 'utils/agency-send-worker.ts', 'utils/auto-campaign-worker.ts', 'utils/continuous-operator.ts', 'utils/direct-send-core.ts', 'utils/journey-executor.ts', 'utils/planner-executor.ts']);
    expect((files.find((f) => f.rel === 'routes/campaigns.ts')!.src.match(/new AdHold\(/g) || []).length).toBe(4);   // AI · 서버 적재 확정 · 직접 동기 · 브랜드
  });
});

describe('#1 · #2 · #6 · #7 · #9 자리', () => {
  it('#1 수신자 삭제 해제 = 표시 있는 캠페인만(두 곳) · 예약 변경 = 표시로 가름 · 요금제 조회 0', () => {
    const c = code('routes/campaigns.ts');
    expect((c.match(/if \(campaignAdGateLinked\(campaign\.rows\[0\]\)\) await releaseCampaignPhoneReservationSafe\(companyId, campaignId, phone\);/g) || []).length).toBe(2);
    expect((c.match(/releaseCampaignPhoneReservationSafe\(/g) || []).length).toBe(2);
    expect(c).toContain('if (campaignAdGateLinked(rsCamp)) {');
    expect(code('utils/ad-send-gate.ts')).not.toContain('adGatePaidState');
    expect(c).not.toContain('adGatePaidState');
  });
  it('#2 큐 편집 열쇠를 만드는 자리 = queueEditKey 뿐(템플릿 0)', () => {
    for (const f of ['routes/campaigns.ts', 'utils/direct-send-core.ts']) expect(code(f)).not.toMatch(/`queue-edit:\$\{/);
    expect(code('routes/campaigns.ts')).toContain('directEditLock = queueEditKey(directPresetId);');
    // 수신자 삭제 열쇠 = HEAD 원문(요청 표기) 한 곳 · 예약 변경은 표기와 무관하게 본다
    expect(code('routes/campaigns.ts')).toContain("if (isInflightUuid('recipient-delete:', campaignId)) {");
    expect((code('routes/campaigns.ts').match(/`recipient-delete:\$\{/g) || []).length).toBe(1);
    expect(code('utils/direct-send-core.ts')).toContain('const editLock = queueEditKey(presetId);');
  });
  it('#6 서버 적재 확정 = 전원 빠짐이면 보관 칸 표식 전에 바로 「대상 없음」', () => {
    const c = code('routes/campaigns.ts');
    const early = c.indexOf('if (g.allExcluded) return res.status(400)');
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(c.indexOf('adGateParked = (g.excludedRows ?? 0) > 0;'));
    expect(code('utils/ad-send-gate.ts')).toContain('if (mode !== \'dry\' && !allExcluded) {');
  });
  it('#7 설정 저장 = 요금제 조건을 단 문장(0 행 = 403) · 다른 칸 저장보다 먼저 · 따로 읽는 요금제 확인 0', () => {
    const c = code('routes/companies.ts');
    const put = c.slice(c.indexOf("router.put('/settings'"));
    const save = put.indexOf('saved = await saveAdGateSettings(companyId,');
    expect(save).toBeGreaterThan(0);
    expect(save).toBeLessThan(put.indexOf('brand_name = COALESCE($1, brand_name)'));
    expect(put.slice(0, put.indexOf('brand_name = COALESCE($1, brand_name)'))).not.toContain('loadAdGatePolicy(');
    expect(put).toContain("if (saved === 'unpaid') {");
    expect(c).not.toContain('buildAdGateSettingsUpdate(');
    expect(code('utils/ad-send-gate.ts')).toContain("buildAdGateSettingsUpdate(companyId, body, `COALESCE((SELECT ${ACTIVE_PAID_PLAN_WHERE} FROM plans p WHERE p.id = c.plan_id), false)`)");
  });
  it('#9 PDF 효과 증명 = 제목 줄 뒤 y 증가가 실행문(주석 안 0)', () => {
    const pdf = code('utils/performance-pdf-render.ts');
    const sec = pdf.slice(pdf.indexOf('효과 증명(대조군 비교)'), pdf.indexOf('캠페인 발송 후 기여') > 0 ? pdf.indexOf('캠페인 발송 후 기여') : undefined);
    expect((sec.match(/50, y\); y \+= 13;/g) || []).length).toBe(2);
  });
});
