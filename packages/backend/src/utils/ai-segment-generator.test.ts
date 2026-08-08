/**
 * ★ 2026-08-08 (임은지 접수 08-05) AI 자연어 타겟의 조건 필드 노출 계약.
 *
 * 접수 = 직접타겟발송 AI 자연어 모드가 수신자 필드를 안 넘겨(meta []) 추출 목록에 열도 %변수%도
 * 없었다. 축은 filter의 키 하나 — { field: { operator, value } } 구조라 그 키가 곧 조건 필드다.
 * previewMatching이 그 키를 FIELD_MAP(단일 기준)으로 풀어 샘플 열(sampleFields)로 싣고,
 * 프론트 meta도 같은 목록에서 나온다(미리보기와 발송 목록이 같은 값을 본다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock('../services/ai', () => ({ callAIWithFallback: vi.fn(async () => ({ content: '' })) }));
// CT-01은 이 테스트의 관심이 아니다 — previewMatching의 열 구성만 고정한다.
vi.mock('./customer-filter', () => ({ buildCustomerFilter: vi.fn(() => ({ sql: 'AND 1=1', params: ['VIP'] })) }));

import { query } from '../config/database';
import { previewMatching } from './ai-segment-generator';

const qmock = query as unknown as ReturnType<typeof vi.fn>;
const norm = (s: string) => s.replace(/\s+/g, ' ');

describe('previewMatching — filter 참조 필드를 샘플 열로 싣는다', () => {
  beforeEach(() => {
    qmock.mockReset();
    qmock.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*)')) return { rows: [{ cnt: 2 }] };
      return {
        rows: [{
          id: 'c-1', phone: '01000000000', name: null, gender: null, region: null,
          last_purchase_date: null, total_purchase_amount: null, grade: 'VIP', custom_3: '멤버십A',
        }],
      };
    });
  });

  it('컬럼 필드·custom 필드가 FIELD_MAP 매핑으로 SELECT에 실리고, 값·라벨이 함께 돌아온다', async () => {
    const r = await previewMatching('company-1', {
      grade: { operator: 'equals', value: 'VIP' },
      custom_3: { operator: 'equals', value: '멤버십A' },
    } as any);
    const sampleSql = qmock.mock.calls.map((c: any[]) => String(c[0])).find((s) => !s.includes('COUNT(*)'))!;
    expect(norm(sampleSql)).toContain(', c.grade AS "grade"');
    expect(norm(sampleSql), 'custom 슬롯은 JSONB 경로로 — 직접 컬럼으로 추측하면 42703').toContain(`c.custom_fields ->> 'custom_3' AS "custom_3"`);
    expect(r.sampleFields).toEqual([
      { field_key: 'grade', display_name: '고객등급', data_type: 'string', category: 'membership' },
      { field_key: 'custom_3', display_name: '커스텀3', data_type: 'string', category: 'custom' },
    ]);
    expect(r.samples[0].grade).toBe('VIP');
    expect(r.samples[0].custom_3).toBe('멤버십A');
  });

  it('sms_opt_in(발송 강제라 항상 true)·FIELD_MAP 밖 키·기본 열 중복 키는 싣지 않는다 — 컬럼명 추측 금지', async () => {
    const r = await previewMatching('company-1', {
      sms_opt_in: { operator: 'equals', value: true },
      days_since_last_purchase: { operator: 'lte', value: 30 },
      region: { operator: 'equals', value: '서울' },
    } as any);
    const sampleSql = qmock.mock.calls.map((c: any[]) => String(c[0])).find((s) => !s.includes('COUNT(*)'))!;
    expect(r.sampleFields).toEqual([]);
    expect(norm(sampleSql)).not.toContain('days_since_last_purchase');
    expect(norm(sampleSql), '기본 열(region)이 추가 열로 중복되면 별칭이 충돌한다').not.toContain('AS "region"');
  });
});
