# isae(이새에프앤씨) 싱크에이전트 설치 — 2026-06-30 작업기록 + 내일 마무리 지시서

> 이 문서 하나로 내일 작업을 빈틈없이 끝내기 위한 인수인계 문서. **내일 작업 전 처음부터 끝까지 정독.**
> 같이 볼 것: `status/SYNC-AGENT-REMOTE-INSTALL.md` (win-legacy×Oracle 원격설치 일반 가이드)

---

## 0. 지금 상태 한눈에

| 항목 | 상태 |
|------|------|
| 고객 동기화 | **라이브 완료** — 99,838건, 휴대폰 합치기 성공, 서버 적재 검증 끝 |
| 구매 동기화 | **대기** — 외주(안기성)가 JOIN 뷰 고치면 내일 붙임. 현재 0건(전화번호 없어서) |
| 에이전트 실행 | 작업 스케줄러 `SyncAgent` 실행 중(SYSTEM/세션0/부팅자동) |
| sync_agents.status | **inactive** (구매 다 돌면 active로 바뀜 — 원인 8번 참조) |
| 모델명 화면 노출 | 코드 수정 + 자동 차단 게이트 완료. **새 exe 빌드해야 적용** |

---

## 1. 고객사 환경 (확정 사실)

- 회사: **이새에프앤씨** / `agent_name = isae` / `company_id = 682956b7-37a3-46b5-9868-b63011bda47b`
- 서버 OS: Windows Server 2008 R2 (IE8 → 웹 마법사 불가, `--setup-cli` 필수)
- DB: **Oracle** — host `125.141.198.22` / port `1521` / service `ISDB` (서비스명 방식, SID 아님)
- 접속 계정: **CRM_VIEW_USER** (읽기전용, 본인 소유 테이블 0개. 시노님 11개로 타 스키마 노출)
- 실제 데이터 소유 스키마: **ISUSER2** (고객 618, 그 외 다수)
- 시노님 11개 → 전부 ISUSER2: 고객, 고객구매이력, 기초코드, 매장, 매장재고, 물류출고의뢰, 브랜드아이템, 창고재고, 품번, 품번규격, 품번색상
- 핵심 테이블: 고객 테이블 = `고객`, 구매 테이블 = `고객구매이력`
- 전화번호 저장 방식: **휴대폰이 `핸드폰1`/`핸드폰2`/`핸드폰3` 3칸으로 쪼개짐** (010 | XXXX | XXXX). 전화번호1/2/3도 같은 방식.
- 주소: `주소1`(기본) + `주소2`(상세) 2칸.
- 타임스탬프(증분 기준): 고객 = `최종수정일시`, 구매 = `판매일자`
- **구매 테이블(고객구매이력)에는 전화번호가 없음. `고객번호`만 있음** → 고객 테이블과 JOIN해야 전화번호 확보 (원인 5번)

### 접속 명령 (참고)
```
sqlplus CRM_VIEW_USER/비번@"(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=125.141.198.22)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=ISDB)))"
```

---

## 2. 오늘 부딪힌 문제 · 원인 · 해결 (전부)

1. **0개 테이블 감지** — CRM_VIEW_USER가 시노님 계정인데 에이전트가 `user_tables`만 조회 → 0개.
   해결: `getTables`를 `user_tables` + `user_views` + `user_synonyms`로 확장. `getColumns`는 시노님이면 실제 소유자.테이블로 해석해 `all_tab_columns`/`all_constraints`에서 조회. (데이터 조회는 `FROM "시노님"`을 오라클이 자동 해석해 원래부터 동작)

2. **ORA-12560 (sqlplus)** — 호스트 없이 접속하면 로컬 인스턴스로 가서 발생. 디스크립터 형식(위 1장)으로 원격 강제.

3. **휴대폰이 3칸으로 쪼개짐** — 한 칸만 phone에 매핑하면 전 고객이 '010' 하나로 뭉쳐 식별키 붕괴.
   해결: `mapRow`가 같은 표준필드에 여러 소스컬럼이 오면 끝자리 숫자 순으로 이어붙임. `editMapping`이 phone 등 복합필드는 중복 지정 허용.

4. **주소 2칸** — `주소1`+`주소2` → address 복합(공백으로 이어붙임).

5. **구매 테이블에 전화번호 없음** — 고객번호만 있어 한줄로(전화번호로 고객-구매 연결) 구조와 안 맞음.
   해결: 외주가 고객구매이력 ↔ 고객을 `고객번호`로 JOIN해 전화번호를 붙인 **뷰**(`고객구매이력_연동`) 제공. 우리 에이전트는 뷰 지원이 이미 들어가 추가 코드 0.

6. **외주 1차 뷰가 JOIN 빠진 복사본** — 전화번호 컬럼 없이 그냥 고객구매이력 복사 → 49컬럼에 전화번호 없음. CREATE OR REPLACE로 JOIN 포함 재작성 요청.

7. **시노님 누락** — 외주가 뷰는 만들었으나 CRM_VIEW_USER용 시노님을 안 만들어 설치 목록에 안 뜸. 다른 11개처럼 시노님 한 줄 필요.

8. **sync_agents.status = inactive (동기화는 됨)** — 원인: 에이전트 기동 흐름이 `초기 동기화(고객+구매) → 그 다음 하트비트 전송(status=active)` 순서(`index.ts`). 구매가 전화번호 없이 565배치를 느리게 갈아 초기 동기화가 안 끝나니 하트비트 단계 도달 못 함. **에이전트는 살아있고 데이터도 보냄(last_sync_at·count 갱신), status 플래그만 못 찍힘.** → 구매가 정상화돼 다 돌면 그 직후 하트비트 나가 active로 바뀜. (근본 fix는 6번 항목 — 미해결 과제)

9. **구매 grinding (565배치 전건 0)** — 전화번호 없어 정규화 단계에서 전건 제외. 에러 아님. 뷰 정상화되면 실제 적재됨.

10. **모델명 화면 노출** — setup CLI/로그/JSON 5곳에서 AI 모델명을 그대로 출력 → 원격이라 외주도 봄.
    해결: 전부 `AI 모델`로 가림 + **가드 테스트**(`npm test`) + **빌드 게이트**(`build-tier.js`) 추가 → 모델명이 화면 코드에 들어가면 빌드 자체가 실패. (검증: 원본 위반 차단·정상 통과 확인, 22 테스트 통과)

11. **win-legacy zip 137MB (다른 티어는 작음)** — 정상. Oracle Instant Client(oci.dll + 약 921개 파일, 100MB+) 동봉 때문. 구형 윈도우 오라클 thick 연결 필수. 다른 티어는 미동봉이라 작음.

12. **작업 디렉터리 함정** — vitest/tsc를 루트에서 돌리면 모노레포 전체(296 테스트)가 돌아감. 반드시 `cd sync-agent` 후 실행.

---

## 3. 이번 세션 코드 변경 (배포 대기 — 새 exe 빌드 필요)

| 파일 | 변경 |
|------|------|
| `sync-agent/src/db/oracle.ts` | getTables = 테이블+뷰+시노님 / getColumns = 시노님 해석(all_tab_columns·all_constraints) |
| `sync-agent/src/mapping/index.ts` | COMPOSITE_FIELDS(phone/customer_phone/address) + mapRow 이어붙이기 |
| `sync-agent/src/setup/cli.ts` | editMapping 복합필드 중복 매핑 허용 + 모델명 가림 |
| `sync-agent/src/setup/edit-config.ts`, `ai-mapping-client.ts`, `setup/server.ts` | 모델명 가림 |
| `sync-agent/src/db/oracle.synonym.test.ts`, `mapping/composite.test.ts`, `setup/model-name-exposure.guard.test.ts` | 테스트 신규 |
| `sync-agent/scripts/build-tier.js` | 모델명 노출 빌드 게이트 |

- 검증 상태: **테스트 22개 통과 + tsc 0**
- 빌드: 로컬에서 `cd C:\Users\ceo\projects\targetup\sync-agent` → `npm run build:win-legacy` → `release\sync-agent-win-legacy.exe`
- 배포: 그 exe를 `sync-agent.exe`로 이름 변경 → 박스 `C:\SyncAgent\sync-agent.exe` 교체 (전체 zip 재전송 불필요 — 박스에 oracle-client/oracledb/wasm 폴더 이미 있음)

---

## 4. 내일 작업 — 안기성 SQL 실행 후 (단계별, 순서 절대 준수)

### 4-A. 안기성이 실행할 SQL (먼저 확인)
```sql
CREATE OR REPLACE VIEW ISUSER2.고객구매이력_연동 AS
SELECT p.*, c.핸드폰1 || c.핸드폰2 || c.핸드폰3 AS 고객전화
FROM ISUSER2.고객구매이력 p
JOIN ISUSER2.고객 c ON p.고객번호 = c.고객번호;

CREATE SYNONYM CRM_VIEW_USER.고객구매이력_연동 FOR ISUSER2.고객구매이력_연동;
```
(`고객전화` = 휴대폰 3칸 이어붙인 단일 컬럼. 오라클 `||`는 null을 빈문자로 처리.)

### 4-B. 뷰 검증 (우리 — sqlplus CRM_VIEW_USER 창)
```sql
-- ① 시노님 생겼는지 (설치 목록에 떠야 함)
SELECT synonym_name FROM user_synonyms WHERE synonym_name LIKE '%연동%';

-- ② 컬럼 + 전화번호 값 확인 (고객전화가 11자리로 보여야 함)
SELECT * FROM (SELECT * FROM "고객구매이력_연동") WHERE ROWNUM <= 3;
```
- 시노님 안 보이면 → 안기성한테 `CREATE SYNONYM` 한 줄 다시 요청
- `고객전화`가 11자리 휴대폰으로 안 보이면 → 뷰 JOIN/concat 잘못된 것, 4-A SQL 다시 확인

### 4-C. (권장) 새 exe로 교체 — 모델명 가림 적용
> 구매 붙이는 것과 무관하지만, 모델명 가림은 새 exe에 들어있으니 이왕이면 같이.
- 로컬: `cd C:\Users\ceo\projects\targetup\sync-agent` → `npm run build:win-legacy`
- `release\sync-agent-win-legacy.exe` → `sync-agent.exe`로 이름 변경 → 서팀장 전달
- 박스: `schtasks /End /TN SyncAgent` → `taskkill /F /IM sync-agent.exe` → exe 교체
- 안 할 거면 이 단계 생략(모델명 가림만 미적용, 구매는 그대로 붙음)

### 4-D. 구매 테이블 연결 (박스 — 빌드 불필요)
```
cd /d C:\SyncAgent
sync-agent.exe --edit-config
```
- **[3] 동기화 설정** → `구매 테이블명` → `고객구매이력_연동` 입력
- **[4] 컬럼 매핑** → `구매 매핑`:
  - `고객전화` → **customer_phone** (새 매핑 추가)
  - `판매일자` → **purchase_date** (현재 recent_purchase_date면 변경)
  - 실제 거래금액 컬럼 → **total_amount** (매출가/확정가 중 어느 게 실거래액인지 4-B ② 샘플로 확인 후)
- **💾 저장하고 종료**

### 4-D-2. 같은 세션에서 고객 매핑 최종 정리 (custom 15개 + 라벨)

> 어제는 65컬럼 전부 매핑(잡동사니 custom 포함). 고객사가 쓸 것만 재확정 — 표준 8 + custom 15.
> `--edit-config` [4] 고객 매핑에서 불필요 매핑 삭제 + 필요한 것 추가, 그리고 [4] 커스텀 필드 라벨에서 이름 지정.
> (custom 슬롯 번호는 자동 배정, **라벨이 화면 표시명**)

**표준 8**: 성명→name / 매장코드→store_code / 핸드폰1·2·3→phone(합침) / 생년월일→birth_date / 마일리지→points / 문자수신→sms_opt_in / 가입매장→registered_store / 가입구분→registration_type

**custom 15 (라벨 = 컬럼명 그대로)**: 고객상태 · 고객번호 · 등록일자 · 마일리지사용액 · 마일리지발생액 · 신규등록일자 · 신규마일리지 · 추가마일리지 · 소멸마일리지 · 인증여부 · 인증매장 · CI · 카카오인증매장 · 최종접속일자 · 이관이력

**뺀 6 (매핑 삭제)**: 비고 · 주민등록번호 · 최종수정일자 · 나이대 · 인증일시 · 최초인증일시

- 참고: `나이대`는 age(숫자) 아니라 문자 구간 → 뺌. `주민등록번호`는 고유식별정보라 뺌(잘한 선택). `CI`는 주민번호 파생 연계정보라 민감계열(그대로 둘지 고객사 판단).
- 주의: 이미 올라간 99,838건은 증분이라 기존 custom_fields 유지. 신규·수정분부터 정리된 매핑 적용. 전부 비우려면 전체 재동기화 필요(잡동사니는 화면 노출 안 돼 급하지 않음).

### 4-E. 재시작 + 실행 검증 (박스)
```
schtasks /End /TN SyncAgent
schtasks /Run /TN SyncAgent
tasklist /FI "IMAGENAME eq sync-agent.exe" /V
```
- `tasklist`에 **NT AUTHORITY\SYSTEM** sync-agent.exe(세션0)면 정상
- 구매 동기화가 이번엔 실제 적재됨. **구매 약 200만건+(565배치×4000)이라 시간 오래 걸림. 절대 Ctrl+C 금지** — 다 돌아야 (a) 구매 적재 완료 (b) 하트비트 나가 status=active (c) 증분 커서 advance.

### 4-F. 서버 검증 (PostgreSQL)
```
docker exec -it targetup-postgres psql -U targetup targetup
```
```sql
-- ① 에이전트 상태 (구매 다 돌면 active + 하트비트 + 구매건수)
SELECT status, last_heartbeat_at, last_sync_at, total_customers_synced, total_purchases_synced
FROM sync_agents WHERE agent_name='isae';

-- ② 구매 적재 + 고객 연결 확인
SELECT COUNT(*) AS 구매수,
       COUNT(*) FILTER (WHERE customer_phone ~ '^010[0-9]{8}$') AS 전화번호정상
FROM purchases
WHERE company_id='682956b7-37a3-46b5-9868-b63011bda47b';
```
- `status=active` + `total_purchases_synced` 증가 + 구매수 차오르면 **구매까지 라이브 완료**

> 참고 — 오늘 고객 검증치(이미 통과): 고객 99,838 / 휴대폰정상 99,475 / 고유전화번호 99,838(전부 유니크=합치기 성공) / 수신동의 92,070.

---

## 5. 내일 빠지지 말 함정 (체크리스트)

- [ ] 빌드·테스트는 반드시 `cd C:\Users\ceo\projects\targetup\sync-agent` 후 (루트면 모노레포 전체 296개 돌아감)
- [ ] 구매 200만건 = 오래 걸림. **Ctrl+C 금지** (status active·커서 advance가 안 됨)
- [ ] phone에 합칠 세트 = **010이 실제로 차 있는 쪽**(핸드폰 세트). 빈 칸 고르면 전 고객 식별키 붕괴
- [ ] total_amount = 매출가/확정가 중 **실제 거래금액** 컬럼 (샘플로 확인 후 매핑)
- [ ] 시노님 없으면 설치 목록에 뷰 안 뜸 → 안기성 시노님 한 줄
- [ ] 모델명 화면 노출 0건 (빌드 게이트가 막지만, 새 코드 작성 시 의식)

---

## 6. 미해결 / 후속 과제 (급하지 않음, 별도)

1. **하트비트 순서 fix** — `index.ts`에서 하트비트(status=active)를 초기 동기화 *전에* 보내도록 순서 조정. 그래야 대용량 회사도 초기 동기화 중에 바로 active로 뜸. (현재는 동기화 다 끝나야 active) — 명령 핸들러 유실 안 되게 신중히 설계 후 TDD.
2. **구매 비활성 옵션** — `--edit-config`로 구매 테이블을 빈칸으로 못 만듦(Enter=유지). 구매를 안 돌리고 싶을 때 깔끔히 끄는 경로 필요 시 추가.
3. **한줄로 본체(frontend/packages) 모델명 빌드 게이트** — 반복 노출이 본체에서도 났음(D214 등). 본체 빌드(build:safe)에도 동일 게이트 권장.

---

## 7. 표준 명령 모음 (박스 = C:\SyncAgent)

| 용도 | 명령 |
|------|------|
| 작업 정지 | `schtasks /End /TN SyncAgent` |
| 강제 종료 | `taskkill /F /IM sync-agent.exe` |
| 작업 실행 | `schtasks /Run /TN SyncAgent` |
| 실제 프로세스(진실) | `tasklist /FI "IMAGENAME eq sync-agent.exe" /V` |
| 설정 편집 | `sync-agent.exe --edit-config` |
| 설정 보기 | `sync-agent.exe --show-config` |
| 로그 | `type logs\sync-YYYY-MM-DD.log` |
