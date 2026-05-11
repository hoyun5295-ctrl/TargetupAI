# AI 인라인 다듬기 설계서 (D152+)

> **배경:** D135~D150에서 알림톡/브랜드/RCS/자동발송/AI 프리미엄 등 핵심 기능 박혔으나 67사 무료체험(D144) 5일치 funnel = 고객DB 업로드 **2/67 (3%)**. AI 진입 절대 병목.
>
> **핵심 아이디어:** AI 가치(문안 생성)를 고객DB 없이 즉시 체감 가능한 동선 신설. 직접발송(이미 67사가 사용 중인 동선) 화면에서 "AI 다듬기" 버튼 → 톤/길이/이모지/스팸회피 적용된 다듬은 안 1개 자동 생성 → 클릭 적용 → 본문 반영.
>
> **요금제 게이팅:** BASIC(월 35만원) 이상 — Harold님 명시 (2026-05-12).

---

## 1. 요금제 매핑 (SQL 검증 2026-05-12)

| plan_code | plan_name | monthly_price | ai_messaging_enabled | AI 인라인 다듬기 |
|---|---|---:|:---:|:---:|
| FREE | 미가입 | 0 | f | ✗ |
| TRIAL | 무료체험 | 0 | t | ○ (**PRO 요금제와 기능 동일**, D143 정합 — BASIC 아님) |
| STARTER | 스타터 | 150,000 | f | ✗ |
| **BASIC** | **베이직** | **350,000** | **t** | **○ (게이팅 기준선)** |
| PRO | 프로 | 1,000,000 | t | ○ |
| BUSINESS | 비즈니스 | 3,000,000 | t | ○ |
| ENTERPRISE | 엔터프라이즈 | 5,500,000 | t | ○ |

→ 기존 `plans.ai_messaging_enabled` 플래그(BASIC+) 재활용. **컬럼 추가 마이그레이션 0건.**

---

## 2. Backend 설계

### 2-1. 새 라우트
`POST /api/ai/refine-message`
- 미들웨어: `requirePlanFeature('ai_messaging')` (CT-17 재활용)
- body: `{ message: string, tone?: 'friendly' | 'formal' | 'urgent' | 'warm', maxBytes?: number, companyName?: string }`
- response:
```ts
{
  candidates: Array<{
    text: string;
    bytes: number;
    type: 'SMS' | 'LMS';
  }>;
}
```

### 2-2. 새 함수 `services/ai.ts`
```ts
export async function refineDirectMessage(opts: {
  message: string;
  tone?: 'friendly' | 'formal' | 'urgent' | 'warm';
  maxBytes?: number;
  companyName?: string;
}): Promise<{
  candidates: Array<{ text: string; bytes: number; type: 'SMS' | 'LMS' }>;
}>;
```

시스템 프롬프트 핵심:
- 한국어 마케팅 메시지 다듬기 전용
- 톤 옵션별 표현 (친근/공식/긴급/따뜻함)
- SMS(90바이트) / LMS(2000바이트) 자동 분류
- 스팸 회피 (특수문자/이모지 적정 사용, KISA 키워드 차단)
- **변수 치환 자리 보존** (`%이름%`, `%등급%`, custom_1~15 등 그대로 유지)
- 다듬은 안 1개 반환 (가장 자연스럽고 효과적인 단일 안 — Harold님 D152 명시 단순화)
- Claude(Anthropic) 우선 + OpenAI 폴백 (기존 ai.ts 패턴 미러)

---

## 3. Frontend 설계

### 3-1. `DirectSendPanel.tsx` 변경
- 메시지 textarea 우상단에 **"AI 다듬기"** 버튼 추가
- 요금제 잠금 시 비활성 + tooltip: "베이직 요금제(35만원/월) 이상에서 이용 가능"
- 활성 시 클릭 → `AiRefineModal` 오픈

### 3-2. 새 컴포넌트 `AiRefineModal.tsx`
- 톤 선택 dropdown (친근/공식/긴급/따뜻함)
- "다듬기 시작" 버튼 → POST /api/ai/refine-message
- 결과 1개 카드 표시 (텍스트 + 바이트 + SMS/LMS 배지)
- 카드 클릭 → 본문 적용 + 모달 닫기

### 3-3. 요금제 잠금 안내
- `ai_messaging_enabled = false` 시 버튼 비활성 + tooltip
- 클릭 시 plans 페이지(요금제 안내) 이동 모달

---

## 4. UX 시나리오

```
직접발송 화면 → 메시지 작성 ("내일 신상품 입고됩니다!")
  → "AI 다듬기" 버튼 클릭
  → 톤 선택 (친근) → "다듬기 시작"
  → 2~3초 대기 (AI 호출 + 로딩 인디케이터)
  → 결과 5개 안 카드:
     [1] "내일 드디어 기다리시던 신상품이 입고됩니다! 매장에서 만나뵐게요" (62B, SMS)
     [2] "안녕하세요 %이름%님! 내일(5/13) 신상품 입고 안내드립니다 :)" (78B, SMS)
     [3] "내일 신상품 입고! 한정 수량으로 준비하니 서두르세요" (54B, SMS)
     [4] ...
  → 카드 [2] 클릭 → 본문에 자동 적용 + 모달 닫기
  → "발송" 진행
```

---

## 5. 구현 단계 (의존 순서)

1. **Backend** `services/ai.ts` `refineDirectMessage` 함수 신설
2. **Backend** `routes/ai.ts` `POST /refine-message` 라우트 + `requirePlanFeature('ai_messaging')` 미들웨어
3. **Frontend** `AiRefineModal.tsx` 신설
4. **Frontend** `DirectSendPanel.tsx` 버튼 추가 + 모달 연결
5. **Frontend** 요금제 잠금 분기 (user.plan_code 또는 user.features.ai_messaging_enabled 참조)

---

## 6. 검증 시나리오 (배포 후 직원 자연 검증 + funnel 재측정)

1. **TRIAL 회사** (현재 67사 모두) — 버튼 활성 + AI 안 생성 정상
2. **STARTER**(15만원) 회사 — 버튼 비활성 + 안내 tooltip
3. **BASIC**(35만원) 이상 회사 — 버튼 활성
4. **AI 호출 실패** 시 — 에러 토스트 + 본문 변경 없음
5. **변수 치환 자리 보존** — 입력 "안녕하세요 %이름%님" → 출력에도 %이름% 유지
6. **바이트 계산 정확성** — SMS(90B) 초과 시 LMS 분류 자동

---

## 7. funnel 재측정 (배포 1주일 후)

배포 1주일 후 67사 중:
- AI 다듬기 버튼 클릭 회사 수 (=** AI 가치 첫 체감 사용자**)
- 클릭 후 본문 적용 회사 수 (=** 실제 발송 채택**)
- 클릭 후 고객DB 업로드 진입 회사 수 (= **DB 업로드 동기 유발 성과**)

진단 SQL (배포 시 새 컬럼 또는 로그 기반 추적 필요 — 별건):
```sql
SELECT COUNT(DISTINCT company_id) AS refine_clicked
  FROM ai_refine_logs
 WHERE created_at >= '2026-05-12';
```

→ DB 업로드 funnel(3% → ?%) 변화로 본 fix의 진입 비용 단축 효과 확정.

---

## 8. 향후 확장 (별건)

- AI 메시지 생성 결과 클릭률/응답률 추적 → 다음 추천 학습 (AI TMS "실시간 대응력" 미러)
- 톤 자동 추천 (브랜드명 + 캠페인 컨텍스트 기반)
- A/B 테스트 자동화 (TMS AB insight 미러, SMS/카카오까지 확장)
- 다국어 (글로벌 진출 시)
- 행동 트리거 자동발송 (TMS 장바구니/결제 이탈 미러) — e-commerce 연동 SDK 필요

---

## 9. 메모리 컨텍스트

- `memory/project_d144_view_and_stats_fix.md` — 67사 무료체험 BULK grant-trial
- `memory/project_d150_3_auto_campaign_audit.md` — D150-3 (5/10) AI 0사 진단
- `memory/project_d145_ai_guide_popup.md` — D145 AI 활용 안내 팝업 + 가이드 페이지 (배포됐으나 효과 미진)
- `status/STATUS.md` D143 — ENTERPRISE 잠금 정책 + TRIAL=PRO 기능 동일
- `packages/backend/src/utils/plan-guard.ts` — CT-17 컨트롤타워

---

## 10. 핵심 차별점 vs 휴머스온 TMS

| 영역 | 휴머스온 TMS | 한줄로AI (본 fix 후) |
|---|---|---|
| AI 문안 생성 | **없음** (변수 치환 기반 다이나믹 콘텐츠만) | ✓ Claude/OpenAI 직접 다듬기 |
| 진입 비용 | 영업 인력 + 매니지드 서비스 (대기업 도입) | ✓ DB 없이 즉시 체험 |
| 행동 트리거 (장바구니/결제 이탈) | ✓ 30개 시나리오 템플릿 | 미보유 (별건, e-commerce 연동 필요) |
| 채널 자동 전환 (3단계) | ✓ 카카오 → SMS → 메일 | 미보유 (`CHANNEL-EXPANSION.md` 설계서만) |
| 통합 메시징 (이메일/푸시) | ✓ EMS/PMS 시장점유율 70%/90% | SMS+카카오+RCS만 (이메일/푸시 미보유) |

→ 본 fix는 한줄로AI의 **AI 차별점(TMS 없음)** 을 **진입 비용 0(SaaS 본질)** 에서 체감 가능하게 만드는 정답.
