# 비토 게이트웨이 × 링크가드 — 접점 피더 (게이트웨이 쪽 소유)

> **이 문서가 소유하는 것** = 비토 게이트웨이 안의 링크가드 훅(정책 게이트 URL 검사)과 관제센터 연결의 **게이트웨이 쪽 전부**: 구조·불변 원칙·계약(ENV·정책 컬럼·응답·이력)·배포 절차·운영 명령·실측 기록·이력.
> **소유하지 않는 것** = 링크가드 제품 자체(관제센터 `linkguard-control`·에이전트 `linkguard-agent`·판정 코어 `pkg/core`·관제 화면·KISA 적재·해시 비밀·설치 안내). 그것은 **`projects/linkguard/docs/FEATURE-LINKGUARD.md`** 가 소유한다(호출어 **링크가드**). 여기서 그 내용을 다시 쓰지 않고 링크한다.
> 상위 = [FEATURE-BITO-GATEWAY.md](../FEATURE-BITO-GATEWAY.md) §9 스포크 9. 게이트웨이 소스 = `C:\Users\ceo\projects\bito-gateway`(커밋 = Harold 승인 후).

## 0. 30초 요약

게이트웨이는 링크가드 **관제센터의 고객 하나**다. 정책 게이트(저장·과금 앞)에서 문자 본문의 URL 을 메모리 대조기로 판정하고, 목록·해시 비밀은 관제센터 sync API 로 15초마다 받으며, 차단·미확인 이력은 hits API 로 보낸다. 차단이면 접수 자체를 `URL_BLOCKED`(403 · 비재시도)로 거절한다. **배포만으로는 아무도 막히지 않는다** — 정책 토글이 off 이거나 관제센터 URL 이 비어 있으면 검사하지 않고, 켜져 있어도 원장에 있는 주소만 막는다.

2026-09-04 .65 배포 완료 · 전역 토글 on · 차단 실측 1건 완료(§6).

## 1. 구조

```
Agent(gRPC) / REST 접수
   └─ engine.acceptOne
        └─ 정책 게이트(policy.go · effectivePolicy)
             ├─ 서비스 정지 · 야간/광고/브랜드 시간 · 한도 · 블록리스트
             ├─ ★ urlGuard.check(policy, msg)  ← internal/gateway/engine/urlguard.go
             │     block   → PolicyError{Code: URL_BLOCKED, HTTPStatus 403, Scope}  → policy_block_event + hits(blocked)
             │     unknown → 통과 · url_guard_unknown_check 이면 hits(unknown_pass)
             │     pass    → 통과
             └─ 중복 판정 · 저장 · 과금
urlGuard.run  ─ 15초(GW_LINKGUARD_REFRESH)마다 관제센터 POST /api/linkguard/v1/sync(since=head) → core.Matcher.Apply
              ─ 5초마다 hits 버퍼 flush → POST /api/linkguard/v1/hits(≤500건 · 실패 시 보관 · 20,000건 상한)
```

| 파일 | 소유 |
|---|---|
| `internal/gateway/engine/urlguard.go` | 관제센터 HTTP 클라이언트(`lgHTTPClient`) · 가드(`urlGuard`: refresh/run/check/hits) · 상태(`URLGuardStatus`) |
| `internal/gateway/engine/engine.go` | `Config.URLGuardControlURL/CredentialID/Token/Refresh` · `New()` 에서 가드 조립(URL 비면 nil = 검사 없음) · `Start()` 에서 첫 refresh + run |
| `internal/gateway/engine/policy.go` | `effectivePolicy.URLGuardEnabled/URLGuardUnknownCheck`(send_policy 합성 · global → customer → sender) · 정책 게이트 호출 |
| `internal/gateway/engine/accept.go` · `ingress_profile.go` | 접수 경로에서 게이트 결과 처리 |
| `internal/gateway/session/grpc_server.go` | `URL_BLOCKED` 를 **비재시도** 거절로 Agent 에 돌려준다(재시도하면 같은 URL 이 또 막힌다) |
| `cmd/gateway/main.go` | ENV 파싱(§3-1) |
| `migrations/055_linkguard_control_plane.sql` | `send_policy.url_guard_enabled`·`url_guard_unknown_check`(NULL = 상속 · 최종 기본 false) |
| `web/api/routes/policies.js` · `web/dashboard/src/pages/SendPolicyPage.jsx` | 정책 토글 2개(**0904 현재 운영 미배포** → 토글은 SQL · §4-1) |
| `go.mod` | `require github.com/invito/linkguard` + `replace => ../linkguard` — **빌드 서버·로컬 모두 `../linkguard` 체크아웃 필수** |

판정 코어(`pkg/core`)는 링크가드 저장소가 소유한다. 게이트웨이는 import 만 한다.

## 2. 불변 원칙 (게이트웨이 쪽)

1. **배포만으로는 아무도 막히지 않는다.** 정책 토글 기본 NULL(=false) · 관제센터 URL 미설정 = 가드 nil · 원장에 없는 주소는 unknown(통과).
2. **fail-open + 경고.** 관제센터 불통·목록 미수신·자격 off·401 = 검사 없이 접수하고 5분마다 경고 로그. 발송을 멈추는 경로는 없다. 유일한 차단은 원장 block 항목 일치뿐.
3. **해시 비밀의 원천은 관제센터.** 게이트웨이 ENV 에 비밀이 없다(0904 v2 에서 `GW_LINKGUARD_HASH_SECRET` 폐지). sync 의 `hash_secrets` 목록이 권위(항목 하나면 직전 폐기) · 항목마다 세대 id · 미보유 세대 항목 수 = `orphaned_hashed`.
4. **차단은 접수 거절이지 발송 실패가 아니다.** `URL_BLOCKED` 는 `PolicyError` 403 · `policy_block_event` 기록 · Agent 에는 비재시도. 과금·저장 전이라 돈이 움직이지 않는다.
5. **이력은 두 곳.** 게이트웨이 DB `policy_block_event`(정책 이력 · 기존 표) + 관제센터 `linkguard_hit_event`(hits API · message_ref = `agent_id:source_seq` · phone_masked · content_hash). 원문 본문·수신번호는 관제센터로 가지 않는다.
6. **정책 토글은 send_policy 합성 규칙을 따른다**(global → customer → sender · 하위 non-null 이 덮음). 검사 여부는 `url_guard_enabled`, 미확인 이력은 `url_guard_unknown_check`. 게이트웨이는 정책을 캐시하지 않는다(UPDATE 즉시 반영).
7. **게이트웨이 빌드는 `../linkguard` 동반.** `go.mod replace` 라 링크가드 저장소가 옆에 없으면 컴파일이 안 된다. 코어 규칙이 바뀌면 게이트웨이도 재빌드·재배포 대상이다.
8. **자격은 kind=agent 하나(`bito-gateway`).** 허용 IP = 게이트웨이의 출발지(.65 자신 = `58.227.193.65`·`127.0.0.1`). 토큰은 발급 때 한 번 · 회전 24h 유예 · 회수 = 즉시 401(통과 모드).

## 3. 계약

### 3-1. ENV (`/etc/default/bito-gateway` · root 600)
| 키 | 뜻 | 0904 값 |
|---|---|---|
| `GW_LINKGUARD_CONTROL_URL` | 관제센터 주소(비면 검사 없음) | `https://linkguard.hanjulgw.com` |
| `GW_LINKGUARD_CREDENTIAL_ID` | kind=agent 자격 ID | `lg-e063a7a5f35a643e` |
| `GW_LINKGUARD_TOKEN` / `GW_LINKGUARD_TOKEN_FILE` | 토큰(원문 · 또는 파일 경로) | env 안 |
| `GW_LINKGUARD_REFRESH` | 동기화 주기(기본 15s) | 기본 |
| `GW_LINKGUARD_ENABLED` | false 면 가드 조립 안 함(기본 true) | 기본 |
URL 은 있는데 자격 ID·토큰이 없으면 기동 거부.

### 3-2. 정책 컬럼 (055)
`send_policy.url_guard_enabled BOOLEAN` · `send_policy.url_guard_unknown_check BOOLEAN` — NULL = 상위 상속 · 최종 기본 false. 0904 = 전역(id 1) `url_guard_enabled=true` · unknown NULL.

### 3-3. 거절 응답
`PolicyError{Code: "URL_BLOCKED", HTTPStatus: 403, Message: "차단된 URL이 포함되어 있습니다.", Scope, Detail{key_type, key_value, url, list_kind}}`. REST 는 403 JSON, gRPC Agent 는 비재시도 실패코드. `policy_block_event(policy_code='URL_BLOCKED', policy_scope, agent_id, source_seq, phone_masked, content_hash, detail)`.

### 3-4. 관제센터 호출 (클라이언트 = `lgHTTPClient`)
| 호출 | 본문 | 응답 처리 |
|---|---|---|
| `POST /api/linkguard/v1/sync` `Authorization: Bearer <id>:<token>` | `{since: head, limit: 5000, agent{version:"bito-gateway", source_kind:"gateway"}}` | `enabled=false` → 목록 보존·집행 중지 · `entries[]` → `core.Entry{Seq,List,Type,Value,Active,HashKeyID}` Apply · `settings.hash_secrets` 권위 적용 · `more` 면 페이지 반복 · `head` 저장 |
| `POST /api/linkguard/v1/hits` | `{events[≤500]{event_id(uuid), verdict blocked|unknown_pass, occurred_at, key_type, key_value, url, message_ref, phone_masked, content_hash, detail{via:"gateway", agent_id, source_type, unknown_urls?}}}` | 실패(5xx·망) = 보관 후 재시도 · 4xx/401 = 폐기 |
검사 대상 텍스트 = `Message · Title · KakaoButtons · KakaoPayload · KakaoAltMsg · KakaoFailoverTitle`(수신자 노출 필드 전수 · 계약 테스트가 InboundMessage 문자열 필드 분류를 강제).

### 3-5. 상태 (`Engine.URLGuardStatus()`)
`enabled, enforcing, head, entries, hashed_entries, loaded_at, last_error, public_suffix_skipped, hash_ready, hash_key_id, orphaned_hashed, pending_hits, credential_enabled, unauthorized`. `enforcing = credential_enabled && 목록 수신 && !unauthorized`.

## 4. 운영

### 4-1. 정책 토글 (대시보드 토글 UI 미배포 동안 SQL · .65 root)
```bash
docker exec bito-bench-postgres psql -U bito -d bito_gateway -c "UPDATE send_policy SET url_guard_enabled = true, updated_by = 'ops', updated_at = NOW() WHERE id = 1 AND scope_type = 'global' RETURNING id, url_guard_enabled, url_guard_unknown_check;"
```
끄기 = `false`. 특정 고객사·발송계정만 = 그 scope 행(customer/sender)의 컬럼을 두면 상위를 덮는다. 미확인 이력 = `url_guard_unknown_check`.

### 4-2. 연결 확인
- 프로세스 ENV: `cat /proc/$(systemctl show -p MainPID --value bito-gateway)/environ | tr '\0' '\n' | grep GW_LINKGUARD | cut -d= -f1`
- 관제센터가 본 마지막 접속: `docker exec bito-bench-postgres psql -U bito -d linkguard -c "SELECT name, enabled, last_seen_at, last_agent_version FROM linkguard_credential;"` → `bito-gateway` 행 `last_seen_at` 이 15초 간격으로 갱신되면 정상.
- 게이트웨이 로그(`journalctl -u bito-gateway`)에 링크가드 줄이 **없는 것이 정상**이다(성공은 조용). 있으면 = 자격 무효(재발급) · 동기화 실패(마지막 목록 유지) · 미집행 5분 경고.

### 4-3. 차단 이력
```bash
docker exec bito-bench-postgres psql -U bito -d bito_gateway -c "SELECT created_at, agent_id, source_seq, policy_code, policy_scope, reason FROM policy_block_event WHERE policy_code = 'URL_BLOCKED' ORDER BY created_at DESC LIMIT 20;"
```
관제 화면 **판정 이력** 탭(hits)과 건수가 맞아야 한다(버퍼 flush 5초 지연).

### 4-4. 자격 회전·회수
관제 화면 발급 탭 → `bito-gateway` → **회전**(새 토큰 1회 표시 · 이전 토큰 24h 유예) → `/etc/default/bito-gateway` 의 `GW_LINKGUARD_TOKEN` 교체 → `systemctl restart bito-gateway`(재시작 1초 미만 · 0828 실측). **회수**는 되돌릴 수 없고 즉시 401 = 통과 모드.

## 5. 배포 절차 (0904 실행본 · 런북 §3-3 준수)

순서 = **DDL 선적용 → ENV → 바이너리**(재시작 약 3초 · 실트래픽 서버).
1. 로컬: `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o out/bito-gateway-<sha> ./cmd/gateway/` + `.sha256`(작업 트리에 다른 트랙 미커밋이 있으면 `build.sh` 가 거부한다 — Go 소스가 전부 커밋돼 있을 때만 수동 빌드 허용 · 0904 = 9be2ade).
2. `scp out/bito-gateway-<sha> out/bito-gateway-<sha>.sha256 scripts/gw/deploy.sh migrations/055_linkguard_control_plane.sql invito@58.227.193.65:/tmp/`
3. .65: `docker exec -i bito-bench-postgres psql -U bito -d bito_gateway -v ON_ERROR_STOP=1 < /tmp/055_linkguard_control_plane.sql` → `information_schema.columns` 로 2컬럼 확인.
4. .65: `/etc/default/bito-gateway` 에 §3-1 키 3개 추가.
5. .65: `install -o root -g root -m 0700 /tmp/deploy.sh /run/bito-gw-deploy.sh && bash /run/bito-gw-deploy.sh gateway /tmp/bito-gateway-<sha>` → `GW_DEPLOY_OK gateway`(실패 시 자동 복원 · 백업 `deploy-backups/<ts>`).
6. §4-2 로 연결 확인.
롤백 = `deploy-backups/<ts>/bito-gateway` 를 `/opt/bito-gateway/app/bin/bito-gateway` 로 되돌리고 재시작. ENV 3개는 남겨도 옛 바이너리는 무시한다.

## 6. 실측 기록

| 시각(0904) | 무엇 | 결과 |
|---|---|---|
| 19:09:48 | 055 적용 → ENV 3 → 바이너리 9be2ade(`deploy.sh gateway`) | `GW_DEPLOY_OK` · 백업 `20260904-190948` |
| 19:11:28 | 관제센터 첫 동기화 | `linkguard_credential.last_seen_at` 갱신 · 게이트웨이 로그 링크가드 줄 0(정상) |
| 19:2x | 전역 `url_guard_enabled=true` + 관제 URL 목록에 `http://linkguard-test.invalid/x` 차단 | 즉시 반영(정책 캐시 없음) |
| 19:21:15 | .66 발송 콘솔(`bito-agent-01`) 로 그 주소가 든 문자 1건 | `policy_block_event` `URL_BLOCKED` global · source_seq 7803 · 관제 판정 이력 차단 1건 |
| 이후 | 테스트 항목 해제 · 전역 토글은 켠 채 유지 | 원장에 항목이 없으면 아무도 안 막힘 |

## 7. 남은 것

- 대시보드 정책 화면의 토글 2개(`policies.js`·`SendPolicyPage.jsx`) 운영 배포 — 그때까지 §4-1 SQL.
- KISA 보완 증빙 제출 → API 발급 → 신고 목록 적재(관제 화면 · 링크가드 SoT §5-2) → 그 순간부터 실차단. **적재는 API 발급 뒤에만 가능**(증빙 = 링크가드 `docs/KISA-보안조치-증빙-패키지-2026-09.md`).
- 게이트웨이 상태 노출(`URLGuardStatus`)을 대시보드 현황에 표시(현재 미노출).
- 에이전트(`linkguard-agent`) 온보딩(.57/.58 → .54)은 링크가드 SoT §7·설치 안내 소유 — 게이트웨이와 무관.

## 8. 이력

- **2026-09-04 v1(게이트웨이 안)** — 관제센터를 Node(`web/api`)로 게이트웨이에 얹은 1차 구현 · Codex 적대 1~4R(high 7·7·9·9) · 같은 뿌리 3회 반복으로 정지·재설계.
- **2026-09-04 v2(분리)** — Harold "별도 폴더·관제센터 포함(.65)" → `projects/linkguard` 독립 모듈 · 게이트웨이는 클라이언트로 재작성(`urlguard.go`) · Node 관제센터·대시보드 페이지·clientapi 링크가드 3경로·`internal/linkguard`·`cmd/linkguard-agent` 삭제 · 055 = 정책 컬럼만 · ENV 는 `GW_LINKGUARD_CONTROL_URL/CREDENTIAL_ID/TOKEN`(해시 비밀 ENV 폐지). 커밋 `958032c`.
- **2026-09-04 해시 세대 목록 권위** — 관제센터 `hash_secrets` 목록이 권위(하나면 직전 폐기) · 세대 id 전달 · `orphaned_hashed` 상태. 커밋 `9be2ade`(= 0904 배포 바이너리).
- **2026-09-04 배포·실측** — §5·§6. 링크가드 저장소 Codex 7R 종결·배포 상세 = 링크가드 SoT §14.
- 뒤집힌 판단: 관제센터 위치 게이트웨이 → 독립 제품 · 해시 비밀 원천 게이트웨이 ENV → 관제센터 · 정책 토글 UI 우선 → SQL 로 먼저 운영.
