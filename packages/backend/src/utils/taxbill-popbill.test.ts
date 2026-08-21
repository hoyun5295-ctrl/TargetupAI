/**
 * 팝빌 세금계산서 발행 계약 테스트 (2026-07-30)
 *
 * SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §7-0.
 * 국세청으로 나가는 실문서라 payload 계약을 순수 함수로 고정한다 — 금액 정수 String·
 * 회계 항등식·24자 문서번호·수정발행 짝·웹훅 판정. 기대값은 리터럴로 적는다(표에서 유도 금지).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  normalizeCorpNum,
  toWriteDate,
  buildInvoicerMgtKey,
  splitBizTypeItem,
  buildTaxinvoicePayload,
  decideWebhookUpdate,
  judgeInfoState,
  planModifyIssue,
  getPopbillConfig,
  isPopbillEnabled,
  selectTaxbillResendTargets,
  selectTaxbillArchiveTargets,
  enqueueTaxbillArchiveCopies,
  sendEmailAsync,
  enqueueTaxbillResendsForIssue,
  TAXBILL_SENDMAIL_TIMEOUT_MS,
  TaxinvoiceBuildInput,
} from './taxbill-popbill';
import { TaxbillParty } from './billing-settings';

const party: TaxbillParty = {
  companyName: '금강제화',
  bizNumber: '214-81-12345',
  ceoName: 'SHIN KIEUN(김현정)(각자대표),이종문(각자대표)',
  address: '서울시 성동구',
  bizType: '도소매',
  bizItem: '제화',
  source: 'company_contact',
};

const baseInput: TaxinvoiceBuildInput = {
  issueDate: '2026-07-31',
  supplyAmount: 13397454,
  taxAmount: 1339745,
  totalAmount: 14737199,
  party,
  invoiceeEmail: 'billing@kumkang.co.kr',
  invoicerMgtKey: 'TU260731-1234567890abc',
  itemName: '7월 메시징 이용료',
};

describe('normalizeCorpNum — 사업자번호 10자리 정규화', () => {
  it('하이픈 제거 후 10자리만 유효', () => {
    expect(normalizeCorpNum('667-86-00578')).toBe('6678600578');
    expect(normalizeCorpNum('6678600578')).toBe('6678600578');
  });
  it('10자리가 아니면 null — 빈 값·9자리·주민번호 형태 전부', () => {
    expect(normalizeCorpNum('')).toBeNull();
    expect(normalizeCorpNum(null)).toBeNull();
    expect(normalizeCorpNum('123-45-678')).toBeNull();
    expect(normalizeCorpNum('123456-1234567')).toBeNull();
  });
});

describe('buildInvoicerMgtKey — 팝빌 문서번호 발번', () => {
  it('TU + YYMMDD + - + uuid 앞 13자 = 22자, 행마다 결정적(재시도 = 같은 번호 = 중복 발행 차단)', () => {
    const k1 = buildInvoicerMgtKey('2026-07-31', '1b1d6619-413c-4abf-8cbc-9ef78df4fea3');
    const k2 = buildInvoicerMgtKey('2026-07-31', '1b1d6619-413c-4abf-8cbc-9ef78df4fea3');
    expect(k1).toBe('TU260731-1b1d6619413c4');
    expect(k1).toBe(k2);
    expect(k1.length).toBe(22);
    expect(/^[0-9A-Za-z_-]+$/.test(k1)).toBe(true);
  });
  it('행이 다르면 번호도 다르다', () => {
    const a = buildInvoicerMgtKey('2026-07-31', '1b1d6619-413c-4abf-8cbc-9ef78df4fea3');
    const b = buildInvoicerMgtKey('2026-07-31', '58a83513-23bf-4447-9535-9261796cda07');
    expect(a).not.toBe(b);
  });
  it('날짜·uuid 형식이 깨지면 throw', () => {
    expect(() => buildInvoicerMgtKey('2026-7-1', '1b1d6619-413c-4abf-8cbc-9ef78df4fea3')).toThrow();
    expect(() => buildInvoicerMgtKey('2026-07-31', 'P0070')).toThrow();
  });
});

describe('toWriteDate·splitBizTypeItem', () => {
  it('YYYY-MM-DD → YYYYMMDD, 그 외 throw', () => {
    expect(toWriteDate('2026-07-31')).toBe('20260731');
    expect(() => toWriteDate('20260731')).toThrow();
  });
  it('업태/종목은 첫 슬래시에서 가른다 (INVITO_INFO.bizType 형식)', () => {
    expect(splitBizTypeItem('서비스 / 소프트웨어및앱개발 공급')).toEqual({
      bizType: '서비스',
      bizItem: '소프트웨어및앱개발 공급',
    });
    expect(splitBizTypeItem('서비스')).toEqual({ bizType: '서비스', bizItem: '' });
  });
});

describe('buildTaxinvoicePayload — RegistIssue 계약', () => {
  it('필수 축이 문서 값 그대로 박제된다 — 정발행·과세·정과금·청구, 금액은 정수 String', () => {
    const p = buildTaxinvoicePayload(baseInput);
    expect(p.issueType).toBe('정발행');
    expect(p.taxType).toBe('과세');
    expect(p.chargeDirection).toBe('정과금');
    expect(p.purposeType).toBe('청구');
    expect(p.writeDate).toBe('20260731');
    expect(p.supplyCostTotal).toBe('13397454');
    expect(p.taxTotal).toBe('1339745');
    expect(p.totalAmount).toBe('14737199');
    expect(p.invoicerMgtKey).toBe('TU260731-1234567890abc');
    expect(p.invoiceeType).toBe('사업자');
    expect(p.invoiceeCorpNum).toBe('2148112345');
    expect(p.invoiceeEmail1).toBe('billing@kumkang.co.kr');
    expect(p.detailList).toHaveLength(1);
    expect(p.detailList[0]).toMatchObject({ serialNum: 1, itemName: '7월 메시징 이용료', supplyCost: '13397454', tax: '1339745' });
    expect(p.modifyCode).toBeUndefined();
  });

  // ★ 2026-08-05 품목 줄 거래일자를 안 보내 문서의 월·일이 빈 칸으로 나갔다(금강제화 발행분 실물 확인).
  //   두 날짜가 어긋난 계산서는 바로잡는 길이 수정발행뿐이라 비용이 크다 — 일치를 계약으로 못 박는다.
  it('품목 줄 거래일자는 작성일자와 **같은 값**이다 — 따로 계산하면 문서 상단과 품목이 갈린다', () => {
    const p = buildTaxinvoicePayload(baseInput);
    expect(p.detailList[0].purchaseDT, '품목 거래일자가 비어 있다').toBe(p.writeDate);
    expect(p.detailList[0].purchaseDT).toBe('20260731');
  });

  it('작성일자를 바꾸면 품목 거래일자도 따라 바뀐다 — 한 변수에서 파생돼야 성립한다', () => {
    const p = buildTaxinvoicePayload({ ...baseInput, issueDate: '2026-08-31' });
    expect(p.writeDate).toBe('20260831');
    expect(p.detailList[0].purchaseDT).toBe('20260831');
  });

  it('공급자 = 인비토 고정 (사업자번호 10자리 정규화)', () => {
    const p = buildTaxinvoicePayload(baseInput);
    expect(p.invoicerCorpNum).toBe('6678600578');
    expect(p.invoicerCorpName).toContain('인비토');
  });

  it('소수 금액 = 절사 규칙 위반으로 throw (numeric이 소수로 오면 여기서 잡힌다)', () => {
    expect(() => buildTaxinvoicePayload({ ...baseInput, supplyAmount: 13397454.84 })).toThrow(/절사/);
  });

  it('회계 항등식 — 공급가액+세액≠합계면 throw', () => {
    expect(() => buildTaxinvoicePayload({ ...baseInput, totalAmount: 14737200 })).toThrow(/합계 불일치/);
  });

  it('음수 금액 throw — 마이너스는 수정세금계산서 사유로만', () => {
    expect(() => buildTaxinvoicePayload({ ...baseInput, supplyAmount: -100, totalAmount: 1339645 })).toThrow(/음수/);
  });

  it('공급받는자 사업자번호 없으면 throw (3단 전부 빈 회사 — 발행 불가를 명확한 사유로)', () => {
    expect(() =>
      buildTaxinvoicePayload({ ...baseInput, party: { ...party, bizNumber: null } }),
    ).toThrow(/사업자번호/);
  });

  it('수정발행 = modifyCode(1·2·4·6)와 당초 승인번호가 짝 — 한쪽만 있으면 throw', () => {
    const neg = { supplyAmount: -13397454, taxAmount: -1339745, totalAmount: -14737199 };
    const ok = buildTaxinvoicePayload({ ...baseInput, ...neg, modifyCode: 6, orgNtsConfirmNum: '20260731-ORG-0001' });
    expect(ok.modifyCode).toBe(6);
    expect(ok.orgNTSConfirmNum).toBe('20260731-ORG-0001');
    expect(() => buildTaxinvoicePayload({ ...baseInput, ...neg, modifyCode: 6 })).toThrow(/함께/);
    expect(() => buildTaxinvoicePayload({ ...baseInput, orgNtsConfirmNum: 'X' })).toThrow(/함께/);
    expect(() => buildTaxinvoicePayload({ ...baseInput, ...neg, modifyCode: 3, orgNtsConfirmNum: 'X' })).toThrow(/수정사유/);
  });

  it('★부호 계약 — 사유 4·6은 음(-) 문서만, 양수로 오면 throw (0730 Codex ⑤ 정식 구현)', () => {
    expect(() =>
      buildTaxinvoicePayload({ ...baseInput, modifyCode: 6, orgNtsConfirmNum: 'ORG' }),
    ).toThrow(/음\(-\) 문서/);
    expect(() =>
      buildTaxinvoicePayload({ ...baseInput, modifyCode: 4, orgNtsConfirmNum: 'ORG', orgWriteDate: '2026-07-31' }),
    ).toThrow(/음\(-\) 문서/);
  });

  it('부호 계약 — 부호가 섞인 장·합계 0원 수정 장은 거부', () => {
    expect(() =>
      buildTaxinvoicePayload({
        ...baseInput, supplyAmount: 100, taxAmount: -10, totalAmount: 90,
        modifyCode: 2, orgNtsConfirmNum: 'ORG', orgWriteDate: '2026-07-31',
      }),
    ).toThrow(/부호가 섞인/);
    expect(() =>
      buildTaxinvoicePayload({
        ...baseInput, supplyAmount: 0, taxAmount: 0, totalAmount: 0,
        modifyCode: 2, orgNtsConfirmNum: 'ORG', orgWriteDate: '2026-07-31',
      }),
    ).toThrow(/0원/);
  });

  it('사유 2·4는 remark1에 당초 작성일자 기재 — orgWriteDate 없으면 throw', () => {
    const p = buildTaxinvoicePayload({
      ...baseInput, supplyAmount: -1000, taxAmount: -100, totalAmount: -1100,
      modifyCode: 2, orgNtsConfirmNum: 'ORG', orgWriteDate: '2026-07-15',
    });
    expect(p.remark1).toBe('당초 작성일자 2026-07-15');
    expect(() =>
      buildTaxinvoicePayload({
        ...baseInput, supplyAmount: -1000, taxAmount: -100, totalAmount: -1100,
        modifyCode: 2, orgNtsConfirmNum: 'ORG',
      }),
    ).toThrow(/작성일자/);
    // 사유 6은 당초 작성일자 불요 — remark1 없음
    const p6 = buildTaxinvoicePayload({
      ...baseInput, supplyAmount: -1000, taxAmount: -100, totalAmount: -1100,
      modifyCode: 6, orgNtsConfirmNum: 'ORG',
    });
    expect(p6.remark1).toBeUndefined();
  });

  it('0원 계산서는 통과한다 (0 + 0 = 0 — 감액 전액 조정 케이스)', () => {
    const p = buildTaxinvoicePayload({ ...baseInput, supplyAmount: 0, taxAmount: 0, totalAmount: 0 });
    expect(p.supplyCostTotal).toBe('0');
  });
});

describe('decideWebhookUpdate — 웹훅 판정(§7-0 stateCode 계약)', () => {
  it('304 전송완료 → issued + 국세청승인번호 (문서 표기 ntsconfirmNum·camelCase 둘 다 수용)', () => {
    expect(
      decideWebhookUpdate({ invoicerMgtKey: 'TU260731-abc', stateCode: 304, ntsconfirmNum: 'NTS-001' }),
    ).toEqual({ mgtKey: 'TU260731-abc', set: { status: 'issued', ntsConfirmNum: 'NTS-001' } });
    expect(
      decideWebhookUpdate({ invoicerMgtKey: 'TU260731-abc', stateCode: 304, ntsConfirmNum: 'NTS-002' }),
    ).toEqual({ mgtKey: 'TU260731-abc', set: { status: 'issued', ntsConfirmNum: 'NTS-002' } });
  });

  it('305 전송실패 → failed + 사유 (재전송은 팝빌 사이트에서)', () => {
    const d = decideWebhookUpdate({ invoicerMgtKey: 'TU260731-abc', stateCode: 305 });
    expect(d?.set.status).toBe('failed');
    expect(d?.set.error).toContain('305');
  });

  it('301 전송전 → 관측만 (발행 축은 issueReadyTaxbills가 이미 기록)', () => {
    expect(decideWebhookUpdate({ invoicerMgtKey: 'TU260731-abc', stateCode: 301 })).toEqual({
      mgtKey: 'TU260731-abc',
      set: {},
    });
  });

  it('매칭 키 없으면 null — 핸들러는 그래도 200 "OK" (테스트 핑·타 이벤트)', () => {
    expect(decideWebhookUpdate({})).toBeNull();
    expect(decideWebhookUpdate(null)).toBeNull();
    expect(decideWebhookUpdate({ stateCode: 304 })).toBeNull();
  });
});

describe('planModifyIssue — 사유별 장 구성 계약', () => {
  const orig = {
    ntsConfirmNum: 'NTS-ORIG-001',
    issueDate: '2026-07-31',
    supplyAmount: 1000000,
    taxAmount: 100000,
    totalAmount: 1100000,
  };

  it('사유 6 착오 이중발급 = -전액 1장, 작성일자 = 당초 작성일자', () => {
    expect(planModifyIssue(orig, { code: 6 })).toEqual([
      { modifyCode: 6, orgNtsConfirmNum: 'NTS-ORIG-001', issueDate: '2026-07-31', supplyAmount: -1000000, taxAmount: -100000, totalAmount: -1100000 },
    ]);
  });

  it('사유 4 계약 해제 = -전액 1장, 작성일자 = 해제일(필수 입력)', () => {
    expect(planModifyIssue(orig, { code: 4, writeDate: '2026-08-05' })).toEqual([
      { modifyCode: 4, orgNtsConfirmNum: 'NTS-ORIG-001', issueDate: '2026-08-05', supplyAmount: -1000000, taxAmount: -100000, totalAmount: -1100000 },
    ]);
    expect(() => planModifyIssue(orig, { code: 4 })).toThrow(/해제일.*입력되지/);
  });

  it('사유 2 공급가액 변동 = ±변동분 1장, 작성일자 = 변동일 — 0원·부호 섞임·소수 거부', () => {
    expect(planModifyIssue(orig, { code: 2, writeDate: '2026-08-03', deltaSupply: -200000, deltaTax: -20000 })).toEqual([
      { modifyCode: 2, orgNtsConfirmNum: 'NTS-ORIG-001', issueDate: '2026-08-03', supplyAmount: -200000, taxAmount: -20000, totalAmount: -220000 },
    ]);
    expect(planModifyIssue(orig, { code: 2, writeDate: '2026-08-03', deltaSupply: 50000, deltaTax: 5000 })[0].totalAmount).toBe(55000);
    expect(() => planModifyIssue(orig, { code: 2, writeDate: '2026-08-03', deltaSupply: 0, deltaTax: 0 })).toThrow(/0원/);
    expect(() => planModifyIssue(orig, { code: 2, writeDate: '2026-08-03', deltaSupply: 100, deltaTax: -10 })).toThrow(/부호/);
    expect(() => planModifyIssue(orig, { code: 2, writeDate: '2026-08-03', deltaSupply: 100.5, deltaTax: 10 })).toThrow(/정수/);
  });

  it('★사유 2 잔액 계약 — 전액·초과 감액은 변동(2)이 아니라 해제(4)·이중발급(6)이다 (Codex 3R ②)', () => {
    // 변동 후 공급가액 0 = 전액 취소
    expect(() => planModifyIssue(orig, { code: 2, writeDate: '2026-08-03', deltaSupply: -1000000, deltaTax: -100000 })).toThrow(/해제\(4\)/);
    // 초과 감액 = 음수 잔액
    expect(() => planModifyIssue(orig, { code: 2, writeDate: '2026-08-03', deltaSupply: -1200000, deltaTax: -100000 })).toThrow(/해제\(4\)/);
    // 변동 후 세액 음수
    expect(() => planModifyIssue(orig, { code: 2, writeDate: '2026-08-03', deltaSupply: -100, deltaTax: -200000 })).toThrow(/세액이 음수/);
    // 잔액이 양수로 남으면 통과
    expect(planModifyIssue(orig, { code: 2, writeDate: '2026-08-03', deltaSupply: -999999, deltaTax: -100000 })[0].supplyAmount).toBe(-999999);
  });

  it('★빈 입력·null은 0이 아니라 거부다 — Number(null)=0 함정 차단 (Codex 3R ③)', () => {
    expect(() => planModifyIssue(orig, { code: 2, writeDate: '2026-08-03', deltaSupply: null, deltaTax: -10 })).toThrow(/입력되지/);
    expect(() => planModifyIssue(orig, { code: 2, writeDate: '2026-08-03', deltaSupply: -10 })).toThrow(/입력되지/);
    expect(() => planModifyIssue(orig, { code: 1, correctedSupply: null, correctedTax: 100 })).toThrow(/입력되지/);
    expect(() => planModifyIssue(orig, { code: 4, writeDate: '' })).toThrow(/입력되지/);
  });

  it('★빈 문자열·공백이 원형으로 와도 거부다 — 라우트가 Number()를 먼저 걸면 이 검증이 무력화된다 (Codex 4R ③)', () => {
    expect(() => planModifyIssue(orig, { code: 2, writeDate: '2026-08-03', deltaSupply: '', deltaTax: '100' })).toThrow(/입력되지/);
    expect(() => planModifyIssue(orig, { code: 2, writeDate: '2026-08-03', deltaSupply: '  ', deltaTax: '100' })).toThrow(/입력되지/);
    expect(() => planModifyIssue(orig, { code: 1, correctedSupply: '', correctedTax: '0' })).toThrow(/입력되지/);
    // 문자열 정수는 통과한다 (JSON body가 문자열로 올 수 있다)
    expect(planModifyIssue(orig, { code: 2, writeDate: '2026-08-03', deltaSupply: '-100', deltaTax: '-10' })[0].totalAmount).toBe(-110);
  });

  it('★사유 1 정정 합계 0원 거부 — 0원 정 장은 빌더가 거부해 부(-) 장만 발행되는 반쪽을 만든다 (Codex 4R ①)', () => {
    expect(() => planModifyIssue(orig, { code: 1, correctedSupply: 0, correctedTax: 0 })).toThrow(/이중발급\(6\)/);
    // 합계가 양수면 통과 (세액 0원 정정은 성립)
    expect(planModifyIssue(orig, { code: 1, correctedSupply: 900000, correctedTax: 0 })[1].totalAmount).toBe(900000);
  });

  it('사유 1 기재사항 착오정정 = 부(-전액)+정(정정 금액) 2장, 작성일자 둘 다 당초 작성일자', () => {
    const rows = planModifyIssue(orig, { code: 1, correctedSupply: 1000000, correctedTax: 100000 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ modifyCode: 1, issueDate: '2026-07-31', supplyAmount: -1000000, totalAmount: -1100000 });
    expect(rows[1]).toMatchObject({ modifyCode: 1, issueDate: '2026-07-31', supplyAmount: 1000000, totalAmount: 1100000 });
    expect(() => planModifyIssue(orig, { code: 1, correctedSupply: -1, correctedTax: 0 })).toThrow(/음수/);
    expect(() => planModifyIssue(orig, { code: 1 })).toThrow(/입력되지/);
  });

  it('당초 승인번호 없으면 어떤 사유도 성립 안 한다 — 전송성공 상태에서만 수정 가능(§7-0)', () => {
    expect(() => planModifyIssue({ ...orig, ntsConfirmNum: null }, { code: 6 })).toThrow(/승인번호/);
    expect(() => planModifyIssue({ ...orig, ntsConfirmNum: '  ' }, { code: 6 })).toThrow(/승인번호/);
  });

  it('지원 밖 사유(3·5)·당초 항등식 불일치는 거부', () => {
    expect(() => planModifyIssue(orig, { code: 3 })).toThrow(/수정사유/);
    expect(() => planModifyIssue({ ...orig, totalAmount: 1100001 }, { code: 6 })).toThrow(/항등식/);
  });
});

describe('judgeInfoState — 재조회 자가치유 판정 (truthy ≠ 발행)', () => {
  it('3xx = 발행 계열만 issued — 단 305는 예외', () => {
    expect(judgeInfoState(300)).toBe('issued');
    expect(judgeInfoState(304)).toBe('issued');
    expect(judgeInfoState(399)).toBe('issued');
  });
  it('305 = 국세청 전송실패 — 웹훅 판정(failed)과 같은 결론이어야 전송실패가 안 숨는다', () => {
    expect(judgeInfoState(305)).toBe('nts_failed');
  });
  it('6xx = 발행취소 계열 — issued로 승격하면 취소 문서가 살아난다', () => {
    expect(judgeInfoState(600)).toBe('cancelled');
    expect(judgeInfoState(699)).toBe('cancelled');
  });
  it('그 외·비숫자 = unknown — 성공으로 승격하지 않는다(fail-closed)', () => {
    expect(judgeInfoState(100)).toBe('unknown');
    expect(judgeInfoState(undefined)).toBe('unknown');
    expect(judgeInfoState('abc')).toBe('unknown');
    expect(judgeInfoState(null)).toBe('unknown');
  });
});

describe('게이트 — 기본은 닫힘', () => {
  it('POPBILL_ENABLED 미설정 = 비활성 (명시 true만 연다)', () => {
    const prev = process.env.POPBILL_ENABLED;
    delete process.env.POPBILL_ENABLED;
    expect(isPopbillEnabled()).toBe(false);
    process.env.POPBILL_ENABLED = 'false';
    expect(isPopbillEnabled()).toBe(false);
    process.env.POPBILL_ENABLED = 'true';
    expect(isPopbillEnabled()).toBe(true);
    if (prev === undefined) delete process.env.POPBILL_ENABLED;
    else process.env.POPBILL_ENABLED = prev;
  });

  it('필수 ENV 하나라도 없으면 설정 null / IsTest 기본은 테스트베드(true)', () => {
    const keep = { ...process.env };
    try {
      delete process.env.POPBILL_LINK_ID;
      delete process.env.POPBILL_SECRET_KEY;
      delete process.env.POPBILL_CORP_NUM;
      delete process.env.POPBILL_IS_TEST;
      expect(getPopbillConfig()).toBeNull();

      process.env.POPBILL_LINK_ID = 'INVITO';
      process.env.POPBILL_SECRET_KEY = 'secret=';
      expect(getPopbillConfig()).toBeNull(); // CORP_NUM 없음

      process.env.POPBILL_CORP_NUM = '667-86-00578';
      const cfg = getPopbillConfig();
      expect(cfg?.corpNum).toBe('6678600578');
      expect(cfg?.isTest).toBe(true); // ★ 미설정 = 테스트베드 — 운영으로 새는 사고 차단

      process.env.POPBILL_IS_TEST = 'false';
      expect(getPopbillConfig()?.isTest).toBe(false);
    } finally {
      process.env.POPBILL_LINK_ID = keep.POPBILL_LINK_ID as any;
      process.env.POPBILL_SECRET_KEY = keep.POPBILL_SECRET_KEY as any;
      process.env.POPBILL_CORP_NUM = keep.POPBILL_CORP_NUM as any;
      process.env.POPBILL_IS_TEST = keep.POPBILL_IS_TEST as any;
      for (const k of ['POPBILL_LINK_ID', 'POPBILL_SECRET_KEY', 'POPBILL_CORP_NUM', 'POPBILL_IS_TEST']) {
        if (keep[k] === undefined) delete (process.env as any)[k];
      }
    }
  });
});

// ★ 2026-07-31(2) 세금계산서 참조 재전송 대상 — 대표 1명 발행 + 참조 N명 sendEmail 재전송 계약
describe('selectTaxbillResendTargets — 참조 재전송 대상 선별', () => {
  it('참조 없음 = 빈 배열(재전송 무호출)', () => {
    expect(selectTaxbillResendTargets({ primary: { email: 'a@x.co' }, cc: [] })).toEqual([]);
    expect(selectTaxbillResendTargets({ primary: null, cc: [] })).toEqual([]);
  });

  it('대표와 중복(대소문자 무시)·상호 중복 제거, 형식 무효 제외, 순서 보존', () => {
    expect(
      selectTaxbillResendTargets({
        primary: { email: 'Billing@Kumkang.co.kr' },
        cc: ['billing@kumkang.co.kr', 'cfo@kumkang.co.kr', ' cfo@kumkang.co.kr ', 'not-an-email', 'tax@kumkang.co.kr'],
      }),
    ).toEqual(['cfo@kumkang.co.kr', 'tax@kumkang.co.kr']);
  });

  it('공백·빈 값은 제외', () => {
    expect(selectTaxbillResendTargets({ primary: { email: 'a@x.co' }, cc: ['', '   ', 'b@x.co'] })).toEqual(['b@x.co']);
  });
});

// ★ 2026-07-31(2) Codex 수용분 — 재전송 상한 + sendEmail 유한 타임아웃(워커 정지 차단) 계약
describe('selectTaxbillResendTargets — 상한(장당 최대 10명)', () => {
  it('11명 이상이면 앞 10명까지만 재전송 대상', () => {
    const cc = Array.from({ length: 13 }, (_, i) => `cc${i}@x.co`);
    const out = selectTaxbillResendTargets({ primary: { email: 'p@x.co' }, cc });
    expect(out).toHaveLength(10);
    expect(out[0]).toBe('cc0@x.co');
    expect(out[9]).toBe('cc9@x.co');
  });
});

describe('sendEmailAsync — 유한 타임아웃 보장(콜백 미호출 SDK에서도 settle)', () => {
  it('success/error 콜백을 전혀 호출하지 않는 SDK = 타임아웃으로 reject (전역 워커 무한 대기 차단)', async () => {
    vi.useFakeTimers();
    try {
      const fakeSvc = { sendEmail: () => { /* 콜백 미호출 — SDK timeout/error 이벤트 미전달 재현 */ } };
      const p = sendEmailAsync(fakeSvc, '6678600578', 'TU260731-abc', 'cc@x.co', null);
      const guarded = p.catch((e: any) => e);
      await vi.advanceTimersByTimeAsync(TAXBILL_SENDMAIL_TIMEOUT_MS + 1);
      const err = await guarded;
      expect(err).toBeInstanceOf(Error);
      expect(String(err.message)).toContain('응답 없음');
    } finally {
      vi.useRealTimers();
    }
  });

  it('success 콜백 = resolve, error 콜백 = reject (타이머 정리 포함)', async () => {
    const okSvc = {
      sendEmail: (_c: any, _k: any, _m: any, _r: any, _u: any, ok: (v: any) => void) => ok({ code: 1 }),
    };
    await expect(sendEmailAsync(okSvc, '6678600578', 'TU-1', 'a@x.co', null)).resolves.toMatchObject({ code: 1 });

    const errSvc = {
      sendEmail: (_c: any, _k: any, _m: any, _r: any, _u: any, _ok: any, fail: (e: any) => void) =>
        fail(new Error('팝빌 거절')),
    };
    await expect(sendEmailAsync(errSvc, '6678600578', 'TU-1', 'a@x.co', null)).rejects.toThrow('팝빌 거절');
  });

  it('sendEmail 동기 throw도 reject로 수렴', async () => {
    const throwSvc = { sendEmail: () => { throw new Error('연결 불가'); } };
    await expect(sendEmailAsync(throwSvc, '6678600578', 'TU-1', 'a@x.co', null)).rejects.toThrow('연결 불가');
  });
});

// ★ 2026-07-31(2) Codex 3R — issued 승격 계약: "참조 대상이 있으면 pending 기록과 같은 트랜잭션이 아니면 승격 불가"
//   (발행 패스·웹훅 304 공유). tableExists 주입 + fake client로 단위 고정.
describe('enqueueTaxbillResendsForIssue — issued 승격 계약', () => {
  const fakeClient = () => {
    const calls: { sql: string; params: any[] }[] = [];
    return {
      calls,
      query: async (sql: string, params?: any[]) => { calls.push({ sql, params: params || [] }); return { rows: [] }; },
    };
  };

  it('참조 0명 = 기록 없이 통과(0 반환·카탈로그 조회도 안 한다)', async () => {
    const c = fakeClient();
    let existsCalled = 0;
    const n = await enqueueTaxbillResendsForIssue(c, 'issue-1', 'TU-1', { primary: { email: 'p@x.co' }, cc: [] }, {
      tableExists: async () => { existsCalled += 1; return true; },
    });
    expect(n).toBe(0);
    expect(c.calls).toHaveLength(0);
    expect(existsCalled).toBe(0);
  });

  it('참조 있음 + 테이블 미생성 = throw(승격 차단 — 조용한 유실 금지)', async () => {
    const c = fakeClient();
    await expect(
      enqueueTaxbillResendsForIssue(c, 'issue-1', 'TU-1', { primary: { email: 'p@x.co' }, cc: ['a@x.co'] }, {
        tableExists: async () => false,
      }),
    ).rejects.toThrow('미생성');
    expect(c.calls).toHaveLength(0);
  });

  it('참조 있음 + 테이블 실존 = 대상별 멱등 INSERT + 대상 수 반환', async () => {
    const c = fakeClient();
    const n = await enqueueTaxbillResendsForIssue(c, 'issue-1', 'TU-1', { primary: { email: 'p@x.co' }, cc: ['a@x.co', 'b@x.co'] }, {
      tableExists: async () => true,
    });
    expect(n).toBe(2);
    expect(c.calls).toHaveLength(2);
    expect(c.calls[0].sql).toContain('ON CONFLICT (taxbill_issue_id, lower(email)) DO NOTHING');
    expect(c.calls[0].params).toEqual(['issue-1', 'TU-1', 'a@x.co']);
    expect(c.calls[1].params).toEqual(['issue-1', 'TU-1', 'b@x.co']);
  });
});

// ★ 2026-08-08 발행 메일 아카이브 참조(ENV TAXBILL_ARCHIVE_BCC) — 두 갈래 계약(§2-1):
//   고객 참조 기록 실패 = 발행 확정 미룸(기존) / 아카이브 때문에는 절대 미루지 않는다.
describe('selectTaxbillArchiveTargets — 아카이브 참조 대상(순수)', () => {
  it('ENV 미설정·빈 값 = 빈 배열', () => {
    expect(selectTaxbillArchiveTargets(undefined, [])).toEqual([]);
    expect(selectTaxbillArchiveTargets(null, [])).toEqual([]);
    expect(selectTaxbillArchiveTargets('  ', [])).toEqual([]);
  });

  it('쉼표·세미콜론·공백 구분 + 형식 무효 제외 + 제외 목록(대소문자 무시) 중복 제거', () => {
    expect(
      selectTaxbillArchiveTargets('Mobile@invitocorp.com, tax@invitocorp.com; not-an-email mobile@invitocorp.com', [
        'MOBILE@invitocorp.com',
      ]),
    ).toEqual(['tax@invitocorp.com']);
  });

  it('대표·고객 참조와 겹치지 않으면 그대로 — 순서 보존', () => {
    expect(selectTaxbillArchiveTargets('a@x.co,b@x.co', ['p@x.co', 'c@x.co'])).toEqual(['a@x.co', 'b@x.co']);
  });
});

describe('enqueueTaxbillArchiveCopies — 확정 트랜잭션 밖 best-effort 계약', () => {
  // ★ Codex 1R로 형태 확정 — 아카이브를 확정 트랜잭션 안(SAVEPOINT 격리)에 두면 복구 실패가 트랜잭션을
  //   오염시키고(25P02), 아카이브 전용 카탈로그 조회 거절만으로 확정이 롤백된다. 그래서 COMMIT 뒤
  //   자기 연결로 기록하고 **어떤 실패도 던지지 않는다**(로그가 복구 근거).
  const fakeExec = () => {
    const calls: { sql: string; params: any[] }[] = [];
    return {
      calls,
      exec: async (sql: string, params?: any[]) => { calls.push({ sql, params: params || [] }); return { rows: [] }; },
    };
  };
  const to = { primary: { email: 'p@x.co' }, cc: ['a@x.co'] };

  it('ENV 미설정 = 0 — 카탈로그 조회도 INSERT도 없다(기존 동작과 1:1)', async () => {
    const f = fakeExec();
    let existsCalled = 0;
    const n = await enqueueTaxbillArchiveCopies('issue-1', 'TU-1', to, {
      archiveBcc: null, tableExists: async () => { existsCalled += 1; return true; }, exec: f.exec,
    });
    expect(n).toBe(0);
    expect(existsCalled).toBe(0);
    expect(f.calls).toHaveLength(0);
  });

  it('대상 있음 + 테이블 실존 = 멱등 INSERT + 대상 수 반환', async () => {
    const f = fakeExec();
    const n = await enqueueTaxbillArchiveCopies('issue-1', 'TU-1', to, {
      archiveBcc: 'mobile@invitocorp.com', tableExists: async () => true, exec: f.exec,
    });
    expect(n).toBe(1);
    expect(f.calls[0].sql).toContain('ON CONFLICT (taxbill_issue_id, lower(email)) DO NOTHING');
    expect(f.calls[0].params).toEqual(['issue-1', 'TU-1', 'mobile@invitocorp.com']);
  });

  it('테이블 미생성 = throw 없이 0 — 발행 확정(이미 COMMIT)에 아무 영향이 없다', async () => {
    const f = fakeExec();
    const n = await enqueueTaxbillArchiveCopies('issue-1', 'TU-1', to, {
      archiveBcc: 'mobile@invitocorp.com', tableExists: async () => false, exec: f.exec,
    });
    expect(n).toBe(0);
    expect(f.calls).toHaveLength(0);
  });

  it('카탈로그 조회 거절(rejection) = throw 없이 0 — 아카이브 전용 조회가 발행 결과를 못 바꾼다', async () => {
    const n = await enqueueTaxbillArchiveCopies('issue-1', 'TU-1', to, {
      archiveBcc: 'mobile@invitocorp.com', tableExists: async () => { throw new Error('pool timeout'); },
    });
    expect(n).toBe(0);
  });

  it('INSERT 실패 = throw 없이 0(로그가 복구 근거) — best-effort', async () => {
    const n = await enqueueTaxbillArchiveCopies('issue-1', 'TU-1', to, {
      archiveBcc: 'mobile@invitocorp.com', tableExists: async () => true,
      exec: async () => { throw new Error('varchar 초과 등 임의 실패'); },
    });
    expect(n).toBe(0);
  });

  it('부분 실패는 수신자별 격리 — 한 주소가 막혀도 뒤 주소는 계속 시도하고 성공 수를 돌려준다(Codex 2R medium)', async () => {
    const tried: string[] = [];
    const n = await enqueueTaxbillArchiveCopies('issue-1', 'TU-1', to, {
      archiveBcc: 'x1@invitocorp.com, x2@invitocorp.com, x3@invitocorp.com',
      tableExists: async () => true,
      exec: async (_sql: string, params?: any[]) => {
        const rcpt = (params || [])[2] as string;
        tried.push(rcpt);
        if (rcpt === 'x2@invitocorp.com') throw new Error('중간 실패');
        return { rows: [] };
      },
    });
    expect(tried).toEqual(['x1@invitocorp.com', 'x2@invitocorp.com', 'x3@invitocorp.com']);
    expect(n).toBe(2);
  });

  it('대표·고객 참조와 겹치는 주소는 아카이브 축에서 제외 — 이중 발송 없음', async () => {
    const f = fakeExec();
    const n = await enqueueTaxbillArchiveCopies('issue-1', 'TU-1', to, {
      archiveBcc: 'A@x.co, p@x.co, mobile@invitocorp.com', tableExists: async () => true, exec: f.exec,
    });
    expect(n).toBe(1);
    expect(f.calls.map((q) => q.params[2])).toEqual(['mobile@invitocorp.com']);
  });
});

// ★ 2026-08-21 계산서 비고(PO번호 — 시세이도 접수). 입력 → invoice_confirmations.taxbill_remark → 발행 행 SQL → payload.
//   배치 규칙: 원본(및 remark1이 빈 수정 장) = remark1 / 사유 2·4처럼 remark1이 당초 작성일자로 찬 장 = remark2.
describe('buildTaxinvoicePayload — 계산서 비고(PO) 배치 (2026-08-21)', () => {
  it('원본 장 — 비고가 remark1에 그대로 실린다', () => {
    const p = buildTaxinvoicePayload({ ...baseInput, remark: ' PO-2026-0831 ' });
    expect(p.remark1).toBe('PO-2026-0831');
    expect(p.remark2).toBeUndefined();
  });

  it('비고가 없으면 remark 키를 만들지 않는다(빈 문자열도 싣지 않는다)', () => {
    expect(buildTaxinvoicePayload({ ...baseInput, remark: '   ' }).remark1).toBeUndefined();
    expect(buildTaxinvoicePayload({ ...baseInput, remark: null }).remark1).toBeUndefined();
  });

  it('사유 2(기재사항 착오) 수정 장 — remark1은 당초 작성일자가 지키고 비고는 remark2로 내려간다', () => {
    const p = buildTaxinvoicePayload({
      ...baseInput, modifyCode: 2, orgNtsConfirmNum: '20260801410002030000366e', orgWriteDate: '2026-07-31', remark: 'PO-2026-0831',
    });
    expect(p.remark1).toBe('당초 작성일자 2026-07-31');
    expect(p.remark2).toBe('PO-2026-0831');
  });

  it('150자 상한 — 팝빌 비고 필드 규격과 입력 경로 상한이 같다', () => {
    const p = buildTaxinvoicePayload({ ...baseInput, remark: 'x'.repeat(300) });
    expect(p.remark1).toHaveLength(150);
  });
});
