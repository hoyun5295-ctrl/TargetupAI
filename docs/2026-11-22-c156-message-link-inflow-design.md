# C156 유입 경로 — 문자 링크로 들어온 방문 가리기 설계서

> 카드 C156 · 2026-11-22 · 3판(설계 Codex 1R 다섯 · 2R 넷 반영 · §9) · 스냅 대조 3차의 셋째 축(첫째 = [C154](2026-11-22-c154-send-ledger-rollup-design.md) · 둘째 = [C155](2026-11-22-c155-ask-answer-conversation-design.md) · 넷째 = C157)
> 접수 = Harold 1122 「다음과제로 한것들도 채용할만한거 있음 해야지?」 → 추천 표(문자 링크로 들어온 방문 식별 = 채용) → 「전체 다 설계 제대로하고 … 구현도 … 보고」
> 앞 설계 = [C152 §2-E 유입 경로](2026-11-21-c152-snap-gap-upgrade-design.md)(알고 두는 한계 = 「문자 링크로 들어온 방문은 referrer 가 비어 직접 방문」 · §8-4 다음 과제 후보)

## §0 접수 대조표

| # | 약한 것 | 지금(코드 근거) | 닫는 자리 |
|---|---|---|---|
| A | 우리가 보낸 문자의 링크를 눌러 들어온 방문이 「직접 방문」으로 잡힌다 | 경로 판정 = 방문 시작 줄의 주소 꼬리표(`utm_source`) → referrer(`inflow-channel.ts inflowChannelSql`) · 문자 앱에서 연 링크는 referrer 가 빈다 · 추적 링크의 넘겨주기 = `routes/short-url.ts` `res.redirect(302, resolved.fullUrl)`(주소를 그대로 넘긴다) | §2 S1 · S2 |

### §0-1 미가입 · 직접발송만 쓰는 회사 = 동작 변화 0

| 자리 | 변화 |
|---|---|
| 직접발송 · AI 한줄로 · 한 줄로 묻기 문자 | 0 — 이 길들은 추적 링크로 바꾸지 않는다(본문 주소 그대로 나간다 · 이번에도 그대로) |
| 배포 직후(ENV 명단이 빈 동안) | 0 — 전 회사 · 전 링크가 지금과 같은 주소로 넘어간다(S1 의 첫 판정 = 명단) · 넘겨주기 길에는 명단을 연 뒤에도 DB 읽기가 더해지지 않는다(S1 나) |
| 명단에 든 회사의 추적 링크(여정 · 자동마케팅 · 시험 발송 `campaign-split`) | 넘겨주는 주소 끝에 표식 한 칸이 붙는 것은 S1 판정표를 **전부** 통과한 주소뿐(등록된 자사몰 Origin · 단순한 주소) · 그 밖 = 지금 그대로 |
| 자사몰 도메인을 등록하지 않은 회사(수집 연동 없음) | 0(등록 목록이 비면 붙이지 않는다) |
| 담당자 링크(충전 승인 · 대행 승인 · 자동 발송 멈춤 등 `isManagerLinkUrl`) | 0(판정 앞에서 뺀다 · 조각이 있는 주소도 뺀다) |
| 문자 본문 | 0(받는 분이 보는 글 · 짧은 링크 글자는 바뀌지 않는다 · 바뀌는 것은 누른 뒤 도착하는 주소뿐) |

### §0-2 결정 표(추천대로 진행 · Harold 가 뒤집을 수 있게 맨 앞에 둔다)

| # | 결정 | 이유 · 다른 길 |
|---|---|---|
| D1 | 붙이는 것 = **우리만 쓰는 쿼리 칸 하나** `hanjul_link=1` · 표준 꼬리표(`utm_source` · `utm_medium`)는 붙이지 않는다 · 목적지에 `utm_source` 가 이미 있으면 아무것도 붙이지 않는다(고객이 단 꼬리표가 먼저 · 그 방문은 지금 갈래 그대로) | 고객이 이미 `utm_source=hanjul` 같은 값을 쓰고 있을 수 있다 — 표준 꼬리표로 가리면 그 방문 · 지난 방문까지 새 줄로 옮겨 간다(설계 Codex 1R). 우리만 쓰는 칸이면 그 칸이 든 방문 = 우리가 붙인 것뿐이다 |
| D2 | 붙이는 목적지 = 그 회사 `companies.cdp_allowed_origins` 와 **Origin 전체(스킴 · 호스트 · 포트)** 가 맞는 주소 · 비교 함수 = 수집 판정(`cdp-auth requireCdpBrowserOrigin`)과 **같은 함수 하나**(`mall-origins.ts normOrigin` = 소문자 · 끝 `/` · `www.` 뗌) | 표식을 읽는 것은 우리 수집 스크립트가 깔린 사이트뿐 · 호스트만 맞추면 수집이 거절되는 Origin(다른 스킴 · 포트)의 주소까지 바꾼다(설계 Codex 1R) |
| D3 | 등록 Origin 이어도 **단순한 주소만** 붙인다(S1 판정표) · 서명 · 토큰 · 불투명한 값이 든 쿼리 · 조각(`#…`)이 있는 주소 = 원문 그대로 | 등록된 자사몰의 쿠폰 · 로그인 주소가 쿼리 전체를 서명으로 검증하면 한 칸만 더해도 거절된다(설계 Codex 1R) · 모르는 꼴은 건드리지 않는다 |
| D4 | 유입 경로 갈래 = **그 세션의 가장 이른 시각의 페이지뷰들 가운데** 표식이 든 줄이 있으면 「한줄로 메시지 링크」(같은 시각 줄들의 순서에 기대지 않는다 · 방문 도중에 누른 링크는 그 세션의 갈래를 바꾸지 않는다) | 한 묶음으로 올라온 페이지뷰는 서버 시각이 같아 「가장 이른 한 줄」이 흔들린다(`cdp-events.ts ingestBrowserEvents` 가 묶음 하나에 시각 하나를 쓴다 · 설계 Codex 1R) · 세션 어느 줄이든 보면 표식 앞의 방문 · 구매까지 새 줄로 옮겨 간다(2R) |
| D5 | 켜기 = ENV `SHORT_URL_INFLOW_TAG` **회사 명단**(비어 있음 = 닫힘 · `*` = 전 회사 · 회사 id 쉼표 목록 · `sns-constants companyListAllows`) · 사내 회사 → 전체 순서 · 되돌리기 = 명단에서 빼거나 비우고 재시작 | 배포만으로는 아무 주소도 바뀌지 않는다 · 한 회사의 링크가 깨지면 그 회사만 뺀다 · 설정 화면을 늘리지 않는다 |
| D6 | 직접발송 · AI 한줄로 · 한 줄로 묻기의 링크를 추적 링크로 바꾸는 것 = **이번에 하지 않는다** | 받는 분이 보는 주소가 한줄로 도메인으로 바뀌고 스팸 판정에 영향이 갈 수 있다(문안 · 도착률이 걸린 일 = 따로 실측하고 정한다 · §8-1) |

## §1 흐름 표

| # | 이음매 | 지금 | 판정 자리 | 값 범위 | 그리는 화면 |
|---|---|---|---|---|---|
| F1 | 추적 링크 만들기 | 여정 실행기(`journey-executor.ts shortenUrlsInTexts`) · 자동마케팅(`continuous-operator.ts shortenUrlsInText`) · 시험 발송(`campaign-split.ts shortenUrlsStrict`) · 담당자 링크들(`createShortUrl`) → `message_short_urls`(hash · full_url · company_id · campaign · journey · step · variant · customer) | `utils/short-url.ts` | 저장되는 주소 = 임의의 `http(s)` 주소 | - |
| F2 | 누름 | `GET /c/:hash` → `resolveShortUrl` → 302 `fullUrl` → (비동기) 누름 기록 `message_click` · 누른 수 · A/B 보상 · 고객 연결 | `routes/short-url.ts` | 없는 hash = 기본 주소 · 담당자 링크 = 기록 안 함 · 미리보기 로봇 = 기록 안 함 | - |
| F3 | 방문 수집 | SDK `page_view`(첫 화면 · `pushState` · `replaceState` · `popstate` · `hashchange` 마다 `window.location.href` 를 싣는다 · `sdk-js auto-capture/pageview.ts`) → 묶음 하나로 올라온다 → `ingestBrowserEvents` 가 묶음의 모든 줄에 같은 `occurred_at` · `session_id` 를 쓴다 · 수집은 등록 Origin 에서만(`requireCdpBrowserOrigin`) | `cdp-events.ts` · `cdp-auth.ts` | 같은 묶음 안의 줄 순서 = 서버가 모른다 | - |
| F4 | 경로 판정 | 세션의 가장 이른 `page_view` 한 줄: `utm_source` 있음 → 「링크 꼬리표 · 값」 / referrer 빔 → 「직접 방문」 / 같은 호스트 → 「직접 방문」 / 검색 / SNS / 다른 사이트 | `inflow-channel.ts INFLOW_SQL` 의 `sess` | 여섯 갈래 | 성과 화면 「유입 경로」 카드(`InflowChannelCard.tsx`) · 한 줄로 묻기 답의 근거 문서 |

## §2 서버

### S1 넘겨줄 주소

**(가) 순수 함수 둘 — `utils/short-url.ts`**

상수 `INFLOW_MARK = 'hanjul_link=1'`(붙이는 글자 · S2 가 읽는 글자 = 이 상수 하나).

`inflowTagOrigin(fullUrl): string | null` — 이 주소가 「붙여도 되는 꼴」이면 그 Origin(`normOrigin` 을 거친 값), 아니면 `null`. 판정표(위에서부터 · 하나라도 걸리면 `null` = 원문 그대로):

| # | 걸리는 것 | 왜 |
|---|---|---|
| 1 | 길이 2,000자 초과 · `new URL` 실패 · 스킴이 `http:` · `https:` 가 아님 · 사용자 정보(`user:pw@`)가 있음 | 읽지 못하는 주소 · 앱 링크 · 다른 스킴은 건드리지 않는다 |
| 2 | 담당자 링크(`isManagerLinkUrl`) | 승인 토큰이 든 주소 |
| 3 | 조각(`#`)이 있음 | 조각으로 길을 찾는 화면 · 조각에 토큰을 싣는 주소 |
| 4 | 쿼리 칸이 8개 초과 | 단순한 주소가 아니다 |
| 5 | 어느 칸이든 이름이 `[A-Za-z0-9_.\-\[\]]{1,40}` 꼴이 아님 · 값이 `[A-Za-z0-9_.\-,%+]{0,24}` 꼴이 아님(원문 글자 그대로 본다 · 풀지 않는다) · `=` 가 없는 칸 | 긴 값 · `/` `=` `:` 가 든 값 = 서명 · 토큰 · 인코딩된 덩어리일 수 있다(MD5 32자 · UUID 36자 · HMAC 64자 · base64 는 모두 여기서 걸린다) |
| 6 | 어느 칸이든 이름(소문자)이 `utm_source` · `hanjul_link` 이거나, 서명 · 인증류 이름표에 든다: 같은 이름 = `sig` `sign` `signature` `token` `auth` `authorization` `key` `apikey` `api_key` `hmac` `hash` `expires` `expire` `exp` `nonce` `ticket` `otp` `password` `passwd` `pw` `secret` `session` `sessionid` `session_id` `sid` `code` `state` `policy` `credential` / 앞 글자 = `x-amz-` `x-goog-` / 끝 글자 = `token` `signature` `secret` `password` `_sig` | 고객이 단 꼬리표가 먼저 · 이미 붙은 주소에 또 붙이지 않는다 · 짧은 서명도 이름으로 거른다 |

`inflowTaggedUrl(fullUrl, allowedOrigins): string` — `inflowTagOrigin` 이 `null` 이거나 그 값이 `allowedOrigins.map(normOrigin)` 에 없으면 **받은 주소 그대로**. 있으면 **받은 글자 뒤에 붙이기만** 한다: 쿼리가 없으면 `?hanjul_link=1` · 있으면 `&hanjul_link=1`(`?` · `&` 로 끝나면 구분자 없이). 있던 글자는 한 글자도 바꾸지 않는다(`URL` 객체로 다시 쓰지 않는다 = 있던 칸의 인코딩 · 순서가 그대로다).

판정표의 기대값(시험이 고정한다): `https://shop.example` 등록일 때 `http://shop.example/…` = 원문(스킴) · `https://shop.example:8443/…` = 원문(포트) · `https://www.shop.example/…` = 붙인다(`www.` 만 같은 사이트) · `https://m.shop.example/…` = 원문(따로 등록해야 한다 · `mallPlatformOrigins` 가 몰 연동 때 `m.` 을 같이 넣는다) · `https://SHOP.example/…` = 붙인다(호스트 소문자).

**알고 두는 한계**: 24자 이하의 값에 이름표에 없는 이름으로 서명을 싣는 주소는 5 · 6 을 지난다. 그 위험은 D5 로 가둔다 — 회사마다 명단으로 열고(사내 회사 먼저), 그 회사의 링크가 깨지면 명단에서 뺀다. 목적지는 그 회사가 스스로 등록한 자사몰 Origin 뿐이다.

**(나) 등록 Origin 기억 — 넘겨주기 길에서 DB 를 읽지 않는다(`utils/short-url.ts`)**

- 프로세스 안 기억 하나(회사 id → 등록 Origin 목록 · 채운 시각). 넘겨주기는 이 기억만 본다(동기 · 대기 0).
- 채우기 = 뒤에서 60초마다 도는 일 하나(`startInflowOriginRefresher` · `app.ts` 에 등록 · 기동 직후 한 번): 명단(`SHORT_URL_INFLOW_TAG`)이 비면 기억을 비우고 끝(DB 0). 아니면 조회 하나로 통째로 새로 채운다 — `SELECT id, cdp_allowed_origins FROM companies WHERE COALESCE(array_length(cdp_allowed_origins, 1), 0) > 0 AND (<전 회사> OR id = ANY(<명단>))`.
- **동시에 도는 조회 = 언제나 하나 이하**(앞 조회가 끝나지 않았으면 이번 차례를 건너뛴다 · 누름 수 · 회사 수와 무관) → 조회가 쌓여 연결을 차지하는 길이 없다.
- 기억이 5분보다 오래됐으면(채우기가 멈췄다 · 늦다) `allowedOriginsNow(companyId)` 는 `null` = 원문으로 넘긴다. 기동 뒤 첫 채우기 전에도 `null`.
- 등록 목록을 고친 뒤 최대 60초 동안 옛 목록으로 판정한다(지운 도메인에 60초 더 붙을 수 있다 = 그 회사가 쓰던 자사몰 주소).
- 상수 `INFLOW_ORIGIN_REFRESH_MS = 60000` · `INFLOW_ORIGIN_STALE_MS = 300000`.

**(다) 넘겨주기 순서 — `routes/short-url.ts`(302 는 지금처럼 한 곳 · 더해지는 `await` 0)**

1. `resolveShortUrl`(지금 그대로 · 없으면 기본 주소).
2. 명단 판정 `companyListAllows(resolved.companyId, process.env.SHORT_URL_INFLOW_TAG)` — 닫힘이면 **여기서 끝**(원문 302 · 지금과 같은 길).
3. `inflowTagOrigin(resolved.fullUrl)` — `null` 이면 원문 302(담당자 링크 · 조각 · 서명 꼴이 모두 여기서 빠진다).
4. `allowedOriginsNow(resolved.companyId)`(기억 · 동기) — `null` 이면 원문 302.
5. `inflowTaggedUrl` 의 결과로 302.

2 ~ 5 는 순수 계산과 기억 읽기뿐이다(넘겨주기가 이 기능 때문에 기다리는 시간 0). 2 ~ 5 를 감싼 `try` 가 무엇을 던져도 원문 302.

**누름 기록 · 자사몰 인지(`detectKoreanEcommerce`) · 고객 연결 · A/B 보상은 원래 주소(`resolved.fullUrl`)로 지금 그대로**(기록되는 주소가 바뀌지 않는다).

**(라) 비교 함수 한 곳 — `utils/mall-origins.ts normOrigin(o)`**

`cdp-auth.ts requireCdpBrowserOrigin` 안의 `norm`(trim · 소문자 · 끝 `/` 뗌 · 스킴 뒤 `www.` 뗌)을 `mall-origins.ts`(수집 허용 도메인 CT)로 옮겨 내보내고, `cdp-auth` 와 `short-url` 이 같이 쓴다(동작 같음 · 글자 그대로 옮긴다).

### S2 갈래(`utils/inflow-channel.ts`)

- `inflowOwnSql(url)` = 주소에서 **조각을 떼고 첫 `?` 뒤의 쿼리만** 꺼내 그 안에서 표식 칸을 찾는다: `COALESCE(substring(split_part(url, '#', 1) from '[?](.*)$') ~ '(^|&)hanjul_link=1(&|$)', false)`(글자 = `INFLOW_MARK` 에서 만든다). 경로 · 조각 · 다른 칸의 값 안에 든 같은 글자는 잡지 않는다(`/#/a?hanjul_link=1` · `/items/&hanjul_link=1` · `?returnUrl=https://o.example/?hanjul_link=1` · `?xhanjul_link=1` · `?hanjul_link=10` = 전부 아님).
- `INFLOW_OWN_LABEL = '한줄로 메시지 링크'`.
- `INFLOW_SQL` 의 `sess`: 세션마다 **가장 이른 `occurred_at` 을 가진 페이지뷰들**(같은 묶음으로 올라와 시각이 같은 줄들) 가운데 `inflowOwnSql` 이 참인 줄이 하나라도 있으면 `own`. 경로 = `CASE WHEN s.own THEN '한줄로 메시지 링크' ELSE <지금의 inflowChannelSql> END`.
  - 그 뒤 시각의 페이지뷰에 표식이 있어도 그 세션의 갈래는 바뀌지 않는다(방문 시작 = 세션의 가장 이른 시각이라는 지금 규칙 그대로 · 표식 앞의 방문 · 구매가 새 줄로 옮겨 가지 않는다).
- `inflowChannelSql` 은 **고치지 않는다**(여섯 갈래의 차례 · 글 그대로 · 고객이 단 `utm_source=hanjul` 은 지금처럼 「링크 꼬리표 · hanjul」).
- 구매 귀속 = 지금 그대로(같은 세션 → 그 고객의 7일 안 가장 늦은 방문 시작) · 표식으로 **시작한** 세션의 구매만 새 줄로 간다.
- 지난 방문: 표식이 든(위 식이 참인) 페이지뷰가 지금 0건인지 **배포 앞에** 센다(§7 C156-S0 · 0 이 아니면 배포하지 않고 보고한다 = 새 갈래 코드가 서버에 올라가기 전에 판정이 끝난다).
- 분류를 되돌리기 = 명단을 비우면 새 표식이 생기지 않는다 · 이미 표식으로 시작한 세션은 그대로 새 줄에 남는다(우리가 붙인 것이 사실이다) · 줄 자체를 없애려면 코드 되돌리기.

**알고 두는 한계**: ① 자사몰 서버가 화면을 띄우기 전에 주소를 바꿔 쿼리를 버리면(예: 다른 도메인으로 넘김) 표식이 수집되지 않는다 = 그 방문은 지금처럼 「직접 방문」. ② 자사몰을 보던 중(같은 세션)에 문자 링크를 누른 방문은 그 세션이 시작한 갈래에 남는다(지금의 꼬리표 방문과 같은 규칙).

## §3 화면

- 「유입 경로」 카드(`InflowChannelCard.tsx`): 줄 이름이 서버 글 그대로라 코드 변경 0 · 카드 아래 안내 한 줄만 고친다 = 「한줄로 메시지 링크 = 한줄로가 줄여 보낸 링크(여정 · 자동 마케팅)를 눌러 들어온 방문이에요. 본문에 주소를 그대로 적어 보낸 문자는 직접 방문에 들어 있어요.」
- 한 줄로 묻기 답의 근거 문서(유입 경로 표가 들어가는 자리가 있으면)도 같은 줄 이름을 그대로 쓴다(코드 변경 0 · 구현 때 확인).

## §4 영향표

| 고치는 것 | 소비처 | 영향 |
|---|---|---|
| `routes/short-url.ts` 302 주소 | 추적 링크를 누르는 받는 분 전부 | 명단이 빈 동안 0 · 명단에 든 회사의 판정표 통과 주소에만 표식 한 칸 |
| `cdp-auth.ts` 의 `norm` → `mall-origins.ts normOrigin` | `requireCdpBrowserOrigin` 하나(구현 때 `norm(` · Origin 비교 전수 grep 으로 다시 확인) | 0(글자 그대로 옮김 · 계약 시험으로 고정) |
| `INFLOW_SQL` 의 `sess` | 성과 카드 주소 `/api/ai/operator/performance/inflow-channels` · `ask-answer` 가 유입 표를 쓰면 그 표 | 표식이 든 세션만 새 줄 · 그 밖 세션의 갈래 = 지금 그대로(`inflowChannelSql` 무변경) |
| `message_click` 기록 | 여정 누름 판정(`journey-click.ts`) · A/B 보상 · 누른 수 | 0(원래 주소로 기록) |

## §5 시험

- 순수(`inflowTagOrigin` · `inflowTaggedUrl`): 판정표 1 ~ 6 의 줄마다 걸리는 예 하나 + 바로 옆의 지나는 예 하나(값 24자 / 25자 · 칸 8개 / 9개 · `code` / `xcode` · `token` / `accessToken` / `tokyo`) · D2 기대값 다섯(스킴 · 포트 · `www.` · `m.` · 대소문자) · 붙인 뒤 있던 글자가 앞부분과 글자 그대로 같다 · `?` 로 끝나는 주소 · 이미 표식이 있는 주소 · 고객이 단 `utm_source`.
- 순수(기억 · 채우기 = 조회 함수 · 시계를 넣어 주는 꼴): 채우기 전 = `null` · 채운 뒤 = 목록 · 5분 지나면 `null` · 명단이 비면 조회 0 이고 기억이 빈다 · 앞 채우기가 끝나지 않았으면 다음 차례는 조회를 시작하지 않는다(동시 조회 하나) · 채우기 실패 = 옛 기억 유지(5분 뒤 `null`).
- 실 PG(`INFLOW_SQL`): ① 표식 페이지뷰와 표식 없는 페이지뷰가 **같은 `occurred_at`** 인 세션 = 「한줄로 메시지 링크」(순서 무관) ② 고객이 단 `utm_source=hanjul&utm_medium=email` 세션 = 「링크 꼬리표 · hanjul」 그대로 ③ 표식으로 시작한 세션의 구매 = 새 줄의 구매 · 매출 ④ 표식 없는 세션들의 갈래 = 고치기 전 SQL 과 같은 결과 ⑤ **2R 반례**: 10:00 고객 꼬리표로 시작 → 10:05 구매 → 10:10 표식 페이지뷰인 세션 = 방문 · 구매 모두 고객 꼬리표 줄 그대로 ⑥ 표식 글자가 조각 · 경로 · 다른 칸의 값 안에만 있는 주소 다섯 = 새 줄 아님.
- 계약(소스 · 구문 트리): 302 호출이 명단 판정 → `inflowTagOrigin` → `allowedOriginsNow` 차례 뒤에 있다 · `resolveShortUrl` 과 302 사이에 더해진 `await` 가 없다 · 넘겨주기 파일이 `companies` 를 읽지 않는다 · 누름 기록 · `detectKoreanEcommerce` · `isManagerLinkUrl` 에 넘기는 주소 = `resolved.fullUrl` · `cdp-auth` 가 `normOrigin` 을 부른다(안에 따로 정규화 식이 없다) · 붙이는 글자와 읽는 글자가 같은 상수.
- 변이: 명단 판정 빼기 · 등록 Origin 검사 빼기 · 조각 검사 빼기 · 값 길이 상한 빼기 · 이름표 빼기 · 기억의 5분 기한 빼기 · 채우기 겹침 막기 빼기 · 누름 기록에 표식 주소 넘기기 · `own` 을 「가장 이른 한 줄」로 바꾸기 · `own` 을 세션 어느 줄이든으로 넓히기 · 표식 식에서 조각 떼기 빼기 · `inflowChannelSql` 에 `hanjul` 갈래 넣기.

## §6 직원 지시문(C156-ENV-1 로 사내 회사에 연 뒤)

1. (사내 계정 · 자사몰 연동 회사) 여정 문자에 자사몰 상품 주소를 넣어 시험 번호로 보냅니다. 받은 문자의 짧은 링크를 누르면 자사몰이 열리고 주소 끝에 `hanjul_link=1` 이 붙어 있습니다.
2. 그 창에서 상품을 하나 봅니다. 성과 화면 「유입 경로」에 「한줄로 메시지 링크」 줄이 보입니다.
3. 자사몰이 아닌 주소(예: 블로그)를 넣은 문자의 링크를 누르면 주소가 그대로입니다.
4. 자사몰 주소 끝에 `#review` 처럼 `#` 이 붙은 주소를 넣은 문자의 링크를 누르면 주소가 그대로입니다.

## §7 배포

**C156-S0(배포 앞 · 지난 페이지뷰에 표식이 든 줄이 0건인지 세는 읽기 명령 하나 · 식 = S2 의 `inflowOwnSql` 과 같은 글자)** → 0 이면 커밋 · push → 한줄로 배포(C156-H1 · DDL 0 · ENV 없음 = 닫힘 = 넘겨주는 주소 변화 0) → C156-ENV-1(`SHORT_URL_INFLOW_TAG` = 사내 회사 id · 재시작) → §6 → C156-ENV-2(`*`). S0 이 0 이 아니면 배포하지 않고 보고한다(표식 이름을 바꾼다). 되돌리기 = 명단에서 빼거나 비우고 재시작.

## §8 범위 밖

1. 직접발송 · AI 한줄로 · 한 줄로 묻기의 링크를 추적 링크로 바꾸기(받는 분이 보는 주소 · 스팸 판정 영향 실측이 먼저).
2. 문자 · 알림톡 · 브랜드 메시지별 줄 나누기(짧은 링크 줄에 채널이 없다).
3. 문자를 받은 뒤 링크 없이 들어온 방문을 「문자 뒤 방문(추정)」으로 가리기(C154 의 받은 고객 낱행이 닫히기 전 10일만 있다 · 추정이라 따로 설계).
4. 수집 스크립트가 없는 사이트의 유입(읽을 방문 기록이 없다).
5. 표준 꼬리표(`utm_source` · `utm_medium`)를 같이 붙여 고객사의 다른 분석 도구에도 보이게 하기(D1 · 고객 꼬리표와 섞이는 문제를 따로 풀어야 한다).
6. **기존 결함 후보(기록만 · 추가 과제)**: 같은 묶음으로 올라온 페이지뷰는 `occurred_at` 이 같아, 화면 전환이 빠른 사이트(주소를 바로 고쳐 쓰는 화면)에서 지금의 여섯 갈래가 「가장 이른 한 줄」을 잘못 고를 수 있다(검색 · SNS 방문이 「직접 방문」으로). 닫는 길 = 수집 스크립트가 사건마다 시각 · 순번을 싣기. 이번 축은 새 줄만 순서 없이 판정한다(D4).

## §9 구현 기록

- 1122 설계 Codex 1R = 지적 다섯(높음 둘 · 중간 셋) 전부 수용 → 2판.
  1. 등록된 자사몰의 서명 주소도 바뀐다 → D3 · S1 판정표(조각 · 값 꼴 · 이름표) + D5 회사 명단.
  2. 등록 Origin 읽기의 대기 상한 · 끄기 판정의 자리 → (2판) 대기 상한 · (다) 명단 → 순수 판정 → 읽기 차례 → (3판) 읽기를 길에서 뺌(아래 2R 의 1).
  3. 호스트 비교 ≠ 수집의 Origin 비교 → D2 · S1(라) 같은 함수 하나.
  4. 고객이 쓰던 `hanjul` 꼬리표가 새 줄로 옮겨 간다 → D1 우리만 쓰는 칸 · `inflowChannelSql` 무변경 · 켜기 앞 지난 방문 0건 확인.
  5. 같은 묶음의 페이지뷰 순서를 모른다 → D4(2R 에서 「가장 이른 시각의 줄들」로 좁힘) · 기존 갈래의 같은 문제는 §8-6 기록.

- 1122 설계 Codex 2R = 지적 넷(중간) 전부 수용 → 3판. 1R 의 2번과 2R 의 1번이 같은 뿌리(넘겨주기 길의 DB 읽기)라 상한을 덧대지 않고 **읽기 자체를 길에서 뺐다**.
  1. 뒤에서 도는 조회가 회사 수만큼 쌓인다 → S1(나) 넘겨주기는 기억만 본다 · 채우기는 60초마다 조회 하나(동시 하나 이하).
  2. 나중의 표식이 그 앞의 방문 · 구매를 새 줄로 옮긴다 → D4 · S2 세션의 가장 이른 시각의 줄들만 본다.
  3. 표식 정규식이 쿼리 밖 글자도 잡는다 → S2 조각을 떼고 첫 물음표 뒤만 본다 + 아닌 예 다섯.
  4. 지난 표식 검사가 새 갈래 배포보다 늦다 → §7 C156-S0 을 배포 앞으로.

- 1122 구현(설계 Codex 3R approve 뒤 · 미커밋).
  - `utils/short-url.ts`: `INFLOW_MARK` · `inflowTagOrigin` · `inflowTaggedUrl` · 등록 도메인 기억(`allowedOriginsNow` · `refreshInflowOrigins` · `startInflowOriginRefresher`) · 넘겨주기 차례 한 함수 `inflowRedirectUrl`(동기 · DB 0 · 무엇이 던져져도 원문) · `routes/short-url.ts` 는 302 의 주소만 그 함수의 값으로 바꿨다(누름 기록 · 자사몰 인지 · 고객 연결 = 원래 주소).
  - `utils/mall-origins.ts normOrigin`(수집 판정의 식을 글자 그대로 옮김) · `cdp-auth.ts` 가 그 함수를 쓴다. Origin 정규화 식을 따로 가진 자리는 그 하나였다(`cdp_allowed_origins` 를 읽는 다섯 파일 전수 = `routes/cdp.ts` · `cdp-app-id.ts` · `cdp-auth.ts` · `mall-origins.ts` · `woocommerce-client.ts` 가운데 비교를 하는 곳은 `cdp-auth` 뿐).
  - `utils/inflow-channel.ts`: `inflowOwnSql` · `INFLOW_OWN_LABEL` · `INFLOW_SQL` 의 `sess`(세션의 가장 이른 시각의 줄들 가운데 표식) · `inflowChannelSql` 무변경. `INFLOW_SQL` 을 쓰는 곳 = `listInflowChannels` 하나(성과 카드 주소) · 한 줄로 묻기 답의 표 넷에는 유입 경로 표가 없다(코드 변경 0).
  - 화면: `InflowChannelCard.tsx` 발치에 「한줄로 메시지 링크」 줄이 있을 때만 그 뜻 한 줄.
  - 일꾼 등록 = `app.ts startInflowOriginRefresher()`(명단이 비면 조회 0).
  - 시험: `c156-inflow-link.test.ts` 18(판정표 · 붙이는 꼴 · 기억 · 차례 · 소스 계약 · 갈래 SQL) · 실 PG `c156-inflow-link.pg.test.ts` 2(경로별 방문 · 구매 · 매출 = 2R 반례 포함 · 표식 식의 잡는 꼴 다섯 · 안 잡는 꼴 일곱) · 기존 `c152-snap-gap-1121.pg.test.ts` 17 그대로 통과(표식 없는 세션의 갈래 불변).

- 1122 구현 Codex 1R = approve(지적 0).
- 1122 미리보기(개발 서버 + 흉내 응답): 유입 경로 카드에 「한줄로 메시지 링크」 줄과 발치 한 줄 · 폭 320 넘침 0.
