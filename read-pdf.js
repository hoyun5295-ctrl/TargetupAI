const { PDFParse } = require('./node_modules/pdf-parse');
const fs = require('fs');
const buf = fs.readFileSync('C:\\Users\\ceo\\OneDrive\\문서\\카카오톡 받은 파일\\한줄로_20260406.pdf');
(async () => {
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  console.log('Pages:', result.total);
  console.log('=== TEXT ===');
  console.log(result.text);
})().catch(e => console.error(e.message));
