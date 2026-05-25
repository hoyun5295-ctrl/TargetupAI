# 📱 모바일DM 빌더 D215+ 강화 — 완벽 설계도 (Spec)

> **작성일**: 2026-05-25 (D215+ 세션 종결 직전)
> **작성자**: Harold + 본 AI (brainstorming 흐름 정합)
> **포지셔닝**: 한줄로 프로 요금제 (월 100만원+) 핵심 차별화 메뉴 — Notion + Figma + Figma AI + Journey Builder 동급 통합 흐름
> **이관**: D119 옛 설계서 (`status/DM-PRO-DESIGN.md`) 보존 + 강화 + 잔존 완성 + Journey 동급 디자인 정합화
> **분량**: 2 세션 (52~67h) — 분량 큰 영역 = 3 세션 가능
> **영구 룰 정합**: `design_quality_minimum_journey_level` + `superpowers_workflow_default` + `codex_review_after_code_change` + `feedback_no_native_browser_dialog` + `feedback_no_bakkeum_usage` + `feedback_ai_no_arbitrary_benefit`

---

## § 1. 제품 정의 / 포지셔닝

### 1-1. 한 줄 요약

> **"한 줄 프롬프트로 모바일 DM 구조·카피·개인화·이벤트·검수·발행까지 5분 안 자동 완성하는 마케팅 실행 엔진 — Notion + Figma + AI Operator 통합"**

### 1-2. 옛 D119 → D215+ 진화

| 옛 D119 | D215+ 강화 |
|---|---|
| 한 줄 프롬프트 → DM 자동 생성 | + **종합 메가 메뉴** — Notion 동급 직접 편집 + Figma 동급 드래그/키보드 + Figma AI 동급 자연어 명령 |
| 11 정적 섹션 | + **신규 16 인터랙티브 섹션** (시각 카드 / 인터랙션 수집 / 참여형 / 외부 임베드) |
| 4 AI 모듈 | + **자율 진단** (5 factor) + **1-click 액션 3** + **6 sub-agent 진행 시각 효과** |
| 옛 단순 form 영역 | + **Journey Builder 동급 디자인** (sticky 헤더 + 자연어 입력 + 7 빠른 시작 + 다크 톤 + violet 액센트) |

### 1-3. 경쟁 차별화

| 경쟁군 | D215+ 차별화 |
|---|---|
| Canva / Miricanvas | 자연어 한 줄 → 5분 완성 + 발송 직결 + 27 섹션 + 인터랙티브 이벤트 |
| 스티비 / Mailerlite | 모바일 네이티브 + 카톡/문자 직결 + 참여형 이벤트 (추첨/룰렛/투표) |
| Klaviyo / Braze | 한국 알림톡 + KISA + AI 자율 진단 (Braze Sage AI 베타 동급) |
| Kakao 알림톡 빌더 | 자유 세로 스크롤 + AI 자동 구성 + 참여형 이벤트 (옛 카카오 = 단순 안내만) |

### 1-4. 타겟 사용자

- 1차: 프로 요금제 회사 admin (마케터) — 편집 UX 가장 편리 의무
- 2차: 중소 매장 점주 — 자연어 한 줄 + 빠른 시작 7 카드 = 5분 완성
- 3차: 에이전시 — 실시간 협업 + 버전 관리 + 승인 흐름

---

## § 2. 27 섹션 매트릭스 (옛 11 + 신규 16)

### 2-1. 옛 11 섹션 (보존)

1. **header** — variant (logo/banner/countdown/coupon) + 로고 + 브랜드명 + 이벤트
2. **hero** — 이미지 + 헤드라인 + 서브카피 + 정렬 + 높이
3. **coupon** — 할인 라벨 + 코드 + 만료 + 최소 구매 + 조건
4. **countdown** — 마감 일시 + 긴급 텍스트 + 일/시/분/초 표시
5. **text_card** — 태그 + 헤드라인 + 본문 + 이미지 위치
6. **cta** — 다중 버튼 (primary/secondary/outline) + 정렬
7. **video** — 영상 URL + 썸네일
8. **store_info** — 매장 정보
9. **sns** — SNS 링크 다수
10. **promo_code** — 프로모 코드 + 복사 버튼
11. **footer** — 하단 정보

### 2-2. 신규 16 섹션 (4 카테고리)

#### 카테고리 A. 시각 카드형 (리테일 브랜드 핵심)

| # | 섹션 | 핵심 props |
|---|---|---|
| A1 | **product_carousel** | 상품 다수 (사진 + 이름 + 가격 + 할인 + 구매 링크) + 좌우 슬라이드 + 인디케이터 |
| A2 | **gallery** | 다중 사진 그리드 (2×2 / 3×3 / 1×N) + 풀스크린 + 줌 |
| A3 | **slideshow** | 자동 슬라이드 (3~5초 전환) + 좌우 인디케이터 + 일시정지 |
| A4 | **tab_cards** | 탭 다수 (카테고리별 분기) + 각 탭별 콘텐츠 |

#### 카테고리 B. 인터랙션 수집형 (리드 발굴)

| # | 섹션 | 핵심 props |
|---|---|---|
| B1 | **poll** | 질문 + 옵션 2~5 + 실시간 결과 % 표시 + 1인 1회 |
| B2 | **survey** | 다중 질문 (객관식 / 주관식 / 별점) + 진행률 + 완료 보상 |
| B3 | **email_capture** | 이메일 input + 동의 체크 입력란 + 즉시 쿠폰 자동 발급 + 정보통신망법 명시 |
| B4 | **click_rewards** | 좋아요 / 공유 / 스크롤 적립 + 진행률 + 보상 안내 |

#### 카테고리 C. 참여형 이벤트 (매출 직결)

| # | 섹션 | 핵심 props |
|---|---|---|
| C1 | **lucky_draw** | 응모 form (이름 + 전화) + 자동 추첨 시간 + 결과 발표 페이지 |
| C2 | **roulette** | 8 영역 회전 휠 + 1회 회전 + 자동 당첨 + 쿠폰 발급 연동 |
| C3 | **instant_coupon** | 즉시 발급 + 만료 카운트다운 + 사용 조건 + 사용 안내 |
| C4 | **limited_quantity** | 100명 선착순 + 실시간 잔여 수량 + 완료 알림 |

#### 카테고리 D. 외부 임베드 + 매장 안내 (신뢰도 강화)

| # | 섹션 | 핵심 props |
|---|---|---|
| D1 | **youtube_embed** | YouTube URL + 자동 재생 옵션 + 썸네일 fallback |
| D2 | **instagram_embed** | Instagram post URL + 공식 임베드 |
| D3 | **map_store_locator** | 지도 임베드 + 매장 다수 + 사용자 위치 기반 가까운 매장 자동 정렬 |
| D4 | **reviews** | 리뷰 다수 (별점 + 본문 + 작성자) + 평균 별점 + 더 보기 |

### 2-3. 빠른 시작 7 시나리오 (Journey Builder 정합)

1. **신상품 출시** = header + hero + product_carousel + cta + footer
2. **시즌 세일** = header + countdown + coupon + product_carousel + cta + footer
3. **추첨 이벤트** = header + hero + lucky_draw + cta + footer
4. **매장 안내** = header + hero + map_store_locator + store_info + footer
5. **설문 + 보상** = header + survey + instant_coupon + footer
6. **신규 가입 환영** = header + hero + email_capture + cta + footer
7. **룰렛 이벤트** = header + roulette + cta + footer

---

## § 3. 편집 UX (종합 메가 메뉴 — Notion + Figma + Figma AI 통합)

### 3-1. 좌우 3열 레이아웃 (옛 보존 + 강화)

```
┌────────────────────────────────────────────────────────┐
│ DmTopBar (sticky)                                      │
│ ←뒤로 / 캠페인명 / 자동저장 / undo redo / AI 마법봉 / 발행 │
├──────┬──────────────────────────────┬──────────────────┤
│ Left │ Center (모바일 캔버스 360px)  │ Right Panel       │
│ 섹션  │ ┌──────────────────────────┐ │ 선택 섹션 props   │
│ 카테고│ │ Section 1: header        │ │ + AI 마법봉       │
│ 리   │ │ Section 2: hero (선택)   │ │ + 변수 드롭다운   │
│ +    │ │ Section 3: coupon        │ │ + 브랜드 킷       │
│ 검색 │ │ ...                       │ │                   │
│      │ │ (드래그 앤 드롭 순서)       │ │                   │
│      │ └──────────────────────────┘ │                   │
└──────┴──────────────────────────────┴──────────────────┘
```

### 3-2. 편집 UX 6 영역

| 영역 | 흐름 |
|---|---|
| **WYSIWYG 직접 편집** | 텍스트 클릭 → 인라인 편집 (contentEditable) + Esc 종료 |
| **드래그 앤 드롭** | 섹션 순서 변경 (HTML5 drag API) + 시각 피드백 (회색 영역) + drop zone |
| **키보드 단축키** | Cmd+Z/Y (undo/redo) + Cmd+S (저장) + Cmd+Enter (발행 흐름) + Cmd+K (검색) + Delete (선택 섹션 삭제) |
| **AI 마법봉** | 각 섹션 마법봉 → 자연어 입력 → AI 자동 다듬기 (3 톤 — 감성/실용/캐주얼) + 변수 자동 추천 |
| **자동 저장** | 5초 단위 자동 저장 + 상태 표시 ("저장됨" / "저장 중..." / "변경 사항 있음") |
| **실시간 협업 (옵션)** | 여러 회사 admin 동시 편집 (Yjs CRDT 또는 WebSocket optimistic) — 후순위 |

### 3-3. undo/redo 흐름 (D211+ 잔존)

- Zustand 또는 useReducer = 옛 dmBuilderStore.ts 활용
- history stack 50건 default + LRU
- Cmd+Z = undo / Cmd+Y or Cmd+Shift+Z = redo
- 매 변경 시점 = diff 저장 (전체 state 저장 X = 메모리 효율)

---

## § 4. Journey Builder 동급 디자인 흐름 (영구 룰 정합)

### 4-1. 14 화면 영역

| # | 영역 | 흐름 |
|---|---|---|
| 1 | 상단 헤더 sticky | BETA badge + sky/blue 그라데이션 아이콘 |
| 2 | 데이터 부족 안내 카드 (조건부) | 0건 / 발송 0건 / 검수 미통과 안내 |
| 3 | AI 자율 진단 카드 | violet/fuchsia 그라데이션 + Sparkles + topInsight 한 줄 |
| 4 | 1-click 액션 3 카드 | AI 다듬기 (violet) / 디자인 정합화 (emerald) / 변수 일관성 (amber) |
| 5 | **자연어 입력 + 빠른 시작 7 카드** | fuchsia/purple/indigo 그라데이션 + Sparkles + Enter 키 + 7 시나리오 |
| 6 | **6 sub-agent 진행 카드** | 5~10초 시각 효과 — Brand Analysis / Layout Recommend / Copy Generate / Variable Bind / Validate / Ready |
| 7 | 요약 5 metric + 격차 | 총 DM / 활성 / 평균 CTR / 30일 발송 / 평균 참여율 |
| 8 | 자세히 분석 토글 | 6 차트 — CTR 분포 / 시간대 / 디바이스 / Top DM / 섹션별 클릭 / 이벤트 응답률 |
| 9 | AI 영향 요인 분석 (Explainability) | 5 factor (이미지 / 카피 길이 / 섹션 순서 / CTA 색상 / 변수 적용 정합) |
| 10 | DM 목록 (filter + sort + 카드) | status + template + sort 필터 + 카드 view |
| 11 | DM Builder 편집 모달 | § 3 영역 — 3열 레이아웃 + WYSIWYG + 드래그 + 키보드 + AI 마법봉 |
| 12 | 통계 드릴다운 (DM별 클릭 시) | impression → click → 이벤트 응답 → 24h 매출 attribution |
| 13 | 템플릿 갤러리 | 옛 dm-template-registry + 신규 7 시나리오 |
| 14 | 브랜드 킷 설정 | 옛 brand-kit + 신규 자동 추출 (URL → og:image + theme-color) |

### 4-2. 색상 매트릭스 (옛 다크 톤 정합)

- 배경: `bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950`
- 헤더 아이콘: `from-sky-400 to-blue-500`
- AI 자율 진단: `from-violet-500/15 via-purple-500/10 to-fuchsia-500/15`
- 자연어 입력: `from-fuchsia-500/10 via-purple-500/8 to-indigo-500/10`
- 1-click 액션: violet (AI) / emerald (디자인) / amber (변수)

---

## § 5. AI 모듈 강화 (옛 4 + 신규 5)

### 5-1. 옛 4 모듈 (보존 + 강화)

| 모듈 | 옛 흐름 | D215+ 강화 |
|---|---|---|
| **parse-prompt** | 자연어 → CampaignSpec | + 시즌 / 브랜드 톤 / 회사 메모리 통합 |
| **recommend-layout** | CampaignSpec → Section[] | + 신규 16 섹션 추천 + 이벤트 종류 자동 선택 |
| **generate-copy** | 섹션별 카피 3안 | + AI 임의 혜택 X (placeholder 의무) + 회사 브랜드 톤 통합 |
| **transform-tone** | 톤 변환 (감성/실용/캐주얼) | 옛 보존 |

### 5-2. 신규 5 모듈 (CT-86 ~ CT-90)

| CT | 모듈 | 핵심 | 호출 영역 |
|---|---|---|---|
| **CT-86** | `dm-self-diagnosis` | CTR / 디자인 일관성 / 광고 합성 / 변수 정합 / 섹션 순서 5 factor 자율 진단 | AI 자율 진단 카드 |
| **CT-87** | `dm-quick-action` | AI 다듬기 / 디자인 정합화 / 변수 일관성 자동 1-click | 1-click 액션 3 카드 |
| **CT-88** | `dm-event-recommender` | 회사 데이터 + 시즌 → 이벤트 종류 추천 (룰렛/추첨/투표/쿠폰 자동) | 빠른 시작 카드 + 신규 캠페인 |
| **CT-89** | `dm-section-suggester` | 작성 중 DM → 다음 섹션 자동 추천 (예: hero 다음 = product_carousel) | 편집 모드 인라인 추천 |
| **CT-90** | `dm-personalization-engine` | Liquid 변수 + customer + 등급별/시점별 변수 자동 추천 | 변수 드롭다운 + 자동 적용 |

---

## § 6. DB 모델

### 6-1. 옛 테이블 보존 (D119)

- `dm_campaigns` + `dm_sections` + `dm_versions` + `dm_brand_kits` + `dm_templates` + `dm_ab_tests` + `dm_views` + `dm_section_interactions`

### 6-2. 신규 ALTER (dm_campaigns 4 컬럼)

```sql
ALTER TABLE dm_campaigns ADD COLUMN IF NOT EXISTS event_type varchar(30);
ALTER TABLE dm_campaigns ADD COLUMN IF NOT EXISTS personalization_strategy jsonb DEFAULT '{}'::jsonb;
ALTER TABLE dm_campaigns ADD COLUMN IF NOT EXISTS quick_start_scenario varchar(30);
ALTER TABLE dm_campaigns ADD COLUMN IF NOT EXISTS last_diagnosed_at timestamptz;
```

### 6-3. SectionType 확장 (dm-section-registry.ts)

```typescript
export type SectionType =
  // 옛 11
  | 'header' | 'hero' | 'coupon' | 'countdown' | 'text_card'
  | 'cta' | 'video' | 'store_info' | 'sns' | 'promo_code' | 'footer'
  // 신규 16 — 카테고리 A. 시각 카드형
  | 'product_carousel' | 'gallery' | 'slideshow' | 'tab_cards'
  // 카테고리 B. 인터랙션 수집형
  | 'poll' | 'survey' | 'email_capture' | 'click_rewards'
  // 카테고리 C. 참여형 이벤트
  | 'lucky_draw' | 'roulette' | 'instant_coupon' | 'limited_quantity'
  // 카테고리 D. 외부 임베드 + 매장 안내
  | 'youtube_embed' | 'instagram_embed' | 'map_store_locator' | 'reviews';
```

### 6-4. 신규 테이블 1건 — `dm_event_responses`

```sql
CREATE TABLE IF NOT EXISTS dm_event_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES dm_campaigns(id) ON DELETE CASCADE,
  section_id uuid NOT NULL,
  section_type varchar(30) NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  anonymous_id varchar(100),
  response_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address varchar(45),
  user_agent text,
  occurred_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dm_event_resp_campaign ON dm_event_responses(company_id, campaign_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_event_resp_section ON dm_event_responses(section_id, section_type);
CREATE INDEX IF NOT EXISTS idx_dm_event_resp_customer ON dm_event_responses(customer_id) WHERE customer_id IS NOT NULL;
```

---

## § 7. API endpoint 신규 매트릭스

### 7-1. 옛 40+ endpoint 보존

### 7-2. 신규 endpoint 8건

| Method | Path | CT |
|---|---|---|
| POST | `/dm/:id/self-diagnose` | CT-86 |
| POST | `/dm/:id/quick-action` | CT-87 (ai_refine / design_align / variable_consistency) |
| POST | `/dm/event-recommend` | CT-88 |
| GET | `/dm/:id/section-suggest` | CT-89 |
| GET | `/dm/personalization-vars` | CT-90 |
| GET | `/dm/overview` | 회사 전체 5 metric + 격차 |
| GET | `/dm/top-campaigns` | Top CTR DM 10 |
| POST | `/dm/event-response` | dm_event_responses INSERT (SDK + 외부 자사몰 호출) |

---

## § 8. 2 세션 작업 분할 (Plan outline)

### 8-1. 1 세션 (Backend + UX 강화 + 잔존 완성)

| Step | 작업 | 분량 |
|---|---|---|
| 1 | DB ALTER 4 컬럼 + dm_event_responses 신설 | Harold 직접 |
| 2 | dm-section-registry SectionType 확장 + props 정의 | 2~3h |
| 3 | CT-86 ~ CT-90 신설 5건 (Backend AI 모듈) | 8~10h |
| 4 | routes/dm.ts 신규 endpoint 8건 추가 + 503 안전망 | 2h |
| 5 | dmBuilderStore + DmBuilderPage 편집 UX 강화 (WYSIWYG + 드래그 + 키보드 + undo/redo) | 6~8h |
| 6 | tsc 0 + 자가 grep 0 + 표준 배포 | 1h |
| **합계** | | **19~24h** |

### 8-2. 2 세션 (신규 16 섹션 + Journey 동급 디자인)

| Step | 작업 | 분량 |
|---|---|---|
| 1 | 신규 16 섹션 backend 렌더링 (dm-section-renderer 확장) | 6~8h |
| 2 | 신규 16 섹션 frontend 컴포넌트 신설 (DmCanvas 안 렌더링 분기) | 8~10h |
| 3 | DmBuilderPage Journey 동급 디자인 정합화 (14 화면 영역) | 8~10h |
| 4 | AI 자율 진단 + 1-click 액션 + 6 sub-agent 시각 효과 | 4~6h |
| 5 | 자세히 분석 토글 (6 차트) + Top DM + Explainability | 3~4h |
| 6 | 통계 드릴다운 + 이벤트 응답 통계 + funnel | 3~4h |
| 7 | tsc 0 + 자가 grep 0 + 표준 배포 | 1h |
| **합계** | | **33~43h** |

**총 2 세션 = 52~67h** (분량 큰 영역 = 3 세션 가능).

---

## § 9. 테스트 / 검증 / 배포 표준

### 9-1. 검증 매트릭스

- backend tsc 0 errors
- frontend tsc 0 errors
- 박-단어 / 모델명 / 매트릭스 / native dialog 광범위 grep 0건
- DB ALTER 503 분기 (db_alter_safety_net 룰)
- AI 임의 혜택 X (시스템 프롬프트 + placeholder 의무)
- Source caption 모든 차트
- 모바일 반응형 default

### 9-2. 표준 배포

- `tp-push "D216+/D217+ 모바일DM 강화 — Step N: ..."` 명령어 활용
- 서버 흐름 = git pull + backend build:safe + frontend build:safe + pm2 restart all
- Harold 직접 진행

---

## § 10. 영구 룰 정합 검증

| 룰 | 검증 |
|---|---|
| `design_quality_minimum_journey_level` | 14 화면 영역 + 자연어 + 7 빠른 시작 + 6 sub-agent + 1-click + 5 metric + 자세히 토글 |
| `superpowers_workflow_default` | 본 세션 = brainstorming 활용 / 다음 세션 = writing-plans + executing-plans |
| `codex_review_after_code_change` | 작업 종결 직전 = `/codex:adversarial-review` 호출 의무 (DB 마이그레이션 + AI 모듈 신설 = Critical) |
| `feedback_no_native_browser_dialog` | ConfirmModal + useToast 의무 (native dialog 0건) |
| `feedback_no_bakkeum_usage` | 박-단어 0건 자가 grep |
| `feedback_ai_operator_model_isolation` | 모델명 UI 노출 X / backend `model: 'opus'` 파라미터만 허용 |
| `feedback_ai_no_arbitrary_benefit` | AI 임의 혜택 X / `[직접 작성해주세요]` placeholder 의무 |
| `db_alter_safety_net` | 모든 신규 endpoint catch 503 DB_MIGRATION_PENDING 분기 |

---

## 변경 이력

| 날짜 | 변경 | 담당 |
|---|---|---|
| 2026-05-25 | 본 설계서 신설 (brainstorming 흐름 종결) | Harold + 본 AI |
