/**
 * billing-invoice-lines.ts — 청구서 항목 줄 생성 컨트롤타워 (★ 2026-07-26 신설)
 *
 * 신설 사유: 청구서 1페이지 항목표가 `billings` **헤더 컬럼**에서 그려지고 있었다.
 *   헤더에는 SMS/LMS/MMS/카카오/테스트/스팸/AI크레딧 칸만 있고 **에이전트 칸이 없다.**
 *   그런데 공급가액(`subtotal`)에는 에이전트 금액이 더해진다 —
 *   결과적으로 **항목을 세로로 더한 값 ≠ 공급가액**이고, 2페이지 상세 합계와도 갈렸다.
 *   코드 주석은 "1페이지는 billing_items에서 채널별로 집계한다"고 적혀 있는데 PDF는 그렇게 하지 않았다.
 *
 * 그래서 항목 줄을 `billing_items`에서 만들고 PDF·이메일·화면이 **같은 함수**를 쓴다.
 * 복사하면 언젠가 갈라진다 — 이 파일이 생긴 이유가 바로 그 갈라짐이다.
 *
 * ★ 그룹키에 **단가를 넣는다.** 에이전트는 발송ID별로 단가가 다르므로(채널·유형)으로만 묶으면
 *   한 줄에 여러 단가가 섞여 단가 칸이 거짓말을 한다.
 */

import { shiftDayKey } from './plan-proration';
import { BILLING_TYPES } from './billing-types';
import { floorWon } from './money';

/** 청구서 항목 한 줄 */
export interface InvoiceLine {
  channel: string;
  typeKey: string;
  /** 요금제 줄의 구간 시작일(YYYY-MM-DD). 발송 줄은 없다 — 일자 축으로 합쳐지기 때문이다 */
  itemDate?: string;
  /** 사람이 읽는 항목명 — 채널을 접두로 붙여 웹/에이전트가 구분된다 */
  label: string;
  unitPrice: number;
  /** 청구 수량 = 성공 건수. 요금제 줄은 0(수량 축이 없다) */
  count: number;
  amount: number;
  /**
   * 수량 칸에 대신 쓸 문구. 요금제는 `9일 / 31일` 형태다 —
   * 없으면 청구서가 `0건 × ₩350,000 = ₩101,613`이라는 거짓 산식을 인쇄한다.
   */
  quantityText?: string;
  /** 요금제 줄의 일할 구간 일수 / 그 달 일수. 화면이 산식을 다시 검산할 때 쓴다 */
  planDays?: number;
  planMonthDays?: number;
}

const CHANNEL_LABEL: Record<string, string> = {
  web: '', agent: '에이전트 ', test: '', spam: '', extra: '',
};

/**
 * 항목명 — 유형 축(`billing-types.ts`)의 표시명을 그대로 쓰고, **이 문서에서만 다른 문구만** 덮어쓴다.
 *
 * ★ 2026-07-29 그 전에는 여기에 유형 목록이 통째로 복제돼 있었다(순서 배열까지 둘째 복제).
 *   유형을 늘릴 때 이 파일을 잊으면 청구서에서 그 줄의 항목명이 비고 정렬이 맨 뒤로 밀린다.
 *   축에서 파생하면 잊을 수가 없다. 스팸 문구만 인쇄물 유지를 위해 예외로 남긴다.
 */
const TYPE_LABEL: Record<string, string> = {
  ...Object.fromEntries(BILLING_TYPES.map((t) => [t.key, t.label])),
  SPAM_SMS: '스팸필터 SMS', SPAM_LMS: '스팸필터 LMS',
  // ★ 2026-07-30 080 청구(billing_extra_items — 서수란 접수). 내부 키(EXTRA_*)는 고객에게 보일 값이 아니다.
  EXTRA_080_FEE: '080 번호 이용료', EXTRA_080_SVC: '080 부가서비스', EXTRA_080_CALL: '080 통화료',
};

const CHANNEL_ORDER = ['plan', 'web', 'agent', 'test', 'spam', 'extra'];
const TYPE_ORDER = BILLING_TYPES.map((t) => t.key);

/**
 * 항목명.
 *
 * ★ 2026-07-26 요금제 줄에는 **적용 구간을 붙인다**(Codex 3차 MEDIUM).
 *   6월분·7월분처럼 같은 플랜이 두 구간으로 나오면(일할 분모가 달마다 달라 반드시 나뉜다)
 *   이름이 같아서 어느 줄이 어느 달인지 알 수 없고, 고객이 일할 금액을 검산할 수 없다.
 */
export function invoiceLineLabel(channel: string, typeKey: string, period?: { from: string; days: number }): string {
  // 요금제 행은 `PLAN_<플랜코드>`로 들어온다.
  if (channel === 'plan') {
    const code = String(typeKey || '').replace(/^PLAN_/, '');
    const base = code ? `요금제 ${code}` : '요금제';
    if (period && period.from && period.days > 0) {
      const to = shiftDayKey(period.from, period.days - 1);
      return `${base} (${period.from.slice(5, 10)}~${to.slice(5, 10)})`;
    }
    return base;
  }
  const ch = CHANNEL_LABEL[channel] ?? `${channel} `;
  const ty = TYPE_LABEL[typeKey] || typeKey;
  return `${ch}${ty}`;
}

/**
 * (순수) `billing_items` 행 → 청구서 항목 줄.
 * 수량 0인 줄은 만들지 않는다 — 청구서에 0건 항목이 늘어서면 읽기 어렵다.
 */
export function buildInvoiceLines(items: any[]): InvoiceLine[] {
  const acc = new Map<string, InvoiceLine>();
  for (const it of items || []) {
    const channel = String(it?.channel || 'web');
    const typeKey = String(it?.message_type || '');
    const unitPrice = Number(it?.unit_price) || 0;
    const count = Number(it?.success_count) || 0;
    const amount = Number(it?.amount) || 0;
    if (count <= 0 && amount === 0) continue;

    // ★ 2026-07-26 요금제 줄은 **구간마다 한 줄**이다(Codex 3차 MEDIUM 수용).
    //   그 전에는 (채널·유형·단가)만으로 묶어서, 같은 플랜의 6월분 22일치와 7월분 9일치가 한 줄로 합쳐졌고
    //   수량 문구는 **먼저 온 구간 것만** 남았다. 금액은 두 구간 합인데 문구는 한 구간이라
    //   "22일 / 30일"이라고 적힌 줄에 다음 달 요금이 함께 들어가는 거짓 산식이 된다.
    //   일할 분모가 달마다 달라서 애초에 합칠 수 있는 줄이 아니다.
    //   발송 줄은 일자 축으로 합치는 게 맞으므로 이 조각이 빈 문자열이다.
    const planKeyPart = channel === 'plan' ? String(it?.item_date ?? '').slice(0, 10) : '';
    const key = `${channel}\u0000${typeKey}\u0000${unitPrice}\u0000${planKeyPart}`;
    if (!acc.has(key)) {
      const seed: InvoiceLine = { channel, typeKey, label: invoiceLineLabel(channel, typeKey), unitPrice, count: 0, amount: 0 };
      if (channel === 'plan') {
        // ★ 2026-07-26 일수를 **전용 컬럼**에서 읽는다(`billing_items.plan_days`·`plan_month_days`).
        //   그 전에는 발송 수량 컬럼(total_count·fail_count)에 실려서, 같은 컬럼이 채널에 따라 다른 뜻이 되고
        //   PDF 2페이지 '전송'·'실패' 열과 상세 모달 합계에 9·31이 발송 건수처럼 더해졌다(Codex 3차 HIGH).
        const days = Number(it?.plan_days) || 0;
        const monthDays = Number(it?.plan_month_days) || 0;
        seed.itemDate = planKeyPart;
        seed.planDays = days;
        seed.planMonthDays = monthDays;
        seed.label = invoiceLineLabel(channel, typeKey, { from: planKeyPart, days });
        seed.quantityText = monthDays > 0 ? `${days}일 / ${monthDays}일` : `${days}일`;
      }
      acc.set(key, seed);
    }
    const line = acc.get(key)!;
    // ★ 2026-07-30 extra(080 등 월별 항목)는 발송 수량 축이 없어 success_count가 0이다(2페이지 오염 차단 —
    //   요금제와 같은 이유). 항목줄 수량은 **합쳐진 항목 수**로 센다 — 같은 단가 그룹만 합쳐지므로
    //   "2건 × ₩9,000 = ₩18,000"이 참 산식이 된다. 0으로 두면 "0건 × ₩9,000 = ₩18,000" 거짓 산식이 인쇄된다.
    line.count += channel === 'extra' ? 1 : count;
    line.amount += amount;
  }

  const chOrder = (c: string) => {
    const i = CHANNEL_ORDER.indexOf(c);
    return i === -1 ? 99 : i;
  };
  const tyOrder = (t: string) => {
    const i = TYPE_ORDER.indexOf(t);
    return i === -1 ? 99 : i;
  };

  return Array.from(acc.values()).sort((a, b) => {
    if (a.channel !== b.channel) return chOrder(a.channel) - chOrder(b.channel);
    const t = tyOrder(a.typeKey) - tyOrder(b.typeKey);
    if (t !== 0) return t;
    if (a.typeKey !== b.typeKey) return a.typeKey.localeCompare(b.typeKey);
    if (a.unitPrice !== b.unitPrice) return a.unitPrice - b.unitPrice;
    // 요금제는 같은 플랜·같은 단가로 여러 구간이 나온다 — 구간 시작일로 순서를 고정한다(D150-4 계열).
    return String(a.itemDate || '').localeCompare(String(b.itemDate || ''));
  }).map((line) => ({
    // ★ 2026-07-30 원 미만 절사는 **여기, 항목줄에서 1회**다(Harold 정정 — 0726 지시의 원뜻은
    //   "최종 청구 금액의 소수점만 버려라"였는데 일자행마다 절사해 항목표가 수량×단가와 수십 원씩
    //   어긋났다. 서수란 0729 접수). 일자행(billing_items.amount)은 정확값이고, 같은 단가 그룹은
    //   Σ(일자수량×단가) = 총수량×단가라 이 절사값이 정확히 floor(수량×단가)다.
    //   요금제 줄은 구간 단위로 이미 정수라 여기 절사는 무해(멱등)하다.
    ...line,
    amount: floorWon(line.amount),
  }));
}

/**
 * (순수) 발행 시점의 메모리 항목(PricedBillingItem 모양) → `buildInvoiceLines` 입력 행.
 * 발행(billing-issue)과 표시(PDF·메일·화면)가 **같은 그룹핑·같은 절사**를 쓰게 하는 어댑터다 —
 * 헤더 공급가액이 항목줄 절사 합에서 파생되므로, 그룹핑 코드가 둘이면 언젠가 1원이 갈라진다.
 */
export function invoiceRowFromPricedItem(it: {
  channel: string;
  typeKey: string;
  itemDate?: string | null;
  unitPrice: number;
  success?: number;
  amount: number;
  planDays?: number | null;
  planMonthDays?: number | null;
}): any {
  return {
    channel: it.channel,
    message_type: it.typeKey,
    item_date: it.itemDate ?? null,
    unit_price: it.unitPrice,
    success_count: Number(it.success) || 0,
    amount: it.amount,
    plan_days: it.planDays ?? null,
    plan_month_days: it.planMonthDays ?? null,
  };
}

/** (순수) 항목 묶음의 청구 합 = 절사된 항목줄들의 정수 합. 헤더·장 공급가액이 이 값에서 파생된다. */
export function sumFlooredInvoiceLines(items: Array<Parameters<typeof invoiceRowFromPricedItem>[0]>): number {
  return buildInvoiceLines(items.map(invoiceRowFromPricedItem)).reduce((s, l) => s + (Number(l.amount) || 0), 0);
}

export interface InvoiceLineCheck {
  ok: boolean;
  linesSum: number;
  aiCreditSupply: number;
  subtotal: number;
  diff: number;
}

/**
 * (순수) 항목 줄 합 + AI 크레딧 = 헤더 공급가액.
 *
 * PDF·이메일이 고객에게 나가기 **전에** 검사한다. 이메일은 회수가 안 된다.
 * 기존 발행분도 통과해야 하므로 AI 크레딧은 반드시 더한다 —
 * 크레딧은 발송이 아니라 `billing_items` 행이 없다.
 */
export function checkInvoiceLinesAgainstHeader(
  lines: InvoiceLine[],
  aiCreditSupply: number,
  subtotal: number,
): InvoiceLineCheck {
  const linesSum = (lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const credit = Number(aiCreditSupply) || 0;
  const sub = Number(subtotal) || 0;
  const diff = linesSum + credit - sub;
  return { ok: Math.abs(diff) < 0.005, linesSum, aiCreditSupply: credit, subtotal: sub, diff };
}
