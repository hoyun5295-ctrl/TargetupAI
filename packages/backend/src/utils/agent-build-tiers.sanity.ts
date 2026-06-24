// 수동 새너티 — backend는 단위 테스트 러너 미설치(프로젝트 관례 = tsc + grep + 서버 검증).
// 실행: cd packages/backend && npx ts-node src/utils/agent-build-tiers.sanity.ts
import { PLATFORMS, OS_TIERS, DB_OPTIONS, resolveAgentBuild } from './agent-build-tiers';

let pass = 0;
function check(cond: boolean, label: string): void {
  if (!cond) {
    console.error('  FAIL:', label);
    process.exit(1);
  }
  pass++;
}

// 2008R2 × Oracle 11g → win-legacy-oracle, node12, thick, 동봉, candidate(스모크 전).
const a = resolveAgentBuild('windows', 'win-2008r2', 'oracle-11g');
check(
  a.supported && a.buildTier === 'win-legacy' && a.node === 12 && a.packageKey === 'win-legacy-oracle',
  '2008R2 × Oracle 11g → win-legacy-oracle node12',
);
check(a.driver === 'oracle' && a.mode === 'thick' && a.runtimeBundle === true, 'Oracle 11g node12 = thick + 동봉');
check(a.state === 'candidate', '스모크 전이라 candidate(미노출)');
check(!!a.nativeClient && a.nativeClient.includes('Instant Client'), 'thick = Instant Client 명시');

// 2008R2 × SQL Server 2008 → win-legacy-mssql, 구형 SQL 주의사항.
const b = resolveAgentBuild('windows', 'win-2008r2', 'mssql-2008');
check(b.supported && b.packageKey === 'win-legacy-mssql' && b.mode === 'na', '2008R2 × SQL2008 → win-legacy-mssql');
check(b.dbNotes.join(' ').includes('encrypt=false'), '구형 SQL Server 주의사항 포함');

// ★ win-modern × SQL Server 2008 = blocked (OpenSSL3 vs 옛 TLS).
const c = resolveAgentBuild('windows', 'win-modern', 'mssql-2008');
check(!c.supported && c.state === 'blocked' && !!c.rangeMessage && c.rangeMessage.includes('불가'), 'win-modern × SQL2008 = blocked');

// win-modern × Oracle 19c → thin(클라이언트 불필요).
const d = resolveAgentBuild('windows', 'win-modern', 'oracle-19c');
check(d.supported && d.packageKey === 'win-modern-oracle' && d.mode === 'thin' && d.nativeClient === null, 'win-modern × Oracle 19c = thin');

// CentOS7 × PostgreSQL → linux-legacy-pg node16.
const e = resolveAgentBuild('linux', 'linux-legacy', 'postgres');
check(e.buildTier === 'linux-legacy' && e.node === 16 && e.packageKey === 'linux-legacy-pg', 'CentOS7 × postgres → linux-legacy-pg node16');

// 바닥 미만 → 미지원 + 안내.
const f = resolveAgentBuild('windows', 'win-ancient', 'mssql-2008');
check(!f.supported && f.state === 'blocked' && !!f.rangeMessage && f.rangeMessage.includes('지원 범위 밖'), '바닥 미만 → 미지원 + 안내');

check(PLATFORMS.length === 2, 'PLATFORMS 2개');
check(OS_TIERS.some((t) => /2008 R2|Windows 7/.test(t.label)), 'OS 라벨이 평범한 말');
check(DB_OPTIONS.length >= 6, 'DB 옵션 6개 이상(버전 인지)');
check(DB_OPTIONS.every((o) => ['oracle', 'mssql', 'mysql', 'pg'].includes(o.driver)), '모든 DB 옵션에 driver 매핑');

console.log(`OK — agent-build-tiers sanity ${pass}/${pass} 통과`);
