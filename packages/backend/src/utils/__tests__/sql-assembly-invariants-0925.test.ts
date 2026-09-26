/**
 * SQL 문자열 조립 재발 방지 계약 (★2026-09-25 한줄로 전수점검 C-02 · C-03 · C-04 · C-13)
 *
 * 왜 있나
 *   같은 뿌리(고객사·외부가 넣을 수 있는 값을 따옴표로만 감싸 SQL에 이어 붙임)가 네 곳에서 나왔다.
 *   ① 매장 코드(companies.ts 대시보드 카드) ② 직접발송 금액필터 키(campaigns.ts) ③ 예약 문안 수정 MySQL 본문(campaigns.ts)
 *   ④ 커스텀 필드 키(enabled-fields.ts · services/ai.ts). tsc·런타임 테스트로는 이 부류가 안 잡혀 소스 스캔으로 막는다.
 *
 * 못 박는 것
 *   1. customFieldRef는 평범한 키에서 종전과 같은 SQL을 내고, 따옴표가 든 키는 값 안에 가둔다.
 *   2. 네 자리에 옛 조립 형태가 다시 나타나지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { customFieldRef } from '../safe-field-name';

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('customFieldRef', () => {
  it('평범한 키는 종전과 같은 접근식', () => {
    expect(customFieldRef('custom_1')).toBe("custom_fields->>'custom_1'");
    expect(customFieldRef('membership_tier', 'c')).toBe("c.custom_fields->>'membership_tier'");
  });

  it('작은따옴표가 든 키는 값 안에 가둔다', () => {
    const key = "x' IS NOT NULL UNION ALL SELECT phone FROM customers --";
    expect(customFieldRef(key)).toBe("custom_fields->>'x'' IS NOT NULL UNION ALL SELECT phone FROM customers --'");
  });
});

describe('옛 조립 형태 재발 금지', () => {
  it('C-02 companies.ts: 매장 코드를 따옴표로만 감싸 붙이지 않는다', () => {
    const src = read('routes/companies.ts');
    expect(src).not.toMatch(/storeCodes\.map\(\s*s\s*=>\s*`'\$\{s\}'`\s*\)/);
    expect(src).toContain('buildCustomerStoreFilterLiteral(companyId, scope.storeCodes)');
  });

  it('C-03 campaigns.ts: 금액필터 키를 컬럼명으로 그대로 쓰지 않는다', () => {
    const src = read('routes/campaigns.ts');
    expect(src).not.toContain('AND c.${key}');
  });

  it('C-04 campaigns.ts: MySQL 본문을 따옴표 이중화로 붙이지 않는다', () => {
    const src = read('routes/campaigns.ts');
    expect(src).not.toContain(`finalMessage.replace(/'/g, "''")`);
    expect(src).not.toContain(`finalSubject.replace(/'/g, "''")`);
    expect(src).not.toContain('mysqlQuery(updateQuery, [])');
  });

  it('C-13 enabled-fields.ts · services/ai.ts: 커스텀 필드 키를 따옴표로만 감싸 붙이지 않는다', () => {
    expect(read('utils/enabled-fields.ts')).not.toContain("custom_fields->>'${");
    const ai = read('services/ai.ts');
    // 남은 한 곳(706행 부근)은 /^custom_\d+$/ 화이트리스트를 통과한 키만 쓴다 — 그 한 곳만 허용
    const hits = ai.split('\n').filter((l) => l.includes("custom_fields->>'${"));
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain('${v.column}');
  });
});
