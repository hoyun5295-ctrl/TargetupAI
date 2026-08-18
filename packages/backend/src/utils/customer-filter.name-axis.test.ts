/**
 * customer-filter.name-axis.test.ts — 이름 타겟팅 축 + 빈 조건 판정 고정
 *
 * ★ 2026-08-18 Harold 접수: "유호윤 고객에게만 30% 할인안내 문자 보낼거야"
 *   → AI가 "사용 가능한 필터 필드에 고객명 항목이 없어 이름 기반 필터링이 불가능합니다"라고 답했고,
 *     그런데도 **전체 6명이 대상으로 잡혀** 할인 문자가 나머지 5명에게 나갈 뻔했다.
 *
 *   두 가지가 겹쳐 있었다:
 *     (1) 필터 엔진은 이름을 처리할 수 있는데 AI에게 주는 필드 목록에서만 잘려 있었다
 *     (2) 조건이 안 만들어지면 빈 WHERE가 되고, 빈 WHERE는 "전체 고객"으로 읽혔다
 *
 *   여기서 고정하는 것은 그 둘의 **사실 근거**다 — 이름이 실제로 조건을 만들고,
 *   조건이 없을 때 정말 빈 문자열이 나온다는 것. 라우트의 차단은 이 판정 위에 서 있다.
 */
import { describe, it, expect } from 'vitest';
import { buildFilterWhereClauseCompat } from './customer-filter';
import { getColumnFields } from './standard-field-map';

describe('이름 타겟팅 축', () => {
  it('name은 컬럼 필드로 등록돼 있다 — 여기서 빠지면 제너릭 루프가 못 본다', () => {
    const name = getColumnFields().find((f) => f.fieldKey === 'name');
    expect(name).toBeDefined();
    expect(name?.columnName).toBe('name');
    expect(name?.dataType).toBe('string');
  });

  it('eq — 특정 고객 한 명만 집는 조건을 만든다', () => {
    const { sql, params } = buildFilterWhereClauseCompat(
      { name: { operator: 'eq', value: '유호윤' } },
      1,
    );
    expect(sql).toContain('name');
    expect(sql).toContain('$1');
    expect(params).toEqual(['유호윤']);
  });

  it('contains — 부분일치도 조건을 만든다', () => {
    const { sql, params } = buildFilterWhereClauseCompat(
      { name: { operator: 'contains', value: '유호' } },
      1,
    );
    expect(sql).toContain('ILIKE');
    expect(params[0]).toContain('유호');
  });
});

describe('빈 조건 판정 — 전원 발송과 갈리는 자리', () => {
  it('빈 객체는 WHERE를 만들지 않는다', () => {
    expect(buildFilterWhereClauseCompat({}, 1).sql.trim()).toBe('');
  });

  it('키는 있는데 값이 없으면 WHERE를 만들지 않는다 — 키 개수로 세면 통과해 버리는 형태', () => {
    for (const filters of [
      { grade: null },
      { grade: undefined },
      { region: { operator: 'eq', value: null } },
      { name: null },
    ]) {
      expect(buildFilterWhereClauseCompat(filters as any, 1).sql.trim(), JSON.stringify(filters)).toBe('');
    }
  });

  // ⚠ 여기 없는 케이스 — `{ name: { operator: 'eq' } }`처럼 **value 키 자체가 빠진** 엔트리.
  //   `getValue`가 그 객체를 값으로 돌려줘 `name = $1`에 객체가 실린다(customer-filter.ts:60).
  //   2026-08-18 실측으로 확인했으나 이번 접수 축이 아니라 고치지 않았다 —
  //   조건을 그냥 빼면 남은 필터만으로 **대상이 넓어지고**, 이 CT는 여러 경로가 공유한다.
  //   고친다면 무효 날짜와 같은 fail-closed(`AND FALSE`)여야 하고, 그건 별도 과제다.

  it('조건이 하나라도 붙으면 WHERE가 비지 않는다', () => {
    expect(buildFilterWhereClauseCompat({ name: { operator: 'eq', value: '유호윤' } }, 1).sql.trim()).not.toBe('');
  });
});
