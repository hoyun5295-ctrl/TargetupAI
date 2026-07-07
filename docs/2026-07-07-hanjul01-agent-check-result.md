# hanjul01 Agent 점검 결과 (2026-07-07)

> 대상: 게이트웨이 담당(자비스) / 작성: 한줄로(비토)
> 서버: invito (58.227.193.62) 에서 실행한 진단 결과 정리
> 관련: 알림톡 강조표기형 **7300** 블로커 원인 추적 (k_etc_json 매핑 확인)

---

## 요약

| 항목 | 결과 |
|------|------|
| Agent 버전 | **v1.0.8 확인 완료** (built 2026-07-04) |
| 서비스/프로세스 | **정상** (bito-agent.service active/running) |
| GW 연결 | **연결 정상** (139.150.81.213:9090, agentID=hanjul01) — 단 주기적 재연결 다수(§2 확인 요청) |
| 카카오 field_map | **미확인** — config 경로 오류로 grep 실패. 재실행 필요(§3) |
| 리포트 DB 기록 | **reportDBFailures 2502 + 대기 1건** — 확인 요청(§4) |

즉 버전·연결은 확인됐고, **정작 이번 목적인 카카오 매핑(k_etc_json)은 아직 못 봤습니다.** §3 재실행 결과가 있어야 7300 진단이 됩니다.

---

## 1. 버전 / 서비스 (확인 완료)

```
bito-agent 1.0.8
commit: nogit
built:  2026-07-04T16:18:14Z
```
- 바이너리: `/opt/bito-agent/bito-agent run`
- 서비스: `bito-agent.service` — loaded, **active (running)**, enabled, Main PID 703569, since 2026-07-05 (약 2일 가동)
- 유닛 설명: "ViTO Messaging Gateway Agent"

## 2. GW 연결 (연결 정상 — 재연결 빈도만 확인 요청)

- `GW 연결 완료  addr=139.150.81.213:9090  agentID=hanjul01  connectCount=2520+`
- 폴링 정상: table=SMSQ_SEND_13, interval 500ms, statePolicy=final_result_only
- 다만 로그에 **주기적으로**(예: 12:34:32, 12:37:49 등 수 분 간격) 아래가 반복됨:
  - `GW 수신 오류 … "error reading from server: EOF" … received prior goaway … "graceful_stop"`
  - → `GW 연결 끊김 감지` → 즉시 `GW 연결 완료`(재연결 성공)
- Agent는 매번 자동 재연결하므로 발송에는 문제 없어 보이나, **connectCount 2520회**는 과다합니다.
  - **[자비스 확인]** 게이트웨이가 이렇게 수 분 간격으로 `graceful_stop`(재시작)하는 게 정상인지? 게이트웨이 측 잦은 재시작/재배포 때문인지, 아니면 keepalive/타임아웃 설정 이슈인지.

## 3. ★ 카카오 field_map — 미확인 (재실행 필요)

- 점검 4번이 실패했습니다:
  ```
  sed: can't read /etc/bito-agent/agent-config.yaml: No such file or directory
  ```
  CONFIG 변수가 기본값(`/etc/bito-agent/...`)이라 실제 파일을 못 읽었습니다. **실제 config는 다른 경로**입니다.
- `find` 결과 config 후보 3곳:
  - `/opt/bito-agent/agent-config.yaml`  ← 바이너리와 같은 위치, 실사용 유력
  - `/home/administrator/bito-install/agent-config.yaml`
  - `/home/administrator/bito-agent/agent-config.yaml`
- **먼저 서비스가 실제로 쓰는 config 경로를 확정** (systemd ExecStart의 --config 인자 확인):
  ```bash
  systemctl cat bito-agent | grep -Ei 'ExecStart|WorkingDirectory'
  ```
- 그 경로를 CONFIG에 넣어 **마스킹 grep 재실행** (자격정보는 MASKED):
  ```bash
  CONFIG=/opt/bito-agent/agent-config.yaml   # 위에서 확인된 실제 경로로 교체
  sudo sed -E \
    -e 's/(token|password|passwd|secret|api_key|authorization|dsn|database_url|username|user)([[:space:]]*[:=]).*/\1\2 MASKED/I' \
    "$CONFIG" | grep -nEi 'agent_id|gateway|table:|field_map|kakao|k_template_code|k_button_json|k_etc_json|kakao_template|kakao_buttons|kakao_payload|msg_type_values|status_values'
  ```
- **확인 목적**: field_map에서
  - `k_template_code` → kakao_template
  - `k_button_json` → kakao_buttons
  - **`k_etc_json` → (kakao_payload 또는 카카오 확장 payload)**  ← **이게 핵심**
- `k_etc_json`이 매핑되어 있지 않으면 **7300 강조표기형 원인 = Agent/게이트웨이의 강조표기 payload 미전달**로 확정됩니다.
  - 참고: 한줄로 연동 명세(`docs/bito-gateway-integration-spec.md`)의 field_map 예시에는 `k_template_code`·`k_button_json`만 있고 **`k_etc_json`은 없습니다.** 명세대로 구성했다면 미매핑이 정상이므로, 미매핑이면 명세 보완 + Agent가 `kakao_payload` 슬롯을 지원하는지도 함께 알려주세요(config로 되는지, Agent 코드 반영이 필요한지).

## 4. ★ 리포트 DB 기록 실패 2502 + 대기 1건 (확인 요청)

- Poller 상태(반복 로그):
  ```
  sentMessages:3  reportsProcessed:2  reportDBFailures:2502
  claimedInMemory:1  waitingReportCount:1
  lastReportDBUpdateAt: 2026-07-05T02:29:14
  lastReportDBFailureAt: 2026-07-05T02:29:00
  ```
- lastReportDBFailureAt/UpdateAt 모두 **2026-07-05 02:29 고정** → 신규 발생은 없고 07-05 이후 멈춘 상태(카운터만 남음).
- 해석: 07-05에 보낸 메시지 1건이 게이트웨이 전송 후, 그 **결과 리포트를 한줄로 DB(SMSQ_SEND_13)에 기록하려다 2502회 실패**하고 멈춰 `sent_to_gateway` 대기(waitingReportCount:1)로 남아 있습니다.
- 영향: 그 1건의 발송 결과(status_code UPDATE)가 DB에 안 써져 **한줄로 쪽에선 계속 미완료(대기)로 보일 수 있습니다.**
- **[자비스 확인]** 이 리포트 DB 기록 실패의 원인이 무엇인지 — DB 계정 UPDATE 권한 / 컬럼·타입 / 커넥션 중 무엇인지. 07-05 테스트 1건이라 무시 가능한지, 아니면 리포트 write-back 경로 자체에 손볼 게 있는지.
  - (한줄로 측 DB/스키마 확인이 필요하면 알려주세요 — SMSQ_SEND_13 UPDATE 권한·컬럼은 우리가 대조하겠습니다.)

---

## 5. ★★ k_etc_json 매핑 확정 후 — 게이트웨이 엔진이 추출할 payload 구조 (2026-07-07 추가)

자비스 확인 결과 **field_map에 k_etc_json 누락 = 7300 강조표기형 원인 확정.** `kakao_payload: "k_etc_json"` 추가는 맞는 방향입니다. 다만 **한 줄 매핑만으로는 끝이 아니라, 게이트웨이 엔진이 k_etc_json 안의 특정 키를 꺼내 IMC ATTACHMENT.link로 넣어야** 강조표기 대표링크가 실제로 뜹니다. 아래를 정확히 맞춰주세요.

### 5-1. 한줄로가 SMSQ_SEND_13.k_etc_json에 넣는 실제 구조 (이미 구현·배선 완료)

우리 발송 4경로(직접발송·캠페인·자동마케팅·여정)는 대표링크 템플릿이면 k_etc_json을 아래 형태로 넣습니다. **이미 구현되어 발송되고 있습니다**(추가 배포 불필요):

```json
{
  "title": "강조표기 문구",
  "attachment_link": {
    "url_mobile": "https://...",
    "url_pc": "https://...",
    "scheme_ios": "...",
    "scheme_android": "..."
  }
}
```
- 값이 있는 키만 들어갑니다(빈 키 생략). `title`만 있고 `attachment_link` 없는 건 = 강조표기만/버튼형.
- **★ 키 이름이 `link`가 아니라 `attachment_link`(snake_case)입니다.** 하위 키도 `url_mobile`/`url_pc`/`scheme_ios`/`scheme_android`(snake).
  - 2026-06-11에 `link` 키로 넣은 테스트가 전부 7300이었던 원인이 이 변수명 불일치였고, 그 뒤 게이트웨이 외주 명시(2026-06-16)에 따라 우리가 `attachment_link`로 확정 구현했습니다.

### 5-2. 게이트웨이 엔진이 해야 할 것 (자비스 확인 요청)

`kakao_payload: "k_etc_json"`로 payload를 넘긴 뒤, 게이트웨이 엔진이:
1. kakao_payload(=k_etc_json) JSON을 파싱해서
2. **`attachment_link` 객체**(url_mobile/url_pc/scheme_ios/scheme_android)를 꺼내
3. IMC 요청 최상위 **ATTACHMENT.link**(urlMobile/urlPc)로 매핑

이 추출 로직이 있어야 합니다. **주의**: 엔진이 `link` 키를 찾으면 못 찾습니다(우리는 `attachment_link`). kakao_payload를 IMC에 통째로 원문 전달해도 IMC는 못 알아듣습니다 — 엔진이 `attachment_link`를 IMC ATTACHMENT.link 규격으로 변환해야 합니다.

### 5-3. E2E 검증 (매핑+엔진 반영 후)

- 대표링크가 등록된 템플릿(예: **79738**, kakao_templates.represent_link에 urlPc/urlMobile 있음)으로 **line 13(SMSQ_SEND_13)에 강조표기 발송 1건**.
- 기대: **status_code 1800(알림톡 성공)**. 여전히 7300이면 엔진이 `attachment_link`를 ATTACHMENT.link로 추출·변환하지 못하는 것.
- 게이트웨이 message_request 확인 시 `kakao_payload`에 attachment_link가 들어오는지 + IMC 접수에 ATTACHMENT.link가 실리는지 대조.

### 5-4. 참고 — 자비스 DB 확인 명령 오류

첨부 로그에 `docker exec -i bito-bench-postgres … No such container: bito-bench-postgres`가 있었습니다. 이 서버(invito)엔 그 컨테이너명이 없습니다 — 게이트웨이 DB 컨테이너 실제 이름으로 바꿔 실행 부탁드립니다(`docker ps`로 확인). 이건 게이트웨이 측 확인 명령이라 한줄로와 무관합니다.

---

## 다음 단계

1. **§3/§5 — 게이트웨이 엔진이 `attachment_link` → IMC ATTACHMENT.link 추출**하도록 매핑+엔진 반영 → §5-3 E2E 1건(79738, line 13) → 1800 확인. **한줄로 측은 추가 코드 불필요(② 이미 완료).**
2. **§4** 리포트 DB 실패(reportDBFailures 2502 + 대기 1건) 원인 회신 (필요 시 한줄로가 SMSQ_SEND_13 UPDATE 권한·컬럼 대조).
3. **§2** 잦은 재연결(graceful_stop) 정상 여부 회신.
4. **§1** config 편집(`kakao_payload: "k_etc_json"` 추가)·`doctor`·`systemctl restart`는 게이트웨이 서버 작업 — 자비스/운영자 진행(한줄로는 서버 config 편집 안 함).
