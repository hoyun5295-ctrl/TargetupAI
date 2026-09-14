/**
 * ai-auto-build-routes.test.ts — AI 자동제작 라우트 소스 계약(★2026-09-14 T4 · 설계서 §6-5 · §6-7 · 계약 8 · 13)
 *  materials v1 분기 3곳(DM 생성 · 이메일 생성 · 견적) = 신규 ENV(aiAutoBuildEnabled) AND · v1 분기가 v0 앞 · 판정은 오케스트레이터가 checkCredit 앞에서 · 409 in-flight ·
 *  오류 매핑(AiAutoBuildError.status → 402 잔액 → 503 마이그레이션 → 500) · v0 경로 무후퇴. DB·네트워크 0(소스 문자열).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const code = (rel: string) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const V1_IF = 'if (req.body?.materials && isBuildMaterialsV1(req.body.materials)) {';
const V0_IF = "if (req.body?.materials && typeof req.body.materials === 'object') {";

function v1Block(route: string): string {
  const v1 = route.indexOf(V1_IF);
  const v0 = route.indexOf(V0_IF);
  expect(v1).toBeGreaterThan(-1);
  expect(v0).toBeGreaterThan(v1);
  return route.slice(v1, v0);
}

describe('★ T4 라우트 — materials v1 분기 · ENV AND · 잠금 · 오류 매핑', () => {
  it('DM 생성 — v1 분기가 v0 앞 · aiAutoBuildEnabled 403 · 잠금 → 생성 → finally 해제 · 채널 고정 dm · 오류 매핑 · 몰 자동 첨부 0', () => {
    const block = v1Block(code('routes/dm.ts'));
    expect(block).toContain('if (!aiAutoBuildEnabled(companyId)) return res.status(403)');
    expect(block).toContain("code: 'FEATURE_DISABLED'");
    expect(block.indexOf('tryAcquireInflight(lockKey)')).toBeGreaterThan(-1);
    expect(block.indexOf('tryAcquireInflight(lockKey)')).toBeLessThan(block.indexOf('generateFromBuildMaterials('));
    expect(block).toContain("code: 'IN_FLIGHT'");
    expect(block).toContain('finally { releaseInflight(lockKey); }');
    expect(block).toContain("channel: 'dm'");
    expect(block).toContain('buildGenerateResponse(r)');
    expect(block.indexOf('aiAutoBuildErrorResponse(err)')).toBeLessThan(block.indexOf("code: 'INSUFFICIENT_CREDIT'"));
    expect(block).toContain("handleDbMigrationError(err, res, 'dm_pages')");
    expect(block).not.toContain('quickMaterialsEnabled(');
    expect(block).not.toContain('attachMallImagesToProductCarousels');
  });
  it('이메일 생성 — 같은 형태 · 채널 고정 email · 503 email_campaigns · v0 분기 그대로', () => {
    const route = code('routes/email.ts');
    const block = v1Block(route);
    expect(block).toContain('if (!aiAutoBuildEnabled(auth.companyId)) return res.status(403)');
    expect(block.indexOf('tryAcquireInflight(lockKey)')).toBeLessThan(block.indexOf('generateFromBuildMaterials('));
    expect(block).toContain("code: 'IN_FLIGHT'");
    expect(block).toContain('finally { releaseInflight(lockKey); }');
    expect(block).toContain("channel: 'email'");
    expect(block).toContain('buildGenerateResponse(r)');
    expect(block).toContain('aiAutoBuildErrorResponse(err)');
    expect(block).toContain("code: 'INSUFFICIENT_CREDIT'");
    expect(block).toContain("handleDbMigrationError(err, res, 'email_campaigns')");
    expect(block).not.toContain('quickMaterialsEnabled(');
    // v0 무후퇴
    expect(route).toContain('generateEmailFromMaterials(');
    expect(route).toContain('const result = await generateEmailSections({ companyId: auth.companyId, userId: auth.userId, prompt, scenario, isAd, eventText });');
  });
  it('견적 — POST /materials/quote(v1 · 정규화·게이트·역할·견적) · aiAutoBuildEnabled 403 · 오류 매핑 · GET 옛 견적 그대로', () => {
    const ec = code('routes/event-campaigns.ts');
    const start = ec.indexOf("eventCampaignRouter.post('/materials/quote'");
    expect(start).toBeGreaterThan(-1);
    const block = ec.slice(start, ec.indexOf('eventCampaignRouter.', start + 10));
    expect(block).toContain('if (!aiAutoBuildEnabled(companyId)) return res.status(403)');
    expect(block).toContain('quoteFromBuildMaterials(');
    expect(block).toContain('aiAutoBuildErrorResponse(err)');
    expect(block).toContain('plan_locked');
    expect(block).toContain('smtp_configured');
    expect(block).not.toContain('checkCredit(');
    expect(block).not.toContain('deductCredit');
    expect(ec).toContain("eventCampaignRouter.get('/materials/quote'");
    expect(ec).toContain('quoteQuickCampaign({ imageCount, hasText, reads })');
  });
  it('ENV 게이트 = 3곳 모두 aiAutoBuildEnabled · 잠금 키는 CT(buildInflightKey) · 라우트에 인라인 잠금 Set 0', () => {
    for (const f of ['routes/dm.ts', 'routes/email.ts', 'routes/event-campaigns.ts']) {
      const src = code(f);
      expect(src, f).toContain('aiAutoBuildEnabled(');
      expect(src, f).not.toMatch(/new (Set|Map)<string>\(\)\s*;?\s*\n[^\n]*(inflight|inFlight|busy)/i);
    }
    expect(code('routes/dm.ts')).toContain('const lockKey = buildInflightKey(companyId);');
    expect(code('routes/email.ts')).toContain('const lockKey = buildInflightKey(auth.companyId);');
  });
});
