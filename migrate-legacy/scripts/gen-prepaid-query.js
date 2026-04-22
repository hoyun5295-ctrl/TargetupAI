// ─────────────────────────────────────────────────────────
// gen-prepaid-query.js
// user-map.json (141명) 기준으로 레거시 MEMBER 테이블에서
// 선불 업체 (TOTALAMTCHARGED > 0) + 잔액 조회 SQL 생성
//
// 생성: data/query-prepaid-balance.sql
// 실행: Harold님이 sqlplus @파일 로 실행
// ─────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const userMap = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'user-map.json'), 'utf8'));
const companySummary = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'company-summary.json'), 'utf8'));

const loginIds = Object.keys(userMap).sort();
const inList = loginIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');

const sql = `-- ═══════════════════════════════════════════════════════
-- 레거시 선불 업체 잔액 조회 (이관 대상 141명 login_id 기준)
-- 실행: @/tmp/query-prepaid-balance.sql
-- ═══════════════════════════════════════════════════════

SET LINESIZE 220
SET PAGESIZE 9999
SET FEEDBACK ON
SET HEADING ON
COL USERID          FORMAT A22
COL NAME            FORMAT A42
COL TOTALAMTCHARGED FORMAT 999,999,999
COL TOTALAMTUSED    FORMAT 999,999,999
COL BALANCE         FORMAT 999,999,999

-- (1) USERID별 선불 잔액 상세 (TOTALAMTCHARGED > 0 인 것만)
SELECT
  USERID,
  NAME,
  NVL(TOTALAMTCHARGED, 0)                                      AS TOTALAMTCHARGED,
  NVL(TOTALAMTUSED, 0)                                         AS TOTALAMTUSED,
  GREATEST(NVL(TOTALAMTCHARGED,0) - NVL(TOTALAMTUSED,0), 0)    AS BALANCE
FROM MEMBER
WHERE USERID IN (${inList})
  AND NVL(TOTALAMTCHARGED, 0) > 0
ORDER BY BALANCE DESC;

-- (2) 전체 합계
SELECT
  COUNT(*)                                                                  AS PREPAID_COUNT,
  SUM(NVL(TOTALAMTCHARGED,0))                                               AS SUM_CHARGED,
  SUM(NVL(TOTALAMTUSED,0))                                                  AS SUM_USED,
  SUM(GREATEST(NVL(TOTALAMTCHARGED,0) - NVL(TOTALAMTUSED,0), 0))            AS SUM_BALANCE
FROM MEMBER
WHERE USERID IN (${inList})
  AND NVL(TOTALAMTCHARGED, 0) > 0;

-- (3) 이관 대상 전체 (TOTALAMTCHARGED 0 포함)  -- 후불 vs 선불 구분 확인용
SELECT
  CASE WHEN NVL(TOTALAMTCHARGED,0) > 0 THEN 'PREPAID' ELSE 'POSTPAID' END   AS BILLING_TYPE,
  COUNT(*)                                                                  AS CNT
FROM MEMBER
WHERE USERID IN (${inList})
GROUP BY CASE WHEN NVL(TOTALAMTCHARGED,0) > 0 THEN 'PREPAID' ELSE 'POSTPAID' END;
`;

const outPath = path.join(DATA_DIR, 'query-prepaid-balance.sql');
fs.writeFileSync(outPath, sql, 'utf8');

// 참고: 회사별 매핑 (다중회사는 여러 USERID 합산 필요)
const multiCompanies = Object.entries(companySummary).filter(([, s]) => s.is_multi);
const soloCompanies = Object.entries(companySummary).filter(([, s]) => !s.is_multi);

console.log('═══════════════════════════════════════════════');
console.log('  선불 잔액 조회 SQL 생성 완료');
console.log('═══════════════════════════════════════════════');
console.log(`  대상 login_id : ${loginIds.length}명 (신규 admin 18명 포함 — 자동 제외됨)`);
console.log(`  회사 구조     : 단독 ${soloCompanies.length}곳 / 다중 ${multiCompanies.length}곳`);
console.log();
console.log(`  출력: ${outPath}`);
console.log();
console.log('  다음 절차:');
console.log('  1) 로컬 PowerShell에서 SCP 업로드');
console.log('     scp -P 27153 migrate-legacy\\data\\query-prepaid-balance.sql root@27.102.203.143:/tmp/');
console.log('  2) 레거시 SSH → sqlplus 접속');
console.log('     ssh -p 27153 root@27.102.203.143');
console.log('     (oracle 유저 상태 확인 후 sqlplus 진입)');
console.log('     LANG=C NLS_LANG=AMERICAN_AMERICA.UTF8 sqlplus usom_user@orcl');
console.log('  3) sqlplus 프롬프트에서');
console.log('     SQL> @/tmp/query-prepaid-balance.sql');
console.log('  4) 결과 3개 쿼리 출력을 채팅에 붙여넣어 주세요');
