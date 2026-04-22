// ─────────────────────────────────────────────────────────
// build-prepaid-update-sql.js
// prepaid-company-rollup.json → companies UPDATE SQL 생성
//
//   정책: 34개 전원 이관 (0원/천원미만 포함)
//   - billing_type='prepaid'
//   - balance=<회사별 합산 잔액>
//   - psql -1 단일 트랜잭션
//   - 사전/사후 검증 쿼리 포함
//
// 출력: data/migration-prepaid-update.sql
// ─────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const rollup = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'prepaid-company-rollup.json'), 'utf8'));

const entries = Object.entries(rollup); // 잔액 내림차순

const companyIds = entries.map(([, v]) => `'${v.company_id}'`).join(',\n    ');

let sql = `-- ═══════════════════════════════════════════════════════
-- 레거시 선불 잔액 → 한줄로 companies 이관 UPDATE
-- 생성일: ${new Date().toISOString()}
-- 대상: ${entries.length}개 회사 (전원 이관 — 0원/천원미만 포함)
-- 총 잔액: ${entries.reduce((s, [, v]) => s + v.total_balance, 0).toLocaleString()}원
--
-- 실행:
--   docker cp migration-prepaid-update.sql targetup-postgres:/tmp/
--   docker exec -i targetup-postgres psql -U targetup targetup -1 -f /tmp/migration-prepaid-update.sql
-- ═══════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────
-- (1) 사전 검증: 이관 대상 회사 현재 상태 확인
--     기대: billing_type='postpaid', balance=0 (D134 생성 당시 기본값)
-- ─────────────────────────────────────────────
SELECT 'BEFORE UPDATE' AS phase, billing_type, COUNT(*) AS cnt, SUM(balance) AS sum_balance
FROM companies
WHERE id IN (
    ${companyIds}
)
GROUP BY billing_type;

-- ─────────────────────────────────────────────
-- (2) UPDATE ${entries.length}개 회사 — billing_type='prepaid' + balance
-- ─────────────────────────────────────────────
`;

for (const [code, v] of entries) {
  const uidList = v.userids.map((x) => `${x.userid}=${x.balance.toLocaleString()}원`).join(' + ');
  sql += `-- ${code.padEnd(16)} | ${v.company_name} | ${v.is_multi ? '다중' : '단독'} | ${uidList}\n`;
  sql += `UPDATE companies SET billing_type='prepaid', balance=${v.total_balance}, updated_at=NOW() WHERE id='${v.company_id}';\n\n`;
}

sql += `-- ─────────────────────────────────────────────
-- (3) 사후 검증
-- ─────────────────────────────────────────────
-- 이관 대상 34개의 billing_type / balance 분포
SELECT 'AFTER UPDATE' AS phase, billing_type, COUNT(*) AS cnt, SUM(balance) AS sum_balance
FROM companies
WHERE id IN (
    ${companyIds}
)
GROUP BY billing_type;

-- 상위 10개 회사 확인
SELECT company_code, company_name, billing_type, balance
FROM companies
WHERE id IN (
    ${companyIds}
)
ORDER BY balance DESC
LIMIT 15;

-- 합계 확인 (기대: 20,398,110원)
SELECT 'TOTAL PREPAID BALANCE (migrated)' AS metric,
       COUNT(*) AS cnt,
       SUM(balance) AS total_balance
FROM companies
WHERE id IN (
    ${companyIds}
);

COMMIT;
`;

const outPath = path.join(DATA_DIR, 'migration-prepaid-update.sql');
fs.writeFileSync(outPath, sql, 'utf8');

console.log('═══════════════════════════════════════════════');
console.log('  선불 잔액 UPDATE SQL 생성 완료');
console.log('═══════════════════════════════════════════════');
console.log(`  대상 회사   : ${entries.length}개`);
console.log(`  총 잔액     : ${entries.reduce((s, [, v]) => s + v.total_balance, 0).toLocaleString()}원`);
console.log(`  단독/다중   : ${entries.filter(([, v]) => !v.is_multi).length} / ${entries.filter(([, v]) => v.is_multi).length}`);
console.log();
console.log(`  출력: ${outPath}`);
console.log(`  크기: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
