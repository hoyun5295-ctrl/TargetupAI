/**
 * 레거시 90일 발송이력 USERID 133개 → Excel 템플릿 생성
 * 서팀장님이 옆에 회사명 붙여서 그룹핑 작업용
 *
 * 실행: node migrate-legacy/scripts/generate-whitelist.js
 * 출력: migrate-legacy/data/whitelist-template.xlsx
 */
const path = require('path');
const xlsx = require(path.join(
  'C:',
  'Users',
  'ceo',
  'projects',
  'targetup',
  'packages',
  'backend',
  'node_modules',
  'xlsx'
));

const userids = [
  'isoi', 'toun28', 'shiseido1', 'nain', 'SOOBIN02',
  'kumkang', 'cdfasms123', 'babynews', 'miguhara', 'kumkang2',
  'benetton', 'isae', 'hpio', 'kumkang4', 'pckr',
  'metrocity2', 'idlook', 'shiseido4', 'idlooksms', 'ACEMKT',
  'kumkang3', 'reskin', 'guess', 'isaeshop', 'blanc101',
  'martsmart', 'lumourkorea', 'shiseido3', 'hyobin17', 'benjefe',
  'coreya', 'crispyba', 'dkpharm2', 'gwss', 'comvita',
  'soongsil', 'jessi1', 'songzio', 'skincure', 'soos',
  'choisun', 'icemanim', 'biellee4040', 'mdysresort', 'dsfashion',
  'comvitaon', 'dh200601', 'sgbaek', 'songzio1', 'jessi2',
  'shiseido6', 'rudtjr', 'shw115', 'arnew', 'bhappy1',
  'pdfasms123', 'giantg', 'benjefe2', 'ahbusan', 'kbjfood',
  'lpksgkn', 'Everych', 'mario1', 'lphdmd', 'ydfasms123',
  'idlookcs2', 'gwchae', 'lpkhdhq', 'lpkhdcx', 'benjefe1',
  'lpkhdpg', 'jessi', 'afexkorea', 'lpkglhq', 'laprairie',
  'bhappy2', 'bhappy4', 'lpkltkn', 'techfood', 'lpkltjs',
  'lpklthq', 'lululemon44117', 'hddg2135', 'laprairieak', 'lpkhdch',
  'ACEON', 'jessi3', 'speakingworks', 'ABCOZX', 'lpglgg',
  'lpksghq', 'idlookcs', 'louisquatorze3', 'labelyoung', 'lpksggg',
  'lpksgdg', 'benetton5', 'dp26', 'benetton2', 'benetton1',
  'elensilia', 'lpksgct', 'cnxsol', 'mario6', 'benetton4',
  'benetton3', 'beigic', 'mario4', 'lpkltgj', 'cats0901',
  'mink95', 'benjefe3', 'mario2', 'isoics', 'Treksta',
  'banilaco', 'surane', 'efolium', 'jessi4', 'lpkltbs',
  'lpkhdus', 'louisquatorze1', 'quiksilver', 'repair', 'amc2020',
  'bsuhee1225', 'moonjh0404', 'KISA1', 'ceo', 'dp35',
  'letsrun', 'skwldy1', 'lpcom'
];

console.log(`총 ${userids.length}개 USERID`);

const data = [['USERID'], ...userids.map(id => [id])];

const ws = xlsx.utils.aoa_to_sheet(data);
ws['!cols'] = [{ wch: 25 }];

const wb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(wb, ws, 'whitelist');

const outPath = path.join(
  'C:', 'Users', 'ceo', 'projects', 'targetup',
  'migrate-legacy', 'data', 'whitelist-template.xlsx'
);

xlsx.writeFile(wb, outPath);
console.log('생성 완료:', outPath);
