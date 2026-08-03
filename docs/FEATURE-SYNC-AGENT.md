# 싱크에이전트(Sync Agent) — 기능 상설 SoT

> **호출어: "싱크에이전트"** — Harold님이 싱크에이전트를 언급하면 이 문서를 먼저 연다.
> 이 문서는 **구조·불변 원칙·커서 규약·이력 색인**을 소유한다. 검증·빌드·출고 절차는 [빌드 런북](2026-07-28-sync-agent-build-verification-runbook.md), 증상별 진단은 [SYNC-AGENT-TROUBLESHOOTING](../status/SYNC-AGENT-TROUBLESHOOTING.md)이 소유한다(doc_ownership).
> 상태·잔여는 STATUS §2 카드가 소유한다.

---

## 1) 정의

고객사 내부 DB(Oracle·MSSQL·MySQL·PostgreSQL·엑셀/CSV)를 읽어 한줄로 원장(`customers`·`purchases`)으로 밀어 넣는 설치형 에이전트. 싱크에이전트와 자사몰 연동은 한줄로 타겟팅의 데이터 기반이다 — **여기가 새면 여정·자동마케팅 전부가 조용히 0건이 된다.**
문은 회사마다 하나(여정 불변 원칙과 동일) — 같은 사실이 두 경로로 들어오면 중복 발송·중복 과금이 된다.

## 2) 불변 원칙 (어길 수 없는 것)

| 원칙 | 뜻 | 어겼을 때 |
|---|---|---|
| **커서에 우리 시계를 넣지 않는다** | 커서는 **가져온 행에서 읽은 값**이다. 동기화 완료 시각을 넣는 순간 소스 컬럼과 축이 어긋난다 | 2026-08-03 이새 — 판매일에 시각이 없어(전량 자정) 그날 첫 배치 뒤 하루치 영구 탈락, 한 달 유실 98% |
| **커서 시각은 DB 원문 문자열로 왕복** | 조회 때 DB가 만든 문자열(`TO_CHAR`·`::text`)을 저장하고 같은 형식으로 파싱시킨다. JS Date 왕복 금지 | 드라이버 변환이 프로세스 TZ 의존 — 재부팅·TZ 변경 사이에 벽시계가 밀린다 |
| **바인드는 컬럼 타입에 맞춘다** | 타입 변환은 항상 상수 쪽에서. Oracle `DATE` 컬럼에 `TIMESTAMP` 바인드 금지 | 컬럼 쪽 캐스트 = 인덱스 불가 = 수백만 행 30분마다 풀스캔 |
| **적재는 멱등** | `source_row_key`(원본 PK) + `ON CONFLICT DO UPDATE`. 같은 행이 몇 번 와도 한 줄 | 재싱크·재전송·커서 겹침이 전부 중복 행이 되고, 고객 구매요약 재계산까지 오염 |
| **키는 자르지 않는다** | 상한 초과는 그 행만 거부+사유 보고 | 자르면 서로 다른 원본 행이 같은 키 — 한 건이 조용히 사라진다 |
| **`created_at`(도착 축)은 UPSERT가 갱신하지 않는다** | 여정 구매 원장 커서가 도착 축으로 읽는다 | 값이 올라가면 이미 발화한 구매가 커서 창에 재진입 — 재발송 |
| **PK 없는 테이블은 증분을 잠근다** | 자연키 조합을 지어내지 않는다(정답표). 전량 경로만 허용, 사유를 화면·heartbeat로 보고 | 같은 날 같은 상품 두 건이 한 건이 된다 |
| **커서 전진은 서버 성공 후** | API 실패(네트워크·5xx) = 미전진(재시도 몫). 행 검증 실패(전화번호 불량 등)는 전진+`failures` 보고 | 실패 행에 걸려 멈추면 그 청크 영구 재조회 루프 |
| **전량 뒤 커서 = 관측한 최대 (ts, PK)** | 전량 스캔은 PK 순서라 마지막 행 ≠ 최대 시각 | 전량 직후 증분이 이미 받은 구간 재수집 또는 누락 |
| **검증된 조합만 출고** | `VERIFIED_COMBOS` fail-closed + 같은 라벨 다른 물건 금지(변경 = 버전 올림) | 런북 §8 — 2026-07-27 빌드 먼저 사고 |

## 3) 구조 — 파일별 소유

| 층 | 파일 | 소유하는 것 |
|---|---|---|
| 엔진 | `sync-agent/src/sync/engine.ts` | 증분·전량 흐름 · 커서 전진 규칙 · 타임스탬프 컬럼 실재 검증 |
| 커서 저장 | `sync-agent/src/sync/state.ts` (`data/sync_state.json`) | 대상별 커서 · 명령 멱등 · ACK 보류함 · 원자 저장 |
| 어댑터 | `sync-agent/src/db/{oracle,mssql,mysql,postgresql,excel-csv,mock}.ts` | 증분·전량 조회 SQL · PK 해석 · **커서 직렬화(원문 문자열)는 어댑터가 소유** |
| 전송 | `sync-agent/src/api/client.ts` | 서버 payload(`source_row_key` 포함) · 재시도 |
| 스케줄 | `sync-agent/src/scheduler/index.ts` | 주기 실행(고객·구매 개별 주기) · heartbeat 매 정각 |
| 서버 수신 | `packages/backend/src/routes/sync.ts` | 인증 · 배치 상한 · sync_logs 기록 |
| 서버 적재 CT | `packages/backend/src/utils/sync-ingest.ts` | 키 정규화 · 배치 내 중복 제거(키 정렬 = 교착 방지) · 멱등 UPSERT SQL · 42703 강등 |
| 고객 적재 CT | `packages/backend/src/utils/customer-upsert.ts` | `(company_id, store_code, phone)` 멱등 — 처음부터 멱등이었다 |
| 티어·검증 | `packages/backend/src/utils/agent-build-tiers.ts` | OS 티어 판정 · `VERIFIED_COMBOS` |

**산출물 축** — 소스 하나, 바이너리는 OS 티어 5종(win-modern·win-2012·win-2008r2·linux-modern·linux-legacy). 드라이버 4종은 한 exe에 들어 있고 지연 로드. **회사별 빌드가 아니라 조합별 검증이다.**

## 4) 커서 규약 (2026-08-03 계약 — Codex 적대검증 1R 반영)

대상(customers/purchases)별로 `{ tsRaw, keys[], pkColumns[], fingerprint }`.
- `tsRaw` = 타임스탬프 **DB 원문 문자열**(어댑터가 SELECT에 원문 컬럼을 함께 실어 온다). 바인드는 컬럼 타입에 맞는 상수식으로만 되돌린다.
- **저장하는 것은 마지막 행이 아니라 "닫힌 버킷 경계"다** — 더 큰 ts가 관측된 버킷의 마지막 행까지. 최대 ts 버킷(열린 버킷)은 저장하지 않고 매 주기 재조회한다. PK 단조 증가는 아무도 보장하지 않아서, 같은 ts에 낮은 PK가 나중에 삽입되면 "마지막 행" 커서는 그 행을 영구 유실한다. `keys=[]` 커서 = 열린 버킷 시작(`ts >=` 재조회).
- `fingerprint` = dbType|접속대상|테이블|ts컬럼|PK구성. 하나라도 다르면 커서 폐기 → 전량 재기준(fail-closed).
- 조회 조건은 전 DB 공통 전개형 `ts > :t OR (ts = :t AND (k1 > :k1 OR …))`, 정렬 `ts ASC, k1 ASC, …`. 페이지 넘김은 런 안에서만 튜플 strict >.
- **키는 fail-closed** — `source_row_key`(PK 값 이스케이프 결합) 직렬화 불가 행(초과 길이·NULL·비스칼라)은 보내지 않고 행 실패로 보고한다(키 없이 보내면 열린 버킷 재조회마다 중복). PK 타입은 어댑터가 검증한다: Oracle NUMBER는 문자열 fetch+`TO_NUMBER` 바인드(JS number 반올림 차단), MySQL 정수는 `DECIMAL(65,0)` 캐스트(문자열 근사 차단), MSSQL·PG는 정수·문자 계열 화이트리스트 — 밖이면 명시 오류로 잠근다.
- **전량 씨앗은 완전 스캔+API 무실패일 때만** 심는다. 씨앗 = 시작 시점의 닫힌 버킷 경계(2단 조회). 닫힌 경계가 없으면(버킷 하나) 열린 버킷 시작 커서로.
- 커서 전진: API 실패 = 미전진 / 행 검증 실패 = 전진+보고 / 경계는 그 행이 포함된 페이지 전송 성공 후에만 저장.
- 시각 NULL 행은 증분에 안 잡힌다(전량에서만 — 동작 보존). 옛 형식 커서(완료 시각)는 fingerprint가 없어 자동 폐기 → 전량 재기준.
- **한계(기록)** — 과거 날짜로 소급 삽입(backdating)된 행은 어떤 HWM 커서로도 못 잡는다. 주기 재대조 워커가 별도 과제.

## 5) 이력 색인

| 시점 | 무엇 | 근거 |
|---|---|---|
| 2026-08-03 | **구매 증분 유실 사고 발견·서버 멱등 선행 배포** — 이새 6월 하루 820건 → 8월 3.7건(실제의 1.5%). 커서=완료시각 × 시각 없는 판매일 컬럼. 전 버전(1.5.7·1.6.4·1.6.5) 공통 결함. 서버 `source_row_key`+부분 유일 인덱스+UPSERT 선행 | SCHEMA `purchases` 절 · `utils/sync-ingest.ts` |
| 2026-07-28 | 빌드 검증 런북·`--test-db`·smoke-combos | [런북](2026-07-28-sync-agent-build-verification-runbook.md) |
| 2026-07-27 | Server 2016 VM 검증(1.6.4 win-modern×mysql 전체 통과). **VM은 검증 후 삭제됨(2026-08-03)** — 재검증 필요 시 재구축 | 런북 §0·§3 |
| 2026-06-30 | 이새 연동 시작(1.5.7 · Oracle · 2008 R2) · 전량 키셋 페이지네이션 | `memory/project_2026_0727_sync_agent_vm_verification.md` |
| 2026-06-11 | 인비토 첫 연동 3건(버전 단일 진입점 등) | TROUBLESHOOTING §2-4 |

## 6) 착수 전 필독

1. 이 문서 §2(불변 원칙) — 전부 사고 기원이다.
2. 검증·빌드·출고 = [런북](2026-07-28-sync-agent-build-verification-runbook.md) §1·§8.
3. 증상 진단 = [TROUBLESHOOTING](../status/SYNC-AGENT-TROUBLESHOOTING.md) 해당 절.
4. 서버 적재를 만지면 여정 구매 원장 커서(`journey-purchase-ledger`·`journey-target-extractor`)와 도착 축 계약을 먼저 확인한다.
