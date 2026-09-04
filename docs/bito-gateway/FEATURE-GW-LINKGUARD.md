# 비토 링크가드 (Bito LinkGuard) — URL 차단 관제센터·에이전트·검사 API (GW-LINKGUARD)

> 허브 = [FEATURE-BITO-GATEWAY.md](../FEATURE-BITO-GATEWAY.md) (§9 스포크 9). 호출어 **링크가드**.
> 이 문서가 링크가드의 정체성·판정 규칙·계약·스키마·실패 정책·테스트·배포 순서·이력을 소유한다. 최초 작성 = 2026-09-04 (Harold 구상 → 비토 설계 → 같은 날 구현 완료).
> 근거 = 전송자격인증 5.2(금칙어·악성 URL 차단 체계) + 특수부가통신 등록 요건(악성문자 사전차단체계, KISA 엑스레이). 제도 사실은 [전송자격인증 설계서](../2026-08-18-transmission-qualification-cert.md)가 소유한다.

## 0. 정체성

**무엇** — 문자 본문에서 URL을 꺼내 관제센터에 등록된 차단 URL(KISA 신고분 + 수동)과 대조하고, 걸리면 발송 전에 실패로 낙인하는 체계. 판매 상품이다(월 구독). 한줄로 웹은 범위 밖이고, 판정은 **게이트웨이 층**(발송이 모이는 곳)에서 한다.

**셋으로 나뉜다** — ①관제센터(계정 발급·차단 목록 원장·이력·설정) ②에이전트(업체 큐 DB 앞에서 판정, DBMS 무관) ③검사 API(자체 게이트웨이 코드가 있는 업체용, 비토 게이트웨이는 코드 안 훅). 판정 코어는 하나(Go)이고 세 입구가 같은 코어를 쓴다. **Node 관제센터는 판정하지 않는다.**

**1차 범위(★2026-09-04 Harold 확정 · 구현 완료)** — 관제센터(Agent 자격·API 키 발급·토글·회전·회수), 관제센터와 연결된 에이전트·검사 API, 비토 게이트웨이 훅, 목록 밖 URL의 AI 판정 **온/오프 토글과 보류 정책**(엔진은 어댑터 자리 = null 엔진), **KISA 신고 URL 해시 보관**(§2-5).
**2차** — MongoDB 소스, 트리거 팩(상태값을 못 바꾸는 레거시 큐), KISA 자동 수집기(규격 수령 후), AI 판정 엔진 본체, 전용 결과코드 매핑, hit 보존기간 자동 정리, PG 볼륨 암호화(KISA가 문자 그대로 요구할 때).

## 1. 구조 (구현 실물)

```
[관제센터]  web/api(Node)·PG            자격 발급·토글·회전·회수 / URL 원장(block·allow, KISA=해시) / hit 이력 / 설정 / judge 어댑터(null)
     ▲ POST /api/linkguard/v1/{sync,hits,judge}   (Bearer credential_id:token · kind=agent)
     ▲ POST /api/linkguard/v1/check              (kind=api → Node 인증 → Go 내부 /internal/v1/linkguard/check)
[판정 코어]  internal/linkguard/core (Go)     추출 → 정규화 → 4단 키(+해시 3종) → allow/block 우선순위 → 메시지 판정
   ├ 입구 A  cmd/linkguard-agent(Go 단독 실행형)   업체 큐 DB 앞. 대기 → 검사통과 승격 / 악성 → 실패코드. MySQL·MariaDB·MSSQL·Oracle·PostgreSQL
   ├ 입구 B  검사 API                                게이트웨이 clientapi /internal/v1/linkguard/check (+ 에이전트 내장 localhost /check)
   └ 훅      engine 정책 게이트(저장·과금 앞)       PolicyError URL_BLOCKED · 비재시도 · policy_block_event
[관제센터 ↔ 게이트웨이]  /internal/v1/linkguard/keys  KISA 적재 시 키·해시 산출(해시 비밀은 Go 에만)
```

원칙 여섯 — ①판정은 현장(게이트웨이 프로세스·에이전트)에서 메모리로, 관제센터는 목록 배포·이력·라이선스만 ②핫패스에 외부 HTTP·리다이렉트 추적 0 ③판정 단위 = 메시지 안 고유 URL, 대조 비용은 목록 크기와 무관(해시) ④차단은 돈이 움직이기 전(게이트웨이 = 저장·과금 앞 / 에이전트 = 전송기가 집기 전) ⑤모르는 것은 통과 + 이력(fail-open), 악성 확정만 막는다 ⑥라이선스 off = 통과 + 로그 + 화면 경고, 조용한 무방비 금지.

## 2. 판정 규칙 (코어 = Go 하나)

### 2-1. 추출 (`core.Extract`)
1. 전처리: 난독화 복원 `[.]` `(.)` `{.}` `[dot]` `(dot)` `{dot}` → `.` · 전각 `．` `。` `｡` → `.` · `hxxp` → `http` · 폭 0 문자(U+200B~U+200D·U+FEFF·U+2060) 제거 · 전각 영숫자 → ASCII · `abc . kr`(양쪽 공백 점) → `abc.kr`.
2. 스킴 URL: `https?://` `ftp://` 토큰. 종결 = 공백·`<>"'`·`)` `）` `]`. **한글은 끊지 않는다**(IDN 호스트 `악성.kr`·`악성.한국` 때문).
3. 스킴 없는 URL: `label(.label)+.tld(:port)?(/path)?`(라벨에 유니코드 글자 허용) 중 **tld가 ICANN 공개 접미사**인 것(`golang.org/x/net/publicsuffix` · 비ASCII 호스트는 `idna.Lookup.ToASCII` 뒤 판정)·IPv4·`www.` 시작. 바로 앞 글자가 영숫자·`@.-_/:%`면 다른 토큰의 일부(이메일·버전·경로)라 버린다. 끝의 `.,;:!?` 따옴표는 뗀다.
   **한글 처리 원칙(★Codex 1R·2R)** — 한글은 두 얼굴(IDN 호스트 / 조사)이고 문자열만으로 확정할 수 없다. 그래서 **원문 후보를 항상 남기고 조사를 뗀 것을 추가 변형으로 더한다**(둘 다 대조 → block 이 하나라도 있으면 차단). ① 라벨 전체가 한글이면 IDN → 그대로(정규화가 punycode). `악성.한국으로` 는 조사만 뗀 `악성.한국` 도 낸다 ② 첫 라벨 앞 한글 덩어리(`택배조회bad.kr`)·마지막 라벨 뒤 한글 덩어리(`abc.kr로`)를 뗀 변형을 더한다 ③ 경로·query 는 유니코드 그대로(`bad.kr/피싱` 은 exact 키) · 끝 조사만 뗀 변형 추가 ④ 호스트에 한글이 있는 후보는 IDN 변환 뒤 공개 접미사가 확인될 때만 남는다(`abc.kr로` 는 떨어지고 `abc.kr` 만). 스킴 URL 의 경계는 허용 문자 목록(RFC 3986 전부 + 유니코드 글자·숫자)이라 이모지·큰따옴표·꺾쇠에서 끝나고, `hxxp` 복원은 스킴 접두에만 적용한다(`https://hxxp-bad.kr` 호스트 보존). JSON 이스케이프 `\/` 는 전처리에서 `/` 로 되돌린다(카카오 버튼·페이로드). **괄호·대괄호·작은따옴표는 URL 문자**(★Codex 3R — `/a(b)`, `[2001:db8::1]:8080`, `/it's`): 문장이 감싼 닫는 괄호는 깊이 0 에서 만나는 첫 `)`/`]` 에서 자르는 균형 계산으로만 뗀다(`(http://abc.kr/x1)확인` → `http://abc.kr/x1`). 스킴 없는 IPv6 는 다루지 않는다.
4. 결과 = 등장 순 후보(중복 제거). 정규화가 거부한 후보는 URL이 아니다(unknown이 되지 않는다).

### 2-2. 정규화 (`core.Normalize` · Node `services/linkguard-url.js` 동일 · 벡터 파일 `testdata/linkguard-normalization-vectors.json` 38건으로 고정)
- 손으로 쓴 파서(net/url·WHATWG에 기대지 않는다). 스킴 없으면 http. userinfo·fragment 제거. `\` → `/`. `hxxp(s)` 복원. `mailto:`·`javascript:` 거부.
- host: 소문자 · 끝 `.` 제거 · IDN → punycode · 라벨 2개 이상 · 라벨 `[a-z0-9-]`(밑줄 거부) · TLD 숫자만이면 거부 · IP 리터럴 허용(IPv6 대괄호 제거).
- port: 기본값(80/443/21) 제거, 아니면 `host:port` = hostKey.
- path: percent 해제 → 점 세그먼트 해소·빈 세그먼트 접기(끝 `/` 보존) → 정규 인코딩(허용 = unreserved + sub-delims + `:@`, 나머지 `%XX` 대문자, 비ASCII는 UTF-8).
- query: 같은 방식 재인코딩(허용에 `/?` 추가). 정렬·삭제 없음. 비면 "".
- 산출 = `{hostKey, host, path, query}` · `ExactKey = hostKey+path(+?query)` · `PrefixKey = hostKey+path`.

### 2-3. 키와 우선순위
| 키 | 값 | 일치 |
|---|---|---|
| `exact` | hostKey + path + (`?`query) | 완전 일치 |
| `url_prefix` | hostKey + path | hostKey 동일 + 메시지 path가 항목 path로 시작(긴 접두 우선) |
| `host` | hostKey | 완전 일치 |
| `domain` | host(port 없음) | 메시지 host == 값 또는 `.`+값으로 끝남(긴 접미사 우선) |
| `exact_h` / `host_h` / `domain_h` | HMAC-SHA256 hex | 같은 단계에서 평문 맵 다음에 해시 맵을 본다(§2-5) |

판정 순서 = exact → url_prefix → host → domain. **처음 걸린 단계의 목록(block/allow)이 결정**한다. 같은 키가 block과 allow에 동시에 있을 수 없다(UNIQUE). 메시지 판정 = block 하나라도 → **block** / unknown 하나라도 → **unknown** / 아니면 **pass**.
`domain` 값이 공개 접미사(`co.kr`·`com`)면 Go 적재 시 무시 + 경고 + `PublicSuffixSkipped` 통계. Node 입력은 라벨 2개 미만 거부 + 잘 알려진 2단 접미사 거부.

### 2-4. 미확인(unknown) 정책 = AI 판정 토글
- 자격별 `unknown_url_check`(기본 off) · `unknown_url_hold_seconds`(0~60, 기본 10). 게이트웨이는 정책 `url_guard_unknown_check`.
- off → 통과, 이력 없음. on → 에이전트는 행을 **DB 상태 `held`(yaml `status_values.held`)로 옮기고**(★Codex 2R — 메모리 보류는 다른 인스턴스 경쟁·선두 배치 점유(굶김)를 만들었다) 메모리에 마감을 둔 채 `POST /judge`에 묻는다(캐시: pass·block 1시간, unknown 30초 · **미만료 캐시는 답이 무엇이든 재질의하지 않는다** ★Codex 1R). block → failed, pass → ready, unknown인 채 마감 → ready + 이력 `unknown_pass`. **`held` 값이 yaml 에 없으면 보류 기능이 꺼진다**(토글 on 이어도 unknown 통과 + 5분마다 경고). **승격 직전 재평가**(★Codex 3R): held → ready 직전에 본문을 지금 목록으로 다시 대조해 보류 중 추가된 차단이면 failed(이력 `blocked`)로 보낸다. 보류 상한 10,000: pending → held 전에 용량을 보고 넘치면 그 배치의 unknown 은 승격 + 경고(1분 1회). held 전이 DB 오류는 1초→60초 backoff · 경고 1분 1회. judge 회로: 거부(403 꺼진 자격·400 토글 off 등 비재시도 4xx)는 다음 성공 sync 까지 묻지 않고, 일시 오류는 1초→60초 지수 backoff. 게이트웨이 훅은 통과 + `linkguard_hit_event(source=gateway, unknown_pass)`.
- `/judge` 엔진 = 어댑터(`services/linkguard-judge.js`). 1차 = null(전부 unknown). AI 판정기는 같은 인터페이스 `{name, judge(urls)}`로 꽂는다.

### 2-5. 해시 보관 모드 (★KISA "악성 URL 보관 DB 암호화" 대응)
- KISA 신고 URL은 **평문으로 저장·전송하지 않는다.** 적재 시 게이트웨이 `/internal/v1/linkguard/keys`가 정규화 키의 `HMAC-SHA256(secret, key_type + \0 + value)`을 만들고 원장에는 `*_h` 종류와 hex 64자만 들어간다(`raw_input` NULL). 비밀 = 게이트웨이 `GW_LINKGUARD_HASH_SECRET`(64자 hex · 형식 오류면 기동 거부).
- **비밀의 원천은 게이트웨이 하나다**(★Codex 1R — Go·Node ENV 불일치 = 조용한 부분 보호). Node는 `/internal/v1/linkguard/hash-secret`을 60초 캐시로 받아 sync `settings.hash_secret`(켜진 agent 자격에만)으로 내리고, `hash_ready`·`hash_key_id`(sha256 앞 12자)·`hash_reason`을 함께 내린다. 게이트웨이 불통·미설정이면 `hash_ready=false`.
- 에이전트는 그 비밀로 메시지 URL 키를 해시해 조회한다. **sync 의 비밀 의미 = SET/KEEP**: 값이 오면 SET(적용·지문 로그), 생략이면 KEEP(꺼진 자격·게이트웨이 일시 불통·미설정 어느 경우든 적용 중인 비밀 유지). **SET = 회전**: 직전 비밀을 함께 들어(매처 비밀 2개, 조회당 HMAC 최대 2회) 옛 digest 도 그대로 대조한다(★Codex 3R — 새 비밀만 들면 재적재가 끝날 때까지 KISA 항목 전체가 차단 공백). 적용 중인 현재·직전 비밀은 응답 settings 와 **별도로 보관**하고 **암호화 스냅샷에는 항상 그 둘**을 쓴다(★Codex 2R — KEEP 응답을 그대로 저장해 재시작 때 비밀이 비었다). 명시 CLEAR 는 없다(게이트웨이 ENV 가 원천 · 제거는 회전으로만). 해시 항목이 있는데 비밀이 없거나 키 지문이 어긋나면 5분마다 경고 + stats `hash_ready`/`hash_key_id`로 관제 화면(현황 탭 "해시 준비" · 자격 표 "해시 미준비"/"키 불일치")에 드러난다.
- **비밀 회전 절차(운영)** — 게이트웨이 `GW_LINKGUARD_HASH_SECRET` 교체 = 새 적재분의 digest 가 바뀐다. 순서: ① 새 값으로 게이트웨이 재기동 ② Node 캐시 60초 안에 전 워커가 새 key_id 로 수렴(그 창에서 워커별 두 세대 공존 = 에이전트가 둘 다 대조하므로 무해) ③ 에이전트는 다음 sync 에서 SET(직전 비밀 병행 · key_id 변화 로그) ④ KISA 해시 항목 재적재는 **서두를 필요 없음**(옛 digest 는 직전 비밀로 계속 걸린다) · 다음 회전 전까지 끝내면 된다(다음 회전에서 직전 비밀이 밀려난다). generation 컬럼(원장에 세대 기록·에이전트가 세대 완결 확인 뒤 원자 교체)은 2차 DDL 과제.
- 평문 항목(수동·허용)은 각 단계에서 해시보다 먼저 본다 → 우리 허용 도메인이 KISA에 잘못 신고돼도 host/domain 단계에서 허용이 이긴다. 다만 exact 단계의 해시 차단은 host 단계 허용보다 앞이다(오픈 리다이렉터 신고 = 정확 URL 차단이 맞다).
- KISA 적재 시 평문 값이 허용 목록에 있으면 적재하지 않고 `conflicts`로 보고한다(사람이 본다).
- 에이전트 로컬 파일(스냅샷·spill)은 `cfgcrypt`로 암호화(키 = `state_dir/state.key` 0600).

## 3. 관제센터 스키마 (`migrations/055_linkguard_control_plane.sql` · 추가 전용·재진입 가능)

| 테이블 | 핵심 | 비고 |
|---|---|---|
| `linkguard_credential` | `credential_id` `lg-`+16hex UNIQUE · `kind` agent/api · `name` · `customer_id`→reseller · `token_hash`/`token_hint` · `prev_token_hash`/`prev_token_expires_at`(회전 유예 24h) · `enabled` · `allowed_ips` TEXT[] · `unknown_url_check` · `unknown_url_hold_seconds` 0..60 · `last_seen_at/ip` · `last_sync_seq` · `last_agent_version` · `last_stats` JSONB · `revoked_at` · `rotated_at` · `note` | CHECK: 회수면 해시 NULL + enabled false |
| `linkguard_url_entry` | `seq` UNIQUE(시퀀스 `linkguard_url_entry_seq`) · `list_kind` block/allow · `key_type` exact/url_prefix/host/domain/exact_h/host_h/domain_h · `key_value` · `raw_input` · `source` kisa/manual/import · `source_ref` · `reason` · `is_active` · `deactivated_*` · UNIQUE(`key_type`,`key_value`) | 모든 변경 = `pg_advisory_xact_lock(hashtext('linkguard_url_entry'))` 안에서 `nextval` → 커밋 순서 = seq 순서. 해시 값은 `^[0-9a-f]{64}$` CHECK |
| `linkguard_hit_event` | `credential_ref`(NULL=게이트웨이) · `event_id` UUID · `source` agent/api/gateway · `verdict` blocked/unknown_pass/unknown_blocked/judged_pass · `key_type/value` · `url` · `message_ref` · `phone_masked` · `content_hash` · `hold_ms` · `detail` · `occurred_at` · UNIQUE(COALESCE(credential_ref,0), event_id) | 게이트웨이 **차단**은 기존 `policy_block_event`(URL_BLOCKED)가 소유. 관제 화면은 둘을 UNION으로 읽는다 |
| `send_policy` ALTER | `url_guard_enabled` · `url_guard_unknown_check` (NULL=상속, 최종 기본 false) | 배포만으로는 아무도 안 막힌다 |

## 4. 계약

### 4-1. 에이전트·API 면 `/api/linkguard/v1/*` (Node · `Authorization: Bearer <credential_id>:<token>` · JSON 256KB · 출발지 IP rate limit 300/분)
| 경로 | kind | 요청 → 응답 |
|---|---|---|
| `POST /sync` | agent | `{since, limit≤5000, agent:{version,instance,source_kind}, stats}` → `{enabled, head, entries:[{seq,list_kind,key_type,key_value,is_active}], more, settings}`. `since=0` = 활성 스냅샷, 아니면 `seq>since` 전부(비활성 포함). `more`면 `head`=페이지 끝. **자격 off = 200 + enabled:false + entries [] + head=since**(비밀도 내리지 않음). settings = `{enabled, unknown_url_check, unknown_url_hold_seconds, sync_interval_seconds, hits_batch_max, judge_batch_max, judge_engine, token_generation, hash_mode, hash_ready, hash_key_id, hash_reason, hash_secret?}`. stats(에이전트→관제) = `{scanned, passed, blocked, unknown, held, lag_ms, enforcing, entries, stale, hash_ready, hashed_entries, hash_key_id}` |
| `POST /hits` | agent·api | `{events:[…]}`(≤500) → `{accepted, duplicated}` (event_id 멱등) |
| `POST /judge` | agent | `{urls:[…]}`(≤50) → `{engine, results:[{url,verdict block/pass/unknown/invalid,source}]}`. unknown 토글 off = 400 `UNKNOWN_CHECK_DISABLED` |
| `POST /check` | api | `{messages:[{id,text}]}`(≤200) → `{enabled, guard, results:[{id,verdict,urls,blocked?,unknown_urls?}]}`. Node가 Go `/internal/v1/linkguard/check`에 넘기고 차단(항상)·미확인(토글 시) 이력을 남긴다. Go 불통 = 503 |
인증 실패 = 401 `LINKGUARD_CREDENTIAL_INVALID`(회수·불일치 구분 없음) · IP 밖 403 · 스코프 밖 403 · **자격 enabled=false 는 sync/hits 만 통과하고 check·judge 는 403 `LINKGUARD_CREDENTIAL_DISABLED`**(★Codex 1R — 꺼진 자격이 판정 자원·목록 oracle 을 쓰지 못한다) · 인증 캐시 60초 + 토글·회전·회수 시 즉시 무효화.

### 4-2. 관리 면 `/api/admin/linkguard/*` (adminAuth · 변경은 `audit_log` 같은 트랜잭션)
`GET/POST /credentials` · `PATCH /credentials/:id` · `POST /credentials/:id/rotate` · `DELETE /credentials/:id`(회수) · `GET/POST /entries` · `DELETE /entries/:id`(비활성) · `POST /entries/:id/reactivate` · `POST /ingest/kisa` · `GET /hits` · `GET /stats` · `GET /status`. 발급·회전 응답에만 토큰 + `config_snippet`. 반대 목록 충돌 = 409 `CONFLICTING_LIST`(롤백). 055 미적용 = 503 `DB_MIGRATION_PENDING`.

### 4-3. 게이트웨이 내부 `/internal/v1/linkguard/*` (Go clientapi · `X-Internal-Key`)
`POST /check` `{messages}` → `{results, guard}` · `POST /keys` `{items:[{url,key_type?,hashed}]}` → `{results:[{url,ok,reason,key_type,key_value,plain_key_type,plain_key_value}]}` (hashed 요청인데 비밀 없음 = 409 `LINKGUARD_HASH_SECRET_MISSING`) · `POST /hash-secret` → `{configured, key_id, secret, mode}`(Node 전용 · 비밀 원천).

## 5. 자격 수명주기
issue → active(enabled) ⇄ toggle → revoke(해시 삭제·복구 불가). rotate = 새 토큰 + 이전 해시 24h 유예. 토큰 = 32바이트 base64url(43자), 저장 = sha256 + 힌트 6자. 스코프: agent = sync·hits·judge / api = check·hits.

## 6. 동기화 계약
에이전트는 스냅샷(암호화)을 읽고 즉시 집행 → `since=head` 증분. 관제센터 불통 = 마지막 목록으로 계속(1시간 넘으면 경고). `enabled=false` = 집행 중지·목록 보존·5분마다 경고 · **꺼진 설정도 스냅샷에 저장**(★Codex 3R — 저장 없이 돌아가면 재시작 + 관제 불통 때 옛 enabled=true 로 다시 집행). 401 = 통과 모드 + 오류 로그(재발급 필요). 적용 = 활성이면 add, 비활성이면 remove, 오래된 seq 무시.
**큐 단일 인스턴스 락**(★Codex 3R · yaml `instance_lock`, 기본 true) — held 행에 소유자·임대 컬럼을 둘 수 없으므로(업체 테이블) "같은 큐 테이블을 다루는 에이전트는 하나" 를 DB 세션 락으로 강제한다: MySQL/MariaDB `GET_LOCK('linkguard:<table>', 0)` · PostgreSQL `pg_try_advisory_lock(hashtext(…))` · MSSQL `sp_getapplock Session/Exclusive` · Oracle 미지원(false 로 두고 운영 절차로 보장). 전용 커넥션이 프로세스 수명 동안 쥐고, 두 번째 인스턴스는 기동을 거부한다(Run 오류 → 서비스 매니저 재시작 → 옛 인스턴스가 나간 뒤 획득).

## 7. 에이전트 (`cmd/linkguard-agent` · `internal/linkguard/agent`)

### 7-1. 설정 (`linkguard-agent.yaml` · 모르는 키는 거부)
```yaml
credential_id: lg-0123456789abcdef
token_file: /etc/linkguard/token          # 또는 token:
control: { base_url: https://gw.example.com, sync_interval: 30s, request_timeout: 10s, tls_ca_file: "" }
source:
  db_type: mysql                          # mysql|mariadb|mssql|oracle|postgres
  host: 127.0.0.1
  port: 3306
  database: smsdb
  username: linkguard
  password_env: LINKGUARD_DB_PASSWORD     # 또는 password:
  table: SMSQ_SEND
  seq_column: seqno
  content_column: msg_contents
  extra_content_columns: [title_str, k_button_json]   # 선택 · 함께 검사
  status_column: status_code
  status_values: { pending: "100", ready: "101", failed: "90", held: "102" }   # 서로 달라야 함 · ready = 전송기가 읽는 값 · held = 미확인 보류(선택 · 없으면 보류 기능 off)
  fail_code_column: ""                    # 선택
  fail_code_value: "URL_BLOCKED"
  send_time_column: sendreq_time          # 선택 · "<= NOW()"
  queued_at_column: msg_instm             # 선택 · 지연 측정
  where_extra: ""                         # ; 금지
  order_by: seqno
  poll_interval: 200ms
  batch_size: 200
  lock_mode: skip_locked                  # skip_locked(기본: MySQL 8·MariaDB 10.6·PG·MSSQL) | for_update(MySQL 5.7) | none(oracle 전용 기본 · 단일 인스턴스)
  instance_lock: true                     # 큐 단일 인스턴스 DB 세션 락(기본 true · oracle 은 false)
local_check_api: { enabled: true, listen: 127.0.0.1:8471 }   # localhost 만 허용
state_dir: /var/lib/linkguard
log_level: info
stale_warn_after: 1h
```

### 7-2. 루프
1. **스캔 = 한 트랜잭션**(★Codex 1R 원자 claim): `BEGIN` → `SELECT seq, content[, extras][, queued_at] FROM table[ WITH (UPDLOCK, READPAST, ROWLOCK)] WHERE status=? [AND send_time <= NOW()] [AND (where_extra)] ORDER BY … LIMIT ?[ FOR UPDATE SKIP LOCKED]`(방언별 LIMIT/TOP/FETCH · 잠금 절은 `lock_mode`) → 행마다 `core.Evaluate`(메모리 대조라 잠금 구간이 짧다) → `UPDATE … SET status=ready|failed[, fail_code=?] WHERE status=pending AND seq IN (…)` → `COMMIT`. 다른 인스턴스가 잠근 행은 건너뛰고(롤링 재시작 중 구 목록의 pass 가 신 목록의 block 을 선점하지 못한다), 프로세스가 죽으면 잠금이 풀려 pending 그대로다. 새 상태값·소유자 컬럼 없음.
   pass → ready / block → failed + hit(blocked) / unknown → 토글 on 이고 `held` 값이 있으면 **같은 트랜잭션에서 pending → held**(pending 조회에서 사라져 뒤 행이 굶지 않는다), 아니면 승격.
2. **보류 해제**: `/judge` 캐시 답으로 held → failed(+hit unknown_blocked) / ready, 마감 경과 = ready + hit(unknown_pass). 승격 직전 지금 목록으로 **재평가**(차단이면 failed + hit blocked). 상한 10,000행(pending → held 전에 용량 확인). 해제 UPDATE 는 **행을 먼저 잠근 뒤** 갱신하되 **최종 전이는 SKIP LOCKED 를 쓰지 않고 잠금을 기다린다**(★Codex 3R — 건너뛰면 "잠긴 행" 과 "상태가 바뀐 행" 을 구분할 수 없어 잘못 지운다). 돌아오지 않은 seq = 확정적으로 held 가 아니다 → 오류가 없으면 전부 메모리에서 제거, 이력·통계는 갱신된 seq 에만(★Codex 2R). 결정(resolve)은 비파괴·멱등이라 DB 실패는 backoff 뒤 재시도.
   **고아 복구**: 기동 직후 1회, DB 의 held 행(이전 인스턴스가 남긴 것 · 인스턴스 락으로 기동 시점의 held 는 전부 고아)을 지금 목록으로 다시 판정한다. 이미 기다린 행이라 재보류하지 않는다(block → failed · 그 밖 → ready) → 매 배치가 held 를 비우므로 뒤 행까지 반드시 도달한다(★Codex 3R — 재보류 루프는 선두에 갇혔다). **종료(SIGTERM·서비스 stop)** 때는 보류 행을 재평가해 500행씩 별도 트랜잭션으로 failed/ready 로 보내고(unknown_pass · via=shutdown_drain), 그 이력까지 마지막 flush 에 실은 뒤 나간다. **잔존(held 에 남은 행)이 0 이 아니면 Run 이 오류로 끝난다**(서비스 매니저가 실패로 본다 · 다시 시작하면 고아 복구가 처리).
3. **집행 off**(자격 off·목록 없음·401): 검사 없이 승격 + 5분마다 경고.
4. **hit 보고**: 5초/500건 배치, 실패 시 spill(암호화) 후 재시도, 4xx 거절은 폐기+로그.
5. UPDATE는 항상 `status=pending` 조건 → 잠금 뒤 상태가 바뀐 행은 0행이라 로그. **루프 backoff** = 이번에 결정(승격·실패)한 행 수가 `batch_size` 이상일 때만 바로 다음 배치, 보류 행만 가득한 배치는 `poll_interval` 대기(★Codex 1R 판정 폭주).
6. 이력·통계·보류 등록은 **커밋 뒤에만** 반영한다(커밋 실패 = 아무것도 남기지 않음).

### 7-3. 서브커맨드
`run` · `check-config`(형식·토큰·DB 연결·**한 트랜잭션에서 잠금 조회 1행 + ready/failed/held UPDATE 문을 불가능 조건(`AND 1=0`)으로 실행 후 롤백**(권한·컬럼·잠금 문법 · 데이터 무변경 ★Codex 2R)·관제센터 sync 1회 · `hash_ready`가 아니면 그 사유를 출력) · `sync-once` · `test-scan -text` · `discover [-table]`(카탈로그 읽기) · `install-service`/`uninstall-service`/`service-status`(**링크가드 자체 설치기** `cmd/linkguard-agent/service_install.go` — 메시지 Agent 공용 설치기는 부트스트랩 서비스 `Requires`·`AGENT_CONFIG` 환경변수·`windows-service --name` 규약이 전용이라 그대로 쓰면 기동 실패. Linux = systemd unit `ExecStart=… run -config <yaml>` · `User=linkguard`(미리 `useradd --system`) · `EnvironmentFile=-<설정 디렉터리>/linkguard-agent.env`(DB 비밀번호 등) · 부트스트랩 의존 없음 / Windows = `sc.exe create … binPath="<exe>" windows-service -config "<yaml>"` + 실패 시 5초 재시작 · 로그 = `state_dir\linkguard-agent.log`) · `windows-service`(서비스 매니저 전용) · `encrypt-config`(→ `.enc` + `.linkguard.key`) · `version`. `-config` 생략 = 환경변수 `LINKGUARD_CONFIG` → `./linkguard-agent.yaml`. 빌드 = `make build-linkguard-agent[-win]`. 배포 예시 = `deploy/linkguard-agent/`(예시 yaml·env · 설치 안내).

### 7-4. 안전망
systemd `Restart=always` / Windows 서비스 · 선택 DB 이벤트(N초 지난 pending 자동 승격 = 에이전트 사망 시 발송 계속, 그 구간은 미검사 → 관제 화면 "미보호" 경고가 짝) · 큐 지연 = 가장 오래된 pending의 queued_at 대비.

## 8. 비토 게이트웨이 훅 (실물)
- `engine/urlguard.go`: `urlGuard`(코어 Matcher + `seq > $1` 증분 로더, 기본 15초 · 첫 로드는 Start에서 동기 시도). `EngineConfig.URLGuardRefresh`·`DisableURLGuard`·`URLGuardHashSecret`.
- `policy.go`/`ingress_profile.go`: 블록리스트 검사 **뒤**, 중복 검사 **앞**에 `guard.check(policy, msg)`. 대상 텍스트 = Message + Title + KakaoButtons + KakaoPayload + KakaoAltMsg. block → `PolicyError{URL_BLOCKED, 403, Detail{key_type,key_value,url,list_kind}}` → 기존 `recordPolicyBlock`. unknown + 토글 → `linkguard_hit_event(gateway, unknown_pass)` 비동기.
- `session/grpc_server.go sendAckPolicyDetails`: `URL_BLOCKED` = 비재시도(Agent가 고객 행을 `status_values.failed`로 종결). REST = 403 JSON.
- `clientapi/linkguard.go`: `/internal/v1/linkguard/check`·`/keys`.
- `cmd/gateway/main.go`: `GW_LINKGUARD_HASH_SECRET`(64 hex) · `GW_LINKGUARD_ENABLED=false`면 훅 비활성 · `GW_LINKGUARD_REFRESH`.
- [범위 밖 기록] 기존 `CONTENT_BLOCKED`·`RECIPIENT_BLOCKED` 등 정책 차단은 `sendAckPolicyDetails`에서 재시도 가능으로 나간다(Agent 경로에서 종결이 안 됨). 별도 과제.

## 9. 화면
`web/dashboard/src/pages/LinkGuardPage.jsx` — 메뉴 「발송 설정 › 링크가드」. 탭 4 = 발급(목록·발급 모달·토큰 1회 표시+복사+설정 조각·설정·회전·회수) · URL 목록(차단/허용 부탭·여러 줄 등록·KISA 적재·해제) · 판정 이력(자격·판정·출처 필터, hit ∪ 게이트웨이 차단) · 현황(head·항목·자격별 동기화 지연·미보호 경고). `SendPolicyPage.jsx`에 「URL 차단 집행(링크가드)」·「미확인 URL 판정」 토글. 브라우저 dialog 0 · 공용 Modal · 정적 계약 `scripts/test-linkguard-ui.mjs`(화면이 부르는 14경로가 서버에 있는지 대조).

## 10. 보안 · KISA "데이터 제공형" 보안조치 증빙 대응
| KISA 요구 | 우리 답 |
|---|---|
| 악성 URL 보관 DB 암호화 | §2-5 해시 보관(원문 미저장·복원 불가) + 에이전트 로컬 파일 암호화. 문자 그대로 요구 시 .65 PG 볼륨 암호화(2차) |
| 비인가 접속 차단 | 자격 토큰 해시·timingSafeEqual · 허용 IP CIDR · rate limit · 관리자 세션+TOTP · 감사 로그 · 토큰 원문 1회 표시 |
| 네트워크 구성도(망분리) | .65 구성(PG·관리 API 127.0.0.1, gRPC 9090 출발지 허용 목록, nginx 전면) 도식 + `ufw status`·`ss -tlnp` 캡처. 논리 분리로 설명 |
| 백신 설치 | .65 ClamAV + 주기 검사 로그(운영 작업) |

## 11. 실패 정책 (요약)
| 상황 | 동작 |
|---|---|
| 관제센터 불통 | 마지막 목록으로 계속 · 1시간 넘으면 경고 · 발송 계속 |
| 목록 한 번도 못 받음 | 통과 + 경고(fail-open) · 화면 "미보호" |
| 자격 off / 회수(401) | 통과 + 경고 · 목록 보존 / 재발급 필요 로그 |
| judge 불통 | 마감까지 대기 후 통과 + unknown_pass |
| DB UPDATE 0행 | 로그 · 다음 사이클 |
| hit 전송 실패 | spill → 재시도 · 멱등 |
| 게이트웨이 로더 실패 | 마지막 메모리 목록 유지 · 로그 · 접수 계속 |
| 게이트웨이 해시 비밀 없음 | 해시 항목 대조 안 함(평문만) · KISA 적재 409 · sync `hash_ready=false` + 사유 · 화면 "미준비" |
| 에이전트 해시 비밀 없음·키 지문 불일치 | 평문 항목만 대조 · 5분마다 경고 · stats `hash_ready=false` → 자격 표 "해시 미준비"/"키 불일치" |
| 다른 인스턴스가 잠근 행 | SKIP LOCKED 로 건너뜀 · 잠금 해제 뒤 다음 스캔에서 판정(`lock_mode=none` 은 이 보호 없음 = 단일 인스턴스 전제) |
| 보류 행을 남이 먼저 처리(held 가 아님) | 갱신 0 → 이력 없이 메모리에서만 제거 + 로그 |
| 에이전트 사망 후 held 고아 | 다음 기동에서 재판정(block → failed · 그 외 ready · 재보류 없음) |
| 에이전트 정상 종료·제거 | 보류 행 재평가 뒤 ready/failed(500행 청크) → 발송 계속 · 잔존 0 이 아니면 종료 오류 · **되돌리기 = pickup 이 ready 인 채 stop → held 0 확인 → pickup 원복** |
| 두 번째 인스턴스 기동 | 인스턴스 락 실패 → 기동 거부(오류 종료) · 옛 인스턴스가 나간 뒤 재시작 |
| 해시 비밀 회전 | 새 비밀 SET + 직전 비밀 병행 → 옛 digest 계속 대조 · 재적재는 다음 회전 전까지 |
| judge 거부(403 꺼진 자격·400 토글 off) | 다음 성공 sync 까지 묻지 않음 · 보류는 마감에 통과 |
| judge 일시 오류 | 1초→60초 지수 backoff(로그 1회·10회마다) |
| `held` 값 없이 AI 판정 토글 on | unknown 통과 + 5분마다 경고(보류 기능 꺼짐) |

## 12. 검증 (2026-09-04 실측)
- Go: `internal/linkguard/core`(벡터 38 + 추출(한글 IDN·조사·원문 보존·유니코드 경로·한글 TLD 조사·이모지 경계·hxxp 호스트·JSON 이스케이프 17케이스)·매칭·해시) · `internal/linkguard/agent`(설정·lock_mode 방언별 SQL·클라이언트·상태(비밀 round-trip)·보류(비파괴 resolve·remove·캐시) + **실 MySQL 8 종단**: 승격·실패코드·제목 URL 차단·허용 통과·**unknown → held(102) 전환 → 마감 뒤 ready + unknown_pass**·재스캔 processed 0·**다른 트랜잭션이 잠근 행 SKIP LOCKED → 해제 뒤 차단**·이력 3+1·스냅샷·자격 off 통과·재시작 복구·**스냅샷에서 해시 비밀 복구 후 관제 불통에도 해시 차단**) · `cmd/linkguard-agent`(자체 설치기 unit 계약·Windows binPath·비root/사용자 부재 거부·예시 yaml 파싱·LINKGUARD_CONFIG) · `internal/gateway/engine`(urlguard 8건: InboundMessage 전 string 필드 수신자 노출 대응표 포함) · `clientapi`(check·keys·hash-secret) · `session`(URL_BLOCKED 비재시도) 전부 `ok`. gofmt·vet 0. `go build ./cmd/gateway ./cmd/linkguard-agent`(linux·windows 크로스) OK.
- Node: url 44 · credential 15 · store 13 · routes 15(해시 비밀 원천 = 게이트웨이 · 꺼진 자격 check/judge 403) · **실 PG 통합 9** · api 전체 체인 377 통과. 055 재진입 OK · `information_schema`로 3테이블·2컬럼 실존 확인.
- Dashboard: `test:linkguard-ui`(경로 14 대조) + 모달 계약 PASS · production build PASS.
- 게이트 = `bash scripts/gw/check.sh` → **`GW_GATE_OK` · `GW_CHECK_OK`**(2026-09-04 · Windows 환경 제외 5건은 기존 목록 그대로).

## 13. 배포 순서 · ENV · 롤백 · 온보딩
**순서(DEPLOY-RUNBOOK 경유)** ① `migrations/055` 적용(추가 전용) ② api 파일 반영: 신규 `middleware/linkguard-auth.js` · `services/linkguard-{credential,store,url,judge}.js` · `routes/linkguard-{admin,agent}.js` + 변경 `server.js`·`routes/policies.js`·`services/gateway-internal.js` → 재시작 ③ dashboard dist ④ gateway 바이너리(DDL 뒤) ⑤ `linkguard-agent` 바이너리를 .54·.57·.58에 설치(온보딩).
**ENV** — 게이트웨이(.65 EnvironmentFile): `GW_LINKGUARD_HASH_SECRET=<64 hex>` (`openssl rand -hex 32`) · 선택 `GW_LINKGUARD_REFRESH` · `GW_LINKGUARD_ENABLED=false`(비상 차단). Node(.65): **해시 비밀 ENV 없음**(게이트웨이 내부 API 로 받는다 · Codex 1R 정정) · 선택 `LINKGUARD_SYNC_INTERVAL_SECONDS` · `LINKGUARD_PUBLIC_BASE_URL`. 게이트웨이 바이너리보다 Node 가 먼저 올라가면 관제 현황 "해시 미준비(GATEWAY_HASH_SECRET_NOT_CONFIGURED)"가 정상이다 — ④ 뒤 60초 안에 풀린다.
**켜는 순서** — 발송 정책(전역 또는 고객사)에서 「URL 차단 집행」 on → 관제 화면에서 자격 발급 → 에이전트 `check-config` → (암호화 → 서비스 등록) → **전송기 잠시 정지 → pending 이 ready 로 올라가는지 확인 → 전송기 pickup 상태값 ready 로 전환 → 전송기 재개** → 악성 테스트 URL 1건 차단 실측(★Codex 3R — 전송기가 pending 을 읽는 채로 에이전트를 먼저 띄우면 같은 행을 두고 경쟁해 미검사 발송이 난다). 상세 = `deploy/linkguard-agent/README.install.md`.
**롤백** — 정책 토글 off(게이트웨이) · 에이전트: **pickup 이 ready 인 상태에서 정지(보류 행 승격됨) → SQL 로 held 0 확인 → 그 뒤** 전송기 pickup 원복 · `GW_LINKGUARD_ENABLED=false`. 마이그레이션은 추가 전용. 순서를 바꾸면(pickup 먼저 원복) 방금 승격된 ready 행을 전송기가 읽지 않는다.
**레퍼런스 설치 온보딩 SQL(각 서버, Harold 실행)** — `SELECT VERSION();` → `information_schema.tables`(schema·table·rows 상위 30) → `SHOW CREATE TABLE <수집 테이블>` → `SELECT <상태컬럼>, COUNT(*) … GROUP BY 1` → 전송기 설정에서 pickup 상태값 변경 가능 여부. 그 답이 방식 A(상태 승격)/B(트리거 팩·2차)를 정한다.

## 14. 이력
- **2026-09-04** — Harold 구상(관제센터 + 업체 설치 에이전트 + 판매) → 판단 3회 정정(한줄로 웹 제외 · 게이트웨이 층 · 범용 DBMS) → 설계 확정 → 같은 날 구현 완료(코어·관제센터·에이전트·게이트웨이 훅·검사 API·화면). KISA "데이터 제공형" 보안조치 요구 접수 → 해시 보관 모드를 1차에 편입. AI 판정 온/오프 토글 1차 포함(엔진은 어댑터). 미커밋·배포 대기. Codex 적대 검토 = 이 절 아래 라운드 기록.
- **Codex 1R(2026-09-04 · needs-attention · high 7 · medium 1)** — 전량 수용, 뿌리 6개로 묶어 구조 수정: ① 추출 우회(한글 IDN·조사 → §2-1 한글 처리 원칙) ② `KakaoFailoverTitle` 누락(→ 검사 필드 + reflect 대응표 테스트) ③ 해시 준비 상태의 조용한 fail-open(재시작 비밀 소실·Go/Node ENV 불일치 → §2-5 비밀 원천 = 게이트웨이 · 암호화 스냅샷 보존 · `hash_ready` 노출) ④ 큐 claim 없음·판정 폭주(→ §7-2 트랜잭션 + `lock_mode` 잠금 · processed 기준 backoff · 미만료 캐시 재질의 금지) ⑤ 비활성 API 자격의 판정기 사용(→ check·judge 403) ⑥ KISA 적재 allow 충돌 검사가 락 밖(→ 트랜잭션 첫 문장 advisory lock). 2R = 정정 줄 + 직접 호출부만.
- **Codex 2R(2026-09-04 · needs-attention · high 7 · medium 2 · 범위 밖 1)** — 수용 8 · 부분 수용 1. 같은 뿌리 재발 = "보류가 DB 에 없다"(1R ④의 잔여) → 구조 수정: **보류 = DB 상태 `held`**. ① 보류 결정을 DB 전 폐기(→ resolve 비파괴 + 갱신 seq 집합 기준 이력·remove) ② 보류 행 선두 점유 굶김(→ pending → held 전환 · pending 조회 제외 · 고아 복구 · 종료 drain) ③ KEEP 응답이 스냅샷 비밀을 지움(→ 적용 중 비밀 별도 보관 · 스냅샷은 항상 그 값) ④ Node 60초 캐시·키 회전 세대 혼재 → **부분 수용**: 코드 변경 없음, §2-5 회전 절차(재적재 필수 · 60초 창) 문서화. generation 컬럼(DDL)은 2차 = Harold 판단 항목 ⑤ 한글 휴리스틱이 유효 구성요소 폐기(→ §2-1 원문 보존 + 변형 추가) ⑥ hxxp 전체 치환·이모지 삼킴(→ 스킴 접두 치환 · 허용 문자 경계) ⑦ JSON 이스케이프 URL 미추출(→ `\/` 복원) ⑧ ProbeQueue UPDATE 미검증·실데이터 승격 위험(→ 불가능 조건 UPDATE 3종 + 롤백) ⑨ 비활성 403 judge 폭주(→ judge 회로) · [범위 밖] hold 맵 동시 접근 → 뮤텍스(수용). 설치 서브커맨드 결함(공용 설치기 전용 규약)은 안내문 작성 중 발견해 자체 설치기로 정정(§7-3). 라운드 상한 2 도달 → Harold 지시("끝까지")로 3R 진행.
- **Codex 3R(2026-09-04 · needs-attention · high 9 · medium 1)** — 전량 수용(구조 4). ① 고아 복구가 남의 보류 탈취·뒤 행 미도달 → **큐 단일 인스턴스 락**(§6) + 고아 복구 = 기동 시 1회·재보류 없이 비움 ② SKIP LOCKED 로 건너뛴 행까지 삭제 → 최종 전이는 잠금 대기 ③ 보류 중 목록 갱신 미반영 → 승격 직전 재평가 ④ 꺼진 설정 스냅샷 미저장 → disabled 응답도 저장 ⑤ 해시 회전 세대 공백 → **직전 비밀 병행 대조**(§2-5 · generation DDL 없이 공백 제거 · DDL 은 2차) ⑥ IPv6·괄호 우회 → 허용 문자 확장 + 균형 계산 절단 + 대괄호 authority ⑦ 종료 drain 실패 은폐 → 500행 청크·재평가·잔존 반환(Run 오류)·리포터 별도 컨텍스트로 drain 뒤 최종 flush ⑧ 전환·되돌리기 순서 → §13·README 재작성 ⑨ 암호화 뒤 서비스 경로 고착 → 암호화를 등록 앞으로 + 재등록 절차 ⑩(medium) held 전이 영구 오류 hot loop → backoff·경고 1분 1회·용량 사전 확인. 4R = 3R 정정 줄.
- **Codex 4R(2026-09-04 · needs-attention · high 9 · medium 1) — 코드 정정 정지, §15 재설계안으로 전환.** 뿌리별: [보류·락 상태기계 3회째] ① 락 세션이 끊겨도 기존 인스턴스가 계속 처리(락 세션 ≠ 작업 세션) ② `max_open_conns=1` 이면 락 커넥션이 풀을 고갈 ③ 고아 복구가 잠긴 행·일시 오류를 완료로 오인(기동 1회·SKIP LOCKED 빈 배치) ④ 최종 전이 무기한 잠금 대기 + 재평가가 잠금 밖 [비밀 세대 3회째] ⑤ 무효 현재 비밀 하나가 현재·직전을 모두 제거 ⑥ 2세대 한도라 A→B→C 회전에서 활성 A digest 무력화(generation 없음) [추출 wrapper 3회째] ⑦ 대괄호 IPv6 뒤 wrapper 가 붙으면 후보 소멸 + 실패 범위 마스킹 ⑧ 균형 절단이 userinfo `)@` 를 잘라 호스트를 숨김 [절차 2회째] ⑨ 전환·되돌리기 순서(서비스 시작 시점·ready 고립) ⑩(medium) 사용자 생성 전에 `sudo -u linkguard` 암호화. 재발 판정: 1~3R 에서 닫은 항목의 재오픈은 없으나 같은 뿌리 4묶음이 3회 연속 → 규율(같은 부류 2회 = 구조부터)대로 개별 정정 금지.

## 15. 에이전트 상태기계 재설계안 (2026-09-04 · 4R 뒤 정지 · **Harold 승인 대기**)
배경 = high 7·7·9·9. 정정하면서 새 구조를 통째로 넣고 내 적대 검토 없이 Codex 로 넘긴 것이 원인(§14). 코드 정정을 멈추고 설계를 한 장으로 먼저 올린다. 승인 뒤 한 번에 구현하고, 내 적대 검토 → Codex 1회.

### 15-1. 불변식 (코드가 증명해야 하는 것)
| # | 불변식 | 4R 에서 깨진 곳 |
|---|---|---|
| I1 | 큐 테이블 하나를 동시에 바꾸는 링크가드 **세션은 최대 1개** | 락 세션과 작업 세션이 달라 락을 잃어도 작업이 계속됨(①②) |
| I2 | held 행은 살아 있는 인스턴스의 메모리에 있거나 고아다. **고아는 다음 기동이 반드시 0 으로 만든다** | 기동 1회·빈 배치 = 종료·오류 = 계속(③) |
| I3 | held → ready 는 **행 잠금 → 같은 트랜잭션에서 현재 목록 재평가 → 갱신 → 커밋**. 잠금 밖 판정으로 ready 가 되지 않는다 | 재평가가 잠금 전·무기한 대기(④) |
| I4 | 해시 항목은 **그것을 만든 비밀**이 있을 때만 대조된다. 비밀 폐기 조건 = 그 비밀로 만든 활성 항목 0(관제센터가 증명) | 2세대 한도·무효 비밀이 전부 제거(⑤⑥) |
| I5 | 추출은 **원문 후보를 파괴하지 않는다**(변형은 추가만). 마스킹은 유효 후보를 만든 범위에만 | wrapper 절단이 authority 를 자름·실패 범위 마스킹(⑦⑧) |
| I6 | 전환·되돌리기 중 어느 시점에도 전송기가 **미검사 pending 을 읽지 않고, 승격된 ready 가 고립되지 않는다** | 서비스 시작 시점·ready 소진 확인 없음(⑨) |

### 15-2. 구조 (추천 = 이 안 하나)
- **A. 단일 작업 세션 = 락 세션.** 인스턴스 락을 잡은 `*sql.Conn` 하나가 스캔·해제·복구·drain 의 **모든 큐 트랜잭션**을 실행한다(스캔은 단일 goroutine 이라 커넥션 1개로 충분). 세션이 끊기면 다음 `BeginTx` 가 실패 → **재획득하지 않고 Run 오류 종료** → 서비스 매니저 재시작 → 새 락. 풀은 discover·check-config 만 쓴다(`max_open_conns` 문제 소멸). → I1
- **B. 잠금 대기 상한.** 트랜잭션마다 방언별 lock timeout(MySQL `SET innodb_lock_wait_timeout` · PG `SET LOCAL lock_timeout` · MSSQL `SET LOCK_TIMEOUT` · Oracle `FOR UPDATE WAIT n`) = yaml `lock_wait: 5s`. 초과 = 오류 → backoff(오류 **직후** 시각 기준).
- **C. 해제 전이 = 잠금 안 재평가.** held 행을 `SELECT seq, content … FOR UPDATE` 로 본문까지 다시 읽고 그 트랜잭션에서 Evaluate → block 이면 failed, 아니면 ready. 메모리 hold 는 마감·judge 캐시·URL 만 든다. → I3
- **D. 고아 복구 완료 조건.** 기동 시 `SELECT COUNT(*) … WHERE status = held` 가 0 이 될 때까지 for_update 잠금으로 배치 처리(bounded backoff · 상한 도달 = Run 오류). **복구가 끝나기 전에는 스캔을 시작하지 않는다.** → I2
- **E. 비밀 세대 = 원장에 기록(DDL).** `linkguard_url_entry.hash_key_id char(12) NULL`(해시 항목만) 추가 = 마이그레이션 056. keys 산출·KISA 적재가 현재 key_id 를 기록. sync 응답 entries 에 `hash_key_id`, settings 에 `hash_secrets: [{key_id, secret}]`(현재 + 활성 항목이 남은 옛 세대) 와 `hash_generations: [{key_id, active_count}]`. 에이전트는 key_id 별 비밀 링을 들고 **항목의 key_id 로 그 비밀만** 쓴다(HMAC 1회로 복귀). 옛 비밀의 원천 = 게이트웨이 ENV `GW_LINKGUARD_HASH_SECRET_PREVIOUS`(회전 때 옛 값을 옮겨 적고, `active_count` 0 이 되면 제거 · 관제 화면이 세대별 잔량 표시). 응답 비밀이 하나라도 무효 = **sync 오류**(마지막 정상 세대·스냅샷 불변). → I4
- **F. 추출 = 파싱 우선.** 스킴 범위 → (원문, wrapper 제거 변형들) 후보 집합 → 각 후보를 authority 문법으로 분리(`userinfo@host:port`) → 정규화가 받는 후보만 채택. 균형 절단은 authority·path 를 분리한 뒤 **URL 밖 문맥**에만. 유효 후보가 0 인 범위는 마스킹하지 않는다(다른 경로가 복구). → I5
- **G. 전환 절차.** 정방향 = **전송기 정지 → 서비스 시작 → pending 0 확인 → pickup=ready → 전송기 재개.** 역방향 = **유입 정지 → 에이전트 stop(drain) → 전송기가 ready 소진(ready 0 · held 0 확인) → pickup=pending → 유입 재개.** 사용자 생성·디렉터리 소유권은 준비 단계로 이동. → I6

### 15-3. 검증 계획
상태 전이표 테스트 하나(실 MySQL 종단): 상태 {pending, held} × 이벤트 {pass, block, unknown, judge 답, 마감, 목록 갱신, 종료, 락 상실, 잠금 타임아웃, 고아} 전 조합을 표에서 돌린다. 추출 회귀 계약에 IPv6 wrapper·userinfo·중첩 괄호 케이스. 내 적대 검토(전이표 대비 코드 대조)를 끝낸 뒤 Codex 1회.

### 15-4. 범위 · Harold 판단 3건
- 코드: `agent.go`(스캔·해제·복구·drain 재작성) · `scanner.go`(세션 기반·lock timeout) · `instance_lock.go`(세션 통합) · `core/extract.go`(파싱 우선) · `core/hashed.go`+`matcher.go`(key_id 링) · Node `linkguard-store/agent/admin`(key_id·hash_secrets·generations) · 게이트웨이 `keys/hash-secret`(key_id·previous) · `migrations/056` · README.
- ① 이 설계 승인 ② DDL 056(`hash_key_id` nullable · 원장 컬럼이라 Codex 대상) ③ Codex 는 재설계 뒤 1회(4라운드처럼 부분 정정을 반복하지 않는다).
