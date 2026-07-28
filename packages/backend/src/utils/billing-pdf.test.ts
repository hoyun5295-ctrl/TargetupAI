/**
 * PDF 생성 CT 스모크 (★ 2026-07-28 추출 직후 신설)
 *
 * 신설 사유: 그림 코드를 라우트에서 CT로 **통째로 옮겼다.** 소스 대조로 "한 글자도 안 바뀌었다"까지는
 *   확인했지만, 그건 파일이 열리고 폰트를 찾고 스트림이 닫히는 것까지 보장하지 않는다.
 *   직원 다운로드와 컨펌 메일 첨부가 같은 함수를 쓰므로, 여기서 터지면 둘 다 죽는다.
 *   실제로 렌더해서 `%PDF` 헤더가 나오는지까지 본다(6원칙 ② — 효과 검증 후에만 성공).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { renderBillingStatementPdf, renderInvoicePdf } from './billing-pdf';

const COMPANY = {
  company_name: '테스트상사 주식회사',
  business_number: '123-45-67890',
  ceo_name: '홍길동',
  address: '서울특별시 강남구 테헤란로 1',
  contact_name: '김담당',
  contact_phone: '02-0000-0000',
  contact_email: 'test@example.invalid',
  business_type: '서비스',
  business_category: '소프트웨어',
};

const isPdf = (p: string) => readFileSync(p).subarray(0, 4).toString('latin1') === '%PDF';

describe('PDF 생성 CT 스모크 (2026-07-28)', () => {
  it('정산서 PDF가 실제 파일로 만들어진다', async () => {
    const bil = {
      ...COMPANY,
      id: '11111111-1111-1111-1111-111111111111',
      billing_year: 2026, billing_month: 7,
      billing_start: '2026-07-01', billing_end: '2026-07-31',
      subtotal: 1000000, vat: 100000, total_amount: 1100000, ai_credit_supply: 0,
      user_name: null,
    };
    const items = [
      { item_date: '2026-07-01', message_type: 'SMS', channel: 'web', count: 100, unit_price: 9, amount: 900, agent_send_id: null, user_id: null },
    ];
    const { pdfPath, displayFilename } = await renderBillingStatementPdf(bil, items);
    expect(existsSync(pdfPath), '파일이 생성되지 않았다').toBe(true);
    expect(isPdf(pdfPath), 'PDF 헤더가 아니다').toBe(true);
    // 고객이 보는 이름 — 화면·메일과 같은 말(거래내역서)을 쓴다.
    expect(displayFilename).toBe('거래내역서_테스트상사 주식회사_2026-07.pdf');
    // 디스크 경로는 표시 이름과 달라야 한다(같으면 동시 렌더에서 같은 파일을 두 스트림이 문다).
    expect(pdfPath.endsWith(displayFilename), '디스크 경로가 표시 이름과 같다').toBe(false);
    unlinkSync(pdfPath);
  });

  it('같은 장을 두 번 렌더해도 서로 다른 파일이다 — 덮어쓰기·동시 쓰기 차단', async () => {
    const bil = {
      ...COMPANY,
      id: '44444444-4444-4444-4444-444444444444',
      billing_year: 2026, billing_month: 7,
      billing_start: '2026-07-01', billing_end: '2026-07-31',
      subtotal: 100, vat: 10, total_amount: 110, ai_credit_supply: 0, user_name: null,
    };
    const a = await renderBillingStatementPdf(bil, []);
    const b = await renderBillingStatementPdf(bil, []);
    expect(a.pdfPath).not.toBe(b.pdfPath);
    expect(a.displayFilename, '표시 이름은 같아야 한다 — 고객에게는 같은 문서다').toBe(b.displayFilename);
    expect(existsSync(a.pdfPath) && existsSync(b.pdfPath), '앞 렌더가 덮어써져 사라졌다').toBe(true);
    unlinkSync(a.pdfPath); unlinkSync(b.pdfPath);
  });

  it('거래내역서 PDF가 실제 파일로 만들어진다 — 컨펌 메일 첨부가 이 함수를 쓴다', async () => {
    const inv = {
      ...COMPANY,
      id: '22222222-2222-2222-2222-222222222222',
      billing_start: '2026-07-01', billing_end: '2026-07-31',
      subtotal: 2000000, vat: 200000, total_amount: 2200000,
    };
    const { pdfPath, displayFilename } = await renderInvoicePdf(inv);
    expect(existsSync(pdfPath), '파일이 생성되지 않았다').toBe(true);
    expect(isPdf(pdfPath), 'PDF 헤더가 아니다').toBe(true);
    expect(displayFilename).toBe('거래내역서_테스트상사 주식회사_2026-07-01_2026-07-31.pdf');
    unlinkSync(pdfPath);
  });

  it('항목이 많아도 렌더가 끝난다 — 페이지 넘김 경로', async () => {
    const bil = {
      ...COMPANY,
      id: '33333333-3333-3333-3333-333333333333',
      billing_year: 2026, billing_month: 7,
      billing_start: '2026-07-01', billing_end: '2026-07-31',
      subtotal: 5000000, vat: 500000, total_amount: 5500000, ai_credit_supply: 0,
      user_name: '담당자',
    };
    const items = Array.from({ length: 120 }, (_, i) => ({
      item_date: '2026-07-01', message_type: i % 2 ? 'LMS' : 'SMS', channel: i % 3 ? 'web' : 'agent',
      count: 10 + i, unit_price: 9, amount: (10 + i) * 9,
      agent_send_id: i % 3 ? null : `B00${i % 10}`, user_id: null,
    }));
    const { pdfPath } = await renderBillingStatementPdf(bil, items);
    expect(isPdf(pdfPath)).toBe(true);
    unlinkSync(pdfPath);
  });
});
