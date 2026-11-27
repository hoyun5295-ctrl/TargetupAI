# 한줄로 승인 알림톡 템플릿 → 비토 카카오 발신프로필 등록부 자동 연결 설계서 (2026-11-27)

> 접수 = 베네통 비토 발급(전환 2026-12-02 09:00) 중 서팀장 질문 「한줄로에서 새 템플릿 승인되면 엔진에 자동 추가되냐」 · 코드 확인 = 자동 연결 길 0(한줄로 백엔드에 비토 등록부 참조 0).
> Harold 1127 = 「V000 으로 시작하는 코드로 발급하는걸 이용해서 맞춰서 템플릿 넣어주게」 · 「설계서 완벽하게 → Codex 닫힐 때까지 → 구현 → Codex 닫힐 때까지 → 보고」 · 「한줄로 템플릿코드 쪽 체크하는 서버 명령어랑 비토엔진쪽 지금 대량 등록한것들이랑 비교 체크까지 꼭 하고 배포명령어」.
> 범위 = 승인 템플릿을 등록부에 **넣기만**. 프로필(브랜드) 만들기 · 고치기 · 지우기 0 · 연결 고치기 · 지우기 0. 화면 0. DDL 0(양쪽). Go(엔진) 변경 0. 계정 주인 이전 때 등록부 정리(이 기능 이전부터 있던 비토 등록부 관리 문제) = 범위 밖 기록(§7).

---

## 0. 결론

- **대응 자리 = V 발송ID 하나.** 한줄로 `company_agent_ids.agent_send_id`(V 판정 = `utils/bito-sender-sync.ts` `isBitoAgentSendId`) = 비토 `agent_account.pay_cust_id`(발급 때 넣는 값 · 전역 유일 `uq_agent_account_pay_cust_id` · migrations/050:29) → `agent_account.sender_account_id` = 등록부 단위(`kakao_template_map` 은 발송계정마다 · migrations/099:47). 발신번호 거울(C161 · 1125 배포 · 운영 중)과 같은 축 · 같은 입구 · 같은 토큰이다.
- **비토가 60초마다 한줄로에서 V 회사의 승인 템플릿(코드 · 발신프로필 키)을 당겨 와, 그 발송계정 등록부에 같은 키 프로필이 이미 있고 사용 중일 때만 템플릿 연결 한 줄을 넣는다.** 이미 있는 연결(손 등록 포함)은 고치지 않는다. 지우지 않는다. 프로필을 만들지 않는다(등록부 「없음 → 있음」 전환 = 사람만). 넣기 직전 같은 트랜잭션에서 그 발송계정의 주인(활성 Agent 전부가 그 회사 V)임을 다시 확인한 뒤에만 넣는다(§3-2 ⑦ · 재확인과 커밋 사이 수 ms 경합은 §7 범위 밖).
- 못 넣은 것 중 사람이 고쳐야 하는 것(다른 키로 손 연결 · 같은 코드 두 키 · 발송계정 주인 판정 실패 · 코드 꼴 · 쓰기 오류 · 비토 등록부에 없는 브랜드)은 한줄로 운영 경보(`alertPassFailures` · 항목마다 6시간 · 이름당 1시간 1통 · 문자 = 종류와 수 · 어느 회사 · 코드인지는 비토 일꾼 로그 줄)로 알린다. 넣는 연결에는 원래 한줄로 회사를 찍는다(`created_by` · 회사별 되돌리기 · 나중 등록부 정리의 근거).
- 켜기 = 비토 ENV `HANJUL_TEMPLATE_SYNC_ENABLED`(새) 세 값: 없음 = 꺼짐 · `dryrun` = 쓰기 0 · 결과 보내기 0 · 판정만 로그(켜기 전 전 대상 미리보기) · `true` = 켜짐. 주소 · 토큰은 이미 있는 `HANJUL_SENDER_SYNC_URL` · `HANJUL_SENDER_SYNC_TOKEN`. 한줄로 ENV 새것 0(이미 있는 `BITO_SENDER_SYNC_TOKEN` · `BITO_SENDER_SYNC_IPS` 입구 그대로).

---

## 1. 동작 변화 0 증명 표 (설계 맨 앞 · memory `feedback_free_direct_send_zero_change`)

| # | 대상 | 지금 | 켠 뒤 | 근거(코드) |
|---|---|---|---|---|
| 1 | 미가입 · 직접발송만 쓰는 회사(V 없음) | 비토 등록부와 무관 | **같음** | 한줄로 목록 = `loadBitoAgentIds()`(V 판정 한 곳 `isBitoAgentSendId` · `/^V[0-9]+$/`)가 돌려준 회사만. V 없는 회사는 목록에 안 실린다 → 비토가 그 회사 템플릿을 모른다 |
| 2 | 한줄로 웹 발송 전부(직접 · 캠페인 · 자동 · 대행) | — | **같음** | 한줄로 변경 파일 = `routes/bito-sync.ts`(입구 둘 추가) · 새 CT `utils/bito-template-sync.ts`(SELECT 하나 · 경보). 발송 · 차감 · 결과 · 템플릿 표 쓰기 0 |
| 3 | 옛 중계 경로(54/58 `gateway_template_mappings` 워커 · `GATEWAY_TMPL_*`) | 지금대로 | **같음** | 그 표 · 워커 · ENV 무접촉. V 회사가 옛 경로 자동 push 도 켜져 있으면 옛 경로는 옛 경로대로 upsert(서로 모름 · 둘 다 넣기만) |
| 4 | 한줄로 자체 비토 라인(hanjul01 ~ 04 Agent · 한줄로 큐를 읽음) | 지금대로 | **같음**(조건부 · 아래) | 주인 판정(§3-2 ⑤) = 그 발송계정의 **활성 Agent 전부**가 발송ID 를 갖고, 그 발송ID 전부가 **한 한줄로 회사**의 V 일 때만 쓴다. 발송ID 없는 hanjul Agent 가 하나라도 붙은 계정 = 쓰기 0. ⚠ 코드는 hanjul Agent 에 V 를 주는 것을 막지 않는다(비토 `agents.js` 발송ID 규칙 = `/^V\d{4}$/` 만 · 이중 청구 경고뿐). 그 V 를 한줄로가 어느 고객 회사에 이어 둔 경우에만 그 회사 것으로 본다 = 잘못된 설정. 그때도 쓰는 연결은 「그 회사 승인 코드 → 카카오가 그 코드를 승인한 그 회사 키(그 계정 등록부에 사용 중으로 이미 있어야 함)」뿐이다. **켜기 전 §5-B 출력과 미리보기 회차(§5-0)로 hanjul Agent 가 붙은 계정이 대상에 0 임을 확인한다** |
| 5 | V 회사 · 등록부 없는 발송계정(프로필 0) | 행 키로만 보냄 | **같음** | `no_registry` = 쓰기 0. 프로필을 만들지 않으므로 엔진의 「등록부 있음」(K2 · kakao_sender_profile.go:74 `reg.Present`)이 바뀌지 않는다 |
| 6 | V 회사 · 행에 키를 싣는 고객(미래꽃도매 `k_etc_json` senderkey 등) | 행 키 | **같음** | 엔진 판정은 행 키가 있으면 템플릿 연결을 보지 않는다(kakao_sender_profile.go:92-101) |
| 7 | V 회사 · 이미 연결된 템플릿(서팀장 155 붙여넣기 등) | 연결대로 | **같음** | 같은 키 = `same`(쓰기 0) · 다른 키 = `conflict_existing`(쓰기 0 · 경보). 있는 행을 UPDATE · DELETE 하는 문장 0 |
| 8 | V 회사 · 등록부 있음 · **연결 안 된 승인 템플릿** | 기본 프로필 있으면 기본 키(다른 브랜드면 카카오 실패) · 없으면 접수 거절 `KAKAO_SENDER_KEY_UNRESOLVED` no_default | **그 템플릿의 승인 키로 접수** | 의도한 변화(이 설계의 목적). 단 그 키 프로필이 등록부에 없거나 중지면 쓰기 0(지금대로) |
| 9 | 비토의 다른 고객(한줄로 V 와 안 이어진 발송계정) | — | **같음** | 비토는 한줄로 목록의 V 로만 발송계정을 찾는다 |
| 7-2 | 넣은 뒤 주인이 다른 한줄로 회사로 바뀐 발송계정 | 손 연결 · 옛 프로필 · 기본 프로필이 남아 옛 회사 키 접수(사람이 정리할 때까지) | **같음**(자동 연결도 손 연결처럼 남음) | 이 기능 이전부터 있던 등록부 관리 문제 = 범위 밖 기록(§7) · 이 기능은 넣기 직전 재확인한 주인에게만 넣는 데까지(⑦) |
| 10 | 비토 관리 화면 손 작업(프로필 · 템플릿 연결 · 붙여넣기) | — | **같음** | 손 행을 고치지 않는다. 손 쓰기(`lockAccount` = 발송계정 행 `FOR UPDATE`)와 자동 쓰기(같은 행 `FOR KEY SHARE`)가 서로 막혀 한 번에 하나 → 붙여넣기 저장이 자동 쓰기와 겹쳐 고유 키 409 가 나는 일 0 |
| 11 | 비토 접수 · 발송 길(엔진) · Agent 하트비트 | — | **기다림 0** | 엔진 접수의 `message_request` INSERT 는 발송계정 행에 `FOR KEY SHARE`(외래키 migrations/015:28) = 자동 쓰기의 `FOR KEY SHARE` 와 안 부딪힌다. 엔진은 프로필 · 연결 표를 잠그지 않고 읽기만 한다(kakao_sender_profile.go:42-55) |

---

## 2. 지금 흐름 (이음매 표 · 소스에서 뽑음)

뽑은 명령 = `grep -rn "INSERT INTO kakao_templates\|UPDATE kakao_templates"`(한줄로 쓰기 35곳 = INSERT 6 · UPDATE 29) · `grep -rn "kakao_template_map"`(비토 = 엔진 2 · 기동 검사 2 · 관리 라우트 10 · CT 3 · 마이그레이션 5).

| 단계 | 쓰는 쪽 | 읽는 쪽 | 지금 |
|---|---|---|---|
| ① 템플릿 승인 | 한줄로 `utils/alimtalk-jobs.ts:334 · 354`(IMC 검수 동기화 5분) · `routes/admin.ts:6450`(슈퍼관리자 수동 승인 · 코드 입력 가능) · `routes/alimtalk.ts:2069`(휴면 해제) | — | `kakao_templates.status = 'APPROVED'` |
| ② 진짜 카카오 코드 | `utils/kakao-template-sync.ts:232 · 433`(내부 키 `Tm…` → `B_…`) | — | 승인 뒤에도 `template_code` 가 잠시 `Tm…` 일 수 있다 |
| ③ 옛 중계 매핑 | `utils/gateway-template-mapping-worker.ts:77-92`(승인 × `gateway_bill_mappings` → 54/58 upsert) | 옛 중계 서버 | 비토와 무관 |
| ④ 비토 등록부 | 비토 `web/api/routes/kakao-sender-profiles.js:268-288`(손 「템플릿 연결」) · `:358-391`(붙여넣기) | 엔진 `internal/gateway/engine/kakao_sender_profile.go:42-55`(발송계정의 프로필 · 연결 한 문장) | **사람만 쓴다** ← 빈틈 |
| ⑤ 접수 판정 | — | `kakao_sender_profile.go:90-118` `decideKakaoSenderKey` = 행 키 → 템플릿 연결 → 기본 → 거절 | 연결 없음 + 기본 없음 = `KAKAO_SENDER_KEY_UNRESOLVED` no_default |
| ⑥ 캐시 | — | `cmd/gateway/main.go:272` `GW_INGRESS_PROFILE_TTL`(기본 1초) | 등록부 바뀜 → TTL 뒤 반영 |

- 승인 쓰기 자리가 여럿(①)이고 코드가 늦게 바뀐다(②). 그래서 **승인 순간에 거는 사건 방식은 쓰지 않는다.** 상태를 주기적으로 읽어 맞추는 방식(옛 중계 워커 설계 원칙 「desired state + 수렴」 · 발신번호 거울)이면 쓰기 자리가 몇 개든, 코드가 언제 바뀌든 다음 회차에 맞춰진다.

---

## 3. 설계

### 3-1. 한줄로 = 목록 입구 (읽기만)

`GET /api/bito-sync/kakao-templates` · 입구 판정 = 발신번호 거울과 같은 `checkBitoSyncCaller`(토큰 ENV 없음 503 · 출발지 밖 403 · 토큰 틀림 401).

응답:
```json
{ "companies": [ { "companyId": "<uuid>", "agentSendIds": ["V0012"],
    "templates": [ { "templateId": "<uuid>", "templateCode": "B_IV_013_02_80287", "senderKey": "<발신프로필 키>", "profileLabel": "@benetton" } ] } ] }
```
- 회사 = `loadBitoAgentIds()` 가 돌려준 V 회사 전부(템플릿 0 인 회사도 · V 단위 결과를 받으려고).
- `profileLabel` = `coalesce(yellow_id, profile_name)`(100자 자름) · 비토는 판정에 쓰지 않고 로그 줄에서 사람이 브랜드를 알아보는 데만 쓴다.
- 2 · 4 의 「비지 않음 · Tm 아님」 은 SQL 이 아니라 가져온 뒤 JS 한 곳에서 본다(앞뒤 공백 = JS `trim` · 비토 정규화 함수와 같은 공백 정의).
- 템플릿 = 아래 넷을 다 만족하는 행(새 CT `listBitoTemplateCompanies` 의 SELECT 하나):
  1. `t.status = 'APPROVED'`(한줄로 승인 판정 · 옛 중계 워커 `gateway-template-mapping-worker.ts:89` 와 같은 값)
  2. `template_code` 가 비지 않고 **내부 키(`Tm…`)가 아님** · 판정 = `kakao-template-sync.ts` 의 「Tm 으로 시작 = 진짜 카카오 코드 아님」을 순수 코어 `kakao-template-guard-core.ts` 의 함수 하나로(`isImcInternalTemplateKey` · 새로 내보냄 · 그 파일 안 기존 두 자리도 이 함수로 바꿈 = 판정 한 곳)
  3. 그 템플릿의 발신프로필이 **같은 회사 것**(`p.company_id = t.company_id` · 다른 회사 프로필을 가리키는 행이 있어도 그 키를 내보내지 않는다)이고 사용 중 = `p.is_active IS TRUE AND p.status IS DISTINCT FROM SENDER_PROFILE_DISABLED_STATUS`. 두 칸 = `kakao-sender-profile-admin.ts:59` 의 중지 판정(`is_active === false` 또는 `DELETED`)과 같은 칸이고, `is_active` 가 NULL 인 행은 **넣지 않는 쪽**으로 둔다(고객이 고르는 프로필 목록 `routes/companies.ts:190` 의 `is_active = true` 와 같음 · 모르면 넣지 않음)
  4. `profile_key` 가 앞뒤 공백을 빼고도 비지 않음
- 응답에 발신프로필 키 원문이 실린다(비토가 등록부 키와 맞대야 함) → 이 입구는 토큰 + 출발지 둘 다 통과해야 열리고(이미 운영 중인 거울 입구와 같은 문), 양쪽 모두 키를 로그에 남기지 않는다.

`POST /api/bito-sync/kakao-templates/results` · 같은 입구 판정 · 몸통 꼴 검사(틀리면 400 · 경보 0):
```json
{ "accounts":  [ { "companyId": "<uuid>", "agentSendId": "V0012", "outcome": "ok", "reason": null } ],
  "templates": [ { "companyId": "<uuid>", "agentSendId": "V0012", "templateId": "<uuid>", "templateCode": "…", "outcome": "registered", "reason": null } ] }
```
- 한줄로는 결과를 **저장하지 않는다**(표 0 · DDL 0). 경보 대상 결과만 골라 `alertPassFailures({ pass: 'bito-template-sync', title, failures, total, action })` 에 넘기고 · `registered` 수를 로그 한 줄로 남긴다.
- 경보 대상 = `mapping_conflict`(V 단위) · `conflict_existing` · `code_ambiguous` · `invalid` · `sync_error` · `profile_missing`(템플릿 단위). 항목 키 = `V|템플릿 id|결과` · `V|-|결과` → 같은 문제는 6시간에 한 번 · 이 이름 전체로 1시간에 한 통(그 CT 의 규칙 그대로 · 사내 회사 = 로그만).
- **문자 글 = 고정된 종류 이름 둘 중 하나**(숫자 · 회사 · 코드 · V 0): 템플릿 단위 다섯(`conflict_existing` · `code_ambiguous` · `invalid` · `sync_error` · `profile_missing`) = 「비토 자동 연결이 막힌 한줄로 승인 템플릿」 · V 단위 `mapping_conflict` = 「비토 발송계정 주인 판정 실패」. 그 CT 의 주기 모드는 글의 숫자를 N 으로 바꾸고 60자로 자르고 **상위 세 종류만** 문자에 실은 뒤 실린 것 · 안 실린 것을 함께 「알림」 처리한다(system-alert.ts:343-375) → 종류를 둘로 고정하면 동시에 다 생겨도 둘 다 실린다. 문자 = 「무엇이 몇 곳」 신호 · 어느 회사 · V · 코드 · 브랜드 · 세부 결과인지 = 비토 일꾼 로그 줄(§3-2 ⑨) · action 글이 그 로그 보는 자리를 가리킨다. 공용 경보 CT 는 바꾸지 않는다(모든 주기 작업의 계약).
- 경보 아님(지금 상태가 사람의 선택이거나 대상 밖) = `ok` · `registered` · `same` · `unmapped` · `agent_inactive` · `no_sender_account` · `no_registry` · `profile_inactive` · `busy`.
  - `profile_missing` 을 알리는 이유: 고객이 새 브랜드를 쓰기 시작했는데 비토 등록부에 프로필 등록을 빠뜨리면 키 없는 발송이 접수 거절된다(이 설계가 닫으려는 빈틈의 브랜드판). **브랜드(프로필) 등록 = 사람(드묾 · 그 계정이 받는 키 집합을 넓히는 일이라) · 템플릿 연결 = 자동(잦음)** 으로 나누되, 사람이 할 일을 경보가 알려 준다.
  - `profile_missing` 처리 = 그 브랜드 프로필을 비토 등록부에 등록한다(그 회사의 카카오 채널 · 다른 고객사 키는 등록 화면이 K14 로 막음 · 등록부가 이미 있는 계정에서만 생기는 결과라 「있음」 판정은 그대로). 다음 회차에 그 브랜드 승인 템플릿 전부가 연결된다. 고객이 그 브랜드를 더 안 쓰면 한줄로에서 그 프로필을 사용 중지(목록에서 빠짐 = 경보 끝).
  - `profile_inactive` · 중지 프로필에 걸린 `same` 은 알리지 않는다 = 비토 직원이 세운 중지.

### 3-2. 비토 = 동기화 일꾼 `web/api/workers/hanjul-template-sync-worker.js`(새 · Node · Go 빌드 0)

60초마다 · 앞 회차가 돌고 있으면 건너뜀 · 켜기 = `hanjulSenderSyncConfig()`(주소 · 토큰) **그리고** `HANJUL_TEMPLATE_SYNC_ENABLED` 가 `true` 또는 `dryrun`(그 밖 · 없음 = start 안 함 = 배포만으로 동작 변화 0).
- `dryrun` = ① ~ ⑥ 을 그대로 돌고(같은 목록 함수 · 같은 판정 함수) ⑦ 의 BEGIN 부터 하지 않으며 ⑧ 결과 보내기도 하지 않는다. 넣을 후보는 결과 이름 `would_register` · 로그는 ⑨ 와 같은 규칙에 더해 회차마다 계정별 결과 수 한 줄.

① **목록 받기** · 10초 상한 · 200 아님 · JSON 아님 · 꼴 틀림(회사 UUID · V `/^V[0-9]+$/` · templateId UUID · templateCode · senderKey 문자열) = 회차 실패 · 쓰기 0.

② **V → Agent → 발송계정**(잠금 0):
```sql
SELECT aa.pay_cust_id, aa.is_active AS agent_active, aa.sender_account_id, sa.is_active AS account_active
  FROM agent_account aa LEFT JOIN sender_account sa ON sa.id = aa.sender_account_id
 WHERE aa.pay_cust_id = ANY($1::text[])
```

③ **발송계정의 활성 Agent 전부**(주인 판정용 · 잠금 0):
```sql
SELECT sender_account_id, pay_cust_id FROM agent_account
 WHERE is_active = TRUE AND sender_account_id = ANY($1::bigint[])
```

④ **등록부**(한 문장 = 한 스냅숏 · 엔진 `loadKakaoSenderRegistrySQL` 과 같은 방식 · 잠금 0):
```sql
SELECT 'profile' AS kind, p.sender_account_id, p.sender_key, p.status, NULL::text AS template_code
  FROM kakao_sender_profile p WHERE p.sender_account_id = ANY($1::bigint[])
UNION ALL
SELECT 'template', m.sender_account_id, p.sender_key, p.status, m.template_code
  FROM kakao_template_map m JOIN kakao_sender_profile p ON p.id = m.profile_id
 WHERE m.sender_account_id = ANY($1::bigint[])
```

⑤ **V 단위 판정**(앞에서부터 처음 걸리는 것 · 이 순서로 고정):

| 순 | 조건 | 결과 | 쓰기 |
|---|---|---|---|
| 1 | ② 에 행 없음 | `unmapped` | 0 |
| 2 | Agent 꺼짐 | `agent_inactive` | 0 |
| 3 | 발송계정 없음 · 꺼짐 | `no_sender_account` | 0 |
| 4 | 그 발송계정 프로필 0 | `no_registry` | 0 |
| 5 | ③ 의 활성 Agent 중 발송ID 가 **이 한줄로 회사의 V 목록 밖**(빈 값 · hanjul* · 다른 회사 V · 한줄로에 안 이어진 V)인 것이 하나라도 | `mapping_conflict` | 0 |
| 6 | 그 밖 | `ok` → ⑥ | — |

- 5번이 엄격한 이유: 등록부는 발송계정 단위라, 그 계정을 쓰는 Agent 가 한 회사 것임이 증명될 때만 그 회사 템플릿을 넣는다. 발송ID 없는 Agent 가 섞인 계정은 막힌다(경보로 드러나면 그 Agent 에 V 를 준다 · 0916 이후 발급은 Agent 마다 V). 등록부 없는 계정(4번)은 5번까지 가지 않으므로 경보도 없다.
- 한 회사 V 둘이 같은 발송계정이면 계정은 한 번만 처리하고 결과를 두 V 에 똑같이 싣는다.

⑥ **템플릿 판정 = 순수 함수 하나**(비토 등록부 CT `services/kakao-sender-registry.js` 에 `judgeHanjulTemplates({ profiles, templates: maps, items })` · 등록부 판정의 단일 소유 규칙 그대로):

| 순 | 조건 | 결과 | 쓰기 |
|---|---|---|---|
| 1 | 코드가 `normalizeTemplateCode` 를 못 통과(빈 값 · 50자 초과 · 제어 문자) 또는 키가 `normalizeSenderKey` 를 못 통과 | `invalid` | 0 |
| 2 | 같은 회사 · 같은 코드(앞뒤 공백 뺀 값)에 다른 키가 둘 이상 | `code_ambiguous`(그 코드의 행 전부) | 0 |
| 3 | 등록부에 그 코드 연결이 있고 키가 같음 | `same` | 0 |
| 4 | 등록부에 그 코드 연결이 있고 키가 다름 | `conflict_existing` | 0 |
| 5 | 그 키 프로필이 등록부에 없음 | `profile_missing` | 0 |
| 6 | 그 키 프로필이 중지 | `profile_inactive` | 0 |
| 7 | 그 밖(사용 중 프로필 있음 · 연결 없음) | 넣을 후보 → ⑦ | 1 |

- 같은 코드 · 같은 키의 한줄로 행이 둘(중복 등록)이면 후보 하나로 합치고 결과는 두 행에 똑같이.
- 3번 「같음」은 그 프로필이 중지여도 같음(사람이 세운 중지 = 사람의 선택 · 고치지 않음).

⑦ **넣기 = 발송계정마다 트랜잭션 하나**(후보가 있을 때만 · 평소 회차는 잠금 0 · 쓰기 0 · **한 트랜잭션 후보 상한 50**(코드 순 앞 50 · 남은 후보는 이번 회차 결과 `busy` · 다음 회차 60초에 이어서) = 손 쓰기가 기다릴 수 있는 시간을 후보 수와 무관하게 묶는다 · 옛 중계 워커 `PUSH_BATCH_LIMIT` 50 과 같은 꼴 · 설계 7라운드):
```
BEGIN
SET LOCAL lock_timeout = '200ms'; SET LOCAL statement_timeout = '2s'
SELECT id FROM sender_account WHERE id = $1 AND is_active = TRUE FOR KEY SHARE        -- 없으면 전 후보 no_sender_account · ROLLBACK
후보의 키마다(키 순):
  SELECT id, status FROM kakao_sender_profile WHERE sender_account_id = $1 AND sender_key = $2 FOR SHARE
    없음 → 그 키 후보 profile_missing · 중지 → profile_inactive (그 후보들만 뺌)
③ 을 그 계정 하나로 다시 → 주인 판정 다시 = **활성 Agent 가 하나 이상 · 전부 발송ID 있음 · 전부 이 회사 V**(⑤ 5번과 같은 함수 · 어긋나면 사이에 Agent 가 떠났거나 바뀜 → 전 후보 `busy` · ROLLBACK · 다음 회차가 새 상태로 다시 판정 · 같은 회사의 다른 V 로 바뀐 것은 주인이 같으므로 넣는다)
남은 후보를 코드 순으로:
  INSERT INTO kakao_template_map (sender_account_id, template_code, profile_id, memo, created_by, updated_by)
  VALUES ($1, $2, $3, '한줄로 승인 템플릿 자동 연결', 'hanjul-template-sync:' || <한줄로 회사 id>, 'hanjul-template-sync')
  ON CONFLICT (sender_account_id, template_code) DO NOTHING RETURNING id
    넣음 → audit_log(admin_user_id NULL · action 'HANJUL_TEMPLATE_SYNC_INSERT' · target 'kakao_template_map' · detail = 계정 · 코드 · 가린 키 · 한줄로 회사 · 템플릿 id) → registered
    못 넣음(그 사이 다른 쪽이 넣음) → 그 행의 키를 다시 읽어 same / conflict_existing
COMMIT
```
- 잠금 순서 = 발송계정(`FOR KEY SHARE`) → 프로필(`FOR SHARE`) → 연결 INSERT(외래키 검사가 같은 두 행을 `FOR KEY SHARE` · 이미 쥔 잠금) · 손 쓰기 순서(발송계정 `FOR UPDATE` → 프로필)와 같은 방향이라 서로 엇갈려 기다리는 일(교착)이 없다. 손 쓰기가 계정을 쥐고 있으면 자동 쪽이 200ms 뒤 물러난다.
- `FOR KEY SHARE` 를 고른 이유: 손 쓰기의 `FOR UPDATE` 와는 부딪혀 둘을 한 줄로 세우고, 엔진 접수의 외래키 잠금(`FOR KEY SHARE`)과는 안 부딪혀 발송을 세우지 않는다(§1 #11). `lockAccount`(`FOR UPDATE`)를 쓰면 쥐고 있는 동안 그 계정 접수가 선다.
- 잠금 · 시간 초과(`55P03` · `57014`) = 그 계정 후보 전부 `busy` · 다음 회차(60초)에 다시 · 회차 안에서 다시 시도하지 않는다(템플릿 연결은 초 단위로 급하지 않다). 그 밖 오류 = 그 계정 후보 전부 `sync_error`(메시지 200자 · 경보).
- 넣은 행은 비토 관리 화면 템플릿 목록에 메모 「한줄로 승인 템플릿 자동 연결」로 보인다(그 화면은 memo 를 이미 보여 줌 · 화면 변경 0).
- `created_by` = `hanjul-template-sync:<원래 한줄로 회사 id>`(21 + 36 = 57자 ≤ varchar(64)) · 손 수정(PUT)은 `updated_by` · `profile_id` · `memo` 만 바꾸므로(kakao-sender-profiles.js:300-303) 원래 회사는 지워지지 않는다 · 쓰임 = 회사별 되돌리기(§3-5) · 나중 등록부 정리(§7 범위 밖)의 근거.
- **주인 = 넣기 직전 같은 트랜잭션에서 재확인한 시점의 주인.** Agent 행 · 표는 잠그지 않는다. 재확인과 커밋 사이(수 ms)에 Agent 를 옮기거나 새 Agent 를 붙이는 경합은 막지 않는다 = 런북 ★1127 수용 3분류의 ③(이론 사례) · 그 끝 상태는 넣은 뒤의 재배정 · 손 연결이 재배정 뒤 남는 상태와 같다(§7 범위 밖). 설계 6라운드에서 Agent 표 `SHARE` 잠금을 넣었다가 ③ 수용 금지로 되돌렸다.

⑧ **결과 돌려주기** · 10초 상한 · 실패 = 로그만(다음 회차가 다시 보냄 · 한줄로는 저장하지 않으므로 회차 시각 · 늦게 닿은 옛 회차 판정이 필요 없다 = 몸통에 회차 시각 칸 없음).

⑨ **로그** = 회차 실패 · 넣음(계정 · 코드 · 가린 키 · 브랜드 이름) · 계정 단위 오류 + **결과가 바뀐 항목마다 한 줄**(V · 계정 · 코드 · 결과 · 브랜드 이름 · 가린 키 · 이유) · 같은 결과가 이어지면 다시 찍지 않되, **경보 대상 결과가 남아 있는 항목은 6시간마다 다시 한 줄**(한줄로 경보 되새김 주기와 같음 · 문자를 받은 뒤 최근 줄로 찾게) · 일꾼 메모리 · api 재시작 뒤 첫 회차는 다시 찍음. 한줄로 경보 문자의 「어느 것」 은 이 줄로 찾는다. 키 원문 0(`maskKey`).

### 3-3. 승인 · 수정 · 삭제 때 등록부

| 한줄로 사건 | 등록부 | 이유 |
|---|---|---|
| 승인(어느 쓰기 자리든) | 다음 회차(≤ 60초 + 엔진 캐시 TTL)에 연결 넣음 | 상태를 읽어 맞춤 · 사건을 걸지 않음 |
| 승인됐는데 코드가 아직 `Tm…` | 넣지 않음 → `B_…` 로 바뀐 회차에 넣음 | 고객 행은 진짜 코드로 온다 · 내부 키 연결은 쓸모없는 화석 |
| 본문 수정(`routes/alimtalk.ts:1667` PUT) | 할 일 0 | 그 길은 코드 · 프로필 · 상태를 바꾸지 않는다(`UPDATE … SET` 칸 목록에 셋 없음 · 1686-1711). 등록부는 코드 → 키만 갖는다 |
| 코드 · 프로필 변경(`routes/companies.ts:2691`) | 할 일 0 | 그 길은 검수요청 · 반려 · 초안에서만 열린다(2680) = 승인 템플릿은 안 바뀐다 |
| 재검수 등으로 승인 밖으로 | 할 일 0(있는 연결 그대로) | 넣기만 |
| 삭제(`routes/alimtalk.ts:1844` → `DELETED`) · 프로필 중지 | **지우지 않음** | ①지우면 기본 프로필 있는 계정은 기본 키로(다른 브랜드면 카카오 실패), 없는 계정은 접수 거절 = 어느 쪽도 「카카오가 삭제 템플릿을 거절」보다 낫지 않다 ②옛 중계 워커(삭제 API 없음) · 발신번호 거울(지우기 0)과 같은 원칙 ③LESSONS_BACKEND 「스냅샷 동기화에서 안 보낸 키는 어떻게 되는가」에 대한 답 = 남는 연결은 「코드 → 그 템플릿이 승인된 바로 그 키」라 화석이어도 다른 템플릿을 잘못 보내지 않는다. 정리 = 지금처럼 비토 관리 화면 손 작업(추가 과제 기록) |
| 한줄로에서 발신프로필 사용 중지(`disableSenderProfile`) | 할 일 0(그 프로필 템플릿은 목록에서 빠지고, 이미 넣은 연결은 남는다) | 비토 쪽 그 브랜드 사용 여부의 주인 = 비토 등록부 프로필 상태(사람). 자동 연결이 남기는 것은 손 연결(서팀장 155)이 남기는 것과 같은 「승인 코드 → 승인 키」다 = 이 설계가 없을 때 사람이 넣었을 연결과 같은 끝 상태. 비토 Agent 로도 그 브랜드를 막으려면 비토 등록부에서 그 프로필을 「중지」 · 효과 = 그 키를 실은 요청 `KAKAO_SENDER_KEY_UNREGISTERED` 거절 · **연결이 있는 코드**의 키 없는 요청 `template_profile_inactive` 거절 · 연결이 **없는** 코드의 키 없는 요청은 기본 프로필이 있으면 기본 키로 나간다(중지로 안 막힘 · decideKakaoSenderKey 106-115). **막힘이 보장되는 것은 연결이 확인된 코드뿐**이다(프로필을 중지하면 그 뒤 승인된 코드는 `profile_inactive` 로 연결되지 않으므로 기본 프로필이 있는 계정에서는 기본 키로 나갈 수 있다) · 런북 §9 에 이 한계와 함께 한 줄 |
| 비토 직원이 자동 연결 한 줄을 손으로 지움 | 그 코드가 한줄로에서 아직 승인 · 그 키 프로필이 사용 중이면 다음 회차에 같은 연결(같은 키)이 다시 들어간다 | 되살아나는 값은 「카카오가 그 코드를 승인한 그 키」(§3-1 3 · 같은 회사 프로필)라, 잘못 연결된 키를 바로잡으려고 지운 경우는 맞는 키로 다시 채워진다. 연결 지우기는 비토에서 템플릿을 막는 정해진 방법이 아니다(기본 프로필이 있으면 막히지 않고 기본 키로 나간다). 막는 방법 = 연결을 둔 채 비토 프로필 「중지」(브랜드 단위 · 위 줄의 효과) 또는 한줄로 · 카카오에서 템플릿 삭제. 자동이 다시 넣은 일은 감사 기록 `HANJUL_TEMPLATE_SYNC_INSERT` 로 남는다 |
| Agent 재배정 · 발송계정 주인 바뀜(경합 포함) | 할 일 0(지우지 않음 · 손 연결과 같음) | 이 기능 이전부터 있던 등록부 관리 문제(옛 프로필 · 기본 프로필 · 손 연결이 이미 같은 결과) = §7 범위 밖. 이 기능의 의무 = 넣는 순간 섞인 계정을 만들지 않음(⑦) · 원래 회사는 `created_by` 로 남음 |
| 회사 이전 · 합치기(1124 엔그램 → 미래꽃도매 같은) | 새 회사 V 의 발송계정에 다음 회차 넣음 · 옛 계정 연결 그대로 | 넣기만 |
| V 를 회사에 새로 이음 | 다음 회차부터 대상 | 목록이 V 로 만들어짐 |

### 3-4. 기존 손 등록 행과 충돌

| 비토 등록부 지금 | 한줄로 승인 템플릿 | 결과 | 쓰기 | 경보 |
|---|---|---|---|---|
| 같은 코드 · 같은 키(서팀장 155 대부분 예상) | 있음 | `same` | 0 | 0 |
| 같은 코드 · **다른 키** | 있음 | `conflict_existing` | 0(손 행이 이긴다) | 있음 = 둘 중 하나가 틀렸다(손 연결이면 카카오가 거절할 키로 나간다) |
| 연결 없음 · 그 키 프로필 사용 중 | 있음 | `registered` | 1 | 0 |
| 연결 없음 · 그 키 프로필 없음 | 있음 | `profile_missing` | 0 | 있음(처리 = 그 브랜드 프로필 등록 · 안 쓰는 브랜드면 한줄로에서 프로필 사용 중지 · §3-1) |
| 연결 없음 · 그 키 프로필 중지 | 있음 | `profile_inactive` | 0 | 0(비토 직원의 중지) |
| 연결 있음(QTmsg 에만 있던 템플릿 등) | 없음 | 손대지 않음(목록에 없는 코드는 보지 않는다) | 0 | 0 |
| 손 쓰기와 같은 순간 | — | 한 번에 하나(§3-2 ⑦) · 먼저 넣은 쪽 행이 남고 다른 쪽은 `same`/`conflict_existing` 또는 손 화면의 기존 판정 | — | — |

### 3-5. 켜기 · 끄기 · 되돌리기

- 배포 순서 = 한줄로(입구) → 비토 api(일꾼 · ENV 없음 = 꺼짐) → **비교 확인(§5-A ~ D)** → 비토 ENV `dryrun` → api 재시작 → **미리보기 회차 로그 확인(§5-0)** → ENV `true` → api 재시작 → 첫 회차 로그 · 한줄로 로그 확인 → 실측 1건(§5-E).
- 끄기 = 그 ENV 를 지우고 api 재시작(넣은 연결은 남음 · 동작 = 지금과 같은 손 관리).
- 넣은 연결 되돌리기(필요할 때만 · 감사 기록 남김) = `created_by LIKE 'hanjul-template-sync:%' AND updated_by = 'hanjul-template-sync'` 인 행만(손으로 고친 행은 updated_by 가 바뀌어 빠진다).

---

## 4. 바뀌는 것

| 저장소 | 파일 | 무엇 |
|---|---|---|
| 한줄로 | `packages/backend/src/utils/bito-template-sync.ts`(새 CT) | `listBitoTemplateCompanies()` · `parseBitoTemplateResults(body)`(순수) · `bitoTemplateAlertFailures(parsed)`(순수 · 경보 항목 고르기) · `reportBitoTemplateResults(parsed)`(경보 + 로그) · 결과 이름 목록 |
| 한줄로 | `packages/backend/src/routes/bito-sync.ts` | `GET /kakao-templates` · `POST /kakao-templates/results`(부르기만 · 입구 판정 = 기존 `denied`) |
| 한줄로 | `packages/backend/src/utils/kakao-template-guard-core.ts` · `kakao-template-sync.ts` | 내부 키 판정 `isImcInternalTemplateKey`(`code.startsWith('Tm')` 그대로)를 DB 없는 순수 코어에 두고, `kakao-template-sync.ts` 안 두 자리가 그 함수를 씀(동작 같음 · 무거운 IMC 모듈을 목록 CT 가 끌어오지 않게) |
| 비토 | `web/api/services/kakao-sender-registry.js` | `judgeHanjulTemplates`(순수) · 결과 이름 |
| 비토 | `web/api/workers/hanjul-template-sync-worker.js`(새) | §3-2 |
| 비토 | `web/api/server.js` | 일꾼 만들기 · 켜기 조건 · 종료 목록(발신번호 거울 두 줄 옆) |
| 둘 다 | 시험 | §6 |

- DDL 0 · Go 0 · 대시보드 빌드 0 · 한줄로 프론트 0 · 한줄로 ENV 0 · 비토 ENV 1(`HANJUL_TEMPLATE_SYNC_ENABLED`).
- 쓰는 칸 근거(새 칸 · 새 표 0 · 전부 운영에서 이미 도는 SQL 이 쓰는 칸 · LESSONS_DB 「컬럼을 쓰기 전 3단계」 2단계):
  - 한줄로 `kakao_templates.id · company_id · profile_id · template_code · status` · `kakao_sender_profiles.id · profile_key` = `gateway-template-mapping-worker.ts:77-92`(0720 운영) · `kakao_sender_profiles.is_active · status` = `kakao-sender-profile-admin.ts:59-67`(0912 운영) · `company_agent_ids.company_id · agent_send_id` = `bito-sender-sync.ts:33`(1125 운영).
  - 비토 `agent_account.pay_cust_id · is_active · sender_account_id` · `sender_account.id · is_active` = `hanjul-sender-sync-worker.js:69-99`(1125 운영) · `kakao_sender_profile.*` · `kakao_template_map.(sender_account_id, template_code, profile_id, memo, created_by, updated_by)` = `kakao-sender-profiles.js:276`(1031 운영) · `audit_log.(admin_user_id, action, target_type, target_id, detail)` = `hanjul-sender-sync-worker.js:158`.

---

## 5. 배포 전 비교 확인 (Harold 1127 「비교 체크까지 꼭」 · 한 번에 하나씩)

목적 = 켜기 전에 첫 회차가 할 일을 사람이 먼저 본다. 두 겹: (가) SQL 로 양쪽 DB 를 맞대는 사람 비교(A ~ D · 배포 전에도 됨) (나) 실제 목록 함수 · 판정 함수로 전 V 대상을 쓰기 없이 도는 미리보기 회차(§5-0 · 배포 뒤 · 켜기 전). 키는 원문 대신 `md5(btrim(키))` 앞 8자로 맞댄다(원문 0). 코드는 일꾼과 같이 `btrim`.

- A. 한줄로 서버 · V 회사와 목록 대상 템플릿 수(목록 입구와 같은 조건):
  `docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "SELECT a.agent_send_id, c.company_name, count(t.id) AS approved FROM company_agent_ids a JOIN companies c ON c.id = a.company_id LEFT JOIN kakao_templates t ON t.company_id = a.company_id AND t.status = 'APPROVED' AND btrim(coalesce(t.template_code,'')) <> '' AND btrim(t.template_code) NOT LIKE 'Tm%' AND EXISTS (SELECT 1 FROM kakao_sender_profiles p WHERE p.id = t.profile_id AND p.company_id = t.company_id AND p.is_active IS TRUE AND p.status IS DISTINCT FROM 'DELETED' AND btrim(coalesce(p.profile_key,'')) <> '') WHERE a.agent_send_id ~ '^V[0-9]+$' GROUP BY 1, 2 ORDER BY 1;"`
- B. 비토 `.65` · V Agent · 발송계정 · 등록부 크기 · 같은 계정의 다른 Agent(발송ID 없음 = (빈)):
  `docker exec -i bito-bench-postgres psql -U bito -d bito_gateway -P pager=off -c "SELECT aa.pay_cust_id, aa.agent_id, aa.is_active, aa.sender_account_id, (SELECT count(*) FROM kakao_sender_profile p WHERE p.sender_account_id = aa.sender_account_id) AS profiles, (SELECT count(*) FROM kakao_template_map m WHERE m.sender_account_id = aa.sender_account_id) AS maps, (SELECT string_agg(coalesce(o.pay_cust_id,'(빈)') || ':' || o.agent_id, ', ') FROM agent_account o WHERE o.sender_account_id = aa.sender_account_id AND o.is_active AND o.agent_id <> aa.agent_id) AS other_agents FROM agent_account aa WHERE aa.pay_cust_id ~ '^V[0-9]+$' ORDER BY 1;"`
- C. 한줄로 · 베네통 V 의 목록 대상 템플릿(코드 · 키 지문 · 프로필 이름):
  `docker exec -i targetup-postgres psql -U targetup targetup -At -F '|' -c "SELECT t.template_code AS code, left(md5(btrim(p.profile_key)), 8) AS key8, btrim(p.profile_key) ~ '^[!-~]{1,50}$' AS key_ok, coalesce(p.yellow_id, p.profile_name) AS profile FROM company_agent_ids a JOIN kakao_templates t ON t.company_id = a.company_id JOIN kakao_sender_profiles p ON p.id = t.profile_id AND p.company_id = t.company_id WHERE a.agent_send_id = '<V>' AND t.status = 'APPROVED' AND btrim(coalesce(t.template_code,'')) <> '' AND btrim(t.template_code) NOT LIKE 'Tm%' AND p.is_active IS TRUE AND p.status IS DISTINCT FROM 'DELETED' AND btrim(coalesce(p.profile_key,'')) <> '' ORDER BY 1;"`
- D. 비토 · 같은 V 의 등록부(서팀장 155 · 프로필 포함):
  `docker exec -i bito-bench-postgres psql -U bito -d bito_gateway -At -F '|' -c "SELECT 'map' AS kind, m.template_code AS code, left(md5(btrim(p.sender_key)), 8) AS key8, p.status, m.created_by FROM agent_account aa JOIN kakao_template_map m ON m.sender_account_id = aa.sender_account_id JOIN kakao_sender_profile p ON p.id = m.profile_id WHERE aa.pay_cust_id = '<V>' UNION ALL SELECT 'profile', p.label, left(md5(btrim(p.sender_key)), 8), p.status, CASE WHEN p.is_default THEN 'default' ELSE '' END FROM agent_account aa JOIN kakao_sender_profile p ON p.sender_account_id = aa.sender_account_id WHERE aa.pay_cust_id = '<V>' ORDER BY 1, 2;"`
- 판정(C · D 를 코드로 맞대 줄마다) = `same`(코드 · key8 같음) · `conflict_existing`(코드 같고 key8 다름) · `would_register`(C 에만 · D 프로필에 그 key8 사용 중) · `profile_missing`(C 에만 · 프로필 없음) · `profile_inactive`(C 에만 · 프로필 중지) · `D 에만`(손대지 않음). 맞대기는 출력 두 개(C · D 는 `-At -F '|'` = 줄마다 칸을 `|` 로 이은 꼴)를 받아 **일꾼과 같은 판정 함수 `judgeHanjulTemplates` 를 그대로 부르는 스크립트**(`scratch/bito-tmpl/compare-c-d.js` · 합성 자료로 확인)로 한다(코드 = 원문 · 키 자리 = 지문 · 손으로 세지 않음) · 그래서 `invalid` · `code_ambiguous` 도 일꾼과 같은 규칙으로 나온다. SQL 의 `btrim` 은 공백 글자만 자르고 JS `trim` 은 탭 등도 자르는 차이가 있어(코드 · 키 앞뒤에 탭이 붙은 행이 있을 때만 갈림) **최종 기준은 미리보기 회차**(실제 값 · 실제 함수)다.
- **0 · 미리보기 회차(배포 뒤 · 켜기 전)** = 비토 ENV `HANJUL_TEMPLATE_SYNC_ENABLED=dryrun` → api 재시작 → 첫 회차 로그(계정별 결과 수 + 줄마다)를 받는다. 이것이 실제 일꾼이 할 일 그 자체다(전 V 대상 · 같은 목록 · 같은 판정 · 쓰기 0 · 결과 보내기 0). C · D 의 베네통 판정과 같은지 대조.
- **켜는 조건(전부)** = 미리보기에서 `mapping_conflict` · `conflict_existing` · `code_ambiguous` · `invalid` 0 · `profile_missing` 0(남으면 그 브랜드를 쓰면 프로필 등록 · 안 쓰면 중지 프로필 등록으로 정리) · 대상 계정에 hanjul Agent 0(B). 하나라도 어긋나면 켜지 않고 그 줄을 먼저 정리한다.
- E. 실측 1건(6원칙 ⑤) = 켠 뒤 **자동으로 `registered` 된 코드** 하나로 키 없는 알림톡 시험 1건이 접수 거절 없이 1800 으로 끝나는지(런북 §9-3 4번 꼴 · `same` 인 손 연결로 대신하지 않는다). 전환 전이라 고객 Agent 로 못 보내면 전환 날 시험 2건에 넣는다. 켠 시점에 `registered` 가 0 이면(한줄로 승인 템플릿이 전부 이미 손 연결) 다음 새 승인 템플릿이 생겼을 때 그 코드로 한다 · 그 전까지 이 항목은 「미검증」.

---

## 6. 시험 (계약 · 변이로 빨간불 확인)

비토(`web/api/test/hanjul-template-sync-test.js` · 가짜 pool · 가짜 fetch):
1. 판정 표 ⑥ 일곱 줄 각각(같은 코드 두 키 · 공백 붙은 코드 = 같은 코드 · 중복 행 합치기 · 중지 프로필의 같음).
2. V 단위 표 ⑤ 여섯 줄 각각 · 주인 판정 = 빈 발송ID Agent · 다른 회사 V · 한줄로에 없는 V → `mapping_conflict` · 등록부 없는 계정은 주인 판정 전에 `no_registry`.
3. 넣기 트랜잭션 문장 순서(lock_timeout · statement_timeout → 계정 KEY SHARE → 프로필 SHARE → 주인 다시 → INSERT ON CONFLICT → audit) · Agent 표 · 행 잠금 문장 0 · 후보 없으면 BEGIN 0 · 후보 51개 = 한 트랜잭션 INSERT 50 · 나머지 1 = busy · 다음 회차에 들어감 · 트랜잭션 안 주인 다시 보기에서 「이 회사 V 가 그 계정을 떠남(활성 Agent 0)」 · 「활성 Agent 0」 · 「빈 발송ID 생김」 · 「다른 V 생김」 각각 → 쓰기 0 · `busy`.
4. 그 사이 다른 쪽이 넣음(INSERT 0행) → 다시 읽어 same / conflict_existing · 감사 0.
5. `55P03` · `57014` → 그 계정 전부 `busy` · 다른 계정은 계속 · 그 밖 오류 → `sync_error`.
6. 목록 꼴 틀림 · 200 아님 · 시간 초과 → 쓰기 0 · 결과 보내기 0.
7. 결과 몸통에 키 원문 0 · 로그에 키 원문 0.
8. 켜기 = 주소 · 토큰 · 스위치(`true` · `dryrun`) 셋 다일 때만 · 그 밖 값(`1` · `yes` · 빈 값) = 꺼짐(`server.js` 글자 대조 · 거울 일꾼과 같은 꼴 · 종료 목록 포함).
9. `dryrun` = 같은 판정에서 넣을 후보가 `would_register` · BEGIN · INSERT · audit · 결과 보내기 0.
10. 로그 = 결과가 바뀐 항목만 한 줄 · 같은 결과 두 번째 회차엔 줄 0 · 키 원문 0.
11. 넣는 행 `created_by` = `hanjul-template-sync:<회사 id>` · `updated_by` = `hanjul-template-sync`.
12. ⑨ 로그 = 경보 대상 결과가 남은 항목은 6시간마다 다시 한 줄(가짜 시계).
13. 일꾼 소스에 kakao_template_map 의 UPDATE · DELETE 문장 0 · kakao_sender_profile 쓰기 문장 0(소스 대조).

한줄로(vitest + 실 PG):
1. `parseBitoTemplateResults` = 틀린 꼴 하나라도 null(UUID · V · 결과 이름 · 배열 · 길이 상한).
2. 경보 고르기 = 경보 대상 여섯만 · 항목 키 꼴 둘 · 경보 글 = 고정 종류 이름 둘 중 하나(숫자 · 회사 · V · 코드 0) · 여섯 결과가 한 번에 다 와도 실제 `alertPassFailures` 문자 본문(가짜 send)에 두 종류가 다 실림 · 경보 아님 아홉은 0.
3. 입구 = 토큰 ENV 없음 503 · 출발지 밖 403 · 토큰 틀림 401(두 입구 모두 · 거울 입구와 같은 함수).
4. 실 PG `listBitoTemplateCompanies` = V 회사만 · 템플릿 0 회사 포함 · 승인만 · `Tm…`(앞 공백 포함) 빼기 · 중지 프로필(둘 중 한 칸만 꺼진 경우 · `is_active` NULL 포함) 빼기 · **다른 회사 프로필을 가리키는 템플릿 빼기** · 빈 키 · 공백뿐인 키 빼기 · B 발송ID 회사 빼기.
5. `isImcInternalTemplateKey` 를 쓰는 기존 두 자리 = 기존 시험 그대로 초록.

---

## 7. 미검증 · 범위 밖 기록

미검증(켜기 전 §5 로 확인):
- 베네통 고객 행 `K_TEMPLATE_CODE` 가 한줄로 `template_code` 와 같은 값인가 = C · D 의 `same` 수로 확인(서팀장 붙여넣기는 「인비토코드 = 템플릿코드」 판정을 통과한 값).
- 한줄로 `profile_key` 와 비토 `sender_key` 가 같은 글자인가 = key8 로 확인.
- 비토 운영 `GW_INGRESS_PROFILE_TTL` 값(기본 1초 · 운영 override 여부).
- 베네통 Agent 의 `pay_cust_id` 와 한줄로 `company_agent_ids` 의 V 가 같은가 = A · B.
- 한줄로 nginx `client_max_body_size`(저장소에 설정 없음) · 결과 POST 몸통 = 템플릿 1건당 약 200바이트 × V 수(베네통 155건 ≈ 30KB) · 넘으면 그 회차 경보만 빠지고 넣기는 그대로 · 발신번호 거울 결과 POST 와 같은 길.

범위 밖(착수 0 · 기록만):
- [범위 밖] 한줄로에서 삭제된 템플릿의 비토 연결 정리(지금처럼 손 작업).
- [범위 밖] **비토 발송계정 주인 이전(Agent 재배정 · V 를 다른 고객 계정 Agent 에 줌) 때 등록부 정리를 확인하는 장치 없음** = 옛 고객 프로필 · 기본 프로필 · 손 연결 · (이 기능 이후) 자동 연결이 남아 새 주인 Agent 의 키 없는 요청 · 그 키를 실은 요청이 옛 고객 키로 접수될 수 있다. 이 기능 이전부터 손 연결 · 프로필로 같은 결과가 났다. 정리 근거 = 자동 연결의 `created_by`(원래 회사) · 손 줄의 `created_by`(직원). Codex 설계 2 ~ 6라운드 지적 · 처방 후보(탐지 · 거두기 · Agent 표 잠금)는 일부만 고치거나 이론 사례(재확인과 커밋 사이 수 ms 경합 포함 · 런북 ★1127 ③)라 이 기능에서 뺐다 · 착수 판단 = Harold.
- [범위 밖] `gateway-template-mapping-worker.ts:77-92` 옛 중계 적재 스캔은 내부 키(`Tm…`) · 중지 프로필 템플릿도 적재한다.
- [범위 밖] 비토 관리 화면 템플릿 목록에 「자동 · 손」 표시(지금은 메모 글로 구분).
- [범위 밖] 한줄로 템플릿 화면에 비토 연결 상태 칸.

---

## 8. 구현 · 검증 기록 (1127)

- 리뷰 = Codex 설계 7라운드(Harold 「닫고 구현」 · 3 ~ 6라운드 계정 주인 바뀜 부류는 §7 범위 밖) · 구현 3라운드 approve(1R #1 같은 코드 섞인 키 · #2 연결 획득 실패 회차 중단 → 2R 같은 부류 = 연결 획득 · 트랜잭션 두 단계로 가름 → 3R approve) · 전 라운드 gpt-6.2-sol · high · 하위 에이전트 0(로그 대조).
- 구현 중 설계에서 뺀 것 = ⑦ 재확인의 「이번 회차에 판정한 V 가 아직 있음」(ownedBy 가 이미 「활성 Agent 전부 이 회사 V」 를 보장 · 변이에서 살아남아 군더더기로 확인).
- 한줄로 = tsc 0 · 단위 14,325 전부 통과(도장 대조 포함) · 실 PG 123파일 1,110건 통과(도장 기록) · 목록 SQL 실 PG 시험(운영 덤프 스키마 · is_active NULL · 다른 회사 프로필 · 내부 키 · 공백 키).
- 비토 = 단위 사슬 107 실패 0 · check.sh --pg = GW_PG_CHECK_OK(새 PG 시험이 최종 · 운영 중간 모양 둘 다 통과 · 손 쓰기 계정 FOR UPDATE 중 2초 안에 busy · 일꾼 FOR KEY SHARE 중 엔진 message_request INSERT 안 막힘 · dryrun 쓰기 0 · 후보 상한 50) · 변이 13개 빨간불.
- §5 비교 명령 A · C = 로컬 운영 덤프 DB(t_tpl_closed) · B · D = 일회용 PG 16 + 마이그레이션 107 에서 오류 없이 실행 확인(시험 DB 라 0행).
