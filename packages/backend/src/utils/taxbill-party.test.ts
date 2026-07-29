/**
 * 공급받는자 사업자 3단 판정 불변식 — 2026-07-29 신설
 *
 * 계기: PDF가 `companies`만 봐서 정산 탭에 등록한 사업자가 인쇄물에 반영되지 않았다
 *       (Harold 실측 — 등록했는데 `대표: -`, `사업자번호: -`로 발행).
 *
 * 이 테스트의 핵심은 "읽어 오는가"가 아니라 **섞이지 않는가**다.
 * 상호는 계정에서, 대표자는 회사에서 가져오면 국세청 신고물에 실재하지 않는 사업자가 찍힌다.
 * 그건 빈 칸보다 나쁘다 — 빈 칸은 사람이 알아채지만 조합된 사업자는 그대로 신고된다.
 */

import { describe, it, expect } from 'vitest';
import { pickTaxbillParty } from './billing-settings';

/** 세 단계가 전부 채워진 행 — 어느 단계가 이기는지만 보면 된다 */
const full = {
  // 계정 레벨
  acct_taxbill_company_name: '계정상호', acct_taxbill_biz_number: '111-11-11111',
  acct_taxbill_ceo_name: '계정대표', acct_taxbill_address: '계정주소',
  acct_taxbill_biz_type: '계정업태', acct_taxbill_biz_item: '계정종목',
  // 회사 레벨
  co_taxbill_company_name: '회사상호', co_taxbill_biz_number: '222-22-22222',
  co_taxbill_ceo_name: '회사대표', co_taxbill_address: '회사주소',
  co_taxbill_biz_type: '회사업태', co_taxbill_biz_item: '회사종목',
  // companies 기본정보
  company_name: '기본상호', business_number: '333-33-33333', ceo_name: '기본대표',
  address: '기본주소', business_type: '기본업태', business_category: '기본종목',
};

describe('공급받는자 3단 우선순위', () => {
  it('계정 사업자가 있으면 계정이 이긴다', () => {
    const p = pickTaxbillParty(full);
    expect(p.source).toBe('account');
    expect(p.bizNumber).toBe('111-11-11111');
    expect(p.companyName).toBe('계정상호');
  });

  it('계정이 없으면 회사(billing_contacts)', () => {
    const p = pickTaxbillParty({ ...full, acct_taxbill_biz_number: null });
    expect(p.source).toBe('company_contact');
    expect(p.bizNumber).toBe('222-22-22222');
    expect(p.companyName).toBe('회사상호');
  });

  it('둘 다 없으면 companies 기본정보', () => {
    const p = pickTaxbillParty({ ...full, acct_taxbill_biz_number: null, co_taxbill_biz_number: '' });
    expect(p.source).toBe('companies');
    expect(p.bizNumber).toBe('333-33-33333');
    expect(p.companyName).toBe('기본상호');
  });

  it('아무 데도 없으면 전부 null — 화면에 `-`로 찍힌다', () => {
    const p = pickTaxbillParty({});
    expect(p.source).toBe('companies');
    expect(p.bizNumber).toBeNull();
    expect(p.companyName).toBeNull();
  });
});

describe('단계를 섞지 않는다 — 조합된 유령 사업자 차단', () => {
  it('채택한 단계에 빈 필드가 있어도 아래 단계로 메우지 않는다', () => {
    // 계정 사업자번호는 있는데 대표자·주소가 비어 있는 상태.
    // 회사·기본정보에는 값이 있지만 **가져오면 안 된다** — 그러면 없는 사업자가 만들어진다.
    const p = pickTaxbillParty({
      ...full,
      acct_taxbill_ceo_name: null,
      acct_taxbill_address: '',
      acct_taxbill_biz_item: null,
    });
    expect(p.source).toBe('account');
    expect(p.bizNumber).toBe('111-11-11111');
    expect(p.ceoName).toBeNull();
    expect(p.address).toBeNull();
    expect(p.bizItem).toBeNull();
    // 아래 단계 값이 새어 들어오지 않았는지 직접 확인한다.
    expect(p.ceoName).not.toBe('회사대표');
    expect(p.ceoName).not.toBe('기본대표');
  });

  it('판정 기준은 사업자등록번호 하나다 — 상호만 있는 단계는 채택하지 않는다', () => {
    // 상호만 입력해 둔 계정 행이 있어도 사업자번호가 없으면 그 단계는 건너뛴다.
    const p = pickTaxbillParty({ ...full, acct_taxbill_biz_number: '   ' });
    expect(p.source).toBe('company_contact');
    expect(p.companyName).toBe('회사상호');
  });

  it('채택 결과의 6필드가 모두 같은 단계에서 온다', () => {
    const p = pickTaxbillParty({ ...full, acct_taxbill_biz_number: null });
    const values = [p.companyName, p.ceoName, p.address, p.bizType, p.bizItem];
    // 회사 단계를 채택했으면 계정·기본정보 값이 하나도 섞이면 안 된다.
    for (const v of values) {
      expect(String(v)).toMatch(/^회사/);
    }
  });
});
