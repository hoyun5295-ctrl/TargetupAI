# 싱크에이전트 OS시대 × DB버전 전담빌드 조합표 — 브레인스토밍 v1 (GPT 교차검토용)

> 작성: 2026-06-24 · 단계: **브레인스토밍(설계 전)** · 상태: 웹출처 검증 1라운드 완료, 설계서 착수 전
> 목적: 한줄로 싱크에이전트를 **(OS시대 × DB버전) 전담 패키지**로 쪼개는 조합표를 사실로 굳히는 중. 이 문서를 GPT가 적대적으로 검토해 **빠진 OS 시대·DB·버전, 틀린 호환 주장, thin/thick·Instant Client·TLS 논리 모순**을 더 찾아주는 게 목표.

---

## 0. GPT에게 — 이 문서를 보는 법 / 검토 요청 요약

이건 사내(on-prem) 고객 DB를 읽기전용으로 읽어 서버로 동기화하는 **Node.js 싱크에이전트**를 단일 exe로 패키징(@yao-pkg/pkg = 모던, vercel/pkg@5.8.1 = 레거시)하는 빌드 체계 설계다. 현재 DB 커넥터는 mssql(tedious)·mysql2·pg·oracledb 4종. 티베로/DB2는 커넥터 없음.

**배경 사고:** 직전에 win-legacy(node12) 빌드를 2008 R2 VM에서 돌렸더니 `sync-agent.exe --setup`이 `SyntaxError: Unexpected token '?'`로 죽었다. 원인 = node12는 `??`/`?.` 미지원인데 거기 묶인 mssql 9.3.2(tedious 15)가 `??`를 씀. Oracle 테스트였는데 mssql 때문에 죽었고(전 커넥터를 최상단 import), `agent-build-tiers.ts`가 win-legacy에 5개 DB를 전부 "검증됨"으로 **거짓 선언**해둔 게 드러남.

**그래서 만드는 것:** 빌드를 `node-tier × DB-driver` 2축으로 쪼개고, 사용자 다운로드는 `(OS × DB버전)` 칸 단위 전담 패키지로 서빙. VERIFIED는 그 칸 단독 실연결 스모크를 통과한 것만 노출(fail-closed).

**GPT가 적대적으로 봐줄 것 (상세는 §9, §11):**
1. §6 호환 사실 13건 중 **틀린 것** — 특히 §9-A의 oracledb 5.5.0/node12 prebuilt 실재 여부.
2. §2~§5 표에서 **빠진 OS 시대·DB 제품·버전** — 특히 국내 on-prem(CUBRID·Altibase·Sybase ASE·MS Access).
3. thin/thick·Instant Client 버전↔DB 도달·TLS 차단의 **논리 모순**.
4. `feasible:true`인데 `confidence:medium`(실스모크 미완)인 칸을 phase A로 둔 게 fail-closed 원칙과 모순되는지.

---

## 1. 핵심 설계 — 2축 구조

- **빌드(exe) = (node-tier × DB-driver).** 그 node가 받는 드라이버 1종만 그 버전으로 동봉. → 교차 사망(이번 mssql이 Oracle을 죽인 클래스) 소멸 + 조합 단독 스모크로 실검증 가능.
- **패키지(다운로드물) = (OS-tier × DB제품·버전) = exe + 그 DB용 native client(Oracle IC 등) + 연결 프로파일 + 설치 노트.** 같은 exe를 공유해도 (2008R2 × Oracle 10g)와 (2008R2 × Oracle 11g)는 각각 별도 패키지로 존재하고 각각 실측 VERIFIED가 찍힌다.
- **VERIFIED fail-closed.** `agent-build-tiers.ts`의 `VERIFIED_DBS_BY_TIER`는 칸별 실스모크 통과 전엔 노출 안 함. 가정 표기 금지.

---

## 2. OS 티어 — 8개 (지원 5 / 미지원 3)

| tierId | node 천장 | 평범한 말 | 예시 OS | glibc | pkg 도구 | 런타임 동봉 | 지원 |
|---|---|---|---|---|---|---|---|
| win-2003 | (없음) | 아주 옛날 윈도우 서버 | Server 2003/2003 R2, XP x64 | — | (실용 타깃 없음) | — | ✗ |
| win-2008-nonr2 | (없음) | R2 안 붙은 2008/비스타 | Vista, Server 2008(비R2) | — | (실용 타깃 없음) | — | ✗ |
| **win-legacy** | **12** | 좀 오래된 윈도우(사내 최다 잔존) | Win7 / Server 2008 R2 SP1 / Server 2012(비R2) | — | node12-win-x64 (vercel/pkg@5.8.1) | O | ✓ |
| **win-mid** | **16** | 중간 시기 윈도우 | Win8.1 / Server 2012 R2 | — | node16-win-x64 (vercel/pkg@5.8.1) | O | ✓ |
| **win-modern** | **20** | 요즘 윈도우 | Win10/11 / Server 2016·2019·2022 | — | node20-win-x64 (@yao-pkg/pkg) | ✗ | ✓ |
| linux-el6 | (미보장) | 아주 오래된 리눅스 | CentOS6 / RHEL6 | 2.12 | node12-linux-x64(공식 prebuilt glibc2.17 링크라 미보장) | — | ✗ |
| **linux-legacy** | **16** | 오래된 리눅스(리눅스 바닥선) | CentOS7/RHEL7, Ubuntu 14.04·16.04·18.04, Debian 8·9, AL2 | 2.17 | node16-linux-x64 (vercel/pkg@5.8.1) | ✗ | ✓ |
| **linux-modern** | **20** | 요즘 리눅스 | RHEL/Rocky/Alma 8·9, Ubuntu 20.04·22.04·24.04, Debian 10·11·12, AL2023 | 2.28+ | node20-linux-x64 (@yao-pkg/pkg) | ✗ | ✓ |

**바닥 근거(검증됨):** node14부터 Win7/2008R2 차단(PR #31954, 마지막 테스트 12.14.1). node18부터 glibc 2.28 요구 → CentOS7/RHEL7(2.17)·Ubuntu 14.04~18.04 천장은 node16. 그래서 **Windows 실용 바닥 = 2008R2(node12), Linux 실용 바닥 = CentOS7(node16)**.

---

## 3. 빌드(exe) 표 — 20개 (node-tier 5 × driver 4)

| binaryKey | node | driver | npm 핀 | pkg 도구 | 핵심 비고 |
|---|---|---|---|---|---|
| win-legacy::oracle | 12 | oracle | **oracledb 5.5.0 (thick 전용)** | vercel/pkg@5.8.1 | thin은 6.0+/node14.6+라 불가 → 무조건 thick+IC. **.node 네이티브 → pkg.assets 등록.** ※§9-A 미검증 칸 |
| win-legacy::mssql | 12 | mssql | **mssql 8.1.4 (tedious 14)** | vercel/pkg@5.8.1 | ★VM 사망 차단. 9.0.0이 node10/12 제거(#1417)+tedious15 `??`. 8.1.4가 node12 마지막. 순수 JS |
| win-legacy::mysql | 12 | mysql | **mysql2 3.2.0 (+lru-cache 7.x 고정)** | vercel/pkg@5.8.1 | 3.2.1부터 lru-cache 8.0.0(private field `#`)로 node12 require 시 SyntaxError. lockfile로 lru-cache 7.18.3 고정 필수 |
| win-legacy::pg | 12 | pg | **pg 8.7.3** | vercel/pkg@5.8.1 | 순수 JS. engines `>=8.0.0`. pg-native는 optional이라 미사용 |
| win-mid::oracle | 16 | oracle | oracledb 6.x (thin 기본; ORACLE_HOME 시 thick) | vercel/pkg@5.8.1 | node16≥14.6 thin 가능(DB 12.1+). 11g/10g는 thick+IC |
| win-mid::mssql | 16 | mssql | mssql 10.0.4 (tedious 16) | vercel/pkg@5.8.1 | node16=OpenSSL1.1.1이라 SQL2008/R2 TLS1.0 도달 가능 |
| win-mid::mysql | 16 | mysql | mysql2 3.x | vercel/pkg@5.8.1 | lru-cache8 요구 node16.14+ 충족 |
| win-mid::pg | 16 | pg | pg 8.x | vercel/pkg@5.8.1 | 순수 JS |
| win-modern::oracle | 20 | oracle | oracledb 6.10.x (thin 기본) | @yao-pkg/pkg | thin DB 12.1+. 11g/10g는 thick+IC19 |
| win-modern::mssql | 20 | mssql | mssql 11.x/12.x (tedious 18/19) | @yao-pkg/pkg | ★node20=OpenSSL3 → SQL2008/R2 핸드셰이크 불가. 2012+ 전용 |
| win-modern::mysql | 20 | mysql | mysql2 3.11.x | @yao-pkg/pkg | 메인 핀 |
| win-modern::pg | 20 | pg | pg 8.20.x | @yao-pkg/pkg | 메인 핀 |
| linux-legacy::oracle | 16 | oracle | oracledb 6.x (thin/ORACLE_HOME 시 thick) | vercel/pkg@5.8.1 | CentOS7 glibc2.17 바닥. 11g/10g thick+IC(Linux)+LD_LIBRARY_PATH. linuxstatic 금지 |
| linux-legacy::mssql | 16 | mssql | mssql 10.0.4 (tedious 16) | vercel/pkg@5.8.1 | Linux SQL Server는 2017+. 사내 빈도 낮음 |
| linux-legacy::mysql | 16 | mysql | mysql2 3.x | vercel/pkg@5.8.1 | CentOS7 기본 MariaDB 5.5 |
| linux-legacy::pg | 16 | pg | pg 8.x | vercel/pkg@5.8.1 | CentOS7 기본 PostgreSQL 9.2 |
| linux-modern::oracle | 20 | oracle | oracledb 6.10.x (thin) | @yao-pkg/pkg | glibc2.28+ 바닥. 11g thick+IC19 |
| linux-modern::mssql | 20 | mssql | mssql 11.x/12.x | @yao-pkg/pkg | OpenSSL3 → SQL2008/R2 불가. 2017+ 전용 |
| linux-modern::mysql | 20 | mysql | mysql2 3.11.x | @yao-pkg/pkg | 메인 핀 |
| linux-modern::pg | 20 | pg | pg 8.20.x | @yao-pkg/pkg | 메인 핀 |

---

## 4. 패키지(OS × DB버전) 표

> mode: thin/thick/na(순수 TDS·JS) · conf: confidence · phase: A(커넥터 보유, 바로 빌드) / B(커넥터 신설)

### win-legacy (node12)
| DB | 버전 | feasible | mode | native client | 연결 프로파일 핵심 | phase | conf |
|---|---|---|---|---|---|---|---|
| MS SQL | 2008 R2 | ✓ | na | none | tedious 7_3_B + encrypt:false + trustServerCertificate. 암호화 강제 시 `cryptoCredentialsDetails:{minVersion:'TLSv1'}` + `--tls-min-v1.0`. node12=OpenSSL1.1.1이라 TLS1.0 도달 | A | high |
| MS SQL | 2008 | ✓ | na | none | tedious 7_3_A, 나머지 동일 | A | high |
| MS SQL | 2012/2014 | ✓ | na | none | tedious 7_4 default | A | high |
| Oracle | 10g(10.2) | ✓ | thick | **IC 11.2 또는 12.1** (10.2 도달 마지막 IC; IC12.2/18/19/21은 11.2+라 10g 끊김) | oracledb 5.5.0 thick + initOracleClient. IC 외부 확보 필수 | A | high |
| Oracle | 11g(11.2) | ✓ | thick | IC 11.2~19 (IC21은 12.1+라 11g 끊김) | oracledb 5.5.0 thick. IC19시 VS2017 재배포, IC11.2시 VS2005 | A | high |
| Oracle | 12c | ✓ | thick | IC 12.2~19 | node12라 thin 불가 → thick 고정 | A | high |
| MySQL/MariaDB | 5.5~8.0 / MariaDB 10.x | ✓ | na | none | mysql2 3.2.0. MySQL8 caching_sha2는 SSL/RSA 필요, 구형 5.x는 native_password. **MariaDB ed25519 미지원** | A | high |
| PostgreSQL | 8.4~14 | ✓ | na | none | pg 8.7.3. md5/SCRAM 내장 | A | high |
| **Tibero** | 4/5/6 | ✗ | — | Tibero ODBC(libtbcli) + odbc npm(N-API) | 순수 npm 부재 → node-odbc. odbc.node node12 ABI prebuild 필요. Tibero 클라이언트 OS 설치 전제 | **B** | medium |
| **DB2 LUW** | 9.7/10.x/11.x | ✗ | — | ibm_db + IBM Db2 CLI driver(clidriver) | odbc_bindings.node node12 ABI + clidriver 동봉. 폐쇄망 미러 필요 | **B** | medium |

### win-mid (node16)
| DB | 버전 | feasible | mode | native client | phase | conf |
|---|---|---|---|---|---|---|
| MS SQL | 2008 R2 | ✓ | na | none (tedious 7_3_B, OpenSSL1.1.1 TLS1.0 도달) | A | high |
| MS SQL | 2012/2014/2016 | ✓ | na | none | A | high |
| Oracle | 11g(11.2) | ✓ | thick | IC 11.2~19 (thin은 12.1+라 11g 불가) | A | high |
| Oracle | 12c/18c/19c | ✓ | thin | none | A | **medium**(실스모크 미완) |
| MySQL/MariaDB | 5.5~8.0 | ✓ | na | none | A | medium |
| PostgreSQL | 9.2~12 | ✓ | na | none | A | medium |
| Tibero | 5/6 | ✗ | — | node-odbc(node16 ABI) | B | medium |

### win-modern (node20)
| DB | 버전 | feasible | mode | native client | phase | conf |
|---|---|---|---|---|---|---|
| MS SQL | 2016/2017/2019/2022 | ✓ | na | none (tedious 7_4, OpenSSL3 TLS1.2) | A | high |
| **MS SQL** | **2008 R2 / 2008** | **✗** | na | **불가** — node20=OpenSSL3 ClientHello supported_versions를 2008R2 SCHANNEL이 거절. `--tls-min-v1.0`/encrypt:false로도 못 고침 → **win-legacy/win-mid로만** | A(차단) | high |
| Oracle | 12c/18c/19c/21c | ✓ | thin | none | A | medium |
| Oracle | 11g(11.2) | ✓ | thick | IC19 + VS2017 | A | medium |
| MySQL/MariaDB | 5.7/8.0/8.4 · MariaDB 10.x/11.x | ✓ | na | none | A | high |
| PostgreSQL | 10~17 | ✓ | na | none | A | high |
| Tibero | 6/7 | ✗ | — | node-odbc(node20 ABI) | B | medium |
| DB2 LUW | 11.1/11.5 | ✗ | — | ibm_db(NAPI) + clidriver | B | medium |

### linux-legacy (node16, glibc2.17)
| DB | 버전 | feasible | mode | native client | phase | conf |
|---|---|---|---|---|---|---|
| Oracle | 11g(11.2) | ✓ | thick | IC 11.2~19(Linux) + LD_LIBRARY_PATH | A | medium |
| Oracle | 12c/18c/19c | ✓ | thin | none | A | medium |
| MySQL/MariaDB | CentOS7 기본 MariaDB 5.5 / Ubuntu 5.5~5.7·MySQL8 | ✓ | na | none | A | medium |
| PostgreSQL | CentOS7 기본 9.2 / Ubuntu 9.3~10·PGDG 상위 | ✓ | na | none | A | medium |
| MS SQL(Linux) | 2017/2019 | ✓ | na | none (Linux SQL은 2017+) | A | medium |
| Tibero | 5/6/7 | ✗ | — | Tibero ODBC + unixODBC + odbc npm (odbcinst.ini libtbcli 등록) | B | medium |
| DB2 LUW | 10.x/11.x | ✗ | — | ibm_db + clidriver(자체 CLI 런타임) | B | medium |

### linux-modern (node20, glibc2.28+)
| DB | 버전 | feasible | mode | native client | phase | conf |
|---|---|---|---|---|---|---|
| Oracle | 12c/18c/19c/21c | ✓ | thin | none | A | medium |
| Oracle | 11g(11.2) | ✓ | thick | IC19(Linux) + LD_LIBRARY_PATH | A | medium |
| MySQL/MariaDB | RHEL8 MariaDB 10.3 / Ubuntu 8.0 · MariaDB 10.x/11.x | ✓ | na | none | A | high |
| PostgreSQL | RHEL8 기본 10 / Ubuntu 12~16 · 10~17 | ✓ | na | none | A | high |
| MS SQL(Linux) | 2019/2022 | ✓ | na | none | A | high |
| Tibero | 6/7 | ✗ | — | node-odbc(node20 ABI) | B | medium |
| DB2 LUW | 11.1/11.5 | ✗ | — | ibm_db(NAPI) | B | medium |

---

## 5. fail-closed로 빠지는 칸 (보이면 작동 불변식)

- **win-modern × SQL Server 2008/2008R2 = 불가.** node20=OpenSSL3의 ClientHello `supported_versions` 확장을 2008R2 SCHANNEL이 거절(`no cipher suites available`). 로그인 패킷은 encrypt:false여도 항상 TLS라 못 우회. → 2008/2008R2 SQL Server는 **win-legacy 또는 win-mid 빌드로만**.
- **Oracle 10g/11g는 어느 티어든 thin 불가 → thick + Instant Client 강제.** thin은 DB 12.1+만. 10g(10.2)는 IC 11.2/12.1로만 도달, IC 19/21로는 끊김.
- **node12 티어는 oracledb 6.x(thin) 자체가 안 깔림**(6.0+는 node14.6+ 요구) → win-legacy는 oracledb 5.x thick 고정.

---

## 6. 검증된 호환 사실 13건 (적대적 교차검증 결과)

> ✅ confirmed = 1차 출처로 확인 · ⚠️ refuted = 주장 틀림(정정 첨부). 전부 출처 URL 보유(원본 JSON에 포함).

| # | 주장 | 판정 | 핵심 근거 |
|---|---|---|---|
| 1 | oracledb 5.x가 node12 지원 마지막, 6.0+는 node14.6+ | ✅ | release_notes.rst: 6.0.0 "minimum Node.js 14.6". 단 §9-A 보정 — 5.4.0이 stated 지원에서 node12 뺌 |
| 2 | thin = node14.6+ & DB12.1+, 10g/11g는 thick | ✅ | node-oracledb 공식 문서. thick는 client lib에 따라 9.2까지 도달 |
| 3 | IC 11.2는 10g/11g 연결, IC 19/21은 10g 끊김 | ✅ | node-oracledb 2.2 + Doc 207303.1. IC11.2→DB9.2+, IC19→11.2+, IC21→12.1+ |
| 4 | mssql 9.0.0이 node10/12 제거, 마지막은 8.x(8.1.4) | ✅ | node-mssql CHANGELOG 9.0.0 "Removed NodeJS 10 & 12 (#1417)" (tedious15=node>=14) |
| 5 | 최신 tedious가 2008은 되고 2005/2000은 끊는다 | **⚠️ refuted** | **진짜 단절선은 tedious 버전이 아니라 OpenSSL3 vs SCHANNEL.** tedious는 7_1(2000)/7_2(2005) 여전히 지원. 2008/2005 둘 다 OpenSSL3에서 막힘 — "2008만 됨"은 구형 런타임(node≤16)에서만 참 |
| 6 | 2008R2 기본 TLS1.0이라 OpenSSL3에서 핸드셰이크 실패 가능 | ✅ | 보정: TLS1.2 미만 거부는 Node12부터(JS minVersion TLSv1.2). 2008R2는 2016-01 업데이트+레지스트리로 TLS1.2 가능. 대응 = `--tls-min-v1.0` 또는 `minVersion:'TLSv1'` |
| 7 | mysql2 3.2.1부터 node12 깨짐, 3.2.0 마지막 | ✅ | 원인은 추이 의존성 lru-cache 8.0.0(private field). **3.2.0도 lru-cache가 caret이라 lockfile로 7.18.3 고정 필수** |
| 8 | pg 8.7.x는 node12 안전 | ✅ | pg 8.7.3 engines `>=8.0.0`. 순수 JS. (함정은 Node14였고 8.2+면 해결) |
| 9 | node18/20은 glibc2.28 요구 → CentOS7/Ubuntu14~16 천장 node16 | ✅ | BUILDING.md + PR #42659. 보정: **Ubuntu 18.04(glibc2.27)도 제외** |
| 10 | Win7/2008R2 마지막 node12, node14부터 드롭 | ✅ | PR #31954(node14.0.0), 마지막 테스트 12.14.1 |
| 11 | vercel/pkg@5.8.1=node12/14/16, @yao-pkg=node18/20/22 | ✅ | 보정: @yao-pkg는 node8~24 상위호환. vercel/pkg 명시 상한 node16(latest로 18까지) |
| 12 | Tibero는 순수 npm 드라이버 없음 → node-odbc(libtbcli) 또는 JDBC | ✅ | Tibero API = tbJDBC/tbCLI(ODBC3.51)/tbESQL. node-odbc는 N-API 네이티브라 tier별 ABI prebuild 필요 |
| 13 | 배포판 기본 DB 시대 매핑(CentOS7=MariaDB5.5 등) | ✅ | 확인됨 |

---

## 7. Phase A / Phase B 분할

- **Phase A (지금 커넥터 보유 → 바로 빌드):** oracle / mssql / mysql / pg. 5티어 × 4드라이버 = **최대 20 전담 빌드**. 각 빌드는 자기 드라이버 1종만 그 node에 맞춰 동봉.
- **Phase B (커넥터 신설 필요):** Tibero · DB2. 둘 다 순수 npm 드라이버 없어 node-odbc(또는 DB2는 ibm_db) **네이티브 애드온** 경유 → node-tier별 ABI prebuild 제약을 그대로 받음(순수 JS 아님). 대상 OS에 벤더 ODBC/CLI 드라이버 설치 전제라 단일 exe 자기완결 불가. **Tibero가 공공·금융 Oracle 대체 주력이라 Phase B 1순위.**

---

## 8. 외부 확보물 (제가 코드로 못 만드는 의존)

- Oracle Instant Client: **11.2/12.1(Windows·Linux x64)** = 10g 도달용(공식서 내려감 → 11g XE 내장 OCI 추출 또는 archive). **19** = 11g/12c용.
- IC별 Windows VC++ 재배포: IC11.2=VS2005, IC12.1=VS2010, IC12.2/18=VS2013, IC19=VS2017, IC21=VS2019.
- **Universal CRT (KB2999226)** — Win7/2008R2 SP1에서 node12 실행 전제. 미설치 시 `api-ms-win-crt-*.dll` 누락으로 node.exe 안 뜸.
- (Phase B) Tibero 클라이언트(libtbcli) · IBM Db2 clidriver — 폐쇄망 사전 번들.

---

## 9. 이미 발견한 약점 (자체 적대 비평 11건) — GPT는 이걸 넘어서 찾아줘

### A. ★ CRITICAL — win-legacy::oracle(oracledb 5.5.0/node12)이 미검증 high 단정
릴리스 노트 1차 확인 결과 **5.4.0(2022-06)에서 stated 지원을 'Node.js 14,16,18'로 올리며 node12를 명시 목록에서 뺌**. 5.5.0은 그 이후. oracledb는 순수 JS가 아니라 **prebuilt N-API 바이너리**라 node12 prebuilt(ABI 72)가 실제 게시됐는지로 작동이 갈리는데, 표는 confidence:high로 단정. **이건 이번 VM 사망(mssql `??`)과 동일 클래스의 미검증 high.** → 다음 확인: npm `oracledb/v/5.5.0` package.json engines + GitHub release의 node12 prebuilt asset 실재. 없으면 핀을 **5.3.0/5.0.x로 강등**(thick·IC 도달 범위 동일).

### B. HIGH — 나머지 구조적 구멍
1. **Server 2012(비R2) 티어 경계 모호** — win-legacy에 묶였으나 node16(win-mid)도 가능(node17부터 2012 끊김). node16으로 보내면 oracledb 5.5.0 node12 리스크 회피 가능.
2. **국내 on-prem 핵심 DB 누락** — CUBRID(국산, **node-cubrid 순수 드라이버 존재 가능 → Phase A 편입 후보**)·Altibase(국산 인메모리)·Sybase ASE(금융 레거시 대량)·MS Access(.mdb/.accdb, 소규모 사내 최다, Windows ODBC/ACE OLEDB). Tibero/DB2만 본 게 시장 커버리지 구멍.
3. **medium 칸(실스모크 미완)을 phase A·feasible:true로 둔 게 fail-closed와 모순** — 이번 거짓 VERIFIED 재생산 위험. Oracle 칸을 thin(12.1+)/thick(11g/10g)로 행 분리 필요(현재 한 칸에 혼재).
4. **mssql 8.1.4의 node12 파싱 통과가 미실측** — 9.2.0 engines가 'node 10||12||14'로 보였는데 런타임 `??`로 죽은 전례라 engines 신뢰 불가. tedious 14.x dist를 `?.`/`??`/`#` grep + VM 실측 필요.

### C. MEDIUM/LOW
5. TLS1.0 도달(node12/16)이 `--tls-min-v1.0`만으로 되는지 SECLEVEL=0(legacy)까지 필요한지 칸마다 미확정.
6. linux-el6(glibc2.12) 미지원 단정 — unofficial-builds.nodejs.org glibc 구버전 빌드 미검토(순수JS DB만 살릴 여지).
7. Tibero ODBC 라이브러리명(libtbcli vs libtbodbc)·비트(32/64)·node-odbc prebuild 게시 여부 미확정인데 '1순위'.
8. Win 2016/2019/2022·Ubuntu 22.04/24.04·RHEL9가 node20 한 티어로 뭉뚱그려져 최신 glibc(2.34/2.35) IC thick·libaio 의존 미점검.
9. win-2003/2008-nonr2/el6의 node 천장 숫자가 출처 없이 단정.

---

## 10. 미해결 질문

- 이새F&C 실제 Oracle 10g 정확 버전(`SELECT * FROM v$version`) — IC 11.2 vs 12.1 매칭.
- node16/node20 티어의 oracledb 6.x thin·thick / mysql2 / pg 실연결 스모크(현재 코드·문서 검증만).
- win-legacy 4종 node12 로드 실측(VM isaetest 2008R2 SP1) — mssql 8.1.4가 실제 `--setup` 통과하는지.
- 순수 IC(루트 DLL) 환경에서 oracle.ts의 `ORACLE_HOME\bin` 가정이 깨지는지.
- 모던 티어(node20) all-in-one 합본 1개 유지 vs 전 조합 분리 — Harold 결정.

---

## 11. ★ GPT 검토 요청 (이것만 정확히 해줘)

너는 Node.js 패키징·DB 드라이버·OS 호환을 깊이 아는 시니어 엔지니어다. 위 조합표를 **적대적으로** 검토해라. 칭찬·요약 말고, 아래만 출처와 함께 짚어라:

1. **§9-A 최우선 검증** — node-oracledb **5.5.0(및 5.0~5.5 각 패치)이 node12(NODE_MODULE_VERSION 72) prebuilt 바이너리를 실제로 게시**했는가? npm/GitHub release asset로 확인. 안 했으면 node12에서 도는 마지막 oracledb 버전은 정확히 몇인가?
2. **§6 호환 사실 13건 중 틀린 것** — 특히 IC↔DB 도달 사슬, OpenSSL3 vs 2008R2 SCHANNEL, mysql2/lru-cache 경계, node glibc 바닥. 버전 숫자가 틀린 곳.
3. **빠진 OS 시대·DB 제품·버전** — 국내 on-prem 관점(CUBRID·Altibase·Sybase ASE·MS Access·기타). CUBRID는 순수 node 드라이버가 있어 Phase A로 올릴 수 있는지.
4. **thin/thick·Instant Client·TLS 논리 모순** — 한 칸에 thin/thick 혼재, feasible:true인데 confidence:medium(미실측)을 phase A로 둔 게 fail-closed 원칙과 충돌하는지.
5. **mssql 8.1.4(tedious 14) node12 파싱 가능 여부** — tedious 14.x dist 코드에 `?.`/`??`/`#` 가 있는지(있으면 node12에서 또 죽음).
6. **빌드 도구 함정** — vercel/pkg@5.8.1로 node16 Linux(glibc2.17) base + oracledb `.node` 동봉 시 추출경로/LD_LIBRARY_PATH 문제, node-odbc/ibm_db 네이티브 애드온의 pkg 동봉 가능성.

각 지적에 **출처 URL + 정확한 버전 숫자 + 권장 수정**을 붙여라. 추측이면 "추측"이라 표시해라.
