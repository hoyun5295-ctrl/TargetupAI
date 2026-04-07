const fs = require('fs');
const b = fs.readFileSync('C:\\Users\\ceo\\OneDrive\\문서\\카카오톡 받은 파일\\한줄로_20260406.pdf');
const t = b.toString('latin1');
const pages = (t.match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log('PDF size:', b.length, 'bytes');
console.log('Pages:', pages);
console.log('Has images:', t.includes('/Image'));
