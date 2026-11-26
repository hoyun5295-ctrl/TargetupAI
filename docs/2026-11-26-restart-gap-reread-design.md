# 재시작 공백 때 화면이 0 으로 남는 결함 — 설계서 (비어 있는 표시 값만 다시 읽어 채우기 · 5판)

> 흐름 표 = [docs/2026-11-26-restart-gap-reread-flow-ledger.md](2026-11-26-restart-gap-reread-flow-ledger.md)(F1 ~ F19 · 1126 다시 검토 · Harold 「빠진 거 없나 다시 한번 제대로 검토하고 시작하도록해」).
> 처방 방향 = Harold 1126 「오케이 추천안으로 쓰자」 · 조건 = 「직접발송에 문제가 없어야 해 · 대행발송 메일 접수나 이런 게 들어왔을 때 문제가 없어야 해 · 모든 기간계에 영향이 없어야 한다」.
> 뿌리 = **R109(새)** 한 번만 읽는 화면이 서버 재시작 공백(nginx 502)에 받은 실패를 그대로 굳힌다 — 다시 읽지 않아 값이 0 으로 남고, 확정 요청은 nginx 의 HTML 을 JSON 으로 읽다 깨진 문장(「Unexpected token」)을 보인다.
> **판 경위(§10)**: 1판 = 화면 요청 전체 감싸기 → Codex 1R 일곱(소비처마다 다르게 반응) → 2판 = 여섯 자리의 요청 **안에서** 기다렸다 다시 → Codex 2R 다섯(늦게 끝난 요청이 그 사이 바뀐 상태를 덮음 · 회신번호 선택 · 로그인 · 마감 · 크레딧 세대) = 1R #5 와 같은 부류 두 번째 → 3판 = 서버가 돌아오면 불러오기 함수를 처음부터 다시 → Codex 3R = 함수 전체를 다시 부르면 그 안의 다른 일(요금제 승인 창 → 새로고침 = 작성 중 초안 잃음 · 잔액 덮음 · 대기열 차례)까지 다시 돈다 = 같은 부류 세 번째 → **4판 = 함수를 다시 부르지 않는다. 실패한 카드 값 하나하나를 그 주소로만 다시 읽고, 그 값이 아직 비어 있을 때만 채운다(이미 다른 길이 채운 값은 절대 덮지 않는다).** 덮지 않으니 늦게 온 응답 · 차례 · 다른 일이 생길 자리가 없다. → Codex 4R = 다시 채운 **잔액**이 직접발송 확정의 성공 갈래(선불 잔액 다시 읽기)를 새로 열고 · 차감 전 잔액이 들어갈 수 있다 → **5판 = 화면 표시에만 쓰는 값 셋(발송 현황 · DB 현황 · AI 크레딧)만 채운다. 직접발송 판단에 쓰이는 값(요금제 = 기능 잠금 30 곳 · 충전 잔액 = 선불 확정 갈래 · 잔액 부족 창)은 채우지 않는다.**

## §0 요약

- CT 하나(`packages/frontend/src/lib/restart-gap.ts` · 순수 판정 + 다시 읽기 고리 · 전역 설치 0).
- 판정 = 상태 `502 · 503 · 504` 이고 `content-type` 에 `application/json` 이 없음(nginx 가 백엔드에 못 닿을 때 내는 쪽 · 서버가 스스로 내는 502 · 503 은 JSON = 손대지 않음).
- **대시보드 표시 값 셋**(발송 현황 = 고객 통계 · DB 현황 · AI 크레딧)을 읽는 요청이 판정에 걸리면(또는 앞 요청이 걸려 그 요청이 불리지도 않았으면), 원래 흐름은 오늘처럼 끝내고 → 그 값만 **같은 주소로 1초 간격 다시 읽기(최대 20초)** → 성공하면 **그 값이 아직 비어 있을 때만** 채운다. 다른 길이 먼저 채웠으면 아무것도 안 한다. 요금제 · 충전 잔액(직접발송 판단에 쓰이는 값)과 승인 · 변경 알림 · 다른 일은 다시 읽지 않는다(오늘처럼 비어 있음 = 요금제 칸 「로딩」 · 잔액 줄 숨김 · 기능 잠금 그대로).
- **직접발송 확정 두 곳** = 다시 보내지 않고 흐름도 그대로(오늘 `res.json()` 이 던지던 자리에서 같은 catch) · catch 의 문장만 「접수 여부를 확인하지 못했어요 …」.
- 그 밖(직접발송 설정 · 작성 · 명단 · 대상 수 · 대행 · 공개 화면 · 주기 읽기 · 모든 쓰기) = **글자 하나 안 바뀐다.**
- 서버 파일 변경 0 · DDL 0 · ENV 0 · 배포 = 프론트 빌드만(백엔드 재시작 없음).

## §1 미가입 · 직접발송 변화 0 — 증명 표 (메모리 `feedback_free_direct_send_zero_change`)

| 길 | 바뀐 코드 | 미가입 · 직접발송에서 왜 변화 0 인가 | 증명 시험 |
|---|---|---|---|
| 서버 전부(발송 · 예약 · 취소 · 큐 행 · 차감 · 대행 메일 접수 · 일꾼 · 웹훅 · SDK · 싱크) | 0 | 서버 파일을 바꾸지 않는다 | 커밋 목록에 `packages/backend/src` 운영 파일 0(시험 파일만) · Codex 구현 = HEAD 대비 diff 전수 |
| 화면 요청 통로(fetch 전역 · axios 7) | 0 | 전역 감싸기 없음 | 소스 계약: `window.fetch =` 대입 = `credit-interceptor.ts` 한 곳 그대로 · `axios.create` 7 곳 무변경 |
| 대시보드 표시 값 셋(F1 · 발송 현황 · DB 현황 · AI 크레딧) | 실패 갈래 끝에 「비어 있으면 채우기」 다시 읽기 | **원래 요청 · 응답 · 반영 차례는 오늘과 같다**(늦추지 않음 · 함수를 다시 부르지 않음) · 다시 읽은 값은 그 카드 값이 **아직 비어 있을 때만** 들어간다(어떤 길이 채운 값도 덮지 않음) · 알림 · 새로고침 · 발송 상태는 건드리지 않는다 | 「성공 = 다시 읽기 0」 · 「502 JSON · 401 · 연결 실패 = 다시 읽기 0」 · 「값이 이미 있으면 채우기 0」 · 소스 계약 「`setPlanInfo` · `setBalanceInfo` 를 다시 읽기가 부르지 않음」 |
| 요금제 · 충전 잔액(직접발송 기능 잠금 · 선불 확정 뒤 잔액 다시 읽기 `:854` · `:1061` · 잔액 부족 창) | 0 | 다시 채우지 않는다(Codex 4R #1 · #2) = 공백 뒤 그 둘은 오늘과 같이 비어 있음 | 소스 계약 |
| **직접발송 설정 · 회신번호 · 080 번호(F2)** · 작성 · 명단 · 수신거부 대조 · 준비분 · 대상 수(F3 · F4) | **0** | 손대지 않는다(Codex 2R #1 = 늦게 끝난 설정 읽기가 고객이 고른 회신번호를 기본값으로 덮을 수 있다 → 직접발송 상태를 쓰는 함수는 건드리지 않는다) | `loadCompanySettings` · `DirectSendPanel.tsx` diff 0 |
| 직접발송 확정 · 직접 타겟 발송 확정(F5 · B1 · B2) | 판정 한 줄 · catch 문장 갈래 | 다시 보내지 않는다(횟수 1) · nginx 502 때 가는 자리 = 오늘과 같은 catch → finally(발송 중 표시 해제) → 확인 창 닫기(Codex 2R 확인) · 그 밖 응답(402 · 라인그룹 · 발신 인증 · 실패 JSON · 성공)은 무변경 | 소스 계약: 판정 줄이 같은 try 안 `res.json()` 바로 앞 · catch 문장만 갈래 |

## §2 결함 장부 (흐름 표 칸마다 판정 · 3판)

| 칸 | 판정 | 처방 |
|---|---|---|
| F1 대시보드 | **결함**(재현) | 표시 값 셋 비어 있으면 채우기(§3-2) · 요금제 · 충전 잔액은 범위 밖(§8) |
| F2 직접발송 화면 설정(080 · 회신번호) | 같은 뿌리 · **이번 범위 밖**(직접발송 상태를 쓰는 함수 · 회신번호 선택을 덮는 순서 위험 · §8) | 없음(오늘 그대로) |
| F3 · F4 직접발송 쓰기(발송 전) | 오늘 그대로(다시 누르면 된다) | 없음 |
| F5 직접발송 확정 · 직접 타겟 발송 확정 | **문장 결함** | B1 · B2 문장만 |
| F6 · F14 · 플래너 확인 링크 | 같은 뿌리 · 범위 밖(§8) | 없음 |
| F7 · F8 · F18 | 범위 밖(서버 무변경) | 없음 |
| F9 · Codex 1R #4 · 2R 「세션 갱신 · 캐시 갱신」 | 다시 읽는 다섯 GET = 대시보드 첫 화면이 늘 부르는 같은 요청(세션 활동 갱신 · `swr-cache` 캐시 · my-plan 같은 값 쓰기 = 새로고침 한 번과 같은 일) | 없음 |
| F11 · F12 · F13 · F15 · F16 · F10 · F17 · F19 | 무변경 | 없음 |

## §3 처방

### 3-1 CT `packages/frontend/src/lib/restart-gap.ts`(순수 · 모듈 최상위 실행 0)

```ts
/** nginx 가 백엔드에 못 닿아 낸 응답인가 — 502 · 503 · 504 이고 JSON 이 아님(서버가 스스로 낸 502 · 503 = JSON) */
export function isRestartGap(status: number | undefined, contentType: string | null | undefined): boolean;
/** axios 오류가 그 응답인가(response.status · response.headers['content-type']) */
export function isRestartGapAxiosError(err: unknown): boolean;
/** 비어 있는 값 하나를 다시 읽어 채우는 고리 — 같은 열쇠는 한 번에 하나 */
export function refillWhenServerBack<T>(o: {
  token: string | null;                       // 실패한 요청이 실은 토큰(다시 읽기도 이 토큰만 싣는다)
  read: (token: string | null, signal: AbortSignal) => Promise<{ gap: true } | { gap: false; value?: T }>;
  fill: (value: T) => void;                   // 「비어 있을 때만」은 부르는 쪽이 setState(prev => prev ?? …)로 정한다
  ok: () => boolean;                          // 화면 살아 있음 && 지금 토큰 === token
  intervalMs?: number; deadlineMs?: number; attemptMs?: number; wait?: …; now?: …;
}): Promise<void>;
export class RestartGapError extends Error {}
export const RESTART_GAP_SEND_ERROR = '접수 여부를 확인하지 못했어요. 명단을 다시 올리기 전에 발송 결과에서 이 발송이 접수됐는지 먼저 확인해 주세요.';
```

- 고리: 마감 = 실패한 때 + `deadlineMs`(20000 · 절대) · 1초 기다림 → 마감 지났거나 `ok()` 거짓이면 끝 → `read`(시도 마감 시각 = `min(전체 마감, 시도 시작 + attemptMs 5000)` 을 시도 시작 때 고정 · 그 시각에 끊는 signal · 본문 읽기까지) → `gap` 이면 다시 → `gap: false` 이고 값이 있으면 **본문까지 끝난 시각이 그 시도 마감 안이고(타이머가 늦게 돌아도 시각으로 다시 본다 · Codex 5R #1)** `ok()` 참일 때만 `fill(value)`(마감 뒤 도착한 성공 = 채우지 않음 · Codex 4R #3) · 값이 없으면(401 · 500 · JSON 오류 등) 끝(오늘과 같은 화면) · 시도 하나가 제한에 걸리면 그 시도만 실패로 보고 마감 안에서 다음 시도.
- 20초 근거 = 옛 프로세스 종료 대기 최대 12초(`ecosystem.config.js` `kill_timeout`) + 새 프로세스 기동 1 ~ 3초(1126 실측) · 마감 = 채우지 않는다(오늘과 같은 화면).
- CT 에 모듈 상태 0 · 중복 막기 = 부르는 화면이 `useRef(new Set())` 로 그 화면 안에서만(열쇠 = 주소) · 고리가 끝나면 푼다 → 다른 화면 · 다음 진입의 다시 읽기를 막지 않는다(Codex 4R #4).
- 확인 요청을 따로 두지 않는다(Codex 3R #4) — 다시 읽기 자체가 「돌아왔나」를 본다 · 다섯 주소는 대시보드 첫 화면이 늘 부르는 GET 이다.

### 3-2 붙이는 자리(`packages/frontend/src/pages/Dashboard.tsx`)

| 값 | 원래 읽는 곳 | 다시 읽기를 거는 때 | 채우기(비어 있을 때만) |
|---|---|---|---|
| stats(발송 현황 · 이번 달 사용금액 · 고객 분석 창 · 오늘 통계 창) | `loadStats` `:1526` `customersApi.stats()` | 그 호출이 판정에 걸려 던짐(`:1584` catch) | `setStats(prev => prev ?? body.stats)` |
| dashboardCards(DB 현황) | `loadDashboardCards` `:1592` | `fetchJson` 결과 `gap` · 또는 `loadStats` 의 stats 가 걸려 불리지 않음 | `setDashboardCards(prev => prev ?? body)` · 기준 시각도 그때만 |
| creditInfo(AI 크레딧 · 크레딧 이력 창) | `loadCredit` `:483` | `fetchJson` 결과 `gap` | 다시 읽기를 시작한 세대 이후 차감 사건으로 낮춘 값(`loadCredit` 과 같은 식 = 함수 하나로 빼서 둘이 함께 씀)을 `setCreditInfo(prev => prev ?? capped)` |

- **채우지 않는 값**: `planInfo`(요금제 · 기능 잠금 `isSpamFilterLocked` 등 30 곳 · 직접발송 창 기능) · `balanceInfo`(충전 잔액 · 선불 확정 뒤 잔액 다시 읽기 `:854` · `:1061` · 잔액 부족 창) = 직접발송 판단에 쓰인다 → 공백 뒤 오늘과 같이 비어 있음(Codex 4R #1 · #2 · §8).
- 요금제 승인 알림(`:1573`) · 에이전트 잔액(`:1551`) · 요금제(`:1531`) · 충전 잔액(`:1540`) · 최근 캠페인 등 그 밖의 첫 화면 요청은 다시 읽지 않는다(Codex 3R #1 = 승인 창 → 새로고침 · 4R #1 #2 = 직접발송 판단 값).
- `ok()` = 화면 살아 있음(`useEffect` 정리에서 내려감 표시) && 지금 `localStorage` 토큰 === 실패한 요청의 토큰 · 다시 읽기 요청도 그 토큰만 싣는다(Codex 3R #3).
- `utils/dashboard-live.ts` `fetchJson` 결과에 `gap?: boolean` 칸만 더한다(본문을 읽기 **전** 판정 · 기존 칸 · 본문 읽기 · 10초 제한 · 28 소비처 무변경).
- 다시 읽기 요청 = 원시 `fetch`(axios 통로 · 401 처리를 지나지 않는다 · 401 이면 채우지 않고 끝 = 로그인 끝 처리는 세션 감시가 늘 하던 대로).

### 3-3 직접발송 확정 두 곳

| # | 자리 | 지금 | 바꿈 |
|---|---|---|---|
| B1 | 직접발송 `Dashboard.tsx:816` `const data = await res.json()` | HTML 이면 던져 `:882` catch → 「발송 실패: Unexpected token …」 → finally `directSending` 해제 → `:889` 확인 창 닫기 | 바로 앞 줄 `if (isRestartGap(res.status, res.headers.get('content-type'))) throw new RestartGapError();` · catch 문장 = `err instanceof RestartGapError ? RESTART_GAP_SEND_ERROR : 오늘 문장` |
| B2 | 직접 타겟 발송 `:1035` `res.json()` | catch `:1080` 「발송 실패」 · finally `targetSending` 해제 | 같은 판정 한 줄 · catch 문장만 갈래 |

- 판정이 503 · 504(JSON 아님)도 잡는다: 오늘 그 둘도 `res.json()` 이 던져 같은 catch 로 간다 → 흐름 같음 · 문장만.
- 고객 문장: 줄표 0 · 가운뎃점 0 · 우리 쪽 원인 단정 0(메모리 `feedback_customer_copy_no_self_blame`).

## §4 영향표 (바뀌는 것 → 소비처)

| 바뀌는 것 | 소비처 | 영향 |
|---|---|---|
| 새 파일 `lib/restart-gap.ts` | `Dashboard.tsx` · `dashboard-live.ts` | 전역 실행 0 |
| `fetchJson` 결과 칸 `gap` 추가 | `fetchJson(` 28 곳 | 칸 추가뿐 · 읽던 칸 · 동작 무변경 |
| 표시 값 셋의 「비어 있으면 채우기」 | 발송 현황 카드 · 고객 분석 창 · 오늘 통계 창 · DB 현황 카드 · AI 크레딧 칸 · 크레딧 이력 창 | 판정에 걸린 실패에서만 · 값이 비어 있을 때만 채움(비어 있는 동안 = 오늘은 0 · 숨김) · 직접발송 판단 값 무변경 |
| `loadCredit` 의 차감 사건 낮추기 식 | `loadCredit` · 크레딧 다시 읽기 | 같은 식을 함수 하나로(결과 무변경) |
| B1 · B2 catch 문장 | 직접발송 · 직접 타겟 발송 확인 창 | 흐름 · 횟수 · 닫기 무변경 · 문장만 |

## §5 계약 시험 (backend vitest · 프론트 순수 함수 직접 import · 선례 `agency-ad-subject-display.test.ts`)

`packages/backend/src/utils/__tests__/restart-gap-1126.test.ts`
1. `isRestartGap`: 502 · 503 · 504 + `text/html` = 참 · + 없음 = 참 · + `application/json; charset=utf-8` = 거짓 · 200 · 401 · 500 · 0 · undefined = 거짓 · `isRestartGapAxiosError` 같은 표.
2. `refillWhenServerBack`: gap 두 번 뒤 값 = fill 1회 · read 3번 · 기다림 1000 × 3 / 마감까지 gap = fill 0 · 마감 뒤 read 0 / **마감 직전 시작한 시도가 마감 뒤 성공 = fill 0**(시도 제한 = 남은 시간 · 그 시도의 signal 이 남은 시간에 실제로 끊김) / **취소 타이머가 늦게 돌아 5초를 넘긴 본문이 전체 마감 전에 끝남 = fill 0**(시각으로 다시 봄) / 값 없음(401 등) = fill 0 · read 1 / 시도가 5초 넘게 멈춤 = 그 시도만 실패 · 다음 시도 / `ok()` 가 기다리는 중 거짓 = read 더 0 / 값을 받은 뒤 `ok()` 거짓 = fill 0 / read 에 넘긴 토큰 = 처음 토큰 / 모듈 상태 0(두 고리가 서로를 막지 않음).
3. 「비어 있을 때만」: 채우기 함수에 값이 이미 있으면 그대로(부르는 쪽 식을 순수 함수로 빼서 시험 · 예 `fillIfEmpty(prev, next)`).
4. 소스 계약(R109 · 기계 추출): ① `window.fetch =` 대입 = `lib/credit-interceptor.ts` 한 곳뿐 ② `restart-gap` 을 부르는 파일 = `pages/Dashboard.tsx` · `utils/dashboard-live.ts` 둘뿐 ③ `refillWhenServerBack(` 세 자리의 채우기가 모두 `prev => prev ??` 꼴 · 다시 읽는 주소 = 셋뿐(`customers/stats` · `companies/dashboard-cards` · `companies/my-credit`) · 다시 읽기 안에 `setPlanInfo` · `setBalanceInfo` 0 · 중복 막기 = 화면의 `useRef` 집합 ④ 다시 읽기 안에서 `loadStats` · `loadDashboardCards` · `loadCredit` · `setShowPlanApproval` · `setPlanChange` · `location.reload` 0 ⑤ B1 · B2: 판정 줄이 같은 try 안 `res.json()` 바로 앞 · catch 가 `RestartGapError` 갈래 ⑥ `loadCompanySettings` · `DirectSendPanel.tsx` 에 `restart-gap` 0 ⑦ `fetchJson` 본문 읽기 · 제한 줄 무변경 + `gap` 은 본문 읽기 전 ⑧ 고객 문장 줄표 · 가운뎃점 · 모델명 0.
5. `loadStats` 원래 차례(소스 계약 · 기계 추출 · Codex 5R #2): 함수 본문의 요청 차례 = `customersApi.stats` → my-plan → balance → balance/agent → `loadDashboardCards` → plan-request/status(오늘과 같음) · 기다림 꼴도 오늘과 같다 = stats · my-plan · balance · `loadDashboardCards` 는 `await` · balance/agent 는 `await` 없이(`fetch(...).then` 꼴) · plan-request/status 는 `await loadDashboardCards()` 뒤(Codex 6R) · my-plan · balance 갈래에 `return` · `throw` · 다시 읽기 0(그 둘이 502 여도 뒤 요청이 이어지고 다시 읽기 0) · 다시 읽기 예약은 stats 가 던진 catch 안에서만(stats · dashboard-cards 둘) · `loadDashboardCards` · `loadCredit` 의 예약은 `r.gap` 갈래에서만.
- 변이(파일 복사): JSON 조건 제거 · `ok()` 무시 · 마감 무시(마감 뒤 성공 채움) · 채우기를 덮어쓰기로 · B1 판정 줄 빼기 → 각각 빨간불.
- 로컬 재현 고리(1단계 도구 · 스크래치패드 `restart-loop/fake-api.cjs` + 개발 화면): 처방 뒤 4초 공백 중 진입 → 공백 끝 뒤 몇 초 안에 전송건수 29 · 사용금액 2,802(처방 전 = 25초 뒤에도 0) · 충전 잔액 줄은 오늘처럼 숨김 · 가짜 API 기록 = 세 주소만 공백 뒤 한 번씩 더 · 요금제 · 잔액 · 승인 상태 · 최근 캠페인은 다시 읽지 않음.

## §6 직원 지시문 (구현 전 · §3 서식 · Harold 가 백엔드를 다시 켤 때)

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 테스트계정으로 로그인해 첫 화면을 띄워 둔다 | 요금제 · 발송 현황 · DB 현황 숫자가 보인다 |
| 2 | Harold 가 「지금」이라고 하면 곧바로 키보드 F5 를 누른다 | 숫자 자리가 잠깐 0 이거나 로딩으로 보인다 |
| 3 | 30초 기다린다(손대지 않는다) | 발송 현황 · DB 현황 · AI 크레딧 숫자가 1번과 같은 숫자로 돌아온다(0 으로 남지 않는다) |

## §7 배포 · 되돌리기

- 프론트 `npm run build:safe` 만(서버 HEAD = pull · 백엔드 실행 코드 변경 0 → **재시작 없음**).
- 되돌리기 = 이 커밋을 뺀 판으로 프론트 빌드(서버 무관).

## §8 범위 밖 (기록만 · 착수 = Harold)

- **요금제 · 충전 잔액 칸**: 공백 뒤 오늘처럼 비어 있다(요금제 칸 「로딩」 · 잔액 줄 숨김 · 기능 잠김) · 직접발송 판단(기능 잠금 · 선불 확정 뒤 잔액 다시 읽기 `:854` · `:1061` · 잔액 부족 창)에 쓰이므로 직접발송 전용 설계로 따로(Codex 4R #1 · #2 · 확정 성공 갈래의 잔액 다시 읽기가 실패하면 접수된 발송에 「발송 실패」가 뜨는 길 = 오늘부터 있는 결함 후보 · 기록만).
- **같은 뿌리(R109)의 남은 자리**: 직접발송 설정(080 번호 · 회신번호 `loadCompanySettings` · 회신번호 선택을 덮는 순서 위험 = Codex 2R #1) · 대행 화면 · 공개 승인 · 플래너 확인 링크(POST 로 읽음) · 알림톡 · 브랜드 · 그 밖의 한 번 읽기 화면(같은 출처 `/api` fetch 918 곳 · 244 파일). 직접발송 상태를 쓰는 함수는 직접발송 전용 설계(사용자 선택 · 기본값 차례)로 따로.
- 쓰기 실패 문장(「Unexpected token」)이 남은 확정 요청: AI 한줄로(`AiLinePage.tsx:873`) · 한 줄로 묻기(`AiAskPage.tsx:567`) · 알림톡 · 브랜드.
- 20초 넘게 서버가 안 돌아오면 지금처럼 0 으로 남는다.
- 서버 공백 자체를 없애는 무중단 재시작(pm2 cluster · 웹 / 일꾼 분리) · 재시작 순간 처리 중이던 요청이 끊기는 틈(서버 종료 처리 = 발송 경로).
- 외부 웹훅 · SDK · 싱크 에이전트가 1 ~ 3초 공백에 받은 502 를 다시 보내는지(F18 · 미검증).
- 배포 원장 도구 문구 「재시작 = 고객 화면 10~15초 끊김」(ts-node 시절 값).

## §9 미검증 · 위험

- 운영 nginx 의 502 본문이 `text/html` 인지(운영에 `error_page` 를 JSON 으로 둔 설정이 있으면 판정이 거짓 → 처방이 오늘과 같게 돈다 = 위험 아님 · 효과 0) · 확인 = 배포 전 Harold 서버 명령(`grep -rn "error_page" /etc/nginx/` · 읽기만).

## §10 Codex 설계 리뷰 (gpt-6.2-sol · high · 하위 0 · 라운드마다 로그 대조)

| R | 지적 | 판정 · 처리 |
|---|---|---|
| 1 | [high] 쓰기 502 를 JSON 으로 바꾸면 알림톡 · 직접발송 수신거부 대조가 `res.ok` 없이 0 건으로 세어 확인 창을 연다 | 구조 · 쓰기에 JSON 을 싣지 않는다(전역 감싸기 폐기) · 확정 두 곳만 같은 catch 로 보내고 문장만 |
| 1 | [high] axios 다시 보내기가 요청 인터셉터를 다시 돌려 세션 · 401 · 크레딧을 두 번 처리 | 구조 · axios 에 붙이지 않는다 |
| 1 | [medium] 직접발송 확정 합성 JSON 이 `!data.success` 로 빠져 확인 창이 열린 채 남음 | 구조 · JSON 을 만들지 않고 오늘 던지던 자리에서 같은 catch 로 |
| 1 | [medium] 첫 실행에 쓰는 GET(카페24 · 아임웹 연동 시작 · 제안 화면 감사) | 붙이지 않음 |
| 1 | [medium] 주기 읽기가 늦게 끝나 새 작업을 덮음 | 붙이지 않음 |
| 1 | [medium] 20초 마감이 진행 중 시도를 끝내지 못함 · 발송 뒤 잔액 재조회가 결과 표시를 막음 | 3판 = 원래 요청을 늦추지 않음(해당 없음) |
| 1 | [medium] 플래너 확인 링크는 POST 로 읽어 복구가 안 됨 | 범위 밖 §8 |
| 2 | [high] A4 늦은 설정 읽기가 고객이 고른 회신번호를 기본값으로 덮음 | 구조 · 1R #5 와 같은 부류(늦게 끝난 요청이 그 사이 바뀐 상태를 덮음) 두 번째 → 원래 요청을 늦추는 방식을 버리고 「복귀하면 같은 함수 다시 부르기」로 · 직접발송 상태를 쓰는 `loadCompanySettings` 는 범위 밖 §8 |
| 2 | [high] 로그인이 바뀐 뒤에도 옛 세션 작업이 이어짐 | 다시 부르기 전 `ok()` = 실패 받을 때 토큰 = 지금 토큰 · 화면 살아 있음 · 원래 요청은 오늘처럼 이미 끝남 |
| 2 | [medium] 20초 마감이 첫 정상 응답을 끊고 axios 재시도는 못 끊음 | 해당 없음(원래 요청에 마감을 걸지 않음 · axios 다시 보내기 없음) |
| 2 | [medium] A2 · A3 취소 계약이 JSON 본문 읽기까지 닿지 않음 | 해당 없음(`fetchJson` 본문 읽기 · 10초 제한 무변경 · `gap` 은 칸 추가) |
| 2 | [medium] A3 크레딧 세대가 재시도 전 차감으로 잔액을 낮춤 | 4판 = 다시 읽기를 시작한 세대 이후 사건만으로 낮춘다(같은 식 한 함수) · 비어 있을 때만 |
| 3 | [high] 함수 전체를 다시 부르면 요금제 승인 창 → 새로고침으로 작성 중 직접 타겟 발송 초안을 잃음 | 구조 · 같은 부류(다시 돈 일이 그 사이 상태를 건드림) 세 번째 → 함수를 다시 부르지 않고 카드 값 다섯만 그 주소로 다시 읽어 **비어 있을 때만** 채운다 · 승인 · 변경 알림 · 새로고침은 다시 돌지 않음 |
| 3 | [medium] 다시 읽은 잔액이 발송 뒤 갱신된 잔액을 덮음 | 비어 있을 때만 채움 = 덮지 않음 |
| 3 | [medium] 대기열(`serialRunner`)에 들어간 다시 부르기가 화면 닫힘 · 로그인 바뀜 뒤 실행 | 대기열을 쓰지 않음 · 다시 읽기는 실패한 토큰만 싣고 시도 전 · 채우기 전에 `ok()` |
| 3 | [medium] 확인 요청이 503 · 504 를 돌아옴으로 보고 · 인증 확인이 세션을 바꿈 | 확인 요청 없음 · 판정 = 502 · 503 · 504 + JSON 아님 · 다시 읽는 GET = 첫 화면과 같은 요청 |
| 4 | [high] 다시 채운 잔액이 직접발송 확정 성공 갈래의 잔액 다시 읽기를 새로 열어, 그 읽기가 실패하면 접수된 발송에 실패 문장 | 구조 · 직접발송 판단에 쓰이는 값(요금제 · 충전 잔액)은 채우지 않는다 · 표시만 쓰는 셋만 |
| 4 | [medium] 차감 전 잔액이 접수 뒤 처음 표시됨 | 잔액을 채우지 않음(해당 없음) |
| 4 | [medium] 마감 뒤 도착한 성공도 채움 | 절대 마감 · 시도 제한 = 남은 시간 · 마감 뒤 성공 = 채우지 않음 · 시험 |
| 4 | [medium] 모듈 열쇠가 이전 화면의 고리로 새 화면을 막음 | CT 모듈 상태 0 · 중복 막기 = 그 화면의 `useRef` 집합 |
| 5 | (판정) 세 값이 직접발송 · 직접 타겟 · 알림톡 · 대행의 판단 · 자동 창 · 새로고침을 바꾸는 길 없음 · 화면 집합 · B1 · B2 결함 없음 | 닫힘 |
| 5 | [medium] 시도 제한이 지난 응답도 전체 마감 전이면 반영될 수 있음(타이머 지연) | 시도 마감 시각을 시작 때 고정 · 본문 끝난 시각으로 다시 봄 · 시험 둘 |
| 5 | [medium] `loadStats` 원래 차례 회귀를 시험이 못 잡음 | 소스 계약 5번(요청 차례 · my-plan · balance 갈래 무변경 · 예약 자리) |
| 6 | 5R #1 닫힘 · [medium] 차례만으로는 balance/agent 에 `await` 를 더하는 회귀를 못 잡음 | 소스 계약 5번에 기다림 꼴(어느 요청을 `await` 하고 어느 것을 안 하는가)을 더함 |

## §11 구현 기록 (1126)

- 새 파일 `packages/frontend/src/lib/restart-gap.ts`(판정 · `jsonRefillRead` · `refillWhenServerBack` · `RestartGapError` · 문장) · `utils/dashboard-live.ts` `fetchJson` 에 `gap` 칸 · `pages/Dashboard.tsx` = import 한 줄 · `capCredit`(크레딧 낮추기 식을 함수로 · 조회와 다시 채우기가 함께 씀) · 다시 채우기 묶음(`refillShown` · `refillStats` · `refillCards` · `refillCredit` · 화면 집합 · 살아 있음 표시) · `loadStats` 보낼 때 토큰 + catch 두 줄 · `loadDashboardCards` · `loadCredit` 실패 갈래 한 줄씩 · B1 · B2 판정 한 줄 + catch 문장 갈래.
- 시험 = `packages/backend/src/utils/__tests__/restart-gap-1126.test.ts` 19(판정 · 고리 8 · 읽기 · 소스 계약 ① ~ ⑧) · 옛 계약 `dashboard-live-1010.test.ts` 크레딧 낮추기 식 = 같은 식을 함수로 뺀 꼴로 다시 적음(식 · 조회 적용 둘 다 잠금).
- 변이 8(JSON 조건 · 기다린 뒤 ok · 마감 · 시도 마감 시각 다시 보기 · 채우기 전 ok · 덮어쓰기 · B1 판정 줄 · 요금제 채우기 추가) 전부 빨간불 뒤 원복.
- 로컬 재현(가짜 API 4초 502 · 개발 화면 · 운영 무관): 처방 전 = 25초 뒤에도 전송건수 0 · 사용금액 0 → 처방 뒤 = +2초 0 · **+8초 전송건수 29 · 사용금액 2,802**. 가짜 API 기록 = customers/stats · my-credit 는 공백 원래 요청 뒤 다시 읽기(502 → 200 한 고리) · dashboard-cards 는 원래 불리지 않았다가 다시 읽기로 200 · my-plan · balance · 승인 상태 = 불리지 않음(다시 읽기 0 · 설계대로 빈 채) · settings · callback-numbers(직접발송 설정) = 원래 요청만(다시 읽기 0). 화면 스크립트 오류 0(502 자원 오류만).
- tsc 프론트 · 백엔드 0.

## §12 Codex 구현 리뷰 (gpt-6.2-sol · high · 하위 0 · 라운드마다 로그 대조)

| R | 지적 | 판정 · 처리 |
|---|---|---|
| 1 | (확인) 정상 응답의 요청 순서 · 기다림 · 크레딧 낮추기 · B1 · B2 오류 뒤 해제 · 닫기 차례 = HEAD 와 같음 | 닫힘 |
| 1 | [medium] B1 은 알림톡 확정도 지나는 함수라 범위 밖(§8)인 알림톡에도 새 문장이 뜸 · B2 도 채널 조건 없음 | 수용 · 판정을 문자만(`!isAlimtalk` · `!isTargetAlimtalk`) · 알림톡은 오늘 그대로 · 시험(정확한 두 줄 · 채널 변수 뒤) |
| 1 | [medium] 다시 읽은 200 의 깨진 JSON 이 시도 실패로 바뀌어 마감까지 다시 읽음 | 수용 · 깨진 JSON = 값 없음(끝) · 본문 읽기가 시도 제한으로 끊긴 것만 다음 시도 · 시험 |
| 1 | (변이) 위 두 고침을 각각 빼면 빨간불 | 확인 |
| 2 | (1R 두 고침 · 직접 호출부) | **approve** · 지적 0 · 「발송 채널을 정하는 같은 변수로 가드 · 알림톡은 HEAD 와 같은 길 · 깨진 JSON = 끝 · 본문 끊김 = 그 시도만」 확인 |
| 3 | (2R 뒤 단위 전체에서 c136 · c138 3건 빨간불 = 가짜 fetch 응답에 headers 가 없어 `fetchJson` 의 `r.headers.get` 이 던짐 → `r.headers?.get?.(…)` 한 줄) | **approve** · 지적 0 · 「헤더 없는 응답도 HEAD 와 같은 ok · status · body · 브라우저 Headers.get 판정 그대로」 확인 |
