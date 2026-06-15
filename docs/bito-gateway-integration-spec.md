# 한줄로 ↔ 비토 게이트웨이 연동 명세 — SMSQ_SEND_13

> **대상**: 비토 게이트웨이 개발팀
> **버전**: v1.0 (2026-06-15)
> **목적**: 한줄로 발송 큐 `SMSQ_SEND_13`을 비토 Agent가 polling·매핑하여 비토 Gateway로 발송하고, 결과를 다시 기록하기 위한 인터페이스 규격

---

## 1. 연동 구조

```
한줄로 백엔드
  → SMSQ_SEND_13 INSERT (status_code = 100, 대기)
  → 비토 Agent polling
  → 비토 Gateway 전송 → 중계사 route 발송
  → 결과 REPORT 수신
  → 비토 Agent가 같은 row UPDATE (status_code / 결과시각 / 통신사)
  → 한줄로가 status_code로 성공·실패 집계
```

- **DB**: MySQL `smsdb`, 테이블 `SMSQ_SEND_13` (기존 `SMSQ_SEND_12`와 **동일 스키마**)
- 한줄로는 기존 발송 큐 규격 그대로 INSERT하며 **변경하지 않습니다.** 비토 Agent가 `agent-config.yaml`의 `field_map` / `status_values` / `msg_type_values`로 이 스키마에 **매핑**합니다. (한줄로 싱크에이전트가 고객사 DB 컬럼을 매핑하는 것과 동일한 방식)

## 2. 픽업 조건 (비토 Agent polling)

- `status_code = 100` **AND** `sendreq_time <= NOW()` 인 row만 픽업합니다.
- `sendreq_time`은 예약발송 시 미래 시각이 들어갑니다 → 그 시각 이전에는 픽업하면 안 됩니다(예약발송 보호).

## 3. 컬럼 명세 (field_map 작성 기준)

| 컬럼 | 타입 | 의미 | 방향 |
|------|------|------|------|
| `seqno` | int PK AUTO_INCREMENT | row 고유번호 (= 비토 seq 키) | 한줄로 생성 |
| `dest_no` | varchar(20) | 수신번호 | 읽기 |
| `call_back` | varchar(20) | 발신번호 | 읽기 |
| `msg_contents` | mediumtext | 메시지 본문 | 읽기 |
| `title_str` | varchar(200) | LMS/MMS/알림톡 제목 | 읽기 |
| `msg_type` | varchar(10) | **S=SMS / L=LMS / M=MMS / K=알림톡** | 읽기 |
| `sendreq_time` | datetime | 발송요청시각 (픽업 기준) | 읽기 |
| `sender_code` | varchar(9) | 발신사업자 식별코드 | 읽기 |
| `status_code` | int | 상태/결과 (§4 참조) | 한줄로 `100` INSERT → **비토 결과 UPDATE** |
| `mob_company` | varchar(10) | 통신사 (11=SKT / 16=KT / 19=LGU+) | 비토 UPDATE |
| `mobsend_time` | datetime | 발송완료시각 | 비토 UPDATE |
| `repmsg_recvtm` | datetime | 결과수신시각 | 비토 UPDATE |
| `app_etc1` | varchar(50) | **한줄로 결과·정산 매칭 키 — UPDATE 시 변경/삭제 절대 금지** | 읽기·보존 |
| `app_etc2` | varchar(50) | companyId (추적용) | 읽기 |
| `file_name1`~`file_name5` | varchar(120) | MMS 첨부 파일명 | 읽기 |
| `k_template_code` | varchar(30) | 알림톡 템플릿코드 | 읽기 |
| `k_button_json` | varchar(1024) | 알림톡 버튼 JSON | 읽기 |
| `k_etc_json` | varchar(1024) | 알림톡 강조표기/부가정보 | 읽기 |
| `k_next_type` / `k_next_contents` | varchar(1) / text | 알림톡 실패 시 대체발송(SMS/LMS) 타입·본문 | 읽기 |
| `k_oriseq` | varchar(20) | 대체발송 시 원본 seqno | 비토 |
| `rsv1` | varchar(10) | 예약 플래그 (기본 `'1'`) | 읽기 |
| `bill_id` | varchar(40) | 과금/추적 식별자 | 읽기 |
| `msg_instm` | datetime | 입력시각 | 한줄로 생성 |

## 4. status_code 체계 (★ 가장 중요)

한줄로는 `status_code`(int) **하나로만** 성공·실패·대기를 집계합니다. 비토 Agent는 결과를 반드시 아래 값으로 UPDATE해야 합니다.

| 상태 | status_code |
|------|------|
| 대기 / 발송 진행 중 (claim·sent 포함) | **100** |
| SMS 성공 | **6** |
| LMS 성공 | **1000** |
| 알림톡 성공 | **1800** |
| 알림톡 실패 → SMS/LMS 대체 성공 | **7830 / 7831** |
| 실패 | 해당 실패코드 (아래 예시) |

**주요 실패코드** (전체는 QTmsg 매뉴얼 ver4.0 기준, 요청 시 전체 표 제공):

| code | 의미 | code | 의미 |
|------|------|------|------|
| 7 | 결번/서비스정지 | 3004 | 스팸 차단 |
| 8 | 단말기 꺼짐 | 9008 | 발신번호 미등록 |
| 55 | 요금 부족 | 9014 | 착신번호 수신거절 |
| 2008 | 비가입자/결번 | 7300 | 카카오 기타에러 |
| 3002 | 수신번호 오류 | 9999 | 기타 오류 |

### ★★ 진행 중에는 반드시 `status_code = 100` 유지

한줄로는 `100`·`104`만 '대기'로 인식하고 **그 외 모든 값은 즉시 '실패'로 집계**합니다.
비토의 CLAIMED / SENT 같은 **중간 상태를 `status_code`에 숫자로 기록하면, 발송 진행 중인 건이 전부 '실패'로 표시**됩니다.

→ claim 추적이 필요하면 **비토 Agent 내부에서 처리**하거나, `SMSQ_SEND_13`에 **별도 claim 컬럼 추가를 협의**해 주세요. 한줄로 집계는 `status_code`만 봅니다.

### ★ 성공코드는 채널별로 다릅니다

`6`(SMS) / `1000`(LMS) / `1800`(알림톡)으로 **채널에 따라 다른 값**입니다. 비토의 단일 `done` 상태값 하나로는 표현할 수 없으니, 발송 채널(msg_type)에 따라 성공코드를 분기해 기록해야 합니다.

## 5. 비토 `agent-config.yaml` 매핑 예시

```yaml
agent_id: "hanjul01"

gateway:
  host: "139.150.81.213"
  port: 9090
  token: "<발급 token>"
  use_tls: false

source:
  db_type: mysql
  host: "<한줄로 MySQL host>"
  port: 3306
  database: "smsdb"
  username: "<발급 계정>"
  password: "<발급 password>"

table: "SMSQ_SEND_13"
order_by: "seqno ASC"

# 픽업: status_code=100 AND sendreq_time <= NOW()
field_map:
  phone: "dest_no"
  callback: "call_back"
  message: "msg_contents"
  title: "title_str"
  msg_type: "msg_type"          # S/L/M/K
  seq: "seqno"
  status: "status_code"          # int — §4 체계로 변환해 UPDATE
  sender_code: "sender_code"
  bill_id: "bill_id"
  send_result_time: "mobsend_time"
  report_recv_time: "repmsg_recvtm"
  telco_info: "mob_company"
  kakao_template: "k_template_code"
  kakao_buttons: "k_button_json"

msg_type_values:
  sms: "S"
  lms: "L"
  mms: "M"
  kakao_alim: "K"

# status_values: 비토 내부 상태를 §4 status_code(int)로 변환
#   pending  → 100 (대기/진행 중 유지)
#   done     → 채널별 6 / 1000 / 1800
#   failed   → 해당 실패코드
```

## 6. 핵심 요청 3가지

1. **진행 중에는 `status_code = 100` 유지** (claim을 status_code에 쓰지 말 것 — 필요 시 별도 컬럼 협의)
2. **결과는 채널별 성공코드(6/1000/1800) + 실패코드**로 UPDATE
3. **`app_etc1`은 절대 보존** (한줄로 결과·정산 매칭 키)

## 7. 비고

- `SMSQ_SEND_13` 라인은 우선 **담당자 테스트용**입니다. 검증 후 실업체로 확대 예정입니다.
- 한줄로 측 작업 = `SMSQ_SEND_13` 라인 추가(테이블 생성 · `SMS_TABLES` 환경변수 · `sms_line_groups` 라인그룹 · 일반 발송 격리).
- 비토 측 작업 = `agent-config.yaml` 매핑 작성(본 명세 기준) + 비토 슈퍼관리자에서 Agent 계정/토큰/중계사 라우팅 관리.
- Agent 인증정보(`agent_id` / `gateway.token`)는 비토 Agent 서버에만 보관하며, 한줄로 코드·DB에는 저장하지 않습니다.
