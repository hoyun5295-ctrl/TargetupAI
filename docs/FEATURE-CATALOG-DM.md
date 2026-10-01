# 카탈로그 DM (기능 상설 문서 · 2026-09-15 신설)

> **호출어 = "카탈로그 DM" / "카탈로그형 DM" / "메이크뷰"**. 이 문서가 이 기능의 **정체성·불변 원칙·구조·입구 3곳·요금·추적·실측 원장·이력**을 소유한다. STATUS는 세션 행으로 참조만 한다.
> 시점 근거 = [0915 인계 §6](2026-09-15-session-handoff.md)(카탈로그 보기·DM 메뉴·AI 자동제작 채널 구현 기록) · [0915 인계 §7](2026-09-15-session-handoff.md)(아웃리치 카탈로그) · 메이크뷰 실측·비교·제안 3축 = memory `project_2026_0915_catalog_dm_review`. 두 문서가 다르면 **현재 코드가 진실**이다.
> 관련 상설 = [FEATURE-AI-AUTO-BUILD.md](FEATURE-AI-AUTO-BUILD.md)(카탈로그 채널 요금·재료 계약) · [FEATURE-SALES-OUTREACH.md](FEATURE-SALES-OUTREACH.md)(아웃리치 카탈로그 DM 이력) · [FEATURE-HELP-CATALOG.md](FEATURE-HELP-CATALOG.md)(도움말 문구 원장).

---

## §0 30초 요약

- **무엇**: 장마다 이미지 1장인 슬라이드 DM을 **PC에서는 책처럼 두 쪽 펼침**(표지 단독 → 2쪽 펼침 · 낱장 넘김 · 전체보기 썸네일 · 처음/마지막 · 확대 · 한쪽/두쪽 · 전체화면), **휴대폰에서는 현행 슬라이드 무대 그대로**(+ 띠 왼쪽 전체보기 · 두 손가락 확대)로 보여 주는 보기 방식. 참고 실물 = 메이크뷰 e-book 뷰어(jQuery 플릭 · PC 두 쪽 · 썸네일 · 전체화면 · 링크 추적).
- **어떤 DM이 되나**: **Harold 0915 정정** = 자동 판정이 아니라 **고른 DM만**. 저장값 `dm_pages.settings.catalog === true`(jsonb 기존 컬럼 · DDL 0) AND `layout_mode = 'slides'` AND 펼친 뒤 전 장이 이미지 1장 무대(2쪽 이상). 플래그 없는 DM은 전 장 이미지라도 현행 슬라이드(출력 바이트 동일).
- **입구 3곳**: ①모바일 DM 목록 카드띠 **[카탈로그 DM]** 카드 + 편집기 상단 토글 3안(스크롤·슬라이드·**카탈로그**) + 목록 뱃지 ②**AI 자동제작 채널 [카탈로그 DM]**(쪽 이미지 N장 · 수량 제한 없음 · **10크레딧**) ③**AI 영업 아웃리치**(크롤 사본으로 서버가 자동 조립 · AI 0 · 크레딧 0 · 제안 메일 3번째 버튼 「카탈로그 보기」).
- **추적**: 수신자별 도달 장·진행률·장별 조회는 기존 뷰어 비콘 그대로(책이 쪽을 보일 때 같은 함수를 부른다 · 비콘 본문·주기 무변경 · 이중 집계 0).
- **상태(0915)**: ①②는 배포 · Harold 실측 「제대로 적용되었다 완벽해」. ③은 `d12997a2` 배포 · 새 잡에서 카탈로그 생성 확인 · Harold 「아직 좀 수정이 필요」(항목은 다음 세션 접수) → §9.

---

## §1 정체성

- **보기 방식이지 새 채널이 아니다.** 저장 구조는 슬라이드 DM(장마다 `list_1xN` 갤러리 1장)이고, 카탈로그는 그 위에 얹는 **플래그 + PC 크롬**이다. 편집기·발행·단축 주소·추적·수신자 상세는 슬라이드 DM의 것을 그대로 쓴다.
- **이미지만으로 완성되는 산출물.** 쪽은 사용자가 올린 완성 이미지(카드·AI 자동제작) 또는 서버가 합성한 이미지(아웃리치)이며 AI 문안·판독이 없다. 그래서 AI 자동제작 채널 요금(10)은 판독·모델 비용이 아닌 **조립·발행 서비스 요금**이다(Harold 확정).
- **선택형.** 어떤 DM이 카탈로그가 되는지는 사람이 정한다(카드·토글·채널이 플래그를 심는다). 자동 판정으로 만들었던 1차 판(`a99cef1a`)은 Harold 정정으로 폐기됐다(§8).

## §2 불변 원칙 (어길 수 없는 것)

1. **고른 DM만.** `settings.catalog === true`가 없으면 어떤 조건이라도 책이 되지 않는다. 판정 함수는 한 곳 `dm-viewer-catalog.ts isCatalogEnabled`(뷰어 · 목록 뱃지 공용).
2. **기술 자격은 플래그와 AND.** `isCatalogDm(pages)` = 펼친 뒤 전 장 `isSwipeImagePage` · 2쪽 이상. 자격만으로는 게이트가 아니다.
3. **조건 밖 DM 출력은 바이트 동일.** 게이트 off 인 `renderPagesHtml` 출력에 `dm-cat` 문자열이 0(계약 테스트). 기존 발행물 무회귀.
4. **쪽 조립은 CT 한 곳** `dm/dm-catalog-pages.ts catalogPagesOf(images, idPrefix)` = 장마다 `gallery list_1xN full_bleed` 1장 · `link_url`은 있을 때만. AI 자동제작(`catalog-p{n}`)과 아웃리치(`so-cat-p{n}`)가 같은 함수를 쓴다. 인라인 조립 금지(계약 테스트).
5. **추적 무변경.** 책은 쪽을 보일 때 기존 뷰어 스크립트의 `updateCurrent`(도달 장·진행률)·`bumpSection`(장별 조회)을 부른다. 비콘 본문(`POST /api/dm/v/:code/track`)·주기·키(token > phone > anon)는 건드리지 않는다. PC에서 기존 `.dm-viewer`는 `display:none`이라 IntersectionObserver 이중 집계 0.
6. **이미지 안 글자 = 숫자 0 · 혜택어 0.** 서버가 쪽에 글자를 찍을 때(아웃리치 상품 카드 캡션)는 포스터 문구 게이트 `posterTextOk`를 그대로 쓴다. 가격은 이미지에 넣지 않는다(발송 잠금이 이미지 글자를 못 보므로 · 회의 수렴안 D5).
7. **뷰어 조각은 template literal 안에 들어간다.** `dm-viewer-catalog.ts`가 돌려주는 문자열에 백틱·`${`·정규식을 쓰지 않는다(파일 머리 규약).
8. **DDL 0.** `settings`는 `dm_pages`의 기존 jsonb 컬럼이고 이 키 전에는 어떤 코드도 읽지 않았다(dm-builder 저장만). 새 컬럼·테이블 없이 세 입구가 모두 이 키 하나를 심는다.
9. **요금은 서버 견적 한 곳.** AI 자동제작 채널 `catalog-dm-build` 10 = 견적 결박(409) → `checkCredit` → 초안 행 → 멱등 차감(`quick:{company}:catalog:{token}:{과금 지문16}`) → 차감 호출이 던지면 행 회수. 카드 경로는 완성 슬라이드 카드와 같은 경로라 생성 크레딧 0 · 발행은 기존 발행가. 아웃리치는 내부 계정 CT 직접 호출 = 미차감.
10. **아웃리치 카탈로그는 실패 격리 · 옛 것 중지.** 카탈로그 실패는 `catalogSkipped 'error'`로 남기고 DM 단계를 막지 않는다. 재조립(`stopSupersededDms`)·파기(`purgeOutreachJobArtifacts`)가 `catalogDmId`도 중지하고 합성 카드 파일도 지운다.
11. **사용자 노출 문구** = 모델명 0 · 줄표 「—」 0 · 내부 코드명 0(모든 화면 공통 규율).

## §3 구조 (파일별 소유 · 2026-09-15 실물)

| 축 | 파일 | 소유 |
|---|---|---|
| 뷰어 조각(순수 · DB 0) | `packages/backend/src/utils/dm/dm-viewer-catalog.ts` | `isCatalogDm` · `catalogSettingsOf` · `isCatalogEnabled` · `catalogFirstImageUrl` · og 메타(상호 - 제목 · 첫 장 절대 URL) · 핀치 허용 viewport · CSS/HTML/스크립트(접두 `dm-cat-`) · PC 판정 = `innerWidth >= 768 && !(터치형 && innerWidth < 1024)` · 동작 축소 설정 = 크로스페이드 |
| 뷰어 배선 | `packages/backend/src/utils/dm/dm-viewer.ts renderPagesHtml` | 게이트 `mode === 'slides' && isCatalogEnabled(dm) && isCatalogDm(pages)` 일 때만 viewport 교체 · og · CSS · `body[data-dm-catalog="1"]` · 띠 왼쪽 전체보기 · 마크업 · 스크립트 · 기존 ←/→ 핸들러 가드 |
| 목록 뱃지 | `packages/backend/src/utils/dm/dm-builder.ts getDmList` | SELECT `settings` + `catalog: isCatalogEnabled(row)` |
| 쪽 조립 CT | `packages/backend/src/utils/dm/dm-catalog-pages.ts` | `catalogPagesOf` (§2-4) |
| DM 메뉴(프론트) | `pages/DmBuilderPage.tsx` · `components/dm/DmTopBar.tsx` · `components/dm/DmCanvas.tsx` · `stores/dmBuilderStore.ts` | 카드띠 4번째 카드 **카탈로그 DM**(쪽 이미지 업로드 → 장당 1쪽 slides + 플래그) · 토글 3안(카탈로그 = slides + 플래그 · 슬라이드/스크롤로 바꾸면 해제) · 캔버스 라벨 · 저장 body `settings: { catalog }` · 로드 `dm.settings` · 목록 뱃지 「카탈로그」. 발행된 DM은 자동저장이 꺼져 있어 [저장] 버튼을 눌러야 플래그가 반영된다 |
| AI 자동제작 채널(서버) | `utils/ai-auto-build-materials.ts` · `utils/campaign-quick.ts buildCatalogDm` · `utils/ai-credit-calc.ts` · `routes/event-campaigns.ts` | `BuildChannel 'catalog'` · `catalogImages`(기술 상한 500 · 회사 서빙 경로만) · `catalogTitle` · 게이트 = 쪽 2장(`checkCatalogMinimum` · missing `pages`) · 견적 `catalog-dm-build` 10 · DM 라우트 가족(`channel: 'dm'` 라우트가 catalog 재료 통과 · `requirePlanFeature mobile_dm`) |
| AI 자동제작 채널(프론트) | `pages/QuickCampaignPage.tsx` · `components/ai-build/CatalogPagesInput.tsx` · `utils/ai-build.ts` · `constants/credit.ts` | 채널 탭 3번째 · 제목 입력 · 9장씩 나눠 업로드(`/api/event-campaigns/materials`) · 번호 썸네일 · 드래그 정렬 · 라이브러리 · 견적 바 「쪽 N장」 · 확인 모달 `catalog-dm-build` |
| 아웃리치 카탈로그 | `packages/backend/src/utils/sales-outreach-catalog.ts` | `planOutreachCatalog`(순수 · 포스터 → 상품 ≤6 → 행사 슬라이스 ≤3 · 같은 주소 1번 · 2쪽 미만 생략) · `catalogCaptionOf`(§2-6) · `catalogTintOf`(흰 바탕 + 브랜드색 8%) · `renderCatalogCardBuffer`(sharp 1200×1600 · 상품 사본 contain · 확대 2배 상한) · `composeCatalogProductCard`(캡션은 파이썬 합성기 typography) · `publishOutreachCatalogDm`(createDm slides + `settings.catalog` + publishDm) · `buildOutreachCatalog` |
| 아웃리치 배선 | `utils/sales-outreach-jobs.ts producing_dm` · `producing_email` · `stopSupersededDms` · `utils/sales-outreach-purge.ts` · `utils/sales-outreach-produce.ts buildProposalEmailSections` · `utils/sales-outreach-style.ts emailCopy.cta.catalog` · `components/admin/SalesOutreachModal.tsx` | `dm` 자산 payload `+ catalogDmId · catalogUrl · catalogViewerUrl · catalogPages · catalogImageUrls · catalogSkipped`([SCHEMA](../status/SCHEMA.md)) · 메일 버튼 바 「산출물 보기 · 카탈로그 보기 · DM 열어보기」(없으면 2개) · 평문 1줄 · 검토 화면 "담당자가 열 주소" 카탈로그 행 |
| 도움말 원장 | `packages/backend/src/content/feature-catalog.ts` | 모바일 DM 만들기 단계의 카탈로그 DM 카드·토글 문구 · AI 자동제작 채널 3종 문구 |
| 테스트 | `dm-viewer-catalog.test.ts` 12 · `ai-auto-build-catalog.test.ts` 12 · `sales-outreach-catalog.test.ts` 16 · `campaign-engine.test.ts`(크레딧 키 계약 예외) · `sales-outreach-invariants.test.ts`(주소 헬퍼) | 플래그 off = `dm-cat` 0 · 문자열 settings · og · viewport · 추적 배선 / 정규화·상한·게이트·견적 10/0·차감 순서·멱등·회수·409 / 쪽 조립·캡션 게이트·틴트·계획 순서·상한·중복·최소 쪽·sharp 카드·메일 3버튼·배선 소스 계약 |

## §4 입구 3곳 (사용자 흐름)

> **★2026-09-27 만들기 개편([설계서](2026-09-27-make-redesign-design.md))** — 모바일 DM 첫 화면 만들기 카드 아래 [카탈로그 DM 만들기] = 만들기 화면 카탈로그 채널(쪽 사진 · AI 0). 옛 [완성 이미지로 만들기]는 "다른 방법으로 만들기" 안에 그대로. 수정 화면 카탈로그 모드 = 왼쪽 **쪽** 목록(썸네일 · 끌어서 순서 · ★1001 쪽 패널 [이 쪽 빼기]) · 가운데 **휴대폰 슬라이드 + 넘김 효과 3종**(휴대폰 위 전환) / **PC 책 카드 + [PC 화면 크게 보기]**(효과 무관 · 상품 칩 없음 = 뷰어 실물 그대로) · 오른쪽 **쪽 패널**(쪽 모양 4종 = 이 쪽 다시 만들기 · 사진 바꾸기·스튜디오 · 상품 칩 편집). ⛔ 휴대폰 자리에 PC 책을 놓지 않는다(Harold 0927).

1. **DM 메뉴 카드** : 모바일 DM 목록 → 카드띠 [카탈로그 DM] → 쪽 이미지 여러 장 업로드(완성 슬라이드 카드와 같은 업로더) → 편집기가 열린다(토글 = 카탈로그 · 캔버스 라벨 「카탈로그 (휴대폰 슬라이드 · PC 책 펼침)」) → 발행. 기존 슬라이드 DM도 편집기 토글을 [카탈로그]로 바꾸고 저장하면 된다(발행된 DM은 [저장] 버튼 필요).
2. **AI 자동제작 채널** : AI 자동제작 → 채널 [카탈로그 DM] → 쪽 이미지 N장(장수 제한 없음 · 9장씩 나눠 올라간다) + 선택 제목 → 견적 바 「카탈로그 DM 생성 10 = 10 크레딧 · 쪽 N장」 → 확인 창 → 초안 DM이 편집기에 열린다(카탈로그 토글 on). 쪽 1장이면 버튼 잠김 + 「카탈로그 쪽 이미지를 2장 이상 올려 주세요」.
3. **AI 영업 아웃리치** : 잡의 DM 단계가 영업 DM을 발행한 뒤 카탈로그 DM을 하나 더 만든다(포스터 → 상품 카드 → 행사 슬라이스 · 사람이 재료 탭에서 고른 사본만). 검토 화면 "담당자가 열 주소"에 「카탈로그」 행 · 제안 메일 3번째 버튼. 기존 잡은 「고른 재료로 다시 만들기」로 생성된다. 쪽 링크 = 상품 URL · 히어로 링크 · 행사 상세(모바일 탭 · PC 책은 링크 없음).

## §5 요금

| 입구 | 생성 | 근거 |
|---|---|---|
| DM 메뉴 카드 · 편집기 토글 | 0(완성 슬라이드 카드와 같은 경로) · 발행은 기존 발행가 | §2-9 |
| AI 자동제작 채널 | `catalog-dm-build` **10**(Harold 0915 확정 · 판독 0 · 재생성 = 매회 · 크레딧제 미적용 회사 = 0 표시) | [FEATURE-AI-AUTO-BUILD §4](FEATURE-AI-AUTO-BUILD.md) |
| 아웃리치 | 0(내부 전용 회사 계정 · CT 직접 호출 = 미차감) | FEATURE-SALES-OUTREACH 불변 |

## §6 추적 (있는 것 · 없는 것)

- **있는 것(기존 그대로)**: 수신자별 링크(`hlj.kr/<8자>` → `?r=<token>` · 30일) · 도달 장 · 진행률 · 완독 · 장별 조회 · 클릭 · 발송 추적 탭 [공용 링크] 축. 책이 쪽을 보일 때 같은 함수가 돌아 PC 열람도 같은 원장(`dm_views`)에 쌓인다.
- **없는 것(범위 밖 · §9)**: 장별 체류 시간·열람 순서(`section_interactions` jsonb 확장 · DDL 0) · 이미지 위 핫스팟 레이어(편집기 축) · PC 책의 쪽 링크 · 아웃리치 카탈로그 열람이 아웃리치 열람 집계 SQL(`payload->>'dmId'` 조인)에 안 잡힘.

## §7 실측 원장 (Harold 실행분만)

| 시각 | 확인 | 결과 |
|---|---|---|
| 0915 21:40 | 정정판 배포 뒤 편집기 토글 · PC 책 펼침 · 휴대폰 슬라이드 | Harold 「제대로 적용되었다 완벽해」 |
| 0915 22:23 | `d12997a2` 배포 판정(커밋 · dist 문자열 · 신규 파일 2 · pm2 uptime 리셋) | 4항목 기대값 |
| 0915 22:3x | 공개 웹 보기 `/api/outreach/v/137c25fd33` 버튼 | 「DM 열어보기」 1개 = [B-0915-5](../status/BUGS.md) 통과 |
| 0915 22:3x | 새 AI 영업 잡 처음부터 → 카탈로그 DM | 생성 확인 · Harold 「아직 좀 수정이 필요」(항목 = 다음 세션 접수) |
| 미실측 | AI 자동제작 채널 10크레딧 원장 SQL · 쪽 1장 게이트 · 추적 +1 · og 미리보기 · 포스터 글자색([B-0915-4](../status/BUGS.md)) | [0915 인계 §6-3 5~8 · §7-3 3~5](2026-09-15-session-handoff.md) |

## §7-2 ★ 2026-09-16 쪽 템플릿 · 넘김 효과 · 상품 칩 (블록 조립 축 · 설계서 `docs/2026-09-16-dm-block-assembly-design.md`)

- **쪽 템플릿 4종**(표지 · 상품 한 점 · 두 점 비교 · 마무리) = `utils/dm/dm-catalog-templates.ts`(자리·줄 나눔·글자 항목 · 순수) + `dm-catalog-render.ts`(sharp 배치 + 파이썬 글자 합성 → 1200×1600 한 장).
  합성 결과가 갤러리 1장짜리 장이라 책 자격(`isSwipeImagePage`)을 그대로 통과한다. 경로 = `POST /api/dm/catalog/render-pages`(AI 0 · 크레딧 0 · 한 번에 30쪽).
- **넘김 효과 3종** = `settings.effect` (`slide` 기본 · `flip` · `fade`). 미지정·`slide`면 발행 HTML 에 흔적이 없다(현행 가로 스크롤 그대로). 조각 = `utils/dm/dm-effect.ts` · 배선 = `dm-viewer.ts` 4곳(CSS·body 표식·goToPage 분기·스크립트).
- **상품 칩** = 갤러리 props `chips[{label, price?, url?}]` → 이미지 **밖** 알약(`data-dm-chip` · 최대 4개 · `safeUrl` 통과분만 링크). 가격을 이미지에 새기지 않는 이유 = 값이 바뀌면 재합성 없이는 못 고친다. 계약 = `dm-property-contract DM_GALLERY_CHIP_MARKER`.
- **입구 통합** = 시작 화면의 [완성 슬라이드]와 [카탈로그 DM]은 만드는 결과가 같았다(장마다 이미지 1장 · `settings.catalog` 한 값만 차이). 하나로 합쳐 **완성 이미지 올리기**가 되고 책 펼침은 편집기 토글이 소유한다.
- **입구 통합(★0916)** = 시작 화면 타일이 [직접 제작]·[완성 슬라이드]·[카탈로그 DM]·[라이브러리] 4개였는데, 만드는 결과로 보면 셋이 같은 이미지 DM 이었다(사진 출처·`settings.catalog` 만 달랐다). 지금은 **완성 이미지로 만들기** 하나(저장 소재는 그 카드 안 보조 줄) + 상단 카드띠 [블록으로 만들기]. 빈 캔버스 경로는 조립 화면 헤더 버튼이 소유한다.
- 검증 = `dm-catalog-templates.test.ts`(16) · `dm-effect.test.ts`(9) · `dm-effect-viewer.test.ts`(6) · `dm-catalog-render.test.ts`(9) · `dm-gallery-chips.test.ts`(5) · `dm-blocks-contract.test.ts`(7).

---

## §8 이력 · 뒤집힌 판단

- **2026-09-15(1) 검토** : Harold가 메이크뷰 e-book 뷰어와 우리 34장 슬라이드 DM(`hlj.kr/uFKZAtH`)을 비교 지시. 실측 = 메이크뷰는 jQuery 플릭(3D 넘김 아님) · PC 두 쪽 · 썸네일 · 맞춤 · 전체화면 · URL 파라미터 추적. 우리 부족분 = PC 두 쪽 · 썸네일 · 전체화면 · 핀치(`user-scalable=no`) · og 0. 제안 3축(①카탈로그 보기 ②장별 체류·순서 ③핫스팟) → 목업(다운로드 폴더 · 폐기 전제) → Harold 「맘에든다 진행해볼까」.
- **2026-09-15(2) 1차 판 = 자동 게이트(폐기)** : 전 장 이미지 슬라이드 DM이면 모두 책으로(커밋 `a99cef1a` · Harold 커밋). **Harold 정정** 「모든 걸 카탈로그처럼 하라는 게 아니고 카탈로그형을 선택하고 하면」 → 플래그 선택형으로 재작성. 운영 규모 = published 19 / total 22 가 무변경으로 돌아옴.
- **2026-09-15(3) 정정판** : `settings.catalog` 게이트 + DM 카드띠 카드 · 토글 3안 · 뱃지 + AI 자동제작 채널(수량 제한 없음). 요금은 내 추천 0 → **Harold 「10크레딧만 받자」**로 확정(`catalog-dm-build`). 커밋 `89f0c105`. 배포 · Harold 실측 통과.
- **2026-09-15(4) 아웃리치 카탈로그** : Harold 「AI 영업에 카탈로그 적용해도 기가막힐 거 같은데 · 제품 이미지 따와서 카탈로그로」 → `sales-outreach-catalog.ts` · 메일 3번째 버튼 · 같은 회차 결함 2건([B-0915-4·5](../status/BUGS.md)) 수정 · 커밋 `d12997a2` · 배포. 상세 = [FEATURE-SALES-OUTREACH 5) 2026-09-15(2) 행](FEATURE-SALES-OUTREACH.md).
- **판단 근거로 남긴 것** : 상품 카드에 가격을 넣지 않는다(이미지 글자 숫자 0) · 캡션은 상품명만(숫자 있으면 사진만) · 아웃리치 카탈로그는 숨김 재실행에도 다시 만든다(AI 0 · 새 id 라 중지 논리 단순) · 상품 사본 확대 상한 2배(400px 사본 흐림 방지).

## §8-1 2026-10-01 접수 — 미리보기 치우침 · 책장 넘김 2쪽 멈춤 ([B-1001-1](../status/BUGS.md) ③ · 2026-09-30 박성용·임은지·남지현 접수 · 배포 완료 1001 `bec80a18` · BUGS 에서 옮김)

- **③ 카탈로그 미리보기(cmunux3e4)**: (가) 왼쪽 치우침 = 캡처 실측상 고정 점 줄까지 58px 밀림 + 오른쪽 58px 흰 띠 = 미리보기 틀 바깥 칸(316 · overflow:hidden · 안 문서 375)이 최대치 59px 스크롤된 모습(재현 캡처 동일). 처방 = 바깥 칸 `overflow: clip`(스크롤 칸 아님 · `mk-preview-box` · 옛 브라우저 hidden 대체). 밀린 방아쇠는 헤드리스에서 미재현(목록 고르기·화살표·끝쪽 55회 넘김 모두 0) = 미검증 · clip 이면 방아쇠와 무관하게 0. (나) 책장 넘김 = **발행 DM 에서도** 다음·밀기가 2쪽에서 멈추고 번호 1 고정(5·55쪽 · 마우스·터치 실측). 원인 확정 = 쪽 가시성 추적(IntersectionObserver)이 넘김 끝에 되돌린 앞 장을 "보임"으로 잡아 현재 장을 되돌림(추적 끄면 1→5 정상 · 페이드는 원래 정상). 처방 = 효과 DM 은 쪽 추적을 걸지 않음(`dm-viewer.ts` · 효과 없는 DM 발행 HTML 바이트 동일 확인) + 편집기 목록 고르기 = 그 장의 점을 눌러 장 이동(`make-preview.ts` 다리 · 렌더러 무변경). 공개 뷰어는 요청마다 그려 배포 즉시 발행분에도 반영.

## §8-2 2026-10-01 전수점검 — 만들기 결과 화면이 카탈로그를 일반 DM 으로 다뤘다 ([B-1001-10](../status/BUGS.md) · 박성용 접수 `cmup8g4zm…` · Harold 「자꾸 문제 일어난다 · 뿌리를 뽑아」)

- **방법**: 34쪽 카탈로그를 저장되는 모양 그대로(`catalogPagesOf`) 만들어 ①서버 검수·첫 발행 관문·뷰어 렌더를 실제 실행 ②개발 모드 빌드본을 헤드리스로 띄워 결과 화면·수정 화면·목록을 실제로 눌렀다(응답 = 실제 검수 결과·실제 뷰어 HTML · 견적 = 실제 서버 함수). 접수 캡처와 같은 화면이 재현됐다.
- **뿌리**: 만들기 개편(0927)의 결과 화면(`QuickCampaignResultPage`)은 일반 DM·이메일만 가정했다. 카탈로그 채널로 만들어도 주소에는 `channel=dm` 만 실리고 화면 안에 카탈로그 분기가 0곳이었다. 수정 화면(`DmEditScreen`)에는 카탈로그 전용 칸이 있었다.
- **확인된 결함 8(수정 전 실측)**
  1. 보내기 잠금 — 카탈로그는 구조상 항상 「Footer 없음」(확인하고 넘길 수 있는 치명)이 나오는데 결과 화면만 잠금으로 셌다(서버 첫 발행 관문·보내기 창·수정 화면·목록은 막지 않음) = 이 화면에서 100% 못 보냄.
  2. [고치기]를 눌러도 무반응(갈 블록이 없는 줄) · 보내기를 누를 때마다 알림이 겹쳐 쌓임.
  3. 안내 글 「고칠 곳을 채우면 보내기가 열려요」가 머리 띠(0~64px) 아래로 반쯤(56~73px) 나가 밝은 바탕 위 노란 글씨(일반 DM·이메일 결과 화면도 같음).
  4. [다시 만들기] = 5 크레딧 표시(카탈로그 = 10) · 누르면 일반 DM 채널로 가서 재료 부족으로 아무 일도 안 일어남(수정 화면 결과 띠의 같은 버튼도).
  5. [넣은 재료 다시 보기] = 일반 DM 탭으로 열려 올린 쪽이 안 보임.
  6. [이메일도 만들기] 「다시 넣을 것은 없어요」 → 항상 「재료가 부족해 만들 수 없어요」(쪽 사진뿐이라 서버 견적이 글·첫 사진 부족으로 판정).
  7. 쪽을 누르면 일반 사진 모음 편집 창 — 레이아웃을 바꾸거나 [빼기] 하면 책 보기가 안내 없이 꺼지고 [빼기]는 빈 쪽을 남김(뷰어 판정 함수로 확인).
  8. 수정 화면 카탈로그 모드에 쪽을 빼는 방법이 없음(저장소 `removePage` 는 옛 편집기에서만 호출).
- **정상 확인**: 서버 검수·첫 발행 관문 · 수정 화면 보내기 창 · 목록 뱃지 · 공개 뷰어(휴대폰 · PC 책 × 넘김 효과 3종 × 2·5·34쪽을 끝 쪽까지 · 순서 어긋남 0 · 스크립트 오류 0) · 기존 카탈로그 테스트 55건.
- **수정(화면만 · 서버·DDL·차감 경로 0)**
  - A. 잠금 수 = 서버 관문이 막는 수(`make-flow fixItemsOf` — 넘길 수 있는 치명은 권고 줄 · 갈 블록 없는 줄에 [고치기] 없음 · 「Footer 섹션이 없어요」는 「맨 아래 회사 정보 블록이 없어요 · 그대로 보낼 수 있어요」로). 일반 DM(완성 이미지 DM 등)에도 같이 적용.
  - B. 안내 글을 머리 띠 안(버튼 왼쪽 · 넓은 화면에서만)으로 · 잠금 알림은 한 장이 떠 있는 동안 다시 띄우지 않음 · 갈 블록 없는 잠금 줄은 [자세히 편집]으로.
  - C. 결과 화면이 카탈로그를 안다(판정 = 수정 화면과 같은 값 `layoutMode === 'slides' && catalogView`): 다시 만들기·재료 다시 보기 = 카탈로그 채널 · 금액 = 원장 키 `catalog-dm-build` · 재료 초안의 채널이 완성본과 다르면 다시 만들기를 권하지 않음 / 오른쪽 칸 = PC 책 미리보기 묶음(`PreviewPair PcPanel` — 수정 화면 가운데와 같은 것) / 쪽 누름 = 편집 창 없음 · [자세히 편집] 안내 / 수정 화면 결과 띠 [다시 만들기] = 만든 채널.
  - D. 수정 화면 쪽 패널 [이 쪽 빼기](확인 창 · 되돌리기 가능 · 2쪽 이하에서는 잠김 = 뷰어 책 판정과 같은 수).
- **수정 뒤 실측(같은 스크립트)**: 머리 「보낼 준비 완료」 · 보내기 1번에 보내기 창 · 다시 만들기 10 크레딧 → 카탈로그 채널 견적 통과 → 생성 요청 채널 = catalog 쪽 34 · 재료 다시 보기 = 카탈로그 탭에 쪽 34 · 오른쪽 = PC 책 · 쪽 눌러도 편집 창 없음 · 5쪽 → [이 쪽 빼기] → 4쪽(저장 4) → 되돌리기 5쪽(저장 5) · 2쪽 카탈로그는 버튼 잠김 / 일반 DM 잠금 화면 = 안내 글이 띠 안(23~41px) · 보내기 누르면 버튼 고치기 창.
- **계약**: `make-preview-guard.test.ts` 「고칠 곳 판정」 +2(실제 서버 검수 결과로 잠금 0) · 「결과 화면 · 수정 화면의 카탈로그 배선」 6 · 변이 4종 검출.
- **검증**: frontend tsc 0 · backend tsc 0 · vitest 530파일 7,362건 · **Codex 적대 1R approve(지적 0 · 잠금 수가 서버 관문과 어긋나는 입력 · 넘길 수 없는 치명의 잠금 약화 여부를 물음)**.
- **범위 밖(기록만)**: 보내기 창(`MakeSendModal`)으로 보낼 때는 넘긴 항목 기록(`validation_override`)이 남지 않는다(옛 편집기 발행은 남김 · 0927 부터의 동작) · 검수 권고 문구 「KISA 가이드 준수를 권장해요」가 화면에 그대로 보인다(서버 문구) · 수정 화면 전체 설정의 「AI로 다시 구성」·디자인 테마는 사진만 있는 카탈로그에 뜻이 없다.

## §9 남은 것 · 범위 밖 (착수 판단 = Harold)

- **Harold 접수 대기** : 아웃리치 카탈로그 「아직 좀 수정이 필요」(0915 22:3x · 어떤 점인지 다음 세션에 구체화 → 그때 이 절에 항목으로 옮긴다).
- 미실측 잔여 = §7 마지막 행.
- 장별 체류·열람 순서(2축) · 이미지 위 핫스팟(3축) · PC 책 쪽 링크 · og 메타를 전 DM으로 확대 · 발행 모달 「PC에서는 책처럼 보입니다」 안내 · `EventCampaignModal` 결과 라벨에 카탈로그 미표시.
- 아웃리치 카탈로그 열람 집계(dmId 조인) · 상품 카드 디자인 고도화(로고 · 가격 표기 정책) · 캡션 폰트 미탑재 서버 폴백 실측 · 메일 1순위 라벨 「산출물 보기」 문구.
- 갤러리 N장 펼침 DM의 장 섹션 id `-sN-img` 접미 → 수신자 상세 「(삭제된 섹션)」 · 이탈 집계 누락(`extractFlatSectionsFromDm` 원본만 · 장마다 섹션인 카탈로그 DM은 해당 없음).
- 메이크뷰 「좌우 맞춤」이 한 쪽 보기에서 확대로 동작하는지 미검증 · Codex 검토 미실행(카탈로그 채널 차감 경로 · 스킬 미탑재).
- **이미지만 · AI 토큰 0 · 크레딧 후보(Harold 요청 아이디어)** : 추천 = 상세페이지 한 장 → 여백 행 분할 → 카탈로그·슬라이드 DM(10) / 상품 카드 합성 개방(장당 1) / 모션 티저 GIF·WebP(이메일 히어로 · sharp 애니메이션 출력 미검증) / QR 포스터(2).

## §10 시점 근거

- [0915 인계 §6](2026-09-15-session-handoff.md) 카탈로그 보기·DM 메뉴·AI 자동제작 채널 구현 기록 · 배포 · 실측 순서 · 되돌리기 / [§7](2026-09-15-session-handoff.md) 아웃리치 카탈로그 · 결함 2건.
- [FEATURE-AI-AUTO-BUILD §0·§2-8·§4·§6 2026-09-15(3)](FEATURE-AI-AUTO-BUILD.md) 채널 요금·재료 계약.
- [FEATURE-SALES-OUTREACH 5) 2026-09-15 · 2026-09-15(2)](FEATURE-SALES-OUTREACH.md) 아이디어 근거 · 구현.
- [SCHEMA `dm_pages.settings` · `sales_outreach_assets` dm payload](../status/SCHEMA.md).
- 메이크뷰 실측·비교 · 목업 경위 = memory `project_2026_0915_catalog_dm_review`.
