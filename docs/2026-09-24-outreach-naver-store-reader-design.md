# AI 영업 B: 네이버 스토어 전용 판독기 (2026-09-24)

> 접수: 북마크 1차(화면 글자 긁기)는 Harold 「이런 식으로 못 써」 → 원본 확인 → 「B도 설계하고 구현까지」.
> 근거 원본: Harold 가 저장한 톤28 브랜드스토어 화면(`톤28.html` 1.8MB) 안 `window.__PRELOADED_STATE__`(220KB JS 객체).
> 선행: [품질 A](2026-09-24-outreach-quality-a-design.md) · 스토어 입구(북마크·수신 탭·store-grab) = [직접 발송 설계서 §9-1](2026-09-23-outreach-direct-send-design.md).
> 상설 = [FEATURE-SALES-OUTREACH.md](FEATURE-SALES-OUTREACH.md) 불변 50.

## 1. 원본에서 확인한 사실 (톤28 1건)

| 칸 | 내용 |
|---|---|
| `categoryMenu.firstCategories[]` | 상단 메뉴 11개 `{id, name}` = 톤캉스🌿 · 추석선물🎁 · 슈퍼 적립🎈 · NEW💗 · 스킨 · 헤어 · 바디 · 제품 라인별 · 전체상품 · 정기구독 · 홈 |
| `bsProductCollection.bestProducts[]`(15) · `newProducts[]`(4) · `widgetContents.*.data.simpleProducts[]` | 상품 `{id, dispName, salePrice, benefitsView.discountedSalePrice, benefitsView.discountedRatio, reviewAmount.totalReviewCount, reviewAmount.averageReviewScore}` · 이름 꼬리표 `[톤캉스]` 15개 |
| `homeSetting.widgets.customProductWidget*` | 보이는 상품 묶음 제목(`titleSettings.title` "NEW") + `productNos` |
| `homeSetting.widgets.promotionManageWidget.generalPromotion.items[]` | 배너 10개(보임 3) · 제목·설명 칸 비어 있음(문구는 이미지 안) · 링크 = 기획전(`shoppingstory`) 또는 메뉴(`category/{id}`) |
| `keepStore.count` | 관심고객 118,182 |
| ⛔ 같은 객체 | `naverMember` · `myAddress` · `my` · `addressBook` 등 **보는 사람의 회원·주소 칸** |

## 2. 설계

| 부품 | 규칙 |
|---|---|
| 북마크 판 2 | `window.__PRELOADED_STATE__` 에서 **허용 칸만** 뽑아 보낸다: `bsProductCollection` · `widgetContents` · `categoryMenu.firstCategories` · `keepStore.count` · `channel.{channelName,url}` · `homeSetting.widgets`. 회원·주소 칸은 버튼 안에서 버린다(서버로 가지 않는다). 상태가 없으면 "이 화면에서 스토어 정보를 찾지 못했습니다" · 판 1 버튼은 수신 탭이 다시 설치를 안내한다 |
| 판독기 `parseNaverStoreState`(순수 · 새 파일 `sales-outreach-naver-store.ts`) | 상품 = 위 목록 합집합(id 1번) · 이름 꼬리표·빈칸 정리. **기획(캠페인) = 메뉴 중** ① 이름(이모지 뗀 것)이 상품 이름 꼬리표 `[…]` 로 2개 이상 쓰였거나 ② 이름에 이모지가 있거나 ③ 보이는 배너가 그 메뉴로 링크한 것 · 고정 메뉴(홈·전체상품·전체·정기구독·BEST·베스트)는 제외 · 기획의 상품 = 꼬리표가 같은 상품 → 보이는 상품 묶음 제목이 같은 묶음의 상품 · 링크 = `https://{brand\|smartstore}.naver.com/{slug}/category/{id}` · 관심고객수 |
| 저장 | `stage_results.store_grab = {v:2, store, material:{storeName, interestCount, campaigns[≤6], products[≤12]}, at, by}` · 상태 원문·주소 원문 저장 0 · DDL 0 |
| 행사 후보 | `storeCandidatesOf(store_grab)` → 기획마다 카드 후보 1장(origin 'card' · `source:'naver_store'` · 제목 = 기획 이름 · 링크 = 메뉴 · 면허 = 스토어에 지금 걸려 있음(불변 42 "홈 게시 = 진행 중"과 같은 논법) · 본문 = 대표 상품 1줄 "이름 12,900원(66%) 외 N개"). **후보 목록 = `eventCandidatesView(event_quote.candidates, store_grab)` 하나**: 조회(확인 화면)와 확정이 같은 함수를 부른다 · 옛 스토어 후보는 빼고 새 것을 뒤에 붙인다(중복 0) · 확정 요청은 화면이 본 `store_grab.at` 를 함께 보내고 다르면 CONFLICT(목록이 바뀐 사이 번호가 어긋나지 않게) |
| 저장본(.html) 업로드 | 같은 상태를 파일에서 찾는다(undefined → null) → 허용 칸 → 같은 판독기·같은 저장. 잡에 스토어 주소가 저장돼 있어야 한다(메뉴 링크를 만든다). 상태가 없는 파일이거나 스토어 주소가 없으면 종전 글자 경로 |
| 화면 | 확인 화면 스토어 칸 = 요약 1줄(기획 N · 상품 M · 관심고객 · 가져온 시각) + 대표 상품 3줄(이름 · 정가 → 할인가 · 리뷰) · 스토어 후보 카드에 "네이버 스토어" 표시 · 판 1 글자 카드·자동 채움 제거 · 작업대 뱃지 = "스토어 기획 N" |

## 3. 지키는 선

- 서버는 네이버에 요청하지 않는다(불변 50) · 버튼은 화면에 이미 있는 데이터만 읽는다.
- 보는 사람의 회원·주소 칸은 버튼 안에서 버린다(허용 목록 · 차단 목록 아님).
- 가격·할인율은 가져온 시각의 스토어 표시값(사실)이다 · 확인 화면에 가져온 시각을 보인다.
- 이미지(네이버 서버의 상품·배너 사진)는 쓰지 않는다: DM 상품 카드·카탈로그는 종전처럼 홈페이지 사진 · 네이버 이미지 사용은 Harold 약관 판단 뒤 별도.

## 4. 영향표

| 바뀌는 것 | 소비처 | 영향 |
|---|---|---|
| 북마크 판 2 · 수신 탭 | 설치 칸 · 수신 탭 | 판 1 버튼 = 다시 설치 안내 |
| `grabOutreachStorePage` 입력(state) · `store_grab` 모양 | 작업대 뱃지 · 확인 화면 · 자동 확정 제외(키 있으면 제외 · 무변경) | 판 1 저장분(text)은 읽지 않는다(후보 0) |
| `eventCandidatesView` | `getOutreachJob`(candidatesView) · `confirmSelectionCore` | 스토어 없으면 종전 목록과 같다 |
| `eventCardsOf` 카드 후보 본문 | 표준 조립 행사 카드 | parts 없는 카드 = 종전 |
| 업로드 라우트 응답 | 확인 화면 업로드 버튼 | `mode:'store'|'text'` |

## 5. 실측(배포 뒤 · Harold)

① 확인 화면 [버튼 설치]로 **판 2 버튼을 다시** 끌어다 놓기 ② 톤28 새 잡 → [스토어 열기] → 북마크 → "기획 N개·상품 M개" ③ 확인 화면에 "네이버 스토어" 후보(톤캉스 · 추석선물 …)와 대표 상품 줄 ④ 톤캉스 골라 제작 → DM 행사 카드 "톤캉스 / 대표 상품 12,900원(66%) 외 N개" · 버튼 → 스토어 톤캉스 메뉴 ⑤ **다른 브랜드스토어 원본 2건**으로 기획 판정(이모지·꼬리표 규칙)이 맞는지 확인(규칙 근거가 톤28 1건뿐이다 · 미검증).
