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

const a = resolveAgentBuild('windows', 'win-2008r2', 'mssql-old');
check(
  a.supported && a.buildTier === 'win-legacy' && a.node === 14 && a.runtimeBundle === true,
  '2008R2 -> win-legacy node14 + 동봉',
);
check(a.dbNotes.join(' ').includes('encrypt=false'), '구형 SQL Server 주의사항 포함');

const b = resolveAgentBuild('windows', 'win-modern', 'mssql-modern');
check(
  b.buildTier === 'win-modern' && b.node === 20 && b.runtimeBundle === false,
  '모던 -> win-modern node20 + 동봉없음',
);

const c = resolveAgentBuild('linux', 'linux-legacy', 'postgres');
check(c.buildTier === 'linux-legacy' && c.node === 16, 'CentOS7 -> linux-legacy node16');

const d = resolveAgentBuild('windows', 'win-ancient', 'mssql-old');
check(
  !d.supported && d.buildTier === null && !!d.rangeMessage && d.rangeMessage.includes('지원 범위 밖'),
  '바닥 미만 -> 미지원 + 안내',
);

check(PLATFORMS.length === 2, 'PLATFORMS 2개');
check(
  OS_TIERS.some((t) => /2008 R2|Windows 7/.test(t.label)),
  'OS 라벨이 평범한 말',
);
check(DB_OPTIONS.length >= 3, 'DB 옵션 3개 이상');

console.log(`OK — agent-build-tiers sanity ${pass}/${pass} 통과`);
