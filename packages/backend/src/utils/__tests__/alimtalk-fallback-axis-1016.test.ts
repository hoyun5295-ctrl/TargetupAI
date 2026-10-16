/**
 * 알림톡 실패 → 문자 대체 = 판정 한 곳 · 청구 유형 · 표시명 (★2026-10-16 B-1016-1 · 서수란 접수 cmvaear5e1hyajnn445hdnx59)
 *
 * 같은 부류 세 번째 접수다(B-1003-1 청구 단가 → 1007 캠페인 목록 → 이번 통계 엑셀·정산서 표기).
 * 매번 표면 하나만 고쳐진 이유 = 「대체」 판정이 다섯 군데에 따로 있었다. 설계 = docs/2026-10-16-alimtalk-fallback-axis-design.md
 *   ① 판정 = sms-result-map `fallbackOf` 하나 · ② 청구 유형 SMS_FB·LMS_FB(단가·무료는 상속원) · ③ 표시명 = 축 하나 · ④ 이 파일.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  fallbackOf, tallyAlimtalkFallback, getSendTypeLabel,
  FALLBACK_BILLING_CODE_WHEN_SQL, SMS_SUB_ROW_SQL, SUBSTITUTE_ROW_SQL,
} from '../sms-result-map';
import {
  BILLING_TYPES, FALLBACK_BILLING_CODE, billingBaseType, foldInheritedTotals, testBillingTypeKey,
} from '../billing-types';
import {
  BILLING_MSG_TYPE_SQL, MSG_TYPE_TO_USAGE_KEY, agentUsageKey, resolveBillingUnitPricesDetailed,
} from '../send-usage-aggregation';
import { allocateFreeToRows, freeQuotaKey } from '../free-messaging';
import { billingTypeLabel, billingDetailTypeLabel, buildInvoiceLines } from '../billing-invoice-lines';
import { agentTypeLabel } from '../pay-stats';
import { resolveAdjustmentTypeKey, adjustmentLineType, buildAdjustmentBillingItems, findNegativeAdjustedTypes } from '../billing-qty-adjust';

const SRC = join(__dirname, '..', '..');
const src = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
/** 주석 줄을 뺀 코드 줄만 — 설명 주석에 숫자가 남는 것은 판정이 아니다 */
const codeOnly = (text: string) => text.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if (statSync(p).isDirectory()) return n === '__tests__' ? [] : walk(p);
  return /\.ts$/.test(n) && !/\.(test|verify)\.ts$/.test(n) ? [p] : [];
});

/** 한 행의 대체 청구 유형키 — 청구 식(FALLBACK_BILLING_CODE_WHEN_SQL)과 같은 규칙의 JS 판 */
const billingKeyOf = (msgType: string, kOriseq: any, code: number) => {
  const fb = fallbackOf(msgType, kOriseq, code);
  return fb ? MSG_TYPE_TO_USAGE_KEY[FALLBACK_BILLING_CODE[fb]] : null;
};

describe('① 판정 한 곳 · 같은 행 = 같은 분류', () => {
  // [msg_type, k_oriseq, status_code, 기대 대체 유형]
  const FIXTURES: Array<[string, any, number, 'S' | 'L' | null, string]> = [
    ['K', null, 7831, 'L', '비토 라인 K행 LMS 대체 성공(이번 접수 모양)'],
    ['K', null, 7830, 'S', '비토 라인 K행 SMS 대체 성공'],
    ['K', null, 7300, null, '옛 라인 알림톡 실패 행 자체'],
    ['L', 361669, 1000, 'L', '옛 라인 대체 LMS 성공 행'],
    ['L', '361669', 3000, 'L', '옛 라인 대체 LMS 실패 행(문자열 k_oriseq)'],
    ['S', 361669, 6, 'S', '옛 라인 대체 SMS 성공 행'],
    ['K', null, 1800, null, '알림톡 성공'],
    ['L', null, 1000, null, '일반 LMS'],
    ['L', 0, 1000, null, 'k_oriseq 0'],
    ['L', null, 7831, null, 'K가 아닌 행의 7831'],
    ['F', null, 7831, null, '브랜드 F 행(범위 밖 · B-1003-1 추가 과제)'],
  ];

  it.each(FIXTURES)('%s + %s + %s → %s (%s)', (mt, ori, code, want) => {
    expect(fallbackOf(mt, ori, code)).toBe(want);
    expect(billingKeyOf(mt, ori, code)).toBe(want === 'L' ? 'LMS_FB' : want === 'S' ? 'SMS_FB' : null);
    if (want) expect(getSendTypeLabel(mt, ori, code)).toBe(want === 'L' ? '대체 LMS' : '대체 SMS');
  });

  it('비토 모양과 옛 모양이 같은 숫자를 낸다 = 알림톡 시도 1 실패 1 + 대체 LMS 1 성공(접수 ① 기대값)', () => {
    const bito = tallyAlimtalkFallback([{ msg_type: 'K', k_oriseq: null, status_code: 7831, cnt: 1 }]);
    const old = tallyAlimtalkFallback([
      { msg_type: 'K', k_oriseq: null, status_code: 7300, cnt: 1 },
      { msg_type: 'L', k_oriseq: 1, status_code: 1000, cnt: 1 },
    ]);
    for (const r of [bito, old]) {
      expect({ total: r.total, success: r.success, fail: r.fail, pending: r.pending }).toEqual({ total: 1, success: 0, fail: 1, pending: 0 });
      expect(r.fallback.LMS).toEqual({ total: 1, success: 1, fail: 0, pending: 0 });
      expect(r.fallback.SMS.total).toBe(0);
    }
  });

  it('청구 식의 대체 분기 = 두 모양 → KS·KL (브랜드 F 분기 뒤 · ELSE 앞)', () => {
    expect(FALLBACK_BILLING_CODE).toEqual({ S: 'KS', L: 'KL' });
    expect(FALLBACK_BILLING_CODE_WHEN_SQL).toBe(
      "WHEN msg_type = 'K' AND status_code = 7830 THEN 'KS' "
      + "WHEN msg_type = 'K' AND status_code = 7831 THEN 'KL' "
      + `WHEN msg_type = 'S' AND ${SMS_SUB_ROW_SQL} THEN 'KS' `
      + `WHEN msg_type = 'L' AND ${SMS_SUB_ROW_SQL} THEN 'KL'`,
    );
    expect(BILLING_MSG_TYPE_SQL.endsWith(`${FALLBACK_BILLING_CODE_WHEN_SQL} ELSE msg_type END`)).toBe(true);
    expect(BILLING_MSG_TYPE_SQL.indexOf(FALLBACK_BILLING_CODE_WHEN_SQL)).toBeGreaterThan(BILLING_MSG_TYPE_SQL.indexOf("ELSE 'FN' END)"));
  });

  it('발송결과 「대체발송」 필터 조각은 문자열 그대로다', () => {
    expect(SUBSTITUTE_ROW_SQL).toBe(
      "((k_oriseq > 0 AND msg_type IN ('L', 'S')) OR (msg_type = 'K' AND status_code IN (7830, 7831)))",
    );
  });
});

describe('② 청구 유형 SMS_FB·LMS_FB', () => {
  const lmsFb = BILLING_TYPES.find((t) => t.key === 'LMS_FB')!;
  const smsFb = BILLING_TYPES.find((t) => t.key === 'SMS_FB')!;

  it('웹 집계 코드와 에이전트 코드가 같다 · 단가 칸은 상속원 칸 · 회사 단가 칸 없음', () => {
    expect(lmsFb).toMatchObject({ label: 'LMS(대체발송)', shortLabel: 'LMS(대체)', smsqCode: 'KL', agentCode: 'KL', agentPriceColumn: 'cost_per_lms', companyPriceColumn: null, inheritFrom: 'LMS' });
    expect(smsFb).toMatchObject({ label: 'SMS(대체발송)', shortLabel: 'SMS(대체)', smsqCode: 'KS', agentCode: 'KS', agentPriceColumn: 'cost_per_sms', companyPriceColumn: null, inheritFrom: 'SMS' });
    expect(MSG_TYPE_TO_USAGE_KEY.KL).toBe('LMS_FB');
    expect(agentUsageKey('kl')).toBe('LMS_FB');
    expect(agentUsageKey('KS')).toBe('SMS_FB');
    expect(BILLING_TYPES.some((t) => 'agentCodeAliases' in t)).toBe(false);
  });

  it('청구서 인쇄 순서 = 카카오알림톡 바로 뒤', () => {
    const keys = BILLING_TYPES.map((t) => t.key);
    expect(keys.slice(keys.indexOf('KAKAO'), keys.indexOf('KAKAO') + 3)).toEqual(['KAKAO', 'SMS_FB', 'LMS_FB']);
  });

  it('상속원 = 단가·미설정이 따라간다 · 모든 유형키 단가가 유한하다', () => {
    const co = { cost_per_sms: 9.9, cost_per_lms: 22.7, cost_per_mms: 60, cost_per_kakao: 6, cost_per_brand: 15, unit_price_basis: 'supply' };
    const { prices, unsetKeys } = resolveBillingUnitPricesDetailed(co);
    for (const t of BILLING_TYPES) expect(Number.isFinite(prices[t.key]), t.key).toBe(true);
    expect(prices.LMS_FB).toBe(prices.LMS);
    expect(prices.SMS_FB).toBe(prices.SMS);
    expect(unsetKeys).not.toContain('LMS_FB');
    const unsetLms = resolveBillingUnitPricesDetailed({ ...co, cost_per_lms: null });
    expect(unsetLms.unsetKeys).toEqual(expect.arrayContaining(['LMS', 'LMS_FB']));
    expect(unsetLms.unsetKeys).not.toContain('SMS_FB');
  });

  it('상속원 접기 = 헤더·미리보기가 종전 값(대체 포함 LMS)을 유지한다', () => {
    expect(billingBaseType('LMS_FB')).toBe('LMS');
    expect(billingBaseType('LMS')).toBe('LMS');
    expect(billingBaseType('KAKAO')).toBe('KAKAO');
    const folded = foldInheritedTotals({ SMS: 1, LMS: 3, LMS_FB: 2, SMS_FB: 4, KAKAO: 5 });
    expect(folded).toMatchObject({ SMS: 5, LMS: 5, KAKAO: 5 });
    expect('LMS_FB' in folded).toBe(false);
  });

  it('테스트 축 = KS → 테스트 SMS · KL → 테스트 LMS', () => {
    expect(testBillingTypeKey('KS')).toBe('TEST_SMS');
    expect(testBillingTypeKey('KL')).toBe('TEST_LMS');
    expect(testBillingTypeKey('S')).toBe('TEST_SMS');
  });

  it('무료 LMS 는 대체 LMS 도 덮는다(현행 유지) · 합 10', () => {
    const month = '2026-10-01';
    const rows = [
      { channel: 'web', typeKey: 'LMS', itemDate: '2026-10-13', userId: 'a', success: 5 },
      { channel: 'web', typeKey: 'LMS_FB', itemDate: '2026-10-13', userId: 'a', success: 5 },
    ];
    const alloc = allocateFreeToRows(rows, { [freeQuotaKey(month, 'LMS')]: 10 });
    expect(Array.from(alloc.values()).reduce((s, v) => s + v, 0)).toBe(10);
  });

  it('계정별 공제가 종전(LMS 한 줄)과 같다 = 일자 → 상속원 → 계정 → 유형 순서', () => {
    const month = '2026-10-01';
    const a1 = { channel: 'web', typeKey: 'LMS', itemDate: '2026-10-13', userId: 'a', success: 3 };
    const a2 = { channel: 'web', typeKey: 'LMS_FB', itemDate: '2026-10-13', userId: 'a', success: 2 };
    const b1 = { channel: 'web', typeKey: 'LMS', itemDate: '2026-10-13', userId: 'b', success: 5 };
    const alloc = allocateFreeToRows([b1, a2, a1], { [freeQuotaKey(month, 'LMS')]: 6 });
    // 종전: 계정 a 의 LMS 한 줄(5건)이 먼저 5 · 계정 b 가 나머지 1
    expect((alloc.get(a1) || 0) + (alloc.get(a2) || 0)).toBe(5);
    expect(alloc.get(b1) || 0).toBe(1);
  });

  it('무료 사용량 조회도 같은 상속원으로 묶는다(중간정산 이중 공제 차단)', () => {
    const free = codeOnly(src('utils/free-messaging.ts'));
    expect(free).not.toContain('AND bi.message_type = g.msg_type');
    expect(free).toContain('billingBaseTypeSql(');
  });
});

describe('③ 표시명 = 축 하나', () => {
  it('긴 이름(1쪽·메일 첨부) · 짧은 이름(2쪽·모달)', () => {
    const lines = buildInvoiceLines([{ channel: 'web', message_type: 'LMS_FB', unit_price: 22.7, success_count: 1, amount: 22.7 }]);
    expect(lines[0].label).toBe('LMS(대체발송)');
    expect(lines[0].amount).toBe(22);
    expect(billingTypeLabel('LMS_FB')).toBe('LMS(대체발송)');
    expect(billingDetailTypeLabel({ channel: 'web', message_type: 'LMS_FB' })).toBe('LMS(대체)');
    expect(billingDetailTypeLabel({ channel: 'agent', message_type: 'SMS_FB' })).toBe('SMS(대체)');
    expect(billingDetailTypeLabel({ channel: 'web', message_type: 'KAKAO' })).toBe('카카오');
    expect(billingDetailTypeLabel({ channel: 'web', message_type: 'BRAND' })).toBe('브랜드메시지');
    expect(billingDetailTypeLabel({ channel: 'plan', message_type: 'PLAN_BASIC' })).toBe('BASIC');
    expect(billingDetailTypeLabel({ channel: 'extra', message_type: 'EXTRA_MANUAL', item_label: '단축 URL 제작' })).toBe('단축 URL 제작');
    expect(billingDetailTypeLabel({ channel: 'extra', message_type: 'EXTRA_080_FEE' })).toBe('080 이용료');
  });

  it('모든 유형키에 표시명이 있다(내부 키 노출 0)', () => {
    // SMS·LMS·MMS 는 키가 곧 이름이다. 그 밖의 키(KAKAO·LMS_FB·TEST_SMS…)가 그대로 찍히면 내부 키 노출이다.
    for (const t of BILLING_TYPES) {
      const plain = ['SMS', 'LMS', 'MMS'].includes(t.key);
      expect(billingTypeLabel(t.key), t.key).toBeTruthy();
      if (!plain) expect(billingTypeLabel(t.key), t.key).not.toBe(t.key);
      if (!plain) expect(billingDetailTypeLabel({ channel: 'web', message_type: t.key }), t.key).not.toBe(t.key);
    }
  });

  it('에이전트 통계 표시명도 같은 축(고객사 통계 한 열에 이름 하나)', () => {
    expect(agentTypeLabel('KL')).toBe('LMS(대체발송)');
    expect(agentTypeLabel('KS')).toBe('SMS(대체발송)');
    expect(agentTypeLabel('K')).toBe('카카오알림톡');
    expect(agentTypeLabel('X')).toBe('팩스');
  });

  it('PDF 2쪽 · 관리자 정산 모달에 유형 라벨표 사본이 없다 · 상세 응답이 type_label 을 싣는다', () => {
    const pdf = src('utils/billing-pdf.ts');
    expect(pdf).not.toMatch(/const typeLabel\s*:\s*Record/);
    expect(pdf).toContain('billingDetailTypeLabel({ ...item');
    expect(src('routes/billing.ts')).toContain('type_label: billingDetailTypeLabel(r)');
    const ui = readFileSync(join(SRC, '..', '..', 'frontend', 'src', 'pages', 'AdminDashboard.tsx'), 'utf8');
    expect(ui).not.toContain('billingTypeLabel');
    expect(ui).toContain('item.type_label || item.message_type');
  });

  it('차단 문구는 내부 유형키가 아니라 표시명이다', () => {
    const billing = codeOnly(src('routes/billing.ts'));
    expect(billing).not.toContain('webUnsetPriced.map((u) => u.key)');
    expect(billing).not.toContain('`${m.agentSendId} ${m.typeKey}`');
    const issue = codeOnly(src('utils/billing-issue.ts'));
    expect(issue).not.toMatch(/\$\{m\.agentSendId\} \$\{m\.typeKey\}/);
  });
});

describe('배포 전 「LMS」 수량 조정의 재발행(Codex 1R)', () => {
  const row = (typeKey: string, success: number, unitPrice = 22.7): any => ({
    channel: 'web', itemDate: '2026-09-29', typeKey, userId: null, agentSendId: null, agentId: null,
    total: success, success, fail: 0, pending: 0, unitPrice, amount: success * unitPrice, amountExact: success * unitPrice,
    planDays: null, planMonthDays: null, freeCount: 0,
  });
  const adj = (type_key: string, qty_delta: number): any => ({ id: 'a1', channel: 'web', type_key, qty_delta, user_id: null, agent_id: null });

  it('줄 판정: 같은 유형 → 없으면 같은 상속원 줄 하나 → 둘 이상·없음은 null', () => {
    expect(resolveAdjustmentTypeKey('LMS', ['LMS', 'LMS_FB'])).toBe('LMS');
    expect(resolveAdjustmentTypeKey('LMS', ['LMS_FB', 'KAKAO'])).toBe('LMS_FB');
    expect(resolveAdjustmentTypeKey('LMS', ['KAKAO'])).toBeNull();
    expect(resolveAdjustmentTypeKey('KAKAO', ['LMS_FB'])).toBeNull();
    expect(resolveAdjustmentTypeKey('LMS_FB', ['LMS'])).toBe('LMS');
  });

  it('대체분만 있는 기간 = 옛 LMS 조정이 LMS(대체발송) 줄에 같은 단가로 실린다(옛: 줄 없음 422)', () => {
    const items = buildAdjustmentBillingItems([adj('LMS', -1)], [row('LMS_FB', 10)], '2026-09-01');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ typeKey: 'LMS_FB', unitPrice: 22.7, success: -1 });
    expect(findNegativeAdjustedTypes([row('LMS_FB', 10), ...items])).toEqual([]);
  });

  it('일반 LMS 줄이 있으면 종전 그대로 그 줄 · 알림톡 조정이 대체 줄로 새지 않는다', () => {
    expect(buildAdjustmentBillingItems([adj('LMS', -1)], [row('LMS', 5), row('LMS_FB', 10)], '2026-09-01')[0].typeKey).toBe('LMS');
    expect(() => buildAdjustmentBillingItems([adj('KAKAO', -1)], [row('LMS_FB', 10)], '2026-09-01')).toThrow();
  });

  it('발송ID 범위까지 함수가 거른다(Codex 2R) — A 의 LMS 조정은 A 의 LMS_FB 줄 · B 의 LMS 줄로 새지 않는다', () => {
    const rows = [
      { channel: 'agent', typeKey: 'LMS_FB', agentId: 'A' },
      { channel: 'agent', typeKey: 'LMS', agentId: 'B' },
    ];
    expect(adjustmentLineType({ channel: 'agent', type_key: 'LMS', agent_id: 'A' }, rows)).toBe('LMS_FB');
    expect(adjustmentLineType({ channel: 'agent', type_key: 'LMS', agent_id: 'B' }, rows)).toBe('LMS');
    // 발송ID 없는 조정 = 채널 전부 → 같은 유형(LMS) 우선
    expect(adjustmentLineType({ channel: 'agent', type_key: 'LMS', agent_id: null }, rows)).toBe('LMS');
    // 실릴 줄이 없으면 null — 다른 발송ID 의 같은 유형 줄로 새지 않는다(Codex 3R: A/KAKAO · B/LMS 에 A/LMS 조정)
    expect(adjustmentLineType({ channel: 'agent', type_key: 'LMS', agent_id: 'A' }, [
      { channel: 'agent', typeKey: 'KAKAO', agentId: 'A' }, { channel: 'agent', typeKey: 'LMS', agentId: 'B' },
    ])).toBeNull();
  });

  it('조정 화면 원래 수량 · 재발행 사전 검사가 발행과 같은 함수를 쓴다(범위 거르기를 소비처가 따로 하지 않는다)', () => {
    const billing = codeOnly(src('routes/billing.ts'));
    expect(billing).toContain('const lineType = adjustmentLineType(a, lineCandidates);');
    expect(billing).toContain('if (!lineType) continue;');
    expect(billing).not.toContain('adjustmentLineType(a, lineCandidates) ||');
    expect(billing).toContain('const lineType = adjustmentLineType(a, agg.rows.map((g: any) => ({ channel: String(g.channel), typeKey: String(g.message_type), agentId: g.agent_id })));');
    expect(billing).not.toContain('resolveAdjustmentTypeKey(');
    expect(codeOnly(src('utils/billing-qty-adjust.ts'))).toContain('const lineType = adjustmentLineType(r, ');
  });
});

describe('④ 소스 고정핀', () => {
  it('대체 판정 숫자(7830·7831)와 k_oriseq 판정식은 sms-result-map 안에만 있다', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      if (f.endsWith(join('utils', 'sms-result-map.ts'))) continue;
      const code = codeOnly(readFileSync(f, 'utf8'));
      if (/status_code\s*(=|IN)\s*\(?\s*783[01]/.test(code) || /k_oriseq\s*>\s*0/.test(code)) offenders.push(f.slice(SRC.length + 1));
    }
    expect(offenders).toEqual([]);
  });

  it('슈퍼관리자 통계 엑셀 = 상한 없는 대체 집계(목록용 4초 상한 함수 금지) · 옛 채널 분리 함수 삭제', () => {
    const admin = src('routes/admin.ts');
    const at = admin.indexOf("router.get('/stats/export'");
    const block = codeOnly(admin.slice(at, admin.indexOf('router.', at + 30)));
    expect(block).toContain('aggregateAlimtalkFallbackByCampaign(');
    expect(block).not.toContain('loadAlimtalkFallbackForList');
    expect(block).not.toContain("'알림톡대체발송(");
    const map = src('utils/sms-result-map.ts');
    for (const gone of ['export function classifyMsgChannel', 'export function tallySmsChannelCounts', 'export function alimtalkFallbackMsgType', 'ALIMTALK_FALLBACK_TYPE_WHEN_SQL']) {
      expect(map).not.toContain(gone);
    }
    expect(codeOnly(src('utils/stats-aggregation.ts'))).not.toContain('export async function aggregateSmsChannelSplitByCampaign');
  });

  it('헤더 금액 항등식은 유형 표에서 파생한다(손 나열이면 새 유형이 422)', () => {
    const issue = codeOnly(src('utils/billing-issue.ts'));
    expect(issue).not.toContain('(totalSms * prices.SMS)');
    expect(issue).toContain('BILLING_TYPES.reduce(');
  });
});
