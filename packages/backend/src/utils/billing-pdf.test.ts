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
import {
  renderBillingStatementPdf, renderInvoicePdf,
  contentRowHeight, toSingleLine, DETAIL_ROW_MIN_H,
} from './billing-pdf';

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

/**
 * 상세 행 높이 (★ 2026-08-06 · 서수란 접수 "PDF 구분값 데이터 검증 이슈")
 *
 * 구분 칸을 말줄임하던 뿌리가 **행 높이 18pt 고정**이었다. 높이를 내용에서 만들면 몇 줄이 되든
 * 다음 행을 침범하지 않으므로 자를 이유가 사라진다. 회귀 축은 둘이다 —
 * ①한 줄 행이 예전 높이 그대로일 것(아니면 모든 문서의 쪽수가 늘어난다)
 * ②두 줄 이상이면 줄 수만큼 커질 것(아니면 겹침이 돌아온다).
 */
describe('상세 행 높이 — 내용에서 만든다 (2026-08-06)', () => {
  const LINE = 10.640625; // 8pt 맑은고딕 실측 한 줄 높이

  it('한 줄이면 예전 고정 높이 그대로다 — 대부분 문서의 쪽수가 바뀌지 않는다', () => {
    expect(contentRowHeight(DETAIL_ROW_MIN_H, LINE, LINE, LINE)).toBe(DETAIL_ROW_MIN_H);
  });

  it('두 줄·세 줄이면 줄 수만큼 커진다 — 다음 행을 침범하지 않는 유일한 조건', () => {
    expect(contentRowHeight(DETAIL_ROW_MIN_H, LINE, LINE * 2, LINE)).toBe(DETAIL_ROW_MIN_H + Math.ceil(LINE));
    expect(contentRowHeight(DETAIL_ROW_MIN_H, LINE, LINE, LINE * 3)).toBe(DETAIL_ROW_MIN_H + Math.ceil(LINE * 2));
  });

  it('가장 높은 칸이 행 높이를 정한다 — 구분이 짧아도 유형이 두 줄이면 커진다', () => {
    expect(contentRowHeight(DETAIL_ROW_MIN_H, LINE, LINE, LINE * 2))
      .toBe(contentRowHeight(DETAIL_ROW_MIN_H, LINE, LINE * 2, LINE));
  });

  it('최소 높이는 표마다 다르다 — 1페이지 항목표(22pt)와 2페이지 상세표(18pt)가 같은 함수를 쓴다', () => {
    expect(contentRowHeight(22, LINE, LINE)).toBe(22);
    expect(contentRowHeight(22, LINE, LINE * 2)).toBe(22 + Math.ceil(LINE));
  });

  /**
   * ★ Codex 적대검증 medium (0806) — `varchar(100)`은 **글자 수** 제한이지 줄 수 제한이 아니다.
   * 값 안에 개행이 있으면 폭과 무관하게 줄이 늘어 한 행이 페이지의 표 영역(663pt)을 넘을 수 있다.
   * 개행을 지워야 "줄 수는 칸 폭으로만 결정된다"는 상한이 코드로 성립한다.
   */
  it('강제 개행 7종을 전부 지운다 — 줄 수가 글자 수와 무관해지는 것을 막는다', () => {
    // 실측(0806)으로 pdfkit이 강제 개행으로 처리하는 문자들. `\s`만 쓰면 U+0085가 살아남는다.
    //   제어문자를 소스에 리터럴로 적지 않는다 — 파일이 바이너리로 잡힌다.
    const BREAKS: Record<string, string> = {
      LF: String.fromCharCode(0x0a), CR: String.fromCharCode(0x0d),
      VT: String.fromCharCode(0x0b), FF: String.fromCharCode(0x0c),
      NEL: String.fromCharCode(0x85),
      LS: String.fromCharCode(0x2028), PS: String.fromCharCode(0x2029),
    };
    for (const [name, ch] of Object.entries(BREAKS)) {
      expect(toSingleLine('A' + ch.repeat(62) + 'B'), `${name}가 남았다`).toBe('A B');
    }
    expect(toSingleLine('B0093 / 더화이트\r\n커뮤니케이션')).toBe('B0093 / 더화이트 커뮤니케이션');
    expect(toSingleLine('  앞뒤 공백  ')).toBe('앞뒤 공백');
    expect(toSingleLine(null)).toBe('');
    expect(toSingleLine(undefined)).toBe('');
  });

  /**
   * ★ Codex 6R high 후속 — 반대 방향의 잘못. `\s`는 NBSP·전각 공백까지 잡아서
   * 그것들을 ASCII 공백으로 바꾸면 **고객사 이름 표시가 변형된다**(발급명은 게이트웨이 원장 값이다).
   * 강제 개행이 아닌 공백은 그대로 둬야 한다 — 줄 수를 늘리지 않으므로 지울 이유가 없다.
   */
  it('정상 공백은 건드리지 않는다 — NBSP·전각 공백·연속 공백 보존', () => {
    expect(toSingleLine('더화이트 커뮤니케이션　본점')).toBe('더화이트 커뮤니케이션　본점');
    expect(toSingleLine('A  B')).toBe('A  B');
  });

  it('개행이 든 계정명도 한 행에 그려진다 — 쪽수가 늘지 않는다', async () => {
    const bil = {
      ...COMPANY,
      id: '77777777-7777-7777-7777-777777777777',
      billing_year: 2026, billing_month: 7,
      billing_start: '2026-07-01', billing_end: '2026-07-31',
      subtotal: 1000, vat: 100, total_amount: 1100, ai_credit_supply: 0, user_name: null,
    };
    const base = {
      item_date: '2026-07-01', message_type: 'SMS', channel: 'web',
      total_count: 10, success_count: 10, fail_count: 0, pending_count: 0,
      unit_price: 7.2, amount: 72,
    };
    // 대조군은 **같은 내용의 공백 판**이다 — 폭 때문에 늘어나는 줄은 양쪽이 같고,
    //   개행이 살아남았을 때만 왼쪽이 더 두꺼워진다(그 경우 30줄이라 한 행이 페이지를 넘긴다).
    const withBreaks = Array.from({ length: 20 }, () => ({ ...base, user_name: 'A\n'.repeat(30) + 'B' }));
    const spaced = Array.from({ length: 20 }, () => ({ ...base, user_name: 'A '.repeat(30) + 'B' }));
    const a = await renderBillingStatementPdf(bil, withBreaks);
    const b = await renderBillingStatementPdf(bil, spaced);
    const pages = (p: string) => readFileSync(p).toString('latin1').split('/Type /Page\n').length - 1;
    expect(pages(a.pdfPath), '개행이 줄 수로 살아남았다 — 한 행이 페이지를 넘길 수 있다').toBe(pages(b.pdfPath));
    unlinkSync(a.pdfPath); unlinkSync(b.pdfPath);
  });

  it('측정 실패(0·NaN)면 옛 고정 높이로 돌아간다 — 0높이 행을 만들지 않는다', () => {
    expect(contentRowHeight(DETAIL_ROW_MIN_H, 0, 999)).toBe(DETAIL_ROW_MIN_H);
    expect(contentRowHeight(DETAIL_ROW_MIN_H, NaN, 999)).toBe(DETAIL_ROW_MIN_H);
    expect(contentRowHeight(DETAIL_ROW_MIN_H, LINE)).toBe(DETAIL_ROW_MIN_H);
    expect(contentRowHeight(0, LINE, LINE * 2), '최소 높이가 0이면 상세표 기본값으로').toBe(DETAIL_ROW_MIN_H + Math.ceil(LINE));
  });

  it('긴 구분 라벨이 잘리지 않고 행이 늘어난다 — 같은 행 수라도 쪽수가 더 나온다', async () => {
    const bil = {
      ...COMPANY,
      id: '55555555-5555-5555-5555-555555555555',
      billing_year: 2026, billing_month: 7,
      billing_start: '2026-07-01', billing_end: '2026-07-31',
      subtotal: 100000, vat: 10000, total_amount: 110000, ai_credit_supply: 0, user_name: null,
    };
    // 실제 접수 값 — 더화이트 클레임의 그 라벨(8pt 실측 111.1pt · 구분 칸 안쪽 83pt라 두 줄)
    const long = Array.from({ length: 60 }, () => ({
      item_date: '2026-07-01', message_type: 'SMS', channel: 'agent',
      total_count: 100, success_count: 100, fail_count: 0, pending_count: 0,
      unit_price: 9, amount: 900, agent_send_id: 'B0093', cust_name: '더화이트커뮤니케이션',
    }));
    const short = long.map((r) => ({ ...r, cust_name: null }));

    const a = await renderBillingStatementPdf(bil, long);
    const b = await renderBillingStatementPdf(bil, short);
    const pages = (p: string) => readFileSync(p).toString('latin1').split('/Type /Page\n').length - 1;
    expect(pages(a.pdfPath), '페이지를 못 세고 있다 — 이 회귀 검사가 무효다').toBeGreaterThan(0);
    expect(pages(a.pdfPath), '두 줄이 됐는데 쪽수가 그대로다 — 행 높이가 안 늘었다(겹침)').toBeGreaterThan(pages(b.pdfPath));
    unlinkSync(a.pdfPath); unlinkSync(b.pdfPath);
  });

  /**
   * ★ Codex 적대검증 high (0806) — 숫자 칸도 흐른다.
   * `lineBreak: false`는 `width`가 있으면 줄바꿈을 **막지 못한다**(0806 실측: doc.y가 두 줄만큼 이동).
   * 그래서 "숫자 칸은 한 줄"이라는 전제를 두지 않고 모든 칸을 재서 행 높이에 넣는다.
   * 여기서 쓰는 8자리 건수는 실패·대기 칸(안쪽 37pt)에 38.8pt로 실제로 안 들어가는 값이다.
   */
  it('큰 건수·금액도 행 높이에 반영된다 — 숫자 칸이 흘러도 겹치지 않는다', async () => {
    const bil = {
      ...COMPANY,
      id: '66666666-6666-6666-6666-666666666666',
      billing_year: 2026, billing_month: 7,
      billing_start: '2026-07-01', billing_end: '2026-07-31',
      subtotal: 900000000, vat: 90000000, total_amount: 990000000, ai_credit_supply: 0, user_name: null,
    };
    const row = (fail: number, amount: number) => ({
      item_date: '2026-07-01', message_type: 'SMS', channel: 'web',
      total_count: 12345678, success_count: 12345678, fail_count: fail, pending_count: 0,
      unit_price: 7.2, amount, user_name: '한줄로',
    });
    const big = Array.from({ length: 60 }, () => row(12345678, 123456789));
    const small = Array.from({ length: 60 }, () => row(3, 900));

    const a = await renderBillingStatementPdf(bil, big);
    const b = await renderBillingStatementPdf(bil, small);
    const pages = (p: string) => readFileSync(p).toString('latin1').split('/Type /Page\n').length - 1;
    expect(pages(a.pdfPath), '숫자가 흘렀는데 쪽수가 그대로다 — 행 높이에 안 들어갔다(겹침)').toBeGreaterThan(pages(b.pdfPath));
    unlinkSync(a.pdfPath); unlinkSync(b.pdfPath);
  });
});
