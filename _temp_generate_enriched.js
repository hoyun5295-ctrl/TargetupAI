const XLSX = require('./packages/backend/node_modules/xlsx');
const srcPath = 'C:/Users/ceo/OneDrive/바탕 화면/90일이내 ID리스트.xlsx';
const outPath = 'C:/Users/ceo/OneDrive/바탕 화면/90일이내_ID리스트_분석v1.xlsx';

// ─── 회사별 기본 영문명 매핑 (63개 회사, 이관완료 2개 회사 포함해서 65개) ───
// 원칙:
// - 공식 브랜드 영문명이 있으면 그것 (예: 라프레리 → laprairie, 베네통 → benetton)
// - 한국 회사는 일반적 로마자 표기 (예: 아난티 → ananti, 금강제화 → kumkang)
// - 유저ID 중 회사를 대표하는 간결한 것 활용 (예: isae, idlook)
// - 애매한 경우 비고 '※검색권장' 표시
const COMPANY_EN = {
  '아우구스티누스 바더': 'augustinus',
  '에이스하드웨어': 'acehardware',
  '주식회사 중평알앤에스': 'afex',
  '아난티': 'ananti',
  '(주)에이엠커머스': 'amcommerce',
  '아르뉴': 'arnew',
  '주식회사 베이컨': 'bacon',
  '바닐라코': 'banilaco',
  '주식회사 페이지': 'paige',
  '베네통': 'benetton',
  '벤제프': 'benjefe',
  '캐럿글로벌': 'carrotglobal',
  '엔에스비': 'nsb',
  '이폴리움': 'efolium',
  '캣츠팩토리': 'catsfactory',
  '크로커다일': 'crocodile',
  '최선어학원': 'choisun',
  '코넥스솔루션': 'connexsol',
  '콤비타코리아': 'comvita',
  '지삼유통': 'jisam',
  '(주)경희 크리스피바바': 'crispybaba',
  '동국제약': 'dongkook',
  '방통대 미디어영상학과': 'knoumedia',
  '방통대 통계 데이터과학과': 'knoustat',
  '디에스패션컴퍼니': 'dsfashion',
  '태영_엘렌실라': 'elensilia',
  '에브리치': 'everych',
  '자이언트골프앤투어_광주점': 'giantgolf',
  '게스코리아': 'guesskorea',
  '(주)고운세상코스메틱': 'gwss',
  '에이치피오_덴프스': 'hpio',
  '아이디룩': 'idlook',
  '이새에프앤씨': 'isae',
  '아이소이': 'isoi',
  '제시뉴욕': 'jessinewyork',
  '금강제화': 'kumkang',
  '크리에이션엘': 'creationl',
  '라프레리': 'laprairie',
  '마리오아울렛': 'mariooutlet',
  '메트로시티': 'metrocity',
  '시세이도': 'shiseido',
  '송지오옴므': 'songzio',
  '숭실원격평생교육원': 'soongsil',
  '수스_대행': 'soos',
  '주식회사 테크푸드': 'techfood',
  'toun28': 'toun28',
  '트렉스타': 'treksta',
  '금정이지어학원': 'easyschool',
  '스킨큐어': 'skincure',
  '미구하라_대행': 'miguhara',
  '나인': 'nain',
  '폴라초이스코리아': 'paulaschoice',
  '주식회사 비알케이컴퍼니': 'brk',
  '에프앤드에이': 'fnda',
  '리스킨_대행': 'reskin',
  '패밀리투': 'familytwo',
  '마트스마트': 'martsmart',
  '무주덕유산리조트': 'mdysresort',
  '룰루레몬애틀라티카코리아유한회사': 'lululemon',
  '라무르코리아': 'lumourkorea',
  '한국마사회': 'letsrun',
  '라벨영화장품': 'labelyoung',
  '강복자식품': 'kbjfood',
  'KISA 테스트_1': 'kisa1',
  '쇼메': 'chaumet',
};

// 유저ID 추정 영문명(기존 유저ID prefix/축약)이 공식 영문명과 다를 때 "검색권장" 표시
// (Harold님이 직접 검색해서 확정 필요한 회사 — 대부분 유명 브랜드라 내가 아는 수준으로 처리했지만 일부 애매)
const SEARCH_RECOMMENDED = new Set([
  '주식회사 중평알앤에스',   // afex? → 공식 영문명 불명
  '주식회사 베이컨',         // bacon? → 가능
  '주식회사 페이지',         // paige? → 공식 불명
  '캣츠팩토리',              // catsfactory? 공식 불명
  '엔에스비',                // nsb? 공식 불명
  '지삼유통',                // jisam? 공식 불명
  '(주)경희 크리스피바바',   // crispybaba? 공식 불명
  '방통대 미디어영상학과',   // knoumedia? → KNOU 한국방송통신대
  '방통대 통계 데이터과학과', // knoustat?
  '태영_엘렌실라',           // elensilia or taeyoung
  '에이치피오_덴프스',       // hpio or denps
  '크리에이션엘',            // creationl? → 공식 불명 (louisquatorze 브랜드 소유사)
  '마리오아울렛',            // mariooutlet? → Mario Outlet
  '금정이지어학원',          // easyschool? (speakingworks 유저ID라 다름)
  '주식회사 비알케이컴퍼니', // brk? → Brk Company (quiksilver 브랜드 소유사)
  '에프앤드에이',            // fnda? (repair 유저ID라 별개)
  '패밀리투',                // familytwo? (rudtjr 유저ID 전혀 다름)
  'KISA 테스트_1',           // kisa1? → 테스트 계정이니 큰 의미 없을 수도
  '쇼메',                    // chaumet → 쇼메 공식 영문명은 Chaumet (프랑스 주얼리), icemanim 유저ID와 무관
]);

// ─── 규칙: 관리자ID = 영문명 + (숫자 포함 'a' | 없음 '01') ───
function hasDigit(s) { return /\d/.test(s); }
function makeAdminId(base) {
  if (!base) return '';
  return base + (hasDigit(base) ? 'a' : '01');
}

// ─── 원본 엑셀 읽기 (병합셀 값 상속 + 노란색 감지) ───
const wb = XLSX.readFile(srcPath, { cellStyles: true });
const sheet = wb.Sheets[wb.SheetNames[0]];
const range = XLSX.utils.decode_range(sheet['!ref']);

const mergeValue = {};
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

const rows = [];
for (let r = range.s.r + 1; r <= range.e.r; r++) {
  const cells = [];
  let yellow = false;
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r, c });
    const cell = sheet[addr];
    const v = mergeValue[addr] !== undefined ? mergeValue[addr] : (cell ? cell.v : '');
    cells.push(v);
    if (cell && cell.s && isYellow(cell.s)) yellow = true;
  }
  rows.push({
    유저ID: String(cells[0] || '').trim(),
    사용자명: String(cells[1] || '').trim(),
    회사명: String(cells[2] || '').trim(),
    yellow,
  });
}

// ─── 회사별 "기존 유저ID 목록"과 "관리자ID 충돌 체크" ───
const existingUserIds = new Set(rows.map(r => r.유저ID));
const companyMembers = {};  // 회사명 → [유저ID]
for (const r of rows) {
  if (!companyMembers[r.회사명]) companyMembers[r.회사명] = [];
  companyMembers[r.회사명].push(r.유저ID);
}

// ─── 누락된 영문명 체크 + 경고 로그 ───
const missing = new Set();
for (const r of rows) {
  if (!COMPANY_EN[r.회사명]) missing.add(r.회사명);
}
if (missing.size > 0) {
  console.log('⚠️ 영문명 매핑 누락 회사:');
  for (const c of missing) console.log('   -', c);
  console.log('');
}

// ─── 신규 엑셀 데이터 조립 ───
const enriched = rows.map(r => {
  const en = COMPANY_EN[r.회사명] || '';
  const admin = r.yellow ? '(이관완료)' : makeAdminId(en);
  const memberCount = (companyMembers[r.회사명] || []).length;
  const adminConflict = existingUserIds.has(admin);

  const notes = [];
  if (r.yellow) notes.push('🟡이관완료');
  if (SEARCH_RECOMMENDED.has(r.회사명)) notes.push('※영문명검색권장');
  if (adminConflict && !r.yellow) notes.push('⚠️관리자ID가 기존유저ID와 동일');
  if (memberCount >= 2) notes.push(`그룹${memberCount}명`);

  return {
    '유저ID': r.유저ID,
    '사용자명': r.사용자명,
    '회사명': r.회사명,
    '회사코드(영문)': en,
    '관리자ID(제안)': admin,
    '인원': memberCount,
    '이관상태': r.yellow ? '완료' : '대기',
    '비고': notes.join(' / '),
  };
});

// ─── 엑셀 쓰기 ───
const ws = XLSX.utils.json_to_sheet(enriched);
// 컬럼 폭 조정 (가독성)
ws['!cols'] = [
  { wch: 18 }, // 유저ID
  { wch: 32 }, // 사용자명
  { wch: 24 }, // 회사명
  { wch: 18 }, // 회사코드
  { wch: 18 }, // 관리자ID
  { wch: 6 },  // 인원
  { wch: 10 }, // 이관상태
  { wch: 40 }, // 비고
];

const newWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(newWb, ws, '분석v1');
XLSX.writeFile(newWb, outPath);

console.log('✅ 저장:', outPath);
console.log('');
console.log('=== 요약 ===');
console.log('전체 행:', rows.length);
console.log('이관 완료 (노란색):', rows.filter(r => r.yellow).length);
console.log('이관 대기:', rows.filter(r => !r.yellow).length);
console.log('고유 회사:', Object.keys(companyMembers).length);
console.log('영문명 매핑 누락:', missing.size);

// 관리자ID 충돌 건수
const conflicts = enriched.filter(e => e['비고'].includes('관리자ID가 기존유저ID와 동일'));
console.log('관리자ID ↔ 기존유저ID 충돌:', conflicts.length);
if (conflicts.length > 0) {
  for (const c of conflicts) {
    console.log(`  · ${c['유저ID'].padEnd(18)} | 회사="${c['회사명']}" | 관리자ID="${c['관리자ID(제안)']}"`);
  }
}

// 검색권장 회사 리스트
console.log('');
console.log('=== ※영문명 검색권장 회사 (', SEARCH_RECOMMENDED.size, '개) ===');
for (const c of SEARCH_RECOMMENDED) {
  console.log(`  · ${c} → 현재 제안: "${COMPANY_EN[c]}"`);
}
