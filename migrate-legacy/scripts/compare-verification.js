// ─────────────────────────────────────────────────────────
// compare-verification.js
// expected-per-user.json ↔ verify_actual.csv 비교
// 입력: data/verify_actual.csv  (login_id|company_code|user_type|unsub_cnt|cb_assign_cnt)
// 출력: 콘솔에 불일치 리포트 + data/verification-report.json
// ─────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const expected = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'expected-per-user.json'), 'utf8'));
const actualCsv = fs.readFileSync(path.join(DATA_DIR, 'verify_actual.csv'), 'utf8');

const actual = {};
for (const line of actualCsv.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const [loginId, companyCode, userType, unsubStr, cbStr] = line.split('|');
  actual[loginId] = {
    company_code: companyCode,
    user_type: userType,
    unsub_cnt: parseInt(unsubStr, 10),
    cb_assign_cnt: parseInt(cbStr, 10),
  };
}

const expectedLogins = new Set(Object.keys(expected));
const actualLogins = new Set(Object.keys(actual));

const missingInActual = [...expectedLogins].filter((l) => !actualLogins.has(l));
const extraInActual = [...actualLogins].filter((l) => !expectedLogins.has(l));

const mismatches = [];
let pass = 0;
for (const loginId of expectedLogins) {
  if (!actualLogins.has(loginId)) continue;
  const e = expected[loginId];
  const a = actual[loginId];
  if (e.unsub_cnt !== a.unsub_cnt || e.cb_assign_cnt !== a.cb_assign_cnt) {
    mismatches.push({
      login_id: loginId,
      company_code: e.company_code,
      user_type: e.user_type,
      expected: { unsub: e.unsub_cnt, cb: e.cb_assign_cnt },
      actual: { unsub: a.unsub_cnt, cb: a.cb_assign_cnt },
      diff: {
        unsub: a.unsub_cnt - e.unsub_cnt,
        cb: a.cb_assign_cnt - e.cb_assign_cnt,
      },
    });
  } else {
    pass++;
  }
}

const total = expectedLogins.size;
const report = {
  generated_at: new Date().toISOString(),
  total_expected: total,
  total_actual: actualLogins.size,
  pass_count: pass,
  mismatch_count: mismatches.length,
  missing_in_db: missingInActual,
  extra_in_db: extraInActual,
  mismatches,
};

fs.writeFileSync(path.join(DATA_DIR, 'verification-report.json'), JSON.stringify(report, null, 2));

console.log('═══════════════════════════════════════════════');
console.log('  정합성 비교 결과');
console.log('═══════════════════════════════════════════════');
console.log(`  expected login_id  : ${total}`);
console.log(`  actual DB login_id : ${actualLogins.size}`);
console.log(`  ✅ PASS             : ${pass}/${total}`);
console.log(`  ❌ MISMATCH         : ${mismatches.length}`);
console.log(`  ⚠️  DB에 없음(expected 있음) : ${missingInActual.length}`);
console.log(`  ⚠️  expected에 없음(DB 있음) : ${extraInActual.length}`);
console.log();

if (mismatches.length > 0) {
  console.log('[불일치 리스트]');
  console.log('login_id         company         type   expected(u/cb)     actual(u/cb)       diff');
  console.log('─'.repeat(100));
  for (const m of mismatches) {
    console.log(
      `${m.login_id.padEnd(16)} ${m.company_code.padEnd(14)} ${m.user_type.padEnd(6)} ${String(m.expected.unsub).padStart(6)}/${String(m.expected.cb).padStart(4)}       ${String(m.actual.unsub).padStart(6)}/${String(m.actual.cb).padStart(4)}       unsub${m.diff.unsub >= 0 ? '+' : ''}${m.diff.unsub}  cb${m.diff.cb >= 0 ? '+' : ''}${m.diff.cb}`
    );
  }
  console.log();
}

if (missingInActual.length > 0) {
  console.log('[DB에 없음 (expected에만 존재)]');
  console.log('  ' + missingInActual.join(', '));
  console.log();
}

if (extraInActual.length > 0) {
  console.log('[expected에 없음 (DB에만 존재)]');
  console.log('  ' + extraInActual.join(', '));
  console.log();
}

if (mismatches.length === 0 && missingInActual.length === 0 && extraInActual.length === 0) {
  console.log('🎯 모든 login_id의 unsub_cnt / cb_assign_cnt 완전 일치. 이관 정합성 PASS.');
}

console.log();
console.log(`상세 리포트: ${path.join(DATA_DIR, 'verification-report.json')}`);
