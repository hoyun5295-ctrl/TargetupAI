// ============================================================================
// CT — 싱크에이전트 빌드 티어 룰표 (단일 진실원, AI 판단 0)
// OS(플랫폼+버전) → 내보낼 빌드 티어 + node + 런타임 동봉 + DB 주의사항.
// 프론트 위저드 / admin-sync endpoint는 이 표만 소비한다. 인라인 복제 금지.
// 지원 바닥: Windows 2008R2/Win7, Linux glibc>=2.17(CentOS7). 미만 = 미지원.
// 설계서 docs/superpowers/specs/2026-06-16-sync-agent-build-tiers-design.md
// ============================================================================

export type PlatformId = 'windows' | 'linux';

export interface Platform {
  id: PlatformId;
  label: string;
}

export interface OsTier {
  id: string;
  platform: PlatformId;
  label: string; // 서수란 팀장용 평범한 말 (node/glibc 같은 기술용어 노출 X)
  buildTier: string | null;
  node: 14 | 16 | 20 | null;
  supported: boolean;
  runtimeBundle: boolean; // Windows 구형 = UCRT app-local 동봉
  rangeMessage?: string; // 미지원 안내
}

export interface DbOption {
  id: string;
  label: string;
  notes: string[];
}

export interface ResolveResult {
  supported: boolean;
  buildTier: string | null;
  node: 14 | 16 | 20 | null;
  runtimeBundle: boolean;
  packageFile: string | null; // manifest의 산출물 키(= buildTier id)
  dbNotes: string[];
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
    label: 'Windows 8.1 · Server 2012 / 2012 R2',
    buildTier: 'win-mid',
    node: 16,
    supported: true,
    runtimeBundle: true,
  },
  {
    id: 'win-2008r2',
    platform: 'windows',
    label: 'Windows 7 · Server 2008 R2',
    buildTier: 'win-legacy',
    node: 14,
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
    label: 'CentOS 7 · RHEL 7 · Ubuntu 16~18',
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
    id: 'mssql-old',
    label: 'MS SQL Server 2008 · 2012',
    notes: [
      '연결 옵션 encrypt=false 권장',
      'SQL Server에서 TLS 1.0/1.1 허용 여부 점검',
      '읽기전용 계정 사용',
    ],
  },
  {
    id: 'mssql-modern',
    label: 'MS SQL Server 2016 이상',
    notes: ['기본 설정으로 연결', '읽기전용 계정 사용'],
  },
  {
    id: 'mysql',
    label: 'MySQL / MariaDB',
    notes: ['mysql2 드라이버 사용', '읽기전용 계정 사용'],
  },
  {
    id: 'postgres',
    label: 'PostgreSQL',
    notes: ['pg 드라이버 사용', '읽기전용 계정 사용'],
  },
  {
    id: 'oracle',
    label: 'Oracle',
    notes: [
      '읽기전용 계정 사용',
      'Service Name 방식 연결 (host:port/service)',
      '테이블·컬럼명이 대문자인 경우가 많음 (대문자로 입력)',
    ],
  },
  {
    id: 'excel',
    label: 'Excel 파일 (.xlsx)',
    notes: ['파일 경로 지정', '에이전트가 파일 변경을 감시'],
  },
  {
    id: 'csv',
    label: 'CSV 파일 (.csv)',
    notes: ['파일 경로 지정', '구분자·인코딩 확인 (기본 , / utf-8)'],
  },
];

// 티어별 실연결 검증을 통과한 DB(위저드 db id) — 단일 진실원.
// 빌드 스모크로만 갱신한다 (보이면 작동 불변식: 미검증 조합은 위저드·resolve에서 노출 금지).
// 2026-06-17: oracledb 6.10 thin 모드가 pkg 단일 exe에서 node14/16/20 전부 로드됨을 스모크로 확인
//   → 전 티어에 oracle 등재. (리눅스 2티어는 동일 순수 JS thin — build:tiers 산출 후 실 연결은 운영 실측.)
const ALWAYS_DBS = ['mssql-old', 'mssql-modern', 'mysql', 'postgres', 'oracle', 'excel', 'csv'];
export const VERIFIED_DBS_BY_TIER: Record<string, string[]> = {
  'win-modern': ALWAYS_DBS,
  'win-mid': ALWAYS_DBS,
  'win-legacy': ALWAYS_DBS,
  'linux-modern': ALWAYS_DBS,
  'linux-legacy': ALWAYS_DBS,
};

/**
 * OS(플랫폼+버전)와 DB를 받아 내보낼 빌드와 설치 안내를 돌려준다.
 * 지원 범위 밖이면 supported=false + rangeMessage.
 */
export function resolveAgentBuild(
  platform: PlatformId,
  osTierId: string,
  dbId: string,
): ResolveResult {
  const tier = OS_TIERS.find((t) => t.platform === platform && t.id === osTierId);
  const db = DB_OPTIONS.find((d) => d.id === dbId);
  const dbNotes = db ? db.notes : [];

  if (!tier || !tier.supported || !tier.buildTier) {
    return {
      supported: false,
      buildTier: null,
      node: null,
      runtimeBundle: false,
      packageFile: null,
      dbNotes,
      installSummary: [],
      rangeMessage: tier?.rangeMessage ?? '지원 범위 밖이거나 알 수 없는 OS입니다.',
    };
  }

  // ★ 보이면 작동 불변식: 이 티어에서 실연결 검증 안 된 DB는 차단 (fail-closed)
  const verifiedDbs = VERIFIED_DBS_BY_TIER[tier.buildTier] || [];
  if (dbId && !verifiedDbs.includes(dbId)) {
    return {
      supported: false,
      buildTier: null,
      node: null,
      runtimeBundle: false,
      packageFile: null,
      dbNotes,
      installSummary: [],
      rangeMessage: `${tier.label}에서는 ${db?.label ?? dbId} 연결이 아직 지원되지 않습니다. 같은 네트워크의 최신 PC/서버에 에이전트를 설치해 이 DB를 읽어오세요.`,
    };
  }

  const installSummary =
    platform === 'windows'
      ? [
          '받은 폴더를 대상 PC의 C:\\ 바로 아래에 복사 (예: C:\\SyncAgent)',
          'INSTALL-run-as-admin.bat 을 관리자 권한으로 실행',
          '화면에 sync-agent v… 가 뜨면 정상 (안 뜨면 diagnose.txt 회신)',
          '읽기전용 DB 계정 정보로 설정',
        ]
      : [
          '받은 zip 을 풀어 나온 실행 파일에 실행 권한 부여 (chmod +x sync-agent-…)',
          '터미널에서 실행 → 화면에 sync-agent v… 가 뜨면 정상 (상시 실행은 systemd 등록 권장)',
          '읽기전용 DB 계정 정보로 설정',
        ];

  return {
    supported: true,
    buildTier: tier.buildTier,
    node: tier.node,
    runtimeBundle: tier.runtimeBundle,
    packageFile: tier.buildTier,
    dbNotes,
    installSummary,
  };
}
