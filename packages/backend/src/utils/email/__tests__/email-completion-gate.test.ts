/**
 * ★ 2026-09-27 만들기 개편 S2·S3 — 이메일 완성 판정 CT · 완성/발송 잠금 CT 계약.
 *   S2: 크레딧제 미적용 회사는 차감이 원장 행 없이 끝나(`ai-credit-tx` not_applicable) 옛 판정으로는 영구 발송 불가였다.
 *   S3: 채울 자리·링크 결함 판정이 `/send` 인라인에만 있어 `/complete`(50 차감)는 막지 못했다 · SMTP 는 선점 뒤 실패였다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { isEmailCampaignCompleted, isCreditNotApplicableRow, emailCompletionKeysOf, type EmailCompletionDeps } from '../email-completion';
import { emailContentBlocker, emailSmtpBlocker } from '../email-send-gate';

const C = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';

function deps(over: Partial<EmailCompletionDeps>): EmailCompletionDeps {
  return {
    hasCompletionRow: async () => false,
    loadCreditRow: async () => ({ plan_credits: 300, purchased: 0 }),
    ...over,
  };
}

describe('S2 이메일 완성 판정', () => {
  it('완성 원장 행이 있으면 완성(신·구 키)', async () => {
    expect(emailCompletionKeysOf(ID)).toEqual([`email-campaign-complete:${ID}`, `email-ai-publish:${ID}`]);
    expect(await isEmailCampaignCompleted(C, ID, deps({ hasCompletionRow: async () => true }))).toBe(true);
  });
  it('크레딧제 적용 회사 + 행 없음 = 미완성', async () => {
    expect(await isEmailCampaignCompleted(C, ID, deps({}))).toBe(false);
    expect(await isEmailCampaignCompleted(C, ID, deps({ loadCreditRow: async () => ({ plan_credits: null, purchased: 500 }) }))).toBe(false);
  });
  it('크레딧제 미적용 회사(요금제 크레딧 없음 + 구매분 0) = 완성 — ai-credit-tx not_applicable 과 같은 식', async () => {
    expect(await isEmailCampaignCompleted(C, ID, deps({ loadCreditRow: async () => ({ plan_credits: null, purchased: 0 }) }))).toBe(true);
    expect(isCreditNotApplicableRow({ plan_credits: null, purchased: '0' })).toBe(true);
    expect(isCreditNotApplicableRow({ plan_credits: 0, purchased: 0 })).toBe(false);
    expect(isCreditNotApplicableRow(null)).toBe(true);
    // ai-credit-tx 의 not_applicable 조건 원문과 같은 식인지(갈리면 교착 재발)
    const tx = fs.readFileSync(path.join(__dirname, '../../ai-credit-tx.ts'), 'utf-8');
    expect(tx).toContain('locked.plan_credits == null && (Number(locked.purchased) || 0) === 0');
  });
  it('조회 실패는 삼키지 않는다(fail-closed · 돈을 안 낸 캠페인이 나가지 않게)', async () => {
    await expect(isEmailCampaignCompleted(C, ID, deps({ loadCreditRow: async () => { throw new Error('db down'); } }))).rejects.toThrow('db down');
  });
  it('라우트는 CT 를 쓴다(인라인 판정 0) — /complete · /send · /test-send · /export-html · 목록', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../routes/email.ts'), 'utf-8');
    expect(src).not.toMatch(/async function isEmailCampaignCompleted/);
    expect(src).toContain("from '../utils/email/email-completion'");
    // ★ 2026-10-04 /complete 본문은 완성 코어 CT(email-complete-core · 편집기 · 플래너 승인 두 입구가 같은 문)
    expect((src.match(/isEmailCampaignCompleted\(auth\.companyId, campaign\.id\)/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(src).toContain('await completeEmailCampaignCore({ companyId: auth.companyId, userId: auth.userId, campaign })');
    const core = fs.readFileSync(path.join(__dirname, '../email-complete-core.ts'), 'utf-8');
    expect(core).toContain('isEmailCampaignCompleted(companyId, campaign.id)');
    expect(src).toContain('emailCompletionContextOf(companyId, (campaigns as any[]).map((c) => String(c.id)))'); // ★0928 R122 목록 id 만
  });
});

describe('S3 이메일 완성·발송 잠금', () => {
  it('채울 자리 → UNEDITED_PLACEHOLDER(옛 문구 그대로)', () => {
    const b = emailContentBlocker({ subject: '가을 세일', htmlBody: '<p>[혜택 안내: 직접 수정해주세요]</p>', textBody: '' });
    expect(b).toMatchObject({ status: 400, code: 'UNEDITED_PLACEHOLDER' });
    expect(b!.error).toContain('직접 입력이 필요한 자리');
  });
  it('링크 결함 → LINK_DEFECT · 정상 링크 = 통과', () => {
    expect(emailContentBlocker({ subject: 'a', htmlBody: '<a href="https://shop.example.cpm/x">x</a>' })).toMatchObject({ code: 'LINK_DEFECT' });
    expect(emailContentBlocker({ subject: 'a', htmlBody: '<a href="https://www.naver.com/x">x</a>' })).toBeNull();
  });
  it('발신 설정 없으면 SMTP_NOT_CONFIGURED · 있으면 null', async () => {
    expect(await emailSmtpBlocker(C, { isSmtpConfigured: async () => false })).toMatchObject({ status: 400, code: 'SMTP_NOT_CONFIGURED' });
    expect(await emailSmtpBlocker(C, { isSmtpConfigured: async () => true })).toBeNull();
  });
  it('/complete 는 차감 앞에서 잠금 · /send 는 선점 앞에서 발신 설정', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../routes/email.ts'), 'utf-8');
    const complete = fs.readFileSync(path.join(__dirname, '../email-complete-core.ts'), 'utf-8');
    expect(complete.indexOf('emailSmtpBlocker(')).toBeGreaterThan(-1);
    expect(complete.indexOf('emailSmtpBlocker(')).toBeLessThan(complete.indexOf('deductCreditSafe('));
    expect(complete.indexOf('emailContentBlocker(')).toBeLessThan(complete.indexOf('deductCreditSafe('));
    const send = src.slice(src.indexOf("router.post('/campaigns/:id/send'"), src.indexOf("router.post('/campaigns/:id/test-send'"));
    expect(send.indexOf('emailSmtpBlocker(')).toBeGreaterThan(-1);
    expect(send.indexOf('emailSmtpBlocker(')).toBeLessThan(send.indexOf("SET status = 'sending'"));
    expect(send).not.toMatch(/const ph = findUneditedPlaceholder/);
  });
});
