# 브랜드 학습 통합 구현 계획 (Brand Learning Consolidation)

> **For agentic workers:** 이 계획은 task 단위로 실행. 각 task = 파일·변경·테스트·커밋. 스텝은 체크박스(`- [ ]`).
> SoT 설계 = [docs/2026-07-21-brand-learning-consolidation-design.md](2026-07-21-brand-learning-consolidation-design.md)

**Goal:** 브랜드 정보 편집을 AI메모리 "브랜딩 학습" 단일 허브(3탭)로 집약하고, 전 경로(DM·이메일·인앱·문안생성)가 그 단일 저장소만 참조하게 한다.

**Architecture:** `companies.brand_kit`(jsonb 단일) 계승 + jsonb 필드 확장(DDL 최소). 허브 = 3탭(기본정보·브랜드킷·브랜드보이스). DM 편집기 브랜드킷 모달·자동추출·서체 그리드 제거. 심플·모던·시인성 우선.

**Tech Stack:** React+TS(frontend), Node/Express+TS(backend), PostgreSQL(jsonb), vitest, Codex 검증.

**규칙:** 각 코드 변경 전 MANDATORY_CHECKLIST · SQL 신규컬럼은 information_schema 선검증 · 완료 시 tsc 0 + vitest + Codex.

---

## Phase 0 — 사전 실측 검증 ✅ 완료 (2026-07-21 실측)

- **기본정보 컬럼 = 기존 companies 컬럼으로 전부 충당(신규 컬럼 0)**: `brand_name` · `company_name`(상호) · `business_number`(사업자등록번호) 존재 확인 + 기존 `business_category`/`business_item`(업태/종목) · `industry_code`(업종). → 기본정보 탭은 companies 컬럼 저장(브랜드명/상호/사업자번호/업태/종목/업종), 연락처·주소·SNS만 `companies.brand_kit` jsonb.
- **브랜드보이스 저장처 = `ai_company_memory`(memory_type='brand_guideline')** (brand_guidelines 테이블 없음). BrandVoiceCard가 이미 사용 → Phase 6은 UI 편입만, 저장 무변.
- **DM override 실사용 52건** → **Harold 결정: 편집 UI만 제거 + 기존 52 override 렌더 유지(회귀 0), 향후 DM은 브랜드학습 완전 참조·자동 채움.** (Phase 7·8 반영)

---

## Phase 1 — 데이터 모델 확장 (backend)

**Files:**
- Modify: `packages/backend/src/utils/dm/dm-brand-kit.ts` (DmBrandKit 타입·DEFAULT·get/update)
- Modify: `packages/backend/src/utils/dm/dm-tokens.ts:111` (DmBrandKit type)
- Test: `packages/backend/src/utils/dm/dm-brand-kit.test.ts` (신규 또는 기존 확장)

### Task 1.1: brand_kit 타입에 신규 필드 추가
- [ ] **Step 1** DmBrandKit 타입에 필드 추가(jsonb라 DDL 불요):
```ts
// 서체 한/영 분리 (기존 font_family/font_display 대체)
font_ko?: string;    // 한글 서체 키
font_en?: string;    // 영문 서체 키
// 공식 SNS
official_sns?: { instagram?: string; youtube?: string; naver?: string; facebook?: string; x?: string };
// 기본정보(브랜드명·사업자정보는 Phase 0 결과로 위치 확정 — brand_kit 편입 시 아래)
brand_name?: string;
biz?: { company_name?: string; reg_no?: string; category?: string; item?: string };
contact?: { phone?: string; cs_phone?: string; email?: string; website?: string; address?: string };
```
- [ ] **Step 2** 기존 `font_family`/`font_display` → `font_ko`/`font_en` 로드 폴백(무손실):
```ts
export function normalizeBrandKit(raw: any): DmBrandKit {
  const k = raw || {};
  return { ...k,
    font_ko: k.font_ko ?? k.font_family,
    font_en: k.font_en ?? k.font_display ?? k.font_family,
  };
}
```
- [ ] **Step 3** `getCompanyBrandKit`가 normalizeBrandKit 거쳐 반환, `updateCompanyBrandKit`가 신규 필드 저장(jsonb merge) 확인.

### Task 1.2: 라운드트립 테스트
- [ ] **Step 1** 테스트: 신규 필드 저장→조회 일치 + 구키(font_family) 폴백.
```ts
it('brand_kit 신규 필드 라운드트립 + 서체 구키 폴백', () => {
  expect(normalizeBrandKit({ font_family: 'noto' }).font_ko).toBe('noto');
  const k = normalizeBrandKit({ font_ko: 'gothic', official_sns: { instagram: 'https://ig' } });
  expect(k.font_ko).toBe('gothic'); expect(k.official_sns?.instagram).toBe('https://ig');
});
```
- [ ] **Step 2** `npx vitest run dm-brand-kit` PASS. **Step 3** 커밋 `feat(brand): brand_kit 타입 확장(서체 한/영·SNS·기본정보) + 구키 폴백`.

---

## Phase 2 — 서체 목록 SoT (한/영 분류)

**Files:**
- Create: `packages/frontend/src/utils/brand-fonts.ts`
- 참조: 기존 서체 옵션(`dm-tokens.ts`/`dm-themes.ts` 서체 페어링 목록)

### Task 2.1: 드롭다운용 서체 목록 상수
- [ ] **Step 1** 현재 무료 서체 목록(스샷: Pretendard·노토세리프·나눔명조·고운바탕·고운돋움·검은고딕·노토산스·IBM플렉스산스·고딕A1·나눔고딕·주아·도현…)을 한/영 그룹으로 분류한 상수 생성:
```ts
export const BRAND_FONTS_KO = [
  { value: 'pretendard', label: '기본 (Pretendard)' },
  { value: 'noto-serif-kr', label: '노토 세리프 (명조)' },
  /* … 스샷 목록 전부 매핑 … */
] as const;
export const BRAND_FONTS_EN = [
  { value: 'inherit', label: '한글과 동일' },
  { value: 'ibm-plex-sans', label: 'IBM Plex Sans' },
  /* … 라틴 지원 서체 … */
] as const;
```
- [ ] **Step 2** 값(value)은 기존 렌더 서체 키와 1:1(발행 CSS 폰트 스택과 일치 — 미러 확인). **Step 3** 커밋.

---

## Phase 3 — 브랜딩 학습 = 단일 모달 + 3탭 (완전 새 디자인)

> **Harold 확정:** AiMemory 페이지 "브랜드 학습" 진입 **1개** → 클릭 시 **단일 모달** 오픈 → 모달 상단 **탭 3개**(기본정보/브랜드킷/브랜드보이스). 기존 흩어진 카드 2개(BrandStudioCard·BrandVoiceCard) 폐기·통합. 다크 톤·모던·시인성.

**Files:**
- Create: `packages/frontend/src/components/AiMemory/BrandLearningModal.tsx` (모달 + 탭 네비 + 탭별 콘텐츠 마운트)
- Create: `packages/frontend/src/components/AiMemory/BrandLearningCard.tsx` (페이지의 단일 진입 카드/버튼 — 클릭 시 모달 오픈)
- Modify: `packages/frontend/src/pages/AiMemoryPage.tsx:626-638` (BrandStudioCard+BrandVoiceCard 2개 호출 → BrandLearningCard 1개로 교체, import 정리)

### Task 3.1: 진입 카드 + 모달 셸
- [ ] **Step 1** `BrandLearningCard` 생성 — 페이지의 단일 진입점(요약 미리보기 + "브랜드 학습" 버튼). 클릭 → `open` 상태 → `BrandLearningModal` 오픈.
- [ ] **Step 2** `BrandLearningModal` 생성 — 인터럽트 모달 z-티어([[feedback_no_native_browser_dialog]] 계열 — z-[2000] 이상), 다크(`bg-slate-900 border-white/10 rounded-2xl`), X 닫기(백드롭 클릭 닫힘 금지), 상단 탭 3개(기본정보/브랜드킷/브랜드보이스) 세그먼트, 활성 탭만 콘텐츠 렌더. props: `open, onClose, apiBase, token, onToast`.
- [ ] **Step 3** AiMemoryPage 626-638의 두 카드 호출부를 `<BrandLearningCard .../>` 하나로 교체, 기존 import(BrandStudioCard/BrandVoiceCard) 정리.
- [ ] **Step 4** tsc 0 + 진입→모달→탭 전환 확인. **Step 5** 커밋 `feat(brand): 브랜딩 학습 단일 모달 + 3탭 셸`.

> Phase 4·5·6의 각 탭 콘텐츠는 이 모달의 탭 슬롯에 마운트(기본정보 폼 / 브랜드킷 편집 / 브랜드보이스). BrandStudioCard·BrandVoiceCard 로직은 탭 콘텐츠 컴포넌트로 이식·개조.

---

## Phase 4 — 탭① 브랜드 기본정보 (신규)

**Files:**
- Create: `packages/frontend/src/components/AiMemory/BrandBasicInfoTab.tsx`
- 사용 API: 기본정보를 brand_kit에 편입 시 기존 `/dm/brand-kit` GET/PUT 재사용(Phase 0 결과 따라 별도 companies 필드면 해당 API)

### Task 4.1: 기본정보 폼
- [ ] **Step 1** 섹션 그룹핑 폼(라벨+입력): 브랜드명 / 사업자정보(상호·등록번호·업태·종목) / 업종(select=industry_code) / 연락처(대표전화·**고객센터 번호**·이메일) / 홈페이지 / 주소 / 공식 SNS(인스타·유튜브·네이버·페북 — 있는 것만). native dialog 0, useToast 저장 피드백.
- [ ] **Step 2** 저장 = brand_kit(또는 companies) PUT. 로드 = GET. 빈 값 허용(선택 입력).
- [ ] **Step 3** tsc 0. **Step 4** 커밋 `feat(brand): 기본정보 탭(브랜드명·사업자·연락처·SNS)`.

---

## Phase 5 — 탭② 브랜드킷 (BrandStudioCard 개조)

**Files:**
- Modify: `packages/frontend/src/components/AiMemory/BrandStudioCard.tsx` → 탭 콘텐츠로 전환(`BrandKitTab.tsx`로 리네임 검토)

### Task 5.1: 자동추출 제거
- [ ] **Step 1** "홈페이지 주소 하나로 자동 학습" 카드·"AI 자동 추출" 버튼·`/dm/brand-kit/extract` 호출·`extracting` 상태 제거. (백엔드 엔드포인트는 보존 — 재도입 여지, 설계 §11-4.)
- [ ] **Step 2** 커밋.

### Task 5.2: 로고 업로드 전용
- [ ] **Step 1** 로고 = 파일 업로드만 유지(기존 업로드 경로). URL 자동추출 흔적 제거. 색 = 컬러 피커 직접 지정 유지.
- [ ] **Step 2** 커밋.

### Task 5.3: 서체 한/영 드롭다운
- [ ] **Step 1** 서체 그리드 나열 → `BRAND_FONTS_KO`/`BRAND_FONTS_EN`(Phase 2) 기반 **드롭다운 2개**(한글용/영문용). 저장 = `font_ko`/`font_en`.
- [ ] **Step 2** tsc 0. **Step 3** 커밋 `feat(brand): 브랜드킷 탭 — 로고 업로드·서체 한영 드롭다운·추출 제거`.

---

## Phase 6 — 탭③ 브랜드보이스 편입

**Files:**
- Modify: `packages/frontend/src/components/AiMemory/BrandVoiceCard.tsx` → 허브 탭 콘텐츠로 편입(로직 무변, 셸만 탭 정합)

### Task 6.1: 탭 편입
- [ ] **Step 1** BrandVoiceCard를 BrandLearningHub 탭③으로 렌더. 대표문안 10건→추출 로직 무변경(회귀 0).
- [ ] **Step 2** tsc 0. **Step 3** 커밋 `feat(brand): 브랜드보이스 탭 편입`.

---

## Phase 7 — DM 편집기 브랜드킷 제거

**Files:**
- Modify: `packages/frontend/src/components/dm/DmQuickBar.tsx:42-43` (브랜드킷 칩 제거)
- Delete/Modify: `packages/frontend/src/components/dm/modals/BrandKitModal.tsx`
- Modify: `packages/frontend/src/stores/dmBuilderStore.ts:76` (`'brand-kit'` 모달 타입·상태 제거)

### Task 7.1: 진입점(편집 UI)만 제거 — 렌더 폴백 유지 (Harold 결정)
> **결정:** 편집 UI만 제거하고 기존 `dm_pages.brand_kit` override 52건의 **렌더는 그대로 유지**(회귀 0). 렌더 코드(override-or-회사값)는 **손대지 않는다**. 새 DM은 override 없음 → 회사 브랜드 상속.
- [ ] **Step 1** DmQuickBar에서 "🎨 브랜드 킷" 칩 제거. dmBuilderStore openModal 유니온에서 `'brand-kit'` 제거 + 관련 분기 정리.
- [ ] **Step 2** BrandKitModal 참조 제거(파일 삭제 또는 미사용화). **렌더 경로(dm_pages.brand_kit 소비)는 무접촉 — 52건 보존.**
- [ ] **Step 3** tsc 0(미참조 잔존 0 grep) + 기존 override DM 렌더 회귀 0 확인. **Step 4** 커밋 `refactor(dm): DM 편집기 브랜드킷 편집 제거(렌더 폴백 유지) — 편집은 브랜딩 학습으로 일원화`.

---

## Phase 8 — 소비처 참조 통일

**Files:**
- Modify(확인): `packages/backend/src/utils/dm/dm-section-renderer.ts`(footer/store_info/sns), 이메일 렌더, 인앱 렌더, `packages/backend/src/utils/copy-prompt-composer.ts`

> **구현 결과(2026-07-21) — 전부 완료:** 색·서체 = renderDmTokensCss가 brand_kit primary/accent/background + font_ko/font_en(영문=웹세이프 라틴 폰트, 미설정=회귀 0) 소비 + 프리로드 반영. **연락처 자동채움 = 완료** — `seedBrandContact()`(순수·테스트)가 DM 생성 시점(양 경로: `/ai/recommend-layout` + `/ai/one-shot-generate`)에 footer.cs_phone·store_info(phone/email/website/address) 빈 필드를 회사 brand_kit.contact로 시드. 생성 시점 시드라 편집기·발송물 동일(편집=발송·#3 파리티 유지), 기존 값 미덮어씀. **Codex 2라운드 검증 반영**(High 2·Medium 4·Low 1 정정: 데이터 손실 가드·font_family 미러·부분저장 메시지·industry 화이트리스트·업태=business_type·서체 한영 실동작·클리어 null·학습 판정).

### Task 8.1: 자동 채움·참조 배선 (★ Harold 강조 — 향후 DM은 브랜드학습 완전 참조)
> **핵심:** 새 DM 생성 시 매장정보/푸터/연락처/SNS/색/서체가 **브랜딩 학습(companies.brand_kit + companies 컬럼)에서 자동으로 채워져야** 한다. "빈 칸 두고 사용자가 다시 입력" 금지 — 허브 값이 있으면 자동 주입.
- [ ] **Step 1** DM 매장정보/푸터·이메일 푸터·인앱 안내가 기본정보 값(브랜드명·상호·연락처·고객센터·홈페이지·주소·SNS)을 허브에서 자동 참조·채움하는지 전수 확인. 미배선이면 배선([[feedback_impact_analysis_before_modification]] — 전 소비처 grep). 새 DM 초기 생성 시 회사 brand_kit·기본정보 상속 주입 경로 확인.
- [ ] **Step 2** copy-prompt-composer가 시각+기본정보+보이스 전부 참조하는지 확인·보강.
- [ ] **Step 3** 서체 렌더: `font_ko`/`font_en`가 발행 CSS 폰트 스택으로 반영(구키 폴백 포함).
- [ ] **Step 4** 커밋 `feat(brand): 전 소비처 단일 브랜드 참조·자동 채움 통일`.

---

## Phase 9 — 검증

### Task 9.1: 전체 검증
- [ ] backend tsc 0 · frontend tsc 0
- [ ] vitest(brand-kit 라운드트립·서체 폴백·소비 파리티) PASS
- [ ] 자가 grep 0: 모델명(Opus/Sonnet/GPT/Claude)·native dialog(alert/confirm/prompt)·박-단어
- [ ] 서체/색/기본정보 저장→DM·이메일·인앱 자동 채움 실측 시나리오 1건
- [ ] Codex `/codex:review`(DB 필드·데이터 흐름 변경 포함) → 이슈 정정 → 재검증
- [ ] 표준 종료 멘트 + 배포 명령 제공(tp-push → build:safe → pm2 reload)

---

## 자가 검토 (작성 후)

- **스펙 커버리지:** 설계 §3(3탭)·§5(데이터)·§6(제거)·§7(참조통일) 전부 Phase 1~8에 매핑됨. 고객센터 번호=Task 4.1, SNS=Task 1.1/4.1, 서체 한영=Task 2/5.3.
- **미결 의존:** Phase 0 실측 결과가 Phase 1·4의 데이터 위치를 확정(브랜드명/사업자번호 컬럼). Phase 0 없이 Phase 1 착수 금지.
- **타입 일관성:** font_ko/font_en·official_sns·brand_name 이름을 Phase 1 정의 → 2/4/5/8에서 동일 사용.
