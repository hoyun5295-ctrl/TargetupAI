// ═══════════════════════════════════════════════════════
// D143 차분 — BLOCKEDNUM 4/22~5/5 신규 수신거부 이관 SQL 생성
// 입력:
//   - migrate-legacy/data/legacy_blockednum.csv      (4/22 추출본)
//   - migrate-legacy/data/legacy_blockednum_d143.csv (5/5 추출본)
//   - migrate-legacy/data/user-map.json
//   - migrate-legacy/data/company-summary.json
// 출력:
//   - migrate-legacy/data/migration-blockednum-d143-diff.sql
//
// D135 정책 일관 (build-migration-sql.js Phase 3-B 그대로):
//   - 각 user_id에 직접 INSERT (DISTINCT user_id+phone)
//   - 다중회사(is_multi=true) → admin user_id에 합집합 INSERT
//   - source = 'legacy_migration_d143' (D135 source와 분리)
// ═══════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const CSV_422 = path.join(ROOT, 'migrate-legacy/data/legacy_blockednum.csv');
const CSV_55 = path.join(ROOT, 'migrate-legacy/data/legacy_blockednum_d143.csv');
const USER_MAP_PATH = path.join(ROOT, 'migrate-legacy/data/user-map.json');
const COMPANY_SUMMARY_PATH = path.join(ROOT, 'migrate-legacy/data/company-summary.json');
const OUT_PATH = path.join(ROOT, 'migrate-legacy/data/migration-blockednum-d143-diff.sql');

const SOURCE = 'legacy_d143';  // varchar(20) 제약상 21자 'legacy_migration_d143' 사용 불가
const BATCH = 5000;

const userMap = JSON.parse(fs.readFileSync(USER_MAP_PATH, 'utf8'));
const companySummary = JSON.parse(fs.readFileSync(COMPANY_SUMMARY_PATH, 'utf8'));

function parsePairs(csv) {
  const set = new Set();
  let skippedTooLong = 0;
  for (const line of csv.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || !t.includes('|')) continue;
    if (t.startsWith('SQL>') || t.startsWith('SELECT') || t.startsWith('FROM') ||
        t.startsWith('WHERE') || t.startsWith('AND') || t.startsWith('SPOOL')) continue;
    const parts = t.split('|');
    const userid = parts[0]?.trim();
    const phone = parts[1]?.trim();
    if (!userid || !phone || !/^\d+$/.test(phone)) continue;
    // phone 컬럼 varchar(20) 제약 — 20자 초과는 잘못된 입력 (두 번호 결합 등) → 스킵
    if (phone.length > 20) { skippedTooLong++; continue; }
    set.add(userid + '|' + phone);
  }
  if (skippedTooLong > 0) console.log(`  (스킵 ${skippedTooLong}건: phone length > 20)`);
  return set;
}

const set422 = parsePairs(fs.readFileSync(CSV_422, 'utf8'));
const set55 = parsePairs(fs.readFileSync(CSV_55, 'utf8'));

const newPairs = [];
for (const k of set55) if (!set422.has(k)) newPairs.push(k);

console.log(`[ DIFF ]`);
console.log(`  4/22 unique: ${set422.size}`);
console.log(`  5/5 unique: ${set55.size}`);
console.log(`  신규: ${newPairs.length}`);

// 한줄로 매핑
const unsubPairs = new Map();
let unmapped = 0;
const unmappedUserids = new Set();

for (const k of newPairs) {
  const [userid, phone] = k.split('|');
  const u = userMap[userid];
  if (!u) { unmapped++; unmappedUserids.add(userid); continue; }
  const key = `${u.user_id}|${phone}`;
  if (!unsubPairs.has(key)) {
    unsubPairs.set(key, { company_id: u.company_id, user_id: u.user_id, phone });
  }
}

if (unmapped > 0) {
  console.error(`✗ Unmapped USERID(s): ${[...unmappedUserids].join(', ')} (총 ${unmapped}건)`);
  process.exit(1);
}

const directCount = unsubPairs.size;
console.log(`  직접 INSERT (각 user_id): ${directCount}`);

// 다중회사 admin 합집합
let adminAdded = 0;
const adminAddedByCompany = {};
for (const [code, s] of Object.entries(companySummary)) {
  if (!s.is_multi) continue;
  const adminUserId = s.admin_user_ids?.[0];
  if (!adminUserId) continue;
  const companyUserIds = new Set(
    (s.user_login_ids || []).map((l) => userMap[l]?.user_id).filter(Boolean)
  );
  // 차분 안에서 이 회사 user들의 phone 집합
  const phonesInDiff = new Set();
  for (const row of unsubPairs.values()) {
    if (companyUserIds.has(row.user_id)) {
      phonesInDiff.add(row.phone);
    }
  }
  for (const phone of phonesInDiff) {
    const adminKey = `${adminUserId}|${phone}`;
    if (!unsubPairs.has(adminKey)) {
      unsubPairs.set(adminKey, { company_id: s.company_id, user_id: adminUserId, phone });
      adminAdded++;
      adminAddedByCompany[code] = (adminAddedByCompany[code] || 0) + 1;
    }
  }
}

console.log(`  다중회사 admin 합집합: ${adminAdded}`);
for (const [code, n] of Object.entries(adminAddedByCompany)) {
  console.log(`    - ${code}: +${n}`);
}
console.log(`  총 INSERT: ${unsubPairs.size}`);

// SQL 생성
const inserts = [];
for (const row of unsubPairs.values()) {
  const id = crypto.randomUUID();
  inserts.push(`  ('${id}', '${row.company_id}', '${row.user_id}', '${row.phone}', '${SOURCE}', NOW())`);
}

const batches = [];
for (let i = 0; i < inserts.length; i += BATCH) {
  batches.push(inserts.slice(i, i + BATCH));
}

const now = new Date().toISOString();
const sqlParts = [];
sqlParts.push(`-- ═══════════════════════════════════════════════════════
-- D143 차분 — BLOCKEDNUM 4/22~5/5 신규 수신거부 이관
-- 생성일: ${now}
--
-- 입력:
--   legacy_blockednum.csv (4/22) - 329,292행 spool / unique pair ${set422.size}
--   legacy_blockednum_d143.csv (5/5) - 338,360행 spool / unique pair ${set55.size}
--
-- 신규 (USERID,phone) 차분: ${newPairs.length}건
--   ├─ 직접 INSERT (각 user_id)        : ${directCount}건
--   └─ 다중회사 admin 합집합           : ${adminAdded}건
-- 총 INSERT: ${unsubPairs.size}건
-- source = '${SOURCE}'
--
-- 실행:
--   docker cp migration-blockednum-d143-diff.sql targetup-postgres:/tmp/
--   docker exec -i targetup-postgres psql -U targetup targetup -1 -f /tmp/migration-blockednum-d143-diff.sql
-- ═══════════════════════════════════════════════════════

BEGIN;

-- 사전 검증
SELECT 'BEFORE' AS phase, source, COUNT(*) AS cnt
FROM unsubscribes
WHERE source IN ('legacy_migration', '${SOURCE}')
GROUP BY source
ORDER BY source;
`);

batches.forEach((batch, idx) => {
  sqlParts.push(`
-- unsubscribes batch ${idx + 1}/${batches.length} (${batch.length} rows)
INSERT INTO unsubscribes (id, company_id, user_id, phone, source, created_at) VALUES
${batch.join(',\n')}
ON CONFLICT (user_id, phone) DO NOTHING;
`);
});

sqlParts.push(`
-- 사후 검증
SELECT 'AFTER' AS phase, source, COUNT(*) AS cnt
FROM unsubscribes
WHERE source IN ('legacy_migration', '${SOURCE}')
GROUP BY source
ORDER BY source;

COMMIT;
`);

fs.writeFileSync(OUT_PATH, sqlParts.join('\n'), 'utf8');
console.log(`\nSaved: ${OUT_PATH}`);
console.log(`Size: ${fs.statSync(OUT_PATH).size} bytes`);
