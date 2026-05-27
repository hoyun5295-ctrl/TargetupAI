# Claude Design 마스터 프롬프트 — CHAPTER 10 AI Operator 본질 (한줄로 매뉴얼 추가)

> **작성일**: 2026-05-27 (D222+ 세션 안 신설)
> **용도**: Harold 직접 Claude Design 호출 시 복붙 영역
> **출력 영역**: HTML CHAPTER 10 article (옛 manual.html 안 CHAPTER 09 직후 삽입 의무)

---

## 본 작업 본질

한줄로 사용자 매뉴얼 (`packages/frontend/public/manual/manual.html`) 안 **AI Operator 10 sub-메뉴 본질 영역**이 누락된 상태. 본 영역 = 한줄로 차별점 핵심 (Braze 압도 영역) + 6,000사+ 마케팅 담당자 진입 필수 영역. 신규 CHAPTER 10 추가 + 사이드바 nav 항목 추가 의무.

기존 매뉴얼 9 챕터 = 발송 흐름 중심 (자동발송 / 직접발송 / 세그먼트 / 결과 분석 / 부가 기능). AI Operator 본질 = 별 영역 = 진정 한줄로 압도 강점 = 마케팅 담당자 활용 필수 영역.

---

## 디자인 톤앤매너 정합 (기존 매뉴얼 9 챕터와 100% 일치 의무)

### 배경 + 글로벌 영역

- 배경 = radial-gradient (fuchsia + violet) + linear-gradient (#020617 → #1e1b4b → #3b0764) — 다크 violet/fuchsia 그라데이션
- Tailwind CDN + Pretendard Variable (font-feature-settings ss01/ss02)
- body color = rgba(255,255,255,0.9)
- user-select = body 차단 + .selectable 활성 (본문 텍스트 읽기 가능)

### 챕터 헤더 영역

```html
<article class="chapter" data-ch="10">
  <header class="mb-10">
    <div class="flex items-center gap-2">
      <div class="text-[11px] tracking-[0.2em] font-mono text-violet-300">CHAPTER 10</div>
      <span class="px-2 py-0.5 rounded-md text-[10px] tracking-widest font-mono uppercase bg-fuchsia-400/15 text-fuchsia-200 border border-fuchsia-400/30">BETA</span>
    </div>
    <h1 class="mt-2 text-3xl sm:text-4xl text-white font-semibold tracking-tight">AI Operator — 10 sub-메뉴 본질</h1>
    <p class="mt-3 text-white/55 max-w-2xl leading-relaxed">한줄로 차별점의 핵심. 자연어 한 줄로 AI가 마케팅 캠페인 전 영역을 자동 설계하는 통합 운영 체계입니다. 일반 발송 흐름 (CHAPTER 03~09)을 뛰어넘는 본질적인 AI 자동화 영역.</p>
    <div class="mt-6 h-px bg-gradient-to-r from-violet-400/50 via-fuchsia-400/30 to-transparent"></div>
  </header>
  <!-- 본문 -->
</article>
```

### Step 카드 패턴

```html
<div class="step rounded-xl border border-violet-400/20 bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-transparent p-5 hover:border-violet-400/40 transition-colors">
  <div class="flex items-start gap-4">
    <div class="w-10 h-10 shrink-0 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white font-semibold grid place-items-center text-sm">N</div>
    <div class="min-w-0 flex-1">
      <div class="text-white font-semibold mb-1">제목</div>
      <p class="text-white/70 text-sm leading-relaxed">설명</p>
    </div>
  </div>
</div>
```

### Tip / Info / Warn 박스 패턴

```html
<!-- Tip (emerald) -->
<div class="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4 flex gap-3">
  <svg class="shrink-0 text-emerald-200 mt-0.5" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z"/></svg>
  <div>
    <div class="text-emerald-200 font-semibold text-sm mb-1">Tip — 제목</div>
    <div class="text-emerald-100/85 text-sm leading-relaxed">설명</div>
  </div>
</div>

<!-- Info (violet) -->
<div class="rounded-xl border border-violet-400/30 bg-violet-500/10 p-4 flex gap-3">
  <svg class="shrink-0 text-violet-200 mt-0.5" width="20" height="20"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
  <div>
    <div class="text-violet-200 font-semibold text-sm mb-1">Info — 제목</div>
    <div class="text-violet-100/85 text-sm leading-relaxed">설명</div>
  </div>
</div>

<!-- Warn (amber) -->
<div class="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 flex gap-3">
  <svg class="shrink-0 text-amber-200 mt-0.5" width="20" height="20"><path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/></svg>
  <div>
    <div class="text-amber-200 font-semibold text-sm mb-1">Warn — 제목</div>
    <div class="text-amber-100/85 text-sm leading-relaxed">설명</div>
  </div>
</div>
```

### 스크린샷 placeholder 패턴

```html
<div class="shot mb-10 rounded-xl overflow-hidden border border-violet-400/20 bg-slate-900/50 max-w-[720px] shadow-2xl shadow-violet-500/10 hover:border-violet-400/40" data-caption="스크린샷 설명">
  <div class="aspect-[16/10] bg-[repeating-linear-gradient(45deg,rgba(167,139,250,0.06)_0_10px,transparent_10px_20px)] grid place-items-center">
    <div class="text-center px-6">
      <div class="text-[10px] tracking-[0.2em] font-mono text-violet-300/80">SCREENSHOT</div>
      <div class="mt-2 text-white/70 font-medium">화면 제목</div>
      <div class="text-white/40 text-xs mt-1">설명</div>
    </div>
  </div>
</div>
```

---

## CHAPTER 10 본문 구조 (필수 영역 10 sub-메뉴)

### 0. 진입 영역 (Hero + 10 sub-메뉴 개요)

- AI Operator 진입 흐름 = 대시보드 우측 큰 카드 (보라 그라데이션 from-violet-900 via-purple-900 to-fuchsia-900) "AI Operator" 클릭
- 진입 후 화면 = 자연어 한 줄 입력 + 빠른 시작 7 카드 + 10 sub-메뉴 카드 영역 (SUB_MODULE_CARDS)
- AI Operator 본질 = 한 줄 자연어 → AI 6 sub-agent 자동 협업 (Target / Message / Compliance / Channel / Schedule / Cost-ROI) → 제안서 → 1-click 발송
- 일반 사용자 영역 X (현재 베타 — 일부 회사만 진입 가능 + Whitelist + Enterprise/Business 등급)

**스크린샷 영역**: AI Operator 메인 페이지 전체 (자연어 입력 + 빠른 시작 7 카드 + 10 sub-메뉴 카드)

### 1. 여정 자동화 (Journey Builder — `/ai-journeys`)

- **본질**: 자연어 한 줄로 6 표준 여정 + 자유 여정 자동 설계 (5~10초)
- 6 표준 여정 = 신규 가입 환영 / 재구매 유도 / 휴면 회수 / 장바구니 회복 / 생일 축하 / 예약 알림 / 자유 여정 (AI 자율 설계)
- AI 자동 설계 영역 = Trigger Detection → Season Context (시즌+회사 톤) → Memory Learning (회사 누적) → Step Design → Message Composition → Review Ready (6 sub-agent 700ms 간격 진행 시각 효과)
- step 편집 흐름 = wait / condition / message 3 step type + 발송 채널 (SMS/LMS/MMS/카카오) + 광고 합성 미리보기
- 활성화 흐름 = 자동 검증 (스팸 + 비용 + 잔액) + 발송 2시간 전 담당자 LMS 알림 + 즉시 정지 단축 URL + 결과 알림 LMS + 7일 학습 통합
- variant 영역 = A/B 테스트 + Thompson Sampling 자동 winner 선정 (Bandit Optimizer)

**스크린샷**: 여정 자동화 메인 (자연어 입력 + 7 빠른 시작 + 활성 여정 카드)

### 2. AI 자율 마케팅 (Continuous Operator — `/continuous-operator`)

- **본질**: 매일 09:00 KST AI 자동 제안서 생성 (영구 운영)
- 회사 admin 영구 캠페인 목표 설정 (예: "VIP 유지 + 신규 가입 환영")
- AI 매일 = 회사 데이터 분석 → 오늘 추천 캠페인 1~3건 제안서 박음 → 회사 admin 승인/거부
- ENT 자동 실행 영역 = 1000건 이하 + 5만원 이하 + low risk + 비광고 조건 만족 시 자동 발송
- 7일 만료 흐름 = 옛 제안서 자동 만료 (운영 안전망)
- variant 자동 학습 = Thompson Sampling cold start + 운영 누적 학습 (Bandit Optimizer)
- 안전망 5단 = 비용 한도 + 시간대 옵트아웃 (매일 / 매주 / 매달) + 발송 정책 매트릭스 + 7일 학습 검증 + 담당자 정지 사유 AI 학습

**스크린샷**: AI 자율 마케팅 메인 (대기 제안서 목록 + 영구 운영 목표 + 안전 카드)

### 3. Predictive (예측 분석 — `/predictive`)

- **본질**: 회사 customer 안 LTV + 이탈 위험 + 구매 가능성 + 클릭 점수 자동 예측 (1시간 cron)
- 7+ 영역 예측 = LTV (90일 매출 예측) + 이탈 위험 (90일 미접속 확률) + 구매 가능성 + 클릭 점수 + 휴면 전환 + VIP 유지 + 가격 민감도
- 모델 영역 = trained (실 데이터 7일+ 누적) vs cold start (등급/활동 추정치)
- Explainability 영역 = AI 예측 근거 5 영역 (등급 + 최근 활동 + 누적 구매 + 채널 응답 + 시즌)
- 1-click 액션 3 카드 = 이탈 위험 고객 (rose) + 휴면 회수 (amber) + VIP 회복 (emerald) → 옛 ai_operator_prefill_objective sessionStorage 활용 → AI Operator 즉시 진입
- cdp_customer_predictions 테이블 = customer 안 예측 점수 누적

**스크린샷**: Predictive 대시보드 (8 카드 요약 + 차트 + 1-click 액션 3 + 모델 정확도)

### 4. AI 자율 진단 (AiSelfDiagnosisCards — `/ai-operator` 안 좌측 영역)

- **본질**: AI Operator 진입 첫 화면 안 자동 추천 카드 (회사 admin 진입 즉시 노출)
- 회사 건강 점수 (overallScore 0~100) + 우선 처리 영역 3건 + 추천 캠페인 3 우선순위 카드
- 우선순위 카드 = priority 1 (critical rose) / priority 2 (warning amber) / priority 3 (opportunity emerald)
- 각 카드 = title + reason + targetCount + expectedImpact + oneClickObjective
- 1-click 진행 = 옛 ai_operator_prefill_objective → AI Operator 즉시 진입

**스크린샷**: AI 자율 진단 카드 (좌측 영역 — 회사 건강 점수 + 우선 처리 + 우선순위 카드 3)

### 5. 성과리포트 (Performance — `/performance`)

- **본질**: 매주 AI 인사이트 + 채널·시간대·요일별 분포 + 매출/ROI 추정
- 옛 30일 + 옛 7일 + 옛 24h 기간 토글 (PERIOD_OPTIONS) — 직전 기간 대비 +/-% 델타
- 12 화면 영역 = 요약 5 metric (매출/ROI/전환율/클릭율/발송수) + 자율 진단 + 1-click 액션 3 + 6 차트 (시간대 + 요일 + 채널 + 세그먼트 + 시즌 + funnel)
- AI 자율 진단 카드 = topInsight 한 줄 + recommendation 추천 캠페인
- 1-click 액션 3 = 강화 / 정정 / 신규 캠페인 (AI Operator 진입 흐름 정합)
- 일일 인사이트 카드 = 매일 9시 자동 메일과 동일한 인사이트 (CT-98 collectCompanyInsight)
- 매장 region 강화 = 매장 코드별 분포 (D209+ CT-53)

**스크린샷**: 성과리포트 메인 (요약 5 metric + 자율 진단 + 1-click 액션 + 6 차트 토글)

### 6. 자사몰 + 데이터 융합 (CDP Settings — `/cdp-settings`)

- **본질**: 자사몰 연동 + Customer Data Platform 본질
- 지원 자사몰 매트릭스 = 카페24 / 네이버 스마트스토어 / Shopify / 메이크샵 / imweb / 식스샵 / WooCommerce / 자체 호스팅 (Provider Adapter 일반화)
- 카페24 OAuth + Webhook = HMAC-SHA256 서명 검증 + 이벤트 실시간 동기화 (customer / order / cancel)
- 한줄로 CDP API = identify / event / order / bulk-import 4 외부 endpoint + bcrypt 인증 + 월 한도 + Webhook idempotency_key 중복 차단
- AI 자율 진단 카드 = 자사몰 영역 진단 + 1-click 액션
- 본 영역 = Braze CDP 동급 차별점

**스크린샷**: CDP Settings 메인 (자사몰 카드 + 연동 흐름 + AI 자율 진단)

### 7. 인앱메시지 (In-App Message — `/inapp-messages`)

- **본질**: 자사몰 안 In-App 메시지 (top_banner / bottom_banner / center_modal)
- 12 화면 영역 = 자연어 입력 + 7 빠른 시작 + 6 sub-agent 진행 + 5 metric + 6 차트 + Explainability
- display_frequency = once_per_session / once_per_day / always (옵션)
- 통계 영역 = impression / click / dismiss + 메시지별 CTR
- SDK 활용 = `@hanjullo/sdk` v0.2.0 inapp 모듈 자동 fetch + render + 빈도 sessionStorage + localStorage + 서버 검증
- 메시지 신설 흐름 = CRUD + 미리보기 + 활성 메시지 매칭 (자동 추출)

**스크린샷**: 인앱메시지 메인 (메시지 목록 + 신설 흐름 + 통계)

### 8. Email 캠페인 (`/email-campaigns`)

- **본질**: SMTP relay 영역 + AES-256-GCM 암호화 + 4 preset (Gmail / Outlook / Naver / 자체)
- 회사 admin SMTP 자격증명 등록 (회사 안 password 암호화 저장)
- 캠페인 흐름 = 메일 디자인 + 수신자 매트릭스 + 발송 (자체 SMTP 발송 — 옛 SendGrid 영역 폐기)
- 통계 영역 = 발송 / 오픈 / 클릭 / 반송 / 옵트아웃 (email_campaigns_events 테이블)
- 6 metric 요약 + ConfirmModal + useToast (native dialog 0건)
- 향후 강화 = AI 자율 진단 + 자연어 자동 생성 + 6 sub-agent 진행 시각 효과

**스크린샷**: Email 캠페인 메인 (SMTP 설정 + 캠페인 목록 + 6 metric)

### 9. AI 메모리 (Anthropic Memory tool — `/ai-memory`)

- **본질**: 회사별 학습 메모리 누적 → AI 호출 시 시스템 프롬프트 안 자동 컨텍스트 주입
- 5 타입 메모리 = success_pattern (성공 패턴) + customer_insight (고객 인사이트) + brand_tone_evolution (브랜드 톤 진화) + channel_performance (채널 성과) + compliance_learning (검수 학습)
- 자동 학습 영역 = recordCampaignLearning 30초 cron + sent ≥ 10건 + idempotent → ai_company_memory 자동 누적
- 메모리 검색 = 자연어 검색 (Anthropic Citations + Opus 모델 영역) + 회사별 격리 + 5 타입 필터
- Top Impact Card = 가장 영향 큰 메모리 5건 (수치 영향 + 최근 활용)
- 메모리 수동 추가 = 회사 admin 직접 입력 + 5 타입 분류 + 가이드 모달
- 본 영역 = 한줄로 "시간 지날수록 정확도↑" 본질

**스크린샷**: AI 메모리 메인 (5 타입 카드 + Top Impact + 메모리 목록 + 수동 추가)

### 10. AI 사용량 (`/ai-usage`)

- **본질**: AI 호출 횟수 + 비용 + 한도 추적 + 향후 30일 예측
- 직전 30일 호출 추이 + 채널별 분포 (Opus / Sonnet / Haiku 통합 — UI 안 추상 명칭만)
- 6 metric = 호출 수 + 비용 + 토큰 + 캐시 hit율 + 일평균 + 한도 사용률
- 일별 비용 추이 + 선형 회귀 (y = ax + b) 향후 30일 예측 + 일평균 한도 비교
- Batch 영역 = 24h SLA 일괄 처리 (50% 비용 절감)
- 6 차트 = 호출 추이 + 채널 분포 + 토큰 분포 + 비용 trend + 한도 사용률 + 실패 분포
- AI 사용량 데이터 source = ai_call_log 옛 30일 일별 + ai_batch_jobs

**스크린샷**: AI 사용량 메인 (6 metric + 6 차트 + 예측 + 일별 비용 추이)

---

## CHAPTER 10 종결 안내 영역

```html
<!-- 종결 안내 -->
<div class="rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-transparent p-6">
  <div class="text-[10px] tracking-[0.2em] font-mono text-violet-300 mb-2">AI OPERATOR 진입 자격</div>
  <div class="text-white font-semibold text-lg mb-2">베타 진입 가능 회사</div>
  <p class="text-white/65 text-sm leading-relaxed">AI Operator는 현재 베타 영역으로 일부 회사만 진입 가능합니다 (Enterprise / Business 요금제 + 한줄로 운영팀 승인). 진입 자격 확인 + 활성화 신청은 1:1 고객 지원 영역으로 진입해 주세요.</p>
</div>
```

---

## 사이드바 nav 항목 추가 의무

기존 매뉴얼 JS 안 `CHAPTERS` 배열 (line 905~915) 끝에 신규 항목 추가:

```javascript
const CHAPTERS = [
  { n: 1, title: '시작하기',          sub: '메인 대시보드' },
  { n: 2, title: '고객 데이터 관리',  sub: '엑셀 업로드 · AI 매핑' },
  { n: 3, title: 'AI 자동발송',       sub: '자연어 한 줄 캠페인' },
  { n: 4, title: '직접발송',          sub: '즉시 발송' },
  { n: 5, title: '직접 타겟 발송',    sub: '조건 필터 타겟팅' },
  { n: 6, title: '자동발송',          sub: '반복 스케줄', beta: true },
  { n: 7, title: '세그먼트',          sub: '저장 + 재활용' },
  { n: 8, title: '발송 결과 & 분석',  sub: '성과 추적 · 인사이트' },
  { n: 9, title: '부가 기능',         sub: '템플릿 · 수신거부 · 예약' },
  { n: 10, title: 'AI Operator',     sub: '10 sub-메뉴 본질', beta: true },  // ★ 신규 추가
];
```

또한 — `goto(n)` 함수 안 `Math.max(1, Math.min(9, n))` → `Math.max(1, Math.min(10, n))` 정정 의무 (line 944).

또한 — `renderPager` 함수 안 `n < 9 ? CHAPTERS[n] : null` → `n < 10 ? CHAPTERS[n] : null` 정정 (line 968).

---

## 영구 룰 정합 매트릭스 (필수 통과)

- **모델명 0건** — Opus / Sonnet / GPT / Claude / Anthropic / Haiku 단어 본문 안 0건 (추상 명칭 "AI 모델" / "AI 자율 진단" 활용)
- **박-단어 0건** — 박음 / 박힘 / 박지 / 박는 / 박을 / 박힌 / 박혀 / 박혔 / 박힐 / 박았 = 0건
- **D219+ 영구 룰 단어 0건** — 옛 / 진정 / 영영 = 0건 ("기존" / "이전" / "직전" 정합 활용)
- **이모지 0건** — ✨ / 📌 / 💬 / 🖼️ / 📷 / ✏️ / 👁️ / ⏳ / 📝 / 📢 / ⚠️ / 📱 등 사용자 영역 X
- **native dialog 0건** — alert / confirm / prompt 신규 X
- **휴머스온 0건** — 휴머스온 / Humuson 키워드 노출 X (대체 = "검수팀" / "내부 반려")

---

## 출력 형식 (Claude Design 호출 시)

1. **HTML article 영역만 출력** — CHAPTER 10 article 본문만 (옛 CHAPTER 09 직후 삽입 의무)
2. **사이드바 nav JS 정정 영역 별도 출력** — CHAPTERS 배열 + goto 함수 + renderPager 함수 안 9 → 10 정정
3. **스크린샷 placeholder 11건 영역 정합** — 위 본문 영역 안 각 sub-메뉴 별 1건 + 진입 hero 1건 = 11건 placeholder
4. **다른 영역 정정 X** — head / 기존 9 챕터 / script 영역 (보안 흐름 + 라이트박스) = 영역 정정 X

---

## 본 마스터 프롬프트 활용 흐름 (Harold 직접)

1. **본 마스터 프롬프트 전체 복사** (위 영역)
2. **Claude Design 호출** + 본 프롬프트 붙여넣기
3. **Claude Design 출력 HTML 영역** = CHAPTER 10 article + JS 정정 영역
4. **Harold = 본 AI 새 세션 진입** + 출력 HTML 업로드
5. **본 AI = 매뉴얼 HTML 안 정정** — CHAPTER 09 직후 신규 CHAPTER 10 article 삽입 + JS 정정 영역 적용 + 사이드바 nav 자동 활성 확인
6. **스크린샷 입히기** = Harold 직접 스크린샷 캡처 11건 (CHAPTER 10 영역 + 옛 32건 = 총 43건) + 본 AI = `<div class="shot"><img src="..." alt="..." /></div>` 영역 정정

---

## 본 마스터 프롬프트 정합 자가 검증 매트릭스

- [x] 디자인 톤앤매너 정합 (다크 violet/fuchsia + Tailwind + Pretendard) — 기존 9 챕터 100% 일치
- [x] 10 sub-메뉴 본질 영역 정의 완전 (라우트 + 본질 + 활용 흐름)
- [x] 영구 룰 17건 정합 (모델명 / 박-단어 / 옛-진정-영영 / 이모지 / native dialog / 휴머스온 0건)
- [x] 스크린샷 placeholder 11건 매트릭스 명확
- [x] 사이드바 nav 정정 영역 (JS 안 CHAPTERS + goto + renderPager) 명시
- [x] 본 마스터 프롬프트 = Claude Design 직접 활용 영역 완전

---

> **본 마스터 프롬프트 종결.** Harold 직접 Claude Design 호출 시 복붙 영역. 출력 HTML = 다음 세션 본 AI 진입 시 매뉴얼 HTML 안 정정 의무.
