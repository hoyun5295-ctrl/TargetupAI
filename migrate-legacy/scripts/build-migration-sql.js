// ─────────────────────────────────────────────────────────
// build-migration-sql.js
// CSV + 매핑 JSON → PostgreSQL INSERT SQL 생성
//
//   Phase 3-A: callback_numbers + callback_number_assignments
//       - company_id 기준 DISTINCT phone
//       - 단독회사 scope='all', 다중회사 scope='assigned'
//       - 다중회사만 assignments 배정
//
//   Phase 3-B: unsubscribes
//       - 각 user_id에 INSERT
//       - 다중회사는 admin user_id에도 합집합 INSERT (D88 정책)
//       - ON CONFLICT (user_id, phone) DO NOTHING
//       - source='legacy_migration'
//
// 출력:
//   data/migration-callbacks.sql
//   data/migration-unsubscribes.sql
//   data/migration-summary.json
// ─────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
const userMap = load('user-map.json');
const companySummary = load('company-summary.json');

// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────
function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 8 || d.length > 13) return null;
  return d;
}

function readPipeCsv(file, expectedCols) {
  const rows = [];
  const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    if (parts.length < expectedCols) continue;
    rows.push(parts);
  }
  return rows;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// company_id → company_code 역맵
const companyIdToCode = Object.fromEntries(
  Object.entries(companySummary).map(([code, s]) => [s.company_id, code])
);

// ─────────────────────────────────────────────
// Phase 3-A: 회신번호
// ─────────────────────────────────────────────
const memberSendNum = readPipeCsv('legacy_member_send_num.csv', 2);

// callbackByCompany[company_id][phone] = { uuid, userids: Set<login_id> }
const callbackByCompany = {};
let sendSkipped = 0, sendUnmapped = 0;

for (const [userid, rawPhone] of memberSendNum) {
  const phone = normalizePhone(rawPhone);
  if (!phone) { sendSkipped++; continue; }
  const u = userMap[userid];
  if (!u) { sendUnmapped++; continue; }
  const cid = u.company_id;
  if (!callbackByCompany[cid]) callbackByCompany[cid] = {};
  if (!callbackByCompany[cid][phone]) {
    callbackByCompany[cid][phone] = { uuid: crypto.randomUUID(), userids: new Set() };
  }
  callbackByCompany[cid][phone].userids.add(userid);
}

// callback_numbers rows
const callbackNumberRows = [];
// callback_number_assignments rows (다중회사만)
const assignmentRows = [];

let countSoloCompanies = 0, countMultiCompanies = 0;
for (const [cid, phones] of Object.entries(callbackByCompany)) {
  const code = companyIdToCode[cid];
  const isMulti = companySummary[code]?.is_multi || false;
  const scope = isMulti ? 'assigned' : 'all';
  if (isMulti) countMultiCompanies++; else countSoloCompanies++;
  for (const [phone, info] of Object.entries(phones)) {
    callbackNumberRows.push({
      id: info.uuid,
      company_id: cid,
      phone,
      label: '레거시',
      is_default: false,
      scope,
    });
    if (isMulti) {
      const adminUserId = companySummary[code]?.admin_user_ids?.[0];
      if (!adminUserId) {
        throw new Error(`다중회사 ${code}의 admin_user_id 누락`);
      }
      for (const userid of info.userids) {
        const u = userMap[userid];
        if (!u) continue;
        assignmentRows.push({
          id: crypto.randomUUID(),
          callback_number_id: info.uuid,
          user_id: u.user_id,
          assigned_by: adminUserId,
        });
      }
    }
  }
}

// ─────────────────────────────────────────────
// Phase 3-B: 수신거부
// ─────────────────────────────────────────────
const blockedNum = readPipeCsv('legacy_blockednum.csv', 2);

// unsubPairs: Map<"user_id|phone", { company_id, user_id, phone }>
const unsubPairs = new Map();
let blockSkipped = 0, blockUnmapped = 0;

for (const [userid, rawPhone] of blockedNum) {
  const phone = normalizePhone(rawPhone);
  if (!phone) { blockSkipped++; continue; }
  const u = userMap[userid];
  if (!u) { blockUnmapped++; continue; }
  const key = `${u.user_id}|${phone}`;
  if (!unsubPairs.has(key)) {
    unsubPairs.set(key, {
      company_id: u.company_id,
      user_id: u.user_id,
      phone,
    });
  }
}

const unsubDirectRowCount = unsubPairs.size;

// 다중회사 admin 합집합 INSERT
//   - 해당 회사 소속 user의 phone 집합 → admin_user_id에 복제
for (const [code, s] of Object.entries(companySummary)) {
  if (!s.is_multi) continue;
  const adminUserId = s.admin_user_ids[0];
  if (!adminUserId) continue;
  // 이 회사의 user_login_ids → user_id 집합
  const companyUserIds = new Set(
    s.user_login_ids.map((l) => userMap[l]?.user_id).filter(Boolean)
  );
  // unsubPairs에서 이 company user의 phone 추출
  for (const [key, row] of unsubPairs) {
    if (companyUserIds.has(row.user_id)) {
      const adminKey = `${adminUserId}|${row.phone}`;
      if (!unsubPairs.has(adminKey)) {
        unsubPairs.set(adminKey, {
          company_id: s.company_id,
          user_id: adminUserId,
          phone: row.phone,
        });
      }
    }
  }
}

const unsubRows = [];
for (const row of unsubPairs.values()) {
  unsubRows.push({
    id: crypto.randomUUID(),
    ...row,
    source: 'legacy_migration',
  });
}
const unsubAdminAddedCount = unsubRows.length - unsubDirectRowCount;

// ─────────────────────────────────────────────
// SQL 포맷터
// ─────────────────────────────────────────────
function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function buildBatchedInsert(table, columns, rows, batchSize = 5000) {
  if (rows.length === 0) return `-- (no rows for ${table})\n`;
  let out = '';
  const batches = chunk(rows, batchSize);
  const colList = columns.map((c) => c.name).join(', ');
  batches.forEach((batch, i) => {
    out += `-- ${table} batch ${i + 1}/${batches.length} (${batch.length} rows)\n`;
    out += `INSERT INTO ${table} (${colList}) VALUES\n`;
    const lines = batch.map((row) => {
      const vals = columns.map((c) => {
        const raw = row[c.key];
        if (c.type === 'bool') return String(Boolean(raw));
        if (c.type === 'now') return 'NOW()';
        return sqlStr(raw);
      });
      return `  (${vals.join(', ')})`;
    });
    out += lines.join(',\n');
    // ON CONFLICT 처리
    //   - callback_number_assignments: UNIQUE(callback_number_id, user_id) 실존 → ON CONFLICT 사용
    //   - unsubscribes: DB에 UNIQUE 제약 없음 (SCHEMA.md 불일치 확인 D135) → ON CONFLICT 불가, JS Map으로 이미 DISTINCT
    //   - callback_numbers: UNIQUE 없음, JS로 이미 DISTINCT
    if (table === 'callback_number_assignments') {
      out += `\nON CONFLICT (callback_number_id, user_id) DO NOTHING;\n\n`;
    } else {
      out += `;\n\n`;
    }
  });
  return out;
}

// ─────────────────────────────────────────────
// Phase 3-A SQL 파일 작성
// ─────────────────────────────────────────────
let sqlA = `-- ═══════════════════════════════════════════════════════
-- 레거시 이관 — Phase 3-A: 회신번호 (callback_numbers + assignments)
-- 생성일: ${new Date().toISOString()}
--
-- callback_numbers       : ${callbackNumberRows.length}건 (단독 scope='all', 다중 scope='assigned')
-- callback_number_assignments (다중회사만): ${assignmentRows.length}건
--
-- 실행:
--   docker cp migration-callbacks.sql targetup-postgres:/tmp/
--   docker exec -i targetup-postgres psql -U targetup targetup -1 -f /tmp/migration-callbacks.sql
-- ═══════════════════════════════════════════════════════

BEGIN;

`;

sqlA += buildBatchedInsert('callback_numbers',
  [
    { key: 'id', name: 'id' },
    { key: 'company_id', name: 'company_id' },
    { key: 'phone', name: 'phone' },
    { key: 'label', name: 'label' },
    { key: 'is_default', name: 'is_default', type: 'bool' },
    { key: 'scope', name: 'assignment_scope' },
    { key: '_created', name: 'created_at', type: 'now' },
  ],
  callbackNumberRows,
  5000
);

sqlA += buildBatchedInsert('callback_number_assignments',
  [
    { key: 'id', name: 'id' },
    { key: 'callback_number_id', name: 'callback_number_id' },
    { key: 'user_id', name: 'user_id' },
    { key: 'assigned_by', name: 'assigned_by' },
    { key: '_created', name: 'created_at', type: 'now' },
  ],
  assignmentRows,
  5000
);

sqlA += `
-- 검증
SELECT 'callback_numbers (label=레거시)'    AS TB, COUNT(*) AS CNT FROM callback_numbers WHERE label='레거시'
UNION ALL
SELECT 'callback_number_assignments (레거시)' AS TB, COUNT(*) AS CNT
FROM callback_number_assignments cna
JOIN callback_numbers cn ON cna.callback_number_id = cn.id
WHERE cn.label='레거시';

COMMIT;
`;

fs.writeFileSync(path.join(DATA_DIR, 'migration-callbacks.sql'), sqlA, 'utf8');

// ─────────────────────────────────────────────
// Phase 3-B SQL 파일 작성
// ─────────────────────────────────────────────
let sqlB = `-- ═══════════════════════════════════════════════════════
-- 레거시 이관 — Phase 3-B: 수신거부 (unsubscribes)
-- 생성일: ${new Date().toISOString()}
--
-- unsubscribes 총 ${unsubRows.length}건
--   ├─ 각 user_id에 직접 INSERT : ${unsubDirectRowCount}건
--   └─ 다중회사 admin 합집합    : ${unsubAdminAddedCount}건
-- source = 'legacy_migration'
-- DISTINCT(user_id, phone) 은 JS Map에서 이미 처리됨 (실제 DB에 UNIQUE 제약 없음)
--
-- 실행:
--   docker cp migration-unsubscribes.sql targetup-postgres:/tmp/
--   docker exec -i targetup-postgres psql -U targetup targetup -1 -f /tmp/migration-unsubscribes.sql
-- ═══════════════════════════════════════════════════════

BEGIN;

`;

sqlB += buildBatchedInsert('unsubscribes',
  [
    { key: 'id', name: 'id' },
    { key: 'company_id', name: 'company_id' },
    { key: 'user_id', name: 'user_id' },
    { key: 'phone', name: 'phone' },
    { key: 'source', name: 'source' },
    { key: '_created', name: 'created_at', type: 'now' },
  ],
  unsubRows,
  5000
);

sqlB += `
-- 검증
SELECT 'unsubscribes (source=legacy_migration)' AS TB, COUNT(*) AS CNT
FROM unsubscribes WHERE source='legacy_migration';

COMMIT;
`;

fs.writeFileSync(path.join(DATA_DIR, 'migration-unsubscribes.sql'), sqlB, 'utf8');

// ─────────────────────────────────────────────
// 요약
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Per-user expected (정합성 검증용)
// ─────────────────────────────────────────────
// user_id → login_id 역매핑
const userIdToLogin = {};
for (const [loginId, u] of Object.entries(userMap)) {
  userIdToLogin[u.user_id] = loginId;
}

// expected[login_id] = { company_code, user_type, unsub: Set<phone>, cb_assign: Set<phone> }
const expected = {};
function ensureLogin(loginId) {
  if (!expected[loginId]) {
    const u = userMap[loginId];
    expected[loginId] = {
      company_code: u.company_code,
      user_type: u.user_type,
      unsub: new Set(),
      cb_assign: new Set(),
    };
  }
  return expected[loginId];
}

// 모든 매핑 user를 expected에 프리로드(0건 보유자도 포함)
for (const loginId of Object.keys(userMap)) ensureLogin(loginId);

// unsubscribes 예상치 — 최종 INSERT row 기준 역산
// unsubRows: 각 row는 user_id+phone
for (const row of unsubRows) {
  const loginId = userIdToLogin[row.user_id];
  if (!loginId) continue;
  ensureLogin(loginId).unsub.add(row.phone);
}

// callback assignment 예상치 — assignment row 기준
// assignmentRows: user_id+callback_number_id → callback_numbers에서 phone 조회
const cbIdToPhone = {};
for (const row of callbackNumberRows) cbIdToPhone[row.id] = row.phone;
for (const row of assignmentRows) {
  const loginId = userIdToLogin[row.user_id];
  if (!loginId) continue;
  const phone = cbIdToPhone[row.callback_number_id];
  if (phone) ensureLogin(loginId).cb_assign.add(phone);
}

// JSON 직렬화용 변환
const expectedOut = {};
for (const [loginId, e] of Object.entries(expected)) {
  expectedOut[loginId] = {
    company_code: e.company_code,
    user_type: e.user_type,
    unsub_cnt: e.unsub.size,
    cb_assign_cnt: e.cb_assign.size,
  };
}
fs.writeFileSync(path.join(DATA_DIR, 'expected-per-user.json'), JSON.stringify(expectedOut, null, 2));

const summary = {
  generated_at: new Date().toISOString(),
  callback: {
    source_rows_csv: memberSendNum.length,
    invalid_phone_skipped: sendSkipped,
    unmapped_userid_skipped: sendUnmapped,
    callback_numbers_rows: callbackNumberRows.length,
    assignments_rows: assignmentRows.length,
    solo_companies_with_data: countSoloCompanies,
    multi_companies_with_data: countMultiCompanies,
  },
  unsubscribe: {
    source_rows_csv: blockedNum.length,
    invalid_phone_skipped: blockSkipped,
    unmapped_userid_skipped: blockUnmapped,
    user_direct_pairs: unsubDirectRowCount,
    admin_union_pairs: unsubAdminAddedCount,
    total_unsubscribes_rows: unsubRows.length,
  },
};
fs.writeFileSync(path.join(DATA_DIR, 'migration-summary.json'), JSON.stringify(summary, null, 2));

console.log('═══════════════════════════════════════════════');
console.log('  Phase 3 INSERT SQL 생성 완료');
console.log('═══════════════════════════════════════════════');
console.log('[회신번호]');
console.log(`  CSV 원본                    : ${memberSendNum.length}건`);
console.log(`  - 전화번호 정규화 탈락     : ${sendSkipped}`);
console.log(`  - USERID 매핑 없음        : ${sendUnmapped}`);
console.log(`  ✅ callback_numbers INSERT : ${callbackNumberRows.length}건`);
console.log(`     (단독회사 ${countSoloCompanies}곳 scope='all' / 다중회사 ${countMultiCompanies}곳 scope='assigned')`);
console.log(`  ✅ assignments INSERT     : ${assignmentRows.length}건 (다중회사만)`);
console.log();
console.log('[수신거부]');
console.log(`  CSV 원본                    : ${blockedNum.length.toLocaleString()}건`);
console.log(`  - 전화번호 정규화 탈락     : ${blockSkipped}`);
console.log(`  - USERID 매핑 없음        : ${blockUnmapped}`);
console.log(`  ✅ user 직접 INSERT        : ${unsubDirectRowCount.toLocaleString()}건`);
console.log(`  ✅ admin 합집합 추가       : +${unsubAdminAddedCount.toLocaleString()}건 (다중회사만)`);
console.log(`  ✅ unsubscribes 총 INSERT : ${unsubRows.length.toLocaleString()}건`);
console.log();
console.log('출력:');
console.log(`  migrate-legacy/data/migration-callbacks.sql`);
console.log(`  migrate-legacy/data/migration-unsubscribes.sql`);
console.log(`  migrate-legacy/data/migration-summary.json`);
