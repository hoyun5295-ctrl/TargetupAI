# 재시작 공백 때 화면이 0 으로 남는 결함 — 흐름 표 (1단계 · Harold 확인 전 설계 0)

> 접수 = 2026-11-26 Harold 「배포 뒤 크레딧부터 고객 숫자까지 전부 0 으로 보이다가 15초쯤 지나면 돌아온다 · 직접발송에 명단을 올려 준비하던 고객사가 데이터가 안 보여 다시 올려 잘못 나가는 게 걱정」 → 처방 방향 = 「화면이 공백을 기다렸다 다시 읽기」(Harold 「오케이 추천안으로」).
> Harold 조건 = **직접발송(요금제 안 쓰는 다수) · 대행 메일 접수를 포함한 모든 기간계에 영향 0**(메모리 `feedback_free_direct_send_zero_change`).
> 순서 = `status/DEFECT-PLAYBOOK.md` §1(흐름 표 빈칸 0 + Harold 확인 → 결함 장부 → 설계서).

## 0. 실측 · 재현 (근거)

| 무엇 | 결과 | 근거 |
|---|---|---|
| 서버가 비는 시간 | 1126 재시작 세 번 모두 1 ~ 3초(멈춤 요청 → 옛 프로세스 종료 같은 초 · 새 프로세스 API 배너 1 ~ 3초 뒤) | Harold 서버 출력 `~/.pm2/pm2.log` · out log |
| 그 시각 nginx | 12:29 ~ 12:30 서버 오류(500번대) 0 · 재시작 초(16 ~ 18)에 들어온 요청 0 | Harold 서버 출력 `/var/log/nginx/access.log` |
| 화면 재현(로컬 · 운영 무관) | 가짜 API 가 4초 동안 502 를 낼 때 대시보드에 들어가면 요청 18 종류가 한 번씩 502 → 전송건수 · 사용금액 0 · 충전 잔액 안 보임 → **서버가 돌아온 뒤 10초 · 25초에도 0**(같은 요청을 다시 보내지 않음 · 30초마다 도는 로그인 확인만 성공) | 시험 도구 = 스크래치패드 `restart-loop/fake-api.cjs` + 개발 화면 |
| 0 으로 그리는 자리 | `SendStatusCard.tsx:40-55` `stats?.monthly_total \|\| 0` 등 · `Dashboard.tsx:1524-1586` `loadStats` 첫 요청이 실패하면 나머지(요금제 · 잔액 · DB 현황)를 부르지 않고 끝 | 소스 |

## 1. 흐름 표 — 재시작 공백(1 ~ 3초)을 고객 요청이 만나는 이음매

칸 뽑기(기계): 화면의 요청 = `grep -rhoE "fetch\((\`|')/api" packages/frontend/src` → **244 파일 · 918 곳** + `axios.create` **7 곳**(`api/client.ts:6` · DM 화면 6) · 서버의 읽기 입구 = 스크래치패드 `restart-loop/get-writes.cjs`(routes 전 파일의 GET 입구 **505** · 본문에 쓰기 꼴 **44**).

| # | 흐름(고객이 하는 일) | 화면 쪽(쓰는 쪽) | 서버 쪽(읽는 쪽) | 공백을 만나면 오늘 | 값 범위(응답 꼴) | 그리는 화면 |
|---|---|---|---|---|---|---|
| F1 | 로그인 뒤 대시보드 진입 | `Dashboard.tsx:1524` `loadStats` · `:490` `loadCredit` · `:1592` `loadDashboardCards` · `:204` 등 18 종류(재현 기록) | `customers` stats · `companies` my-plan · my-credit · dashboard-cards · `balance` | 그 한 번 502 → 값 비움 → 카드 0 · 다시 읽지 않음 | 200 · 304 · 401 · 502 · 503 · 504 · 연결 실패 | 요금제 · 발송 현황 · DB 현황 · 오늘의 추천 카드 |
| F2 | 직접발송 화면 열기(회신번호 · 설정 · 문자 템플릿 · 080 번호 읽기) | `Dashboard.tsx:1654` settings · `:1668` callback-numbers · `:1699` sms-templates | `companies` settings · callback-numbers · `sms-templates` | 그 한 번 실패 → 회신번호 목록 · 템플릿 빈 칸 | 같음 | 직접발송 작성 칸 · 회신번호 고르기 |
| F3 | 직접발송 명단 올리기 | `DirectSendPanel.tsx:569` POST `/api/upload/parse` (같은 꼴 = 주소록 · 알림톡 · 브랜드 · 대행 화면 접수 · 고객 DB 매핑 6 곳) | `routes/upload.ts` parse | 502 → 올리기 실패 문장 → 고객이 다시 올림(아직 발송 전 = 안전) | POST · 502 · 연결 실패 | 명단 칸 |
| F4 | 수신거부 대조 · 준비분 넣기 · 대상 수 세기 | `DirectSendPanel.tsx:553` POST unsubscribes/check · `:488` POST direct-send/stage · `:501` POST direct-send/count | `routes/unsubscribes.ts` · `routes/campaigns.ts:1888` stage · count | 502 → 그 단계 실패 문장 → 다시 누름(아직 발송 전) | POST · 502 | 확인 창 |
| F5 | **직접발송 확정(발송)** | `Dashboard.tsx:811` · `:994`(직접 타겟) POST direct-send/commit · `AiLinePage.tsx:873` · `AiAskPage.tsx:567` | `routes/campaigns.ts:2026` commit(`stagingId` 한 번만 · 같은 준비분 두 번 확정 = 서버가 받지 않음) | 502 → `res.json()` 이 HTML 을 못 읽어 catch → 토스트 「발송 실패: Unexpected token …」(`Dashboard.tsx:882-885`) → **고객이 명단을 새로 올려 다시 보내면 새 준비분이라 막을 장치 없음** | POST · 502 · 연결 실패 | 토스트 |
| F6 | 대행발송 화면 접수 · 승인 | `agency/*` POST(접수 · 승인 · 취소) | `routes/agency-send.ts` | 502 → 그 요청 실패 문장 | POST · 502 | 대행 화면 |
| F7 | 대행발송 **메일 접수** | (화면 없음 · 서버 일꾼) | `utils/agency-send-mail-worker.ts`(1분 폴링 · POP3S) | 재시작 동안 그 틱만 쉬고 다음 틱에 이어 받음(메일함에 남음) | — | 메일 회신 |
| F8 | 서버 일꾼(직접발송 적재 · 스팸 검사 · 정산 · 자동 발송 등 `app.ts` `app.listen` 안에서 시작) | (화면 없음) | `app.ts:637` 이하 · `direct-send-worker.ts:1278-1288`(종료 신호 = 적재 중 줄을 청크 경계에서 내려놓고 끝 · 최대 8초) | 재시작은 적재 0 일 때만(런북 `status/OPS.md` §2-2 5) | — | — |
| F9 | 읽기인데 서버가 무엇을 쓰는 입구(GET 505 중 입구 본문에 쓰기 꼴 42 · 다시 본 결과 화면이 부르는 실제 쓰기 10) | 각 화면 | `companies.ts:572` my-plan(UPDATE plan_notified_code = 같은 값) · `spam-filter.ts:677` · `:908`(시간 넘긴 검사 닫기 · WHERE 상태 조건) · `sms-templates.ts:61`(MMS 경로 정리 = 같은 값) · `admin.ts:4817`(대행 충전 상태 · WHERE status='reserved') · `billing.ts:2825` · `:3340` · `:3346`(PDF 임시 파일 · updated_at) · `analysis.ts:940` · `:1166`(임시 PDF) · `upload.ts:995`(멈춘 올리기 표시 redis = 같은 값) · `cdp.ts:1303`(읽기 함수 이름에 걸림 = 쓰기 아님) | 같은 요청이 두 번 오면 그 쓰기가 두 번 | GET · 502 | 각 화면 |
| F11 | **서버가 스스로 내는 502**(AI 생성 실패 · 외부 게이트웨이 실패 등 JSON 응답) | 각 화면 | `grep -rn "status(502)" packages/backend/src` = **27 곳**(예: `ai.ts:2041` · `ai-memory.ts:783` · `admin.ts:4599`) | 화면이 그 문장을 보임 | 502 + JSON | 각 화면 실패 문장 |
| F12 | 주기적으로 다시 읽는 화면(발송 진행률 · 스팸 검사 결과 · 올리기 진행 · 대행 상세 · 로그인 확인 30초 등) | `setInterval` 과 `/api` 요청이 함께 있는 파일 **25** 곳(예: `Dashboard.tsx:862` 발송 진행 · `:1407` 올리기 진행 · `useSessionGuard.ts:41`) | 각 읽기 입구 | 한 번이 공백을 만나면 그 번만 실패 · 다음 번이 회복 | GET · 502 | 진행률 · 결과 칸 |
| F13 | 시간 제한을 건 읽기 | `new AbortController` · `AbortSignal.timeout` **28 곳**(예: `utils/dashboard-live.ts:109` `fetchJson` 10초) | 각 읽기 입구 | 화면이 끊으면 중단 오류 | Abort | 각 화면 |
| F14 | 공개 화면(대행 승인 링크 · 충전 승인 · 로그인) | `App.tsx:854` `/agency-approve` · `:855` `/charge-approve` · 로그인 POST | `routes/agency-approve` · `charge-approve` · `auth` | 읽기 = 빈 칸 / 승인 · 로그인 = 실패 문장 | GET · POST · 502 | 승인 화면 · 로그인 화면 |
| F15 | 이미 있는 전역 요청 감싸기(크레딧 사용 토스트) | `lib/credit-interceptor.ts:21-28`(`window.fetch` 전역 1회 감쌈 · `main.tsx:5` 에서 불러옴) · axios 는 `attachCreditInterceptor` | 응답 머리 `X-Credit-*` | 응답마다 한 번 크레딧 헤더를 본다 | 모든 응답 | 크레딧 토스트 |
| F16 | axios 로 부르는 화면 | `axios.create` **7 곳** = `api/client.ts:6`(대시보드 고객 통계 등) · `DmBuilderPage.tsx:80` · `stores/dmBuilderStore.ts:322` · DM 창 넷(`AbTestModal.tsx:18` · `AiImproveModal.tsx:16` · `VersionHistoryModal.tsx:24` · `FormControls.tsx:14`) | 각 입구 | fetch 와 같은 결과(브라우저 안 다른 통로 = XHR · 전역 fetch 감싸기가 닿지 않음) | GET · POST · 502 | 각 화면 |
| F17 | 브라우저가 직접 여는 `/api` 주소(링크 · 내려받기 · sendBeacon) | `href="/api/…"` 2 곳 · `sendBeacon` 1 곳 | 각 입구 | 그 번만 실패 | — | — |
| F18 | 화면 밖 손님(외부 API 고객 `/api/v1` · 싱크 에이전트 `/api/sync` · 외부 웹훅 `/api/woocommerce/webhook` 등) | (화면 없음) | `results.ts` · `sync.ts` · 웹훅 입구 | 재시작 1 ~ 3초 동안 502 · 보내는 쪽이 다시 보내는지는 미검증 | — | — |
| F19 | 프론트 배포(화면 파일 교체) 뒤 옛 화면 조각을 못 받음 | `lib/lazy-page.tsx:31` 한 번 새로고침 | (정적 파일) | 백엔드 재시작과 별개 | — | 새로고침 |
| F10 | 브라우저 이동으로 여는 서버 주소(OAuth 콜백 · 짧은 주소 · 메일 열람 표시 · 싱크 에이전트) | 주소창 · 에이전트(화면 요청 통로를 지나지 않음) | `short-url.ts:60` · `email.ts:195` · `sns.ts:946` · cafe24 · imweb · `sync.ts:1490` | 이번 처방이 지나지 않는 길 | — | — |

## 2. 판정 축(값 범위)

| 응답 | 오늘 | 처방 뒤(안) |
|---|---|---|
| 200 · 304 · 400번대(401 로그아웃 포함) | 그대로 | **그대로(받은 응답을 손대지 않고 돌려준다)** |
| 502 + JSON 이 아닌 본문(nginx 가 백엔드에 못 닿을 때 내는 HTML 쪽 · 재시작 공백) | 읽기 = 값 비움 → 0 / 쓰기 = `res.json()` 이 HTML 을 못 읽어 「발송 실패: Unexpected token …」 | 읽기(GET · HEAD) = 1초 간격으로 다시 읽기(최대 20초 · 화면이 끊으면 멈춤) / 쓰기 = **다시 보내지 않음** · 같은 502 에 JSON 문장(「방금 요청이 처리됐는지 먼저 확인」 꼴)을 실어 돌려줌 |
| 502 + JSON(서버가 스스로 낸 실패 · F11) | 화면이 그 문장을 보임 | **그대로** |
| 연결 실패(브라우저가 nginx 에 못 닿음 = 재시작 공백이 아님) | 화면마다 실패 처리 | **그대로** |
| 503(DB 칸 준비 전 · `DB_MIGRATION_PENDING`) · 504(오래 걸림) | 그대로 | 그대로(재시작 공백이 아니다 · 다시 읽으면 서버 부담만) |
| 화면이 스스로 끊음(Abort · 시간 초과) | 그대로 | 그대로(다시 읽지 않는다) |

## 3. 미가입 · 직접발송 변화 0 (설계서 맨 앞에 증명 표로 옮긴다)

- 서버 파일 변경 0 → 발송 · 예약 · 취소 · 큐 행 · 차감 · 대행 메일 접수 · 일꾼 전부 지금과 같다.
- 성공 응답은 화면이 원래 받던 그 응답 그대로 → 성공 흐름의 문장 · 차례 변화 0.
- 쓰기(POST · PUT · PATCH · DELETE)는 어떤 경우에도 다시 보내지 않는다 → 발송 횟수 변화 0.
- 바뀌는 것 = 502 · 연결 실패를 만난 갈래뿐(읽기 = 기다렸다 다시 · 쓰기 = 안내 문장).

## 3-1. 다시 검토(1126 · Harold 「빠진 거 없나 다시 한번 제대로 검토」)

- 더한 이음매 = F11 ~ F19(서버가 스스로 내는 502 · 주기 읽기 · 시간 제한 · 공개 화면 · 이미 있는 전역 감싸기 · axios 7 · 브라우저 직접 주소 · 화면 밖 손님 · 프론트 배포 새로고침).
- 바뀐 판정 = 다시 읽는 조건을 「502 + JSON 아닌 본문」으로 좁힘(F11 의 27 곳은 서버가 일부러 낸 실패라 다시 읽으면 AI 를 다시 부르는 등 일이 늘어난다) · 연결 실패는 재시작 공백이 아니라 그대로.
- F9 다시 뽑기 = 입구 본문만(뒤에 붙은 도우미 함수 제외) · 화면이 부르는 실제 쓰기 10 곳은 모두 같은 값 다시 쓰기 · 상태 조건 · 임시 파일 · 캐시. 다시 읽기는 첫 번이 nginx 502 일 때만이라, 서버가 그 요청을 받지도 못한 경우(연결 거절)는 두 번째가 첫 실행이다. 받은 뒤 프로세스가 끝나 끊긴 경우만 두 번 실행될 수 있다.
- 뽑기 한계 = 입구가 부르는 `utils` 함수 안의 쓰기는 이 뽑기로 못 본다 → 설계서에서 화면이 부르는 GET 입구가 쓰는 utils 를 따로 본다.

## 3-2. 설계 판에 따른 범위(1126 · 설계서 3판 §2)

- 처방이 닿는 칸 = F1(대시보드 카드 불러오기 셋 = 서버가 돌아오면 같은 함수 다시 부르기) · F5(직접발송 · 직접 타겟 발송 확정 = 문장만).
- F2(직접발송 설정 · 080 · 회신번호)는 같은 뿌리지만 이번 범위 밖 = 직접발송 상태를 쓰는 함수라 늦은 응답이 고객이 고른 회신번호를 덮을 수 있다(Codex 설계 2R #1) → 직접발송 전용 설계로 따로.

## 4. Harold 확인 받을 것

- 이 흐름 표(F1 ~ F10)에서 빠진 흐름이 있는가.
- 범위 밖(기록만): 20초 넘게 실패하면 지금처럼 0 으로 남는다(244 파일의 「실패를 0 으로 그림」 자체를 바꾸는 일은 별건) · 서버 공백 자체를 없애는 무중단 재시작(pm2 cluster · 웹 / 일꾼 분리) · 재시작 순간 처리 중이던 확정 요청의 응답이 끊기는 틈(F5 · 서버 종료 처리 = 발송 경로라 이번 범위 밖).
