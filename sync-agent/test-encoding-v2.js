const mysql = require('mysql2/promise');

const CP1252 = {0x20ac:0x80,0x201a:0x82,0x0192:0x83,0x201e:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02c6:0x88,0x2030:0x89,0x0160:0x8a,0x2039:0x8b,0x0152:0x8c,0x017d:0x8e,0x2018:0x91,0x2019:0x92,0x201c:0x93,0x201d:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02dc:0x98,0x2122:0x99,0x0161:0x9a,0x203a:0x9b,0x0153:0x9c,0x017e:0x9e,0x0178:0x9f};

function fix(s) {
  const b = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i);
    if (c <= 0xff) b.push(c);
    else if (CP1252[c] !== undefined) b.push(CP1252[c]);
    else return s;
    if (c > 0xffff) i++;
  }
  try {
    const d = Buffer.from(b).toString('utf8');
    if (d.includes('\ufffd')) return s;
    return d;
  } catch { return s; }
}

function containsKorean(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xac00 && c <= 0xd7a3) return true;
  }
  return false;
}

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost', port: 3307,
      user: 'synctest', password: 'synctest123',
      database: 'customer_db', charset: 'utf8mb4'
    });

    // 1. charset 확인
    const [g] = await conn.query('SELECT @@global.character_set_client AS gcc, @@character_set_database AS csdb');
    console.log('=== 1. CHARSET ===');
    console.log('global_client:', g[0].gcc, '| database:', g[0].csdb);
    const suspicious = g[0].gcc === 'latin1' && ['utf8mb4','utf8'].includes(g[0].csdb);
    console.log('의심 조합:', suspicious ? 'YES' : 'NO');

    // 2. 감지 로직 테스트
    console.log('\n=== 2. DETECTION ===');
    const [rows] = await conn.query("SELECT MBR_NM AS val FROM TB_MEMBER WHERE MBR_NM > '' LIMIT 1");
    const original = rows[0].val;
    console.log('원본:', original);
    console.log('원본에 한글?', containsKorean(original));
    const fixed = fix(original);
    console.log('fix후:', fixed);
    console.log('fix후 한글?', containsKorean(fixed));
    const needsFix = !containsKorean(original) && containsKorean(fixed);
    console.log('needsEncodingFix:', needsFix);

    // 3. 전체 적용 테스트
    console.log('\n=== 3. RESULT (5건) ===');
    const [all] = await conn.query('SELECT MBR_NM, REGION_CD, ADDR FROM TB_MEMBER LIMIT 5');
    for (const r of all) {
      const n = needsFix ? fix(r.MBR_NM) : r.MBR_NM;
      const rg = needsFix ? fix(r.REGION_CD || '') : (r.REGION_CD || '');
      const a = needsFix ? fix(r.ADDR || '') : (r.ADDR || '');
      console.log(n, '|', rg, '|', a);
    }

    await conn.end();
    console.log('\n' + (needsFix ? '✅ 감지+보정 모두 정상 → 빌드 GO' : '❌ 감지 실패 → 빌드 중단'));
  } catch (e) {
    console.error('ERROR:', e.message);
  }
})();
