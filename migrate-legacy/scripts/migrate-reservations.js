/**
 * 레거시 → 한줄로 예약발송 이관 스크립트 (D-Day 2026-05-05)
 *
 * 사용법:
 *   cd /home/administrator/targetup-app
 *   node migrate-legacy/scripts/migrate-reservations.js --dry-run   # 시뮬레이션
 *   node migrate-legacy/scripts/migrate-reservations.js --live      # 실제 INSERT
 *
 * 입력:
 *   migrate-legacy/data/recipients_v2.csv  (1454행)
 *   migrate-legacy/data/user-map.json
 *
 * 출력:
 *   - PG campaigns INSERT 70건 (단일 트랜잭션, BEGIN/COMMIT)
 *   - MySQL SMSQ_SEND INSERT 1454건 (bulkInsertSmsQueue, 라인그룹별 라운드로빈)
 *   - dry-run: MMS 매핑 + SCP 가이드 + INSERT 카운트 시뮬레이션
 *
 * 환경:
 *   /home/administrator/targetup-app/packages/backend/.env 자동 로드
 *   backend dist 모듈 import (sms-queue, db connection)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ───────────────────────────────────────────────────
// 환경 로드 (backend .env 재활용 — backend node_modules 경로 명시)
// ───────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '../..');
const BACKEND_NODE_MODULES = path.join(ROOT, 'packages/backend/node_modules');
try {
  const dotenv = require(path.join(BACKEND_NODE_MODULES, 'dotenv'));
  dotenv.config({ path: path.join(ROOT, 'packages/backend/.env') });
} catch (e) {
  // dry-run에서는 .env 없어도 OK (DB 연결 안 함)
  console.warn('⚠️  dotenv 로드 실패 (dry-run에서는 무시):', e.message);
}

// ───────────────────────────────────────────────────
// CLI 옵션
// ───────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIVE = args.includes('--live');

if (!DRY_RUN && !LIVE) {
  console.error('❌ 사용법: --dry-run 또는 --live');
  process.exit(1);
}

// ───────────────────────────────────────────────────
// 입력 파일
// ───────────────────────────────────────────────────
const CSV_PATH = path.join(ROOT, 'migrate-legacy/data/recipients_v2.csv');
const USER_MAP_PATH = path.join(ROOT, 'migrate-legacy/data/user-map.json');
const MMS_MAP_OUTPUT = path.join(ROOT, 'migrate-legacy/data/mms-uuid-map.json');

// ───────────────────────────────────────────────────
// MMS 한줄로 표준 경로 (서버 PG 검증 결과)
// ───────────────────────────────────────────────────
const MMS_BASE_DIR = '/home/administrator/mms-images';

// ───────────────────────────────────────────────────
// 헬퍼
// ───────────────────────────────────────────────────
function decodeMsg(s) {
  return s.replace(/\\n/g, '\n');
}

function convertSendTime(yyyymmddhhmiss) {
  const m = yyyymmddhhmiss.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) throw new Error('잘못된 SENDREQ_TIME 형식: ' + yyyymmddhhmiss);
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

function msgTypeToFull(t) {
  if (t === 'S') return 'SMS';
  if (t === 'L') return 'LMS';
  if (t === 'M') return 'MMS';
  throw new Error('알 수 없는 MSG_TYPE: ' + t);
}

function detectIsAd(msg) {
  return /^\(광고\)/.test(msg);
}

// ───────────────────────────────────────────────────
// CSV 파싱 + 캠페인 그룹핑
// ───────────────────────────────────────────────────
function parseCsv() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = raw.split('\n').filter(l => /^\d+\|/.test(l));
  const campaigns = new Map();

  for (const line of lines) {
    const cols = line.split('|');
    if (cols.length < 11) continue;
    const [code, userid, dest, callback, msgType, sendTime, msg, title, f1, f2, f3] = cols;

    if (!campaigns.has(code)) {
      campaigns.set(code, {
        legacyCode: code,
        userid,
        callback,
        msgType,
        sendTime,
        message: decodeMsg(msg),
        title,
        legacyMmsPath: f1 || null,
        recipients: [],
      });
    }
    campaigns.get(code).recipients.push({ dest, callback });
  }

  return campaigns;
}

// ───────────────────────────────────────────────────
// MMS 9개 매핑 (legacy_path → company_id + new_uuid)
// ───────────────────────────────────────────────────
function buildMmsUuidMap(campaigns, userMap) {
  // 같은 legacy_path는 동일 UUID 사용 (deduplication)
  const map = new Map();

  for (const c of campaigns.values()) {
    if (c.msgType !== 'M' || !c.legacyMmsPath) continue;
    if (map.has(c.legacyMmsPath)) continue;

    const userInfo = userMap[c.userid];
    if (!userInfo) throw new Error(`user-map.json에 USERID 없음: ${c.userid}`);
    const companyId = userInfo.company_id;
    const newUuid = crypto.randomUUID();
    const newPath = `${MMS_BASE_DIR}/${companyId}/${newUuid}.jpg`;
    const originalName = path.basename(c.legacyMmsPath);

    map.set(c.legacyMmsPath, {
      legacyPath: c.legacyMmsPath,
      companyId,
      newUuid,
      newPath,
      originalName,
    });
  }

  return map;
}

// ───────────────────────────────────────────────────
// dry-run: 시뮬레이션 + SCP 가이드 출력
// ───────────────────────────────────────────────────
function dryRun(campaigns, userMap, mmsMap) {
  console.log('\n========== DRY-RUN 시뮬레이션 ==========\n');
  console.log(`총 캠페인: ${campaigns.size}건`);
  console.log(`총 수신자: ${[...campaigns.values()].reduce((s, c) => s + c.recipients.length, 0)}건`);

  const byType = { SMS: 0, LMS: 0, MMS: 0 };
  const byCompany = new Map();
  let recvSum = { SMS: 0, LMS: 0, MMS: 0 };

  for (const c of campaigns.values()) {
    const t = msgTypeToFull(c.msgType);
    byType[t]++;
    recvSum[t] += c.recipients.length;
    const u = userMap[c.userid];
    const key = u.company_id;
    byCompany.set(key, (byCompany.get(key) || 0) + 1);
  }

  console.log('\n캠페인 타입:', byType);
  console.log('수신자 타입:', recvSum);
  console.log('\n회사별 캠페인:');
  for (const [cid, n] of byCompany.entries()) {
    console.log(`  ${cid}: ${n}건`);
  }

  console.log('\n========== MMS 9개 SCP 매핑 ==========\n');
  console.log('아래 명령어 실행 (Harold님 직접):');
  console.log('');
  console.log('# 1) MMS 압축파일 SCP (이미 완료한 경우 생략)');
  console.log('cd /home/administrator');
  console.log('tar xzf mms_files.tar.gz   # → home/storysom/WebContent/files/...');
  console.log('');
  console.log('# 2) 회사별 디렉토리 생성 + 9개 이미지 복사 (mv 아닌 cp 권장 — 검증 후 정리)');
  const companyDirs = new Set();
  for (const m of mmsMap.values()) companyDirs.add(m.companyId);
  for (const cid of companyDirs) {
    console.log(`mkdir -p ${MMS_BASE_DIR}/${cid}`);
  }
  console.log('');
  for (const m of mmsMap.values()) {
    const srcRel = m.legacyPath.replace(/^\//, '');
    console.log(`cp /home/administrator/${srcRel} ${m.newPath}`);
  }
  console.log('');
  console.log('# 3) 권한 설정');
  console.log(`chown -R administrator:administrator ${MMS_BASE_DIR}`);
  console.log(`chmod -R 644 ${MMS_BASE_DIR}/*/*.jpg`);
  console.log('');
  console.log('========== UUID 매핑 (mms-uuid-map.json에 저장) ==========\n');
  for (const m of mmsMap.values()) {
    console.log(`  ${path.basename(m.legacyPath)} → ${m.companyId}/${m.newUuid}.jpg (${m.originalName})`);
  }
  fs.writeFileSync(MMS_MAP_OUTPUT, JSON.stringify([...mmsMap.values()], null, 2));
  console.log(`\n📁 mms-uuid-map.json 저장됨 (live 모드에서 동일 UUID 재사용)\n`);

  console.log('========== 캠페인 INSERT 시뮬레이션 (처음 5건) ==========\n');
  let i = 0;
  for (const c of campaigns.values()) {
    if (i++ >= 5) break;
    const u = userMap[c.userid];
    const isAd = detectIsAd(c.message);
    const newCampaignId = '<gen_uuid>';
    const mmsImagePaths = (c.msgType === 'M' && c.legacyMmsPath)
      ? [{ path: mmsMap.get(c.legacyMmsPath).newPath, originalName: mmsMap.get(c.legacyMmsPath).originalName }]
      : null;
    console.log(`[${c.legacyCode}] ${msgTypeToFull(c.msgType)} ${c.recipients.length}명 → user=${u.login_id || c.userid} company=${u.company_id} is_ad=${isAd}`);
    console.log(`  scheduled_at: ${convertSendTime(c.sendTime)} KST`);
    console.log(`  callback: ${c.callback}, title: ${c.title}`);
    console.log(`  mms_image_paths: ${mmsImagePaths ? JSON.stringify(mmsImagePaths) : 'NULL'}`);
    console.log(`  message: ${c.message.substring(0, 80).replace(/\n/g, '\\n')}...`);
    console.log('');
  }

  console.log('========== 검증 OK 시 다음 실행 ==========\n');
  console.log('node migrate-legacy/scripts/migrate-reservations.js --live');
  console.log('');
}

// ───────────────────────────────────────────────────
// LIVE: PG + MySQL INSERT
// ───────────────────────────────────────────────────
async function liveRun(campaigns, userMap, mmsMap) {
  console.log('\n========== LIVE 실행 시작 ==========\n');

  // backend dist 모듈 import
  const distBase = path.join(ROOT, 'packages/backend/dist');
  const dbModule = require(path.join(distBase, 'config/database'));
  const smsQueue = require(path.join(distBase, 'utils/sms-queue'));

  const pgPool = dbModule.pool;
  if (!pgPool) throw new Error('PG pool 로드 실패 (dist/config/database 점검 필요)');

  const client = await pgPool.connect();
  let pgInsertedCount = 0;
  let mysqlInsertedCount = 0;
  const campaignIdMap = new Map(); // legacyCode → new PG campaign_id

  try {
    // ───── Phase 1: PG campaigns INSERT (단일 트랜잭션) ─────
    console.log('[Phase 1] PG campaigns INSERT (BEGIN)');
    await client.query('BEGIN');

    for (const c of campaigns.values()) {
      const u = userMap[c.userid];
      if (!u) throw new Error(`user-map 없음: ${c.userid}`);

      const isAd = detectIsAd(c.message);
      const messageType = msgTypeToFull(c.msgType);
      const scheduledAt = convertSendTime(c.sendTime); // KST 'YYYY-MM-DD HH:mm:ss'
      const targetCount = c.recipients.length;
      const campaignName = `[레거시이관] ${c.title || '제목없음'} ${c.sendTime}`;
      const subject = c.title || null;

      // mms_image_paths: 객체 배열 ({path, originalName})
      let mmsImagePaths = null;
      if (c.msgType === 'M' && c.legacyMmsPath) {
        const m = mmsMap.get(c.legacyMmsPath);
        mmsImagePaths = JSON.stringify([{ path: m.newPath, originalName: m.originalName }]);
      }

      const insertSql = `
        INSERT INTO campaigns (
          company_id, campaign_name, message_type, message_content, subject,
          callback_number, target_count, send_type, status, scheduled_at,
          message_template, message_subject, created_by, mms_image_paths,
          send_channel, is_ad, created_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, 'direct', 'scheduled', ($8 || ' +09')::timestamptz,
          $4, $5, $9, $10,
          'sms', $11, NOW()
        ) RETURNING id`;

      const result = await client.query(insertSql, [
        u.company_id,         // $1
        campaignName,         // $2
        messageType,          // $3
        c.message,            // $4 (D143 정책: 사용자 입력 그대로, sanitize 안 함)
        subject,              // $5
        c.callback,           // $6
        targetCount,          // $7
        scheduledAt,          // $8
        u.user_id,            // $9 created_by
        mmsImagePaths,        // $10
        isAd,                 // $11
      ]);

      const newCampaignId = result.rows[0].id;
      campaignIdMap.set(c.legacyCode, newCampaignId);
      pgInsertedCount++;
    }

    await client.query('COMMIT');
    console.log(`[Phase 1] ✅ PG campaigns ${pgInsertedCount}건 INSERT 완료\n`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ PG INSERT 실패 — ROLLBACK:', e.message);
    throw e;
  } finally {
    client.release();
  }

  // ───── Phase 2: MySQL SMSQ_SEND bulkInsertSmsQueue ─────
  console.log('[Phase 2] MySQL SMSQ_SEND INSERT (회사별 라운드로빈)');

  // 회사별로 묶어서 처리 (라인그룹이 회사별로 다름)
  const byCompany = new Map();
  for (const c of campaigns.values()) {
    const u = userMap[c.userid];
    const cid = u.company_id;
    if (!byCompany.has(cid)) byCompany.set(cid, []);
    byCompany.get(cid).push(c);
  }

  for (const [companyId, companyCampaigns] of byCompany.entries()) {
    const tables = await smsQueue.getCompanySmsTables(companyId);
    console.log(`  회사 ${companyId}: 라인그룹 [${tables.join(', ')}]`);

    const rows = [];
    for (const c of companyCampaigns) {
      const newCampaignId = campaignIdMap.get(c.legacyCode);
      const sendTime = convertSendTime(c.sendTime);
      const qtmsgType = c.msgType; // 이미 'S'/'L'/'M'
      let f1 = '', f2 = '', f3 = '';
      if (c.msgType === 'M' && c.legacyMmsPath) {
        const m = mmsMap.get(c.legacyMmsPath);
        f1 = m.newPath;
      }
      const subject = c.title || '';

      // bulkInsertSmsQueue rows 형식:
      // [dest_no, call_back, msg_contents, msg_type, title_str, sendTime, app_etc1(=campaignId), app_etc2(=companyId), file_name1, file_name2, file_name3]
      for (const r of c.recipients) {
        rows.push([
          r.dest,
          c.callback,
          c.message,        // (D143 정책: 사용자 입력 그대로)
          qtmsgType,
          subject,
          sendTime,
          newCampaignId,
          companyId,
          f1, f2, f3,
        ]);
      }
    }

    const sent = await smsQueue.bulkInsertSmsQueue(tables, rows, false);
    mysqlInsertedCount += sent;
    console.log(`  → ${sent}/${rows.length}건 INSERT 완료`);
  }

  console.log(`\n[Phase 2] ✅ MySQL SMSQ_SEND ${mysqlInsertedCount}건 INSERT 완료\n`);

  // ───── 결과 요약 ─────
  console.log('========== LIVE 실행 완료 ==========');
  console.log(`PG campaigns: ${pgInsertedCount}건`);
  console.log(`MySQL SMSQ_SEND: ${mysqlInsertedCount}건`);
  console.log('');
  console.log('다음 단계:');
  console.log('  1) 검증 SQL (런북 §검증) 실행');
  console.log('  2) 한줄로 UI에서 예약대기 모달 70건 표시 확인');
  console.log('  3) 1~2건 실 발송 테스트 (가까운 5/6 캠페인)');
  console.log('  4) 검증 완료 후 레거시 RESERVEYN=0 차단');

  process.exit(0);
}

// ───────────────────────────────────────────────────
// MAIN
// ───────────────────────────────────────────────────
async function main() {
  console.log(`🚀 migrate-reservations.js (모드: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'})`);

  if (!fs.existsSync(CSV_PATH)) throw new Error('CSV 없음: ' + CSV_PATH);
  if (!fs.existsSync(USER_MAP_PATH)) throw new Error('user-map.json 없음: ' + USER_MAP_PATH);

  const userMap = JSON.parse(fs.readFileSync(USER_MAP_PATH, 'utf8'));
  const campaigns = parseCsv();

  // 정합 검증
  if (campaigns.size !== 70) throw new Error(`캠페인 수 불일치: 기대 70, 실제 ${campaigns.size}`);
  const totalRecv = [...campaigns.values()].reduce((s, c) => s + c.recipients.length, 0);
  if (totalRecv !== 1454) throw new Error(`수신자 수 불일치: 기대 1454, 실제 ${totalRecv}`);

  // user-map 매핑 검증
  for (const c of campaigns.values()) {
    if (!userMap[c.userid]) throw new Error(`user-map.json에 매핑 없음: ${c.userid}`);
  }

  // MMS 매핑 — dry-run/live 동일 UUID 재사용 (캐시 파일)
  let mmsMap;
  if (LIVE && fs.existsSync(MMS_MAP_OUTPUT)) {
    const cached = JSON.parse(fs.readFileSync(MMS_MAP_OUTPUT, 'utf8'));
    mmsMap = new Map(cached.map(m => [m.legacyPath, m]));
    console.log(`📁 mms-uuid-map.json 캐시 사용 (${mmsMap.size}개 이미지)`);
  } else {
    mmsMap = buildMmsUuidMap(campaigns, userMap);
  }

  if (DRY_RUN) {
    dryRun(campaigns, userMap, mmsMap);
  } else {
    await liveRun(campaigns, userMap, mmsMap);
  }
}

main().catch(e => {
  console.error('\n❌ 실패:', e);
  process.exit(1);
});
