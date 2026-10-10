# 대시보드 모션(B안 · 의미 있는 움직임만) 설계 · 2026-10-10

> 소유 = 이 문서. 관제 포인터 = STATUS C25 · SOT-INDEX §1.
> 경위: Harold님 「모션대시보드로 만들면 좋을까?」 → B안 추천 · 목업 → 「B안으로 구현」(1차) → 「추가로 모션을 입힐 자리를 브레인스토밍 소집해서 체크 · 안건이 나오면 설계·구현까지 · 코덱스 닫힐 때까지」(2차).

## 0. 한 줄 요약

대시보드는 **서버가 확인한 상태가 바뀔 때만** 움직인다. 숫자 채우기·카드 들어오기는 페이지를 열 때 1회, 계속 도는 것은 「지금 켜져 있다」는 점 둘뿐이다. 장식용 상시 움직임은 넣지 않는다.

## 1. 원칙 (Harold 승인 B안 · 모든 항목의 판정 기준)

| # | 원칙 | 확인 방법 |
|---|------|-----------|
| P1 | 상태 변화 · 피드백 · 주의가 필요할 때만 움직인다 | 항목마다 「트리거」 칸이 서버 응답이나 사용자 행동이어야 한다 |
| P2 | 서버가 확인한 상태에만 움직인다(목업 지표 · 가짜 숫자 금지) | 트리거 칸의 출처 = 서버 경로 · 칸 이름 |
| P3 | 브라우저 「움직임 줄이기」 설정을 지킨다 | 모든 animate 클래스에 `motion-reduce:animate-none` 또는 `motion-safe:` |
| P4 | 계속 도는 움직임 = 「켜져 있다」 점 두 곳(띠 머리 · AI Operator 알약) | `animate-ping` 무한 사용처 grep |
| P5 | 숫자 채우기 · 들어오기 = 페이지를 새로 열 때 1회(다른 화면 갔다 오면 다시 안 함 · 새로고침이면 다시 함) | 모듈 변수 한 곳 |
| P6 | CSS 우선 · 신규 라이브러리 0 | `tailwind.config.js` 의 기존 토큰 + `ping-twice` 한 줄 |
| P7 | 사용자 문구 = 줄표 · 이모지 · 모델명 0 | grep |

## 2. 1차 (B안 목업 그대로 · 오늘 구현)

| 자리 | 움직임 | 근거 데이터 |
|------|--------|-------------|
| 「지금 돌고 있는 자동화」 띠(신규) | 켜짐 점 · 발송 진행 막대 · 다음 회차 카운트다운 · 1분마다 다시 읽기 | `GET /api/ai/operator/continuous` · `/api/ai/operator/journeys?status=active` · `/api/campaigns?status=sending` + `/:id/send-progress` · 대시보드 예약 목록 |
| 크레딧 · 발송 실적 · 채널별 · 총 사용금액 · DB 숫자 카드 | 0에서 1회 채우기(0.9초) | 기존 응답 그대로 |
| 상단 카드 · 오른쪽 버튼 · DB 카드 | 차례로 1회 들어오기 · 분포 막대 차오름 | 없음(화면 첫 표시) |
| DB 현황 머리 | 늘 깜빡이던 「REAL-TIME」 → 「HH:MM 기준」 | §3 E 에서 서버 시각으로 정정 |
| AI Operator 버튼 | 「자동화 N개 작동 중」(켜진 것이 있을 때만) | 띠와 같은 값 |

부품: `components/dashboard/LiveAutomationStrip.tsx` · `components/dashboard/CountUp.tsx` · `utils/dashboard-live.ts`(판정 순수 함수) · `utils/formatDate.ts formatKstClock`.

## 3. 2차 (5역할 회의 수렴 · 이 문서의 본론)

회의 = 기획 · 프론트엔드 · 백엔드 · 디자이너 · 회의론자(읽기 전용) · 1차 의견 → 교차 토론 1라운드 → 회의론자 최종 검증. 기록 = §6.

| ID | 자리 | 움직임 | 트리거(출처) | 움직임 줄이기 |
|----|------|--------|--------------|---------------|
| A | 발송 성공 창 | 정의가 없어 무효였던 `animate-fadeIn`·`animate-zoomIn` → `animate-backdrop-in`·`animate-dialog-in`. 🎉 → 에메랄드 원 + 체크가 1회 튀어나옴 | 캠페인 생성 API 성공 뒤 | 즉시 정지 화면 |
| B | 띠 발송 칸 끝 | 막대 100% → 체크 1회 → 「발송 접수를 마쳤어요 · 결과는 발송결과에서」 4초 뒤 빠짐. 0건 적재면 로즈 「발송 처리에 실패했어요」 + [발송결과](1분). 취소면 끝 상태 없이 칸만 빠짐 | `send-progress` 단계 `sent` = 적재 끝일 뿐 → **응답에 추가한 `status`** 로 가름(cancelled · failed · 그 밖). 적재 중 단계(preparing · queued · processing)일 때만 「발송 중」 칸. 통신 실패는 끝으로 보지 않는다 · 404 는 칸만 뺌 | 글자 · 아이콘만 바뀜 |
| C | 띠 즉시 다시 읽기 | 방금 접수한 발송 칸이 바로 1회 들어옴 | **즉시 직접발송 · 타겟발송 접수 응답** → `refreshKey`(접수 응답 전에 `sending` 행이 이미 있다 = 재시도 없음). `/:id/send` 경로(한줄로 AI · 이어하기)는 응답 전에 상태를 끝내므로 신호를 올리지 않는다 | 즉시 표시 |
| D | 띠 정직성 | 일부 호출 실패 = 회색 정지 점 + 「일부 상태를 확인하지 못했어요」 · 기준 시각 숨김 · 실패한 축은 직전 값 유지 · AI Operator 숫자 0. 크레딧 부족으로 멈춘 자동 마케팅 = 호박색 정지 칩 「충전하면 다음 회차부터 다시 돌아요」(자동 재개 = `continuous-operator.ts` 1193-1196) + 충전 1클릭 | 응답 성공 여부(여정 403 = 권한 없음 = 칸만 숨김) · `status='paused_no_credit'` | 같음(원래 정지) |
| E | 1차 보정 | 카운트다운 1시간 이상 = 「N시간 M분」 다음 분 경계에 갱신 · 띠 첫 읽기 전 정적 자리표시 · 빈 띠도 같은 높이(86px · 아래 카드가 뛰지 않게) · 숨었던 창이 다시 보이면 바로 읽기 · 읽기 순번 가드 · 들어오기 1회를 모듈 변수 한 곳으로 · 칩 안 점은 정지 · DB 「HH:MM 기준」 = 서버 캐시 계산 시각 | swrCache 엔벨로프 `at` → `dashboard-cards` 응답 `asOf`(브라우저 시각은 최대 600초 묵은 값을 「지금」이라 말했다) | 해당 없음 |
| F | 토스트 | 오른쪽에서 1회 미끄러져 들어옴(나가기 없음) | 토스트 호출 = 서버 응답 직후 | 들어오기 없음 |
| G | 크레딧 숫자 | AI 작업 뒤 옛 값에서 새 잔여로 0.6초 1회 이어 셈 | `credit:used` 이벤트 `balance`(= my-credit `total` 같은 정의 · `ai-credit.ts` 58 · 250). 작아질 때만 받는다(응답 순서 역전 방지) · 커지면(월초 리셋 · 다른 탭 충전) my-credit 다시 읽기 · 이력 창 열 때도 다시 읽기 · 잔여 헤더 없으면 null | 즉시 교체 |
| H | 첫 업로드 공개 | DB 카드가 1회 들어오며 숫자 채움(블러 덮개는 바로 빠지고 진짜 카드가 들어온다 · 덮개 퇴장 연출은 두지 않음). 업로드 창 상태 아이콘 1회 · 진행 막대 등속(2초 폴링 사이를 1.9초 등속) · 서버가 unknown 이면 막대를 0으로 되돌리지 않음 | 업로드 창을 닫을 때(완료면) `dashboard-cards` 만 다시 읽음(`loadStats` 통째 금지 = 요금제 승인 창 재발). 공개 표식은 다시 읽기 앞에서 켬 | 즉시 표시 |
| I | 정리 묶음 | 로그인 안내 창 · 카드 상세 창 들어오기를 공용 토큰으로(카드 상세의 전역 이름 덮어쓰던 인라인 keyframes 삭제) · 상세 분포 막대 1회 차오름 · 진단 초대 점과 선불 기간 뱃지(잠김 또는 자동 연장 꺼짐 + 3일 이하)는 ping 2회 뒤 정지(페이지 열 때만) · DB 카드 호버 들림 · 아이콘 회전에 움직임 줄이기 가드(디자인은 유지) · 성공 창 세그먼트 칸 들어오기에도 가드 | 각 창 열림 · 서버 진단 상태 · `prepaid_term` | 정지 |

## 4. 하지 않은 것 (범위 밖 · 기록만)

| 항목 | 이유 |
|------|------|
| 성공 창 「대상 N명」 숫자 출처 · 「즉시 발송 완료」 문구 · 나머지 이모지 | 모션이 아니라 표시 값 · 문구 변경. 별건 |
| 직접발송 완료 토스트 「성공 N건」 | `sent` = 적재 완료라 「성공」은 통신사 결과가 아니다. 문구 별건 |
| 대시보드 `setToast` 변환이 표시 시간을 버림(5초 의도 → 3초) | 동작 변경 별건 |
| 재업로드 뒤 DB 숫자 갱신 | `dashboard-cards` 캐시가 업로드에 무효화되지 않는다(최대 10분). 캐시 무효화 별건 |
| 업로드 창 「창을 닫으셔도」 문구 ↔ 진행 중 닫기 버튼 없음 | 문구 · 동작 별건 |
| 에이전트 잔액 ping · 늦게 붙는 안내 카드 밀림 · 로딩 뼈대 · 머리 메뉴 발송결과 점 · 여정 +N · 자동 마케팅 회차 배지 · 로그인 안내 창 바탕 닫힘 | 회의에서 접음(§6) |

## 5. 영향표

| 바뀐 것 | 읽는 곳 · 쓰는 곳 | 영향 |
|---------|--------------------|------|
| `swrCache` → 내부를 `swrCacheWithAt` 로 옮기고 value 만 돌려줌 | 남은 호출처 4곳(admin.ts 3063 · 5816 · customers.ts 833 · 1297) · companies.ts 는 swrCacheWithAt 로 옮김 · `swrPrimeCache` 무관 | 반환값 · 저장(엔벨로프 · 세대 가드) 동작 동일. miss 의 계산 시각 = 엔벨로프 시각 |
| `classifySwrEntry` 결과에 `at`(선택 칸) | swr-cache.ts · swr-cache-core.test.ts(state · value 만 확인) | 칸 추가만 |
| `dashboard-cards` 응답 `asOf` | Dashboard 만 | 칸 추가 · 옛 화면은 무시 |
| `send-progress` 응답 `status`(campaigns.status · 같은 파일 목록 SELECT 194행이 이미 읽는 컬럼) | Dashboard 직접발송 폴링(phase · sentCount · failCount 만 읽음) · 띠 | 칸 추가 · 기존 칸 무변 · 범위 확인(`canAccessOwnedRow`) 그대로 |
| `credit:used` detail.balance: 헤더 없을 때 0 → null | ToastProvider(`Number(d.balance)` = 0 → 문구 동일) · Dashboard | 서버가 헤더 셋을 함께 싣는 동안은 차이 0(app.ts 408-410) |
| ToastBox 들어오기 | 앱 전체 토스트 | 들어오기 0.2초만 · 나가기 · 타이머 무변 |
| `tailwind.config.js` animation `ping-twice` | Dashboard 2곳 · DiagnosisHeroCard | 추가만 |
| Dashboard `loadDashboardCards` 함수로 뺌 | loadStats · 첫 업로드 공개 | 같은 요청 · 같은 상태 설정 |
| Dashboard AI Operator 버튼 onClick → `openLive('hub')` | 계약 테스트 plan-feature-modal-contract(`navigate('/ai-operator')` 글자) | 동작 동일 · 글자 유지 |

DDL 0 · 신규 서버 경로 0 · 신규 라이브러리 0 · 발송 · 돈 경로 쓰기 0(진행률 응답에 읽기 칸 하나).

## 6. 회의 기록

- 소집 = Harold님 「브레인스토밍 소집」(1010). 소환 = 기획 · 프론트엔드 · 백엔드 · 디자이너 · 회의론자(Explore · 읽기 전용).
- 1차 의견 → 교차 토론 1라운드 → 주재자 수렴(A~I) → 회의론자 최종 검증(조건부 5개) → 전부 반영.
- 다섯 역할이 함께 고른 자리 = 성공 창(A) · 발송 끝 칸(B) · 즉시 다시 읽기(C) · 띠 정직성(D) · 1차 보정(E).
- 갈린 지점과 선택:
  - 들어오기 1회 저장 위치: sessionStorage(디자이너 · 프론트) vs 모듈 변수(기획). **모듈 변수** — sessionStorage 는 새로고침에도 막아 B안 승인 문구 「접속 · 새로고침 때 1회」와 어긋난다.
  - 재업로드 뒤 바뀐 숫자 이어 세기(기획 · 백엔드 · 프론트 · 디자이너) vs 움직임 0(회의론자). **움직임 0** — 카드 캐시가 업로드로 무효화되지 않아 값이 안 바뀐다. 캐시 무효화는 별건(B-1010-10).
  - DB 카드 아이콘 호버 회전 제거(기획 · 프론트) vs 유지. **유지 + 움직임 줄이기 가드** — Harold 승인 디자인(D224+)을 지우지 않는다.
  - 에이전트 잔액 ping(디자이너 · 프론트) vs 없음(회의론자). **없음** — 들어올 때마다 퍼지고, 빨간 글자로 충분하다.
- 접은 안: 머리 메뉴 발송결과 점 · 로딩 뼈대 · 여정 +N · 자동 마케팅 회차 배지 · 토스트 남은 시간 막대 · 크레딧 「-N」 떠오름 · DB 쪽 넘김 방향 슬라이드 · 안내 카드 퇴장 · 지난달 대비 뱃지 지연 · 발송 현황 다시 읽기(단계 sent 는 적재 끝이라 값이 안 바뀜).
- 회의론자 조건부 5개(전부 반영): ① status 로 끝 가름 + 단계 없는 행 제외 ② 읽기 순번 + finished + load 에서 끝 판정 제거 ③ 일부 실패 = 버튼 숫자 0 · 기준 시각 숨김 ④ `/:id/send` 경로 신호 · 3초 재시도 제거 ⑤ 빈 띠 높이 · visibilitychange 짝. 같이: ping-twice 페이지 열 때만 · 크레딧 다시 읽기 둘 · 공개 표식 앞으로 · unknown 가드. 주재자 추가: 진행률 404 = 칸만 뺌.

## 7. 구현 기록

| 파일 | 내용 |
|------|------|
| `frontend/src/utils/dashboard-live.ts`(신규) | summarizeLive(running · journeys · auto · scheduled · sending · stalled) · countdownText · countdownTickMs · ENTER_ONCE · 들어오기 1회 표식 · prefersReducedMotion |
| `frontend/src/components/dashboard/LiveAutomationStrip.tsx`(신규) | 띠 전체(B · C · D · E) |
| `frontend/src/components/dashboard/CountUp.tsx`(신규) | 처음 1회 채우기 · animateChanges |
| `frontend/src/pages/Dashboard.tsx` | 띠 배치 · openLive · intro · ENTER · CountUp · 기준 시각 asOf · DB 카드 들어오기 · 분포 막대 · 호버 가드 · AI Operator 알약 · 선불 뱃지 ping-twice · 크레딧 리스너 · 첫 업로드 공개 · unknown 가드 · refreshKey |
| `frontend/src/components/CampaignSuccessModal.tsx` | A |
| `frontend/src/components/ToastProvider.tsx` | F |
| `frontend/src/components/UploadProgressModal.tsx` | H(아이콘 1회 · 등속 막대 · 스피너 motion-safe) |
| `frontend/src/components/dashboard/CardDetailModal.tsx` · `AiOperatorLoginPromo.tsx` · `marketing-diagnosis/DiagnosisHeroCard.tsx` | I |
| `frontend/src/lib/credit-interceptor.ts` | 잔여 헤더 없으면 null |
| `frontend/src/utils/formatDate.ts` | formatKstClock |
| `frontend/tailwind.config.js` | ping-twice |
| `backend/src/utils/swr-cache.ts` · `swr-cache-core.ts` | swrCacheWithAt · at |
| `backend/src/routes/companies.ts` | dashboard-cards asOf |
| `backend/src/routes/campaigns.ts` | send-progress status |
| `backend/src/utils/__tests__/dashboard-live-1010.test.ts`(신규) | 판정 · 카운트다운 · 화면 계약 · 회의론자 조건 잠금 19건 |

검증(1010 최종): backend tsc 0 · frontend tsc 0 · backend vitest 599파일 8,494건 통과 · 대시보드 잠금 테스트 28건(serialRunner 실제 실행 2건 · 변이 시험 1건 = 금지 클래스를 넣으면 실패 · 되돌리면 원본과 바이트 동일) · build:safe 성공.

### 7-1. Codex 적대 리뷰(gpt-6-astra)

| 라운드 | 판정 | 지적 | 처리 |
|--------|------|------|------|
| 1R(변경분 전체) | needs-attention · medium 4 | ① 늦은 크레딧 조회가 차감 뒤 잔여를 되돌림 ② await 뒤 finished 재확인 없음 → 끝난 발송 되살아남 ③ 1분 읽기가 끝 단계를 받아 3초 폴링을 지움 → 끝 안내 누락 ④ 3초 진행률 실패가 정상 표시로 남음 | ②③ 같은 뿌리 = 같은 칸을 두 경로가 바꿈 → **칸의 주인 하나(tracked)** · ④ pollFail · ① creditGen |
| 2R(고친 줄) | medium 2 | 끝난 뒤 늦은 실패가 pollFail 되살림 · 첫 조회 중 연속 이벤트로 크레딧 카드 영구 숨김 | **같은 부류 두 번째 → 구조 수정**: 응답 반영 자리 전수(띠 3 · 대시보드 2)를 한 규칙으로 = 정리된 요청 응답 버림 · 겹치지 않게 · 버리면 영영 못 얻는 자리는 합쳐 반영(이벤트 cap) · 재귀 재조회 삭제 |
| 3R | medium 2 | 시간 제한 없는 요청이 폴링을 막음 · 「마지막 시작 요청만」이 앞 성공까지 버림 | 규칙 다듬기: 모든 요청 10초 제한 · 마지막 반영 성공 순번 |
| 4R | medium 1 | 요청 시작 순번 ≠ 서버 읽기 순서(다른 탭 차감) | **뿌리 제거**: 같은 값 읽기는 하나씩(serialRunner · 합침) → 순번 비교 · seq 가드 전부 삭제(덧댄 장치 제거). 규칙 소유 = utils/dashboard-live.ts fetchJson · serialRunner |
| 5R | **approve** · 지적 0 | | |
| 6R(실측으로 고친 줄 · 7-2) | **approve** · 지적 0 | | 종결 |

### 7-2. 폭별 실측(빌드 CSS · puppeteer · 390 · 820 · 1100 · 1280 · 1440 · 1920 × 칸 5 · 4 · 3 · 빈 띠 · 일부 실패 · 첫 읽기 전)

- 1차 실측에서 찾은 것 3 + 빌드 경고 1 → 고침:
  - 1100 폭 5칸(199px) 에서 예약 시각 줄이 잘림 → 5칸은 xl 에서만 5등분(sm 2 · lg 3)
  - 여정 「외 N개」가 이름과 함께 잘림 → 이름만 말줄임
  - 390 폭 첫 읽기 전 ↔ 뒤 머리 높이 29px 뜀 → 모바일은 기준 시각 · 버튼을 늘 둘째 줄
  - 빌드 경고 `duration-[1900ms]` ambiguous(애니메이션 플러그인이 duration 재등록 → CSS 없음) → 인라인 transitionDuration · 같은 실수 막는 잠금(임의 값 duration · delay · ease 금지)
- 재실측: 가로 넘침 0 · 글자 꺾임 0 · 첫 읽기 전 = 빈 띠 높이(390 214px · 그 밖 185px) · 잘리는 것은 사용자가 지은 긴 이름뿐.
- 빌드 CSS 안 새 클래스 생성 확인: ping-twice(단축 속성 `ping 1s … 2`) · motion-reduce:animate-none · motion-safe:animate-ping · fill-mode-backwards · slide-in-from-* · zoom-in-50/95 · dialog-in · backdrop-in · hover 가드 2종 · min-h-[86px] · xl:grid-cols-5.
