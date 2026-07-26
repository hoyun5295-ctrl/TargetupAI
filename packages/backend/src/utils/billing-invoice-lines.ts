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
  web: '', agent: '에이전트 ', test: '', spam: '',
};

const TYPE_LABEL: Record<string, string> = {
  SMS: 'SMS', LMS: 'LMS', MMS: 'MMS', KAKAO: '카카오알림톡',
  TEST_SMS: '테스트 SMS', TEST_LMS: '테스트 LMS',
  SPAM_SMS: '스팸필터 SMS', SPAM_LMS: '스팸필터 LMS',
};

const CHANNEL_ORDER = ['plan', 'web', 'agent', 'test', 'spam'];
const TYPE_ORDER = ['SMS', 'LMS', 'MMS', 'KAKAO', 'TEST_SMS', 'TEST_LMS', 'SPAM_SMS', 'SPAM_LMS'];

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
    line.count += count;
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
  });
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
