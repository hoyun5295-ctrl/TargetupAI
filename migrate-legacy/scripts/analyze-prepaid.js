// ─────────────────────────────────────────────────────────
// analyze-prepaid.js
// CSV(파이프 구분: USERID|NAME|CHARGED|USED|BALANCE) → 회사별 합산
//
// 입력: data/prepaid_balance.csv  (D-Day sqlplus @query-prepaid-dump.sql 결과)
//       또는 argv[2]로 경로 지정
// 출력: data/prepaid-company-rollup.json
//
// D-Day 사용법:
//   1) Oracle sqlplus @/tmp/query-prepaid-dump.sql → /tmp/prepaid_balance.csv
//   2) 로컬로 scp → migrate-legacy/data/prepaid_balance.csv
//   3) node migrate-legacy/scripts/analyze-prepaid.js
//   4) node migrate-legacy/scripts/build-prepaid-update-sql.js
//
// 4/22 스냅샷 참고: data/prepaid_snapshot_20260422.csv (보존)
// ─────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const userMap = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'user-map.json'), 'utf8'));
const companySummary = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'company-summary.json'), 'utf8'));

// CSV 경로 — argv 우선, 없으면 기본값
const csvPath = process.argv[2] || path.join(DATA_DIR, 'prepaid_balance.csv');
if (!fs.existsSync(csvPath)) {
  console.error(`❌ CSV 파일 없음: ${csvPath}`);
  console.error('   D-Day 절차: sqlplus @query-prepaid-dump.sql → scp로 로컬 전송 후 이 스크립트 실행');
  console.error('   또는 node analyze-prepaid.js <경로> 로 경로 지정');
  process.exit(1);
}

// ─────────────────────────────────────────────
// CSV 파싱 (USERID|NAME|CHARGED|USED|BALANCE)
// ─────────────────────────────────────────────
const PREPAID = [];
const raw = fs.readFileSync(csvPath, 'utf8');
for (const line of raw.split(/\r?\n/)) {
  const t = line.trim();
  if (!t) continue;
  // 헤더 스킵
  if (/^USERID\s*\|/i.test(t)) continue;
  const parts = t.split('|').map((s) => s.trim());
  if (parts.length < 5) continue;
  const [userid, name, chargedStr, usedStr, balanceStr] = parts;
  const charged = parseInt(String(chargedStr).replace(/[^0-9-]/g, ''), 10);
  const used = parseInt(String(usedStr).replace(/[^0-9-]/g, ''), 10);
  const balance = parseInt(String(balanceStr).replace(/[^0-9-]/g, ''), 10);
  if (Number.isNaN(charged) || Number.isNaN(used) || Number.isNaN(balance)) continue;
  PREPAID.push({ userid, name, charged, used, balance });
}

if (PREPAID.length === 0) {
  console.error(`❌ CSV에서 유효한 레코드를 읽지 못했습니다: ${csvPath}`);
  process.exit(1);
}

// ─────────────────────────────────────────────
// 회사별 합산
// ─────────────────────────────────────────────
const byCompany = {};
const unknown = [];
for (const row of PREPAID) {
  const u = userMap[row.userid];
  if (!u) { unknown.push(row.userid); continue; }
  const code = u.company_code;
  if (!byCompany[code]) {
    const s = companySummary[code];
    byCompany[code] = {
      company_id: u.company_id,
      company_name: s?.company_name || '(unknown)',
      is_multi: s?.is_multi || false,
      userids: [],
      total_balance: 0,
      total_charged: 0,
      total_used: 0,
    };
  }
  byCompany[code].userids.push({ userid: row.userid, balance: row.balance, charged: row.charged, used: row.used });
  byCompany[code].total_balance += row.balance;
  byCompany[code].total_charged += row.charged;
  byCompany[code].total_used += row.used;
}

// 내림차순 정렬
const sorted = Object.entries(byCompany).sort((a, b) => b[1].total_balance - a[1].total_balance);
const outJson = path.join(DATA_DIR, 'prepaid-company-rollup.json');
fs.writeFileSync(outJson, JSON.stringify(Object.fromEntries(sorted), null, 2));

const total = sorted.reduce((s, [, v]) => s + v.total_balance, 0);
const totalRaw = PREPAID.reduce((s, r) => s + r.balance, 0);

console.log('═══════════════════════════════════════════════════════════════════');
console.log(`  레거시 선불 잔액 → 한줄로 회사별 합산`);
console.log(`  CSV: ${csvPath}`);
console.log('═══════════════════════════════════════════════════════════════════');
console.log('rank | code            | company_name                        | mul | USERID        | balance');
console.log('-----+-----------------+-------------------------------------+-----+---------------+------------');
sorted.forEach(([code, v], i) => {
  const uids = v.userids.map((x) => x.userid).join(',');
  console.log(
    `${String(i + 1).padStart(3)}  | ${code.padEnd(15)} | ${v.company_name.padEnd(35)} | ${(v.is_multi ? '다중' : '단독').padEnd(3)} | ${String(v.userids.length).padStart(2)}명 (${uids})`
  );
  console.log(`     |                 |                                     |     | → balance: ${v.total_balance.toLocaleString()}원`);
});
console.log('-----+-----------------+-------------------------------------+-----+---------------+------------');
console.log(`  합계: ${total.toLocaleString()}원 (회사별 ${sorted.length}곳)`);
console.log(`  CSV SUM: ${totalRaw.toLocaleString()}원 → 일치 여부: ${total === totalRaw ? '✅' : '❌'}`);
console.log(`  단독/다중: ${sorted.filter(([, v]) => !v.is_multi).length} / ${sorted.filter(([, v]) => v.is_multi).length}`);
if (unknown.length) console.log(`  ⚠️ user-map에 없는 USERID: ${unknown.join(', ')}`);
console.log();
console.log(`  출력: ${outJson}`);
console.log(`  다음: node migrate-legacy/scripts/build-prepaid-update-sql.js`);
