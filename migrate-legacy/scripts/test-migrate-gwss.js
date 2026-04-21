/**
 * gwss(광원시스틱) 주소록 테스트 이관 스크립트
 *
 * 레거시 ADDRBOOK (Oracle, USERID='gwss', 58,582건)
 *   → 한줄로 address_books (PostgreSQL, 직접발송 주소록)
 *
 * 전제:
 * - 한줄로에 gwss 회사(companies) + admin user(users) 이미 등록됨
 * - login_id = 'gwss' (레거시와 동일)
 * - Node.js 18+ (oracledb, pg, dotenv 설치 필요)
 *
 * 환경변수 (migrate-legacy/.env.migrate):
 *   LEGACY_ORACLE_USER       = 레거시 Oracle 사용자
 *   LEGACY_ORACLE_PASSWORD   = 레거시 Oracle 비밀번호
 *   LEGACY_ORACLE_DSN        = 예: 27.102.203.143:1521/orcl
 *   PG_HOST                  = 한줄로 PG 호스트
 *   PG_PORT                  = 한줄로 PG 포트 (기본 5432)
 *   PG_USER                  = targetup
 *   PG_PASSWORD              = ...
 *   PG_DATABASE              = targetup
 *   GWSS_COMPANY_ID          = 한줄로 companies.id (UUID)
 *   GWSS_USER_ID             = 한줄로 users.id (login_id='gwss'인 admin UUID)
 *   DRY_RUN                  = true/false (true면 조회/정규화만, INSERT 안 함)
 *
 * 실행:
 *   cd migrate-legacy
 *   npm install oracledb pg dotenv   (최초 1회)
 *   node scripts/test-migrate-gwss.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.migrate') });

const oracledb = require('oracledb');
const { Pool } = require('pg');

const BATCH_SIZE = 5000;
const DRY_RUN = (process.env.DRY_RUN || '').toLowerCase() === 'true';

const LEGACY_CONFIG = {
  user: process.env.LEGACY_ORACLE_USER,
  password: process.env.LEGACY_ORACLE_PASSWORD,
  connectString: process.env.LEGACY_ORACLE_DSN,
};

const PG_CONFIG = {
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
};

const GWSS_USERID = 'gwss';
const GWSS_COMPANY_ID = process.env.GWSS_COMPANY_ID;
const GWSS_USER_ID = process.env.GWSS_USER_ID;

function assert(cond, msg) {
  if (!cond) {
    console.error(`[ERROR] ${msg}`);
    process.exit(1);
  }
}

function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/[^0-9]/g, '');
  if (!digits) return null;
  // +82-10-xxxx → 010xxxx
  if (digits.startsWith('82')) digits = '0' + digits.slice(2);
  return digits || null;
}

function parseCreatedAt(s) {
  // 레거시 CREATEDT: 'YYYYMMDDHHMMSS' 14자리 문자열
  if (!s) return null;
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}+09`;
}

async function main() {
  assert(LEGACY_CONFIG.user && LEGACY_CONFIG.password && LEGACY_CONFIG.connectString,
    'LEGACY_ORACLE_* 환경변수 누락');
  assert(PG_CONFIG.host && PG_CONFIG.user && PG_CONFIG.password && PG_CONFIG.database,
    'PG_* 환경변수 누락');
  assert(GWSS_COMPANY_ID && GWSS_USER_ID,
    'GWSS_COMPANY_ID / GWSS_USER_ID 환경변수 누락 — 한줄로 PG에서 조회 후 세팅');

  console.log('=== gwss 주소록 테스트 이관 ===');
  console.log(`DRY_RUN: ${DRY_RUN}`);
  console.log(`COMPANY_ID: ${GWSS_COMPANY_ID}`);
  console.log(`USER_ID: ${GWSS_USER_ID}`);
  console.log('');

  let legacy, pgPool;

  try {
    console.log('[1/5] 레거시 Oracle 연결...');
    legacy = await oracledb.getConnection(LEGACY_CONFIG);
    console.log('  연결 성공');

    console.log('[2/5] 레거시 gwss 주소록 + 그룹 조회...');
    const sql = `
      SELECT a.NAME, a.MOBILE, a.ETC1, a.CREATEDT,
             NVL(g.ADDRGROUPNAME, 'default') AS GROUP_NAME
      FROM ADDRBOOK a
      LEFT JOIN ADDRGROUP g ON g.CODE = a.ADDRGROUPCODE
      WHERE a.USERID = :userid
    `;
    const result = await legacy.execute(sql, { userid: GWSS_USERID }, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      fetchArraySize: 1000,
    });
    const legacyRows = result.rows;
    console.log(`  조회: ${legacyRows.length.toLocaleString()}건`);

    console.log('[3/5] 정규화 및 필터링...');
    const normalized = [];
    let droppedNoPhone = 0;
    for (const r of legacyRows) {
      const phone = normalizePhone(r.MOBILE);
      if (!phone) { droppedNoPhone++; continue; }
      normalized.push({
        name: r.NAME ? String(r.NAME).slice(0, 50) : null,
        phone: phone.slice(0, 20),
        extra1: r.ETC1 ? String(r.ETC1).slice(0, 100) : null,
        group_name: String(r.GROUP_NAME || 'default').slice(0, 100),
        created_at: parseCreatedAt(r.CREATEDT),
      });
    }
    console.log(`  유효: ${normalized.length.toLocaleString()}건`);
    console.log(`  제외(전화번호 없음): ${droppedNoPhone.toLocaleString()}건`);

    // 그룹별 분포
    const groupCounts = {};
    for (const r of normalized) groupCounts[r.group_name] = (groupCounts[r.group_name] || 0) + 1;
    const groupSummary = Object.entries(groupCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log(`  그룹 수: ${Object.keys(groupCounts).length}개`);
    console.log('  TOP 10 그룹:');
    for (const [name, cnt] of groupSummary) {
      console.log(`    ${name.padEnd(40)} ${cnt.toLocaleString()}`);
    }

    if (DRY_RUN) {
      console.log('');
      console.log('[DRY_RUN=true] — INSERT 스킵. 위 통계만 확인하고 종료.');
      return;
    }

    console.log('[4/5] 한줄로 PG bulk INSERT...');
    pgPool = new Pool(PG_CONFIG);

    // 이관 전 기존 잔여 데이터 확인 (안전장치)
    const { rows: [precheck] } = await pgPool.query(
      `SELECT COUNT(*) AS cnt FROM address_books WHERE company_id=$1 AND user_id=$2`,
      [GWSS_COMPANY_ID, GWSS_USER_ID]
    );
    console.log(`  이관 전 기존 건수: ${precheck.cnt}`);
    if (Number(precheck.cnt) > 0) {
      console.log('  [WARN] 기존 데이터 존재. 중복 방지 로직 없음 — 필요 시 사전 DELETE 후 재실행.');
    }

    let inserted = 0;
    const startTime = Date.now();
    for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
      const batch = normalized.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = batch.map((r, idx) => {
        const base = idx * 7;
        values.push(
          GWSS_COMPANY_ID,
          GWSS_USER_ID,
          r.group_name,
          r.phone,
          r.name,
          r.extra1,
          r.created_at
        );
        return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, COALESCE($${base+7}::timestamptz, NOW()))`;
      }).join(',');

      await pgPool.query(
        `INSERT INTO address_books (company_id, user_id, group_name, phone, name, extra1, created_at)
         VALUES ${placeholders}`,
        values
      );
      inserted += batch.length;
      console.log(`  ${inserted.toLocaleString()}/${normalized.length.toLocaleString()} (${Math.round(inserted/normalized.length*100)}%)`);
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  INSERT 완료: ${inserted.toLocaleString()}건 / ${elapsed}초`);

    console.log('[5/5] 검증...');
    const { rows: [finalCheck] } = await pgPool.query(
      `SELECT COUNT(*) AS cnt, COUNT(DISTINCT group_name) AS group_cnt
       FROM address_books WHERE company_id=$1 AND user_id=$2`,
      [GWSS_COMPANY_ID, GWSS_USER_ID]
    );
    console.log(`  한줄로 address_books 건수: ${Number(finalCheck.cnt).toLocaleString()}`);
    console.log(`  한줄로 그룹 수: ${finalCheck.group_cnt}`);
    console.log(`  레거시 조회: ${legacyRows.length.toLocaleString()} / 정규화: ${normalized.length.toLocaleString()} / INSERT: ${inserted.toLocaleString()}`);

    console.log('');
    console.log('=== 이관 완료 ===');
    console.log('확인 방법:');
    console.log('  한줄로 로그인 → 직접발송 → 주소록 메뉴에서 34개 그룹 표시 여부 확인');

  } finally {
    if (legacy) await legacy.close().catch(() => {});
    if (pgPool) await pgPool.end().catch(() => {});
  }
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
