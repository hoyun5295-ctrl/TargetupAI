# 브랜드메시지 발송 계약 정정 — 작업 지시서 (2026-08-15 작성)

> **임시 문서다. 작업을 완료하면 이 파일을 삭제한다.**(Harold 지시) 완료 사실·확정 결과는 상설 문서
> [docs/bito-gateway/FEATURE-GW-BRAND-MESSAGE.md](bito-gateway/FEATURE-GW-BRAND-MESSAGE.md)에 옮겨 적고 삭제한다.
> 배경·결함 근거는 그 상설 문서 §4가 소유한다 — 여기는 **작업 절차만**.

## 0. 착수 전 필독

- 상설 문서 §3의 ⛔ 2개(NGS 근거 금지 · 형식 추정 금지)
- 게이트웨이 작업 규율 = `docs/FEATURE-BITO-GATEWAY.md` §2-1, 배포 = 게이트웨이 저장소 `status/DEPLOY-RUNBOOK.md`
- **이 작업은 4101을 고치는 작업이 아니다.** 매뉴얼 정합 결함 4건을 닫는 작업이다(인과 미확인 — 상설 §4 ⚠)

## 1. 목표

한줄로 브랜드 발송의 **경계 규약을 알림톡과 동일하게** 맞춘다: `msg_contents` = 순수 본문 / 제어·부가 필드 = `k_etc_json`. 그 결과로 §4 결함 1~3(AD_FLAG·HEADER·ADDITIONAL_CONTENT·PUSH_ALARM·UNSUBSCRIBE)이 한 통로로 실린다.

## 2. 영향 범위 (착수 전 전수 grep 의무)

| 경계 | 파일 | 확인할 것 |
|---|---|---|
| 한줄로 조립 | `packages/backend/src/utils/brand-message.ts` | `buildBrandMsgContents` 시그니처·반환 규약 |
| 한줄로 적재 | `packages/backend/src/utils/sms-queue.ts` | `insertBrandQueue` — `msg_contents`·`k_etc_json` 컬럼 배치 |
| 한줄로 호출 | `packages/backend/src/routes/campaigns.ts` (431·991·2186) | 3곳 전부 동일 파라미터 세트인지 |
| 한줄로 화면 | 브랜드 발송 페이지(프론트) | `isAd`·`header`·`additionalContent` 입력이 실제로 전달되는지 |
| 에이전트 | `.62` `/opt/bito-agent*/agent-config.yaml` | `field_map.message`·`kakao_payload` 매핑(현재 `msg_contents`·`k_etc_json`) |
| 게이트웨이 | `internal/gateway/connector/humuson_imc/payload.go` | `absorbBrandContentsMessage` 제거 가능 여부 |

⚠ **조회·집계·정산 경로도 `msg_contents`를 읽는다** — 발송 결과 화면·엑셀·청구가 본문을 어떻게 표시하는지 전수 확인 후에만 규약을 바꾼다(축 변경 = 전 경로 영향표, 6원칙 ④).

## 3. 작업 순서

1. **영향표 작성** — §2 표의 전 소비처 `rg` 결과를 Harold께 보고. 특히 기존 적재분(JSON 본문)과 신규 적재분(순수 본문)이 **혼재**하는 기간의 조회·집계 동작을 명시할 것
2. **설계안 승인** — 규약 변경안 + 혼재 구간 처리(하위호환 읽기) + 롤백 경로
3. **한줄로 수정** — 조립 함수 + 호출부 3곳 + 화면 입력 배선(누락 필드 포함)
4. **에이전트 확인** — config 변경이 필요한지 판정(불필요할 가능성 높음 — `kakao_payload`가 이미 `k_etc_json`)
5. **게이트웨이** — 하위호환(전문 JSON 본문)을 당분간 유지. 신규 규약 적재분이 전량 전환된 뒤에 `absorbBrandContentsMessage` 제거
6. **검증** — 실측 1건(발송 프레임 로그로 필드 확인) + 조회·집계 화면 회귀

## 4. 완료 조건

- [ ] 발송 프레임에 `AD_FLAG`(사용자 선택값)·`HEADER`·`ADDITIONAL_CONTENT`·`PUSH_ALARM`이 실제로 실림 — 게이트웨이 브랜드 전송 프레임 로그로 확인
- [ ] 관리 화면 본문이 JSON이 아닌 실제 문구로 보임
- [ ] 알림톡 발송 회귀 0(같은 큐·같은 에이전트를 공유한다)
- [ ] 조회·집계·정산 화면 회귀 0
- [ ] 상설 문서 §4·§5 갱신 + §6 착수 원장 1번 종결 처리
- [ ] **이 파일 삭제**

## 5. 하지 말 것

- 4101을 고치겠다고 시리얼 형식을 추정해 넣지 말 것(상설 §3 ⛔)
- 기존 적재분 하위호환을 먼저 끊지 말 것(발송 중인 예약분이 깨진다)
- 공용 컴포넌트(알림톡 큐 함수)를 브랜드 사정으로 고치지 말 것 — 호출부에서 막는다
