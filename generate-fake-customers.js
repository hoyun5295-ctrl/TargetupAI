const XLSX = require('./packages/backend/node_modules/xlsx');

const TOTAL = 10000;

// 성씨 분포 (한국 통계 기반)
const LAST_NAMES = ['김','이','박','최','정','강','조','윤','장','임','한','오','서','신','권','황','안','송','류','전','홍','고','문','양','손','배','백','허','유','남','심','노','하','곽','성','차','주','우','구','민','진','나','탁','도','마','채','원','방','공'];
const MALE_NAMES = ['민준','서준','도윤','예준','시우','하준','주원','지호','지후','준서','준우','현우','도현','건우','우진','선우','서진','민재','현준','연우','유준','정우','승현','승우','태민','지훈','지환','승민','준혁','이준','시윤','동현','재원','민성','수호','윤호','재민','한결','진우','성민','성현','영진','우빈','재현','태현','민규','기현','준호','은우','형준'];
const FEMALE_NAMES = ['서연','서윤','지우','서현','하은','하윤','민서','지유','윤서','채원','수아','지민','지아','은서','다은','예은','수빈','소율','시은','예린','하린','소윤','유진','채은','지윤','유나','아린','예서','소은','나윤','다인','서영','지수','예진','서은','하영','미래','수진','혜원','지영','은지','현지','유빈','다현','민지','하나','세은','아영','보름','연우'];

// 지역 + 주소
const REGIONS = [
  { region: '서울', addresses: ['서울특별시 강남구 역삼동 123-45','서울특별시 서초구 서초동 456-78','서울특별시 마포구 상암동 789-12','서울특별시 송파구 잠실동 234-56','서울특별시 영등포구 여의도동 345-67','서울특별시 강서구 화곡동 111-22','서울특별시 성동구 성수동 333-44','서울특별시 용산구 이태원동 555-66'] },
  { region: '경기', addresses: ['경기도 성남시 분당구 정자동 100-1','경기도 수원시 영통구 매탄동 200-2','경기도 고양시 일산서구 주엽동 300-3','경기도 용인시 수지구 죽전동 400-4','경기도 화성시 동탄면 500-5','경기도 파주시 교하동 600-6','경기도 안양시 동안구 평촌동 700-7'] },
  { region: '인천', addresses: ['인천광역시 연수구 송도동 100-10','인천광역시 남동구 구월동 200-20','인천광역시 부평구 부평동 300-30','인천광역시 서구 청라동 400-40'] },
  { region: '부산', addresses: ['부산광역시 해운대구 우동 100-1','부산광역시 수영구 광안동 200-2','부산광역시 부산진구 부전동 300-3','부산광역시 남구 대연동 400-4'] },
  { region: '대구', addresses: ['대구광역시 수성구 범어동 100-1','대구광역시 달서구 월성동 200-2','대구광역시 중구 동성로 300-3'] },
  { region: '대전', addresses: ['대전광역시 유성구 봉명동 100-1','대전광역시 서구 둔산동 200-2','대전광역시 중구 대흥동 300-3'] },
  { region: '광주', addresses: ['광주광역시 서구 치평동 100-1','광주광역시 북구 용봉동 200-2','광주광역시 남구 봉선동 300-3'] },
  { region: '울산', addresses: ['울산광역시 남구 삼산동 100-1','울산광역시 중구 성남동 200-2'] },
  { region: '세종', addresses: ['세종특별자치시 조치원읍 100-1','세종특별자치시 나성동 200-2'] },
  { region: '강원', addresses: ['강원특별자치도 춘천시 효자동 100-1','강원특별자치도 원주시 무실동 200-2','강원특별자치도 강릉시 교동 300-3'] },
  { region: '충북', addresses: ['충청북도 청주시 상당구 용암동 100-1','충청북도 충주시 성내동 200-2'] },
  { region: '충남', addresses: ['충청남도 천안시 서북구 불당동 100-1','충청남도 아산시 배방읍 200-2'] },
  { region: '전북', addresses: ['전북특별자치도 전주시 덕진구 금암동 100-1','전북특별자치도 익산시 영등동 200-2'] },
  { region: '전남', addresses: ['전라남도 여수시 학동 100-1','전라남도 순천시 연향동 200-2','전라남도 목포시 상동 300-3'] },
  { region: '경북', addresses: ['경상북도 포항시 남구 효자동 100-1','경상북도 구미시 원평동 200-2','경상북도 경주시 동천동 300-3'] },
  { region: '경남', addresses: ['경상남도 창원시 성산구 상남동 100-1','경상남도 김해시 내동 200-2','경상남도 진주시 칠암동 300-3'] },
  { region: '제주', addresses: ['제주특별자치도 제주시 연동 100-1','제주특별자치도 서귀포시 중문동 200-2'] },
];

// 지역별 인구 비중 대략 반영
const REGION_WEIGHTS = [25,26,6,7,5,3,3,2,1,3,3,4,3,3,5,6,1]; // 서울~제주

function weightedRandom(weights) {
  const total = weights.reduce((a,b) => a+b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(startYear, endYear) {
  const y = randomInt(startYear, endYear);
  const m = randomInt(1, 12);
  const d = randomInt(1, 28);
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

// 가상 전화번호 (010-0000-xxxx ~ 010-0099-xxxx, 실제 할당 안 되는 대역)
function fakePhone(idx) {
  const prefix = String(Math.floor(idx / 10000)).padStart(4, '0');
  const suffix = String(idx % 10000).padStart(4, '0');
  return `010${prefix}${suffix}`;
}

const rows = [];

for (let i = 0; i < TOTAL; i++) {
  const gender = Math.random() < 0.48 ? '남' : '여';
  const lastName = LAST_NAMES[randomInt(0, LAST_NAMES.length - 1)];
  const firstNames = gender === '남' ? MALE_NAMES : FEMALE_NAMES;
  const firstName = firstNames[randomInt(0, firstNames.length - 1)];
  const name = lastName + firstName;

  // 연락처: 010-0000-0000 ~ 010-0099-9999 (가상)
  const phone = fakePhone(i);

  // 생년월일: 1955~2005
  const birthDate = randomDate(1955, 2005);

  // 방문횟수: 0~200 (로그 분포)
  const visitCount = Math.min(200, Math.floor(Math.pow(Math.random(), 0.5) * 50));

  // 최종방문일: 2024-01-01 ~ 2026-04-05
  const lastVisitBase = new Date(2024, 0, 1).getTime();
  const lastVisitEnd = new Date(2026, 3, 5).getTime();
  const lastVisitMs = lastVisitBase + Math.random() * (lastVisitEnd - lastVisitBase);
  const lv = new Date(lastVisitMs);
  const lastVisitDate = `${lv.getFullYear()}-${String(lv.getMonth()+1).padStart(2,'0')}-${String(lv.getDate()).padStart(2,'0')}`;

  // 포인트: 0~500,000
  const points = randomInt(0, 500000);

  // 지역 + 주소
  const regionIdx = weightedRandom(REGION_WEIGHTS);
  const regionObj = REGIONS[regionIdx];
  const region = regionObj.region;
  const address = regionObj.addresses[randomInt(0, regionObj.addresses.length - 1)];

  // 누적구매금액: 0~20,000,000 (만원 단위 반올림)
  const totalPurchase = Math.round(Math.pow(Math.random(), 0.7) * 2000) * 10000;

  // 수신동의: 약 75% 동의, 25% 거부
  const smsOptIn = Math.random() < 0.75 ? 'Y' : 'N';

  rows.push({
    '이름': name,
    '연락처': phone,
    '생년월일': birthDate,
    '방문횟수': visitCount,
    '최종방문일': lastVisitDate,
    '포인트': points,
    '지역': region,
    '누적구매금액': totalPurchase,
    '성별': gender,
    '주소': address,
    '수신동의': smsOptIn,
  });
}

// 엑셀 생성
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(rows);

// 컬럼 너비 설정
ws['!cols'] = [
  { wch: 8 },   // 이름
  { wch: 14 },  // 연락처
  { wch: 12 },  // 생년월일
  { wch: 10 },  // 방문횟수
  { wch: 12 },  // 최종방문일
  { wch: 10 },  // 포인트
  { wch: 6 },   // 지역
  { wch: 14 },  // 누적구매금액
  { wch: 6 },   // 성별
  { wch: 40 },  // 주소
  { wch: 10 },  // 수신동의
];

XLSX.utils.book_append_sheet(wb, ws, '고객DB');

const outPath = 'C:\\Users\\ceo\\projects\\targetup\\가상고객DB_10000건.xlsx';
XLSX.writeFile(wb, outPath);
console.log(`완료: ${outPath} (${rows.length}건)`);
