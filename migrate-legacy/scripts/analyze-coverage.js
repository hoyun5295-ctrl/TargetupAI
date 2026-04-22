// ─────────────────────────────────────────────────────────
// analyze-coverage.js
// legacy_counts_raw.txt 를 파싱하여 user-map과 교차 매칭
// - 이관 대상 USERID 목록 + 건수
// - 매칭 안되는 USERID (이관 제외) 목록 + 건수
// - company별 합산
// 출력: data/coverage-report.json + 콘솔 요약
// ─────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const RAW_PATH = path.join(__dirname, '..', 'data', 'legacy_counts_raw.txt');
const USER_MAP_PATH = path.join(__dirname, '..', 'data', 'user-map.json');
const COMPANY_SUMMARY_PATH = path.join(__dirname, '..', 'data', 'company-summary.json');
const OUT_PATH = path.join(__dirname, '..', 'data', 'coverage-report.json');

const raw = fs.readFileSync(RAW_PATH, 'utf8');
const userMap = JSON.parse(fs.readFileSync(USER_MAP_PATH, 'utf8'));
const companySummary = JSON.parse(fs.readFileSync(COMPANY_SUMMARY_PATH, 'utf8'));

// ─────────────────────────────────────────────
// 1) raw 파싱 — 섹션 분리
// ─────────────────────────────────────────────
function parseSection(raw, startMarker, endMarker) {
  const startIdx = raw.indexOf(startMarker);
  const endIdx = endMarker ? raw.indexOf(endMarker, startIdx + 1) : raw.length;
  const body = raw.slice(startIdx + startMarker.length, endIdx);
  const rows = {};
  body.split('\n').forEach((line) => {
    // 빈 줄, 주석, 섹션 헤더 skip
    if (!line.trim() || line.trim().startsWith('--')) return;
    // "USERID  ...  CNT" 형태 (USERID는 일반적으로 공백 없음)
    const m = line.match(/^(\S+)\s+(\d+)\s*$/);
    if (m) rows[m[1]] = parseInt(m[2], 10);
  });
  return rows;
}

const blockedNum = parseSection(
  raw,
  "-- BLOCKEDNUM USERID별 건수",
  "-- MEMBER_SEND_NUM"
);
const memberSendNum = parseSection(raw, "-- MEMBER_SEND_NUM (STATUS='1') USERID별 건수", "-- 전체 합계");

const blockedTotal = Object.values(blockedNum).reduce((a, b) => a + b, 0);
const sendNumTotal = Object.values(memberSendNum).reduce((a, b) => a + b, 0);

// ─────────────────────────────────────────────
// 2) user-map과 교차
// ─────────────────────────────────────────────
const mappedLoginIds = new Set(Object.keys(userMap));

// case-sensitive 정확 매칭 + case-insensitive 보조 매칭 통계
const lowerMap = new Map();
for (const loginId of mappedLoginIds) lowerMap.set(loginId.toLowerCase(), loginId);

function classify(rows) {
  const matched = {};         // USERID → count (한줄로 user-map 매칭)
  const caseInsMatched = {};  // USERID → { legacy, mapped, count } (대소문자 불일치)
  const unmatched = {};       // USERID → count (이관 대상 외)
  let matchedTotal = 0, unmatchedTotal = 0, caseInsTotal = 0;
  for (const [userid, count] of Object.entries(rows)) {
    if (mappedLoginIds.has(userid)) {
      matched[userid] = count;
      matchedTotal += count;
    } else if (lowerMap.has(userid.toLowerCase())) {
      const mappedKey = lowerMap.get(userid.toLowerCase());
      caseInsMatched[userid] = { legacy: userid, mapped: mappedKey, count };
      caseInsTotal += count;
    } else {
      unmatched[userid] = count;
      unmatchedTotal += count;
    }
  }
  return { matched, caseInsMatched, unmatched, matchedTotal, caseInsTotal, unmatchedTotal };
}

const bn = classify(blockedNum);
const sn = classify(memberSendNum);

// ─────────────────────────────────────────────
// 3) 회사별 합산 (이관 대상만)
// ─────────────────────────────────────────────
function rollupByCompany(matched) {
  const byCompany = {};
  for (const [loginId, count] of Object.entries(matched)) {
    const u = userMap[loginId];
    if (!u) continue;
    const code = u.company_code;
    if (!byCompany[code]) {
      byCompany[code] = {
        company_id: u.company_id,
        company_name: companySummary[code]?.company_name || '',
        is_multi: companySummary[code]?.is_multi || false,
        userids: {},
        total: 0,
      };
    }
    byCompany[code].userids[loginId] = count;
    byCompany[code].total += count;
  }
  return byCompany;
}

const blockedByCompany = rollupByCompany(bn.matched);
const sendNumByCompany = rollupByCompany(sn.matched);

// 이관 대상 회사 중 레거시 데이터 0건 회사
const zeroBlocked = Object.keys(companySummary).filter(code => !blockedByCompany[code]);
const zeroSendNum = Object.keys(companySummary).filter(code => !sendNumByCompany[code]);

// ─────────────────────────────────────────────
// 4) 리포트 작성
// ─────────────────────────────────────────────
const report = {
  source_totals: {
    blockednum_total: blockedTotal,
    member_send_num_total: sendNumTotal,
  },
  coverage: {
    blockednum: {
      matched_userids: Object.keys(bn.matched).length,
      matched_count: bn.matchedTotal,
      case_insensitive_matched: Object.keys(bn.caseInsMatched).length,
      case_insensitive_count: bn.caseInsTotal,
      unmatched_userids: Object.keys(bn.unmatched).length,
      unmatched_count: bn.unmatchedTotal,
    },
    member_send_num: {
      matched_userids: Object.keys(sn.matched).length,
      matched_count: sn.matchedTotal,
      case_insensitive_matched: Object.keys(sn.caseInsMatched).length,
      case_insensitive_count: sn.caseInsTotal,
      unmatched_userids: Object.keys(sn.unmatched).length,
      unmatched_count: sn.unmatchedTotal,
    },
  },
  blockednum: {
    matched: bn.matched,
    case_insensitive: bn.caseInsMatched,
    unmatched: bn.unmatched,
  },
  member_send_num: {
    matched: sn.matched,
    case_insensitive: sn.caseInsMatched,
    unmatched: sn.unmatched,
  },
  blocked_by_company: blockedByCompany,
  send_num_by_company: sendNumByCompany,
  zero_data_companies: {
    blockednum: zeroBlocked,
    member_send_num: zeroSendNum,
  },
};

fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2), 'utf8');

// ─────────────────────────────────────────────
// 5) 콘솔 요약
// ─────────────────────────────────────────────
console.log('═══════════════════════════════════════════════');
console.log('  교차 매칭 리포트');
console.log('═══════════════════════════════════════════════');
console.log(`[BLOCKEDNUM]`);
console.log(`  레거시 전체             : ${blockedTotal.toLocaleString()}건 (${Object.keys(blockedNum).length}개 USERID)`);
console.log(`  ✅ 이관 대상 매칭       : ${bn.matchedTotal.toLocaleString()}건 (${Object.keys(bn.matched).length}개 USERID)`);
console.log(`  ⚠️  대소문자만 다른 매칭: ${bn.caseInsTotal.toLocaleString()}건 (${Object.keys(bn.caseInsMatched).length}개)`);
console.log(`  ❌ 이관 제외(whitelist外): ${bn.unmatchedTotal.toLocaleString()}건 (${Object.keys(bn.unmatched).length}개 USERID)`);
console.log(`  → 이관 회사 수         : ${Object.keys(blockedByCompany).length}/${Object.keys(companySummary).length}`);
console.log();
console.log(`[MEMBER_SEND_NUM 활성]`);
console.log(`  레거시 전체             : ${sendNumTotal.toLocaleString()}건 (${Object.keys(memberSendNum).length}개 USERID)`);
console.log(`  ✅ 이관 대상 매칭       : ${sn.matchedTotal.toLocaleString()}건 (${Object.keys(sn.matched).length}개 USERID)`);
console.log(`  ⚠️  대소문자만 다른 매칭: ${sn.caseInsTotal.toLocaleString()}건 (${Object.keys(sn.caseInsMatched).length}개)`);
console.log(`  ❌ 이관 제외(whitelist外): ${sn.unmatchedTotal.toLocaleString()}건 (${Object.keys(sn.unmatched).length}개 USERID)`);
console.log(`  → 이관 회사 수         : ${Object.keys(sendNumByCompany).length}/${Object.keys(companySummary).length}`);
console.log();
if (Object.keys(bn.caseInsMatched).length > 0) {
  console.log('[⚠️ 대소문자 불일치 BLOCKEDNUM]');
  for (const [legacy, info] of Object.entries(bn.caseInsMatched)) {
    console.log(`  ${legacy.padEnd(20)} → ${info.mapped.padEnd(20)} ${info.count}건`);
  }
  console.log();
}
if (Object.keys(sn.caseInsMatched).length > 0) {
  console.log('[⚠️ 대소문자 불일치 MEMBER_SEND_NUM]');
  for (const [legacy, info] of Object.entries(sn.caseInsMatched)) {
    console.log(`  ${legacy.padEnd(20)} → ${info.mapped.padEnd(20)} ${info.count}건`);
  }
  console.log();
}
console.log(`[이관 대상인데 레거시 데이터 0건]`);
console.log(`  BLOCKEDNUM 0건 회사     : ${zeroBlocked.length}/${Object.keys(companySummary).length}`);
console.log(`  MEMBER_SEND_NUM 0건 회사: ${zeroSendNum.length}/${Object.keys(companySummary).length}`);
console.log();
console.log(`출력: ${OUT_PATH}`);
