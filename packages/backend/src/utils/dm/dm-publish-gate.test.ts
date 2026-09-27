/**
 * ★ 2026-09-27 만들기 개편 S6~S10 — DM 첫 발행 잠금 · 발행비 판정 CT · 선견적 · 무저장 미리보기 계약.
 *   두 발행 문(`/publish` · `send-to-target`)이 같은 잠금을 **첫 발행에만** 건다(재발행·재발송 무변경).
 *   발행비 판정은 옛 인라인과 같은 식(미납 + 실발송 이력 없음 + 크레딧제 적용 = 부과 · 조회 실패 = null).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock('../ai-credit', () => ({ isCreditEnabledStrict: vi.fn(async () => true) }));
vi.mock('./dm-interaction', () => ({ isInteractionCampaign: vi.fn(async () => false) }));

import { query } from '../../config/database';
import { isCreditEnabledStrict } from '../ai-credit';
import { isInteractionCampaign } from './dm-interaction';
import { dmPublishBlocker, resolveSendPublishFeeGate, quoteDmPublishFee } from './dm-publish-gate';

const C = '11111111-1111-4111-8111-111111111111';
const D = '22222222-2222-4222-8222-222222222222';

const footer = { id: 'f', type: 'footer', visible: true, props: { cs_phone: '1588-0000', show_unsubscribe: true, notes: '유의사항' } };
const hero = (title: string) => ({ id: 'h', type: 'hero', visible: true, props: { headline: title } });
const cta = (url: string) => ({ id: 'c', type: 'cta', visible: true, props: { buttons: [{ label: '보러 가기', url }] } });

describe('S6 dmPublishBlocker — 첫 발행 잠금', () => {
  it('정상 DM = null', async () => {
    expect(await dmPublishBlocker({ sections: [hero('가을 세일'), cta('https://www.naver.com/x'), footer] })).toBeNull();
  });
  it('링크 결함 = LINK_DEFECT(옛 /publish 와 같은 판정·문구 머리)', async () => {
    const b = await dmPublishBlocker({ sections: [hero('가을 세일'), cta('https://shop.example.cpm/x'), footer] });
    expect(b).toMatchObject({ status: 400, code: 'LINK_DEFECT' });
    expect(b!.error.startsWith('링크는')).toBe(true);
  });
  it('채울 자리 = UNEDITED_PLACEHOLDER (pages 구조도 본다 · JSON 문자열 저장분도)', async () => {
    const pages = JSON.stringify([{ id: 'p1', sections: [hero('[혜택 안내: 직접 수정해주세요]'), cta('https://www.naver.com'), footer] }]);
    expect(await dmPublishBlocker({ pages })).toMatchObject({ code: 'UNEDITED_PLACEHOLDER' });
  });
  it('무시 불가 검수 치명(빈 버튼 주소) = VALIDATION_BLOCKED + 섹션 id', async () => {
    const b = await dmPublishBlocker({ sections: [hero('가을 세일'), cta(''), footer] });
    expect(b).toMatchObject({ code: 'VALIDATION_BLOCKED' });
    expect(b!.items?.[0]).toMatchObject({ area: 'link', section_id: 'c' });
  });
  it('무시 가능한 치명(footer 없음 · required_info)만 있으면 막지 않는다(화면이 확인받고 넘긴다)', async () => {
    expect(await dmPublishBlocker({ sections: [hero('가을 세일'), cta('https://www.naver.com')] })).toBeNull();
  });
  // ★ Codex 1R — 옛 슬라이드 DM(장마다 사진 · sections 없음)은 뷰어가 그대로 그린다. "섹션 0"으로 막지 않는다
  it('옛 슬라이드 DM(pages = 사진 장 · sections 없음) = 링크·채울 자리만 보고 통과', async () => {
    expect(await dmPublishBlocker({ sections: [], pages: [{ imageUrl: '/uploads/a.png' }, { imageUrl: '/uploads/b.png' }] })).toBeNull();
    expect(await dmPublishBlocker({ sections: [], pages: [{ imageUrl: '/uploads/a.png', linkUrl: 'https://shop.example.cpm/x' }] })).toMatchObject({ code: 'LINK_DEFECT' });
  });
  it('정말 빈 DM(장 구조도 섹션도 없음)은 그대로 막는다', async () => {
    expect(await dmPublishBlocker({ sections: [], pages: [{ id: 'p1', sections: [] }] })).toMatchObject({ code: 'VALIDATION_BLOCKED' });
  });
});

describe('S6 발행비 판정 — 옛 send-to-target 인라인과 같은 식', () => {
  const q = query as unknown as ReturnType<typeof vi.fn>;
  beforeEach(() => {
    q.mockReset();
    (isCreditEnabledStrict as any).mockReset(); (isCreditEnabledStrict as any).mockResolvedValue(true);
    (isInteractionCampaign as any).mockReset(); (isInteractionCampaign as any).mockResolvedValue(false);
  });
  it('미납 + 실발송 이력 없음 + 적용 회사 = 일반 100 / 참여형 120', async () => {
    q.mockResolvedValue({ rows: [] });
    expect(await resolveSendPublishFeeGate(C, D)).toEqual({ source: 'dm-builder', cost: 100 });
    (isInteractionCampaign as any).mockResolvedValue(true);
    expect(await resolveSendPublishFeeGate(C, D)).toEqual({ source: 'dm-interaction-publish', cost: 120 });
  });
  it('이미 납부 = null · 실발송 이력 있음 = null · 미적용 회사 = null', async () => {
    q.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    expect(await resolveSendPublishFeeGate(C, D)).toBeNull();
    q.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    expect(await resolveSendPublishFeeGate(C, D)).toBeNull();
    q.mockResolvedValue({ rows: [] });
    (isCreditEnabledStrict as any).mockResolvedValue(false);
    expect(await resolveSendPublishFeeGate(C, D)).toBeNull();
  });
  it('조회 실패 = null(옛 동작: 발송 우선)', async () => {
    q.mockRejectedValue(new Error('db down'));
    expect(await resolveSendPublishFeeGate(C, D)).toBeNull();
    q.mockResolvedValue({ rows: [] });
    (isCreditEnabledStrict as any).mockRejectedValue(new Error('credit row down'));
    expect(await resolveSendPublishFeeGate(C, D)).toBeNull();
  });
  // ★ Codex 1R — 선견적은 모르는 발행비를 0 크레딧으로 접지 않는다(던진다 → 라우트 오류 → 화면이 [링크만 받기]를 막는다)
  it('선견적 = 조회 실패면 던진다(via send · publish 둘 다)', async () => {
    q.mockResolvedValue({ rows: [] });
    (isCreditEnabledStrict as any).mockRejectedValue(new Error('credit row down'));
    await expect(quoteDmPublishFee(C, D, 'send')).rejects.toThrow('credit row down');
    await expect(quoteDmPublishFee(C, D, 'publish')).rejects.toThrow('credit row down');
    q.mockRejectedValue(new Error('db down'));
    (isCreditEnabledStrict as any).mockResolvedValue(true);
    await expect(quoteDmPublishFee(C, D, 'publish')).rejects.toThrow('db down');
  });
  it('선견적 via=publish = 첫 발행 규칙(납부 전 + 적용 회사)', async () => {
    q.mockResolvedValue({ rows: [] });
    expect(await quoteDmPublishFee(C, D, 'publish')).toEqual({ required: true, cost: 100, source: 'dm-builder' });
    (isCreditEnabledStrict as any).mockResolvedValue(false);
    expect(await quoteDmPublishFee(C, D, 'publish')).toEqual({ required: false, cost: 0, source: null });
  });
});

describe('S7~S10 라우트 배선', () => {
  const src = readFileSync(resolve(__dirname, '../../routes/dm.ts'), 'utf-8');
  const publish = src.slice(src.indexOf("dmRouter.post('/:id/publish'"), src.indexOf("dmRouter.post('/:id/stop'"));
  const send = src.slice(src.indexOf("dmRouter.post('/:id/send-to-target'"), src.indexOf("dmRouter.get('/:id/recipients-tracking'"));
  it('/publish = 첫 발행(short_code 없음)만 CT 잠금 · 재발행은 옛 링크 검사 · 둘 다 차감 앞', () => {
    expect(publish).toMatch(/if \(!dmBodyRow\.short_code\) \{\s*const block = await dmPublishBlocker\(dmBodyRow\)/);
    expect(publish.indexOf('dmPublishBlocker(')).toBeLessThan(publish.indexOf('deductCreditSafe('));
    expect(publish).toContain('dmPublishFeeSourceOf(companyId, req.params.id)');
    expect(publish).toContain('isDmPublishFeeCharged(companyId, req.params.id)');
  });
  it('send-to-target = 미발행 DM 만 잠금 · 발행비 판정(CT)·차감보다 앞 · 인라인 발행비 SQL 0', () => {
    expect(send).toMatch(/if \(!dm\.short_code\) \{\s*const block = await dmPublishBlocker\(dm\)/);
    expect(send.indexOf('dmPublishBlocker(dm)')).toBeLessThan(send.indexOf('resolveSendPublishFeeGate('));
    expect(send.indexOf('resolveSendPublishFeeGate(')).toBeLessThan(send.indexOf('deductCreditSafe('));
    expect(send).not.toContain('FROM dm_recipient_tokens WHERE dm_id = $1::uuid AND company_id = $2::uuid LIMIT 1');
  });
  it('선견적·무저장 미리보기 = 소유 가드(requireDmAccess) · 미리보기는 DB 쓰기 0', () => {
    expect(src).toContain("dmRouter.get('/:id/publish-quote', requireDmAccess");
    const pv = src.slice(src.indexOf("dmRouter.post('/:id/render-preview'"), src.indexOf("// POST /api/dm/:id/publish — 발행"));
    expect(pv).toContain('requireDmAccess');
    expect(pv).toContain('renderDmViewerHtmlWithCustomer(merged');
    expect(pv).not.toMatch(/UPDATE|INSERT|updateDm\(|save/);
  });
});
