/**
 * ★ 2026-10-01 브랜드 계정 수신거부 자동 등록의 브랜드 판정 — B-1001-4
 *   옛: 고객 행 store_code 로만 판정 → 고객은 폰당 1행이라 다매장 고객(고객 행 칸 = 브랜드 하나)의 거부가 나머지 브랜드 계정 명부에 안 들어갔다.
 *   처방(CT-03 brandRefusalCopyCond): 고객 행 칸 일치(옛 판정 · 줄이지 않음) OR 계정 코드의 소속 행 — 단 계정 코드에 몰 동의 코드가
 *   하나라도 있으면 소속 분기를 끈다(D93 · resolveSendConsent 와 같은 계정 단위 · Codex R1 섞인 계정 반례).
 *   몰 동의 코드 판정 = mall-consent mallConsentCodeAmong(getMallConsentStoreCodes 와 같은 진실 · 자사몰 연동 행 meta.store_code).
 *   실제 PostgreSQL 실행은 일회용 PG16 으로 확인(pg-mem 은 바깥 표를 가리키는 하위 조회를 못 푼다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const calls: Array<{ sql: string; params: any[] }> = [];
const queryMock = vi.fn(async (sql: string, params: any[] = []) => {
  calls.push({ sql, params });
  return { rows: [], rowCount: 3 };
});
vi.mock('../../config/database', () => ({ query: (...a: any[]) => (queryMock as any)(...a) }));

import { brandRefusalCopyCond, registerBulkCompanyUserUnsubscribes, registerUploaderOwnUnsubscribes } from '../unsubscribe-helper';
import { mallConsentCodeAmong } from '../mall-consent';

const CO = '00000000-0000-0000-0000-0000000000c1';
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

beforeEach(() => { calls.length = 0; });

describe('판정 조각', () => {
  it('고객 행 칸 일치 OR (계정 코드에 몰 동의 코드 없음 AND 계정 코드 소속)', () => {
    expect(brandRefusalCopyCond({ customerAlias: 'c', companyRef: '$1', codesRef: 'u.store_codes' })).toBe(
      "(c.store_code = ANY(u.store_codes) OR (NOT EXISTS (SELECT 1 FROM company_integrations mci WHERE mci.company_id = $1 AND mci.meta->>'store_code' = ANY(u.store_codes))"
      + " AND EXISTS (SELECT 1 FROM customer_stores bm WHERE bm.company_id = $1 AND bm.customer_id = c.id AND bm.store_code = ANY(u.store_codes))))",
    );
  });
  it('몰 동의 코드 판정은 getMallConsentStoreCodes 와 같은 진실(자사몰 연동 행 meta.store_code · 해제 연동 포함 = 상태 조건 없음)', () => {
    expect(mallConsentCodeAmong('$1', 'u.store_codes')).toBe("EXISTS (SELECT 1 FROM company_integrations mci WHERE mci.company_id = $1 AND mci.meta->>'store_code' = ANY(u.store_codes))");
    const src = readFileSync(resolve(__dirname, '../mall-consent.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function getMallConsentStoreCodes'), src.indexOf('export function mallConsentCodeAmong'));
    expect(fn).toContain("SELECT DISTINCT meta->>'store_code' AS store_code");
    expect(fn).toContain('FROM company_integrations');
    expect(fn).not.toMatch(/status|revoked|is_active/);
    // 같은 단위: resolveSendConsent 도 계정 코드 중 하나라도 몰 동의 코드면 몰 동의로 판정한다
    const rs = src.slice(src.indexOf('export async function resolveSendConsent'), src.indexOf('/** 몰 동의 조건이 붙는 소속 표의 별칭'));
    expect(rs).toContain('const any = userStoreCodes.some((c) => mall.has(c));');
    expect(rs).toContain('return any;');
  });
});

describe('등록 함수 — SQL 과 파라미터', () => {
  it('싱크·관리자 업로드(registerBulkCompanyUserUnsubscribes): filtered 단계의 브랜드 판정이 조각 하나', async () => {
    await registerBulkCompanyUserUnsubscribes(CO, 'sync');
    const { sql, params } = calls[0];
    expect(flat(sql)).toContain(flat(`AND ${brandRefusalCopyCond({ customerAlias: 'c', companyRef: '$1', codesRef: 'u.store_codes' })}`));
    expect(sql).not.toMatch(/AND c\.store_code = ANY\(u\.store_codes\)\s*\n\s*AND EXISTS/);
    expect(params).toEqual([CO, 'sync']);
  });
  it('브랜드 사용자 업로드(registerUploaderOwnUnsubscribes): 코드 있음 = 조각 · 4번째 자리표 text[]', async () => {
    const n = await registerUploaderOwnUnsubscribes(CO, 'u1', ['A', 'B'], 'db_upload');
    expect(n).toBe(3);
    const { sql, params } = calls[0];
    expect(flat(sql)).toContain(flat(brandRefusalCopyCond({ customerAlias: 'customers', companyRef: '$1', codesRef: '$4::text[]' })));
    expect(params).toEqual([CO, 'u1', 'db_upload', ['A', 'B']]);
  });
  it('브랜드 사용자 업로드: 코드 없음(단일 브랜드 회사) = 회사 전체 · 옛 동작 그대로', async () => {
    await registerUploaderOwnUnsubscribes(CO, 'u1', [], 'db_upload');
    const { sql, params } = calls[0];
    expect(sql).not.toContain('store_code');
    expect(params).toEqual([CO, 'u1', 'db_upload']);
  });
});
