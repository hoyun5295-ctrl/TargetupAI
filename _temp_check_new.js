const XLSX = require('./packages/backend/node_modules/xlsx');
const path = 'C:/Users/ceo/OneDrive/바탕 화면/ID 신규생성리스트.xlsx';

const wb = XLSX.readFile(path, { cellStyles: true });
console.log('Sheets:', wb.SheetNames);
const sheet = wb.Sheets[wb.SheetNames[0]];
const range = XLSX.utils.decode_range(sheet['!ref']);
console.log('Range:', sheet['!ref']);
console.log('Merges:', (sheet['!merges'] || []).length);

// 헤더
const headers = [];
for (let c = range.s.c; c <= range.e.c; c++) {
  const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
  headers.push(String(sheet[addr]?.v || ''));
}
console.log('Headers:', headers);
console.log('');

// 병합셀 값 상속
const mergeValue = {};
for (const m of (sheet['!merges'] || [])) {
  const v = sheet[XLSX.utils.encode_cell(m.s)]?.v;
  for (let r = m.s.r; r <= m.e.r; r++) {
    for (let c = m.s.c; c <= m.e.c; c++) {
      mergeValue[XLSX.utils.encode_cell({ r, c })] = v;
    }
  }
}

// 전체 raw 덤프
console.log('=== 전체 행 덤프 ===');
for (let r = range.s.r + 1; r <= range.e.r; r++) {
  const cells = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r, c });
    const v = mergeValue[addr] !== undefined ? mergeValue[addr] : (sheet[addr] ? sheet[addr].v : '');
    cells.push(String(v || '').trim());
  }
  console.log(`${String(r + 1).padStart(3)} | ${cells[0].padEnd(18)} | ${cells[1].padEnd(30)} | ${cells[2] || ''}`);
}
