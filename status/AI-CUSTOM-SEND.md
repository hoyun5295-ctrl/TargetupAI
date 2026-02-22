# AI 맞춤한줄 — 작업 레퍼런스

> **관련 문서:** STATUS.md | SCHEMA.md | OPS.md
> **최종 업데이트:** 2026-02-22 (Step 1~4 UI + API 구현 완료, 배포 완료)

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

### Step 4 — 최종 문안 생성 ✅ (발송 확정 미연결)
- API: POST /api/ai/generate-custom
- 핸드폰 모양 3개 가로 배치 (기존 AI 한줄로 UI 패턴 동일)
- 광고문구 + 수신거부 자동 포함 (wrapAdText)
- 개인화 변수 → 샘플값 치환 미리보기 (김민수, VIP, 강남점 등)
- 수정 버튼 + 편집 모드 지원
- LMS 제목 별도 표시
- **⬜ 발송 확정 버튼 → 타겟 선택 + AiCampaignSendModal 연결 필요**

---

## 4) 파일 구조

```
packages/frontend/src/
├── components/
│   ├── AiSendTypeModal.tsx          ✅ 완료 (분기 모달)
│   ├── AiCustomSendFlow.tsx         ✅ 완료 (4-step 위자드, 핸드폰 UI)
│   └── AiCampaignSendModal.tsx      기존 (최종 발송 확정, 공용 재활용 예정)
├── pages/
│   └── DashboardPage.tsx            ✅ 수정 완료 (textarea 제거 + 분기 연결 + AiCustomSendFlow import)

packages/backend/src/
├── routes/
│   └── ai.ts                        ✅ 수정 완료 (parse-briefing + generate-custom 라우트 추가)
├── services/
│   └── ai.ts                        ✅ 수정 완료 (parseBriefing + generateCustomMessages 함수 추가)
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
- **parseBriefing()**: Claude claude-sonnet-4-20250514, temp 0.3, 브리핑에서 명시된 정보만 추출 (날조 금지)
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
| ④ | 백엔드 POST /api/ai/parse-briefing | ✅ 완료 | services/ai.ts + routes/ai.ts |
| ⑤ | 백엔드 POST /api/ai/generate-custom | ✅ 완료 | services/ai.ts + routes/ai.ts |
| ⑥ | 서버 배포 + 실제 테스트 | ✅ 완료 | Step 1→2→3→4 정상 동작 확인 |
| ⑦ | **발송 확정 → 타겟 선택 방식 결정** | ⬜ 미정 | 다음 세션 (아래 미해결 참고) |
| ⑧ | **AiCampaignSendModal 연결** | ⬜ 미착수 | ⑦ 결정 후 진행 |
| ⑨ | 전체 통합 테스트 (실제 발송) | ⬜ 미착수 | ⑧ 완료 후 |

---

## 7) ⚠️ 미해결 — 다음 세션 결정 필요

### 발송 확정 시 타겟 선택 방식
현재 "발송 확정" 버튼 → 임시 alert만 동작. 타겟 선택 방식 결정 필요.

| 옵션 | 설명 | 장단점 |
|------|------|--------|
| **A** | AiCampaignSendModal 재활용 + 타겟 선택 스텝 추가 | 기존 모달 재활용으로 빠른 구현, 타겟 UI 추가 필요 |
| **B** | "전체 고객" 또는 "조건 필터" 선택 화면 → 확정 | 심플하지만 필터 UI 신규 구현 필요 |
| **C** | Step 1~2 사이에 타겟 조건 입력 스텝 추가 (브리핑에서 AI가 타겟도 파싱) | AI 한줄로와 유사한 UX, 스텝 5단계로 증가 |

**핵심 차이점:** AI 한줄로는 AI가 타겟도 자동 추출, AI 맞춤한줄은 문안만 AI 생성 → 타겟을 어떻게 선택할지 결정 필요

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

### 발송 확정 (Step 4 → AiCampaignSendModal) — ⬜ 미연결
- 기존 AiCampaignSendModal은 props로 메시지/채널/타겟 정보 받아서 발송 확정
- AI 맞춤한줄에서도 동일한 모달 재활용 가능
- **핵심 미해결: 타겟 추출 방식** (AI 한줄로: AI 추천 필터 / AI 맞춤한줄: 별도 타겟 선택 필요)

---

## 10) Phase 2 (이후 작업)
- 브리핑 히스토리 저장 (DB)
- 브리핑 템플릿화 (자주 쓰는 프로모션 유형)
- 등급별 자동 분기 발송 (VIP/골드/실버 각각 다른 문안)
- 브리핑 AI 자동완성/제안
