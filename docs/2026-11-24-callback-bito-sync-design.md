# 발신번호 승인 → 비토엔진 허용 발신번호 자동 등록 설계서 (2026-11-24)

> 접수 = 그룹웨어 서수란 `cmwuc8dfz2jfkjnsc86dgfu0z` 「(발신번호관리) 등록신청에 대한 승인 시 엔진 연동도 추가 요청」 · 판정 = 개선 요청(연결 자체가 없음).
> Harold 1124 「어떻게 발신번호를 연결할지 고민해서 처리해야지?」 → 「QTmsg 쪽 말고 비토엔진사용하는 업체만 등록되게 하면되는거야」 → 「디버깅 승인하도록한다 제대로 하자」.
> 비토 저장소 수정 = `projects/bito-gateway`(FEATURE-BITO-GATEWAY §2 · Harold 승인 범위 = 이번 디버깅) · 비토 배포 = 그 저장소 `status/DEPLOY-RUNBOOK.md`.
> 상태 = 설계 3판(1124 · Codex 6라운드 반영 = §6) · 구현 Codex 13R approve(1125 · §7). 2판의 「한줄로에서 지운 번호를 비토에서도 지우기」를 뺐다 — 접수는 **승인 때 등록**이고, 지우기가 끌고 온 갈래(대량 삭제 상한 · 연결 해제 정리 · 직원 편집 충돌)가 Codex 1 · 2라운드 지적의 대부분이었다(§6). 지우기는 지금처럼 비토 콘솔 손 작업 · 추가 과제로 기록.

## §0 실측(1124 · Harold 서버 출력 · 소스)

| 항목 | 값 |
|---|---|
| 비토엔진 업체(한줄로 `company_agent_ids.agent_send_id` 가 V 로 시작) | V0001 ~ V0014 중 13개 · 11곳(랩디 · 아이티앤 · 이터널그룹 · 더화이트 · 테스트 · 금강제화 · 콜비서 · 프로웨어 · 피케이포유 · 미래꽃도매) |
| 그중 한줄로 등록 번호가 있는 곳 | 금강제화 161개뿐 |
| 비토 V 발송ID 칸 | `agent_account.pay_cust_id`(유일 · `migrations/050`) |
| 엔진이 보는 고객사 | `COALESCE(mr.customer_id, sa.customer_id, aa.reseller_id)` · `aa` = 활성 에이전트(LEFT JOIN) · `sa` = 그 에이전트의 **활성** 발송계정(LEFT JOIN · 없거나 꺼져 있으면 `aa.reseller_id` 로 넘어감) (`internal/gateway/engine/sender.go:1665 · 1697-1703`) · `mr.customer_id` = 적재 때 저장한 값 |
| 엔진 허용 판정 | 고객사 `reseller.is_active` AND 그 고객사 · 정규화 번호 행이 `is_active = TRUE AND verification_status = 'APPROVED'`(`sender.go:1602-1618` · 캐시 5초) |
| 비토 관리 API | 등록 · 수정 · 삭제 모두 `created_by` 를 바꾸지 않는다 · 「삭제」는 `is_active = FALSE`(`web/api/routes/customer-sender-numbers.js:221-235 · 479-560`) |
| 한줄로 회사 단위 등록 판정 | 사용자를 모르는 판정 = `getRegisteredCallbackSet(companyId)`(`utils/callback-filter.ts:249-288`) = 회사의 등록 번호 전부(전체 · 원장 · 지정 사용자 모두) · 규격 위반만 뺀다 · 사용 범위 칸 `describeCallbackUsage`(`:186 · 197-243`) = ledger · all · assigned · invalid(= 규격 위반 = 「발송 불가」) |
| 번호 정책 | registered_only = 랩디 · 이터널 · 테스트 · 금강제화 · 미래꽃도매 / exempt_special_vasp = 아이티앤 · 더화이트 · 콜비서 · 프로웨어 · 피케이포유(엔진이 번호를 안 봄) |

## §1 흐름 표

| 단계 | 지금(쓰는 쪽 · 읽는 쪽) | 이 기능이 걸리는 자리 |
|---|---|---|
| 1 고객 신청 | `routes/sender-registration.ts:148` → sender_registrations pending | 없음 |
| 2 슈퍼관리자 승인 | `routes/sender-registration.ts:389` → `utils/sender-registration.ts:426 approveRegistration` → `callback_numbers` INSERT(`:482`) | 승인 창 · 승인 완료 안내에 「비토엔진 업체 · 비토 허용번호에도 등록됩니다」 한 줄(V 발송ID 회사만) |
| 3 다른 입구 | 슈퍼관리자 직접 추가 `admin.ts:2652` · 번호 수정(callback_id 그대로) `admin.ts:2731-2756` · 관리 메뉴 `manage-callbacks.ts:147` | 같은 거울로 닫힘(번호 표 전체가 대상 · 고친 번호도 새로 넣는다) |
| 4 삭제 | `admin.ts:2774` · `manage-callbacks.ts:251` | **무변경**(비토 쪽 행은 남는다 · 지금처럼 비토 콘솔 손 작업 · 추가 과제) |
| 5 웹 발송 | `callback_numbers` 읽기 20파일 | 무변경 |
| 6 모듈 발송 | 비토 엔진 `sender.go:1605` | 동기화가 넣은 행을 그대로 읽는다 |
| 7 비토 허용번호 쓰기 | 비토 관리 API(직원 손 입력) | 새 쓰기 = 동기화 넣기 하나(created_by = `hanjul-sync` · 있는 행은 읽기만) |
| 8 결과 표시 | 없음 | 한줄로 슈퍼관리자 발신번호 목록에 번호마다 상태 한 칸 |

**값 범위**: V 발송ID 없는 회사 = 대상 아님 · 번호 = 한줄로 회사 단위 판정 집합(원장 `sender_numbers` 활성 ∪ `callback_numbers` · 저장 원문 규격 통과분 · 숫자) · V 여럿 = 이어지는 고객사 합집합 · 에이전트 꺼짐 · 고객사 꺼짐 = 넣기 0(사유) · 발송계정 꺼짐 · 없음 = 엔진처럼 `aa.reseller_id` · 한 고객사에 한줄로 회사 둘 이상 = 그 고객사 넣기 0 · 화면 「비토 매핑 충돌」 · 번호 규격 위반 = 안 됨(사유) · 같은 번호 행이 이미 있음 = 그 행 그대로 · 상태만 읽음 · 회차 실패(응답 오류 · 시간 초과 · 꼴 오류) = 넣기 0 · 결과 없는 번호 · 오래된 결과 = 「확인 중」.

## §2 정한 것

1. **대상 = 비토엔진 업체(V 발송ID)의 한줄로 등록 번호 전체 · 버튼 없음**(Harold 「비토엔진 사용하는 업체만 등록되게 하면 되는거야」). QTmsg(B · C · D) 무변경.
2. **연결 = 비토가 한줄로에서 당겨 간다(거울)** — 한줄로 = 진실 한 곳 · 비토 관리 열쇠를 한줄로에 두지 않는다 · 한줄로 입구 = 비토 서버 IP + 전용 토큰 · 매 회차 전체 대조 = 승인 순간 비토가 잠깐 꺼져 있어도 다음 회차가 넣는다(6원칙 ③).
3. **넣기만 한다** — `ON CONFLICT DO NOTHING`. 이미 있는 행(손 입력 · 동기화 · 꺼짐 · 미승인 무엇이든)은 고치지 않고 읽어서 상태만 알린다 = 있는 행에 대한 비토 직원의 판단(끄기 · 미승인)이 이긴다. 지우기 · 끄기 0. **번호를 없애는 자리는 한줄로다** — 한줄로에 남은 번호는 비토 행이 없으면 다음 회차가 다시 넣는다(비토에서 번호만 바꾸거나 행을 지우면 옛 번호가 돌아온다 · 한줄로 = 진실 · Codex 3R #1 불수용 근거). 직원 안내 = 「번호를 그만 쓰게 하려면 한줄로에서 먼저 지우고, 비토에서도 끈다」(런북 한 줄).
4. **대상 번호 = 한줄로 회사 단위 판정 그 함수** — 모듈 발송은 사용자를 모르는 회사 단위 발송이라 한줄로의 회사 단위 판정 `getRegisteredCallbackSet(companyId)`(CT · 원장 ∪ 발신번호 표 · 저장 원문에 규격 판정을 한 뒤 숫자 · 사용 범위와 관계없이)을 **그대로 불러** 그 집합을 넣는다(다시 만들지 않는다 · Codex 3R #2 불수용 근거 · 4R #1). 비토 규격 판정은 같은 규칙의 두 번째 겹.
5. **효과 확인 = 비토가 번호마다 결과를 돌려준다**(6원칙 ②) → 한줄로 표 `bito_sender_sync` → 관리 화면. 결과는 그 회차에 본 번호 · 회차 시각과 함께 행마다 저장하고, 행마다 더 새 회차만 덮는다.
6. **V 판정 = 한 CT**(`utils/bito-sender-sync.ts` `isBitoAgentSendId` · 정규식 리터럴 `/^V[0-9]+$/`).

## §3 처방

**한줄로**
- `utils/bito-sender-sync.ts`(CT)
  - `isBitoAgentSendId(id)` · `listBitoSenderCompanies()` = V 발송ID 가 있는 회사마다 `{ companyId, agentSendIds, numbers: string[] }` · numbers = `getRegisteredCallbackSet(companyId)` 그대로(숫자).
  - `saveBitoSyncResults({ roundAt, results })` = 한 트랜잭션 · 마지막으로 받은 회차 한 행(`bito_sender_sync_round` · DDL-2)을 `FOR UPDATE` → 들어온 `roundAt` ≤ 그 값 = 저장 0 · 409(늦게 닿은 옛 회차 · 같은 회차 재전송 = 멱등 · 빈 회차도 회차 시각은 올린다 = 처음 닿는 옛 POST 도 막힌다 · Codex 5R #2) → 회차 시각 올림 → 행마다 `INSERT … ON CONFLICT (company_id, phone, agent_send_id) DO UPDATE`.
  - `bitoSyncStatusOf(results, connectedV, now)` (순수) = 그 번호의 **지금 이어진 V(connectedV) 결과만** 한 칸으로(끊긴 V 의 옛 행은 누락 · 지연 · 가장 나쁜 결과 · 펼침 어디에도 쓰지 않는다 · Codex 6R #1): 이어진 V 중 결과 없는 V 가 있으면 `checking` · 하나라도 round_at 5분 넘음 → `delayed`(마지막 확인 시각) · 아니면 **가장 나쁜 결과**(mapping_conflict > agent_inactive · customer_inactive > invalid > manual_blocked > blocked_in_bito > manual_ok > registered · Codex 5R #1) + V 마다 결과 한 줄(펼침). 화면은 지금 번호의 숫자로 (회사 · 번호) 결과를 찾는다 = 번호를 바꾸면 새 번호 결과가 올 때까지 「확인 중」.
- `routes/bito-sync.ts`: `GET /api/bito-sync/sender-numbers` · `POST /api/bito-sync/sender-numbers/results` · 인증 = `X-Bito-Sync-Token` 과 ENV `BITO_SENDER_SYNC_TOKEN` 을 `timingSafeEqualUtf8`(CT `utils/secret-hash.ts` · 길이 다름 · 빈 값 false) **그리고** `req.ip` ∈ ENV `BITO_SENDER_SYNC_IPS`(CT `utils/ip-allowlist.ts` · 내부 경보 입구와 같은 판정) · 토큰 ENV 없음 = 503 · 토큰 틀림 401 · IP 밖 403.
- 관리 화면: 슈퍼관리자 발신번호 목록 응답에 V 회사 번호만 `bitoSync` 칸(표가 없으면 칸 없음 = 지금 화면 그대로) · 승인 창 · 승인 완료 안내 한 줄.
- DDL-1: `CREATE TABLE bito_sender_sync (company_id uuid NOT NULL, phone varchar(20) NOT NULL, agent_send_id varchar(100) NOT NULL, customer_id integer, outcome varchar(24) NOT NULL, reason text, round_at timestamptz NOT NULL, saved_at timestamptz NOT NULL DEFAULT NOW(), PRIMARY KEY (company_id, phone, agent_send_id))`.
- DDL-2: `CREATE TABLE bito_sender_sync_round (id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1), round_at timestamptz NOT NULL)` · 첫 저장 = `INSERT … VALUES (1, '-infinity') ON CONFLICT DO NOTHING` 뒤 `FOR UPDATE`.

**비토(`projects/bito-gateway`)**
- `web/api/workers/hanjul-sender-sync-worker.js`(새 · Node · Go 빌드 0 · 기존 작업자 꼴 = workers/allowed-ip-expiry-worker.js): `createHanjulSenderSyncWorker({ pool, fetch })` · 60초마다 · 앞 회차가 돌고 있으면 건너뜀(직렬)
  1. 한줄로 목록 GET(10초 상한) · 200 아님 · 시간 초과 · JSON 아님 · `companies` 배열 없음 = 회차 실패 · 쓰기 0.
  2. 해석 = V → `agent_account`(pay_cust_id · 활성) → LEFT JOIN 활성 `sender_account` → `COALESCE(sa.customer_id, aa.reseller_id)`(엔진 조회와 같은 식) → `reseller` 활성. 에이전트 없음 · 꺼짐 = `agent_inactive` · 고객사 꺼짐 = `customer_inactive`.
  3. 고객사 충돌 = 한 비토 고객사에 한줄로 회사 둘 이상 → 그 고객사 넣기 0 · 그 번호들 결과 `mapping_conflict`(한줄로 화면 「비토 매핑 충돌」) · 오류 기록. 이미 있던 행은 이 기능이 만든 권한이 아니다(매핑 자체의 문제 = 직원이 화면에서 보고 매핑을 고친다).
  4. 번호 규격 = `services/callback-spec.js` `checkCallbackSpec` · 위반 = `invalid`.
  5. 넣기 = 번호마다 한 트랜잭션 `INSERT … created_by 'hanjul-sync' ON CONFLICT (customer_id, normalized_number) DO NOTHING RETURNING id` → 넣었으면 같은 트랜잭션에 `audit_log`(admin_user_id NULL · `HANJUL_SYNC_INSERT`) → COMMIT(감사 실패 = 번호째 되돌림 · Codex 3R #4 · `allowed-ip-expiry-worker.js:41-73` 과 같은 꼴) · 결과 = 그 행을 다시 읽어 분류: **쓸 수 있음 = `is_active AND verification_status = 'APPROVED'` · 그 밖의 모든 조합 = 막힘** × 출처(`created_by = 'hanjul-sync'` 인가) → `registered` · `blocked_in_bito` · `manual_ok` · `manual_blocked`.
  6. 결과 POST(`roundAt` = 1번 시작 시각 · 10초 상한) · 실패 = 오류 기록(logger.error) · 다음 회차는 그대로 돈다(시간 상한이 다음 회차를 막지 않는다). 장애가 보이는 자리 = 한줄로 화면 「확인 지연 · 마지막 확인 시각」(5분) · 새 경보 경로는 만들지 않는다(Codex 4R #3 · 기존 경보 작업자에 동기화 규칙 없음).
- `web/api/server.js` 기동 = ENV `HANJUL_SENDER_SYNC_URL` · `HANJUL_SENDER_SYNC_TOKEN` 둘 다 있을 때만 start.
- ENV = 관리 API drop-in(root 600 · 기존 drop-in 과 같은 방식) = Harold 가 비토 런북대로 · 켜기 전에 .65 → hanjul.ai 입구 실측(.65 에서 200 · 다른 곳 403).

## §4 계약 시험

- 한줄로: V 판정(V0001 · V12 참 · B0015 · C0006 · D0002 · 빈 값 · `v0001` 거짓) · 목록 = V 회사만(실 PG) · 입구 인증(토큰 ENV 없음 503 · 없음 · 틀림 · 길이 다름 401 · IP 밖 · X-Forwarded-For 꾸밈 403) · 결과 저장 = 회차 한 행으로 새 회차만(옛 회차 · 같은 회차 재전송 409 · 결과 행이 하나도 없을 때 빈 새 회차를 먼저 받은 뒤 닿은 옛 회차 = 0행 · 실 PG) · 표시 판정(결과 없음 · 이어진 V 중 결과 빠짐 = checking · 5분 지남 = delayed · 넣은 직후 비토에서 끄고 결과 POST 실패 = 5분 뒤 delayed · 같은 번호 V 둘 = registered + mapping_conflict → mapping_conflict · 끊긴 V 의 옛 mapping_conflict 행 + 이어진 V 의 새 registered → registered) · 대상 = `getRegisteredCallbackSet(companyId)` 를 부른다(소스 계약) · 실 PG = 지정 사용자 번호 포함 · 원장 전용 번호 포함 · 저장 원문에 허용 밖 문자가 섞인 번호 제외 · V 없는 회사 제외.
- 비토(node 시험 · 가짜 pool · 가짜 fetch): 감사 INSERT 실패 = 번호 행 0 · 다시 돌면 번호 · 감사 각 한 건 · 결과 POST 실패 · 시간 초과 = 다음 회차 진행 · 회차 실패 4종 = 쓰기 0 · 해석(에이전트 꺼짐 · 발송계정 꺼짐 = reseller 로 넘어감 · 발송계정 없음 = reseller · 고객사 꺼짐) · 고객사 충돌 = 넣기 0 + 결과 mapping_conflict · 규격 위반 · 있는 행 = 무변경 + 분류(두 출처 × 활성 둘 × 승인 상태 셋) · 직렬 · ENV 없음 = start 안 함 · 지우기 · 끄기 SQL 0(소스 계약).

## §5 직원 지시문

| 순 | 하세요 | 보이면 맞음 | 맞음 / 다름 |
|---|---|---|---|
| 1 | sys.hanjullo.com 슈퍼관리자 → 「발송 관리」 → 「발신번호 관리」에서 「금강제화」를 펼친다 | 번호마다 「비토 등록됨」(161개) | |
| 2 | 비토 콘솔 → 고객사 「금강제화」 → 허용 발신번호 | 같은 번호 161개 · 등록자 = hanjul-sync | |
| 3 | 금강제화 이름으로 들어온 발신번호 등록 신청 하나를 승인한다(지원팀이 정한 시험 번호) | 승인 창에 「비토엔진 업체 · 비토 허용번호에도 등록됩니다」 · 2분 안에 그 번호 「비토 등록됨」 | |
| 4 | 비토 콘솔에서 3번 번호를 「사용 안 함」으로 바꾼다 → 2분 기다린다 | 비토 콘솔 그 번호가 계속 「사용 안 함」 · 한줄로 화면 = 「비토에서 꺼 둠」 | |
| 5 | 비토 콘솔 금강제화에 시험 번호 하나를 손으로 넣고(사용 안 함) 같은 번호를 한줄로에서 승인한다 | 한줄로 화면 = 「비토 손 입력 · 꺼짐」 · 비토 콘솔 그 행은 그대로(등록자 = 직원) | |
| 6 | 한줄로에서 금강제화 번호 하나를 다른 번호로 고친다 | 2분 안에 새 번호 「비토 등록됨」(옛 번호는 비토에 남는다 · 지우기는 지금처럼 비토 콘솔에서) | |
| 6-2 | 비토 콘솔에서 3번 시험 번호를 다른 번호로 고친다(한줄로에는 그대로) → 2분 기다린다 | 비토 콘솔에 3번 번호가 다시 생긴다(등록자 = hanjul-sync · 한줄로가 기준이라는 뜻) · 비토 콘솔의 「삭제」는 행을 끄기만 하므로 다시 생기지 않는다(런북 안내) | |
| 7 | 비토엔진이 아닌 회사(예: 엠투넷)를 펼친다 · 그 회사 번호 하나를 승인한다 | 비토 표시가 없다 · 승인 창에 비토 문장이 없다 · 비토 콘솔 어느 고객사에도 그 번호가 없다 | |
| 8 | (Harold) 동기화 대상과 같은 비토 고객사(registered_only)의 Agent 로, 승인한 번호로 비토 모듈 발송 1건 · 승인 안 한 번호로 1건 | 앞 건 = 발송 · 뒤 건 = 미등록 발신번호 실패 | |

## §6 Codex 설계 리뷰 처리

**1라운드(needs-attention 8)** = 충돌 고객사 · 직원이 끈 행 복구 · 엔진과 다른 해석 · 회차 실패와 대량 지우기 · 옛 결과 표시 · 정규식 · 손 입력 행 상태 · 입구 인증 → 2판에서 받음.

**2라운드(needs-attention 7)**

| # | 지적 | 처리 |
|---|---|---|
| 1 | 충돌 고객사에 먼저 동기화된 행이 남아 다른 회사 발송에도 쓰임 | 고쳐서 받음 = 충돌은 매핑 자체의 문제(그 고객사의 요금 · 설정 전부를 두 회사가 나눔)라 이 기능이 고칠 자리 아님 · 넣기 0 + 경보로 직원이 매핑을 고친다 |
| 2 | V 연결 해제 뒤 정리 대상에서 사라짐 | 3판에서 지우기 자체를 뺌(지금처럼 손 작업) |
| 3 | 손 삭제(= 끄기)로는 대량 삭제 보류가 안 풀림 | 3판에서 지우기 · 상한을 뺌 |
| 4 | 발송계정 꺼짐 · 없음일 때 엔진은 reseller 로 넘어가는데 설계는 건너뜀 | 받음 = 엔진과 같은 LEFT JOIN · COALESCE(§3 비토 2) · 계약 시험 둘 |
| 5 | 직원 편집 행이 동기화에서 지워짐 | 3판에서 지우기를 뺌 · 넣기만이라 직원 편집이 늘 이김 |
| 6 | 빈 결과 저장 뒤 늦은 POST 기준 상실 · A→B→A | 받음 = 전부 지우고 넣기 대신 행마다 새 회차만 덮기 · 지우기 0 이라 A 는 비토에 남아 「등록됨」이 사실과 맞음 |
| 7 | 꺼짐 + 승인 · 켜짐 + 미승인 조합 미정의 | 받음 = 쓸 수 있음 = 활성 AND APPROVED · 그 밖 전부 막힘 |

**3라운드(needs-attention 4)**

| # | 지적 | 처리 |
|---|---|---|
| 1 | 비토에서 A→B 로 바꾸면 한줄로에 남은 A 가 다시 허용됨 | 불수용 = 한줄로가 진실(§2 3) · A 를 그만 쓰려면 한줄로에서 지운다 · 직원 지시문 6-2 로 동작을 보이게 함 |
| 2 | 한줄로 사용 범위(원장 · 지정 사용자 · 발송 불가)가 비토 고객사 단위로 풀림 | 불수용 = 모듈 발송은 회사 단위 발송이라 한줄로의 회사 단위 판정(`callback-filter.ts:249-288` · 사용자 없이 = 회사 번호 전부)과 같은 집합이 맞다 · 발송 불가 = 규격 위반 = 비토 규격 판정이 뺀다(§2 4) |
| 3 | 결과 POST 실패 뒤 옛 성공이 10분 표시 | 받음 = 5분 넘으면 「확인 지연 · 마지막 확인 시각」 · POST 10초 상한 · 연속 3회 경보 |
| 4 | 번호 INSERT 와 감사 기록의 트랜잭션 경계 | 받음 = 번호마다 한 트랜잭션 |

**4라운드(needs-attention 3)**

| # | 지적 | 처리 |
|---|---|---|
| 1 | 정규화된 번호를 넘기면 저장 원문 규격 위반이 지워짐 · 원장 전용 번호 미정의 | 받음 = 회사 단위 판정 함수 `getRegisteredCallbackSet` 을 그대로 부름(원문 규격 · 원장 합집합이 함께 옴) · 결과 열쇠 = (회사 · 번호 · V) |
| 2 | 콘솔 삭제 = 끄기라 6-2 로 재등록을 못 봄 | 받음 = 6-2 = 비토에서 번호 바꾸기 · 런북에 「콘솔 삭제는 끄기 · 영구 중지는 한줄로에서 먼저 지우고 비토에서도 끈다」 |
| 3 | 연속 실패 경보가 기존 경보 경로에 없음 | 받음 = 새 경보 경로를 만들지 않음 · 보이는 자리 = 한줄로 화면 「확인 지연」 · 「비토 매핑 충돌」 + 비토 오류 기록 |

**5라운드(needs-attention 2)**

| # | 지적 | 처리 |
|---|---|---|
| 1 | 같은 번호의 V 둘(등록됨 · 매핑 충돌)을 한 칸에 어떻게 보일지 계약 없음 | 받음 = 가장 나쁜 결과 한 칸 + V 마다 한 줄 |
| 2 | 빈 회차 뒤 처음 닿는 옛 POST 를 못 막음 | 받음 = 마지막 받은 회차 한 행(DDL-2)을 잠그고 비교 · 빈 회차도 올린다 |

**6라운드(needs-attention 1)** = 끊긴 V 의 옛 결과가 번호 칸을 가림 → 받음 = connectedV 결과만으로 판정(§3 · §4).

**추가 과제(기록만)** = 한줄로에서 지운 번호 · V 연결을 끊은 회사의 비토 허용번호 정리(지금 = 비토 콘솔 손 작업 · 착수 판단 = Harold).

## §7 Codex 구현 리뷰 처리(1124 ~ 1125 · 13R approve)

- 1 ~ 5R = 단건 실패 격리 · V 마다 따로 · 분류 읽기를 넣기와 한 트랜잭션 · 회차 중 매핑 바뀜 = 쓰기 0(발송계정 · 고객사 행 공유 잠금 → agent_account 표 SHARE 잠금 뒤 다시 셈).
- 6 ~ 8R = 표 잠금이 하트비트(agent_account UPDATE)를 붙잡음 → 잠금 전부 NOWAIT · 기다릴 수 있는 잠금을 표 잠금 앞으로 · lock_timeout 200ms · 하트비트와 잠깐 겹친 55P03 = 회차 안 짧은 재시도(3번 · 지터 100 ~ 300ms).
- 9 ~ 12R = 같은 부류(재시도가 회차를 밀어냄) 셋 → 구조 = 재시도 구간(기다림 + 다시 한 시도)을 단조 시계로 잰 값으로 예산 5초 · 다시 시도는 남은 예산이 기다림 + 잠금 대기 상한 200 을 덮을 때만 · 경합 고객사 나머지 번호는 그 회차 시도 0 · 상한 설정 = 트랜잭션 첫 문장 앞.
  안 받음(12R ⑤) = 마감 시각으로 쿼리 취소 — audit_log · customer_sender_number 를 표 단위로 잠그는 앱 경로 0(grep) · 남겨 둔 200 을 넘는 대기 = 배포 DDL 과 겹친 회차뿐 · 넘침은 한 회차 한 시도 · 지켜야 할 성질(결과 POST 가 다음 60초 틱 전) = 5초 + 1초 안팎 vs 60초. 12R 이 이 근거를 받고 시험 경계만 지적 → 13R approve.
- 시험 = 비토 `test/hanjul-sender-sync-test.js` 4-6 ~ 4-9(4-9 = 지속 경합 열두 곳 · 잠금 대기 200 · 400 · 실제 5,200ms 에서 멈춤) · 변이 = 옛 계산(넘긴 기다림만)이면 4-9 실패(9,600ms).
