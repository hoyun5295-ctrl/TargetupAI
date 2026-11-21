// 한줄로 파비콘 E(남색 칸 + 「한」 + 그라데이션 줄) → packages/frontend/public 아이콘 파일 · 원본 = docs/mockups/favicon-candidates
const sharp = require('C:/Users/ceo/projects/targetup/packages/backend/node_modules/sharp');
const fs = require('fs');
const SRC = 'C:/Users/ceo/projects/targetup/docs/mockups/favicon-candidates';
const PUB = 'C:/Users/ceo/projects/targetup/packages/frontend/public';
const main = fs.readFileSync(`${SRC}/e-navy-han.svg`, 'utf8');
const full = main.replace('<rect width="32" height="32" rx="7.5" fill="#0F172A"/>', '<rect width="32" height="32" fill="#0F172A"/>');   // iOS 가 모서리를 깎는다 = 꽉 찬 칸
if (full === main) throw new Error('apple 판 치환 실패');
const r = (svg, n) => sharp(Buffer.from(svg), { density: 72 * n / 32 }).resize(n, n).png().toBuffer();
(async () => {
  const p16 = await sharp(fs.readFileSync(`${SRC}/e-16px.svg`), { density: 72 }).resize(16, 16).png().toBuffer();
  const p32 = await sharp(fs.readFileSync(`${SRC}/e-32px.svg`), { density: 72 }).resize(32, 32).png().toBuffer();
  const p48 = await r(main, 48);
  const files = {
    'favicon-16x16.png': p16, 'favicon-32x32.png': p32, 'favicon-48x48.png': p48,
    'apple-touch-icon.png': await r(full, 180),
    'android-chrome-192x192.png': await r(main, 192), 'android-chrome-512x512.png': await r(main, 512), 'favicon-preview.png': await r(main, 512),
  };
  // ICO = PNG 프레임 셋(16 · 32 · 48)
  const frames = [[16, p16], [32, p32], [48, p48]];
  const head = Buffer.alloc(6 + 16 * frames.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(frames.length, 4);
  let off = head.length;
  frames.forEach(([n, b], i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(n, e); head.writeUInt8(n, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += b.length;
  });
  files['favicon.ico'] = Buffer.concat([head, ...frames.map(([, b]) => b)]);
  for (const [f, b] of Object.entries(files)) fs.writeFileSync(`${PUB}/${f}`, b);
  for (const f of Object.keys(files)) { const m = f.endsWith('.ico') ? null : await sharp(`${PUB}/${f}`).metadata(); console.log(f, fs.statSync(`${PUB}/${f}`).size, m ? `${m.width}x${m.height} ${m.channels}ch` : 'ico'); }
})();
