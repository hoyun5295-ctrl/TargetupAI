# 한 줄 → 묻기 → 완성 DM·이메일 설계서 (2026-10-10)

> 호출어 **"한 줄 DM 강화 / 한 줄 이메일 / 몰 상품 확정"**. 상태 = **Harold 승인(2026-10-10 「추천대로 승인, 설계서 작성하고 구현까지 진행해 그리고 코덱스 닫힐때까지 돌려」)** · 구현 기록 = §10.
> 근거 = 브레인스토밍 5역할(기획 · 프론트엔드 · 백엔드 · 디자이너 · 회의론자 · 1차 의견 → 교차 토론 1라운드 → 회의론자 최종 검증 두 시선) + 주재자 코드 재확인.
> 관련 = [한줄로 시그니처 설계서](2026-10-05-hanjul-signature-design.md)(판정 CT · 혜택 묻기 · 스위치 `ONE_LINE_FACTS_COMPANY_IDS`) · [만들기 개편 설계서](2026-09-27-make-redesign-design.md)(결과 화면 · 렌더러 무접촉) · [FEATURE-AI-AUTO-BUILD.md](FEATURE-AI-AUTO-BUILD.md)(상품 불변 2~5 · 재조회 CT) · [원스텝 인터뷰 설계서](2026-08-13-one-step-content-interview-design.md)(구성 원천 `dm-interview-contract.ts`).
> ⚠ 카페24 연동은 휴면 정지 상태(Harold 1010). 0단계 실측(카페24 상품번호 조회 · 기간할인 가격 반영)은 건너뛰고, 실측이 필요한 판정은 안전한 쪽으로 둔다(§1 H5 · §8).

---

## §0 30초 요약

- **무엇**: Harold님 요구 = "한 줄만 치면 필요한 것만 묻고, 재료로 완벽한 DM·이메일. 자사몰 연동이면 한 줄의 제품명·할인율로 몰 사진·링크·가격". 지금은 "제품명 + 할인율" 한 줄이 **상품 카드 0개**다(`event-brief.ts:66` 가격 없는 상품 버림 · `mall-product-match.ts:52` 이름 글자 일치만).
- **흐름**: 한 줄(지금 그 칸) → 서버 판정(규칙 · 무료) → 이미 있는 확인 창에서 **두 가지만**(혜택 · 몰 상품 사진 탭) → 생성(기존 금액) → DM 은 결과 화면 착지.
- **상품 계약 하나**: 이름은 후보 **찾기**에만 · 사람이 탭해 확정 · 서버는 `provider + 상품번호(no)`만 받아 몰에서 다시 읽고 **재조회가 ok 인 상품만** 카드로 · 가격 = 몰 값 · 사용자 % = 혜택 문구 · 할인가 계산 0.
- **회사 색**: 한 줄 DM 은 회사가 저장한 주색(읽히게 보정한 값)을 생성기 팔레트 주색에 고정하고, 회사 킷 위에 AI 아트디렉션을 얹는다(회사 저장값이 이긴다). 한 줄 이메일은 회사 주색 + 회사(없으면 업종) 아트디렉션 design.
- **DDL 0 · 신규 크레딧 키 0 · 렌더러 무접촉 · 스위치(`ONE_LINE_FACTS_COMPANY_IDS`) 켠 회사만 바뀐다.**

---

## §1 Harold 결정 (2026-10-10 · 추천대로 승인)

| # | 결정 |
|---|---|
| H1 | 몰 후보 미리 체크 = **체크 0**(정확 일치 1건은 테두리 + 「상품명이 같아요」 표식만). 사내 측정 뒤 다시 본다 |
| H2 | 원스텝 「생성 5 + 오토설계 50」 = **그대로**. 구성 고정(5단계) 때 다시 정한다 |
| H3 | 「이미지로 불러오기」로 칸에 붙은 사진 글 = **면허 아님**. 직접 친 글만 면허(§3-6) |
| H4 | 결과 화면 블록 [문구 다르게] = **0크레딧 그대로 · 누른 블록 하나만 보냄 · 회사당 동시 1건** |
| H5 | 화면 문구 「몰 상품은 진짜 가격 그대로」 = **0단계 실측(카페24 기간할인 반영 여부) 뒤에만** 노출. 이번 출고 화면에는 싣지 않는다 |
| H6 | 카페24 휴면 → 0단계 실측 건너뜀(1010) |

---

## §2 출발점 (코드 실측 · 주재자 재확인)

| 사실 | 근거 |
|---|---|
| 가격 없는 상품은 브리프에서 버려진다 → 「제품명 + 할인율」 한 줄은 상품 카드 0 | `event-brief.ts:64-66` |
| 몰 첨부 = AI 가 쓴 상품명이 몰 상품명과 정규화 후 글자 그대로 같을 때만 · 빈 칸만 채움 · `discount_rate` 남김 | `mall-product-match.ts:52 · 65-89` |
| 한 줄 DM brand_kit = `{ tone }` + AI art_direction 뿐(회사 주색·로고 없음) | `dm/dm-ai.ts:908-910 · 1031-1043` |
| 재료(v1) 엔진은 회사 킷 · 로고 · 업종 아트디렉션을 싣는다 | `campaign-quick.ts:932-1003` |
| 재료(v1) 최소 게이트 = 글 40자 또는 히어로 사진(짧은 한 줄은 막힘) → **한 줄은 v1 로 옮기지 않는다** | `ai-auto-build-materials.ts:379-387` |
| 카페24 `/search` 의 `code` = product_code(P0000BKA 형식) · 재조회 키는 숫자 상품번호 | `mall-product-normalize.ts:62` · `ai-auto-build-materials.ts:459-464` |
| 재조회는 카페24 · 우커머스만(네이버 = 빈 결과) | `campaign-quick.ts:500-534` |
| `deductCreditOutcome` 은 잔액 부족을 `throwOnInsufficient` 일 때만 던진다 | `ai-credit.ts:258-262` |
| 생성기는 장 나누기를 끝내고 돌려준다(밖에서 섹션을 바꾸면 pages 와 어긋남) | `dm/dm-ai.ts:1051-1052` · `dm-page-split.ts:12` |
| 저장된 pages 는 `{ id, sections }[]` 모양이어야 편집기 · 뷰어가 장을 읽는다 | `dm/dm-builder.ts:66-71 · 131-147` · `frontend/stores/dmBuilderStore.ts:374-386` |
| 결과 화면 「다른 채널 · 다시 만들기 · 재료 다시 보기 · 최근 주소」는 localStorage 24시간 재료 초안을 결과와 대조 없이 읽는다 | `QuickCampaignResultPage.tsx:115-121 · 165 · 209-218 · 286` |
| DM 다듬기(`/dm/ai/improve`)는 0크레딧 · 잠금 없음 · 지금 장 전체를 보낸다 | `routes/dm.ts:2403-2411` · `AiImproveModal.tsx:53` |

---

## §3 계약 (불변)

1. **판정은 서버 순수 CT 하나**(`one-line-facts.ts` · AI 0 · DB 0 · 무료). 화면은 응답으로만 칸을 그린다. 판정 응답에 더하는 것 = `product_terms`(혜택 · 의도 · 기간 낱말과 숫자를 걷은 검색어 최대 3개) · `benefit_percents`(혜택 문맥의 % 값).
2. **묻는 자리 = 이미 멈추는 곳 하나.** DM = 크레딧 확인 창 안 · 이메일 = 판정에 걸릴 때만 묻는 창. 생성 전 칸 상한 2(혜택 · 상품). 둘 다 비워도 만든다. 판정이 안 걸리면 오늘과 같다.
3. **몰 후보**: 화면이 기존 `GET /api/mall-products/search` 를 재조회 가능한 몰(카페24 · 우커머스)에만 · 몰마다 낱말마다 **순서대로** · 전체 시간 상한 안에서 부른다(카페24 토큰 동시 재발급 회피). 0건 · 실패 · 시간 초과 = 상품을 묻지 않는다. 네이버만 연동한 회사 = 후보 0. `/search` 응답 항목에 `no`(재조회 상품번호) · `exact`(검색어와 정규화 일치)를 **더한다**(기존 필드 무변경).
4. **확정 = 사람의 탭.** 기본 체크 0(H1). 서버는 `products: [{ provider, no }]`만 받는다(이름 · 가격을 받지 않는다). provider = `cafe24` · `woocommerce:{몰}` 만. 우커머스는 담당자 범위(`canTouchIntegration`)를 재조회 앞에서 본다.
5. **카드 = 재조회 ok 만.** 품절 · 못 찾음 · 몰 장애 · 사진 없음 = 카드에서 빼고 사유를 결과 안내에 싣는다(피커 값으로 채우는 길 없음). 카드 필드 = `name · price(정가) · discount_price(판매가 < 정가일 때만) · image_url · link_url` — **`discount_rate` 를 쓰지 않는다**(DM · 이메일 렌더러가 같은 수를 낸다). 고른 상품이 1개 이상인데 카드가 0이면 **AI 호출 · 차감 전에** 409 `MALL_PRODUCTS_UNAVAILABLE`.
6. **면허 = 사용자가 직접 친 글자**(한 줄 · 칸에 적은 답). 사진에서 읽은 글(판독본) · 몰 텍스트(몰 할인율 포함)는 면허가 아니다(H3). 몰 상품명 · 가격은 원문 자리에 들어가지 않는다(카피 생성 뒤 코드가 싣는다).
7. **가격 진실 = 몰 재조회 값.** 한 줄의 「30%」는 혜택 문구로만. 할인가 계산 0. 사용자 % · 금액이 몰 값과 다르면 **결과 안내 한 줄**(잠금 아님 · 질문 아님). 몰 할인율 0 이면 「몰 판매가에는 이 할인이 반영돼 있지 않아요」.
8. **확정 카드가 있는 요청은 이름 자동 첨부를 부르지 않는다**(후보를 보여 준 요청 = `products` 칸이 온 요청 · 빈 배열 포함). 확정 카드는 생성기 **안에서** 장 나누기 · 검산 전에 놓는다. 첫 상품 슬라이드의 상품을 통째 교체하고, 없으면 히어로 뒤에 하나 넣는다. 그 요청은 AI 상품 추출을 건너뛰고 검산에서 브리프 상품을 뺀다.
9. **회사 색**: 회사가 **저장한** 주색이 읽히는 색일 때만(`accessiblePrimaryOf`) 생성기 팔레트 주색을 그 값으로 고정한다(선택 인자 · 기본 = 오늘과 같다). 결과 brand_kit = 회사 저장 킷 + AI tone · art_direction(회사 저장 art_direction 키가 이긴다) + 고정 주색. 저장 주색이 없거나 못 쓰는 색 = 오늘과 같다(무채색으로 바꾸지 않는다).
10. **돈**: 신규 키 0. 묻기 · 후보 · 상품 바꾸기 = 0. 생성 = DM 5 · 이메일 3. 멱등 지문에 확정 상품(정렬)을 더한다(없으면 키 무변경). **DM 착지 경로**(새 화면만 `land: 'result'` 를 보냄) = 생성 → 서버 초안 행 → `deductCreditOutcome(throwOnInsufficient)` → **낸 것(deducted · duplicate · not_applicable)만 건넨다.** 잔액 부족 = 행 회수 + 402 · `failed`(원장 쓰기 실패) = 행 회수 + 503(★ Codex 2R · 결과를 아직 건네지 않은 경로라 「failed = 행 유지」 규칙을 쓰지 않는다). 같은 시도 재요청 = 낸 초안 재사용 · 회수 못 한 초안은 다시 회수(`line-draft-memo.ts`). `land` 없는 요청(옛 화면) = 오늘과 같다.
11. **렌더러 무접촉.** 바뀌는 것은 새 초안 행의 섹션 · brand_kit · design 값뿐이다(발행 · 예약분 무변화).
12. **스위치 켠 회사만.** 스위치 밖인데 `facts` · `products` 가 오면 400 `FEATURE_DISABLED`(조용히 버리지 않는다). 공용 부품(확인 창 · 묻는 창 · 피커 · 생성기)은 **선택 prop · 선택 인자로만** 넓힌다(기본값 = 오늘과 바이트 동일).
13. **모델명 0 · native dialog 0 · 줄표 0 · 내부 코드명 0**(사용자 노출 문구).

---

## §4 부품

| 부품 | 파일 | 몫 |
|---|---|---|
| 판정 CT 확장 | `backend/src/utils/one-line-facts.ts` | `lineProductTerms` · `lineBenefitPercents` · `lineMoneyAmounts` · `sanitizeLineProducts` · `lineProductsKey`(멱등 지문용) |
| 확정 카드 CT(신규) | `backend/src/utils/line-mall-cards.ts` | `resolveLineMallCards`(범위 확인 → 재조회 → ok 만 카드 · 사유) · `placeLineMallCards`(순수 · 섹션 배치) · `linePriceNotes`(순수 · 결과 안내 문장) · `mergeLineBrandKit`(순수 · 회사 킷 + AI) · `lineEmailDesign`(순수 · 이메일 design) |
| 몰 정규화 | `backend/src/utils/mall-product-normalize.ts` | `mallProductNoFrom`(카페24 = 상품 링크의 번호 · 우커머스 = id) |
| 재조회 | `backend/src/utils/campaign-quick.ts` | `defaultBuildDeps().lookupMall` 그대로 재사용(새 재조회 함수 0) |
| DM 생성기 | `backend/src/utils/dm/dm-ai.ts` `oneShotGenerate` | 선택 인자 `confirmedCards` · `pinPrimary`(기본 undefined = 무변화) |
| 저장 모양 | `backend/src/utils/dm/dm-builder.ts` | `pagesFromSectionGroups`(장 묶음 → `{ id, sections }[]`) |
| 라우트 | `routes/dm.ts` 한 줄 분기 · `routes/email.ts` 한 줄 분기 · `routes/ai.ts` 판정 · `routes/mall-products.ts` `/search` 필드 + `POST /cards` | §3 순서 그대로 |
| 화면 CT | `frontend/src/utils/one-line.ts` | 판정 응답 확장 · `fetchLineMallCandidates`(몰 · 낱말 순차 · 시간 상한) · `requestLineDm`(DM 한 줄 착지 요청 한 곳) |
| 묻기 부품 | `frontend/src/components/zone/LineFacts.tsx` | `LineFactsInline` · `LineFactsAskModal` 선택 prop(상품 후보 · 고른 상품) · `LineMallPick`(3칸 격자 · 체크 0 · 정확 일치 표식 · 담은 수) |
| 확인 창 | `frontend/src/components/credit/CreditConfirmModal.tsx` | 선택 prop `title` · `scrollBody`(기본 = 오늘) |
| 결과 화면 | `frontend/src/pages/QuickCampaignResultPage.tsx` · `utils/ai-build.ts` | 재료 초안 `resultId` 결박 · 한 줄 출처(handoff `origin`) · 한 줄 다시 만들기 · 휴대폰 폭(dvh · 고칠 곳 위 줄 · 폰 폭) · 상품 블록 [몰에서 상품 바꾸기] |
| 블록 시트 · 다듬기 | `BlockSheet.tsx` · `AiImproveModal.tsx` · `routes/dm.ts /ai/improve` | 누른 블록만 보냄(`onlySectionId`) · 회사당 동시 1건(409) |

---

## §5 화면

1. **DM 첫 화면 한 줄** → [Enter] → 판정(즉시) → 확인 창(제목 「만들기 전에 확인해 주세요」 · 내용만 스크롤 · 버튼 줄 고정)
   - 혜택 칸(판정이 걸릴 때) · 몰 상품 3칸 격자(검색어가 있고 재조회 가능한 몰이 있을 때 · 자리를 먼저 잡고 채운다 · 0건 = 「몰에서 찾은 상품이 없어요」 한 줄)
   - 담은 상품이 있고 한 줄에 %가 있으면 「상품 가격은 몰 판매가 그대로 실어요. 적어 주신 N%는 혜택 문구로 들어가요」
   - [진행] → 생성 → **결과 화면 착지**(서버 초안). 409 상품 없음 = 「고른 상품을 지금 쓸 수 없어요」 확인 창 → [상품 없이 만들기].
2. **이메일 첫 화면 한 줄** → 제출 즉시 `checking`(두 번 눌러도 한 번) → 판정에 걸리면 묻는 창(혜택 · 상품 · [만들기] 하나) · 안 걸리면 오늘처럼 바로 → 편집 화면 착지(지금 그대로 · 무료 채우기 시트 유지) · 회사 디자인이 실린 design.
3. **결과 화면**
   - 한 줄 출처 = 「넣은 재료 다시 보기」 · 「다른 채널」 · 「재료로 다시 만들기」 대신 [같은 한 줄로 다시 만들기 · 5크레딧](같은 한 줄 + 답 + 상품 · 새 시도 토큰).
   - 재료 초안이 이 결과의 것이 아니면(`resultId` 불일치) 재료를 쓰는 버튼 · 안내 · 최근 주소 칩을 감춘다(엉뚱한 재료로 차감하지 않는 안전 실패).
   - 휴대폰 폭: 높이 `100dvh` · 보내기 창 · 블록 시트 `dvh` · md 미만은 고칠 곳을 미리보기 위 한 줄로 · 폰 폭 = 화면 폭에 맞춰 줄인다.
   - 상품 블록 시트 맨 위 [몰에서 상품 바꾸기] → 피커(재조회 가능한 몰만) → `POST /api/mall-products/cards` → 그 블록 상품을 통째 교체(AI 0 · 0크레딧 · 할인율 칸 지움).
   - [문구 다르게] = 누른 블록 하나만 다듬기 창으로.

---

## §6 영향표 (전 소비처 grep · 1010)

| 바꾸는 것 | 소비처 | 영향 |
|---|---|---|
| `oneShotGenerate` 선택 인자 2개 | `routes/dm.ts:1055` · `routes/content-interview.ts:294` | 원스텝은 인자를 넘기지 않음 → 무변화. 한 줄 분기만 넘긴다 |
| `/api/mall-products/search` 응답 필드 추가 | `MallProductPickerModal.tsx` · `MakeInputs.tsx useMallCandidates`(→ `QuickCampaignPage` · `PlannerEventModal`) | 추가 필드만 · 기존 필드 무변경 |
| `CreditConfirmModal` 선택 prop | 18개 파일 | prop 미지정 = 오늘과 같다 |
| `LineFactsInline` · `LineFactsAskModal` 선택 prop | `DmBuilderPage` · `AiOperatorPage`(허브 문자) | 허브는 prop 미지정 → 두 버튼 그대로 |
| `loadBuildDraft` · `saveBuildDraft` `resultId` | `QuickCampaignPage` · `QuickCampaignResultPage` | 옛 초안(`resultId` 없음) = 결과 화면 재료 버튼 감춤(안전 실패) |
| `AiImproveModal` `onlySectionId` | `DmBuilderPage`(미지정 = 오늘) · `QuickCampaignResultPage` | 결과 화면만 한 블록 |
| `/dm/ai/improve` 회사 잠금 | `AiImproveModal` 하나 | 같은 회사 동시 두 번째 요청 = 409 「다른 다듬기가 진행 중이에요」 |
| `attachMallImagesToProductCarousels` 호출 조건 | `routes/dm.ts:1064` · `routes/email.ts:1178` · `routes/content-interview.ts:302` | `products` 칸이 온 한 줄 요청에서만 건너뛴다 · 원스텝 무변경 |
| 판정 응답 필드 추가 | `fetchOneLineGaps`(DmBuilderPage) · `fetchOneLineEnabled`(JourneysPage) | 추가 필드만 |
| 한 줄 DM 착지 | `DmBuilderPage handleAutoGenerate` | 새 화면 = `land:'result'` + 서버 초안 → 결과 화면 · 옛 번들 = 오늘과 같다(서버는 `land` 없으면 행을 만들지 않는다) |

---

## §7 범위 (이번 출고 · 단계 1~4)

| 단계 | 들어가는 것 |
|---|---|
| 1 | 판정 확장 · 몰 후보 · 확정 카드 · 회사 색(DM) · 스위치 밖 400 |
| 2 | DM 결과 화면 착지(서버 초안 · 차감 순서) · 결과 화면 결박 · 한 줄 다시 만들기 · 휴대폰 폭 |
| 3 | 이메일: 묻는 창 · 확정 카드 · 회사 design · `facts` 받기(혜택 = 요청 글에 `[혜택]` 줄) · 이중 제출 막기 |
| 4 | [문구 다르게] 한 블록 · 회사 동시 1건 · 상품 블록 [몰에서 상품 바꾸기] |

**이번에 하지 않는 것(다음 과제로 기록)**
- 이메일 결과 화면 착지 · 한 줄 출처의 「다른 채널 1클릭」(이메일 서버 초안 + 결과 화면 무료 채우기가 함께 들어가야 닫힌다). 그때까지 이메일은 편집 화면에 착지하고(무료 채우기 시트 유지), 한 줄 출처 결과 화면은 다른 채널 버튼을 그리지 않는다.
- 엔진 이관(한 줄 → 재료 v1) · 구성 고정(`dm-interview-contract.ts` 원천) · 말로 고치기(지시 한 줄) · 시작 카드 정리 · 정예 10종 캡처 승인 → 5단계(측정 뒤 Harold 결정).
- 확인 창 안 [다른 상품 고르기](피커를 확인 창 위에 띄우는 ESC · 겹침 처리가 필요) → 결과 화면 [몰에서 상품 바꾸기]가 같은 일을 한다.
- `ALREADY_DONE` 응답에 이미 만든 초안 id 싣기(낮음 · 초안은 목록에 남는다).

---

## §8 0단계 실측 (카페24 휴면 · Harold 재인증 뒤)

1. 카페24 상품번호 목록 조회(`fetchCafe24ProductsByNoRaw` · `cafe24-client.ts:461-462` 미검증 파라미터) 응답 원문 1건. 실패해도 오매칭은 없다(응답의 `product_no` 로 매핑) · 「몰에서 찾지 못했어요」로 빠진다.
2. 같은 상품의 기간할인(혜택) 가격이 `/products` `price` 에 반영되는지(`embed=discountprice` 비교). 반영 안 되면 H5 문구는 계속 숨긴다.
3. 우커머스 상품 사진 형식(WebP 이면 이메일 확정 카드만 사본 · 아웃룩).
4. 스위치 사내 1곳 → 같은 한 줄 10건(상품 있음 · 없음 · % 있음)으로 결과 화면 고칠 곳 수 · 사람 판단.

---

## §9 테스트 계약

- `one-line-facts` 확장: 검색어 = 혜택 · 의도 · 기간 낱말 · 숫자를 뺀 명사 · 최대 3 · 업종별 고정 사례 · % 값 · `sanitizeLineProducts`(허용 provider · 숫자 no · 상한 12 · 중복 제거 · 형식 오류 = invalid).
- `line-mall-cards`: ok 만 카드 · 품절 · 못 찾음 · 장애 · 사진 없음 = 사유 · 범위 밖 우커머스 = 재조회 0 · 카드에 `discount_rate` 0 · 배치(교체 · 히어로 뒤 삽입 · 순서 재매김 · 다른 캐러셀 AI 상품 제거) · 가격 안내(% 다름 · 몰 할인 0 · 금액 다름 · 같으면 0줄) · brand_kit 병합(회사 art_direction 이 이김 · 저장 주색 없으면 primary 없음).
- 라우트 소스 계약: 재조회 → 409 가 `checkCredit` 앞 · 착지 경로 = 초안 행 → `throwOnInsufficient` 차감 → 잔액 부족 시 `deleteDm` · `products` 온 요청은 이름 첨부 0 · 스위치 밖 400 · 멱등 지문에 상품.
- 화면 소스 계약: `land:'result'` 는 한 줄 경로만 · 착지 경로에 `save(` 0 · 결과 화면 재료 버튼 = `resultId` 결박 · 확인 창 · 묻는 창 prop 기본값 무변화 · 새 문구 줄표 · 모델명 0.

---

## §10 구현 기록 (2026-10-10)

### 10-1. 바뀐 파일

| 층 | 파일 | 내용 |
|---|---|---|
| 판정 CT | `backend/src/utils/one-line-facts.ts` | `lineProductTerms` · `lineBenefitPercents` · `lineMoneyAmounts` · `sanitizeLineProducts` · `lineProductsKey` (순수 · import 추가 = `woocommerce-core` 정규화 하나) |
| 확정 카드 CT(신규) | `backend/src/utils/line-mall-cards.ts` | `resolveLineMallCards` · `placeLineMallCards` · `linePriceNotes` · `linePinnedPrimary` · `mergeLineBrandKit` · `lineEmailDesign` · `defaultLineMallDeps`(무거운 모듈은 부를 때 읽는다) |
| 몰 정규화 | `backend/src/utils/mall-product-normalize.ts` | `mallProductNoFrom` |
| 생성기 | `backend/src/utils/dm/dm-ai.ts` | `oneShotGenerate` 선택 인자 `confirmedCards` · `pinPrimary` |
| 저장 모양 | `backend/src/utils/dm/dm-builder.ts` | `pagesFromSectionGroups` |
| 라우트 | `routes/dm.ts` | 한 줄 분기(상품 · 착지 · 회사 킷 · 402) · `/ai/improve` 회사 잠금 |
| | `routes/email.ts` | 한 줄 분기(혜택 답 · 상품 · 회사 design) |
| | `routes/mall-products.ts` | `/search` 응답 `no` · `exact` · `POST /cards` |
| | `routes/ai.ts` | 판정 응답 `product_terms` · `benefit_percents` |
| 화면 CT | `frontend/src/utils/one-line.ts` | 판정 확장 · `fetchLineMallCandidates` · `requestLineDm` · `lineResultNotes` · `isLineMallProvider` |
| | `frontend/src/utils/ai-build.ts` | `resultId` · `bindBuildDraftResult` · `draftBelongsTo` · 결과 넘김 `origin` |
| 부품 | `components/zone/LineFacts.tsx` | `LineMallPick` · `LineFactsInline`/`LineFactsAskModal` 선택 prop |
| | `components/credit/CreditConfirmModal.tsx` | `title` · `scrollBody` |
| | `components/make/BlockSheet.tsx` · `MakeSendModal.tsx` · `styles/make.css` | `topSlot` · 보이는 높이(dvh) |
| | `components/dm/MallProductPickerModal.tsx` · `modals/AiImproveModal.tsx` | `providerFilter` · `onlySectionId` |
| 화면 | `pages/DmBuilderPage.tsx` · `EmailCampaignsPage.tsx` · `QuickCampaignPage.tsx` · `QuickCampaignResultPage.tsx` | §5 그대로 |
| 테스트 | `backend/src/utils/__tests__/oneline-dm-email-1010.test.ts`(신규 36) · 기존 계약 5건 글자 갱신(뜻 그대로) | |

### 10-2. 구현 중 바꾼 판단

- **착지 경로도 이름 첨부를 지킨다** — 후보를 못 보여 준 요청(products 칸 없음)은 저장 **전에** 지금처럼 이름 첨부를 한다(처음엔 착지 경로에서 첨부를 건너뛰어 회귀가 있었다 · 자체 적대 검토). 장 묶음은 섹션과 같은 객체라 제자리 변형이 저장본에 그대로 실린다(`dm-page-split.ts`).
- **잔액 부족 응답 402**(옛: 500) — 한 줄 분기 바깥 catch 가 잔액 부족을 402 로 돌려준다. 화면 문구는 같다.
- **DM 착지 응답에 `draft_id` 가 없으면**(그 사이 스위치가 꺼짐) 화면은 옛 흐름(편집기)으로 이어 간다 — 만든 결과를 버리지 않는다.

### 10-3. 검증

- backend tsc 0 · frontend tsc 0 · backend vitest 598파일 8,458건(신규 36 포함).
- Codex 적대 검토 = §10-4.

### 10-4. Codex 적대 검토 (`--model gpt-6-astra` · 범위 = 돈 · 가격이 지나는 서버 경로)

| 라운드 | 지적 | 판단 · 처리 |
|---|---|---|
| 1R | high · 착지 차감이 failed 여도 성공 응답 → 같은 토큰 재요청이 새 초안을 또 만든다 | 수용 · 멱등키 → 초안 기억(`line-draft-memo.ts`) |
| 1R | high · 잔액 부족 뒤 초안 삭제 실패 시 미과금 초안 잔존 | 수용 · 삭제 재시도 + 기억 |
| 1R | medium · 혜택 칸 답의 %가 가격 안내 비교에서 빠짐 | 수용 · 비교 입력 = 한 줄 + 혜택 답(DM `buildLineEventText` · 이메일 `genPrompt`) |
| 2R | high 2건 · 「차감만 다시」가 failed 면 미과금 초안을 건넴 · 미해결 초안 기억이 만료됨 | **1R 과 같은 뿌리**(결과를 아직 건네지 않은 착지 경로에 「failed = 행 유지」 규칙을 옮겨 놓고 기억으로 덧댐) → 구조 수정: **착지 경로는 미과금 초안을 건네지 않는다**(failed = 거두고 503 · 잔액 부족 = 거두고 402) · 기억은 paid(30분) · orphan(회수 실패 · 만료 없음) 두 상태만 · 「차감만 다시」 분기 삭제 |
| 3R | 2R 수정분 = 지적 0. H3(새 코드) high · 사진 글 지우기 규칙이 혜택 판정 규칙과 달라 「두 배 적립」 · 「1+1 증정」이 근거로 남음 | 수용 · **지우기 = 판정기 정규식 목록 한 벌**(`CONCRETE_VALUE_RES`) · 「지운 뒤 판정기가 값을 못 찾는다」 성질 테스트 |
| 3R | medium · 조각을 차례로 바꿔 겹친 조각 숫자가 남고 「15%」 안 「5%」를 지움 | 수용 · 원문에서 위치를 먼저 정하고(칸에 붙는 「 · 」 경계만) 겹친 구간을 합쳐 한 번에 |
| 4R | **critical · high 0 → 종결.** medium 2건(지우기 고정점 · 끝 공백 경계) | 비용이 작아 바로 수용 · 더 바뀌지 않을 때까지 반복(입력 길이 상한) · 판정 경로도 앞뒤 공백을 떼고 본다 |

종결 검증 = backend tsc 0 · frontend tsc 0 · backend vitest 598파일 8,468건 · frontend `npm run build:safe` 성공(lazy 청크 게이트 51건 · 비literal 동적 import 0).

### 10-5. 구현 중 더한 것 — Harold 결정 H3(사진에서 읽은 글 = 면허 아님)

- 화면이 「이미지로 불러오기」로 한 줄 칸에 붙인 글 조각을 기억해 `read_texts` 로 따로 보낸다(칸에 붙는 모양 그대로 · `readPartOf`). 확인 창 · 묻는 창에 「사진에서 읽은 숫자도 그대로 쓰기」(기본 꺼짐).
- 서버는 체크가 없으면 **한 줄 안에 그대로 남은 조각의 숫자 값만**(비율 · 금액 · N+N · N배) 지운 글로 생성 · 판정한다(`applyLineReads` · 상품명 · 기간 낱말은 남는다). 담당자가 고친 조각은 직접 친 글로 본다. 판정(`/one-line/gaps`)도 같은 글로 해서 사진에만 혜택이 있으면 혜택 칸이 뜬다.
- 멱등 지문 = 숫자를 지운 뒤의 글(DM eventText · 이메일 genPrompt) → 체크를 바꾸면 새 시도다.
