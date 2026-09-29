# 인앱 메시지 제작 개편 설계서 (2026-09-29)

> 호출어 **인앱 만들기 개편**. 이 문서가 개편의 SoT다(데이터 계약 · 단계 · 결정). 앱 통합 계약의 단일 소스는 여전히
> `packages/frontend/src/components/inapp/AppIntegrationContract.tsx`이고, 여기는 무엇을 왜 바꿨는지를 소유한다.
> 상위 문서 = [인앱메세지전용.md](인앱메세지전용.md)(§10-B 앱 계약 · §10-C 캐러셀).

## 0. 배경 · 결정

- **Harold 요구(0929)**: 편집을 매우 쉽게 · 스타벅스처럼 크고 좌우 슬라이드 · 웹 메시지 다양하게 · 앱 메시지도 제대로 ·
  템플릿 고르고 이미지 넣고 글자 편집 · 제작 모달 자체를 편리하게. "지금 슬라이드되는 게 없다" = 전제로 받는다.
- **확인한 사실**: 슬라이드(0721 포스터 캐러셀)는 포스터형 안에만 있고 그 형태의 안내가 「전면 이미지 1장」 · 첫 장과 둘째 장 이후를
  다른 자리에서 편집 · 글 칸과 사진 칸이 나뉜 모양(벤치마크 2장)에는 슬라이드가 없다.
- **브레인스토밍(COLLAB §1 · 5역할 + 교차 토론 + 회의론자 최종 검증 조건부 승인)** 수렴안 = 아래. Harold 0929 「추천안대로 바로 진행 ·
  3차까지 끝내라」.
- **운영 사용 실측(Harold SQL 0929)**: 루트 22건 · 한 회사 · 게시 중 = 포스터형 3건(앱 2 · 웹 1) · 옛 슬라이드 잔존 0 · 블록 = 보관 7건.

## 1. 데이터 계약 (DDL 0 · 새 template 값 0)

### 1-1. 레이아웃 = `design.poster_layout` (template 은 `full_image` 그대로)

| 값 | 모양 | 비고 |
|---|---|---|
| 없음 · `overlay` | 지금 포스터(사진 위 글 · 스크림) | 회귀 0 |
| `event_card` | 벤치마크 B: 위 글 칸(라벨 · 제목 · 본문 · 면색) / 아래 사진 4:3 / 쪽 번호 N/M / 흰 바닥 텍스트 버튼 둘 | 스타벅스형 |
| `banner_sheet` | 벤치마크 A: 색 면 · 좌상단 탭 라벨 칩 · X · 왼쪽 글(윗줄 · 큰 제목 · 아랫줄) · 오른쪽 사진(contain) · 버튼(선택) | 배민형 |

- 이 값을 모르는 옛 SDK · 옛 앱은 **지금 포스터 모양**으로 그린다(내용 같고 모양 다름). 캐러셀을 모르는 더 옛 앱은 첫 장만(flat 합성).
- `overlay`가 아닌 레이아웃은 **1장이어도 `poster_slides`를 [slide0]로 저장**하고 SDK·미리보기는 레이아웃을 먼저 본다
  (옛 `>=2` 조건은 overlay 에만 적용 · 회의론자 2).

### 1-2. 슬라이드 키 추가(`poster_slides[i]` · 전부 선택)

| 키 | 뜻 | 쓰는 레이아웃 |
|---|---|---|
| `eyebrow` | 작은 라벨(EVENT) · 배너의 탭 라벨 | event_card · banner_sheet · overlay(배지 자리) |
| `subtitle` | 배너 윗줄 | banner_sheet |
| `bg_color` | 글 칸 바탕(event_card) · 면 색(banner_sheet) · hex만 | event_card · banner_sheet |
| `image_fit` | `cover` · `contain` | 전 레이아웃(기본 = event_card cover · banner_sheet contain) |

- 기존 키(image_url · title · body · cta · link_url · 색 · 크기) 그대로. 최대 5장 그대로.
- **장마다 색·크기를 명시 기록**한다. `design.poster_*`는 첫 장 값의 복사본(옛 SDK 폴백용)으로만 둔다(회의론자 6).
- **배지 규칙(회의론자 3)**: `badge_text` = 모든 장의 eyebrow 가 같으면 그 값 · 다르면 `''`(매번 명시 전송). 편집기 진입 때
  기존 badge_text 를 장마다 eyebrow 로 복사.

### 1-3. 닫기 방식 = `design.dismiss_mode`

- `snooze_day` = 「오늘 하루 보지 않기 · 닫기」 — 기존 `dismiss` 이벤트에 `button_id='snooze_day'` 기록 · 서버 억제(24시간 · 부모 축) ·
  SDK localStorage 만료 시각(5분 캐시 경로 포함). 라벨은 **SDK·앱이 직접 그린다**(모르는 SDK·앱 = 지금의 「다시 보지 않기 · 닫기」 = 거짓 표시 0).
- 없음 = 지금 동작(다시 보지 않기 = 영구 opt_out · 닫기 = 세션). 기존 메시지 동작 불변. 새 레이아웃의 기본값 = `snooze_day`.

### 1-4. 초안 · 발행 (회의론자 1 · 코드 확인: 새 작업본이 active 로 시작 → 첫 저장 = 게시 · 15크레딧)

- **초안 = 멈춤(paused) 저장**: 편집기 자동 저장은 늘 paused. 서버는 paused 저장이면 빈 제목 · 혜택 placeholder · 이미지 없는 장을 받아 둔다.
- **발행 = active 로 넘어갈 때만 검사 · 과금**: 서버가 결과 행으로 게시 조건(제목·본문 · placeholder 0 · 포스터 이미지 · 장마다 이미지)을 검사하고,
  못 넘으면 이전 상태로 되돌리고 400. 과금 확인 창은 **서버 과금 이력**(`publish_charged`)으로 판정.
- 게시 중(active) 메시지 = 자동 저장 없이 [반영] · 반영 때 A/B 변형에 레이아웃·디자인·2~N장 전파(첫 장 제목·본문은 변형 값 유지 · 회의론자 8).
- 저장은 요청 하나씩 순서대로 · 응답에서는 id 만 병합(초안 2행 방지).

### 1-5. 남은 슬라이드 게이트

- 서빙 · 편집기 불러오기 · update SET 모두 template 이 `full_image` 가 아니면 슬라이드를 비운다(회의론자 9 · 사전 집계 0건).

## 2. 제작 화면

- 모달 → 전체 화면(`EditShell` 재사용 · `channelSwitch` 선택 prop 으로 웹/앱 표시 · DM·이메일 불변).
- **입구**: 채널 → 모양 고르기(실제 렌더 썸네일) · 「용도로 바로 시작」(문안·장 채워진 완성본 · 혜택 칸만 placeholder).
- **크게 보여 주기(포스터 계열 3종)**: 왼쪽 장 목록(썸네일 · 끌어 순서 · 장 추가 = 복제 · 여러 장 끌어 놓기 = 장 자동 생성) /
  가운데 휴대폰 미리보기 위 **별도 편집 층**(data-edit 키 · 떠 있는 제어형 textarea · 한글 조합 Enter 무시 · Esc 취소 · 장마다 고정 key ·
  원문 + 변수 칩 · 「고객으로 보기」 켤 때만 치환) / 오른쪽 = 고른 칸·장·메시지 설정(강조만 · 동시 포커스 없음 · 회의론자 12).
- **기본 알림 · 작게 알리기**: 지금의 내용·디자인 편집을 오른쪽 패널로(블록 · 정예 템플릿 = 「고급」) · 가운데 미리보기.
- 「타겟·시점」 탭 → [발행] 확인 창(로직 이동). 이미지 없는 장 = 발행 전에 그 장으로 데려감.
- 기본 알림에서 [장 추가] = 「크게 보여 주기로 바꿀까요?」 → 글·사진·첫 버튼을 첫 장으로 옮김 · 되돌리기(회의론자 7).
  문구 스타일은 내용이 있으면 스타일만(블록 통교체 금지 · LESSONS_FRONTEND 67).

## 3. 단계 (Harold 「3차까지」)

1. **1차(웹 완결 + 앱 보호)**: 1장 전부 · 2장 전부 · 웹 SDK(레이아웃 렌더 · 쪽 번호 · PC 화살표·키보드 · snooze) · SDK 새 버전 + 고정 버전 갱신 ·
   앱 채널 새 레이아웃 잠금(「앱 업데이트 필요」 · 「구버전 앱 모습」) · 대조 테스트(미리보기 ↔ SDK 속성 원장 · 넘긴 뒤 상태).
2. **2차(앱)**: 계약서(poster_layout · eyebrow · subtitle · bg_color · image_fit · dismiss_mode) + 첫 고객 앱(poppon-app `src/lib/hanjul/`) 렌더 ·
   OTA(Harold) · 실기기 확인 뒤 앱 잠금 해제.
3. **3차**: 정예 템플릿을 새 입구 「기본 알림」의 문구 스타일로 재분류 · 용도 카드에 새 레이아웃 완성본.

## 4. 결정 기록 (회의에서 갈린 것)

- 배너 시트 1차 포함(기획·디자이너·회의론자 2차 → 벤치마크 A · 같은 렌더러 분기 · 누끼 = 스튜디오 배경 지우기).
- 휴대폰 위 직접 편집 1차(조건 3 · 기획만 2차).
- 키 이름 `poster_layout`(poster_* 관례).
- [0718 설계서](2026-07-18-inapp-simplify-image-studio-design.md) §2-4(여러 메시지 묶음 페이징) **폐기** — 1 메시지 = N장(§10-C)이 기준.

## 5. 구현 기록 (0929 · 1~3차 코드 완료 · 미배포)

### 5-1. 서버 (DDL 0 · 새 컬럼 0 · 새 크레딧 키 0)

| 무엇 | 어디 |
|---|---|
| 레이아웃 · 닫기 방식 화이트리스트 | `utils/inapp-message.ts` `INAPP_POSTER_LAYOUTS` · `INAPP_DISMISS_MODES` · `sanitizeInAppDesign` |
| 장 새 키 · 초안 자리 지키기 · 배지 규칙 | `sanitizePosterSlides(raw, { allowEmptyImage })` · `commonPosterEyebrow` · `posterSlidesHaveUneditedPlaceholder`(라벨·윗줄 포함) · 앱 면 색 단색 보정 |
| 초안 판정 | `isInAppDraftSave` = draft true **와** status paused(플래너 제작처럼 draft 없는 멈춤 저장은 지금처럼 엄격) |
| 게시 조건 CT | `inAppPublishDefect`(제목 · 본문[장 있는 포스터는 선택] · placeholder · 포스터 사진 · 장마다 사진) — 생성(최종 active) · 수정(트랜잭션 안 결과 행 판정 · 미달 = ROLLBACK · 400 `INAPP_NOT_PUBLISHABLE` + 결함 자리) · 변형 생성/켜기 · 플래너 실행 켜기 5길목 |
| 남은 슬라이드 게이트 | 수정 SET(최종 template ≠ full_image → NULL) · 서빙 매퍼 |
| [반영] = 변형에 모양 전파 | `propagatePosterToVariants`(수정 CT 같은 트랜잭션 · 부모 장 사본 + 첫 장 제목·본문만 변형 값 · 장 없는 부모 = 변형 사진 유지 · 포스터 아닌 부모 = 무접촉) |
| 켜기 단일 길목 · 게시 중 초안 거절 | `activateInAppMessage`(한 트랜잭션 · FOR UPDATE → 게시 조건 CT → 켜기 · 플래너 실행 · 변형 켜기가 이것만 부른다) · 수정 CT 초안 저장은 행 잠금 뒤 게시 중이면 `INAPP_DRAFT_ON_LIVE`(409) · 저장은 사진 없는 장을 버리지 않는다(게시 판정이 거절) |
| 하루 보지 않기 억제 | opt_out 억제 쿼리에 `dismiss + button_id='snooze_day' + 24시간` OR(같은 식별 축 · 부모 축) |
| 과금 이력 | `ai-credit.ts chargedKeysAmong` → GET /inapp `publish_charged`(과금 판정은 PUT 라우트 그대로) |
| 개인화 | 서빙 치환 · 변수 스캔에 eyebrow · subtitle |

테스트 = `src/utils/__tests__/inapp-editor-redesign-0929.test.ts`(32건).

Codex 적대검토: 1R needs-attention(high 1 켜기 경합 · medium 2 사진 없는 장 삭제 · 변형 전파 미판정) → 뿌리 수정(켜기 단일 길목 · 저장은 장 보존 · 전파 결과 판정 + 사진 상속) · 자체 검토로 늦은 초안 저장 경합(게시 중 초안 거절 + 화면 저장 비우기·잠금) 함께 닫음 → **2R approve**(고친 줄 + 직접 호출부 · 차단 결함 0) · 2R 이 범위 밖으로 남긴 1건(전파할 때 변형 문안을 잠그지 않고 읽음 = 동시 변형 수정 덮어쓰기)은 이번에 쓴 함수라 `FOR UPDATE` 한 줄로 닫음.

### 5-2. 웹 SDK

`packages/sdk-js/src/inapp.ts` — `resolvePosterLayout` · `POSTER_SHEET_DEFAULTS` · `renderPosterSheet`(event_card · banner_sheet · 1장도 레이아웃 경로 · 쪽 번호 · PC 화살표 · ←/→ · Esc) · overlay 장마다 라벨 · `appendOptOutLink` 닫기 방식(snooze_day = 「오늘 하루 보지 않기」 · dismiss + snooze_day 기록 · localStorage 만료 · 부모 축) · `canDisplayMessage` 억제(5분 캐시 경로 포함).
**버전 고정은 바꾸지 않았다** — `sync-serving-folders.mjs`가 v0.3.8 이상 모든 서빙 폴더에 같은 빌드를 복사하므로 카페24 scripttag(v0.3.9 고정)·수동 스니펫 모두 `build:all` 한 번으로 새 코드를 받는다(재등록 불필요 · Cache-Control 1시간).
테스트 = `inapp-poster-sheet-0929.test.ts`(16) · 대조 `inapp-sheet-parity-0929.test.ts`(7 · 프론트 미리보기 기본값 표 · 부품 이름 · 바닥 문구 · 쪽 번호 형식 · 넘긴 뒤 상태).

### 5-3. 편집 화면

| 무엇 | 어디 |
|---|---|
| 입구(용도로 바로 시작 5 · 크게 보여 주기 3 · 기본 알림 · 문구 스타일 · 작게 알리기 3 · 실제 렌더 썸네일) | `components/inapp/InAppEntryGallery.tsx` · 완성본 = `inappStarters.ts`(혜택 칸 = placeholder · 사진 없음) |
| 장 순수 함수 · 발행 전 점검 · 모양 분류 · 앱 잠금 값 | `components/inapp/inappSlides.ts` |
| 3모양 미리보기 · 편집 무대(SDK 미러) | `components/inapp/PosterSheetPreview.tsx` |
| 장 목록 · 휴대폰 위 직접 편집 · 칸/장 패널 · 모양 바꾸기 · 사진 넣기 | `components/inapp/PosterEditor.tsx` |
| 전체 화면 편집기(EditShell) · 초안 자동 저장(순차 · id 만 병합) · 되돌리기 · [발행] 확인 창(표시 조건) · 과금 확인 창(서버 과금 이력) · [반영] · 게시 멈춤 · 모양 바꾸기(글·사진 보존 · 되돌리기) · 문구 스타일 비파괴 | `pages/InAppMessagesPage.tsx` `EditModal` |
| 채널 전환 슬롯 | `components/make/EditShell.tsx` `channelSwitch`(DM·이메일 불변) |
| 목록 상태 = 게시 중 · 멈춤 · 초안 / 모양 이름 | 같은 파일 목록 카드 |

실렌더 측정(스크래치 하네스 · 1440 · 1280 · 390 · 가로 넘침 0) + SDK 실물(390 · 1440 · 375×600 화면 안).

**0929 배포 뒤 접수(Harold)** — 낮은 화면에서 휴대폰 무대가 잘리고(1455×740 = 43px) 떠 있는 입력 칸이 화면 밖으로 밀림 → `PosterStage` 무대 맞춤(가운데 칸 높이를 재서 축소 · 키우지 않음 · DM·이메일 `PreviewPair` 와 같은 방식) + 입력 칸 자리 확정(아래 자리 없으면 글자 위 · 보이는 칸 안 · 글씨 크기 그대로). 브라우저 측정 = 데스크톱 9가지(1280×720 ~ 1920×969 · 앱 포스터 · 웹 이벤트 카드 · 배너 · PC 틀) 휴대폰 잘림 0 · 본문·제목·라벨 입력 칸 전부 보이는 칸 안 · 포커스 정상.

**0929 접수(Harold) 2** — 떠 있는 입력 칸이 사진을 가림 · 왼쪽 장 목록 칸 빈 곳은 장 수에 따라 사라짐(5장이면 1455×740 = 64px 실측) → 편집 칸 = **가운데 칸 안 휴대폰 옆**(장 수 무관): 글자를 누르면 휴대폰이 가운데 칸 오른쪽 끝으로 비키고 왼쪽에 편집 칸(240~360)이 그 글자 높이에 맞춰 붙는다(화살표 + 연결선 · 휴대폰·글자 안 가림). 옆자리가 모자라면(1024급 · 모바일 · PC 틀) 오른쪽 패널 글자 칸으로 커서 이동. 끌어 옮기기는 넣지 않음(누를 때마다 옮겨야 하고 옮긴 자리가 다른 칸에서 다시 가림). 열 때 커서 = 글 끝(옛: 맨 앞이라 입력이 글 앞에 붙음 · 실측으로 발견). 브라우저 측정 = 6화면 × 4모양 × 장 1·5 × 모든 칸 = 180번 누름 · 휴대폰 잘림 0 · 휴대폰·글자 가림 0 · 커서 이동 정상 · 입력 반영 · Esc 되돌림 · Enter 완료.

### 5-4. 앱(2차)

- 계약서 v3 = `components/inapp/AppIntegrationContract.tsx`(새 레이아웃 · 장마다 라벨 · 오늘 하루 보지 않기).
- 팝폰 `poppon-app/src/lib/hanjul/` — `types.ts` · `inapp-core.ts`(레이아웃 · 기본값 · 닫기 방식 · 부모 id · `markSnoozed` · `canDisplay` 억제) · `InAppPosterSheet.tsx`(신규 · RN 기본 + expo-image = OTA 가능) · `InAppBottomSheet.tsx`(새 레이아웃 분기 · 바닥 라벨 · 장마다 라벨) · `InAppHost.tsx`(하루 보지 않기 · 사진 누름). 앱 tsc 0 · 순수 로직 14건 스크래치 실행 확인.
- **앱 잠금** = `inappSlides.ts APP_SHEET_LAYOUTS_UNLOCKED = false`(고를 수는 있고 「앱 업데이트 필요」 표시 · 미리보기 「구버전 앱 모습」 기본 켜짐). OTA 뒤 실기기에서 새 모양 · 하루 보지 않기 확인 → true 로 해제.

### 5-5. 3차

정예 템플릿 = 입구 「기본 알림」의 문구 스타일 · 편집기 제목 「문구 스타일」 · 적용 비파괴(블록 있으면 모양만 · 글만 있으면 블록으로 옮긴 뒤 모양 · 빈 메시지만 구성까지 · 옛 통교체 확인 창 제거). 용도 카드 5종에 새 레이아웃 완성본.
