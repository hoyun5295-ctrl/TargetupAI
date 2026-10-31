# 싱크에이전트 키 발급 = 설치 서버 공인 IP 필수 · 출발지 등록 한 번에 (설계 · 2026-10-29)

> 접수 = Harold 1029 「그딴 식으로 풀지 말고 싱크에이전트 API 키랑 시크릿 발급할 때 상대 IP 주소 필수로 넣는 걸로 개발 경로를 변경하면 되잖아」 → 「설계서 작성 → 구조체크로 결함 찾아 닫힐 때까지 → Codex 리뷰 닫힐 때까지 → 바로 구현 → 구현 Codex 닫힐 때까지」.
> 상태 = 구조체크 8회차 결함 0(§8) · Codex 설계 3R approve(§9) · 구현 · Codex 구현 3R approve(§10) · 5264fa99 배포 1029(C83 과 한 커밋) · 남은 = 원장 C82-S1 실측.

## 0. 축 대조표

| 접수 항목 | 이 축이 없으면 닫히는가 |
|---|---|
| 키 · 시크릿 발급 때 상대(설치 서버) IP 를 필수로 받는다 | 안 닫힘 — 지금 발급 화면에 IP 칸이 없다 |
| 받은 IP 로 출발지를 등록해 발급한 키가 바로 통한다 | 안 닫힘 — IP 를 받기만 하고 등록이 따로면 지금과 같은 빠뜨림이 남는다 |

빠진 축 0. 엠티 전달(1.7.5)은 이 처방 배포 뒤 엠티 IP 로 발급하는 것으로 닫힌다(이 설계 밖 · Harold 실행).

## 1. 현재 사실 (근거 = 코드)

- 싱크 API 는 인증 단계에서 출발지를 본다: `routes/sync.ts:237` `guardMachineOrigin(req, res, company.id, 'company_agent')` · 판정 `utils/geo-access.ts:351` `evaluateMachineOrigin` — 사설 · 루프백 = 통과 · 등록 행 있음 = 통과 · 없으면 `ORIGIN_ALLOWLIST_ENFORCE_FROM` 시행이면 403 `ORIGIN_NOT_ALLOWED`. 운영은 시행 중(1029 테스트계정 115.138.27.202 `machine_origin_blocked` · Harold 실행 SQL).
- 막히면 에이전트는 이렇게 된다: 마법사 Step 4 AI 매핑 403 → `setup/cli.ts:606` 「AI 매핑 호출 실패 → 로컬 규칙 기반 매핑으로 대체」로 말없이 진행 · 예약 동기화 = `api/retry.ts:89` 401 · 403 재시도 안 함 → 데이터 0.
- 쓸 수 있는 싱크 키가 나오는 곳 = 하나: `routes/admin.ts:6075` `POST /companies/:id/sync-keys/regenerate`(`authenticate` · `requireSuperAdmin` 만 · 등급표 영역 없음) — 새 키 · 새 시크릿 → `UPDATE companies SET api_key, api_secret_hash, api_secret = NULL` → 원문은 응답에만.
  - `utils/company-create.ts:53-57` 회사 생성 = `api_key` 생성 · 시크릿은 `hashSecret(crypto.randomBytes(32)…)` 한 줄에서 해시만 남고 원문은 아무 데도 안 나간다 → 설치에 못 쓰는 키(설치는 늘 재발급을 거친다).
  - `scripts/reset-synthetic-test-company.ts:130` · `scripts/setup-demo-company.ts:228` = 시험 · 시연 회사 시크릿 갱신 · 수집은 서버 안 루프백 → 출발지 판정 사설 통과.
  - `routes/sync.ts:205` = 옛 원문으로 인증한 에이전트의 해시 채우기(`WHERE api_secret_hash IS NULL`) · 새 자격 아님.
- 출발지 등록 = 따로 한 곳: `routes/admin.ts:1147` `POST /geo/exceptions`(`requireAdminArea('geoAccess')` · 범위 · CIDR(`validateCidrToken`) · 사유 필수 · 대상 해석 · 만료) → `INSERT INTO access_origin_allowlist`(:1178) → 감사 `access_origin_exception_granted`.
- 등급표 `utils/admin-role.ts:116` `geoAccess` = super RWD · lead RWD · support NONE. 지금은 support 도 키를 재발급할 수 있고(영역 없음), 출발지 등록은 못 한다.
- 화면 = `packages/frontend/src/components/admin/company-detail/tabs/CompanySyncTab.tsx` — 「API Key 재발급」 → 확인 칸 → `fetch(POST)` 본문 없음 · `res.ok` 아니면 아무 말 없음(:36 · 실패가 화면에 안 닿는다) · `finally` 에서 확인 칸을 닫는다.
- 예외 조회 `hasOriginException`(geo-access.ts:232)은 캐시 없이 매번 DB → 등록 즉시 통한다.
- 시험: `utils/__tests__/agency-lows-closure.test.ts:224` 가 재발급 라우트 글자(감사 `sync_key_regenerate` · `details: { apiKeyTail: newApiKey.slice(-4) }` · 원문 미기록)를 본다.

## 2. 설계

### 2-1 발급 = 한 함수 한 트랜잭션 (`utils/sync-key-issue.ts` 새 CT)

```
issueSyncAgentKeys({ companyId, originIp, actorUserId, req })
  → { ok: true, apiKey, apiSecret, useDbSync, originIp, originCidr, originAdded }
  | { ok: false, status: 400 | 403 | 404, code, error }
```

1. **등급** — `agentOriginRights(actorUserId)`(같은 파일 · `fetchAdminRole` 한 번 → `{ canList: canRead, canIssue: canWrite, canRevoke: canDelete }` 를 `geoAccess` 축으로 · 조회 실패 · 미등록 = support = 셋 다 거짓) 의 `canIssue` 가 거짓이면 403 `ORIGIN_GRANT_FORBIDDEN` 「키 발급은 국외 접근 통제를 바꿀 수 있는 등급만 할 수 있습니다.」. 출발지 승인은 등급표상 super · lead 의 일이라 발급도 같은 등급(아래 2-4). 판정은 효과를 만드는 이 함수 안(LESSONS_BACKEND 0819 「게이트는 효과를 만드는 함수 안」) · 화면용 표시(2-5 출발지 조회)도 같은 함수(판정 한 벌).
2. **IP** — `parseAgentOriginIp(originIp)`(2-2) 실패면 400 `ORIGIN_IP_INVALID` + 사유.
3. **`withTransaction`** —
   - `UPDATE companies SET api_key = $1, api_secret_hash = $2, api_secret = NULL, updated_at = NOW() WHERE id = $3 RETURNING api_key, use_db_sync`(지금과 같은 문장) · 0행이면 404 `COMPANY_NOT_FOUND`(등록 안 함).
   - **이전 발급 출발지 회수** — 그 회사 · `company_agent` · 활성 · 사유 = 발급 표시(`SYNC_KEY_ORIGIN_REASON` = 「싱크에이전트 키 발급 출발지」 · CT 상수 한 곳)인 행 중 이번 cidr 와 같지 않은 행 = `is_active = false`(지우지 않음 · 이력). 재발급은 옛 키를 즉시 끊으므로 옛 키의 설치 서버 출발지도 같이 닫는다 → 발급 행은 회사마다 늘 하나(쌓이지 않는다 · 300건 목록에서 사라진 영구 허용이 남지 않는다 · Codex 설계 1R). 국외 접근 통제에서 다른 사유로 등록한 행은 건드리지 않는다. 사유 글자가 표시다(DDL 0 · 손으로 같은 사유를 적은 행도 발급 행으로 본다 = 이름 그대로의 뜻).
   - 등록 생략 조건 = 그 회사 · `company_agent` · 활성 · **만료 없는**(`expires_at IS NULL`) 행이 이 IP 를 덮음(`$cidr::cidr <<= cidr` · `hasOriginException` 과 같은 덮음 판정 · 값은 2-2 가 만든 `/32` · `/128` 글자 하나만 써서 PG 형 오류가 늘 「type cidr」 꼴 = `isInvalidCidrError` 로 잡힌다) → `originAdded = false`. 만료가 있는 행 · `global` 행만 덮으면 등록한다(그 행이 끝나는 날 다시 막히지 않게). 그 밖 = `insertOriginException(run, …)`(2-3) — 사유 「싱크에이전트 키 발급 출발지」 · 승인자 = 발급한 직원 · 만료 없음.
   - UPDATE 가 회사 행을 잠그므로 같은 회사 동시 발급은 줄을 선다 → 뒤 거래의 중복 확인이 앞 거래의 등록 행을 본다(READ COMMITTED · 문장마다 새 스냅샷).
   - 등록이 실패하면(PG 가 cidr 를 거절 등) 전체 되돌림 = 키도 그대로.
4. **감사(커밋 뒤)** — `sync_key_regenerate`(details = `{ apiKeyTail, originCidr, revokedOrigins }` · 원문 0) + 새로 등록했으면 `access_origin_exception_granted`(details 꼴 = 국외 접근 통제 화면과 같은 `{ scope, companyId, userId, cidr, reason, expiresAt }`) + 회수한 행마다 `access_origin_exception_revoked`(details = `{ reason: '키 재발급 · 새 출발지 {originIp}' }` · 국외 접근 통제 회수와 같은 꼴).

`originIp` 는 타입에서 필수 → 이 함수를 부르는 곳이 IP 를 빼먹으면 tsc 가 막는다.

### 2-2 IP 판정 (`geo-access.ts` `parseAgentOriginIp` 새 CT)

- 빈 값 = 「설치 서버의 공인 IP를 입력해주세요.」
- `/` 가 있으면 = 「IP 하나만 입력해주세요. 대역은 국외 접근 통제 화면에서 등록합니다.」
- **뜻으로 풀어 한 꼴로**(Codex 설계 1R — `normalizeIp` 는 소문자 `::ffff:` 접두만 걷어, `0:0:0:0:0:ffff:cb00:710a` 는 IPv6 /128 로 등록되고 같은 서버 요청 `203.0.113.10` 은 IPv4 로 조회돼 등록 뒤에도 403 · 확장형 루프백 `0:0:0:0:0:0:0:1` 은 `isPrivateIp` 를 지나간다):
  - IPv4 글자(`d.d.d.d`) = 자리마다 10진 숫자로 다시 써서(`010.1.2.3` → `10.1.2.3` · 255 초과 = 형식 아님).
  - `:` 가 있으면 = ① `new URL('http://[' + 입력 + ']/').hostname`(소문자 · 0 줄임 · Node 내장 · 새 의존성 0 · 못 풀면 형식 아님) ② 양끝 대괄호를 벗긴다(hostname = `[::1]` 꼴) ③ `::ffff:XXXX:XXXX`(IPv4-mapped · 각 1~4자리 16진) 이면 IPv4 로 바꾼다.
  - 순서 = 표준 꼴 → (mapped 면 IPv4) → `::` · 사설 판정 → cidr(Codex 설계 2R).
  - 형식 아님 · `::`(지정 안 된 주소) = 「IP 주소 형식이 아닙니다.」
- 위 표준 꼴로 `isPrivateIp`(기존) = 「사설 주소입니다. 설치 서버가 밖으로 나갈 때 쓰는 공인 IP를 입력해주세요.」 — ipconfig 의 192.168 · 10 주소를 넣는 실수가 가장 흔하다. 등록해도 서버가 보는 주소가 아니다(표준 꼴이라 확장형 루프백 · 대문자 mapped 사설도 걸린다).
- 결과 = IPv4 `/32` · IPv6 `/128` + 표준 꼴 IP 글자(`originIp`). PG 형 거절은 이제 거의 없지만 남으면 400.
- `normalizeIp` · `isPrivateIp` 자체는 바꾸지 않는다(로그인 · 기계 판정이 같이 쓴다 · 넓히면 판정이 바뀐다 · 요청 쪽 `req.ip` 는 Express 가 준 소문자 꼴).

### 2-3 출발지 등록 INSERT = 한 벌 (`geo-access.ts` `insertOriginException` 새 CT)

- 지금 `admin.ts:1178` 의 INSERT 문장을 그대로 옮긴다(컬럼 · 순서 · `$4::cidr` · `reason.slice(0, 500)` · `NOW()` · `is_active = true`) · 실행자(`run`)를 받아 트랜잭션 안에서도 쓴다.
- 국외 접근 통제 라우트 = 이 CT 를 부른다(동작 같음 · 중복 확인 없음 그대로 · 감사 그대로).
- 새 컬럼 0 · 새 표 0 — `companies` · `access_origin_allowlist` 의 지금 운영에서 도는 두 문장과 같은 컬럼만.

### 2-4 등급

- 재발급 = `geoAccess` 쓰기 등급(super · lead). support 는 403 `ORIGIN_GRANT_FORBIDDEN`(2-1 문장)으로 막히고, 화면은 그 전에 버튼 대신 같은 이유 한 줄을 보인다(2-6) — 지금 support 가 하던 재발급이 막힌다 = Harold 1029 채택 · 추천 1.
- 출발지 조회 = `geoAccess` 조회 등급 · 회수 = 지금 국외 접근 통제 회수 라우트(`DELETE /geo/exceptions/:id` · `requireAdminArea('geoAccess')` = 삭제 등급) 그대로.
- 키 조회(`GET /sync-keys`) · 사용 토글(`PUT /sync-keys`) = 등급 · 응답 그대로.

### 2-5 라우트 (`admin.ts:6075`)

- 본문 = `issueSyncAgentKeys({ companyId: req.params.id, originIp: req.body?.originIp, actorUserId: req.user?.userId, req })` 를 부르고 결과만 옮긴다. `ok: false` = `status` · `{ error, code }`.
- 성공 응답 = 지금 꼴 그대로(`syncKeys: { api_key, use_db_sync, api_secret, has_secret: true }` · `secretShownOnce: true`) + `originIp` · `originCidr` · `originAdded` · 문장 = 등록했으면 「… 접속 허용 IP {originIp} 를 국외 접근 통제에 함께 등록했습니다 …」 · 이미 덮여 있었으면 「… 접속 허용 IP {originIp} 는 국외 접근 통제에 이미 허용되어 있습니다 …」(대역 행이 덮는 경우도 맞는 말) · 회수한 행이 있으면 「이전 발급 출발지 N개는 회수했습니다.」 한 문장 더(응답 `revokedOrigins` = 회수한 cidr 목록)(앞뒤 = 「API Key가 재발급되었습니다. 기존 키는 즉시 무효화됩니다.」 · 「시크릿은 지금만 확인할 수 있으니 복사해 두세요.」 · IP 는 `/32` 접미 없이).
- catch = 지금 `isMissingSchemaError` 503 그대로 + `isGeoSchemaMissing` 503(`GEO_MIGRATION_HINT`) + `isInvalidCidrError` 400 「IP 주소 형식이 아닙니다.」.
- **새 조회 `GET /companies/:id/sync-origins`**(`authenticate` · `requireSuperAdmin`) = CT `listAgentOrigins(companyId, actorUserId)` → `{ canIssue, canRevoke, enforced, origins }`(`enforced` = `isOriginAllowlistEnforced()` · 기존 시행 스위치 판정 그대로). `canList` 거짓(support) = `{ canIssue: false, canRevoke: false, enforced, origins: [] }`(200 · 화면을 단순하게 · 행은 안 내보냄). 참 = **그 회사**의 `company_agent` 활성 행 전부(회사 조건으로 거른 뒤 · 전체 300건 목록과 무관 · 회사 하나의 행은 몇 개라 상한 없음) — `id` · 표준 꼴 IP(`host(cidr)`, 대역이면 `host/masklen`) · `reason` · `approved_at` · `expires_at` · `is_expired`(만료됐지만 활성인 행도 보임) · 정렬 = 승인 시각 최신 먼저. catch = `isGeoSchemaMissing` 503.
  - 이것이 Codex 설계 1R · 2R 「목록 300건 밖 활성 허용을 못 찾는다」의 처방 자리다 — 발급한 화면에서 그 회사 것을 다 보고 그 자리에서 회수한다.

### 2-6 화면 (`CompanySyncTab.tsx`)

- 확인 칸(「정말 재발급하시겠습니까?」) 안에 「설치 서버 공인 IP」 입력(필수 · 자리표시 예 = 문서용 주소 `203.0.113.10`) + 한 줄 「이 IP에서 오는 싱크에이전트 접속만 받습니다. 발급과 함께 국외 접근 통제에 등록되고, 이전 발급 때 등록한 IP는 회수됩니다.」 — 되돌릴 수 없는 일(기존 키 무효)이라 이 한 단계는 둔다(CLAUDE.md `marketing_user_ux_priority` 허용 조건).
- 빈 칸이면 「재발급 확인」 잠김.
- 요청 = `Content-Type: application/json` · 본문 `{ originIp }`.
- 실패 = `showAlert('재발급 실패', 서버 error, 'error')` · 확인 칸과 입력값은 남긴다(고쳐서 다시 누르게) · 성공일 때만 확인 칸을 닫고 입력을 비운다.
- 입력값 상태 = 이 탭 안 `useState`(탭을 옮기면 비워짐 · 발급 전 잠깐 쓰는 값).
- **접속 허용 IP 칸**(키 칸 아래 · 사용 토글이 꺼져 흐려지는 키 영역 **밖** = 꺼져 있어도 보고 회수한다 · 이 탭이 열릴 때 · 재발급 성공 뒤 · 회수 뒤 `GET /sync-origins` 를 부른다 · 상태 = 이 탭 안 · 부모 상태 타입 변화 0):
  - 행마다 = IP · 사유 · 등록일(만료 있으면 만료일 · 지난 행은 「만료」 표시) · `canRevoke` 면 「회수」 → 그 행 안에서 한 번 더 확인(native dialog 0) → `DELETE /api/admin/geo/exceptions/{id}`(본문 사유 「싱크 탭에서 회수」) → 다시 조회 · 회수 실패 = 서버 error 알림.
  - 행이 없으면 = 「이 회사 전용 접속 허용 IP가 없습니다.」 + `enforced` 참 = 「출발지 통제가 켜져 있어 등록되지 않은 곳의 싱크에이전트 접속은 막힙니다.」 · 거짓 = 「지금은 기록만 하고 막지 않지만, 통제가 켜지면 막힙니다.」 + 「재발급할 때 설치 서버 IP를 넣으면 등록됩니다.」(global 임시 행이 덮는 경우에도 맞는 말).
  - 조회 실패 = 칸 안에 한 줄 「접속 허용 IP를 불러오지 못했습니다.」 + 「다시 불러오기」(키 칸은 그대로 · 발급 버튼은 조회가 성공해 `canIssue` 를 받은 뒤에만).
- `canIssue` 가 거짓이면 「API Key 재발급」 버튼 자리에 한 줄 「키 발급은 국외 접근 통제를 바꿀 수 있는 등급만 할 수 있습니다.」(누를 수 없는 버튼 · 입력 뒤 거절 = 이유 없는 중간 단계 0) · 조회 응답 전에는 버튼을 그리지 않는다(값 = 서버가 준 것만 · 화면이 등급을 다시 계산하지 않음).
- native dialog 0 · 모델명 0 · 줄표 · 가운뎃점 0.

## 3. 영향표 (쓰기 · 읽기 · 화면)

| 자리 | 읽기/쓰기 | 바뀜 |
|---|---|---|
| `admin.ts:6075` 재발급 | 쓰기(키) | 본문 → CT 호출 · IP 필수 · 등급 geoAccess |
| `admin.ts:1147` 예외 등록 | 쓰기(출발지) | INSERT 만 CT 로 · 응답 · 감사 · 검사 그대로 |
| `admin.ts:6051` 키 조회 · `:6121` 사용 토글 | 읽기 · 쓰기(use_db_sync) | 0 |
| 새 `GET /companies/:id/sync-origins` | 읽기(출발지 · 회사 하나) | 새로 |
| `admin.ts:1202` 회수(`DELETE /geo/exceptions/:id`) | 쓰기(출발지) | 0 — 싱크 탭이 같은 라우트를 부른다(등급 · 감사 그대로) |
| `AdminDashboard.tsx:365` · `CompanyDetailModal.tsx` | 화면 상태 | 0(출발지 · 등급 표시는 탭 안 상태) |
| `company-create.ts` · 게이트웨이 일괄 생성(같은 CT) | 쓰기(못 쓰는 키) | 0 |
| `scripts/reset-synthetic-test-company.ts` · `setup-demo-company.ts` | 쓰기(시크릿 · 루프백) | 0 |
| `sync.ts:205` 해시 채우기 · `:237` 출발지 검사 | 쓰기 · 읽기 | 0 |
| `geo-access.ts` `hasOriginException` · `evaluateMachineOrigin` | 읽기(출발지) | 0(새 행을 그대로 읽는다) |
| 국외 접근 통제 화면 `GeoAccessTab.tsx`(목록 · 회수) | 읽기 · 쓰기(회수) | 0 — 발급 행은 사유 「싱크에이전트 키 발급 출발지」로 보이고, 재발급으로 회수된 행은 비활성으로 남는다(목록 정렬 = 활성 먼저 · 지금 그대로) |
| `CompanySyncTab.tsx` | 화면 | IP 입력 칸 · 실패 표시 · 접속 허용 IP 칸(조회 · 회수) · 등급 표시 |
| `agency-lows-closure.test.ts:224` | 시험 | 감사 자리가 CT 로 옮겨 감 → 시험이 CT 를 읽게 · details 꼴 = `{ apiKeyTail, originCidr, revokedOrigins }`(출발지 · 회수 목록이 더해짐) · 원문 미기록 판정 그대로 · 토글 줄(:232) = 바뀜 0 |
| 돌고 있는 에이전트 · 기존 키 · 기존 출발지 행 | — | 0(재발급하는 순간에만 바뀜 · 지금과 같음) |

## 4. 뿌리

- **R29 신설 「출입 통제를 켰는데 자격 발급 자리에 배선하지 않음」** — 출발지 통제(0819 · 시행 스위치)를 만들 때 「통제가 걸리는 곳」(sync 인증 단계)만 배선했고 「쓸 수 있는 자격이 생기는 곳」(재발급)은 통제를 몰랐다 → 발급한 키가 조용히 막힌다. 판정 기준 = 쓸 수 있는 싱크 자격(`api_key` · `api_secret_hash` 를 쓰는 SQL)이 생기는 곳은 출발지 등록과 한 함수 · 한 트랜잭션.
- 계약 시험(기계로 뽑음) = `packages/backend/src` · `packages/backend/scripts` 의 비시험 `.ts` · `.js` · `.mjs` 에서 `companies` 의 `api_key` · `api_secret_hash` · `api_secret`(옛 원문 칸 · `sync.ts` 인증이 해시 없는 회사에 아직 받는다 · Codex 설계 1R) 를 쓰는 문장 전수 →
  - `api_secret` = `NULL` 로 비우는 쓰기만 어디서나 허용 · 값을 넣는 쓰기 = 실패(옛 원문 발급 길 0).
  - `api_key` · `api_secret_hash` = 허용 `utils/sync-key-issue.ts`(발급) · 면제(이유 줄) = `utils/company-create.ts`(원문을 아무 데도 안 내보냄 · 그 한 줄 꼴을 시험이 확인) · `routes/sync.ts` 해시 채우기(`api_secret_hash IS NULL` 조건 · 이미 증명한 원문의 해시) · 두 스크립트(루프백).
  - 그 밖이 나오면 실패. `INSERT INTO access_origin_allowlist` = `geo-access.ts` 한 곳(R1).
- 같은 뿌리 다른 기능(전수 grep): 자사몰 SDK 키 `utils/cdp-auth.ts:121`(`company_api` · 시행이면 같은 막힘) = **이번 축 밖 · 추가 과제**(몰 서버는 호스팅 따라 고정 IP 가 없는 곳이 많아 「IP 필수」를 따로 정해야 한다 · Harold 1029 채택 · 추천 3) · 대장에 알려진 빈칸으로 적는다. 플러그인 키(`woocommerce.ts:458` · `company_plugin`) = 기본 기록만(회사가 그 범위를 등록했을 때만 막음) → 조용한 막힘 없음 = 해당 없음.

## 5. 시험 (빨강 먼저 · 기대값 = 손으로 정한 값 · 주소 = 문서용 대역 203.0.113.0/24 · 2001:db8::/32)

1. `parseAgentOriginIp` — 빈 값 · 대역 · 형식 아님(`abc` · `1:2:3:4:5:6:7:8:9` · `::` · `fe80::1%eth0`) · 사설(192.168.0.10 · 10.0.0.1 · 127.0.0.1 · fe80::1 · 확장형 `0:0:0:0:0:0:0:1` · `::FFFF:192.168.0.10` · `010.001.002.003`(= 10.1.2.3)) 거절 · `203.0.113.10` → `203.0.113.10/32` · 앞뒤 공백 · `203.000.113.010` → `203.0.113.10/32` · `::ffff:203.0.113.10` · `::FFFF:203.0.113.10` · `0:0:0:0:0:ffff:cb00:710a` → 전부 `203.0.113.10/32` · `2001:DB8:0:0:0:0:0:1` → `2001:db8::1/128`. + 등록한 cidr 를 `evaluateMachineOrigin` 이 같은 서버 요청 꼴(`203.0.113.10` · `::ffff:203.0.113.10`)로 통과시키는지(실 PG).
2. 실 PG(`sync-key-issue-1029.pg.test.ts` · 등급은 `admin-role` 흉내) — 성공 = 키 바뀜 · 해시가 원문과 맞음 · 출발지 행 1(company_agent · cidr · 활성 · 사유) / 같은 IP 다시 = 행 그대로 1 · 키는 또 바뀜 · 회수 0 / 다른 IP = 새 행 활성 · 옛 발급 행 비활성 · 국외 접근 통제 사유 행은 그대로 활성 / 만료 없는 대역 행이 덮음 = 등록 생략 · 만료 있는 행만 덮음 = 등록 / 회사 없음 = 404 · 행 0 / support = 403 · 키 그대로 · 행 0 / 등록 실패를 일으켜(트랜잭션 안 INSERT 를 실패시키는 시험 자리) = 던짐 · 키 그대로 · 회수도 되돌림.
   + `agentOriginRights` = super · lead 셋 다 참 · support · 미등록(조회 0행) 셋 다 거짓.
   + `listAgentOrigins` = 다른 회사 활성 행 301개를 승인 시각 더 최신으로 넣은 뒤에도 그 회사 발급 행이 보이고, 그 id 로 회수(국외 접근 통제 회수 문장)하면 다음 조회에서 빠지고 출발지 판정이 막힘으로 바뀜 · 다른 회사 · global · 비활성 행은 안 보임 · support = 빈 목록.
3. 소스 계약 — 라우트가 CT 를 `req.body?.originIp` 로 부름 · `admin.ts` 에 `SET api_key` 0 · 새 조회 라우트가 `listAgentOrigins(` 만 부름 · 화면이 본문에 `originIp` · 빈 칸 잠금 · 실패 알림 · 성공일 때만 닫음 · `canIssue` 거짓 = 버튼 대신 이유 한 줄 · 회수 = `geo/exceptions/` DELETE · 재발급 · 회수 뒤 다시 조회 · 접속 허용 IP 칸이 흐림 감싸기 밖 · `enforced` 두 문구 · 조회 실패 = 다시 불러오기 · 발급 버튼은 조회 성공 뒤에만.
4. R29 · R1(INSERT 한 곳) 계약 · `agency-lows-closure` 를 CT 로.
5. 변이(파일 복사) — IP 검사 제거 · mapped 를 IPv4 로 안 바꿈 · 중복 확인 제거 · 회수 제거 · 등록을 트랜잭션 밖으로 · 등급 검사 제거 · 화면 본문에서 originIp 제거 · 아무 라우트에 `UPDATE companies SET api_secret = $1` 추가 · `api_key` 쓰기 추가 → 각각 실패 확인.
6. backend tsc 0 · vitest 전체 · test:pg 전체.

## 6. 하지 않는 것 (기록만)

- 자사몰 SDK 키 발급의 IP 필수(§4 · 추가 과제).
- 발급한 IP 가 틀렸을 때(설치 서버가 다른 주소로 나감) = 여전히 막힌다 · 막힌 주소는 `audit_logs` `machine_origin_blocked` 에 남는다 · 싱크 탭에 「최근 막힌 접속 주소」를 보이는 일은 따로.
- 마법사 403 무음 내려감(에이전트 쪽 · 1.7.5 설계서 §9-5) · 출발지 여러 개 · 대역 = 국외 접근 통제 화면.
- 한 회사가 에이전트 서버를 둘 이상 둘 때(키는 회사에 하나) = 두 번째 서버는 국외 접근 통제에서 다른 사유로 등록(재발급 회수 대상 아님).
- 국외 접근 통제 목록 자체가 최신 300건만 보이는 것(`admin.ts:1135`) = 그 화면의 한계로 남는다 · 싱크에이전트 출발지는 싱크 탭이 회사 단위로 다 보이고 회수한다(2-5 · 2-6) · 사용자 · global · 자사몰 범위 행의 회사별 조회 · 쪽 나눔은 따로.

## 7. 결정 (Harold 1029 「설계서 → 구조체크 → Codex → 바로 구현」 = 추천 채택)

1. support 등급 재발급 막음(출발지 승인과 같은 등급).
2. 발급 때 IP 한 개만(대역 = 국외 접근 통제).
3. 자사몰 SDK 키 = 이번 축 밖.

## 8. 구조체크 진행표

(회차마다 = 설계서를 코드 경로에 대고 결함을 적는다 · 결함 0 회차가 나올 때까지)

| 회차 | 결함 | 처방(설계서 반영 자리) |
|---|---|---|
| 1 | K1 support 가 확인 칸을 열고 IP 를 넣은 뒤에야 403 = 이유 없는 중간 단계 · 403 문장이 등급 화면 일반 문장 | 판정 함수 `canIssueSyncKeys` 하나 · 조회 응답 `can_issue` · 거짓이면 버튼 자리에 이유 한 줄 · 403 문장 = 발급 사유(2-1 · 2-5 · 2-6) |
| 1 | K2 중복 확인이 같은 cidr 글자만 봄 — 넓은 대역 행이 이미 덮으면 쓸모없는 /32 를 더하고, 만료 있는 행 · global 행만 덮을 때 생략하면 그 행이 끝나는 날 다시 막힌다 | 생략 = 그 회사 company_agent · 활성 · 만료 없는 행이 덮을 때만(`<<=`)(2-1) |
| 1 | K3 응답 문장의 IP 를 어디서 만드는지 없음(cidr 에서 글자 잘라내기 = 새 결함원) | CT 가 `originIp` 도 돌려줌 · 문장 = 등록 · 이미 등록 두 꼴(2-1 · 2-5) |
| 1 | K4 사용 토글 응답에 `can_issue` 가 없어 토글 한 번에 버튼이 사라짐 | 토글이 이전 값을 이어 둠 · 상태 타입 다섯 곳(2-6) |
| 1 | K5 PG 가 IPv6 꼴을 거절할 때 라우트 문장 없음 | `isInvalidCidrError` 400 「IP 주소 형식이 아닙니다.」(2-5) |
| 1 | K6 등급 조회 실패 때 열림/닫힘이 안 적힘 | `fetchAdminRole` 실패 · 미등록 = support = 닫힘(2-1 · 지금 CT 동작 그대로) |

| 2 | K7 영향표가 1회차 처방(조회 응답 `can_issue` · 상태 타입 다섯 곳)을 안 실음 | §3 행 셋으로 나눔 |
| 2 | K8 시험 절에 `can_issue` · 토글 이어 두기 · 등급 판정 함수 시험 없음 | §5-2 · §5-3 |
| 2 | K9 중복 확인을 `$ip::inet` 로 쓰면 PG 가 거절한 IPv6 가 「type inet」 오류 = `isInvalidCidrError` 가 못 잡아 500 | 덮음 판정도 `/32` · `/128` 글자를 `::cidr` 로(2-1) |
| 2 | K10 「이미 등록되어 있습니다」 = 대역 행이 덮은 경우와 안 맞는 말 | 「이미 허용되어 있습니다」(2-5) |

| 3 | K11 §2-4 가 2-1(403 문장) · 2-5(조회 응답 `can_issue`)와 어긋남 | §2-4 고침 |
| 3 | K12 영향표가 감사 details 꼴이 바뀌는 것 · 토글 시험 정규식을 안 적음 | §3 시험 행 |
| 4 | 0 — 2-1 ~ 2-6 · §3 · §5 를 코드 줄(sync.ts:237 · admin.ts:1147 · :6051 · :6075 · :6121 · geo-access.ts:139 · :149 · :232 · :351 · admin-role.ts:229 · :268 · CompanySyncTab.tsx 전부 · CompanyDetailModal.tsx:135-143 · AdminDashboard.tsx:365 · agency-lows-closure.test.ts:222-235)에 다시 대 봄 · 실패 경로(등급 조회 실패 · 회사 없음 · PG cidr 거절 · 동시 발급 · 탭 안 로딩 중 입력값) 전부 처방 있음 | — |

| 5 | (Codex 설계 1R 처방 뒤) K13 영향표 감사 details 꼴에 `revokedOrigins` 빠짐 · 확인한 것 = 트랜잭션 안 순서(UPDATE 0행 = 404 로 끝 · 회수 · 덮음 · 등록 순 · 회수 대상 = 발급 사유 · 이번 cidr 와 다른 행만 → 같은 IP 재발급은 그 행이 남아 덮음 판정에 잡힘) · 403 · 400 은 트랜잭션 전 · Node URL 표준 꼴 실측(`::ffff:203.0.113.10` · `::FFFF:…` · `0:0:0:0:0:ffff:cb00:710a` → `[::ffff:cb00:710a]` · `0:0:0:0:0:0:0:1` → `[::1]` · `2001:DB8:0:0:0:0:0:1` → `[2001:db8::1]` · `::` → `[::]` · 9칸 · 영역 id = 오류 · Node 20.19.4) | §3 시험 행 |
| 6 | 0 — 2-1 회수 · 2-2 파서 · 2-5 문장 · 2-6 문구 · §3 · §4 `api_secret` · §5 · §6 을 코드 줄(admin.ts:1116-1135 목록 · :1202-1223 회수 · sync.ts:178-207 인증 · secret-hash.ts)에 다시 대 봄 | — |

| 7 | (Codex 설계 2R 처방 뒤) K14 접속 허용 IP 칸이 사용 끔 때 흐려지는 키 영역 안이면 끔 상태에서 회수 못 함 · K15 조회 실패 때 발급 버튼이 영영 안 그려짐(다시 부를 길 없음) · K16 「모두 막힙니다」 = 시행 스위치가 꺼진 동안 · global 행이 덮을 때 틀린 말 | 칸을 키 영역 밖으로 · 「다시 불러오기」 · 응답 `enforced` + 두 문구 · 「이 회사 전용 … 없습니다」(2-5 · 2-6) · 1회차 K1 · K4 · 2회차 K7 · K8 · 3회차 K11 의 `can_issue` 처방은 설계 2R 로 걷어냄(이 줄 위 기록은 이력) |
| 8 | 0 — 2-1 등급 함수 · 2-2 순서 · 2-4 · 2-5 새 조회 · 2-6 칸 · §3 · §5 를 코드 줄(admin.ts:1202-1223 회수 = id 만 보는 문장 · 싱크 탭이 주는 id = 회사로 거른 목록의 것 · CompanySyncTab.tsx:80-100 로딩 · 흐림 감싸기 · geo-access.ts:325 시행 스위치)에 다시 대 봄 | — |

- 1회차 기록만(범위 밖): 국외 접근 통제 라우트(`admin.ts:1147`)는 PG 가 거절한 IPv6 를 500 으로 돌려준다(`validateCidrToken` 주석은 「호출부가 400 으로」 라고 적었으나 그 catch 에 `isInvalidCidrError` 없음) — INSERT 만 옮기고 그 catch 는 그대로 둔다.

## 9. Codex 진행표

| 라운드 | 지적 | 판정 · 처방 |
|---|---|---|
| 설계 3R | **approve**(지적 0 · 회사별 조회 · 회수 권한 · IPv6 순서 · can_issue 제거 일관) | 설계 닫힘 → 구현 |
| 설계 2R | medium 2 — ① URL hostname 대괄호 벗기는 단계가 없음 · 시험 `010.001.002.003` 은 10.1.2.3 = 사설 ② 회사마다 발급 행 하나여도 회사가 301곳이면 전체 300건 목록 밖 → 1R 지적 안 닫힘 | 둘 다 수용. ① 순서 명시(표준 꼴 → 대괄호 → mapped → `::` · 사설 → cidr) · 시험 기대값 고침(2-2 · §5) ② **같은 부류 두 번 = 왜 반복**: 이 기능이 영구 허용 행을 만들면서 그 행을 보고 닫는 자리를 기능 밖(전체 목록 화면)에 맡겼다 → 처방 = 발급하는 싱크 탭이 그 회사 출발지를 회사 단위로 조회 · 회수(`GET /sync-origins` · 기존 회수 라우트) · 그 조회가 등급(`canIssue` · `canRevoke`)도 돌려줘서 1회차 K1 · K4 로 덧댄 `can_issue` 배관(조회 응답 · 부모 상태 타입 다섯 곳 · 토글 이어 두기)을 걷어냄 · 회수 자동화(1R ②)는 남김(옛 키 = 옛 서버 · 같이 닫는 게 발급의 뜻) |
| 설계 1R | medium 3 — ① IPv4-mapped · 확장형 IPv6 가 요청 꼴과 다른 계열로 등록돼 등록 뒤에도 403 · 확장형 루프백 통과 ② 옛 출발지를 「국외 접근 통제에서 회수」 하라는데 그 목록은 최신 300건만 → 쌓이면 못 찾는 영구 허용 ③ R29 가 옛 `api_secret` 쓰기를 안 봄(해시 없는 회사는 원문 인증 가능) | 셋 다 수용. ① 발급 파서가 뜻으로 풀어 한 꼴(URL 표준 꼴 · mapped → IPv4 · 그 꼴로 사설 판정)(2-2) ② 뿌리 = 발급 행이 쌓이는 것 → 재발급이 이전 발급 출발지를 회수(발급 행 = 회사마다 하나)(2-1) · 300건 목록 자체는 지금부터 있던 한계로 기록(§6) ③ `api_secret` 은 NULL 쓰기만 허용(§4) · 시험 · 변이 더함(§5) |

## 10. 구현 기록

### 10-1 바뀐 곳

- 새 `packages/backend/src/utils/sync-key-issue.ts` — `SYNC_KEY_ORIGIN_REASON` · `agentOriginRights` · `issueSyncAgentKeys`(등급 → IP → 한 트랜잭션 = 키 UPDATE · 이전 발급 회수 · 덮음 확인 · 등록 → 커밋 뒤 감사 세 종류) · `listAgentOrigins`.
- `packages/backend/src/utils/geo-access.ts` — `canonicalIp`(IPv4 10진 · IPv6 URL 표준 꼴 · mapped → IPv4 · 글자 집합 거름) · `parseAgentOriginIp` · `insertOriginException`(옛 admin.ts INSERT 문장 그대로) · `TxRun` import.
- `packages/backend/src/routes/admin.ts` — 국외 접근 통제 등록 = INSERT 만 CT · 새 `GET /companies/:id/sync-origins` · 재발급 라우트 = CT 결과만 옮김(catch = `isInvalidCidrError` 400 · 스키마 부재 503 두 갈래) · `hashSecret` import 정리.
- `packages/frontend/src/components/admin/company-detail/tabs/CompanySyncTab.tsx` — IP 칸 · 실패 표시 · 접속 허용 IP 칸(조회 · 회수 · 흐림 밖 · 시행 두 문구 · 다시 불러오기) · 요청 셋 = `fetchAuthJson`(lib/auth-download · 본문까지 20초) · 조회 = 차례 하나 · 탭 인스턴스 수명(`alive`) · 결과 불명 = 다시 조회 · 불러오는 동안 버튼 잠금.
- `packages/frontend/src/components/admin/company-detail/CompanyDetailModal.tsx` — `<CompanySyncTab key={editCompany.id}>`(상태 주인 = 회사 · 설계 §3 「화면 상태 0」 에서 한 줄 늘어남 · Codex 구현 1R).
- 시험: 새 `sync-key-origin-1029.test.ts`(파서 · 라우트 · 화면 계약) · 새 실 PG `sync-key-issue-1029.pg.test.ts`(9) · `sync-key-issue-rollback-1029.pg.test.ts`(1) · `root-ledger.test.ts` R29(수집기 = 구문 트리 상수 · 접기 · 동적 분류 · 반례) · `agency-lows-closure.test.ts`(감사 자리 = CT).
- 문서: `docs/ROOT-LEDGER.md` R29 줄 · 이력 줄.

### 10-2 검증

- 빨강 먼저 = 새 시험 38건 실패 확인 → 초록.
- backend tsc 0 · frontend tsc 0 · backend vitest 721파일 10,626건(새 pg 시험 스탬프 2건 = 전체 test:pg 뒤 해소 · pg-test-stamp 28 통과) · 실 PG 15파일 75건(덤프 해시 = 운영과 같은 t_tpl_closed · 쓴 컬럼 실재 확인 겸함) · 영향 시험 3파일 257건.
- 변이(파일 복사 · 되돌림 바이트 대조) M1~M18 전부 잡힘 — IP 검사 · mapped 변환 · 덮음 확인 · 회수 · 트랜잭션 밖 등록 · 등급 · 화면 본문 · api_secret 값 쓰기 · api_key 쓰기 · 사설 판정 · 응답 뒤 차례 확인 · 탭 key · 따옴표 값 뒤 api_key · 동적 SET 파일 자격 칸 이름 · 발급 응답 뒤 살아 있음 · 결과 불명 재조회 · 이어 붙인 api_key · 변수 머리 이어 붙임.
- 화면 자가 검사 = 모델명 · native dialog · 줄표 · 가운뎃점 0.

### 10-3 Codex 구현 진행표

| 라운드 | 지적 | 판정 · 처방 |
|---|---|---|
| 구현 1R | (첫 잡 = 런처째 약 4분에 종료 · 결과 없음 · 잡 pid 없음 → 레코드 cancelled · 시간 상한 주고 재실행) medium 2 — ① 늦게 온 조회가 최신 목록을 덮음 ② R29 SET 수집이 SQL 따옴표에서 끊김 | 수용. ① 메모리 교훈(불러오기 = 한 차례 · 상한 · key)대로 조회 단위 차례 · fetchAuthJson 상한 · 버튼 잠금 · 회사 key ② 판정을 소스 글자 꼴에 맡긴 것이 뿌리 → 구문 트리 상수 + SQL 글자 가림 + 동적 SET 파일 자격 칸 이름 0 · 반례 시험 · 제 검토 1건(회수 문구 「막습니다」 → 「접속 허용에서 뺍니다」) 함께 |
| 구현 3R | **approve**(지적 0) · 범위 밖 2 = 모달 키 조회 `CompanyDetailModal.tsx:143` · 기존 사용 토글 `CompanySyncTab.tsx:153` 에 수명 검사 없음(늦은 응답이 부모 키 상태를 덮을 수 있음 · 이번 변경 전부터 있던 코드 · 같은 부류) | 기록만 · 착수 판단 = Harold |
| 구현 2R | high 1 · medium 2 — ① key 는 탭 안 상태만 바꿈 · 늦은 발급 응답이 부모 키 · 시크릿을 다른 회사 화면에 씀 ② 본문 읽기 시간 넘김을 fetchAuthJson 이 data null 로 삼켜 재조회 없는 실패 갈래 ③ 비어 있지 않은 SET 뒤 이어 붙인 SQL 을 수집 · 동적 분류 둘 다 놓침 | 수용 · **같은 부류 두 번째**(비동기 응답 · R29 수집) → 단위를 넓힘. ①② 요청 셋 모두 탭 인스턴스 수명(alive)으로 부모 상태 쓰기 차단 · data 없음 = 결과 불명 = 다시 조회 ③ 이어 붙임 · 배열 join 을 접고 「끝을 모르는 조립 = 동적」 · SET 에 ${…} 가 있어도 글자 대입은 읽음 |
