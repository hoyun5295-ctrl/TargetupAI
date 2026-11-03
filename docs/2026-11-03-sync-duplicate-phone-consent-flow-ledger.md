# 같은 번호 여러 원본 행 · 수신동의 접기 — 흐름 표 · 결함 장부

> 단계 = `status/DEFECT-PLAYBOOK.md` §1 의 1(흐름 표) · 2(결함 장부). **Harold 확인 전 설계 · 코드 0.**
> 접수 = 2026-11-03 엠티콜렉션(메트로시티) 싱크 설치 전 문의 「전화 번호의 경우 일부 고객은 중복이 있는데 이 경우 인비토 측에서 문제되지 않는지요?」(고객마스터 키 = `CD_CUSTOMER` · 고객 약 100만 · 수신 Y 935,123 / N 156,328 · 판매 뷰 = 일별 · 고객별 합계 · 일시 칸 없음 = 매 주기 전량).
> 1028 회신 대조 때 「같은 폰 두 코드 순서 의존」으로 기록만 했던 자리.

## §0 접수 대조(서버 지금 / 배포 뒤)

- 서버 지금 = `3af58654`(원장 `deployed_head` · 2026-11-03 08:47 · C98 · 이미지 스튜디오 `e904cb87` 포함).
- `git log -p 8372eb16..3af58654 -- routes/sync.ts utils/customer-upsert.ts routes/upload.ts` = 30줄 바뀜 · 그중 동의 · 수신거부 · 같은 번호 접기 줄(`sms_opt_in|unsubscribe|seenPhones|seenInBatch|optIn`) 0줄 → 이 흐름은 **서버 지금 = 배포 뒤**.
- 작업 트리 = 이 흐름 파일 미커밋 0(1103 `git --no-optional-locks status`).

## §1 칸을 뽑은 패턴(손 목록 금지)

| 칸 | 패턴 · 명령 | 결과 |
|---|---|---|
| 고객 행 `sms_opt_in` 을 쓰는 자리 | `grep -rnE "sms_opt_in\s*=\s*(true\|false\|\$\|EXCLUDED\|COALESCE\|CASE)" packages/backend/src --include=*.ts`(시험 · WHERE 읽기 제외) | 쓰기 = `customer-upsert.ts`(업서트 · 기본값 2) · `unsubscribes.ts`(118 · 136 · 361 · 508 · 600) · `unsubscribe-helper.ts:74` · `cdp-identity.ts`(323 · 443 · 666) · `mall-consent.ts`(537 · 546 · 651 = 매장 소속 동의) · `customers.ts`(수동) |
| 고객 행을 만드는 자리 | `grep -rn "INSERT INTO customers" packages/backend/src --include=*.ts`(시험 제외) → 업서트 CT 를 부르는 곳 `grep -rn "createCustomerUpsertBuilder(" packages/backend/src` | 만드는 자리 2 = 업서트 CT(`customer-upsert.ts:208`) · 자사몰 회원(`cdp-identity.ts:303`) · CT 를 부르는 곳 4 = `customers.ts:554`(한 명 추가) · `customers.ts:644`(일괄 추가) · `sync.ts:829` · `upload.ts:532` |
| 같은 번호를 한 행으로 접는 자리 | `grep -rn "seenPhones\|seenInBatch\|duplicateInRequest\|dedupe" routes/` | `sync.ts:816-821` · `upload.ts:546 · 594-603` · `customers.ts:652-663`(일괄 추가) |
| 같은 번호 충돌 축 | `grep -rn "ON CONFLICT (company_id, phone)" packages/backend/src` | 업서트 CT(`customer-upsert.ts`) · `cdp-identity.ts:314` |
| 수신거부 원장 쓰기 · 지우기 | `grep -rn "INSERT INTO unsubscribes\|DELETE FROM unsubscribes" packages/backend/src --include=*.ts` | 싱크 = `sync.ts:313-381` 한 곳(`reconcileSyncUnsubscribes`) · 업로드 = `upload.ts:896-930` · 화면 · 080 = `unsubscribes.ts` |
| 발송 자격을 읽는 자리 | `grep -rln "consentSql(" packages/backend/src` · `grep -rn "NOT EXISTS (SELECT 1 FROM unsubscribes"` | 동의 읽기 CT = `mall-consent.ts:228 consentSql`(8파일) · 수신거부 읽기 = `unsubscribe-helper.ts:31` 등 |
| 에이전트가 고객 행에 싣는 원본 키 | `grep -n "source_row_key" sync-agent/src/sync/engine.ts` | 구매에만 붙인다(`engine.ts:1172`) · 고객 행 = 원본 고객코드 없음 |

## §2 흐름 표(싱크 고객 = 엠티 경로 · 이음매마다 쓰는 쪽 / 읽는 쪽)

| 단계 | 하는 일 | 쓰는 쪽 | 읽는 쪽 | 같은 번호 원본 행이 여럿일 때 |
|---|---|---|---|---|
| S1 원본 읽기 | 전량 = 원본 키 순(`CD_CUSTOMER`) 4,000행씩 · 일시 칸이 없으면 증분도 전량 | `sync-agent/src/sync/engine.ts:1016`(keyset) · `config/index.ts:326`(4,000) · `engine.ts:357`(전량 대체) | 고객사 뷰 | 같은 번호의 행들이 키 순서 곳곳에 흩어져 서로 다른 요청으로 갈 수 있다(100만 = 요청 약 250) |
| S2 정규화 | 수신 표기 · 설치별 값 분류 · 탈퇴 = `sms_opt_in=false` 로 접음 · 모르는 표기 = `sms_opt_in_unknown` | `sync-agent/src/normalize/index.ts:604-635` | S3 | 행마다 따로 판정(번호끼리 비교 없음) |
| S3 원본 키 부착 | 구매 행만 `source_row_key` | `engine.ts:1172` | 서버 구매 적재 | **고객 행에는 원본 고객코드가 없다** → 서버는 「같은 코드의 갱신」과 「다른 코드」를 가를 수 없다 |
| S4 전송 | `POST /api/sync/customers` 한 요청 = 한 묶음 | `engine.ts:1261` · `api/client.ts:110` | `routes/sync.ts:607` | 요청끼리 서로 모른다 |
| S5 입력 · 번호 정규화 | 번호 없음 · 꼴 오류 = 그 행 실패 · 동의 칸 미제공 = null | `sync.ts:685-696 · 769-777` | S6 | 같은 번호 = 같은 정규화 번호 |
| S6 같은 번호 접기(요청 안) | 매장은 접기 전에 모두 모음 · **고객 행은 첫 행만 남김** | `sync.ts:808-814`(매장) · `sync.ts:816-821`(첫 행) | S7 | 둘째 행부터 동의값이 버려진다 |
| S7 고객 업서트 | 500행 트랜잭션 · 충돌 축 (company_id, phone) · 칸 = `COALESCE(EXCLUDED, 기존)` · 회원번호 등 커스텀 = 병합(뒤 값 이김) | `sync.ts:843-876` → `customer-upsert.ts:117-128` | 고객 행 | 요청이 갈리면 **뒤 요청의 동의값이 앞 요청 값을 덮는다** |
| S8 신규 동의 기본값 | 새 행 null → 모르는 표기 = 미동의 · 값 없음 = 동의 | `sync.ts:875` → `customer-upsert.ts:237-274` | 고객 행 | 새 번호일 때 첫 묶음 값 기준 |
| S9 수신거부 원장 대조 | 회사 전체 `sms_opt_in=false` → `unsubscribes`(source sync) 등록 · 이 요청이 동의로 보낸 번호 중 고객 행이 동의 → sync 수신거부 삭제 · 삭제 건수 감사 기록 | `sync.ts:1029-1033` → `sync.ts:313-381`(등록 324-359 · 삭제 365-376 · 감사 380) | `unsubscribes` | 앞 요청 미수신 → 등록 · 뒤 요청 수신 → 삭제 · **매 주기 되풀이** |
| S10 발송 자격 | 고객 행 동의 + 수신거부 없음 | (S7 · S9 결과) | `mall-consent.ts:228 consentSql` · `unsubscribe-helper.ts:31` · `channel-eligibility.ts:53` · `journey-safety-filter.ts:23-26` · `direct-send-core.ts:88` · `auto-campaign-worker.ts:457 · 795` | 접힌 최종값만 읽는다(번호 하나 = 한 판정) |
| S11 화면 | 고객 목록 수신동의 · 수신거부 목록 | 고객 행 · `unsubscribes` | `enabled-fields.ts:422` · `routes/unsubscribes.ts` | S7 · S9 의 마지막 값이 보인다 |

## §3 결함 장부(칸마다 판정)

| # | 칸 | 판정 | 사슬 · 근거 | 고객사가 겪는 일 |
|---|---|---|---|---|
| D1 | S6 요청 안 접기 | **결함** | `sync.ts:816-821` 첫 행만 · 둘째 행 동의 버림 | 같은 묶음에 수신(앞) · 미수신 또는 탈퇴(뒤)가 오면 그 번호 = 발송 대상 |
| D2 | S7 · S9 요청 사이 | **결함** | `customer-upsert.ts:120` 뒤 값이 덮음 → `sync.ts:365-376` 이 요청 동의 번호의 sync 수신거부 삭제 | 미수신 코드가 앞 요청 · 수신 코드가 뒤 요청이면 발송 대상(원본 키 순서가 정한다 · 사람이 예측 못 함) |
| D3 | S9 매 주기 되풀이 | **결함** | D2 꼴 번호마다 주기 중간엔 등록(324-359) · 끝엔 삭제(365-376) + 감사 기록(380) | 주기 도중엔 발송 제외 · 끝나면 다시 대상(같은 번호가 한 주기 안에서 왔다 갔다) · 실사 감사 기록에 매 주기 「동기화가 수신거부 삭제」 건수가 쌓인다 |
| D4 | S7 다른 칸(이름 · 등급 · 회원번호 등) | **판정 보류 = Harold 정할 것 ③** | `customer-upsert.ts:120 · 128` 같은 순서 규칙 | 화면 · 개인화 문구의 이름 · 등급 · 회원번호가 어느 코드 값인지 순서가 정한다(동의와 달리 법 위험은 없음) |
| D5 | S3 고객 원본 키 없음 | **이음매 결함(처방의 전제)** | `engine.ts:1172` 구매만 | 서버만 고쳐서는 요청 사이(D2 · D3)를 닫을 수 없다 · 다음 에이전트 판이 필요할 수 있다(설계에서 판정) |
| N1 | S1 · S2 · S4 · S5 · S8 | 정상 | 행 단위 처리 · 같은 번호 문제 아님 | — |
| N2 | S10 발송 자격 읽기 | 정상 | 읽는 자리는 접힌 최종값 하나만 본다(번호 하나 = 한 판정 · 중복 발송 0) | 같은 번호로 두 통 안 감 |
| N3 | 구매 연결 | 정상 | 구매 = 번호로 붙음 · 두 코드 구매가 한 고객에 합쳐짐 | 사람 기준 구매 이력 |

## §4 같은 뿌리 · 다른 입구(전수)

뿌리(새 줄 후보 · 번호는 설계 때 확정) = **시각 근거 없이 같은 번호의 여러 원본 행을 한 고객으로 접을 때 동의가 순서로 정해진다.**

| 입구 | 판정 | 근거 |
|---|---|---|
| 싱크 고객(위 표) | 같은 뿌리 · D1 ~ D3 | — |
| 고객 파일 업로드 | **같은 뿌리** | 2,000행 묶음 안 첫 행만(`upload.ts:546 · 594-603`) · 묶음 사이 = 업서트 CT 뒤 값(`customer-upsert.ts:120`) · 수신거부 등록(`upload.ts:896-930`) · 한 파일 안 같은 번호의 동의가 다르면 순서가 정한다 |
| 자사몰 회원 | 다른 판정(정상) | 동의 = 원천 시각 시계(`cdp-identity.ts:299 · 323` `consentOkSql` · `consent_source_at`) · 같은 번호 두 회원 = 더 나중 동의 사건이 이김 = 사건 근거가 있다 |
| 화면 한 명 추가 · 수정 | 정상 | 한 번에 한 행(`customers.ts:554`) |
| 화면 일괄 추가(`POST /api/customers/bulk`) | **같은 뿌리**(1103 설계 착수 때 추가 · Harold 확인 뒤 발견) | 요청(최대 5,000) 안 같은 번호 = 첫 행만(`customers.ts:652-663`) · 동의 = 그 행 `smsOptIn`(673) · 요청이 하나라 요청 사이 문제는 없다 |
| 수신거부 화면 · 080 · 파일 | 정상 | 사람의 명시 거부 = source manual · upload · 080 · 싱크 대조는 source sync 만 지운다(`sync.ts:305-306`) |
| 몰 매장 소속 동의 | 정상(이 흐름 밖) | 소속 행 단위(`mall-consent.ts:537 · 546 · 651`) · 같은 번호 접기 없음 |

## §5 Harold 확인할 것(이 표가 넘어가는 조건)

1. **흐름이 빠짐없다** — 이번 범위 = 싱크 고객 + 고객 파일 업로드(같은 뿌리) · 자사몰 · 수동 · 수신거부 화면은 정상 판정. **Harold 확인 2026-11-03(「빠짐없음, 설계 진행」)** · 그 뒤 설계 착수 때 업서트 CT 호출부 전수에서 화면 일괄 추가(같은 뿌리)를 더 찾아 §1 · §4 에 넣었다(범위 +1 · 설계서 §0 에 보고).
2. 설계에서 정할 것 미리보기(지금 결정 아님 · 설계서 §정할 것에 추천과 함께 올림):
   - ① 거부 우선 범위 = 「같은 번호의 원본 행 중 하나라도 미수신 또는 탈퇴면 거부」(탈퇴한 옛 코드가 새 코드의 동의를 막는 것까지 포함할지).
   - ② 요청 사이를 닫는 길 = 에이전트가 고객 원본 키를 싣는 새 판(엠티 출고 판이 1.7.5 → 다음 판) 또는 다른 길.
   - ③ 이름 · 등급 · 회원번호의 대표 코드 규칙을 이번에 정할지(D4).
