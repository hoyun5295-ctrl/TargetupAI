# 0913 세션 인계: 대행발송·싱크에이전트 적대검토 종결 · 비토 Agent §8 A4~A6 소스 반영 (2026-09-13 작성)

> 이 문서는 **Harold님이 실행할 순서와 명령**, 다음 세션이 이어받을 자리만 담는다. 사실·경위의 소유 문서는 아래 링크가 가진다.
> 착수 첫 명령은 **현재 상태 확인**이다(이 문서의 상태는 작성 시점 값).
> 명령마다 **실행 위치**를 적었다. `.62`·`.65` 호스트명이 둘 다 `invito`라 프롬프트 계정으로 구분한다. 명령은 한 번에 하나씩 실행하고 결과를 본 뒤 다음으로 간다.

## 0. 먼저 읽을 것

1. 이 문서 전체
2. [FEATURE-AGENCY-SEND.md](FEATURE-AGENCY-SEND.md) §2 불변 **24·25·26** · §4 "명단 크기" · §5 이력 끝 "적대검토에서 확정됐으나 고치지 않은 것"
3. [FEATURE-SYNC-AGENT.md](FEATURE-SYNC-AGENT.md) §2 불변 마지막 세 행 · **§10 첫 항목**
4. [BUGS.md](../status/BUGS.md) B-0912-3·4·5·6 (각 항목 끝 "실측" 줄)
5. 게이트웨이 작업일 때: [FEATURE-GW-SECURITY.md](bito-gateway/FEATURE-GW-SECURITY.md) §8

## 1. 이번 세션에서 한 것 (전부 미커밋 · 근거 = 세션 중 실행 출력)

| 축 | 무엇 | 소유 문서 |
|---|---|---|
| 싱크 인증 | 42703일 때만 옛 원문 쿼리(사전 컬럼 탐지 제거) · 관리자 키 API 3곳 컬럼 부재 503 | FEATURE-SYNC-AGENT §10 |
| 싱크 로그 | 0912 마스킹 정정이 만든 회귀 차단: axios 오류 순환 객체 무한 재귀(로그 호출이 예외 → 등록 실패 시 로컬 모드·오프라인 큐가 죽는 경로) · **요청 본문 `config.data`의 apiSecret 우회** · 오류는 허용 목록 필드만 · 인증 헤더 키 · 콘솔 출력 직렬화 실패 무시 · DB 드라이버 진단 필드 유지 · **에이전트 새 빌드 전이라 고객사 반영 0** | FEATURE-SYNC-AGENT §2 |
| 대행발송 이메일 | **회신번호 열 방식 반려를 없애고 화면과 같은 계약으로 받음**(접수 1건·고객별 번호) · 회신 메일에 "고객별 N종"·빈 행 제외 건수 · 명단 파싱 4회 → 1회(요청서는 시트만 읽음: 20만 행 4,174ms → 18ms 실측) · POP3 수신 O(n²) → 선형 | 불변 24·25 · B-0912-5·6 |
| 대행발송 발송 | 컬럼 탐지 실패 캐시 금지 · 시도 키 advisory lock + 동시 3개 슬롯(연결 없이 대기) + 같은 프로세스 중복 방지 + 잠금 연결 오류 수신자 · 발송 직전 재검증에 대표 번호 포함 · 저장 컬럼 없으면 접수 되돌림(503) | 불변 26 |
| 대행발송 화면 | 재접수가 고객별 번호를 나름(접수 창 안내) · 화면 접수도 고객별 번호 등록을 접수 때 확인 · 승인 링크 화면 "고객별 N종" · 원스텝 버튼 "접수하기" | 불변 24 |
| 비토 Agent §8 | A4 기본 호스트 3곳 `gateway.invalid` + 검사기 `invito\.local`(단어 `invito`는 안내서 9건 오탐으로 기각) · A5 마법사 TLS 기본 사용 · A6 `AllowDowngrade` 영구 유지 주석 | FEATURE-GW-SECURITY §8 · 게이트웨이 STATUS `0-G` |
| ★(2) 등재분 6건 정정(Harold 지시 "추천 6건으로 진행") | 대행 ⑤ 수신자 값 저장형(문자열 · 미리보기 = 발송 글자) · 대행 ⑦ 캠페인 생성 직전 DB 시각·소유권 판정 + **lock 복구가 시도 잠금·진행 중 시도를 존중**(적대검토에서 같은 뿌리로 두 번 올라와 구조로 고침 · 두 벌 발송·제시간 발송 누락·과금 중 캠페인 회수 경로 차단) · 싱크 ① 고객사 응답 6곳(목록·상세 2·생성·수정 2)에서 비밀값 컬럼 제외 · 싱크 ⑤ 시크릿 로그 전부 가림 · 싱크 ⑥ 행 식별값 가림(7자리 통째 · 8자리 이상 뒤 4자리 · 전각 숫자 포함) · 싱크 ⑩ DRY RUN 샘플 가림 | FEATURE-AGENCY-SEND 불변 25·26 · §5 끝 · FEATURE-SYNC-AGENT §10 |
| ★(3) 대행 두 벌 발송·수용 위험·범위 밖·등재분 전량 정정(Harold 지시 "대행발송은 완벽하게 · 남은 것조차 남지 않도록") | 대행 ⓔ 문안 수정·시각 변경 두 벌 발송 차단(시도 키 캠페인·진행 중 판정 + UPDATE 조건 셋) · ⓕ 상태 문장은 상태가 바뀐 때만 · 멈춘 시도 인수 트랜잭션 + 배관 활성화 소유권 재확인(접수 행 잠금 직렬화 · 임시 PG 실측) · 안내 대기 60초 상한 · 복구 표시 · 행·단계 격리 · 같은 단계 겹침 가드(B-0825-7) · 예약 도중 예외 뒤 살아 있는 캠페인 보존 · 대조·취소 판정 정리("이미 발송"에서 빼는 것은 preparing뿐) · staging 잔여 정리 · 회신번호 종류 표시·변경 때 재검증 · 엑셀 날짜 셀 벽시계 글자(불변 27) · 직접발송 키 기준 페이지 · 화면 접수 본문 상한 안내(413) · 메일 워커 컬럼 부재 메일만 넘김 · 싱크 DB 오류 값 가림(메시지 끝 확인) · ICU 없는 숫자 · 로그 요청 회전 파일·기준 시각 · 재발급 감사·토글 시크릿 유지 · 수정 차단 화면 버튼 숨김 | FEATURE-AGENCY-SEND 불변 26 끝·27 · §5 0913(3) · FEATURE-SYNC-AGENT §10 · BUGS B-0825-7 |

**★(3) 검증(마지막 실행)**: backend tsc 0 · vitest 282파일 4,398건 · frontend tsc 0 · frontend 안전 빌드 통과(로컬 · 청크 게이트 43건) · sync-agent tsc 0 · vitest 22파일 184건 · 멈춘 시도 인수×활성화 잠금 순서 = 임시 PostgreSQL 16 컨테이너(127.0.0.1 · 실측 후 삭제)에서 네 가지 순서 + 정상 활성화.

**★(3) 리뷰**: Codex 적대 1R(high 3 · medium 1: 멈춘 시도 인수 뒤 늦은 활성화 발송 · 슬롯 조기 반납 풀 고갈 · DB 값 가림 경계 · failed 캠페인 취소 오판정) → 전부 반영 · 2R(high 2 = 같은 뿌리 두 번째: 커밋 전 캠페인 INSERT·활성화 겹침 · 가림 끝 구문 오인) → **구조로 고침**(인수 트랜잭션 + 활성화 FOR SHARE 가드 · 끝 구문 규칙) · 3R(high 0 · 교착·재활성화 반례 없음 확인 · medium 1 = 가림 끝 구문 후퇴, 같은 뿌리 세 번째 → 메시지 끝 확인 규칙) · 4R(high 0 · 탐색 선형 확인 · medium 1 = 값 안에서 잘린 가짜 스택 줄을 믿음 → 임의 문자열의 스택 모양을 경계로 쓰지 않고, 로그 스택만 원본 Error.message 위치로 나눔) · 5R(high 0 · medium 1 = 생성 뒤 바뀐 메시지로 스택을 나누면 값이 남음 → 스택도 통째로 한 문장으로 가림) · 6R(high 0 · 보통 오류 회귀 없음 확인 · medium 1 = 합쳐진 오류 문장에서 앞 형식 치환이 뒤 값 시작 표식을 지움 → 원문에서 구간을 모아 합친 뒤 한 번에) · **7R approve(지적 없음) → 종결**. 대행 쪽은 3R부터 high 0(인수 트랜잭션·활성화 가드 반례·교착 없음 확인).

**검증(마지막 실행)**: backend tsc 0 · vitest 276파일 4,334건 · frontend tsc 0 · sync-agent tsc 0 · vitest 17파일 128건 · 게이트웨이 수정 패키지 go test 4개 통과 · 경계 검사기 계약 23건 · 공개자료 14개 파일 경계 통과.

**리뷰 이력**: Codex 적대 1R(대행 high 3 · 싱크 high 1·medium 1) → 2R(싱크 high 1 · 대행 high 2·medium 1) → 3R(high 1·medium 2) → 4R(high 1·medium 1) → 5R(high 1 부분 수용) → **6R·7R high 0** · 내부 적대검토 워크플로 1R(에이전트 85 · 확정 high 5종) → 2R(26 · high 0) → 3R(4 · medium 이상 0). 라운드마다 확정분 전량 반영.

### 1-1. 리뷰 종결 상태

- Codex 4R: high 1(DB 진단 자유 문장에 행 값) · medium 1(승인 화면 빈 행 번호) → 둘 다 반영
- Codex 5R: high 1(DB 오류 문장에 행 값) → **부분 수용**: 문장 안 이메일·휴대폰 번호 가림 · 문장 삭제는 불수용(현장 진단 회귀) · 남는 값은 수용 위험으로 FEATURE-SYNC-AGENT §10 등재
- Codex 6R: **high 0**(오류 문장 보존 판단을 high로 재지적할 근거 부족) · medium 3(번호 표기 누락·이메일 정규식 제곱 시간·자른 뒤 가림) → 전부 반영(sync-agent 124건 통과)
- Codex 7R: **high 0** · medium 1(`+82 (0)10` 표기 누락) → 반영
- **종결 판정**: Codex 6R·7R 연속 high 0, 6R부터 지적이 같은 부류(문장 속 번호 표기 범위)로만 이어져 리뷰를 닫았다. 내부 워크플로 3R medium 이상 0. 남은 medium 이하는 소유 문서 등재(FEATURE-AGENCY-SEND §5 끝 · FEATURE-SYNC-AGENT §10).
- 내부 적대검토 3R: **medium 이상 0** · low 6건은 소유 문서에 등재(FEATURE-AGENCY-SEND §5 끝 ⑦⑧ · FEATURE-SYNC-AGENT §10 ⑧⑨⑩)
- ★(2) 등재분 6건 정정 리뷰(라운드마다 Codex 적대 + 내부 워크플로를 함께 · 범위는 직전 라운드 수정 줄만):
  - 1R Codex high 2(마감 판정이 슬롯 대기 직후라 오래된 후보 목록·기존 캠페인 복구를 못 막음) · 워크플로 medium 1(국번 없는 번호) + 범위 밖 = 고객사 수정 응답 2곳
  - 2R Codex approve · 워크플로 medium 2(생성 직전 판정이 소유권을 안 봄 · 8~9자리 부분 가림)
  - 3R Codex medium 1 · 워크플로 medium 2 = **lock 복구가 살아 있는 시도를 무시**(같은 뿌리 두 번째 → 구조 수정: 복구 UPDATE 한 문장 안에서 시도 키 잠금 시도)
  - 4R medium 1(잠금 연결만 끊긴 경우) → 진행 중 시도도 복구가 봄 · 5R medium 1(시도 키 스냅샷) → **접수 id 수로 판단 · 바꾸기 직전 한 자리**
  - **6R Codex approve · 워크플로 medium 이상 0**(low 2 = 테스트 보강·주석의 창 크기 정정 반영) → 종결
  - 남은 것 = 수용 위험 2가지(FEATURE-AGENCY-SEND 불변 26 ③ 끝) · 범위 밖 발견(§2-6)

## 2. Harold님 실행 순서

### 2-0. 현재 상태 확인

**로컬 · 한줄로 저장소**
```bash
git status --short
```
기대 = 이번 세션 수정 파일(M)과 새 파일(??): `docs/2026-09-13-session-handoff.md` · `packages/backend/src/utils/__tests__/agency-dispatch-callback-guards.test.ts` · `packages/backend/src/utils/__tests__/pop3-client.test.ts` · `packages/backend/src/utils/db-column-probe.ts` 삭제(D).
★(3) 새 파일 추가: `packages/backend/src/utils/stage-guard.ts` · `stage-guard.test.ts` · `__tests__/agency-send-state-stuck.test.ts` · `__tests__/agency-worker-residuals.test.ts` · `__tests__/agency-lows-closure.test.ts` · `__tests__/sheet-date-cell.test.ts` · `__tests__/normalize-phone-country-code.test.ts` · `sync-agent/src/sync/error-text.ts` · `error-text.test.ts` · `sync-agent/src/setup/secret-display.guard.test.ts` · `sync-agent/src/normalize/normalize-phone.test.ts` · `custom-fields.test.ts` · `sync-agent/src/logger/tail.test.ts`.

### 2-1. 커밋·푸시

**로컬 · 한줄로 저장소**
```bash
tp-push "0913 대행발송·싱크에이전트 적대검토 종결 - 이메일 회신번호 열 방식 수용(접수 1건), 시도 키 잠금·동시 슬롯, 재접수·승인화면 고객별 번호, 명단 파싱 1회·POP3 선형, 싱크 인증 42703 한정·로그 마스킹 회귀 차단(허용 목록), 비토 §8 설계 / 등재분 6건 정정 - 캠페인 생성 직전 시각·소유권 판정과 lock 복구의 시도 잠금 존중(두 벌 발송·발송 누락 차단), 수신자 값 저장형, 고객사 응답 비밀값 제외, 싱크 시크릿·행 식별값·DRY RUN 로그 가림 / 대행 두 벌 발송·수용 위험·범위 밖·등재분 전량 정정 - 문안 수정·시각 변경 두 벌 발송 차단, 멈춘 시도 인수·안내 대기 상한·복구 표시·단계 겹침 가드, 엑셀 날짜 셀 벽시계 글자, staging 잔여 정리, 회신번호 종류 표시·재검증, 직접발송 키 기준 페이지, 싱크 DB 오류 값 가림·로그 요청 회전 파일·재발급 감사"
```

**로컬 · 게이트웨이 저장소**(`C:\Users\ceo\projects\bito-gateway` · 저장소 규칙상 대표님이 직접): 변경 파일 = `cmd/agent/main.go` · `internal/agent/onboarding/install_bundle.go` · `internal/agent/setup/wizard.go` · `internal/agent/setup/wizard_test.go` · `internal/agent/release/types.go` · `scripts/verify_customer_delivery_full_boundary.py` · `scripts/test_customer_delivery_full_boundary.py` · `status/STATUS.md`. **릴리즈 빌드는 하지 않는다**(다음 릴리즈에 합류).

### 2-2. 배포 (한줄로 운영 서버 · `administrator@invito` · [OPS §2-2](../status/OPS.md))

DDL 없음(`agency_send_recipients.callback`·`companies.api_secret_hash`는 0912에 실행완료).

```bash
cd /home/administrator/targetup-app && git pull
```
```bash
cd /home/administrator/targetup-app/packages/backend && npm run build:safe
```
```bash
cd /home/administrator/targetup-app/packages/frontend && npm run build:safe
```
```bash
pm2 reload targetup-backend
```
```bash
pm2 logs targetup-backend --nostream --lines 60
```
판정 = 기동 후 오류 스택 없음.

### 2-3. 배포 직후 실측 (한줄로 운영 서버 · `administrator@invito`)

**싱크 인증(이새 · 키가 화면에 찍히지 않게 파이프로)**
```bash
docker exec -i targetup-postgres psql -U targetup targetup -tAc "SELECT api_key || ' ' || api_secret FROM companies WHERE name = '이새에프앤씨'" | { read K S; curl -s -o /dev/null -w "HTTP %{http_code}\n" -H "X-Sync-ApiKey: $K" -H "X-Sync-Secret: $S" "https://hanjul.ai/api/sync/version?current_version=1.5.7"; }
```
기대 = `HTTP 200`.

**에이전트 접속 상태**
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT c.name, s.agent_version, s.updated_at, NOW() - s.updated_at AS 경과, (c.api_secret_hash IS NOT NULL) AS 해시전환 FROM sync_agents s JOIN companies c ON c.id = s.company_id ORDER BY s.updated_at DESC;"
```
판정 = 이새 `경과`가 1시간 이내면 동기화 복귀. 계속 늘면 고객사 서버에서 에이전트 재시작 필요(0912 23:30 KST 이후 미접속 · 서버 인증은 실제 키로 200 실측됨).

**설치된 에이전트 로그 업로드에 인증값 흔적이 있는가(값은 출력하지 않는다)**
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT c.name, s.agent_version, (s.config::text ILIKE '%x-sync-secret%') AS 헤더흔적, (s.config::text ILIKE '%apisecret%' OR s.config::text ILIKE '%api_secret%') AS 본문흔적 FROM sync_agents s JOIN companies c ON c.id = s.company_id;"
```
판정 = 둘 다 `f`면 서버 보관본에는 없다. `t`가 있으면 그 회사 키 재발급 대상(고객사 설치본 교체 일정과 함께 · 고객사 서버 로그는 서버에서 확인할 수 없다).

**★(3) 대조가 못 찾는 대행발송 캠페인이 이미 있는가(종전 ⓔ 경로 흔적 · 조회만)**
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT c.id, c.company_id, c.status, c.send_phase, c.created_at FROM campaigns c WHERE c.campaign_name LIKE '대행발송 %' AND c.created_at > NOW() - INTERVAL '30 days' AND c.staging_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agency_send_requests a WHERE a.dispatch_key = c.staging_id) ORDER BY c.created_at DESC;"
```
판정 = 0행. 행이 있으면 문안 수정·시각 변경이 시도 키를 비운 뒤 남은 캠페인이다(대조가 못 본다) → 결과를 가져온다(값 확인 뒤 처리 방법을 정한다 · 직접 UPDATE 금지).

**★(3) 배포 전 접수 중 숫자 저장값이 남은 진행 중 접수(ⓓ · 조회만)**
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT COUNT(DISTINCT r.request_id) AS 접수수 FROM agency_send_recipients r JOIN agency_send_requests a ON a.id = r.request_id WHERE a.status NOT IN ('sent','expired','cancelled','test_failed') AND EXISTS (SELECT 1 FROM jsonb_each(r.vars) e WHERE jsonb_typeof(e.value) = 'number');"
```
판정 = 0이면 해당 없음. 1 이상이면 그 접수는 옛 저장값이다(지수 범위 숫자가 있을 때만 미리보기와 발송 글자가 갈린다 · 종결되면 자연히 0).

**★(3) 직접발송 staging 키 기준 페이지 전제(id 유일 · 조회만)**
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'campaign_send_staging';"
```
판정 = `id`의 PRIMARY KEY(유일) 인덱스가 있다. 없으면 배포를 멈추고 결과를 가져온다.

### 2-4. 원문 시크릿 제거 (조건 충족 시 · 되돌릴 수 없음)

**선행 조건**: §2-2 배포 완료 · §2-3 이새 200 · §1-1 리뷰 종결.
- ⛔ R2 이후에는 **백엔드를 0912 이전 코드로 되돌리면 모든 에이전트가 401**이다(옛 코드는 원문으로만 인증한다).
- 원문 백업 테이블은 만들지 않는다: 백업이 곧 평문 유출이고, 해시만으로 인증되므로 되돌릴 대상이 없다. 키를 잃은 회사는 재발급으로 복구한다(발급 시 1회 노출).

**R0 · 선행 확인(조회만)**
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT current_setting('server_version_num')::int AS pg버전, (SELECT COUNT(*) FROM companies WHERE api_secret IS NOT NULL) AS 원문, (SELECT COUNT(*) FROM companies WHERE api_secret_hash IS NOT NULL) AS 해시, (SELECT COUNT(*) FROM companies WHERE api_secret IS NOT NULL AND api_secret_hash IS NOT NULL AND api_secret_hash <> encode(sha256(convert_to(api_secret, 'UTF8')), 'hex')) AS 불일치, (SELECT COUNT(*) - COUNT(DISTINCT api_key) FROM companies WHERE api_key IS NOT NULL) AS 중복키, (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'companies' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%(api_key)%') AS 유일인덱스;"
```
판정 = `pg버전` 110000 이상 · `불일치` 0 · `중복키` 0. 하나라도 어긋나면 멈추고 결과를 가져온다. `유일인덱스` 0이면 제거와 별개로 유일 인덱스 추가를 판단한다(§3).

**R1 · 해시 백필(UPDATE)**
- 영향: `companies.api_secret_hash` · 대상 = 원문이 있고 해시가 비어 있는 행(R0의 원문 − 해시 근처 · 0912 기준 약 82행)
- 변경 전 NULL → 변경 후 원문의 sha256 hex(`utils/secret-hash.ts` `hashSecret`과 같은 값)
- 의도 = 한 번도 접속하지 않은 키도 해시로 인증되게 한다
- 되돌리기 불필요(원문이 남아 있어 인증 결과가 같다)
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "UPDATE companies SET api_secret_hash = encode(sha256(convert_to(api_secret, 'UTF8')), 'hex') WHERE api_secret IS NOT NULL AND api_secret_hash IS NULL;"
```
기대 = `UPDATE N`(R0의 원문 − 해시).

**R1 확인**
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT COUNT(*) FILTER (WHERE api_secret IS NOT NULL AND api_secret_hash IS NULL) AS 해시없음, COUNT(*) FILTER (WHERE api_secret IS NOT NULL AND api_secret_hash <> encode(sha256(convert_to(api_secret, 'UTF8')), 'hex')) AS 불일치 FROM companies;"
```
기대 = `0 | 0`.

**R2 · 원문 제거(UPDATE · 되돌릴 수 없음)**
- 영향: `companies.api_secret` · 대상 = 원문과 해시가 **일치하는 행만**(불일치 행은 건드리지 않는다)
- 변경 전 원문 → 변경 후 NULL · 의도 = DB에 원문 시크릿 0
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "UPDATE companies SET api_secret = NULL WHERE api_secret IS NOT NULL AND api_secret_hash = encode(sha256(convert_to(api_secret, 'UTF8')), 'hex');"
```

**R3 · 확인**: §2-3의 이새 인증 명령은 DB 원문을 읽으므로 R2 뒤에는 쓸 수 없다. 원문 0과, 이새 에이전트가 R2 뒤에도 계속 접속하는지로 확인한다.
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT (SELECT COUNT(*) FROM companies WHERE api_secret IS NOT NULL) AS 원문잔존, (SELECT MAX(updated_at) FROM sync_agents s JOIN companies c ON c.id = s.company_id WHERE c.name = '이새에프앤씨') AS 이새_마지막통신;"
```
기대 = 원문잔존 0 · 이새 마지막 통신이 R2 이후에도 계속 갱신(1시간 주기).

### 2-5. 운영 실측 (화면·메일 · Harold님)

| 대상 | 실측 | 기대 |
|---|---|---|
| B-0912-5 원스텝 | 회신번호 열(여러 번호) 요청서를 화면 원스텝으로 접수 | 목록 1건 · 담당자 테스트·승인 요청 1회 · 승인 링크 화면 "고객별 N종" · 발송 결과에서 수신자별 발신번호 |
| B-0912-5 이메일 | **같은 파일을 이메일로** 접수 | 반려 없이 1건 · 회신 메일 "회신번호: 고객별 N종" · 빈 행 있으면 제외 건수 |
| B-0912-5 재접수 | 위 건을 취소 후 "같은 내용으로 다시 접수" | 접수 창 "이전 접수의 고객별 회신번호 N종" 안내 · 접수 성공 |
| B-0912-6 | 3만 초과 명단 이메일 접수 | 반려 없음 · 인원 = 파일 · 50MB 근처 메일이 메일 서버를 통과하는지 |
| B-0912-3·4 MDM | 문자 제목 수정 발송 · 타겟 조건 직접 선택 | 수신함 제목 = 입력값 · 대상 수 일치 |
| ★(2) 싱크 ① | 슈퍼관리자 고객사 목록·상세 열기 → 수정 저장 → 싱크 키 화면 열기 | 화면·저장 종전과 같음(응답에서 비밀값 컬럼만 빠짐 · 화면은 그 값을 쓰지 않는다) |
| ★(2) 대행 ⑤ | 숫자·날짜 항목이 든 명단으로 접수 → 상세 미리보기와 담당자 테스트 문자, 실제 수신 문자 글자 대조 | 세 글자가 같음 |
| ★(3) 날짜 셀 | 요청서 보낼 시각을 엑셀 날짜 서식 셀(예 2026-09-20 14:30)로 적어 원스텝 접수 · 명단에 날짜 서식 열을 넣어 문안에 사용 · 보낼 시각을 날짜만 적은 요청서도 한 번 | 확인 화면 시각 14:30 그대로 · 미리보기·테스트·실제 문자에 엑셀에 보이던 날짜 글자(T·Z 없음) · 날짜만 적은 건은 "보낼 시각을 읽지 못했습니다" 반려 |
| ★(3) 회신번호 표시 | 고객별 회신번호 열 명단으로 접수 → 목록 · 상세 미리보기 · 슈퍼관리자 내역 상세 | 세 곳 모두 "고객별 N종"(한 종류면 그 번호) |
| ★(3) 수정 차단 | 예약 완료(queued) 접수 상세 열기 | 고치기·바꾸기 버튼이 없다 |
| ★(3) 싱크 키 | 슈퍼관리자 싱크 키 재발급 → 바로 사용 토글 → 시스템 관리 감사 로그 | 토글 뒤에도 시크릿이 보인다 · 감사 로그 "싱크 키 재발급 · 새 키 끝자리 NNNN" |

### 2-6. 판단 대기 (Harold님)

- **메일 워커 별도 프로세스 분리**: 명단 파싱 1회분(20만 행 약 4.5초 실측)만큼 같은 프로세스의 API·발송 워커가 멈춘다. 없애려면 PM2 앱을 하나 더 두는 운영 변경이 필요하다. 추천 = 100만 건 요청이 실제로 오기 전까지 보류, 첫 대형 접수 전 분리.
- 하이웍스 첨부 상한(코드 50MB 가정).
- `companies.api_key` 유일 인덱스(R0 결과가 0이면 · DDL).
- 싱크에이전트 새 빌드 시점(마스킹 수정은 새 빌드부터 고객사에 반영 · 1.5.7은 원격 업데이트 불가라 신규 설치).
- 비토 §8 A1 복구 루트 개인키 오프라인 분리(root 운영) · A2 코드서명 인증서.
- ★(3) ★(2)의 범위 밖 발견(대행 ⓐⓒⓔⓕ · 싱크 ⓐⓑⓒⓓⓔ) · 수용 위험(대행 불변 26 · 싱크 DB 오류 문장·ICU 없는 숫자·아랍 숫자) · 등재분(대행 ①②③④⑥⑧ · 싱크 ②③④⑦⑧⑨)은 **전량 닫았다**(§1 ★(3) 행 · 소유 문서). 판단 대기로 남긴 것 없음.

## 3. 하지 말 것

- 대행발송 접수를 회신번호로 쪼개지 않는다 · 이메일에서 회신번호 열 방식을 다시 막지 않는다(불변 24).
- 같은 파일을 두 번 파싱하는 경로를 새로 만들지 않는다 · 행수 상한을 되살리지 않는다(불변 25).
- 시도 키 잠금 연결 상한을 "넘기기(approved로 되돌리기)"로 바꾸지 않는다(불변 26 · 적재 마감 누락).
- ★(2) 캠페인 생성 직전 판정을 적재 여유(10분) 기준으로 바꾸거나, 기존 시도 캠페인 확인보다 앞에 두거나, 슬롯 대기 직후로만 옮기지 않는다 · 그 판정에서 소유권 조건을 빼지 않는다(불변 26).
- ★(2) lock 복구를 잠금 조건 없는 `setStatus`로 되돌리지 않는다 · 진행 중 접수 확인(`inFlightRequests` · 접수 id별 수)을 빼거나 `dispatch_key` 기준으로 바꾸지 않는다 · 시도와 복구의 잠금 이름을 따로 적지 않는다(`ATTEMPT_LOCK_PREFIX`).
- ★(2) 수신자 `vars`를 원래 타입 그대로 넣지 않는다(`toStoredVars` · 불변 25 · 미리보기와 발송 글자가 갈린다).
- ★(2) 싱크 행 식별값 가림에 공용 `maskPhone`을 다시 쓰지 않는다(8~9자리 번호가 거의 그대로 남는다).
- 싱크 로그에 axios `toJSON`을 통째로 쓰지 않는다(요청 본문 문자열이 마스킹을 우회한다).
- 원문 시크릿 제거(§2-4) 뒤, 그리고 **어느 회사든 싱크 키를 한 번이라도 재발급한 뒤**에는 백엔드를 0912 이전으로 되돌리지 않는다(재발급 키는 원문이 없어 옛 코드에서 401 · FEATURE-SYNC-AGENT §10 ②).
- ★(3) 대행: 엑셀을 `cellDates: true`로 읽지 않는다(불변 27) · 멈춘 시도 인수 조건에서 예약 시각 경과를 빼지 않는다 · 복구 표시를 finally 밖에서 끄지 않는다 · 문안 수정·시각 변경의 판정과 UPDATE 사이에 대기를 넣거나 UPDATE 조건 셋(캐시 빔·시도 키 캠페인 부재·잠금 빔)을 빼지 않는다 · tick 겹침 가드를 tick 전체 가드로 바꾸지 않는다 · 화면 접수 본문 상한을 올리지 않는다(API 힙) · 직접발송 워커 청크 조회를 OFFSET으로 되돌리지 않는다 · 대조의 staging 정리에서 잠금 조건을 빼지 않는다 · 멈춘 시도 인수를 트랜잭션 없는 한 문장으로 되돌리거나 대행 활성화 조건(`activationGuard`)에서 FOR SHARE를 빼지 않는다 · 멈춘 시도의 슬롯을 시간으로 먼저 반납하지 않는다 · "이미 발송" 판정에서 preparing 말고 다른 캠페인을 빼지 않는다(불변 26 끝).
- ★(3) 싱크: DB 오류 문장을 통째로 지우지 않는다(값 자리만 가린다) · `logs/.masked-since`를 재시작마다 덮어쓰지 않는다.
- 비토: 검사기에 회사명 단독 `invito`를 넣지 않는다(공개 안내서 오탐) · `AllowDowngrade` 필드를 지우지 않는다 · `init-authority` 운영 중 재실행 금지.

## 4. 다음 세션 진입

**한줄로 세션** (작업 디렉터리 `C:\Users\ceo\projects\targetup`)
```text
0913 인계 이어가자. docs/2026-09-13-session-handoff.md 먼저 정독하고 §2-0 현재 상태 확인부터 시작해
```

**비토 게이트웨이 세션** (작업 디렉터리 `C:\Users\ceo\projects\bito-gateway`)
```text
게이트웨이 보안 §8 이어가자. 한줄로 저장소 docs/bito-gateway/FEATURE-GW-SECURITY.md §8 정독하고 A1 복구 키 분리 착수 전 현재 상태 확인부터
```
