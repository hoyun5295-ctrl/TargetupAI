/**
 * 커스텀 필드 라벨 단일 결정 자리(resolveCustomFieldLabels) 계약 (2026-10-15 엠티 VM 실설치)
 *
 * 실측: AI 가 고객 custom_1~3 을 배정하고 마법사가 남은 두 컬럼에 custom_4·5 를 배정했는데,
 *       라벨은 마법사가 배정한 2개에만 생겨 서버 필드 정의도 2개만 등록됐다(값은 5개 전부 적재).
 *       기동 등록은 "저장 라벨이 전부 비었을 때만" 매핑에서 역추출해 그 2개를 보충하지 못했다.
 */
import { describe, it, expect } from 'vitest';
import { assignCustomFieldSlots, customSlotSources, labelsAfterMappingUpdate, resolveCustomFieldLabels } from './templates';
import { mapRow } from './index';

describe('resolveCustomFieldLabels — 고객 custom 슬롯마다 라벨 하나', () => {
  it('엠티 VM 재현: AI 배정 3개 + 마법사 배정 2개 = 라벨 5개(옛 = 2개)', () => {
    const aiMapping = {
      CD_CUSTOMER: 'custom_1', YN_WITHDRAW: 'custom_2', DT_WITHDRAW: 'custom_3', NO_HP: 'phone',
    };
    const { mapping } = assignCustomFieldSlots(aiMapping, ['DM_REGISTER', 'DM_CHANGE']);
    expect(mapping.DM_REGISTER).toBe('custom_4');
    expect(mapping.DM_CHANGE).toBe('custom_5');

    // 옛 설정 파일에 저장돼 있던 라벨 2개를 그대로 넣어도 5개가 나온다(이미 설치된 에이전트 기동 시)
    const labels = resolveCustomFieldLabels(mapping, { custom_4: 'DM_REGISTER', custom_5: 'DM_CHANGE' });
    expect(labels).toEqual({
      custom_1: 'CD_CUSTOMER',
      custom_2: 'YN_WITHDRAW',
      custom_3: 'DT_WITHDRAW',
      custom_4: 'DM_REGISTER',
      custom_5: 'DM_CHANGE',
    });
  });

  it('사람이 붙인 라벨은 유지하고, 없거나 빈 라벨은 소스 컬럼명', () => {
    const mapping = { CD_CUSTOMER: 'custom_1', DT_WITHDRAW: 'custom_3' };
    expect(resolveCustomFieldLabels(mapping, { custom_1: '회원번호', custom_3: '   ' })).toEqual({
      custom_1: '회원번호',
      custom_3: 'DT_WITHDRAW',
    });
  });

  it('고객 매핑에 없는 슬롯 라벨은 버린다 — 구매 슬롯·옛 슬롯이 고객 필드 이름으로 올라가지 않게', () => {
    const mapping = { CD_CUSTOMER: 'custom_1' };
    expect(resolveCustomFieldLabels(mapping, { custom_1: '회원번호', custom_2: '탈퇴여부', custom_9: 'NO_SALE' }))
      .toEqual({ custom_1: '회원번호' });
  });

  it('previousMapping: 소스 컬럼이 바뀐 슬롯의 저장 라벨은 버리고, 그대로인 슬롯은 유지', () => {
    const before = { CD_CUSTOMER: 'custom_1', YN_WITHDRAW: 'custom_2' };
    const after = { CD_CUSTOMER: 'custom_1', DM_CHANGE: 'custom_2' };
    expect(resolveCustomFieldLabels(after, { custom_1: '회원번호', custom_2: '탈퇴여부' }, before)).toEqual({
      custom_1: '회원번호',
      custom_2: 'DM_CHANGE',
    });
  });

  it('한 슬롯에 컬럼이 둘이면 먼저 나온 컬럼 — mapRow 가 값을 읽는 컬럼과 같다', () => {
    const mapping = { A_COL: 'custom_1', B_COL: 'custom_1' };
    expect(resolveCustomFieldLabels(mapping)).toEqual({ custom_1: 'A_COL' });
    expect(mapRow({ A_COL: 'a', B_COL: 'b' }, mapping).custom_fields).toEqual({ custom_1: 'a' });
  });

  it('슬롯 번호 순(custom_10 이 custom_2 뒤) · 매핑·라벨이 없으면 빈 객체', () => {
    expect([...customSlotSources({ X: 'custom_10', Y: 'custom_2', Z: 'name' }).keys()]).toEqual(['custom_2', 'custom_10']);
    expect(resolveCustomFieldLabels(undefined, undefined)).toEqual({});
    expect(resolveCustomFieldLabels({ NO_HP: 'phone' }, { custom_1: '회원번호' })).toEqual({});
  });
});

describe('labelsAfterMappingUpdate — 원격 매핑 갱신(슈퍼관리자 매핑 모달)', () => {
  const current = {
    customers: { CD_CUSTOMER: 'custom_1', YN_WITHDRAW: 'custom_2' },
    customFieldLabels: { custom_1: '회원번호', custom_2: '탈퇴여부' },
  };

  it('고객 매핑을 보내면 전체 교체 — 라벨 칸을 비운 슬롯도 원본 컬럼명으로 등록된다(옛 = 빠짐)', () => {
    const labels = labelsAfterMappingUpdate(current, {
      customers: { CD_CUSTOMER: 'custom_1', DM_CHANGE: 'custom_2', DM_REGISTER: 'custom_3' },
      customFieldLabels: { custom_1: '회원 번호' },
    });
    expect(labels).toEqual({ custom_1: '회원 번호', custom_2: 'DM_CHANGE', custom_3: 'DM_REGISTER' });
  });

  it('라벨만 보내면 지금 고객 매핑 위에 덮는다', () => {
    expect(labelsAfterMappingUpdate(current, { customFieldLabels: { custom_2: '탈퇴 여부' } }))
      .toEqual({ custom_1: '회원번호', custom_2: '탈퇴 여부' });
  });

  it('구매만 보내면 라벨은 그대로', () => {
    expect(labelsAfterMappingUpdate(current, {})).toEqual(current.customFieldLabels);
  });
});

describe('assignCustomFieldSlots — 슬롯만 배정한다', () => {
  it('AI 가 쓴 슬롯을 건너뛰고 다음 빈 슬롯부터 · 라벨은 돌려주지 않는다', () => {
    const r = assignCustomFieldSlots({ A: 'custom_1', B: 'custom_3' }, ['C', 'D']);
    expect(r.mapping).toEqual({ A: 'custom_1', B: 'custom_3', C: 'custom_2', D: 'custom_4' });
    expect(r.overflowColumns).toEqual([]);
    expect(Object.keys(r)).toEqual(['mapping', 'overflowColumns']);
  });
});
