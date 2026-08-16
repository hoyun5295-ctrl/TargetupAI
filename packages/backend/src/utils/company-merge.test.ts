/**
 * 회사 병합 축 계약 테스트 (2026-07-29)
 *
 * 기대값을 COMPANY_MERGE_AXES에서 유도하지 않는다 — 유도하면 표가 틀려도 테스트가 같이 틀린다.
 * (0729 billing-type-axis.test.ts와 같은 원칙)
 *
 * 이 파일이 지키는 것 셋:
 *  1) 무엇을 옮기고 무엇을 남기는지 — 이력·설정·채번·계정을 옮기면 병합 목적지가 오염된다.
 *  2) 충돌 검사를 손으로 고르지 않는다는 계약 — 쿼리는 pg_index가 준 인덱스 정의에서 조립된다.
 *  3) 잠금 키 정규화 — 대소문자 uuid가 서로 다른 잠금을 잡으면 겹치는 병합이 직렬화되지 않는다.
 */
import { describe, it, expect } from 'vitest';
import {
  COMPANY_MERGE_AXES,
  COMPANY_MERGE_INDIRECT_AXES,
  moveTables,
  keepTables,
  registeredTables,
  findUnregisteredTables,
  findUnregisteredIndirect,
  isSafeIdentifier,
  isUuid,
  isUniqueIndexSupported,
  normalizeLockOrder,
  buildConflictQuery,
  indirectSignature,
  predicateReferencesCompanyId,
  isIndirectRefSupported,
  buildIndirectCountQuery,
} from './company-merge';

describe('COMPANY_MERGE_AXES — 표 자체의 불변식', () => {
  it('테이블이 중복 등재되지 않는다 (같은 테이블에 move·keep이 동시에 걸리면 판정이 갈린다)', () => {
    const tables = registeredTables();
    expect(new Set(tables).size).toBe(tables.length);
  });

  it('모든 축은 move 아니면 keep이고 사유 문장을 갖는다', () => {
    for (const axis of COMPANY_MERGE_AXES) {
      expect(['move', 'keep']).toContain(axis.action);
      expect(axis.reason.trim().length).toBeGreaterThan(0);
      expect(isSafeIdentifier(axis.table)).toBe(true);
    }
  });
});

describe('이동/잔류 판정 — 리터럴로 고정', () => {
  it('이동 축 = 그 회사가 보유한 자산 7종 (★2026-08-16 마케팅 진단 원장 합류 — §4-7)', () => {
    expect(moveTables().sort()).toEqual(
      [
        'brand_message_templates',
        'company_agent_ids',
        'gateway_bill_mappings',
        'gateway_template_mappings',
        'kakao_sender_profiles',
        'kakao_templates',
        'marketing_diagnoses',
      ].sort(),
    );
  });

  it('잔류 축 = 이력·설정·채번·계정 + 진단 지급·초대 6종 — 옮기면 병합 목적지의 사실이 오염된다', () => {
    expect(keepTables().sort()).toEqual(
      [
        'company_plan_changes',
        'company_settings',
        'customer_code_sequences',
        'users',
        // ★2026-08-16 마케팅 진단(§4-7) — 지급(1회 한정)·초대 상태는 병합 대상 자신의 것을 유지(선행 행 유지)
        'diagnosis_trial_grants',
        'diagnosis_invites',
      ].sort(),
    );
  });

  it('발신프로필과 템플릿은 반드시 같은 판정이어야 한다 — 갈리면 템플릿이 옛 회사에 남는다', () => {
    const move = new Set(moveTables());
    expect(move.has('kakao_sender_profiles')).toBe(true);
    expect(move.has('kakao_templates')).toBe(true);
  });

  it('게이트웨이 bill은 이동이다 — auto_push가 이 축으로 도는데 해지된 회사에 남으면 자동 등록이 그쪽으로 간다', () => {
    expect(moveTables()).toContain('gateway_bill_mappings');
  });
});

describe('findUnregisteredTables — 미등록 회사 축 차단 게이트', () => {
  it('표에 없는 테이블만 돌려준다', () => {
    const found = findUnregisteredTables(['kakao_templates', 'customers', 'campaigns', 'users']);
    expect(found.sort()).toEqual(['campaigns', 'customers']);
  });

  it('표에 있는 것만 들어오면 빈 배열 — 병합이 진행된다', () => {
    expect(findUnregisteredTables(registeredTables())).toEqual([]);
  });

  it('company_id를 가진 테이블이 새로 생기면 잡힌다 (표를 안 고치면 조용히 빠지는 것을 막는 장치)', () => {
    expect(findUnregisteredTables(['some_new_company_scoped_table'])).toEqual(['some_new_company_scoped_table']);
  });
});

describe('간접 참조 축 — company_id 없는 관계까지 잡는 게이트', () => {
  const uspProfile = {
    childTable: 'user_sender_profiles',
    childColumns: ['profile_id'],
    parentTable: 'kakao_sender_profiles',
    parentColumns: ['id'],
  };

  it('간접 서명 전수 등재 — 0729 실측 4개 + 2026-08-16 진단 지급 1개', () => {
    expect(COMPANY_MERGE_INDIRECT_AXES.map((a) => indirectSignature(a)).sort()).toEqual(
      [
        'billing_items(agent_id)->company_agent_ids',
        'campaigns(kakao_profile_id)->kakao_sender_profiles',
        'campaigns(kakao_template_id)->kakao_templates',
        'user_sender_profiles(profile_id)->kakao_sender_profiles',
        // ★2026-08-16 마케팅 진단(§4-7) — 지급 이력(keep)이 진단 행(move)을 가리킨다
        'diagnosis_trial_grants(diagnosis_id)->marketing_diagnoses',
      ].sort(),
    );
    expect(findUnregisteredIndirect([uspProfile])).toEqual([]);
  });

  it('★같은 테이블에 다른 이동 테이블을 향한 FK가 생기면 새 축으로 잡힌다 — 테이블명 등재로는 조용히 통과했다', () => {
    const uspTemplate = {
      childTable: 'user_sender_profiles',
      childColumns: ['template_id'],
      parentTable: 'kakao_templates',
      parentColumns: ['id'],
    };
    expect(findUnregisteredIndirect([uspProfile, uspTemplate])).toEqual([
      'user_sender_profiles(template_id)->kakao_templates',
    ]);
  });

  it('등재되지 않은 연결 테이블이 탐지되면 서명으로 돌려준다', () => {
    expect(
      findUnregisteredIndirect([
        uspProfile,
        {
          childTable: 'some_join',
          childColumns: ['profile_id'],
          parentTable: 'kakao_sender_profiles',
          parentColumns: ['id'],
        },
      ]),
    ).toEqual(['some_join(profile_id)->kakao_sender_profiles']);
  });

  it('중복 탐지는 한 번만 보고한다', () => {
    expect(findUnregisteredIndirect([uspProfile, uspProfile])).toEqual([]);
    const unknown = {
      childTable: 'x_join',
      childColumns: ['profile_id'],
      parentTable: 'kakao_sender_profiles',
      parentColumns: ['id'],
    };
    expect(findUnregisteredIndirect([unknown, unknown])).toEqual(['x_join(profile_id)->kakao_sender_profiles']);
  });

  it('서명은 컬럼 순서가 달라도 같다 (복합 FK 순서로 축이 갈리지 않는다)', () => {
    const a = indirectSignature({ childTable: 't', childColumns: ['b', 'a'], parentTable: 'p' });
    const b = indirectSignature({ childTable: 't', childColumns: ['a', 'b'], parentTable: 'p' });
    expect(a).toBe(b);
  });

  it('등재 축은 전부 식별자 형식이고 사유 문장을 갖는다', () => {
    for (const axis of COMPANY_MERGE_INDIRECT_AXES) {
      expect(axis.action).toBe('block');
      expect(axis.reason.trim().length).toBeGreaterThan(0);
      expect(isSafeIdentifier(axis.childTable)).toBe(true);
      expect(isSafeIdentifier(axis.parentTable)).toBe(true);
      expect(axis.childColumns.every((c) => isSafeIdentifier(c))).toBe(true);
    }
  });
});

describe('buildIndirectCountQuery — count 쿼리도 손으로 쓰지 않고 FK 서명에서 파생한다', () => {
  it('단일 컬럼이 부모 id를 가리키면 파생한다', () => {
    const sql = buildIndirectCountQuery({
      childTable: 'campaigns',
      childColumns: ['kakao_profile_id'],
      parentTable: 'kakao_sender_profiles',
      parentColumns: ['id'],
    });
    expect(sql).toContain('"campaigns" ch');
    expect(sql).toContain('"kakao_sender_profiles" p ON p.id = ch."kakao_profile_id"');
    expect(sql).toContain('p.company_id = $1::uuid');
  });

  it('복합 FK·id가 아닌 부모 컬럼은 파생하지 않고 차단한다 (fail-closed)', () => {
    const composite = {
      childTable: 'x',
      childColumns: ['a', 'b'],
      parentTable: 'kakao_templates',
      parentColumns: ['a', 'b'],
    };
    const notId = {
      childTable: 'x',
      childColumns: ['a'],
      parentTable: 'kakao_templates',
      parentColumns: ['template_code'],
    };
    expect(isIndirectRefSupported(composite)).toBe(false);
    expect(isIndirectRefSupported(notId)).toBe(false);
    expect(() => buildIndirectCountQuery(composite)).toThrow();
    expect(() => buildIndirectCountQuery(notId)).toThrow();
  });

  it('식별자 형식이 아닌 이름은 파생하지 않는다', () => {
    expect(
      isIndirectRefSupported({
        childTable: 'x',
        childColumns: ['bad"col'],
        parentTable: 'kakao_templates',
        parentColumns: ['id'],
      }),
    ).toBe(false);
  });
});

describe('predicateReferencesCompanyId — 사후 상태로 판정해야 하는 술어는 차단', () => {
  it('현재 두 부분 인덱스 술어는 company_id를 참조하지 않는다 (계산 가능)', () => {
    expect(predicateReferencesCompanyId('(yellow_id IS NOT NULL)')).toBe(false);
    expect(predicateReferencesCompanyId('(template_key IS NOT NULL)')).toBe(false);
    expect(predicateReferencesCompanyId(null)).toBe(false);
  });

  it('술어가 company_id를 참조하면 차단 대상 — 이동 전 값으로 한 사전검사가 빗나간다', () => {
    expect(predicateReferencesCompanyId("(company_id <> '00000000-0000-0000-0000-000000000000'::uuid)")).toBe(true);
  });
});

describe('buildConflictQuery — 충돌 검사는 인덱스 정의에서 조립된다', () => {
  it('부분 인덱스 술어를 양쪽에 붙인다 (술어 밖 행은 인덱스에 없으니 충돌도 없다)', () => {
    const sql = buildConflictQuery({
      table: 'kakao_sender_profiles',
      indexName: 'idx_ksp_yellow_id',
      columns: ['company_id', 'yellow_id'],
      predicate: '(yellow_id IS NOT NULL)',
      nullsNotDistinct: false,
    });
    expect(sql).toContain('INTERSECT');
    expect(sql.match(/yellow_id IS NOT NULL/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain('$1::uuid');
    expect(sql).toContain('$2::uuid');
  });

  it('0729에 손으로 고르다 빠뜨린 두 축도 같은 조립으로 처리된다', () => {
    const profileKey = buildConflictQuery({
      table: 'kakao_sender_profiles',
      indexName: 'kakao_sender_profiles_company_id_profile_key_key',
      columns: ['company_id', 'profile_key'],
      predicate: null,
      nullsNotDistinct: false,
    });
    expect(profileKey).toContain('"profile_key"');

    const brand = buildConflictQuery({
      table: 'brand_message_templates',
      indexName: 'idx_bmt_company_template_key',
      columns: ['company_id', 'template_key'],
      predicate: null,
      nullsNotDistinct: false,
    });
    expect(brand).toContain('"brand_message_templates"');
    expect(brand).toContain('"template_key"');
  });

  it('기본 UNIQUE는 키 컬럼 NULL을 충돌에서 뺀다 (PG가 NULL을 서로 다른 값으로 본다)', () => {
    const sql = buildConflictQuery({
      table: 'kakao_templates',
      indexName: 'idx_kt_company_template_key',
      columns: ['company_id', 'template_key'],
      predicate: null,
      nullsNotDistinct: false,
    });
    expect(sql).toContain('"template_key" IS NOT NULL');
  });

  it('NULLS NOT DISTINCT 인덱스는 NULL 제외를 걸지 않는다 (그 인덱스는 NULL도 같다고 본다)', () => {
    const sql = buildConflictQuery({
      table: 'kakao_templates',
      indexName: 'x',
      columns: ['company_id', 'template_key'],
      predicate: null,
      nullsNotDistinct: true,
    });
    expect(sql).not.toContain('IS NOT NULL');
  });

  it('company_id 단독 UNIQUE = 회사당 1행이라 양쪽에 행이 있으면 그 자체가 충돌', () => {
    const sql = buildConflictQuery({
      table: 'company_settings',
      indexName: 'x',
      columns: ['company_id'],
      predicate: null,
      nullsNotDistinct: false,
    });
    expect(sql).toContain('LEAST');
    expect(sql).not.toContain('INTERSECT');
  });

  it('컬럼명·테이블명이 식별자 형식이 아니면 쿼리를 만들지 않는다', () => {
    expect(() =>
      buildConflictQuery({
        table: 'kakao_templates',
        indexName: 'x',
        columns: ['company_id', 'bad"col'],
        predicate: null,
        nullsNotDistinct: false,
      }),
    ).toThrow();
  });
});

describe('isUniqueIndexSupported — 계산할 수 없는 인덱스는 통과시키지 않는다', () => {
  it('키 컬럼 수가 맞으면 지원', () => {
    expect(isUniqueIndexSupported(['company_id', 'template_key'], 2)).toBe(true);
  });

  it('표현식·INCLUDE가 섞여 컬럼 수가 어긋나면 미지원 (fail-closed)', () => {
    expect(isUniqueIndexSupported(['company_id'], 2)).toBe(false);
    expect(isUniqueIndexSupported(['company_id', 'a', 'b'], 2)).toBe(false);
  });

  it('★표현식 자리는 이름이 없어 (expr)로 오는데 개수는 맞는다 — 그래도 미지원이어야 한다', () => {
    // UNIQUE(company_id, lower(code)) INCLUDE(extra) 같은 인덱스가 개수 대조만으로 통과하던 자리
    expect(isUniqueIndexSupported(['company_id', '(expr)'], 2)).toBe(false);
  });

  it('빈 컬럼 목록은 미지원', () => {
    expect(isUniqueIndexSupported([], 0)).toBe(false);
  });
});

describe('normalizeLockOrder — 잠금 키 정규화', () => {
  it('대문자 uuid와 소문자 uuid가 같은 잠금 키가 된다 (PG는 같은 행을 가리킨다)', () => {
    const upper = '1B1D6619-413C-4ABF-8CBC-9EF78DF4FEA3';
    const lower = '1b1d6619-413c-4abf-8cbc-9ef78df4fea3';
    const other = '7b7a663b-a0d1-4972-9f9e-1cc980f65c14';
    expect(normalizeLockOrder(upper, other)).toEqual(normalizeLockOrder(lower, other));
  });

  it('순서를 뒤집어 불러도 같은 순서로 잡는다 (반대 방향 병합 동시 실행 교착 차단)', () => {
    const a = '1b1d6619-413c-4abf-8cbc-9ef78df4fea3';
    const b = '7b7a663b-a0d1-4972-9f9e-1cc980f65c14';
    expect(normalizeLockOrder(a, b)).toEqual(normalizeLockOrder(b, a));
  });
});

describe('식별자·uuid 방어', () => {
  it('SQL에 끼워 넣을 수 없는 문자열을 거부한다', () => {
    expect(isSafeIdentifier('kakao_templates')).toBe(true);
    expect(isSafeIdentifier('users; DROP TABLE users')).toBe(false);
    expect(isSafeIdentifier('"users"')).toBe(false);
    expect(isSafeIdentifier('Users')).toBe(false);
    expect(isSafeIdentifier('')).toBe(false);
  });

  it('uuid 형식만 통과한다', () => {
    expect(isUuid('1b1d6619-413c-4abf-8cbc-9ef78df4fea3')).toBe(true);
    expect(isUuid('P0070')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
