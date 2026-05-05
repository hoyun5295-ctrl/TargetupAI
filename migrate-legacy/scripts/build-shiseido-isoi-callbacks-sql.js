// ═══════════════════════════════════════════════════════
// D143 차분 — 시세이도/아이소이 회신번호 이관 SQL 생성
// 입력: migrate-legacy/data/legacy_callbacks_shiseido_isoi.csv (127행)
// 출력: migrate-legacy/data/migration-shiseido-isoi-callbacks.sql
//
// D135 정책 일관:
//   - label='레거시', is_default=false
//   - 단독 USERID phone → assignment_scope='all'
//   - 다중 USERID phone → assignment_scope='assigned' + assignment 행
//   - assigned_by = D135 시점 super_admin (6229750b...)
// ═══════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const CSV_PATH = path.join(ROOT, 'migrate-legacy/data/legacy_callbacks_shiseido_isoi.csv');
const OUT_PATH = path.join(ROOT, 'migrate-legacy/data/migration-shiseido-isoi-callbacks.sql');

// 한줄로 PG에서 직접 조회한 매핑 (2026-05-05 검증)
const USER_MAP = {
  'isoi':      { user_id: '2bd336d1-55b5-4966-b43c-7be8e184ef5c', company_id: '697c7905-3165-47cf-a140-4f1cd369242a' },
  'isoics':    { user_id: '9b9f4c58-c1d9-4186-b3b4-5031587f4764', company_id: '697c7905-3165-47cf-a140-4f1cd369242a' },
  'shiseido1': { user_id: '7858c4cf-af74-481e-8d21-84fb10f53935', company_id: '3e7ec67b-f093-4b41-91c0-1eb284d8bfef' },
  'shiseido3': { user_id: 'af8972ce-bd19-4aea-bbe6-2331132573c8', company_id: '3e7ec67b-f093-4b41-91c0-1eb284d8bfef' },
  'shiseido4': { user_id: 'd51a8fbb-30a1-4e7c-a88c-c0d8fffe32c7', company_id: '3e7ec67b-f093-4b41-91c0-1eb284d8bfef' },
  'shiseido6': { user_id: '45818746-1571-4893-b6a4-bcd57fe62669', company_id: '3e7ec67b-f093-4b41-91c0-1eb284d8bfef' },
};

const ISOI_COMPANY_ID = '697c7905-3165-47cf-a140-4f1cd369242a';
const SHISEIDO_COMPANY_ID = '3e7ec67b-f093-4b41-91c0-1eb284d8bfef';

// D135에서 사용된 super_admin user_id (migration-callbacks.sql 코드 그대로)
const ASSIGNED_BY = '6229750b-3b64-4b08-bb12-0a9b945884d4';

// CSV 파싱
const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/\r/g, '');
const lines = raw.split('\n');
const rows = [];
for (const line of lines) {
  const t = line.trim();
  if (!t) continue;
  // sqlplus 잔여 행 제외
  if (t.startsWith('SQL>') || t.startsWith('SELECT') || t.startsWith('FROM') ||
      t.startsWith('WHERE') || t.startsWith('AND') || t.startsWith('ORDER') ||
      t.startsWith('SPOOL')) continue;
  const parts = t.split('|');
  if (parts.length !== 3) continue;
  const [userid, send_num, reg_dt] = parts;
  if (!USER_MAP[userid]) {
    console.error(`✗ Unknown USERID: ${userid}`);
    process.exit(1);
  }
  if (!/^\d+$/.test(send_num)) {
    console.error(`✗ SEND_NUM not numeric: ${send_num} (USERID=${userid})`);
    process.exit(1);
  }
  rows.push({ userid, send_num, reg_dt: reg_dt || '' });
}

console.log(`Parsed ${rows.length} rows from CSV`);
if (rows.length !== 127) {
  console.error(`✗ Expected 127 rows, got ${rows.length}`);
  process.exit(1);
}

// (company_id, phone)별 USERID 그룹핑
const phoneCompanyMap = new Map();
for (const r of rows) {
  const cid = USER_MAP[r.userid].company_id;
  const key = `${cid}|${r.send_num}`;
  if (!phoneCompanyMap.has(key)) {
    phoneCompanyMap.set(key, { company_id: cid, phone: r.send_num, userids: [] });
  }
  phoneCompanyMap.get(key).userids.push(r.userid);
}

// callback_numbers / assignments INSERT 행 생성
const callbackInserts = [];
const assignmentInserts = [];

for (const entry of phoneCompanyMap.values()) {
  const callbackId = crypto.randomUUID();
  const userids = [...new Set(entry.userids)];
  const scope = userids.length === 1 ? 'all' : 'assigned';
  callbackInserts.push(
    `  ('${callbackId}', '${entry.company_id}', '${entry.phone}', '레거시', false, '${scope}', NOW())`
  );
  if (scope === 'assigned') {
    for (const uid of userids) {
      const assignmentId = crypto.randomUUID();
      const userId = USER_MAP[uid].user_id;
      assignmentInserts.push(
        `  ('${assignmentId}', '${callbackId}', '${userId}', '${ASSIGNED_BY}', NOW())`
      );
    }
  }
}

// 분포 통계
const isoiPhones = [...phoneCompanyMap.values()].filter(e => e.company_id === ISOI_COMPANY_ID).length;
const shiseidoPhones = [...phoneCompanyMap.values()].filter(e => e.company_id === SHISEIDO_COMPANY_ID).length;
const allScope = [...phoneCompanyMap.values()].filter(e => new Set(e.userids).size === 1).length;
const assignedScope = [...phoneCompanyMap.values()].filter(e => new Set(e.userids).size > 1).length;

console.log(`\n[ 분포 ]`);
console.log(`  callback_numbers: ${callbackInserts.length}`);
console.log(`    - 자연인(isoi): ${isoiPhones}`);
console.log(`    - 한국시세이도: ${shiseidoPhones}`);
console.log(`    - scope='all': ${allScope}`);
console.log(`    - scope='assigned': ${assignedScope}`);
console.log(`  callback_number_assignments: ${assignmentInserts.length}`);

// 검증
if (callbackInserts.length !== 119) {
  console.error(`✗ Expected 119 callback_numbers, got ${callbackInserts.length}`);
  process.exit(1);
}
if (assignmentInserts.length !== 14) {
  console.error(`✗ Expected 14 assignments, got ${assignmentInserts.length}`);
  process.exit(1);
}

// SQL 파일 생성
const now = new Date().toISOString();
const sql = `-- ═══════════════════════════════════════════════════════
-- D143 차분 — 시세이도 + 아이소이 회신번호 이관
-- 생성일: ${now}
--
-- callback_numbers       : ${callbackInserts.length}건 (자연인 ${isoiPhones} + 한국시세이도 ${shiseidoPhones})
-- callback_number_assignments : ${assignmentInserts.length}건
-- D135 정책 일관 (label='레거시', is_default=false, assigned_by 동일)
--
-- 실행 (한줄로 서버):
--   docker cp migration-shiseido-isoi-callbacks.sql targetup-postgres:/tmp/
--   docker exec -i targetup-postgres psql -U targetup targetup -1 -f /tmp/migration-shiseido-isoi-callbacks.sql
-- ═══════════════════════════════════════════════════════

BEGIN;

-- 사전 검증 (이관 전 두 회사의 'legacy' callback 카운트)
SELECT 'BEFORE callback_numbers' AS phase,
       COUNT(*) FILTER (WHERE company_id = '${ISOI_COMPANY_ID}' AND label='레거시') AS isoi_legacy,
       COUNT(*) FILTER (WHERE company_id = '${SHISEIDO_COMPANY_ID}' AND label='레거시') AS shiseido_legacy
FROM callback_numbers;

SELECT 'BEFORE assignments' AS phase,
       COUNT(*) AS legacy_assignments_total
FROM callback_number_assignments cna
JOIN callback_numbers cn ON cn.id = cna.callback_number_id
WHERE cn.label='레거시'
  AND cn.company_id IN ('${ISOI_COMPANY_ID}', '${SHISEIDO_COMPANY_ID}');

-- callback_numbers INSERT (${callbackInserts.length}행)
INSERT INTO callback_numbers (id, company_id, phone, label, is_default, assignment_scope, created_at) VALUES
${callbackInserts.join(',\n')};

-- callback_number_assignments INSERT (${assignmentInserts.length}행)
INSERT INTO callback_number_assignments (id, callback_number_id, user_id, assigned_by, created_at) VALUES
${assignmentInserts.join(',\n')};

-- 사후 검증
SELECT 'AFTER callback_numbers' AS phase,
       COUNT(*) FILTER (WHERE company_id = '${ISOI_COMPANY_ID}' AND label='레거시') AS isoi_legacy,
       COUNT(*) FILTER (WHERE company_id = '${SHISEIDO_COMPANY_ID}' AND label='레거시') AS shiseido_legacy
FROM callback_numbers;

SELECT 'AFTER assignments' AS phase,
       COUNT(*) AS legacy_assignments_total
FROM callback_number_assignments cna
JOIN callback_numbers cn ON cn.id = cna.callback_number_id
WHERE cn.label='레거시'
  AND cn.company_id IN ('${ISOI_COMPANY_ID}', '${SHISEIDO_COMPANY_ID}');

-- scope 분포 확인
SELECT 'AFTER scope dist' AS phase,
       company_id::text,
       assignment_scope,
       COUNT(*) AS cnt
FROM callback_numbers
WHERE label='레거시'
  AND company_id IN ('${ISOI_COMPANY_ID}', '${SHISEIDO_COMPANY_ID}')
GROUP BY company_id, assignment_scope
ORDER BY company_id, assignment_scope;

COMMIT;
`;

fs.writeFileSync(OUT_PATH, sql, 'utf8');
console.log(`\nSaved: ${OUT_PATH}`);
console.log(`Size: ${fs.statSync(OUT_PATH).size} bytes`);
