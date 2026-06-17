# 싱크에이전트 표준 DB 완전 대응 설계 (2026-06-17)

## 1. 배경

어제(2026-06-16) OS별 빌드 5티어 + 배포 위저드를 만들었으나, DB 지원에 구멍이 있다.

- 싱크에이전트 소스는 DB 6종을 정의(`mssql / mysql / oracle / postgres / excel / csv`)하고, 고객 설정 화면(CLI + 웹 setup)과 팩토리·config 스키마·기본포트까지 Oracle을 전부 갖췄다.
- Oracle 커넥터(`oracle.ts`)도 완전 구현(연결·테이블·컬럼·증분조회·한글 NLS)이다.
- 그런데 `oracledb` 드라이버가 `package.json`·node_modules·package-lock 어디에도 없다. esbuild에서도 external 제외(주석 "선택적")라 빌드에 포함되지 않는다.
- 결과: 고객이 Oracle을 고르면 연결 순간 `require('oracledb')` 실패 → "oracledb 패키지가 설치되지 않았습니다" 에러. **화면엔 보이는데 런타임에 100% 실패**한다.
- 배포 위저드 DB 안내표(`agent-build-tiers.ts` `DB_OPTIONS`)에는 Oracle 자체가 없다(MSSQL 2종 / MySQL / PostgreSQL 4종뿐). Excel/CSV도 빠져 있다.

원격 설치 2회 리젝의 직접 원인은 OS(2008 R2)였고 그건 어제 구형 티어 빌드로 해결했다. DB는 별개 축이며, 위 Oracle 구멍이 같은 종류(말없이 죽음)의 다음 리젝 씨앗이다.

## 2. 범위 (Harold 확정 2026-06-17)

일반 기업이 실제로 쓰는 표준 DB를 **완벽하게** 대응한다. 드문 DB는 실제 고객이 나오면 그때 대응한다.

### 대응 (이번 작업)
| DB | 현재 | 이번 작업 |
|----|------|-----------|
| MS SQL Server (2008~최신) | 작동 | 재검증 |
| MySQL / MariaDB | 작동 | 재검증 |
| PostgreSQL | 작동 | 재검증 |
| Oracle | 코드만 있고 런타임 실패 | **드라이버 번들 + 티어별 실연결 검증 — 핵심 작업** |
| Excel / CSV | 작동(에이전트) / 위저드 누락 | 위저드 노출 일치 |

### 보류 (코드 없음, 설계 자리만)
- 티베로(Tibero), DB2, 알티베이스 등 = Node 전용 드라이버가 없어 ODBC/JDBC 경유만 가능. 지금 코드로 만들지 않는다.
- 대신 `db/index.ts` 팩토리와 CT에 ODBC 확장 지점(주석 + 분기 자리)만 남겨, 나중에 고객이 나오면 커넥터 하나 추가로 끝나게 한다.

## 3. 핵심 불변식 — "보이면 반드시 작동"

어제 Oracle 버그(UI엔 있는데 런타임 죽음)를 코드 구조로 영구 차단한다.

> 위저드·설정 화면에 노출되는 DB는, 그 빌드 티어에서 실제 연결 검증을 통과한 것만이다. 미검증 조합은 노출 자체를 막거나 "준비 중/별도 문의"로 명확히 안내한다.

이를 위해 CT가 **티어 × DB 지원표**를 단일 진실원으로 보유하고, 위저드·resolve·다운로드가 이 표만 소비한다(인라인 판정 금지).

## 4. 변경 지점

### 4-1. 에이전트 드라이버 번들 (sync-agent/)
- `package.json` dependencies에 `oracledb` 추가(메인 node20 기준 버전).
- esbuild `external`에 oracledb는 이미 있음(유지) — 번들엔 require만 남고 pkg가 node_modules에서 포함.
- **pkg 동적 require 함정:** `oracle.ts`는 `require('oracledb')`를 try/catch 안에서 동적 호출한다. pkg 정적 분석이 이를 못 잡을 수 있으므로, `package.json`의 `pkg.scripts`/`assets`에 oracledb를 명시해 강제 포함한다.
- **네이티브 바이너리(.node) 처리:** oracledb는 thin 모드(순수 JS)라 Oracle Client는 불필요하나, 패키지 자체에 네이티브 애드온이 동봉된다. 단일 .exe(pkg)에서 thin 연결이 .node 없이 되는지 빌드 실측으로 확인하고, 필요 시 win 구형 티어는 `bundle-windows-runtime.js`로 .node를 exe 옆에 app-local 동봉(UCRT DLL과 동일 방식).
- **티어별 버전 핀:** `build-tier.js`의 레거시 분기(현재 `npm i express@4.22.2 mssql@10.0.4 --no-save`)에 oracledb의 node14/node16 호환 버전을 추가한다. oracledb 6.x는 node 14.6+ 프리빌드 제공 — 정확한 호환 버전은 빌드 실측으로 확정(추측 금지).

### 4-2. CT — `packages/backend/src/utils/agent-build-tiers.ts`
- `DB_OPTIONS`에 `oracle` 추가(읽기전용 계정·service name 연결·대문자 식별자 주의 notes). `excel`/`csv`도 추가해 에이전트 능력과 일치.
- **티어 × DB 지원표 신설:** 각 티어가 실제 연결 검증을 통과한 DB 목록을 보유. `resolveAgentBuild`가 (tier, db) 미검증 조합이면 `supported:false` + 안내 메시지 반환.
- 위저드 부트스트랩이 전체 DB를 받되, 선택된 티어 기준으로 노출 가능 DB를 알 수 있도록 표를 함께 노출.

### 4-3. 배포 위저드 — `AgentDeployWizard.tsx`
- DB 단계(step 3)를 **티어 인지**로: 선택한 OS 티어에서 검증된 DB만 카드로 노출(미검증은 비노출 또는 비활성 + 사유). CT 표만 소비, 매핑 인라인 금지.
- 결과 단계는 기존 dbNotes/installSummary 흐름 유지.

### 4-4. 고객 설정 화면 (sync-agent/src/setup/)
- `cli.ts`·`setup-html.ts`·`setup-ui/index.html`의 DB 선택지는 에이전트가 실제 연결 가능한 것만 유지(현재 Oracle 포함 — 번들 후 실제 작동하므로 유지). 미지원 DB는 노출하지 않음(현재 티베로/DB2 미노출 — 유지).
- 연결 테스트 실패 시 조용히 죽지 않고 사용자에게 원인 메시지를 노출하는지 확인·보강(server.ts test-connection 경로).

### 4-5. 다운로드 일치 — `admin-sync.ts` + `build-tiers.js`
- 다운로드는 티어별 .exe 1개이고 모든 표준 드라이버가 그 안에 포함되므로, 4-1이 충족되면 다운로드 산출물이 자동으로 일치한다.
- `build-tiers.js`가 만든 티어 zip을 서버 `agent-builds/`에 올려야 위저드 다운로드가 서빙(기존 구조 유지). 빌드머신↔서버 분리라 빌드 후 zip 업로드 1회 필요(기존과 동일).

### 4-6. ODBC 확장 지점 (설계만, 코드 없음)
- `db/types.ts`의 `DbType`에 향후 `'odbc'` 추가 예정 주석.
- `db/index.ts` 팩토리에 `case 'odbc'` 자리 주석.
- CT `DB_OPTIONS`에 "드라이버 설치 필요" 플래그 필드 설계(미사용, 향후 티베로/DB2가 들어올 자리).

## 5. 빌드·검증 계획 (3단계 신뢰)

추측 통과 보고 금지. 단계별 증거로만 완료를 말한다.

1. **유닛:** `oracle.ts` 타입 매핑·식별자 sanitize·행 정규화 등 순수 로직 테스트(기존 vitest 패턴). 실제 DB 불요.
2. **빌드 스모크:** 5티어 각각 빌드 후 packed 산출물에서 `require('oracledb')`가 에러 없이 로드되는지 확인(node14/16/20). 실패 티어는 지원표에서 Oracle 제외 + 위저드 비노출.
3. **실연결 실측(Harold/직원):** 실제 Oracle 인스턴스에 읽기전용 계정으로 연결 → 테이블·컬럼 조회·증분 1건. (로컬에 Oracle 인스턴스가 없어 본 단계는 운영 측 실측 영역.)

기존 MSSQL/MySQL/PostgreSQL 고객은 무손 — 드라이버 추가만 있고 기존 경로 변경 없음을 빌드·tsc로 확인.

## 6. 리스크

- **oracledb pkg 번들(특히 node14 레거시):** 네이티브 애드온 + 동적 require 조합이 pkg에서 막힐 수 있음. 빌드 스모크 전엔 장담 불가 → 5단계 2번이 게이트. 막히면 해당 티어는 Oracle 비노출(불변식이 사고를 막음).
- **레거시 node14에서 oracledb 미지원 가능성:** 그 경우 win-legacy(2008R2/Win7) 티어는 Oracle 비노출로 처리하고 위저드가 "이 OS에서는 최신 PC에 에이전트 설치 후 Oracle 연결 권장"으로 안내(기존 rangeMessage 패턴 재사용).

## 7. 작업 순서

1. CT에 oracle/excel/csv + 티어×DB 지원표 추가, resolve 미검증 분기.
2. 에이전트 oracledb 의존성·pkg 포함 설정, build-tier.js 티어별 핀.
3. 5티어 빌드 스모크 → 지원표 확정(통과 티어만 Oracle on).
4. 위저드 티어 인지 DB 노출.
5. 설정 화면 연결 실패 메시지 보강.
6. tsc 0 + 유닛 GREEN + 박-단어/모델명/native dialog grep 0 → 종료.

## 8. 비고

- git/배포는 Harold 직접. 본 문서 작성·검토 후 구현 진입.
- 본 작업은 발송·돈에 직접 닿지 않음(고객 DB 읽기 전용). 단 리젝 직결이라 불변식(보이면 작동)이 최우선.
