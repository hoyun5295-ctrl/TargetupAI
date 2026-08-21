/**
 * ★ CT: 팝빌 세금계산서 발행 (2026-07-30)
 *
 * SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §7-0(RegistIssue·웹훅 계약).
 * 소비 큐 = taxbill_issues(status='ready' — taxbill-worker가 적재). 국세청으로 나가는 실문서라
 * 발송·돈과 같은 등급으로 다룬다:
 *
 *  1) [이중 게이트] POPBILL_ENABLED='true'(기본 false) + 필수 ENV 3종이 다 있어야 호출이 나간다.
 *     하나라도 없으면 ready에 그대로 쌓이고 로그 한 줄만 남는다(기존 "연동 전 정지" 동작 유지).
 *  2) [추적 먼저] invoicer_mgt_key(팝빌 문서번호)를 **외부 호출 전에** 행에 저장한다 — 호출 후
 *     크래시하면 어떤 번호로 나갔는지 알 수 없어 웹훅 매칭·중복 방지가 다 무너진다(0729 통지
 *     파이프라인 "적재 후 전송" 원칙 그대로).
 *  3) [효과 검증 후 성공 표시] registIssue 성공 응답만으로 issued를 찍지 않는다 — getInfo로
 *     재조회해 문서 실재를 확인한 뒤에만 issued. 재조회 실패면 submitted에 세워두고 사람이 본다.
 *  4) [멱등] 문서번호가 행마다 결정적(TU+작성일+uuid 조각)이라 재시도가 같은 번호로 나간다.
 *     registIssue가 중복 에러를 내면 getInfo로 실재를 확인해 issued로 자가치유한다 —
 *     에러 코드 숫자를 추측해 분기하지 않는다(외부 API 응답 추측 금지).
 *
 * SDK 계약은 문서가 아니라 설치본 소스로 확정(2026-07-30 실측 — node_modules/popbill):
 *   config({LinkID,SecretKey,IsTest,...}) 선행 → TaxinvoiceService() 싱글톤 /
 *   registIssue(CorpNum, Taxinvoice, success, error) / getInfo(CorpNum, 'SELL', MgtKey, success, error).
 */

import pool from '../config/database';
import { INVITO_INFO } from '../config/defaults';
import { pickTaxbillParty, TaxbillParty } from './billing-settings';
// ★ 2026-07-31 계산서 통지 수신자는 거래내역서와 별개 원장 축(doc_type='taxbill')이다.
import { resolveBillingRecipients } from './billing-recipients';

const log = (msg: string) => console.log(`[팝빌] ${msg}`);

// ════════════════════════════════════════════════════════════
// ENV·게이트
// ════════════════════════════════════════════════════════════

/** 마스터 게이트 — 명시적으로 'true'일 때만 발행이 나간다. */
export function isPopbillEnabled(): boolean {
  return process.env.POPBILL_ENABLED === 'true';
}

export interface PopbillConfig {
  linkId: string;
  secretKey: string;
  corpNum: string; // 인비토 사업자번호 (숫자 10자리)
  isTest: boolean;
  userId: string | null; // 팝빌 회원 아이디 (옵션)
}

/**
 * 필수 ENV 3종(POPBILL_LINK_ID·POPBILL_SECRET_KEY·POPBILL_CORP_NUM)이 다 있어야 설정이 성립한다.
 * IsTest 기본값은 **true(테스트베드)** — 미설정 상태에서 운영으로 나가는 사고를 막는 방향.
 * (팝빌 SDK 기본값은 false지만 우리 안전 기본은 반대다. 운영 전환 = POPBILL_IS_TEST=false 명시.)
 */
export function getPopbillConfig(): PopbillConfig | null {
  const linkId = String(process.env.POPBILL_LINK_ID || '').trim();
  const secretKey = String(process.env.POPBILL_SECRET_KEY || '').trim();
  const corpNum = normalizeCorpNum(process.env.POPBILL_CORP_NUM);
  if (!linkId || !secretKey || !corpNum) return null;
  return {
    linkId,
    secretKey,
    corpNum,
    isTest: process.env.POPBILL_IS_TEST !== 'false',
    userId: String(process.env.POPBILL_USER_ID || '').trim() || null,
  };
}

// ════════════════════════════════════════════════════════════
// 순수 함수 (계약 테스트 대상)
// ════════════════════════════════════════════════════════════

/** 사업자번호 정규화 — 숫자만 남겨 정확히 10자리일 때만 유효. */
export function normalizeCorpNum(v: unknown): string | null {
  const digits = String(v ?? '').replace(/\D/g, '');
  return digits.length === 10 ? digits : null;
}

/** 'YYYY-MM-DD' → 'YYYYMMDD'. 형식이 깨지면 throw — 조용히 이상한 작성일자를 만들지 않는다. */
export function toWriteDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) {
    throw new Error(`작성일자 형식 오류: ${isoDate}`);
  }
  return isoDate.replace(/-/g, '');
}

/**
 * 팝빌 문서번호(invoicerMgtKey) — 24자 제한(영문·숫자·-·_), 우리 발번.
 * `TU` + YYMMDD(작성일) + `-` + uuid 앞 13자(hex) = 22자.
 * **행마다 결정적** — 같은 행 재시도는 같은 번호로 나가 팝빌 쪽에서 중복 발행이 막힌다(멱등 안전망).
 * 날짜 조각은 사람이 팝빌 사이트에서 문서를 찾을 때의 가독용이다.
 */
export function buildInvoicerMgtKey(issueDate: string, rowId: string): string {
  const ymd = toWriteDate(issueDate).slice(2); // YYMMDD
  const hex = String(rowId || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`uuid 형식 오류: ${rowId}`);
  const key = `TU${ymd}-${hex.slice(0, 13)}`;
  if (key.length > 24 || !/^[0-9A-Za-z_-]+$/.test(key)) {
    throw new Error(`문서번호 규격 위반: ${key}`);
  }
  return key;
}

/** 업태/종목 분리 — INVITO_INFO.bizType('서비스 / 소프트웨어및앱개발 공급') 형식을 첫 '/'에서 가른다. */
export function splitBizTypeItem(combined: string): { bizType: string; bizItem: string } {
  const idx = String(combined || '').indexOf('/');
  if (idx < 0) return { bizType: String(combined || '').trim(), bizItem: '' };
  return {
    bizType: combined.slice(0, idx).trim(),
    bizItem: combined.slice(idx + 1).trim(),
  };
}

export interface TaxinvoiceBuildInput {
  /** 작성일자 YYYY-MM-DD (= taxbill_issues.issue_date) */
  issueDate: string;
  /** 공급가액·세액·합계 — **정수**여야 한다(행 단위 절사 규칙의 산출물). */
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  /** 공급받는자 (pickTaxbillParty 결과 — bizNumber 필수) */
  party: TaxbillParty;
  /** 팝빌 발행 메일 수신자 (컨펌 메일 수신자 = 정산 담당자) */
  invoiceeEmail: string | null;
  invoicerMgtKey: string;
  /** 품목 1줄 (예: '7월 메시징 이용료') */
  itemName: string;
  /** 수정발행일 때만 — 사유 코드(1·2·4·6)와 당초 국세청승인번호를 함께 */
  modifyCode?: number | null;
  orgNtsConfirmNum?: string | null;
  /** 당초 작성일자(YYYY-MM-DD) — 사유 2·4는 remark1에 기재 의무(§7-0) */
  orgWriteDate?: string | null;
}

const MODIFY_CODES = new Set([1, 2, 4, 6]); // §7-0 — 우리 구현 대상 사유만

/**
 * 사유별 금액 부호 계약(0730 Codex 지적 ⑤ → 정식 구현).
 *  - 4(계약 해제)·6(착오 이중발급) = **음(-) 문서만** — 양수로 나가면 잘못된 실문서다.
 *  - 2(공급가액 변동) = ±어느 쪽이든 1장 (증액이면 +, 감액이면 -).
 *  - 1(기재사항 착오정정) = 부(-)+정(+) 2장 연계 — 장 단위 부호는 어느 쪽이든 오고,
 *    짝은 planModifyIssue가 한 트랜잭션 INSERT로 강제한다(빌더는 장 하나만 본다).
 */
const MODIFY_SIGN: Record<number, 'negative' | 'any'> = { 1: 'any', 2: 'any', 4: 'negative', 6: 'negative' };

/** 사유 2·4는 remark1에 당초 작성일자 기재 의무(§7-0) */
const MODIFY_NEEDS_ORG_DATE = new Set([2, 4]);

/**
 * RegistIssue용 Taxinvoice 조립(순수). 계약 위반은 전부 throw — 호출부가 failed로 기록한다.
 * 금액은 **정수 String**(팝빌 계약이자 우리 절사 규칙 — 소수가 오면 절사 규칙 위반이 여기서 잡힌다).
 */
export function buildTaxinvoicePayload(input: TaxinvoiceBuildInput): any {
  const { supplyAmount, taxAmount, totalAmount, party } = input;

  const hasModifyCode = input.modifyCode !== null && input.modifyCode !== undefined;
  const hasOrgNum = !!String(input.orgNtsConfirmNum || '').trim();
  if (hasModifyCode !== hasOrgNum) {
    throw new Error('수정발행은 modifyCode와 당초 국세청승인번호(orgNTSConfirmNum)를 함께 넣어야 합니다');
  }
  if (hasModifyCode && !MODIFY_CODES.has(Number(input.modifyCode))) {
    throw new Error(`지원하지 않는 수정사유 코드: ${input.modifyCode} (지원 = 1·2·4·6)`);
  }

  for (const [label, v] of [['공급가액', supplyAmount], ['세액', taxAmount], ['합계', totalAmount]] as const) {
    if (!Number.isInteger(v)) throw new Error(`${label}이(가) 정수가 아닙니다: ${v} — 원 미만 절사 규칙 위반`);
  }
  if (supplyAmount + taxAmount !== totalAmount) {
    throw new Error(`합계 불일치: 공급가액 ${supplyAmount} + 세액 ${taxAmount} ≠ 합계 ${totalAmount}`);
  }
  // 부호 계약 — 원본은 음수 금지, 수정은 사유별(MODIFY_SIGN). 부호가 섞인 장(공급가액 +, 세액 -)은 거부.
  if (!hasModifyCode) {
    if (supplyAmount < 0 || taxAmount < 0) {
      throw new Error(`원본 계산서에 음수 금액: 공급가액 ${supplyAmount} / 세액 ${taxAmount} — 마이너스는 수정세금계산서로만`);
    }
  } else {
    if (Math.sign(supplyAmount) * Math.sign(taxAmount) < 0) {
      throw new Error(`부호가 섞인 장: 공급가액 ${supplyAmount} / 세액 ${taxAmount}`);
    }
    if (totalAmount === 0) {
      throw new Error('수정 장의 합계가 0원 — 바꿀 것이 없는 수정발행은 만들 수 없습니다');
    }
    if (MODIFY_SIGN[Number(input.modifyCode)] === 'negative' && totalAmount > 0) {
      throw new Error(`사유 ${input.modifyCode}(해제·이중발급)는 음(-) 문서만 가능한데 합계가 +${totalAmount}입니다`);
    }
    if (MODIFY_NEEDS_ORG_DATE.has(Number(input.modifyCode))) {
      // remark1 당초 작성일자 기재 의무 — 형식 검증은 toWriteDate가 한다(깨지면 throw).
      toWriteDate(String(input.orgWriteDate || ''));
    }
  }

  const invoiceeCorpNum = normalizeCorpNum(party.bizNumber);
  if (!invoiceeCorpNum) {
    throw new Error(`공급받는자 사업자번호가 없거나 형식 오류: ${party.bizNumber ?? '(없음)'} (출처 ${party.source})`);
  }

  const invitoCorpNum = normalizeCorpNum(INVITO_INFO.bizNumber);
  if (!invitoCorpNum) throw new Error(`공급자(인비토) 사업자번호 형식 오류: ${INVITO_INFO.bizNumber}`);
  const invitoBiz = splitBizTypeItem(INVITO_INFO.bizType);

  const s = (v: string | null | undefined) => String(v ?? '').trim();

  // ★ 2026-08-05 작성일자는 **한 번만 만든다.** 아래 품목 줄의 거래일자(purchaseDT)가 이 값에서
  //   파생돼야 문서 상단과 품목의 날짜가 갈리지 않는다 — 따로 계산하는 순간 그 둘이 어긋난다.
  const writeDate = toWriteDate(input.issueDate);

  const payload: any = {
    writeDate,
    issueType: '정발행',
    taxType: '과세',
    chargeDirection: '정과금',
    purposeType: '청구',
    supplyCostTotal: String(supplyAmount),
    taxTotal: String(taxAmount),
    totalAmount: String(totalAmount),
    invoicerMgtKey: input.invoicerMgtKey,

    // 공급자 = 인비토 고정 (config/defaults INVITO_INFO)
    invoicerCorpNum: invitoCorpNum,
    invoicerCorpName: s(INVITO_INFO.companyName),
    invoicerCEOName: s(INVITO_INFO.ceoName),
    invoicerAddr: s(INVITO_INFO.address),
    invoicerBizType: invitoBiz.bizType,
    invoicerBizClass: invitoBiz.bizItem,
    invoicerContactName: '정산 담당',
    invoicerEmail: s(INVITO_INFO.email),
    invoicerTEL: s(INVITO_INFO.phone),
    // 발행 시 공급자 알림 메일은 불필요 — 발행 주체가 우리다.
    invoicerSMSSendYN: false,

    // 공급받는자 = 3단 채택 사업자 (빈 필드는 빈 채로 — 단계를 섞은 조합이 더 나쁘다, §5-1)
    invoiceeType: '사업자',
    invoiceeCorpNum: invoiceeCorpNum,
    invoiceeCorpName: s(party.companyName),
    invoiceeCEOName: s(party.ceoName),
    invoiceeAddr: s(party.address),
    invoiceeBizType: s(party.bizType),
    invoiceeBizClass: s(party.bizItem),
    invoiceeContactName1: '',
    invoiceeEmail1: s(input.invoiceeEmail),

    detailList: [
      {
        serialNum: 1,
        // ★ 2026-08-05 품목 줄 거래일자. 그전에는 이 필드를 안 보내 **문서 품목 줄의 월·일이 빈 칸으로**
        //   나갔다(금강제화 발행분 실물 확인). 작성일자와 **같은 변수**를 쓴다 — 따로 만들면 그 둘이 갈리고,
        //   두 날짜가 어긋난 세금계산서는 바로잡기가 수정발행뿐이라 비용이 크다(Harold 확정: 일치해야 한다).
        //   필드명·형식은 팝빌 문서 확정 — `purchaseDT`, `yyyyMMdd`(`toWriteDate` 출력과 같은 형식).
        purchaseDT: writeDate,
        itemName: s(input.itemName),
        supplyCost: String(supplyAmount),
        tax: String(taxAmount),
      },
    ],
  };

  if (hasModifyCode) {
    payload.modifyCode = Number(input.modifyCode);
    payload.orgNTSConfirmNum = String(input.orgNtsConfirmNum).trim();
    if (MODIFY_NEEDS_ORG_DATE.has(Number(input.modifyCode))) {
      payload.remark1 = `당초 작성일자 ${String(input.orgWriteDate).trim()}`;
    }
  }

  return payload;
}

// ════════════════════════════════════════════════════════════
// 수정발행 계획 (순수 — 사유별 장 구성 계약)
// ════════════════════════════════════════════════════════════

export interface ModifyIssueOriginal {
  /** 당초 국세청승인번호 — 없으면(전송 미완) 수정발행 자체가 성립 안 한다(§7-0) */
  ntsConfirmNum: string | null;
  issueDate: string; // YYYY-MM-DD
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export interface ModifyIssueRequest {
  code: number;
  /** 사유 2 = 변동일, 사유 4 = 해제일 (작성일자가 된다). 사유 1·6은 당초 작성일자 고정이라 불필요 */
  writeDate?: string | null;
  /**
   * 금액 입력은 **원형(unknown) 그대로** 받는다 — 호출부가 Number()를 먼저 걸면 Number('')=0이
   * requiredInt에 닿기 전에 0으로 굳는다(0730 Codex 4R ③ — 검증 앞에서 값을 오염시키는 함정).
   * 사유 2 = 변동분(±·같은 부호) / 사유 1 = 정정 후 금액(음수 불가·합계 0 불가).
   */
  deltaSupply?: unknown;
  deltaTax?: unknown;
  correctedSupply?: unknown;
  correctedTax?: unknown;
}

export interface PlannedModifyRow {
  modifyCode: number;
  orgNtsConfirmNum: string;
  issueDate: string;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
}

/** 수정발행 계획의 계약 위반 — 라우트가 이 타입만 400으로 변환한다(DB·연결 장애를 400으로 숨기지 않기 위해). */
export class ModifyPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModifyPlanError';
  }
}

/** 필수 정수 입력 — null·undefined·빈값·소수를 전부 거부한다. Number('')=0, Number(null)=0 함정(D150-3 계열) 차단. */
function requiredInt(label: string, v: unknown): number {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
    throw new ModifyPlanError(`${label}이(가) 입력되지 않았습니다`);
  }
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new ModifyPlanError(`${label}이(가) 정수가 아닙니다: ${v}`);
  return n;
}

/**
 * (순수) 수정발행 요청 → 만들 장 목록. 호출부(라우트)가 이 배열을 **한 트랜잭션**으로 INSERT한다.
 *  - 1 기재사항 착오정정: 부(-당초 전액) + 정(정정 금액) **2장**, 작성일자 = 당초 작성일자
 *  - 2 공급가액 변동: ±변동분 1장, 작성일자 = 변동일(입력)
 *  - 4 계약 해제: -당초 전액 1장, 작성일자 = 해제일(입력)
 *  - 6 착오 이중발급: -당초 전액 1장, 작성일자 = 당초 작성일자
 * 계약 위반은 전부 throw — 잘못된 실문서 계획을 만들지 않는다.
 */
export function planModifyIssue(orig: ModifyIssueOriginal, req: ModifyIssueRequest): PlannedModifyRow[] {
  const code = Number(req.code);
  if (!MODIFY_CODES.has(code)) throw new ModifyPlanError(`지원하지 않는 수정사유 코드: ${req.code} (지원 = 1·2·4·6)`);
  const orgNum = String(orig.ntsConfirmNum || '').trim();
  if (!orgNum) throw new ModifyPlanError('당초 국세청승인번호가 없습니다 — 전송성공(승인번호 수신) 상태에서만 수정발행이 가능합니다');
  try {
    toWriteDate(orig.issueDate); // 당초 작성일자 형식 검증
  } catch (e: any) {
    throw new ModifyPlanError(e?.message ?? String(e));
  }
  for (const [label, v] of [['공급가액', orig.supplyAmount], ['세액', orig.taxAmount], ['합계', orig.totalAmount]] as const) {
    if (!Number.isInteger(v)) throw new ModifyPlanError(`당초 ${label}이(가) 정수가 아닙니다: ${v}`);
  }
  if (orig.supplyAmount + orig.taxAmount !== orig.totalAmount) {
    throw new ModifyPlanError(`당초 금액 항등식 불일치: ${orig.supplyAmount} + ${orig.taxAmount} ≠ ${orig.totalAmount}`);
  }

  const requiredDate = (label: string, v: unknown): string => {
    const d = String(v || '').trim();
    if (!d) throw new ModifyPlanError(`${label}이(가) 입력되지 않았습니다`);
    try {
      toWriteDate(d);
    } catch {
      throw new ModifyPlanError(`${label} 형식 오류: ${d} (YYYY-MM-DD)`);
    }
    return d;
  };

  const negation: Omit<PlannedModifyRow, 'issueDate'> = {
    modifyCode: code,
    orgNtsConfirmNum: orgNum,
    supplyAmount: -orig.supplyAmount,
    taxAmount: -orig.taxAmount,
    totalAmount: -orig.totalAmount,
  };

  if (code === 6) {
    return [{ ...negation, issueDate: orig.issueDate }];
  }
  if (code === 4) {
    return [{ ...negation, issueDate: requiredDate('해제일', req.writeDate) }];
  }
  if (code === 2) {
    const d = requiredDate('변동일', req.writeDate);
    const ds = requiredInt('공급가액 변동분', req.deltaSupply);
    const dt = requiredInt('세액 변동분', req.deltaTax);
    if (ds === 0 && dt === 0) throw new ModifyPlanError('변동분이 0원 — 바꿀 것이 없는 수정발행은 만들 수 없습니다');
    if (Math.sign(ds) * Math.sign(dt) < 0) throw new ModifyPlanError(`변동분 부호가 섞였습니다: 공급가액 ${ds} / 세액 ${dt}`);
    // ★ 잔액 검증(0730 Codex 3R ② 수용) — 변동 후 공급가액이 0 이하가 되는 감액은 '변동'이 아니라
    //   전액 취소다. 팝빌 계약상 그 경우는 사유 4(해제)·6(이중발급)을 써야 한다.
    if (orig.supplyAmount + ds <= 0) {
      throw new ModifyPlanError(
        `변동 후 공급가액이 ${orig.supplyAmount + ds}원 — 전액·초과 감액은 공급가액 변동(2)이 아니라 계약 해제(4)·착오 이중발급(6)으로 처리합니다`,
      );
    }
    if (orig.taxAmount + dt < 0) {
      throw new ModifyPlanError(`변동 후 세액이 음수(${orig.taxAmount + dt}원)가 됩니다 — 변동분을 확인해 주세요`);
    }
    return [{ modifyCode: 2, orgNtsConfirmNum: orgNum, issueDate: d, supplyAmount: ds, taxAmount: dt, totalAmount: ds + dt }];
  }
  // code === 1 — 부+정 2장, 작성일자 = 당초 작성일자
  const cs = requiredInt('정정 후 공급가액', req.correctedSupply);
  const ct = requiredInt('정정 후 세액', req.correctedTax);
  if (cs < 0 || ct < 0) throw new ModifyPlanError(`정 장의 금액은 음수일 수 없습니다: 공급가액 ${cs} / 세액 ${ct}`);
  // ★ 정정 합계 0원 거부(0730 Codex 4R ① 수용) — 0원 정 장은 빌더가 거부해 부(-) 장만 발행되는
  //   반쪽을 만든다. 전액을 없애는 정정은 착오 이중발급(6)·계약 해제(4)의 몫이다.
  if (cs + ct === 0) {
    throw new ModifyPlanError('정정 합계가 0원 — 전액 취소는 기재사항 정정(1)이 아니라 착오 이중발급(6)·계약 해제(4)로 처리합니다');
  }
  return [
    { ...negation, issueDate: orig.issueDate },
    { modifyCode: 1, orgNtsConfirmNum: orgNum, issueDate: orig.issueDate, supplyAmount: cs, taxAmount: ct, totalAmount: cs + ct },
  ];
}

/**
 * (순수) getInfo 재조회의 stateCode 판정 — 팝빌 상태코드 계약(3xx=발행 계열 / 6xx=발행취소 계열).
 * truthy 응답을 곧 발행으로 읽으면 취소된 문서(6xx)까지 issued로 자가치유된다(0730 Codex 지적 ② 수용).
 * 모르는 코드는 'unknown' — 성공으로 승격하지 않고 submitted에 세워 사람이 본다(fail-closed).
 */
export function judgeInfoState(stateCode: unknown): 'issued' | 'nts_failed' | 'cancelled' | 'unknown' {
  const n = Number(stateCode);
  if (!Number.isFinite(n)) return 'unknown';
  // 305 = 발행은 됐으나 국세청 전송실패 — 웹훅 판정(305→failed)과 같은 결론이어야 한다.
  // issued로 승격하면 전송실패가 숨는다(사람이 팝빌 사이트에서 재전송해야 하는 상태).
  if (n === 305) return 'nts_failed';
  if (n >= 300 && n < 400) return 'issued';
  if (n >= 600 && n < 700) return 'cancelled';
  return 'unknown';
}

export interface WebhookDecision {
  mgtKey: string;
  /** 빈 객체면 기록만 하고 갱신 없음 (301 전송전 등) */
  set: { status?: 'issued' | 'failed'; ntsConfirmNum?: string; error?: string };
}

/**
 * (순수) 웹훅 이벤트 → 갱신 내용. §7-0 이벤트 계약(stateCode 301 전송전/304 전송완료/305 전송실패).
 * 매칭 키가 없으면 null — 핸들러는 그래도 200 "OK"를 돌려준다(그 외 응답 = 5분×4회 재전송 폭주).
 * `ntsconfirmNum` 표기는 문서 기준이되 camelCase도 함께 받는다 — 실측 전 방어(웹훅 실측에서 확정).
 */
export function decideWebhookUpdate(body: any): WebhookDecision | null {
  const mgtKey = String(body?.invoicerMgtKey || '').trim();
  if (!mgtKey) return null;

  const stateCode = Number(body?.stateCode);
  const ntsNum = String(body?.ntsconfirmNum || body?.ntsConfirmNum || '').trim();

  if (stateCode === 304) {
    const set: WebhookDecision['set'] = { status: 'issued' };
    if (ntsNum) set.ntsConfirmNum = ntsNum;
    return { mgtKey, set };
  }
  if (stateCode === 305) {
    return { mgtKey, set: { status: 'failed', error: '국세청 전송실패(stateCode 305) — 팝빌 사이트에서 재전송 필요' } };
  }
  // 301(전송전) 포함 그 외 — 발행 축은 이미 issueReadyTaxbills가 기록했으므로 관측만.
  return { mgtKey, set: {} };
}

// ════════════════════════════════════════════════════════════
// SDK 접속 (lazy 싱글톤)
// ════════════════════════════════════════════════════════════

let cachedService: any = null;

function getService(cfg: PopbillConfig): any {
  if (cachedService) return cachedService;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const popbill = require('popbill');
  popbill.config({
    LinkID: cfg.linkId,
    SecretKey: cfg.secretKey,
    IsTest: cfg.isTest,
    IPRestrictOnOff: true,
    UseStaticIP: false,
    UseLocalTimeYN: true,
  });
  cachedService = popbill.TaxinvoiceService();
  log(`SDK 초기화 — ${cfg.isTest ? '테스트베드' : '★운영★'}`);
  return cachedService;
}

/** 테스트 전용 — 싱글톤 초기화 (env 바꿔 재시험할 때) */
export function resetPopbillService(): void {
  cachedService = null;
}

function registIssueAsync(svc: any, corpNum: string, payload: any, userId: string | null): Promise<any> {
  return new Promise((resolve, reject) => {
    // 소스 실측 시그니처: (CorpNum, Taxinvoice, writeSpecification, forceIssue, memo, emailSubject, dealInvoiceMgtKey, UserID, success, error)
    svc.registIssue(corpNum, payload, false, false, '', '', '', userId || '', resolve, (err: any) => reject(err));
  });
}

function getInfoAsync(svc: any, corpNum: string, mgtKey: string): Promise<any> {
  return new Promise((resolve, reject) => {
    svc.getInfo(corpNum, 'SELL', mgtKey, resolve, (err: any) => reject(err));
  });
}

// ★ 2026-07-31(2) Codex 지적 수용 — 설치 SDK(1.64.2)는 요청 timeout·error 이벤트에서 error 콜백을
//   호출하지 않는 경로가 있어(로그만) 콜백만 기다리면 Promise가 영원히 안 끝날 수 있다.
//   애플리케이션이 보장하는 유한 타임아웃으로 반드시 settle시킨다 — 워커 정지 차단.
export const TAXBILL_SENDMAIL_TIMEOUT_MS = 30_000;

export function sendEmailAsync(svc: any, corpNum: string, mgtKey: string, receiver: string, userId: string | null): Promise<any> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: (v: any) => void) => (v: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(v);
    };
    const timer = setTimeout(
      () => settle(reject)(new Error(`sendEmail 응답 없음 — ${TAXBILL_SENDMAIL_TIMEOUT_MS / 1000}초 초과`)),
      TAXBILL_SENDMAIL_TIMEOUT_MS,
    );
    try {
      // 소스 실측 시그니처: (CorpNum, KeyType, MgtKey, Receiver, UserID, success, error)
      svc.sendEmail(corpNum, 'SELL', mgtKey, receiver, userId || '', settle(resolve), settle(reject));
    } catch (err) {
      settle(reject)(err);
    }
  });
}

/**
 * ★ 2026-07-31(2) 세금계산서 참조 재전송 대상(순수) — 대표와 중복·상호 중복 제거, 형식 유효 주소만.
 * 발행은 대표 1명(invoiceeEmail1)으로 하고, 참조는 발행 확정 직후 팝빌 sendEmail 재전송으로 같은
 * 계산서 메일을 받는다. 설치 SDK에 addContactList가 없어(실측) 미검증 필드를 payload에 넣지 않는
 * 0731 결정은 그대로 유지 — 재전송이 실측된 유일한 복수 통지 축이다.
 */
/** 참조 재전송 상한(장당) — 외부 호출 노출 횟수 제한(Codex). 등록 자체는 막지 않고 재전송만 앞 N명. */
export const TAXBILL_RESEND_MAX_TARGETS = 10;
/** 행당 재시도 상한 — 초과 시 failed 확정(수동 재전송 몫). */
export const TAXBILL_RESEND_MAX_ATTEMPTS = 5;

/**
 * ★ 2026-08-05 `taxbill_issues.is_test` 실존 확인 — 양성만 캐시(선례: 재전송 테이블).
 *
 * 신설 사유: 2026-08-05 운영 전환(KST 12:30) **전에 발행된 12장이 국세청에 안 나갔는데**
 * 우리 장부는 `issued`, 화면은 `발행 완료`로 보여줬다. 어느 환경으로 나갔는지가 **어디에도 안 남아**
 * 승인번호 모양이나 시각으로 추측해야 했다. 그 추측을 영구히 없앤다 — 발행 시점의 `IsTest`를 행에 적는다.
 *
 * 컬럼이 없으면(배포 직후~DDL 전) 표식만 건너뛰고 발행은 그대로 진행한다. 그 창의 행은 백필이 덮는다.
 */
let isTestColumnKnown: boolean | null = null;
let isTestColumnWarned = false;
/** 컬럼이 없으면 환경 격리가 없는 상태로 도는 것이다 — 조용히 넘기지 않고 한 번 남긴다. */
function warnIsTestColumnMissingOnce(): void {
  if (isTestColumnWarned) return;
  isTestColumnWarned = true;
  log('taxbill_issues.is_test 미생성 — 발행 환경 격리 없이 진행합니다(DDL 실행 필요). 표식 기록도 건너뜁니다');
}
async function taxbillIsTestColumnExists(): Promise<boolean> {
  if (isTestColumnKnown === true) return true;
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'taxbill_issues' AND column_name = 'is_test'`,
  );
  if (r.rows.length > 0) { isTestColumnKnown = true; return true; }
  return false;
}

// 재전송 테이블 실존 확인 — 양성만 캐시(생성 후 자가 치유). 미생성 = 발행은 진행·기록만 건너뜀.
// ★ Codex 2R — 조회 예외를 '없음'으로 강등하지 않는다: 일시 오류 한 번이 pending 미기록인 채 issued 커밋
//   = 참조 재전송 영구 유실이 된다. 예외는 전파 — 호출부(issued 분기 = submitted 유지 재시도 /
//   재전송 패스 = 워커 tick catch)가 재시도를 소유한다.
let taxbillResendTableKnown: boolean | null = null;
async function taxbillResendTableExists(): Promise<boolean> {
  if (taxbillResendTableKnown === true) return true;
  const r = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'taxbill_email_resends'`);
  if (r.rows.length > 0) {
    taxbillResendTableKnown = true;
    return true;
  }
  return false;
}

let resendTableWarned = false;
function warnResendTableMissingOnce(): void {
  if (resendTableWarned) return;
  resendTableWarned = true;
  log('참조 재전송 테이블(taxbill_email_resends) 미생성 — 참조 수신자가 등록된 계산서는 DDL 실행 전까지 발행 확정을 미룹니다');
}

/**
 * ★ 2026-07-31(2) Codex 3R·4R — issued 승격의 단일 계약:
 *   "참조 대상이 있으면, pending 기록과 같은 트랜잭션이 아니고서는 issued가 되지 않는다."
 * ★ 4R부터 **승격 소유자는 발행 패스(processOne) 하나뿐**이다 — 웹훅 304는 승격하지 않고 failed만
 * submitted로 재큐잉해 워커에 위임한다(웹훅은 순서 보장 없는 외부 신호라 내구 계약의 주체가 될 수 없다).
 * 이 함수는 processOne의 확정 트랜잭션 전용: 같은 트랜잭션에서 pending을 기록하고, 기록 불가(테이블
 * 미생성 등)면 throw로 승격 자체를 막는다(호출부 catch = submitted 유지·다음 tick 재시도).
 * 대상 0명 = 기록 없이 통과(약속이 없다). 멱등 = UNIQUE(taxbill_issue_id, lower(email)) ON CONFLICT DO NOTHING.
 * opts.tableExists 주입은 테스트 전용(기본 = 실제 카탈로그 조회).
 */
export async function enqueueTaxbillResendsForIssue(
  client: { query: (sql: string, params?: any[]) => Promise<any> },
  issueId: string,
  mgtKey: string,
  to: { primary: { email: string; name?: string | null } | null; cc: string[] },
  opts?: { tableExists?: () => Promise<boolean> },
): Promise<number> {
  const targets = selectTaxbillResendTargets(to);
  if (targets.length === 0) return 0;
  const exists = await (opts?.tableExists ?? taxbillResendTableExists)();
  if (!exists) {
    warnResendTableMissingOnce();
    throw new Error('참조 재전송 테이블(taxbill_email_resends) 미생성 — 참조 수신자가 등록된 계산서는 기록 가능해질 때까지 발행 확정을 미룹니다');
  }
  for (const rcpt of targets) {
    await client.query(
      `INSERT INTO taxbill_email_resends (taxbill_issue_id, invoicer_mgt_key, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (taxbill_issue_id, lower(email)) DO NOTHING`,
      [issueId, mgtKey, rcpt],
    );
  }
  return targets.length;
}

/**
 * ★ 2026-08-08 발행 메일 아카이브 참조(Harold 지시 0807 · ENV TAXBILL_ARCHIVE_BCC) — **확정 트랜잭션 밖 best-effort.**
 *
 * 원칙(§2-1) = "우리 아카이브 주소 때문에 고객 계산서 발행 확정을 미루지 않는다."
 * 처음 구현은 확정 트랜잭션 안에 SAVEPOINT로 격리하는 형태였는데 Codex 1R이 그 형태 자체를 깼다 —
 * SAVEPOINT 복구 실패가 트랜잭션을 오염시켜(25P02) issued 갱신·고객 참조 기록까지 조용히 되돌리고,
 * 아카이브 전용 tableExists 조회 거절만으로도 확정이 롤백된다. **격리 장치를 덧대는 대신 트랜잭션 밖으로
 * 뺐다** — COMMIT 뒤 자기 연결(pool)로 기록하고, 어떤 실패도 던지지 않고 [아카이브미기록] 로그로만 남긴다
 * (issueId·mgtKey·대상 수 — 복구는 수동 재발송 창구 몫이고, 고객에게는 아무 영향이 없다).
 * 멱등 UNIQUE(taxbill_issue_id, lower(email))라 재시도가 겹쳐도 중복 발송 없음.
 * opts(archiveBcc·tableExists·exec) 주입은 테스트 전용 — 기본은 ENV·카탈로그·pool.
 */
let archiveEnvWarned = false;
export async function enqueueTaxbillArchiveCopies(
  issueId: string,
  mgtKey: string,
  to: { primary: { email: string; name?: string | null } | null; cc: string[] },
  opts?: {
    archiveBcc?: string | null;
    tableExists?: () => Promise<boolean>;
    exec?: (sql: string, params?: any[]) => Promise<any>;
  },
): Promise<number> {
  const raw = opts?.archiveBcc !== undefined ? opts.archiveBcc : (process.env.TAXBILL_ARCHIVE_BCC ?? null);
  const archives = selectTaxbillArchiveTargets(raw, [to.primary?.email || '', ...selectTaxbillResendTargets(to)]);
  // 비어 있지 않은 ENV에서 형식 무효 토큰이 버려지면 아카이브가 무음으로 꺼진 셈이다 — 1회 경고(Codex 1R medium).
  const invalid = String(raw || '').split(/[,;\s]+/).filter((t) => t.trim() && !t.includes('@'));
  if (invalid.length > 0 && !archiveEnvWarned) {
    archiveEnvWarned = true;
    console.error(`[팝빌][아카이브설정오류] TAXBILL_ARCHIVE_BCC 형식 무효 토큰 ${invalid.length}건 — ${invalid.join(', ')} (발행은 막지 않는다)`);
  }
  if (archives.length === 0) return 0;
  try {
    const exists = await (opts?.tableExists ?? taxbillResendTableExists)();
    if (!exists) {
      console.error(
        `[팝빌][아카이브미기록] issue=${issueId} key=${mgtKey} 대상=${archives.length} — 재전송 테이블 미생성(DDL 필요). 발행 확정은 이미 끝났고 아카이브 메일만 안 나간다`,
      );
      return 0;
    }
    const exec = opts?.exec ?? ((sql: string, params?: any[]) => pool.query(sql, params));
    // ★ Codex 2R medium 수용 — 실패는 수신자별로 격리한다. 한 주소가 막혀 뒤 주소까지 누락되면
    //   로그의 "대상 수"만으로는 누가 빠졌는지 재구성할 수 없다. 실패 주소를 그대로 남긴다.
    let ok = 0;
    for (const rcpt of archives) {
      try {
        await exec(
          `INSERT INTO taxbill_email_resends (taxbill_issue_id, invoicer_mgt_key, email)
           VALUES ($1, $2, $3)
           ON CONFLICT (taxbill_issue_id, lower(email)) DO NOTHING`,
          [issueId, mgtKey, rcpt],
        );
        ok += 1;
      } catch (insErr: any) {
        console.error(
          `[팝빌][아카이브미기록] issue=${issueId} key=${mgtKey} 주소=${rcpt} — ${String(insErr?.message ?? insErr).slice(0, 200)} (발행 확정은 이미 끝났다)`,
        );
      }
    }
    return ok;
  } catch (err: any) {
    console.error(
      `[팝빌][아카이브미기록] issue=${issueId} key=${mgtKey} 대상=${archives.length} — ${String(err?.message ?? err).slice(0, 200)} (발행 확정은 이미 끝났다)`,
    );
    return 0;
  }
}

/**
 * ★ 2026-08-08 발행 메일 아카이브 참조 대상(순수) — ENV TAXBILL_ARCHIVE_BCC(쉼표·세미콜론·공백 구분)를
 * 참조 재전송 큐에 합칠 주소로 고른다. 팝빌 발행 payload에 BCC 필드가 없어(invoiceeEmail1 대표 1명뿐)
 * 재전송 축이 유일한 통로다. 대표·고객 참조와 중복(대소문자 무시)이면 제외 — 그쪽으로 이미 간다.
 * 상한을 두지 않는 이유 — ENV는 우리가 통제하는 값이라 폭주 축이 아니다(고객 참조 상한 10과 축이 다르다).
 */
export function selectTaxbillArchiveTargets(raw: string | null | undefined, exclude: string[]): string[] {
  const seen = new Set(exclude.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean));
  const out: string[] = [];
  for (const part of String(raw || '').split(/[,;\s]+/)) {
    const e = part.trim();
    if (!e || !e.includes('@')) continue;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export function selectTaxbillResendTargets(to: {
  primary: { email: string; name?: string | null } | null;
  cc: string[];
}): string[] {
  const primary = (to.primary?.email || '').trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of to.cc || []) {
    const e = String(c || '').trim();
    if (!e || !e.includes('@')) continue;
    const key = e.toLowerCase();
    if (key === primary || seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= TAXBILL_RESEND_MAX_TARGETS) break;
  }
  return out;
}

// ════════════════════════════════════════════════════════════
// 발행 실행 (워커 소비부)
// ════════════════════════════════════════════════════════════

/**
 * ready 행 1건의 발행에 필요한 전부 — 컨펌·정산·회사·3단 사업자 후보.
 * ★ 날짜는 to_char로 문자열 고정 — 이 프로젝트 pg는 DATE(1082)를 JS Date로 파싱해서
 *   (database.ts는 1114만 재정의) `String(row.issue_date)`가 'Fri Jul 31 …'이 된다.
 *   그대로 두면 운영 행 전부가 작성일자 형식 오류로 failed(0730 Codex critical 실측 확정).
 */
const ISSUE_ROW_SQL = `
  SELECT t.id, t.kind, t.modify_code, t.org_nts_confirm_num, t.invoicer_mgt_key,
         to_char(t.issue_date, 'YYYY-MM-DD') AS issue_date,
         t.supply_amount, t.tax_amount, t.total_amount, t.status,
         t.confirmation_id,
         -- 당초 작성일자(수정 장의 remark1 재료) — 당초 승인번호로 우리 장부에서 역참조
         (SELECT to_char(o.issue_date, 'YYYY-MM-DD')
            FROM taxbill_issues o
           WHERE o.nts_confirm_num = t.org_nts_confirm_num AND o.id <> t.id
           ORDER BY o.created_at LIMIT 1) AS org_write_date,
         ic.recipient_email,
         t.company_id, b.user_id AS billing_user_id,
         to_char(b.billing_end, 'YYYY-MM-DD') AS billing_end,
         c.company_name, c.business_number, c.ceo_name, c.address,
         c.business_type, c.business_category,
         bca.taxbill_company_name AS acct_taxbill_company_name,
         bca.taxbill_biz_number   AS acct_taxbill_biz_number,
         bca.taxbill_ceo_name     AS acct_taxbill_ceo_name,
         bca.taxbill_address      AS acct_taxbill_address,
         bca.taxbill_biz_type     AS acct_taxbill_biz_type,
         bca.taxbill_biz_item     AS acct_taxbill_biz_item,
         bcc.taxbill_company_name AS co_taxbill_company_name,
         bcc.taxbill_biz_number   AS co_taxbill_biz_number,
         bcc.taxbill_ceo_name     AS co_taxbill_ceo_name,
         bcc.taxbill_address      AS co_taxbill_address,
         bcc.taxbill_biz_type     AS co_taxbill_biz_type,
         bcc.taxbill_biz_item     AS co_taxbill_biz_item
    FROM taxbill_issues t
    LEFT JOIN invoice_confirmations ic ON ic.id = t.confirmation_id
    LEFT JOIN billings b ON b.id = t.billing_id
    LEFT JOIN companies c ON c.id = t.company_id
    LEFT JOIN users u ON u.id = b.user_id
    LEFT JOIN billing_contacts bca ON bca.company_id = t.company_id AND bca.user_id = b.user_id
    LEFT JOIN billing_contacts bcc ON bcc.company_id = t.company_id AND bcc.user_id IS NULL
   WHERE t.id = $1`;

// ★ Codex 5R — 실패 기록은 조건부(CAS)다: 이 패스가 claim한 상태(submitted) 그대로일 때만 쓴다.
//   그 사이 웹훅 304 관측이 상태를 ready로 돌렸다면(팝빌은 발행됐다는 뜻) 실패 기록을 거부하고
//   다음 tick의 getInfo 자가치유에 맡긴다 — 외부 발행 문서를 내부에서 failed로 덮는 경합 차단.
async function markFailed(id: string, error: string): Promise<void> {
  const r = await pool.query(
    `UPDATE taxbill_issues SET status = 'failed', error = $2 WHERE id = $1 AND status = 'submitted'`,
    [id, error],
  );
  if ((r.rowCount || 0) === 0) {
    log(`실패 기록 거부 — id=${id} 행 상태가 claim 이후 바뀜(웹훅 304 관측 등) → 다음 tick 재확인에 위임. 사유였던 것: ${error.slice(0, 200)}`);
  }
}

/** 발행 1건 — 순차 전용. 결과는 'issued' | 'submitted'(재조회 실패 — 사람 확인) | 'failed'. */
async function processOne(id: string, cfg: PopbillConfig): Promise<'issued' | 'submitted' | 'failed'> {
  const r = await pool.query(ISSUE_ROW_SQL, [id]);
  const row = r.rows[0];
  if (!row) {
    return 'failed'; // 행 소실 — claim 직후 삭제된 경우뿐. 기록할 행 자체가 없다.
  }

  try {
    if (!row.issue_date) {
      await markFailed(id, '작성일자(issue_date)가 없습니다 — 직접선택 정책이면 날짜 지정 후 ready로');
      return 'failed';
    }
    if (!row.billing_end) {
      await markFailed(id, '정산 행이 소실되어 대상월을 알 수 없습니다');
      return 'failed';
    }
    // ★ 수정발행(0730 정식 개방 — Harold 지시): 장 생성은 planModifyIssue(사유별 부호 계약)를
    //   통과한 행만 존재하고, 빌더가 부호·remark1(당초 작성일자)을 한 번 더 검증한다.
    //   그 밖의 kind는 알 수 없는 값이라 거부(fail-closed 유지).
    if (row.kind !== 'original' && row.kind !== 'modify') {
      await markFailed(id, `알 수 없는 장 유형(kind=${row.kind}) — original/modify만 발행 가능`);
      return 'failed';
    }

    // numeric(15,2)는 문자열로 온다 — Number 변환 후 정수 검증은 빌더가 한다.
    const supply = Number(row.supply_amount);
    const tax = Number(row.tax_amount);
    const total = Number(row.total_amount);

    const issueDate = String(row.issue_date).slice(0, 10);
    const party = pickTaxbillParty(row);

    // [추적 먼저] 문서번호를 외부 호출 전에 저장 — 이미 있으면 그 번호 재사용(멱등).
    // ★ 2026-08-21 (Codex 5R 수용) 저장 판정도 trim 기준 — 공백 키 행에서 새 키를 만들어 쓰면서 원본
    //   truthiness로 저장을 건너뛰면, 외부 호출은 생성 키로 나갔는데 DB엔 공백이 남는다(추적 유실).
    const mgtKey = String(row.invoicer_mgt_key || '').trim() || buildInvoicerMgtKey(issueDate, id);
    if (!String(row.invoicer_mgt_key || '').trim()) {
      await pool.query(`UPDATE taxbill_issues SET invoicer_mgt_key = $2 WHERE id = $1`, [id, mgtKey]);
    }

    const month = Number(String(row.billing_end).slice(5, 7));
    // ★ 2026-07-31 계산서 통지 메일은 **거래내역서 수신자와 별개**다(서수란 접수 — 받는 사람이 다른 고객사가 있다).
    //   그전엔 컨펌 메일을 받은 사람(`ic.recipient_email`)을 그대로 팝빌에 넘겨 둘이 강제로 같았다.
    //   등록된 계산서 수신자가 없으면 null로 둔다 — 거래내역서 수신자로 되돌리면 원장이 다시 섞인다.
    const taxbillTo = await resolveBillingRecipients(
      String(row.company_id),
      row.billing_user_id ? String(row.billing_user_id) : null,
      'taxbill',
    );
    // ★ 2026-07-31 수신자가 없으면 **발행하지 않는다**(Codex 적대검증 high).
    //   팝빌은 빈 이메일도 받아 발행을 진행하므로, 그대로 두면 계산서는 국세청에 나가고 과금까지 끝났는데
    //   고객은 아무 통지를 못 받는다. 되돌리려면 수정발행이라 비용이 크다.
    //   거래내역서 수신자로 되돌리는 폴백은 두지 않는다 — 원장을 다시 섞는 길이다.
    if (!taxbillTo.primary?.email) {
      await markFailed(id, '세금계산서 수신자가 등록되어 있지 않습니다 — 고객사 정산 탭에서 세금계산서 수신자를 등록한 뒤 재시도해주세요');
      return 'failed';
    }
    const payload = buildTaxinvoicePayload({
      issueDate,
      supplyAmount: supply,
      taxAmount: tax,
      totalAmount: total,
      party,
      invoiceeEmail: taxbillTo.primary?.email ?? null,
      invoicerMgtKey: mgtKey,
      itemName: `${month}월 메시징 이용료${row.kind === 'modify' ? ' (수정)' : ''}`,
      modifyCode: row.kind === 'modify' ? row.modify_code : null,
      orgNtsConfirmNum: row.kind === 'modify' ? row.org_nts_confirm_num : null,
      orgWriteDate: row.kind === 'modify' ? row.org_write_date : null,
    });

    const svc = getService(cfg);

    let issueRes: any = null;
    let issueErr: any = null;
    try {
      issueRes = await registIssueAsync(svc, cfg.corpNum, payload, cfg.userId);
      log(`registIssue 응답 raw — key=${mgtKey} ${JSON.stringify(issueRes)}`);
    } catch (err: any) {
      issueErr = err;
      log(`registIssue 실패 raw — key=${mgtKey} ${JSON.stringify({ code: err?.code, message: err?.message })}`);
    }

    // [효과 검증 후 성공 표시] 성공이든 실패든 getInfo 재조회가 최종 판정이다 — 단 실재만으로는
    // 부족하고 stateCode 계열(3xx=발행/6xx=취소)까지 본다(취소 문서를 issued로 승격하는 사고 차단).
    //  - 재조회 3xx → issued (registIssue가 중복 에러였어도 이전 시도 성공 = 자가치유)
    //  - 재조회 6xx → failed '발행취소 상태'
    //  - 재조회 실패/미지 코드: 성공 응답이었으면 submitted(사람 확인 — 성공 표시 유보), 실패 응답이었으면 failed
    let info: any = null;
    try {
      info = await getInfoAsync(svc, cfg.corpNum, mgtKey);
      log(`getInfo 재조회 raw — key=${mgtKey} ${JSON.stringify(info).slice(0, 800)}`);
    } catch {
      info = null;
    }

    const verdict = info ? judgeInfoState(info.stateCode) : 'unknown';

    if (verdict === 'issued') {
      // 팝빌 GetInfo 필드 표기는 소문자 c(ntsconfirmNum) — camelCase도 방어적으로 수용.
      const ntsNum =
        String(issueRes?.ntsConfirmNum || issueRes?.ntsconfirmNum || info?.ntsconfirmNum || info?.ntsConfirmNum || '').trim() || null;
      // ★ 2026-07-31(2) 참조 재전송은 이 패스 안에서 보내지 않는다(Codex — 전역 발행 락 안 외부 호출·비내구 유실).
      //   issued 확정 트랜잭션에 수신자별 pending 행을 함께 기록(내구)하고, 락 밖 재전송 패스가 소비한다.
      //   테이블 미생성 환경은 기록만 건너뛴다(발행은 진행 — 경고 1회).
      // ★ Codex 2R — verdict=issued 이후의 로컬 실패(카탈로그 조회·트랜잭션·큐 INSERT)는 절대 failed로
      //   강등하지 않는다: 팝빌엔 이미 발행·과금된 문서라 거짓 실패가 된다. 행은 claim 시점의 submitted
      //   그대로 두고 반환 — 다음 tick 재수집 → registIssue 중복 → getInfo 3xx 자가치유가 장부 확정과
      //   pending 기록까지 통째로 재시도한다(문서번호가 행마다 결정적 = 재시도에도 중복 발행 없음).
      try {
      // ★ 발행 사실은 두 테이블이 함께 알아야 한다(0730 Codex 지적 ④ 수용) — 장부(taxbill_issues)만
      //   issued로 바꾸면 공개 컨펌 페이지(invoice_confirmations 축)가 발행 후에도 이의신청을 받는다.
      //   한 트랜잭션으로 컨펌 행의 taxbill_status·issued_at·popbill_invoice_key까지 동기화한다.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // ★ 2026-08-05 **발행 시점의 환경을 행에 적는다.** 이게 없어서 전환 전 12장이 국세청에 안 나갔는데도
        //   `issued`로 남아 있었고, 어느 환경이었는지를 승인번호 모양과 시각으로 추측해야 했다.
        //   컬럼이 없으면(DDL 전) 표식만 건너뛰고 발행은 그대로 진행한다 — 발행이 죽는 쪽이 더 나쁘다.
        const markIsTest = await taxbillIsTestColumnExists();
        await client.query(
          `UPDATE taxbill_issues
              SET status = 'issued', issued_at = NOW(), error = NULL,
                  nts_confirm_num = COALESCE($2, nts_confirm_num)${markIsTest ? ', is_test = $3' : ''}
            WHERE id = $1`,
          markIsTest ? [id, ntsNum, cfg.isTest] : [id, ntsNum],
        );
        // ★ 3R·4R — issued 승격 계약: 참조 pending 기록과 같은 트랜잭션. 승격 소유자는 이 패스 하나뿐
        //   (웹훅 304는 관측·failed 재큐잉만 — 여기가 유일한 기록 지점이라 수신자 집합도 한 벌만 커밋된다).
        await enqueueTaxbillResendsForIssue(client, id, mgtKey, taxbillTo);
        if (row.confirmation_id) {
          await client.query(
            `UPDATE invoice_confirmations
                SET taxbill_status = 'issued',
                    issued_at = COALESCE(issued_at, NOW()),
                    popbill_invoice_key = COALESCE(popbill_invoice_key, $2)
              WHERE id = $1`,
            [row.confirmation_id, mgtKey],
          );
        }
        await client.query('COMMIT');
      } catch (txErr) {
        try { await client.query('ROLLBACK'); } catch { /* 전파 */ }
        throw txErr;
      } finally {
        client.release();
      }
      } catch (localErr: any) {
        // 팝빌 발행은 확정 — 여기 실패는 우리 쪽 반영 실패일 뿐이다. submitted 유지 = 다음 tick 자가치유.
        log(`issued 확정 후 로컬 반영 실패 — key=${mgtKey} 다음 tick 자가치유 대기 ${JSON.stringify({ message: localErr?.message || String(localErr) })}`);
        try {
          await pool.query(
            `UPDATE taxbill_issues SET error = $2 WHERE id = $1`,
            [id, `발행은 확정(팝빌 3xx)됐으나 내부 반영 실패 — 다음 주기 자동 재시도: ${String(localErr?.message ?? localErr).slice(0, 300)}`],
          );
        } catch { /* best-effort — 로그가 진실 */ }
        return 'submitted';
      }
      // ★ 2026-08-08 아카이브 참조는 확정 트랜잭션 **밖** best-effort — 여기 도달 = COMMIT 완료.
      //   함수가 어떤 실패도 던지지 않으므로(로그만) 발행 결과에 영향이 없고, 워커 tick의 재전송 패스가
      //   발행 패스 직후 돌므로 같은 tick에 아카이브 메일까지 나간다.
      await enqueueTaxbillArchiveCopies(id, mgtKey, taxbillTo);
      return 'issued';
    }

    if (verdict === 'nts_failed') {
      // 발행 자체는 됐다 — 하지만 웹훅 305 판정과 같은 결론(failed + 재전송 안내)으로 통일한다.
      await markFailed(id, '국세청 전송실패(stateCode 305) — 팝빌 사이트에서 재전송 필요');
      return 'failed';
    }
    if (verdict === 'cancelled') {
      await markFailed(id, `팝빌 문서가 발행취소 상태(stateCode ${info?.stateCode}) — 사람이 확인 후 재발번 필요`);
      return 'failed';
    }

    if (issueErr) {
      await markFailed(id, `팝빌 ${issueErr?.code ?? '?'}: ${issueErr?.message ?? String(issueErr)}`);
      return 'failed';
    }
    await pool.query(
      `UPDATE taxbill_issues SET error = $2 WHERE id = $1`,
      [id, `발행 응답은 성공인데 재조회 판정 불가(${info ? `stateCode ${info.stateCode}` : '재조회 실패'}) — 팝빌 사이트 확인 필요 (submitted 유지)`],
    );
    return 'submitted';
  } catch (err: any) {
    await markFailed(id, String(err?.message ?? err));
    return 'failed';
  }
}

export interface IssuePassResult {
  picked: number;
  issued: number;
  submitted: number;
  failed: number;
  skipped?: string;
}

/**
 * ready → 발행 패스. taxbill-worker가 5분마다 부른다.
 *
 * ★ 패스 전체를 세션 advisory lock 하나로 직렬화한다(0730 Codex 지적 ③ 수용 — 더 단순한 방식으로).
 *   SDK 타임아웃(호출당 180초)이 tick 주기(5분)를 넘을 수 있어, 락 없이는 이전 패스가 아직
 *   registIssue 중인 행을 다음 tick이 다시 집어 같은 문서를 두 실행이 만지게 된다(setInterval은
 *   이전 tick을 기다리지 않고, PM2 다중 인스턴스면 프로세스 밖에서도 겹친다). try_lock이 실패하면
 *   이번 패스를 통째로 건너뛴다 — 겹침의 해악(상태 역전·이중 호출)이 5분 지연보다 훨씬 크다.
 *   lease/owner-token 방식은 같은 목표에 컬럼 추가(DDL)가 들어 채택하지 않았다.
 *
 * claim(ready·submitted→submitted)을 짧은 트랜잭션으로 끝내고, 외부 호출은 트랜잭션 밖에서
 * **순차** 처리한다(돈·발송 인접 = 병렬 금지). 크래시로 submitted에 남은 행은 다음 패스가 집어
 * getInfo 자가치유한다(문서번호가 행마다 결정적이라 재시도 = 같은 번호 = 중복 발행 없음).
 */
export async function issueReadyTaxbills(limit = 10): Promise<IssuePassResult> {
  if (!isPopbillEnabled()) return { picked: 0, issued: 0, submitted: 0, failed: 0, skipped: 'POPBILL_ENABLED != true' };
  const cfg = getPopbillConfig();
  if (!cfg) return { picked: 0, issued: 0, submitted: 0, failed: 0, skipped: 'POPBILL ENV 미설정(LINK_ID·SECRET_KEY·CORP_NUM)' };

  // 세션 락 전용 커넥션 — 패스가 끝날 때까지 쥔다(트랜잭션 락은 claim 커밋과 함께 풀려서 부족).
  const lockClient = await pool.connect();
  try {
    const lock = await lockClient.query(`SELECT pg_try_advisory_lock(hashtext('taxbill_issue_pass')) AS ok`);
    if (!lock.rows[0]?.ok) {
      return { picked: 0, issued: 0, submitted: 0, failed: 0, skipped: '다른 발행 패스가 진행 중 — 이번 tick 건너뜀' };
    }

    // claim — ready를 submitted로 전환해 이 패스의 소유로 만든다. SKIP LOCKED로 겹침 무해.
    //
    // ★ 2026-08-06 (Codex 2R high) **행에 적힌 환경과 내 환경이 같을 때만 집는다.**
    //   그전에는 "어느 환경으로 나가야 하는가"가 행에 없어서, 되돌려 놓은 운영 재발행 건을
    //   그 사이 재기동으로 테스트 설정이 된 워커가 집어 **테스트베드로 또 보낼 수 있었다**.
    //   요청 시점에 환경을 확인하는 것만으로는 enqueue와 소비 사이가 닫히지 않는다 — 그 구간이 뿌리다.
    //   `is_test`가 그 축이다: 발행 전에는 **목표**, 발행 후에는 **결과**.
    //   ★ Codex 3R high 수용 — NULL 관용(`COALESCE`)을 뺐다. 그 관용은 표식 없는 행을 **양쪽 환경 모두**에
    //   열어 격리를 되돌린다. 컬럼이 `NOT NULL DEFAULT false`라 NULL 행이 생기지 않으므로 잃는 것도 없다.
    //   컬럼이 아직 없는 환경에서는 조건을 빼되(발행을 통째로 멈추는 쪽이 더 나쁘다) **조용히 넘기지 않는다.**
    const hasIsTestColumn = await taxbillIsTestColumnExists();
    if (!hasIsTestColumn) warnIsTestColumnMissingOnce();
    const claimEnvClause = hasIsTestColumn ? 'AND is_test = $2' : '';
    // ★ 2026-08-21 작성일자 도래 게이트(서수란 접수 — 라프레리 실측). 자동 정책(익월 1일)은 언제나
    //   미래 작성일자를 만드는데, claim이 날짜를 보지 않아 컨펌 직후 발행을 시도했고 팝빌이
    //   -11002009(작성일자가 미래일자)로 거부해 failed에 멈췄다. 작성일자는 한국 세법 개념이라 KST 축.
    //   issue_date IS NULL은 게이트에서 빼고 집는다 — 기존 processOne의 markFailed('작성일자가 없습니다')로
    //   드러나야 한다. 게이트에 넣으면 그 행이 조용히 영영 잠긴다(fail-silent 금지).
    const claimed = await pool.query(
      `UPDATE taxbill_issues SET status = 'submitted'
        WHERE id IN (
          SELECT id FROM taxbill_issues
           WHERE status IN ('ready', 'submitted')
             AND (issue_date IS NULL OR issue_date <= (NOW() AT TIME ZONE 'Asia/Seoul')::date)
             ${claimEnvClause}
           ORDER BY created_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, kind, modify_code, org_nts_confirm_num, total_amount`,
      claimEnvClause ? [limit, cfg.isTest] : [limit],
    );

    // ★ 사유 1(부+정 2장)은 순서·짝 게이트로 처리한다(0730 Codex 3R ① 수용).
    //   부(-) 장을 먼저 발행하고, 부가 issued가 아니면 정(+) 장은 시도하지 않고 failed로 묶는다 —
    //   정 장만 국세청에 남는 반쪽을 만들지 않기 위해서다. 부만 발행되고 정이 실패한 반쪽은
    //   문서번호가 결정적이라 재시도(retry)로 안전하게 이어붙일 수 있다(같은 번호 = 중복 발행 없음).
    const rows = [...claimed.rows].sort((a: any, b: any) => {
      const aPairPos = a.modify_code === 1 && Number(a.total_amount) > 0 ? 1 : 0;
      const bPairPos = b.modify_code === 1 && Number(b.total_amount) > 0 ? 1 : 0;
      return aPairPos - bPairPos; // 부(-)·일반 장 먼저, 사유1 정(+) 장은 뒤로
    });

    const result: IssuePassResult = { picked: rows.length, issued: 0, submitted: 0, failed: 0 };
    const pairNegOutcome = new Map<string, 'issued' | 'submitted' | 'failed'>(); // org승인번호 → 부 장 결과
    for (const row of rows) {
      const id = String(row.id);
      const isPairPositive = row.modify_code === 1 && Number(row.total_amount) > 0;
      if (isPairPositive) {
        // 같은 패스의 부 장 결과를 우선 보고, 없으면(이전 패스 분리 처리) DB의 부 장 상태를 본다.
        let negState = pairNegOutcome.get(String(row.org_nts_confirm_num));
        if (!negState) {
          const sib = await pool.query(
            `SELECT status FROM taxbill_issues
              WHERE org_nts_confirm_num = $1 AND kind = 'modify' AND modify_code = 1 AND total_amount < 0
              ORDER BY created_at DESC LIMIT 1`,
            [row.org_nts_confirm_num],
          );
          negState = (sib.rows[0]?.status === 'issued' ? 'issued' : 'failed') as 'issued' | 'failed';
        }
        if (negState !== 'issued') {
          await markFailed(id, '짝인 부(-) 장이 발행되지 않아 중단 — 부 장 문제를 해결하고 두 장을 재시도해 주세요');
          result.failed += 1;
          continue;
        }
      }
      const outcome = await processOne(id, cfg);
      result[outcome] += 1;
      if (row.modify_code === 1 && Number(row.total_amount) < 0) {
        pairNegOutcome.set(String(row.org_nts_confirm_num), outcome);
      }
    }
    if (result.picked > 0) {
      log(`발행 패스 — 대상 ${result.picked} / 발행 ${result.issued} / 확인대기 ${result.submitted} / 실패 ${result.failed}`);
    }
    return result;
  } finally {
    try {
      await lockClient.query(`SELECT pg_advisory_unlock(hashtext('taxbill_issue_pass'))`);
    } catch {
      /* 커넥션 종료 시 세션 락은 자동 해제 */
    }
    lockClient.release();
  }
}

// ════════════════════════════════════════════════════════════
// ★ 2026-07-31(2) 세금계산서 참조 재전송 패스 (발행 패스와 분리 — Codex 수용)
//   발행 락 밖에서 pending 행을 소비한다: 행 단위 상태(sent/failed)·시도 카운트·유한 타임아웃.
//   한 주소가 느려도 발행 패스는 영향 없고, 크래시 시 pending 행이 남아 다음 tick이 이어간다.
// ════════════════════════════════════════════════════════════

export interface ResendPassResult {
  picked: number;
  sent: number;
  failed: number;
  skipped?: string;
}

export async function processTaxbillEmailResends(limit = 20): Promise<ResendPassResult> {
  const cfg = getPopbillConfig();
  if (!cfg) return { picked: 0, sent: 0, failed: 0, skipped: '팝빌 게이트 닫힘' };
  if (!(await taxbillResendTableExists())) {
    return { picked: 0, sent: 0, failed: 0, skipped: 'taxbill_email_resends 미생성 — DDL 실행 필요' };
  }
  const lockClient = await pool.connect();
  try {
    const lock = await lockClient.query(`SELECT pg_try_advisory_lock(hashtext('taxbill_email_resend_pass')) AS ok`);
    if (!lock.rows[0]?.ok) {
      return { picked: 0, sent: 0, failed: 0, skipped: '다른 재전송 패스가 진행 중 — 이번 tick 건너뜀' };
    }
    // 단일 패스 락이라 이중 집기 없음 — claim 전이 없이 행 단위로 결과를 기록한다.
    const rows = await pool.query(
      `SELECT id, invoicer_mgt_key, email, attempts FROM taxbill_email_resends
        WHERE status = 'pending' AND attempts < $2
        ORDER BY created_at
        LIMIT $1`,
      [limit, TAXBILL_RESEND_MAX_ATTEMPTS],
    );
    const svc = getService(cfg);
    let sent = 0;
    let failed = 0;
    for (const r of rows.rows) {
      try {
        await sendEmailAsync(svc, cfg.corpNum, String(r.invoicer_mgt_key), String(r.email), cfg.userId);
        await pool.query(
          `UPDATE taxbill_email_resends
              SET status = 'sent', attempts = attempts + 1, last_error = NULL, updated_at = NOW()
            WHERE id = $1`,
          [r.id],
        );
        sent += 1;
      } catch (err: any) {
        const nextAttempts = Number(r.attempts) + 1;
        const final = nextAttempts >= TAXBILL_RESEND_MAX_ATTEMPTS;
        await pool.query(
          `UPDATE taxbill_email_resends
              SET status = $2, attempts = $3, last_error = $4, updated_at = NOW()
            WHERE id = $1`,
          [r.id, final ? 'failed' : 'pending', nextAttempts, String(err?.message || err).slice(0, 500)],
        );
        failed += 1;
        log(`참조 재전송 실패 — key=${r.invoicer_mgt_key} to=${r.email} 시도 ${nextAttempts}/${TAXBILL_RESEND_MAX_ATTEMPTS}${final ? ' · 최종 실패(수동 재전송 몫)' : ''}`);
      }
    }
    if (rows.rows.length > 0) {
      log(`참조 재전송 패스 — 대상 ${rows.rows.length} / 성공 ${sent} / 실패 ${failed}`);
    }
    return { picked: rows.rows.length, sent, failed };
  } finally {
    try {
      await lockClient.query(`SELECT pg_advisory_unlock(hashtext('taxbill_email_resend_pass'))`);
    } catch {
      /* 커넥션 종료 시 세션 락은 자동 해제 */
    }
    lockClient.release();
  }
}

// ════════════════════════════════════════════════════════════
// ★ 2026-08-05 발행 완료분 메일 재발송 (서수란 접수 — "미수신으로 재발송 요청 시 처리 방법이 없다")
// ════════════════════════════════════════════════════════════

/**
 * 재발송 실패의 **성격**을 담는다(Codex 3R medium 수용).
 * 전부 422로 내리면 팝빌 게이트가 닫힌 것도, SDK가 죽은 것도 "입력 오류"로 기록되어
 * 5xx 알림과 재시도 판단이 막힌다 — 유일한 재발송 창구라 그 누락이 오래간다.
 */
export class TaxbillResendError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'TaxbillResendError';
  }
}

/**
 * 이미 발행된 세금계산서의 **메일만** 다시 보낸다.
 *
 * 재발행이 아니다 — 팝빌에 있는 그 문서를 **같은 문서번호로 다시 메일링**한다. 국세청에 문서가
 * 두 번 나가지 않으므로 "ready 이상 재발행 금지"와 충돌하지 않는다. 금액이 틀린 건은 여전히
 * 수정세금계산서 경로이고, 이 함수는 어떤 상태도 바꾸지 않는다(부수효과 = 메일 하나).
 *
 * 수신자는 원장(`billing_recipients` · `doc_type='taxbill'`) 하나에서 나온다 — 대표 + 참조 전부.
 * 주소를 넘기면 그 한 곳에만 보낸다("이 주소로 다시 주세요"가 실제 요청 형태다).
 *
 * 한 통이라도 나가면 성공으로 돌려주고 실패한 주소를 함께 알린다 — 전부 실패면 던진다.
 * 발행 패스와 달리 락을 잡지 않는다: 상태를 쓰지 않으므로 겹쳐 돌아도 어긋날 값이 없다.
 */
export async function resendIssuedTaxbillEmail(opts: {
  issueId: string;
  /** 지정하면 이 주소 한 곳에만. 비우면 원장의 대표 + 참조 전부. */
  email?: string | null;
  /** 누가 눌렀는가 — 국세청 문서 관련 행위라 로그에 남긴다(Codex 1R high 부분 수용). */
  adminId?: string | null;
}): Promise<{ mgtKey: string; sent: string[]; failed: { email: string; error: string }[] }> {
  const cfg = getPopbillConfig();
  if (!cfg) {
    throw new TaxbillResendError(503, 'TAXBILL_POPBILL_GATE_OFF', '팝빌 연동이 꺼져 있어 계산서 메일을 보낼 수 없습니다.');
  }

  // 계정 축은 **발행 때 쓴 것과 같아야 한다** — 발행 패스는 `billings.user_id`(ISSUE_ROW_SQL의 billing_user_id)로
  // 수신자를 해석하고, 거기서 **NULL은 "회사 단위 장"이라는 유효한 값**이다(계정 미상이 아니다).
  // ★ Codex 2R high 수용 — 그래서 COALESCE로 다른 축을 끌어오면 안 된다. 회사 단위로 발행한 계산서가
  //   추적행의 계정 담당자에게 재발송된다. 정산 행의 유무와 `user_id`가 NULL인 것은 다른 사실이라 나눠 읽는다.
  const r = await pool.query(
    `SELECT t.status, t.invoicer_mgt_key, t.company_id,
            (b.id IS NOT NULL) AS billing_exists, b.user_id AS billing_user_id
       FROM taxbill_issues t
       LEFT JOIN billings b ON b.id = t.billing_id
      WHERE t.id = $1::uuid`,
    [opts.issueId],
  );
  if (r.rows.length === 0) {
    throw new TaxbillResendError(404, 'TAXBILL_ISSUE_NOT_FOUND', '세금계산서 내역을 찾을 수 없습니다.');
  }
  const row = r.rows[0];
  if (String(row.status) !== 'issued') {
    throw new TaxbillResendError(422, 'TAXBILL_NOT_ISSUED',
      `발행이 끝난 계산서만 메일을 다시 보낼 수 있습니다. (현재 상태: ${String(row.status)})`);
  }
  const mgtKey = String(row.invoicer_mgt_key || '').trim();
  if (!mgtKey) {
    throw new TaxbillResendError(422, 'TAXBILL_NO_MGT_KEY', '팝빌 문서번호가 없어 메일을 보낼 수 없습니다.');
  }

  const override = String(opts.email || '').trim();
  let targets: string[];
  if (override) {
    // 임의 주소로 재무 문서가 나가는 자리라 형식을 느슨하게 보지 않는다(Codex 1R high 부분 수용).
    if (!/^[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}$/.test(override)) {
      throw new TaxbillResendError(400, 'TAXBILL_RESEND_BAD_EMAIL', '받는 사람 이메일 형식이 올바르지 않습니다.');
    }
    targets = [override];
  } else {
    // ★ Codex 2R high 수용 — 정산 행이 사라진 계산서(FK SET NULL)는 **발행 당시 계정 축을 알 방법이 없다.**
    //   추적행도 `billing_id` CASCADE로 함께 지워지므로 물러설 축 자체가 없다. 아무 축이나 골라 보내는 대신
    //   받는 사람을 직접 지정하게 한다 — 국세청 문서 통지를 추측으로 보내지 않는다.
    if (!row.billing_exists) {
      throw new TaxbillResendError(422, 'TAXBILL_RESEND_BILLING_GONE',
        '이 계산서의 정산 내역이 삭제돼 받는 사람을 확정할 수 없습니다. 받는 사람 이메일을 직접 지정해 주세요.');
    }
    // 대표 + 참조. 참조 선별은 발행 직후 재전송과 **같은 순수 함수**를 쓴다(대표 중복·형식 불량 제거).
    const to = await resolveBillingRecipients(
      String(row.company_id),
      row.billing_user_id ? String(row.billing_user_id) : null,
      'taxbill',
    );
    const primary = String(to.primary?.email || '').trim();
    targets = [...(primary.includes('@') ? [primary] : []), ...selectTaxbillResendTargets(to)]
      .slice(0, TAXBILL_RESEND_MAX_TARGETS);
  }
  if (targets.length === 0) {
    throw new TaxbillResendError(422, 'TAXBILL_RESEND_NO_RECIPIENT',
      '세금계산서 수신자가 등록돼 있지 않습니다. 고객사 정산 설정에서 수신자를 먼저 등록해 주세요.');
  }

  const svc = getService(cfg);
  const sent: string[] = [];
  const failed: { email: string; error: string }[] = [];
  for (const t of targets) {
    try {
      await sendEmailAsync(svc, cfg.corpNum, mgtKey, t, cfg.userId);
      sent.push(t);
    } catch (err: any) {
      failed.push({ email: t, error: String(err?.message || err).slice(0, 300) });
    }
  }
  // 누가·어디로 보냈는지 남긴다 — 국세청 문서 관련 행위이고, 임의 주소 override가 가능한 경로다.
  log(`발행분 메일 재발송 — key=${mgtKey} by=${opts.adminId || '미상'} to=${targets.join(',')}`
    + `${override ? ' (직접 지정)' : ' (등록 수신자)'} 성공 ${sent.length} / 실패 ${failed.length}`);
  if (sent.length === 0) {
    // 전 주소 실패 = 우리 입력이 아니라 **바깥**이 문제다(팝빌 SDK·네트워크). 502로 올려 알림·재시도 판단에 걸리게 한다.
    throw new TaxbillResendError(502, 'TAXBILL_RESEND_ALL_FAILED',
      `계산서 메일 재발송에 실패했습니다: ${failed.map((f) => `${f.email}(${f.error})`).join(', ')}`);
  }
  return { mgtKey, sent, failed };
}
