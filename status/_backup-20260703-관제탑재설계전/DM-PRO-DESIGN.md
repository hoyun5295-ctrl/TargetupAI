# 📱 한줄로AI 모바일 DM 빌더 프로모델 v1 — 통합 설계서

> **시작일:** 2026-04-16
> **포지션:** 한줄로AI 프로 요금제(월 100만원+) 핵심 차별화 기능
> **목표:** MVP가 아닌 **실전 프로모델** — "월 100만원 가치" 수준의 기능 + 디자인 완성도
> **이관:** D119의 슬라이드 기반 DM 빌더를 **섹션 기반 + AI 생성형 + 검수 내장** 실행 엔진으로 전면 재설계
> **원칙:** CLAUDE.md 0/4-2/4-7/4-9 준수 — 컨트롤타워 우선, 하드코딩 금지, 설계 → 구현 → 검증

---

## 📑 목차

1. [제품 정의 / 포지셔닝](#1-제품-정의--포지셔닝)
2. [핵심 설계 원칙](#2-핵심-설계-원칙)
3. [Gap 분석](#3-gap-분석)
4. [데이터 모델](#4-데이터-모델)
5. [API 설계](#5-api-설계)
6. [프론트 에디터 아키텍처](#6-프론트-에디터-아키텍처)
7. [섹션 시스템 (11종)](#7-섹션-시스템-11종)
8. [디자인 시스템](#8-디자인-시스템)
9. [AI 엔진 (4모듈)](#9-ai-엔진-4모듈)
10. [검수 엔진](#10-검수-엔진)
11. [개인화 변수 시스템](#11-개인화-변수-시스템)
12. [브랜드 킷](#12-브랜드-킷)
13. [버전 관리 + 승인](#13-버전-관리--승인)
14. [테스트 발송](#14-테스트-발송)
15. [마이그레이션 전략](#15-마이그레이션-전략)
16. [컨트롤타워 매핑](#16-컨트롤타워-매핑)
17. [구현 의존성 그래프](#17-구현-의존성-그래프)
18. [파일 구조](#18-파일-구조)
19. [완료 체크리스트](#19-완료-체크리스트)

---

## 1. 제품 정의 / 포지셔닝

### 1-1. 한 줄 요약

> **"한 줄 프롬프트로 DM 구조·카피·개인화·검수·발행까지 연결하는 AI 마케팅 실행 엔진"**

### 1-2. 경쟁 제품 대비 차별화

| 경쟁군 | 한줄로 DM 프로모델 차별화 |
|---|---|
| Canva/Miricanvas | **발송·개인화·검수 내장** (디자인툴 ≠ 마케팅 실행 엔진) |
| 스티비/메일러라이트 | **모바일 네이티브** + 카톡/문자 발송 파이프라인 직결 |
| Kakao 알림톡 빌더 | **자유로운 세로 스크롤 섹션** + AI 자동 구성 |
| 자체 MMS 제작 대행 | **한 줄 프롬프트로 5분 자동 생성** |

### 1-3. 타겟 사용자

- **1차:** 프로 요금제 구독 고객사 마케터 (뷰티/패션/식품 등 리테일 브랜드)
- **2차:** 중소 매장 점주 (직접 DM 발행)
- **3차:** 에이전시 (고객사 대행 발행)

### 1-4. 사용 시나리오 (핵심 플로우)

```
  [마케터]
     │
     ▼ 한 줄 프롬프트 입력
  "시세이도 봄 신상 프로모션, 30대 여성, 20% 할인, 오늘 자정 마감"
     │
     ▼ Prompt Parser → 구조화 스펙
  { brand, target, benefit, urgency, objective, personalization, tone }
     │
     ▼ Layout Recommender → 섹션 자동 구성
  [logo 헤더 / 히어로 / 쿠폰 / 카운트다운 / 텍스트카드 / CTA / 매장안내 / 하단]
     │
     ▼ Copy Generator → 각 섹션 카피 초안
     ▼ Variable Binder → %고객명% 등 개인화 변수 자동 삽입
     ▼ Brand Kit 적용 (로고/컬러/폰트)
     │
     ▼ 캔버스에 AI 초안 렌더링 (3~5초 내)
  [마케터] 문구 미세 조정, 이미지 교체, 섹션 순서 변경
     │
     ▼ [검수 버튼] → Validation Engine
  10개 영역 × 3등급 자동 검사 → 치명 오류 해결
     │
     ▼ [테스트 발송] → 담당자 번호로 SMS + DM 링크 송출
  샘플 고객 데이터 치환 렌더링 확인
     │
     ▼ [발행] → 즉시/예약/승인요청
  campaigns 발송 경로와 연결 (기존 5경로 재활용)
     │
     ▼ 성과 추적 (dm_views + section_interactions)
```

---

## 2. 핵심 설계 원칙

### 2-1. **빈 화면에서 시작하지 않는다**
사용자가 빈 캔버스 앞에서 고민하게 두지 않는다. 진입 시 **프롬프트 또는 템플릿** 두 옵션만 제공.

### 2-2. **자유배치가 아니라 제한형 섹션 편집**
Figma/자유형 에디터 거부. **11종의 사전 정의된 섹션**을 조합·순서변경·숨김·복제. 반응형/검수/품질 보장.

### 2-3. **미리보기가 아니라 캔버스가 중심**
우측 미리보기 패널 폐기. **중앙 모바일 캔버스가 곧 편집 무대** (WYSIWYG 직접 편집).

### 2-4. **개인화와 검수는 보조가 아니라 핵심**
디자인 툴이 아닌 **마케팅 실행 품질 보증 도구**. 변수 바인딩 + fallback + 10개 검수 영역 모두 필수.

### 2-5. **실전 디자인 품질 (프로모델 추가 원칙)**
- 타이포/컬러/스페이싱 토큰화 (하드코딩 금지)
- 11개 섹션 **업종별 3~5 스타일 변형**
- 애니메이션/마이크로 인터랙션 완성도 확보
- WCAG AA 대비 검증 + 320~430px 반응형 완벽 대응

---

## 3. Gap 분석

### 현재 (D119 기준)

| 파일 | 줄수 | 역할 |
|---|---|---|
| `utils/dm/dm-builder.ts` | 219 | CRUD + 단축URL + 추적 + 통계 |
| `utils/dm/dm-viewer.ts` | 291 | 뷰어 HTML 렌더러 (480px) |
| `routes/dm.ts` | 258 | API 라우트 |
| `pages/DmBuilderPage.tsx` | 663 | 프론트 에디터 (입력폼 기반) |

**한계:**
- 슬라이드 기반 (`pages[]`) — 순차 페이지 넘김 구조
- 4종 헤더 + 4종 푸터 + 4종 슬라이드 레이아웃 = 총 12개 고정 템플릿
- 입력폼 기반 편집 (캔버스 아님)
- AI 생성/변수/검수/브랜드킷/버전/승인 **전부 부재**

### 목표 (프로모델 v1)

- **섹션 기반 세로 스크롤 DM** (슬라이드 ↔ 세로스크롤 선택 가능)
- **11개 섹션 타입** × 업종별 3~5 스타일 변형 = 총 30~50개 디자인 프리셋
- **WYSIWYG 캔버스 직접 편집**
- **AI 4모듈** (Prompt Parser / Layout Recommender / Copy Generator / Validation)
- **개인화 변수 + fallback + 샘플 렌더링**
- **브랜드 킷 + 템플릿 7카테고리 + 버전 관리 + 승인 플로우**

---

## 4. 데이터 모델

### 4-1. 마이그레이션 실행 안내 (Harold님 직접 실행)

> **⚠️ SQL 파일 생성하지 않음.** OPS.md 기반 SSH → Docker psql 방식으로 Harold님이 직접 실행.
> 아래 블록을 그대로 복붙해 실행하시면 됩니다.

#### 📋 실행 순서

```bash
# ── 1) SSH 접속 ──
ssh administrator@58.227.193.62

# ── 2) 백업 (필수) ──
cd /home/administrator/targetup-app
BACKUP_FILE=backups/pre_dm_pro_$(date +%Y%m%d_%H%M).sql.gz
docker exec targetup-postgres pg_dump -U targetup targetup | gzip > $BACKUP_FILE
echo "백업 완료: $BACKUP_FILE"
ls -la $BACKUP_FILE

# ── 3) 마이그레이션 실행 (heredoc 일괄) ──
docker exec -i targetup-postgres psql -U targetup targetup << 'EOF'
BEGIN;

-- (a) dm_pages 7컬럼 확장
ALTER TABLE dm_pages
  ADD COLUMN IF NOT EXISTS sections          JSONB,
  ADD COLUMN IF NOT EXISTS brand_kit         JSONB,
  ADD COLUMN IF NOT EXISTS template_id       TEXT,
  ADD COLUMN IF NOT EXISTS ai_prompt         TEXT,
  ADD COLUMN IF NOT EXISTS layout_mode       TEXT DEFAULT 'scroll',
  ADD COLUMN IF NOT EXISTS validation_result JSONB,
  ADD COLUMN IF NOT EXISTS approval_status   TEXT DEFAULT 'draft';

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_dm_pages_approval ON dm_pages(company_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_dm_pages_template ON dm_pages(template_id);

-- 기존 데이터는 'slides' 모드로 표시 (하위호환)
UPDATE dm_pages SET layout_mode = 'slides'
 WHERE sections IS NULL AND pages IS NOT NULL;

-- (b) dm_versions 신설 (버전 관리)
CREATE TABLE IF NOT EXISTS dm_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dm_id           UUID NOT NULL REFERENCES dm_pages(id) ON DELETE CASCADE,
  version_label   TEXT NOT NULL,
  version_number  INT NOT NULL,
  sections        JSONB NOT NULL,
  brand_kit       JSONB,
  note            TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dm_versions_dm ON dm_versions(dm_id, version_number DESC);

-- (c) dm_templates 신설 (기본 제공 템플릿)
CREATE TABLE IF NOT EXISTS dm_templates (
  id              TEXT PRIMARY KEY,
  category        TEXT NOT NULL,
  industry        TEXT,
  name            TEXT NOT NULL,
  description     TEXT,
  thumbnail_url   TEXT,
  sections        JSONB NOT NULL,
  brand_kit       JSONB,
  popularity      INT DEFAULT 0,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dm_templates_category
  ON dm_templates(category, industry) WHERE is_active = TRUE;

-- (d) dm_views 섹션별 추적 컬럼
ALTER TABLE dm_views
  ADD COLUMN IF NOT EXISTS section_interactions JSONB;

COMMIT;
EOF

# ── 4) 검증 ──
docker exec targetup-postgres psql -U targetup targetup -c "\d dm_pages"
docker exec targetup-postgres psql -U targetup targetup -c "\d dm_versions"
docker exec targetup-postgres psql -U targetup targetup -c "\d dm_templates"
docker exec targetup-postgres psql -U targetup targetup -c "\d dm_views"

# 데이터 확인: 기존 dm_pages가 slides 모드로 표시되었는지
docker exec targetup-postgres psql -U targetup targetup \
  -c "SELECT layout_mode, COUNT(*) FROM dm_pages GROUP BY layout_mode;"
```

#### ♻️ 롤백 (문제 발생 시)

```bash
# 전체 롤백 (백업 복원)
gunzip -c $BACKUP_FILE | docker exec -i targetup-postgres psql -U targetup targetup

# 또는 부분 롤백 (신규 컬럼/테이블만 제거)
docker exec -i targetup-postgres psql -U targetup targetup << 'EOF'
BEGIN;
ALTER TABLE dm_pages
  DROP COLUMN IF EXISTS sections,
  DROP COLUMN IF EXISTS brand_kit,
  DROP COLUMN IF EXISTS template_id,
  DROP COLUMN IF EXISTS ai_prompt,
  DROP COLUMN IF EXISTS layout_mode,
  DROP COLUMN IF EXISTS validation_result,
  DROP COLUMN IF EXISTS approval_status;
ALTER TABLE dm_views DROP COLUMN IF EXISTS section_interactions;
DROP TABLE IF EXISTS dm_versions;
DROP TABLE IF EXISTS dm_templates;
COMMIT;
EOF
```

### 4-2. 컬럼 / 테이블 스펙 (참조용)

**`dm_pages` 확장 컬럼 7개:**

| 컬럼 | 타입 | 기본값 | 용도 |
|---|---|---|---|
| `sections` | JSONB | null | 섹션 배열 (신규 구조) |
| `brand_kit` | JSONB | null | 브랜드 토큰 (컬러/로고/폰트/톤) |
| `template_id` | TEXT | null | 시작 템플릿 참조 |
| `ai_prompt` | TEXT | null | 생성 프롬프트 원문 기록 |
| `layout_mode` | TEXT | `'scroll'` | `'scroll'` \| `'slides'` (하위호환) |
| `validation_result` | JSONB | null | 최근 검수 결과 |
| `approval_status` | TEXT | `'draft'` | `draft` \| `review` \| `approved` \| `published` |

**`dm_versions` 신규 테이블:** 버전 관리 (초안/AI/수정/검수/발행 단계별 스냅샷)

**`dm_templates` 신규 테이블:** 7카테고리 × 업종별 기본 제공 템플릿

**`dm_views` 확장 컬럼 1개:** `section_interactions` JSONB — 섹션별 체류/클릭 추적

### 4-3. 로컬 개발 환경 마이그레이션 (참고)

```bash
# 로컬 Docker PostgreSQL에도 동일하게 적용
docker exec -i targetup-postgres psql -U targetup targetup << 'EOF'
-- (위 상용 서버 마이그레이션 heredoc 동일 내용)
EOF
```

### 4-3. JSONB 스키마 정의

#### `dm_pages.sections` (섹션 배열)

```ts
type Section = {
  id: string;                    // uuid, DnD용 고유 키
  type: SectionType;             // 11개 중 하나
  order: number;                 // 0-indexed
  visible: boolean;              // 숨김 토글
  style_variant?: string;        // 업종별 스타일 변형 (예: 'beauty-elegant')
  props: SectionProps;           // 섹션 타입별 속성
  ai_locked?: boolean;           // AI 재생성 대상 제외
};

type SectionType =
  | 'header'          // 브랜드 로고 + 고객센터번호
  | 'hero'            // 풀 배너 + 메인 헤드라인 + 서브카피
  | 'coupon'          // 할인율 + 쿠폰코드 + 유효기간
  | 'countdown'       // 종료 시각 + 긴급성 문구
  | 'text_card'       // 헤드라인 + 본문 + 강조 태그
  | 'cta'             // 버튼 1~2개 + 링크
  | 'video'           // 썸네일 + 재생 버튼 + 랜딩
  | 'store_info'      // 전화 + 홈페이지 + 매장찾기
  | 'sns'             // 인스타/유튜브/카카오
  | 'promo_code'      // 프로모션 코드 + 사용안내
  | 'footer';         // 유의사항 + 고객센터 + 법정안내
```

#### `dm_pages.brand_kit` (브랜드 토큰)

```ts
type BrandKit = {
  logo_url?: string;
  primary_color: string;         // #4f46e5
  secondary_color?: string;
  accent_color?: string;
  neutral_color?: string;        // 본문 색
  background_color?: string;
  font_family?: string;          // 'Pretendard' | 'Noto Sans KR' | ...
  tone: 'premium' | 'friendly' | 'urgent' | 'elegant' | 'playful';
  contact?: {
    phone?: string;
    email?: string;
    website?: string;
  };
  sns?: {
    instagram?: string;
    youtube?: string;
    kakao?: string;
    naver?: string;
  };
};
```

#### `dm_pages.ai_prompt` (Prompt Parser 입력 기록)

```ts
type AiPromptRecord = {
  raw: string;                   // 사용자 입력 원문
  parsed: CampaignSpec;          // 파싱 결과
  generated_at: string;          // ISO timestamp
  model: string;                 // 'claude-3-5-sonnet' | 'gpt-4o'
  tokens_used: number;
};
```

---

## 5. API 설계

### 5-1. 기존 라우트 (유지)
```
GET    /api/dm                     — 목록
POST   /api/dm                     — 생성
GET    /api/dm/:id                 — 상세
PUT    /api/dm/:id                 — 수정
DELETE /api/dm/:id                 — 삭제
POST   /api/dm/:id/publish         — 발행 (단축URL)
GET    /api/dm/:id/stats           — 통계
POST   /api/dm/upload-image        — 이미지 업로드
DELETE /api/dm/delete-image        — 이미지 삭제
GET    /api/dm/v/:code             — 공개 뷰어
POST   /api/dm/v/:code/track       — 열람 추적
```

### 5-2. 신규 라우트

```
# AI 4모듈
POST   /api/dm/ai/parse-prompt     — 프롬프트 → 캠페인 스펙
POST   /api/dm/ai/recommend-layout — 스펙 → 섹션 구성 추천
POST   /api/dm/ai/generate-copy    — 섹션별 카피 생성
POST   /api/dm/ai/improve          — 기존 문안 AI 개선
POST   /api/dm/ai/transform-tone   — 톤 전환 (6종)
POST   /api/dm/:id/validate        — 발행 전 검수

# 개인화/샘플
POST   /api/dm/:id/render-sample   — 샘플 고객 기준 렌더링
GET    /api/dm/variables           — 사용 가능한 변수 목록 (회사별)

# 브랜드 킷
GET    /api/dm/brand-kit           — 회사 브랜드 킷 조회
PUT    /api/dm/brand-kit           — 브랜드 킷 수정

# 템플릿
GET    /api/dm/templates           — 템플릿 목록 (카테고리/업종 필터)
GET    /api/dm/templates/:id       — 템플릿 상세
POST   /api/dm/from-template       — 템플릿 기반 신규 생성 + AI 보정

# 버전 관리
GET    /api/dm/:id/versions        — 버전 목록
POST   /api/dm/:id/versions        — 새 버전 저장
POST   /api/dm/:id/versions/:vid/restore — 버전 복원

# 승인 플로우
POST   /api/dm/:id/request-approval — 검수 요청
POST   /api/dm/:id/approve          — 승인
POST   /api/dm/:id/reject           — 반려

# 테스트 발송
POST   /api/dm/:id/test-send        — 관리자 번호로 테스트 SMS + DM 링크
```

---

## 6. 프론트 에디터 아키텍처

### 6-1. 레이아웃

```
┌──────────────────────────────────────────────────────────┐
│  상단 바                                                 │
│  [← 목록] [제목]  [⚡프롬프트] [✨AI개선] [🔍검수]       │
│                   [📤테스트] [💾저장] [🚀발행]          │
├────────┬─────────────────────────────────┬───────────────┤
│        │                                 │               │
│ 좌측   │      중앙 캔버스                │   우측        │
│ 패널   │      (모바일 프레임)            │   속성패널    │
│        │                                 │               │
│ ▸ 섹션 │   ┌─────────────────────┐       │  [선택한      │
│   목록 │   │                     │       │   섹션의      │
│        │   │   [Header]     ↕    │       │   속성]       │
│ ▸ 섹션 │   │   [Hero]       ↕    │       │               │
│   추가 │   │   [Coupon]     ↕    │       │  • 스타일     │
│        │   │   [Countdown]  ↕    │       │  • 데이터     │
│ ▸ 브랜 │   │   [Text]       ↕    │       │  • 링크       │
│   드킷 │   │   [CTA]        ↕    │       │  • AI 카피    │
│        │   │   [Footer]     ↕    │       │    제안       │
│ ▸ 변수 │   │                     │       │  • 개인화     │
│   목록 │   └─────────────────────┘       │    변수       │
│        │                                 │               │
└────────┴─────────────────────────────────┴───────────────┘
  240px              가변(최대 480px)          320px
```

### 6-2. 컴포넌트 트리

```
DmBuilderPage
├── DmTopBar
│   ├── PromptTrigger (모달 호출)
│   ├── AiImproveButton
│   ├── ValidateButton
│   ├── TestSendButton
│   └── PublishButton
├── DmLeftPanel
│   ├── SectionList (드래그 가능)
│   ├── SectionAddMenu (11종)
│   ├── BrandKitQuickAccess
│   └── VariableList
├── DmCanvas
│   ├── MobileFrame (320~430px)
│   └── SectionRenderer[] (11종 렌더러)
│       ├── HeaderSection
│       ├── HeroSection
│       ├── CouponSection
│       ├── CountdownSection
│       ├── TextCardSection
│       ├── CtaSection
│       ├── VideoSection
│       ├── StoreInfoSection
│       ├── SnsSection
│       ├── PromoCodeSection
│       └── FooterSection
└── DmRightPanel
    ├── SectionPropsEditor (타입별 분기)
    ├── AiCopyPanel (3안 생성)
    ├── StyleVariantPicker
    ├── LinkEditor
    └── VariableInserter
```

### 6-3. 상태 관리

**선택:** Zustand (이미 프로젝트에 설치되지 않았다면 Context + useReducer 대안)

```ts
// stores/dm-builder-store.ts
type DmBuilderState = {
  // Entity
  dmId: string | null;
  title: string;
  sections: Section[];
  brandKit: BrandKit;
  layoutMode: 'scroll' | 'slides';

  // UI
  selectedSectionId: string | null;
  hoveredSectionId: string | null;
  isDirty: boolean;
  lastSavedAt: number | null;

  // AI
  aiGenerating: boolean;
  validationResult: ValidationResult | null;

  // Actions
  setSections: (sections: Section[]) => void;
  addSection: (type: SectionType, afterId?: string) => void;
  removeSection: (id: string) => void;
  duplicateSection: (id: string) => void;
  reorderSections: (fromIdx: number, toIdx: number) => void;
  updateSectionProps: (id: string, props: Partial<SectionProps>) => void;
  selectSection: (id: string | null) => void;
  applyBrandKit: (kit: BrandKit) => void;
  applyAiSpec: (spec: CampaignSpec, generated: Section[]) => void;
  runValidation: () => Promise<ValidationResult>;
  save: () => Promise<void>;
  loadDm: (id: string) => Promise<void>;
};
```

**자동 저장:** 섹션/브랜드킷 변경 시 debounce 2초 후 자동 저장 (dirty flag 기반).

### 6-4. 에디터 기술 선정

**자체 구현 (Lexical/TipTap 불채택).**

**사유:**
- 설계안 원칙 "제한형 섹션 편집" — 일반 리치텍스트 에디터 기능 과잉
- 섹션 단위 DnD + 인라인 텍스트 편집 + 속성 패널이 전부 → React + 최소 라이브러리로 충분
- 외부 의존 최소화 (dm-viewer처럼 빌드 크기/보안 고려)

**사용 라이브러리:**
- `@dnd-kit/core`, `@dnd-kit/sortable` — 섹션 드래그 순서 변경
- `contentEditable` + `onBlur` — 인라인 텍스트 편집 (이미 일부 적용 중)
- `react-colorful` — 컬러 피커
- 이미 있는 것 재활용: axios, react-router-dom

---

## 7. 섹션 시스템 (11종)

### 7-1. 섹션 타입별 Props 스펙

#### A. `header` — 헤더

```ts
type HeaderProps = {
  variant: 'logo' | 'banner' | 'countdown' | 'coupon';
  logo_url?: string;
  brand_name: string;
  phone?: string;
  // countdown 전용
  event_title?: string;
  event_date?: string;  // ISO
  // coupon 전용
  discount_label?: string;
  coupon_code?: string;
  // banner 전용
  banner_image_url?: string;
};
```

#### B. `hero` — 히어로 (메인 비주얼)

```ts
type HeroProps = {
  image_url?: string;              // 풀 배너
  headline: string;                // 메인 헤드라인
  sub_copy?: string;               // 서브카피
  overlay_gradient?: boolean;      // 이미지 위 그라디언트
  align: 'left' | 'center' | 'right';
  height: 'sm' | 'md' | 'lg' | 'full';
};
```

#### C. `coupon` — 쿠폰

```ts
type CouponProps = {
  discount_label: string;          // "20% 할인"
  discount_type: 'percent' | 'amount' | 'free_shipping';
  coupon_code?: string;
  expire_date?: string;            // ISO
  min_purchase?: number;
  usage_condition?: string;
  cta_url?: string;
};
```

#### D. `countdown` — 카운트다운

```ts
type CountdownProps = {
  end_datetime: string;            // ISO — JS로 클라이언트 카운트다운
  urgency_text?: string;           // "마감 임박!"
  show_days: boolean;
  show_hours: boolean;
  show_minutes: boolean;
  show_seconds: boolean;
};
```

#### E. `text_card` — 텍스트 카드

```ts
type TextCardProps = {
  tag?: string;                    // "NEW" / "BEST" 등 강조 태그
  headline: string;
  body: string;                    // 마크다운 제한 허용 (굵기/강조만)
  align: 'left' | 'center';
  image_url?: string;              // 이미지 + 텍스트 조합
  image_position: 'top' | 'left' | 'right' | 'bottom';
};
```

#### F. `cta` — CTA 버튼

```ts
type CtaProps = {
  buttons: Array<{
    label: string;
    url: string;
    style: 'primary' | 'secondary' | 'outline';
    icon?: string;
  }>;
  layout: 'stack' | 'row';         // 세로/가로 배열
};
```

#### G. `video` — 영상

```ts
type VideoProps = {
  video_url: string;
  video_type: 'youtube' | 'direct';
  thumbnail_url?: string;
  caption?: string;
  autoplay: boolean;               // muted autoplay
};
```

#### H. `store_info` — 매장/고객센터

```ts
type StoreInfoProps = {
  phone?: string;
  website?: string;
  email?: string;
  address?: string;
  map_url?: string;                // 네이버/카카오 지도
  business_hours?: string;
};
```

#### I. `sns` — SNS

```ts
type SnsProps = {
  channels: Array<{
    type: 'instagram' | 'youtube' | 'kakao' | 'naver' | 'facebook' | 'twitter';
    url: string;
    handle?: string;
  }>;
  layout: 'icons' | 'buttons';
};
```

#### J. `promo_code` — 프로모션 코드

```ts
type PromoCodeProps = {
  code: string;
  description?: string;
  instructions?: string;           // 사용 방법
  cta_url?: string;
  cta_label?: string;
};
```

#### K. `footer` — 하단 정보

```ts
type FooterProps = {
  notes?: string;                  // 유의사항
  cs_phone?: string;
  cs_hours?: string;
  legal_text?: string;             // 법정 안내 (사업자번호 등)
  show_unsubscribe_link?: boolean; // 수신거부 링크 (하단 링크)
};
```

### 7-2. 섹션별 스타일 변형 (style_variant)

각 섹션은 **업종별 3~5 스타일 변형**을 제공. 예:

**`hero` 섹션 스타일 변형:**
- `beauty-elegant` — 흰 배경 + 큰 여백 + 얇은 폰트 + 파스텔 포인트
- `beauty-bold` — 블랙 배경 + 고채도 컬러 + 두꺼운 폰트
- `fashion-editorial` — 그리드 + 세리프 + 고해상도 이미지
- `food-warm` — 웜톤 배경 + 둥근 모서리 + 친근한 폰트
- `default` — 범용

**선택 UX:** 섹션 클릭 시 우측 패널에 변형 썸네일 갤러리 표시, 클릭으로 즉시 교체.

---

## 8. 디자인 시스템

### 8-1. 컬러 토큰 (`dm-tokens.ts`)

```ts
export const DM_COLOR_TOKENS = {
  // 범용 뉴트럴
  neutral: {
    0: '#ffffff',
    50: '#fafafa',
    100: '#f5f5f5',
    200: '#e5e5e5',
    300: '#d4d4d4',
    400: '#a3a3a3',
    500: '#737373',
    600: '#525252',
    700: '#404040',
    800: '#262626',
    900: '#171717',
    1000: '#000000',
  },
  // 기본 브랜드 (브랜드킷으로 override)
  brand: {
    primary: '#4f46e5',
    primaryHover: '#4338ca',
    primaryLight: '#eef2ff',
    accent: '#f59e0b',
  },
  // 의미론적
  semantic: {
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',
  },
  // 업종 프리셋
  industry: {
    beauty: { primary: '#ec4899', accent: '#fbcfe8' },
    fashion: { primary: '#18181b', accent: '#fde68a' },
    food: { primary: '#ea580c', accent: '#fef3c7' },
    tech: { primary: '#0ea5e9', accent: '#cffafe' },
    luxury: { primary: '#1e3a8a', accent: '#d4af37' },
  },
};
```

### 8-2. 타이포그래피

```ts
export const DM_TYPOGRAPHY = {
  fontFamily: {
    primary: '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, "Helvetica Neue", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
    serif: '"Noto Serif KR", serif',
    mono: '"JetBrains Mono", Menlo, monospace',
  },
  // 위계 (모바일 기준)
  scale: {
    hero: { size: '32px', lineHeight: '1.2', weight: 800, letterSpacing: '-0.02em' },
    h1:   { size: '24px', lineHeight: '1.3', weight: 700, letterSpacing: '-0.01em' },
    h2:   { size: '20px', lineHeight: '1.4', weight: 700 },
    h3:   { size: '18px', lineHeight: '1.4', weight: 600 },
    body: { size: '15px', lineHeight: '1.6', weight: 400 },
    small:{ size: '13px', lineHeight: '1.5', weight: 400 },
    tiny: { size: '11px', lineHeight: '1.4', weight: 400 },
  },
};
```

**Pretendard CDN 인라인 로드** (dm-viewer 내부 `<style>`에 @font-face 인라인, 외부 CDN 대비 fallback).

### 8-3. 스페이싱 / 레이아웃

```ts
export const DM_SPACING = {
  0: '0',
  1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px',
  6: '24px', 8: '32px', 10: '40px', 12: '48px', 16: '64px',
  20: '80px',
};

export const DM_RADIUS = {
  none: '0', sm: '4px', md: '8px', lg: '12px', xl: '16px',
  '2xl': '24px', full: '9999px',
};

export const DM_SHADOW = {
  sm: '0 1px 2px rgba(0,0,0,0.05)',
  md: '0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.04)',
  lg: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
  xl: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
};
```

### 8-4. 애니메이션

```ts
export const DM_MOTION = {
  // 섹션 추가/삭제
  sectionEnter: { opacity: [0, 1], y: [10, 0], duration: 240 },
  sectionExit:  { opacity: [1, 0], y: [0, -10], duration: 180 },
  // DnD
  dragOver: { scale: 1.02, shadow: DM_SHADOW.lg },
  // 인터랙션
  hover: { duration: 150, easing: 'ease-out' },
  press: { scale: 0.98, duration: 100 },
};
```

### 8-5. 반응형 전략

- **에디터 캔버스:** 편집 시 430px 모바일 프레임, 좌우 여백은 뷰포트 가변
- **뷰어 (공개):** `max-width: 430px; margin: 0 auto;` + 세이프 에어리어 `env(safe-area-inset-*)`
- **미디어 쿼리:** 320px / 375px / 430px 3단계만 체크 (모바일 전용)

### 8-6. 접근성 (A11y)

- 모든 CTA 버튼 최소 터치 영역 44×44pt
- WCAG AA 대비 자동 검증 (검수 엔진 `10-1 스타일` 항목)
- alt 텍스트 강제 (검수 엔진)
- `prefers-reduced-motion` 존중

---

## 9. AI 엔진 (4모듈)

### 9-1. Prompt Parser

**입력:** 자연어 1줄 ~ 몇 문장
**출력:** 구조화된 캠페인 스펙 JSON

```ts
type CampaignSpec = {
  brand: { name: string; tone?: string };
  objective: 'awareness' | 'sale' | 'retention' | 'reactivation' | 'loyalty';
  target: {
    age_range?: [number, number];
    gender?: 'F' | 'M' | 'all';
    region?: string;
    segment?: string;        // 자유 텍스트 ("VIP", "휴면고객")
  };
  benefit?: {
    type: 'discount' | 'coupon' | 'free_gift' | 'point' | 'limited_time';
    value?: string;          // "20%" | "5만원" | "신상 샘플"
  };
  urgency?: {
    end_datetime?: string;   // ISO
    label?: string;          // "오늘 자정 마감"
  };
  personalization?: string[]; // ['고객명', '최근구매매장', '보유포인트']
  tone: 'premium' | 'friendly' | 'urgent' | 'elegant' | 'playful';
  industry?: string;         // 'beauty' | 'fashion' | 'food' ...
  recommended_sections?: SectionType[];  // Layout Recommender가 채움
};
```

**프롬프트 전략:**
- Claude 3.5 Sonnet 우선, GPT-4o 폴백 (한줄로 기존 `callAIWithFallback` 재활용)
- few-shot 예시 5~10개 포함 (업종별)
- 출력은 **JSON만** (마크다운 코드블록 금지)
- 날짜 파싱: "오늘", "자정", "이번 주말" 등 상대적 표현 → ISO 변환

### 9-2. Layout Recommender

**입력:** `CampaignSpec`
**출력:** `Section[]` (11종 중 선택 + 순서 + 스타일 변형)

**로직:**
- 규칙 기반 + AI 보정 하이브리드
- objective별 기본 템플릿:
  - `sale` → [header, hero, coupon, countdown, cta, store_info, footer]
  - `retention` → [header, text_card, cta, sns, footer]
  - `awareness` → [header, hero, video, text_card, cta, footer]
- 업종 → `style_variant` 자동 선택
- personalization 변수 있으면 `text_card.body`에 자동 삽입

### 9-3. Copy Generator

**입력:** `CampaignSpec` + `Section` (무엇을 생성할지)
**출력:** 섹션별 카피 (`headline`, `body`, `cta_label` 등)

**마이크로 AI 카피라이터 (블록별):**
- 헤드라인 3안 생성
- 본문 4 톤 변환 (짧게/감성/긴박/프리미엄)
- CTA 3안
- 쿠폰 강조 문구 추천
- 마감 문구 추천

**프롬프트 템플릿 (예: 헤드라인):**
```
당신은 {industry} 업종 마케팅 카피라이터입니다.
브랜드: {brand}
타겟: {target}
혜택: {benefit}
긴급성: {urgency}
톤: {tone}

이 DM의 메인 헤드라인 3개를 서로 다른 접근으로 생성:
1. 직관형 — 혜택을 바로 제시
2. 감성형 — 고객의 순간/감정을 자극
3. 긴박형 — 희소성/시간 제한 강조

각 헤드라인은 18자 이내, 이모지 1개 이내, 브랜드명 포함 금지.

JSON만 반환:
{ "headlines": [{ "style": "direct", "text": "..." }, ...] }
```

### 9-4. AI 톤 전환 (6종)

```
직관형  → 감성형  → 고급형  → 긴박형  → 친절형  → 세일즈형
```

기존 문안을 받아 선택된 톤으로 변환. `services/ai.ts`에 새 함수 `transformTone(text, targetTone, context)`.

### 9-5. AI 자동 개선

```
- 문구 더 짧게 정리
- 전환 유도 강화
- CTA 더 강하게
- 혜택 강조 순서 개선
- 너무 장황한 문구 축약
- 반복 표현 제거
```

상단 `✨AI개선` 버튼 → 전체 섹션 재검토 후 다중 수정안 제시 (diff UI).

---

## 10. 검수 엔진

### 10-1. 10개 검수 영역

| 영역 | 체크 항목 | 등급 판정 |
|---|---|---|
| **link** | CTA url 누락, 유효하지 않은 URL, http(s) 아닌 스킴 | 누락=치명, 유효성=권장 |
| **personalization** | `%변수%`이 있는데 fallback 미설정, 존재하지 않는 변수 사용 | 미설정=치명 |
| **coupon** | coupon_code 있는데 expire_date 없음, usage_condition 없음 | expire 없음=권장, 조건 없음=성과 |
| **countdown** | end_datetime이 과거, 이벤트 문구와 불일치 | 과거=치명 |
| **layout** | 한 섹션 텍스트 500자 초과, 이미지 3개 초과, 섹션 0개 | 500자 초과=권장 |
| **style** | 컬러 대비 부족(WCAG AA 미달), 버튼 크기 44pt 미만 | 대비 부족=권장 |
| **content** | 과장 표현(`반드시 성공` 등), 금지어, 법정 오인 표현 | 금지어=치명 |
| **required_info** | 고객센터/문의처 누락 (KISA 가이드), 수신거부 링크 누락 | KISA 누락=치명 |
| **data** | 샘플 고객 렌더링 결과 중 치환 안 되는 변수 존재 | 치환 실패=치명 |
| **operation** | 예약시간 누락(예약 선택 시), 테스트 미실행 | 예약 누락=치명, 테스트=권장 |

### 10-2. 검수 결과 타입

```ts
type ValidationResult = {
  level: 'pass' | 'warning' | 'error';  // 전체 판정
  items: Array<{
    area: string;                // 'link' | 'personalization' | ...
    severity: 'fatal' | 'recommend' | 'improve';
    section_id?: string;         // 어느 섹션 문제인지
    message: string;
    fix_suggestion?: string;
  }>;
  can_publish: boolean;          // 치명 0건이면 true
  checked_at: string;
};
```

### 10-3. UI 표시

- 상단바 `[🔍검수]` 클릭 → 검수 모달 오픈
- 3등급 색상: 치명(빨강) / 권장(노랑) / 성과개선(파랑)
- 각 항목 클릭 시 해당 섹션으로 스크롤 + 하이라이트
- `[자동 수정]` 버튼: AI가 가능한 항목 자동 수정 (예: CTA 버튼 크기 조정, 오타 수정)
- 치명 0건일 때만 발행 버튼 활성화

---

## 11. 개인화 변수 시스템

### 11-1. 변수 목록 (기본 + 커스텀)

**기본 변수 (FIELD_MAP 재활용):**
```
%고객명%         (customers.name)
%최근구매매장%   (customers.recent_purchase_store)
%보유포인트%     (customers.points)
%쿠폰코드%       (별도 시스템 연동 — 추후)
%최근구매일%     (customers.recent_purchase_date)
%최근관심카테고리% (customers.custom_fields 활용)
%휴면여부%       (조건 계산)
%추천상품%       (세그먼트 기반 — 추후)
```

**커스텀 변수:** `customer_field_definitions` 기반 동적 생성 (기존 한줄로 변수 체계 그대로).

### 11-2. fallback 설계

```ts
type VariableBinding = {
  variable: string;              // '%고객명%'
  fallback: string;              // '고객님'
  hide_section_if_empty?: boolean; // 변수 없을 때 섹션 숨김
};
```

**기본 fallback 매핑:**
```
%고객명%         → "고객님"
%최근구매매장%   → "가까운 매장"
%보유포인트%     → (섹션 숨김)
%쿠폰코드%       → "공통 프로모션 코드"
%최근관심카테고리% → "인기 상품"
```

**저장 위치:** `dm_pages.sections[].props.variable_fallbacks: VariableBinding[]`

### 11-3. 삽입 UX

- 우측 패널 "변수 삽입" 드롭다운 → 클릭 시 커서 위치에 삽입
- 또는 `#{ 입력 시 자동완성 (Notion/Linear 스타일)
- 캔버스 내 인라인 편집 중에도 동작

### 11-4. 샘플 렌더링

```
[샘플 고객 A 보기] — VIP, 30대, 포인트 많음
[샘플 고객 B 보기] — 신규, 20대, 포인트 0
[데이터 없는 고객 보기] — fallback만 적용
```

**구현:** 회사 DB에서 샘플 3명 자동 선정(실제 고객 랜덤) + 완전 빈 가상 고객.

---

## 12. 브랜드 킷

### 12-1. 수집 방법

**1차 (수동):**
- 로고 업로드
- 컬러 4개 (primary/secondary/accent/neutral) — 컬러 피커
- 폰트 선택 (Pretendard / Noto Sans KR / 기타)
- 톤 선택 (프리미엄/친근/긴박/엘레강트/플레이풀)

**2차 (자동 제안):**
- 브랜드 URL 입력 → AI가 메타 태그/og:image 분석
- 로고 자동 탐지 (og:image, apple-touch-icon)
- 메인 컬러 자동 추출 (로고 이미지 기반)
- 톤 추천

### 12-2. 적용 범위

```ts
type BrandKitApplication = {
  header_logo: true,             // 로고 자동
  button_color: 'primary',       // CTA 버튼
  accent_text_color: 'accent',   // 강조 텍스트
  card_point_color: 'primary',
  background_tone: 'neutral.50',
};
```

원클릭 "브랜드 킷 일괄 적용" 버튼.

### 12-3. 저장

- 회사 단위: `companies.brand_kit JSONB` (신규 컬럼) — 기본값 용
- DM 단위: `dm_pages.brand_kit JSONB` — DM별 오버라이드 허용

---

## 13. 버전 관리 + 승인

### 13-1. 자동 버전 저장 트리거

- AI 생성 직후 → `ai_v1` 자동 저장
- 10분 이상 편집 없이 변경 후 저장 → `edit_vN` 자동
- 수동 `[버전 저장]` 버튼 → 라벨 입력 가능
- 발행 직전 → `final_vN` 자동

### 13-2. 버전 비교 UI

- 좌측 패널 하단 `버전 히스토리`
- 클릭 시 side-by-side diff (섹션 단위)
- `[이 버전으로 복원]` 버튼

### 13-3. 승인 플로우

```
draft → review(작성자 요청) → approved(승인자) → published(발행자)
      ↓
    rejected (반려 사유 기록 → 작성자에게 알림)
```

**역할:**
- 작성자: `company_user`
- 검수자: `company_admin` (설정으로 on/off)
- 승인자: `company_admin` (설정으로 on/off)
- 발행자: 승인자와 동일

**옵션:** 회사 설정에서 "승인 플로우 사용" on/off. 1인 기업은 off.

---

## 14. 테스트 발송

### 14-1. 테스트 채널

```
1. 담당자 번호로 SMS + DM 링크
2. 슬랙/카카오톡 워크 링크 (V2)
3. 이메일 (V2)
```

**V1은 SMS only.**

### 14-2. 테스트 SMS 본문

```
[DM 테스트 발송]
{제목}

미리보기: https://hanjul-flyer.kr/dm-{code}?p=test&s=샘플A

- 샘플 고객: 김철수 (VIP, 30대)
- 생성 시각: 2026-04-16 15:30
```

### 14-3. 재활용 인프라

- `getTestSmsTables()` — 테스트 전용 라인 (기존)
- `insertTestSmsQueue()` — CT-04 컨트롤타워 (기존)
- `bill_id = userId` — 테스트 비용 사용자 격리 (기존 D100)

### 14-4. 샘플 고객 선정 로직

```ts
async function selectSampleCustomers(companyId: string): Promise<{
  vip: Customer;
  newbie: Customer;
  empty: Customer;
}> {
  // 1. VIP — grade='VIP' 중 points 많은 1명
  // 2. newbie — created_at 최근, purchase_count 적은 1명
  // 3. empty — 완전 가상 고객 (모든 필드 null)
}
```

---

## 15. 마이그레이션 전략

### 15-1. 기존 D119 DM 처리 정책

**3가지 모드 제공:**

**A. 자동 변환 (기본)**
- 기존 `pages[]` → `sections[]` 자동 매핑
  - header_template → `header` 섹션
  - footer_template → `footer` 섹션
  - 슬라이드 → `hero` 또는 `text_card` 또는 `video` 섹션
- `layout_mode = 'scroll'`로 설정 (세로 스크롤)
- `approval_status = 'draft'`

**B. 레거시 유지 (선택)**
- `layout_mode = 'slides'` 유지
- dm-viewer.ts는 두 모드 모두 렌더링 지원
- 사용자가 명시적으로 "새 에디터로 전환" 버튼 클릭 시 A 수행

**C. 재작성 (추천 안 함)**
- 기존 DM 삭제 후 새로 작성

### 15-2. 마이그레이션 실행

**1) DB 스키마 변경** → [§4-1 마이그레이션 실행 안내](#4-1-마이그레이션-실행-안내-harold님-직접-실행) 참조
- 기존 dm_pages는 `layout_mode='slides'`로 자동 표시 (heredoc UPDATE 포함)

**2) 슬라이드 → 섹션 자동 변환**
- Application 레벨에서 수행 (별도 유틸 함수)
- 파일: `packages/backend/src/utils/dm/dm-legacy-converter.ts` (★신설 예정)
- 호출 시점: 사용자가 "새 에디터로 전환" 버튼 클릭 시 (강제 변환 X)
- 변환 매핑:
  - `header_template='logo'` + `header_data` → `header` 섹션
  - `pages[].layout='full-image'` → `hero` 섹션
  - `pages[].layout='text-card'` → `text_card` 섹션
  - `pages[].layout='cta-card'` → `text_card` + `cta` 섹션 분리
  - `pages[].layout='video'` → `video` 섹션
  - `footer_template` + `footer_data` → `footer` 또는 `cta` 또는 `sns` 등 분기

### 15-3. 뷰어 호환

`dm-viewer.ts` 업데이트:
```ts
if (dm.layout_mode === 'slides' || !dm.sections) {
  return renderLegacySlidesHtml(dm, trackApiBase);
}
return renderSectionsHtml(dm, trackApiBase);
```

신구 렌더러 공존.

---

## 16. 컨트롤타워 매핑

### CT-DM (dm-builder.ts) 확장

**신규 함수:**
```
saveDmVersion(dmId, label, sections, brandKit, note?, userId)
listDmVersions(dmId, companyId)
restoreDmVersion(dmId, versionId, companyId)
getCompanyBrandKit(companyId)
updateCompanyBrandKit(companyId, kit)
selectSampleCustomers(companyId)
renderDmWithVariables(dm, customer)   — 변수 치환
runValidation(dm)                      — 10영역 검수
requestDmApproval(dmId, userId)
approveDm(dmId, userId)
rejectDm(dmId, userId, reason)
testSendDm(dmId, userId, managerPhones[])
```

### CT-DM2 (dm-viewer.ts) 확장

**신규 렌더러:**
```
renderSectionsHtml(dm, trackApiBase)   — 세로 스크롤 11섹션
renderSection(section, brandKit, context)  — 단일 섹션 (11종 분기)
renderLegacySlidesHtml(dm, trackApiBase)   — 기존 슬라이드 (하위호환)
```

### CT-DM-AI (신설) — `utils/dm/dm-ai.ts`

```
parsePrompt(raw): Promise<CampaignSpec>
recommendLayout(spec): Section[]
generateCopy(spec, section): Promise<SectionCopy>
improveMessage(text, context): Promise<string>
transformTone(text, targetTone): Promise<string>
```

### CT-DM-VALIDATE (신설) — `utils/dm/dm-validate.ts`

```
validateDm(dm, brandKit, sampleCustomers): ValidationResult
validateLinks(sections): ValidationItem[]
validatePersonalization(sections, customers): ValidationItem[]
validateCoupons(sections): ValidationItem[]
validateCountdown(sections): ValidationItem[]
validateLayout(sections): ValidationItem[]
validateStyle(sections, brandKit): ValidationItem[]
validateContent(sections): ValidationItem[]
validateRequiredInfo(sections): ValidationItem[]
validateData(sections, sampleCustomers): ValidationItem[]
validateOperation(dm): ValidationItem[]
```

### 기존 한줄로 컨트롤타워 재활용

| 재활용 CT | 용도 |
|---|---|
| `messageUtils.ts` `replaceVariables` | 변수 치환 (DM도 동일 체계) |
| `standard-field-map.ts` FIELD_MAP | 개인화 변수 목록 |
| `callAIWithFallback` (ai.ts 내부) | Anthropic → OpenAI 폴백 |
| `sms-queue.ts` `insertTestSmsQueue` | 테스트 SMS 발송 |
| `auto-notify-message.ts` `sanitizeSmsText` | 테스트 SMS 본문 정제 |
| `prepaid.ts` `prepaidDeduct` | 테스트 발송 비용 차감 |

---

## 17. 구현 의존성 그래프 (순서)

```
[1] DB 마이그레이션 (sections/brand_kit/versions/templates 컬럼·테이블)
       ↓
[2] 섹션 렌더러 11종 (백엔드 dm-viewer + 프론트 Canvas 양쪽)
       ↓
[3] 디자인 토큰 (dm-tokens.ts)
       ↓
[4] 프론트 에디터 뼈대 (레이아웃 3분할 + Zustand 스토어)
       ↓
[5] 섹션 DnD + 인라인 편집 + 속성 패널
       ↓
[6] AI 엔진 4모듈 (Prompt Parser → Layout → Copy → Tone)
       ↓
[7] 변수 바인딩 + fallback + 샘플 렌더링
       ↓
[8] 검수 엔진 (10영역) + 검수 UI
       ↓
[9] 브랜드 킷 + 템플릿 7카테고리
       ↓
[10] 버전 관리 + 승인 플로우
       ↓
[11] 테스트 발송 (SMS + DM 링크)
       ↓
[12] 기존 DM 자동 변환 스크립트
       ↓
[13] 통합 QA + 디자인 폴리싱
       ↓
[14] 문서화 (사용자 가이드 + 내부 운영 가이드)
```

각 단계는 **선행 단계 없이는 테스트 불가**. 순차 구현 필수.

---

## 18. 파일 구조

### 백엔드 신규/수정

```
packages/backend/src/
├── routes/
│   └── dm.ts                                    (수정 — 신규 라우트 추가)
├── utils/dm/
│   ├── dm-builder.ts                            (수정 — 함수 확장)
│   ├── dm-viewer.ts                             (수정 — renderSectionsHtml 추가)
│   ├── dm-ai.ts                                 ★신설
│   ├── dm-validate.ts                           ★신설
│   ├── dm-template-registry.ts                  ★신설 (템플릿 7카테고리)
│   ├── dm-brand-kit.ts                          ★신설
│   ├── dm-section-registry.ts                   ★신설 (11섹션 스펙)
│   └── dm-sample-customer.ts                    ★신설
└── scripts/
    └── migrate-dm-slides-to-sections.ts         ★신설 (일회성 마이그레이션)
```

### 프론트 신규/수정

```
packages/frontend/src/
├── pages/
│   └── DmBuilderPage.tsx                        (수정 — 레이아웃 재설계)
├── components/dm/
│   ├── DmTopBar.tsx                             ★신설
│   ├── DmLeftPanel.tsx                          ★신설
│   ├── DmRightPanel.tsx                         ★신설
│   ├── DmCanvas.tsx                             ★신설
│   ├── MobileFrame.tsx                          ★신설
│   ├── canvas/
│   │   ├── HeaderSection.tsx                    ★신설
│   │   ├── HeroSection.tsx                      ★신설
│   │   ├── CouponSection.tsx                    ★신설
│   │   ├── CountdownSection.tsx                 ★신설
│   │   ├── TextCardSection.tsx                  ★신설
│   │   ├── CtaSection.tsx                       ★신설
│   │   ├── VideoSection.tsx                     ★신설
│   │   ├── StoreInfoSection.tsx                 ★신설
│   │   ├── SnsSection.tsx                       ★신설
│   │   ├── PromoCodeSection.tsx                 ★신설
│   │   └── FooterSection.tsx                    ★신설
│   ├── panels/
│   │   ├── SectionList.tsx                      ★신설
│   │   ├── SectionAddMenu.tsx                   ★신설
│   │   ├── SectionPropsEditor.tsx               ★신설
│   │   ├── BrandKitPanel.tsx                    ★신설
│   │   ├── VariableList.tsx                     ★신설
│   │   └── VersionHistory.tsx                   ★신설
│   ├── ai/
│   │   ├── PromptModal.tsx                      ★신설
│   │   ├── AiCopySuggestions.tsx                ★신설
│   │   ├── AiImproveDiff.tsx                    ★신설
│   │   └── ToneTransformer.tsx                  ★신설
│   ├── validation/
│   │   ├── ValidationModal.tsx                  ★신설
│   │   └── ValidationItem.tsx                   ★신설
│   └── common/
│       ├── MobileFrame.tsx                      ★신설
│       ├── ColorPicker.tsx                      ★신설
│       └── InlineTextEditor.tsx                 ★신설
├── stores/
│   └── dmBuilderStore.ts                        ★신설 (Zustand)
├── utils/
│   ├── dm-tokens.ts                             ★신설 (디자인 토큰)
│   ├── dm-section-defaults.ts                   ★신설 (섹션별 기본값)
│   └── dm-variable-fallbacks.ts                 ★신설 (변수 fallback)
└── styles/
    └── dm-builder.css                           ★신설 (전역 토큰 → CSS 변수)
```

### 문서

```
status/
├── DM-PRO-DESIGN.md                             ★(이 문서)
└── DM-PRO-IMPLEMENTATION-LOG.md                 ★신설 (구현 중 의사결정 기록)
```

---

## 19. 완료 체크리스트

### 19-1. 기능 체크리스트

**AI 엔진**
- [ ] Prompt Parser — 자연어 → `CampaignSpec` JSON
- [ ] Layout Recommender — spec → `Section[]`
- [ ] Copy Generator — 섹션별 헤드라인/본문/CTA 생성
- [ ] AI 개선 — 전체 섹션 diff 제시
- [ ] 톤 전환 — 6종

**에디터**
- [ ] WYSIWYG 캔버스 (중앙, 인라인 편집)
- [ ] 좌측 패널 (섹션 목록 + 추가 + 브랜드킷 + 변수)
- [ ] 우측 패널 (선택 섹션 속성 + AI 제안)
- [ ] 섹션 DnD 순서 변경
- [ ] 섹션 추가/삭제/복제/숨김

**섹션 11종**
- [ ] header (4 variant)
- [ ] hero
- [ ] coupon
- [ ] countdown
- [ ] text_card
- [ ] cta
- [ ] video
- [ ] store_info
- [ ] sns
- [ ] promo_code
- [ ] footer

**개인화**
- [ ] 변수 삽입 (#{ 자동완성)
- [ ] fallback 설정
- [ ] 샘플 고객 A/B/empty 렌더링

**검수**
- [ ] 10영역 체크 로직
- [ ] 3등급 표시
- [ ] 자동 수정 버튼

**브랜드 킷**
- [ ] 컬러 4개 선택
- [ ] 로고 업로드
- [ ] 폰트 선택
- [ ] 원클릭 일괄 적용

**템플릿 7카테고리**
- [ ] 신상품 홍보
- [ ] 할인 프로모션
- [ ] 긴급 마감형
- [ ] 포인트 리마인드형
- [ ] 재방문 유도형
- [ ] 오프라인 매장 유도형
- [ ] VIP 전용형

**버전 관리**
- [ ] 자동 버전 저장
- [ ] 수동 저장 + 라벨
- [ ] 히스토리 UI
- [ ] 버전 복원

**승인 플로우 (회사 설정 on/off)**
- [ ] 검수 요청
- [ ] 승인
- [ ] 반려 + 사유

**테스트 발송**
- [ ] 담당자 번호로 SMS + DM 링크
- [ ] 샘플 고객 치환 결과 렌더링

**발행**
- [ ] 즉시 발행 (기존)
- [ ] 예약 발행
- [ ] 승인 요청 후 발행

**마이그레이션**
- [ ] 기존 DM `layout_mode='slides'` 유지
- [ ] 자동 변환 스크립트
- [ ] 뷰어 신구 호환

### 19-2. 디자인 체크리스트

- [ ] 디자인 토큰 (`dm-tokens.ts`) 정의 + 모든 섹션 토큰 참조
- [ ] Pretendard 폰트 인라인 로드 (뷰어)
- [ ] WCAG AA 대비 자동 검증
- [ ] 320/375/430px 반응형
- [ ] 섹션 진입/이탈 애니메이션
- [ ] DnD 드래그오버 시각 피드백
- [ ] 호버/프레스 마이크로 인터랙션
- [ ] 다크모드 대응 (V1: 라이트만, 토큰만 준비)
- [ ] 11섹션 × 업종별 스타일 변형 3~5개 (beauty/fashion/food/tech/luxury)

### 19-3. 품질 체크리스트

- [ ] TypeScript 타입 에러 0건 (프론트/백엔드)
- [ ] 5경로 매트릭스 점검 (발송 연결 시)
- [ ] 컨트롤타워 원칙 준수 (인라인 중복 0건)
- [ ] 기존 DM 하위호환 검증 (slides 모드 뷰어)
- [ ] 에디터 로딩 속도 (FCP < 2s)
- [ ] 뷰어 로딩 속도 (FCP < 1s, TTI < 2s)
- [ ] base64 이미지 인라인 유지 (외부 CDN 의존 금지)

### 19-4. 운영 체크리스트

- [ ] DB 마이그레이션 SQL 준비 (롤백 스크립트 포함)
- [ ] pg_dump 백업
- [ ] 프로 요금제 게이팅 (`plans.dm_builder_enabled`)
- [ ] 사용량 제한 정책 (월 DM 발행 수)
- [ ] AI 호출 비용 추적 (company별 토큰 사용량)

---

## 📌 결정사항 기록 (Decision Log)

| 날짜 | 결정 | 대안 | 사유 |
|---|---|---|---|
| 2026-04-16 | 섹션 기반 세로 스크롤 | 슬라이드 유지 | 설계안 v2 핵심 방향 + 검수/브랜드 일관성 우수 |
| 2026-04-16 | 자체 구현 에디터 | Lexical/TipTap | 제한형 섹션 빌더라 리치텍스트 에디터 과잉 |
| 2026-04-16 | Zustand 상태 관리 | Context+useReducer | 섹션 추가/삭제 빈번 → 구독 최적화 필요 |
| 2026-04-16 | Claude 3.5 Sonnet 우선 | GPT-4o only | 기존 `callAIWithFallback` 재활용 |
| 2026-04-16 | 기존 DM `layout_mode='slides'` 하위호환 | 강제 변환 | 발행된 DM 링크 보존 |
| 2026-04-16 | 브랜드 킷 1차 수동, 2차 AI 자동 | 1차부터 AI 자동 | 로고/컬러 자동 추출 불확실성 |
| 2026-04-16 | V1 다크모드 미포함 (토큰만) | V1 포함 | 스코프 관리 |

---

## 🚧 V2 이후 로드맵 (참고용, 이번 범위 아님)

- A/B 버전 자동 생성 + 성과 비교
- 성과 학습 루프 (업종/타겟/섹션구조 기반 추천)
- 브랜드 킷 AI 자동 추출 (URL 기반)
- 타겟 세그먼트별 DM 자동 분기 발행
- 다국어 DM
- 카카오 브랜드메시지 직결
- 이메일 채널 확장

---

**설계서 끝.** 이 문서를 기준으로 구현 착수.
