# AI 맞춤한줄 — 작업 레퍼런스

> **관련 문서:** STATUS.md | SCHEMA.md | OPS.md
> **최종 업데이트:** 2026-02-22

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
         └── Step 4: 최종 문안 생성 → 발송 확정
```

### Step 1 — 개인화 필드 선택
- 고객사 DB 필드 목록 로드 (enabled_fields + customer_field_definitions)
- 체크박스로 이번 발송에 활용할 필드 선택
- 예: ☑ 이름 ☑ 등급 ☑ 매장명 ☐ 구매금액 ☐ 생일

### Step 2 — 프로모션 브리핑 + 옵션
- 자연어 브리핑 textarea (예시 placeholder 제공)
- 마케터가 회의에서 브리핑하듯 자연스럽게 작성
- URL 입력 (바로가기 ▶ 위치에 자동 배치)
- 톤/분위기 선택 (드롭다운: 친근한/격식있는/유머러스한/긴급한 등)

### Step 3 — AI 파싱 → 프로모션 카드
- API 호출: POST /api/ai/parse-briefing
- 브리핑 텍스트 → 구조화된 프로모션 정보 (카드)
- 카드 항목: 프로모션명, 혜택/할인, 조건, 기간, 대상, 기타
- 마케터가 카드 내용 직접 수정 가능 → 확인 후 다음

### Step 4 — 최종 문안 생성 + 발송 확정
- API 호출: POST /api/ai/generate-custom
- 개인화 필드 + 프로모션 카드 + 옵션 → AI 문안 3시안 (A/B/C)
- SMS/LMS 바이트 제한 고려
- 시안 선택 → 기존 AiCampaignSendModal로 발송 확정

---

## 4) 파일 구조

```
packages/frontend/src/
├── components/
│   ├── AiSendTypeModal.tsx          ✅ 완료 (분기 모달)
│   ├── AiCustomSendFlow.tsx         ⬜ 미착수 (AI 맞춤한줄 스텝 위자드)
│   └── AiCampaignSendModal.tsx      기존 (최종 발송 확정, 공용 재활용)
├── pages/
│   └── DashboardPage.tsx            ✅ 수정 완료 (textarea 제거 + 분기 연결)

packages/backend/src/
├── routes/
│   └── ai.ts                        ⬜ 미착수 (parse-briefing + generate-custom 추가)
```

---

## 5) 백엔드 API 설계

### POST /api/ai/parse-briefing (신규)
프로모션 브리핑 자연어 → 구조화 파싱

```typescript
// Request
{
  briefing: string;       // 마케터 브리핑 텍스트
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
  }
}
```

### POST /api/ai/generate-custom (신규)
개인화 필드 + 프로모션 카드 + 옵션 → 맞춤 문안 생성

```typescript
// Request
{
  briefing: string;             // 원본 브리핑
  promotionCard: object;        // 파싱 후 수정된 카드
  personalFields: string[];     // 선택된 개인화 필드 (예: ["name", "grade", "store_name"])
  url?: string;                 // 바로가기 URL
  tone: string;                 // 톤 (친근한/격식있는/유머러스한/긴급한)
  brandName: string;
  channel: string;              // SMS/LMS/MMS
  isAd: boolean;
}

// Response
{
  variants: [
    {
      variant_id: string;
      variant_name: string;     // "A안", "B안", "C안"
      concept: string;          // 컨셉 설명
      message_text: string;     // 완성 문안 (개인화 변수 포함: &이름&, &등급& 등)
      subject?: string;         // LMS 제목
      score: number;
    }
  ],
  recommendation: string;       // 추천 variant_id
}
```

---

## 6) 구현 진행 상황

| # | 작업 | 상태 | 비고 |
|---|------|------|------|
| ① | AiSendTypeModal.tsx (분기 모달) | ✅ 완료 | 대시보드 카드 스타일 톤 |
| ② | DashboardPage.tsx 수정 (textarea 제거 + 분기 연결) | ✅ 완료 | 5곳 수정 |
| ③ | 로컬 테스트 + 서버 배포 | ⬜ 대기 | git push → 서버 빌드 |
| ④ | AiCustomSendFlow.tsx Step 1~2 (필드선택 + 브리핑) | ⬜ 미착수 | 다음 세션 |
| ⑤ | 백엔드 POST /api/ai/parse-briefing | ⬜ 미착수 | |
| ⑥ | AiCustomSendFlow.tsx Step 3 (프로모션 카드) | ⬜ 미착수 | |
| ⑦ | 백엔드 POST /api/ai/generate-custom | ⬜ 미착수 | |
| ⑧ | AiCustomSendFlow.tsx Step 4 (문안 생성 + 발송) | ⬜ 미착수 | |
| ⑨ | AiCampaignSendModal 연결 + 전체 통합 테스트 | ⬜ 미착수 | |

---

## 7) 핵심 설계 결정

| ID | 결정 | 근거 |
|----|------|------|
| D1 | AI 발송 2분기: "AI 한줄로" + "AI 맞춤한줄" | 대시보드 3메뉴 유지, AI추천발송에서 분기. 메뉴 4개 확장보다 진입 후 선택이 자연스러움 |
| D2 | 프로모션 입력 = 브리핑 방식 (자연어 → AI 파싱 → 카드 확인) | 폼은 번거롭고 자유텍스트는 부정확. 말하듯이 쓰면 AI가 구조화 |
| D3 | 개인화 필드 = DB 필드 체크박스 선택 | AI에게 명확한 지시 가능, 어떤 데이터를 활용하는지 가시적 |
| D4 | 대시보드 textarea 제거 → 분기 모달 내에서 각각 입력 | 각 플로우가 독립적으로 자기 맥락에 맞는 입력창을 가짐 |
| D5 | 신규 코드는 별도 컴포넌트로 분리 (대시보드 최소 수정) | 대시보드 7,800줄 → 추가하면 만줄. 회귀 리스크 최소화 |

---

## 8) 연동 참고

### 고객사 필드 로드 (Step 1용)
- `GET /api/companies/:id/fields` 또는 기존 enabled_fields + customer_field_definitions 조합
- DashboardPage에 이미 `loadEnabledFields()` 함수 존재 → 참고/재활용

### 기존 AI API 연동 (참고)
- `POST /api/ai/recommend-target` — AI 한줄로에서 타겟 추천
- `POST /api/ai/generate-message` — AI 한줄로에서 문안 생성
- 위 두 개는 AI 한줄로 전용, AI 맞춤한줄은 parse-briefing + generate-custom 신규 API 사용

### 발송 확정 (Step 4 → AiCampaignSendModal)
- 기존 AiCampaignSendModal은 props로 메시지/채널/타겟 정보 받아서 발송 확정
- AI 맞춤한줄에서도 동일한 모달 재활용 가능
- 단, 타겟 추출 방식이 다름 (AI 한줄로: AI 추천 필터 / AI 맞춤한줄: 별도 타겟 선택 필요 → 추후 설계)

---

## 9) Phase 2 (이후 작업)
- 브리핑 히스토리 저장 (DB)
- 브리핑 템플릿화 (자주 쓰는 프로모션 유형)
- 등급별 자동 분기 발송 (VIP/골드/실버 각각 다른 문안)
- 브리핑 AI 자동완성/제안
