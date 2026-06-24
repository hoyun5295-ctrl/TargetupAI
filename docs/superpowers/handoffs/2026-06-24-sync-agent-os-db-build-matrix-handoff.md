# 2026-06-24 핸드오프 — 싱크에이전트 OS×DB 전담 빌드 매트릭스 (다음 세션 메인 작업)

## 0. 한 줄
싱크에이전트 빌드를 지금처럼 **OS 티어(node 버전) 1축**으로 잡고 모든 DB 드라이버를 한 빌드에 욱여넣는 구조에서, **(OS 티어 × DB 드라이버) 전담 빌드**로 전환한다. 위저드 변수 전 조합을 각각 빌드·실검증해 서버 `agent-builds/`에 올린다.

## 1. 왜 (이번 세션 VM 리허설로 잡은 근본)
- 이새F&C(Windows 2008 R2 + Oracle 10g) 대응 win-legacy(node12) 빌드를 VirtualBox VM(2008 R2 SP1 + Oracle 11g XE + 한글 5만건)에서 리허설.
- `sync-agent.exe --setup` 실행 시 **`SyntaxError: Unexpected token '?'`** 로 사망 — node12는 `??`/`?.`(V8 7.9/node13.2+) 미지원인데, win-legacy에 묶인 **mssql@9.3.2가 `??` 사용**. Oracle 테스트인데 **mssql 때문에 죽음**.
- 근본: `db/index.ts`가 mssql/mysql/oracle/pg 커넥터를 **전부 최상단 import** → 안 쓰는 드라이버까지 파싱.
- 더 큰 문제: `agent-build-tiers.ts`의 `VERIFIED_DBS_BY_TIER`가 win-legacy에 5개 DB 전부 "검증됨"이라 **선언**해놨으나 mssql은 node12 실검증 안 됨 = **"보이면 작동 불변식" 거짓**. OS 1축 + 전 DB 한 빌드 구조의 한계.

### 이번 세션 즉시 fix (코드 완료 · 빌드/업로드는 이 작업에서)
- `sync-agent/scripts/build-tier.js` win-legacy deps: `mssql@9.3.2` → **`mssql@8.1.4`** + 누락됐던 **`mysql2@3.2.0`** + **`pg@8.7.3`** 추가 (+ oracledb@5.5.0 유지). node12 끊긴 지점 근거: mssql 9.0.0이 node10/12 제거 · mysql2 3.2.1부터 node12 파싱 깨짐 · pg는 강제차단 없으나 8.7.x가 node12 시절 안전판.
- `sync-agent/src/db/index.ts`: switch에서 **선택된 DB 타입만 지연 `require`** (안전망 — 안 쓰는 드라이버 로드 0). oracle.ts·postgresql.ts가 이미 패키지를 메서드 안 require 하던 패턴을 팩토리로 올림. sync-agent tsc 0.

## 2. 브레인스토밍 결론 (Harold 방향 = 맞음, 정제)
- **축**: `node-tier × DB-driver`.
  - DB-driver = {oracle, mssql, mysql, pg} **4종**. (위저드의 `mssql-old`/`mssql-modern`은 같은 mssql 드라이버 — SQL Server 버전이 아니라 **node 버전**이 드라이버 버전을 결정하므로 한 빌드로 합쳐짐. 연결 노트만 다름.)
  - node-tier = {win-legacy(12), win-mid(16), win-modern(20), linux-legacy(16), linux-modern(20)} **5종**.
  - → 최대 **5 × 4 = 20 전담 빌드**. 각 빌드는 **자기 드라이버 1종만** node에 맞는 버전으로 동봉.
- **이점**: ① 각 빌드의 "보이면 작동"이 그 조합 단독 스모크로 **실검증 가능**(타 DB 간섭 0) ② node12에서 4종 드라이버 동시 호환을 맞출 필요 없음(조합당 1종만) ③ 빌드 작아짐 ④ 이번 같은 교차 사망 클래스 소멸.
- **비용**: 빌드 수 증가(최대 20, 자동화로 감당) · 서버 업로드/스토리지 증가.
- **드라이버 버전 매트릭스(핵심 산출물)** — node별로 드라이버 버전 확정:
  - node12(win-legacy): oracledb **5.5.0**(thick) · mssql **8.1.4** · mysql2 **3.2.0** · pg **8.7.3**
  - node16(win-mid·linux-legacy): mssql 10.x · mysql2 3.x · pg 8.x · oracledb 6.x(thin, ORACLE_HOME 있으면 thick) — 실검증 필요
  - node20(win-modern·linux-modern): 메인 최신(mssql 11 · mysql2 3 · pg 8 · oracledb 6) — 실검증 필요

## 3. 다음 세션 작업 순서
1. **superpowers:brainstorming** — 매트릭스 최종 확정(20 전부냐 / 하이브리드냐 — 모던 티어는 드라이버 다 도니 all-in-one 유지 가능. Harold 결정).
2. **build-tier.js 파라미터화** — `(tier, db)` 받아 그 드라이버 1종 + node별 버전만 설치·번들. 드라이버 버전 매트릭스 표를 단일 진실원으로.
3. **build-tiers.js / build:matrix** — 전 조합 빌드 + 윈도우 런타임 동봉 + 조합별 zip + manifest(조합 키).
4. **agent-build-tiers.ts** — `resolveAgentBuild(OS, DB)`가 **(OS×DB) 전담 packageFile** 반환. `VERIFIED_DBS_BY_TIER` → **조합별 실스모크 통과 시에만** 노출(가정 표기 금지, fail-closed 유지).
5. **위저드** — 이미 OS+DB 수집 → 그 조합 전담 빌드 서빙(프론트 변경 최소).
6. **전 조합 빌드 + `npm run upload:agents`** 로 서버 `agent-builds/` 업로드.
7. **조합별 검증** — VM(아래) 재활용. 최소 win-legacy×{oracle,mssql,mysql,pg} 4종은 node12 로드 실측.

## 4. 재활용할 VM 리허설 인프라 (이미 구축됨)
- VirtualBox VM **isaetest**: Windows Server 2008 R2 Standard(전체 설치, 빌드 7600 RTM — **SP1 적용 필요**) + Oracle 11g XE(OracleXE112_Win64) + vcredist_x64(VC++2010) + 한글 5만건(`isae/isae1234`, customers 테이블, 한글 무손).
- 공유폴더 "이새싱크"(\\vboxsvr) 로 호스트↔VM 파일 이동. 게스트확장 설치됨. 호스트키 = Left Ctrl로 변경됨.
- 에이전트: win-legacy zip 설치됨(서비스 등록). **재빌드한 exe로 교체 후 --setup 재검증 지점**.
- ★ 실전 10g 박스용 IC 11.2/12.1: Oracle 공식서 내려감(마지막 공개 IC=12.2, 단 12.2는 DB 11.2+만이라 10g 불가). 11g XE의 내장 11.2 클라(server\bin OCI)를 포터블로 뽑거나 archive.org 풀DB에서 추출. **원격 작업 직전 별도 확보**.
- 이새F&C: 원격 열어주고 "알아서 하라" → VM 리허설로 절차 굳힌 뒤 원격 실전. 그쪽 박스엔 10g 클라만 있어 IC 11.2/12.1 폴더 복사 필요(설치 아님).

## 5. 미해결/확인거리
- 이새F&C 실제 Oracle 10g 정확 버전(`SELECT * FROM v$version`) — IC/검증 매칭용.
- node16/20 티어 드라이버 버전 실검증(현재 코드·문서 검증만).
- IC 경로 함정: 에이전트 oracle.ts가 `ORACLE_HOME\bin`을 보는데 Instant Client는 루트에 DLL — PATH 또는 bin 구조 맞춰야 함(VM에서 11g XE 내장 클라는 bin 있어 통과, 순수 IC 실전 시 재현될 포인트).
