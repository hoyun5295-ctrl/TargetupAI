// ─────────────────────────────────────────────────────────
// gen-dump-sql.js
// coverage-report.json 의 matched USERID 목록으로
// 레거시 Oracle sqlplus 덤프용 SQL 파일 생성
//
// 출력:
//   data/dump-blockednum.sql        (수신거부 CSV 덤프)
//   data/dump-member-send-num.sql   (회신번호 CSV 덤프)
//
// 덤프 CSV 형식 (구분자 '|' — phone에 콤마 없으므로 파이프로 안전):
//   BLOCKEDNUM       : USERID|PHONE|CREATEDT(YYYY-MM-DD HH24:MI:SS)
//   MEMBER_SEND_NUM  : USERID|SEND_NUM|REG_DT(YYYY-MM-DD HH24:MI:SS)
// ─────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const coverage = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'coverage-report.json'), 'utf8'));

const blockedUserids = Object.keys(coverage.blockednum.matched).sort();
const sendNumUserids = Object.keys(coverage.member_send_num.matched).sort();

function quoteList(ids) {
  // 한 줄 1000자 제한 대비 청크 분할 (Oracle IN 절 최대 1000개 OK)
  return ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
}

// ─────────────────────────────────────────────
// BLOCKEDNUM 덤프 SQL
// ─────────────────────────────────────────────
const blockedSQL = `-- ═══════════════════════════════════════════════════════
-- BLOCKEDNUM 덤프 (수신거부)
-- 이관 대상 USERID ${blockedUserids.length}개, 예상 ${coverage.coverage.blockednum.matched_count.toLocaleString()}건
-- 출력: /tmp/legacy_blockednum.csv
-- 형식: USERID|PHONE|CREATEDT (파이프 구분)
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
SET SQLBLANKLINES ON

SPOOL /tmp/legacy_blockednum.csv

SELECT USERID
       || '|' ||
       REGEXP_REPLACE(BLOCKEDNUM, '[^0-9]', '')
       || '|' ||
       TO_CHAR(CREATEDT, 'YYYY-MM-DD HH24:MI:SS')
FROM BLOCKEDNUM
WHERE USERID IN (${quoteList(blockedUserids)})
ORDER BY USERID, CREATEDT;

SPOOL OFF

-- 건수 검증
SET TERMOUT ON
SET HEADING ON
SET FEEDBACK ON

SELECT COUNT(*) AS DUMPED_COUNT
FROM BLOCKEDNUM
WHERE USERID IN (${quoteList(blockedUserids)});
`;

// ─────────────────────────────────────────────
// MEMBER_SEND_NUM 덤프 SQL
// ─────────────────────────────────────────────
const sendNumSQL = `-- ═══════════════════════════════════════════════════════
-- MEMBER_SEND_NUM 덤프 (회신번호 STATUS='1' 활성)
-- 이관 대상 USERID ${sendNumUserids.length}개, 예상 ${coverage.coverage.member_send_num.matched_count.toLocaleString()}건
-- 출력: /tmp/legacy_member_send_num.csv
-- 형식: USERID|SEND_NUM|REG_DT (파이프 구분)
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
SET SQLBLANKLINES ON

SPOOL /tmp/legacy_member_send_num.csv

SELECT USERID
       || '|' ||
       REGEXP_REPLACE(SEND_NUM, '[^0-9]', '')
       || '|' ||
       TO_CHAR(REG_DT, 'YYYY-MM-DD HH24:MI:SS')
FROM MEMBER_SEND_NUM
WHERE STATUS = '1'
  AND USERID IN (${quoteList(sendNumUserids)})
ORDER BY USERID, REG_DT;

SPOOL OFF

-- 건수 검증
SET TERMOUT ON
SET HEADING ON
SET FEEDBACK ON

SELECT COUNT(*) AS DUMPED_COUNT
FROM MEMBER_SEND_NUM
WHERE STATUS = '1'
  AND USERID IN (${quoteList(sendNumUserids)});
`;

fs.writeFileSync(path.join(DATA_DIR, 'dump-blockednum.sql'), blockedSQL, 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'dump-member-send-num.sql'), sendNumSQL, 'utf8');

console.log('═══════════════════════════════════════════════');
console.log('  덤프 SQL 생성 완료');
console.log('═══════════════════════════════════════════════');
console.log(`  dump-blockednum.sql       : ${blockedUserids.length}개 USERID, 예상 ${coverage.coverage.blockednum.matched_count.toLocaleString()}건`);
console.log(`  dump-member-send-num.sql  : ${sendNumUserids.length}개 USERID, 예상 ${coverage.coverage.member_send_num.matched_count.toLocaleString()}건`);
console.log();
console.log('  실행 절차:');
console.log('  1) 레거시 서버에 업로드:');
console.log('     scp -P 27153 migrate-legacy/data/dump-blockednum.sql root@27.102.203.143:/tmp/');
console.log('     scp -P 27153 migrate-legacy/data/dump-member-send-num.sql root@27.102.203.143:/tmp/');
console.log('  2) 레거시에서 sqlplus 실행:');
console.log('     ssh -p 27153 root@27.102.203.143');
console.log('     su - oracle');
console.log('     cp /tmp/dump-*.sql /home/oracle/');
console.log('     LANG=C NLS_LANG=AMERICAN_AMERICA.UTF8 sqlplus usom_user@orcl');
console.log('     SQL> @/home/oracle/dump-blockednum.sql');
console.log('     SQL> @/home/oracle/dump-member-send-num.sql');
console.log('     SQL> EXIT');
console.log('  3) 로컬(PowerShell)에서 CSV 수집:');
console.log('     scp -P 27153 root@27.102.203.143:/tmp/legacy_blockednum.csv migrate-legacy/data/');
console.log('     scp -P 27153 root@27.102.203.143:/tmp/legacy_member_send_num.csv migrate-legacy/data/');
