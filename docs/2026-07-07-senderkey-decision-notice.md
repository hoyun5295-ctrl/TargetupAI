# [통지] senderkey 처리 방향 확정 — 한줄로가 k_etc_json에 SENDER_KEY 직접 주입 (자동 도출 요청 철회)

> 수신: 게이트웨이 담당(자비스) / 발신: 한줄로
> 관련: `docs/2026-07-07-gateway-auto-senderkey-request.md`(철회 대상) · 자비스 회신(자동 도출 = v1.0.10 부재, Agent/Gateway 동시 보강 필요)

## 결정

회신 주신 대로 자동 도출이 설정 변경이 아니라 **v1.0.11급 개발(매핑 저장소 + Agent 보완 + Gateway fallback)**임을 확인했고, 내부 검토 결과 **방식 2(한줄로가 k_etc_json에 SENDER_KEY 직접 주입)로 확정**했습니다. 질문 1·2의 자동 도출 개발은 **불필요합니다 — 진행하지 말아 주세요.**

- 근거: 템플릿→발신프로필 매핑의 원본은 한줄로 DB(`kakao_sender_profiles.profile_key`)입니다. 게이트웨이에 매핑 저장소를 복제하면 진실이 두 곳이 되어 동기화 드리프트 리스크가 생깁니다. 게이트웨이는 받은 값을 그대로 전달하는 얇은 파이프로 유지하는 게 맞다고 판단했습니다.
- Agent v1.0.10의 `kakao_sender_key 필수` fail-fast는 **그대로 유지해 주세요** — 저희가 빠뜨리면 바로 걸러지는 좋은 안전망입니다.

## 한줄로 측 반영 (구현 완료, 배포 예정)

- 비토 라인(SMSQ_SEND_13) 알림톡 INSERT 시 k_etc_json에 `SENDER_KEY`(= IMC 발신프로필키, 질문 3 확인값) 병합:
  ```json
  {"title":"…","attachment_link":{"url_mobile":"…","url_pc":"…"},"SENDER_KEY":"<profile_key>"}
  ```
- Agent v1.0.10의 kakao_payload(k_etc_json) SENDER_KEY 승격 동작을 그대로 사용 — **Agent/Gateway 추가 변경 0**.
- 표준 QTmsg 라인 payload는 불변(비토 라인 한정 주입).

## 배포 후 E2E (한줄로 진행)

79738(대표링크 템플릿) line13 발송 → 기대: Agent 필드매핑 통과 → Gateway v149 attachment_link 변환 → status 1800/DONE. 실패 시 Agent/Gateway 로그 대조를 요청드릴 수 있습니다.
