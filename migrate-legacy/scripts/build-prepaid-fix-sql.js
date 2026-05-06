// ─────────────────────────────────────────────────────────
// build-prepaid-fix-sql.js
// D143 이관 시 analyze-prepaid.js의 Math.floor로 절삭된 소수점을 보정.
//
// 입력:
//   - data/prepaid_balance.csv (USERID|NAME|CHARGED|USED|BALANCE)
//   - data/user-map.json
//
// 출력:
//   - 회사별 보정 UPDATE SQL (콘솔 + data/prepaid-fix.sql)
//
// 사용:
//   node migrate-legacy/scripts/build-prepaid-fix-sql.js
// ─────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const csvPath = path.join(DATA_DIR, 'prepaid_balance.csv');
const userMap = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'user-map.json'), 'utf8'));

const raw = fs.readFileSync(csvPath, 'utf8');
const lines = raw.split(/\r?\n/).filter((l) => l.trim() && !/^USERID/i.test(l));

// 회사별 절삭분 합산
const byCompany = {}; // company_id → { name, fractional_total }

const unmapped = [];
for (const line of lines) {
  const parts = line.split('|').map((s) => s.trim());
  if (parts.length < 5) continue;
  const [userid, name, , , balanceStr] = parts;
  const u = userMap[userid];
  if (!u) {
    unmapped.push(userid);
    continue;
  }
  const balanceFloat = parseFloat(String(balanceStr).replace(/[^0-9.-]/g, '')) || 0;
  const balanceFloor = Math.floor(balanceFloat);
  const fractional = +(balanceFloat - balanceFloor).toFixed(2); // 소수점 2자리

  if (fractional === 0) continue; // 정수면 보정 불필요

  const cid = u.company_id;
  if (!byCompany[cid]) {
    byCompany[cid] = { company_name: u.company_name || u.legacy_name || name, fractional_total: 0, userids: [] };
  }
  byCompany[cid].fractional_total = +(byCompany[cid].fractional_total + fractional).toFixed(2);
  byCompany[cid].userids.push({ userid, fractional });
}

// 정렬
const sorted = Object.entries(byCompany).sort((a, b) => b[1].fractional_total - a[1].fractional_total);

// SQL 출력
const sqlLines = [
  '-- ═══════════════════════════════════════════════════════════',
  '-- 선불잔액 소수점 절삭 보정 (D143 → D144, 2026-05-06)',
  '-- 원인: analyze-prepaid.js Math.floor 적용으로 회사별 0.x원 절삭',
  '-- 보정: companies.balance(numeric(15,2))에 절삭분 합산 + α',
  `-- 회사 수: ${sorted.length}개`,
  `-- 총 보정액: ${sorted.reduce((s, [, v]) => s + v.fractional_total, 0).toFixed(2)}원`,
  '-- ═══════════════════════════════════════════════════════════',
  '',
  'BEGIN;',
  '',
];

let totalFix = 0;
for (const [cid, v] of sorted) {
  const uidStr = v.userids.map((x) => `${x.userid}:+${x.fractional}`).join(', ');
  sqlLines.push(`-- ${v.company_name} (${uidStr})`);
  sqlLines.push(`UPDATE companies SET balance = balance + ${v.fractional_total} WHERE id = '${cid}';`);
  sqlLines.push('');
  totalFix += v.fractional_total;
}

sqlLines.push('-- 사후 검증 (보정 결과 확인)');
sqlLines.push("SELECT id, name, balance FROM companies WHERE id IN (");
sqlLines.push(sorted.map(([cid]) => `  '${cid}'`).join(',\n'));
sqlLines.push(') ORDER BY balance DESC;');
sqlLines.push('');
sqlLines.push('-- 문제 없으면: COMMIT;');
sqlLines.push('-- 문제 있으면: ROLLBACK;');
sqlLines.push('');

const outSql = path.join(DATA_DIR, 'prepaid-fix.sql');
fs.writeFileSync(outSql, sqlLines.join('\n'));

// 요약 출력
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  선불잔액 소수점 보정 SQL 생성 완료`);
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  대상 회사: ${sorted.length}개`);
console.log(`  총 보정액: ${totalFix.toFixed(2)}원`);
console.log('───────────────────────────────────────────────────────────────');
console.log('회사별 보정값 (Top 10):');
sorted.slice(0, 10).forEach(([cid, v]) => {
  console.log(`  +${v.fractional_total.toFixed(2)}원  ${v.company_name}  (${cid})`);
});
if (unmapped.length > 0) {
  console.log(`\n⚠️ user-map 매핑 안 된 USERID: ${unmapped.join(', ')}`);
}
console.log(`\n출력 파일: ${outSql}`);
console.log('\n다음: docker exec -i targetup-postgres psql -U targetup targetup < /path/to/prepaid-fix.sql');
