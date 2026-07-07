# [요청·선행] Gateway(139.150.81.213) 버전 확인 — v149 이상인지

> 수신: 게이트웨이 담당(자비스) / 발신: 한줄로
> 배경: v1.0.10 회신 확인 완료. **7300 대표링크(attachment_link → IMC ATTACHMENT.link) 변환은 Agent가 아니라 Gateway IMC connector v149 이상에서 처리**된다고 회신 주셨습니다. 그래서 Agent v1.0.10 교체 전에 **현재 Gateway 버전이 v149 이상인지**부터 확정해야 합니다. (Gateway가 v149 미만이면 Agent를 올려도 7300은 그대로라, 교체가 헛수고가 됩니다.)

---

## 확인 요청 (이것만 회신 주시면 다음 단계로 갑니다)

| # | 질문 | 회신 |
|---|------|------|
| 1 | 현재 운영 중인 Gateway(139.150.81.213:9090) binary 버전이 **v149 이상**입니까? | |
| 2 | (v149 미만이면) v149 이상 적용 예정 시점은? Agent 교체를 그 이후로 맞추겠습니다. | |
| 3 | Gateway 버전 확인 방법 — 버전 명령/로그/헬스체크 등 우리가 대조 가능한 방법이 있습니까? | |
| 4 | v149 이상에서 카카오 route/bind가 `invito11`(Humuson IMC) 계정으로 연결되어 있는지 확인 부탁드립니다. | |

## 전제 확정 시 진행 순서 (참고)

Gateway가 v149 이상 확인되면:
1. Agent v1.0.10(linux-amd64, sha256 `51872d01…27146`) 교체 — 자비스 회신의 설치 스크립트대로(백업 → binary 교체 → doctor --check-runtime-write → 재기동).
2. live config = **`field_map.kakao_payload: "k_etc_json"` 유지**(마이그레이션 없음, 하위호환 확인됨) + (Gateway fallback 사용 시) `kakao_failover: "k_next_type"` / `kakao_alt_msg: "k_next_contents"` 2줄 추가 / `kakao_failover.enabled: false` 유지.
3. E2E: 대표링크 템플릿 **79738**을 SMSQ_SEND_13(line13)로 강조표기 발송 → **DONE/정상 결과코드**, 7300 재발 없음.
4. (겸사) 교체 시 `doctor --check-runtime-write` 결과 회신 — SMSQ_SEND_13 UPDATE 권한 확인(현재 v1.0.8 로그의 `reportDBFailures:2502`+대기 1건 원인 진단용).

## 한줄로 측 상태 (참고 — 손댈 것 없음)

- 우리 발송(②)은 이미 대표링크 시 k_etc_json에 아래를 **top-level `attachment_link`**로 합성해 넣고 있습니다(확인 완료, 코드 변경 불필요):
  ```json
  {"title":"강조문구","attachment_link":{"url_mobile":"…","url_pc":"…","scheme_ios":"","scheme_android":""}}
  ```
- Agent field_map은 이미 `kakao_payload: "k_etc_json"` 매핑됨(2026-07-07 반영).

참고 문서: `docs/2026-07-07-agent-v1.0.10-migration-request.md`(질의) · 자비스 회신(`bito-gateway/status/2026-07-07-agent-v1.0.10-migration-response.md`) · `docs/2026-07-07-hanjul01-agent-check-result.md`(점검 상세).
