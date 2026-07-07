# [요청] 비토 게이트웨이 — 발신프로필키(senderkey) 자동 도출 (표준 QTmsg 방식)

> 수신: 게이트웨이 담당(자비스) / 발신: 한줄로
> 배경: Agent v1.0.10 교체 완료 후 알림톡 발송 시 `kakao_sender_key 필수`로 전부 실패(status_code 9999, 발송 전 필드매핑 실패). 우리 발송 경로를 고치는 것보다 **게이트웨이가 표준 QTmsg처럼 senderkey를 자동 처리**하는 게 빠르고 정합적이라, 아래를 요청합니다.

---

## 상황 (실측 확정)

- Agent v1.0.10 교체·config(kakao_payload: k_etc_json 유지)·doctor PASS·GW v149 연결 전부 정상.
- 79738 강조표기 발송 6건 → Agent 로그 `"필드 매핑 실패 … kakao_sender_key 필수: 카카오/브랜드메시지는 발신 프로필 키가 필요합니다"` → **게이트웨이로 가기 전에 막힘**(failures:6, sentMessages:0).
- 우리 k_etc_json 합성은 완벽: `{"title":"…","attachment_link":{"url_mobile":"https://invitocorp.com","url_pc":"https://invitocorp.com"}}` — 템플릿 79738의 represent_link와 정확히 일치. 즉 **대표링크(7300)는 해결 준비 완료, 유일한 관문 = senderkey.**

## 핵심 요청

**표준 QTmsg 중계서버(DPK_HM)는 senderkey를 템플릿코드에서 자동 도출**했습니다 — 한줄로가 senderkey를 안 보내도 알림톡 강조표기가 정상 발송됐습니다(이게 원래 잘 되던 방식). 그런데 **비토 게이트웨이(Agent v1.0.10)는 senderkey를 명시적으로 요구**해서 지금 막힙니다.

→ **비토 게이트웨이(Agent 또는 Humuson IMC connector)가 템플릿코드 → 발신프로필키를 자동 도출하도록 바꿔줄 수 있습니까?**

- 근거: 우리 알림톡은 템플릿코드(`B_IV_013_02_79738` 등) 기반이고, **각 템플릿은 Humuson IMC에 발신프로필과 함께 등록**되어 있습니다. IMC는 템플릿↔발신프로필 매핑을 이미 알고 있으니, IMC connector가 템플릿코드로 senderkey를 도출할 수 있을 것으로 봅니다(표준 중계서버가 하던 것과 동일).
- 이렇게 되면 **한줄로 발송 경로 변경 0**으로 끝납니다.

## 대안 (자동 도출이 불가할 경우)

게이트웨이 자동 도출이 불가하면, 한줄로가 k_etc_json에 `SENDER_KEY`를 직접 넣도록 발송 경로를 수정하겠습니다. 단 이건 우리 쪽 변경 범위가 큽니다(발송 4경로 + 캠페인 staging 배관 7개 지점, 발신프로필키를 send_config로 전파). 시간·리스크가 더 듭니다.

## 회신 요청

| # | 질문 | 회신 |
|---|------|------|
| 1 | 비토 게이트웨이/IMC connector가 **템플릿코드 → 발신프로필키 자동 도출** 가능한가? (표준 QTmsg 방식) | |
| 2 | 가능하면 적용 방법·시점은? (그러면 한줄로 무변경) | |
| 3 | 불가하면, 우리가 k_etc_json에 넣을 `SENDER_KEY` 값 = `kakao_sender_profiles.profile_key`(IMC 발급 발신프로필키)가 맞는지 최종 확인 | |

**우선순위: 게이트웨이 자동 도출(방식 1)** — 표준과 동일하고 한줄로 변경이 없어 가장 빠릅니다.

---

참고: 이전 경위 = `docs/2026-07-07-hanjul01-agent-check-result.md` / `docs/2026-07-07-agent-v1.0.10-migration-request.md` / 블로커 SoT = `status/BUGS.md` §2.
