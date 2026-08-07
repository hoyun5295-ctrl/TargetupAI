# 2026-08-07 세션 인계 — 접수 4건 + 정산 점검

> **다음 세션 진입어 = "0807 인계 이어가자"**
> 이 문서는 **미완 작업의 착수 원장**이다. 완료분의 구조·이력은 각 기능 문서가 소유한다 —
> 정산 = [FEATURE-BILLING.md](FEATURE-BILLING.md)(§7 남은 것 · §8-6 0807 이력). 여기 재서술하지 않는다.

---

## 0) 배포 상태 — 이것부터 확인한다

| 변경 | 코드 | Codex | 배포 |
|---|---|---|---|
| 정산 거래내역서 PDF 구분값 말줄임 폐기 | 완료 | 11R 종결 | **커밋 `1a2921c9`** · 운영 반영 여부 미확인 |
| **모바일DM 발행 중지·재개** | 완료 | 4R — **high 1·medium 1 미착수** | 미배포 |
| **실패 계산서 재시도 관문** | 완료 | **미실시** | 미배포 |

⚠ **배포 전까지 크로커다일 `failed` 취소 장의 [재시도]를 누르면 안 된다** — 코드에 막는 장치가 없다.
사유는 [FEATURE-BILLING §8-4 정정](FEATURE-BILLING.md)에 있다.

---

## 1) 다음 세션 첫 작업 — 순서 고정

### ① 실패 계산서 재시도 관문 Codex (미실시)
대상 = `routes/billing.ts`의 `taxbill-issues/:id/retry`·`/cancel`, `routes/popbill-webhook.ts` 갱신문,
`utils/billing-route-invariants.test.ts`, `pages/AdminDashboard.tsx`(재시도 확인 모달).
검증 수치 = backend tsc 0 / frontend tsc 0 / vitest 141파일 2,085건 / 신규 SQL 2건 PREPARE 실검증 통과.

### ② 모바일DM 중지 — Codex 4R 잔여
- **[high] `NOT EXISTS`는 교차 테이블 경쟁을 원자화하지 못한다** — READ COMMITTED에서 서브쿼리는
  스냅샷만 보고 다른 테이블의 후속 INSERT를 막지 않는다. 처방은 stop·resume·`startAbTest`·추첨 claim이
  **공유하는 per-DM 잠금**인데 그건 A/B·추첨 워커까지 함께 고치는 공사다.
  ⇒ **판단: 잠금 공사 대신 실제 피해가 발생하는 길목을 막는다.** 피해는 "당첨될 수 없는 응모를 받는 것"
  하나이고 그 길목은 **응모 제출**이다. 지금 제출 경로는 `draw_at`도 `dm_draw_runs`도 안 본다
  ([dm-interaction.ts:60](../packages/backend/src/utils/dm/dm-interaction.ts) 부근 — Codex 3R이 범위 밖으로 지목).
  거기에 가드 하나를 넣으면 경쟁이 나도 피해가 안 생긴다. 잠금보다 작고 정확하다.
- **[medium] 실패 사유가 실제 거절 원인을 보존하지 않는다** — UPDATE 0행 뒤 별도 조회로 원인을 추측한다.
  경합 시 엉뚱한 사유를 지목할 수 있다. 중립 문구로 낮추거나 tagged outcome으로 바꾼다.
- ✅ medium 1건(모달에 "중지 중에도 예정 추첨은 실행되고 그 뒤엔 재개 불가")은 0807에 반영 완료.

### ③ `mobile@invitocorp.com` 발행 메일 참조 (설계 확정·착수 전)
[FEATURE-BILLING §7](FEATURE-BILLING.md)이 설계를 소유한다. 요지 — 팝빌 payload에 BCC가 없으므로
기존 참조 재전송 구조(`taxbill_email_resends`)를 쓴다. ENV `TAXBILL_ARCHIVE_BCC`를 순수 함수
`selectTaxbillResendTargets`가 cc에 합치고, **고객 참조와 아카이브를 갈라** 기록 실패 시
고객 참조가 있을 때만 발행 확정을 미룬다. DDL 0.

### ④ 직접타겟발송 AI자연어 수신자 필드 (접수 · 임은지 08-05)
**버그가 아니라 미구현이다.** 코드에 그대로 적혀 있다 —
`// AI 자연어 모드 = fieldsMeta 단순 (phone만 필수 — 향후 확장 가능)`
([DirectTargetFilterModal.tsx:122](../packages/frontend/src/components/DirectTargetFilterModal.tsx)).

- **값은 이미 온다** — `/api/customers/extract`가 FIELD_MAP 전 컬럼 + `custom_fields` 평면화 +
  `region`·`callback`까지 돌려준다([customers.ts:1138](../packages/backend/src/routes/customers.ts)).
- 수동 모드는 고른 필드로 `meta`를 만들어 넘기고([441행](../packages/frontend/src/components/DirectTargetFilterModal.tsx)),
  **AI 모드만 `[]`를 넘긴다**([123행](../packages/frontend/src/components/DirectTargetFilterModal.tsx)) → 열도 변수도 안 생긴다.
- 미리보기 샘플은 **서버가 고정 7필드로 매핑**한다
  ([ai-segment-generator.ts:329](../packages/backend/src/utils/ai-segment-generator.ts)) — 등급·포인트는 애초에 안 내려온다.
- **축은 하나 — `filter`가 참조한 필드**(`{ field: { operator, value } }` 구조라 그 키가 곧 조건 필드).
  그 하나로 서버 샘플과 프론트 `meta`를 함께 채우면 미리보기와 발송 목록이 같은 값을 본다.
  라벨은 FIELD_MAP `displayName` 단일소스 규약을 따른다(별도 라벨 테이블 금지 — LESSONS_BACKEND).

---

## 2) 서버에서 확인된 사실 (코드와 무관 · 실측 기록)

- **2026-08-08 09:00에 13건 자동 발행 첫 실행.** 워커 생존·팝빌 `★운영★`·end-to-end 동작 08-07 확인 완료.
  `pending → due` 전이만 실행 이력이 없다. 상세 = [FEATURE-BILLING §8-6](FEATURE-BILLING.md)
- **거래내역서 발송 지연(무주덕유산리조트) 80분은 미확정.** 완료 조건 = 업체 메일 원문 Received 체인 확보.
  코드가 보장하는 것은 "`sendMail`이 타임아웃 전에 성공한 요청이면 인계가 응답 전에 끝난다"까지다
- **구분 칸에서 발송ID를 뺄지** — Harold 제안. 판정 축은 **같은 발급명을 쓰는 발송ID가 있는가** 하나다.
  확인 문 = `RSRM_SalesMst`의 `CustNm` 중복 집계(MySQL). 아직 실행 전

---

## 3) 별건 (이번 세션에서 발견 · 착수 판단 = Harold)

정산 축은 전부 [FEATURE-BILLING §7](FEATURE-BILLING.md)에 등재했다. 그 밖:

- **`publish`·`send-to-target` 핸들러에 `canAccessDm`이 없다** — 같은 회사 안에서 남의 DM을 발행·발송할 수 있다(기존 결함)
- **A/B 시작·수정의 원자성 부재** — `updateAbTest`/`startAbTest`가 검증과 전이를 분리해, 동시 요청으로
  타사 published page UUID를 running 테스트에 넣을 수 있다
- **발송 intent 직렬화·예약 취소 부재** — DM을 중지해도 이미 예약된 발송은 나간다. 캠페인에 `dm_id`가 없어
  나중에 취소할 대상을 찾지도 못한다. 중지 모달에 그 한계를 명시해 뒀다
- **추첨 claim 실패 시 run 행 잔존** — 그 추첨의 재시도가 영구 차단된다
- **여정·자동마케팅 본문에 붙여넣은 내부 DM URL** — 일반 URL로 재단축돼 중지 후에도 발송된다

---

## 4) 이번 세션에서 배운 것 (반복 방지)

- **상태값 하나를 만들면 그것을 소비해야 하는 축이 몇 개인지 먼저 센다.** DM 중지는 넷이었다(공개 노출·발송·
  A/B 실행·이벤트 수명주기). 축마다 가드를 덧대면 라운드마다 새 구멍이 난다 — **충돌 상태에서 전이 자체를 거절**하는 쪽이 가드를 늘리지 않는다
- **`failed`·`ready` 같은 상태 이름이 외부 사실을 보장하지 않는다.** `failed`에는 "팝빌에 문서가 없다"와
  "발행됐는데 전송만 실패했다"가 섞여 있다. 외부 사실은 외부에 물어야 한다
- **지난 사건의 귀속을 사후 흔적으로 확정하려 하지 않는다.** 축을 하나씩 더해도 반례가 계속 나온다 —
  기록이 없어서 생긴 한계는 서술로 못 메운다(⇒ 불변 발송 시도 기록이 과제가 됐다)
- **전수 정정은 코드만이 아니라 문장에도 적용한다.** 한 문단만 낮추고 같은 주장을 하는 다른 세 곳을 남겼다가
  Codex 4·5·7라운드에서 연속으로 잡혔다
- **템플릿 리터럴 안 SQL 주석에 백틱을 넣지 않는다**(문자열이 끊긴다) · **정규식 리터럴에 제어문자를 직접 적지 않는다**(파일이 바이너리로 잡힌다) — 둘 다 이번에 실제로 밟았다
- **소스 스캔 테스트의 경계는 고정 길이가 아니라 다음 선언까지**로 잡는다. 주석이 늘자 슬라이스가 검사 대상 앞에서 잘려 거짓 실패가 났다
