# 싱크에이전트 환경별 현황 (Sync.md)

> **목적**: 싱크에이전트가 돌 OS·DB·스키마 환경을 조합별로 기록하고, 어디까지 실제로 검증됐는지/어디가 미검증인지 한눈에 보기 위한 살아있는 문서. 신규 업체 설치 전 환경을 이 표에 먼저 채워 넣고 판단한다.
> **만든 날**: 2026-06-30. **갱신 규칙**: 새 업체 설치/실연결 검증 때마다 §4 조합 표 상태와 §5 환경별 기록을 갱신.
> 같이 볼 것: `status/SYNC-AGENT-TROUBLESHOOTING.md`, `status/SYNC-AGENT-REMOTE-INSTALL.md`, `status/SYNC-AGENT-ISAE-2026-06-30-HANDOFF.md`

---

## 1. 한눈에 — 정직한 현재 상태

- **실고객·실연결로 검증된 환경 = 이새(win-legacy × Oracle 11g, Windows Server 2008 R2) 하나뿐.** 고객 137,082건 동기화 확인.
- 나머지 OS×DB 조합은 **빌드는 되고 단위테스트(목)는 통과하지만 실 DB 연결 검증은 안 됨 = candidate.**
- 2026-06-30 페이지네이션 전면 정정(아래 §3)은 **코드 검증(tsc 0 + 단위 25개) 완료**, 단 새 코드라 **아직 어떤 실 DB로도 안 돌아봄.** 실연결 검증은 다음 배포/동기화 때.
- **결론**: 신규 환경은 설치 전 §6 체크리스트로 사전 판단 + 설치 후 실연결 스모크로 검증해야 "된다"고 말할 수 있다. 미검증 조합을 "완벽"이라 단정하지 않는다.

---

## 2. OS 빌드 티어 (build-tier.js 기준)

| 티어 | node | OS 바닥 | pkg 타깃 | 레거시 의존성 핀 |
|---|---|---|---|---|
| win-modern | 20 | Win10 / Server 2016+ | node20-win-x64 | 없음(메인 그대로) |
| win-mid | 16 | Win8.1 / Server 2012 R2 | node16-win-x64 | express4 · mssql10 · tedious16 |
| win-legacy | 12 | Win7 / Server 2008 R2 / 2012(비R2) | node12-win-x64 | oracledb5.5.0(thick) · mssql8.1.4 · tedious14.7 · mysql2 3.2.0 · lru-cache7.18.3 · pg8.7.3 · nodemailer6 · sql.js1.8.0 |
| linux-modern | 20 | glibc 2.28 | node20-linux-x64 | 없음 |
| linux-legacy | 16 | glibc 2.17 | node16-linux-x64 | express4 · mssql10 · tedious16 |

- 구형 윈도우(win-legacy)는 exe 옆에 런타임 폴더 + Oracle thick은 Instant Client 동봉 필요(약 290M, 외부 확보).
- node 바닥을 잘못 고르면(예: 2008R2에 node20 exe) 실행 자체가 안 됨 — 설치 전 OS 정확히 확인.

---

## 3. 지원 DB 어댑터 + 페이지네이션 현황 (2026-06-30 정정 반영)

| 어댑터 | 전체(full) 페이지네이션 | 증분 정렬 | 검증 |
|---|---|---|---|
| Oracle | **ROWID 키셋** (깊은 OFFSET 재스캔 제거) | 타임스탬프 + ROWID 타이브레이커 | 코드(tsc+목). 실DB 미검증 |
| MySQL | 단일 PK 안정 정렬 OFFSET | 타임스탬프 + PK 타이브레이커 | 코드만 |
| MSSQL | 단일 PK 안정 정렬 OFFSET(ROW_NUMBER) | 타임스탬프 + PK 타이브레이커 | 코드만 |
| PostgreSQL | ctid 정렬 OFFSET | 타임스탬프 + ctid 타이브레이커 | 코드만 |
| Excel/CSV | 인메모리 slice(결정적) | 파일 변경감지 diff | 안전(동시변경 0) |
| **공용 엔진(전 어댑터)** | 키셋 우선 → OFFSET은 getRowCount까지 구동 + 완전성 가드 | "짧은 페이지면 끝" 단정 제거(full·증분) | 단위 25개 통과 |

- 핵심: full이 "짧은 페이지면 끝"이라 단정해 이새가 99,852에서 끊긴 사고 → 엔진을 총건수 기준 구동 + 완전성 가드(받은수<총건수면 경고)로 바꿈. Oracle은 키셋으로 깊은 OFFSET 자체를 제거.
- **미지원 DB(어댑터 없음)**: 티베로(Tibero) · DB2 · 알티베이스(Altibase) 등. types.ts에 odbc 단일 커넥터로 확장 예정이나 **현재 코드 없음** — 이런 DB 업체는 설치 불가.

---

## 4. 조합 표 (OS 티어 × DB) — 상태

상태: **검증완료**(실고객 실연결) / **candidate**(빌드+단위만, 실연결 미검증) / **blocker**(추가 확보 필요)

| OS 티어 \ DB | Oracle | MSSQL | MySQL | PostgreSQL | Excel/CSV |
|---|---|---|---|---|---|
| win-modern (node20) | candidate(thin) | candidate | candidate | candidate | candidate |
| win-mid (node16) | candidate(thin) | candidate | candidate | candidate | candidate |
| win-legacy (node12) | **검증완료 = 이새**(thick·IC 필요) | candidate | candidate | candidate | candidate |
| linux-modern (node20) | candidate(thin) | candidate | candidate | candidate | candidate |
| linux-legacy (node16) | candidate(thin) | candidate | candidate | candidate | candidate |

- 모든 Oracle thick(win-legacy 등) = **blocker: Oracle Instant Client 동봉 필요**(외부 확보 후 zip에 포함).
- candidate = 빌드되고 단위는 통과하나 **그 OS/그 DB로 실제 연결해 한 건이라도 동기화해 본 적 없음.** 첫 업체가 그 조합이면 그때 검증.

---

## 5. 환경별 기록

### 5-1. 이새에프앤씨 (isae) — 유일한 실연결 검증 환경
- 조합: **win-legacy × Oracle 11g** / Windows Server 2008 R2 / `company_id=682956b7-37a3-46b5-9868-b63011bda47b`
- 접속: Oracle host 125.141.198.22 : 1521, **service_name=ISDB**(SID 아님), 계정 `CRM_VIEW_USER`(읽기전용 시노님 11개 → 실소유 스키마 ISUSER2)
- 스키마 특이점: 휴대폰이 `핸드폰1/2/3` 3칸 분할 / 주소 2칸 / 고객=`고객`, 구매=`고객구매이력` / 증분 기준 고객=`최종수정일시`·구매=`판매일자`
- 검증된 사실: 고객 137,082건 전부 유니크 적재(중복 0). full이 25/35 배치에서 조기종료됐던 사고는 2026-06-30 엔진/Oracle 정정으로 차단(코드 검증). **새 exe 배포 후 실연결 재검증 필요.**
- 미해결: 구매 동기화 = 외주(안기성) `고객구매이력_연동` 뷰(전화번호 JOIN) 미완성으로 전건 실패 대기.
- 상세: `status/SYNC-AGENT-ISAE-2026-06-30-HANDOFF.md`

### 5-2. [신규 업체 기록 템플릿 — 설치 시 복사해서 채움]
- 업체명 / company_id:
- 조합: OS 티어( ) × DB( ) / OS 정확 버전:
- 접속: host·port / 인증방식(SID·service / 시노님 / 스키마):
- 핵심 테이블·컬럼: 고객( ) 구매( ) / 증분 타임스탬프 컬럼( ) / **단일 PK 컬럼( )** ← 키셋·안정정렬 키
- 전화번호 저장 방식 / 인코딩 / 데이터 규모(고객 약 건, 구매 약 건):
- 검증: 실연결 스모크 통과 여부 / full 완주(받은수=총건수) 확인 / 특이사항:

---

## 6. 신규 설치 전 환경 점검 체크리스트 (설치 전 반드시 확인)

1. **OS 정확 버전** → 티어 결정(2008R2=win-legacy, 2012R2=win-mid, 2016+=win-modern, 리눅스 glibc). 잘못 고르면 exe 실행 불가.
2. **DB 종류 + 버전** → 지원 어댑터(oracle/mssql/mysql/postgres/excel/csv)인지. **티베로·DB2·알티베이스면 설치 불가(어댑터 없음).**
3. **접속 방식** → Oracle: SID vs service_name, 시노님 계정 여부 / 권한(읽기전용 가능한지).
4. **대상 테이블 스키마** → 고객/구매 테이블·컬럼 실재, 증분용 타임스탬프 컬럼 존재.
5. **단일 컬럼 PK 존재 여부** → 있으면 키셋/안정정렬로 대용량 안전. 없으면 OFFSET 무정렬 위험(완전성 가드가 누락은 잡지만 정렬 보장 약함) — 사전 인지.
6. **전화번호 저장 방식** → 분할(이새 3칸)·접두 0 누락·국가코드 등. 식별키라 어긋나면 전 고객 붕괴.
7. **인코딩** → MySQL latin1/cp1252 이중인코딩, MSSQL 한글 등.
8. **데이터 규모** → 고객 10만+·구매 100만+면 full 페이지네이션·소요시간 사전 점검(이새 구매 약 200만).

---

## 7. 환경별 알려진 함정 (누적)

- **2008R2 콘솔 cp949** → 배포 .bat는 ASCII 영문 전용(한글 bat는 명령 깨짐). 한글 안내는 데이터 파일로.
- **node12(win-legacy) 드라이버 핀** → mssql 9.0+ / mysql2 3.2.1+ / oracledb 6.x(thin)이 node12에서 `??`·thin 미지원으로 깨짐. build-tier.js의 핀 버전 고정 필수. es-check es2019 가드로 위험 버전 차단.
- **Oracle thick** → 11g 이하 + 구형 윈도우는 Instant Client 동봉 필수. pkg가 `.node`를 스냅샷에 못 실어 exe 옆 외부 폴더로 동봉(oracle.ts가 감지).
- **Oracle 시노님 계정** → user_tables만 보면 0개. getTables가 tables+views+synonyms 조회, getColumns가 시노님→실소유.테이블 해석.
- **페이지네이션 깊은 OFFSET** → 라이브 대용량에서 짧은/빈 페이지로 조기 종료(이새 사고). 2026-06-30 정정: 키셋 우선 + getRowCount 구동 + 완전성 가드.
- **무정렬 OFFSET(정정 전 MySQL/MSSQL)** → 건너뜀/중복. PK 안정 정렬로 정정. PK 없으면 잔존 위험 → §6-5 사전 확인.
- **타임스탬프 컬럼 부재** → 증분 매 주기 실패(인비토 실측). 기동 시 validateTimestampColumnsAtStartup로 사전 경고 + fallbackToFullSync.
