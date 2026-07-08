# 행사 캠페인 — 이미지 입력 + 생성 초안 DB 보관 설계/구현 계획

작성 2026-07-08 · 상태: Harold 동의 대기 (구현 전)

## 배경 (Harold 요청 2건)

1. **이미지로 행사 내용 입력** — 지금은 "행사 캠페인 자동 생성" 모달에 행사 내용을 텍스트로 붙여넣어야 DM·이메일·인앱 초안이 나온다. 여기에 **이미지 업로드**를 추가해, 스샷(상품 목록 등)을 올리면 AI가 그 안의 내용을 읽어 텍스트로 붙여넣은 것과 동일하게 생성한다. 이미지는 텍스트 입력을 **대체**한다.
2. **생성 초안 소멸 방지** — 3채널을 한 번에 생성한 뒤 하나를 편집하면 나머지 2채널이 어디에도 저장되지 않고 소멸한다. 편집은 하나씩만 하므로, 나머지 초안이 시안으로 남아 이어서 편집 가능해야 한다.

## 확정 사실 (코드 검증)

- 3채널 생성 라우트가 전부 `event_text` **단독 입력**을 수용 → 이미지 판독은 생성 경로를 건드리지 않고 맨 앞단에만 붙는다.
  - `POST /api/dm/ai/one-shot-generate` — `event_text` → `buildEventPromptBlock` 합성 (dm.ts:482,490)
  - `POST /api/email/ai/generate-sections` — `event_text` → `generateEmailSections` (email.ts:880,892)
  - `POST /api/cdp/inapp/ai-generate` — `event_text` → `generateInAppMessagePackage` (cdp.ts:1331,1338)
- `event-brief.ts`의 `validateProductsAgainstEventText`·`benefitMatchesEventText`가 "원문에 실존하는 값만" 통과시키는 혜택·가격 날조 방지 안전망을 이미 갖고 있다 → 전사 텍스트가 곧 원문이 되어 그대로 작동.
- AI 호출부 `callAIWithFallback`(services/ai.ts:50)은 `userMessage: string`만 받고 **이미지 입력 미지원** → vision 지원을 추가해야 한다.
- 소멸 원인 (EventCampaignModal.tsx): 3채널 결과는 컴포넌트 `results` 상태에만 존재(67행). "편집 열기"는 해당 채널만 sessionStorage 1회성 handoff + `onClose()`(138~147행). 편집기는 `takeEventDraft`로 읽는 즉시 삭제. 모달 재오픈 시 `useEffect`가 `results={}` 리셋(77행). → 나머지 2채널 완전 소멸.
- 모달 진입점: MarketingCalendarPage(363), AiOperatorPage. 둘 다 `<EventCampaignModal open initialText onClose />` 렌더.
- 크레딧: 신규 source `event-image-extract`=3. 20 미만이라 CreditConfirmModal 대상 아님(단, 모달에 "예상 3 크레딧" 표시). 백엔드 `CREDIT_COST_MAP` + 프론트 `CREDIT_SOURCE_LABELS`에 1:1 추가.
- 테이블 관례: `id uuid PK DEFAULT gen_random_uuid()` · `company_id uuid FK companies(id) ON DELETE CASCADE` · `created_by uuid` · `created_at/updated_at timestamptz`.

## 기능 ① 이미지 → 행사 내용 (텍스트 대체)

흐름: 이미지 업로드(여러 장) → vision 판독 endpoint가 "보이는 것만 그대로 전사" → 반환 텍스트가 **행사 내용 입력칸을 채움(수정 가능)** → 사용자 확인·보정 후 기존처럼 "선택 채널 생성".

- 전사 결과를 입력칸에 노출하는 이유: 그 텍스트가 곧 "행사 원문"이 되어 다운스트림 혜택·가격 실존 검증이 그대로 걸린다. 사용자 눈 + 기계 검증 이중으로 AI 날조 차단(혜택 날조 금지 영구 룰 양립).

### 백엔드
- 신규 라우터 `routes/event-campaigns.ts`, `/api/event-campaigns`에 마운트.
- `POST /api/event-campaigns/extract-image` — body `{ images: [{ media_type, data(base64) }] }`. 성공 시 `{ success, event_text }`.
  - `checkCredit(companyId, 3)` 선검사 → vision 판독 → 성공 시 `deductCreditSafe(source:'event-image-extract', cost:3)`. **성공 시에만 차감.**
  - 이미지 개수 상한 5장, media_type 화이트리스트(jpeg/png/webp), 서버측 total 크기 가드.
- `services/ai.ts` `callAIWithFallback`에 **optional** `images?: Array<{ media_type; data }>` 추가(additive, 기존 호출부 무영향).
  - Claude: `content = [...images(type:'image', source base64), {type:'text', text}]`.
  - GPT fallback: `content = [{type:'text'}, ...images(type:'image_url', data URL)]`.
  - `images` 존재 시 cache get/set **skip**(이미지 해시 미포함 충돌 방지). rate-limit·차감·로깅은 그대로.
- 전사 전용 함수 `extractEventTextFromImages(images, companyId, userId)` — 엄격 시스템 프롬프트("이미지에 실제로 보이는 브랜드·상품명·정가·할인율·판매가·기간·대상·혜택만 그대로 옮겨 적는다. 보이지 않는 가격·혜택·기간을 지어내지 않는다. 사용자가 손으로 적은 것과 같은 자연스러운 나열로 출력"). 다중 이미지는 한 행사로 합쳐 전사.

### 프론트 (EventCampaignModal.tsx)
- 행사 내용 입력칸 위에 이미지 업로드 영역(드롭/선택, 스샷 여러 장, 썸네일+삭제). 클라이언트에서 긴 변 ~1568px 다운스케일 + jpeg 재인코딩(페이로드 절감).
- "이미지로 행사 내용 불러오기 (예상 3 크레딧)" 버튼 → extract-image 호출 → 로딩 → 반환 텍스트를 `text`에 채움. 이후 흐름은 기존과 동일.
- 다크 톤·기존 모달 디자인 유지. native dialog 미사용(useToast).

## 기능 ② 생성 초안 DB 임시 보관

생성 세트(행사 원문 + 3채널 payload + 채널별 상태)를 계정 DB에 보관하고, 모달 재오픈·재개 시 복원한다. 편집은 하나씩 이어서.

### 신규 테이블 `event_campaign_drafts` (Harold psql 실행)
```sql
CREATE TABLE event_campaign_drafts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by  uuid,
  title       varchar(120) NOT NULL DEFAULT '',
  event_text  text NOT NULL DEFAULT '',
  source_kind varchar(10) NOT NULL DEFAULT 'text',  -- 'text' | 'image'
  channels    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { dm|email|inapp: { payload, status:'generated'|'opened', updated_at } }
  status      varchar(10) NOT NULL DEFAULT 'active', -- 'active' | 'archived'
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ecd_company_active ON event_campaign_drafts (company_id, status, updated_at DESC);
```
- 원본 이미지는 저장하지 않는다(전사된 `event_text`가 원문 진실 — YAGNI). `source_kind`로 이미지 유래만 표시.
- 발송·정산 테이블은 건드리지 않는다 — 생성 payload JSON만 별도 보관(발송 파이프라인 보호 영역 미접촉).

### 엔드포인트 (routes/event-campaigns.ts, 전부 company 스코프 auth)
- `POST /drafts` — 세트 생성/업서트(event_text, source_kind, 첫 채널). 반환 `{ id }`.
- `PATCH /drafts/:id` — 채널 payload 추가/상태 갱신(생성됨/편집함), title·event_text 갱신.
- `GET /drafts` — 활성 세트 목록(최근 30일, company 스코프). 재개용.
- `GET /drafts/:id` — 세트 1건.
- `POST /drafts/:id/archive` — status='archived'.
- 오래된 활성 세트 정리(30일 TTL)는 on-read 필터로 목록 노출만 제한. 물리 프루닝 워커는 후속(선택).

### 프론트 흐름 (EventCampaignModal + 진입 2페이지)
- 생성 성공 시: 세트가 없으면 `POST /drafts`로 생성(id 확보), 이후 채널마다 `PATCH`. 모달 상태에 `draftId` 보관.
- "편집 열기": 기존 sessionStorage handoff 유지(편집 hop) + 해당 채널 상태 'opened' PATCH(best-effort). **모달 세트는 파괴하지 않는다.**
- 모달 재오픈: 활성 세트가 있으면 `results` 복원 — 각 채널을 "생성됨/편집함 · 편집 열기"로 표시(소멸 해결). 새 행사면 "새로 시작".
- 재개 진입: MarketingCalendarPage·AiOperatorPage에 "임시 보관 행사 캠페인"(GET /drafts) 소형 목록/칩 → 클릭 시 해당 세트로 모달 재오픈.
- "이 행사 보관 종료" 버튼 → archive.

## 크레딧 변경 (백엔드↔프론트 1:1)
- 백엔드 `CREDIT_COST_MAP`에 `'event-image-extract': 3` 추가.
- 프론트 `CREDIT_SOURCE_LABELS`에 `'event-image-extract': '이미지 판독'` 추가.
- CONFIRM_CREDIT_COSTS 미추가(20 미만). 모달에 "예상 3 크레딧" 안내만.

## 영향 검토 (수정 전 연관 지점)
- `callAIWithFallback`: optional `images` 추가 = additive → 기존 호출부(약 20곳) 무영향. 인보전 테스트(ai-call-invariants.test.ts) 유지 확인.
- 크레딧 맵 3파일 동시 갱신(백엔드 map / 프론트 라벨) — 한쪽만 수정 금지.
- EventCampaignModal props 확장은 optional로 → MarketingCalendarPage·AiOperatorPage 무영향.
- 편집기 3종(DmBuilder/Email/Inapp): 편집 handoff(sessionStorage) 그대로 → 미수정. 발송 파이프라인 미접촉.
- 신규 테이블·라우터: 기존 소비처 없음.

## 구현 순서
1. DDL 실행(Harold, psql) → `information_schema`로 생성 확인.
2. 크레딧 맵 3파일 갱신.
3. `callAIWithFallback` vision 지원(optional images) + 전사 함수.
4. `routes/event-campaigns.ts` — extract-image + drafts CRUD, `/api/event-campaigns` 마운트.
5. EventCampaignModal — 이미지 업로드 UI + 전사 연결 + 세트 저장/복원/상태.
6. 진입 2페이지 — 임시 보관 재개 칩/목록.
7. tsc 0 + 자가 grep(모델명/native dialog 0) + Codex 리뷰.

## 검증 시나리오 (실측)
- 이미지: 상품 스샷 여러 장 업로드 → 전사 텍스트에 실제 상품·정가·할인율만 반영(없는 값 미생성) → 3채널 생성 정상.
- 소멸: 3채널 생성 → DM 편집 열기 → 이메일·인앱을 "임시 보관"에서 재개 → 편집 가능(소멸 0).
- 크레딧: 이미지 판독 실패 시 미차감 / 성공 시 3 차감 1건.

## 잔여 결정 (Harold)
- 없음 — 보관=DB, 판독=3크레딧 확정. 이 계획 동의 시 위 순서로 구현.
