# AI 자동제작 (기능 상설 문서 · 2026-09-14 신설)

> **호출어 = "AI 자동제작"**. 이 문서가 이 기능의 **정체성·불변 원칙·구조·요금·운영 실측·이력**을 소유한다. STATUS는 카드 3줄로 참조만 한다.
> 시점 설계 근거·회의 수렴·착수 원장·구현 기록 원문 = [0914 설계서](2026-09-14-ai-auto-build-design.md)(§2 불변 원본 · §3 수렴 · §5 요금 · §6 서버 계약 · §10 회의론자 · §13 구현 기록 · §14 배포 원장). 이 문서는 그 결과를 상설로 정리한 것이고, 두 문서가 다르면 **현재 코드가 진실**이다.
> 관련 상설 = [FEATURE-SALES-OUTREACH.md](FEATURE-SALES-OUTREACH.md)(캠페인 엔진 소유) · [FEATURE-CDP-INTEGRATION.md](FEATURE-CDP-INTEGRATION.md)(몰 연동 · 상품 재조회 출처) · [FEATURE-IMAGE-STUDIO.md](FEATURE-IMAGE-STUDIO.md)(소재 라이브러리).

---

## §0 30초 요약

- **무엇**: 재료 4칸(행사 카드[내용+이미지 ≤3장×3] · 몰 상품 ≤12 · 기능 칩 4종 · 채널 DM/이메일) → 버튼 1개 → 완성본이 편집기에 열린다. 옛 `/quick-campaign`(원클릭 캠페인)의 **승격**이며 신규 조립 엔진·크레딧 키·DDL은 0이다.
- **어디**: AI Operator 허브 타일 "AI 자동제작"(NEW) · 모바일 DM 목록 상단 카드띠 · 이메일 캠페인 상단 카드띠 · 두 편집기의 "재료" 링크 1줄.
- **누가 보나**: `AI_AUTO_BUILD_COMPANY_IDS`에 있는 회사만(비면 전 회사 미노출 · 옛 화면 그대로). 2026-09-14 기준 디버깅테스트 1회사.
- **상태**: 2026-09-14 T1~T8 배포완료. **§5 실측 5건은 미실행**(Harold가 뒤로 미룸). Codex 적대검토 2R 종결(3R은 Harold 판단).

---

## §1 정체성

마케팅 담당자가 **재료만 넣으면** 모바일 DM·이메일 완성본이 나온다. 질문·재입력·역할 지정·중간 선택이 없다. AI 영업(아웃리치)의 캠페인 엔진을 고객 입구에서 그대로 쓰되, 고객이 준 재료가 **면허**이고 서버가 재료의 자격(이미지 역할·몰 가격·최소 분량)을 판정한다. 돈은 시도 단위(attemptToken + 과금 지문)로 원장이 지킨다.

---

## §2 불변 원칙 (어길 수 없는 것 · 설계서 §2 14개 + T7 정정)

1. **재료는 사용자가 준 것만 면허다.** `licensedQuote` = 사용자 원문만. 판독본(이미지 글자 읽기)·몰 텍스트·프리필은 재료로만 쓰고 혜택 수치의 근거가 되지 않는다.
2. **가격·링크·할인율은 AI 프롬프트를 지나지 않는다.** 코드가 상품 캐러셀에 직접 싣는다.
3. **몰 값은 믿지 않고 상품번호로 다시 읽는다.** 못 찾으면 피커 값 + "가격 확인 못함", 품절이면 제외 + 사유, 몰 장애는 생성을 막지 않는다. 카드에 `source`(mall/manual)·`verified`.
4. **상품 병합 키 = 상품번호.** 이름 매칭으로 병합·자동 첨부하지 않는다. 우커머스는 몰별 provider(`woocommerce:{mall}`)라 같은 번호라도 몰이 다르면 다른 상품(★0914(2)).
5. **상품 이미지 = 몰 이미지만.** 수동 상품은 글줄 재료로만.
6. **이미지 역할 지정 UI를 만들지 않는다.** 순서가 기본 역할, 서버가 자격(히어로 비율 ≥0.8 · 로고 추정 ≥3:1)을 판정해 배지로만 알린다. 사용자 수단 = 드래그 정렬·[제외].
7. **기능 칩은 엔진이 만들 수 있는 것만 보인다.** 고른 값은 결정적 후처리(`applyDmFeatures`)가 지킨다. `features: null` = no-op(아웃리치 회귀 0). 이메일은 카운트다운 칩이 없다.
8. **신규 크레딧 키 0 · 대행 델타 0.** 생성 = 채널 키(DM 5 · 이메일 3) · 판독 3(텍스트 0이고 이미지 있을 때 1회) · 발행은 기존 발행가. 화면 금액 = 서버 견적 한 곳.
9. **돈 단위 = 시도 토큰 + 과금 지문.** 멱등키 `quick:{company}:{channel}:{attemptToken}:{billingHash16}`. 과금 지문(`buildBillingHash`) = 정규화 입력 전체(이미지 URL·면허·칩·상품·채널·광고 포함 · 토큰·견적 합계 제외). 견적 결박용 지문(`buildMaterialsHash` · 이미지 uuid 불변)과 **분리**한다. 재시도 = duplicate 무료, 재료가 하나라도 다르면 새 차감. 세션 카운터·사본 0.
10. **판독비는 초안이 생긴 뒤 정산한다.** 판독은 `runInCreditBundle` 안(AI 자체 차감 off) → 초안 성공 뒤 `quick-read:{company}:{첫 판독 토큰}:{이미지 지문16}`으로 차감. 조립 실패 = 판독비 0. 캐시(10분)는 정산 상태를 들고, 미정산 캐시는 견적에 판독 부품을 그대로 남긴다(표시 = 차감).
11. **모든 판정은 차감 앞.** 개방 → 정규화 → 이미지 실물 → 최소 재료(40자 또는 히어로 1장) → SMTP(이메일) → 몰 재조회 → 견적 결박(409) → `checkCredit`(402) → 판독 → 조립 → 초안 행 → 차감. 차감 호출이 던지면 행 회수(고아 0).
12. **DDL 0.**
13. **1클릭.** 버튼 1 → 확인 모달 1(금액) → 완성본 → 편집기. 필수 입력 = 행사 카드 1장에 내용 또는 이미지.
14. **노출 스위치는 새로 둔다.** `AI_AUTO_BUILD_COMPANY_IDS` 비면 미노출 · 카드띠 노출 + materials v1 분기 3곳(DM 생성·이메일 생성·견적)에 AND. 기존 `CAMPAIGN_MATERIALS_COMPANY_IDS`(비면 전 회사 노출)와 반대 의미라 공유하지 않는다.
15. **모델명 0 · native dialog 0 · 내부 코드명 0(화면 문구).** 진행 문구는 서버 phase만.

---

## §3 구조 (파일별 소유 · 2026-09-14 실물)

| 층 | 파일 | 몫 |
|---|---|---|
| 순수 코어(백) | `utils/ai-auto-build-materials.ts` | 재료 계약 v1 정규화 · 이미지 역할 판정 · 최소 재료 게이트 · 견적 지문/과금 지문/멱등키 · `AiAutoBuildError`·응답 매핑 · 상품 병합(`resolveBuildProducts`) · `isBuildMallProvider`(cafe24·naver·`woocommerce:{mall}`) · `aiAutoBuildEnabled` |
| 오케스트레이터(백) | `utils/campaign-quick.ts` | `generateFromBuildMaterials`(BuildDeps 주입 · `defaultBuildDeps`) · `quoteBuildMaterials`·`quoteFromBuildMaterials` · `prepareBuildMaterials` · 판독 캐시(settled/readKey) · 몰 재조회 `lookupMallProductsByNo`(카페24 상품번호 · 우커머스 Store API include) |
| 엔진 접점(백) | `utils/campaign-engine.ts` · `utils/sales-outreach-produce.ts` · `utils/event-brief.ts` | `EngineOptions.features` · `applyDmFeatures`(DM/EMAIL · OFF 제거 · ON 유지 또는 쿠폰만 삽입 · `firstBenefitPhrase`) |
| 라우트(백) | `routes/dm.ts` · `routes/email.ts` · `routes/event-campaigns.ts` | materials v1 분기(v0 앞) · ENV 403 · 회사 in-flight 409(`utils/inflight-lock.ts`) · 오류 매핑 · `POST /materials/quote` v1 · GET 견적 `auto_build_enabled` |
| 몰 접점(백) | `utils/cafe24-client.ts fetchCafe24ProductsByNoRaw` · `utils/mall-product-normalize.ts`(카페24·우커머스 가용성·정규화) | 상품번호 재조회 · 품절/미전시 사유 |
| 화면(프) | `pages/QuickCampaignPage.tsx`(승격) · `pages/QuickCampaignLegacyPage.tsx`(v0 · ENV 미개방 회사) · `components/ai-build/{BuildCardsInput,FeatureChips,ProductPickList,BuildResultBar,AiBuildEntryStrip}.tsx` · `utils/ai-build.ts`(화면 CT) · `constants/credit.ts AI_GENERATE_COSTS` | 1열 폼 → 서버 견적 sticky 바 → `CreditConfirmModal` → 편집기 착지(`sessionStorage` 결과 전달 · 이메일 `?edit=`) · 카드띠·링크 1줄·"직접 제작" 개명 |
| 테스트 | `__tests__/ai-auto-build-{materials,quick,routes}.test.ts` · `inflight-lock.test.ts` · `campaign-engine.test.ts`·`event-brief.test.ts` 추가분 | 계약 고정(RED→GREEN · Codex 1R 수용분은 구현과 같은 배치에 쓰였음을 §6에 기록) |

---

## §4 요금 · ENV · 응답 계약

- 요금 = 설계서 §5 표 그대로(신규 키 0). 크레딧제 미적용 회사 = 0 표시. 재생성 = 매회 생성비(새 토큰). 더블클릭·응답 유실 재시도 = 무료(같은 토큰·같은 지문).
- ENV = `AI_AUTO_BUILD_COMPANY_IDS`(회사 UUID 콤마 목록). 반영 = `pm2 restart targetup-backend --update-env`(reload는 env를 다시 안 읽는다).
- 응답·오류 코드 계약 = 설계서 §13 "T4 응답 계약"(400 `MATERIALS_INVALID`·`MATERIAL_THIN`·`SMTP_REQUIRED` · 403 `FEATURE_DISABLED` · 409 `QUOTE_CHANGED`·`IN_FLIGHT` · 402 · 503 `CREDIT_LOOKUP_UNAVAILABLE`·`DB_MIGRATION_PENDING`).

---

## §5 운영 · 실측 (배포 뒤 · 미실행)

배포 = 2026-09-14(frontend dist "AI 자동제작" 1 · restart 687) · ENV = 디버깅테스트(`a0990249-3550-4baa-92ca-32e45b185e83`) · 카페24 `hanjulai` 재인증 active.
**실측 5건(설계서 §14-4 · 전부 미실행 · Harold 뒤로 미룸)**: ①로고가 첫 화면에 오지 않음(배지 "로고 추정") ②상품 카드 가격 = 몰 값 · 링크 버튼 ③[다시 만들기]·뒤로가기 재클릭 = 새 토큰 = 원장 새 행(`ai_credit_transactions` `quick:%`) ④20자 + 이미지 0 = 안내 + 버튼 비활성 ⑤이메일 광고 체크 → `?edit=` 착지 · `email_campaigns` draft(`ai_generated`·`is_ad`). 하나라도 어긋나면 ENV 비우고 reload.
**T0 ③(카페24 `product_no` 콤마 목록 조회)은 실측 ②가 겸한다.**

---

## §6 이력 · 뒤집힌 판단

- **2026-09-14 설계**: 브레인스토밍 5역할 2라운드 + 회의론자 최종 8건 → 설계서. 승격(신설 아님) · 신규 키 0 · DDL 0 · 돈 단위 attemptToken(회의론자 1·2) · 판독 분리 표기.
- **2026-09-14 구현(T0~T7)**: 설계서 §13. 설계와 다르게 한 것 = 신규 컴포넌트 4→5(`BuildCardsInput` 후계) · ENV 미개방 회사는 옛 화면(v0)을 그대로(회귀 창 차단) · 옛 3채널 세트는 보조 줄 · 수동 상품에 원문 대조 미적용(면허) · 이메일 `isAd` 인자 미추가(죽은 인자) · 카운트다운 재료 = 면허 카드의 연도 있는 날짜.
- **Codex 적대검토 2R(돈 경로)로 뒤집힌 것 4**: 멱등키에 과금 지문 합류(토큰만이면 결제 토큰으로 재료를 바꿔 무료 통과) · 판독비는 초안 뒤 정산 · 캐시 정산 상태 · 정산 캐시만 견적에서 판독 제외. 1R 수용분 테스트는 구현과 같은 배치에 쓰여 RED를 못 봤다(정직 기록) · 2R 수용분은 RED 8 → GREEN.
- **설계서 정정(코드 실측)**: 1200×1600은 히어로 후보 아님(0.8 하한) · 쿠폰은 인터랙션 타입이 아니라 "발행 120" 고지 없음 · 고객 카드 `endDate`는 항상 null이라 본문 날짜 파서로 · 이메일 경로는 엔진을 안 타서 같은 자리에 후처리 별도 부착.
- **2026-09-14(2) 우커머스 접점 합류**: 상품 provider `woocommerce:{mall}`을 몰 상품으로 인정 · Store API 재조회(품절 = 제외 + 사유). 상세 = [우커머스 설계서 §5 W5](2026-09-14-woocommerce-integration-design.md).

---

## §7 남은 것 · 범위 밖(착수 판단 = Harold)

- **§5 실측 5건**(다음 세션 첫 일 후보) → 통과 뒤 ENV 확대 여부.
- Codex 3R(2R 지적은 내 테스트로만 닫음 · 라운드 상한).
- 범위 밖 기록: `cafe24-client.ts getCafe24Integration`이 status를 안 걸러 `token_expired` 회사에도 카페24 탭이 뜬다(호출부 `status='active'` 판정으로 막았음) · `DmSendAndTrackModal` "(3크레딧)" 토스트 표기 · 입구 8개 정리 2차 · 몰 상품 이미지 외부 URL 그대로(사본 복사 0) · 카드 링크 0이면 CTA URL 빈 값 가능(v0 동일).
- 요금 인상·대행 델타 = 계측(생성→발행률) 뒤 Harold 결정.

---

## §8 시점 근거

| 문서 | 무엇 |
|---|---|
| [2026-09-14-ai-auto-build-design.md](2026-09-14-ai-auto-build-design.md) | 요구 원문 · 출발점 실측 · 회의 수렴 · 화면 규격 · 요금 · 서버 계약 · 회의론자 8건 · 미검증 · 구현 기록(T0~T7 · Codex 2R) · T8 배포·ENV·실측 원장 |
| [2026-09-14-session-handoff.md](2026-09-14-session-handoff.md) | 0914 두 세션의 순서·명령·다음 착수 |
| [2026-09-06-campaign-engine-design.md](2026-09-06-campaign-engine-design.md) §7·§8 · [2026-08-13-one-step-content-interview-design.md](2026-08-13-one-step-content-interview-design.md) §0·§6·§9 | 엔진 고객 입구 · 요금 규약의 뿌리 |
