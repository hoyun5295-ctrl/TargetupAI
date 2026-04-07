const XLSX = require('./packages/backend/node_modules/xlsx');
const fs = require('fs');

// 1. Excel 검수리스트
try {
  const wb = XLSX.readFile('C:\\Users\\ceo\\OneDrive\\문서\\카카오톡 받은 파일\\한줄로 검수리스트_0406.xlsx');
  for (const name of wb.SheetNames) {
    console.log('=== Sheet:', name, '===');
    const ws = wb.Sheets[name];
    const data = XLSX.utils.sheet_to_csv(ws);
    console.log(data);
    console.log('');
  }
} catch (e) {
  console.log('Excel error:', e.message);
}

// 2. PDF 버그리포트 - 텍스트 추출 시도
console.log('\n\n========== PDF 버그리포트 ==========');
try {
  const pdf = fs.readFileSync('C:\\Users\\ceo\\OneDrive\\문서\\카카오톡 받은 파일\\한줄로_20260406.pdf');

  // Method 1: Look for text in parentheses (standard PDF text)
  const text = pdf.toString('latin1');
  const matches = [];
  let pos = 0;
  while ((pos = text.indexOf('BT', pos)) !== -1) {
    const end = text.indexOf('ET', pos);
    if (end === -1) break;
    const block = text.substring(pos, end);
    const txts = block.match(/\(([^)]*)\)/g);
    if (txts) {
      for (const t of txts) {
        const decoded = t.slice(1, -1);
        if (decoded.length > 0) matches.push(decoded);
      }
    }
    pos = end + 2;
  }

  if (matches.length > 0) {
    console.log('Extracted text objects:', matches.length);
    console.log(matches.join('\n'));
  } else {
    console.log('No standard text objects found. PDF likely uses compressed streams or images.');
    console.log('PDF size:', pdf.length, 'bytes');
    console.log('Pages hint:', (text.match(/\/Type\s*\/Page[^s]/g) || []).length, 'pages');
  }
} catch (e) {
  console.log('PDF error:', e.message);
}
