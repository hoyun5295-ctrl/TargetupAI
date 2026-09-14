# AI 자동제작 설계서: 재료만 넣으면 모바일 DM·이메일 완성본까지 (2026-09-14)

> **이 문서가 소유하는 것** = 2026-09-14 브레인스토밍(5역할 · 1차 → 교차 토론 1라운드 → 주재자 수렴 → 회의론자 최종 검증)의 **수렴안 · 계약 · 착수 원장**. 구현 종결 뒤 상설 문서 `FEATURE-AI-AUTO-BUILD.md`를 신설하고 이 문서는 시점 근거로 남긴다.
> 발동 = Harold 2026-09-14 "브레인스토밍 완벽하게 끝내고 설계서까지 작성완료해서 다음 세션에 인계". 회의 원문 = 세션 scratchpad `meeting/`(r1-*.md · r2-*.md · converged-v1.md · final-skeptic.md).
> 관련 상설 문서 = [FEATURE-SALES-OUTREACH.md](FEATURE-SALES-OUTREACH.md)(캠페인 엔진 소유) · [FEATURE-CDP-INTEGRATION.md](FEATURE-CDP-INTEGRATION.md)(몰 연동) · [FEATURE-IMAGE-STUDIO.md](FEATURE-IMAGE-STUDIO.md)(소재 라이브러리). 시점 근거 = [캠페인 엔진 설계서](2026-09-06-campaign-engine-design.md) §7·§8(S5·S6 고객 입구) · [원스텝 인터뷰 설계서](2026-08-13-one-step-content-interview-design.md) §0·§6·§9(요금·세션 교훈).

## 0. 한 줄 · 요구 원문

**기존 원클릭 캠페인 페이지(`/quick-campaign`)를 "AI 자동제작"으로 승격한다.** 재료 4칸(행사 카드[내용+이미지] · 상품 · 기능 칩 · 채널) → 버튼 1개 → 완성본이 편집기에 열린다. **신규 조립 엔진 0 · 신규 크레딧 키 0 · DDL 0.**

Harold 요구(2026-09-14 원문 요지):
- 기존 직접 제작은 그대로 두고, 모바일 DM과 이메일에 "AI 제작" 메뉴를 추가한다. AI 영업에서 영감.
- 행사 내용·할인 제품 내용을 적고, 자체 보유 이미지를 올리고, 넣고 싶은 기능을 넣으면 AI가 그에 맞게 제작을 대신한다.
- 자사몰이 연동돼 있으면 제품 정보(이미지·가격·링크)를 바로 가져와 바로가기 연결까지 해 준다.
- 크레딧 책정 · 명칭 미확정(가칭 AI 자동제작).

## 1. 출발점(코드 실측 · 2026-09-14)

이 기능의 뼈대는 이미 있다. 회의 다섯 역할이 전부 같은 결론이었다: **신설이 아니라 승격 + 결손 3개 보강.**

| 있는 것 | 위치 | 상태 |
|---|---|---|
| 재료 폼(행사 카드 ≤3: 제목·내용·이미지 ≤3·링크·"그대로 씁니다" 면허 체크) | `pages/QuickCampaignPage.tsx:211-345` · `components/EventCardsInput.tsx:11-28` | 동작 중(원클릭 캠페인 · AI Operator 타일) |
| 재료 → DM 조립(캠페인 엔진 고객 입구) | `utils/campaign-quick.ts generateDmFromMaterials` · `utils/campaign-engine.ts assembleDmCampaign(entry:'customer')` · `routes/dm.ts:945-963` | 동작 중 · 크레딧 `dm-ai-generate` 5 · 멱등 `quick:{draftId}` |
| 재료 → 이메일 조립 | `campaign-quick.ts generateEmailFromMaterials` · `routes/email.ts:1046-1075` | 동작 중 · `email-ai-generate` 3 · **멱등키 없음 · eventCards 미지원 · is_ad 미전달** |
| 몰 상품 불러오기 | `components/dm/MallProductPickerModal.tsx`(이름·정가·판매가·할인율·이미지·링크) · `routes/mall-products.ts`(카페24·네이버) · `utils/mall-product-match.ts` · `utils/mall-product-normalize.ts` | 동작 중 · 고도몰·아임웹·메이크샵 미조사 · 네이버 `productUrl` null |
| 소재 라이브러리 | `components/assets/AssetLibraryPickerModal.tsx`(multiSelect) · `routes/assets.ts` | 동작 중 · 서빙 접두어 `/api/cdp/inapp/image/{companyId}/` |
| 기능 선택 연결점 | `campaign-engine.ts:73-79 EngineOptions.skeletonTypes·sectionOverride·presetSections` | 고객 입구에서 전부 null(`campaign-quick.ts:289`) · `skeletonTypes`는 프롬프트 힌트뿐(`sales-outreach-produce.ts:1132` "재료가 없는 섹션은 빼도 된다") |
| 요금 원장·판정 | `utils/ai-credit-calc.ts CREDIT_COST_MAP` · `utils/ai-credit.ts deductCreditOutcome`(3값) | `CREDIT_COST_MAP`↔프론트 라벨 1:1 유지 의무 |
| 편집기 안 재료 입구 | `components/MaterialQuickPanel.tsx`(DM `DmBuilderPage.tsx:898` · 이메일 `EmailVisualEditor.tsx:592`) | 동작 중 · 승격되면 중복 |

**결손 3**: ① 상품이 재료 텍스트로만 들어간다(`campaign-quick.ts:279 products: []` · `routes/dm.ts:946` "몰 상품 자동 첨부는 이 분기에서 부르지 않는다") ② 이메일 경로가 멱등키·eventCards·is_ad를 안 나른다 ③ 기능 선택이 없고 `skeletonTypes`만으로는 고른 값이 모델 판단에 덮인다(원스텝 §0-5와 같은 부류).

**입구 과밀(실측)**: DM 허브 한 화면에 AI 입구 8개 동시 노출(`DmBuilderPage.tsx` 865·873·898·908·925·948·961·979) · 제작 라벨 4종 공존("AI로 만들기" `DmTopBar:151` · "질문 몇 개로 정확하게" `DmBuilderPage:863` · "재료로 만들기" `MaterialQuickPanel:94` · "AI로 만들기" `EmailVisualEditor:575`).

## 2. 불변 원칙(⛔ 어길 수 없는 것)

1. **재료는 사용자가 준 것만 면허다.** `licensedQuote` = `origin='user'`인 행사 원문만. 판독본(vision)·몰 텍스트·프리필은 재료로만 쓰고 혜택 수치의 근거가 되지 않는다(원스텝 §0-6 · 캠페인 엔진 §7 계승).
2. **가격·링크·할인율은 AI 프롬프트를 지나지 않는다.** 코드가 `product_carousel.props.products`에 직접 싣는다. 원문에 할인율이 있으면 원문만, 없을 때만 계산값에 "정가 대비" 표기.
3. **몰 값은 믿지 않고 다시 읽는다.** 피커가 보낸 가격은 생성 시 서버가 **상품번호 기준**으로 1회 재조회한 값으로 바꾼다(못 찾으면 피커 값 + "가격 확인 못함" · 품절이면 제외 + 사유). 카드에 `source`(mall/manual)·조회 시각을 남긴다. 발행 직전 재조회는 2차(몰 장애가 발행 차단이 되면 안 된다).
4. **상품 병합 키 = 상품번호**(`extractMallProductNo`). 이름 매칭으로 병합·자동 첨부하지 않는다.
5. **상품 이미지 = 몰 이미지만.** 업로드 이미지는 상품 카드에 붙지 않고(엔진 규칙 유지 · 아웃리치와 공용), 이미지 없는 수동 상품은 텍스트 재료로만 들어간다(카드 X).
6. **이미지 역할 지정 UI를 만들지 않는다.** 순서가 기본 역할(첫 장 = 첫 화면)이고, 서버가 자격을 검사해(`heroEligible` 계열) 로고 후보를 강등한다. 사용자가 고치는 수단은 드래그 정렬과 [제외]뿐.
7. **기능 칩은 엔진이 만들 수 있는 것만 보인다.** 못 만드는 칩은 비활성으로도 두지 않는다(죽은 컨트롤 금지). 고른 값은 프롬프트 힌트가 아니라 **결정적 후처리**(`applyFeatures`)가 지키고, `features: null`이면 후처리는 no-op이다(아웃리치 회귀 0).
8. **신규 크레딧 키 0 · 대행 델타 0.** 생성 = 채널 키 그대로, 발행 = 기존 발행가. 대행 가치는 발행가(100/120/50)가 받는다. 인상·델타는 계측 뒤 별도 결정. 화면 금액은 서버 견적 한 곳만.
9. **돈 단위 = 시도 토큰(attemptToken).** 화면이 [AI 자동제작] 1회 누름마다 uuid를 만들고 재시도에 같은 값을 보낸다. 멱등키 = `quick:{companyId}:{channel}:{attemptToken}`. 초안 행 id(DM draftId · 이메일 campaignId)는 **결과 참조**일 뿐 돈 단위가 아니다(행은 조립 뒤에 생기므로 차감 시점보다 늦다 · 회의론자 최종 1·2). 세션 표·카운터 사본 0. "이미 냈는가"의 진실은 원장(`isChargedByKey` · `deductCreditOutcome` 3값).
10. **모든 판정은 차감 앞.** 최소 재료 게이트 · 요금제 잠금 · SMTP 게이트 · 몰 재조회 · 이미지 검증이 `checkCredit` 앞에 선다. 미달은 402가 아니라 400 + 부족 항목 한 줄.
11. **DDL 0.** 이번 트랙에서 테이블·컬럼을 만들지 않는다. 세션·계측이 필요해지면 그때 별도 축.
12. **1클릭.** 버튼 1개 → 완성본 → 편집기. 중간 질문·재입력·역할 드롭다운·채널 동시 선택 0. 필수 입력은 "행사 카드 1장에 내용 또는 이미지" 하나.
13. **노출 스위치는 새로 둔다.** `AI_AUTO_BUILD_COMPANY_IDS` 비면 **미노출**. 기존 `CAMPAIGN_MATERIALS_COMPANY_IDS`(비면 전 회사 노출 · `campaign-quick.ts:40-44`)와 반대 의미이므로 공유하지 않는다. 실측 1건(§9) 통과 전 열지 않는다.
14. **모델명 0 · native dialog 0 · 내부 코드명 0(화면 문구).** 진행 문구는 서버 phase만(타이머 연출 금지).

## 3. 회의 수렴(갈린 지점 10 판정)

| # | 지점 | 판정 | 근거·경위 |
|---|---|---|---|
| 1 | 입구 형태 | DM·이메일 목록 상단 **2칸 카드띠 [AI 자동제작 | 직접 제작]** → 클릭 = 전체 페이지(`/quick-campaign` 승격). 모달 금지 | 5/5. 모달은 세로 폼 = "추가 입력 요구"로 읽힘(`OneStepInterviewModal:263-264` 폭 한계) |
| 2 | 기존 입구 정리 | **지금 걷는 것 2**: 편집기 안 `MaterialQuickPanel`(DM:898 · 이메일:592)의 펼침 패널 → "AI 자동제작으로 만들기" 링크 1줄(렌더 플래그 · 제거 0) · "질문 몇 개로"(`DmBuilderPage:863`) → 접힘 줄 [더 정확하게 만들기]로 강등. **남기는 것**: `AiPromptModal`(편집기 안 [AI로 다시 만들기]) · 원스텝(폐기는 계측 뒤 · §4-5 대조군). 목록 화면 이름 = 둘 | 5/5 절충. 즉시 삭제는 디자이너가 접음 |
| 3 | 명칭 | **"AI 자동제작"** · 부제 "재료만 넣으면 완성본까지" · 맞은편 **"직접 제작"**으로 통일 개명(현 "자유 시작"·"비주얼로 만들기") · NEW 배지 1곳(`OUI_BADGE_NEW`) 4~6주 | 4/5(기획 "AI 제작소" 접음: 스튜디오와 장소 둘) · Harold 원어 |
| 4 | 기능 칩 | **4개**(상품 카드 · 카운트다운 · 쿠폰 · 갤러리) + "AI가 알아서" 기본 ON · 데이터 없는 칩 = 회색+사유(종료일 없으면 카운트다운 불가) · 결과 바 아래 "룰렛·설문은 편집기에서 추가" 1줄 · 존중 = `EngineOptions.features` + `deps.applyFeatures` + 계약 테스트 | 5/5. 엔진 허용 9종(`sales-outreach-exemplars.ts:191-198`) · 인터랙션은 발행가 120 분기(`routes/dm.ts:785`) · 기획의 "빈 섹션 삽입"은 3역할이 기각 |
| 5 | 상품 | **폼 전체 1칸**(카드당 표 X) · [연동몰에서 불러오기](연동 시만) + 직접 추가(붙여넣기 파싱 `utils/product-paste.ts parsePastedProducts`) · 생성 시 서버 재조회 · 상품번호 병합 · 네이버 링크 null = 카드 유지·버튼만 생략 | 5/5 |
| 6 | 이미지 역할 | 순서 = 기본 + 서버 자격 검사 강등 + 썸네일 **읽기 전용** 배지("첫 화면/사진/로고 추정") · 드래그 정렬 + [제외]만 · 히어로 후보 0 = amber 1줄 고지·버튼 유지 | 4/5 + 디자이너 1탭 순환 배지는 1클릭과 충돌해 채택 안 함 |
| 7 | 요금 | **기존 키만 · 델타 0** · 재생성 = 매회 생성비 · 더블클릭·재시도 = 같은 attemptToken → 원장 duplicate 무료 · 견적 결박 = materialsHash | 5/5 기존 키. 회의론자 최종 1로 키 축이 초안 id → attemptToken. 상세 §5 |
| 8 | 돈 단위·DDL | 돈 단위 = attemptToken · DM 초안 행·이메일 `createEmailCampaign` draft 행은 **결과 참조** · **DDL 0** | 5/5(백엔드가 `email-channel.ts:129-207` 실측 · `scheduledAt` 없으면 draft · 기존 컬럼만 INSERT) · 회의론자 최종 2 |
| 9 | 채널 | **DM+이메일 동시 출시 · 단일 선택**(헤더 세그먼트 · 기본 = 들어온 목록 채널) · 이메일이면 접힘 1행(광고 여부 체크 = `is_ad` 전달 · 제목·프리헤더 서버 산출) | 5/5(DM 단독 안은 이메일 DDL 우려가 풀리며 전원 접음) |
| 10 | ENV | 신규 `AI_AUTO_BUILD_COMPANY_IDS` 기본 미노출 | 5/5 |

## 4. 화면 규격

### 4-1. 카드띠(입구)
- 위치: `DmBuilderPage` 목록 상단 · `EmailCampaignsPage` 상단(자연어 카드 `:845` + 시작 허브 `:886` 자리를 이 띠 하나로).
- 좌 = **AI 자동제작**(`OUI_CARD_ACCENT` · 화면당 강조 카드 1개 규칙 · NEW) · 우 = **직접 제작**(`OUI_CARD` dashed). 빈 상태 = 같은 카드 확대(신규 컴포넌트 0 · `DmBuilderPage:945-990` dashed 규격 재사용).
- 이미지 스튜디오는 세 번째 갈래로 올리지 않는다. 페이지 이미지 칸 안 보조 링크("쓸 이미지가 없으면 스튜디오에서 만들기").

### 4-2. 페이지(`/quick-campaign` 승격 · 1열 · `OUI_WRAP_NARROW`)
시각 무게 4:2:2:1. 필수는 하나: 행사 카드 1장에 내용 또는 이미지.
1. **행사 카드**(`EventCardsInput` 그대로): 카드 ≤3 · 카드당 제목(선택)·내용·이미지 ≤3(썸네일 80px 행 + [추가] 타일 + [소재 라이브러리]) · 링크 · "그대로 씁니다" 체크. 첫 장 = 첫 화면 문구(`MaterialInput:80`) 유지. 썸네일 좌상단 읽기 전용 배지(서버 판정 결과 · "추정").
2. **상품**(폼 전체 1칸): 연동 시 상단 1줄 "[연동몰에서 불러오기]" → `MallProductPickerModal`(카페24·네이버 탭) · 직접 추가 = 붙여넣기 파싱 · 표시 = 썸네일/칩 줄(56px · 가로 스크롤 · 상품명·판매가·`source`) · 미연동이고 0건이면 칸 접힘(버튼 미렌더).
3. **기능 칩** 4 + "AI가 알아서"(기본 ON). 쿠폰 칩을 켜면 "발행 때 120크레딧" 한 줄 사전 고지.
4. **채널**: 폼 헤더 우측 세그먼트 [모바일 DM | 이메일] 단일 선택. 이메일이고 SMTP 미설정이면 세그먼트 비활성 + 사유. 이메일 선택 시 폼 끝 접힘 1행: 광고 여부 체크(기본 = 회사 기본값).
- 하단 sticky 바(`QuickCampaignPage:267` 그대로): 좌 = 견적 1줄(서버 부품 합 = N크레딧 · 이미지 N장 · 상품 N개 · "발행 시 별도") · 우 = [AI 자동제작] 1개 → `CreditConfirmModal` 1회.
- 상태: 텍스트·상품·칩·채널 = 로컬 초안 키(`EventCampaignModal:298-304` 패턴) · 이미지 = 고르는 즉시 업로드해 url만 보유(새로고침 복구가 이미지까지 닿는다).

### 4-3. 생성 중
차단(재클릭·이탈 방지) 유지. 폼 카드 자리에 **in place 진행 카드**(4행 체크리스트: 재료 읽기 → 구성 → 문안 → 이미지 배치 · 완료행 emerald · 현재행 spinner · 서버 phase만 · 15초 경과 시 "20~40초" 보조 1줄). 입력 disabled · 위치 이동 0.

### 4-4. 결과
- DM = `/dm-builder?id={draftId}` 착지(편집 모드). 이메일 = 이메일 편집기 착지(campaignId).
- 캔버스 위 **sticky 얇은 바 1개**: 좌 판정 3항(재료 N건 · 이미지 N/N장 배치 · 구획 N개 · emerald/amber) · 중 [미반영 N건] 칩(누르면 목록 · 8건 초과 은닉 금지) · 우 [다시 만들기](ConfirmModal 1회 · "다시 만들면 생성비 N크레딧" 고지). 편집을 시작하면 칩 1개로 접힘. violet/amber · rose 0. 반짝임·그라데이션 글자 금지(이 바 자체가 AI 티).
- 결과 바 아래 1줄: "룰렛·설문은 편집기에서 추가할 수 있어요".

## 5. 요금

| 항목 | 키 | 값 | 멱등키 |
|---|---|---|---|
| DM 생성 | `dm-ai-generate` | 5 | `quick:{companyId}:dm:{attemptToken}` |
| 이메일 생성 | `email-ai-generate` | 3 | `quick:{companyId}:email:{attemptToken}` |
| 이미지 판독(텍스트 비고 이미지 있을 때 1회) | `event-image-extract` | 3 | 기존 |
| 발행 | `dm-builder` 100 · `dm-interaction-publish` 120 · `email-campaign-complete` 50 | 기존 | 각 발행 라우트가 자기 키로(견적 합산 금지 · "발행 시 별도" 1줄) |

- 신규 키 0 · 대행 델타 0. 대행 가치는 발행가가 받는다. 인상·델타는 계측(생성→발행률) 뒤 Harold 결정.
- **재생성 = 매회 생성비**(원스텝 규약과 동일 · 세션 카운터 0 · DDL 0). [다시 만들기] = 새 attemptToken. 모달이 금액을 밝힌다.
- **더블클릭·응답 유실 재시도 = 무료**: 같은 attemptToken → 원장이 `duplicate`. 수용 위험 = 응답 유실 뒤 재시도는 초안이 하나 더 생길 수 있다(차감 0 · AI 원가만 · 드묾).
- **견적 결박**: `materialsHash`(정규화 텍스트 + 상품번호 목록 + 이미지 역할·순서 · URL uuid 제외)는 키가 아니라 `expectedTotal` 검증에만 쓴다. 서버 견적과 다르면 409 `QUOTE_CHANGED`(표시 ≠ 차감 차단).
- **판독(3)**: 텍스트가 비고 이미지가 있을 때만 · 견적 줄에 "이미지 글자 읽기 3(지금 차감)"으로 **분리 표기** · 확인 모달 1회가 동의(별도 버튼 X · 1클릭 유지) · 같은 이미지 조합은 결과 재사용(메모리 캐시 10분 · 재차감 0) · 판독→생성을 한 번에 잇는다(옛 패널의 "판독 뒤 재실행" 2회 흐름 제거).
- 판정 = `deductCreditOutcome` 3값(deducted / duplicate / failed). `failed`는 생성을 막지 않되 `[CREDIT][MISS]`에 **멱등키·attemptToken·초안 id**를 싣는다(수동 재차감 대상 특정).
- 화면 금액 = 서버 견적(`quoteQuickCampaign` 확장 · 채널 키 반영)만. 하드코딩 "3크레딧" 3곳(`AiPromptModal:184` · `EmailVisualEditor:588` · `EmailCampaignsPage:853`) 동시 정리.
- 크레딧제 미적용 회사 = 금액 0 표시(원스텝 `creditEnabled` 규약).

## 6. 서버 계약

### 6-1. 재료 스키마 v1(`materials` · `version: 1` 필수 · 옛 요청(version 없음)은 현행 경로 그대로)
```json
{
  "version": 1,
  "attemptToken": "0f3c...(화면이 누름마다 생성 · 재시도 동일)",
  "expectedTotal": 5,
  "channel": "dm",
  "isAd": true,
  "eventCards": [
    { "id": "c1", "title": "가을 세일", "text": "10/1~10/15 전 품목 30% 할인", "link": "https://...",
      "licensed": true,
      "images": [{ "url": "/api/dm/v/images/{companyId}/x.jpg", "width": 1200, "height": 1600 }] }
  ],
  "products": [
    { "source": "mall", "provider": "cafe24", "code": "12345", "name": "수분크림 50ml",
      "price": 38000, "salePrice": 26600, "discountRate": 30,
      "url": "https://mall.../product/detail.html?product_no=12345", "imageUrl": "https://mall.../big/1.jpg" },
    { "source": "manual", "name": "립밤", "price": 12000, "salePrice": null, "discountRate": null, "url": null, "imageUrl": null }
  ],
  "features": ["product_carousel", "countdown"],
  "brandName": null
}
```
- 정규화 = `normalizeBuildMaterials(raw, companyId)` **한 곳**(순수) → `EngineMaterials`. `origin`·`licensed`·`source`는 클라이언트 주장이 아니라 서버 판정(현행 `normalizeQuickMaterials` 규약 계승). 이미지 URL은 이 회사의 서빙 경로만(`/api/dm/v/images/{companyId}/` + 소재 라이브러리 `/api/cdp/inapp/image/{companyId}/` **접두어 추가가 선행 작업**).
- `products` → `EngineMaterials.products`(현행 `[]`를 채운다). mall 항목은 **상품번호(`code`) 기준** 서버 재조회 값으로 덮는다(불변 3 · 이름 검색 `matchMallProductByName`은 정규화가 품절·미전시를 버려 고른 상품이 조용히 사라지므로 쓰지 않는다 · `mall-product-match.ts:20-44` · `mall-product-normalize.ts:50`). manual 항목은 `validateProductsAgainstEventText` 통과분만(원문 대조).
- `features` → `EngineOptions.features`(신설 · `null` = 현행).
- `isAd` → 이메일 생성 입력(현행 미전달 `routes/email.ts:1052·1057` 정정). `produceOutreachBrandEmail`에 `isAd` 파라미터 1개 추가(정보성 기본) + 캠페인 행 `is_ad` 저장. 표기 부착은 발송 단계 그대로(회의론자 최종 8).
- `attemptToken`(uuid · 필수) → 멱등키. `expectedTotal` → 견적 결박(409).

### 6-2. 엔진 후처리 `applyFeatures`(신설 · 결정적)
- 자리 = `assembleDmCampaign` 순서 "생성 → 채우기 → **features** → 차단 → 정리 → …"(`campaign-engine.ts:137-175`). `EngineDeps.applyFeatures(sections, features, materials)`.
- 규칙: `features === null` → no-op(아웃리치·옛 호출 회귀 0). OFF 타입 = 제거. ON 타입 = 재료가 있을 때만 `createSection` 기본 props로 삽입(카피 생성 0 · 환각 0) · 재료 없으면 삽입하지 않고 `materialsMeta.featuresSkipped`에 사유. 허용 목록 = `dmAllowedTypes('customer')` 교집합.
- 계약 테스트: "features 밖 타입 미생성" · "null = 출력 동일".

### 6-3. 이미지 역할 판정(서버 · 1클릭)
- 순서 = 기본(첫 장 = 히어로 후보). 자격 = `heroEligible`(`sales-outreach-look.ts:85`) 계열: 긴 변·비율. 로고 후보 = 가로세로 비 3:1 이상 또는 짧은 변 400 미만 투명 PNG(**미검증 수치 · 표본 20장 실측 전 "추정" 표시**). 실패 = 강등 + 다음 자격자 승격. 히어로 후보 0 = 텍스트가 있으면 `text_card` 상단 생성 + amber 고지.
- 응답 `materialsMeta.imageRoles[]` = 화면 배지의 단일 출처.

### 6-4. 최소 재료 게이트(차감 앞)
- 통과 = 사용자 텍스트 40자 이상 **또는** (이미지 1장 이상 **그리고** 히어로 후보 1장 이상). 미달 = `400` + `{ missing: ['text' | 'hero'] }` 한 줄.
- 생성 뒤 = 섹션 수·히어로·CTA 링크로 `MATERIAL_THIN` 판정 → 발행 잠금 + 고지(B-0909-1 형태 재사용).
- 텍스트 40자 단독 통과(이미지 0)는 **문안형 구성**으로 선다: 히어로 자리 = `text_card` 상단(계약 테스트로 고정) · 결과 바에 "사진 없음 · 이미지 추가" 1줄(회의론자 최종 5).

### 6-5. 실패 계약
| 상황 | 응답 |
|---|---|
| 테이블·컬럼 부재 | 503 `DB_MIGRATION_PENDING`(`handleDbMigrationError` 유지 · `email_campaigns.sections/ai_generated`는 ALTER 컬럼) |
| 원장 조회 실패 | 503 `CREDIT_LOOKUP_UNAVAILABLE` |
| 잔액 부족 | 402 |
| 동시 생성(같은 회사 · in-flight) | 409(메모리 잠금 · 클라 busy와 한 쌍) |
| 몰 재조회(상품번호 기준) 못 찾음 | 피커 값 그대로 싣고 카드에 "가격 확인 못함" 표시 · `materialsMeta.mallUnverified`(조용한 소실 0 · 회의론자 최종 4) |
| 몰 재조회 결과 품절·미전시 | 그 상품만 카드에서 제외 + 결과 바 사유 1줄 |
| 몰 API 장애 | 생성 계속 · 전 항목 "가격 확인 못함" · `materialsMeta.mallFailed`(502 금지) |
| 이미지 일부 실패 | 그 장만 제외 · `images` 수로 드러냄 |
| 차감 **이전** 실패 | 만든 draft 행 제거(고아 0) · 차감 0 |
| 차감 **이후** 실패(응답 유실 등) | 행을 남기고 목록에 "생성 중 오류" 표시 · 회수 금지(전사 정책 · 회의론자 최종 3) |
| 커버리지 미반영 | 숨기지 않는다 · `coverage.missing` 그대로 |

### 6-6. 이메일 선행 5(둘 다 출시의 조건)
① SMTP 게이트 `isSmtpConfigured`(`company-smtp-client.ts:369`) — `ensureEmailAccess`는 요금제만 본다(`email.ts:314-318`) ② `is_ad` 전달 ③ 멱등키(`quick:{campaignId}:{hash}`) ④ `eventCards` 이메일 합류(`campaign-quick.ts:364-377`) ⑤ 제목·프리헤더 서버 산출(덮어쓰기는 편집기).

### 6-7. ENV
`AI_AUTO_BUILD_COMPANY_IDS`(회사 UUID 목록 · 비면 미노출). 판정 함수 `aiAutoBuildEnabled(companyId)` = 카드띠 노출 + **materials v1 분기 3곳(DM 생성·이메일 생성·견적) 진입 조건에 AND**(회의론자 최종 7 · 기존 `quickMaterialsEnabled`는 v0 요청에만). 계약 테스트 "ENV 비면 v1 = 403". 승격 시점부터 `/quick-campaign` = AI 자동제작이라 노출·API 모두 신규 ENV가 지배한다.

## 7. 파일별 소유(수정·신설)

| 구분 | 파일 | 무엇 |
|---|---|---|
| 신설(백) | `utils/ai-auto-build-materials.ts` | `normalizeBuildMaterials` · `buildMaterialsHash` · 최소 재료 게이트 · 이미지 역할 판정(순수) · `aiAutoBuildEnabled` |
| 수정(백) | `utils/campaign-engine.ts` | `EngineOptions.features` · `EngineDeps.applyFeatures` · 순서 1스텝 |
| 수정(백) | `utils/sales-outreach-produce.ts`(`outreachEngineDeps`) | `applyFeatures` 구현(`createSection` · 허용 목록) |
| 수정(백) | `utils/campaign-quick.ts` | `products` 채움 · 몰 재조회·병합 · 이메일 eventCards·is_ad·멱등키 · 견적 채널 키 · draft 행 생성·실패 제거 |
| 수정(백) | `routes/dm.ts` · `routes/email.ts` | materials v1 분기 · 게이트 순서(판정 → checkCredit) · 409 in-flight |
| 수정(백) | `routes/event-campaigns.ts` | 견적 라우트 채널·상품 수 반영 |
| 신설(프) | `components/ai-build/AiBuildEntryStrip.tsx`(카드띠) · `FeatureChips.tsx` · `ProductPickList.tsx` · `BuildResultBar.tsx` | 신규 4개로 제한 |
| 수정(프) | `pages/QuickCampaignPage.tsx` | 승격(제목·채널·상품·칩·결과 착지) |
| 수정(프) | `pages/DmBuilderPage.tsx` · `pages/EmailCampaignsPage.tsx` · `components/dm/DmTopBar.tsx` | 카드띠 · 패널 → 링크 1줄 · "직접 제작" 개명 · 하드코딩 금액 제거 |
| 수정(프) | `components/MaterialQuickPanel.tsx` · `EmailVisualEditor.tsx` | 링크 1줄 축소(플래그) |
| 재사용 | `EventCardsInput` · `MallProductPickerModal` · `AssetLibraryPickerModal` · `CreditConfirmModal` · `ConfirmModal` · `useToast` · `FormControls` · `operator-ui.ts OUI_*` · `product-paste.ts` | 신규 금지 |
| 문서 | `status/SCHEMA.md` 무변경(DDL 0) · `status/SOT-INDEX.md` 등재 · 종결 시 `FEATURE-AI-AUTO-BUILD.md` | |

## 8. 계약 테스트(고정 지점)

1. 가격 원문 보존: 입력 정수 = 섹션 props 정수(AI 미경유).
2. 상품 링크·이미지 보존 + 상품번호 중복 제거 · manual↔mall 충돌 시 mall 재조회 값.
3. 같은 `materialsHash` 2회 = 원장 1행 · 해시가 URL uuid에 흔들리지 않음.
4. 채널 독립(DM 키로 이메일 차감 안 됨) · `is_ad` 전달.
5. `origin`·`licensed`·`source` 서버 판정(클라 주장 무시).
6. `features` 밖 타입 미생성 · `features: null` = 출력 동일(아웃리치 스냅샷).
7. 타 회사·외부 URL 거부 · 소재 라이브러리 접두어 허용.
8. 최소 재료 게이트가 `checkCredit`보다 앞(소스 계약).
9. SMTP 미설정 회사 이메일 = 400 + 사유, 차감 0.
10. 실패 생성 = draft 행 0(고아 없음).
11. 화면: 카드띠 라벨 둘 · 금액 하드코딩 0(소스 grep 계약) · 모델명 0.
12. 같은 attemptToken 재시도 = 원장 1행 · `expectedTotal` 불일치 = 409.
13. 신규 ENV 비면 v1 요청 = 403(3곳).
14. 텍스트 40자 단독(이미지 0) = 문안형(히어로 자리 text_card) · MATERIAL_THIN 아님.
15. 몰 재조회 못 찾음 = 피커 값 유지 + `mallUnverified` · 품절 = 제외 + 사유.
16. 차감 뒤 실패 = draft 행 유지(회수 0).

## 9. 착수 게이트 · 실측 · 첫 배포 범위

- **착수 전 실측(코드 전)**: ① `email_campaigns`에 `sections`·`ai_generated` 컬럼 실존(`information_schema`) ② `dm_pages` draft 흐름에서 `quick:{draftId}` 원장 행 실존 1건 ③ 카페24 연동 회사 1곳의 `/api/mall-products/preview` 응답에 `productUrl`·`imageUrl`·판매가 실존.
- **첫 배포 범위**: DM+이메일(단일 선택) · 카페24 단독(네이버 = 링크 null 처리로 허용 · 고도몰·아임웹·메이크샵 2차) · 몰 상품은 피커에서 고른 것만(자동 매칭 0) · 칩 4 · 최소 재료 게이트 · 신규 ENV 미노출.
- **실측 1건(배포 뒤 · 도달 불가 값)**: 카페24 연동 회사 · 이미지 3(로고 1 · 상품 2) + 텍스트 60자 + 몰 상품 2 선택 → ① 히어로에 로고가 오지 않는다 ② 상품 카드 가격 = 몰 값 자릿수까지 ③ 같은 초안 재시도 = `ai_credit_transactions` 멱등키 1행 ④ 재료 두 줄 = 400 ⑤ 이메일 1건 draft 행 생성 + `is_ad` 반영 + 완성 50 별도 차감. 하나라도 어긋나면 스위치를 열지 않는다.
- **2차(범위 밖 등재)**: 발행 직전 몰 재조회 · 이미지 역할 편집 · 자동 이름 매칭 · 인터랙션 섹션(룰렛·설문·응모) 엔진 편입 · 원스텝 폐기 판정(계측 대조군) · 입구 8개 정리 · 클릭 추적(hlj.kr 단축 축과 분리) · 고도몰·아임웹·메이크샵 상품 API · 우커머스 어댑터 · 대행 델타·요금 인상.

## 10. 회의론자 최종 검증(수렴안 v1 · 8건 · "다섯 역할이 납득할 안인가 = 예")

| # | 깨지는 지점 | 심각도 | 처리 |
|---|---|---|---|
| 1 | 멱등키가 초안 id라 조립 뒤에 생겨 응답 유실 재시도를 못 막음(`campaign-quick.ts:297-307`) | high | **채택** → 돈 단위 = attemptToken(§2-9 · §5) · materialsHash는 견적 결박으로 이동 |
| 2 | 이메일은 차감 앞에 돈 단위 행을 못 만듦(`email-channel.ts:143-172` subject·htmlBody 필수) | high | **채택** → 이메일도 attemptToken · campaignId는 결과 참조 |
| 3 | 고아 draft 제거가 차감 뒤 실패에서는 효과물 회수가 됨(전사 정책 위반) | high | **채택** → 제거는 차감 이전 실패로 한정 · 이후 실패는 행 유지 + "생성 중 오류" |
| 4 | 이름 기준 재조회가 고른 상품을 조용히 지움(`mall-product-match.ts:20-44` · 정규화가 품절 버림 `:50`) | high | **채택** → 상품번호 기준 · 못 찾으면 피커 값 + "가격 확인 못함" · 품절은 제외 + 사유 |
| 5 | 텍스트 40자 단독 통과가 사진 0 산출물 허용(`heroFallback`) | medium | **채택** → 문안형 구성 계약 테스트 + 결과 바 1줄 |
| 6 | 판독 3크레딧이 산출물 없이 나감 · 재실행 위험(`MaterialQuickPanel:79`) | medium | **부분 수용** → 견적 분리 표기 + 확인 모달 1회 + 같은 조합 재사용 + 판독→생성 한 번에. 별도 버튼은 불수용(1클릭 원칙 · 텍스트가 빈 경우에만 생기는 단계라 확인 모달이 동의) |
| 7 | 신규 ENV가 화면만 막고 API는 `quickMaterialsEnabled`(비면 전 회사 true) | medium | **채택** → v1 분기 3곳 AND + 계약 테스트 |
| 8 | `produceOutreachBrandEmail`에 isAd 입력이 없음(`campaign-quick.ts:371-378`) | medium | **채택** → 파라미터 1개 + 행 `is_ad` 저장 |

끝까지 갈린 지점 = 6번(판독 동의 형태)뿐. 주재자 판단 = 1클릭 원칙이 우선하고, 확인 모달의 분리 표기가 "산출물 없는 차감"의 동의 역할을 한다. Harold가 별도 버튼을 원하면 폼 이미지 칸에 [이미지 글자 읽기 3] 버튼 1개로 바꾼다(코드 영향 = 프론트 1곳).

## 11. 미검증 목록(설계 시점)

- 로고 후보 판정 수치(비 3:1 · 짧은 변 400 · 투명 PNG): 업로드 표본 20장 실측 전.
- `createEmailCampaign`이 draft로 만든 행이 이메일 목록에서 "AI 초안"으로 구분 표시되는지(현 목록 필터).
- 카페24 `productUrl`이 상품별로 항상 채워지는지(0708 preview 실측은 1회사).
- 40자/1장 게이트가 실제 고객 재료 분포에서 과하거나 느슨한지(계측 뒤 조정).
- 생성 소요(몰 재조회 포함)가 40초 상한 안인지.
- 카페24 상품번호 단건 조회 API(`products/{product_no}`)가 현 클라이언트(`utils/cafe24-client.ts`)에 있는지 · 네이버 단건 조회 가능 여부(없으면 T3에서 추가 · 스펙 실측 후).

## 12. 다음 세션 착수 원장(순서)

| T | 축 | 내용 | 검증 |
|---|---|---|---|
| T0 | 게이트 | §9 착수 전 실측 3건(Harold SQL·API) | 결과 회신 |
| T1 | 백 순수 | `ai-auto-build-materials.ts`(정규화·해시·게이트·역할 판정) + 테스트 1·3·5·7·8 | vitest RED→GREEN |
| T2 | 백 엔진 | `features` + `applyFeatures` + 테스트 6(아웃리치 스냅샷 동일) | vitest |
| T3 | 백 조립 | `campaign-quick.ts` products·상품번호 재조회(클라이언트 단건 조회 추가 가능)·병합 · 이메일 5 선행 · attemptToken 멱등·견적 결박 · draft 행·차감 전 실패 제거 | 테스트 2·4·9·10·12·15·16 |
| T4 | 백 라우트 | dm/email materials v1 분기 · 순서(판정→checkCredit) · 409 · ENV | tsc 0 · 전체 suite |
| T5 | 프 페이지 | `QuickCampaignPage` 승격(채널·상품·칩·결과 착지) + 신규 4 | frontend tsc 0 · build:safe |
| T6 | 프 입구 | 카드띠 2곳 · 패널 링크 1줄 · "직접 제작" 개명 · 금액 하드코딩 0 · NEW | grep 계약 |
| T7 | 검토 | 내 적대 검토 → Codex `adversarial-review`(돈 경로: 요금·멱등·게이트 · 라운드 ≤2) | high 0 |
| T8 | 배포·실측 | OPS §2-2(백·프 build:safe) · ENV 1회사 · §9 실측 1건 | 통과 시 회사 확대 |

## 13. 구현 기록(2026-09-14 · 2세션)

| T | 상태 | 산출물 | 검증 |
|---|---|---|---|
| T0 | ①·② 통과 · ③ 미검증(카페24 활성 연동 0 · `디버깅테스트` gyunoo83 `token_expired` 2026-07-21) | `email_campaigns.sections/ai_generated/is_ad` 실존(`ai_generated` NOT NULL) · `quick:{draftId}` 원장 5행 | ③ = 재인증 뒤 T3 착수 전 다시 본다(Harold 결정) |
| T1 | 완료 | `utils/ai-auto-build-materials.ts` + `__tests__/ai-auto-build-materials.test.ts` 36건 | RED→GREEN · 전체 4,460 · tsc 0 |
| T2 | 완료 | `campaign-engine.ts`(`EngineOptions.features?` · `EngineDeps.applyFeatures` · `EngineResult.features` · 순서 채우기→기능 칩→차단) · `sales-outreach-produce.ts applyDmFeatures`(deps 배선) · `event-brief.ts BENEFIT_TOKEN_RE·firstBenefitPhrase` · 테스트 9건 | RED→GREEN · 전체 4,469 · tsc 0 · 아웃리치 골든 무변경 |
| T3 | 완료 | `campaign-quick.ts`: `generateFromBuildMaterials`(v1 오케스트레이터 · `BuildDeps` 주입 · `defaultBuildDeps` 실물) · `quoteBuildMaterials`(채널 키 · 판독 분리 · creditEnabled 0) · 판독 캐시 10분 · `ai-auto-build-materials.ts`: `AiAutoBuildError`·`buildIdempotencyKey`·`mallProductNoOf`·`resolveBuildProducts` · `cafe24-client.ts fetchCafe24ProductsByNoRaw`(`product_no` 콤마 · **미검증**) · `mall-product-normalize.ts cafe24ProductAvailability` · `sales-outreach-produce.ts`: `applyDmFeatures` EMAIL 채널 + `produceOutreachBrandEmail` features 배선(`ProduceDmInput.features?` · `BrandEmailResult.features`) · 테스트 34건(계약 2·4·9·10·12·15·16) | RED→GREEN · 전체 288파일 4,504 · tsc 0 · v0 경로 문자열 계약 그대로 |

| T4 | 완료 | `routes/dm.ts`·`routes/email.ts`: materials v1 분기(v0 앞 · `isBuildMaterialsV1`) · `aiAutoBuildEnabled` 403 · 회사 단위 in-flight 409(`utils/inflight-lock.ts` 신설 · `buildInflightKey`) · 채널 고정(dm/email) · 오류 매핑(`aiAutoBuildErrorResponse` → 402 → 503 `dm_pages`/`email_campaigns` → 500) · `routes/event-campaigns.ts`: **POST** `/materials/quote` v1(재료 본문 · 게이트·역할·견적·SMTP·요금제 잠금 · 차감 0) · `campaign-quick.ts`: `prepareBuildMaterials`(견적·생성 공통 앞단) · `quoteFromBuildMaterials` · `buildGenerateResponse` · 원장 조회 실패 503 `CREDIT_LOOKUP_UNAVAILABLE` · 테스트 12건(라우트 소스 계약 4 · 잠금 2 · 매핑 2 · 오케스트레이터 4) | RED→GREEN · 전체 290파일 4,516 · tsc 0 · v0 경로 무후퇴 |

| T5 | 완료 | `pages/QuickCampaignPage.tsx` 승격(1열 `OUI_WRAP_NARROW` · 채널 세그먼트 · 행사 카드 → 상품 → 칩 → 이메일 광고 1행 · sticky 바 = 서버 견적 1줄 + [AI 자동제작] → `CreditConfirmModal` 1회 → 편집기 착지 · 진행 카드 = 실제 단계만 · 오류 코드 매핑 · 로컬 초안 복구 · `?regen=1` 재생성 · 옛 3채널 세트는 보조 줄 1개) · **신규 5**(`ai-build/BuildCardsInput`(즉시 업로드·라이브러리·드래그 정렬·서버 판정 배지) · `FeatureChips` · `ProductPickList` · `BuildResultBar` · `AiBuildEntryStrip`) · `utils/ai-build.ts`(화면 CT: 재료 계약 조립·칩 재료 거울·오류 문구·초안·결과 전달·노출 스위치 훅) · `pages/QuickCampaignLegacyPage.tsx`(v0 원본 파일째 복사 · 신규 ENV 미개방 회사가 보는 화면) · `DmBuilderPage`·`EmailVisualEditor` 캔버스 위 결과 바(편집 시작 = isDirty 로 접힘 · [다시 만들기] = ConfirmModal 1회 → 새 토큰) · `EmailCampaignsPage` `?edit=` 딥링크 | frontend tsc 0 · build:safe 성공(lazy 청크 43건 실존) · 검출기 1건 정정(로고 배지 색) · 모델명·native dialog·박-단어·금액 하드코딩 0 |
| T6 | 완료 | 카드띠 2곳(`DmBuilderPage` 목록 상단 · `EmailCampaignsPage` 상단 · ENV 미개방 = 미렌더) · `MaterialQuickPanel` = 개방 회사에서 링크 1줄(렌더 플래그 · 제거 0) · "질문 몇 개로" 접힘 줄로 강등 · "자유 시작"·"비주얼로 만들기" → "직접 제작" · 허브 타일 "원클릭 캠페인" → "AI 자동제작"(NEW) · 금액 하드코딩 3곳(`AiPromptModal`·`EmailVisualEditor`·`EmailCampaignsPage`) → `constants/credit.ts AI_GENERATE_COSTS`(백엔드 CREDIT_COST_MAP 미러 · 옛 "3크레딧" 표기는 DM 생성 5로 오른 뒤에도 남아 있던 오표기) · 백엔드 GET `/materials/quote` 응답에 `auto_build_enabled` 추가(노출 스위치의 화면 원천) | frontend tsc 0 · backend tsc 0 · 전체 4,516 |

| T7 | 완료(Codex 2R 상한) | 내 적대 검토 25항 → Codex `adversarial-review` 돈 경로 1R(high 2 · medium 1 · 전부 수용) → 2R(증분 · high 2 · 전부 수용 · 라운드 상한 도달) · 수용분은 테스트로 고정(quick 테스트 +7 · materials +2) | 전체 290파일 4,525 · tsc 0 · **3R 은 Harold 판단**(2R 지적은 내 테스트로만 닫음) |

**★ Codex 적대검토(0914 T7 · 1R 3건 + 2R 2건 전부 수용) = §5 정정 4건(뿌리 = 돈 단위가 토큰뿐 · 판독비가 원장 밖 캐시)**:
1. **멱등키 = `quick:{companyId}:{channel}:{attemptToken}:{과금 지문 16자}`**(§2-9·§5 "지문은 키가 아니다" 정정 · 1R high → 2R high 로 지문 범위 확대). 토큰만 키면 결제한 토큰으로 재료를 바꿔 보내는 요청이 duplicate(무료)로 통과한다. **과금 지문(`buildBillingHash`) = 정규화 입력 전체**(채널·광고·카드 제목·내용·링크·면허·이미지 URL·치수·상품 전부·칩·브랜드명 · 토큰·견적 합계·카드 id 제외) — 견적 결박용 지문(`buildMaterialsHash` · uuid 불변 · 세 요소)과 **분리**한다(1R 뒤 견적 지문을 키에 넣었더니 히어로 이미지만 바꾼 요청이 같은 키였다 = 2R high). "같은 재료 재시도 = 원장 1행 · 이미지·면허·칩 하나라도 다르면 새 차감"을 원장이 지킨다. 화면도 재료가 바뀌면 토큰을 버린다(이중 안전).
2. **판독(이미지 글자 읽기 3)은 `runInCreditBundle` 안에서 돌려 AI 호출의 자체 차감을 끄고, 초안이 생긴 뒤 `quick-read:{companyId}:{처음 읽은 시도 토큰}:{이미지 지문 16자}` 키로 원장에 차감한다**(1R high · §5 "판독 함수 안에서 차감" 정정). 조립 실패 = 판독비 0(산출물 없는 차감 0 · 회의론자 최종 6 잔여 위험 해소). 생성비 차감 뒤 판독비 차감이 실패하면 행은 남기고 `[CREDIT][MISS] ai-auto-build-read` 로 키·토큰·초안 id 를 남긴다.
3. **판독 캐시는 정산 상태를 든다**(2R high). 판독 직후 = 미정산(readKey 보관). 초안이 안 생겨 미정산으로 남은 캐시는 견적에 판독 부품을 **그대로 남기고**(표시 = 차감) 다음 초안 성공 때 그 readKey 로 멱등 차감한 뒤 정산으로 전이한다. 정산된 캐시만 무료 재사용(견적에서 판독 제외).
4. **캐시(정산) 적중 = 견적에서 판독 부품이 빠진다**(1R medium). 견적(POST quote)과 생성이 같은 `freshVisionCache(...).settled` 판정을 읽어 표시 = 차감. 견적 뒤 캐시가 만료되면 합계가 달라져 409 → 화면이 견적을 다시 받는다. 화면의 "이미지 글자 읽기" 표시는 서버 견적 부품으로만 판단한다.
- 2R 이 확인해 준 것: 캐시 만료 시 409 처리 · `runInCreditBundle` 안 creditCost 0 · 판독비 failed 의 식별 로그·초안 유지는 타당.

**T5·T6 에서 설계와 다르게 한 것(근거)**:
1. 신규 컴포넌트 4 → 5. `EventCardsInput`(v0 · File 보유)을 "그대로" 쓰면 §4-2의 "이미지는 고르는 즉시 업로드해 url 만"·라이브러리·드래그 정렬·서버 판정 배지가 안 들어간다. v0 화면이 그 컴포넌트를 그대로 쓰므로 후계 `BuildCardsInput` 을 새로 두고 v0 는 무접촉.
2. `/quick-campaign` 은 신규 ENV 미개방 회사에 **옛 화면(v0)** 을 그대로 보인다(`QuickCampaignLegacyPage` · 원본 파일째 복사). 설계 §6-7 "승격 시점부터 신규 ENV 가 지배" 를 글자대로 하면 ENV 를 열기 전까지 모든 회사의 원클릭 캠페인이 사라진다(회귀 창). 개방 회사만 새 화면.
3. 옛 3채널 세트(EventCampaignModal)·임시 보관 재개는 새 화면 맨 아래 보조 줄 1개로 남겼다(허브 진입이 이 페이지뿐 · 입구 8개 정리는 §9 2차).
4. 이메일 [직접 제작] = 옛 [비주얼로 만들기]와 같은 동작(빈 블록 편집기) · DM [직접 제작] = 옛 [자유 시작].
5. 판독(이미지 글자 읽기)은 별도 요청 없이 생성 호출 안에서 서버가 한 번에 잇는다(§5 "판독→생성 한 번에") · 견적 줄에 "이미지 글자 읽기 3(지금 차감)" 분리 표기.

## 14. T8 배포·ENV·실측 원장(Harold 실행 · 명령마다 실행 위치)

### 14-1. 커밋·push
▶ 실행 위치: 로컬 PowerShell (`C:\Users\ceo\projects\targetup`)
```powershell
tp-push "0914 AI 자동제작 T1~T7 - 재료 코어·엔진 칩·조립·라우트·프론트 승격·입구·Codex 적대검토(tsc 0 · backend 4,516 · frontend build:safe · DDL 0 · ENV 비면 옛 화면)"
```

### 14-2. 배포(OPS §2-2 · 백엔드 + 프론트 둘 다)
▶ 실행 위치: .62 · administrator
```bash
cd /home/administrator/targetup-app && git pull
```
```bash
cd /home/administrator/targetup-app/packages/backend && npm run build:safe
```
```bash
cd /home/administrator/targetup-app/packages/frontend && npm run build:safe
```
```bash
pm2 reload targetup-backend
```
배포 확인(둘 다 1 이상 + online · ENV 를 아직 안 넣었으니 화면은 전 회사 옛 화면 그대로):
```bash
grep -c "generateFromBuildMaterials" /home/administrator/targetup-app/packages/backend/dist/routes/dm.js; grep -c "generateFromBuildMaterials" /home/administrator/targetup-app/packages/backend/dist/routes/email.js; grep -l "AI 자동제작" /home/administrator/targetup-app/packages/frontend/dist/assets/QuickCampaignPage-*.js | wc -l; pm2 status targetup-backend
```
(프론트 청크는 문자열 표 난독화라 속성명(`auto_build_enabled`)으로는 못 찾는다 · 화면 문구 "AI 자동제작"으로 본다)
```bash
true
```

### 14-3. ENV(1회사 · 카페24 재인증 뒤 T0 ③ 실측이 먼저)
1. 카페24 재인증: 디버깅테스트(gyunoo83) 회사로 로그인 → 자사몰 연동 화면에서 카페24 재연결(OAuth). 그 뒤 T0 ③ 확인:
▶ 실행 위치: .62 · administrator
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT company_id, mall_id, status, connected_at, token_expires_at FROM company_integrations WHERE provider='cafe24';"
```
`status='active'` 가 아니면 ENV 를 열지 않는다(몰 재조회는 "가격 확인 못함"으로 접히지만 실측 1건의 ②(가격 자릿수) 항목을 볼 수 없다).
2. ENV 추가(값에 비밀 없음 · 회사 UUID 목록):
▶ 실행 위치: .62 · administrator
```bash
grep -c '^AI_AUTO_BUILD_COMPANY_IDS=' /home/administrator/targetup-app/packages/backend/.env
```
0 이면:
```bash
echo 'AI_AUTO_BUILD_COMPANY_IDS=a0990249-3550-4baa-92ca-32e45b185e83' >> /home/administrator/targetup-app/packages/backend/.env && pm2 reload targetup-backend
```
확인(값 자체는 찍지 않는다):
```bash
grep -c '^AI_AUTO_BUILD_COMPANY_IDS=' /home/administrator/targetup-app/packages/backend/.env; pm2 status targetup-backend
```

### 14-4. 실측 1건(§9 · 도달 불가 값 · 디버깅테스트 회사)
화면: AI Operator → [AI 자동제작](NEW) → 행사 카드 1장(제목 + 60자 텍스트 + "그대로 씁니다" 체크 + 이미지 3장 = 가로형 배너 1 · 상품 사진 1 · 로고 1) + [연동몰에서 불러오기] 상품 2개 + 칩 "AI가 알아서" → [AI 자동제작] → 확인 모달(금액 = 서버 견적 5) → 편집기 착지.
판정:
1. 편집기 첫 화면(hero)에 로고가 오지 않는다(썸네일 배지 "로고 추정" 확인 · 결과 바 미반영 목록에 사유).
2. 상품 카드 가격 = 몰 값 자릿수까지(카드 2개 · 링크 버튼).
3. 같은 초안 화면에서 [다시 만들기] 는 새 토큰이라 새 차감 · 브라우저 [뒤로] 뒤 같은 재료로 [AI 자동제작] 재클릭도 새 토큰. 멱등 실측은 원장에서: 
▶ 실행 위치: .62 · administrator
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT idempotency_key, source, amount, created_at FROM ai_credit_transactions WHERE company_id='a0990249-3550-4baa-92ca-32e45b185e83' AND idempotency_key LIKE 'quick:%' ORDER BY created_at DESC LIMIT 5;"
```
키 형식 `quick:{회사}:dm:{uuid}` · 한 번 누름당 1행.
4. 행사 카드에 두 줄(20자)만 적고 이미지 0 → sticky 바에 "행사 내용 40자 이상 또는 첫 화면 사진 1장" 안내 + 버튼 비활성(400 은 서버 · 화면은 견적 응답 gate 로 먼저 막는다).
5. 채널 [이메일] → 광고 체크 → [AI 자동제작] → 이메일 편집기 착지(`/email-campaigns?edit=`) · 목록에 draft 행 1개(`ai_generated=true` · `is_ad=true`) · 완성 저장 시 50 별도 차감:
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT id, status, is_ad, ai_generated, (sections IS NOT NULL) AS has_sections, created_at FROM email_campaigns WHERE company_id='a0990249-3550-4baa-92ca-32e45b185e83' ORDER BY created_at DESC LIMIT 3;"
```
하나라도 어긋나면 ENV 에서 회사를 빼고(`AI_AUTO_BUILD_COMPANY_IDS=` 빈 값 · pm2 reload) 보고한다.

**T4 응답 계약(프론트 T5 가 읽는 것)**: 생성 = `data.{channel, draft_id, campaign_id(email), attempt_token, deduct_outcome, quote, sections, pages, layout_mode, brand_kit, look, benefitStripped, heroFallback, subjects[], preheader, name, materials(=materialsMeta: imageRoles·features·mallUnverified·excluded·imagesDropped·reads·materialsHash)}` · 오류 = `{ success:false, error, code, ...extra }`(400 `MATERIALS_INVALID`{field} · 400 `MATERIAL_THIN`{missing} · 400 `SMTP_REQUIRED` · 403 `FEATURE_DISABLED` · 409 `QUOTE_CHANGED`{quote} · 409 `IN_FLIGHT` · 402 `INSUFFICIENT_CREDIT` · 503 `CREDIT_LOOKUP_UNAVAILABLE` · 503 `DB_MIGRATION_PENDING`). 견적 = `POST /api/event-campaigns/materials/quote` 본문 `{ materials }`(attemptToken = 화면이 가진 값 · expectedTotal 0) → `{ total, parts, credit_enabled, gate{ok,missing}, image_roles, text_chars, images, images_dropped, materials_hash, plan_locked, smtp_configured, max_cards, max_card_images, max_products, min_text_chars }`. 옛 GET 견적·v0 materials 분기는 그대로.

**T3 순서(코드)**: 개방(403) → 정규화(400 `MATERIALS_INVALID`) → 이미지 실물(없는 장 제외 `imagesDropped` · 치수 빈 값만 실측) → 최소 재료 게이트(400 `MATERIAL_THIN` + missing) → 이메일면 SMTP(400 `SMTP_REQUIRED`) → 몰 재조회(상품번호 · 장애 = `mallFailed` · 생성 계속) → 견적 결박(409 `QUOTE_CHANGED` + quote) → `checkCredit`(402) → 판독(텍스트 0 + 이미지 · 같은 조합 10분 재사용) → 조립(DM `assembleDmCampaign` / 이메일 `produceOutreachBrandEmail`) → 초안 행(DM `createDm` draft · 이메일 렌더 → `createEmailCampaign` draft + `is_ad`·`ai_generated`·`sections`) → 차감(`deductCreditOutcome` · 키 `quick:{company}:{channel}:{attemptToken}` · duplicate 무료 · failed = 행 유지 + `[CREDIT][MISS]` 키·토큰·초안 id). 차감 호출 자체가 던지면 행 회수(고아 0).

**T3 에서 설계와 다르게 한 것(근거)**:
1. 수동 상품에 `validateProductsAgainstEventText`(원문 대조)를 걸지 않았다. 대조는 판독본(AI 추출)의 환각을 거르는 장치인데 수동 상품은 사용자가 직접 친 값이라 면허다(불변 1). 수동·상품번호 없는 몰·이미지 없는 몰 상품은 글줄로 재료와 `licensedQuote` 에 합류한다.
2. `produceOutreachBrandEmail` 에 `isAd` 파라미터를 추가하지 않았다(프롬프트·조립에 소비처가 없어 죽은 인자가 된다). `is_ad` 는 행 저장으로 충족하고 표기 부착은 발송 단계 그대로(회의론자 최종 8의 뒷부분).
3. 이메일 칩 후처리는 이메일 생성 함수 안(채우기 뒤·차단 앞)에 같은 `applyDmFeatures` 를 EMAIL 채널로 붙였다. 이메일 허용 타입에 countdown 이 없어 ON 카운트다운은 사유("이메일에는 카운트다운을 넣을 수 없어요")만 남긴다 → T5 는 이메일 선택 시 카운트다운 칩을 숨긴다.
4. 카운트다운 재료 = 면허 카드 본문의 연도 있는 날짜(`parseLicensedEndDate` · jobs.ts 기존 파서 · 연도 없는 표기는 잡지 않는다) → `eventCards[].endDate`.

**미검증(T0 ③ 재인증 뒤 실측)**: 카페24 `GET /products?product_no=1,2,3` 콤마 목록 파라미터. 실패·무응답·다른 상품 반환 어느 경우도 "가격 확인 못함"(피커 값 유지)으로 접히고 생성은 계속된다(테스트 "몰 장애"). 네이버는 상품번호 조회 API 가 없어 재조회 없이 피커 값 + `mallUnverified`.

**알려진 한계(현행과 동일 · T5 이후 판단)**: 몰 상품 이미지는 몰 외부 URL 그대로 카드에 실린다(`attachMallImagesToProductCarousels` 와 같은 관행 · 사본 복사 0) · 카드 링크가 하나도 없으면 CTA URL 이 빈 값이 될 수 있다(v0 동일 · T5 폼에서 링크 입력 유도).

**T2 규칙(코드로 확인한 채우기 사실에 맞춘 것 · §6-2 보강)**: 고객 입구 `fillOutreachDmMediaV3`가 상품 2개 이상 → 캐러셀, 카드 잔여 이미지 → 갤러리, 미래 종료일 → 카운트다운을 이미 데이터로 만든다. 후처리는 OFF 제거 · ON 은 있으면 유지 · 없으면 **쿠폰만** 삽입(`discount_label` = 면허 문구의 혜택 첫 구절 원문 · 마지막 CTA 앞 · 상한 13) · 나머지 ON 은 `skipped[{type, reason}]`(고객 언어 사유). 허용 4종 밖 타입은 무시.

**설계서 정정(코드 실측)**:
1. §6-1 예시 이미지 1200x1600(비율 0.75)은 현행 `heroEligible` 하한 0.8 미만이라 히어로 후보가 아니다 → 배지 "사진". 하한은 아웃리치 공용이라 이번 트랙 무변경.
2. §4-2 "쿠폰 칩 = 발행 때 120" 은 사실과 다르다. `coupon` 은 인터랙션 타입이 아니다(`dm-interaction.ts INTERACTION_SECTION_TYPES`). T5 에서 그 고지를 넣지 않는다.
3. 고객 카드는 `endDate` 가 항상 null(`materialsFromEventCards`) → 카운트다운 칩 재료는 T3 에서 카드 본문 날짜를 결정적으로 뽑아야 생긴다(파서 유무 T3 grep).
4. 이메일 경로(`produceOutreachBrandEmail`)는 `assembleDmCampaign` 을 타지 않아 T2 후처리가 닿지 않는다 → T3 에서 같은 자리(채우기 뒤·차단 앞)에 `applyDmFeatures` 를 붙이거나 이메일 칩 범위를 정한다.

**범위 밖 기록(착수 판단 = Harold)**: `cafe24-client.ts:238 getCafe24Integration` 이 status 를 안 걸러 `token_expired` 회사도 `/api/mall-products/providers` 에 카페24 탭이 뜬다(LESSONS_BACKEND "연동 상태 = active + 검증 신호" 위반). 이번 트랙은 T3 호출부에서 `status='active'` 판정으로 막는다.
