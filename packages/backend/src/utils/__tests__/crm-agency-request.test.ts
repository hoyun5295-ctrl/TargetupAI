// CRM 캠페인 대행 — 웹 폼 정규화/필수 검증 테스트 (2026-07-09 웹 폼 전환)
import { describe, it, expect } from 'vitest';
import { buildParsedFromForm, AGENCY_REQUIRED_FIELDS } from '../crm-agency-request';

describe('buildParsedFromForm', () => {
  it('완결 폼은 missingRequired 0건으로 정규화한다', () => {
    const parsed = buildParsedFromForm({
      title: '7월 신제품 런칭', periodStart: '2026-07-15', periodEnd: '2026-07-31',
      description: '신제품 A 출시 기념 행사', benefit: '전 구매 고객 10% 할인',
      channels: ['문자', '모바일DM'], budget: '500,000원', note: '주말 발송 희망',
      products: [{ name: '신제품 A', price: '39000', salePrice: 29000 }],
    });
    expect(parsed.missingRequired).toEqual([]);
    expect(parsed.title).toBe('7월 신제품 런칭');
    expect(parsed.channels).toEqual(['문자', '모바일DM']);
    expect(parsed.budget).toBe(500000);
    expect(parsed.products).toEqual([{ name: '신제품 A', price: 39000, salePrice: 29000 }]);
  });

  it('필수 누락은 라벨로 보고한다 (throw 금지)', () => {
    const parsed = buildParsedFromForm({ title: '행사', channels: '문자' });
    expect(parsed.missingRequired).toContain('행사 시작일');
    expect(parsed.missingRequired).toContain('행사 내용');
    expect(parsed.missingRequired).toContain('혜택 내용');
    expect(parsed.missingRequired).not.toContain('행사명');
  });

  it('channels는 배열/쉼표 문자열 둘 다 받는다 (관리자 보정 폼 호환)', () => {
    expect(buildParsedFromForm({ channels: '문자, 알림톡' }).channels).toEqual(['문자', '알림톡']);
    expect(buildParsedFromForm({ channels: ['이메일'] }).channels).toEqual(['이메일']);
    expect(buildParsedFromForm({}).channels).toEqual([]);
  });

  it('이름 없는 상품 행은 걸러지고, 가격 0/음수/비숫자는 null', () => {
    const parsed = buildParsedFromForm({
      products: [
        { name: '', price: 1000 },
        { name: 'B', price: '0', salePrice: 'abc' },
        { name: 'C', price: '12,000', salePrice: null },
      ],
    });
    expect(parsed.products).toEqual([
      { name: 'B', price: null, salePrice: null },
      { name: 'C', price: 12000, salePrice: null },
    ]);
  });

  it('missingRequired 필수 목록 = AGENCY_REQUIRED_FIELDS 단일 진실 (5개 전부)', () => {
    const parsed = buildParsedFromForm({});
    expect(parsed.missingRequired).toEqual(AGENCY_REQUIRED_FIELDS.map(([, label]) => label));
  });

  it('과대 입력은 상한으로 잘린다', () => {
    const parsed = buildParsedFromForm({
      title: 'a'.repeat(500),
      periodStart: '2026-07-15', periodEnd: '2026-07-31', description: 'd', benefit: 'b',
      products: Array.from({ length: 50 }, (_, i) => ({ name: `p${i}` })),
      channels: Array.from({ length: 20 }, (_, i) => `c${i}`),
    });
    expect(parsed.title.length).toBe(200);
    expect(parsed.products.length).toBe(30);
    expect(parsed.channels.length).toBe(10);
  });
});
