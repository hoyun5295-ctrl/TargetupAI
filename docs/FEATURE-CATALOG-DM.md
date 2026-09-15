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

## §8 이력 · 뒤집힌 판단

- **2026-09-15(1) 검토** : Harold가 메이크뷰 e-book 뷰어와 우리 34장 슬라이드 DM(`hlj.kr/uFKZAtH`)을 비교 지시. 실측 = 메이크뷰는 jQuery 플릭(3D 넘김 아님) · PC 두 쪽 · 썸네일 · 맞춤 · 전체화면 · URL 파라미터 추적. 우리 부족분 = PC 두 쪽 · 썸네일 · 전체화면 · 핀치(`user-scalable=no`) · og 0. 제안 3축(①카탈로그 보기 ②장별 체류·순서 ③핫스팟) → 목업(다운로드 폴더 · 폐기 전제) → Harold 「맘에든다 진행해볼까」.
- **2026-09-15(2) 1차 판 = 자동 게이트(폐기)** : 전 장 이미지 슬라이드 DM이면 모두 책으로(커밋 `a99cef1a` · Harold 커밋). **Harold 정정** 「모든 걸 카탈로그처럼 하라는 게 아니고 카탈로그형을 선택하고 하면」 → 플래그 선택형으로 재작성. 운영 규모 = published 19 / total 22 가 무변경으로 돌아옴.
- **2026-09-15(3) 정정판** : `settings.catalog` 게이트 + DM 카드띠 카드 · 토글 3안 · 뱃지 + AI 자동제작 채널(수량 제한 없음). 요금은 내 추천 0 → **Harold 「10크레딧만 받자」**로 확정(`catalog-dm-build`). 커밋 `89f0c105`. 배포 · Harold 실측 통과.
- **2026-09-15(4) 아웃리치 카탈로그** : Harold 「AI 영업에 카탈로그 적용해도 기가막힐 거 같은데 · 제품 이미지 따와서 카탈로그로」 → `sales-outreach-catalog.ts` · 메일 3번째 버튼 · 같은 회차 결함 2건([B-0915-4·5](../status/BUGS.md)) 수정 · 커밋 `d12997a2` · 배포. 상세 = [FEATURE-SALES-OUTREACH 5) 2026-09-15(2) 행](FEATURE-SALES-OUTREACH.md).
- **판단 근거로 남긴 것** : 상품 카드에 가격을 넣지 않는다(이미지 글자 숫자 0) · 캡션은 상품명만(숫자 있으면 사진만) · 아웃리치 카탈로그는 숨김 재실행에도 다시 만든다(AI 0 · 새 id 라 중지 논리 단순) · 상품 사본 확대 상한 2배(400px 사본 흐림 방지).

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
