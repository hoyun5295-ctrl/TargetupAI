// CRM 캠페인 대행 — 캠페인대행요청서 양식/파싱 순수 CT 테스트 (2026-07-09)
import { describe, it, expect } from 'vitest';
import { buildRequestTemplateRows, parseRequestSheet, AGENCY_REQUEST_LABELS } from '../crm-agency-request';

describe('crm-agency-request', () => {
  it('양식 rows를 생성한다 (라벨 고정)', () => {
    const rows = buildRequestTemplateRows();
    expect(rows.some((r) => r[0] === AGENCY_REQUEST_LABELS.title)).toBe(true);
    expect(rows.some((r) => r[0] === AGENCY_REQUEST_LABELS.benefit)).toBe(true);
    expect(rows.some((r) => r[0] === AGENCY_REQUEST_LABELS.productsHeader)).toBe(true);
  });

  it('작성된 시트를 파싱한다', () => {
    const rows = buildRequestTemplateRows();
    const set = (label: string, v: string) => { const r = rows.find((x) => x[0] === label)!; r[1] = v; };
    set(AGENCY_REQUEST_LABELS.title, '7월 신제품 런칭');
    set(AGENCY_REQUEST_LABELS.periodStart, '2026-07-15');
    set(AGENCY_REQUEST_LABELS.periodEnd, '2026-07-31');
    set(AGENCY_REQUEST_LABELS.description, '신제품 A 출시 기념 행사');
    set(AGENCY_REQUEST_LABELS.benefit, '전 구매 고객 10% 할인');
    set(AGENCY_REQUEST_LABELS.channels, '문자, DM');
    set(AGENCY_REQUEST_LABELS.budget, '500000');
    const parsed = parseRequestSheet(rows);
    expect(parsed.title).toBe('7월 신제품 런칭');
    expect(parsed.benefit).toBe('전 구매 고객 10% 할인');
    expect(parsed.channels).toEqual(['문자', 'DM']);
    expect(parsed.budget).toBe(500000);
    expect(parsed.missingRequired).toEqual([]);
  });

  it('필수 누락을 missingRequired로 보고한다 (throw 아님 — 직원 보정 흐름)', () => {
    const parsed = parseRequestSheet(buildRequestTemplateRows());
    expect(parsed.missingRequired.length).toBeGreaterThan(0);
    expect(parsed.missingRequired).toContain(AGENCY_REQUEST_LABELS.title);
  });

  it('상품 표(3열)를 파싱하고, 빈 행에서 표를 종료한다 (푸터/여백 오인 차단)', () => {
    const rows = buildRequestTemplateRows();
    const idx = rows.findIndex((r) => r[0] === AGENCY_REQUEST_LABELS.productsHeader);
    rows[idx + 2] = ['신제품 A', '39000', '29000'];
    rows[idx + 3] = ['신제품 B', '가격미정', ''];
    rows[idx + 4] = ['', '', ''];
    rows[idx + 5] = ['문의: 한줄로 고객센터', '', ''];  // 표 아래 잡텍스트 — 상품 아님
    const parsed = parseRequestSheet(rows);
    expect(parsed.products).toEqual([
      { name: '신제품 A', price: 39000, salePrice: 29000 },
      { name: '신제품 B', price: null, salePrice: null },
    ]);
  });
});
