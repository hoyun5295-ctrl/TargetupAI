# 싱크에이전트 OS시대 × DB버전 조합표 — v2 (후보표 + 스모크표)

> 작성: 2026-06-24 · 단계: **브레인스토밍 확정본(설계서 직전)**
> 전신: v1 `2026-06-24-sync-agent-os-db-matrix-brainstorm.md` + GPT 적대 검토 `2026-06-24-sync-agent-os-db-matrix-adversarial-review.md`
> v2 = 비토(나) 리서치 + GPT 적대 검토 + 비토 보정 1건을 합친 확정본. **이 문서는 "정답표"가 아니라 "후보표 + 스모크표"다.** 고객에게 노출되는 `verified`는 오직 실연결 스모크 로그가 붙은 행만 허용한다.

---

## 0. v1 → v2 변경 요약

GPT 적대 검토가 잡은 실제 오류 1건 + 커버리지 구멍 3건 + 구조 결함 1건을 반영했다.

| # | v1 문제 | v2 정정 | 근거 |
|---|---|---|---|
| 1 | oracledb 5.5.0을 "node12 prebuilt(NODE_MODULE_VERSION 72)"로 단정 | 5.x tarball은 ABI 전용이 아닌 **플랫폼 N-API 바이너리**(Node18로 빌드). node12는 **미검증 candidate**, 폴백 5.3.0 | GPT F1 |
| 2 | phase·feasible·confidence·VERIFIED 혼재 | **상태 모델 분리**(candidate/smoke-ready/verified). verified만 고객 노출 | GPT §6 |
| 3 | pg 8.20.x 통째, oracledb 6.10.x, @yao-pkg 버전 불명 | 버전 핀 정정(아래 §3) | GPT C1·F2·B2 |
| 4 | SQL2008을 TDS·TLS 한 덩어리로 | TDS 버전 ≠ TLS 핸드셰이크. 2-트랙 스모크 | GPT C3 |
| 5 | Server 2012 비R2를 win-legacy에 묶음 | **win-2012-experimental** 별도(node16 candidate, Tier1 아님) | GPT C4 |
| 6 | 국내 DB = Tibero/DB2만 | **CUBRID·Altibase·Sybase ASE·MS Access 추가** | GPT D1~D4 |
| 7 | (비토 보정) GPT가 CUBRID를 "Phase A"라 함 | 우리 코드에 CUBRID 커넥터 없음 → **Phase B**(신규 커넥터). 단 순수 JS라 **최저비용** | 비토(db/index.ts 실확인: mssql/mysql/oracle/pg/excel·csv뿐) |

---

## 1. 상태 모델 (v2 핵심)

`phase`(구현 단계) · `state`(검증 상태) · `confidence`(문서 추정 강도)를 **분리**한다. 한 칸에 섞으면 이번 거짓 VERIFIED(win-legacy 5DB "검증됨" 선언)가 재발한다.

### state — 고객 노출을 가르는 유일한 축
| state | 의미 | 고객 노출 |
|---|---|---|
| `blocked` | 구조적으로 불가 또는 지원 포기 | 숨김 |
| `research` | 드라이버 후보 탐색 중 | 숨김 |
| `candidate` | 버전·빌드 후보 확정, 실스모크 전 | 숨김 |
| `smoke-ready` | VM/DB 준비 완료, 스모크만 남음 | 숨김 |
| `verified` | 그 (OS×Node×driver×DB버전) 실연결 스모크 통과(로그 첨부) | **노출** |
| `deprecated` | 과거 verified였으나 보안·유지보수로 숨김 예정 | 제한 |

### phase — 구현 단계만 나타냄
- `A` : 현재 코드베이스에 커넥터 보유(oracle/mssql/mysql/pg).
- `B` : 신규 커넥터 필요. **B-pure**(순수 JS, 최저비용 — CUBRID) / **B-native**(네이티브 addon·벤더 클라이언트 — Tibero/DB2/Altibase ODBC).
- `C` : 고객 환경·벤더 런타임 의존이 커 별도 프로젝트화(Sybase JDBC 브리지, MS Access OLE DB 등).

### confidence
문서 추정 강도일 뿐. **고객 노출 조건이 아니다.** verified만 노출.

### 코드 반영
`agent-build-tiers.ts`의 `VERIFIED_DBS_BY_TIER`는 state=`verified` 행만 담는다. candidate/smoke-ready는 위저드·resolve에서 노출 0(fail-closed). 빌드 산출은 candidate부터 만들되, **노출 스위치는 스모크 로그가 켠다.**

---

## 2. OS 티어 (8개 → 지원 6 / 미지원 3, Server 2012 비R2 분리)

| tierId | node 천장 | 평범한 말 | 예시 OS | glibc | pkg 도구 | 런타임 동봉 | state |
|---|---|---|---|---|---|---|---|
| win-2003 | (없음) | 아주 옛날 윈도우 서버 | Server 2003/2003 R2, XP x64 | — | — | — | blocked |
| win-2008-nonr2 | (없음) | R2 안 붙은 2008/비스타 | Vista, Server 2008(비R2) | — | — | — | blocked |
| **win-legacy** | **12** | 좀 오래된 윈도우(사내 최다 잔존) | Win7 / Server 2008 R2 SP1 | — | node12-win-x64 (vercel/pkg 5.8.1) | O | candidate |
| **win-2012-experimental** | **16** | 2012 서버(R2 아님) | Server 2012(비R2) | — | node16-win-x64 (vercel/pkg 5.8.1) | O | candidate (Tier1 아님) |
| **win-mid** | **16** | 중간 시기 윈도우 | Win8.1 / Server 2012 R2 | — | node16-win-x64 (vercel/pkg 5.8.1) | O | candidate |
| **win-modern** | **20** | 요즘 윈도우 | Win10/11 / Server 2016·2019·2022 | — | node20-win-x64 (@yao-pkg/pkg 6.10.0) | ✗ | candidate |
| linux-el6 | (미보장) | 아주 오래된 리눅스 | CentOS6/RHEL6 | 2.12 | — | — | blocked |
| **linux-legacy** | **16** | 오래된 리눅스(바닥선) | CentOS7/RHEL7, Ubuntu 14.04~18.04, Debian 8·9, AL2 | 2.17 | node16-linux-x64 (vercel/pkg 5.8.1) | ✗ | candidate |
| **linux-modern** | **20** | 요즘 리눅스 | RHEL/Rocky/Alma 8·9, Ubuntu 20.04~24.04, Debian 10~12, AL2023 | 2.28+ | node20-linux-x64 (@yao-pkg/pkg 6.10.0) | ✗ | candidate |

**바닥 근거(verified by 출처):** node14부터 Win7/2008R2 차단(PR #31954, 마지막 12.14.1). node18부터 glibc 2.28 요구 → CentOS7·Ubuntu 14.04~18.04 천장 node16. Server 2012(비R2)는 node16까지(node17부터 끊김), 단 공식 표기상 experimental이라 Tier1로 보지 않는다.
**경고(GPT B1):** vercel/pkg가 쓰는 pkg-fetch README의 win x64 최소 OS는 **Windows 8.1**로 적혀 있어 Node12의 Win7/2008R2 공식 지원과 충돌한다. → **win-legacy는 문서로 verified 금지, 2008R2 VM 실측이 source of truth.**

---

## 3. 빌드(exe) 후보표 — 버전 핀 (정정 반영)

> 모든 행 state=`candidate` (스모크 전). 노출은 §7 스모크표 통과 시.

| binaryKey | node | driver | npm 핀 (정정) | pkg 도구 | 비고 |
|---|---|---|---|---|---|
| win-legacy::oracle | 12 | oracledb | **5.5.0 candidate**(폴백 5.3.0) · thick 전용 | vercel/pkg 5.8.1 | ★ "prebuilt 72" 아님 — 플랫폼 N-API 바이너리(Node18 빌드). node12 로드는 **pkg+.node추출+IC+DB 스모크 전 미검증**. stated compat 마지막 Node12 포함 = 5.3.0 |
| win-legacy::mssql | 12 | mssql | **8.1.4 + tedious 14.7.0 lock** | vercel/pkg 5.8.1 | tedious 14.7.0 dist에 `??`/`?.`/`#` 없음(GPT 확인) · 15.1.3엔 `??` 잔존 → 9.x/15.x **금지**. tedious 14.6.0+ engines≥12.3.0 → pkg node12 런타임 12.22.x 확인 |
| win-legacy::mysql | 12 | mysql | **3.2.0 + lru-cache 7.18.3 lock** | vercel/pkg 5.8.1 | lru-cache ≥8 해석되면 reject(`#private`). 순수 JS |
| win-legacy::pg | 12 | pg | **8.7.3** (최대 8.15.6) | vercel/pkg 5.8.1 | ★ pg 8.16.3부터 engines≥16 → node12 floating 8.x 금지. 순수 JS |
| win-mid / win-2012-exp::oracle | 16 | oracledb | **6.10.0 또는 7.0.0**(engines≥14.17) | vercel/pkg 5.8.1 | thin DB12.1+ / 11g·10g는 thick+IC |
| win-mid::mssql | 16 | mssql | 10.0.4 (tedious 16) | vercel/pkg 5.8.1 | node16=OpenSSL1.1.1 → SQL2008/R2 TLS1.0 도달 가능(2-트랙 스모크) |
| win-mid::mysql / ::pg | 16 | mysql2 / pg | mysql2 3.x · pg 8.22.0(engines≥16) | vercel/pkg 5.8.1 | 순수 JS |
| win-modern::oracle | 20 | oracledb | 6.10.0 또는 7.0.0 | @yao-pkg/pkg 6.10.0 | thin DB12.1+ / 11g는 thick+IC19 |
| win-modern::mssql | 20 | mssql | 11.x/12.x | @yao-pkg/pkg 6.10.0 | ★OpenSSL3 → **SQL2008/R2 불가**(blocked). 2012+ 전용 |
| win-modern::mysql / ::pg | 20 | mysql2 / pg | 3.11.x · 8.22.0 | @yao-pkg/pkg 6.10.0 | 순수 JS |
| linux-legacy::* | 16 | (동일) | mssql 10.0.4 · oracledb 6.10.0/7.0.0 · mysql2 3.x · pg 8.22.0 | vercel/pkg 5.8.1 | glibc2.17 바닥. oracle thick은 Linux IC + LD_LIBRARY_PATH. linuxstatic 금지(네이티브) |
| linux-modern::* | 20 | (동일) | mssql 11/12 · oracledb 6.10.0/7.0.0 · mysql2 3.11 · pg 8.22.0 | @yao-pkg/pkg 6.10.0 | glibc2.28+ 바닥 |

**빌드 도구 핀(GPT B1·B2):** node12/14/16 = vercel/pkg 5.8.1(pkg-fetch 3.4.2, node18까지 — node20 없음). node18/20/22 = @yao-pkg/pkg **6.10.0**(빌드 호스트 node≥18). @yao-pkg 6.16+는 빌드 호스트 node≥22 요구 → 호스트 마이그레이션 후 업그레이드.

---

## 4. Oracle 전담 행 분리표 (driver × mode × IC × DB버전 — GPT F2)

> Oracle은 한 칸에 thin/thick/IC/DB를 섞지 않는다. IC 도달표: IC 11.2→DB9.2+ / IC12.1→DB10.2+ / IC12.2·18·19→DB11.2+ / IC21→DB12.1+.

| OS tier | node | driver | mode | DB | Oracle Client | state |
|---|---:|---|---|---|---|---|
| win-legacy | 12 | oracledb 5.5.0(폴백5.3.0) | thick | 10g(10.2) | IC 11.2 또는 12.1 | candidate |
| win-legacy | 12 | oracledb 5.5.0 | thick | 11g(11.2) | IC 11.2/12.1/12.2/18/19 | candidate |
| win-legacy | 12 | oracledb 5.5.0 | thick | 12c | IC 12.1/12.2/18/19 | candidate |
| win-mid / linux-legacy | 16 | oracledb 6.10.0/7.0.0 | thin | 12.1+ | none | candidate |
| win-mid / linux-legacy | 16 | oracledb 6.10.0/7.0.0 | thick | 10g/11g | IC 11.2~19 | candidate |
| win-modern / linux-modern | 20 | oracledb 6.10.0/7.0.0 | thin | 12.1+ | none | candidate |
| win-modern / linux-modern | 20 | oracledb 6.10.0/7.0.0 | thick | 11g(11.2) | IC 19 | candidate |

**blocked(노출 0):** thin 모드 × DB 12.1 미만(10g/11g) · node12 × oracledb 6.x(thin) · IC 19/21 × 10g(10.2).

---

## 5. 패키지(OS × DB버전) 후보표 — Phase A(기존 커넥터)

> state 미표기 행 = candidate. SQL2008/R2는 §6 2-트랙 스모크 통과 전 verified 금지.

### win-legacy (node12)
| DB | 버전 | mode | native client | 연결 프로파일 / 비고 |
|---|---|---|---|---|
| MS SQL | 2008·2008R2 | na | none | tedious 7_3_A/B + encrypt:false. **2-트랙 스모크 필수**(아래 §6) |
| MS SQL | 2012/2014 | na | none | tedious 7_4 |
| Oracle | 10g/11g/12c | thick | IC(§4) | oracledb 5.5.0 thick + initOracleClient. IC 외부 확보 |
| MySQL/MariaDB | 5.5~8.0 / MariaDB 10.x | na | none | mysql2 3.2.0. MariaDB ed25519 미지원 |
| PostgreSQL | 8.4~14 | na | none | pg 8.7.3 |

### win-mid(2012R2) / win-2012-experimental (node16)
- MS SQL 2008R2~2016, Oracle 11g(thick)·12c~19c(thin), MySQL/MariaDB, PostgreSQL 9.2~12.

### win-modern (node20)
- MS SQL **2016~2022만**(2008/R2 = blocked, OpenSSL3), Oracle 12c~21c(thin)·11g(thick IC19), 최신 MySQL/PostgreSQL.

### linux-legacy (node16, glibc2.17) / linux-modern (node20, glibc2.28+)
- Oracle(thin 12.1+ / thick IC19), MySQL·MariaDB(CentOS7 기본 MariaDB 5.5~), PostgreSQL(기본 9.2~), MS SQL Linux 2017+(modern은 2019/2022).

---

## 6. fail-closed / blocked + SQL2008 2-트랙

- **win-modern × SQL2008/2008R2 = blocked.** node20=OpenSSL3 ClientHello `supported_versions`를 2008R2 SCHANNEL이 거절(openssl#28284). encrypt:false·`--tls-min-v1.0`로도 못 고침 → win-legacy/win-mid로만.
- **SQL2008/R2 2-트랙 스모크(GPT C3)** — high 표기 전 둘 다 실측:
  1. `encrypt:false` 로그인 암호화 경로(SQL Server는 2005+부터 로그인 패킷 항상 TLS).
  2. Force Encryption/TLS 경로 — `--tls-min-v1.0` + 필요 시 `cryptoCredentialsDetails.minVersion='TLSv1'`. (2008R2가 TLS1.2 패치 적용됐는지로 갈림.)
- **Oracle thin × DB<12.1 = blocked.** node12 × oracledb thin = blocked(6.0+는 node14.6+).

---

## 7. 스모크표 (smoke matrix) — verified로 가는 유일한 길

> 각 행 통과(실연결 + 로그) 시에만 state=verified로 승격해 고객 노출. 환경 = VM(isaetest 2008R2 SP1) + 각 DB.

### P1 — 1순위 스모크
| # | 대상 | 통과 기준 |
|---|---|---|
| 1 | win-legacy::oracle — node12 pkg + oracledb 5.5.0 + IC 11.2/12.1/19 각각 로드 | `--setup` 무사망 + 실 10g/11g SELECT 1행. 실패 시 5.3.0 폴백 재시도 |
| 2 | win-legacy::mssql — mssql 8.1.4 + tedious 14.7.0 + SQL2008/R2 | 2-트랙(§6) 각각 SELECT 1행 |
| 3 | win-legacy::mysql — mysql2 3.2.0 + lru-cache 7.18.3 lock | `--setup` 무사망(SyntaxError 0) + SELECT 1행 |
| 4 | win-legacy::pg — pg 8.7.3 vs 8.15.6 | SELECT 1행 |
| 5 | CUBRID — node-cubrid 11.0.0으로 8.4.1+/9/10/11 중 최소 2버전 | 신규 커넥터 후 SELECT 1행 |

### node16/20 스모크
- oracledb 6.10.0/7.0.0 thin(12.1+)·thick(11g IC19), mysql2/pg 최신, mssql 10/11 — 조합당 1건.

### CI 가드(빌드 타임, 사람 실측 보조)
- **es-check es2019** — 번들된 드라이버 트리에 `??`/`?.`/`#private` 0건(node12 티어). tedious 14.7.0/lru-cache 7.18.3 회귀 차단.
- **lockfile 검사** — node12 티어에서 lru-cache ≥8, pg ≥8.16, mssql ≥9, oracledb ≥6 해석 시 빌드 실패.

---

## 8. 신규 커넥터 (Phase B/C) — 국내·레거시 DB

| DB | phase | 드라이버 후보 | engines / 네이티브 | state | 비고 |
|---|---|---|---|---|---|
| **CUBRID** | **B-pure** | node-cubrid 11.0.0 (순수 JS) · modern은 cubrid-client 1.1.0(node≥18) | engines≥4 · **네이티브 0** | candidate | CUBRID 8.4.1+. 유지보수 2022 정체 → verified 금지. **최저비용 신규 커넥터**(공공/포털 다수) |
| **Tibero** | B-native / C | node-odbc(npm odbc) + Tibero ODBC(libtbcli) · 또는 JDBC | odbc.node tier별 ABI · 벤더 클라이언트 OS 설치 | candidate | 공공·금융 Oracle 대체 주력 = Phase B 1순위. ODBC vs CLI 라이브러리명·비트(32/64) 확정 필요 |
| **DB2 LUW** | B-native / C | ibm_db(node-ibm_db) + clidriver | NAPI(ABI 유리) · clidriver 동봉/폐쇄망 미러 | candidate | FETCH FIRST n ROWS 페이지네이션 |
| **Altibase** | B-native / C | modern: node-odbc-altibase 1.0.1(node≥18, odbc.node) · legacy: odbc-altibase 0.0.31(node≥10.19, 소스빌드) | unixODBC + 벤더 ODBC | candidate | 통신/금융 인메모리. legacy 소스빌드 고위험 |
| **Sybase ASE** | C | sybase 1.2.3(Java jConnect, jconn3.jar, Java≥1.5) · sybase-tds 0.1.1(순수 TS TDS5.0, node≥18, 신생) · FreeTDS/ODBC | JVM 또는 FreeTDS 런타임 | research | **tedious 호환 아님**(ASE TDS5.0 ≠ SQL Server TDS7.x). JDBC/FreeTDS 우선 |
| **MS Access** | C (Windows 전용) | node-adodb 5.0.3 (ADODB/OLE DB) | engines≥6 · Jet 4.0(.mdb) / ACE OLEDB 12·15·16(.accdb), 32/64-bit 일치 | candidate | 파일 DB(서버형 아님). 스모크: 읽기전용 SELECT, 잠긴 파일, 암호 파일, UNC·한글 경로 |

---

## 9. 외부 확보물

- **Oracle Instant Client**: 11.2/12.1(Win·Linux x64, 10g 도달용 — 공식서 내려가 11g XE 내장 OCI 추출/archive) · 19(11g/12c용).
- **IC별 Windows VC++ 재배포**: IC11.2=VS2005 / 12.1=VS2010 / 12.2·18=VS2013 / 19=VS2017 / 21=VS2019.
- **Universal CRT(KB2999226)** — Win7/2008R2 SP1 node12 실행 전제(미설치 시 node.exe 미기동).
- **Phase B/C 진입 시**: Tibero 클라이언트(libtbcli) · IBM Db2 clidriver · Altibase ODBC · Sybase jConnect(jconn3.jar)+JVM 또는 FreeTDS · MS Access ACE OLEDB 재배포(비트 일치).

---

## 10. 미해결 / 다음

- 이새F&C 실제 Oracle 10g 정확 버전(`SELECT * FROM v$version`) — IC 11.2 vs 12.1.
- win-legacy::oracle 5.5.0이 node12 VM에서 실로드되는지(미검증 — P1-1). 실패 시 5.3.0.
- pkg-fetch가 5.8.1에 묶이는 정확 버전(리서치=3.5 / GPT=3.4.2) — 빌드 타임 확인(결론 동일: node20은 @yao-pkg).
- node16/20 oracledb thin·thick, mysql2/pg 실연결(코드·문서만).
- 모던 티어(node20) all-in-one 합본 유지 vs 전 조합 분리 — 빌드 수 대 운영 부담(주인님 결정).

## 11. 설계서 진입 조건

이 후보표를 설계서(spec)로 승격하려면: ① state 모델을 `agent-build-tiers.ts`에 반영(verified만 노출) ② build-tier.js를 (tier, db) 파라미터화 + 버전 핀 단일 진실원 ③ §7 P1 스모크 1순위부터 실측 → verified 승격. **노출은 코드가 아니라 스모크 로그가 켠다.**
