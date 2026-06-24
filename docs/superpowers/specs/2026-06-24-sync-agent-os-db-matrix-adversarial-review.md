# 싱크에이전트 OS시대 x DB버전 조합표 적대 검토

작성일: 2026-06-24  
대상 문서: `2026-06-24-sync-agent-os-db-matrix-brainstorm.md`  
검토 관점: Node.js 패키징, DB 드라이버, OS 호환성, native addon, thin/thick, TLS, 국내 on-prem DB 커버리지

---

## 1. 결론

현재 조합표의 큰 방향, 즉 `node-tier x db-driver`로 빌드를 쪼개고 `VERIFIED`를 실스모크 통과 전까지 숨기는 원칙은 맞다. 다만 문서 안에는 아직 "맞을 가능성이 높은 추정"과 "출처로 확인된 사실"이 섞여 있다. 특히 Oracle, MSSQL, PostgreSQL, Phase B DB 쪽은 지금 상태로 `confidence:high`를 붙이면 이번 mssql 9.x `??` 사고와 같은 종류의 거짓 VERIFIED가 재발할 수 있다.

내 의견은 다음이다.

1. `VERIFIED`는 절대 문서/metadata만으로 부여하면 안 된다.
2. `phase A`는 "커넥터를 이미 보유"했다는 뜻으로만 쓰고, "고객에게 노출 가능"이라는 뜻으로 쓰면 안 된다.
3. 각 행은 `candidate`, `smoke-ready`, `verified`, `blocked` 상태를 분리해야 한다.
4. Oracle은 `oracledb major`, `thin/thick`, `Instant Client major`, `DB version`을 한 행에 섞지 말고 반드시 행을 쪼개야 한다.
5. 국내 on-prem 관점에서는 CUBRID, Altibase, Sybase ASE, MS Access가 빠진 것이 실제 시장 커버리지상 큰 구멍이다.

---

## 2. Critical Findings

### F1. `oracledb 5.5.0 node12 prebuilt(NODE_MODULE_VERSION 72)` 표현은 틀렸다

`oracledb@5.0.0`부터 `5.5.0`까지 npm tarball에는 `node-v72` 같은 ABI별 prebuilt가 없다. 포함된 파일은 다음 형태다.

- `build/Release/oracledb-5.5.0-win32-x64.node`
- `build/Release/oracledb-5.5.0-linux-x64.node`
- `build/Release/oracledb-5.5.0-darwin-x64.node`

즉 ABI 72 전용 바이너리가 아니라 플랫폼별 N-API 바이너리다. `oracledb@5.5.0` win32 buildinfo도 Node `v18.8.0`으로 빌드된 것으로 확인된다.

하지만 이것이 곧 "Node 12에서 절대 안 돈다"는 뜻은 아니다. `oracledb@5.0.0`부터 `5.5.0`까지 `package.json`의 `engines.node`는 모두 `>=10.16`이다. 또한 `v5.4.0` CHANGELOG는 stated compatibility를 Node 14/16/18로 올렸지만, older releases back to Node 10.16 should still work라고 적고 있다.

정확한 결론:

- "Node12 ABI72 prebuilt가 실제 게시되었는가?"에 대한 답: 아니다.
- "Node12에서 작동 가능한 후보인가?"에 대한 답: N-API 기준으로 가능성이 있으나, pkg + `.node` 추출 + Oracle Client 로드 + 실 DB 연결 스모크 전에는 미검증이다.
- "명시적 stated compatibility에 Node12가 포함된 마지막 버전"은 `oracledb@5.3.0`이다.
- "npm engines/N-API상 Node12 후보로 볼 수 있는 마지막 5.x"는 `oracledb@5.5.0`이다.

권장 수정:

```md
win-legacy::oracle = oracledb 5.5.0 candidate, Thick-only, N-API platform binary.
Do not describe it as NODE_MODULE_VERSION 72 prebuilt.
confidence: medium until pkg/native-addon/IC/DB smoke passes.
Fallback candidate: oracledb 5.3.0 if 5.5.0 fails on Node 12 VM.
```

출처:

- https://registry.npmjs.org/oracledb/-/oracledb-5.5.0.tgz
- https://registry.npmjs.org/oracledb/5.5.0
- https://raw.githubusercontent.com/oracle/node-oracledb/v5.5.0/INSTALL.md
- https://raw.githubusercontent.com/oracle/node-oracledb/v5.5.0/CHANGELOG.md

### F2. Oracle thin/thick, Instant Client, DB 버전이 한 칸에 섞여 있다

현행 문서에는 "oracledb 6.x thin 기본, 11g/10g는 thick+IC" 같은 문장이 여러 곳에 있다. 방향은 맞지만, 실제로는 다음 축을 분리해야 한다.

- `oracledb 5.x`: Thin mode 없음. Oracle Client library 필요.
- `oracledb 6.x/7.x`: Thin mode 기본. Thin은 DB 12.1+ 직접 연결.
- Thick mode: Oracle Client library 필요.
- 최신 node-oracledb 문서 기준 Thick mode는 Oracle Client 19+를 요구하고, DB 11.2+에 연결 가능하다.
- `oracledb@5.5.0` 문서 기준으로는 Client 21 -> DB 12.1+, Client 19/18/12.2 -> DB 11.2+, Client 12.1 -> DB 10.2+, Client 11.2 -> DB 9.2+다.

권장 수정:

Oracle 패키지 표는 아래처럼 행을 쪼개야 한다.

| OS tier | Node | driver | mode | DB | Oracle Client | 상태 |
|---|---:|---|---|---|---|---|
| win-legacy | 12 | oracledb 5.5.0 | thick | 10.2 | IC 11.2 또는 12.1 | candidate |
| win-legacy | 12 | oracledb 5.5.0 | thick | 11.2 | IC 11.2/12.1/12.2/18/19 | candidate |
| win-legacy | 12 | oracledb 5.5.0 | thick | 12c | IC 12.1/12.2/18/19 | candidate |
| win-mid | 16 | oracledb 6.10.0 또는 7.0.0 | thin | 12.1+ | none | candidate |
| win-mid | 16 | oracledb 6.10.0 또는 7.0.0 | thick | 11.2+ | IC 19+ | candidate |
| win-modern | 20 | oracledb 6.10.0 또는 7.0.0 | thin | 12.1+ | none | candidate |
| win-modern | 20 | oracledb 6.10.0 또는 7.0.0 | thick | 11.2+ | IC 19+ | candidate |

주의할 점:

- `oracledb@6.0.0`은 `engines.node >=14.6`이 맞다.
- `oracledb@6.10.0`과 `oracledb@7.0.0`은 `engines.node >=14.17`이다.
- 문서의 `oracledb 6.10.x`는 실제로 `6.10.0`만 존재한다.

출처:

- https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html
- https://node-oracledb.readthedocs.io/en/latest/user_guide/introduction.html
- https://registry.npmjs.org/oracledb/6.0.0
- https://registry.npmjs.org/oracledb/6.10.0
- https://registry.npmjs.org/oracledb/7.0.0
- https://raw.githubusercontent.com/oracle/node-oracledb/v5.5.0/INSTALL.md

### F3. `mssql@8.1.4 + tedious 14`는 Node12 파싱 관점에서 통과한다

`mssql@8.1.4`의 dependency는 `tedious: ^14.0.0`이다. 실제 설치 해상도는 `tedious@14.7.0`으로 풀린다. `mssql@8.1.4`, `tedious@14.7.0`, `@tediousjs` 하위 JS를 ES2019 기준으로 검사했을 때 Node12 파싱 오류는 없었다. `??`, `?.`, `#private`는 실제 런타임 코드에서 발견되지 않았다.

반대로 `tedious@15.1.3`에는 다음과 같은 `??`가 실제 dist 코드에 남아 있고 ES2019 검사에서 실패한다.

- `lib/data-types/tvp.js`
- `lib/connection.js`
- `lib/instance-lookup.js`
- `lib/request.js`

권장 수정:

```md
win-legacy::mssql = mssql 8.1.4 + tedious 14.7.0 lock.
Do not allow mssql 9.x or tedious 15.x in Node12 tier.
Add CI guard: es-check es2019 against bundled driver tree.
```

추가 주의:

- `tedious@14.6.0`부터 `engines.node >=12.3.0`이다.
- pkg의 node12 런타임이 `12.22.x`인지 확인해야 한다.
- `mssql@9.x`의 `engines.node`는 느슨하게 `>=10`으로 남아 있지만 하위 dependency와 dist syntax 기준으로 Node12 tier에 넣으면 안 된다.

출처:

- https://registry.npmjs.org/mssql/8.1.4
- https://registry.npmjs.org/tedious/14.7.0
- https://registry.npmjs.org/tedious/15.1.3
- https://registry.npmjs.org/mssql/9.3.2

---

## 3. §6 호환 사실 중 수정해야 할 내용

### C1. `pg 8.20.x`는 부정확하다

`pg@8.20.0`은 존재하지만 `pg@8.20.3`은 존재하지 않는다. 현재 npm 최신은 `pg@8.22.0`이다. 더 중요한 것은 Node engines 경계다.

- `pg@8.7.3`: `engines.node >=8.0.0`
- `pg@8.15.6`: `engines.node >=8.0.0`
- `pg@8.16.3`: `engines.node >=16.0.0`
- `pg@8.20.0`: `engines.node >=16.0.0`
- `pg@8.22.0`: `engines.node >=16.0.0`

권장 수정:

```md
win-legacy::pg = pg 8.7.3, or max pg 8.15.6 only after smoke.
node16/node20 tiers may use pg 8.22.0 after smoke.
Do not use floating pg 8.x in Node12 tier.
```

출처:

- https://registry.npmjs.org/pg/8.7.3
- https://registry.npmjs.org/pg/8.15.6
- https://registry.npmjs.org/pg/8.16.3
- https://registry.npmjs.org/pg/8.20.0
- https://registry.npmjs.org/pg/8.22.0

### C2. `mysql2 3.2.0` 경계는 맞지만 lockfile이 본체다

확인 결과는 문서와 대체로 일치한다.

- `mysql2@3.2.0`: `lru-cache ^7.14.1`, `engines.node >=8.0`
- `mysql2@3.2.1`: `lru-cache ^8.0.0`
- `lru-cache@7.18.3`: `engines.node >=12`
- `lru-cache@8.0.0`: `engines.node >=16.14`, dist에 `#private` 존재

권장 수정:

```md
win-legacy::mysql = mysql2 3.2.0 + lru-cache 7.18.3 lock.
Reject if package-lock resolves lru-cache >=8.
Add syntax guard for #private, ??, ?. in bundled dependency tree.
```

출처:

- https://registry.npmjs.org/mysql2/3.2.0
- https://registry.npmjs.org/mysql2/3.2.1
- https://registry.npmjs.org/lru-cache/7.18.3
- https://registry.npmjs.org/lru-cache/8.0.0

### C3. SQL Server TLS 설명은 TDS 버전과 TLS 핸드셰이크를 분리해야 한다

tedious는 `7_1`, `7_2`, `7_3_A`, `7_3_B`, `7_4` 값을 계속 갖고 있다. 따라서 "tedious가 2005/2000을 버려서 안 된다" 식의 설명은 부정확하다. 실제 위험은 Node/OpenSSL 기본값과 SQL Server/SCHANNEL/TLS 설정이다.

확인한 사실:

- Node 12 TLS 기본 `DEFAULT_MIN_VERSION`은 `TLSv1.2`다.
- `--tls-min-v1.0`을 주면 기본 minVersion을 `TLSv1`로 낮출 수 있다.
- Microsoft 문서는 SQL Server 2008/2008 R2/2012/2014가 TLS 1.2를 쓰려면 별도 update가 필요하다고 명시한다.
- SQL Server 2016+는 TLS 1.2를 기본 지원한다.

권장 수정:

```md
SQL Server 2008/2008R2 candidates need two smoke tracks:
1. encrypt:false login-only encryption path
2. Force Encryption/TLS path with --tls-min-v1.0 and, if needed, cryptoCredentialsDetails.minVersion='TLSv1'

Do not mark high until tested against real 2008/2008R2 with and without TLS 1.2 patch.
```

출처:

- https://raw.githubusercontent.com/nodejs/node/v12.22.12/doc/api/tls.md
- https://learn.microsoft.com/en-us/troubleshoot/sql/database-engine/connect/tls-1-2-support-microsoft-sql-server
- https://learn.microsoft.com/en-us/sql/connect/odbc/dsn-connection-string-attribute

### C4. Node OS 경계는 대체로 맞지만 Server 2012 비R2를 별도 처리해야 한다

Node 공식 `BUILDING.md` 기준:

- Node 12: Windows `>= Windows 7/2008 R2/2012 R2`, Linux x64 glibc `>=2.17`
- Node 14/16: Windows `>= Windows 8.1/2012 R2`, 단 Windows Server 2012 non-R2는 experimental
- Node 18/20: Windows `>= Windows 10/Server 2016`, Linux x64 glibc `>=2.28`

권장 수정:

```md
win-legacy = Win7 / Server 2008 R2 / hard legacy
win-2012-experimental = Server 2012 non-R2, Node16 candidate, not Tier1
win-mid = Win8.1 / Server 2012 R2, Node16
win-modern = Win10+ / Server 2016+, Node20
```

출처:

- https://raw.githubusercontent.com/nodejs/node/v12.22.12/BUILDING.md
- https://raw.githubusercontent.com/nodejs/node/v16.20.2/BUILDING.md
- https://raw.githubusercontent.com/nodejs/node/v18.0.0/BUILDING.md
- https://raw.githubusercontent.com/nodejs/node/v20.0.0/BUILDING.md

---

## 4. 빠진 국내/레거시 DB

### D1. CUBRID는 Phase A 후보로 올릴 수 있다

`node-cubrid@11.0.0`은 100% JavaScript 드라이버이고 `engines.node >=4`다. README는 CUBRID `8.4.1+` 호환을 주장한다. tarball에도 `.node` native addon은 없고 JS 파일만 있다.

다만 유지보수 시점은 2022년 이후 정체되어 있으므로 `VERIFIED`로 올리면 안 된다.

권장 추가 행:

| tier | driver | DB version | phase | confidence | note |
|---|---|---|---|---|---|
| win-legacy | node-cubrid 11.0.0 | CUBRID 8.4.1/9.x/10.x/11.x | A-candidate | medium | pure JS, smoke required |
| win-mid | node-cubrid 11.0.0 | CUBRID 9.x/10.x/11.x | A-candidate | medium | pure JS |
| win-modern | node-cubrid 11.0.0 or cubrid-client 1.1.0 | CUBRID 10.x/11.x | A-candidate | medium | cubrid-client requires node >=18 |

출처:

- https://registry.npmjs.org/node-cubrid/11.0.0
- https://registry.npmjs.org/node-cubrid/-/node-cubrid-11.0.0.tgz
- https://registry.npmjs.org/cubrid-client/1.1.0
- https://github.com/CUBRID/node-cubrid

### D2. Altibase는 Phase B다

npm에는 다음 후보가 있다.

- `node-odbc-altibase@1.0.1`: 공식 Altibase unixODBC bindings, `engines.node >=18.0.0`, `lib/bindings/napi-v8/odbc.node` 포함
- `odbc-altibase@0.0.31`: `engines.node >=10.19.0`, source build 전제, prebuilt 없음

즉 legacy/mid에서 바로 Phase A로 올릴 수 없다. 벤더 ODBC, unixODBC, prebuild/소스빌드, pkg native addon 추출을 함께 검증해야 한다.

권장 추가:

```md
Altibase 6.x/7.x = Phase B.
modern candidate: node-odbc-altibase 1.0.1, Node >=18.
legacy candidate: odbc-altibase 0.0.31 source build, Node >=10.19, high risk.
```

출처:

- https://registry.npmjs.org/node-odbc-altibase/1.0.1
- https://registry.npmjs.org/odbc-altibase/0.0.31
- https://github.com/ALTIBASE/node-odbc-altibase

### D3. Sybase ASE는 Phase B다

현실적인 후보는 세 갈래다.

- `sybase@1.2.3`: Java/jConnect bridge, `jconn3.jar` 포함, Java 1.5+ 필요
- `sybase-tds@0.1.1`: pure TypeScript TDS 5.0 후보, `engines.node >=18`, 매우 신생
- FreeTDS/ODBC/JDBC 경유: 운영 안정성은 이쪽이 더 현실적일 가능성이 높다

권장 추가:

```md
Sybase ASE 15.7/16.0 = Phase B.
Do not treat as mssql/tedious compatible.
Use JDBC jConnect or FreeTDS/ODBC track first.
sybase-tds 0.1.1 is research-only until protocol smoke passes.
```

출처:

- https://registry.npmjs.org/sybase/1.2.3
- https://registry.npmjs.org/sybase-tds/0.1.1
- https://registry.npmjs.org/drizzle-sybase/1.2.0

### D4. MS Access는 Windows-only Phase B다

`node-adodb@5.0.3`은 Windows ADODB/OLE DB 방식이며 `engines.node >=6.0.0`이다. README는 다음 연결 문자열을 제시한다.

- Access 2000-2003 `.mdb`: `Provider=Microsoft.Jet.OLEDB.4.0`
- Access 2007+ `.accdb`: `Provider=Microsoft.ACE.OLEDB.12.0` 또는 `15.0`

Access는 서버형 DB가 아니라 파일 DB이므로 DB 매트릭스에서 별도 성격으로 다뤄야 한다.

권장 추가:

```md
MS Access = Windows-only Phase B.
driver candidate: node-adodb 5.0.3.
runtime dependency: Jet 4.0 or ACE OLEDB 12/15/16, matching 32/64-bit.
smoke: readonly SELECT, locked file, password-protected file, UNC path, Korean path.
```

출처:

- https://registry.npmjs.org/node-adodb/5.0.3
- https://registry.npmjs.org/node-adodb/-/node-adodb-5.0.3.tgz
- https://www.microsoft.com/download/details.aspx?id=13255

---

## 5. Build Tool 및 native addon 함정

### B1. `vercel/pkg@5.8.1`은 node20 용도가 아니다

`pkg@5.8.1`은 `pkg-fetch@3.4.2`를 사용한다. pkg-fetch README 및 expected shas에는 node18 target까지 존재하지만 node20은 없다. 따라서 node20 modern tier는 `@yao-pkg/pkg` 계열을 쓰는 것이 맞다.

단, `pkg-fetch` README는 win x64 minimum OS를 Windows 8.1로 적고 있다. Node 공식 BUILDING.md의 Node12 Win7/2008R2 지원과 충돌하므로 `win-legacy`는 공식 문구만으로 VERIFIED 처리하지 말고 2008R2 VM 실측을 source of truth로 삼아야 한다.

출처:

- https://registry.npmjs.org/pkg/5.8.1
- https://registry.npmjs.org/pkg-fetch/3.4.2

### B2. `@yao-pkg/pkg`는 CLI 실행 Node 버전까지 핀해야 한다

확인한 버전:

- `@yao-pkg/pkg@6.10.0`: `engines.node >=18.0.0`
- `@yao-pkg/pkg@6.16.0`: `engines.node >=22.0.0`
- `@yao-pkg/pkg@6.20.0`: `engines.node >=22.0.0`

권장 수정:

```md
modern build tool = @yao-pkg/pkg@6.10.0 initially, build host Node >=18.
Upgrade to later @yao-pkg/pkg only after build host Node22 migration.
```

출처:

- https://registry.npmjs.org/@yao-pkg/pkg/6.10.0
- https://registry.npmjs.org/@yao-pkg/pkg/6.16.0
- https://registry.npmjs.org/@yao-pkg/pkg/6.20.0
- https://registry.npmjs.org/@yao-pkg/pkg-fetch/3.5.30

### B3. native addon은 pkg assets와 추출 경로가 본체다

pkg 문서는 `.node` native addon을 지원하지만, 동적 require이면 자동 감지하지 못하므로 assets에 직접 넣어야 한다고 설명한다. 또한 native addon은 snapshot 내부에서 직접 로드되지 않고 임시 파일로 추출된다. fully static Node binary는 native bindings를 로드할 수 없다는 주의도 있다.

권장 수정:

```md
Native driver tiers must define:
- package.json pkg.assets for *.node
- process.pkg runtime path handling
- temp extraction path permission check
- Oracle IC / ODBC / Db2 CLI dynamic library path
- Linux: LD_LIBRARY_PATH or ldconfig before process start
- Windows: PATH or libDir/initOracleClient path
```

`linuxstatic` 권장:

- mysql/pg/mssql/CUBRID처럼 순수 JS 후보에는 사용 가능하다.
- oracledb thick, odbc, ibm_db, Altibase ODBC, Sybase FreeTDS 같은 native/dynamic library 기반에는 피하는 것이 맞다.

출처:

- https://registry.npmjs.org/@yao-pkg/pkg/6.10.0
- https://registry.npmjs.org/@yao-pkg/pkg-fetch/3.5.30
- https://node-oracledb.readthedocs.io/en/latest/user_guide/initialization.html

---

## 6. 내가 권장하는 상태 모델

현재 문서는 `phase`, `feasible`, `confidence`, `VERIFIED`가 서로 섞여 있다. 이 구조는 위험하다. 아래 상태 모델로 바꾸는 것을 권장한다.

| 상태 | 의미 | 고객 노출 |
|---|---|---|
| `blocked` | 구조적으로 불가 또는 지원 포기 | 숨김 |
| `research` | 드라이버 후보 탐색 중 | 숨김 |
| `candidate` | 버전/빌드 후보 확정, 실스모크 전 | 숨김 |
| `smoke-ready` | VM/DB 준비 완료, 스모크만 남음 | 숨김 |
| `verified` | 해당 OS x Node x driver x DB version 실연결 통과 | 노출 가능 |
| `deprecated` | 과거 verified였으나 보안/유지보수상 숨김 예정 | 제한 노출 |

`phase`는 구현 단계만 나타내야 한다.

- `Phase A`: 현재 코드베이스에 커넥터 있음
- `Phase B`: 새 커넥터 필요
- `Phase C`: 고객 환경/벤더 런타임 의존으로 별도 프로젝트화 필요

`confidence`는 문서 추정 강도일 뿐이고 고객 노출 조건이 되면 안 된다.

---

## 7. 우선순위별 수정 제안

### P0. 바로 고칠 문구

1. `oracledb 5.5.0 node12 prebuilt(NODE_MODULE_VERSION 72)` 삭제
2. `oracledb 6.10.x`를 `oracledb 6.10.0` 또는 `oracledb 7.0.0` 후보로 수정
3. `pg 8.20.x`를 tier별 정확 버전으로 수정
4. `phase A + confidence medium + feasible true`가 고객 노출 가능으로 읽히지 않게 상태 모델 분리
5. `SQL Server 2008/2008R2`는 TDS 버전과 TLS/OpenSSL 문제를 분리

### P1. 다음 스모크 대상

1. `win-legacy::oracle`: Node12 pkg + oracledb 5.5.0 + IC 11.2/12.1/19 각각 로드
2. `win-legacy::mssql`: mssql 8.1.4 + tedious 14.7.0 + SQL Server 2008/2008R2
3. `win-legacy::mysql`: mysql2 3.2.0 + lru-cache 7.18.3 lock 검증
4. `win-legacy::pg`: pg 8.7.3 또는 8.15.6 비교
5. `CUBRID`: node-cubrid 11.0.0으로 8.4.1+/9/10/11 중 최소 2버전 연결

### P2. Phase B 설계 후보

1. Altibase: `node-odbc-altibase@1.0.1` modern 전용, legacy는 `odbc-altibase@0.0.31` 소스빌드 검토
2. Sybase ASE: jConnect/JDBC 또는 FreeTDS/ODBC 우선
3. MS Access: `node-adodb@5.0.3`, Jet/ACE bitness와 파일 잠금 테스트
4. Tibero/DB2: node-odbc/ibm_db 버전별 Node engines와 prebuild 유무 재검토

---

## 8. 최종 의견

이 문서는 방향은 좋지만, 아직 "다운로드 매트릭스 설계서"로 승격하기에는 위험하다. 특히 Oracle과 MSSQL은 같은 `feasible: true`라도 의미가 완전히 다르다.

- MSSQL win-legacy는 `mssql@8.1.4 + tedious@14.7.0 lock`으로 문법 리스크는 꽤 낮다.
- Oracle win-legacy는 `oracledb@5.5.0`이 후보는 맞지만, `NODE_MODULE_VERSION 72 prebuilt`라는 근거는 틀렸고 pkg/native addon/Instant Client 실측 전까지 절대 high가 아니다.
- CUBRID는 국내 DB 커버리지 측면에서 Phase A 후보로 반드시 올릴 가치가 있다.
- Altibase, Sybase ASE, MS Access는 실제 고객사에서 나올 수 있으므로 Phase B 테이블에 당장 추가해야 한다.

따라서 다음 문서 버전은 "정답표"가 아니라 "candidate matrix + smoke matrix"로 바꾸는 것이 맞다. 고객 다운로드 UI에 노출되는 `VERIFIED`는 오직 실연결 스모크 로그가 붙은 행만 허용해야 한다.
