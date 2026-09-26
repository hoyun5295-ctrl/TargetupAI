/**
 * AI 타겟 추출 — "전체"는 조건 없는 전체 요청일 때만 (★2026-09-26 한줄로 V2 R1-21)
 *
 * 옛: AI가 조건을 못 뽑으면 입력 문장에 "전체·모든·모두·전부"가 있기만 해도 회사 전체로 넓혔다
 *     ("서울 지역 모든 고객"도 전체). AI 플래그(all_customers)가 참이면 AI가 뽑은 조건까지 버리고 전체로 갔다.
 * 처방(허용 목록): 조건이 비었을 때만, 입력이 "전체 고객" 류 말(채움말 제외 후 남는 것 없음)일 때만 전체.
 *   AI가 조건을 뽑았으면 조건이 이긴다(플래그와 모순이면 좁은 쪽). 그 밖의 빈 조건 = EMPTY_FILTER(되묻기 · 0건 자동 완화 금지와 같은 부류).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
const aiMock = vi.fn();
vi.mock('../../services/ai', () => ({ callAIWithFallback: (...a: any[]) => aiMock(...a) }));
vi.mock('../customer-filter', () => ({ buildCustomerFilter: vi.fn(() => ({ sql: 'AND 1=1', params: ['x'] })) }));

import { convertNaturalLanguageToFilter, isPlainAllCustomersRequest } from '../ai-segment-generator';

const CO = '00000000-0000-4000-8000-000000000001';
const ai = (obj: any) => aiMock.mockResolvedValue(JSON.stringify(obj));

describe('isPlainAllCustomersRequest', () => {
  it.each(['전체 고객', '전체고객에게 발송', '모든 고객에게', '전부 발송', '우리 고객 모두에게 보내줘', '전체 회원', '고객 전체'])('전체 요청: %s', (t) => {
    expect(isPlainAllCustomersRequest(t)).toBe(true);
  });
  it.each(['서울 지역 모든 고객', 'VIP 제외 전체', '30대 여성 모두', '최근 구매한 고객 전부', '이번 주말 전체 고객', '고객'])('조건이 섞이면 아니다: %s', (t) => {
    expect(isPlainAllCustomersRequest(t)).toBe(false);
  });
});

describe('convertNaturalLanguageToFilter 전체 판정', () => {
  beforeEach(() => aiMock.mockReset());

  it('조건을 못 뽑았고 입력이 조건 섞인 "모든" 문장이면 전체로 넓히지 않는다(EMPTY_FILTER)', async () => {
    ai({ filter: {}, explanation: '' });
    await expect(convertNaturalLanguageToFilter({ companyId: CO, naturalLanguage: '서울 지역 모든 고객' } as any)).rejects.toMatchObject({ code: 'EMPTY_FILTER' });
  });

  it('AI 플래그가 참이어도 입력이 조건 섞인 문장이면 넓히지 않는다', async () => {
    ai({ all_customers: true, filter: {}, explanation: '' });
    await expect(convertNaturalLanguageToFilter({ companyId: CO, naturalLanguage: '서울 지역 모든 고객' } as any)).rejects.toMatchObject({ code: 'EMPTY_FILTER' });
  });

  it('AI가 조건을 뽑았으면 플래그가 참이어도 조건을 버리지 않는다', async () => {
    ai({ all_customers: true, filter: { region: { operator: 'in', value: ['서울'] } }, explanation: '서울' });
    const r = await convertNaturalLanguageToFilter({ companyId: CO, naturalLanguage: '서울 모든 고객' } as any);
    expect(r.isAll).toBeFalsy();
    expect(r.filter).toEqual({ region: { operator: 'in', value: ['서울'] } });
  });

  it('조건 없는 전체 요청은 전체(플래그 누락이어도)', async () => {
    ai({ filter: {}, explanation: '' });
    const r = await convertNaturalLanguageToFilter({ companyId: CO, naturalLanguage: '전체 고객에게 발송' } as any);
    expect(r).toMatchObject({ filter: {}, isAll: true });
  });
});
