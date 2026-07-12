# 인앱메시지 일괄 강화 설계서 (2026-07-12 전수 점검 → 다음 세션 구현 SoT)

> **작성 배경**: 2026-07-12(4) 인앱 전수 점검(0711 여정·0712 자동마케팅·모바일DM·이메일과 동일 틀) 완료 후 Harold 지시로 작성.
> 점검 범위 = 백엔드 CT 10종 + routes/cdp.ts 인앱 endpoint 28개 + SDK inapp.ts(1,623)/inapp-blocks/inapp-theme + InAppMessagesPage(2,943)/BlockPreview/blockTheme 전수 정독.
> **이 문서가 구현의 SoT** — 다음 세션은 이 문서 기준으로 착수한다. 점검 상세 기록 = memory/project_2026_0712_inapp_audit.md.
>
> **구현 전 의무**: CLAUDE.md 6원칙 + LESSONS_BACKEND·LESSONS_FRONTEND 정독 + 항목별 영향표(본 문서 기재분 재확인 grep). 신규 DDL = **0건**(전 항목 기존 컬럼/jsonb 안에서 해결).

---

## §0 점검 결과 요약 (판정 포함 — 재논의 불요)

**견고 확인(무접촉)**: 표시 가능성 게이트(네이버 단독 차단)·게시 15크레딧 멱등(inapp-publish:messageId, POST/PUT 공유)·혜택 placeholder 3중 차단·개인화 브라우저 화이트리스트(phone 제외)·세그먼트 매처(파라미터화·0건 무완화)·A/B sticky(백엔드 단일 진실)·표시 자격 V2(시간창·세그먼트·audience_filter·once_per_day·max_displays)·서버 사전 치환(0708)·블록 컴포저/테마 6/형태 4/실고객 샘플/카운트다운 실계산.

**법 판정**: 인앱은 방문자에게 페이지 안에서 표시되는 것이라 정보통신망법 §50(전자적 전송매체 광고 전송) 규제 대상이 아님 — 야간 제한·(광고) 표기·수신거부 의무 없음. (광고) 표기는 자율 표기로 유지. → 야간은 차단이 아니라 **경고**가 정답(P1-2).

**크레딧 정합**: 통과. 이메일 같은 표시≠차감 구멍 없음. AI 생성 3·게시 15 멱등·quick-action은 ai_refine만 3(시간대·세그먼트 액션은 AI 호출 0 = 무과금 정상).

---

## §1 구현 항목 — P0 (기능 결함·보안)

### P0-1. 트리거 임계값 완전 검증 + 편집기 임계값 입력칸 (핵심 — 트리거 정밀 표시가 현재 무동작)

- **현상**: `trigger_conditions`의 `scroll_percent`·`time_on_page_seconds`·`cart_value_min` 임계값을 아무도 완전 검증하지 않는다.
  - 서버 `getActiveMessagesForCustomerV2`(utils/inapp-message.ts:600~)는 이벤트 명칭+시간창만 매칭 — `evaluateTrigger`(utils/inapp-trigger-engine.ts:63, 임계 로직 실존)를 호출하지 않음.
  - SDK `passesTriggerConditions`(sdk-js/src/inapp.ts:271)는 `cart_value`만 검사.
  - 편집기 트리거 탭(InAppMessagesPage.tsx:2044~2078)에 임계값 입력칸 자체가 없음 — "스크롤 도달"을 골라도 % 지정 불가, `trigger_conditions`는 `{event}`만 저장(2055).
- **설계 (정답 1개 — 검증 위치 = SDK)**: 실측값(스크롤%·체류초·장바구니액)은 브라우저만 알므로 SDK가 검증한다. 서버 무변경.
  1. SDK `setupAutoTriggers`(inapp.ts:368~)에서 트리거 발화 시 컨텍스트 동봉: `this.trigger('scroll', { scrollPercent })` / `this.trigger('time_on_page', { timeOnPageSeconds: seconds })`. `InAppInitInput`에 `scrollPercent?: number`·`timeOnPageSeconds?: number` 추가(옵션 — 하위호환).
     - 주의: `trigger()`는 `{...lastInput, ...input}` 병합이라 scrollPercent가 lastInput에 잔류 — 발화별 값이므로 **lastInput에 저장하지 말 것**(병합 전에 분리: `const { scrollPercent, timeOnPageSeconds, ...persist } = input` 후 lastInput에는 persist만).
  2. `passesTriggerConditions` 확장: `scroll` = `input.scrollPercent >= (conds.scroll_percent ?? 50)` / `time_on_page` = `input.timeOnPageSeconds >= (conds.time_on_page_seconds ?? 10)` / cart_value 기존 유지. 값 미전달(자사몰 직접 trigger 호출) = 통과(기존 동작 보존 — 오차단 0).
  3. 편집기: 트리거 select 밑에 조건부 입력칸 — scroll → "도달 %(10~100)" / time_on_page → "체류 초(5~600)" / cart_value → "금액(원)". `updateField('trigger_conditions', {event, scroll_percent: n})` 형태로 저장. 기존 저장분(임계 없음)은 SDK 기본값(50%/10초)으로 동작 — 회귀 0.
  4. scroll 리스너 개선: 현재 10% 증가마다 발화 — 임계 비교가 생기므로 그대로 두되, 발화 시점의 실제 scrollPercent를 전달만 하면 됨.
- **영향표**: SDK inapp.ts(setupAutoTriggers·trigger·passesTriggerConditions·InAppInitInput) / InAppMessagesPage 트리거 탭 / 서버·DB 무변경. evaluateTrigger 소비처(findMatchingMessages·listInAppTriggerCandidates)는 기존 그대로(trackEvent fire-and-forget 경로) — 무접촉.
- **검증**: SDK vitest에 passesTriggerConditions 고정 테스트 신규(임계 미달 skip·충족 표시·미전달 통과 3케이스). 실측 = 스크롤 70% 조건 메시지가 10% 시점 미표시→70% 표시.

### P0-2. SDK 버튼 action_url 스킴 화이트리스트 (보안 — javascript: 실행 차단)

- **현상**: `window.location.href = actionUrl` 4곳(inapp.ts 854 renderFloatingButton·901 blocks onButtonClick·1165 renderBlockFloating·1363 appendButtons)이 스킴 무검증. `javascript:` URL이면 자사몰 방문자 브라우저에서 실행(회사 admin 계정 탈취 시 몰 전 방문자 대상 XSS). 서버 저장(createInAppMessage input.actionUrl·buttons)도 무검증. 이메일은 normalizeWebUrl+https 검사로 이미 막음 — 비대칭.
- **설계**: 2중.
  1. SDK: 공용 `safeNavigate(url)` 1개 신설 — `http:`/`https:`/상대경로(`/`)만 이동, 그 외(`javascript:`·`data:`·`vbscript:` 등) 무시. 4곳 교체. 판정은 `new URL(url, location.href)` 파싱 후 protocol 검사(파서 정규화 신뢰 — LESSONS 0710 hlj.kr 교훈).
  2. 서버: `createInAppMessage`/`updateInAppMessage`/`createVariant`/`sanitizeContentBlocks`(cta_group buttons)에서 action_url 저장 시 동일 판정 — 위험 스킴이면 null로 치환(저장 차단이 아니라 무해화 — 발행 우선). 신규 헬퍼는 utils/inapp-message.ts에 정의(인라인 금지 룰).
- **영향표**: SDK 4곳 + inapp-message.ts 저장 3경로 + variant-optimizer 1곳. 기존 정상 URL(https/http/상대) 동작 무변화.
- **검증**: SDK vitest(javascript: 무시·https 통과·상대경로 통과)·backend vitest(저장 시 무해화). **SDK 수정이므로 번들 재빌드 + company-frontend/public/sdk v0.3.8·v0.3.9 제자리 갱신(md5 확인) 의무** — 기존 설치 몰 캐시 만료 후 자동 반영.

### P0-3. track 라우트 message 소유 검증

- **현상**: `POST /inapp/track`(cdp.ts:645)이 message_id의 회사 소유를 확인하지 않고 `trackImpression` INSERT — 타사/임의 uuid로 자기 회사 impressions에 유령 행 적재 가능(통계 조회는 양쪽 매칭이라 타사 오염은 없음 — 자기 데이터 오염 방어).
- **설계**: `trackImpression`(utils/inapp-message.ts:380) 초입에 `SELECT 1 FROM cdp_inapp_messages WHERE id=$1 AND company_id=$2` — 불일치 시 throw('메시지를 찾을 수 없습니다') → 라우트 400. CT 단일 길목이라 소비처 전부(라우트 1곳) 커버.
- **검증**: 임의 uuid POST → 400 + INSERT 0.

### P0-4. 같은 메시지 중복 렌더 가드 (SDK)

- **현상**: `renderMessage`(inapp.ts:468)에 동일 메시지 DOM 존재 검사 없음 — `display_frequency='always'` 메시지가 scroll(10%마다)·time_on_page(10/30/60s 3회) 자동 트리거로 같은 페이지에 중복 스택.
- **설계**: renderMessage 초입 `if (document.querySelector('[data-hanjullo-msg="' + msg.id + '"]')) return;` 1줄. (닫으면 DOM이 사라지므로 재표시 가능 — always 의미 보존.)
- **검증**: SDK vitest 또는 실측(체류 60초 페이지에서 1회만 표시).

---

## §1-2 구현 항목 — P1 (정합·방어 정비)

### P1-1. updateInAppMessage 부분 PUT NULL 리셋 함정 봉합

- **현상**: `updateInAppMessage`(inapp-message.ts:236~)의 5개 필드가 COALESCE 없이 무조건 대입 — `image_url=$16`·`auto_dismiss_seconds=$21`·`max_displays_per_user=$22`·`send_start_hour=$23`·`send_end_hour=$24`. 필드를 뺀 부분 PUT이면 전부 NULL로 리셋. 현 프론트(handleSave)는 전체 payload를 보내 무증상이나, API 직행·미래 부분 patch에서 사고 지점(자동마케팅 C-2 예산 NULL 함정과 동일 구조).
- **설계**: 자동마케팅 C-2 선례 = **현재값 선조회 병합** — UPDATE 전 기존 행 SELECT, `input.X === undefined ? 기존값 : input.X`로 5필드 결정(null은 "비우기" 의도로 존중 — 프론트 비우기 기능 보존). COALESCE 단순 적용은 비우기가 막혀 오답.
- **검증**: vitest 순수 병합 함수 분리(undefined=유지/null=클리어/값=교체 3케이스) + 부분 PUT 실측 1건.

### P1-2. 새벽 시간대 경고 (차단 아님 — 법 판정 §0)

- **설계**: 편집기 시간대 입력(InAppMessagesPage.tsx:2086~2109) 밑에 조건부 amber 경고 — `send_start_hour < 8 || send_end_hour < 8 || send_end_hour >= 23` 판정 시 "새벽 시간대 노출 설정입니다. 인앱은 방문자에게만 표시돼 법적 제한은 없지만, 새벽 방문 고객 경험을 고려해주세요." 저장은 허용(서버 무변경).

### P1-3. getCompanyInAppStats 파라미터 버그 (죽은 endpoint 수리)

- **현상**: SQL에 `$2::varchar`(channel)가 있는데 params가 `[companyId]`뿐(inapp-message.ts:447~462) — 호출 시 항상 PG bind 오류 500. 소비처 = GET /inapp/stats(cdp.ts:1095) 1곳, 프론트 호출 0건(grep 실측) = 죽은+고장 endpoint.
- **설계**: params를 `[companyId, channel || null]`로 수정(1줄). 라우트 제거 대신 수리(통계 API로 유효 — 추후 소비 가능).
- **검증**: curl 1건(channel 유/무 200).

### P1-4. A/B variant 블록·테마·형태 미상속

- **현상**: `createVariant`(inapp-variant-optimizer.ts:97~)가 `content_blocks`·`theme`·`accent_color`·`card_style`·`badge_text`·`channel`을 INSERT하지 않음(파일 내 channel 언급 0 실측) — 블록 부모의 variant가 레거시 단색 렌더로 표시돼 A/B 비교가 "디자인 세대 차이" 테스트로 오염. quickActionAIRefine(3안 자동 생성)도 동일 경로라 같은 문제.
- **설계**: createVariant INSERT에 부모 상속 6컬럼 추가(content_blocks는 부모 블록에서 headline/body 텍스트만 variant 문안으로 교체한 사본 — `replaceBlockTexts(parentBlocks, title, body)` 순수 헬퍼 신설: headline 첫 블록 text=title·body 첫 블록 text=body, 나머지 구조 유지). input으로 명시 전달 시 그 값 우선.
- **영향표**: createVariant 소비처 2곳(라우트 /inapp/variant·quickActionAIRefine) — 시그니처 하위호환(추가 컬럼은 부모 자동 상속).
- **검증**: vitest(블록 부모 variant 생성 → content_blocks 존재+텍스트 교체 확인) + 실측 1건(A/B 표시가 같은 디자인).

### P1-5. 소액 정정 묶음

1. **레거시 렌더 (광고) 표기**: `renderLegacy`(inapp.ts:509)는 isAd 처리 0 — 블록 경로만 (광고) 자동. 레거시도 isAd면 본문 하단 잔글씨 "(광고)" 라인 append(블록 경로와 동일 문구).
2. **AI 생성기 프롬프트 거짓 서술 정정**: inapp-ai-generator.ts:564 "is_ad: true 시 = SDK가 자동으로 '(광고)' 표기 + 무료거부 080 자동 합성" — 080 합성은 미구현·계획 없음(인앱은 수신거부 개념 없음). "(광고) 표기 자동"만 남기고 080 문구 삭제.
3. **once_per_day 서버 검증의 track 의존**: 수용 판정(클라 localStorage 1차 방어 + 서버 2차. track 실패는 드묾·표시 채널이라 중복 노출 피해 경미) — 코드 무변경, 본 문서 기록으로 종결.

---

## §1-3 구현 항목 — P2 (편집기 "최고의 편집툴" 업그레이드)

### P2-1. 블록 드래그앤드롭 + 복제 (체감 최대)

- **현상**: BlockComposer(InAppMessagesPage.tsx:2559~)가 위/아래 화살표 이동만, 복제 없음.
- **설계**: EmailVisualEditor의 @dnd-kit SortableBlockRow 패턴 이식(의존성 기존재·DM SectionList 선례) — 드래그 핸들(GripVertical)+`arrayMove`, 복제 버튼(Copy 아이콘, `JSON.parse(JSON.stringify(b))` 깊은 복사 후 다음 위치 삽입). 블록 배열은 order 필드가 없는 순수 배열이라 splice 재배열로 충분.
- **주의**: 훅은 조기 return 위(LESSONS 0706 백지 사고) — SortableBlockRow를 별도 컴포넌트로 분리해 훅 규칙 준수.

### P2-2. 상품 블록 가격 구조화

- **현상**: product 블록 = name+meta 문자열뿐(BlockEditor:2807~) — 가격·할인 구조 없음(이메일 product_carousel은 정가·할인가·취소선 구조화).
- **설계**: 블록에 `price?: number`·`discount_price?: number` 추가. BlockEditor에 숫자 입력 2칸(비우면 기존 meta 문자열 그대로 = 하위호환). SDK inapp-blocks renderBlock(product) + BlockPreview(product)에 가격 행 렌더 — `discount_price` 있으면 accent 800 할인가 + 취소선 정가(이메일 렌더러와 동일 문법). meta는 가격 미입력 시에만 표시.
- **영향표**: sanitizeContentBlocks는 type 화이트리스트만이라 신규 필드 통과(무변경). SDK+BlockPreview+BlockEditor 3면 동시(편집=발행 미러 — LESSONS 0709).

### P2-3. 트리거 임계값 입력칸 — P0-1에 포함(중복 방지, 별도 항목 아님)

### P2-4. 보류 판정 (구현하지 않음 — 근거 기록)

- **폰트 px 직접 지정**: 인앱 카드는 폭 340~420px로 좁아 sm/md/lg 토큰이 안전 상한 역할 — px 개방 시 깨진 레이아웃 셀프서비스 위험 > 이득. 보류.
- **블록 표시 토글(숨김)**: hidden 필드를 SDK·미리보기·sanitize 3면에 배선해야 해 비용 대비 사용 빈도 낮음. 보류.
- **Undo/Redo·미리보기 기기 프레임·WYSIWYG 직접 편집**: 대공사 지향점 — 별도 세션 후보로만 기록.

---

## §2 구현 순서 (권장)

1. P0-2(SDK 스킴)+P0-4(중복 가드) — SDK 파일 한 번에 (번들 재빌드 1회)
2. P0-1 — SDK 트리거 컨텍스트+편집기 입력칸 (같은 SDK 빌드에 합류 가능)
3. P0-3·P1-3·P1-5 — 백엔드 소액 묶음
4. P1-1 — 선조회 병합(순수 함수 TDD)
5. P1-4 — variant 상속(순수 헬퍼 TDD)
6. P1-2 — 편집기 경고 1곳
7. P2-1·P2-2 — 편집기 업그레이드
8. Codex 적대 리뷰(--model gpt-5.5 --effort xhigh 명시 — 전역 config 우회 2단, memory 기록) → 정정 → 종결

## §3 검증 체크리스트 (종결 조건)

- [ ] backend tsc 0 + vitest 전체(신규 고정 테스트: 트리거 임계 3·스킴 화이트리스트·병합 3케이스·variant 상속)
- [ ] SDK tsc 0 + vitest 전체 + **번들 재빌드 → company-frontend/public/sdk v0.3.8·v0.3.9 제자리 갱신 + md5 동일 경로 확인**(설치 몰 재설치 불필요 관행)
- [ ] frontend tsc 0
- [ ] 금지 패턴 grep 0 (모델명·native dialog·박-단어) — 수정 파일 전체
- [ ] DDL 0 확인(신규 컬럼·테이블 없음 — 전부 jsonb 필드·코드)
- [ ] 실측(배포 후, 직원/Harold): ①스크롤 70% 조건 메시지 임계 동작 ②javascript: URL 저장→무해화 ③블록 부모 A/B variant 동일 디자인 ④드래그 순서 변경·복제 ⑤상품 블록 가격 표시

## §4 다음 세션 진입 명령어

```
인앱메시지 일괄 강화 구현 시작하자. 설계도 = docs/superpowers/specs/2026-07-12-inapp-full-reinforcement-design.md 가 SoT다.
P0-1~P0-4(트리거 임계값 검증+편집기 입력칸·SDK URL 스킴 화이트리스트·track 소유 검증·중복 렌더 가드),
P1-1~P1-5(부분 PUT 선조회 병합·새벽 경고·stats 파라미터·variant 블록 상속·소액 정정),
P2-1~P2-2(블록 드래그앤드롭+복제·상품 가격 구조화)를 설계도 순서대로 한번에 끝까지 구현하고,
SDK 번들 재빌드+제자리 갱신·검증 체크리스트(§3)·Codex 적대 리뷰까지 완료 후 배포 명령 줘.
```
