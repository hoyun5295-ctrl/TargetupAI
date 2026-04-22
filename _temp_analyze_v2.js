const XLSX = require('./packages/backend/node_modules/xlsx');
const path = 'C:/Users/ceo/OneDrive/바탕 화면/90일이내 ID리스트.xlsx';

const wb = XLSX.readFile(path, { cellStyles: true });
const sheetName = wb.SheetNames[0];
const sheet = wb.Sheets[sheetName];
const range = XLSX.utils.decode_range(sheet['!ref']);

// ─── 1. 병합셀 맵 구축 — 병합 범위 내 셀은 좌상단 셀 값을 상속 ───
const mergeValue = {};  // 'Cr' → 좌상단 값 (회사명)
if (sheet['!merges']) {
  for (const m of sheet['!merges']) {
    const topLeft = XLSX.utils.encode_cell(m.s);
    const v = sheet[topLeft]?.v;
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        mergeValue[addr] = v;
      }
    }
  }
}

// ─── 2. 노란색 감지 헬퍼 ───
function isYellow(style) {
  if (!style) return false;
  const candidates = [
    style.fgColor?.rgb,
    style.bgColor?.rgb,
    style.fill?.fgColor?.rgb,
    style.fill?.bgColor?.rgb,
    style.patternFill?.fgColor?.rgb,
    style.patternFill?.bgColor?.rgb,
  ].filter(Boolean).map(s => String(s).toUpperCase());
  for (const c of candidates) {
    if (c.includes('FFFF00') || c.includes('FFEB9C') || c.includes('FFF2CC') || c.includes('FFFFC0')) return true;
  }
  return false;
}

// ─── 3. 헤더 ───
const headers = [];
for (let c = range.s.c; c <= range.e.c; c++) {
  const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
  headers.push(String(sheet[addr]?.v || ''));
}

// ─── 4. 데이터 행 읽기 (병합셀 값 상속 + 노란색 감지) ───
const rows = [];
for (let r = range.s.r + 1; r <= range.e.r; r++) {
  const cells = [];
  let yellow = false;
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r, c });
    const cell = sheet[addr];
    // 병합셀이면 merge 값 사용, 아니면 원본
    const v = mergeValue[addr] !== undefined ? mergeValue[addr] : (cell ? cell.v : '');
    cells.push(v);
    if (cell && cell.s && isYellow(cell.s)) yellow = true;
  }
  rows.push({
    excelRow: r + 1,
    유저ID: String(cells[0] || '').trim(),
    사용자명: String(cells[1] || '').trim(),
    회사명: String(cells[2] || '').trim(),
    yellow,
  });
}

// ─── 5. 기본 통계 ───
console.log('═══════════════════════════════════════════════');
console.log('📊 기본 통계');
console.log('═══════════════════════════════════════════════');
console.log('시트 범위:', sheet['!ref'], '(총', rows.length, '행)');
console.log('병합셀:', (sheet['!merges'] || []).length, '개');
console.log('');
const migrated = rows.filter(r => r.yellow);
const pending = rows.filter(r => !r.yellow);
console.log('🟡 이관 완료 (노란색):', migrated.length);
console.log('⚪ 이관 대상 (미이관):', pending.length);
console.log('');

// ─── 6. 회사별 그룹핑 (회사명 기준 — 병합셀 값 상속되어 있으므로 정확) ───
const byCompany = {};
for (const row of pending) {
  const key = row.회사명 || '(회사명 없음)';
  if (!byCompany[key]) byCompany[key] = [];
  byCompany[key].push(row);
}

const groups = Object.entries(byCompany)
  .map(([company, members]) => ({
    company,
    count: members.length,
    members,
    // 사용자명 == 회사명 → 대표(관리자) 후보
    adminCandidates: members.filter(m => m.사용자명 === company),
  }))
  .sort((a, b) => b.count - a.count);

console.log('═══════════════════════════════════════════════');
console.log('🏢 이관 대상 회사 그룹 (', groups.length, '개)');
console.log('═══════════════════════════════════════════════');
console.log('');

// 다중 멤버 먼저
const multi = groups.filter(g => g.count >= 2);
console.log('── 다중 멤버 그룹 (N≥2):', multi.length, '개 / 인원', multi.reduce((s,g)=>s+g.count,0),' ──');
console.log('');
for (const g of multi) {
  const mark = g.adminCandidates.length > 0 ? '★' : '⚠️';
  console.log(`${mark} [${g.count}명] ${g.company}${g.adminCandidates.length === 0 ? ' (대표ID 후보 없음)' : ''}`);
  for (const m of g.members) {
    const isAdmin = m.사용자명 === g.company;
    const prefix = isAdmin ? '  👑' : '    ';
    console.log(`  ${prefix} ${m.유저ID.padEnd(18)} | ${m.사용자명}`);
  }
  console.log('');
}

const singles = groups.filter(g => g.count === 1);
console.log('── 단독 멤버 (N=1):', singles.length, '개 ──');
const singleAdmin = singles.filter(g => g.adminCandidates.length > 0);
const singleOther = singles.filter(g => g.adminCandidates.length === 0);
console.log(`   · 사용자명=회사명 (관리자 자동 가능): ${singleAdmin.length}개`);
console.log(`   · 불일치: ${singleOther.length}개`);
console.log('');

console.log('  [A] 사용자명 = 회사명 (👑 관리자 자동):');
for (const g of singleAdmin) {
  const m = g.members[0];
  console.log(`      ${m.유저ID.padEnd(18)} | ${m.사용자명}`);
}
console.log('');

if (singleOther.length > 0) {
  console.log('  [B] 불일치 (사용자명 ≠ 회사명):');
  for (const g of singleOther) {
    const m = g.members[0];
    console.log(`      ${m.유저ID.padEnd(18)} | 사용자="${m.사용자명}" | 회사="${m.회사명}"`);
  }
}

// ─── 7. 이관 완료 (노란색) ───
console.log('');
console.log('═══════════════════════════════════════════════');
console.log('🟡 이관 완료 (', migrated.length, '명)');
console.log('═══════════════════════════════════════════════');
for (const r of migrated) {
  console.log(`  ${r.유저ID.padEnd(18)} | ${r.사용자명.padEnd(30)} | 회사="${r.회사명}"`);
}

// ─── 8. 전체 raw 덤프 (참고용) ───
console.log('');
console.log('═══════════════════════════════════════════════');
console.log('📋 전체 raw 덤프 (병합셀 값 상속 + 노란색)');
console.log('═══════════════════════════════════════════════');
for (const r of rows) {
  const mark = r.yellow ? '🟡' : '  ';
  console.log(`${String(r.excelRow).padStart(3)} ${mark} | ${r.유저ID.padEnd(18)} | ${r.사용자명.padEnd(30)} | ${r.회사명}`);
}
