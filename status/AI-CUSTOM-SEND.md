# AI 맞춤한줄 — 작업 레퍼런스

> **관련 문서:** STATUS.md | SCHEMA.md | OPS.md
> **최종 업데이트:** 2026-02-22 (Step 1~4 완료 + 타겟 파싱 + 발송 확정 설계)

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
         ├── Step 2: 프로모션 브리핑 + 옵션 (타겟 포함 유도)
         ├── Step 3: AI 파싱 → 프로모션 카드 + 타겟 조건 카드 확인/수정
         ├── Step 4: 최종 문안 생성 (핸드폰 3열)
         └── 발송 확정 → AiCustomSendConfirmModal
              ├── 타겟 조건 → DB 필터 변환 → 대상자 수 조회 (수신거부 제거)
              ├── 회신번호 선택 (단일 / 매장별 자동배정)
              ├── 예약시간 (즉시 / 날짜시간)
              └── 최종 발송 확정 → campaigns.ts 발송 로직 연결
```

### Step 1 — 개인화 필드 선택 ✅
- `/api/customers/enabled-fields` 호출하여 필드 로드
- PERSONALIZATION_FIELDS 화이트리스트 필터링 (시스템 필드 제외)
- 카테고리별 그룹화 (기본정보, 구매정보, 지역정보, 등급/포인트, 날짜정보)
- 체크박스 UI, 선택 요약 표시

### Step 2 — 프로모션 브리핑 + 옵션 ✅
- 자연어 브리핑 textarea (최소 10자, 타겟 포함 유도 placeholder)
- **"발송 대상도 함께 적으면 AI가 타겟까지 자동 분석합니다" 안내**
- URL 입력 (선택, 바로가기 ▶ 자동 배치)
- 톤/분위기 선택 (friendly/formal/humorous/urgent/premium/casual)
- 채널 선택 (SMS 90바이트 / LMS 2000바이트)
- 선택 요약 카드 표시

### Step 3 — AI 파싱 → 프로모션 카드 + 타겟 조건 카드 ✅
- API: POST /api/ai/parse-briefing
- **2열 grid 배치:** 프로모션 카드(보라) + 타겟 조건 카드(파랑)
- 프로모션 카드 항목: 프로모션명, 혜택/할인, 조건, 기간, 대상, 쿠폰코드, 기타
- 타겟 조건 카드 항목: 성별, 등급, 연령대, 지역, 구매기간, 매장/브랜드, 최소구매금액, 기타
- 타겟 조건이 없으면 "전체 고객 대상" 표시 + "타겟 조건 직접 추가" 링크
- 각 카드 수정 모드 토글 (직접 편집 가능)
- 원본 브리핑 접기/펼치기
- 모달 너비 820px로 확장 (2열 여유)

### Step 4 — 최종 문안 생성 ✅
- API: POST /api/ai/generate-custom
- 핸드폰 모양 3개 가로 배치 (기존 AI 한줄로 UI 패턴 동일)
- 광고문구 + 수신거부 자동 포함 (wrapAdText)
- 개인화 변수 → 샘플값 치환 미리보기 (김민수, VIP, 강남점 등)
- 수정 버튼 + 편집 모드 지원
- LMS 제목 별도 표시
- **"발송 확정" 클릭 → AiCustomSendConfirmModal 진입**

---

## 4) 파일 구조

```
packages/frontend/src/
├── components/
│   ├── AiSendTypeModal.tsx          ✅ 완료 (분기 모달)
│   ├── AiCustomSendFlow.tsx         ✅ 완료 (4-step 위자드 + 타겟 카드 2열)
│   ├── AiCustomSendConfirmModal.tsx  ⬜ 미착수 (발송 확정: 타겟조회 + 회신번호 + 예약 + 확정)
│   └── AiCampaignSendModal.tsx      기존 (AI 한줄로 전용, 참고용)
├── pages/
│   └── DashboardPage.tsx            ✅ 수정 완료 (textarea 제거 + 분기 연결)

packages/backend/src/
├── routes/
│   └── ai.ts                        ✅ 수정 완료 (parse-briefing + generate-custom + 코드정리)
├── services/
│   └── ai.ts                        ✅ 수정 완료 (parseBriefing 타겟파싱 + generateCustomMessages)
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
  targetCondition: {
    description: string;   // 요약 (예: "3개월 내 구매한 VIP 여성 고객")
    gender: string;        // 성별 (예: "여성")
    grade: string;         // 등급 (예: "VIP")
    ageRange: string;      // 연령대 (예: "30~40대")
    region: string;        // 지역 (예: "서울")
    purchasePeriod: string; // 구매기간 (예: "최근 3개월")
    storeName: string;     // 매장 (예: "강남점")
    minPurchaseAmount: string; // 최소구매 (예: "50000")
    extra: string;         // 기타
  }
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
- **parseBriefing()**: Claude claude-sonnet-4-20250514, temp 0.3, 브리핑에서 명시된 정보만 추출 (날조 금지), 프로모션 + 타겟 조건 동시 파싱
  - TargetCondition 인터페이스 + EMPTY_TARGET_CONDITION 상수 export
  - 브리핑에 타겟 정보 없으면 모든 필드 빈 문자열 (= 전체 고객)
  - 모든 반환 경로(성공/폴백/에러)에서 targetCondition 안전 반환
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
| ③ | AiCustomSendFlow.tsx Step 1~4 (전체 UI) | ✅ 완료 | 타겟 카드 2열 포함, 배포 완료 |
| ④ | 백엔드 POST /api/ai/parse-briefing | ✅ 완료 | 프로모션 + 타겟 조건 동시 파싱 |
| ⑤ | 백엔드 POST /api/ai/generate-custom | ✅ 완료 | services/ai.ts + routes/ai.ts |
| ⑥ | routes/ai.ts 코드 정리 | ✅ 완료 | 들여쓰기 + business_type 수정 |
| ⑦ | 서버 배포 + 실제 테스트 | ✅ 완료 | Step 1→2→3→4 정상 동작 확인 |
| ⑧ | **백엔드 POST /api/ai/resolve-target** | ⬜ 미착수 | 타겟 조건 → DB 필터 변환 + 대상자 수 |
| ⑨ | **AiCustomSendConfirmModal.tsx** | ⬜ 미착수 | 발송 확정 모달 (아래 설계 참고) |
| ⑩ | **발송 로직 연결 (campaigns.ts)** | ⬜ 미착수 | ⑧⑨ 완료 후 |
| ⑪ | 전체 통합 테스트 (실제 발송) | ⬜ 미착수 | ⑩ 완료 후 |

---

## 7) 🔜 다음 세션 작업 — 발송 확정 플로우

### 7-1. 백엔드: POST /api/ai/resolve-target
타겟 조건 카드(자연어 값) → DB 필터 SQL 변환 → 대상자 수 조회

```typescript
// Request
{
  targetCondition: TargetCondition;  // Step 3에서 확정된 타겟 조건
}

// Response
{
  targetCount: number;    // 수신거부 제외 최종 대상자 수
  filterSummary: string;  // "VIP 등급 여성 고객, 최근 3개월 내 구매자" 등 요약
  filterSpec: object;     // campaigns에 저장할 필터 객체
}
```

**처리 로직:**
- targetCondition의 각 필드 → customers 테이블 WHERE 조건 변환
- gender: normalize 처리 (여성 → ['F','f','여','여성'...])
- grade: normalize 처리
- purchasePeriod: "최근 3개월" → recent_purchase_date >= NOW() - 3months
- + sms_opt_in = true, is_active = true
- + LEFT JOIN unsubscribes로 수신거부 제거
- 전체 필드 빈 값이면 전체 고객 (필터 없음)

### 7-2. 프론트: AiCustomSendConfirmModal.tsx
Step 4 "발송 확정" 클릭 시 오픈되는 모달

```
┌─────────────────────────────────────┐
│  📤 발송 확정                    ✕  │
├─────────────────────────────────────┤
│                                     │
│  📊 발송 대상                       │
│  ┌────────────────────────────────┐ │
│  │ VIP 등급 여성 고객 (3개월 내)  │ │
│  │ 대상자: 1,234명               │ │
│  └────────────────────────────────┘ │
│                                     │
│  📞 회신번호                        │
│  ○ 단일 회신번호  ○ 매장별 자동배정 │
│  ┌─ [02-1234-5678 (본사대표) ▼] ─┐ │
│  │ 또는                          │ │
│  │ 고객별 매장 회신번호 자동 배정  │ │
│  │ 미등록 매장 → 기본번호 폴백   │ │
│  └────────────────────────────────┘ │
│                                     │
│  ⏰ 발송 시간                       │
│  ○ 즉시 발송  ○ 예약 발송          │
│  [2026-02-23  14:00 ▼]             │
│                                     │
│  ┌────────────────────────────────┐ │
│  │ 📋 최종 요약                   │ │
│  │ 채널: LMS | 문안: A안         │ │
│  │ 대상: 1,234명 | 예상비용: ₩xxx │ │
│  └────────────────────────────────┘ │
│                                     │
│        [ 취소 ]  [ 🚀 발송 확정 ]   │
└─────────────────────────────────────┘
```

**회신번호 2모드:**
| 모드 | 동작 |
|------|------|
| 단일 회신번호 | 드롭다운에서 하나 선택 → 전체 수신자에게 해당 번호로 발송 |
| 매장별 자동배정 | 고객 store_code → callback_numbers.store_code 매칭 → 매장 번호로 발송. 미등록 매장은 기본 회신번호로 폴백 |

### 7-3. 발송 연결
- AiCustomSendConfirmModal에서 최종 확정 → campaigns.ts 기존 발송 로직 활용
- campaign 생성 → campaign_run 생성 → MySQL 큐 INSERT → QTmsg Agent 발송
- 개인화 변수 merge는 발송 시점에 고객별 치환
- 매장별 회신번호는 callback_numbers.store_code 조회하여 고객별 call_back 설정

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
| D7 | 브리핑에서 타겟 조건도 함께 AI 파싱 (프로모션 + 타겟 동시 추출) | 타겟 별도 선택이면 직접타겟발송과 차별점 없음. 브리핑 하나로 모두 처리가 핵심 |
| D8 | Step 3에 프로모션 카드 + 타겟 카드 2열 배치 | 한 화면에서 프로모션과 타겟 모두 확인/수정 가능 |
| D9 | 회신번호는 발송 확정 모달에서 선택 (단일/매장별 2모드) | Step 1~4 UI를 깔끔하게 유지. 매장별 = callback_numbers.store_code 매칭 |

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

### 발송 확정 (Step 4 → AiCustomSendConfirmModal) — ⬜ 다음 세션
- 기존 AiCampaignSendModal은 AI 한줄로 전용 (재활용 X, 별도 모달 신규 생성)
- AiCustomSendConfirmModal: 타겟 조회 + 회신번호 + 예약 + 발송 확정
- resolve-target API로 대상자 수 조회 후 표시
- 회신번호 단일/매장별 모드
- campaigns.ts 기존 발송 로직 연결

---

## 10) Phase 2 (이후 작업)
- 브리핑 히스토리 저장 (DB)
- 브리핑 템플릿화 (자주 쓰는 프로모션 유형)
- 등급별 자동 분기 발송 (VIP/골드/실버 각각 다른 문안)
- 브리핑 AI 자동완성/제안
