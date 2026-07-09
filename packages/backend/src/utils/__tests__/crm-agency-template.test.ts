// 캠페인대행요청서 디자인 양식(exceljs) ↔ 업로드 파서(SheetJS) 왕복 호환 테스트 (2026-07-09)
// 양식을 다시 디자인해도 파서가 라벨·값 위치·상품 표 구조를 그대로 읽는지 기계로 고정한다.
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildRequestTemplateXlsx } from '../crm-agency-template';
import { parseRequestSheet, AGENCY_REQUEST_LABELS } from '../crm-agency-request';

async function templateAsRows(): Promise<any[][]> {
  const buf = await buildRequestTemplateXlsx();
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];
}

describe('crm-agency-template ↔ parser 왕복', () => {
  it('빈 양식: 전 라벨이 A열에서 인식되고 필수 5건이 누락으로 보고된다', async () => {
    const rows = await templateAsRows();
    const parsed = parseRequestSheet(rows);
    expect(parsed.missingRequired).toHaveLength(5);
    expect(parsed.missingRequired).toContain(AGENCY_REQUEST_LABELS.title);
    expect(parsed.missingRequired).toContain(AGENCY_REQUEST_LABELS.benefit);
  });

  it('상품 표 구조: productsHeader +1 = 표 헤더, +2부터 데이터 (파서 고정 구조)', async () => {
    const rows = await templateAsRows();
    const idx = rows.findIndex((r) => String(r?.[0] ?? '') === AGENCY_REQUEST_LABELS.productsHeader);
    expect(idx).toBeGreaterThan(0);
    expect(String(rows[idx + 1]?.[0] ?? '')).toBe('상품명');
  });

  it('값을 채워 저장하면 파서가 B열 값·상품 행을 읽는다 (병합 셀 호환)', async () => {
    const rows = await templateAsRows();
    const set = (label: string, v: any) => { const r = rows.find((x) => String(x?.[0] ?? '') === label)!; r[1] = v; };
    set(AGENCY_REQUEST_LABELS.title, '가을 신상 런칭');
    set(AGENCY_REQUEST_LABELS.periodStart, '2026-09-01');
    set(AGENCY_REQUEST_LABELS.periodEnd, '2026-09-14');
    set(AGENCY_REQUEST_LABELS.description, '신상품 출시 행사');
    set(AGENCY_REQUEST_LABELS.benefit, 'VIP 15% 할인');
    const idx = rows.findIndex((r) => String(r?.[0] ?? '') === AGENCY_REQUEST_LABELS.productsHeader);
    rows[idx + 2] = ['가을 코트', '199000', '169000'];
    const parsed = parseRequestSheet(rows);
    expect(parsed.missingRequired).toEqual([]);
    expect(parsed.title).toBe('가을 신상 런칭');
    expect(parsed.products).toEqual([{ name: '가을 코트', price: 199000, salePrice: 169000 }]);
  });
});
