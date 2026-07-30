/**
 * 팝빌 세금계산서 발행 계약 테스트 (2026-07-30)
 *
 * SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §7-0.
 * 국세청으로 나가는 실문서라 payload 계약을 순수 함수로 고정한다 — 금액 정수 String·
 * 회계 항등식·24자 문서번호·수정발행 짝·웹훅 판정. 기대값은 리터럴로 적는다(표에서 유도 금지).
 */
import { describe, it, expect } from 'vitest';
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
