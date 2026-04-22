const XLSX = require('./packages/backend/node_modules/xlsx');
const bcrypt = require('./packages/backend/node_modules/bcryptjs');
const crypto = require('crypto');
const fs = require('fs');

// ──────────────────────────────────────────
// 입력/출력 경로
// ──────────────────────────────────────────
const srcPath = 'C:/Users/ceo/OneDrive/바탕 화면/ID 신규생성리스트.xlsx';
const sqlPath = 'C:/Users/ceo/OneDrive/바탕 화면/legacy_migration.sql';
const reportPath = 'C:/Users/ceo/OneDrive/바탕 화면/legacy_migration_report.txt';

const TEMP_PASSWORD = 'qwer1234!';

// ──────────────────────────────────────────
// 회사별 영문명 매핑 (62개)
// ──────────────────────────────────────────
const COMPANY_EN = {
  '아우구스티누스 바더': 'augustinus',
  '에이스하드웨어': 'acehardware',
  '주식회사 중평알앤에스': 'afex',
  '아난티': 'ananti',
  '(주)에이엠커머스': 'amcommerce',
  '아르뉴': 'arnew',
  '주식회사 베이컨': 'bacon',
  '바닐라코': 'banilaco',
  '주식회사 페이지': 'paige',
  '베네통': 'benetton',
  '벤제프': 'benjefe',
  '캐럿글로벌': 'carrotglobal',
  '엔에스비': 'nsb',
  '이폴리움': 'efolium',
  '캣츠팩토리': 'catsfactory',
  '크로커다일': 'crocodile',
  '최선어학원': 'choisun',
  '코넥스솔루션': 'connexsol',
  '콤비타코리아': 'comvita',
  '지삼유통': 'jisam',
  '(주)경희 크리스피바바': 'crispybaba',
  '동국제약': 'dongkook',
  '방통대 미디어영상학과': 'knoumedia',
  '방통대 통계 데이터과학과': 'knoustat',
  '디에스패션컴퍼니': 'dsfashion',
  '태영_엘렌실라': 'elensilia',
  '에브리치': 'everych',
  '자이언트골프앤투어_광주점': 'giantgolf',
  '게스코리아': 'guesskorea',
  '에이치피오_덴프스': 'hpio',
  '아이디룩': 'idlook',
  '이새에프앤씨': 'isae',
  '제시뉴욕': 'jessinewyork',
  '금강제화': 'kumkang',
  '크리에이션엘': 'creationl',
  '라프레리': 'laprairie',
  '마리오아울렛': 'mariooutlet',
  '메트로시티': 'metrocity',
  '송지오옴므': 'songzio',
  '숭실원격평생교육원': 'soongsil',
  '수스_대행': 'soos',
  '주식회사 테크푸드': 'techfood',
  'toun28': 'toun28',
  '트렉스타': 'treksta',
  '금정이지어학원': 'easyschool',
  '스킨큐어': 'skincure',
  '미구하라_대행': 'miguhara',
  '나인': 'nain',
  '폴라초이스코리아': 'paulaschoice',
  '주식회사 비알케이컴퍼니': 'brk',
  '에프앤드에이': 'fnda',
  '리스킨_대행': 'reskin',
  '패밀리투': 'familytwo',
  '마트스마트': 'martsmart',
  '무주덕유산리조트': 'mdysresort',
  '룰루레몬애틀라티카코리아유한회사': 'lululemon',
  '라무르코리아': 'lumourkorea',
  '한국마사회': 'letsrun',
  '라벨영화장품': 'labelyoung',
  '강복자식품': 'kbjfood',
  'KISA 테스트_1': 'kisa1',
  '쇼메': 'chaumet',
};

// ──────────────────────────────────────────
// 규칙: 관리자ID = 영문명 + (숫자 포함 'a' | 없음 '01')
// ──────────────────────────────────────────
function hasDigit(s) { return /\d/.test(s); }
function makeAdminId(base) {
  return base + (hasDigit(base) ? 'a' : '01');
}

// SQL 문자열 이스케이프
function esc(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}

// ──────────────────────────────────────────
// 엑셀 읽기
// ──────────────────────────────────────────
const wb = XLSX.readFile(srcPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const range = XLSX.utils.decode_range(sheet['!ref']);

const rows = [];
for (let r = range.s.r + 1; r <= range.e.r; r++) {
  const get = (c) => String(sheet[XLSX.utils.encode_cell({ r, c })]?.v || '').trim();
  rows.push({
    유저ID: get(0),
    사용자명: get(1),
    회사명: get(2),
  });
}
console.log('엑셀 읽기:', rows.length, '행');

// ──────────────────────────────────────────
// 회사별 그룹핑
// ──────────────────────────────────────────
const companiesMap = {};
for (const r of rows) {
  if (!companiesMap[r.회사명]) companiesMap[r.회사명] = [];
  companiesMap[r.회사명].push(r);
}
console.log('회사 수:', Object.keys(companiesMap).length);

// 영문명 매핑 누락 체크
const missing = Object.keys(companiesMap).filter(c => !COMPANY_EN[c]);
if (missing.length > 0) {
  console.error('⚠️ 영문명 매핑 누락:', missing);
  process.exit(1);
}

// ──────────────────────────────────────────
// 비밀번호 해시 생성 (전체 동일)
// ──────────────────────────────────────────
const PASSWORD_HASH = bcrypt.hashSync(TEMP_PASSWORD, 10);
console.log('비밀번호 해시 생성 완료');

// ──────────────────────────────────────────
// UUID 생성 + SQL 조립
// ──────────────────────────────────────────
const companyInserts = [];
const userInserts = [];
const reportLines = [];

reportLines.push('═══════════════════════════════════════════════');
reportLines.push('레거시 이관 실행 리포트 (2026-04-22)');
reportLines.push('═══════════════════════════════════════════════');
reportLines.push(`임시 비밀번호: ${TEMP_PASSWORD}`);
reportLines.push(`must_change_password = true (첫 로그인 시 강제 변경)`);
reportLines.push('');

let totalSingleCompany = 0;
let totalMultiCompany = 0;
let totalUsers = 0;
let totalNewAdmins = 0;

for (const [companyName, members] of Object.entries(companiesMap)) {
  const companyCode = COMPANY_EN[companyName];
  const companyId = crypto.randomUUID();
  const isSingle = members.length === 1;

  companyInserts.push(
    `  ('${companyId}', ${esc(companyName)}, ${esc(companyName)}, ${esc(companyCode)}, ` +
    `(SELECT id FROM plans WHERE plan_code = 'FREE' LIMIT 1), 'active', 'postpaid', 0, 9, 21, 7, 5, 30, NOW(), NOW())`
  );

  reportLines.push(`[${isSingle ? '단독' : '다중'}] ${companyName} (code=${companyCode}, ${members.length}명)`);

  if (isSingle) {
    // 단독 → 유일 유저를 company_admin 승격
    totalSingleCompany++;
    const m = members[0];
    userInserts.push(
      `  ('${crypto.randomUUID()}', '${companyId}', ${esc(m.유저ID)}, ${esc(PASSWORD_HASH)}, ` +
      `'admin', ${esc(m.사용자명)}, 'active', true, true, NOW(), NOW())`
    );
    totalUsers++;
    reportLines.push(`  👑 ${m.유저ID.padEnd(18)} | ${m.사용자명} [company_admin]`);
  } else {
    // 다중 → 신규 admin 계정 생성 + 기존 멤버는 전부 company_user
    totalMultiCompany++;
    const adminLoginId = makeAdminId(companyCode);
    userInserts.push(
      `  ('${crypto.randomUUID()}', '${companyId}', ${esc(adminLoginId)}, ${esc(PASSWORD_HASH)}, ` +
      `'admin', ${esc(companyName + ' 관리자')}, 'active', true, true, NOW(), NOW())`
    );
    totalUsers++;
    totalNewAdmins++;
    reportLines.push(`  ★ ${adminLoginId.padEnd(18)} | ${companyName} 관리자 [company_admin] ← 신규ID`);

    for (const m of members) {
      userInserts.push(
        `  ('${crypto.randomUUID()}', '${companyId}', ${esc(m.유저ID)}, ${esc(PASSWORD_HASH)}, ` +
        `'user', ${esc(m.사용자명)}, 'active', true, true, NOW(), NOW())`
      );
      totalUsers++;
      reportLines.push(`      ${m.유저ID.padEnd(18)} | ${m.사용자명} [company_user]`);
    }
  }
  reportLines.push('');
}

// ──────────────────────────────────────────
// login_id 중복 체크 (신규 관리자ID ↔ 기존 레거시 유저ID)
// ──────────────────────────────────────────
const allLoginIds = userInserts.map(s => {
  const m = s.match(/'([^']+)', 'qwer|'([^']+)', '\$2a/);
  return null;
});
// 재검증: userInserts에 login_id 포함된 순서 기준으로
const loginIdSet = new Set();
const loginIdDups = [];
const reExtract = /\(\s*'[0-9a-f-]+',\s*'[0-9a-f-]+',\s*'([^']+)',/;
for (const s of userInserts) {
  const m = s.match(reExtract);
  if (m) {
    if (loginIdSet.has(m[1])) loginIdDups.push(m[1]);
    loginIdSet.add(m[1]);
  }
}
if (loginIdDups.length > 0) {
  console.error('🔴 CRITICAL: login_id 중복:', loginIdDups);
  process.exit(1);
}

// ──────────────────────────────────────────
// SQL 파일 조립
// ──────────────────────────────────────────
const sql = [
  '-- ═══════════════════════════════════════════════════════',
  '-- 레거시 이관 SQL (D134, 2026-04-22)',
  `-- 회사: ${Object.keys(companiesMap).length}개 (단독 ${totalSingleCompany} / 다중 ${totalMultiCompany})`,
  `-- 사용자: ${totalUsers}명 (레거시 ${rows.length} + 신규 admin ${totalNewAdmins})`,
  `-- 임시 비밀번호: ${TEMP_PASSWORD} (must_change_password=true)`,
  '--',
  '-- 실행:',
  '--   docker cp legacy_migration.sql targetup-postgres:/tmp/',
  '--   docker exec -i targetup-postgres psql -U targetup targetup -1 -f /tmp/legacy_migration.sql',
  '--   (psql -1 옵션 = 단일 트랜잭션, 실패 시 자동 롤백)',
  '-- ═══════════════════════════════════════════════════════',
  '',
  '-- 사전 점검: 기존 DB에 동일 login_id 있는지 확인 (있으면 INSERT 실패해야 정상)',
  '-- SELECT login_id FROM users WHERE login_id IN (',
  '--   ' + [...loginIdSet].map(id => `'${id}'`).join(', '),
  '-- );',
  '',
  'BEGIN;',
  '',
  '-- 1. companies INSERT',
  'INSERT INTO companies (id, name, company_name, company_code, plan_id, status, billing_type, balance, send_start_hour, send_end_hour, duplicate_prevention_days, max_users, session_timeout_minutes, created_at, updated_at) VALUES',
  companyInserts.join(',\n') + ';',
  '',
  '-- 2. users INSERT',
  'INSERT INTO users (id, company_id, login_id, password_hash, user_type, name, status, is_active, must_change_password, created_at, updated_at) VALUES',
  userInserts.join(',\n') + ';',
  '',
  '-- 3. 검증 쿼리',
  `SELECT COUNT(*) AS new_companies FROM companies WHERE company_code IN (${Object.values(COMPANY_EN).map(c => `'${c}'`).join(', ')});`,
  `SELECT COUNT(*) AS new_users FROM users WHERE login_id IN (${[...loginIdSet].map(id => `'${id}'`).join(', ')});`,
  '',
  'COMMIT;',
  '',
].join('\n');

fs.writeFileSync(sqlPath, sql, 'utf-8');
fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf-8');

console.log('');
console.log('═══════════════════════════════════════════════');
console.log('✅ 생성 완료');
console.log('═══════════════════════════════════════════════');
console.log(`📄 SQL 파일: ${sqlPath}`);
console.log(`📋 리포트:   ${reportPath}`);
console.log('');
console.log(`회사: ${Object.keys(companiesMap).length}개 (단독 ${totalSingleCompany} / 다중 ${totalMultiCompany})`);
console.log(`사용자: ${totalUsers}명 (레거시 ${rows.length} + 신규 admin ${totalNewAdmins})`);
console.log(`login_id 중복: ${loginIdDups.length}건`);
console.log('');
console.log('실행 방법:');
console.log('  docker cp legacy_migration.sql targetup-postgres:/tmp/');
console.log('  docker exec -i targetup-postgres psql -U targetup targetup -1 -f /tmp/legacy_migration.sql');
