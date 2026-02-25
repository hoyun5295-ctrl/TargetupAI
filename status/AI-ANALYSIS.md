# AI 분석 기능 (Task B) — 설계 & 세션 추적

> **관련 문서:** STATUS.md (CURRENT_TASK Task B) | SCHEMA.md (plans 테이블) | OPS.md (배포)
> **생성일:** 2026-02-25
> **목표:** 요금제별 차별화된 AI 마케팅 분석 기능 구현 + 베이직 사용자 업그레이드 유도

---

## 1) 개요

### 배경
- 한줄로 요금제: 베이직(30만원) / 프로(100만원) / 비즈니스(300만원)
- AI 분석은 프로 이상 전용 기능 → 요금제 업그레이드의 핵심 동기 부여
- 베이직 사용자에게는 "맛보기"를 보여줘서 업그레이드 욕구 자극

### 핵심 원칙
- **프로 = What happened** (과거 회고, 집계값 기반, 토큰 소모 적음)
- **비즈니스 = Why + What to do next** (예측+액션, 로우데이터 기반, 토큰 소모 많음)
- **베이직 = 실제 데이터 티저 + 블러 + 업그레이드 CTA**
- 분석 항목은 AI 프롬프트 수정만으로 업데이트 가능한 구조

### UI 배치 결정
- **탑메뉴(DashboardHeader)에 Sparkles 아이콘 + AI 분석 메뉴 추가** (대시보드 내부에 넣지 않음)
- 위치: 발송결과 다음, 수신거부 앞 (gold + emphasized)
- 클릭 → AnalysisModal.tsx (독립 풀 모달, max-w-[900px])
- 분석은 "주기적 리포팅" 성격 → 탑메뉴 진입이 UX상 자연스러움

---

## 2) 요금제별 분석 스펙

### 베이직 (ai_analysis_level = 'none')
- 분석 실행 불가
- **업그레이드 유도 프리뷰 화면 표시:**
  - 실제 데이터 요약 4개 (캠페인 수, 총 발송, 평균 성공률, 전체 고객 수) → 숫자는 진짜
  - 프로에서 볼 수 있는 항목 (최적 시간대, 최고 요일, TOP 캠페인, 수신거부 추이) → 블러 + 🔒
  - AI 분석 예시 텍스트 3줄 → 그라데이션 페이드아웃 ("더 보고 싶다" 효과)
  - 비즈니스 전용 항목 (세그먼트, 이탈 위험, ROI, 액션 플랜) → 더 강한 블러
  - 하단: 👑 업그레이드 CTA 버튼

### 프로 (ai_analysis_level = 'basic')
- **AI 입력:** 집계값 위주 (캠페인 요약 통계, 고객 분포 집계)
- **Claude 호출:** 1~2회
- **분석 항목:**
  - 캠페인 성과 분석: 성공률/실패율 추이, 채널별 비교
  - 요일/시간대별 패턴 → 최적 발송 시간 추천
  - 고객 기본 통계: 성별/등급/지역 분포
  - 수신거부 추이: 월별 증감 + 원인 분석
  - 월간 요약: 총 발송, 성공률, 전월 대비, TOP 3 캠페인
- **PDF:** 기본 1~2페이지 (핵심 수치 + 간단 차트 설명)
- **비즈니스 전용 카드:** 보이되 블러 + "비즈니스에서 확인 가능" → 업셀

### 비즈니스 (ai_analysis_level = 'advanced')
- **AI 입력:** 로우데이터 포함 (개별 캠페인, 고객 세그먼트, 구매 내역)
- **Claude 호출:** 5~8회 (멀티턴)
- **프로의 모든 기능 +**
  - 고객 세그먼트 자동 분류: RFM 기반 고객군 식별 + 군별 특성/추천 전략
  - 이탈 위험 분석: 구매주기 대비 미구매 고객 추출 + 재활성화 메시지 AI 제안
  - 캠페인 심층 비교: 동일 타겟 다른 메시지 성과 비교 + 톤/내용 패턴 분석
  - 구매 전환 분석: 캠페인 발송 후 7일 내 구매 추적 + ROI 추정 (purchases 보유 시)
  - 맞춤 액션 제안: 타겟군 + 메시지 방향 + 발송 시기 패키지 추천
- **PDF:** 상세 5~10페이지 (차트/세그먼트/전략, 회사 로고 + 기간 설정)

---

## 3) DB 변경사항

```sql
-- plans 테이블에 AI 분석 레벨 컬럼 추가
ALTER TABLE plans ADD COLUMN ai_analysis_level varchar(20) DEFAULT 'none';
-- 값: 'none' (베이직) / 'basic' (프로) / 'advanced' (비즈니스)

-- 기존 요금제 매핑
UPDATE plans SET ai_analysis_level = 'none' WHERE plan_code = 'basic';
UPDATE plans SET ai_analysis_level = 'basic' WHERE plan_code = 'pro';
UPDATE plans SET ai_analysis_level = 'advanced' WHERE plan_code = 'business';
```

---

## 4) API 설계

### 새 라우트: `routes/analysis.ts`

> ai.ts(1,300줄+)에 합치지 않고 별도 분리. 간결하게 유지.

#### 4-1. GET /api/analysis/preview

**용도:** 모든 요금제 — 티저 데이터 (베이직은 프리뷰용, 프로/비즈니스는 분석 전 요약)

**응답:**
```json
{
  "analysisLevel": "none|basic|advanced",
  "teaser": {
    "totalCampaigns": 47,
    "totalSent": 12450,
    "avgSuccessRate": 94.2,
    "totalCustomers": 3280,
    "bestTimeSlot": "화 10:00",
    "bestDayOfWeek": "화요일",
    "topCampaignName": "봄 신상품 안내",
    "unsubscribeCount30d": 23,
    "churnRiskCount": 156,
    "segmentCount": 4,
    "estimatedROI": "320%"
  }
}
```
- `analysisLevel === 'none'`이면 프론트에서 bestTimeSlot 이하를 블러 처리
- 백엔드는 모든 데이터를 반환 (프론트에서 요금제별 블러/표시 분기)
- 또는 보안상 백엔드에서 `none`이면 상세 필드 제거 → **Harold님 결정 필요 (세션1에서)**

**데이터 소스:**
| 필드 | 쿼리 대상 |
|------|----------|
| totalCampaigns | campaigns (최근 30일, status=completed/sent) |
| totalSent | campaign_runs SUM(sent_count) |
| avgSuccessRate | campaign_runs SUM(success)/SUM(sent) |
| totalCustomers | customers (is_active=true) |
| bestTimeSlot | campaign_runs → sent_at 시간대별 성공률 집계 |
| bestDayOfWeek | campaign_runs → sent_at 요일별 성공률 집계 |
| topCampaignName | campaign_runs → 성공률 TOP 1 캠페인명 |
| unsubscribeCount30d | unsubscribes (최근 30일) |
| churnRiskCount | customers → 마지막 구매 90일+ (purchases JOIN) |
| segmentCount | 고정값 또는 RFM 기반 동적 계산 |
| estimatedROI | purchases (캠페인 발송 후 7일 내) / 발송비용 |

#### 4-2. POST /api/analysis/run

**용도:** 프로 이상 — AI 분석 실행

**요청:**
```json
{
  "period": "30d|90d|custom",
  "startDate": "2026-01-01",
  "endDate": "2026-02-25"
}
```

**처리 흐름:**
1. 요금제 체크 (ai_analysis_level !== 'none') → 아니면 403
2. 기간 내 데이터 수집 (집계값 or 로우데이터)
3. Claude API 호출 (프로: 1~2회 / 비즈니스: 5~8회 멀티턴)
4. 구조화된 분석 결과 반환

**응답:**
```json
{
  "analysisId": "uuid",
  "level": "basic|advanced",
  "generatedAt": "2026-02-25T15:30:00+09:00",
  "insights": [
    {
      "id": "campaign-performance",
      "category": "campaign",
      "title": "캠페인 성과 분석",
      "summary": "지난 30일간 47건의 캠페인...",
      "details": "...",
      "level": "basic",
      "data": { ... }
    },
    {
      "id": "customer-segments",
      "category": "customer",
      "title": "고객 세그먼트 분류",
      "summary": "...",
      "details": "...",
      "level": "advanced",
      "data": { ... }
    }
  ]
}
```
- 각 insight에 `level` 필드 → 프로 사용자가 비즈니스 카드를 볼 때 블러 처리 기준

#### 4-3. GET /api/analysis/pdf?analysisId=uuid

**용도:** 프로 이상 — 분석 결과 PDF 다운로드
- 프로: 1~2페이지 기본 보고서
- 비즈니스: 5~10페이지 상세 보고서 (차트/세그먼트/전략)
- Content-Type: application/pdf
- 파일명: `한줄로_AI분석_${회사명}_${기간}.pdf`

---

## 5) 프론트엔드 컴포넌트 구조

### 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `DashboardHeader.tsx` | 📊 AI 분석 버튼 추가 + `onAnalysis` prop 추가 |
| `Dashboard.tsx` | `showAnalysis` state + `<AnalysisModal>` 렌더링 + planInfo.ai_analysis_level 전달 |
| `companies.ts` (my-plan API) | ai_analysis_level 반환 추가 |

### 신규 파일

| 파일 | 내용 |
|------|------|
| `AnalysisModal.tsx` | 메인 분석 모달 (독립 컴포넌트) |

### AnalysisModal.tsx 내부 구조

```
AnalysisModal
├── 공통: 헤더 (📊 AI 마케팅 분석 + 닫기)
│
├── analysisLevel === 'none' → AnalysisPreview (베이직 프리뷰)
│   ├── 실제 데이터 요약 카드 4개 (투명하게 보임)
│   ├── 프로 기능 블러 섹션 (반투명 + 🔒)
│   ├── AI 예시 텍스트 (3줄 + 페이드아웃)
│   ├── 비즈니스 기능 블러 섹션 (강한 블러)
│   └── 👑 업그레이드 CTA
│
├── analysisLevel === 'basic' → AnalysisRunner (프로 분석)
│   ├── 기간 선택 (30일/90일/직접설정)
│   ├── 분석 시작 버튼
│   ├── 로딩 애니메이션 (단계별 메시지)
│   ├── 인사이트 카드 목록 (5~6개)
│   ├── 비즈니스 전용 카드 (블러 + 업셀)
│   └── PDF 다운로드 버튼
│
└── analysisLevel === 'advanced' → AnalysisRunner (비즈니스 분석)
    ├── (프로와 동일 UI 구조)
    ├── 인사이트 카드 목록 (10~15개, 전체 언락)
    └── 상세 PDF 다운로드 버튼
```

---

## 6) 베이직 프리뷰 화면 상세

### 업그레이드 유도 전략 (핵심)

**원칙:** 단순 잠금 ❌ → 자기 실제 데이터를 보여주되, "나머지는 프로에서만" 으로 갈증 유발 ✅

**섹션 1 — 내 데이터 요약 (실제 숫자, 잠금 없음)**
- 📨 지난 30일 캠페인 N건
- 📤 총 발송 N건
- ✅ 평균 성공률 N%
- 👥 전체 고객 N명
- → "이만큼의 데이터가 있으니 분석할 게 많다" 인식

**섹션 2 — 프로에서 확인 가능 (블러 + 🔒)**
- 최적 발송 시간대 ████
- 최고 성과 요일 ████
- TOP 캠페인 ██████████
- 수신거부 추이 ██████████
- 월간 성과 리포트 ██████████
- AI 분석 예시 텍스트 3줄 + 그라데이션 페이드아웃:
  > "지난달 대비 성공률이 +3.2% 개선되었습니다. 화요일 오전 10시 발송이 가장 효과적이며..."
  > (페이드아웃)

**섹션 3 — 비즈니스에서 추가 제공 (더 강한 블러)**
- 🎯 고객 세그먼트 자동 분류
- ⚠️ 이탈 위험 고객 탐지 + 재활성화 제안
- 💰 캠페인별 ROI 추정
- 📋 맞춤 액션 플랜
- 📄 상세 PDF 보고서 (5~10p)

**섹션 4 — CTA**
- 👑 아이콘 + "프로 요금제로 업그레이드"
- "월 100만원으로 AI가 분석하는 마케팅 인사이트"
- [요금제 안내 보기] [업그레이드 신청] 버튼

---

## 7) 세션 진행 현황

### 세션 1: DDL + 백엔드 API
**상태:** ✅ 완료 (배포 완료)

**체크리스트:**
- [x] DDL 실행 (plans.ai_analysis_level) — plan_code 대문자 주의
- [x] companies.ts my-plan API에 ai_analysis_level 반환 추가
- [x] routes/analysis.ts 신규 생성
- [x] GET /api/analysis/preview 구현 (none: 기본4개만, basic/advanced: 전체 11개)
- [x] POST /api/analysis/run 구현 (요금제 체크 + 데이터 수집 11종 쿼리, Claude 호출은 세션3)
- [x] GET /api/analysis/pdf 구현 (요금제 체크 + 501 뼈대, PDF 생성은 세션3)
- [x] app.ts에 analysis 라우트 등록
- [x] TypeScript 타입 체크 통과 + 배포 완료

**수정 파일:** companies.ts, app.ts
**신규 파일:** analysis.ts

---

### 세션 2: 프론트엔드 AnalysisModal + 연결
**상태:** ✅ 완료 (타입체크+배포 완료)

**체크리스트:**
- [x] DashboardHeader.tsx에 Sparkles 아이콘 + AI 분석 버튼 + onAnalysis prop
- [x] Dashboard.tsx에 showAnalysis state + AnalysisModal import + 렌더링
- [x] AnalysisModal.tsx 신규 생성 (530줄)
  - [x] 베이직 프리뷰 화면 (실제 데이터 4카드 + 블러 + 페이드아웃 + CTA)
  - [x] 프로 분석 화면 (기간 선택 + 분석 실행 + 인사이트 카드 + PDF)
  - [x] 비즈니스 분석 화면 (프로 + 추가 카드 전체 언락)
  - [x] 비즈니스 전용 카드 블러 (프로 사용자용 업셀)
- [x] 로딩 애니메이션 (4단계 메시지 + 도트 펄스)
- [x] 모달 디자인: animate-in, fade-up, dark 헤더, max-w-[900px], 카테고리별 색상 10종
- [x] TypeScript 타입 체크 통과 + 배포 완료

**수정 파일:** DashboardHeader.tsx, Dashboard.tsx
**신규 파일:** AnalysisModal.tsx

---

### 세션 3: AI 프롬프트 정교화 + 캐싱 + PDF
**상태:** ✅ 완료 (타입체크+배포 완료)

**체크리스트:**
- [x] analysis_results 캐싱 테이블 DDL (UNIQUE + 인덱스)
- [x] 프로용 프롬프트 (집계값 기반, 1회 호출, 인사이트 6개)
- [x] 비즈니스용 멀티턴 프롬프트 (3회 호출, 인사이트 11개)
- [x] Claude 호출 로직 (claude-sonnet-4, 재시도 2회, temperature 0.3)
- [x] 캐시 체크/UPSERT (24시간 유효, forceRefresh 지원)
- [x] PDF 생성 (pdfkit, malgun.ttf, 커버+목차+인사이트+푸터)
- [x] PDF 카테고리별 색상 8종 + 자동 페이지 넘김
- [x] TypeScript 타입 체크 통과 + 배포 완료

**수정 파일:** analysis.ts (524줄→1,121줄)
**신규 DDL:** analysis_results 테이블

---

### 세션 4: 데모 데이터 + 통합 테스트
**상태:** ✅ 완료

**체크리스트:**
- [x] 유호윤 고객사(a0990249) 기존 데이터 정리 + 요금제 ai_analysis_level='basic' 변경
- [x] 고객 300,000명 INSERT (화장품/뷰티, 등급 5단계 VVIP/VIP/GOLD/SILVER/BRONZE, 매장 15개)
- [x] 캠페인 500건 + campaign_runs 500건 (최근 90일, SMS/LMS/MMS, 성공률 88~99%)
- [x] 구매 50,000건 (화장품 30종, row_number JOIN 최적화)
- [x] 수신거부 3,000건 (90일 분산, 4가지 경로)
- [x] 전체 플로우 테스트 확인 완료

**실행 SQL:** demo_data_v2.sql (서버 직접 실행)

---

## 8) DECISION LOG

| ID | 날짜 | 결정 | 근거 |
|----|------|------|------|
| A1 | 02-25 | AI 분석을 탑메뉴(DashboardHeader) 버튼으로 배치, 대시보드 내부에 넣지 않음 | 대시보드 4,964줄 추가 부담 방지. 분석은 "주기적 리포팅" 성격 → 탑메뉴가 UX상 자연스러움 |
| A2 | 02-25 | 베이직에 단순 잠금이 아닌 실제 데이터 티저 + 블러 프리뷰 제공 | 업그레이드 욕구 자극. "내 데이터로 이런 분석이 가능하다"를 체감시킴 |
| A3 | 02-25 | analysis.ts 별도 라우트 파일 분리 (ai.ts에 합치지 않음) | ai.ts 이미 1,300줄+. SRP 준수. 간결하게 유지 |
| A4 | 02-25 | 프로 사용자에게도 비즈니스 카드 블러 표시 (동일한 업셀 전략) | 프로→비즈니스 업그레이드 유도. 단계적 요금제 상승 동기 |
| A5 | 02-25 | 분석 항목은 AI 프롬프트 수정만으로 업데이트 가능한 구조 | 코드 수정 없이 분석 관점 추가/변경. 추후 상황 봐서 업데이트 |
| A6 | 02-25 | 3~4세션 분할, AI-ANALYSIS.md로 세션간 컨텍스트 유지 | 새 채팅에서도 이 파일만 읽으면 바로 이어갈 수 있음 |
| A7 | 02-25 | preview API none일 때 백엔드에서 상세 필드 제거 반환 (프론트 블러만 X) | DevTools 노출 방지.
| A8 | 02-25 | AI 분석 아이콘으로 Sparkles(lucide-react) 선택, 메뉴 위치는 발송결과↔수신거부 사이 | AI/매직 느낌 + 기존 텍스트 메뉴와 차별화. gold+emphasized로 프리미엄 느낌 | 보안 우선 |
| A9 | 02-25 | PDF 라이브러리 pdfkit 선택 (puppeteer 아님) | billing.ts와 동일 패턴(malgun.ttf). Chromium 의존성 없음 |
| A10 | 02-25 | 분석 결과 DB 캐싱 (analysis_results, 24시간 유효, forceRefresh 지원) | 동일 기간 재요청 시 Claude API 비용 절약. UPSERT로 중복 방지 |
| A11 | 02-25 | 비즈니스 멀티턴 5~8회→3회 최적화 (캠페인/고객/전략 종합) | 3회로 인사이트 11개 충분. 토큰 효율+응답 속도 개선 |
| A12 | 02-25 | 데모 데이터 구매 INSERT LATERAL OFFSET→row_number JOIN 최적화 | OFFSET이 30만행 매번 스캔하여 서버 과부하. equijoin으로 O(N) 해결 |

---

## 9) 참고: 데이터 소스 매핑

| 분석 항목 | PostgreSQL 테이블 | 쿼리 방식 |
|----------|------------------|----------|
| 캠페인 수/발송수/성공률 | campaigns + campaign_runs | 기간 필터 + JOIN 집계 |
| 채널별 비교 | campaign_runs.message_type | GROUP BY message_type |
| 요일/시간대 패턴 | campaign_runs.sent_at | EXTRACT(dow/hour) + 성공률 |
| 고객 분포 (성별/등급/지역) | customers | GROUP BY gender/grade/region |
| 수신거부 추이 | unsubscribes | 월별 COUNT + created_at |
| 이탈 위험 | customers + purchases | last_purchase_date vs NOW() |
| 세그먼트 (RFM) | customers + purchases | Recency/Frequency/Monetary 계산 |
| 구매 전환 | campaigns + purchases | 발송 후 7일 내 purchase 매칭 |
| TOP 캠페인 | campaign_runs | 성공률 ORDER BY DESC LIMIT |

---

## 10) 파일 구조 요약

```
packages/backend/src/routes/
├── analysis.ts          ← 신규 (API 3개: preview, run, pdf)
├── ai.ts               ← 기존 유지 (타겟추천, 메시지생성 등)
├── campaigns.ts         ← 기존 유지
├── companies.ts         ← 수정 (my-plan에 ai_analysis_level 추가)
└── ...

packages/frontend/src/components/
├── AnalysisModal.tsx    ← 신규 (메인 분석 모달)
├── DashboardHeader.tsx  ← 수정 (📊 버튼 추가)
├── Dashboard.tsx        ← 수정 (showAnalysis state + 모달 렌더링)
└── ...
```
