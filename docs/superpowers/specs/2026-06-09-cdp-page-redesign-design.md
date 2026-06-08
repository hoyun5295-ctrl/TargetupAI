# CDP(자사몰 연동) 페이지 재설계 — 설계서

> 2026-06-09. 성과리포트(PerformancePage) 모달 패턴을 CDP 페이지에 적용. 게이팅 전 유료 일치 + "지원 자사몰 매트릭스" 나열 제거. 구현 후 SDK 전 소스 재점검.

## Goal

`CdpSettingsPage.tsx`(1596줄·13섹션이 한 화면에 펼쳐짐)를 메인=핵심 요약, 상세=클릭 모달로 단순화한다. 프론트 게이팅을 백엔드(전 유료 개방)와 일치시키고, 특정 플랫폼 나열("Phase 2 예정") 섹션을 "어떤 자사몰이든 연동" 안내로 바꾼다.

## 절대 전제

- 데이터 전부 목업(실 CDP 연동 업체 0) → 실데이터 검증 불가. 검증 가능한 것 = frontend tsc 0 + 기존 API 재사용 + 모달 열림/닫힘 동작 + 게이팅 분기.
- **기존 데이터/state/API 재사용** — UI 재배치 중심. 신규 백엔드 0(단, 게이팅 표시 기준만 변경).
- 백엔드 게이팅은 이미 전 유료 개방: `plan-guard.ts ai_cdp`·`cdp-auth.ts isCdpEnabledForPlan` 둘 다 FREE(미가입)만 차단. 프론트 표시만 옛 "비즈니스 의무"로 남아 불일치.
- 모델명 UI 노출 0 · native dialog 0 · 박-단어 0 · 다크 톤(slate-950 + violet 액센트) · 모바일 반응형 · Source caption.

## 현황 (CdpSettingsPage 1596줄)

섹션 13개 전부 인라인: ①헤더 ②게이팅 안내 ③데이터부족 카드 ④AI 진단 ⑤1-click 3 ⑥5 metric ⑦자세히 분석(funnel·24h·매핑률·POS↔CDP 격차·webhook·채널) ⑨영향요인 ⑩활성 customer Top ⑪Provider 매트릭스(자체호스팅·카페24·네이버·skeleton + Phase2 나열) ⑫키 발급 ⑫-0 도메인 ⑫-1 SDK 스니펫 ⑫-2 설치 검증 ⑬컴퓨팅 시점.

## 재설계 — 메인 (스크롤 짧게)

1. 헤더 (기존 sticky 유지)
2. 게이팅 안내 — STARTER+ 정상 진입, FREE만 "유료 가입 안내". 기준 `usage.cdp_enabled` → `plan_code !== 'FREE'`.
3. **"어떤 자사몰이든 연동" 안내 카드** (지원 매트릭스 대체) — "표준 SDK/webhook로 바로 연동되고, 특수한 환경이면 개발 담당자가 문의 주시면 직접 맞춤 연동을 도와드립니다" + 문의 연락처(미결).
4. 연동 1-click 3 (자체호스팅·카페24·네이버 "연동 시작") — 미연동 시 강조.
5. 핵심 5 metric (회사 customer·매핑·이벤트·융합·자사몰만) + 데이터부족 critical 카드(축약).
6. 요약 칩 바 (클릭 → 모달): AI 진단 / 데이터 분석 / Provider 연동 / 활성 customer.

## 재설계 — 모달 (PerformancePage의 PerfModal 패턴 재사용)

- **AI 진단 모달**: 섹션 ④ + ⑨ (건강도 스코어·영향 요인·추천)
- **데이터 분석 모달**: 섹션 ⑦ (funnel·24h·매핑률·POS↔CDP 격차·webhook 신뢰성·채널 분포) + ⑬ 컴퓨팅 시점
- **Provider 연동 모달**: 섹션 ⑪(자체호스팅·카페24·네이버 연동 시작, **Phase2/skeleton 나열 제거**) + ⑫ 키 발급 + ⑫-0 도메인 등록 + ⑫-1 SDK 스니펫 + ⑫-2 설치 검증
- **활성 customer 모달**: 섹션 ⑩ (자사몰 활성 customer Top)

## 제거

"지원 자사몰 매트릭스" 나열 섹션 통째 제거(Shopify·메이크샵·imweb·식스샵·WooCommerce "Phase 2 예정" + 카페24·네이버·자체호스팅 카드). → 메인 "어떤 자사몰이든 연동" 안내 카드 1개 + Provider 연동 모달의 실제 "연동 시작" 버튼으로 대체. **이유: 특정 목록 나열 + "예정"은 목록에 없는 자사몰 쓰는 회사를 시도 전 이탈시킨다.**

## 게이팅 fix (전 유료 개방 일치)

- 1순위: `usage` API(GET /cdp/usage 등)가 `cdp_enabled`를 `isCdpEnabledForPlan`(plan_code≠FREE)과 동일 기준으로 반환하도록 통일 → 프론트 무수정 일치.
- API 변경이 다른 소비처에 영향 있으면: 프론트 게이팅 판정만 `usage.plan_code !== 'FREE'`로 변경.
- 구현 시 usage 응답 구조·소비처 grep 후 안전한 쪽 선택.

## SDK 소스 재점검 (구현 후 별도 단계 — Harold 명시)

UI 재설계 완료 후 SDK 자사몰 연동 전 소스 재점검·재점검:
- `routes/cdp.ts` (usage·키 발급·도메인 allowlist·설치 검증 endpoint·webhook 수신)
- `utils/cdp-auth.ts` (게이트·이벤트 월 한도)
- SDK 설치 스니펫 (public key 주입·Origin allowlist·이벤트 전송)
- Provider webhook 처리 (카페24·네이버·자체호스팅 OAuth/webhook)
- 이벤트 수집·identity link·회사 격리
- 점검 관점: 게이팅 일관성 · 에러 처리(DB 마이그레이션 503 분기) · 외부 API 응답 검증(raw 확인) · 박-단어/모델명 0 · 부실/죽은 로직.

## 검증

- frontend tsc 0 (usage API 변경 시 backend tsc 0)
- 박-단어/모델명/native dialog grep 0
- 모달 동작: 목업으로 각 칩 클릭 → 모달 열림·닫힘
- 게이팅 분기: STARTER+ 정상 진입, FREE 안내 표시

## 미결

- "어떤 자사몰이든 연동" 안내 카드의 문의 연락처(이메일·카톡 채널 등) — 구현 시 Harold 제공.

## 배포

구현 후 frontend `build:safe` (usage API 변경 시 backend `build:safe` + `pm2 restart all` 동반).
