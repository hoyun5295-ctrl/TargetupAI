# AI 영업 아웃리치 — 기능 상설 SoT

> **호출어: "영업 아웃리치"** — Harold님이 AI 영업을 언급하면 이 문서를 먼저 연다.
> 이 문서는 **AI 영업의 현재 모습과 이력 색인**을 소유한다. 시점별 설계 근거·경위는 설계서가 소유하고 여기엔 링크만 둔다(doc_ownership).
> 상태·잔여는 STATUS §2 카드가 소유한다. 여기엔 **구조와 원칙**만 남긴다.

| 시점 설계서 | 소유하는 것 |
|---|---|
| [2026-07-31 설계서 §1~§14](2026-07-31-ai-sales-outreach-design.md) | 0731 1차 구상 원문(리스트 일괄 + 승인 큐 + 대상 업체 직접 발송). **현행이 아니다** — §15와 어긋나면 §15가 이긴다 |
| [같은 문서 §15 (2026-08-24 v2)](2026-07-31-ai-sales-outreach-design.md) | **현행 설계 전량** — 범위 §15-1 · Harold 조정 3건 §15-2 · 흐름 §15-3 · 화면 §15-4 · 메일·공개 페이지 §15-5 · 백엔드 §15-6 · 테이블 §15-7 · 착수 전 실측 §15-8 · **Codex 검증 이력·잔여 부채 §15-9-1** · 대량 업로드 §15-9-2 · Harold 확정 현황 §15-10 |
| [같은 문서 §16 (2026-08-26 v3)](2026-07-31-ai-sales-outreach-design.md) | **스마트스토어 재료 축(설계 승인 · ★착수 보류 = 게이트 G4 실패)** — 실측 전제 §16-1 · ⛔ 원칙 10 §16-2 · 흐름 §16-3 · DDL 1 §16-4 · 백엔드 계약(H1~H15 반영) §16-5 · 화면 §16-6 · 엑셀 §16-7 · 계약 테스트 9 §16-8 · 착수 전 실측 게이트 G1~G5 §16-9 · **게이트 실측 결과·축 재개 조건 §16-9-1** · 순서 §16-10 · Harold 결재(약관) §16-11 · 뒤집힌 판단 9 §16-12 |

---

## 1) AI 영업이란 — 제품 정의

영업 대상 업체의 **홈페이지 주소만 넣으면**, 그 업체가 지금 하고 있는 행사를 읽어 그 브랜드에 맞춘 산출물(문안 · 포스터 이미지 · 모바일 DM · 제안 메일)을 자동으로 만들고, 완성본을 **자사 수신함으로 1통** 보낸다. Harold가 그 메일을 확인하고 업체에 전달한다.

"우리 서비스 좋습니다"가 아니라 **"귀사 브랜드로 이미 만들어 봤습니다"**를 들고 가는 구조다. 제품이 곧 데모이므로, 받는 쪽이 메일을 여는 순간 한줄로의 실물 산출물을 본다.

사용자는 Harold 1인(슈퍼관리자 ceo 전용)이다. 고객사에 노출되는 기능이 아니다.

---

## 2) 불변 원칙 (어길 수 없는 것)

1. **⛔ 발송 경로는 사람 클릭 하나뿐이다.** 워커·스케줄러·sweeper 어디서도 발송 함수를 부를 수 없다(승인 컨텍스트 필수 인자). 자동 재시도·자동 재생성도 0 — 재시도는 화면 버튼만.
2. **⛔ 발송은 DB 선점 뒤에만 한다.** SMTP 호출 전에 `mail_result='sending'` CAS로 선점하고, 선점된 요청만 발송한다. 프로세스 내 잠금은 다중 프로세스를 못 막는다. **발송 후 기록 UPDATE가 0행이면 성공으로 답하지 않는다.**
3. **⛔ 발송 잠금 5종은 순수 함수 `computeSendLock` 하나가 소유한다**(★0905 개정). 발신 계정 미설정 · 수신거부 문구 공백 · 조립본 부재 · placeholder 잔존(서버 숫자 `placeholderCount` · 제목 포함) · 문구 미반영. 발송 함수(효과)와 조회 응답(`sendLock`)이 같은 함수를 부르고, 화면은 잠금 사유와 바로가기를 보여준다. 수신거부 문구는 정보통신망법 판단(설계서 §10)이 미확정인 동안 그 축을 잠그는 값이다.
4. **⛔ 행사는 AI가 서술하지 않는다. 인용하고 서버가 재대조한다.** 모델은 `{인용문·출처·기간}` 구조체만 돌려주고, 서버가 그 인용문이 크롤 원문에 문자열로 실재하는지 확인한다. 실패·부정 표현·종료 표현이 섞이면 그 행사를 통째로 폐기하고 "행사 미확인" 일반형으로 간다.
5. **⛔ 혜택 수치는 면허가 있을 때만 남는다.** `stripUnauthorizedBenefits`의 `originalBody`에는 **재대조 통과 + 종료일이 실재하고 미래인** 인용만 넘긴다. 나머지는 전부 `[직접 작성해주세요]` 자리가 되고, 그게 남아 있으면 발송이 잠긴다(원칙 3).
6. **⛔ 게이트는 fail-closed다.** 닫히는 축은 **미로그인·미등록 계정·조회 실패**다 — 판정 함수가 예외를 삼키고 false를 낸다(`audit-log.ts:52~61`). `SALES_OUTREACH_ALLOWED_USERS`는 **미설정이면 기본값 `ceo`가 적용된다**(전부 차단이 아니다 · 2026-08-26 코드 실측 정정). **super_admin이라는 이유로 통과하는 분기를 만들지 않는다**(`plan-guard.isAiOperatorAllowed`가 그 형태라 재사용 금지). 판정은 라우트가 아니라 효과를 만드는 함수 안에 둔다.
7. **⛔ 크롤·이미지 fetch는 가드 경로만 쓴다.** `fetchHtmlGuarded` 계열(홉마다 DNS 재검증 + 검증 IP 연결 고정)만 탄다. 같은 파일의 `extractBrandFromUrl`은 무가드라 이 축에서 쓰지 않는다([B-0824-2](../status/BUGS.md)).
8. **⛔ 산출물 INSERT는 소유권과 결속한다.** `insertAssetOwned`(INSERT … SELECT WHERE EXISTS(stage·lock_token))만 쓴다. 검증과 INSERT를 나누면 소유권을 잃은 느린 워커가 나중에 자산을 남겨 **검토된 최신본을 덮는다**(`latestAsset`은 created_at 최신을 읽는다).
9. **⛔ 소유권은 `lock_token`(uuid) CAS다.** 타임스탬프를 fencing 토큰으로 쓰지 않는다(마이크로초·밀리초 왕복 불일치). `lock_at`은 heartbeat·좀비 판정 전용.
10. **⛔ 단계 결과는 3값이다**(`ok` / `no_event` / `unavailable`). 의존 장애(AI·크롤 실패)를 내용 판정("행사 없음")으로 접지 않는다. 화면에도 "확인 실패"와 "행사 없음"을 다르게 쓴다. ★0905 확대: 제작 4단계도 같다. 제작 실패 = `stage_results[failStage]='unavailable'` + `stage='failed'`이고 이 스탬프는 `markFailed` 한 함수만 쓴다(sweeper 포함). 재료 부재로 산출물을 줄인 것(이미지 skip·섹션 prune·문장 제거)은 `ok` + payload 감산 기록.
11. **⛔ 타사 이미지는 인물 없이, 사본으로, 고지와 함께 쓴다**(★0905 개정 A-10b). 포스터 합성은 사람이 고른 1장만(인물 판정 `person`이면 제외 + 사유 표시). 갤러리·상품 이미지는 홈페이지 원본을 **서버가 직접 받아 폭을 실측**(갤러리 ≥600 · 상품 ≥400 · 미만 탈락 · 목록 썸네일은 상세 og:image로 격상)하고 통과분을 **우리 저장소 사본**으로 저장해 산출물이 그 URL을 쓴다(핫링크 0 · 파기 시 함께 삭제). 메일 푸터의 "귀사 이미지를 활용한 예시" 고지는 유지. **로고 픽셀은 어떤 경우에도 금지**(상표) — 브랜드명은 텍스트로.
12. **⛔ 메일은 전달용 완성본 한 벌이다.** 내부 정보(근거 발췌·원가·내부 링크)는 화면이 단독으로 소유한다. "이 아래는 지우고 보내세요" 형태의 블록을 만들지 않는다 — 사람이 지워야 안전한 설계는 사고가 난다([B-0821-5](../status/BUGS.md)가 그 부류).
13. **⛔ 조립 함수에 내부 URL을 넘기지 않는다.** 손에 없으면 샐 수 없다. 조립 결과에서 내부 경로·토큰 패턴이 검출되면 throw한다(계약 테스트 고정).
14. **⛔ 공개 샘플 페이지에는 산출물만 있다.** 원가·근거·내부 식별자·개발 용어 0. noindex + 만료(발송 성공 시각 기산) + 파기(`purged_at`) — 만료·파기 건은 404와 같은 안내를 준다.
15. **⛔ DM 발행은 CT 직접 호출이라 미차감이다.** 라우트를 타면 30크레딧이 차감된다. 내부 발행 함수는 `companyId`가 `OUTREACH_COMPANY_ID`와 같은지 스스로 확인하고 아니면 던진다.
16. **미리보기와 발송본은 같은 조립 함수를 쓴다.** 두 벌이 되는 순간 "화면에서 본 것과 다른 메일"이 나간다.
17. **자사 수신은 안전장치가 아니다.** Harold가 포워딩하면 최종 수신자는 외부다 — 법·저작권·품질 축은 하나도 면제되지 않는다.
18. **⛔ 같은 URL을 두 번 긁지 않는다.** HTML을 한 번 받아 행사 텍스트·이미지 후보·상품 링크·딥링크·법정 표기를 함께 뽑는다. ★0905 개정: **같은 호스트의 다른 URL 1홉**(행사 상세 링크 1개 · 제작 단계의 상품 상세 ≤10)은 별 소스로 허용하되 실패를 격리하고(홈 결과에 영향 0 · `crawling_sub` 3값 별도 기록) 다른 호스트로 리다이렉트되면 버린다. "하나 실패하면 나머지까지 버림"([B-0826-1](../status/BUGS.md))은 여전히 금지.
19. **⛔ 구조화는 우선순위 신호이지 필터가 아니다.** 행사로 보이는 조각을 앞에 싣되 전체 텍스트를 뒤에 그대로 붙인다. 구조화 0건이면 결과가 옛 방식과 **문자 단위로 같아야** 한다(무후퇴 · 계약 테스트로 고정). ★0905: 온전히 실린 블록은 본문에서 첫 1회 제거한다(중복 제거 · 0건 무후퇴 유지).
20. **⛔ 아웃리치 전용 로직은 아웃리치 파일에 둔다.** `fetchEventTextFromUrl`·`fetchProductOgImages`는 DM·이메일·인앱과 공용이다. 바꿔야 하면 **호출부에서** 바꾼다.
21. **⛔ 실패 사유는 DB에 남긴다**(★0905 신설). catch가 원문을 console에만 두고 고정 문구를 넣는 형태 금지. `fail_detail`(제작 실패 · `markFailed`) · `stage_results.crawling_detail / analyzing_detail`(수집·분석은 unavailable 전진) · `stage_results.mail_last`(발송)에 정제본(≤300자). 화면(ceo 전용)에만 보이고 메일·공개 페이지에는 싣지 않는다.
22. **⛔ 자동 발행 DM·이메일 시안의 카피도 혜택 기계 차단을 거친다**(★0905 신설 · `sanitizeDmCopyBenefits`). 면허(재대조 통과 + 미래 종료일) 인용 밖의 혜택 수치는 긴 prop은 문장째, 짧은 prop은 prop째 제거한다(대상 prop = `DM_EDITABLE_TEXT_KEYS` 단일 표). placeholder를 공개 산출물에 남기지 않는다. 프롬프트 재료도 면허 밖 자리를 지운 뒤 넣는다(모델이 애초에 보지 않게).
23. **⛔ 아웃리치 DM은 noindex이고 파기 시 중지된다**(★0905 신설). noindex는 공개 뷰어 라우트가 요청 시각에 회사 id로 판정한다(저장값 아님 · 기존 발행분 소급). 재생성·재크롤로 DM이 다시 발행되면 **새 메일이 조립된 뒤** 옛 DM을 중지하고, 파기(30일)는 `stopDm`으로 전 DM을 내린다(중지된 DM = 404).
24. **⛔ 수신처를 인자로 받는 발송은 검수 테스트 하나뿐이고, 허용 도메인 안에서만 받는다**(★0905 신설 B-15 · Harold 접수). `OUTREACH_TEST_MAIL_DOMAINS`(기본 `invitocorp.com`) 밖 주소는 VALIDATION으로 거절(mailer 안에서도 이중 방어). 제목 앞 `[검수] ` · 본문은 발송본과 같은 조립 결과(원칙 16) · `stage`·`mail_result` 무변경(검수는 발송이 아니다) · 잠금 5종 중 발신 계정·조립본 부재만 적용. 제안 발송의 수신처는 계속 ENV 고정이다.
25. **샘플 학습 층은 예시(few-shot)이지 문장 창고가 아니다**(★0905 신설 · 0905(2) DB 원천 추가). 직원 실물의 **마스킹본**(브랜드 별칭·상품명(본문 포함)·혜택 수치·링크·연락처·날짜·고객명 = 〔〕)을 채널·업종군별로 골라 프롬프트에 싣고, 규칙이 5어절 이상 차용·조건 결합·재료 초과를 금지한다. 원천 = **DB(`best_copy_assets` kind=`outreach_example` · 베스트 구성 페이지에서 단축코드로 올린다 · 5분 캐시) 앞 + 코드 seed 19건 뒤(폴백 · 같은 본문 1번)**. 마스킹·위생 검사는 `sales-outreach-exemplar-mask`(순수) 하나가 소유하고 저장 직전 서버가 다시 검사한다(잔존 = 저장 거부). kind를 `style_example`과 나눈 이유 = 그 kind는 직원 갤러리에 노출되고 재증류가 DELETE한다. 재료(상품·이미지·딥링크·법정 표기)는 코드가 채운다.
26. **⛔ 룩(구도·배경면·아트디렉션)은 코드가 섹션 최상위에 입힌다**(★0905(3) 신설 · 수렴안 C1). 값은 `TREATMENTS`·`EMAIL_TREATMENTS`를 import해 그 안에서만 고르고(classic 미명시 · props 무변경), 배경면은 두 채널이 함께 허용하는 `soft`·`tint`뿐이다. AI에게 구도를 시키지 않는다(허용표 밖 값은 fail-closed로 조용히 사라진다). DM `brand_kit`은 항상 만들되 키는 `primary_color`(접근성 통과 시)·`art_direction` 둘뿐 — **logo_url은 어떤 경우에도 없다**(불변 11). 검증은 JSON 키 수가 아니라 **렌더 HTML 지표**(`data-treatment=` · `dm-bgx-` 사용 · 이메일 밴드)로 한다. **아웃리치 DM은 scroll 한 페이지로 발행한다**(`OUTREACH_DM_LAYOUT_MODE`) — slides는 뷰어가 갤러리를 한 장씩 펼치며 구도·링크를 버리고, 검토 화면의 스크립트 0 iframe에서는 첫 장만 보인다.
27. **⛔ 사람 편집(재료 재선택·블록 숨김)은 override 데이터로 저장하고 같은 조립 경로가 재적용한다**(★0905(3) 신설 · 수렴안 C4). `brand_profile.mediaSelection`(실측 통과 사본 URL 화이트리스트) · `stage_results.section_overrides[kind].hidden`(`type#n` 키 · 줄이는 방향만 · header·footer 금지 · 3개 이상 잔존). 재생성 뒤에도 같은 순번에 다시 적용되고, 재수집(이미지 재생성)·재분석은 선택·숨김을 지운다. 품질 경고(`quality.warnings`)는 잠금 5종과 다른 축이라 **발송을 막지 않는다**(불변 3).

---

## 3) 현재 구조 — 파일별 소유

| 파일 | 소유하는 것 |
|---|---|
| `packages/backend/src/utils/sales-outreach-jobs.ts` | **잡 상태머신 전량** — 등록(중복 409 · 추가 정보) · 크롤(홈 + 행사 상세 1홉 · 재료 순수 추출) · 인용 재대조(원문별 · 계측) · 확정(사람 게이트 · 경고) · 제작 루프(재생성 순서) · 발송(잠금 5종 `computeSendLock` · 선점 CAS · `mail_last`) · **검수 테스트 발송** · 수신 확인 · 전달 표시 · 문안·제목 편집 · 재조립(제목·서두 보존) · 재생성 · 재크롤 · 숨기기 · 뱃지 · 공개 페이지 조회 · 일괄 등록(chain) · 목록(검색·그룹·커서). 되돌리기 = `resetJobTo` 하나 · 실패 종결 = `markFailed` 하나 |
| `packages/backend/src/utils/sales-outreach-produce.ts` | 산출물 제작 작업 함수 — 가드 이미지 fetch · 인물 판정(vision) · **업종 15종 템플릿 풀**(`pickTemplate`) · **재료 실측·사본**(`collectOutreachMedia`) · 누끼·합성 · **DM 섹션 few-shot 생성 + 재료 채우기 + 혜택 차단**(`produceOutreachDm`) · **브랜드 이메일 시안**(`produceOutreachBrandEmail`) · 제안 메일 = 순수 조립(`buildProposalEmailSections` · 한글 리터럴 0) + 제목·서두 AI(`generateSubjectIntro` · 40자 규칙) + 진입점(`assembleProposalEmail` · html·평문·placeholder 합산) |
| `packages/backend/src/utils/sales-outreach-exemplars.ts` · `sales-outreach-exemplar-seed.ts` | ★0905 **샘플 학습 층(순수)** — 채널·업종군별 선택(`pickOutreachExemplars`) · DB 행 → 원천 변환·병합(`exemplarSourceFromRows`·`mergeExemplarSources`) · 생성 규칙·섹션 계약 문자열 · 폴백 seed(DM 10 · 이메일 9 마스킹본 · 위생은 계약 테스트) |
| `packages/backend/src/utils/sales-outreach-exemplar-mask.ts` | ★0905(2) **실물 → 마스킹 예시 변환 CT(순수 · DB 0)** — 별칭 자동 추출(제목·상호·header brand_name·법정 표기 법인명·회사명 · 직원 표기 제외) · 상품명 본문 치환(일반어 유지) · 링크·이메일·연락처·고객명·혜택·날짜 표식 · 예시 본문 조립 · 위생 검사 |
| `packages/backend/src/utils/sales-outreach-examples.ts` | ★0905(2) **실물 예시 학습 DB 층** — 단축코드 정규화·해석(내부 전용 회사 · dm_pages.short_code + 수신자 토큰 코드) · 같은 회사 이메일 후보 + 브랜드명 제안 매칭 · 승격(게이트·위생·중복 재검사 → `best_copy_assets` append) · 생성 원천 로드(DB+seed 병합) |
| `packages/backend/src/utils/best-copy-assets.ts`(추가) | kind=`outreach_example` 읽기(5분 캐시 · `invalidateOutreachExampleCache`)·append·삭제·출처 중복 조회. 테이블 단일 소유 CT |
| `packages/backend/src/routes/admin.ts` `/best-layout/examples*` · `packages/frontend/src/pages/BestLayoutPage.tsx` | ★0905(2) 베스트 구성 페이지(ceo 전용) "실물 예시 · AI 영업 학습" 패널 — 목록·마스킹본 보기·삭제(두 번 클릭) · [실물 예시 올리기] 모달(코드 붙여넣기 → 찾기 → DM·이메일 후보 체크 + 업종 → 올리기) · 감사 로그 2종 |
| `packages/backend/src/utils/sales-outreach-look.ts` | ★0905(3) **룩 배정 CT**(순수) — 구도·배경면·아트디렉션을 재료 형태로 결정해 섹션 최상위에 입힌다(허용표 import · classic 미명시) · brand_kit 빌더(키 화이트리스트 · logo_url 0) · 렌더 HTML 지표 카운터 |
| `packages/backend/src/utils/sales-outreach-review.ts` | ★0905(3) **검수 축 CT**(순수) — 재료 재선택 검증·적용(화이트리스트·순서·무효 선택 무시) · 블록 숨김 override(`type#n` · 보호 골격 · 최소 잔존 · 재적용·missed) · 품질 경고(세면 보이는 결함 · 잠금 아님 · 임계값 미검증) |
| `packages/backend/src/utils/sales-outreach-media.ts` | ★0905 **재료 수집 CT** — 순수 층(상품 카드·이미지 후보·상품 링크·딥링크·법정 표기·theme-color·이미지 헤더 실측·상세 페이지 파싱) + 가드 fetch 층(상품 상세 1홉 · 이미지 실측·사본 저장은 호출부가 저장 함수를 주입) · **크롤 상한 `OUTREACH_FETCH_OPTS`(800KB·10초 · 공용 기본 200KB/5초는 그대로 · jobs·media의 모든 `fetchHtmlGuarded` 호출이 싣는다 = 불변식)** · 이미지 후보 = 작은 속성·menu/nav/gnb 경로 제외 · 상한 24 |
| `packages/backend/src/utils/sales-outreach-style.ts` | 스타일 가이드 **단일 상수**(`getActiveStyleGuide()`가 유일 진입점) — v1-exemplar(예시 층 on) · 문안 규칙 · **제안 메일 문구 층 `emailCopy`**(조립 함수는 여기만 읽는다 · 업체명 뒤 조사 금지) |
| `packages/backend/src/utils/sales-outreach-extract.ts` | **행사 텍스트 추출기**(2026-08-26 신설) — 행사성 class 카드 · 혜택 키워드 링크 · 중복 제거 · 예산 배분. **아웃리치 전용**(공용 `fetchEventTextFromUrl`은 DM과 공유라 손대지 않는다) |
| `packages/backend/src/utils/sales-outreach-bulk.ts` | 엑셀 양식 생성(ExcelJS · 예시·업종 드롭다운 포함) + 업로드 파싱(SheetJS · 행별 거절 사유) |
| `packages/backend/src/utils/sales-outreach-sweeper.ts` | 좀비 잡 종결(markFailed) · **대기 초과 2시간 종결** · 끊긴 발송 선점 복구(unknown) · 만료 파기(포스터·사본 삭제 + **DM 중지** · 회사 컨텍스트 없으면 회차 건너뜀). **발송·재시도·재생성 능력 0** |
| `packages/backend/src/utils/outreach-mailer.ts` | 영업 전용 계정 발신(타임아웃 3종 + 총 30초 + close) · 수신자 정확 일치 판정(`matchAddress`·`decideMailOutcome`) · 결과 3값 · **검수 테스트 발신**(허용 도메인 `isAllowedTestRecipient`) |
| `packages/backend/src/routes/sales-outreach.ts` | ceo 전용 API 20개(등록·양식·일괄·목록·최근·뱃지·조회·확정·재시도·재크롤·재생성·발송·**검수 발송**·수신 확인·전달·문안·제목·재조립·숨기기). 오류는 분류 후 안전 문구만 · 성공 분기 감사 로그 `sales_outreach.*` |
| `packages/backend/src/routes/outreach-public.ts` · `app.ts` | 공개 샘플 페이지(무인증 · noindex · 만료 판정) · 경로 리미터 IP당 분 60 |
| `packages/backend/src/routes/dm.ts`(2줄) | 공개 뷰어 2곳에서 아웃리치 회사 DM이면 `X-Robots-Tag: noindex`(요청 시각 판정 · 소급) |
| `packages/frontend/src/components/admin/SalesOutreachModal.tsx` | 모달 1창 — 4단계 흐름(추가 정보 · 중복 409 · 다시 읽기 · 재료 전문 · 제목 편집 · 폭 토글 · 산출물별 다시 만들기 · 메일 재조립 · 발송 잠금 사유 · **검수 메일 보내기** · 실패 상세·숨기기 · 근거 패널 계측) + 진행 목록(검색·상태 칩·더 보기) + 대량 업로드 |
| `packages/backend/src/utils/audit-log.ts` | `isSalesOutreachOperator`(fail-closed 게이트 · 다른 축과 별도 ENV) · `recordAuditLog`(라벨 = 프론트 `audit-action-labels.ts`) |
| `packages/backend/src/utils/__tests__/sales-outreach-*.test.ts` · `outreach-mailer*.test.ts` · `dm-brand-extractor-lookup.test.ts` | 불변식 13건 + 행동 테스트(재료 CT · 예시 seed 위생 · 제작 순수 함수 · 잡 순수 함수 · 발신 판정 · 추출기 중복 제거 · Node 20 lookup 계약) |

**재사용한 기존 자산(새로 만들지 않았다)**: 가드 크롤(`dm-brand-extractor`) · AI 호출(`services/ai.ts`) · 누끼·합성(`image-studio` + rembg) · DM 생성·발행(`dm-ai`·`dm-builder`) · 이메일 렌더러(`email/email-section-renderer` 12블록) · 혜택 차단(`copy-benefit-detector`) · 업종 SSOT(`industry-codes`) · 엑셀 응답 헤더(`xlsx-writer`).

---

## 4) 운영에 필요한 설정

| ENV | 뜻 | 없으면 |
|---|---|---|
| `SALES_OUTREACH_ALLOWED_USERS` | 사용 허용 슈퍼관리자 login_id(기본 `ceo`) | **기본값 `ceo`가 적용**(전부 차단 아님 · 불변 6 참조) |
| `OUTREACH_COMPANY_ID` / `OUTREACH_USER_ID` | 내부 산출물 귀속 회사·사용자(주식회사 인비토 / mobile) | 기능 전체가 "준비 안 됨"으로 정직 거절 |
| `OUTREACH_SMTP_USER` / `OUTREACH_SMTP_PASS` | 영업 전용 발신 계정(hanjul@invitocorp.com) | 발송만 잠김(제작은 정상) |
| `OUTREACH_MAIL_TO` | 수신함 **목록**(쉼표 구분 · ★0903 · 예 `suran@invitocorp.com,ceo@invitocorp.com`) — 미설정 = `INVITO_INFO.email` 1명. 형식 불량 제거·중복 제거는 `parseOutreachMailTo` | 기본값 1명 |
| `OUTREACH_UNSUB_NOTICE` | 메일 하단 수신거부 안내 문구 | 발송 잠김(원칙 3) |
| `OUTREACH_TEST_MAIL_DOMAINS` | ★0905 검수 테스트 메일 허용 도메인(쉼표 · 예 `invitocorp.com,hanjul.ai`) | 기본 `invitocorp.com` |

테이블 2개(`sales_outreach_jobs` 21컬럼 · `sales_outreach_assets` 6컬럼) — 컬럼·jsonb 키 사전 = [SCHEMA.md 75-A·75-B](../status/SCHEMA.md). 0828 CREATE는 완료. ★0905 `fail_detail` ALTER는 **코드 배포보다 먼저** 실행한다(nullable 로그성 · 신코드는 42703 폴백을 두지 않는다). **실행 절차·검증 SQL·원문 = [OPS.md §2-2-E ⑦](../status/OPS.md)**(그 절이 배포 인계의 유일 소유자다). 전 ENV 예시 = 루트 `.env.example` "AI 영업 아웃리치" 절.

---

## 5) 이력 색인

★**2026-08-28 DDL 2테이블 실행완료**(`sales_outreach_jobs` 20컬럼 · `sales_outreach_assets` 6컬럼). 코드는 0824부터 서버에 있었고 테이블만 없어 sweeper가 10분마다 3건씩 `relation does not exist`를 쌓고 있었다(로그 소음 정리 축에서 함께 처리). **기능 개통은 여전히 ENV 대기** — `OUTREACH_COMPANY_ID`·`OUTREACH_USER_ID`가 없으면 화면은 「준비되지 않았습니다」로 정직하게 거절한다.

| 시점 | 무엇 | 근거 |
|---|---|---|
| 2026-07-31 | 1차 구상·설계서 작성(리스트 일괄 + 승인 큐 + 직접 발송). 샘플 세트 대기로 중단 | 설계서 §1~§14 |
| 2026-08-24 | **v2 수렴** — 5역할 브레인스토밍(1차 의견 → 교차 토론 1R → 회의론자 최종 검증 H1~H19). 진입 형태·발신 경로·메일 구조·이미지 흐름·혜택 처리·범위 6쟁점 판정 | 설계서 §15-1~§15-8 |
| 2026-08-24 | Harold 조정 3건 — 타사 이미지 허용(+고지 문구·보강 3종) · 이미지 자동 선정 · 발신 계정 `hanjul@invitocorp.com` 신설 | 설계서 §15-2 |
| 2026-08-24 | 코드 전량 구현 + Codex 적대 검증 3라운드(high 6건 전량 수용 정정) · 커밋 `4ca769e7` | 설계서 §15-9-1 |
| 2026-08-24 | 엑셀 대량 업로드 + 진행 목록(진행률·산출물 링크·메일 미리보기) · 커밋 `c5c0862e` | 설계서 §15-9-2 |
| **2026-08-26** | **v3 스마트스토어 재료 축 설계 수렴·Harold 승인(다음 세션 구현).** 4역할 브레인스토밍(1차 → 교차 토론 1R → 회의론자 최종 검증 H1~H15) · 실측 2건(스토어 서버 차단 재확인·공식몰 크롤 유효) · **네이버 쇼핑 API는 기존 CT 재사용**(신규 의존성 0) · 행사=공식몰/제품 재료=스토어 역할 분리 · slug 완전 일치 대조 · 착수 전 게이트 G1~G5 · [B-0826-1](../status/BUGS.md) 등재 | 설계서 §16 |
| **2026-08-26** | **v3 착수 게이트 실측 → G4 실패로 축 보류.** 운영 키로 `search/shop.json` = HTTP 404 `SE05` · 같은 키 `search/blog.json` = HTTP 200(키·인증은 유효). G1~G3은 응답을 못 받아 실행 불가, G5는 개발자센터 fetch 차단으로 미실행(Harold 결재 항목). §16-1-3 전제 정정 = "CT가 있다"는 참이지만 "호출이 된다"는 거짓. 재개 조건 2개 등재 · [B-0826-2](../status/BUGS.md) 등재 | 설계서 §16-9-1 |
| **2026-09-05** | **샘플 학습 층·재료 실측·검수 테스트 발송·운영 조작 전량 구현(코드 완료 · 배포 대기 · 선행 = `fail_detail` ALTER).** 출발 = Harold "샘플을 학습해서 제대로 만들 수 있냐가 핵심" → 폐기 전제 프로토타입(`scratch/proto` · 직원 실물 19건 마스킹 few-shot + 재료·후처리 · 3업체 2회전 심사)으로 가능성을 먼저 증명 → 운영 이식. 같은 날 발견 [B-0905-1](../status/BUGS.md)(Node 20 lookup 배열 계약 · 전 사이트 크롤 null) 정정. 불변 3·10·11·18·19 개정 + 21~25 신설 · 파일 신설 3(exemplars·seed·media) · 엔드포인트 +8 · 테스트 8파일 · ENV +1 · DDL 1(nullable) | [0905 설계서](2026-09-05-ai-sales-outreach-refinement-design.md) · [OPS ⑦](../status/OPS.md) |
| **2026-09-05(3)** | **핫픽스 [B-0905-2](../status/BUGS.md) — 운영 첫 DM 빈 껍데기(코드 완료·배포 대기).** 공용 크롤 200KB 절단 위에서 큰 홈페이지(이니스프리 376KB)의 상품이 0이었다 → `FetchHtmlOptions` 선택 인자 + 아웃리치 전용 상한 800KB/10초 · 카운트다운은 종료일 있을 때만 · 이미지 후보에서 메뉴 아이콘 제외. 재현 = 상품 링크 0→6 | 설계서 §21 |
| **2026-09-05(3)** | **퀄리티 대폭 상향 — 브레인스토밍(5역할 · 11에이전트) 수렴안 전량 구현(코드 완료·배포 대기 · DDL 0).** 룩을 코드가 섹션 최상위에 입힌다(C1 · 렌더 HTML 지표로 검증) · 갤러리 링크·CTA 재바인딩·비율 군(C2) · 후보 24 완결 + 갤러리 예산(C3) · 검토 화면 안 DM iframe · 재료 재선택 · 블록 숨김 override · 품질 경고(C4). 네이버 = 커머스 축 폐기 · 쇼핑 검색은 새 키 게이트(코드 0) 대기. 불변 26·27 신설 · 파일 신설 2 · 엔드포인트 +2 · 테스트 +2파일 | [0905 설계서 §22](2026-09-05-ai-sales-outreach-refinement-design.md) |
| **2026-08-26** | **v3 축 전환 — 공식몰 행사 추출 정교화(코드 완료·배포 대기).** 스마트스토어는 봇 UA·크롬 UA·Puppeteer 실렌더 3회 전부 429로 **출구 IP 차단 확정**(우회 판단 상황 자체가 소멸). 팝폰 실측으로 파싱 3단계 패턴을 미러(코드 이식 0) → `sales-outreach-extract.ts` 신설 · `extractEventTextFromHtml` 분리 · **크롤 소스 2개→1개**로 [B-0826-1] 뿌리 종결. 계약 테스트 10건 + 회귀 주입 검증 | 설계서 §17 |

**뒤집힌 판단**: 0731의 "타사 사진 원본 삽입 금지"(§7)는 0824 Harold 확정으로 **대체**됐다 — 고지 문구 + 인물 제외 + 만료·파기를 조건으로 허용한다. 로고 픽셀 금지만 남는다. / 0731의 "다크 화면 의무"(§4)는 폐기 — 부모(슈퍼관리자)가 라이트라 자식 창도 라이트다(미리보기 구역만 다크 액자).

**축 밖 부채**: [B-0824-2](../status/BUGS.md)(무가드 브랜드 추출) · [B-0824-3](../status/BUGS.md)(이미지 스튜디오 사설 IP 필터) · **[B-0826-2](../status/BUGS.md)(네이버 쇼핑 검색 404 — DM 편집기 후보 상시 0건 · v3 재개의 선결)** · 설계서 §15-9-1 medium 2건(fetch deadline에 DNS 미포함 · 모달 폴링 미직렬화).
