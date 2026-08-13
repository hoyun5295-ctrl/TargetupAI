// ============================================================================
// CT — 싱크에이전트 빌드 티어 룰표 (단일 진실원, AI 판단 0)
// OS(플랫폼+버전) × DB(제품+버전) → 내보낼 패키지 + state + 연결 프로파일.
// 프론트 위저드 / admin-sync endpoint는 이 표만 소비한다. 인라인 복제 금지.
//
//  · 빌드(exe) = buildTier 5개(win-legacy/win-mid/win-modern/linux-legacy/linux-modern).
//    각 exe는 4종 드라이버를 그 node-안전 버전으로 핀 + db/index.ts 지연 require → 교차 사망 불가.
//  · 다운로드(zip) = packageKey = `<buildTier>-<driver>`. DB 버전 커버는 zip 수가 아니라
//    resolveAgentBuild의 state(blocked/candidate/verified) + 연결 프로파일로 처리한다.
//  · 노출은 state로만 가른다(거짓 VERIFIED 재발 차단). VERIFIED_COMBOS(실스모크 통과)만 verified.
//
// 지원 바닥: Windows 2008R2/Win7(+2012 비R2는 보수적으로 node12), Linux glibc>=2.17(CentOS7).
// 설계서 docs/superpowers/specs/2026-06-24-sync-agent-os-db-matrix-v2.md
// ============================================================================

export type PlatformId = 'windows' | 'linux';
export type DriverId = 'oracle' | 'mssql' | 'mysql' | 'pg';

// 검증 상태 — 고객/직원 노출을 가르는 유일한 축.
//  blocked   = 구조적으로 불가(예: node20 OpenSSL3 × SQL Server 2008). 다운로드 숨김.
//  candidate = 빌드 후보(버전 핀 확정, 실연결 스모크 전). 직원 테스트 다운로드 + "검증 전" 표기.
//  verified  = 그 (OS×DB) 실연결 스모크 통과(VERIFIED_COMBOS 등록). "검증됨" 노출.
export type BuildState = 'blocked' | 'candidate' | 'verified';

export interface Platform {
  id: PlatformId;
  label: string;
}

export interface OsTier {
  id: string;
  platform: PlatformId;
  label: string; // 서수란 팀장용 평범한 말 (node/glibc 같은 기술용어 노출 X)
  buildTier: string | null;
  node: 12 | 16 | 20 | null;
  supported: boolean;
  runtimeBundle: boolean; // Windows 구형 = UCRT app-local 동봉
  rangeMessage?: string; // 미지원 안내
}

export interface DbOption {
  id: string; // mssql-2008 | oracle-10g | ...
  driver: DriverId;
  label: string;
  notes: string[];
}

export interface ResolveResult {
  supported: boolean;
  state: BuildState;
  buildTier: string | null;
  driver: DriverId | null;
  packageKey: string | null; // <buildTier>-<driver> = 다운로드 산출물 키
  packageFile: string | null; // = packageKey (하위호환 별칭)
  node: 12 | 16 | 20 | null;
  runtimeBundle: boolean;
  mode: 'thick' | 'thin' | 'na'; // oracle만 thick/thin
  nativeClient: string | null; // Oracle Instant Client 등(thick)
  dbNotes: string[];
  connectionProfile: string;
  installSummary: string[];
  rangeMessage?: string;
}

export const PLATFORMS: Platform[] = [
  { id: 'windows', label: 'Windows' },
  { id: 'linux', label: 'Linux' },
];

export const OS_TIERS: OsTier[] = [
  // Windows
  {
    id: 'win-modern',
    platform: 'windows',
    label: 'Windows 10/11 · Server 2016 이상',
    buildTier: 'win-modern',
    node: 20,
    supported: true,
    runtimeBundle: false,
  },
  {
    id: 'win-2012',
    platform: 'windows',
    label: 'Windows 8.1 · Server 2012 R2',
    buildTier: 'win-mid',
    node: 16,
    supported: true,
    runtimeBundle: true,
  },
  {
    id: 'win-2008r2',
    platform: 'windows',
    // Server 2012(R2 아님)은 node16 동작이 experimental이라 확실히 도는 node12 바닥에 보수적으로 둔다.
    // (node16 최적화는 스모크 확인 후 별도 티어로 승격 가능 — 에러 0 우선.)
    label: 'Windows 7 · Server 2008 R2 · Server 2012(R2 아님)',
    buildTier: 'win-legacy',
    node: 12,
    supported: true,
    runtimeBundle: true,
  },
  {
    id: 'win-ancient',
    platform: 'windows',
    label: '그 이하 (Server 2008 · 2003)',
    buildTier: null,
    node: null,
    supported: false,
    runtimeBundle: false,
    rangeMessage:
      '지원 범위 밖입니다 (Windows는 Server 2008 R2 / Win7 이상만 지원). 가능하면 같은 네트워크의 최신 PC에 에이전트를 설치해 이 DB를 읽어오세요.',
  },
  // Linux
  {
    id: 'linux-modern',
    platform: 'linux',
    label: 'Ubuntu 20.04+ · RHEL 8+ · Debian 10+',
    buildTier: 'linux-modern',
    node: 20,
    supported: true,
    runtimeBundle: false,
  },
  {
    id: 'linux-legacy',
    platform: 'linux',
    label: 'CentOS 7 · RHEL 7 · Ubuntu 14.04~18.04',
    buildTier: 'linux-legacy',
    node: 16,
    supported: true,
    runtimeBundle: false,
  },
  {
    id: 'linux-ancient',
    platform: 'linux',
    label: 'CentOS 6 · RHEL 6 이하',
    buildTier: null,
    node: null,
    supported: false,
    runtimeBundle: false,
    rangeMessage:
      '지원 범위 밖입니다 (Linux는 glibc 2.17 / CentOS 7 이상만 지원). 가능하면 같은 네트워크의 최신 서버에 에이전트를 설치해 이 DB를 읽어오세요.',
  },
];

export const DB_OPTIONS: DbOption[] = [
  {
    id: 'mssql-2008',
    driver: 'mssql',
    label: 'MS SQL Server 2008 · 2008 R2',
    notes: [
      '연결 옵션 encrypt=false 권장',
      '구형 TLS(1.0) — 최신 Windows(요즘 PC)에서는 연결이 막혀 옛 OS에 설치해야 함',
      '읽기전용 계정 사용',
    ],
  },
  {
    id: 'mssql-modern',
    driver: 'mssql',
    label: 'MS SQL Server 2012 이상',
    notes: ['기본 설정으로 연결', '읽기전용 계정 사용'],
  },
  {
    id: 'oracle-10g',
    driver: 'oracle',
    label: 'Oracle 10g',
    notes: [
      '읽기전용 계정 사용',
      'Service Name 방식 연결 (host:port/service)',
      '테이블·컬럼명이 대문자인 경우가 많음 (대문자로 입력)',
    ],
  },
  {
    id: 'oracle-11g',
    driver: 'oracle',
    label: 'Oracle 11g',
    notes: [
      '읽기전용 계정 사용',
      'Service Name 방식 연결 (host:port/service)',
      '테이블·컬럼명이 대문자인 경우가 많음 (대문자로 입력)',
    ],
  },
  {
    id: 'oracle-12c',
    driver: 'oracle',
    label: 'Oracle 12c',
    notes: ['읽기전용 계정 사용', 'Service Name 방식 연결 (host:port/service)'],
  },
  {
    id: 'oracle-19c',
    driver: 'oracle',
    label: 'Oracle 18c · 19c · 21c',
    notes: ['읽기전용 계정 사용', 'Service Name 방식 연결 (host:port/service)'],
  },
  {
    id: 'mysql',
    driver: 'mysql',
    label: 'MySQL / MariaDB',
    notes: ['mysql2 드라이버 사용', '읽기전용 계정 사용'],
  },
  {
    id: 'postgres',
    driver: 'pg',
    label: 'PostgreSQL',
    notes: ['pg 드라이버 사용', '읽기전용 계정 사용'],
  },
  // 엑셀/CSV 파일은 싱크에이전트(DB 커넥터) 소스 아님 — 파일만 있는 회사는 앱 직접 업로드로 처리.
  // 티베로·DB2·Altibase·Sybase·MS Access = 신규 커넥터(Phase B/C). 커넥터 구현 후 추가.
];

// ★ 2026-08-03: 검증은 **버전 세대에 귀속**된다 — 1.7.0은 커서·적재가 통째로 바뀐 다른 물건이라
//   옛 버전에서 통과한 조합이 승계되지 않는다(같은 라벨 다른 물건 금지의 검증판).
//   이 값은 sync-agent/package.json version과 세트로 올린다(에이전트 버전 올림 = 여기도 올림 = 전 조합 자연 폐쇄).
export const CURRENT_AGENT_VERSION = '1.7.1';

// 실연결 스모크 통과 조합(`<osTierId>__<dbId>__<version>`) — 단일 진실원.
// CURRENT_AGENT_VERSION과 일치하는 등재만 verified다. 비어 있으면 전부 candidate — fail-closed.
// [이력 — 현 세대 미승계]
//   win-2008r2__oracle-10g : 2026-06-24 VM(2008R2 RTM 6.1.7600) + Oracle 10g(10.2.0.4) 스모크 통과(당시 1.5.x 세대).
//   win-modern__mysql      : 2026-07-27 Server 2016 VM 전체 통과(1.6.4 세대) → 2026-08-03 1.7.0 smoke PASS(커서 재설계 세대).
export const VERIFIED_COMBOS = new Set<string>([
  // 조합별 스모크 통과 시마다 여기 추가한다(케이스바이케이스 개방).
  // 2026-08-13 smoke-combos PASS — v1.7.1 exe 실행·도커 MySQL 접속·테이블/컬럼 판독·PK 해석(member_id) 68ms.
  //   1.7.1 = 아난티 설치 실측 정정 세대(뷰 목록 포함 · 뷰 지정 키 + 유일성 실측 · 마법사 콘솔 인코딩 · 0건 가드).
  //   마법사 전 구간 자동 주행 실측(뷰 전용 계정 · 복합 키 중복 검출 → 재선택 → 통과)까지 확인 후 등재.
  'win-modern__mysql__1.7.1',
]);

/**
 * ★ 2026-07-03: 자동 업데이트 릴리즈 download_url 생성.
 *   티어별 릴리즈는 티어마다 다른 exe를 무선 서빙해야 하므로 download_url에 티어를 인코딩한다.
 *   GET /api/sync/download/:version 이 <param>을 그대로 sync-agent-<param>.exe 로 서빙(하이픈 허용)하므로
 *   서버 파일명 = sync-agent-<version>-<tier>.exe, 라우트 변경 불필요.
 *   tier 없으면(전역) 종전대로 sync-agent-<version>.exe.
 */
export function buildReleaseDownloadUrl(version: string, tier: string | null | undefined): string {
  return tier
    ? `/api/sync/download/${version}-${tier}`
    : `/api/sync/download/${version}`;
}

/** dbId → driver (DB_OPTIONS의 driver 필드가 진실, 헬퍼는 fallback). */
export function driverOfDb(dbId: string): DriverId | null {
  return DB_OPTIONS.find((d) => d.id === dbId)?.driver ?? null;
}

/**
 * ★ 2026-08-03: 다운로드 게이트 — packageKey(`<buildTier>-<driver>`)로 내려받을 수 있는가.
 *   packageKey 하나에 여러 (osTier×dbId) 조합이 매핑되므로(oracle zip 하나 = 10g~21c),
 *   그중 **하나라도 현 버전 세대에서 verified면** 그 zip은 열린다. 0건이면 닫힌다(fail-closed).
 *   화면 잠금이 아니라 이 서버 길목이 실제 게이트다 — 화면만 잠그면 우회된다.
 */
export function isPackageKeyVerified(packageKey: string): boolean {
  for (const tier of OS_TIERS) {
    if (!tier.buildTier) continue;
    for (const db of DB_OPTIONS) {
      if (`${tier.buildTier}-${db.driver}` !== packageKey) continue;
      if (VERIFIED_COMBOS.has(`${tier.id}__${db.id}__${CURRENT_AGENT_VERSION}`)) return true;
    }
  }
  return false;
}

/**
 * ★ 2026-07-01: Agent가 보고한 os_info(`os.platform()+' '+os.release()`, 예: "win32 6.1.7601")로
 *   buildTier를 판별한다. 자동 업데이트 티어 매칭용 — sync_releases.tier와 대조해 각 에이전트가
 *   자기 티어 exe만 받게 한다(다른 티어 exe 오배포 = 실행 실패 사고 차단).
 *   판별 불가/미지원 OS는 null → 자동 업데이트 대상에서 제외(fail-closed 안전).
 */
export function resolveBuildTierFromOsInfo(osInfo: string | null | undefined): string | null {
  const s = (osInfo || '').toLowerCase().trim();
  if (!s) return null;
  // Windows: "win32 6.1.7601" (platform + release)
  if (s.startsWith('win32') || s.includes('windows')) {
    const m = s.match(/(\d+)\.(\d+)/);
    if (!m) return null;
    const major = parseInt(m[1], 10);
    const minor = parseInt(m[2], 10);
    if (major >= 10) return 'win-modern';               // 10/11 · Server 2016+
    if (major === 6 && minor >= 2) return 'win-mid';    // 8/8.1 · Server 2012 R2
    if (major === 6 && minor <= 1) return 'win-legacy'; // 7 · Server 2008 R2 (isae)
    return null;                                         // 6.0 이하 = 미지원
  }
  // Linux: "linux 5.4.0-..." (kernel). glibc 세분 불가 → kernel major로 보수 판별.
  if (s.startsWith('linux')) {
    const m = s.match(/(\d+)\.(\d+)/);
    const major = m ? parseInt(m[1], 10) : 0;
    return major >= 5 ? 'linux-modern' : 'linux-legacy';
  }
  return null;
}

/**
 * Oracle 연결 모드 + Instant Client + 프로파일 산출.
 * - node12 티어: oracledb 5.x = 항상 thick(thin 미지원) → IC 필수.
 * - node16/20 티어: oracledb 6.x = 12.1+ thin / 10g·11g는 thick + IC.
 * IC 도달표: IC 11.2→DB9.2+ / IC12.1→DB10.2+ / IC12.2·18·19→DB11.2+ / IC21→DB12.1+.
 */
function resolveOracle(
  node: 12 | 16 | 20,
  dbId: string,
): { mode: 'thick' | 'thin'; nativeClient: string | null; connectionProfile: string } {
  const legacyDb = dbId === 'oracle-10g' || dbId === 'oracle-11g'; // < 12.1 → thin 불가
  if (node === 12) {
    // 항상 thick. IC는 DB 버전에 맞춰 동봉.
    const ic =
      dbId === 'oracle-10g'
        ? 'Instant Client 11.2 또는 12.1 (10g 도달 마지막 IC)'
        : dbId === 'oracle-19c'
          ? 'Instant Client 19 (11.2~19c 도달)'
          : 'Instant Client 11.2~19';
    return {
      mode: 'thick',
      nativeClient: ic,
      connectionProfile: `oracledb 5.5.0 thick + initOracleClient. ${ic} 동봉 필요(외부 확보).`,
    };
  }
  // node16/20
  if (legacyDb) {
    return {
      mode: 'thick',
      nativeClient: 'Instant Client 11.2~19',
      connectionProfile:
        'oracledb 6.x를 thick으로(initOracleClient). 10g/11g는 thin(12.1+) 불가 → IC 동봉 필요.',
    };
  }
  return {
    mode: 'thin',
    nativeClient: null,
    connectionProfile: 'oracledb 6.x thin(DB 12.1+). Oracle Client 불필요.',
  };
}

function defaultProfile(driver: DriverId): string {
  switch (driver) {
    case 'mssql':
      return 'mssql(tedious). 로컬 네트워크 encrypt=false + trustServerCertificate 권장.';
    case 'mysql':
      return 'mysql2 드라이버. 읽기전용 계정.';
    case 'pg':
      return 'pg 드라이버. 읽기전용 계정.';
    default:
      return '';
  }
}

function notSupportedResult(tier: OsTier | undefined, dbNotes: string[]): ResolveResult {
  return {
    supported: false,
    state: 'blocked',
    buildTier: null,
    driver: null,
    packageKey: null,
    packageFile: null,
    node: null,
    runtimeBundle: false,
    mode: 'na',
    nativeClient: null,
    dbNotes,
    connectionProfile: '',
    installSummary: [],
    rangeMessage: tier?.rangeMessage ?? '지원 범위 밖이거나 알 수 없는 OS입니다.',
  };
}

/**
 * OS(플랫폼+버전)와 DB(제품+버전)를 받아 내보낼 패키지·state·설치 안내를 돌려준다.
 * 지원 범위 밖이거나 구조적으로 불가한 조합이면 supported=false / state=blocked + rangeMessage.
 */
export function resolveAgentBuild(
  platform: PlatformId,
  osTierId: string,
  dbId: string,
): ResolveResult {
  const tier = OS_TIERS.find((t) => t.platform === platform && t.id === osTierId);
  const db = DB_OPTIONS.find((d) => d.id === dbId);
  const dbNotes = db ? db.notes : [];

  if (!tier || !tier.supported || !tier.buildTier || tier.node === null) {
    return notSupportedResult(tier, dbNotes);
  }
  if (!db) {
    return notSupportedResult(tier, dbNotes);
  }

  const driver = db.driver;
  const node = tier.node;
  const packageKey = `${tier.buildTier}-${driver}`;

  // ── 구조적 blocked 규칙 ───────────────────────────────────────────────
  // node20(OpenSSL 3) × SQL Server 2008/2008R2 = TLS 핸드셰이크 불가(openssl#28284).
  if (driver === 'mssql' && dbId === 'mssql-2008' && (tier.buildTier === 'win-modern' || tier.buildTier === 'linux-modern')) {
    return {
      ...notSupportedResult(tier, dbNotes),
      rangeMessage: `${tier.label}에서는 SQL Server 2008 · 2008 R2 연결이 불가합니다(요즘 OS의 최신 TLS가 옛 SQL Server와 안 맞음). Windows 8.1 / Server 2012 R2 이하 PC에 에이전트를 설치해 연결하세요.`,
    };
  }

  const { mode, nativeClient, connectionProfile } =
    driver === 'oracle'
      ? resolveOracle(node, dbId)
      : { mode: 'na' as const, nativeClient: null, connectionProfile: defaultProfile(driver) };

  // ── state: 현 버전 세대에서 스모크 통과한 조합만 verified, 나머지 candidate(검증 전) ──────────
  const state: BuildState = VERIFIED_COMBOS.has(`${tier.id}__${dbId}__${CURRENT_AGENT_VERSION}`) ? 'verified' : 'candidate';

  const installSummary =
    platform === 'windows'
      ? [
          '받은 폴더를 대상 PC의 C:\\ 바로 아래에 복사 (예: C:\\SyncAgent)',
          ...(mode === 'thick'
            ? node === 12
              ? ['Oracle 연결용 클라이언트(Instant Client)가 폴더에 함께 들어 있어 추가 설치 없이 연결됩니다']
              : [`Oracle Instant Client 폴더를 함께 받아 ORACLE_HOME으로 지정 (${nativeClient})`]
            : []),
          'INSTALL-run-as-admin.bat 을 관리자 권한으로 실행',
          '화면에 sync-agent v… 가 뜨면 정상 (안 뜨면 diagnose.txt 회신)',
          '읽기전용 DB 계정 정보로 설정',
        ]
      : [
          '받은 zip 을 풀어 나온 실행 파일에 실행 권한 부여 (chmod +x sync-agent-…)',
          ...(mode === 'thick'
            ? [`Oracle Instant Client(Linux)를 함께 받아 LD_LIBRARY_PATH/ORACLE_HOME 지정 (${nativeClient})`]
            : []),
          '터미널에서 실행 → 화면에 sync-agent v… 가 뜨면 정상 (상시 실행은 systemd 등록 권장)',
          '읽기전용 DB 계정 정보로 설정',
        ];

  return {
    supported: true,
    state,
    buildTier: tier.buildTier,
    driver,
    packageKey,
    packageFile: packageKey,
    node,
    runtimeBundle: tier.runtimeBundle,
    mode,
    nativeClient,
    dbNotes,
    connectionProfile,
    installSummary,
  };
}
