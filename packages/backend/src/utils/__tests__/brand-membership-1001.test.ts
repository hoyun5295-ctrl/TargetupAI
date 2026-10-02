/**
 * ★ 2026-10-01 브랜드(분류코드) 판단 = 소속 표(customer_stores) 하나 — 박성용 접수 cmuozso84
 *   (이에스페이먼트 관리자 고객 DB 조회에서 브랜드를 고르면 0명 · 실측 428,962명 전원 고객 행 store_code 빈 칸 · 전원 소속 표 있음)
 *
 *   ① 실제 SQL 실행(pg-mem): 몰 고객(고객 행 브랜드 빈 칸 · 소속 표에만 있음)이 브랜드로 잡히고, 단일 브랜드 업로드 고객은 종전과 같다.
 *      고객은 폰당 1행이라 다매장 업로드 고객(옛 칸 = 브랜드 하나)은 소속된 모든 브랜드에 잡힌다(의도한 넓어짐).
 *   ①-2 몰 동의 발송(Codex R1 high): 타겟 브랜드 조건과 그 브랜드 동의를 같은 소속 행에서 본다 — 범위 [A,B] 계정이 A 를 고를 때 A 거부·B 동의 고객은 빠진다
 *   ② 공용 필터: 'direct'(고객 행 store_code) 모드 폐기 · 호환 래퍼(캠페인·자동발송·미리보기) = 소속 표 · 별칭 없는 경로는 종전 SQL 그대로
 *   ③ 잔존 0: 고객 행 store_code 로 브랜드를 거르는 SQL 이 백엔드에 남지 않는다(예외 0 — 수신거부 자동 등록 2곳도 CT-03 brandRefusalCopyCond · B-1001-4)
 *   ④ 표시: 관리자 고객 목록·엑셀의 「매장코드」 = 고객 행 값 · 없으면 소속 표 코드들
 */
import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { storeMembershipClause, storeMembershipCond, storeCodeDisplayExpr } from '../store-scope';
import { buildFilterQueryCompat, buildDynamicFilterCompat, buildCustomerFilter } from '../customer-filter';
import { buildSendConsent } from '../mall-consent';

const CO = '00000000-0000-0000-0000-0000000000c1';
const MALL = '00000000-0000-0000-0000-00000000aa01';   // 자사몰 고객: 고객 행 store_code 빈 칸 · 소속 = 이로이로도쿄 · 일본이모
const UPLOAD = '00000000-0000-0000-0000-00000000bb01'; // 업로드 고객: 고객 행 store_code = A · 소속 = A
const OTHER = '00000000-0000-0000-0000-00000000cc01';  // 업로드 고객: B
const MULTI = '00000000-0000-0000-0000-00000000dd01';  // 다매장 업로드 고객: 고객 행 store_code = A(하나만) · 소속 = A · B
const SPLIT = '00000000-0000-0000-0000-00000000ee01';  // 몰 고객: 렌즈고고 거부 · 일본이모 동의(고객 행 칸 빈 칸)

async function client() {
  const db = newDb();
  db.public.none(`
    CREATE TABLE customers (id uuid PRIMARY KEY, company_id uuid, phone text, store_code text, is_active boolean, sms_opt_in boolean);
    CREATE TABLE customer_stores (company_id uuid, customer_id uuid, store_code text, sms_opt_in boolean);
    INSERT INTO customers VALUES ('${MALL}', '${CO}', '01000000001', NULL, true, true),
                                 ('${UPLOAD}', '${CO}', '01000000002', 'A', true, true),
                                 ('${OTHER}', '${CO}', '01000000003', 'B', true, true),
                                 ('${MULTI}', '${CO}', '01000000004', 'A', true, true),
                                 ('${SPLIT}', '${CO}', '01000000005', NULL, true, false);
    INSERT INTO customer_stores VALUES ('${CO}', '${MALL}', '이로이로도쿄', true), ('${CO}', '${MALL}', '일본이모', true),
                                       ('${CO}', '${UPLOAD}', 'A', NULL), ('${CO}', '${OTHER}', 'B', NULL),
                                       ('${CO}', '${MULTI}', 'A', NULL), ('${CO}', '${MULTI}', 'B', NULL),
                                       ('${CO}', '${SPLIT}', '렌즈고고', false), ('${CO}', '${SPLIT}', '일본이모', true);
  `);
  const { Client } = db.adapters.createPg();
  const c = new Client();
  await c.connect();
  return c;
}
const ids = (r: { rows: Array<{ id: string }> }) => r.rows.map((x) => x.id).sort();

describe('① 실제 실행 — 몰 고객도 브랜드로 잡힌다 · 업로드 고객은 종전과 같다', () => {
  it('관리자 고객 조회(별칭 없음 · 단일 코드) = storeMembershipClause', async () => {
    const c = await client();
    const q = (code: string) => c.query(`SELECT id FROM customers WHERE company_id = $1 AND is_active = true${storeMembershipClause({ idCol: 'id', companyRef: '$1', codeRef: '$2' })}`, [CO, code]);
    expect(ids(await q('이로이로도쿄'))).toEqual([MALL]);
    expect(ids(await q('일본이모'))).toEqual([MALL, SPLIT].sort());
    expect(ids(await q('A'))).toEqual([UPLOAD, MULTI].sort());
    expect(ids(await q('없는코드'))).toEqual([]);
  });
  it('사용자별 거르기(여러 코드 · 배열) = many', async () => {
    const c = await client();
    const r = await c.query(`SELECT id FROM customers WHERE company_id = $1${storeMembershipClause({ idCol: 'id', companyRef: '$1', codeRef: '$2', many: true })}`, [CO, ['이로이로도쿄', 'B']]);
    expect(ids(r)).toEqual([MALL, OTHER, MULTI].sort());
  });
  it('다매장 업로드 고객(고객 행 칸 = A 하나)도 B 브랜드에 잡힌다 — 옛 칸으로는 빠지던 고객(의도한 넓어짐)', async () => {
    const c = await client();
    const now = await c.query(`SELECT id FROM customers WHERE company_id = $1${storeMembershipClause({ idCol: 'id', companyRef: '$1', codeRef: '$2' })}`, [CO, 'B']);
    const old = await c.query(`SELECT id FROM customers WHERE company_id = $1 AND store_code = $2`, [CO, 'B']);
    expect(ids(now)).toEqual([OTHER, MULTI].sort());
    expect(ids(old)).toEqual([OTHER]);
  });
  it('자동 발송·미리보기(별칭 c) = storeMembershipClause(c.id)', async () => {
    const c = await client();
    const r = await c.query(`SELECT c.id FROM customers c WHERE c.company_id = $1 AND c.sms_opt_in = true${storeMembershipClause({ idCol: 'c.id', companyRef: '$1', codeRef: '$2' })}`, [CO, '일본이모']);
    expect(ids(r)).toEqual([MALL]); // SPLIT 은 고객 행 동의 false(몰 철회가 고객 행에도 내려감) → 옛 판정 경로에서 빠진다
  });
  it('캠페인 타겟 필터에 브랜드가 들어가면(호환 래퍼) 소속 표로 거른다', async () => {
    const c = await client();
    const f = buildFilterQueryCompat({ store_code: '이로이로도쿄' }, CO);
    const r = await c.query(`SELECT c.id FROM customers c WHERE c.company_id = $1 ${f.where}`, [CO, ...f.params]);
    expect(ids(r)).toEqual([MALL]);
    const f2 = buildFilterQueryCompat({ store_code: { operator: 'in', value: ['A', 'B'] } }, CO);
    const r2 = await c.query(`SELECT c.id FROM customers c WHERE c.company_id = $1 ${f2.where}`, [CO, ...f2.params]);
    expect(ids(r2)).toEqual([UPLOAD, OTHER, MULTI].sort());
  });
});

describe('①-2 몰 동의 발송 — 타겟 브랜드 조건과 그 브랜드 동의 = 같은 소속 행 (Codex R1 high)', () => {
  // campaigns.ts 미리보기와 같은 모양: 범위 [렌즈고고, 일본이모] 계정 · buildSendConsent(enforce) 가 범위 조각에 동의를 넣는다
  const run = async (target: string, storeConsent: boolean) => {
    const c = await client();
    const f = buildFilterQueryCompat({ store_code: target }, CO, { storeConsent });
    const scopeIdx = 1 + f.params.length + 1;
    const consent = buildSendConsent({
      enforce: true,
      alias: 'c',
      storeFilter: ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($${scopeIdx}::text[]))`,
    });
    expect(consent.mode).toBe('mall');
    return ids(await c.query(
      `SELECT c.id FROM customers c WHERE c.company_id = $1 AND c.is_active = true AND ${consent.customerConsent} ${f.where}${consent.storeFilter}`,
      [CO, ...f.params, ['렌즈고고', '일본이모']],
    ));
  };
  it('렌즈고고를 고르면 렌즈고고 거부 고객(일본이모만 동의)은 빠진다', async () => {
    expect(await run('렌즈고고', true)).toEqual([]);
  });
  it('일본이모를 고르면 같은 고객이 들어간다(일본이모 동의)', async () => {
    expect(await run('일본이모', true)).toEqual([MALL, SPLIT].sort());
  });
  it('반례 고정: 동의를 같은 행에서 안 보면(storeConsent 끔) 렌즈고고 거부 고객이 일본이모 동의로 통과한다', async () => {
    expect(await run('렌즈고고', false)).toEqual([SPLIT]);
  });
  it('구조형 입력(관리자 동적 필터 형식)도 storeConsent 를 같은 글자로 따른다 — 두 입력 형식 분기 모두', () => {
    const opts = { tableAlias: 'c', startParamIndex: 2, storeCodeMode: 'subquery' as const, companyIdParamRef: '$1', storeConsent: true };
    const eq = buildCustomerFilter({ store_code: { operator: 'eq', value: 'X' } }, { ...opts, inputFormat: 'structured' });
    const many = buildCustomerFilter({ store_code: { operator: 'in', value: ['X', 'Y'] } }, { ...opts, inputFormat: 'structured' });
    expect(eq.sql).toBe(' AND c.id IN (SELECT mcs.customer_id FROM customer_stores mcs WHERE mcs.company_id = $1 AND mcs.store_code = $2 AND mcs.sms_opt_in = true)');
    expect(many.sql).toBe(' AND c.id IN (SELECT mcs.customer_id FROM customer_stores mcs WHERE mcs.company_id = $1 AND mcs.store_code = ANY($2::text[]) AND mcs.sms_opt_in = true)');
    const mixed = buildCustomerFilter({ store_code: { operator: 'in', value: ['X', 'Y'] } }, { ...opts, inputFormat: 'mixed' });
    expect(mixed.sql).toBe(many.sql);
  });
  it('storeConsent 는 파라미터·자리표 번호를 바꾸지 않는다(campaigns 범위 자리표가 그대로 맞는다)', () => {
    const a = buildFilterQueryCompat({ store_code: { operator: 'in', value: ['A', 'B'] }, gender: 'F' }, CO);
    const b = buildFilterQueryCompat({ store_code: { operator: 'in', value: ['A', 'B'] }, gender: 'F' }, CO, { storeConsent: true });
    expect(b.params).toEqual(a.params);
    expect(b.nextIndex).toBe(a.nextIndex);
    expect(b.where).toContain('mcs.sms_opt_in = true');
    expect(a.where).not.toContain('sms_opt_in');
  });
  it('buildSendConsent 를 쓰는 파일은 타겟 필터에도 같은 판정(storeConsent)을 넘긴다 — campaigns 세는 곳·보내는 곳·미리보기', () => {
    const src = readFileSync(resolve(__dirname, '../../routes/campaigns.ts'), 'utf8');
    // ★ 2026-10-02 범위 없는 발송(관리자)도 몰 동의 회사면 같은 행 판정을 켠다(resolveAdminSendConsent 가 null 이 아닐 때)
    const compat = src.match(/buildFilterQueryCompat\(targetFilter, companyId(, \{ storeConsent: [^}]+ \})?\)/g) || [];
    expect(compat).toEqual([
      'buildFilterQueryCompat(targetFilter, companyId, { storeConsent: countEnforce || countAdminConsent !== null })',
      'buildFilterQueryCompat(targetFilter, companyId, { storeConsent: sendEnforce || sendAdminConsent !== null })',
      'buildFilterQueryCompat(targetFilter, companyId, { storeConsent: previewEnforce || previewAdminConsent !== null })',
    ]);
    for (const v of ['countEnforce', 'sendEnforce', 'previewEnforce']) expect(src).toContain(`enforce: ${v},`);
    for (const f of walk(SRC)) {
      const s = readFileSync(f, 'utf8');
      if (!/buildSendConsent\(\{/.test(s)) continue;
      expect((s.match(/buildFilterQueryCompat\((?![^)]*storeConsent)[^)]*\)/g) || []), f).toEqual([]);
    }
  });
  it('매장코드 표시 = 고객 행 값 · 없으면 소속 표 코드들(가나다순 · 쉼표) — pg-mem 은 SELECT 목록 상관 서브쿼리를 못 돌려 글자로 고정', () => {
    expect(storeCodeDisplayExpr('c')).toBe(
      "COALESCE(NULLIF(c.store_code, ''), (SELECT string_agg(cs.store_code, ', ' ORDER BY cs.store_code) FROM customer_stores cs WHERE cs.company_id = c.company_id AND cs.customer_id = c.id))",
    );
  });
});

describe('② 공용 필터 — direct 폐기 · 호환 래퍼 = 소속 표 · 별칭 없는 경로 종전 그대로', () => {
  it('buildFilterQueryCompat(브랜드) = c.id IN (소속 표 · $1 회사)', () => {
    const f = buildFilterQueryCompat({ store_code: 'X' }, CO);
    expect(f.where).toContain('c.id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = $2)');
    expect(f.where).not.toMatch(/c\.store_code/);
  });
  it('buildDynamicFilterCompat(관리자 동적 필터) = 종전과 같은 글자(별칭 없음 → id)', () => {
    const f = buildDynamicFilterCompat({ store_code: { operator: 'eq', value: 'X' } }, 3);
    expect(f.where).toBe(' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = $3)');
  });
  it("'direct' 모드는 형식에서도 사라졌다", () => {
    const src = readFileSync(resolve(__dirname, '../customer-filter.ts'), 'utf8');
    expect(src).toContain("storeCodeMode?: 'skip' | 'subquery';");
    expect(src).not.toContain("storeCodeMode === 'direct'");
    expect(src).not.toContain("col(alias, 'store_code')");
  });
  it('조각 함수 글자', () => {
    expect(storeMembershipCond({ idCol: 'p.customer_id', companyRef: '$1', codeRef: '$4', many: true }))
      .toBe('p.customer_id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($4::text[]))');
  });
});

const SRC = resolve(__dirname, '../..');
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== '__tests__') walk(p, out); } else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('③ 잔존 0 — 고객 행 store_code 로 브랜드를 거르는 SQL', () => {
  it('백엔드 전체에서 고객 행 store_code 로 거르는 SQL 0건 — 예외 없음(c. · customers. · customers_unified. · 별칭 없음 · = · IN ( · OR)', () => {
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      const rel = f.slice(SRC.length + 1).replace(/\\/g, '/');
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        // 다른 표의 칸(소속 표 · 회신번호 · 구매 · 자동 캠페인 자체 칸) — 표 이름이 윗줄에 있을 수 있어 3줄을 본다
        if (lines.slice(Math.max(0, i - 3), i + 1).some((l) => /customer_stores|callback_numbers/.test(l))) return;
        if (/(cs|bm|mcs|cn|p|ac|cb2?)\.store_code|\$\{hasAssignmentScope/.test(line)) return;
        if (/\b(c|customers|customers_unified)\.store_code\s*(=|<>|!=|IN\s*\()|(AND|WHERE|OR)\s+\(?store_code\s*(=\s*(ANY|\$)|IN\s*\()/.test(line)) {
          bad.push(`${rel}:${i + 1} ${line.trim().slice(0, 90)}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });
  it('수신거부 자동 등록 2곳(싱크·관리자 업로드 CT · 브랜드 사용자 업로드)이 같은 판정 함수를 쓴다', () => {
    const helper = readFileSync(resolve(SRC, 'utils/unsubscribe-helper.ts'), 'utf8');
    expect((helper.match(/\$\{brandRefusalCopyCond\(/g) || []).length).toBe(2);
    const upload = readFileSync(resolve(SRC, 'routes/upload.ts'), 'utf8');
    expect(upload).toContain("registerUploaderOwnUnsubscribes(companyId, userId, userStoreCodes, 'db_upload')");
    expect(upload).not.toMatch(/ANY\(\$3\)/);
  });
});

describe('④ 표시 — 관리자 고객 목록·엑셀 매장코드', () => {
  it('목록 SELECT 와 엑셀 동적 SELECT 가 storeCodeDisplayExpr 를 쓴다', () => {
    expect(readFileSync(resolve(SRC, 'routes/customers.ts'), 'utf8')).toContain("${storeCodeDisplayExpr('customers_unified')} AS store_code");
    expect(readFileSync(resolve(SRC, 'utils/enabled-fields.ts'), 'utf8')).toContain('parts.push(`${storeCodeDisplayExpr(tableAlias)} AS ${f.field_key}`);');
  });
});
