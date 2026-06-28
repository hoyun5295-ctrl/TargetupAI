# 이메일 마케팅 브레이즈급 완성도 — 다음 세션 진입 가이드 (2026-06-28)

> "하려다 만 것" — 2026-06-27 세션 시작 시 Harold 요구의 한 축. 범위가 넓어 다음 세션 brainstorming으로 우선순위부터 확정 후 구현.

## 0. 배경

2026-06-27 세션 시작 Harold 요구 = (A) "이메일 마케팅 퀄리티 올리고 간편하게(브레이즈급)" + (B) "7천 건 AI 학습 문안". 무게중심을 (B) AI 문안 엔진으로 골라 완료(문안 두뇌 RAG+시의성+브랜드 키트+복제가드, [[project_2026_0627_copy_brain_rag]]). (A) 이메일 마케팅 자체 완성도는 미착수 = 이번 가이드 대상.

## 1. 현황 (이미 구현됨 — 구현 직전 재확인)

- **0613 이메일 AI 강화**: 트래킹(오픈 픽셀·링크 래핑·개인 토큰 수신거부) + 수신자 고객DB 연동 + 비동기 발송 + 예약 발송 sweeper + AI 원샷 생성 + AI 비주얼 블록 생성 + 발송 전 스팸 진단 + 발송 후 성과 진단 + 발송시간 추천 + 미오픈자 SMS 크로스. 파일 = `utils/email-ai.ts`, `email-tracking.ts`, `email-send-sweeper.ts`, `email-channel.ts`, `email/email-blocks.ts`, `pages/EmailCampaignsPage.tsx`.
- **2026-06-27**: email-ai 생성기에 문안 두뇌(RAG+시의성+키트+복제가드) 배선 완료.

## 2. 향상 후보 (브레이즈급 — 다음 세션 brainstorming으로 우선순위 확정)

전부 하지 말고 임팩트순으로 1~2개씩. 후보:

- **비주얼 에디터 강화**: 현재 AI 블록 생성 위주 → 드래그앤드롭 블록 편집(추가·순서·스타일·이미지 업로드). email-blocks 기반 확장.
- **템플릿 갤러리**: 업종·시나리오별 완성 템플릿 + 미리보기 선택(인앱 빠른 시작과 동일 철학).
- **자동화 시퀀스(이메일 여정)**: 환영/온보딩/장바구니/윈백 다단계 — 기존 여정 엔진 연계.
- **A/B 테스트**: 제목·본문 변형 + 성과 비교(기존 bandit-arm 연계).
- **세그먼트 타겟**: 고객 조건(등급·행동) 타겟 — CDP 연계.
- **분석 대시보드**: 캠페인별 오픈·클릭·전환 추이 + 비교.
- **개인화**: {{변수}} + 조건부 블록.

## 3. 다음 세션 진입 방법

1. `superpowers:brainstorming`으로 위 후보 중 Harold 우선순위 확정(임팩트 vs 공수).
2. 현황 재확인: `EmailCampaignsPage.tsx` 구조 + `email/email-blocks.ts` 에디터 수준 read.
3. 확정 범위만 spec → plan → 구현.

## 4. 영구 원칙 (이메일 = 발송·돈 경로)

- 발송·돈 수정 = 0611 6원칙(실측 1건 시나리오 + 효과 검증 후 성공 표시).
- AI 임의 혜택 0([[feedback_ai_no_arbitrary_benefit]]) · 모델명 UI 0 · native dialog 0.
- 디자인 = [[feedback_design_modal_first_simplicity]] + Journey 동급.
