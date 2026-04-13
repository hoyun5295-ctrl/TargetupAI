/**
 * exe 빌드 후 native 모듈(.node)을 build/ 폴더에 복사.
 * better-sqlite3는 C++ native addon이라 pkg에 포함 불가 → exe 옆에 배치.
 */

const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const NODE_MODULES = path.join(__dirname, '..', 'node_modules');

// better-sqlite3 native 바이너리 찾기
function findNativeFile(dir, pattern) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const found = findNativeFile(full, pattern);
      if (found) return found;
    } else if (e.name.endsWith('.node') && full.includes(pattern)) {
      return full;
    }
  }
  return null;
}

// build/ 디렉토리 확인
if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}

// better-sqlite3 native 복사
const sqliteNative = findNativeFile(
  path.join(NODE_MODULES, 'better-sqlite3'),
  'better_sqlite3'
);

if (sqliteNative) {
  const dest = path.join(BUILD_DIR, 'better_sqlite3.node');
  fs.copyFileSync(sqliteNative, dest);
  console.log(`✓ better-sqlite3 native 복사: ${dest}`);
} else {
  console.log('⚠ better-sqlite3 native 파일을 찾을 수 없습니다.');
}

// 기본 agent-config.json 템플릿 생성
const configTemplate = {
  serverUrl: 'https://hanjul-flyer.kr',
  agentKey: '',
  db: {
    type: 'mssql',
    host: 'localhost',
    port: 1433,
    database: '',
    username: 'sa',
    password: '',
  },
  sync: {
    salesIntervalMinutes: 5,
    membersIntervalMinutes: 30,
    inventoryIntervalMinutes: 60,
    heartbeatIntervalSeconds: 60,
    batchSize: 500,
  },
};

const configDest = path.join(BUILD_DIR, 'agent-config.json');
if (!fs.existsSync(configDest)) {
  fs.writeFileSync(configDest, JSON.stringify(configTemplate, null, 2), 'utf-8');
  console.log(`✓ 기본 설정 파일 생성: ${configDest}`);
}

console.log('\n빌드 완료! build/ 폴더를 매장 PC에 복사하세요.');
console.log('실행: hanjul-pos-agent.exe (첫 실행 시 설치 마법사 자동 시작)');
