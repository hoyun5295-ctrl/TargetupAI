// ─────────────────────────────────────────────────────────
// build-user-map.js
// legacy_migration.sql (D134) 을 파싱하여 매핑 JSON 생성
//
//   companies INSERT  → company-map.json
//     { [company_code]: { company_id, company_name } }
//
//   users INSERT      → user-map.json
//     { [login_id]: { user_id, company_id, company_code, user_type, name, is_new_admin } }
//
// 실행: node migrate-legacy/scripts/build-user-map.js
// ─────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const SQL_PATH = 'C:/Users/ceo/OneDrive/바탕 화면/legacy_migration.sql';
const OUT_DIR = path.join(__dirname, '..', 'data');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const sql = fs.readFileSync(SQL_PATH, 'utf8');

// ─────────────────────────────────────────────
// 1) companies INSERT 블록 추출
// ─────────────────────────────────────────────
// 형식:
//   ('uuid', 'name', 'company_name', 'company_code', (SELECT ...), 'active', 'postpaid', 0, ...),
const companyMap = {};
const companyCodeToId = {};

const companyBlockMatch = sql.match(
  /INSERT INTO companies[^;]+VALUES([\s\S]+?);\s*--\s*2\. users INSERT/
);
if (!companyBlockMatch) throw new Error('companies INSERT 블록을 찾지 못했습니다.');
const companyBlock = companyBlockMatch[1];

// 각 row는 `(` 로 시작, `)` 로 끝 (쉼표 또는 세미콜론 바로 앞)
const companyRowRegex = /\(\s*'([0-9a-f-]{36})',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'/g;
let m;
while ((m = companyRowRegex.exec(companyBlock)) !== null) {
  const [, id, name, companyName, companyCode] = m;
  companyMap[companyCode] = {
    company_id: id,
    company_name: companyName,
    display_name: name,
  };
  companyCodeToId[companyCode] = id;
}

// ─────────────────────────────────────────────
// 2) users INSERT 블록 추출
// ─────────────────────────────────────────────
// 형식:
//   ('uuid', 'company_uuid', 'login_id', '$2a$10$...', 'admin'|'user', 'name', 'active', true, true, NOW(), NOW())
const userMap = {};
const usersBlockMatch = sql.match(/INSERT INTO users[^;]+VALUES([\s\S]+?);/);
if (!usersBlockMatch) throw new Error('users INSERT 블록을 찾지 못했습니다.');
const usersBlock = usersBlockMatch[1];

// company_id → company_code 역맵
const companyIdToCode = Object.fromEntries(
  Object.entries(companyCodeToId).map(([code, id]) => [id, code])
);

const userRowRegex =
  /\(\s*'([0-9a-f-]{36})',\s*'([0-9a-f-]{36})',\s*'([^']*)',\s*'\$2[ab]\$[^']+',\s*'(admin|user|system)',\s*'([^']*)'/g;
while ((m = userRowRegex.exec(usersBlock)) !== null) {
  const [, userId, companyId, loginId, userType, name] = m;
  const companyCode = companyIdToCode[companyId] || null;
  userMap[loginId] = {
    user_id: userId,
    company_id: companyId,
    company_code: companyCode,
    user_type: userType, // 'admin' or 'user'
    name,
    is_new_admin: /01$|[0-9]a$/.test(loginId) && userType === 'admin',
    // 엄밀하게 "신규 admin"은 legacy_migration_report.txt 기준: 18개 star 표시
    // 여기서는 휴리스틱 — 정확한 매칭은 report.txt 별도 파싱으로 보강
  };
}

// ─────────────────────────────────────────────
// 3) 다중/단독 회사 분류 + admin user 매핑
// ─────────────────────────────────────────────
// company_id 별 user 목록
const companyUsers = {};
for (const [loginId, u] of Object.entries(userMap)) {
  if (!companyUsers[u.company_id]) companyUsers[u.company_id] = [];
  companyUsers[u.company_id].push({ loginId, ...u });
}

const companySummary = {};
for (const [companyCode, c] of Object.entries(companyMap)) {
  const users = companyUsers[c.company_id] || [];
  const admins = users.filter((u) => u.user_type === 'admin');
  const regularUsers = users.filter((u) => u.user_type === 'user');
  companySummary[companyCode] = {
    company_id: c.company_id,
    company_name: c.company_name,
    admin_count: admins.length,
    user_count: regularUsers.length,
    total: users.length,
    is_multi: users.length > 1, // 1명이면 단독, 2명+이면 다중
    admin_login_ids: admins.map((u) => u.loginId),
    admin_user_ids: admins.map((u) => u.user_id),
    user_login_ids: regularUsers.map((u) => u.loginId),
  };
}

// ─────────────────────────────────────────────
// 4) 출력
// ─────────────────────────────────────────────
fs.writeFileSync(
  path.join(OUT_DIR, 'company-map.json'),
  JSON.stringify(companyMap, null, 2),
  'utf8'
);
fs.writeFileSync(
  path.join(OUT_DIR, 'user-map.json'),
  JSON.stringify(userMap, null, 2),
  'utf8'
);
fs.writeFileSync(
  path.join(OUT_DIR, 'company-summary.json'),
  JSON.stringify(companySummary, null, 2),
  'utf8'
);

const companies = Object.keys(companyMap).length;
const users = Object.keys(userMap).length;
const multi = Object.values(companySummary).filter((s) => s.is_multi).length;
const solo = companies - multi;

console.log('═══════════════════════════════════════════════');
console.log('  매핑 JSON 생성 완료');
console.log('═══════════════════════════════════════════════');
console.log(`  companies : ${companies}개 (단독 ${solo} / 다중 ${multi})`);
console.log(`  users     : ${users}명`);
console.log('  출력:');
console.log(`    - ${path.join(OUT_DIR, 'company-map.json')}`);
console.log(`    - ${path.join(OUT_DIR, 'user-map.json')}`);
console.log(`    - ${path.join(OUT_DIR, 'company-summary.json')}`);
