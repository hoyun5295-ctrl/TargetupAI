/**
 * C113 계약 — D1 요금제 · D3 관리자 전용 칸 · D4 효과 카드 · D6 브랜드 관문 · D9 로고 임시 · D12 대행 안내 (★ 2026-11-07 설계서 §2-A · §2-B · §2-D · §2-F · §2-I)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ADMIN_ONLY_SETTINGS_FIELDS, omitAdminOnlySettings } from '../company-settings-fields';
import { buildAdGateExcludedNotify, buildAdGateAllExcludedNotify } from '../agency-send-notify';
import { stripComments } from './helpers/producer-scan';

const BACK = resolve(__dirname, '../..');
const FRONT = resolve(__dirname, '../../../../frontend/src');
const read = (root: string, rel: string) => readFileSync(resolve(root, rel), 'utf8').replace(/\r\n/g, '\n');

describe('D3 · R2 관리자 전용 칸 = 화면 블록 ⊆ 서버 목록', () => {
  it('설정 화면 {isAdmin && ( 블록 안에서 바꾸는 칸이 전부 CT 목록에 있다', () => {
    const src = read(FRONT, 'pages/Settings.tsx');
    const blocks: string[] = [];
    let at = src.indexOf('{isAdmin && (');
    while (at >= 0) {
      let depth = 0;
      let i = at;
      for (; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') { depth--; if (depth === 0) break; }
      }
      blocks.push(src.slice(at, i));
      at = src.indexOf('{isAdmin && (', i);
    }
    expect(blocks.length).toBe(2);
    const fields = new Set<string>();
    for (const b of blocks) for (const m of b.matchAll(/setSettings\(\{ \.\.\.settings, ([a-z_]+):/g)) fields.add(m[1]);
    expect(fields.size).toBeGreaterThanOrEqual(8);
    expect([...fields].filter((f) => !(ADMIN_ONLY_SETTINGS_FIELDS as readonly string[]).includes(f))).toEqual([]);
  });
  it('일반 사용자의 저장 몸 = 관리자 칸만 빠지고 나머지 그대로', () => {
    expect(omitAdminOnlySettings({ brand_name: '가게', monthly_budget: 1, fatigue_cap_days: 3, global_holdout_pct: 5 })).toEqual({ brand_name: '가게' });
  });
  it('설정 저장 라우트 = 관리자 아님이면 구조 분해 전에 걸러낸다(HEAD 구조 분해 그대로)', () => {
    const c = read(BACK, 'routes/companies.ts');
    const put = c.slice(c.indexOf("router.put('/settings'"));
    const filter = put.indexOf('if (resolveOwnerScope(req) !== null) req.body = omitAdminOnlySettings(req.body || {});');
    expect(filter).toBeGreaterThan(0);
    expect(put.indexOf('} = req.body;')).toBeGreaterThan(filter);
  });
});

describe('D2 요금제 · 구독 상태 쓰기 = 같은 연결에서 대조군 · 우선순위 비우기 짝', () => {
  it('구독 상태 · 요금제를 쓰는 파일 = 비우기를 부른다(쓰기 자리 수 ≤ 부르는 수)', async () => {
    const { readdirSync, statSync } = await import('fs');
    const { join, relative } = await import('path');
    const files: string[] = [];
    (function walk(d: string) {
      for (const f of readdirSync(d)) {
        const pth = join(d, f);
        if (f === '__tests__' || f === 'node_modules') continue;
        if (statSync(pth).isDirectory()) walk(pth);
        else if (f.endsWith('.ts') && !f.endsWith('.test.ts')) files.push(pth);
      }
    })(BACK);
    const writers: Array<{ rel: string; writes: number; pairs: number }> = [];
    for (const f of files) {
      const src = stripComments(readFileSync(f, 'utf8'));
      // UPDATE companies 문장의 SET 부분(WHERE 앞)에서 요금제 · 구독 상태를 쓰는 자리 + 이용 기간의 동적 SET
      let writes = (src.match(/add\('plan_id = \?::uuid'/g) || []).length;
      for (const m of src.matchAll(/UPDATE companies\b/g)) {
        const set = src.slice(m.index!, src.indexOf('WHERE', m.index!));
        if (/\b(plan_id|subscription_status)\s*=/.test(set)) writes++;
      }
      if (writes === 0) continue;
      writers.push({ rel: relative(BACK, f).replace(/\\/g, '/'), writes, pairs: (src.match(/await endAdGateIfUnpaid\(/g) || []).length });
    }
    expect(writers.map((w) => w.rel).sort()).toEqual(['routes/admin.ts', 'routes/companies.ts', 'utils/basic-trial.ts', 'utils/plan-term.ts', 'utils/trial-downgrade-worker.ts']);
    for (const w of writers) expect(w.pairs, `${w.rel} 쓰기 ${w.writes} · 비우기 ${w.pairs}`).toBeGreaterThanOrEqual(1);
    expect(writers.find((w) => w.rel === 'routes/admin.ts')!.pairs).toBe(2);
  });
});

describe('D1 요금제 = 새 기능 셋 · D4 효과 카드', () => {
  it('설정 GET = ad_gate_allowed(정책 읽기 한 곳) · 저장 = 요금제 아님이면 403 AD_GATE_PLAN_REQUIRED · 화면 = 참일 때만 칸 · 보낼 때만 그 묶음', () => {
    const c = read(BACK, 'routes/companies.ts');
    expect(c).toContain('row.ad_gate_allowed = row.ad_gate_ready ? (await loadAdGatePolicy(companyId)).ready : false;');
    expect(c).toContain("code: 'AD_GATE_PLAN_REQUIRED'");
    const f = read(FRONT, 'pages/Settings.tsx');
    expect(f).toContain('{settings.ad_gate_ready && settings.ad_gate_allowed && (');
    expect(f).toContain('return ad_gate_ready && ad_gate_allowed ? { ...rest, global_holdout_pct, campaign_holdout_pct, send_priority_order } : rest;');
  });
  it('효과 증명 = 요금제 안 씀이면 ready 거짓 · 빈 카드 단추 = 회사 관리자만 · 꼬리 = 문자와 카카오 기준', () => {
    expect(read(BACK, 'routes/ai.ts')).toContain('const ready = (await loadAdGatePolicy(companyId)).ready;');
    const card = read(FRONT, 'components/performance/EffectProofCard.tsx');
    expect(card).toContain("useAuthStore((st) => st.user?.userType === 'company_admin')");
    expect(card).toContain('회사 관리자가 설정에서 대조군을 켜면 다음 광고부터 효과를 잽니다.');
    expect(card).toContain('문자와 카카오 광고 기준이에요. 이메일과 앱 푸시 광고는 대조군에게도 나가요.');
    const set = read(FRONT, 'pages/Settings.tsx');
    expect(set).toContain('문자와 카카오 광고를 받지 않습니다(이메일과 앱 푸시는 해당 없음).');
  });
});

describe('D6 브랜드 메시지 관문 · D9 로고 임시 · D12 대행 안내', () => {
  it('브랜드 = 관문 길만 · 번호 = 우선순위 면제(둘째 인자 = 같은 목록) · 잇기 = 발송 CT 앞 · 옛 길 응답 = HEAD 칸', () => {
    const c = read(BACK, 'routes/campaigns.ts');
    const brand = c.slice(c.indexOf("router.post('/brand-send'"));
    expect(brand).toContain("const brandGateMode = (isAd ?? true) === true ? await resolveAdGateMode(companyId) : { mode: 'legacy' as const };");
    expect(brand).toContain('phones.map((x: any) => String(x || \'\')), phones.map((x: any) => String(x || \'\')));');
    const link = brand.indexOf('if (brandHold) await brandHold.handoff(campaignId);');
    expect(link).toBeGreaterThan(0);
    expect(brand.indexOf('await sendBrandMessage(baseParams)')).toBeGreaterThan(link);
    expect(brand).toContain('...(brandGateCounts ? { adGate: brandGateCounts, adGateNotice: adGateNotice(brandGateCounts) } : {}),');
  });
  it('스튜디오 저장 = 로고 후보 임시는 400 · 로고 쓰기 = /logo/use 하나', () => {
    const r = read(BACK, 'routes/image-studio.ts');
    expect(r).toContain("if (meta?.kind === 'logo') return res.status(400).json({ success: false, error: '찾은 로고는 「이 로고로 저장」으로 저장해 주세요.', code: 'LOGO_TEMP' });");
    expect(r).toContain("imageStudioRouter.post('/logo/use'");
    const logo = read(BACK, 'utils/studio-logo.ts');
    const find = logo.slice(logo.indexOf('export async function readHomepageLogo'), logo.indexOf('export async function useHomepageLogo'));
    expect(find).not.toMatch(/setLogoIfEmpty\(|moveTempToPermanent\(|storeImage/);
  });
  it('대행 안내 = 가운뎃점 · 「피로도」 0 · 뺀 수 · 전원 문장', () => {
    const a = buildAdGateExcludedNotify({ label: '봄 행사', total: 100, line: '대조군 10명을 뺐습니다.' });
    expect(a).toContain('요청 100건 중 대조군 10명을 뺐습니다.');
    const b = buildAdGateAllExcludedNotify({ label: '봄 행사' });
    expect(b).toContain('대조군, 우선순위 설정으로 받는 사람이 모두 빠져 발송하지 않았습니다.');
    for (const t of [a, b]) { expect(t).not.toContain('·'); expect(t).not.toContain('피로도'); }
  });
});
