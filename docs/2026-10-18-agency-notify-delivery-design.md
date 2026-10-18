# 대행 안내 문자 전달 보장 설계 초안 (2026-10-18)

> 상태 = **설계 초안 · 코드 0 · DDL 0 · Harold님 판단 대기**. 출발 = [마케팅플래너 v2 설계서](2026-10-18-planner-v2-design.md) §8 · §9(Codex D 4R 지적 「링크 취소 결과 문자 0회」 → 「대행 안내 전체가 한 번 시도 계약」으로 불수용 · 5R 에서 타당 판정 · 「정확히 1회는 발송함 · 재시도 · 큐 적재 멱등이 함께 필요」).
> 상설 = [FEATURE-AGENCY-SEND](FEATURE-AGENCY-SEND.md). 선례 = [B-0830-1](../status/BUGS.md)(충전 승인 통보 발송함 불수용 · 「유실 창 밀리초 · 출하 조건 아님」 → 대신 적재 건수 검사 + `notify_failed` 이력).

## 0. 축 대조

| 접수 | 이 설계가 닫는가 |
|---|---|
| 일시 장애에 안내 문자 0통 · 재시도 없음 | §4 A |
| 재시도하면 같은 문자가 두 번 갈 수 있다(큐 적재 멱등 없음) | §4 A 키 · 「결과 모름」 확인 |
| 같은 안내를 두 곳이 보내는 경합(라우트 · 워커 F) | §4 A 안내 키 UNIQUE |

범위 밖 = 테스트 문자(`insertTestSmsQueue` · 다른 함수) · 다른 도메인 안내(충전 승인 · 여정 · 자동마케팅 · 시스템 경보 · 같은 계약이지만 이번 접수가 아니다).

## 1. 현황 (코드 확인 · 2026-10-18)

- **관문 하나** = `utils/agency-send-worker.ts` `notifyManager`(213행). 대행 안내는 전부 이 함수를 지난다. 하는 일 = 인증 라인 테이블 한 곳(`getAuthSmsTable`)에 `bulkInsertSmsQueue` 로 적재 · 60초 상한(`withNotifyTimeout`) · 적재 수 < 기대 수 · 시간 초과 · 예외면 `agency_send_events` 에 `notify_failed` 를 남기고 끝(재시도 없음 · 상태 전이는 계속).
- **적재 행 모양** = `[dest_no, call_back, msg_contents, msg_type, title_str, sendreq_time, app_etc1 = null, app_etc2 = company_id, file1~3]` → `sms-queue.ts:1626` INSERT. **`app_etc1` 이 비어 있다**(캠페인 발송은 캠페인 id · 테스트는 `'test'`).
- **시간 초과의 뜻** = 「결과 모름」. 주석 그대로 「늦게 적재돼 도착할 수는 있다(다시 보내지 않으므로 두 번 가지 않는다)」(`agency-send-worker.ts:187-191`). 지금 계약이 중복 0 을 지키는 방법 = 재시도 0.
- **호출부 20곳**(grep `notifyManager(`):

| 묶음 | 자리 | 제목 | 중요도 |
|---|---|---|---|
| 행동 요청 | worker 507 · 545 · 580 · 731 · 750 · 782 · 1057 · 1485 · 1914 · 1924 | 문안 확인 · 시각 확인 · 승인 요청 · 재승인 요청 · 확인 요청 | 높음 — 못 받으면 승인이 안 나 24시간 만료까지 그대로 선다 · 마감이 있다 |
| 결과 통보 | worker 714 · 745 · 1335 · 1344 · 1526 · admin 6730 | 예약 취소 · 미발송 · 링크 취소 결과 · 운영 취소 | 중간 — 상태는 화면에 맞게 남는다 |
| 보안 영수증 | agency-approve 152 · 194 | 링크 승인 · 링크 조작(취소 · 시각 · 맞춤법) | 높음 — 링크가 새서 남이 눌렀을 때의 유일한 발각 경로 |

- **선례**: ① 메일 접수 원장 `agency_send_email_intake` 의 회신 = `reply_status`(pending · sent · rejected · unknown · skipped) + `reply_attempts` 상한 + 24시간 창 재시도 패스(`agency-send-mail-worker.ts` `retryPendingReplies` · unknown 도 다시 보낸다 = 메일은 중복을 받아들였다) ② `system_alert_state`(dedup_key PK · 쿨다운 · 재시작 내성) ③ B-0830-1 불수용(발송함은 출하 조건 아님).

## 2. 실패 모양

| # | 모양 | 지금 | 빈도 |
|---|---|---|---|
| a | MySQL 적재 오류(배치 실패 · 큐 CT 가 삼키고 0 반환) | `notify_failed`(inserted < expected) · 0통 | **미검증 → §3 실측** |
| b | 적재 60초 초과 | `notify_failed`(timeout) · 늦게 도착할 수 있음 | 미검증 → §3 |
| c | 알리기 전 PG 조회 실패(예: `notifyLinkCancelOutcome` 의 행 조회) | 0통 · `notify_failed` 도 없다(조회가 먼저 실패) | 미검증 |
| d | 상태 커밋 뒤 · 알리기 전 프로세스 종료(pm2 재시작) | 0통 · 기록 없음 | 배포 · 재시작 때만 |
| e | 같은 안내를 두 곳이 보냄 | 1018 v2 에서 「확정 CAS 이긴 쪽만」으로 막음(링크 취소 결과만) | — |

## 3. 실측 먼저 (측정 후 처방 · 착수 판정 기준)

서버(.62) 에서 Harold님 실행 — 최근 12주 `notify_failed` 주별 수와 사유:

```bash
docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "SELECT date_trunc('week', created_at)::date AS wk, COUNT(*) AS n, COUNT(*) FILTER (WHERE payload->>'error' = 'timeout') AS timeouts, COUNT(*) FILTER (WHERE payload ? 'inserted') AS short_inserts, COUNT(*) FILTER (WHERE payload->>'kind' = 'manager-test') AS test_msgs FROM agency_send_events WHERE kind = 'notify_failed' AND created_at > NOW() - INTERVAL '84 days' GROUP BY 1 ORDER BY 1 DESC;"
```

**실측 1018(Harold님 실행) = 84일 `notify_failed` 0행**(테스트 문자 실패 포함 0) · **분모 = 같은 기간 접수 83건 · 승인 50건**(접수마다 안내 최소 1통 = 시도 83회 이상에 실패 기록 0).
**판정 = 착수하지 않음(1018 · B-0830-1 과 같은 결론 · 이 문서는 초안으로 보존)**. 미검증으로 남는 것 = 기록이 안 남는 c · d 모양의 크기 · 적재 건수 검사가 0830 에 들어가 84일 창 앞 약 5주의 「일부 미적재」는 기록되지 않았을 수 있다. 다시 열 조건 = `notify_failed` 가 12주 2건 이상 · 또는 담당자가 안내를 못 받았다는 접수.

판정: **안내(테스트 제외) 실패가 12주에 0~1건이면 B-0830-1 판단 그대로 착수하지 않는다**(기록 유지 · 0건은 안전 증거가 아니라 「지금 크기」의 근거). 2건 이상이거나 timeout 이 섞여 있으면 §4 A 착수를 추천한다. ⚠ c · d 는 이 SQL 에 잡히지 않는다(기록이 안 남는 모양) — 0건이어도 c · d 크기는 미검증이다.

## 4. 선택지

| | A 전용 발송함 표 + 재시도 패스 + 큐 키 | B 접수 이력 표를 발송함으로 | C 관문 안 즉시 재시도 1회 + 큐 키 |
|---|---|---|---|
| 닫는 모양 | a · b · c · d · e | a · b | a(짧은 끊김) · b 일부 |
| DDL | 표 1개(배포 뒤 · 없으면 옛 동작) | 0 | 0 |
| 중복 방지 | 안내 키 UNIQUE + 「결과 모름」은 큐에서 키 확인 뒤에만 다시 | 반쪽(이력 반조인) | 큐 키 확인 |
| 위험 | 표 하나 · 패스 하나 · 문안 보관(링크 포함 · 보존 14일 뒤 삭제 · API 노출 0) | **로그인 화면 API 가 이력을 payload 째 돌려준다**(`routes/agency-send.ts:565-568` · `admin.ts:6664`) → 담당자별 승인 링크 문장이 그 접수를 보는 사람에게 샌다 · 이력 표가 커질수록 반조인 비용 | 프로세스가 죽으면 끝 · 재시도가 요청 처리 시간을 늘린다 |
| 코드 | `notifyManager` 한 곳 + 패스 1 + `sms-queue` 키 조회 1 | 같은 정도 + 화면 노출 차단 | `notifyManager` 한 곳 |

**추천 = A**(§3 실측이 착수 기준을 넘을 때). 이유 = 관문이 이미 한 곳이라 호출부 20곳을 건드리지 않고 다섯 모양을 다 닫는다 · 「결과 모름」을 큐 키로 확인해 지금의 「중복 0」 계약을 잃지 않는다 · 메일 회신 재시도와 같은 꼴(같은 도메인 선례). B 는 노출 근거로 제외 · C 는 실측이 a 만 보일 때의 축소안.

## 5. A 상세 (초안 · 미검증 표시 = ※)

### 5-1. 표 `agency_notify_outbox` (※ 신규 · information_schema 확인 뒤에만 코드)
`id uuid PK DEFAULT gen_random_uuid()` · `request_id uuid NOT NULL REFERENCES agency_send_requests(id) ON DELETE CASCADE` · `notice_key varchar(120) NOT NULL` · `phone varchar(20) NOT NULL` · `title varchar(60) NOT NULL` · `body text NOT NULL` · `callback varchar(20) NOT NULL` · `msg_type char(1) NOT NULL` · `company_id uuid NOT NULL` · `status varchar(12) NOT NULL DEFAULT 'pending'`(pending · sent · unknown · failed · expired) · `attempts int NOT NULL DEFAULT 0` · `next_attempt_at timestamptz NOT NULL DEFAULT NOW()` · `expires_at timestamptz NOT NULL` · `last_error varchar(200)` · `created_at` · `sent_at`.
UNIQUE `(notice_key, phone)` = 같은 안내 · 같은 번호는 한 행(두 곳이 동시에 넣어도 하나 · e). 인덱스 `(status, next_attempt_at)`.

### 5-2. 흐름
1. `notifyManager(opts)` 에 `noticeKey?` 를 더한다(없으면 매번 새 키 = 지금과 같은 한 번짜리). 번호마다 `INSERT … ON CONFLICT (notice_key, phone) DO NOTHING RETURNING id` → 새로 들어간 행만 바로 한 번 보낸다(지금 속도 그대로).
2. 적재할 때 `app_etc1 = 'an:' || 행 id` 를 싣는다 → 큐에서 이 안내를 찾을 수 있다.
3. 결과: 적재 1 = `sent` · 적재 0 · 예외 = `pending` + 다음 시각 · **시간 초과 = `unknown`**.
4. 워커 tick 안 재시도 패스(겹침 가드 · 한 번에 20행): `pending` 은 다시 보낸다 · **`unknown` 은 먼저 큐(인증 라인 LIVE + 이번 달 · 지난달 LOG)에서 `app_etc1 = 'an:<id>'` 를 센다 → 있으면 `sent` · 없을 때만 다시 보낸다**. 간격 1 · 2 · 5 · 10 · 30분 · 5회 넘으면 `failed` + 시스템 경보 1회(`sendSystemAlert` dedup = 접수 id).
5. `expires_at` 지난 행 = `expired`(보내지 않는다): 행동 요청 = 그 안내의 마감(승인 마감 `approvalDeadline` · 보낼 시각) · 결과 통보 · 보안 영수증 = 만든 뒤 24시간.
6. 보존 = `sent` · `expired` · `failed` 14일 뒤 삭제(본문에 링크 주소가 있다 · 어떤 API 도 이 표를 읽지 않는다 · 화면은 지금처럼 `notify_failed` 이력만).
7. 표가 없으면(DDL 전 · 42P01) = 지금 동작 그대로(바로 한 번 · 실패 = `notify_failed`).

### 5-3. 안내 키 규칙 (두 곳이 같은 키를 만들어야 e 가 닫힌다)
- 링크 취소 결과 = `cancel-result:<접수 id>:<취소를 잡은 revision>`(라우트 · 워커 F 둘 다 같은 값 · 1018 v2 의 「이긴 쪽만」 분기를 이 키로 대체할 수 있다)
- 승인 요청 · 재승인 요청 = `approve-req:<접수 id>:<content_version>:<approval_requested_at>`
- 만료 = `expired:<접수 id>:<revision>` · 링크 영수증 = `link-<op>:<접수 id>:<revision>`
- 그 밖 = 키 없음(지금처럼 한 번짜리 · 단 재시도는 받는다)

## 6. 영향표 (grep 근거 · ※ = 미검증)

| 소비처 | 읽는 것 | 영향 |
|---|---|---|
| `notifyManager` 호출 20곳 | 반환 void | 없음(`noticeKey` 는 선택 인자) |
| 청구 · 사용량 `send-usage-aggregation.ts` | `app_etc1 IN (회사 run · 캠페인 id)` · `app_etc1 = 'test'` | 없음 — `'an:…'` 은 어느 목록에도 안 든다 |
| 통계 `stats-aggregation.ts:447 · 496` | `app_etc1 IN (…)` | 없음(같은 이유) |
| 발송 결과 · 예약 취소 `campaigns.ts` · 슈퍼관리자 상세 `admin.ts:3555` | `app_etc1 = 캠페인 id` | 없음 |
| 고객 타임라인 `customer-timeline.ts:357 · 889` | `dest_no + app_etc2` | 없음(바꾸지 않는 칸) |
| QTmsg 에이전트 | `app_etc1` 을 그대로 LOG 로 옮긴다 ※ | ※ `app_etc1` 칸 길이 · 문자 제한(키 39자) — §7 확인 SQL |
| 화면 `AgencyEventLog` | `notify_failed` 문장 | 없음(재시도 끝 `failed` 일 때만 지금처럼 남긴다) |

## 7. DB 확인 (코드 전에 · Harold님 실행)
1. 표가 없는지(PG): `SELECT table_name FROM information_schema.tables WHERE table_name = 'agency_notify_outbox';` → 0행이어야 한다.
2. `app_etc1` 길이(MySQL · OPS §1 = 직접 접속 거부 → 백엔드 접속): 서버 `packages/backend` 에서 `mysqlQuery("SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'SMSQ_SEND_11' AND COLUMN_NAME IN ('app_etc1','app_etc2')")` (FEATURE-BRAND-CAROUSEL §3 의 ts-node 모양). 인증 라인 테이블 이름은 `sms_line_groups` group_type 'auth' 값(없으면 SMSQ_SEND_11).
3. DDL(배포 뒤 · `SET lock_timeout='3s'`) = §5-1 그대로 `CREATE TABLE IF NOT EXISTS` + UNIQUE + 인덱스.

## 8. 시험 (seam)
- 순수: 재시도 간격 · 만료 시각(종류별) · 안내 키 만들기 · 상태 전이표(pending → sent · unknown → sent(키 있음) · unknown → 재전송 · 5회 → failed).
- 관문: 같은 키 두 번 = 한 행 · 적재 0 = pending · 시간 초과 = unknown · 표 없음 = 옛 동작(지금 시험 그대로 통과).
- 재시도 패스: unknown + 큐에 키 있음 = 다시 안 보냄 · 없음 = 한 번 보냄 · 만료 = 안 보냄.
- 계약: `app_etc1` 을 읽는 집계 SQL 이 `'an:'` 행을 세지 않는다(위 영향표 자리 문자열 고정).

## 9. 실측 1건 (배포 뒤)
사내 회사 대행 접수 1건 → 승인 요청 안내 → PG `agency_notify_outbox` 그 행 `sent` · MySQL 인증 라인에 `app_etc1 = 'an:<그 id>'` 1행 · 담당자 휴대폰 1통. 재시도는 운영에서 일부러 만들지 않는다(시험이 맡는다).

## 10. 열린 질문
- 착수 여부 = §3 실측 뒤 Harold님 판단(B-0830-1 과 같은 축 · 같은 크기면 같은 결론이 맞다).
- 다른 도메인 안내(충전 승인 · 여정 · 자동마케팅 · 시스템 경보)도 같은 관문으로 모을지 = A 가 대행에서 실측된 뒤 별건.
