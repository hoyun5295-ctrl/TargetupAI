/**
 * ★2026-10-12 직원 접수 3건 고정
 *   - 임은지 cmv4kvcwe13x5jnn4j7ypz0qm: 직접타겟발송 AI 자연어 모드가 커스텀 칸(Channel · ReservationDate)을 못 읽음
 *       → AI 변환기(CT-97)가 회사 커스텀 칸을 직접 타겟 화면과 같은 원천(CT-18)에서 읽어 프롬프트에 싣는다
 *       → 빌더가 적용하지 못하는 조건은 조용히 빼지 않고 거절한다(옛: 다른 조건과 섞이면 그 조건만 빠져 대상이 넓어짐)
 *   - 남지현 cmv4l5xkm13y8jnn4rh4yl7x2: AI 오퍼레이션 예약 완료 창 X = 결과 창만 닫혀 같은 제안을 다시 보낼 수 있었다 → X = [새 캠페인]
 *   - 남지현 cmv4kzy6m13xojnn4wp8fy1wu: AI 오퍼레이션 개별회신 예약이 안 됨 = 확인 창이 발송을 기다린 뒤 자기를 닫으며
 *       발송이 연 「회신번호 없는 고객 제외」 창까지 지웠다 → onConfirm 은 발송을 기다리지 않는다(다른 발송 창과 같은 형태)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
const aiMock = vi.fn();
vi.mock('../../services/ai', () => ({ callAIWithFallback: (...a: any[]) => aiMock(...a) }));
const payloadMock = vi.fn();
vi.mock('../enabled-fields', () => ({ buildEnabledFieldsPayload: (...a: any[]) => payloadMock(...a) }));

import { convertNaturalLanguageToFilter } from '../ai-segment-generator';
import { getFieldByKey } from '../standard-field-map';

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const CO = '00000000-0000-4000-8000-000000000001';
const field = (field_key: string, display_name: string, data_type: string, is_custom: boolean) =>
  ({ field_key, display_name, field_label: display_name, data_type, is_custom, category: is_custom ? 'custom' : 'basic', sort_order: 1 });

// 회사 실측 모양(1012 SQL): custom_1 = Channel · custom_2 = ReservationDate
const PAYLOAD = {
  fields: [
    field('name', '고객명', 'string', false),
    field('grade', '등급', 'string', false),
    field('custom_1', 'Channel', 'string', true),
    field('custom_2', 'ReservationDate', 'date', true),
    field('custom_3', 'VisitCount', 'number', true),
    field('ExternalKey', 'ExternalKey', 'string', true), // 화이트리스트 밖 JSONB 키 = 빌더가 못 거르므로 싣지 않는다
  ],
  options: { custom_1: ['네이버', '카카오', 'x'.repeat(41), '줄\n바꿈'], grade: ['VIP'] },
  sample: {},
  categories: {},
  phoneFields: [],
};

const lastSystem = () => String(aiMock.mock.calls.at(-1)?.[0]?.system || '');
const ai = (filter: any) => aiMock.mockResolvedValue(JSON.stringify({ filter, explanation: 'x' }));
const run = (text = 'Channel이 네이버인 고객') => convertNaturalLanguageToFilter({ companyId: CO, naturalLanguage: text });

describe('접수 1 · AI 자연어 모드 커스텀 칸', () => {
  beforeEach(() => {
    aiMock.mockReset();
    payloadMock.mockReset();
    payloadMock.mockResolvedValue(PAYLOAD);
  });

  it('프롬프트에 회사 커스텀 칸(맨 키 · 회사가 붙인 이름 · 형식 · 실제 값)이 실린다 · 원천은 회사 전체 범위 CT-18', async () => {
    ai({ custom_1: { operator: 'eq', value: '네이버' } });
    const r = await run();
    expect(r.filter).toEqual({ custom_1: { operator: 'eq', value: '네이버' } });
    expect(payloadMock).toHaveBeenCalledWith({ companyId: CO, scopeWhere: 'company_id = $1 AND is_active = true', scopeParams: [CO] });
    const s = lastSystem();
    expect(s).toContain('- custom_1 (Channel): type: string / operators: eq / in / contains / 실제 값 (일부만 표시): 네이버, 카카오');
    expect(s).toContain('- custom_2 (ReservationDate): type: date / operators: gte / lte / between');
    expect(s).toContain('- custom_3 (VisitCount): type: number');
    expect(s).not.toContain('ExternalKey');
    expect(s).not.toContain('x'.repeat(41)); // 긴 값은 자르지 않고 뺀다
    expect(s).not.toContain('custom_fields.'); // 빌더가 버리는 옛 형식 안내 0
  });

  it('AI에게 알려 주는 표준 칸은 전부 FIELD_MAP 키다(없는 칸 4개 제거)', async () => {
    ai({ grade: { operator: 'eq', value: 'VIP' } });
    await run('VIP 고객');
    const s = lastSystem();
    const std = s.slice(s.indexOf('[지원 표준 필드]'), s.indexOf('[지원 operator]'));
    const keys = Array.from(std.matchAll(/^- ([a-z_0-9]+) \(/gm)).map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(5);
    for (const k of keys) expect(getFieldByKey(k), k).toBeTruthy();
    for (const k of ['avg_order_value', 'ltv_score', 'is_married', 'wedding_anniversary']) expect(s).not.toContain(`- ${k} (`);
  });

  it('커스텀 날짜 · 숫자 조건은 실제 빌더로 적용된다', async () => {
    ai({ custom_2: { operator: 'gte', value: '2026-10-01' }, custom_3: { operator: 'gte', value: 3 } });
    const r = await run('10월 이후 예약 · 3회 이상 방문');
    expect(Object.keys(r.filter)).toEqual(['custom_2', 'custom_3']);
  });

  it('적용 못 하는 조건이 하나라도 있으면 조용히 빼지 않고 멈춘다(섞여 있어도)', async () => {
    ai({ grade: { operator: 'eq', value: 'VIP' }, ltv_score: { operator: 'gte', value: 80 } });
    await expect(run('VIP + LTV 80 이상')).rejects.toMatchObject({ code: 'FILTER_VALIDATION_FAILED', message: expect.stringContaining('ltv_score') });

    ai({ grade: { operator: 'eq', value: 'VIP' }, 'custom_fields.custom_1': { operator: 'eq', value: '네이버' } });
    await expect(run()).rejects.toMatchObject({ code: 'FILTER_VALIDATION_FAILED' });

    ai({ custom_1: { operator: 'eq', value: '' } });
    await expect(run()).rejects.toMatchObject({ code: 'FILTER_VALIDATION_FAILED', message: expect.stringContaining('Channel') });

    ai({ custom_2: { operator: 'date_gte', value: '2026-02-30' } });
    await expect(run()).rejects.toMatchObject({ code: 'FILTER_VALIDATION_FAILED', message: expect.stringContaining('ReservationDate') });

    ai({ custom_3: { operator: 'gte', value: '세 번' } });
    await expect(run()).rejects.toMatchObject({ code: 'FILTER_VALIDATION_FAILED', message: expect.stringContaining('VisitCount') });
  });

  it('예시 칩 4곳에 FIELD_MAP 에 없는 결혼기념일 예시가 없다', () => {
    for (const p of [
      'frontend/src/components/DirectTargetFilterModal.tsx',
      'frontend/src/components/TargetExtractModal.tsx',
      'frontend/src/pages/SegmentsPage.tsx',
      'frontend/src/components/onboarding/Step4Segment.tsx',
    ]) expect(read(p), p).not.toContain('결혼기념일이 이번 달인 고객');
  });
});

describe('접수 1 후속(Codex 1R medium) · 커스텀 칸 날짜 · 숫자 비교는 저장값을 직변환하지 않는다', () => {
  // 빈 값 · 글자 · '2026.10.12' · '1,000' 이 범위 안에 한 건만 있어도 ::date · ::numeric 이 쿼리 전체를 터뜨렸다(500)
  it('구조형 · 혼합형 두 분기 모두: 날짜 = YYYYMMDD 글자 비교 · 숫자 = 모양 확인 뒤에만 numeric', async () => {
    const { buildCustomerFilter } = await vi.importActual<typeof import('../customer-filter')>('../customer-filter');
    const structured = buildCustomerFilter({
      custom_2: { operator: 'gte', value: '2026-10-01' },
      custom_3: { operator: 'between', value: [3, 9] },
    }, { tableAlias: 'c', startParamIndex: 2, storeCodeMode: 'skip', inputFormat: 'structured' });
    const mixed = buildCustomerFilter({
      'custom_fields.custom_2': { operator: 'date_lte', value: '20261031' },
      'custom_fields.custom_3': { operator: 'gte', value: 5 },
    }, { tableAlias: 'c', startParamIndex: 2, storeCodeMode: 'skip' });
    for (const r of [structured, mixed]) {
      expect(r.sql).not.toMatch(/custom_fields->>'custom_\d+'\)::(date|numeric)/);
      expect(r.sql).toContain(`(CASE WHEN custom_fields->>'custom_2' ~ '^([0-9]{4})[-/.]([0-9]{1,2})[-/.]([0-9]{1,2})' THEN`);
      // 로캘에 따라 뜻이 바뀌는 문자 분류(\s · \d)를 쓰지 않는다(Codex 3R)
      expect(r.sql).not.toMatch(/\\[sd]/);
      expect(r.sql).toContain(`THEN (replace(custom_fields->>'custom_3', ',', ''))::numeric END)`);
    }
    expect(structured.params).toEqual(['20261001', 3, 9]);
    expect(mixed.params).toEqual(['20261031', 5]);
  });

  it('숫자 검사식은 변환이 반드시 성공하는 값만 통과시킨다(지수 · 범위 초과 자릿수 거절 · Codex 2R)', async () => {
    const { buildCustomerFilter } = await vi.importActual<typeof import('../customer-filter')>('../customer-filter');
    const r = buildCustomerFilter({ custom_3: { operator: 'gte', value: 5 } },
      { tableAlias: 'c', startParamIndex: 2, storeCodeMode: 'skip', inputFormat: 'structured' });
    const re = new RegExp(/~ '(\^[^']+\$)'/.exec(r.sql)![1]);
    for (const ok of ['7', ' 12.5 ', '-3', '+4', '.5', '5.', '1000', '9'.repeat(30) + '.' + '9'.repeat(20)]) expect(re.test(ok), ok).toBe(true);
    for (const bad of ['', 'abc', '1e3', '1e131072', '9'.repeat(31), '1.' + '1'.repeat(21), '1 2', '--1', 'NaN', 'Infinity',
      String.fromCharCode(0x3000) + '7', String.fromCharCode(0x0661), '7' + String.fromCharCode(0x3000), String.fromCharCode(9) + '7']) {
      expect(re.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('달력에 없는 비교값은 null(= 매칭 0 · 조건을 빼지 않는다)', async () => {
    const { buildCustomerFilter } = await vi.importActual<typeof import('../customer-filter')>('../customer-filter');
    const r = buildCustomerFilter({ custom_2: { operator: 'date_gte', value: '2026-02-30' } },
      { tableAlias: 'c', startParamIndex: 2, storeCodeMode: 'skip', inputFormat: 'structured' });
    expect(r.sql).toContain('>= $2');
    expect(r.params).toEqual([null]);
  });
});

describe('접수 2·3 · AI 오퍼레이션 발송 결과 창 · 확인 창', () => {
  const src = read('frontend/src/pages/AiOperatorPage.tsx');

  it('발송 확인 창 3곳(즉시 · 예약 · 제외 확인)은 발송을 기다리지 않는다', () => {
    expect(src).not.toMatch(/onConfirm: \(\) => performDirectSend\(/);
    expect(src).not.toMatch(/onConfirm: async \(\) => \{\s*await performDirectSend\(/);
    expect(src.match(/onConfirm: \(\) => \{ void performDirectSend\(/g)?.length).toBe(3);
  });

  it('결과 창 X = [새 캠페인]과 같이 제안을 지운다(결과 창만 닫지 않는다)', () => {
    expect(src).not.toContain('onClick={() => setSendResult(null)}');
    const x = src.indexOf('aria-label="닫기"', src.indexOf('{sendResult && ('));
    expect(x).toBeGreaterThan(-1);
    expect(src.slice(src.lastIndexOf('<button', x), x)).toContain('onClick={handleReset}');
  });
});
