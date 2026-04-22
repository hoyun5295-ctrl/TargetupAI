// gen-dump-sql-v2.js — MEMBER_SEND_NUM 재덤프 (REG_DT 제거, 2컬럼만)
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const coverage = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'coverage-report.json'), 'utf8'));
const sendNumUserids = Object.keys(coverage.member_send_num.matched).sort();

const quoteList = (ids) => ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');

const sql = `-- ═══════════════════════════════════════════════════════
-- MEMBER_SEND_NUM 재덤프 v2 (REG_DT 제거, 2컬럼)
-- 이관 대상 USERID ${sendNumUserids.length}개, 예상 ${coverage.coverage.member_send_num.matched_count.toLocaleString()}건
-- 출력: /tmp/legacy_member_send_num.csv
-- 형식: USERID|PHONE (파이프 구분)
-- ═══════════════════════════════════════════════════════

SET COLSEP '|'
SET LINESIZE 200
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

SPOOL /tmp/legacy_member_send_num.csv

SELECT USERID
       || '|' ||
       REGEXP_REPLACE(SEND_NUM, '[^0-9]', '')
FROM MEMBER_SEND_NUM
WHERE STATUS = '1'
  AND USERID IN (${quoteList(sendNumUserids)})
ORDER BY USERID, SEQ;

SPOOL OFF

SET TERMOUT ON
SET HEADING ON
SET FEEDBACK ON

SELECT COUNT(*) AS DUMPED_COUNT
FROM MEMBER_SEND_NUM
WHERE STATUS = '1'
  AND USERID IN (${quoteList(sendNumUserids)});
`;

fs.writeFileSync(path.join(DATA_DIR, 'dump-member-send-num-v2.sql'), sql, 'utf8');
console.log(`생성 완료: migrate-legacy/data/dump-member-send-num-v2.sql (${sendNumUserids.length} USERID, 예상 ${coverage.coverage.member_send_num.matched_count}건)`);
