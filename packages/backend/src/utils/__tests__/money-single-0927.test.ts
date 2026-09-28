/**
 * 돈 낱건 · CRASH 남은 자동발송 환불 (★ 2026-09-27 한줄로 V2 차수 1 — R079 · R260 · R299 · R327 · R242 · m088 · m089)
 *
 * R079 전체 분석(300)과 성과 리포트 PDF 안의 AI 진단이 따로 5크레딧을 뺐다(안내 300보다 5 더 · 뒤에서 실패해도 5는 빠짐)
 *      → 안쪽 AI 호출을 크레딧 묶음 실행(runInCreditBundle)으로 — 바깥 차감 하나가 전체를 덮는다.
 * R260 여정 자동 생성이 오프셋마다 1크레딧씩 순차 차감해, 중간 실패·부족이면 앞 차감은 남고 결과는 없었다
 *      → 필요 크레딧 사전 확인 → 묶음 실행으로 생성 → 전부 성공 뒤 1회 차감.
 * R299 예측 전체 재계산이 잔액 확인 없이 무거운 계산부터 끝내고 차감했다 → 오늘 이미 낸 날이 아니면 먼저 잔액 확인.
 * R327 DM 대상 발송이 발행비 차감·발행을 080·발신번호·대상 0명 검사보다 먼저 했다 → 차감·발행을 검사 뒤로(확인·잔액 확인은 앞 그대로).
 * R242 이미지 스튜디오 세일 템플릿의 자리표시 문구가 그대로면 포스터에 그려진 채 2크레딧이 빠졌다 → 잔액 확인 전에 400.
 * m089 자동발송이 전체 대상으로 차감하고 미적재 환불은 개별 회신으로 거른 뒤 대상 기준 → 거른 몫은 적재 0이면 아무도 환불하지 않았다.
 * m088 자동발송이 차감 뒤 예외면 실패 기록만 하고 환불·의무가 없었다 → 적재 0 의무 CT(재시도 워커가 축별로 적재를 다시 확인하고 갚는다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const ai = src('..', 'routes', 'ai.ts');

describe('R079 전체 분석·리포트 안의 AI 진단 = 묶음 실행', () => {
  it('전체 분석 러너가 진단을 runInCreditBundle로 부른다(★0928 차수4 R293: 화면 호출 0이던 리포트 PDF 라우트는 제거)', () => {
    expect(ai).not.toContain("router.post('/operator/performance/report-pdf'");
    expect(src('full-analysis-runner.ts')).toContain('explanation = await runInCreditBundle(() => explainPerformance(companyId, sn, companyInfo));');
  });
});

describe('R260 여정 자동 생성 = 사전 확인 → 묶음 생성 → 1회 차감', () => {
  it('순서', () => {
    const g = src('journey-ai-generator.ts');
    const fn = g.slice(g.indexOf('export async function generateAnchorJourneyPlan('), g.indexOf('export async function regenerateStepAvoidingSpam('));
    const iCheck = fn.indexOf('await checkCredit(input.companyId, cost);');
    const iBundle = fn.indexOf('await runInCreditBundle(');
    const iDeduct = fn.indexOf('await deductCreditSafe({');
    expect(iCheck).toBeGreaterThan(-1);
    expect(iCheck).toBeLessThan(iBundle);
    expect(iBundle).toBeLessThan(iDeduct);
    expect(fn).toContain("const cost = getCreditCost('journey-ai-refine') * offsets.length;");
    expect(fn).toContain('idempotencyKey: `journey-anchor-plan:${randomUUID()}`');
  });
});

describe('R299 예측 전체 재계산 = 먼저 잔액 확인', () => {
  it('오늘 낸 날이 아니면 checkCredit 뒤 계산', () => {
    const at = ai.indexOf("router.post('/operator/predictive/recompute'");
    const body = ai.slice(at, ai.indexOf('});\n', ai.indexOf('[Predictive recompute] 오류', at)));
    const iCharged = body.indexOf('await isChargedByKey(companyId, dailyKey)');
    const iCheck = body.indexOf('await checkCredit(companyId, cost);');
    const iCompute = body.indexOf('await computeCompanyPredictionsBatch(companyId);');
    expect(iCharged).toBeGreaterThan(-1);
    expect(iCheck).toBeGreaterThan(iCharged);
    expect(iCompute).toBeGreaterThan(iCheck);
    expect(body).toContain("code: 'INSUFFICIENT_CREDIT'");
  });
});

describe('R327 DM 대상 발송 = 차감·발행은 싼 검사 뒤', () => {
  it('발행비 차감·발행이 대상 0명·개별 회신 검사 뒤', () => {
    const dmAll = src('..', 'routes', 'dm.ts');
    const dm = dmAll.slice(dmAll.indexOf("dmRouter.post('/:id/send-to-target'"));
    const iZero = dm.indexOf("code: 'ZERO_MATCH'");
    const iDeduct = dm.indexOf('idempotencyKey: `dm-publish:${req.params.id}`,\n      });');
    const iPublish = dm.indexOf('const pub = await publishDm(req.params.id, companyId);');
    const iTokens = dm.indexOf('tokenPairs = await issueDmRecipientTokensBulk(');
    expect(iDeduct).toBeGreaterThan(iZero);
    expect(iPublish).toBeGreaterThan(iZero);
    expect(iPublish).toBeLessThan(iTokens);
    // 확인(402)·잔액 확인은 앞에 그대로
    expect(dm.indexOf("code: 'PUBLISH_FEE_REQUIRED'")).toBeLessThan(iZero);
  });
});

describe('R242 스튜디오 자리표시 문구 = 만들지 않는다', () => {
  it('판정 CT', async () => {
    const { findUnfilledTemplateText } = await import('../image-studio-templates');
    expect(findUnfilledTemplateText({ label: 'BLACK SALE', title: '[혜택은 직접 입력해주세요]' })).toBe('title');
    expect(findUnfilledTemplateText({ title: '{productName}' })).toBe('title');
    expect(findUnfilledTemplateText({ subtitle: '{salePrice}' })).toBe('subtitle');
    expect(findUnfilledTemplateText({ label: 'SALE', title: '전 품목 30%', subtitle: '' })).toBeNull();
    expect(findUnfilledTemplateText(undefined)).toBeNull();
  });
  it('생성 라우트가 잔액 확인 전에 막는다', () => {
    const r = src('..', 'routes', 'image-studio.ts');
    const at = r.indexOf("imageStudioRouter.post('/generate'");
    const body = r.slice(at, r.indexOf("imageStudioRouter.post('/edit'", at));
    expect(body.indexOf('findUnfilledTemplateText(texts)')).toBeGreaterThan(-1);
    expect(body.indexOf('findUnfilledTemplateText(texts)')).toBeLessThan(body.indexOf('await checkCredit(companyId, 2)'));
    expect(body).toContain("code: 'PLACEHOLDER_TEXT'");
  });
});

describe('m089 · m088 자동발송 환불', () => {
  const w = src('auto-campaign-worker.ts');
  it('m089 미적재 = 차감한 건수(전체 대상) − 적재', () => {
    expect(w).toContain('const failCount = customers.length - sentCount;');
    expect(w).not.toContain('const failCount = filteredCustomers.length - sentCount;');
  });
  it('m088 차감 뒤 예외 = 적재 0 의무 CT(재시도 워커가 축별 적재 재확인)', () => {
    expect(w).toContain('deductedFor = { campaignId, count: customers.length, messageType: ac.message_type };');
    const c = w.slice(w.indexOf("console.error(`${logPrefix} 실행 중 에러:`, err);"), w.indexOf('async function markFailed('));
    expect(c).toContain('await settleZeroLoadAsObligation(deductedFor.campaignId, [{ count: deductedFor.count, messageType: deductedFor.messageType, refundKey: REFUND_KEYS.NOT_LOADED }])');
  });
});
