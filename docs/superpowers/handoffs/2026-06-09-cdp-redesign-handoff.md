# CDP(자사몰 연동) 페이지 재설계 — 핸드오프 (다음 세션 진입용)

> **이 문서가 최신 설계의 진실 원천이다.** spec(`2026-06-09-cdp-page-redesign-design.md`)·plan(`2026-06-09-cdp-page-redesign.md`)보다 **본 핸드오프의 "수정 설계"가 우선**(Harold 2026-06-09 화면 피드백 반영). 다음 세션은 이 문서를 먼저 정독하고 구현한다.

## 1. 이번 세션 완료 (Task 1·2 — 코드 적용됨, 배포 명령 제공, Harold 배포 예정)

- **Task1 게이팅 fix**: `CdpSettingsPage.tsx`의 `cdp_enabled` 게이팅 판정 11곳을 `cdpLocked = !!usage && usage.plan_code === 'FREE'`로 전수 교체. STARTER 이상 전부 개방, FREE만 안내. 안내 문구 "비즈니스 의무" → "스타터 요금제부터". tsc 0.
  - 핵심: 백엔드(`plan-guard.ts ai_cdp`·`cdp-auth.ts isCdpEnabledForPlan`)는 이미 FREE만 차단(전 유료 개방). 프론트 표시만 옛 `cdp_enabled`(plans 플래그, BUSINESS+) 기준이라 불일치였음. `usage.plan_code`가 이미 존재 → 프론트 판정만 교체(백엔드 무수정).
- **Task2 매트릭스 제거**: "지원 자사몰 매트릭스" skeleton 나열(`providers.map`, Shopify·메이크샵·imweb·식스샵·WooCommerce "Phase 2 예정" + 카페24·네이버·자체호스팅) 제거 → "어떤 자사몰이든 연동해 드립니다" 안내 카드. tsc 0.

## 2. 수정 설계 (Harold 2026-06-09 화면 피드백 — 옛 spec/plan보다 우선)

Harold 지적 4가지:
1. **AI 자율진단**: 연동된 CDP 데이터(매핑률·이벤트·POS↔CDP 격차·webhook) 분석으로 건강도+추천을 내는 기능 → **미연동(이벤트 0)이면 무의미·자리만 차지.** 메인에서 제거하고 "데이터 분석" 모달 안으로.
2. **연동 카드 3개 고정 X**: 자체 호스팅(webhook)이 **범용**(고도몰·가비아·기타 어떤 자사몰이든 커버). 카페24·네이버는 OAuth 편의일 뿐. → 메인엔 "자사몰 연동하기" 버튼 1개. 누르면 모달에서 [자체 호스팅(권장·범용) / 카페24 / 네이버 / 그 외 = 자체 호스팅 방식·고객센터 문의] 선택.
3. **연동영역진입 → 모달**: 지금처럼 자체호스팅·카페24·네이버·키발급·도메인·SDK·검증을 메인에 세로로 길게 나열 X → 전부 연동 모달 안으로.
4. **큰 카드 세로 나열 압축**: 자사몰미연동·AI진단 같은 큰 카드가 우측 공간 비우고 세로로 늘어짐 → 압축(필요 시 2열).

### 2-1. 최종 메인 (단순 — 미연동이면 여기까지)
1. 헤더 (기존 sticky 유지)
2. 게이팅 안내 (`cdpLocked`=FREE만 — "스타터부터")
3. "어떤 자사몰이든 연동" 카드 — 설명 + **"자사몰 연동하기" 버튼**(→ 연동 모달). 미연동 강조.
4. 핵심 5 metric (회사 customer·매핑·이벤트·융합·자사몰만)
5. 연동돼서 데이터 있으면(예: `usage.has_key` 또는 이벤트>0): 요약 칩(데이터 분석 / 활성 고객) 노출. 미연동이면 칩 숨김.
- ※ AI 자율진단 큰 카드·3개 연동 카드·도메인·키 발급 인라인 = **메인에서 전부 제거**(모달로 이동).

### 2-2. 모달 (createPortal — 헤더 backdrop-filter가 fixed 가두는 문제 회피. 성과리포트 교훈)
- **연동 모달** ("자사몰 연동하기" 버튼): 자체 호스팅 webhook(권장·범용 — webhook_secret 발급 + 키 발급 + 도메인 등록 + SDK 스니펫 + 설치 검증) + 카페24 OAuth + 네이버 OAuth + "그 외 자사몰 = 자체 호스팅 방식 또는 고객센터 문의" 안내. (기존 섹션 ⑪ 연동부·⑫·⑫-0·⑫-1·⑫-2 통합)
- **데이터 분석 모달**: AI 자율진단(건강도 스코어+영향 요인+추천, `loadExplanation`) + funnel·24h timeline·매핑률·POS↔CDP 격차·webhook 신뢰성·채널 분포 + 컴퓨팅 시점. (기존 ④·⑨·⑦·⑬)
- **활성 고객 모달**: 자사몰 활성 customer Top. (기존 ⑩)

## 3. 미완 Task (다음 세션 — 위 수정 설계대로)

- **Task3** 모달 인프라: `import { createPortal } from 'react-dom'`, `CdpModalKey = null|'connect'|'analytics'|'customers'`, `activeModal` state, `CdpModal` 컴포넌트(다크 톤 slate-900+white/10, createPortal(...,document.body)), 메인 "자사몰 연동하기" 버튼 + 데이터/활성고객 칩.
- **Task4** 연동 모달(2-2 통합).
- **Task5** 데이터 분석 모달(+AI 진단). `loadExplanation`은 모달 open 시 호출.
- **Task6** 활성 고객 모달.
- **Task7** 메인 압축: AI진단 카드·3개 연동 카드·도메인·키 인라인 제거(모달로). 미사용 정리(`detailsExpanded`·`providers` state·`makeshop/sixshop` 라벨 상수 등).
- **Task8** 검증: frontend tsc 0 + grep 0(`박-단어|Opus|Sonnet|Claude|alert\(|confirm\(|prompt\(`) + 모달 동작.
- **Task9** SDK 소스 재점검: `routes/cdp.ts`·`utils/cdp-auth.ts`·`routes/cafe24.ts`·`routes/naver-commerce.ts`·SDK 스니펫·webhook 수신부 — 게이팅 일관·DB ALTER 503 분기·외부 API raw 검증·중복 처리·박/모델명.

## 4. 현재 코드 상태 / 데이터 / 핸들러 (재사용)

- `CdpSettingsPage.tsx`(1596줄 근처): Task1-2 적용(cdpLocked·매트릭스 제거·안내 카드). 나머지 섹션은 기존 인라인 그대로(`!cdpLocked &&` 가드).
- **state**: usage(plan_code·cdp_enabled·has_key·public_key·monthly_limit·used·plan_name·issued_at)·diagnostics·funnel·timeline·activeCustomers·channelDist·channelCaps·explanation·installStatus·allowedOrigins·issuedSecret·cafe24Status·naverStatus·providers·customInfo·customIssuedSecret·confirm.
- **API(loadAll 10 fetch)**: `/cdp/usage`·`/cdp/diagnostics`·`/cdp/funnel?days=30`·`/cdp/timeline`·`/cdp/active-customers?limit=10`·`/cdp/channel-distribution`·`/cafe24/status`·`/naver-commerce/status`·`/cdp/providers`·`/cdp/custom/info`. AI=`POST /cdp/explain`(loadExplanation). install=`/cdp/install-status`(10초 폴링). origins=`/cdp/allowed-origins`(GET/POST/DELETE).
- **핸들러**: handleIssueKey/issueKey·addOrigin/removeOrigin·handleCafe24Connect/handleCafe24Disconnect·handleNaverConnect/handleNaverDisconnect·handleCustomIssue/handleCustomRevoke·copyCustom·SecretRow(컴포넌트).
- **게이팅**: cdpLocked = `!!usage && usage.plan_code === 'FREE'` (백엔드 무수정).

## 5. 미결 (Harold 제공 필요)

- "어떤 자사몰이든 연동" 안내 카드 + 연동 모달 "그 외" 문의 **연락처**(현재 "고객센터" placeholder → 실제 이메일·카톡 채널 등).

## 6. 다음 세션 진입 명령어

> status/STATUS.md CURRENT_TASK 정독 + docs/superpowers/handoffs/2026-06-09-cdp-redesign-handoff.md 정독(최우선·수정 설계) + docs/superpowers/specs/2026-06-09-cdp-page-redesign-design.md + docs/superpowers/plans/2026-06-09-cdp-page-redesign.md 참조 + memory/feedback_design_quality_minimum_journey_level.md + memory/feedback_marketing_user_ux_priority.md 정독 → CDP 페이지 모달화 Task3~9 구현(핸드오프 §2 수정 설계 우선: AI진단 데이터모달 통합·연동 버튼1개→모달·메인 압축·3개 고정 X). 모달=createPortal. 끝까지 구현 후 tsc/grep 검증 → 배포.
