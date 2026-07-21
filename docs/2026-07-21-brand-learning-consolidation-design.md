# 브랜드 학습 통합 설계서 (Brand Learning Consolidation)

> 2026-07-21 · Harold 지시 · 설계 단계(구현 전). SoT = 이 문서.
> 목표: 흩어진 브랜드 정보 입구·필드를 **AI 메모리 "브랜딩 학습" 한 곳**으로 집약해, 전 경로(DM·이메일·인앱·문안 생성)가 여기만 참조하게 한다.

---

## 1. 배경 — "중구난방"의 정체

기능을 계속 붙이다 보니 브랜드 정보 입구가 여러 곳에 생겼다. 진단(2026-07-21 grep):

| 데이터 | 저장소 | 편집 UI(현재) | 참조처 |
|--------|--------|--------------|--------|
| 시각 정체성(로고·색·서체·톤·연락처) | `companies.brand_kit` (jsonb, **단일**) | ① AI메모리 `BrandStudioCard` ② DM `BrandKitModal` — **둘 다 같은 `/api/dm/brand-kit`** | DM·이메일·인앱 렌더(`DmBrandKit`) |
| 브랜드보이스(서명·슬로건·필수/금지어·문장 습관) | `brand_guidelines`(별도) | AI메모리 `BrandVoiceCard`(대표문안 최대 10건→추출) | 문안 생성(`copy-prompt-composer`) |
| 사업자정보·업종 | `companies.business_category/item·industry_code` | 슈퍼관리자 등 흩어짐 | 문안 생성 |

**핵심 결론:** 시각 정체성은 이미 `companies.brand_kit` 단일 저장소다. "두 군데 중복"은 **데이터 이원화가 아니라 입구(UI)가 2개**인 것 — 다른 시점에 각각 만들어진 결과. 따라서 통합의 본질은 **데이터 이전이 아니라 UI를 한 허브로 모으고 + 빠진 필드 추가 + 과대약속(자동추출) 제거**다. 마이그레이션 위험은 낮다.

---

## 2. 목표 아키텍처

**단일 진입: AI 메모리 → "브랜딩 학습" → 3탭.** 이 밖의 브랜드 편집 입구는 없앤다.

```
AI 메모리
└─ 브랜딩 학습 (단일 허브)
   ├─ 탭 ① 브랜드 기본정보
   ├─ 탭 ② 브랜드킷
   └─ 탭 ③ 브랜드보이스
```

전 경로가 이 허브의 저장소만 참조한다. DM 편집기는 회사 브랜드를 **상속만** 한다(편집 입구 없음).

---

## 3. 탭별 상세

### 탭 ① 브랜드 기본정보 (신규)
DM·이메일 푸터, 인앱 안내, 문안 생성이 참조하는 필수 사실 정보. 라벨 붙은 입력 폼, 섹션 구분으로 **일목요연·시인성** 우선.

- 브랜드명
- 사업자정보: 상호 · 사업자등록번호 · 업태 · 종목
- 업종 (문안 생성 참조 = `industry_code`)
- 연락처: 대표전화 · **고객센터 번호** · 이메일 (대표전화와 고객센터 번호는 별개 필드 — DM 푸터 `cs_phone`/매장 `phone` 구분 대응)
- 홈페이지 URL (단순 입력 — 추출 트리거 아님)
- 주소 (DM 매장정보·이메일 푸터 자동 기입)
- **공식 SNS: 인스타그램 · 유튜브 · 네이버 · 페이스북 등 URL** (있는 것만 입력)

> 필수 정보를 빠짐없이 담되(고객센터 번호·주소·SNS 등), UI는 심플·모던·시인성 우선(섹션 그룹핑 + 라벨 + 있는 것만 채우는 선택 입력).

### 탭 ② 브랜드킷 (기존 `BrandStudioCard` 계승, 정리)
- 로고: **직접 업로드만** (자동추출 제거)
- 색: 메인 · 강조 · 배경 = **컬러 피커 직접 지정** (자동추출 제거)
- 서체: **한글용 드롭다운 + 영문용 드롭다운 각각 따로** (기존 그리드 나열 폐기)
- 톤: 친근한/프리미엄/우아한/긴박한/발랄한 (기존)

### 탭 ③ 브랜드보이스 (기존 `BrandVoiceCard` 그대로)
- 대표 문안 **최대 10건** 등록 → AI 가이드라인 추출(서명·슬로건·필수/금지어·문장 습관)
- 이미 구현됨 — 허브 탭으로 편입만.

---

## 4. UI 원칙 (Harold 지시)

- **깔끔·시인성 우선.** 필요한 정보를 한눈에 보고 넣을 수 있게.
- 서체 = 그리드 나열 금지 → **드롭다운**. 한글/영문 분리 선택.
- 신규 UI는 기존 AI 여정/디자인 톤과 동급 퀄리티([[feedback_design_quality_minimum_journey_level]]): 다크 톤, 탭 헤더, 섹션 카드, 모바일 반응형, native dialog 0(ConfirmModal/useToast).
- 모델명 UI 노출 0([[feedback_no_model_name_ui_exposure]]) — "AI 자동" 추상 명칭.

---

## 5. 데이터 모델

DDL 최소. 대부분 기존 저장소·jsonb 확장.

- **시각 정체성** = `companies.brand_kit` (jsonb, 단일) 계승. 신규 키(jsonb라 DDL 불요):
  - `font_ko`, `font_en` (서체 한/영 분리 — 기존 font_family/font_display 대체·마이그레이션 매핑)
  - `official_sns` (예: `{ instagram, youtube, naver, facebook }`)
- **브랜드 기본정보**: 업종=`companies.industry_code`(기존), 업태/종목=`companies.business_category/item`(기존). **브랜드명·사업자등록번호 저장 위치는 구현 전 `information_schema`로 확인**([[feedback_db_column_verify_before_code]]) — 기존 컬럼 없으면 companies 신규 컬럼 또는 brand_kit jsonb 편입 결정.
- **브랜드보이스** = `brand_guidelines`(기존) 그대로.

> 원칙: 이중 진실 금지. 시각·기본정보의 회사 기본값은 오직 이 허브가 씀.

---

## 6. 제거 대상

- DM 편집기 **브랜드킷 모달(`BrandKitModal`) 완전 제거** + 진입점(`DmQuickBar` "브랜드 킷" 칩). DM별 브랜드 override(`dm_pages.brand_kit` 편집)는 없어지고 모든 DM이 회사 브랜드 상속.
- 로고·색 **자동추출 버튼**(`/dm/brand-kit/extract` 호출 UI). — 사이트가 브랜드 자산을 표준 방식으로 노출해야만 되는 근본 한계(시세이도 실측: theme-color 미제공)라 신뢰 불가. 직접 입력이 확실. 품질 확보 시 "보조" 기능으로 재도입 여지는 남김(엔드포인트 즉시 삭제는 보류, UI만 제거 검토).
- 서체 **그리드 나열 UI** → 드롭다운.

---

## 7. 참조 통일 (전 소비처)

구현 시 아래 소비처가 전부 단일 허브 저장소를 보게 배선·점검([[feedback_impact_analysis_before_modification]]):

- DM 렌더: `dm-section-renderer`(store_info·footer·sns 등) — `companies.brand_kit` 상속(override 제거 후 회사값만)
- 이메일 렌더: 이메일 푸터 브랜드 정보
- 인앱 렌더: 인앱 안내 브랜드 정보
- 문안 생성: `copy-prompt-composer`(시각+기본정보+보이스 전부 참조하는지 확인)
- 자동 채움: DM 매장정보/이메일 푸터/인앱 안내가 기본정보 탭 값(연락처·홈페이지·SNS)으로 자동 기입

---

## 8. 마이그레이션·회귀 안전

- 시각 정체성 저장소 불변(`companies.brand_kit`) → 기존 회사 데이터 그대로 사용, 이전 없음.
- 서체 키 변경(font_family/display → font_ko/en): 로드 시 구키→신키 폴백 매핑(기존 설정 무손실).
- DM override 제거: 기존 `dm_pages.brand_kit`에 override 값이 있던 DM은 회사 기본값으로 렌더됨 — 영향 DM 수를 구현 전 SELECT로 파악해 보고(사전 고지 필요 여부 판단).
- 관련 기존 파리티/게이트 계열: [[project_2026_0721_mobile_dm_feature_wiring]], `dm-editor-parity` 계약.

---

## 9. 테스트 전략

- 백엔드: brand_kit 로드/저장 라운드트립(신규 필드 포함), 서체 구키 폴백, copy-prompt-composer가 통합 값 참조.
- 프론트: tsc 0, 탭 전환·저장, native dialog 0 grep.
- 소비 파리티: DM/이메일/인앱 푸터가 허브 값으로 자동 채워지는지.
- Codex 이중 검증([[feedback_default_codex_review_workflow]]) — DB 필드/데이터 흐름 변경 포함이라 `/codex:review`.

---

## 10. 범위 밖 (YAGNI)

- 자동추출 품질 개선(별도 과제로 분리 — 지금은 제거).
- 매장/고객센터 라벨·URL 표기 통일: 이 허브 완성 후 자연 흡수(기존 이연 항목).
- 브랜드보이스 추출 로직 변경 없음(현행 유지).

---

## 11. 미결 / 구현 전 확인

1. 브랜드명·사업자등록번호 컬럼 존재 여부 (`information_schema`).
2. 서체 무료 목록의 한글/영문 분류(어느 폰트가 한/영 드롭다운에 들어가는지) — 현재 목록 기준 매핑.
3. DM override(`dm_pages.brand_kit`) 실제 사용 DM 수 — 제거 영향 파악.
4. 자동추출 엔드포인트(`/dm/brand-kit/extract`) 완전 삭제 vs UI만 제거 — 재도입 여지 고려해 결정.
