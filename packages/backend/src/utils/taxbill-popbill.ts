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

  const payload: any = {
    writeDate: toWriteDate(input.issueDate),
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

async function markFailed(id: string, error: string): Promise<void> {
  await pool.query(`UPDATE taxbill_issues SET status = 'failed', error = $2 WHERE id = $1`, [id, error]);
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
    const mgtKey = String(row.invoicer_mgt_key || '').trim() || buildInvoicerMgtKey(issueDate, id);
    if (!row.invoicer_mgt_key) {
      await pool.query(`UPDATE taxbill_issues SET invoicer_mgt_key = $2 WHERE id = $1`, [id, mgtKey]);
    }

    const month = Number(String(row.billing_end).slice(5, 7));
    const payload = buildTaxinvoicePayload({
      issueDate,
      supplyAmount: supply,
      taxAmount: tax,
      totalAmount: total,
      party,
      invoiceeEmail: row.recipient_email ?? null,
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
      // ★ 발행 사실은 두 테이블이 함께 알아야 한다(0730 Codex 지적 ④ 수용) — 장부(taxbill_issues)만
      //   issued로 바꾸면 공개 컨펌 페이지(invoice_confirmations 축)가 발행 후에도 이의신청을 받는다.
      //   한 트랜잭션으로 컨펌 행의 taxbill_status·issued_at·popbill_invoice_key까지 동기화한다.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE taxbill_issues
              SET status = 'issued', issued_at = NOW(), error = NULL,
                  nts_confirm_num = COALESCE($2, nts_confirm_num)
            WHERE id = $1`,
          [id, ntsNum],
        );
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
    const claimed = await pool.query(
      `UPDATE taxbill_issues SET status = 'submitted'
        WHERE id IN (
          SELECT id FROM taxbill_issues
           WHERE status IN ('ready', 'submitted')
           ORDER BY created_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, kind, modify_code, org_nts_confirm_num, total_amount`,
      [limit],
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
