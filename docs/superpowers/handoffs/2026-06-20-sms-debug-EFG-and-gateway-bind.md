# 2026-06-20 핸드오프 — 추가 디버깅 E/F/G + 발송 지연 게이트웨이 bind

> 다음 세션 1순위: ① 게이트웨이 개발자 답변(한 ID 동시 bind 가능 여부) 확인 → bind 방향 ② F 한줄로 해결 = MMS/LMS 라인 분리 구현(아래 3장 설계). 
> 이번 세션 코드 완료(배포 대기): E(직접발송 빈열 매핑) · G(AI마케팅 주기 요일/날짜) · F-invalidate(라인할당 캐시 보강).

## 0. 세션 상태 한눈에
- 직원 디버깅 A/C/D(이전 핸드오프)는 이 세션 초반 완료·Harold "배포완료"(memory `project_2026_0618_4bug_rootcause` 갱신됨).
- 추가 디버깅 **E/F/G** 처리:
  - **E** 직접발송 리스트 빈열 매핑 = 한줄로 코드 fix 완료, tsc 0, **배포 대기**.
  - **G** AI 자동마케팅 주기(매주/매달) 요일·날짜 선택 = 한줄로 코드 완료 + DB ALTER 실행됨, tsc 0, **배포 대기**.
  - **F** shiseido3 지연발송 = **근본이 게이트웨이 단일 bind(`bind_idx_cnt=1`)로 확정. 한줄로 코드 문제 아님.** 게이트웨이 개발자 답변 대기 + 한줄로 MMS/LMS 분리(다음 세션 구현).

## 1. 배포 대기 (E · G · F-invalidate) — tsc 0×2

### E. 직접발송 리스트 업로드 시 수신번호(F열) 매핑 누락 (이새/진흙 사은품)
- **근본(node 실측 확정)**: `XLSX.utils.sheet_to_json(ws, {header:1})`가 `defval` 없으면 **빈 셀이 sparse 배열의 hole**이 됨(`4 in row === false`). 그런데 `dedupeHeaders`와 preview/allData 매핑이 모두 `forEach`를 쓰는데 **forEach는 hole을 건너뜀** → 빈 열(E) 뒤의 컬럼(F=수신번호)이 헤더 배열에서 사라져 인덱스가 당겨짐 → F 누락. E↔F 순서 바꾸면 정상인 건 빈 열이 맨 끝(trailing)으로 가서.
- **fix**: `packages/backend/src/routes/upload.ts`의 `sheet_to_json(..., { header: 1 })` **4곳**(134 parse · 393 validate-mapping · 473 totalRows · 563 실제 DB저장 백그라운드) → `{ header: 1, defval: null }`. 특히 563(processUploadInBackground)은 빈열 엑셀이 컬럼 누락 저장되던 데이터 손실 잠재버그.
- 검증: node 재현 NO_defval→F 누락 / defval:null→F 정상. backend tsc 0.

### G. AI 자동마케팅 생성 시 매주/매달 주기에 요일·날짜 선택창 없음
- **근본**: `continuous-operator.ts:computeNextRun`이 weekly=+7일·monthly=+1개월로 요일/날짜 지정 불가. `continuous_operators`에 요일/날짜 컬럼 없음.
- **DB ALTER (이미 실행됨, Harold 확인)**: `ALTER TABLE continuous_operators ADD COLUMN IF NOT EXISTS schedule_day_of_week smallint;` + `schedule_day_of_month smallint;`
- **fix 파일**:
  - `backend/utils/continuous-operator.ts` — 타입(CreateOperatorInput·ContinuousOperator·updateOperator patch) + `computeNextRun(schedule, scheduleTime, dayOfWeek, dayOfMonth)`(weekly=다음 지정요일, monthly=지정날짜 말일클램프) + createOperator INSERT + updateOperator(SELECT current+UPDATE $21/$22) + updateOperatorAfterRun(컬럼 미존재 try/catch 안전) + mapRowToOperator
  - `backend/routes/ai.ts` — POST/PUT `/operator/continuous` body `schedule_day_of_week`/`schedule_day_of_month` 전달 + `column does not exist` 503 안전망
  - `frontend/pages/ContinuousOperatorPage.tsx` — 타입 + 저장 body + UI(weekly→요일 select 일~토, monthly→날짜 select 1~31 + "없는 날은 말일" 안내)
- 검증: computeNextRun 실측(weekly 월=다음월요일, 금=다음주금요일 / monthly 1일=다음달1일, 31일=6월30일 말일클램프). backend·frontend tsc 0.

### F-invalidate (F 근본 아닌 별개 코드 결함 — 보강)
- `admin.ts` 회사 수정(484)·사용자 수정(144)에서 라인그룹 **할당 변경** 시 `invalidateLineGroupCache` 누락(라인그룹 CRUD 3024/3073/3107엔 있었음) → 라인 변경 직후 60초 stale 적재 위험. 두 곳 보강.
- ※ 캐시 TTL 60초라 F의 40분 지연과는 무관(별개 결함). 그래도 유지 권장.

## 2. F 발송 지연 — 근본 = 게이트웨이 단일 bind (한줄로 코드 아님, 데이터로 확정)

**현상**: 6/12 10:32 시세이도(shiseido3) 즉시발송 4건(LMS, 캠페인 `549ead81`)이 11:12에 송출(40분 지연). shiseido1 동일 11시 정상.

**추적 결론(전 구간 데이터)**:
1. 라인: shiseido1·3·4·6 모두 같은 회사 `(주)한국시세이도`, **같은 라인 `{SMSQ_SEND_7,8,9}`**. 라인 불일치 아님.
2. 한줄로 적재 정상: PG campaign created/sent 10:32, MySQL `sendreq_time`(=`NOW()`, `bulkInsertSmsQueue:1148`) 10:32. → 한줄로는 제때 큐에 넣음.
3. agent 송출(`mobsend_time`/agent 로그) 11:12. 통신사 리포트도 11:12 → agent가 11:12에야 처리.
4. **라인4는 LMS만(MMS 0) 45,617건을 지연 없이 처리, 라인7/8/9는 MMS 33,196+LMS 44,824를 같이 보내며 느림** → MMS가 범인.
5. agent 로그(`agent7/conf/qtmsg.xml`): **`<bind_idx_cnt>1</bind_idx_cnt>` = 게이트웨이 연결 1개.** MMS(이미지=무거움)가 그 단일 bind를 점유 → 같은 라인 LMS(549ead81)가 뒤에서 40분 대기. 로그상 agent는 11:12:53에 3건을 2ms에 처리(동기 아님, 빠름) 후 PING/PONG idle = "버스트 후 게이트웨이 다음 배치 대기" 패턴. 78,020건/40분 ≈ **32 TPS**(정상 SMPP 수백~수천 대비 비정상).
- qtmsg.xml에 throttle/window 설정은 없음(grep 0). 게이트웨이 MT센터 `58.227.193.58`, agent ID `targetai7_m`(deliver)/`targetai7_r`(report).

**→ 한줄로 코드 수정 대상 아님.** 병목은 agent↔게이트웨이 SMPP 연결 1개.

### 2-1. 게이트웨이 답변 대기 (Harold가 개발자에 문의함)
- 질문: **한 ID(`targetai7_m`)로 동시 bind(연결)를 여러 개 열 수 있는가?** (넷플릭스 한 계정 다중 동시접속처럼)
  - 가능하면 → `qtmsg.xml` `bind_idx_cnt` 1→3~5로 올리고 agent 재시작(서버, 서팀장). 처리량 몇 배.
  - 한 ID=1 bind만 허용하면 → ID(회선) 추가 계약 필요.
- 동시 bind 시 `qtmsg.xml`에 idx별 설정(`deliver_connect_user_2`, `report_server_address_2` 등) 추가 구조인지도 개발자 확인.
- 이 변경은 agent 설정(서버)이라 한줄로 코드 밖. 다음 세션엔 "답변 확인 → 방향 결정"만.

## 3. F 한줄로 해결 — MMS/LMS 라인 분리 (다음 세션 구현)

**목표**: bind를 못 늘리더라도, **MMS가 단일 연결을 점유해도 문자(LMS/SMS)는 다른 라인으로 빠져나가 안 막히게**. 549ead81 같은 문자가 MMS 뒤에 안 깔리게.

**현재 적재 구조 (코드 근거)**:
- `sms-queue.ts:getCompanySmsTables(54)` — 회사 라인그룹 `sms_line_groups.sms_tables`(예 {7,8,9}) 반환.
- `sms-queue.ts:getNextSmsTable(213)` — 전역 `rrIndex` 라운드로빈(균등). 편향 아님.
- `sms-queue.ts:bulkInsertSmsQueue(1119)` — rows를 라인별 라운드로빈 분배 후 batch INSERT. **여기서 MMS/LMS 구분 없음**(msg_type=`row[3]`로 들어옴 — `M`/`L`/`S`).
- 호출: `direct-send-worker.ts:55` getCompanySmsTables → bulkInsertSmsQueue. (campaigns/journey도 동일 경로)

**구현 옵션 (다음 세션 brainstorming → 1개 확정)**:
1. **bulkInsertSmsQueue에서 msg_type별 라인 분리** — rows를 MMS(`M`) vs 문자(`L`/`S`)로 나눠, **문자는 그 순간 가장 한가한 라인(least-loaded)** 으로, MMS는 회사 라인으로. 문자가 MMS와 다른 라인을 타게.
2. **문자(LMS/SMS)를 bulk 전체 라인 least-loaded로** — 회사 전용 {7,8,9}가 MMS로 막혀도, 문자는 유휴 bulk 라인({1~6} 중 빈 곳)으로. 정산은 캠페인(`app_etc1`) 기준이라 라인 무관 = 안전. 라인 격리는 "동시발송 충돌방지"라 유휴 라인 사용은 충돌 없음.
3. **sms_line_groups에 msg_type 전용 라인 개념 추가** — MMS 전용/문자 전용 라인그룹(구조 변경 큼).

**least-loaded 큐깊이 측정 주의**: 적재마다 MySQL COUNT는 부하 → 짧은 캐시(수 초) 또는 라인별 미처리 수 근사치. `cancelled-queue-sweeper`/`expired-pending-sweeper` 같은 안전망 패턴 참고.

**6원칙 준수**: 발송·돈 영역. 실측 1건 시나리오(MMS+LMS 섞인 발송이 라인 분리되는지 + 기존 발송 회귀 0) 보고 후 구현. 라인 선택 로직(getNextSmsTable/getCompanySmsTables)은 CT라 7-1 프로세스(소비처 grep 전수).

**게이트웨이 답변과의 관계**:
- bind 늘릴 수 있으면 → 분리는 "추가 안전망"(병렬로 이미 빨라짐).
- bind 1개 고정이면 → 분리가 **필수**(문자 보호).
- 어느 쪽이든 한줄로 분리는 해두는 게 안전.

## 4. 이번 세션 미구현 / 남은 작업
- **F 한줄로 MMS/LMS 분리** (3장) — 다음 세션 구현.
- **게이트웨이 bind** (2-1) — 개발자 답변 대기, 서버 설정이라 한줄로 밖.
- 그 외 A/C/D/E/G는 코드 완료. (A/C/D 배포완료, E/G 배포 대기.)

## 5. 배포 명령어 (E·G·F-invalidate)
```
## 1. 로컬 PowerShell 푸시
tp-push "직접발송 빈열 매핑 fix(defval) + AI마케팅 주기 요일·날짜 선택 + 라인할당 캐시 무효화 보강"

## 2. 서버 SSH (Harold 직접) — G ALTER는 이미 실행됨
ssh administrator@58.227.193.62
cd /home/administrator/targetup-app && git pull

### backend (upload.ts·continuous-operator.ts·ai.ts·admin.ts·dm.ts·dm-section-renderer.ts) — ts-node라 빌드 없이 재시작
pm2 restart all

### frontend (NewSections·DmBuilderPage·AdminDashboard·ContinuousOperatorPage)
cd /home/administrator/targetup-app/packages/frontend && npm run build:safe
```
> backend는 ts-node 실행이라 `build:safe` 금지(OOM), `pm2 restart all`만.

## 6. 다음 세션 진입 명령어
```
지난 세션(2026-06-20) 핸드오프 읽고 시작:
- docs/superpowers/handoffs/2026-06-20-sms-debug-EFG-and-gateway-bind.md
- status/lessons/LESSONS_BACKEND.md (발송/라인그룹)
- status/OPS.md §6 QTmsg 발송 시스템 (Agent/bind)

1순위 = 게이트웨이 개발자 답변 확인(한 ID 동시 bind 가능 여부) → bind 방향 결정.
2순위 = F 한줄로 MMS/LMS 라인 분리 구현. brainstorming(옵션 1~3) → 설계 → 6원칙(발송·돈, 실측 1건) → 구현.
핵심: 한줄로 적재는 정상, 병목은 게이트웨이 단일 bind(bind_idx_cnt=1)에 MMS가 점유. 문자가 MMS에 안 막히게 라인 분리.
수정 전 승인. 발송 5경로 전수 점검.
```
