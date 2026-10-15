// 싱크 AI 매핑 — 탈퇴·거부 표시 칸(is_opt_out) (2026-10-15 엠티콜렉션 YN_WITHDRAW 가 custom_2 로 가던 자리)
// AI 는 주어진 목록 밖을 고를 수 없고(프롬프트), 골라도 정리 단계 허용 목록 밖이면 버려진다 — 두 문 다 연다.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../config/database', () => ({ query: vi.fn() }));
import { sanitizeMapping, buildFieldMapReference } from '../ai-mapping';
import { SYNC_CUSTOMER_TARGET_FIELDS, validateSyncMappingTarget, syncFieldsNeedingNewerAgent } from '../sync-mapping-fields';

describe('AI 매핑 — is_opt_out', () => {
  it('고객 대상이면 정리 단계에서 남긴다', () => {
    const r = sanitizeMapping({ CM_HP: 'phone', YN_SMS: 'sms_opt_in', YN_WITHDRAW: 'is_opt_out' }, ['CM_HP', 'YN_SMS', 'YN_WITHDRAW'], 'customers');
    expect(r.YN_WITHDRAW).toBe('is_opt_out');
  });

  it('구매 대상이면 버린다', () => {
    const r = sanitizeMapping({ TEL: 'customer_phone', YN_WITHDRAW: 'is_opt_out' }, ['TEL', 'YN_WITHDRAW'], 'purchases');
    expect(r.YN_WITHDRAW).toBeNull();
  });

  it('고객 프롬프트 필드표에 있다(목록이 곧 게이트)', () => {
    expect(buildFieldMapReference()).toContain('- is_opt_out:');
  });

  it('옛 에이전트(1.7.2 미만 · 판 모름)에 걸면 저장 전 검사가 잡는다 — 옛 판은 이 칸을 버린다', () => {
    const m = { customers: { CM_HP: 'phone', YN_WITHDRAW: 'is_opt_out' } };
    expect(syncFieldsNeedingNewerAgent(m, '1.7.1')).toEqual([{ field: 'is_opt_out', minVersion: '1.7.2' }]);
    expect(syncFieldsNeedingNewerAgent(m, null)).toHaveLength(1);
    expect(syncFieldsNeedingNewerAgent(m, '1.7.2')).toEqual([]);
    expect(syncFieldsNeedingNewerAgent({ customers: { CM_HP: 'phone' } }, '1.5.7')).toEqual([]);
  });

  it('싱크 매핑 계약도 받는다(원격 매핑 편집 저장이 거절되지 않는다)', () => {
    expect(SYNC_CUSTOMER_TARGET_FIELDS).toContain('is_opt_out');
    expect(validateSyncMappingTarget('customers', { CM_HP: 'phone', YN_WITHDRAW: 'is_opt_out' }, { requireAll: true })).toEqual([]);
  });
});
