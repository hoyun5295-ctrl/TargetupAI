# 인앱메시지 완성 설계도 — SDK 배선 + 자동 기동 (2026-06-11 분석 → 다음 세션 구현)

> **작성**: 2026-06-11 (Harold 지시 — "SDK 연동이 되면 실제로 모달을 띄울 수 있는지 제대로 분석 + 완벽하게 만들 설계도")
> **결론 한 줄**: 엔진(백엔드)·계기판(관리자 화면)·차체(SDK 인앱 모듈)는 전부 완성돼 있는데, **바퀴가 차체에 붙어 있지 않다.** 현재 배포 구조로는 고객사 사이트에 모달이 절대 표시되지 않는다. 고칠 곳은 SDK 진입점 배선 한 곳 중심 — 작업량은 작고 효과는 기능 전체 활성화.
> **선행 의무**: 다음 세션 시작 시 본 설계 Harold 승인 → 구현 (dev_process_six_rules ⑥).

---

## A. 현재 상태 실측 (2026-06-11 코드 기준)

### A-1. 완성돼 있는 것 (수정 불요)

| 층 | 상태 | 근거 |
|---|---|---|
| Backend 선별 엔진 | 완성 | `utils/inapp-message.ts` getActiveMessagesForCustomerV2 — 트리거 매칭 → identity 매핑 → 시간대/요일(CT-82) → 세그먼트(CT-78) → A/B variant(CT-80) → once_per_day(24h impressions) → max_displays 한도 |
| Backend API | 완성 | `routes/cdp.ts:534` GET /inapp/active + `:570` POST /inapp/track — 둘 다 `requireCdpKeyOrBrowserOrigin`(2026-06-10 브라우저 인증 전환 적용: 공개키+등록 도메인, secret 불요) + DB 마이그레이션 503 가드 |
| 트래킹 | 완성 | impression/click/dismiss + button_id + dwell_seconds 컬럼 수신, identity_link/customer 매핑 기록 |
| SDK 인앱 모듈 자체 | 완성 | `sdk-js/src/inapp.ts` (959줄) — 8 템플릿 렌더러(top/bottom_banner·center_modal·full_screen·slide_in·inline_card·toast·floating_button), 자동 트리거(scroll/time_on_page/exit_intent), 5분 캐시, 지수 backoff 재시도, 빈도 제어(session/day/max_displays), Liquid+%변수% 클라 치환, 다중 CTA 3개, 애니메이션 4종, 자동 dismiss. 2026-06-10 수정으로 secret 미사용(공개키 헤더만) |
| 관리자 화면 | 완성 | InAppMessagesPage — AI 자율 진단/자연어 생성/빠른 시작 7 시나리오/A·B/시간대/세그먼트 (스크린샷 실측) |
| DB | 정의 존재 | SCHEMA.md 1748·1771 cdp_inapp_messages/cdp_inapp_impressions + D215+ 확장 컬럼(template/buttons/segment_conditions/...) — **운영 DB 실재는 다음 세션 시작 시 information_schema 순수 덤프로 확정 의무** (T0) |

### A-2. 치명 공백 — 실행 경로가 0 (이번 분석의 핵심 발견)

인앱 모듈을 **실행하는 코드가 어디에도 없다.** 단절 지점 5곳:

1. **IIFE 번들에 인앱 미탑재** — 설치 스니펫(`hanjul.min.js` + data-hjl-key)의 진입점 `sdk-js/src/auto-capture/index.ts`에 inapp import 자체가 없음 (grep 0건). `window.hjl`에 inapp이 존재하지 않는다.
2. **유일한 진입 클래스는 브라우저 사용 불가** — `HanjulloSDK`(index.ts:42)는 constructor에서 `sk_` secret 필수(throw). secret은 브라우저 금지(가이드 명시)라, 브라우저 전용인 인앱 모듈에 브라우저에서 도달할 방법이 모순적으로 없음.
3. **identify와 미연결** — auto-capture identify(data-hjl-user-id/phone)가 확보한 externalId/anonymousId가 inapp.init에 전달되는 경로 없음 → 연결해도 수동 호출이면 익명 처리·세그먼트 메시지 전멸(`segment 조건 + customer 미식별 = 매칭 불가`가 서버 로직).
4. **이벤트 브리지 부재** — 가이드대로 `window.hjl.track('cart_add')`를 넣어도 inapp.trigger('cart_add')는 호출되지 않음 → cart_add/checkout_start 트리거 메시지 무반응.
5. **가이드 문서에 인앱 사용법 0** — 고도몰 가이드·SDK 가이드 어디에도 인앱 호출 안내 없음.

### A-3. 부수 공백 (배선 후 완성도)

- **Liquid customer 변수의 자동 기동 모순** — 클라 치환이 `input.customer`(호출자가 주는 객체)에 의존. 자동 기동 시 자사몰은 customer 객체를 모름 → `{{ customer.name }}`·`%고객명%`이 기본값으로만 치환. 서버가 /inapp/active 응답에 customer 데이터(또는 치환 완료 본문)를 포함해야 진짜 개인화.
- dwell_seconds — 서버는 받지만 SDK track()이 안 보냄 (표시→닫기 시간 측정 부재).
- inline_card containerSelector — 자동 기동 시 지정 경로 없음 (스크립트 속성 필요).
- seenMessageIds 쿼리 파라미터 — SDK가 보내는데 서버 V2가 소비하는지 확인 필요 (중복 줄이는 보조 — 기능 차단은 아님).
- 모바일 뷰포트 미세 조정(full_screen 등) — 실기기 확인 항목.

---

## B. 구현 설계 (정답 1개 — "설치 스니펫 한 줄이면 인앱도 자동")

마케팅 담당자 UX 원칙(추가 입력 0)에 맞춰, **별도 코드 없이 기존 한 줄 스니펫만으로 인앱이 동작**하게 배선한다.

### T0. (세션 시작) DB 실재 확정 — Harold 실행
```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE table_name IN ('cdp_inapp_messages', 'cdp_inapp_impressions')
ORDER BY table_name, ordinal_position;
```
D215+ 확장 컬럼(template/image_url/buttons/segment_conditions/trigger_conditions/personalization_vars/parent_message_id/variant_weight/auto_dismiss_seconds/max_displays_per_user/send_start_hour/send_end_hour/allowed_weekdays/locale_variants/animation, impressions의 button_id/dwell_seconds) 누락분은 ALTER 목록 작성 → Harold 실행 후 진행.

### T1. auto-capture 진입점에 인앱 통합 (`sdk-js/src/auto-capture/index.ts`)
- `HanjulloInAppModule` 인스턴스 생성: `new HanjulloInAppModule(apiKey, '', endpoint)` — secret 인자는 2026-06-10부터 미사용(자리만 유지), endpoint는 기존 transport와 동일 유도.
- 초기화 순서: identify 모듈이 externalId/anonymousId 확정한 직후 `inapp.init({ externalId, anonymousId })` 호출. identify가 늦게 일어나는 SPA 갱신 케이스는 identify 갱신 훅에서 재호출(과다 호출은 5분 캐시가 흡수).
- `window.hjl.inapp` 노출 — 고급 사용(수동 trigger/inline 컨테이너)용 공개 API.
- 게이팅: 서버 /inapp/active가 비활성 회사면 빈 배열이므로 SDK 측 플래그 불요 — 호출 1회/트리거는 캐시로 억제.

### T2. 이벤트 브리지 (`auto-capture/events.ts`)
- `hjl.track('cart_add' | 'cart_view' | 'checkout_start')` 전송 성공 직후 `inapp.trigger(동일 이벤트)` 자동 호출.
- cart_value 트리거: track properties의 price·quantity가 있을 때 누적 장바구니 금액 추정치를 inapp trigger input으로 전달(없으면 cart_value 트리거는 매칭 안 됨 — 정직한 한계로 가이드에 명시).

### T3. 개인화 변수 서버화 (`routes/cdp.ts` + `utils/inapp-message.ts`)
- /inapp/active 응답에 `customer` 객체 추가: identity 매핑된 경우 customers에서 **메시지들이 실제 쓰는 변수만**(personalization_vars 합집합: name/grade/points/region 등) SELECT해 동봉 — 개인정보 최소화.
- SDK renderMessage는 `input.customer`가 비어 있으면 응답의 customer를 사용 (기존 수동 전달은 우선권 유지 — 하위 호환).
- 컬럼은 customers 실측 컬럼만 사용 (T0과 동일 원칙 — 코드 작성 전 SCHEMA.md 대조).

### T4. 소소한 완성 (SDK)
- dwell_seconds: 렌더 시각 기록 → dismiss/click 시 경과 초 전송.
- inline_card: `data-hjl-inapp-container="#selector"` 스크립트 속성 지원.
- (확인 후) seenMessageIds 서버 소비 — V2에서 미사용이면 후보 조회 WHERE에 `id != ALL($seen)` 추가.

### T5. 빌드 + 배포 (0610 절차 미러)
- sdk-js IIFE 재빌드 → 버전 디렉토리 결정: 이새에프앤씨가 아직 미설치면 v0.3.6 신규 디렉토리 + 가이드 URL 갱신, 이미 v0.3.5 설치면 v0.3.5 덮어쓰기(해시 동기화) — **세션 시작 시 Harold께 설치 진행 상태 확인 후 결정**.
- company-frontend/public/sdk 사본 동기화 + sdk vitest + backend/frontend tsc.

### T6. 가이드 갱신 (구현 완료 후)
- 고도몰_SDK_설치가이드 + Word 가이드: "인앱 메시지는 추가 코드 없이 자동 표시" 1절 + inline_card/수동 트리거 고급 사용 1절.

### T7. 실측 1건 검증 시나리오 (dev_process_six_rules ⑤ — 보고 필수)
1. 테스트 회사에 center_modal 메시지 1건 활성화 (관리자 화면)
2. 데모 HTML(스니펫 한 줄 + data-hjl-user-id/phone)을 등록 도메인에서 열기
3. 모달 표시 확인 → 닫기 → impression/dismiss가 cdp_inapp_impressions에 기록 확인 (SQL)
4. once_per_session 재로드 미표시 확인 + 관리자 통계 카드 반영 확인
5. cart_add 트리거 메시지 1건 — hjl.track('cart_add') 호출 페이지에서 표시 확인

### 순서/의존
T0(Harold SQL) → T1+T2(SDK 배선) → T3(서버 개인화) → T4 → T5(빌드) → T7(실측) → T6(가이드). T3는 T1과 독립적이라 묶어서 한 세션에 가능. 전 단계에 6원칙 적용(승인 후 시작·전수 grep — `window.hjl` 소비처·`HanjulloInAppModule` 호출처·빌드 산출물 사본 경로).

---

## D. AI 편의 강화 백로그 (배선 T1~T7 완료 후 단계 — Harold 선별 대기)

이미 구현된 AI: 자연어 생성(CT-77 inapp-ai-generator), CTR 진단(CT-81 inapp-explainer), 빠른 액션(inapp-quick-action), 개인화 변수 도구(inapp-personalization), 빠른 시작 7. 추가 후보 5건 — 전부 기존 자산 재사용으로 구현 가능:

| # | 기능 | 내용 | 재사용 자산 |
|---|---|---|---|
| D1 | 성과 자동 개선 루프 | CTR 미달 메시지를 AI가 변형 자동 생성 → A/B → 승자 자동 승격 + 담당자 알림. "켜두면 알아서 좋아지는 인앱" | CT-80 Bandit(이미 존재) + variant-generator + 알림 패턴 |
| D2 | 크로스채널 후속 1-click | 인앱 노출됐는데 클릭 안 한 식별 고객을 자동 세그먼트로 → "이 N명에게 SMS 후속 발송" 버튼 (인앱 무료 노출 → SMS 유료 발송으로 잇는 수익 구조) | cdp_inapp_impressions + 직접발송 파이프라인 |
| D3 | 시즌 자동 제안 | 한국 달력 기반 "다음 주 ○○데이 — 인앱 제안 3개" 카드 | getKoreanCalendar + CT-77 |
| D4 | 목표 기반 생성 | 자연어 입력에 목표(전환/가입/재방문) 칩 추가 → 목표별 CTA·템플릿·트리거 조합 자동 | CT-77 프롬프트 확장 |
| D5 | 게시 전 도달 시뮬레이션 | "이 세그먼트+시간대면 24h 예상 노출 N명" — 회사 실측 트래픽(cdp_events) 기반, 임의 상수 0 | cdp_events 집계 (여정 시뮬레이션 카드 패턴) |

AI 생성 메시지에 구체 혜택(%/원/쿠폰) 임의 생성 금지 룰은 전 기능 공통 적용.

## E. 크레딧 현황 + 책정 권고 (2026-06-11 실측)

현행 (ai-credit-calc.ts CREDIT_COST_MAP — 2026-06-01 가치 기반 재설계, 1크레딧=500원):

| 작업 | 크레딧 | 비교 |
|---|---|---|
| 인앱 AI 생성(돌려보기) | 3 | DM 생성 3 / 여정 생성 3 — 동일 |
| 인앱 게시(활성화, 멱등 1회) | 15 | DM 발행 30 / 여정 활성화 150 / 자동마케팅 200 |
| 인앱 진단·빠른 액션 | 1 | 다듬기·진단류 공통 1 |
| 노출(impression)·클릭·트래킹 | 0 | 과금 없음 — 게시 후 무제한 노출 |

평가: 체계(돌려보기 3 + 확정 N)는 일관. 논점은 **게시 15로 무제한 상시 노출**이라는 점 — DM 발행 30은 1회성 페이지인데 인앱 15는 상시 채널이라 값어치 대비 저평가 여지. 노출당 과금은 종량제 정체성과 충돌(Braze는 MAU 정액제라 노출 무과금 — 우리가 따라갈 모델 아님).

권고(정답 1안): 단가 체계는 현행 유지(3/15/1), 노출 가치는 **플랜별 동시 활성 인앱 메시지 수 한도**로 반영 — plans 테이블의 기존 한도 컬럼 패턴(max_auto_campaigns 등)과 동일한 방식이라 종량제와 충돌 없음. 한도 숫자는 Harold 결정 사항.

## C. 판정 요약 (Harold 질문에 대한 답)

- "SDK 연동이 되면 실제로 모달을 띄울 수 있는지" → **지금은 못 띄운다.** 모듈·서버·화면 전부 완성인데 실행 배선이 0이라, 관리자가 메시지를 만들어도 고객사 사이트에는 아무것도 안 나온다.
- 배선(T1~T2)만 붙이면 8 템플릿 모달/배너가 실제로 뜨는 구조까지는 이미 다 만들어져 있다.
- 진짜 개인화(이름/등급 변수)는 T3(서버 동봉)까지 해야 완성 — 클라 치환만으로는 자동 기동 시 빈값.
