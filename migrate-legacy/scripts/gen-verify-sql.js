// ─────────────────────────────────────────────────────────
// gen-verify-sql.js
// 141명 login_id별 실측 count 덤프 SQL 생성
// Harold님이 서버에서 실행 → 로컬로 가져와 compare-verification.js 실행
// ─────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const expected = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'expected-per-user.json'), 'utf8'));
const loginIds = Object.keys(expected).sort();

const inList = loginIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');

// psql -A -t -F'|' 형식으로 stdout 출력하도록 쿼리 구성
const query = `SELECT u.login_id
       || '|' || c.company_code
       || '|' || u.user_type
       || '|' || (SELECT COUNT(*) FROM unsubscribes
                  WHERE user_id=u.id AND source='legacy_migration')::text
       || '|' || (SELECT COUNT(*) FROM callback_number_assignments cna
                  JOIN callback_numbers cn ON cn.id=cna.callback_number_id
                  WHERE cna.user_id=u.id AND cn.label='레거시')::text
FROM users u
JOIN companies c ON c.id=u.company_id
WHERE u.login_id IN (${inList})
ORDER BY c.company_code, CASE WHEN u.user_type='admin' THEN 0 ELSE 1 END, u.login_id;`;

const shellCmd = `docker exec -i targetup-postgres psql -U targetup targetup -At -c "${query.replace(/"/g, '\\"').replace(/\n/g, ' ')}" > /tmp/verify_actual.csv
wc -l /tmp/verify_actual.csv
head -10 /tmp/verify_actual.csv
`;

fs.writeFileSync(path.join(DATA_DIR, 'verify-per-user.sh'), shellCmd, 'utf8');
console.log('생성 완료: migrate-legacy/data/verify-per-user.sh');
console.log(`대상 login_id: ${loginIds.length}명`);
console.log();
console.log('서버 실행 (Harold님 SSH 접속 후):');
console.log('  bash /tmp/verify-per-user.sh');
console.log();
console.log('로컬로 가져오기 (PowerShell):');
console.log('  scp administrator@58.227.193.62:/tmp/verify_actual.csv migrate-legacy/data/');
