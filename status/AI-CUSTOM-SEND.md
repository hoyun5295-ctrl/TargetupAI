# AI 맞춤한줄 — 작업 레퍼런스

> **관련 문서:** STATUS.md | SCHEMA.md | OPS.md
> **최종 업데이트:** 2026-02-22 (전체 플로우 완성 — Step 1~4 + 발송확정 + targetFilters 구조화. 실제 발송 테스트 남음)

---

## 1) 개요

- **기능명:** AI 맞춤한줄
- **목적:** 프로모션 브리핑 → AI가 개인화 1:1 맞춤 문안 생성
- **대비:** 기존 "AI 한줄로"는 자연어 한 줄 → 타겟+문안 자동설계 (변경 없음)
- **진입:** 대시보드 "AI 추천 발송" 버튼 → AiSendTypeModal에서 분기

---

## 2) 네이밍 (확정)

| 기능명 | 설명 |
|--------|------|
| **AI 한줄로** | 기존 AI 추천발송. 자연어 한 줄 → 타겟 선정 + 문안 자동설계 |
| **AI 맞춤한줄** | 개인화 필드 선택 + 프로모션 브리핑 → AI가 고객별 1:1 맞춤 문안 생성 |

---

## 3) 플로우 설계

```
[대시보드] AI 추천 발송 클릭
  → AiSendTypeModal (분기 모달)
    ├── 🚀 AI 한줄로 → 프롬프트 입력 → 기존 플로우 (handleAiCampaignGenerate)
    └── ✨ AI 맞춤한줄 → AiCustomSendFlow (스텝 위자드)
         ├── Step 1: 개인화 필드 선택
         ├── Step 2: 프로모션 브리핑 + 옵션
         ├── Step 3: AI 파싱 → 프로모션 카드 확인/수정
         └── Step 4: 최종 문안 생성 → 발송 확정 (⬜ 타겟 선택 + 발송 연결 미완)
```

### Step 1 — 개인화 필드 선택 ✅
- `/api/customers/enabled-fields` 호출하여 필드 로드
- PERSONALIZATION_FIELDS 화이트리스트 필터링 (시스템 필드 제외)
- 카테고리별 그룹화 (기본정보, 구매정보, 지역정보, 등급/포인트, 날짜정보)
- 체크박스 UI, 선택 요약 표시

### Step 2 — 프로모션 브리핑 + 옵션 ✅
- 자연어 브리핑 textarea (최소 10자, 예시 placeholder)
- URL 입력 (선택, 바로가기 ▶ 자동 배치)
- 톤/분위기 선택 (friendly/formal/humorous/urgent/premium/casual)
- 채널 선택 (SMS 90바이트 / LMS 2000바이트)
- 선택 요약 카드 표시

### Step 3 — AI 파싱 → 프로모션 카드 ✅
- API: POST /api/ai/parse-briefing
- 카드 항목: 프로모션명, 혜택/할인, 조건, 기간, 대상, 쿠폰코드, 기타
- 수정 모드 토글 (직접 편집 가능)
- 원본 브리핑 접기/펼치기
- **targetFilters 구조화 필터 반환** (recommend-target과 동일 형식)
- **대상 고객 수 + 수신거부 수 실시간 표시**

### Step 4 — 최종 문안 생성 ✅ (발송 확정 연결 완료)
- API: POST /api/ai/generate-custom
- 핸드폰 모양 3개 가로 배치 (기존 AI 한줄로 UI 패턴 동일)
- 광고문구 + 수신거부 자동 포함 (wrapAdText)
- 개인화 변수 → 샘플값 치환 미리보기 (김민수, VIP, 강남점 등)
- 수정 버튼 + 편집 모드 지원
- LMS 제목 별도 표시
- **발송 확정(N명) 버튼 → onConfirmSend → AiCampaignSendModal 재활용**
- **handleAiCustomSend → campaignsApi.create + send (targetFilters 기반)**

---

## 4) 파일 구조

```
packages/frontend/src/
├── components/
│   ├── AiSendTypeModal.tsx          ✅ 완료 (분기 모달)
│   ├── AiCustomSendFlow.tsx         ✅ 완료 (4-step 위자드, 핸드폰 UI, 발송확정 연결)
│   └── AiCampaignSendModal.tsx      ✅ 재활용 (AI 한줄로 + AI 맞춤한줄 공용)
├── pages/
│   └── DashboardPage.tsx            ✅ 수정 완료 (분기 연결 + onConfirmSend + handleAiCustomSend + 회신번호 로딩)

packages/backend/src/
├── routes/
│   └── ai.ts                        ✅ 수정 완료 (buildFilterWhereClause 공용 + parse-briefing 고객수 산출)
├── services/
│   └── ai.ts                        ✅ 수정 완료 (parseBriefing → targetFilters 구조화 필터 반환)
```

---

## 5) 백엔드 API 설계

### POST /api/ai/parse-briefing ✅ 구현 완료
프로모션 브리핑 자연어 → 구조화 파싱

```typescript
// Request
{
  briefing: string;       // 마케터 브리핑 텍스트 (최소 10자)
}

// Response
{
  promotionCard: {
    name: string;          // 프로모션명 (예: "봄 신상품 20% 할인")
    benefit: string;       // 혜택 (예: "전 상품 20% 할인 + 무료배송")
    condition: string;     // 조건 (예: "5만원 이상 구매 시")
    period: string;        // 기간 (예: "3/1 ~ 3/15")
    target: string;        // 대상 (예: "VIP 등급 이상")
    couponCode?: string;   // 쿠폰코드 (있으면)
    extra?: string;        // 기타 정보
  },
  targetCondition: { ... },  // 자연어 요약 (화면 표시용)
  targetFilters: {           // 구조화 필터 (DB 쿼리용, recommend-target과 동일 형식)
    gender?: string;         // "M" | "F"
    grade?: { value: string[], operator: "in" };
    age?: [number, number];  // [min, max]
    region?: { value: string[], operator: "in" };
    recent_purchase_date?: { value: string, operator: "gte" };
    total_purchase_amount?: { value: number, operator: "gte" };
    store_name?: { value: string, operator: "eq" };
  },
  estimatedCount: number;    // 대상 고객 수
  unsubscribeCount: number;  // 수신거부 제외 수
}
```

### POST /api/ai/generate-custom ✅ 구현 완료
개인화 필드 + 프로모션 카드 + 옵션 → 맞춤 문안 생성

```typescript
// Request
{
  briefing: string;             // 원본 브리핑
  promotionCard: object;        // 파싱 후 수정된 카드
  personalFields: string[];     // 선택된 개인화 필드 (예: ["name", "grade", "store_name"])
  url?: string;                 // 바로가기 URL
  tone: string;                 // 톤 (friendly/formal/humorous/urgent/premium/casual)
  brandName: string;
  channel: string;              // SMS/LMS
  isAd: boolean;
}

// Response
{
  variants: [
    {
      variant_id: string;       // "A", "B", "C"
      variant_name: string;     // 컨셉명
      concept: string;          // 컨셉 상세 설명
      message_text: string;     // 완성 문안 (개인화 변수 포함: %이름%, %등급% 등)
      subject?: string;         // LMS 제목
      score: number;
    }
  ],
  recommendation: string;       // 추천 variant_id
}
```

### 백엔드 주요 구현 상세
- **parseBriefing()**: Claude claude-sonnet-4-20250514, temp 0.3, 브리핑에서 명시된 정보만 추출 (날조 금지)
  - promotionCard + targetCondition + **targetFilters** 3가지 동시 반환
  - targetFilters: recommend-target과 동일 형식 (gender/grade/age/region/recent_purchase_date 등)
  - user message에 오늘 날짜 포함 → "최근 3개월" 등 정확한 날짜 변환
- **routes/ai.ts parse-briefing**: targetFilters → buildFilterWhereClause → 고객 수 + 수신거부 수 산출
- **buildFilterWhereClause()**: recommend-target과 parse-briefing 공용 함수 (필터→SQL WHERE 절 변환)
  - normalize.ts의 buildGenderFilter, buildGradeFilter, buildRegionFilter 활용
- **generateCustomMessages()**: Claude claude-sonnet-4-20250514, temp 0.7
  - FIELD_TO_VAR 매핑: field_key → 한글 변수명 (name→이름, grade→등급 등)
  - TONE_MAP: tone → 한글 설명
  - getAvailableSmsBytes() 재사용 (광고/수신거부 바이트 차감)
  - validatePersonalizationVars() 재사용 (잘못된 변수 자동 제거)
  - 광고표기 자동 제거 (AI가 삽입한 (광고)/무료거부 등 strip)

---

## 6) 구현 진행 상황

| # | 작업 | 상태 | 비고 |
|---|------|------|------|
| ① | AiSendTypeModal.tsx (분기 모달) | ✅ 완료 | 배포 완료 |
| ② | DashboardPage.tsx 수정 (textarea 제거 + 분기 연결) | ✅ 완료 | 배포 완료 |
| ③ | AiCustomSendFlow.tsx Step 1~4 (전체 UI) | ✅ 완료 | 핸드폰 UI, 배포 완료 |
| ④ | 백엔드 POST /api/ai/parse-briefing | ✅ 완료 | targetFilters + estimatedCount 포함 |
| ⑤ | 백엔드 POST /api/ai/generate-custom | ✅ 완료 | services/ai.ts + routes/ai.ts |
| ⑥ | buildFilterWhereClause 공용 함수 추출 | ✅ 완료 | recommend-target + parse-briefing 공용 |
| ⑦ | 발송 확정 → AiCampaignSendModal 연결 | ✅ 완료 | onConfirmSend + handleAiCustomSend |
| ⑧ | AI 추천발송 진입 시 회신번호/080번호 로딩 | ✅ 완료 | 버튼 onClick에서 fetch |
| ⑨ | 서버 배포 | ✅ 완료 | |
| ⑩ | **전체 통합 테스트 (실제 발송)** | ⬜ 미착수 | 다음 세션 |

---

## 7) ✅ 해결 완료 — 타겟 선택 방식

### 결정: parseBriefing이 targetFilters(구조화 필터) 동시 반환
- 옵션 A 채택: parseBriefing이 promotionCard + targetCondition + **targetFilters** 3가지 동시 반환
- targetFilters는 recommend-target과 동일한 형식 (gender, grade, age, region, recent_purchase_date 등)
- buildFilterWhereClause 공용 함수로 recommend-target / parse-briefing 모두 동일 로직 사용
- AI가 처음부터 구조화 필터 생성 → 자연어→SQL 2단계 변환 제거로 정확도 확보
- 발송 확정 시 AiCampaignSendModal 재활용 (handleAiCustomSend → campaignsApi.create + send)

### 남은 작업
- [ ] 실제 발송 테스트 (문안 개인화 변수 치환 + 타겟 필터 정확도 검증)
- [ ] 타겟 필터 수동 편집 기능 (Step 3에서 타겟 카드 수정 시 estimatedCount 재계산)

---

## 8) 핵심 설계 결정

| ID | 결정 | 근거 |
|----|------|------|
| D1 | AI 발송 2분기: "AI 한줄로" + "AI 맞춤한줄" | 대시보드 3메뉴 유지, AI추천발송에서 분기. 메뉴 4개 확장보다 진입 후 선택이 자연스러움 |
| D2 | 프로모션 입력 = 브리핑 방식 (자연어 → AI 파싱 → 카드 확인) | 폼은 번거롭고 자유텍스트는 부정확. 말하듯이 쓰면 AI가 구조화 |
| D3 | 개인화 필드 = DB 필드 체크박스 선택 | AI에게 명확한 지시 가능, 어떤 데이터를 활용하는지 가시적 |
| D4 | 대시보드 textarea 제거 → 분기 모달 내에서 각각 입력 | 각 플로우가 독립적으로 자기 맥락에 맞는 입력창을 가짐 |
| D5 | 신규 코드는 별도 컴포넌트로 분리 (대시보드 최소 수정) | 대시보드 7,800줄 → 추가하면 만줄. 회귀 리스크 최소화 |
| D6 | Step 4 UI = 기존 핸드폰 모양 3열 패턴 재사용 | 일관된 UX, 광고/수신거부 wrapAdText 동일 적용 |
| D7 | parseBriefing → targetFilters 구조화 필터 동시 반환 | 자연어→SQL 2단계 변환 제거. buildFilterWhereClause 공용 함수로 정확도 확보 |
| D8 | AiCampaignSendModal 재활용 (AI 한줄로 + AI 맞춤한줄 공용) | 신규 모달 불필요. recommendedTime 빈값 → AI추천시간 옵션 자동 숨김 |

---

## 9) 연동 참고

### 고객사 필드 로드 (Step 1용) — ✅ 구현됨
- `GET /api/customers/enabled-fields` 사용
- PERSONALIZATION_FIELDS 화이트리스트로 필터링
- FIELD_CATEGORIES로 카테고리 그룹화

### 기존 AI API 연동 (참고)
- `POST /api/ai/recommend-target` — AI 한줄로에서 타겟 추천
- `POST /api/ai/generate-message` — AI 한줄로에서 문안 생성
- 위 두 개는 AI 한줄로 전용, AI 맞춤한줄은 parse-briefing + generate-custom 사용

### 발송 확정 (Step 4 → AiCampaignSendModal) — ✅ 연결 완료
- AiCustomSendFlow onConfirmSend → DashboardPage customSendData 저장 → showCustomSendModal 열기
- AiCampaignSendModal 재활용 (recommendedTime 빈값 → AI추천시간 옵션 자동 숨김)
- handleAiCustomSend → campaignsApi.create(targetFilter: targetFilters) + campaignsApi.send
- 성공 시 모달 닫기 + 성공 알림 + 캠페인 목록 새로고침

---

## 10) Phase 2 (이후 작업)
- 브리핑 히스토리 저장 (DB)
- 브리핑 템플릿화 (자주 쓰는 프로모션 유형)
- 등급별 자동 분기 발송 (VIP/골드/실버 각각 다른 문안)
- 브리핑 AI 자동완성/제안
