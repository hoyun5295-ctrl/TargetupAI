# D216+ 모바일DM 강화 1 세션 — Backend + 편집 UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모바일DM 빌더 D215+ 강화 1 세션 — 옛 D119 영역 보존 + 27 섹션 SectionType 확장 + 5 신규 AI 모듈 (CT-86~90) + endpoint 8건 + dmBuilderStore undo/redo + DmBuilderPage 편집 UX 강화 (WYSIWYG + 드래그 + 키보드 단축키)

**Architecture:** 옛 24 파일 (`packages/backend/src/utils/dm/` 15 파일 + `routes/dm.ts` + `packages/frontend/src/pages/DmBuilderPage.tsx` + `stores/dmBuilderStore.ts` + 43 컴포넌트) 보존. 신규 = SectionType 16 추가 + utils/dm/dm-self-diagnosis.ts + dm-quick-action.ts + dm-event-recommender.ts + dm-section-suggester.ts + dm-personalization-engine.ts 신설. 모든 신규 endpoint catch = 503 DB_MIGRATION_PENDING 분기 의무. AI 호출 = `callAIWithFallback({ model: 'opus' })` (모델명 UI 노출 절대 X). 자연어 임의 혜택 생성 절대 X (`[직접 작성해주세요]` placeholder 의무).

**Tech Stack:** Node.js / Express / TypeScript / PostgreSQL / React / Zustand / Tailwind CSS / Anthropic Opus 4.7 + GPT 5.5 fallback / @dnd-kit/sortable / Liquid 변수

**참조 설계서:** `docs/superpowers/specs/2026-05-25-mobile-dm-redesign-design.md`

**영구 룰 정합 의무:**
- `no_model_name_ui_exposure` — UI / 시스템 프롬프트 / 응답 / 오류 메시지 안 "Opus" / "Sonnet" / "GPT" / "Claude" 단어 0건
- `feedback_no_bakkeum_usage` — 박-단어 (박음 / 박힘 / 박지 / 박는 / 박을 / 박혀 / 박힌 / 박혔) 0건
- `feedback_no_native_browser_dialog` — alert / confirm / prompt 0건 — ConfirmModal + useToast 활용 의무
- `db_alter_safety_net` — 새 컬럼 활용 endpoint catch = `column does not exist` 분기 의무
- `feedback_ai_no_arbitrary_benefit` — AI 시스템 프롬프트 "구체 혜택 (%/원/쿠폰/무료) 생성 절대 금지" 명시 + `[직접 작성해주세요]` placeholder
- `feedback_ai_operator_model_isolation` — Opus 4.7 (Continuous Operator 영역) / Sonnet 4.6 (옛 한줄로AI 영역 0건 영향)
- `codex_review_after_code_change` — 1 세션 작업 종결 직전 `/codex:adversarial-review` 호출 의무 (DB 마이그레이션 + AI 모듈 신설 = Critical)

**검증 흐름:**
- backend tsc 0 errors (`cd ~/targetup-app/packages/backend && npm run build:safe`)
- frontend tsc 0 errors (`cd ~/targetup-app/packages/frontend && npm run build:safe`)
- 박-단어 / 모델명 / native dialog / sudo / "영역" / "본질" / "매트릭스" 광범위 grep 0건
- 표준 배포 = `tp-push "D216+ 모바일DM 강화 1 세션 — Backend + 편집 UX 강화"` (Harold 직접)

---

## File Structure

### 신규 파일

```
packages/backend/src/utils/dm/
  dm-self-diagnosis.ts          (CT-86 — 5 factor 자율 진단)
  dm-quick-action.ts            (CT-87 — 3 액션 1-click)
  dm-event-recommender.ts       (CT-88 — 이벤트 종류 추천)
  dm-section-suggester.ts       (CT-89 — 다음 섹션 자동 추천)
  dm-personalization-engine.ts  (CT-90 — Liquid 변수 자동 추천)
```

### 정정 파일

```
packages/backend/src/utils/dm/dm-section-registry.ts   (392줄 → 700+줄 — SectionType 16 추가)
packages/backend/src/routes/dm.ts                       (258줄 → 380+줄 — endpoint 8건 추가)
packages/frontend/src/stores/dmBuilderStore.ts          (653줄 → 800+줄 — undo/redo history stack)
packages/frontend/src/pages/DmBuilderPage.tsx           (467줄 → 600+줄 — 편집 UX 강화)
packages/frontend/src/components/dm/InlineEditable.tsx  (WYSIWYG contentEditable 강화)
packages/frontend/src/components/dm/SectionList.tsx     (드래그 시각 피드백 강화)
```

### 보존 파일 (정정 X)

```
packages/backend/src/utils/dm/dm-ai.ts           (456줄 — 옛 4 AI 모듈 보존)
packages/backend/src/utils/dm/dm-builder.ts      (359줄 — CRUD 보존)
packages/backend/src/utils/dm/dm-validate.ts     (379줄 — 옛 10 영역 검수 보존)
packages/backend/src/utils/dm/dm-viewer.ts       (569줄 — 옛 11 섹션 렌더링 보존)
... 옛 15 파일 모두 보존
```

---

## Task 1: DB ALTER 4 컬럼 + dm_event_responses 신설 SQL 안내

**Files:**
- 안내: Harold 직접 실행 (psql `~/targetup-app/.env` `DATABASE_URL` 활용)

- [ ] **Step 1: SQL 안내 출력 — Harold 직접 실행 의무**

```sql
-- D216+ 모바일DM 강화 (1 세션)

-- 1. dm_pages 4 컬럼 ALTER
ALTER TABLE dm_pages ADD COLUMN IF NOT EXISTS event_type varchar(30);
ALTER TABLE dm_pages ADD COLUMN IF NOT EXISTS personalization_strategy jsonb DEFAULT '{}'::jsonb;
ALTER TABLE dm_pages ADD COLUMN IF NOT EXISTS quick_start_scenario varchar(30);
ALTER TABLE dm_pages ADD COLUMN IF NOT EXISTS last_diagnosed_at timestamptz;

-- 2. dm_event_responses 신설 (이벤트 응답 누적)
CREATE TABLE IF NOT EXISTS dm_event_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES dm_pages(id) ON DELETE CASCADE,
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

-- 3. 인덱스 3건
CREATE INDEX IF NOT EXISTS idx_dm_event_resp_campaign
  ON dm_event_responses(company_id, campaign_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_event_resp_section
  ON dm_event_responses(section_id, section_type);
CREATE INDEX IF NOT EXISTS idx_dm_event_resp_customer
  ON dm_event_responses(customer_id)
  WHERE customer_id IS NOT NULL;

-- 4. 검증 쿼리
\d dm_pages
\d dm_event_responses
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'dm_pages'
  AND column_name IN ('event_type', 'personalization_strategy', 'quick_start_scenario', 'last_diagnosed_at');
```

- [ ] **Step 2: SCHEMA.md 갱신**

Files: `status/SCHEMA.md`

dm_pages 4 컬럼 + dm_event_responses 신규 테이블 추가 명시.

- [ ] **Step 3: Harold 실행 결과 확인 후 Step 2 (Task 2) 진입**

DB ALTER 미실행 상태에서 endpoint 호출 시 = 503 DB_MIGRATION_PENDING 안내 의무 (Task 9에서 catch 분기 적용).

---

## Task 2: dm-section-registry SectionType 16 신규 확장

**Files:**
- Modify: `packages/backend/src/utils/dm/dm-section-registry.ts` (392줄 → 700+줄)

- [ ] **Step 1: SectionType union 확장**

```typescript
export type SectionType =
  // 옛 11 (보존)
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

- [ ] **Step 2: 16 신규 Props 타입 추가**

```typescript
// 카테고리 A. 시각 카드형
export interface ProductCarouselProps {
  title?: string;
  products: Array<{
    id?: string;
    image_url: string;
    name: string;
    price: number;
    discount_price?: number;
    discount_rate?: number;
    link_url?: string;
  }>;
  show_indicator?: boolean;
  auto_slide?: boolean;
  slide_interval_ms?: number;
}

export interface GalleryProps {
  title?: string;
  images: Array<{ url: string; caption?: string; link_url?: string }>;
  layout: 'grid_2x2' | 'grid_3x3' | 'list_1xN' | 'masonry';
  enable_zoom?: boolean;
  enable_fullscreen?: boolean;
}

export interface SlideshowProps {
  slides: Array<{ image_url: string; caption?: string; link_url?: string }>;
  interval_ms: number;
  show_pause?: boolean;
  show_indicator?: boolean;
}

export interface TabCardsProps {
  tabs: Array<{
    label: string;
    content_type: 'text' | 'image' | 'product_list';
    content: string;
  }>;
  default_tab_index?: number;
}

// 카테고리 B. 인터랙션 수집형
export interface PollProps {
  question: string;
  options: Array<{ id: string; label: string }>;
  allow_multiple?: boolean;
  show_result_after_vote?: boolean;
  one_vote_per_user: boolean;
}

export interface SurveyProps {
  title?: string;
  questions: Array<{
    id: string;
    type: 'single' | 'multiple' | 'text' | 'rating';
    question: string;
    options?: string[];
    required?: boolean;
  }>;
  show_progress?: boolean;
  completion_reward_text?: string;
}

export interface EmailCaptureProps {
  headline: string;
  description?: string;
  reward_description?: string;
  consent_text: string;
  consent_required: boolean;
  success_text?: string;
  legal_notice?: string;
}

export interface ClickRewardsProps {
  reward_type: 'like' | 'share' | 'scroll';
  target_count: number;
  reward_description: string;
  show_progress: boolean;
}

// 카테고리 C. 참여형 이벤트
export interface LuckyDrawProps {
  title: string;
  description?: string;
  form_fields: Array<{ name: 'name' | 'phone' | 'email'; required: boolean }>;
  draw_at: string;
  result_announce_url?: string;
  consent_text: string;
}

export interface RouletteProps {
  segments: Array<{
    id: string;
    label: string;
    probability: number;
    reward_description?: string;
  }>;
  one_spin_per_user: boolean;
  spin_animation_ms?: number;
}

export interface InstantCouponProps {
  coupon_label: string;
  discount_description: string;
  expires_at?: string;
  conditions?: string;
  usage_instructions?: string;
}

export interface LimitedQuantityProps {
  title: string;
  description?: string;
  total_quantity: number;
  current_remaining?: number;
  signup_url?: string;
}

// 카테고리 D. 외부 임베드 + 매장 안내
export interface YoutubeEmbedProps {
  video_url: string;
  auto_play?: boolean;
  thumbnail_url?: string;
}

export interface InstagramEmbedProps {
  post_url: string;
}

export interface MapStoreLocatorProps {
  stores: Array<{
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    phone?: string;
    hours?: string;
  }>;
  enable_user_location?: boolean;
  default_zoom?: number;
}

export interface ReviewsProps {
  title?: string;
  reviews: Array<{
    rating: number;
    author: string;
    body: string;
    date?: string;
  }>;
  show_average_rating?: boolean;
  show_more_link?: string;
}
```

- [ ] **Step 3: SectionPropsMap 갱신**

```typescript
export type SectionPropsMap = {
  // 옛 11 (보존)
  header: HeaderProps;
  hero: HeroProps;
  coupon: CouponProps;
  countdown: CountdownProps;
  text_card: TextCardProps;
  cta: CtaProps;
  video: VideoProps;
  store_info: StoreInfoProps;
  sns: SnsProps;
  promo_code: PromoCodeProps;
  footer: FooterProps;
  // 신규 16
  product_carousel: ProductCarouselProps;
  gallery: GalleryProps;
  slideshow: SlideshowProps;
  tab_cards: TabCardsProps;
  poll: PollProps;
  survey: SurveyProps;
  email_capture: EmailCaptureProps;
  click_rewards: ClickRewardsProps;
  lucky_draw: LuckyDrawProps;
  roulette: RouletteProps;
  instant_coupon: InstantCouponProps;
  limited_quantity: LimitedQuantityProps;
  youtube_embed: YoutubeEmbedProps;
  instagram_embed: InstagramEmbedProps;
  map_store_locator: MapStoreLocatorProps;
  reviews: ReviewsProps;
};
```

- [ ] **Step 4: SECTION_META 16 신규 메타데이터 추가**

```typescript
export const SECTION_META: Record<SectionType, {
  label: string;
  description: string;
  icon: string;
  category: 'header_footer' | 'hero_visual' | 'commerce' | 'interactive' | 'event' | 'embed' | 'info';
  max_count?: number;
  ai_supported: boolean;
  beta?: boolean;
}> = {
  // ... 옛 11 보존
  // 신규 16 — 카테고리 A. 시각 카드형
  product_carousel: {
    label: '상품 슬라이드',
    description: '상품 다수 (사진 + 가격 + 할인) 좌우 슬라이드',
    icon: '🛍️',
    category: 'commerce',
    max_count: 3,
    ai_supported: true,
  },
  gallery: {
    label: '갤러리',
    description: '다중 사진 그리드 (2×2 / 3×3 / 1×N)',
    icon: '🖼️',
    category: 'hero_visual',
    max_count: 5,
    ai_supported: true,
  },
  slideshow: {
    label: '자동 슬라이드쇼',
    description: '3~5초 자동 전환 슬라이드',
    icon: '🎞️',
    category: 'hero_visual',
    max_count: 2,
    ai_supported: true,
  },
  tab_cards: {
    label: '탭 카드',
    description: '카테고리별 탭 분기 콘텐츠',
    icon: '📑',
    category: 'commerce',
    max_count: 3,
    ai_supported: false,
  },
  // 카테고리 B. 인터랙션 수집형
  poll: {
    label: '실시간 투표',
    description: '질문 + 옵션 + 실시간 결과',
    icon: '📊',
    category: 'interactive',
    max_count: 2,
    ai_supported: true,
  },
  survey: {
    label: '설문',
    description: '다중 질문 + 진행률 + 완료 보상',
    icon: '📝',
    category: 'interactive',
    max_count: 1,
    ai_supported: true,
  },
  email_capture: {
    label: '이메일 수집',
    description: '이메일 + 동의 체크 + 즉시 쿠폰 발급',
    icon: '✉️',
    category: 'interactive',
    max_count: 1,
    ai_supported: true,
  },
  click_rewards: {
    label: '참여 보상',
    description: '좋아요 / 공유 / 스크롤 적립',
    icon: '⭐',
    category: 'interactive',
    max_count: 1,
    ai_supported: false,
  },
  // 카테고리 C. 참여형 이벤트
  lucky_draw: {
    label: '추첨 이벤트',
    description: '응모 + 자동 추첨 + 결과 발표',
    icon: '🎁',
    category: 'event',
    max_count: 1,
    ai_supported: true,
    beta: true,
  },
  roulette: {
    label: '룰렛 이벤트',
    description: '8 영역 회전 휠 + 자동 당첨',
    icon: '🎡',
    category: 'event',
    max_count: 1,
    ai_supported: false,
    beta: true,
  },
  instant_coupon: {
    label: '즉시 쿠폰 발급',
    description: '만료 카운트다운 + 사용 안내',
    icon: '🎟️',
    category: 'event',
    max_count: 2,
    ai_supported: true,
  },
  limited_quantity: {
    label: '선착순 한정',
    description: '실시간 잔여 수량 + 완료 알림',
    icon: '⏳',
    category: 'event',
    max_count: 1,
    ai_supported: true,
  },
  // 카테고리 D. 외부 임베드 + 매장 안내
  youtube_embed: {
    label: 'YouTube 임베드',
    description: 'YouTube URL 공식 임베드',
    icon: '▶️',
    category: 'embed',
    max_count: 2,
    ai_supported: false,
  },
  instagram_embed: {
    label: 'Instagram 임베드',
    description: 'Instagram post 공식 임베드',
    icon: '📷',
    category: 'embed',
    max_count: 2,
    ai_supported: false,
  },
  map_store_locator: {
    label: '매장 찾기 지도',
    description: '지도 + 매장 다수 + 가까운 매장 정렬',
    icon: '🗺️',
    category: 'info',
    max_count: 1,
    ai_supported: false,
  },
  reviews: {
    label: '리뷰',
    description: '별점 + 본문 + 평균 별점',
    icon: '⭐',
    category: 'info',
    max_count: 1,
    ai_supported: true,
  },
};
```

- [ ] **Step 5: 16 신규 default props factory 함수 추가**

```typescript
export function createDefaultProps<T extends SectionType>(type: T): SectionPropsMap[T] {
  switch (type) {
    // 옛 11 보존
    // 신규 16
    case 'product_carousel':
      return { products: [], show_indicator: true } as SectionPropsMap[T];
    case 'gallery':
      return { images: [], layout: 'grid_2x2', enable_zoom: true } as SectionPropsMap[T];
    case 'slideshow':
      return { slides: [], interval_ms: 4000, show_pause: true, show_indicator: true } as SectionPropsMap[T];
    case 'tab_cards':
      return { tabs: [{ label: '탭 1', content_type: 'text', content: '[직접 작성해주세요]' }], default_tab_index: 0 } as SectionPropsMap[T];
    case 'poll':
      return { question: '[직접 작성해주세요]', options: [{ id: '1', label: '옵션 1' }, { id: '2', label: '옵션 2' }], one_vote_per_user: true, show_result_after_vote: true } as SectionPropsMap[T];
    case 'survey':
      return { questions: [], show_progress: true } as SectionPropsMap[T];
    case 'email_capture':
      return { headline: '[직접 작성해주세요]', consent_text: '개인정보 수집 동의 (마케팅 정보 수신)', consent_required: true } as SectionPropsMap[T];
    case 'click_rewards':
      return { reward_type: 'like', target_count: 10, reward_description: '[직접 작성해주세요]', show_progress: true } as SectionPropsMap[T];
    case 'lucky_draw':
      return { title: '[직접 작성해주세요]', form_fields: [{ name: 'name', required: true }, { name: 'phone', required: true }], draw_at: '', consent_text: '개인정보 수집 동의' } as SectionPropsMap[T];
    case 'roulette':
      return { segments: Array.from({ length: 8 }, (_, i) => ({ id: String(i + 1), label: `옵션 ${i + 1}`, probability: 0.125 })), one_spin_per_user: true, spin_animation_ms: 3000 } as SectionPropsMap[T];
    case 'instant_coupon':
      return { coupon_label: '[직접 작성해주세요]', discount_description: '[직접 작성해주세요]' } as SectionPropsMap[T];
    case 'limited_quantity':
      return { title: '[직접 작성해주세요]', total_quantity: 100 } as SectionPropsMap[T];
    case 'youtube_embed':
      return { video_url: '' } as SectionPropsMap[T];
    case 'instagram_embed':
      return { post_url: '' } as SectionPropsMap[T];
    case 'map_store_locator':
      return { stores: [], enable_user_location: false, default_zoom: 14 } as SectionPropsMap[T];
    case 'reviews':
      return { reviews: [], show_average_rating: true } as SectionPropsMap[T];
    default:
      throw new Error(`createDefaultProps: 알 수 없는 섹션 타입 = ${type}`);
  }
}
```

- [ ] **Step 6: tsc 검증**

Run: `cd ~/targetup-app/packages/backend && npm run build:safe`
Expected: 0 errors.

- [ ] **Step 7: 박-단어 / 모델명 자가 grep 검증**

Run: `grep -nE "박음|박힘|박지|박는|박을|박혀|박힌|박혔|Opus|Sonnet|GPT|Claude" packages/backend/src/utils/dm/dm-section-registry.ts`
Expected: 0 matches.

- [ ] **Step 8: Commit (Harold 직접)**

```bash
# Harold 직접 진행 — 표준 종료 멘트 출력 후 대기
```

---

## Task 3: CT-86 dm-self-diagnosis 신설 (5 factor 자율 진단)

**Files:**
- Create: `packages/backend/src/utils/dm/dm-self-diagnosis.ts`

- [ ] **Step 1: 인터페이스 + 5 factor 정의**

```typescript
import { Pool } from 'pg';
import { callAIWithFallback } from '../ai-fallback';
import { listMemories } from '../company-memory';

export interface DmDiagnosisFactor {
  factor: 'ctr' | 'design_consistency' | 'ad_label_compliance' | 'variable_integrity' | 'section_order';
  score: number;             // 0~100
  status: 'good' | 'warning' | 'critical';
  short_message: string;     // 한 줄 진단
  detail?: string;
}

export interface DmSelfDiagnosisResult {
  campaign_id: string;
  overall_score: number;
  factors: DmDiagnosisFactor[];
  top_insight: string;
  recommended_actions: Array<{
    action: 'ai_refine' | 'design_align' | 'variable_consistency';
    priority: 'high' | 'medium' | 'low';
    reason: string;
  }>;
  diagnosed_at: string;
}
```

- [ ] **Step 2: 5 factor 평가 함수 작성**

```typescript
async function evaluateCtr(pool: Pool, campaignId: string, companyId: string): Promise<DmDiagnosisFactor> {
  const result = await pool.query(`
    SELECT
      COUNT(DISTINCT dv.id) AS view_count,
      COUNT(DISTINCT der.id) AS interaction_count
    FROM dm_views dv
    LEFT JOIN dm_event_responses der ON der.campaign_id = dv.dm_id
    WHERE dv.dm_id = $1 AND dv.company_id = $2
      AND dv.viewed_at >= NOW() - INTERVAL '30 days'
  `, [campaignId, companyId]);

  const views = Number(result.rows[0]?.view_count || 0);
  const interactions = Number(result.rows[0]?.interaction_count || 0);
  const ctr = views > 0 ? (interactions / views) * 100 : 0;

  if (views < 50) {
    return { factor: 'ctr', score: 50, status: 'warning', short_message: '데이터 부족 (열람 50건 미만)', detail: `현재 ${views}건 — 분석을 위해 더 많은 발송 필요` };
  }
  if (ctr >= 5) return { factor: 'ctr', score: 90, status: 'good', short_message: `CTR ${ctr.toFixed(1)}% — 우수` };
  if (ctr >= 2) return { factor: 'ctr', score: 70, status: 'warning', short_message: `CTR ${ctr.toFixed(1)}% — 평균` };
  return { factor: 'ctr', score: 40, status: 'critical', short_message: `CTR ${ctr.toFixed(1)}% — 개선 필요`, detail: 'CTA 위치 / 카피 / 이미지 정합 검토 권장' };
}

async function evaluateDesignConsistency(pool: Pool, campaignId: string): Promise<DmDiagnosisFactor> {
  const result = await pool.query(`SELECT sections, brand_kit FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections = result.rows[0]?.sections || [];
  const brandKit = result.rows[0]?.brand_kit || {};

  let issues = 0;
  for (const sec of sections) {
    if (sec.type === 'header' && brandKit.primary_color && sec.props?.background_color && sec.props.background_color !== brandKit.primary_color) {
      issues++;
    }
  }

  if (issues === 0) return { factor: 'design_consistency', score: 95, status: 'good', short_message: '디자인 일관성 우수' };
  if (issues <= 2) return { factor: 'design_consistency', score: 70, status: 'warning', short_message: `${issues}개 섹션 색상 불일치`, detail: '브랜드 킷과 다른 색상 사용 — 디자인 정합화 권장' };
  return { factor: 'design_consistency', score: 40, status: 'critical', short_message: `${issues}개 섹션 색상 불일치`, detail: '브랜드 정체성 약화 위험' };
}

async function evaluateAdLabelCompliance(pool: Pool, campaignId: string): Promise<DmDiagnosisFactor> {
  const result = await pool.query(`SELECT sections FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections = result.rows[0]?.sections || [];

  const hasAdLabel = sections.some((sec: any) =>
    sec.type === 'header' && (sec.props?.ad_label === true || /광고/.test(sec.props?.title || ''))
  );

  if (hasAdLabel) return { factor: 'ad_label_compliance', score: 100, status: 'good', short_message: '광고 표기 정합' };
  return { factor: 'ad_label_compliance', score: 30, status: 'critical', short_message: '광고 표기 누락', detail: '정보통신망법 위반 위험 — 헤더 (광고) 표기 의무' };
}

async function evaluateVariableIntegrity(pool: Pool, campaignId: string): Promise<DmDiagnosisFactor> {
  const result = await pool.query(`SELECT sections FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections = result.rows[0]?.sections || [];

  let unbound = 0;
  let total = 0;
  for (const sec of sections) {
    const text = JSON.stringify(sec.props || {});
    const vars = text.match(/%[^%\s]+%/g) || [];
    total += vars.length;
    const fallbacks = sec.props?.variable_fallbacks || [];
    unbound += vars.filter(v => !fallbacks.some((f: any) => f.variable === v.replace(/%/g, ''))).length;
  }

  if (total === 0) return { factor: 'variable_integrity', score: 80, status: 'good', short_message: '변수 미사용' };
  const integrityRate = ((total - unbound) / total) * 100;
  if (integrityRate >= 90) return { factor: 'variable_integrity', score: 95, status: 'good', short_message: `변수 ${total}건 정합` };
  if (integrityRate >= 70) return { factor: 'variable_integrity', score: 70, status: 'warning', short_message: `${unbound}건 fallback 누락`, detail: '비어있는 변수 시 빈 영역 표시 위험' };
  return { factor: 'variable_integrity', score: 40, status: 'critical', short_message: `${unbound}건 fallback 누락`, detail: '발송 시 빈 변수 출력 위험' };
}

async function evaluateSectionOrder(pool: Pool, campaignId: string): Promise<DmDiagnosisFactor> {
  const result = await pool.query(`SELECT sections FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections = result.rows[0]?.sections || [];

  const types = sections.map((s: any) => s.type);
  const hasHeader = types[0] === 'header';
  const hasFooter = types[types.length - 1] === 'footer';
  const hasHeroNearTop = types.slice(0, 3).includes('hero');
  const hasCta = types.includes('cta');

  let score = 100;
  const issues: string[] = [];
  if (!hasHeader) { score -= 25; issues.push('헤더 누락 (상단)'); }
  if (!hasFooter) { score -= 15; issues.push('푸터 누락 (하단)'); }
  if (!hasHeroNearTop) { score -= 20; issues.push('히어로 상단 누락'); }
  if (!hasCta) { score -= 30; issues.push('CTA 누락'); }

  if (score >= 90) return { factor: 'section_order', score, status: 'good', short_message: '섹션 순서 우수' };
  if (score >= 60) return { factor: 'section_order', score, status: 'warning', short_message: '섹션 순서 개선 권장', detail: issues.join(' / ') };
  return { factor: 'section_order', score: Math.max(score, 0), status: 'critical', short_message: '섹션 구조 미흡', detail: issues.join(' / ') };
}
```

- [ ] **Step 3: 메인 함수 + AI topInsight 도출**

```typescript
export async function selfDiagnoseDm(
  pool: Pool,
  companyId: string,
  campaignId: string,
): Promise<DmSelfDiagnosisResult> {
  const [ctr, design, adLabel, variable, order] = await Promise.all([
    evaluateCtr(pool, campaignId, companyId),
    evaluateDesignConsistency(pool, campaignId),
    evaluateAdLabelCompliance(pool, campaignId),
    evaluateVariableIntegrity(pool, campaignId),
    evaluateSectionOrder(pool, campaignId),
  ]);

  const factors = [ctr, design, adLabel, variable, order];
  const overall = Math.round(factors.reduce((sum, f) => sum + f.score, 0) / factors.length);

  // AI topInsight 도출 (Opus 4.7 활용)
  const memories = await listMemories(pool, companyId, { limit: 10 });
  const memorySnippet = memories.map(m => m.content).join('\n').slice(0, 1000);

  const systemPrompt = `당신은 모바일 DM 마케팅 진단 전문가입니다. 회사 컨텍스트와 5 factor 분석 결과를 기반으로 가장 시급한 개선 한 줄 (15~25자) 을 출력합니다.

**절대 금지:**
- 구체 혜택 (%/원/쿠폰/무료/사은품) 제시 금지
- 모델명 / AI 도구명 노출 금지

**출력 형식 (JSON):**
{ "top_insight": "..." }`;

  const userPrompt = `회사 메모리:
${memorySnippet}

5 factor 결과:
- CTR: ${ctr.status} (${ctr.score}점) — ${ctr.short_message}
- 디자인 일관성: ${design.status} (${design.score}점) — ${design.short_message}
- 광고 표기: ${adLabel.status} (${adLabel.score}점) — ${adLabel.short_message}
- 변수 정합: ${variable.status} (${variable.score}점) — ${variable.short_message}
- 섹션 순서: ${order.status} (${order.score}점) — ${order.short_message}

가장 시급한 개선 한 줄 출력.`;

  let topInsight = '발송 데이터 누적 후 분석 가능';
  try {
    const aiResult = await callAIWithFallback({
      model: 'opus',
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 200,
      response_format: 'json',
    });
    const parsed = JSON.parse(aiResult.content);
    if (parsed.top_insight && typeof parsed.top_insight === 'string') {
      topInsight = parsed.top_insight.slice(0, 30);
    }
  } catch (err) {
    console.warn('[dm-self-diagnosis] AI top_insight 실패:', err);
  }

  // 추천 액션 도출
  const recommendedActions: DmSelfDiagnosisResult['recommended_actions'] = [];
  if (variable.status !== 'good') recommendedActions.push({ action: 'variable_consistency', priority: 'high', reason: variable.short_message });
  if (design.status !== 'good') recommendedActions.push({ action: 'design_align', priority: 'medium', reason: design.short_message });
  if (ctr.status === 'critical') recommendedActions.push({ action: 'ai_refine', priority: 'high', reason: 'CTR 낮음 — 카피 개선 권장' });

  // last_diagnosed_at 갱신
  await pool.query(`UPDATE dm_pages SET last_diagnosed_at = NOW() WHERE id = $1`, [campaignId]);

  return {
    campaign_id: campaignId,
    overall_score: overall,
    factors,
    top_insight: topInsight,
    recommended_actions: recommendedActions,
    diagnosed_at: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: tsc 검증**

Run: `cd ~/targetup-app/packages/backend && npm run build:safe`
Expected: 0 errors.

- [ ] **Step 5: 자가 grep 검증**

Run: `grep -nE "박음|박힘|박지|박는|박을|박혀|박힌|박혔|Opus|Sonnet|GPT|Claude|alert\(|confirm\(|prompt\(" packages/backend/src/utils/dm/dm-self-diagnosis.ts`
Expected: 0 matches.

---

## Task 4: CT-87 dm-quick-action 신설 (3 액션 1-click)

**Files:**
- Create: `packages/backend/src/utils/dm/dm-quick-action.ts`

- [ ] **Step 1: 인터페이스 정의**

```typescript
import { Pool } from 'pg';
import { callAIWithFallback } from '../ai-fallback';
import type { SectionType, SectionPropsMap } from './dm-section-registry';

export type QuickActionType = 'ai_refine' | 'design_align' | 'variable_consistency';

export interface QuickActionResult {
  action: QuickActionType;
  campaign_id: string;
  changes: Array<{
    section_id: string;
    section_type: SectionType;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    reason: string;
  }>;
  applied_at: string;
}
```

- [ ] **Step 2: ai_refine 액션 (전체 카피 다듬기)**

```typescript
async function refineAllCopy(pool: Pool, companyId: string, campaignId: string): Promise<QuickActionResult> {
  const result = await pool.query(`SELECT sections FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections = result.rows[0]?.sections || [];

  const changes: QuickActionResult['changes'] = [];

  for (const sec of sections) {
    const text = extractEditableText(sec);
    if (!text || text.length < 5) continue;

    const systemPrompt = `당신은 모바일 DM 카피라이터입니다. 원본 카피를 한국 마케팅 톤 (감성 + 실용) 으로 다듬습니다.

**절대 금지:**
- 원본에 없는 정보 (할인율 / 가격 / 일자 / 매장명) 추가 금지
- 구체 혜택 (%/원/쿠폰/무료/사은품/적립/무료배송/할인) 임의 생성 금지
- 이모지 (유니코드) 추가 금지 — SMS 호환 특수문자만
- 변수 (% 감싸기) 형식 보존 의무

원본에 변수가 있으면 그대로 보존. 길이 80~150% 허용.

**출력 형식 (JSON):**
{ "refined": "..." }`;

    try {
      const aiResult = await callAIWithFallback({
        model: 'opus',
        system: systemPrompt,
        messages: [{ role: 'user', content: `원본: ${text}` }],
        max_tokens: 300,
        response_format: 'json',
      });
      const parsed = JSON.parse(aiResult.content);
      if (parsed.refined && typeof parsed.refined === 'string') {
        const newProps = applyRefinedText(sec, parsed.refined);
        changes.push({
          section_id: sec.id,
          section_type: sec.type,
          before: sec.props,
          after: newProps,
          reason: '카피 톤 정합 다듬기',
        });
      }
    } catch (err) {
      console.warn(`[dm-quick-action] refine 실패 section_id=${sec.id}:`, err);
    }
  }

  return {
    action: 'ai_refine',
    campaign_id: campaignId,
    changes,
    applied_at: new Date().toISOString(),
  };
}

function extractEditableText(sec: any): string {
  switch (sec.type) {
    case 'header': return sec.props?.title || '';
    case 'hero': return `${sec.props?.headline || ''} ${sec.props?.sub_copy || ''}`.trim();
    case 'text_card': return `${sec.props?.headline || ''} ${sec.props?.body || ''}`.trim();
    case 'cta': return sec.props?.buttons?.map((b: any) => b.label).join(' / ') || '';
    case 'footer': return sec.props?.text || '';
    default: return '';
  }
}

function applyRefinedText(sec: any, refined: string): Record<string, unknown> {
  switch (sec.type) {
    case 'header': return { ...sec.props, title: refined };
    case 'hero': {
      const lines = refined.split('\n').filter(l => l.trim());
      return { ...sec.props, headline: lines[0] || sec.props?.headline, sub_copy: lines.slice(1).join('\n') || sec.props?.sub_copy };
    }
    case 'text_card': {
      const lines = refined.split('\n').filter(l => l.trim());
      return { ...sec.props, headline: lines[0] || sec.props?.headline, body: lines.slice(1).join('\n') || sec.props?.body };
    }
    case 'footer': return { ...sec.props, text: refined };
    default: return sec.props;
  }
}
```

- [ ] **Step 3: design_align 액션 (브랜드 킷 색상 정합화)**

```typescript
async function alignDesign(pool: Pool, campaignId: string): Promise<QuickActionResult> {
  const result = await pool.query(`SELECT sections, brand_kit FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections = result.rows[0]?.sections || [];
  const brandKit = result.rows[0]?.brand_kit || {};

  const changes: QuickActionResult['changes'] = [];

  for (const sec of sections) {
    const newProps = { ...sec.props };
    let modified = false;

    if (sec.type === 'header' && brandKit.primary_color && newProps.background_color !== brandKit.primary_color) {
      newProps.background_color = brandKit.primary_color;
      modified = true;
    }
    if (sec.type === 'cta' && brandKit.accent_color && newProps.buttons) {
      newProps.buttons = newProps.buttons.map((b: any) => ({
        ...b,
        background_color: b.variant === 'primary' ? brandKit.accent_color : b.background_color,
      }));
      modified = true;
    }
    if (sec.type === 'footer' && brandKit.neutral_color && newProps.background_color !== brandKit.neutral_color) {
      newProps.background_color = brandKit.neutral_color;
      modified = true;
    }

    if (modified) {
      changes.push({
        section_id: sec.id,
        section_type: sec.type,
        before: sec.props,
        after: newProps,
        reason: '브랜드 킷 색상 정합화',
      });
    }
  }

  return {
    action: 'design_align',
    campaign_id: campaignId,
    changes,
    applied_at: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: variable_consistency 액션 (변수 fallback 자동 추가)**

```typescript
async function ensureVariableConsistency(pool: Pool, campaignId: string): Promise<QuickActionResult> {
  const result = await pool.query(`SELECT sections FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections = result.rows[0]?.sections || [];

  const FALLBACK_MAP: Record<string, string> = {
    name: '고객님',
    grade: '회원',
    store: '매장',
    last_purchase_date: '최근',
  };

  const changes: QuickActionResult['changes'] = [];

  for (const sec of sections) {
    const text = JSON.stringify(sec.props || {});
    const vars = text.match(/%([^%\s]+)%/g) || [];
    if (vars.length === 0) continue;

    const existingFallbacks: any[] = sec.props?.variable_fallbacks || [];
    const newFallbacks = [...existingFallbacks];
    let modified = false;

    for (const varTag of vars) {
      const varName = varTag.replace(/%/g, '');
      if (!existingFallbacks.some(f => f.variable === varName)) {
        newFallbacks.push({
          variable: varName,
          fallback: FALLBACK_MAP[varName] || '',
        });
        modified = true;
      }
    }

    if (modified) {
      changes.push({
        section_id: sec.id,
        section_type: sec.type,
        before: sec.props,
        after: { ...sec.props, variable_fallbacks: newFallbacks },
        reason: '변수 fallback 자동 추가',
      });
    }
  }

  return {
    action: 'variable_consistency',
    campaign_id: campaignId,
    changes,
    applied_at: new Date().toISOString(),
  };
}
```

- [ ] **Step 5: 메인 함수 + DB 반영**

```typescript
export async function applyQuickAction(
  pool: Pool,
  companyId: string,
  campaignId: string,
  action: QuickActionType,
): Promise<QuickActionResult> {
  let result: QuickActionResult;
  switch (action) {
    case 'ai_refine':           result = await refineAllCopy(pool, companyId, campaignId); break;
    case 'design_align':        result = await alignDesign(pool, campaignId); break;
    case 'variable_consistency': result = await ensureVariableConsistency(pool, campaignId); break;
    default: throw new Error(`알 수 없는 액션: ${action}`);
  }

  if (result.changes.length === 0) return result;

  // DB 반영
  const dbResult = await pool.query(`SELECT sections FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections = dbResult.rows[0]?.sections || [];

  const updated = sections.map((sec: any) => {
    const change = result.changes.find(c => c.section_id === sec.id);
    return change ? { ...sec, props: change.after } : sec;
  });

  await pool.query(
    `UPDATE dm_pages SET sections = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(updated), campaignId],
  );

  return result;
}
```

- [ ] **Step 6: tsc + 자가 grep 검증**

Run: `cd ~/targetup-app/packages/backend && npm run build:safe`
Run: `grep -nE "박음|박힘|박지|박는|박을|박혀|박힌|박혔|Opus|Sonnet|GPT|Claude" packages/backend/src/utils/dm/dm-quick-action.ts`
Expected: 0 errors / 0 matches.

---

## Task 5: CT-88 dm-event-recommender 신설 (이벤트 종류 추천)

**Files:**
- Create: `packages/backend/src/utils/dm/dm-event-recommender.ts`

- [ ] **Step 1: 인터페이스 + 시즌 매핑**

```typescript
import { Pool } from 'pg';
import { callAIWithFallback } from '../ai-fallback';
import { listMemories } from '../company-memory';

export type EventCategory = 'lucky_draw' | 'roulette' | 'instant_coupon' | 'limited_quantity' | 'poll' | 'survey' | 'email_capture';

export interface EventRecommendation {
  event_type: EventCategory;
  reason: string;
  expected_engagement: 'high' | 'medium' | 'low';
  quick_start_scenario?: string;
  default_section_chain: string[];
}

const SEASON_BY_MONTH: Record<number, string[]> = {
  1: ['신년', '새해', '복', '시무식'],
  2: ['설날', '발렌타인', '봄맞이'],
  3: ['봄', '입학', '꽃샘추위'],
  4: ['봄꽃', '벚꽃', '식목일'],
  5: ['어버이날', '어린이날', '가정의달', '봄여행'],
  6: ['초여름', '현충일', '여름맞이'],
  7: ['장마', '여름', '휴가'],
  8: ['휴가', '광복절', '늦여름'],
  9: ['추석', '가을', '환절기'],
  10: ['단풍', '가을여행', '핼러윈'],
  11: ['김장', '늦가을', '블랙프라이데이'],
  12: ['크리스마스', '연말', '송년'],
};
```

- [ ] **Step 2: 메인 함수 작성**

```typescript
export async function recommendEventType(
  pool: Pool,
  companyId: string,
  context: { campaign_goal?: string; target_audience?: string; budget_level?: 'low' | 'medium' | 'high' } = {},
): Promise<EventRecommendation> {
  const month = new Date().getMonth() + 1;
  const seasonKeywords = SEASON_BY_MONTH[month] || [];

  const memories = await listMemories(pool, companyId, { limit: 8, types: ['success_pattern', 'channel_performance'] });
  const memorySnippet = memories.map(m => m.content).join('\n').slice(0, 1200);

  const customerStats = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new_customers_30d,
      COUNT(*) FILTER (WHERE last_purchase_date >= NOW() - INTERVAL '90 days') AS active_customers,
      COUNT(*) AS total
    FROM customers
    WHERE company_id = $1
  `, [companyId]);

  const stats = customerStats.rows[0] || {};

  const systemPrompt = `당신은 모바일 DM 이벤트 추천 전문가입니다. 회사 데이터 + 시즌 + 캠페인 목표를 종합하여 가장 효과 클 이벤트 1건을 추천합니다.

**선택지:**
- lucky_draw (추첨) — 리드 발굴 강력 / 응모 form 활용
- roulette (룰렛) — 참여 강력 / 즉시 보상 / 신규 고객 환영
- instant_coupon (즉시 쿠폰) — 직접 매출 직결 / 활성 고객 재구매
- limited_quantity (선착순) — 긴급감 강력 / VIP 인기
- poll (투표) — 참여 가볍게 / 인사이트 발굴
- survey (설문) — 깊은 인사이트 / 보상 시 효과
- email_capture (이메일 수집) — 리드 발굴 / 동의 기반

**절대 금지:**
- 구체 혜택 제시 (%/원/쿠폰) 금지 — 회사 admin 직접 작성
- 모델명 노출 금지

**출력 형식 (JSON):**
{ "event_type": "...", "reason": "...", "expected_engagement": "high|medium|low", "default_section_chain": ["header", "...", "footer"] }`;

  const userPrompt = `회사 데이터:
- 신규 고객 30일: ${stats.new_customers_30d || 0}
- 활성 고객 (90일 구매): ${stats.active_customers || 0}
- 전체 고객: ${stats.total || 0}

시즌: ${seasonKeywords.join(', ')}
캠페인 목표: ${context.campaign_goal || '미지정'}
타겟: ${context.target_audience || '전체'}
예산: ${context.budget_level || 'medium'}

회사 메모리:
${memorySnippet}

이벤트 추천 1건 출력.`;

  try {
    const aiResult = await callAIWithFallback({
      model: 'opus',
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 500,
      response_format: 'json',
    });

    const parsed = JSON.parse(aiResult.content);
    if (!parsed.event_type || !['lucky_draw', 'roulette', 'instant_coupon', 'limited_quantity', 'poll', 'survey', 'email_capture'].includes(parsed.event_type)) {
      return defaultRecommendation();
    }
    return {
      event_type: parsed.event_type,
      reason: String(parsed.reason || '시즌 + 회사 데이터 정합 추천'),
      expected_engagement: parsed.expected_engagement || 'medium',
      default_section_chain: Array.isArray(parsed.default_section_chain) ? parsed.default_section_chain : ['header', parsed.event_type, 'cta', 'footer'],
    };
  } catch (err) {
    console.warn('[dm-event-recommender] AI 추천 실패:', err);
    return defaultRecommendation();
  }
}

function defaultRecommendation(): EventRecommendation {
  return {
    event_type: 'instant_coupon',
    reason: '안전한 default — 회사 admin 직접 혜택 작성 의무',
    expected_engagement: 'medium',
    default_section_chain: ['header', 'hero', 'instant_coupon', 'cta', 'footer'],
  };
}
```

- [ ] **Step 3: tsc + 자가 grep 검증**

Run: `cd ~/targetup-app/packages/backend && npm run build:safe`
Run: `grep -nE "박음|박힘|박지|박는|박을|박혀|박힌|박혔|Opus|Sonnet|GPT|Claude" packages/backend/src/utils/dm/dm-event-recommender.ts`
Expected: 0 errors / 0 matches.

---

## Task 6: CT-89 dm-section-suggester 신설 (다음 섹션 자동 추천)

**Files:**
- Create: `packages/backend/src/utils/dm/dm-section-suggester.ts`

- [ ] **Step 1: 규칙 기반 + AI 보조 추천**

```typescript
import { Pool } from 'pg';
import { callAIWithFallback } from '../ai-fallback';
import type { SectionType } from './dm-section-registry';

export interface SectionSuggestion {
  next_section_type: SectionType;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

// 규칙 기반 매트릭스 — Notion 동급 직접 흐름 추천
const NEXT_SECTION_RULES: Record<SectionType, SectionType[]> = {
  header: ['hero', 'product_carousel', 'countdown'],
  hero: ['product_carousel', 'text_card', 'cta', 'gallery'],
  coupon: ['cta', 'text_card', 'instant_coupon'],
  countdown: ['hero', 'cta', 'instant_coupon'],
  text_card: ['cta', 'product_carousel', 'gallery'],
  cta: ['footer', 'sns', 'store_info'],
  video: ['text_card', 'cta'],
  store_info: ['sns', 'footer'],
  sns: ['footer'],
  promo_code: ['cta', 'footer'],
  footer: [],
  product_carousel: ['cta', 'reviews', 'gallery'],
  gallery: ['cta', 'text_card'],
  slideshow: ['cta', 'text_card'],
  tab_cards: ['cta', 'product_carousel'],
  poll: ['cta', 'text_card'],
  survey: ['cta', 'footer'],
  email_capture: ['cta', 'footer'],
  click_rewards: ['cta', 'footer'],
  lucky_draw: ['cta', 'footer'],
  roulette: ['cta', 'footer'],
  instant_coupon: ['cta', 'footer'],
  limited_quantity: ['cta', 'footer'],
  youtube_embed: ['text_card', 'cta'],
  instagram_embed: ['cta'],
  map_store_locator: ['store_info', 'sns', 'footer'],
  reviews: ['cta', 'footer'],
};

export async function suggestNextSection(
  pool: Pool,
  companyId: string,
  campaignId: string,
): Promise<SectionSuggestion[]> {
  const result = await pool.query(`SELECT sections FROM dm_pages WHERE id = $1`, [campaignId]);
  const sections = result.rows[0]?.sections || [];

  if (sections.length === 0) {
    return [{ next_section_type: 'header', reason: '모든 DM은 헤더부터 시작', confidence: 'high' }];
  }

  const lastType = sections[sections.length - 1].type as SectionType;
  const ruleCandidates = NEXT_SECTION_RULES[lastType] || [];

  const existingTypes = new Set(sections.map((s: any) => s.type));
  const filteredCandidates = ruleCandidates.filter(t => !existingTypes.has(t) || ['cta', 'text_card', 'product_carousel'].includes(t));

  const suggestions: SectionSuggestion[] = filteredCandidates.slice(0, 3).map((type, idx) => ({
    next_section_type: type,
    reason: `${lastType} 다음 직접 흐름`,
    confidence: idx === 0 ? 'high' : 'medium',
  }));

  return suggestions.length > 0 ? suggestions : [{ next_section_type: 'footer', reason: '마무리 영역', confidence: 'low' }];
}
```

- [ ] **Step 2: tsc + 자가 grep 검증**

Run: `cd ~/targetup-app/packages/backend && npm run build:safe`
Expected: 0 errors.

---

## Task 7: CT-90 dm-personalization-engine 신설 (Liquid 변수 자동 추천)

**Files:**
- Create: `packages/backend/src/utils/dm/dm-personalization-engine.ts`

- [ ] **Step 1: 변수 매핑 + 추천**

```typescript
import { Pool } from 'pg';

export interface PersonalizationVariable {
  variable: string;
  label: string;
  category: 'customer_basic' | 'customer_purchase' | 'customer_grade' | 'campaign_context' | 'company_info';
  example_value?: string;
  default_fallback: string;
  recommended_sections: string[];
}

const VARIABLE_REGISTRY: PersonalizationVariable[] = [
  { variable: 'name', label: '고객 이름', category: 'customer_basic', example_value: '홍길동', default_fallback: '고객님', recommended_sections: ['header', 'hero', 'text_card', 'cta'] },
  { variable: 'phone', label: '전화번호', category: 'customer_basic', example_value: '010-1234-5678', default_fallback: '', recommended_sections: ['store_info'] },
  { variable: 'email', label: '이메일', category: 'customer_basic', default_fallback: '', recommended_sections: ['footer'] },
  { variable: 'grade', label: '등급', category: 'customer_grade', example_value: 'VIP', default_fallback: '회원', recommended_sections: ['header', 'hero', 'text_card'] },
  { variable: 'recent_purchase_date', label: '최근 구매일', category: 'customer_purchase', example_value: '2026-04-15', default_fallback: '최근', recommended_sections: ['text_card'] },
  { variable: 'purchase_count', label: '구매 횟수', category: 'customer_purchase', default_fallback: '', recommended_sections: ['text_card'] },
  { variable: 'total_purchase', label: '누적 구매액', category: 'customer_purchase', default_fallback: '', recommended_sections: ['text_card'] },
  { variable: 'last_visit_store', label: '최근 방문 매장', category: 'customer_purchase', default_fallback: '매장', recommended_sections: ['store_info', 'text_card'] },
  { variable: 'birthday_month', label: '생월', category: 'customer_basic', default_fallback: '', recommended_sections: ['hero', 'text_card'] },
  { variable: 'company_name', label: '회사명', category: 'company_info', default_fallback: '저희', recommended_sections: ['header', 'footer'] },
];

export async function getPersonalizationVariables(
  pool: Pool,
  companyId: string,
  context: { section_type?: string; current_text?: string } = {},
): Promise<PersonalizationVariable[]> {
  const customColumns = await pool.query(`
    SELECT
      jsonb_object_keys(custom_fields) AS field_name,
      COUNT(*) AS usage_count
    FROM customers
    WHERE company_id = $1 AND custom_fields IS NOT NULL AND custom_fields != '{}'::jsonb
    GROUP BY field_name
    ORDER BY usage_count DESC
    LIMIT 20
  `, [companyId]);

  const customVars: PersonalizationVariable[] = customColumns.rows.map(row => ({
    variable: row.field_name,
    label: `사용자 정의: ${row.field_name}`,
    category: 'customer_basic' as const,
    default_fallback: '',
    recommended_sections: ['text_card', 'hero'],
  }));

  const allVars = [...VARIABLE_REGISTRY, ...customVars];

  if (context.section_type) {
    return allVars.filter(v => v.recommended_sections.includes(context.section_type!));
  }

  return allVars;
}
```

- [ ] **Step 2: tsc + 자가 grep 검증**

Run: `cd ~/targetup-app/packages/backend && npm run build:safe`
Expected: 0 errors.

---

## Task 8: routes/dm.ts 신규 endpoint 8건 + 503 안전망

**Files:**
- Modify: `packages/backend/src/routes/dm.ts` (258줄 → 380+줄)

- [ ] **Step 1: import 추가**

```typescript
import { selfDiagnoseDm } from '../utils/dm/dm-self-diagnosis';
import { applyQuickAction, type QuickActionType } from '../utils/dm/dm-quick-action';
import { recommendEventType } from '../utils/dm/dm-event-recommender';
import { suggestNextSection } from '../utils/dm/dm-section-suggester';
import { getPersonalizationVariables } from '../utils/dm/dm-personalization-engine';
```

- [ ] **Step 2: 503 안전망 helper 추가**

```typescript
function isDbMigrationPendingError(err: any): boolean {
  const msg = err?.message || '';
  return msg.includes('column') && msg.includes('does not exist');
}

function send503Migration(res: any, requiredAlter: string) {
  return res.status(503).json({
    success: false,
    error: `DB 마이그레이션 필요 — 운영자에게 ${requiredAlter} 실행 요청 의무`,
    code: 'DB_MIGRATION_PENDING',
  });
}
```

- [ ] **Step 3: POST /dm/:id/self-diagnose**

```typescript
dmRouter.post('/:id/self-diagnose', authenticate, async (req, res) => {
  try {
    const companyId = (req as any).user.companyId;
    const campaignId = req.params.id;
    const result = await selfDiagnoseDm(pool, companyId, campaignId);
    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[POST /dm/:id/self-diagnose]', err);
    if (isDbMigrationPendingError(err)) {
      return send503Migration(res, 'dm_pages ALTER 4 + dm_event_responses CREATE');
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});
```

- [ ] **Step 4: POST /dm/:id/quick-action**

```typescript
dmRouter.post('/:id/quick-action', authenticate, async (req, res) => {
  try {
    const companyId = (req as any).user.companyId;
    const campaignId = req.params.id;
    const { action } = req.body as { action: QuickActionType };
    if (!['ai_refine', 'design_align', 'variable_consistency'].includes(action)) {
      return res.status(400).json({ success: false, error: '알 수 없는 액션' });
    }
    const result = await applyQuickAction(pool, companyId, campaignId, action);
    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[POST /dm/:id/quick-action]', err);
    if (isDbMigrationPendingError(err)) {
      return send503Migration(res, 'dm_pages ALTER 4 + dm_event_responses CREATE');
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});
```

- [ ] **Step 5: POST /dm/event-recommend**

```typescript
dmRouter.post('/event-recommend', authenticate, async (req, res) => {
  try {
    const companyId = (req as any).user.companyId;
    const { campaign_goal, target_audience, budget_level } = req.body || {};
    const result = await recommendEventType(pool, companyId, { campaign_goal, target_audience, budget_level });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[POST /dm/event-recommend]', err);
    if (isDbMigrationPendingError(err)) {
      return send503Migration(res, 'dm_pages ALTER 4 + dm_event_responses CREATE');
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});
```

- [ ] **Step 6: GET /dm/:id/section-suggest**

```typescript
dmRouter.get('/:id/section-suggest', authenticate, async (req, res) => {
  try {
    const companyId = (req as any).user.companyId;
    const campaignId = req.params.id;
    const result = await suggestNextSection(pool, companyId, campaignId);
    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[GET /dm/:id/section-suggest]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});
```

- [ ] **Step 7: GET /dm/personalization-vars**

```typescript
dmRouter.get('/personalization-vars', authenticate, async (req, res) => {
  try {
    const companyId = (req as any).user.companyId;
    const section_type = req.query.section_type as string | undefined;
    const result = await getPersonalizationVariables(pool, companyId, { section_type });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[GET /dm/personalization-vars]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});
```

- [ ] **Step 8: GET /dm/overview**

```typescript
dmRouter.get('/overview', authenticate, async (req, res) => {
  try {
    const companyId = (req as any).user.companyId;
    const result = await pool.query(`
      SELECT
        COUNT(DISTINCT dp.id) AS total_dm,
        COUNT(DISTINCT dp.id) FILTER (WHERE dp.approval_status = 'published') AS active_dm,
        COUNT(DISTINCT dv.id) AS total_views_30d,
        COUNT(DISTINCT der.id) AS total_interactions_30d,
        COALESCE(AVG(CASE WHEN dv_inner.view_count > 0 THEN (der_inner.interaction_count::float / dv_inner.view_count) * 100 END), 0) AS avg_ctr
      FROM dm_pages dp
      LEFT JOIN dm_views dv ON dv.dm_id = dp.id AND dv.viewed_at >= NOW() - INTERVAL '30 days'
      LEFT JOIN dm_event_responses der ON der.campaign_id = dp.id AND der.occurred_at >= NOW() - INTERVAL '30 days'
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS view_count FROM dm_views WHERE dm_id = dp.id AND viewed_at >= NOW() - INTERVAL '30 days'
      ) dv_inner ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS interaction_count FROM dm_event_responses WHERE campaign_id = dp.id AND occurred_at >= NOW() - INTERVAL '30 days'
      ) der_inner ON true
      WHERE dp.company_id = $1
    `, [companyId]);

    return res.json({ success: true, data: result.rows[0] });
  } catch (err: any) {
    console.error('[GET /dm/overview]', err);
    if (isDbMigrationPendingError(err)) {
      return send503Migration(res, 'dm_event_responses CREATE');
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});
```

- [ ] **Step 9: GET /dm/top-campaigns**

```typescript
dmRouter.get('/top-campaigns', authenticate, async (req, res) => {
  try {
    const companyId = (req as any).user.companyId;
    const limit = Math.min(Number(req.query.limit) || 10, 50);

    const result = await pool.query(`
      SELECT
        dp.id,
        dp.title,
        dp.approval_status,
        COUNT(DISTINCT dv.id) AS view_count,
        COUNT(DISTINCT der.id) AS interaction_count,
        CASE WHEN COUNT(DISTINCT dv.id) > 0
          THEN (COUNT(DISTINCT der.id)::float / COUNT(DISTINCT dv.id)) * 100
          ELSE 0
        END AS ctr
      FROM dm_pages dp
      LEFT JOIN dm_views dv ON dv.dm_id = dp.id AND dv.viewed_at >= NOW() - INTERVAL '30 days'
      LEFT JOIN dm_event_responses der ON der.campaign_id = dp.id AND der.occurred_at >= NOW() - INTERVAL '30 days'
      WHERE dp.company_id = $1
      GROUP BY dp.id, dp.title, dp.approval_status
      HAVING COUNT(DISTINCT dv.id) > 0
      ORDER BY ctr DESC, view_count DESC
      LIMIT $2
    `, [companyId, limit]);

    return res.json({ success: true, data: result.rows });
  } catch (err: any) {
    console.error('[GET /dm/top-campaigns]', err);
    if (isDbMigrationPendingError(err)) {
      return send503Migration(res, 'dm_event_responses CREATE');
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});
```

- [ ] **Step 10: POST /dm/event-response (public + SDK 호출)**

`/api/dm/v/:code/event-response` 패턴으로 public router에 추가:

```typescript
// 공개 router (authenticate 없음)
publicDmRouter.post('/:code/event-response', async (req, res) => {
  try {
    const { code } = req.params;
    const { section_id, section_type, response_data, anonymous_id, customer_id } = req.body || {};

    if (!section_id || !section_type) {
      return res.status(400).json({ success: false, error: 'section_id / section_type 필수' });
    }

    const dmResult = await pool.query(`SELECT id, company_id FROM dm_pages WHERE short_code = $1`, [code]);
    if (dmResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'DM 미발견' });
    }

    const { id: campaignId, company_id: companyId } = dmResult.rows[0];

    await pool.query(`
      INSERT INTO dm_event_responses
        (company_id, campaign_id, section_id, section_type, customer_id, anonymous_id, response_data, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      companyId, campaignId, section_id, section_type,
      customer_id || null, anonymous_id || null,
      JSON.stringify(response_data || {}),
      req.ip || null,
      req.headers['user-agent'] || null,
    ]);

    return res.json({ success: true });
  } catch (err: any) {
    console.error('[POST /dm/v/:code/event-response]', err);
    if (isDbMigrationPendingError(err)) {
      return send503Migration(res, 'dm_event_responses CREATE');
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});
```

- [ ] **Step 11: tsc + 자가 grep 검증**

Run: `cd ~/targetup-app/packages/backend && npm run build:safe`
Run: `grep -nE "박음|박힘|박지|박는|박을|박혀|박힌|박혔|Opus|Sonnet|GPT|Claude|alert\(|confirm\(|prompt\(" packages/backend/src/routes/dm.ts`
Expected: 0 errors / 0 matches.

---

## Task 9: dmBuilderStore undo/redo + history stack 신설

**Files:**
- Modify: `packages/frontend/src/stores/dmBuilderStore.ts` (653줄 → 800+줄)

- [ ] **Step 1: 기존 store 정독 + 매핑 (의무)**

옛 store 정확한 state 매핑 후 history stack 추가 진입.

- [ ] **Step 2: history state 추가**

```typescript
interface DmBuilderHistory {
  past: Array<{ sections: Section[]; timestamp: number }>;
  future: Array<{ sections: Section[]; timestamp: number }>;
}

interface DmBuilderState {
  // 옛 state 보존
  // ...
  history: DmBuilderHistory;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
}

const MAX_HISTORY_SIZE = 50;
```

- [ ] **Step 3: pushHistory 구현 (LRU + diff 저장)**

```typescript
pushHistory: () => set((state) => {
  const newPast = [...state.history.past, { sections: JSON.parse(JSON.stringify(state.sections)), timestamp: Date.now() }];
  if (newPast.length > MAX_HISTORY_SIZE) newPast.shift();
  return {
    history: { past: newPast, future: [] },
  };
}),
```

- [ ] **Step 4: undo 구현**

```typescript
undo: () => set((state) => {
  if (state.history.past.length === 0) return state;
  const previous = state.history.past[state.history.past.length - 1];
  const newPast = state.history.past.slice(0, -1);
  const newFuture = [{ sections: JSON.parse(JSON.stringify(state.sections)), timestamp: Date.now() }, ...state.history.future];
  return {
    sections: previous.sections,
    history: { past: newPast, future: newFuture },
    isDirty: true,
  };
}),
```

- [ ] **Step 5: redo 구현**

```typescript
redo: () => set((state) => {
  if (state.history.future.length === 0) return state;
  const next = state.history.future[0];
  const newFuture = state.history.future.slice(1);
  const newPast = [...state.history.past, { sections: JSON.parse(JSON.stringify(state.sections)), timestamp: Date.now() }];
  if (newPast.length > MAX_HISTORY_SIZE) newPast.shift();
  return {
    sections: next.sections,
    history: { past: newPast, future: newFuture },
    isDirty: true,
  };
}),
```

- [ ] **Step 6: 옛 액션 (addSection / removeSection / updateSectionProps / reorderSections / duplicateSection) 안 pushHistory 호출 추가**

각 액션의 set 직전에 `get().pushHistory()` 호출 삽입.

```typescript
addSection: (type) => {
  get().pushHistory();
  set((state) => ({
    sections: [...state.sections, createNewSection(type)],
    isDirty: true,
  }));
},
// ... 동일 패턴 5 액션
```

- [ ] **Step 7: canUndo / canRedo / clearHistory**

```typescript
canUndo: () => get().history.past.length > 0,
canRedo: () => get().history.future.length > 0,
clearHistory: () => set({ history: { past: [], future: [] } }),
```

- [ ] **Step 8: tsc + 자가 grep 검증**

Run: `cd ~/targetup-app/packages/frontend && npm run build:safe`
Run: `grep -nE "박음|박힘|박지|박는|박을|박혀|박힌|박혔|Opus|Sonnet|GPT|Claude" packages/frontend/src/stores/dmBuilderStore.ts`
Expected: 0 errors / 0 matches.

---

## Task 10: DmBuilderPage 편집 UX 강화 (WYSIWYG + 드래그 + 키보드)

**Files:**
- Modify: `packages/frontend/src/pages/DmBuilderPage.tsx`
- Modify: `packages/frontend/src/components/dm/InlineEditable.tsx`
- Modify: `packages/frontend/src/components/dm/SectionList.tsx`

- [ ] **Step 1: 키보드 단축키 hook 추가**

`packages/frontend/src/pages/DmBuilderPage.tsx`:

```typescript
import { useEffect } from 'react';
import { useDmBuilderStore } from '../stores/dmBuilderStore';

function useDmKeyboardShortcuts() {
  const { undo, redo, canUndo, canRedo, save, selectedSectionId, removeSection, setOpenModal } = useDmBuilderStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.matches('input, textarea, [contenteditable="true"]')) return;

      const isMac = navigator.platform.toLowerCase().includes('mac');
      const cmd = isMac ? e.metaKey : e.ctrlKey;

      if (cmd && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo()) undo();
      } else if (cmd && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (canRedo()) redo();
      } else if (cmd && e.key === 's') {
        e.preventDefault();
        save();
      } else if (cmd && e.key === 'k') {
        e.preventDefault();
        setOpenModal('section_search');
      } else if (e.key === 'Delete' && selectedSectionId) {
        e.preventDefault();
        removeSection(selectedSectionId);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, canUndo, canRedo, save, selectedSectionId, removeSection, setOpenModal]);
}
```

DmBuilderPage 컴포넌트 안 `useDmKeyboardShortcuts()` 호출 추가.

- [ ] **Step 2: 자동 저장 상태 표시 (DmTopBar)**

`packages/frontend/src/components/dm/DmTopBar.tsx`:

```typescript
import { useDmBuilderStore } from '../../stores/dmBuilderStore';

function AutoSaveIndicator() {
  const { isDirty, lastSavedAt, isSaving } = useDmBuilderStore();

  if (isSaving) {
    return (
      <span className="text-xs text-cyan-400 flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" /> 저장 중...
      </span>
    );
  }
  if (isDirty) {
    return <span className="text-xs text-amber-400">변경 사항 있음</span>;
  }
  if (lastSavedAt) {
    return <span className="text-xs text-emerald-400">저장됨</span>;
  }
  return null;
}
```

`<AutoSaveIndicator />` 컴포넌트 DmTopBar 안 추가.

- [ ] **Step 3: undo/redo 버튼 추가 (DmTopBar)**

```typescript
import { Undo2, Redo2 } from 'lucide-react';

function UndoRedoButtons() {
  const { undo, redo, canUndo, canRedo } = useDmBuilderStore();
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={undo}
        disabled={!canUndo()}
        title="Cmd+Z 실행 취소"
        className="p-1.5 rounded hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Undo2 className="w-4 h-4 text-white/70" />
      </button>
      <button
        onClick={redo}
        disabled={!canRedo()}
        title="Cmd+Y 다시 실행"
        className="p-1.5 rounded hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Redo2 className="w-4 h-4 text-white/70" />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: InlineEditable WYSIWYG 강화**

`packages/frontend/src/components/dm/InlineEditable.tsx`:

```typescript
import { useState, useRef, useEffect } from 'react';

interface Props {
  value: string;
  onChange: (next: string) => void;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
}

export function InlineEditable({ value, onChange, multiline = false, placeholder, className = '' }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing && ref.current) {
      ref.current.focus();
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [isEditing]);

  const handleBlur = () => {
    if (ref.current) {
      const next = ref.current.textContent || '';
      if (next !== value) onChange(next);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (ref.current) ref.current.textContent = value;
      setIsEditing(false);
    } else if (e.key === 'Enter' && !multiline && !e.shiftKey) {
      e.preventDefault();
      handleBlur();
    }
  };

  if (isEditing) {
    return (
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={`outline-none ring-2 ring-violet-500/50 rounded px-1 ${className}`}
        style={{ whiteSpace: multiline ? 'pre-wrap' : 'normal' }}
      >
        {value}
      </div>
    );
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      className={`cursor-text hover:bg-white/5 rounded px-1 ${className}`}
      title="클릭하여 편집"
    >
      {value || <span className="text-white/30">{placeholder || '클릭하여 입력'}</span>}
    </div>
  );
}
```

- [ ] **Step 5: SectionList 드래그 시각 피드백 강화**

`packages/frontend/src/components/dm/SectionList.tsx` 안 @dnd-kit DragOverlay + 회색 영역 + drop zone 시각 피드백:

```typescript
import { DragOverlay } from '@dnd-kit/core';

// ... 컴포넌트 안
<DragOverlay>
  {activeId ? (
    <div className="bg-violet-500/20 border-2 border-violet-500 border-dashed rounded-xl px-4 py-2 backdrop-blur">
      <span className="text-violet-200 text-sm font-medium">이동 중...</span>
    </div>
  ) : null}
</DragOverlay>
```

drop zone 안 hover 시 = `bg-violet-500/10 border-violet-500/30` 클래스 추가.

- [ ] **Step 6: tsc + 자가 grep 검증**

Run: `cd ~/targetup-app/packages/frontend && npm run build:safe`
Run: `grep -rnE "박음|박힘|박지|박는|박을|박혀|박힌|박혔|Opus|Sonnet|GPT|Claude|alert\(|confirm\(|prompt\(" packages/frontend/src/pages/DmBuilderPage.tsx packages/frontend/src/components/dm/`
Expected: 0 errors / 0 matches (native dialog 0건 + 모델명 0건 + 박-단어 0건).

---

## Task 11: 자가 검증 광범위 + 표준 종료 멘트

- [ ] **Step 1: backend tsc 0 errors 검증**

Run: `cd ~/targetup-app/packages/backend && npm run build:safe`
Expected: `Compiled successfully.` / 0 errors.

- [ ] **Step 2: frontend tsc 0 errors 검증**

Run: `cd ~/targetup-app/packages/frontend && npm run build:safe`
Expected: `Compiled successfully.` / 0 errors.

- [ ] **Step 3: 광범위 자가 grep 검증 (Backend + Frontend)**

```bash
# 박-단어 검증
grep -rnE "박음|박힘|박지|박는|박을|박혀|박힌|박혔|박았|박혀있" \
  packages/backend/src/utils/dm/ \
  packages/backend/src/routes/dm.ts \
  packages/frontend/src/pages/DmBuilderPage.tsx \
  packages/frontend/src/stores/dmBuilderStore.ts \
  packages/frontend/src/components/dm/
# 결과: 0 matches

# 모델명 검증
grep -rnE "Opus|Sonnet|GPT|Claude|Anthropic" \
  packages/frontend/src/pages/DmBuilderPage.tsx \
  packages/frontend/src/stores/dmBuilderStore.ts \
  packages/frontend/src/components/dm/
# 결과: 0 matches (frontend UI 노출 0건)

# native dialog 검증
grep -rnE "alert\(|confirm\(|prompt\(" \
  packages/frontend/src/pages/DmBuilderPage.tsx \
  packages/frontend/src/components/dm/
# 결과: 0 matches

# sudo 검증
grep -rn "sudo" packages/backend/src/utils/dm/ packages/backend/src/routes/dm.ts
# 결과: 0 matches

# 영역 / 본질 / 매트릭스 단어 자가 점검 (사용자 노출 영역)
grep -rnE "영역|본질|매트릭스" packages/frontend/src/pages/DmBuilderPage.tsx packages/frontend/src/components/dm/
# 결과: 코드 주석 한정 / UI 노출 0건 검증
```

- [ ] **Step 4: Codex Plugin adversarial-review 호출 의무 안내**

> Harold 직접 진행:
> `/codex:adversarial-review`
> (DB 마이그레이션 + 신규 5 AI 모듈 = Critical 영역 — `codex_review_after_code_change` 영구 룰 정합)

- [ ] **Step 5: 표준 종료 멘트 출력**

"작업이 완료되었습니다. Harold님, 직접 git add/commit/push 및 배포를 진행해 주세요."

배포 매핑:
1. PG SQL (Task 1) Harold 직접 실행
2. `tp-push "D216+ 모바일DM 강화 1 세션 — 27 섹션 + CT-86~90 + endpoint 8 + undo/redo + 편집 UX"` 명령어 활용
3. 서버 흐름 = git pull + backend build:safe + frontend build:safe + pm2 restart all
4. `/codex:adversarial-review` Harold 직접 호출 의무

---

## Self-Review

### 1. Spec coverage 확인

| 설계서 § | Plan task | 확인 |
|---|---|---|
| § 2-1 옛 11 섹션 | Task 2 (보존) | ✅ |
| § 2-2 신규 16 섹션 | Task 2 (Step 1~5) | ✅ |
| § 2-3 빠른 시작 7 시나리오 | 다음 세션 (frontend UI) | △ (2 세션) |
| § 3 편집 UX 6 영역 | Task 9 + Task 10 | ✅ (5 영역 / 실시간 협업 = 후순위) |
| § 3-3 undo/redo | Task 9 | ✅ |
| § 4 Journey Builder 동급 14 화면 | 다음 세션 | △ (2 세션) |
| § 5-1 옛 4 AI 모듈 보존 | Task 2 (정정 X) | ✅ |
| § 5-2 신규 5 AI 모듈 (CT-86~90) | Task 3~7 | ✅ |
| § 6-2 DB ALTER 4 컬럼 | Task 1 | ✅ |
| § 6-3 SectionType 확장 | Task 2 | ✅ |
| § 6-4 dm_event_responses 신설 | Task 1 | ✅ |
| § 7-2 endpoint 8건 | Task 8 | ✅ |
| § 9 검증 + 배포 | Task 11 | ✅ |
| § 10 영구 룰 정합 | 모든 Task | ✅ |

본 1 세션 = Backend + 편집 UX 영역 = § 8-1 정합. 2 세션 = 신규 16 섹션 frontend 렌더링 + Journey Builder 동급 14 화면 디자인 정합화 영역.

### 2. Placeholder scan

- "TBD" / "TODO" / "implement later" 검색 → 0건
- "Add appropriate error handling" → 0건 (모든 catch 영역 구체 명시)
- "Similar to Task N" → 0건 (각 task 코드 직접 작성됨)

### 3. Type consistency

- `SectionType` union = Task 2 정의 + Task 3~7 import 정합
- `QuickActionType` = Task 4 정의 + Task 8 import 정합
- `DmSelfDiagnosisResult` = Task 3 정의 + Task 8 응답 정합
- `EventRecommendation` = Task 5 정의 + Task 8 응답 정합
- `SectionSuggestion` = Task 6 정의 + Task 8 응답 정합
- `PersonalizationVariable` = Task 7 정의 + Task 8 응답 정합
- `DmBuilderHistory` / `MAX_HISTORY_SIZE` = Task 9 정의 + Task 10 UI 활용 정합

---

## 변경 이력

| 일자 | 변경 | 담당 |
|---|---|---|
| 2026-05-25 | 본 Plan 신설 (writing-plans skill 흐름 정합) | 본 AI |
