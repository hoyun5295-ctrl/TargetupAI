// ─────────────────────────────────────────────────────────
// gen-prepaid-dump-sql.js
// D-Day용 선불 잔액 CSV 덤프 SQL 생성
// (보기용 query-prepaid-balance.sql 과 별도 — 이것은 파이프 CSV spool)
//
// 출력: data/query-prepaid-dump.sql
// ─────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const userMap = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'user-map.json'), 'utf8'));
const loginIds = Object.keys(userMap).sort();
const inList = loginIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');

const sql = `-- ═══════════════════════════════════════════════════════
-- 레거시 선불 잔액 덤프 (D-Day 당일 재조회용)
-- CSV 형식 파이프 구분 → /tmp/prepaid_balance.csv
-- 실행: @/tmp/query-prepaid-dump.sql
-- ═══════════════════════════════════════════════════════

SET COLSEP '|'
SET LINESIZE 500
SET PAGESIZE 0
SET HEADING OFF
SET FEEDBACK OFF
SET TRIMSPOOL ON
SET TRIMOUT ON
SET TERMOUT OFF
SET NEWPAGE NONE
SET WRAP OFF
SET ECHO OFF
SET VERIFY OFF

SPOOL /tmp/prepaid_balance.csv

SELECT USERID
       || '|' ||
       REPLACE(REPLACE(NAME,CHR(10),' '),CHR(13),' ')
       || '|' ||
       TO_CHAR(NVL(TOTALAMTCHARGED, 0))
       || '|' ||
       TO_CHAR(NVL(TOTALAMTUSED, 0))
       || '|' ||
       TO_CHAR(GREATEST(NVL(TOTALAMTCHARGED,0) - NVL(TOTALAMTUSED,0), 0))
FROM MEMBER
WHERE USERID IN (${inList})
  AND NVL(TOTALAMTCHARGED, 0) > 0
ORDER BY GREATEST(NVL(TOTALAMTCHARGED,0) - NVL(TOTALAMTUSED,0), 0) DESC;

SPOOL OFF

-- 덤프 건수 확인
SET TERMOUT ON
SET HEADING ON
SET FEEDBACK ON

SELECT COUNT(*) AS DUMPED_PREPAID_COUNT,
       SUM(GREATEST(NVL(TOTALAMTCHARGED,0) - NVL(TOTALAMTUSED,0), 0)) AS TOTAL_BALANCE
FROM MEMBER
WHERE USERID IN (${inList})
  AND NVL(TOTALAMTCHARGED, 0) > 0;
`;

fs.writeFileSync(path.join(DATA_DIR, 'query-prepaid-dump.sql'), sql, 'utf8');
console.log(`생성 완료: migrate-legacy/data/query-prepaid-dump.sql (대상 login_id ${loginIds.length}개)`);
