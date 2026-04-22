// ─────────────────────────────────────────────────────────
// export-prepaid-xlsx.js
// 선불 회사 리스트를 엑셀로 뽑아 서수란님 공유용 전달
//
// 출력: C:\Users\ceo\OneDrive\바탕 화면\레거시_선불_이관_대상.xlsx
// ─────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const XLSX = require('../../packages/backend/node_modules/xlsx');

const DATA_DIR = path.join(__dirname, '..', 'data');
const rollup = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'prepaid-company-rollup.json'), 'utf8'));
const userMap = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'user-map.json'), 'utf8'));

const entries = Object.entries(rollup); // 이미 잔액 내림차순

// ─────────────────────────────────────────────
// Sheet 1: 회사별 합산 (서수란님이 볼 메인 시트)
// ─────────────────────────────────────────────
const sheet1Header = ['순위', '회사 코드', '회사명', '구조', '소속 USERID 수', '소속 USERID', '총 잔액(원)'];
const sheet1Rows = [];
let grandTotal = 0;
entries.forEach(([code, v], idx) => {
  const uidList = v.userids.map((x) => x.userid).join(', ');
  sheet1Rows.push([
    idx + 1,
    code,
    v.company_name,
    v.is_multi ? '다중' : '단독',
    v.userids.length,
    uidList,
    v.total_balance,
  ]);
  grandTotal += v.total_balance;
});
// 합계 행
sheet1Rows.push([]);
sheet1Rows.push(['', '', '', '', '', '합계', grandTotal]);

const sheet1Data = [sheet1Header, ...sheet1Rows];
const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);

// 컬럼 너비
ws1['!cols'] = [
  { wch: 6 },   // 순위
  { wch: 16 },  // 회사 코드
  { wch: 36 },  // 회사명
  { wch: 6 },   // 구조
  { wch: 12 },  // USERID 수
  { wch: 40 },  // USERID
  { wch: 16 },  // 잔액
];

// 금액 셀 숫자 포맷 (G열, 2~(entries.length+1) 행 + 합계 행)
for (let r = 1; r <= sheet1Rows.length; r++) {
  const cellRef = XLSX.utils.encode_cell({ c: 6, r });
  if (ws1[cellRef] && typeof ws1[cellRef].v === 'number') {
    ws1[cellRef].z = '#,##0" 원"';
  }
}

// ─────────────────────────────────────────────
// Sheet 2: USERID별 상세
// ─────────────────────────────────────────────
const sheet2Header = ['레거시 USERID', '회사명', '회사 코드', '구조', '충전 총액(원)', '사용 총액(원)', '잔액(원)', '한줄로 user_id', '한줄로 역할'];
const sheet2Rows = [];
entries.forEach(([code, v]) => {
  v.userids.forEach((u) => {
    const userInfo = userMap[u.userid] || {};
    sheet2Rows.push([
      u.userid,
      v.company_name,
      code,
      v.is_multi ? '다중' : '단독',
      u.charged,
      u.used,
      u.balance,
      userInfo.user_id || '',
      userInfo.user_type || '',
    ]);
  });
});
// 잔액 내림차순 정렬
sheet2Rows.sort((a, b) => b[6] - a[6]);

const sheet2Data = [sheet2Header, ...sheet2Rows];
const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
ws2['!cols'] = [
  { wch: 22 }, // USERID
  { wch: 36 }, // 회사명
  { wch: 16 }, // 회사 코드
  { wch: 6 },  // 구조
  { wch: 16 }, // 충전
  { wch: 16 }, // 사용
  { wch: 16 }, // 잔액
  { wch: 38 }, // user_id
  { wch: 8 },  // 역할
];
// 금액 컬럼 포맷 (E,F,G — index 4,5,6)
for (let r = 1; r <= sheet2Rows.length; r++) {
  for (const c of [4, 5, 6]) {
    const cellRef = XLSX.utils.encode_cell({ c, r });
    if (ws2[cellRef] && typeof ws2[cellRef].v === 'number') {
      ws2[cellRef].z = '#,##0" 원"';
    }
  }
}

// ─────────────────────────────────────────────
// Sheet 3: 요약 (Harold님/서수란님 한눈 파악)
// ─────────────────────────────────────────────
const summarySolo = entries.filter(([,v]) => !v.is_multi).length;
const summaryMulti = entries.filter(([,v]) => v.is_multi).length;
const summary0 = entries.filter(([,v]) => v.total_balance === 0).length;
const summaryUnder1k = entries.filter(([,v]) => v.total_balance > 0 && v.total_balance < 1000).length;
const top5Sum = entries.slice(0, 5).reduce((s, [,v]) => s + v.total_balance, 0);

const sheet3Data = [
  ['레거시 선불 이관 대상 요약'],
  ['생성일', new Date().toISOString().slice(0, 10)],
  [],
  ['항목', '값'],
  ['총 이관 대상 회사 수', entries.length + '개'],
  ['  · 단독회사', summarySolo + '개'],
  ['  · 다중회사', summaryMulti + '개'],
  [],
  ['총 이관 잔액', grandTotal],
  ['TOP 5 회사 합계', top5Sum],
  [`  · TOP 5 비중`, `${((top5Sum / grandTotal) * 100).toFixed(1)}%`],
  [],
  ['잔액 0원 회사', summary0 + '개'],
  ['잔액 1,000원 미만 회사(0 제외)', summaryUnder1k + '개'],
  [],
  ['안내 대상', '영업팀장 서수란님'],
  ['작업 내용', '한줄로 companies 테이블에서 해당 회사들을 billing_type=prepaid + balance=잔액으로 설정'],
  ['비고', '잔액 0원/극소액 업체 이관 여부는 Harold님 최종 판단 후 진행'],
];
const ws3 = XLSX.utils.aoa_to_sheet(sheet3Data);
ws3['!cols'] = [{ wch: 36 }, { wch: 50 }];
// 금액 포맷
for (const r of [8, 9]) { // '총 이관 잔액', 'TOP 5 회사 합계' 값 행
  const cellRef = XLSX.utils.encode_cell({ c: 1, r });
  if (ws3[cellRef] && typeof ws3[cellRef].v === 'number') {
    ws3[cellRef].z = '#,##0" 원"';
  }
}
// 상단 타이틀 병합
ws3['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];

// ─────────────────────────────────────────────
// 워크북 조립 & 저장
// ─────────────────────────────────────────────
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws3, '요약');
XLSX.utils.book_append_sheet(wb, ws1, '회사별 합산');
XLSX.utils.book_append_sheet(wb, ws2, 'USERID별 상세');

const outPaths = [
  'C:/Users/ceo/OneDrive/바탕 화면/레거시_선불_이관_대상.xlsx',
  path.join(DATA_DIR, '레거시_선불_이관_대상.xlsx'),
];
for (const p of outPaths) {
  XLSX.writeFile(wb, p);
  const size = fs.statSync(p).size;
  console.log(`✅ 생성: ${p} (${(size / 1024).toFixed(1)} KB)`);
}

console.log();
console.log('시트 구성:');
console.log('  ① 요약             — 전체 통계');
console.log(`  ② 회사별 합산      — ${entries.length}개 회사 (잔액 내림차순, 합계 포함)`);
console.log(`  ③ USERID별 상세    — ${sheet2Rows.length}명 (충전/사용/잔액)`);
console.log();
console.log(`총 이관 잔액: ${grandTotal.toLocaleString()} 원`);
