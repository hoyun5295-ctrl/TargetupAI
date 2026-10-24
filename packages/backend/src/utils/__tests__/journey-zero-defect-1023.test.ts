/**
 * 여정 결함 0 (★ 2026-10-23 Harold 「결함이 더 안 나와야 할 거 아냐 · 없애라」)
 *
 * 구조체크 결함 17 을 닫고, 같은 사실을 두 곳에서 다시 조립하면 실패하는 짝 시험을 둔다.
 *   1. 문안 = journey-message-render 한 곳(실행기 · 미리보기 · 켜기 검사 · 발송 2시간 전 재검사)
 *   2. 대상 조건 칸 = journey-condition-fields 표 한 곳(추출 · 검증 · 사람 말 · AI 메뉴) + 성별 · 생일 달
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn() }));
vi.mock('../messageUtils', async (orig) => ({
  ...(await orig<typeof import('../messageUtils')>()),
  prepareFieldMappings: vi.fn(async () => ({ 고객명: { column: 'name', type: 'string', description: '이름', sample: '홍길동' } })),
  getOpt080Number: vi.fn(async () => '0801234567'),
}));
vi.mock('../predictive-suite', () => ({ enrichCustomerWithPredictions: vi.fn(async (c: any) => ({ ...c, churn_risk: 0.9 })) }));
vi.mock('../connected-content', () => ({ enrichLiquidContextWithExternal: vi.fn(async () => ({})) }));
vi.mock('../cdp-events', () => ({ enrichLiquidContextWithCart: vi.fn(async () => ({})) }));

import { query } from '../../config/database';
import { renderJourneySmsMessage } from '../journey-message-render';
import { applyCustomerConditions, findCustomerConditionIssues, partitionCustomerConditions, CUSTOMER_CONDITION_FIELDS } from '../journey-target-extractor';
import { formatConditionMenuForAi, CUSTOMER_CONDITION_SPECS } from '../journey-condition-fields';
import { describeJourneyTarget } from '../journey-step-format';
import { unsupportedConditionNotices } from '../journey-ai-generator';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const SRC = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8');
/** 주석 줄을 뺀 코드(짝 시험이 설명 문장에 걸리지 않게). */
const code = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('1. 문안 = journey-message-render 한 곳', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [{ company_name: '한줄상회', brand_name: '한줄' }] });
  });

  it('실발송과 같은 조립: Liquid 회사 · 예측 점수 갈래 · 변수 · (광고)+080 · 제목 (광고)', async () => {
    const r = await renderJourneySmsMessage({
      companyId: 'c1', createdBy: 'u1', channel: 'lms', isAd: false,
      template: '{{ company.name }} %고객명%님 {% if customer.churn_risk > 0.7 %}오랜만이에요{% else %}새 소식{% endif %}',
      subject: '안부 전해요',
      customer: { id: 'k1', name: '김하나', custom_fields: {} },
    });
    expect(r.msgType).toBe('LMS');
    expect(r.isAd).toBe(true);   // 문자 칸은 저장값이 false 여도 광고(실발송과 같은 판정)
    expect(r.message).toContain('한줄상회');
    expect(r.message).toContain('김하나님');
    expect(r.message).toContain('오랜만이에요');
    expect(r.message).not.toContain('새 소식');
    expect(r.message.startsWith('(광고)')).toBe(true);
    expect(r.message).toContain('0801234567');
    expect(r.subject.startsWith('(광고)')).toBe(true);
  });

  it('표본 고객이 없으면 변수 자리는 비운다(미리보기만 대체값을 넣던 갈래 없음)', async () => {
    const r = await renderJourneySmsMessage({
      companyId: 'c1', createdBy: null, channel: 'sms', isAd: true, template: '%고객명%님 반가워요', subject: null, customer: null,
    });
    expect(r.message).not.toContain('%고객명%');
    expect(r.message).not.toContain('고객님');
    expect(r.message).toContain('님 반가워요');
  });

  it('실행기 · 미리보기 · 검사가 같은 함수를 부르고, 여정 파일에 따로 조립하는 자리가 없다', () => {
    const executor = code(read('utils/journey-executor.ts'));
    const validator = code(read('utils/journey-pretest-validator.ts'));
    const notifier = code(read('utils/journey-pretest-notifier.ts'));
    const route = code(read('routes/ai.ts'));
    expect(executor).toContain('renderJourneySmsMessage({');
    expect(validator).toContain('renderJourneySmsMessage({');
    expect(route).toMatch(/preview-message[\s\S]*?renderJourneySmsMessage\(\{/);
    expect(notifier).toContain('journeyId: b.journeyId');   // 재검사도 이 여정 표본으로
    // 여정 파일 중 렌더 CT 밖에서 조립 함수를 직접 부르는 곳 = 0 (새로 생기면 이 시험이 막는다)
    const dir = resolve(SRC, 'utils');
    const offenders = readdirSync(dir)
      .filter((f) => /^journey-.*\.ts$/.test(f) && !f.endsWith('.test.ts') && f !== 'journey-message-render.ts')
      .filter((f) => /\b(prepareSendMessage|buildAdMessage|buildAdSubject|replaceVariables)\(/.test(code(readFileSync(join(dir, f), 'utf8'))));
    expect(offenders).toEqual([]);
    expect(route).not.toMatch(/\b(buildAdMessage|buildAdSubject|replaceVariables)\(/);
  });
});

describe('2. 대상 조건 칸 = 표 한 곳 · 성별 · 생일 달', () => {
  it('성별 = 표기 변형 전부 · 다름 = NOT · 생일 달 = 두 칸(월일 · 생일)', () => {
    const params: any[] = [];
    const sql = applyCustomerConditions([{ field: 'gender', op: '==', value: '여성' }, { field: 'birth_month', op: '==', value: '3' }], 'AND', params)!;
    expect(sql).toContain('c.gender = ANY(');
    expect(sql).toContain('birth_month_day');
    expect(params[0]).toEqual(expect.arrayContaining(['F', '여', '여성', 'female']));
    expect(params[1]).toBe(3);
    const p2: any[] = [];
    expect(applyCustomerConditions([{ field: 'gender', op: '!=', value: 'M' }], 'AND', p2)).toContain('NOT (c.gender = ANY(');
    expect(applyCustomerConditions([{ field: 'gender', op: '==', value: '모름' }], 'AND', [])).toBe('FALSE');   // 모르는 값 = 닫힘
    expect(applyCustomerConditions([{ field: 'birth_month', op: '==', value: 13 }], 'AND', [])).toBe('FALSE');
  });

  it('검증: 성별 여성 · 남성만 · 생일 달 1~12', () => {
    expect(findCustomerConditionIssues([{ field: 'gender', op: '==', value: '여자' }])).toEqual([]);
    expect(findCustomerConditionIssues([{ field: 'gender', op: '==', value: 'X' }])[0].reason).toBe('bad_value');
    expect(findCustomerConditionIssues([{ field: 'birth_month', op: '==', value: 13 }])[0].reason).toBe('bad_number');
    expect(findCustomerConditionIssues([{ field: 'gender', op: '>=', value: 'F' }])[0].reason).toBe('unknown_op');
  });

  it('AI 초안의 성별은 표준 코드로 저장 · 사람 말 = 여성 · N월 · 마지막 구매 뒤 지난 날', () => {
    const { filters } = partitionCustomerConditions({ customer_conditions: [{ field: 'gender', op: '==', value: '여성' }] });
    expect(filters.customer_conditions[0].value).toBe('F');
    const t = describeJourneyTarget('custom', { customer_conditions: [
      { field: 'gender', op: '==', value: 'F' }, { field: 'birth_month', op: '==', value: 5 }, { field: 'days_since_purchase', op: '>=', value: 90 },
    ] });
    expect(t).toContain('성별 여성');
    expect(t).toContain('생일 달 5월');
    expect(t).toContain('마지막 구매 뒤 지난 날 90 이상');
    expect(t).not.toContain('알 수 없는 항목');
  });

  it('AI 메뉴 = 표의 모든 칸 · 생성 · 대화형 수정 프롬프트가 손 목록 없이 이 메뉴를 쓴다', () => {
    const menu = formatConditionMenuForAi();
    for (const k of CUSTOMER_CONDITION_FIELDS) expect(menu).toContain(`${k}:`);
    expect(CUSTOMER_CONDITION_FIELDS.length).toBe(CUSTOMER_CONDITION_SPECS.length);
    const gen = read('utils/journey-ai-generator.ts');
    const ed = read('utils/journey-ai-editor.ts');
    expect(gen).toContain('${formatConditionMenuForAi()}');
    expect(ed).toContain('${formatConditionMenuForAi()}');
    expect(gen).not.toContain('store_name(매장명), store_code(매장코드)');   // 옛 손 목록
    expect(unsupportedConditionNotices(['앱 설치 고객'])[0]).toContain('반영 안 됨');
  });
});
