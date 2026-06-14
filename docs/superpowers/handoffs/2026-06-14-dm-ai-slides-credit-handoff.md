# 모바일 DM 다음 세션 핸드오프 — ⑥ AI 두 모드 자동생성 + ⑦ 크레딧 조정 (2026-06-14 작성)

> 이 문서만 보고 바로 작업을 이어갈 수 있도록 작성. 재조사 없이 실행 가능하게 코드 위치·근본 원인·접근·제약을 모두 담음.

## 0. 진입 의무 (작업 시작 전)

1. CLAUDE.md 정독 + `status/lessons/LESSONS_BACKEND.md`·`LESSONS_FRONTEND.md` 우선 정독.
2. 핵심 영구 룰: **`feedback_ai_no_arbitrary_benefit`**(AI 구체 혜택 %/원/쿠폰/무료/사은품/할인 임의 생성 절대 금지 — `[직접 작성해주세요]` placeholder) / `feedback_external_api_response_verification`(외부 AI raw 응답 직접 검증 후 파싱) / `feedback_marketing_user_ux_priority`(1클릭 = AI 자동 흐름) / `no_model_name_ui_exposure` / dev_process_six ⑤(발송·돈은 실측 1건).
3. 매 답변 직전 + 코드 작성 직후 Grep으로 박-단어·모델명·native dialog 0건 확인.

## 1. 지난 세션(2026-06-14) 완료분 — 배포 완료

- **B~G**: 인터랙션 엔진(추첨 3방식·신규 3테이블 dm_prizes/dm_winners/dm_draw_runs·뷰어 JS·admin 7 endpoint) / 신규 16섹션 editor + RepeatableList + 경품설정 / 이미지 견고화 / 빠른시작 12 + 썸네일 12종 고유 / 헤더 정렬 / F 안1 `dm-interaction-publish` 50 / G applyInteractionDefaults + buildEventInsight.
- **캔버스 편집 UX 보강**: ① 이미지 근본 fix(업로드 반환 URL `/api/flyer/p/dm-images` → `/api/dm/v/images` + 프런트 `dmImageUrl` 정규화) ② 전 섹션 정렬(`Section.align` 공통) ③ 섹션 버튼색(`Section.accent_color` → 섹션 한정 `--dm-primary` 덮어쓰기) ④ 헤더 브랜드명/로고 크기 ⑤ 레이아웃 토글·뷰어 3모드 작동 확인.
- 전부 backend/frontend tsc 0 · 순수 코어 19 GREEN · 자가 grep 0. **Harold 배포 완료.**

## 2. ⑥ AI 자동생성이 두 레이아웃 모드 다 + "어지간한 건 거의 다 채움" (Harold 최우선)

### 2-1. 근본 원인 (이미 조사 완료 — 재조사 불필요)

- **AI가 슬라이드를 절대 안 만드는 원인**: `packages/frontend/src/pages/DmBuilderPage.tsx`
  - `handleAutoGenerate`(약 176~230행)이 `createNew({ title, layoutMode: 'scroll' })`(약 199행)으로 **무조건 scroll 고정**. 빈 캔버스 시작도 173행 `createNew({ layoutMode: 'scroll' })`.
  - 생성 결과를 `applyAiGenerated(sections, brand_kit, prompt)`(약 210행)로 적용.
- **섹션이 페이지로 안 쪼개지는 원인**: `packages/frontend/src/stores/dmBuilderStore.ts`
  - `applyAiGenerated`(약 601~610행)이 `updateCurrentPageSections(s, () => sections)` — **모든 섹션을 현재 페이지 1개에만** 채움. = scroll(한 페이지). 슬라이드면 여러 페이지로 나눠야 함.
  - 데이터 모델은 멀티 페이지 지원: `pages: DmPage[]`(각 page = `{id, name?, sections}`), `layoutMode: 'scroll' | 'scroll_snap' | 'slides'`. 페이지 추가/이동/삭제 액션 이미 존재(`addPage`/`removePage`/`movePage` 등).
- **뷰어는 이미 3모드 렌더 가능**: `packages/backend/src/utils/dm/dm-viewer.ts` `renderPagesHtml`이 scroll/scroll_snap/slides CSS 분기 보유. = 페이지만 제대로 만들면 슬라이드 발송 정상.
- **시나리오 섹션 chain**: `packages/backend/src/utils/dm/dm-ai.ts` `SCENARIO_MAP`(약 493행, 12 시나리오) → `oneShotGenerate`가 **flat sections** 반환(`{ spec, sections, brandKit, scenario }`, 약 585행). 페이지 개념은 프런트 store에만 있음.

### 2-2. 접근 (설계 → Harold 컨펌 후 구현)

1. **모드 고정 해제**: `handleAutoGenerate`가 `layoutMode: 'scroll'` 하드코딩 대신 **현재 선택된 모드**(store `layoutMode`)를 사용. 빠른시작 카드·자유 입력 모두 동일.
2. **슬라이드면 페이지 자동 분할**: 프런트에 순수 헬퍼 `splitSectionsIntoPages(sections): DmPage[]` 신설(예: header+hero = 1페이지, 이후 주요 섹션 각 1페이지, footer = 마지막 페이지). `applyAiGenerated`(또는 새 경로)가 `layoutMode === 'slides'`면 이 헬퍼로 `pages[]`를 구성, 아니면 기존처럼 한 페이지.
   - 순수 함수라 backend로 빼서 ts-node TDD 가능(프런트 ESM TDD는 ERR_UNKNOWN_FILE_EXTENSION로 막힘 — LESSONS_BACKEND D234+ 참조). 또는 프런트 vitest.
3. **"어지간한 건 거의 다 채움"**(Harold 핵심): `dm-ai.ts`
   - `generateCopy`/`mergeCopyIntoProps`(약 575·588행)가 섹션별 카피를 더 풍성하게(헤드라인+서브+설명+CTA 문구). 시스템 프롬프트 보강하되 **구체 혜택 숫자는 절대 생성 금지**(feedback_ai_no_arbitrary_benefit) — %/원/쿠폰/무료는 `[직접 작성해주세요]`.
   - `applyInteractionDefaults`(약 588행 위, 신설됨)가 경품 구조 placeholder를 이미 채움 → 다른 섹션도 합리적 기본값 더 채우기(예: countdown 기본 마감 안내 문구, poll 기본 선택지, product placeholder 명시). **사실/숫자/혜택은 비우고 골격·문구·구조만.**
   - 외부 AI raw 응답은 첫 호출 시 `console.log`로 직접 확인 후 파싱 확정(feedback_external_api_response_verification).
4. **검증**: 빠른시작 카드(슬라이드 모드) 클릭 → 여러 페이지 생성 + 편집 진입 1건 실측. scroll 모드 → 한 페이지. backend/frontend tsc 0.

### 2-3. 핵심 파일 지도

| 파일 | 역할 | 다음 세션 작업 |
|------|------|----------------|
| `packages/frontend/src/pages/DmBuilderPage.tsx` | handleAutoGenerate(176~230)·QUICK_STARTS(60~) | scroll 고정 해제 → 현재 모드 사용 |
| `packages/frontend/src/stores/dmBuilderStore.ts` | applyAiGenerated(601)·pages 모델·addPage 등 | 슬라이드면 splitSectionsIntoPages로 pages 구성 |
| `packages/backend/src/utils/dm/dm-ai.ts` | oneShotGenerate·SCENARIO_MAP·generateCopy·applyInteractionDefaults | 카피·기본값 더 채움(혜택 숫자 X) |
| `packages/backend/src/utils/dm/dm-viewer.ts` | renderPagesHtml(3모드) | 변경 거의 불필요(이미 슬라이드 렌더) |

## 3. ⑦ 크레딧 조정 (AI가 거의 다 해주면 그에 맞게)

- **현재 단가**(`packages/backend/src/utils/ai-credit-calc.ts` CREDIT_COST_MAP):
  - `dm-ai-generate` 3 (자연어→섹션 돌려보기, 호출마다)
  - `dm-builder` 30 (일반 DM 발행, 최초 1회 멱등)
  - `dm-interaction-publish` 50 (인터랙션 캠페인 발행, F 안1 — 발행 라우트 `dm.ts:303`에서 `isInteractionCampaign`로 자동 분기)
- **검토 포인트**: AI가 "거의 다" 만들어주는 가치 상승분을 어디서 청구할지. 종량제(D227+) 유지하면서 ① 생성 단가(3) 유지 vs 상향, ② 발행 단가(인터랙션 50)와의 균형. **단가는 Harold 결정(가격 정책)** — config가 진실(코드 상수). 임의 변경 금지, 안 제시 후 컨펌.
- 발송(당첨 통보)은 기존 발송 크레딧 그대로(발송은 발송대로).

## 4. 함께 남은 후속(돈/발송 = 실측 필요, 별도)

- **당첨 통보 자동발송 endpoint**: 현재는 당첨자 xlsx 다운로드 → 기존 직접발송으로 통보(`dm_winners.notified_at` 컬럼 준비됨). 자동발송은 발송 경로라 실측 1건 검증 후 안전 구현(dev_process_six).
- **AI 자연어 경품 파싱 심화**: "에어팟 1명·스벅 10명" 같은 자연어를 dm_prizes 등급/인원으로 파싱. 현재는 결정적 구조 + placeholder. 외부 AI raw 검증 후.

## 5. 배포 (다음 세션 종료 시)

`tp-push` → backend **`pm2 restart all`**(ts-node, build:safe 무관) + frontend **`build:safe`**. 신규 DB 컬럼/테이블 없으면 추가 SQL 0. (Harold 직접 실행.)

## 6. 자가 검증 체크리스트 (종료 전)

- [ ] backend tsc 0 / frontend tsc 0
- [ ] 슬라이드 모드 빠른시작 1건 → 여러 페이지 생성 실측 / scroll 1건 → 한 페이지
- [ ] AI 생성물에 구체 혜택(%/원/쿠폰/무료) 0건 — 전부 `[직접 작성해주세요]`
- [ ] 박-단어·모델명·native dialog grep 0
- [ ] 크레딧 단가는 Harold 컨펌 후에만 변경
