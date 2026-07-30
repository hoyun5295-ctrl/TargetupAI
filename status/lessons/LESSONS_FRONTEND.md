# LESSONS — Frontend / UI / 모달 / 모바일 / 모델명 노출 사고

> **참조**: Frontend 페이지/컴포넌트/모달 작성 / UI 노출 영역 작업 시 우선 정독.
> **원본**: 옛 `LESSONS_LEARNED.md` §3 안 UI 관련 사고 분할 (D215+ 도메인 분할 — 2026-05-24).

---

## 핵심 원칙

- **`setMonth(-1)`로 전월을 구하면 월말에 당월이 나온다 — 날짜를 1일로 낮추고 옮긴다** (2026-07-30, 정산 모달 기본 대상월) — `new Date(2026-07-31).setMonth(6-1)`은 "6월 31일"이 7월 1일로 정규화돼 **전월이 아니라 당월**을 돌려준다. 정산·청구처럼 "기본값이 곧 실행 대상"인 화면에서는 운영자가 전월이라 믿고 진행 중인 달을 발행하게 된다. 처방 = `d.setDate(1)` 선행 후 `setMonth`. **일반화: Date의 월 이동은 일자가 살아 있는 한 안전하지 않다.** (서버도 같은 부류를 막아야 한다 — 최소과금 발행은 "끝나지 않은 달" 자체를 거부한다.)
- **역할 라우트 가드 불일치 = 로그아웃 오인 + 기능 개방/차단은 UI 진입점 전수 게이트** (2026-07-21) — PrivateRoute가 userType 불일치 시 `<Navigate to="/login">` → 인증된 사용자가 로그인 화면으로 = 로그아웃 오인(스튜디오에서 담당자가 인앱/이메일 버튼 누르면 튕김의 근본). 담당자 = DB `user_type='user'` → 로그인 시 JWT `company_user`(auth.ts:295). 기능을 역할에 개방/차단할 땐 **라우트만이 아니라 모든 UI 진입점 전수**(스튜디오 발사대 버튼·오퍼레이터 카드 `adminOnly`·채널선택 모달 EventCampaignModal·resume bar) userType 일관 게이트 — 하나 빠지면 그 경로로 튕김/노출(Codex가 EventCampaignModal 잔존 적발). **인앱메시지 = 공유 화면**(SDK `sdk-js/inapp.ts:400`이 active 메시지를 for 루프로 전부 렌더 → 다중 담당자 발행 시 겹침, per-recipient 채널과 근본 다름)이라 관리자 전용.
- **모델명 UI 노출 절대 금지** — Opus / Sonnet / GPT / Claude 단어 Frontend grep = 0건 (D190-fix1 + D214+ 반복 사고)
- **native dialog 절대 금지** — alert / confirm / prompt 0건. ConfirmModal + useToast 의무 (D211+ + D212+)
- **모바일 반응형 default** — `@media (max-width: 767px)` 매트릭스 항상 박을 것 (D186)
- **대량 처리 사용자 안내** — 5초+ 작업 영역 = 로딩 오버레이 + close 차단 + disabled 의무 (D185)
- **CSS pointer-events-none + select-none wrapper 광범위 X** — 자식 textarea/scroll/copy 차단 사고 (D188)
- **모달 z-index 티어 통일** (2026-06-25) — 앱 모달 z-[55]~[140] / DM `ModalBase` 1000(outlier) / **확인·차단 인터럽트 모달 = z-[2000]**(ConfirmModal·CreditConfirmModal·CustomerDataGate) / 시스템 9997~99999. 인터럽트 모달이 자신을 띄운 모달보다 z-index 낮으면 뒤로 깔림 — 새 확인/차단 모달은 z-[2000] 의무.
- **DM 속성 = "편집기 컨트롤이 발행물서 실제 소비되는가"를 기계로 강제 (재발 방지 게이트)** (2026-07-14) — 0713~0714 디자인 3.0/4.0 대개편서 "편집기서 고를 수 있는데 발행물엔 반영 안 되는" 이음새 반복(연결부 색#2·줄바꿈#3·폰트#5·그라데이션 2색#6). 스냅샷은 "렌더됨"만 보고 소비 일치는 못 잡음. **`utils/dm/dm-property-contract.ts`(SoT)+`dm-editor-parity.test.ts`가 각 속성이 SSR/CSS서 실제 소비되는지 밟음("컨트롤 있는데 출력 무변=실패"). DM 편집기에 새 속성/옵션(배경면·연결부·구도·텍스트 필드 등) 추가 시 계약표 등재 의무.** 동작 결함(권한 스코프#4·발행 저장 시점#7)=`dm-flow-invariants.test.ts`(DB목·소스계약). **게이트=git pre-push 훅(`.githooks/pre-push`): 클론당 1회 `git config core.hooksPath .githooks` → push마다 backend vitest 자동·실패 시 push 차단. backend는 ts-node 실행이라 build:safe는 배포서 안 돌아 게이트로 무효.** 테스트 중 DB/Redis 연결은 `process.env.VITEST` 가드로 스킵(config/database.ts·defaults.ts — 운영 VITEST 미설정이라 무영향).
- **DM 편집↔발행 미러는 값·CSS존재 축뿐 아니라 "마크업 클래스" 축까지** (2026-07-20, 남지현 4번째 재오픈) — 신고 "제목 위 주황 막대"의 정체 = 아트디렉션 모티프 `accentMotif='rule'`이 `.dm-text-h2::before`(30x3 강조막대)로 걸리는 것. 발행 SSR은 섹션 제목에 `dm-text-h2` 클래스를 붙이는데 편집 캔버스는 클래스 없는 div라 편집 화면에만 장식 소실. 앞 3회는 "divider(연결부)"로 오진 — **`brand_kit.art_direction`을 실덤프(SQL)해서 처음 값을 봄**(추측 금지). 앞 게이트가 못 잡은 이유 = dm-editor-parity는 "컨트롤 있는 속성"만, dm-variant-parity는 "CSS 셀렉터 존재"만 봤고 이번은 양쪽 CSS 정상·깨진 건 셀렉터가 걸릴 **마크업 클래스**. **게이트 = `dm-title-parity.test.ts`**(섹션별 제목 dm-text-h2 출현 수 SSR↔캔버스 대조 + 모티프 4종 양쪽 CSS + 셸 정합=발행 dmEventCard 섹션=편집 DmEventCard 섹션 `DM_EVENT_CARD_SECTIONS` 3자 일치). 계약 = dm-property-contract.ts `DM_MOTIF_TITLE_HOOK`·`DM_EVENT_CARD_SECTIONS`. **한계(주석)**: 클래스를 제목 아닌 이웃 요소로 이설하는 우회는 정적 완전차단 불가 → 계약 등재+실측 보완. **인앱도 같은 부류** = 편집 미리보기(BlockPreview)↔SDK 렌더(inapp-blocks) 값 미러 = `inapp-poster-parity.test.ts`(full-bleed 최소높이/패딩/헤드라인 정규화 대조). 셸 정합 시 = 발행 셸(padding sp-6 sp-5 무테두리 / dmEventCard)을 편집도 동일하게, 빈 상태 제목은 편집 편의로 유지(발행 early-return과 의도적 차이·주석 명시).
- **DM 편집↔발행 미러 = 값·클래스·셸 축뿐 아니라 "제어요소/상호작용" 축까지** (2026-07-22, 임은지 탭카드·상품슬라이드) — 앞 게이트(dm-editor-parity=값 소비 / dm-title-parity=제목 클래스·셸)가 **"편집 캔버스가 발행과 같은 버튼·인디케이터 개수공식·탭 스타일(알약vs밑줄)·죽은 장식상자·죽은 옵션(탭 content_type 이미지/상품목록)을 그리나"는 못 봄.** 상품슬라이드 점=상품수(아이템 단위)인데 카드가 페이지당 2 → 끝까지 스와이프해도 유령 페이지. 해법 = 신규16 3면(편집기·캔버스·SSR/뷰어) 전수 재감사 + **캔버스 소스 대조 게이트**(dm-editor-parity 확장: `block(fn,next)`로 컴포넌트 본문만 잘라 마커 대조) + **죽은 옵션은 제거가 아니라 실제 렌더**(Harold "없애면 왜 만들었겠어" — 탭 상품목록은 상품 붙여넣기 파서 재사용, 백엔드는 프론트 TS 프로덕션 import 불가라 미러 파서 `dm-tab-content.ts` 신설+교차패키지 일치 테스트). **인디케이터류는 카드를 페이지 래퍼(scroll-snap-align:start)로 묶어 스크롤 자식↔점을 1:1로 만들면 뷰어 로직 무변경으로 페이지 단위 정합**(우아). 옛11은 이미 3면 미러 유지(클린) — rot은 신규16에 집중. [[project_2026_0722_mobile_dm_editor_publish_parity]]
- **섹션 공통 속성은 "구도별 소비처"까지 전수 확인** (2026-07-10) — "버튼 색"(accent_color→--dm-primary)을 래퍼가 걸어줘도 버튼이 없는 구도(히어로 오버랩 카드)는 소비처 자체가 없어 미반영(임은지 신고 — 캔버스·SSR 양쪽 흰 카드 하드코딩). 공통 속성 신설/점검 시 = 그 속성을 소비하는 요소가 **각 구도(treatment)마다** 존재하는지 확인. 해법 = 래퍼가 강조 면 변수(--dm-accent-surface/-fg/-sub)를 동반 정의하고 구도가 `var(x, 기존기본값)` 폴백 소비 — 미지정 발행물 렌더 무변화로 회귀 0. 3면 대조(패널/캔버스/SSR)에 "속성별 소비" 축 추가.
- **템플릿·테마 적용류 = 비파괴 의무 (사용자 콘텐츠 절대 삭제 금지)** (2026-07-14 Harold 격분) — 정예 템플릿/테마/골든 적용이 `setSections(template.sections)` 통교체를 하면 사용자가 만든 상품·문안이 전부 사라진다("상품 추가해 DM 만들고 템플릿 누르면 왜 다 지워지냐"). 원칙: **빈 캔버스(header/footer 외 콘텐츠 0)에만 골격을 채우고, 콘텐츠가 있으면 룩(brand_kit)+같은 타입 섹션의 스타일 키(treatment/background/divider_shape/pull_up/align)만 입힌다.** "교체됩니다" 경고로 넘기지 말 것 — 경고 자체가 설계 실패. 테마 모달(색·서체만 패치)은 원래 비파괴라 정상. 신규 "완성형 적용" 진입점 = 반드시 콘텐츠 유무 분기.
- **overflow:hidden 컨테이너 안 position:absolute 드롭다운 = 잘림 (z-index 아님)** (2026-07-14) — 상단 바(height 56·overflow:hidden, 2026-04-17부터)의 자식 absolute 메뉴가 바 높이에서 클리핑돼 캔버스 뒤로 들어간 것처럼 보임(z-1300이어도 무의미 — 부모가 자름). 해법 = 메뉴를 `position:fixed`로 버튼 실좌표(getBoundingClientRect)에 앵커링해 클리핑 조상 밖으로 분리 + 스크롤/리사이즈 시 닫기 + maxHeight 스크롤. **드롭다운/툴팁이 "안 보이거나 잘리면" z-index 올리기 전에 조상 overflow부터 확인.** DmTopBar overflow:hidden(가로 넘침 방지용)은 무접촉 유지.
- **추출·자동입력 결과는 항목별로 정직하게 피드백** (2026-07-14) — 브랜드 학습 URL 자동 추출이 색을 못 가져와도(사이트가 theme-color 미제공 — shiseido.co.kr 실측) 화면이 "됐는지 안 됐는지" 안 알려주면 사용자가 결함으로 오인. 토스트로 **가져온 것/못 가져온 것을 항목별 구분** ("로고는 가져왔고 색은 사이트가 안 줘서 직접 지정") + 실패 시 직접 입력 경로 항상 병설(파일 업로드 등). 자동화는 실패할 수 있다 = 수동 대체 경로 의무.
- **편집기↔실렌더 대조는 "값"뿐 아니라 "허용표(무엇이 그려지는가)"까지** (2026-07-17 인앱 전수점검) — 인앱 SDK `renderBlocks`는 템플릿별 허용표(`ALLOWED_BLOCKS`)로 미허용 블록을 **조용히 건너뛴다**(slide_in엔 카운트다운·체크리스트 불가 / toast=텍스트 4종 / floating=CTA만). 그런데 편집기 추가 메뉴·미리보기가 그 표를 안 보면 "미리보기엔 보이는데 실물에서 사라지는" 버그가 된다(사용자에겐 조용한 소실 = 결함). 원칙 = **허용표는 단일 진실(SDK) → 소비 3면(편집기 메뉴·미리보기·백엔드 AI 산출물 필터)에 미러 + 기존 미허용 블록엔 정직 경고**. 값 축(정렬·색)만 대조하고 끝내면 이 부류를 못 잡는다. 같은 축 사례 = **flex 행 블록은 text-align 상속이 안 닿는다**(쿠폰·CTA 행 — 아이콘+텍스트 flex라 `justify-content` 미러가 필요. 카운트다운[좌 라벨+우 시계]·목록·상품카드는 구조물이라 정렬 대상 아님). **죽은 컨트롤 금지**도 같은 뿌리 — 채널이 소비 안 하는 컨트롤(앱 채널의 버튼 스타일·자동 닫힘·애니메이션)은 숨긴다("눌러도 안 변함"=신뢰 파괴).
- **DM 섹션 정렬 = 공통 래퍼 단일 메커니즘, 하드코딩 center 금지** (2026-07-09) — 정렬(좌/중/우)은 래퍼(SectionRenderer/renderSection)의 `text-align` 상속 + `--dm-section-justify` var로 전 섹션 구동. 섹션이 `text-align:center`/`justify-content:center`를 하드코딩하면 래퍼를 덮어 정렬 무력화. 기본 align=center는 래퍼가 center 유지하므로 하드코딩 제거=회귀0, 좌/우만 신규 반영. 헤더 로고형 좌/우는 row+justify-content면 **편집 캔버스 contentEditable(브랜드)가 블록으로 폭을 꽉 채워 flex-end 안 먹음** → center·hero처럼 column+align-items가 정답. 편집 canvas ↔ 발행 SSR(dm-section-renderer) 반드시 미러(3면 일치). 미디어박스·이벤트카드 휠(margin:auto)·폼입력·페이징 점·placeholder·풀폭 CTA는 구조적 중앙(정렬 대상 아님)으로 유지.

- **난독화 stringArray × 동적 import = 공존 금지 (비결정 빌드 사고)** (2026-07-18 ★전 고객 대시보드 다운) — stringArrayThreshold 0.5는 문자열의 절반을 "빌드마다 무작위로" 암호화한다. 라우트 동적 import(`import('./pages/X')`) 경로 문자열이 걸리면 rollup이 그 페이지 청크를 아예 생성 못 하고 런타임이 원시 경로(`/assets/pages/X`)를 요청 → SPA fallback HTML → "Unexpected token '<'" → 전 고객 오류 화면. **같은 코드가 로컬(76청크 정상)과 서버(63청크 — Dashboard 미생성)에서 다르게 빌드됨** = 로컬 검증이 서버를 대표 못 함. 원칙: ①동적 import 보유 파일은 난독화 exclude ②프론트 로딩 구조 변경 = safe-build에 "lazy 대상 전 청크 실존 기계 검증" 게이트 통과 없이 배포 금지 ③"빌드 성공 ≠ 배포 가능" — 비결정 요소가 있으면 산출물 검증이 유일한 진실 ④고객 대면 화면 전체가 기간계(발송·돈 무접촉 ≠ 기간계 영향 0). 상세=docs/2026-07-18-frontend-splitting-incident-handoff.md

---

## 사고 이력

### 2026-07-09 — 뒤로가기 navigate 하드코딩 루프 재발 + DM 편집 캔버스↔발행 SSR 미러 부재
- **뒤로가기 navigate 하드코딩 = 루프+스크롤 미복원 재발점**: 여정 통계분석 뒤로가기가 `navigate('/ai-journeys/:id')`(여정상세) 하드코딩 → 여정상세 back(goBackOr -1)이 다시 통계로 → stats↔상세 무한 루프(대시보드 못 감). 전수 감사로 동일 패턴 9곳(JourneyStats+마케팅캘린더·성과·예측·푸시·음성·원클릭·여정목록·자동마케팅) → 전부 `goBackOr(navigate, fallback)`. **교훈: 새 ←/뒤로가기 버튼은 무조건 `goBackOr(navigate, fallback)`. navigate('/x') 직접=PUSH라 루프+스크롤 미복원. 대시보드/메인 '종료' 라벨·정방향 이동만 navigate 허용.** [[feedback_scroll_restoration_convention]]
- **DM 구도(treatment) 캔버스 미반영 = 편집≠단말**: 공통 '구도(분할 등)' 선택이 발행 SSR(renderHeroSplit 등)에만 적용되고 편집 캔버스는 classic만 렌더 → 구도·버튼색 바꿔도 편집 화면 변화 0(사용자 혼선). SectionRenderer가 treatment 미계산·미전달이 근본. fix=프론트 selectTreatment 미러(`utils/dm-treatment.ts`)+SectionRenderer 전달+hero/coupon/text_card/cta 캔버스가 SSR treatment를 JSX 1:1 미러(classic 골든보존). **교훈: 공통 속성(구도·색·정렬)은 캔버스+발행 SSR 둘 다 소비해야 편집=발행. 한쪽만=불일치 신고. TextArea 입력 렌더는 캔버스(InlineEditable는 이미 pre-wrap)+SSR 둘 다 `white-space:pre-wrap` 필수(즉시쿠폰 조건 개행 소실).**

### 2026-07-06 — DM 발송 클릭 시 화면 전체 백지 (조기 return 뒤 훅 = 훅 개수 불일치 크래시)
- **현상**: DM 빌더에서 [발송] 클릭 → 페이지 전체 백지(URL 유지). 긴급 신고.
- **근본**: DmSendAndTrackModal이 `if (!show) return null;` **아래에서** `useRef` 호출(7/2(5) 커서 삽입 기능 추가 때 유입). 모달은 항상 렌더되고 show만 토글이라, 닫힘 렌더=훅 N개 / 열림 렌더=N+1개 → React 훅 개수 불일치 크래시 → 루트 언마운트 = 백지. show가 처음부터 true인 다른 진입(발송 추적 카드)은 무증상이라 "발송 버튼에서만·갑자기"로 보임.
- **fix**: useRef를 조기 return 위로 이동(2줄). 동일 패턴 전수 grep(multiline `return null;` 뒤 훅) — 후보 4파일 중 위반 1곳뿐(나머지는 헬퍼/콜백 내부 return null 오탐).
- **교훈**:
  - **컴포넌트 훅은 전부 조기 return(`if (!x) return null`) 위에** — tsc는 못 잡는다(런타임 크래시). 조건부 렌더 컴포넌트에 기능 추가로 훅을 새로 넣을 때 최상단 훅 블록에만 추가.
  - **전수 grep 시 제네릭 주의**: `useRef\(`는 `useRef<T>(`를 놓친다 — `use(Ref|State|...)[<(]`로.
  - 한 컴포넌트 크래시가 앱 전체 백지가 되는 구조(루트 ErrorBoundary 부재 + rules-of-hooks 린트 미가동) = 클래스 차단 후속 과제.

### 2026-07-04 — 스크롤 복원 전역 통일 (뒤로가기=복원 / 메뉴=최상단)
- **현상**: 하위 모듈(모바일 DM 등) 진입 후 좌상단 뒤로가기 → AI Operator가 보던 위치가 아니라 최상단으로 튐.
- **근본**: 옛 전역 `ScrollToTop`(App.tsx)이 pathname 변경마다 무조건 `window.scrollTo(0,0)`(6/28 "메뉴 진입 top" 룰). 메뉴/뒤로가기가 둘 다 `navigate('/x')`=PUSH라 pathname만으론 구분 불가 — 구분 신호는 히스토리 타입(PUSH/POP)뿐.
- **fix**: `lib/scroll-restoration.tsx` — `ScrollManager`(POP=location.key별 저장 위치 복원[sessionStorage+비동기 성장 대비 rAF/timeout 재시도], PUSH/REPLACE=top). 뒤로가기 버튼 14곳 = `goBackOr(navigate, fallback)`(앱 히스토리 있으면 navigate(-1)=POP, 없으면 fallback). 옛 ScrollToTop 폐기. React Router BrowserRouter(비-데이터 라우터)라 내장 ScrollRestoration 불가 → 직접 구현.
- **교훈**: **새 뒤로가기(←/돌아가기) 버튼은 반드시 `goBackOr(navigate,'/x')`.** `navigate('/x')` 직접 = PUSH라 복원 안 됨(재발 지점). 메뉴/완료(→dashboard) 진입은 그대로 navigate('/x')(top이 맞음). [[feedback_scroll_restoration_convention]].

### 2026-07-04 — 모달 배경(백드롭) 클릭 닫힘 전면 제거
- **현상**: 모달 바깥 흐린 배경을 클릭하면 모달이 닫혀 작업 손실(Harold 격분, 슈퍼관리자·일반 전 영역).
- **fix**: 오버레이 div의 닫기 트리거(`onClick={onClose}`/`onMouseDown`/`e.target===e.currentTarget` 가드) 전수 제거 — X·취소·ESC만 유지. `ModalBase closeOnBackdrop` 기본값 true→false. frontend 약60 + company-frontend 2.
- **판별 주의**: `<div inset-0 onClick>`이라도 **드롭다운 클릭캐처·DM 캔버스 클릭·이미지 라이트박스**는 정상 UX라 제외. 진짜 모달(가운데 정렬 + 내부 카드 stopPropagation)만 수정. `onClick={onClose}`는 X/취소 버튼에도 쓰여 오탐 — 오버레이 div에 달린 것만 골라야.

### 2026-07-02(5) — "글씨색" 반복 사고 뿌리 차단 (option 전역 !important + 흰 패널 컨트롤 명시색)
- **반복 원인**: 네이티브 폼 컨트롤(option/input) 글자·배경색이 컴포넌트마다 제각각. 다크 select 옵션 흰글씨(6/29 전역 규칙)로 한 번 막았는데, 이번엔 `[&>option]:bg-slate-800`가 옵션 배경만 덮어써 전역 `select option{color:#1e293b}`와 글자색=배경색 충돌(여정 대상 드롭다운). 또 흰 패널(AlimtalkChannelPanel `bg-white`)의 input은 색 미지정이라 다크 모달(ModalShell `text-white`) 안에서 흰글씨(여정 정보알림 대체 LMS 제목).
- **뿌리 fix (2단)**:
  1. option = 전역 `select option, select optgroup { color:#1e293b !important; background:#fff !important }`(index.css). `!important`라 컴포넌트가 `[&>option]:bg-*`로 배경만 덮어도 절대 안 깨짐. **개별 컴포넌트에서 option 색 지정 금지 — 전역이 단일 진실.** 기존 3곳(`JourneyBuilderUi:92,95`·`DateAnchorJourneyBuilder:74`)의 `[&>option]:bg-slate-800` 제거.
  2. 흰 패널 = 루트에 `[&_input]:text-gray-900 [&_input]:bg-white [&_textarea]:text-gray-900 [&_textarea]:bg-white [&_select]:text-gray-900` 지정 → 패널 내 모든 컨트롤(현재+미래)을 검은 글자·흰 배경 고정. 어느 모달에 삽입돼도 안전.
- **전역 `input{color:검정}`은 금지**: 다크 입력칸(text-white만 있고 배경 미지정)이 흰 배경 위 흰글씨로 뒤집혀 새 버그가 난다. 그래서 "option=전역 강제 / 흰 패널=패널 단위 명시" 2단으로만.
- **교훈**: 네이티브 컨트롤 색은 상속에 맡기지 말 것 — 테마 경계(다크 모달 → 흰 패널)를 넘으면 뒤집힌다. 흰 패널의 input/textarea/select는 명시색 의무, option은 전역 규칙이 단일 진실.

### 2026-07-02(4) — z-index 티어 위반 재발 3건 + 에디터-발행물 3면 대조 + 상태 축 혼용
- **z-index 재발**: 6/25 티어 룰(인터럽트 z-[2000]) 확립 후에도 SpamFilterTestModal(z-60)·AiRefineModal(z-70)·ToastProvider(z-100)가 DM 발송 모달(z-1100) 뒤에 깔림 — 스팸테스트가 "안 눌리는 것처럼" 보인 원인. 일괄 상향(모달 2000·토스트 9990). **교훈: 위반은 "모달 안에서 뜨는 공용 컴포넌트"가 새로 연결될 때마다 재발 — 공용 모달/토스트를 새 모달에 붙일 때 z 티어부터 확인.**
- **에디터-발행물 3면 대조**: DM 신규 16섹션이 에디터 캔버스에는 동작(탭 전환·설문 입력·슬라이드 넘김)하는데 발행물 SSR은 껍데기(첫 탭/첫 장 고정·설문 입력칸 없음·참여 버튼 무동작) — 죽은 동작 9건. **교훈: 섹션 점검 = 입력 패널 / 에디터 캔버스 / 발행물 SSR 3면 대조가 기본 틀. 캔버스에서 되는 것이 발행물에서 되는지 별도 확인.**
- **미리보기 고정 목업 = 거짓 표시 (2026-07-07(3))**: 인앱 카운트다운 미리보기가 마감 시각과 무관하게 항상 `23:59:59`를 그리던 하드코딩 목업 — 7/15로 설정해도 그대로여서 Harold가 직접 잡음. 실제 렌더러(SDK)는 남은 시간을 계산하는데 미리보기만 상수. **교훈: 미리보기는 SDK/발행물과 같은 실측 계산으로. 편집기에 상수 목업값을 넣어두면 "설정과 화면이 따로 노는" 거짓 표시가 되고, 사용자가 값 바꿔도 안 변한다 = 신뢰 파괴. 값이 시간·상태에 종속되는 요소(카운트다운·재고·남은시간)는 미리보기도 반드시 실계산.**
- **상태 축 혼용**: DM 발행 판정을 approval_status(검수 축)로 해 발행 후에도 크레딧 모달 재노출 / 이메일 발송 버튼이 completed(완성 축) 미검사로 임시저장에도 노출. **교훈: 버튼 노출·게이트 조건은 반드시 그 동작의 실제 상태 축(발행=status/short_code, 발송=completed)으로.**
- **API 응답 키 불일치 = 빈 목록 위장**: 발신번호 목록이 callbackNumbers인데 callbacks로 파싱 → 항상 "등록된 번호 없음". 목록이 비면 코드 추측 대신 응답 필드명 실측부터.
- **onClick={fn} 기본 인자 함정**: `handleSend(confirm = false)`를 onClick={handleSend}로 걸면 이벤트 객체가 인자로 들어가 truthy — 반드시 `() => handleSend()`.

### 2026-07-02 — map/삼항 괄호 안 JSX 주석 = 문법 오류 (같은 날 2회 반복)
- **현상**: `campaigns.map((c) => (` 직후와 삼항 `) : (` 직후에 `{/* 주석 */}`을 넣어 tsc TS1005 문법 오류 2회.
- **근본**: 괄호 안 implicit return 자리에는 표현식 1개만 허용 — `{/* */}` + 요소 = 표현식 2개.
- **대책**: 주석은 ① 괄호 바깥(윗줄 JSX 컨텍스트 안 `{/* */}`) ② 요소 안쪽 첫 줄 ③ `//` 일반 주석(괄호 직후 줄)로. 수정 직후 tsc가 즉시 잡으므로 tsc 검증 생략 금지.
- **현상**: 자동 마케팅 생성 모달에서 select 박스 옵션이 마우스 오버 시에만 보임(흰 바탕에 흰 글씨).
- **근본**: 다크 테마 select에 `text-white` 적용 → 옵션이 상속받아 OS 기본 흰 배경 드롭다운에서 흰글씨. 앱 전역에 옵션 색 지정한 select 0건이라 모든 다크 select 잠재.
- **fix**: `index.css` 전역 1곳 `select option, select optgroup { color:#1e293b; background:#fff }`. 개별 컴포넌트 땜질 대신 단일 전역(no_inline_duplication). 닫힌 select는 그대로, 열린 드롭다운만 가독.
- **교훈**: 네이티브 select/option은 OS가 렌더 — 다크 테마 `text-white`가 옵션까지 상속돼 흰글씨 됨. 전역 `select option` 규칙 1줄로 부류 전체 차단. 새 다크 select마다 옵션 색 따로 안 박아도 됨.

### 2026-06-25 — 게이트/확인 모달이 다른 모달 뒤에 깔림 (z-index 척도 불일치)
- **현상**: 모바일DM "AI 초안 생성"(고객 0명) 무반응처럼 보임. 실제론 CustomerDataGate(z-[150])가 DM `ModalBase`(zIndex:1000) 뒤에 렌더돼 안 보임.
- **근본**: 앱 모달은 z-[55]~[140] 척도인데 **DM `ModalBase`만 zIndex:1000 outlier**. z-[140] 이하 공용 인터럽트 모달(ConfirmModal 140·CreditConfirmModal 120·게이트 150)이 DM 모달 안에서 뜨면 다 깔림. 전수 grep으로 `VersionHistoryModal`·`AbTestModal` 안의 ConfirmModal도 동일하게 깔리던 잠재버그 확인.
- **fix**: "확인/차단 인터럽트 모달 통일티어 z-[2000]"(DM 1000 위·시스템 9997 아래)로 게이트·ConfirmModal·CreditConfirmModal 일괄 상향. AiPromptModal은 게이트 뜰 때 트리거 모달도 닫음.
- **교훈**: 모달 z-index는 **앱 전역 티어 체계**로 잡아라(콘텐츠/인터럽트/시스템). 한 컴포넌트만 다른 척도(1000)를 쓰면 그 위에서 뜨는 공용 모달이 전부 깔린다. 새 확인/차단 모달 = z-[2000]. 한 곳 고치고 끝내지 말고 "다른 모달 안에서 모달 띄우는 곳" 전수 grep.

### 2026-06-05 세션6 — 알림톡 변수매칭 필드 미노출 (미리보기가 매핑된 컬럼만 표시)
- **현상**: 주소록/엑셀 불러오면 수신자 미리보기에 phone만·변수매칭 드롭다운에 필드 0 (직원 psy5868 신고).
- **근본**: `AlimtalkSendModal.tsx` 수신자 미리보기 테이블이 `mappedColumns`(변수매칭에서 `@@컬럼@@`로 선택된 것만)를 헤더/본문으로 렌더 → 변수매칭 안 하면 recipients에 이름·기타1~3이 다 있어도 수신번호만 표시. backend(`address-books.ts:57` SELECT 5컬럼)·불러오기(`AddressBookModal:624` 5키 map)·recipients 연결은 정상 → **표시 로직이 버그**.
- **fix**: `previewColumns`(recipients[0] keys, phone 외 항상 표시) + `FIELD_LABEL_MAP`(name→이름·extra1~3→기타1~3) 한글 라벨(미리보기+드롭다운 공용) + 자동매핑 useEffect(변수명=필드명/라벨/별칭 일치 시 `@@필드@@`, 비워둔 변수만).
- **교훈 (메타)**: 코드를 읽고 "정상으로 보인다"고 단정 = 디버깅 아님. 직원이 화면 버그를 신고했으면 어딘가 결함이 있다. 데이터 흐름(backend→불러오기→recipients→미리보기 렌더)을 끝까지 따라가 **"표시 단계"에서 막힌 곳**을 찾아야. "정상" 단정 반복 → Harold 격분.

### D214+ — Opus 4.7 UI 노출 반복 위반 (Critical) ★ 신규
- **사례**: D190-fix1 (UI 모델명 노출 9건 전수 정정) 영구 룰 박혀있음에도 D214+ CdpSettingsPage 전면 재작성 안 "AI 자율 진단 (Opus 4.7)" 4건 노출:
  - line 10/367/744 (주석)
  - line 752 (UI 노출 — `<div>AI 자율 진단 (Opus 4.7)</div>`)
- Harold 우측 상단 토스트 에러 캡처 격분 — "여전히 오푸스를 쳐 박아놨고"
- **대책**:
  1. 모든 frontend 파일 안 "Opus", "Sonnet", "GPT", "Claude" 문자열 grep = 0건 (UI 노출 절대 금지)
  2. 추상 명칭 사용 의무 — "AI 모델" / "AI 자율 진단" / "고급 추론 모드"
  3. **MANDATORY_CHECKLIST 영구 항목 추가**: "신규 frontend 파일에 모델명 grep = 0건"
- **Critical**: D210+ Phase 1-fix1 9건 정정 → D214+ 4건 재발생 = 자기 강화 루프 사고

### D211+ + D212+ (native dialog 영구 폐기 + ConfirmModal/Toast generic 신설)
- **사례**: archive/unarchive/delete handleAction 안 native confirm/prompt/alert 직접 사용 → Harold 격분 캡처 신고 ("모달 좀 예쁘게 하라니까")
- **대책**:
  - `components/ConfirmModal.tsx` 신설 (D212+) — 4 모드 (default/info/warning/danger) + ESC + backdrop click + autoFocus
  - `components/ToastProvider.tsx` 신설 (D212+) — Provider + useToast hook + 4 모드 + 우측 상단 stacked + 3초 자동
  - 다크 톤 정합 매트릭스 = `bg-slate-900 + border-white/10 + rounded-2xl + shadow-2xl`
- **자가 검증**: 매 답변 직전 `alert\(|confirm\(|prompt\(` 0건 확인

### D188 (영업팀장 알림톡 14건 — CSS pointer-events-none 사고)
- **Root cause 핵심**: `AlimtalkTemplateFormV2.tsx:483` wrapper readOnly 분기에 `[&_textarea]:pointer-events-none` 적용 = textarea scroll/select/copy 영구 차단 사고. D162-4 fix가 불완전 — textarea도 자식 셀렉터에 포함.
- **대책**:
  - native HTML `readOnly` attribute + `select-text` 명시
  - wrapper에 광범위 `pointer-events-none + select-none` 적용 시 자식 영역 차단되는 패턴 영구 차단
  - 검수 알림 같은 회사 admin 의존성 데이터 = fallback 안전망 필수

### D186 (모바일 반응형 누락 — CSS @media 0건)
- **사례**: 모바일 스크린샷 신고 — 직접발송 패널 헤더 "창닫기" 세로 1글자 짤림 + DB 카드 숫자 겹침 + 드래그 스크롤 X.
- **Root cause**:
  1. `direct-send.css` 1509 라인 + `@media` 미디어 쿼리 **0건** (데스크탑 기준 고정)
  2. `.ds-modal__body` `grid-template-columns: 560px 1px 1fr` 2컬럼 강제
  3. `.ds-modal` + section `overflow: hidden` = 모바일 스크롤 차단
  4. Dashboard 메인 카드 `w-[40%]` / `w-[60%]` 픽셀 % 고정
  5. `grid grid-cols-3` 모바일에서도 3 컬럼 강제 = 숫자 겹침
- **3 단계 정정**:
  1. Phase 1 = 7 파일 / 19 모달 `w-[XXXpx]` → `w-full max-w-[XXXpx]` + `flex flex-col md:flex-row`
  2. Phase 1.5 = `overflow-x-auto + flex-shrink-0 + whitespace-nowrap` 가로 스크롤 + `lg:flex-row` + `grid-cols-2 md:grid-cols-3/4`
  3. Phase 2-A = `@media (max-width: 767px)` 추가 + backdrop overflow-y:auto + iOS touch scroll + ds-modal overflow:visible
- **교훈**: B2B SaaS도 모바일 default 의식. `@media` 매트릭스 항상 박을 것. `w-[XX%]` 고정 = 모바일 깨짐 위험 → `w-full lg:w-[XX%]` 정합.

### D185 (대량 업로드 사용자 안내 누락 — 130,962건)
- **사례**: AddressBookModal 파일 업로드 (130,962건) 시 안내/액션 0 + 화면 그대로 + 중간 X 시 다시 처음부터.
- **Root cause**: `isUploading` state 없음 + fetch 4 영역 try/finally 없음 + 로딩 오버레이 없음 + close 차단 없음.
- **대책**:
  1. `isUploading + uploadingMsg` state 추가
  2. 4 fetch 영역 모두 `try { setIsUploading(true); ... } finally { setIsUploading(false); }`
  3. 로딩 오버레이 (`absolute inset-0 bg-white/95 backdrop-blur-sm` + spinner + "창을 닫지 마세요")
  4. 모든 버튼 + X 버튼 `disabled={isUploading}` + close handler 차단 (`safeOnClose`)
  5. 메시지 동적 (`주소록 등록 중... ${count}건`)
- **교훈**: 백엔드 처리 시간 ≥ 5초 = 무조건 로딩 오버레이 + close 차단 + disabled 패턴.

### D70 (안전망의 역설 — 변수 치환)
- **사례**: 변수 치환 `replaceVariables` 정규식 안전망이 주소록 변수를 빈 값 치환 삭제.
- **대책**: 4번째 파라미터 `addressBookFields` 추가 — 안전망 regex 전 먼저 치환.

---

## 디자인 톤앤매너 매트릭스 (D211+ + D214+ 정합)

### 다크 톤 표준
- 배경: `bg-slate-950` 또는 `bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950`
- 카드: `bg-white/5 border border-white/10 rounded-xl`
- 모달: `bg-slate-900 border border-white/10 rounded-2xl shadow-2xl`
- 헤더: `bg-slate-950/80 backdrop-blur-sm sticky top-0 z-30`

### 액센트 색상
- **violet/fuchsia/indigo** — AI/Predictive/지능 영역
- **emerald/teal** — 성공/긍정/활성
- **rose/pink** — 위험/경고/이탈
- **amber/orange** — 경고/주의/베타
- **cyan** — 정보/안내

### 1-click 액션 카드 패턴 (Performance/Predictive/CDP 정합)
- color-coded (rose/emerald/amber 3색)
- icon + title + desc + 진입 버튼
- loading 영역 = `<Loader2 className="animate-spin" />` + "준비 중"
- disabled 영역 = `disabled:opacity-30 disabled:cursor-not-allowed`

### Source caption 의무 (모든 카드/차트)
- `<div className="text-[10px] text-white/30 italic mt-2">Data source — ...</div>`

---

## 그라데이션 — RN(앱 네이티브)에서 반투명 뷰 쌓기 금지 (★2026-07-20 팝폰 포스터형 가로줄)

- **사고**: 인앱 포스터형 하단 가독성 스크림을 네이티브 모듈 없이 만들려고 반투명 View를 쌓았다. 14px 계단 5장 → 밝은 이미지(백사장)에서 계단 경계가 가로줄. 1px 뷰 72장 미세 램프로 바꾸자 **iOS는 완벽해졌는데 Android는 더 심해졌다**.
- **원인**: Android는 dp를 물리픽셀로 반올림해 그린다. 반투명 뷰를 붙여 쌓으면 이음새마다 반올림 오차로 미세하게 겹치거나 벌어져 — 겹친 곳은 알파가 이중으로 진해지고 벌어진 곳은 밝게 비어 **이음새 개수만큼 줄이 생긴다**(72장 = 이음새 71개). iOS는 서브픽셀 정밀 렌더라 증상이 없어 한쪽만 보고 판단하면 오진한다.
- **정답**: 그라데이션은 **단일 요소로** 그린다. OTA 제약(네이티브 모듈 추가 불가)이 있으면 **코드 내장 base64 PNG 알파 램프 1장**을 `expo-image` + `contentFit:'fill'`로 늘린다(외부 에셋·모듈 0, GPU 보간이라 계단도 없음). 모듈 추가가 가능하면 expo-linear-gradient.
- **일반화**: 시각 결함은 **양 플랫폼 실측 전까지 종결 금지**. 한쪽 OK는 절반의 증거다.

---

## 디자인 최소 기준 — 신규 화면 착수 직전 정독 (CLAUDE.md `design_quality_minimum_journey_level` 상세)

> 룰(의무·절대금지·라벨 정책)의 원천은 CLAUDE.md다. 여기는 **그 화면을 만들 때 펼쳐 보는 체크리스트**만 담는다.
> 기준 화면 = Journey Builder(`/ai-journeys`). 신규 메뉴·페이지·UI 신설·옛 페이지 전면 재작성은 이 목록을 만족해야 한다.

| 요소 | 적용 범위 |
|------|-----------|
| 상단 헤더 sticky + 그라데이션 아이콘(10x10 rounded-xl) | 모든 페이지 |
| AI 자율 진단 카드 (violet→fuchsia 그라데이션 + Sparkles + topInsight) | AI 활용 페이지 |
| 자연어 입력 카드 (fuchsia/purple/indigo 그라데이션 + Enter 키) | 자동 생성 페이지 |
| 빠른 시작 카드 7건 (시나리오별 고유 icon + gradient) | 자동 생성 페이지 |
| 6 sub-agent 진행 카드 (700ms 간격 시각 효과) | AI 자동 생성 진행 |
| 1-click 액션 3 카드 (color-coded rose/emerald/amber) | 개선 추천 |
| 요약 5 metric + 이전 30일 대비 +/-% (TrendingUp/Down) | 통계 |
| 자세히 분석 토글 (ChevronDown/Up + 6 차트) | 통계 |
| 다크 톤 + violet 액센트 (`bg-slate-950` + `border-white/10`) | 모든 페이지 |
| Source caption (`text-[10px] text-white/30 italic` + `Data source — …`) | 모든 차트/카드 |
| 모바일 반응형 (flex-wrap + md:/lg: 분기 + grid-cols-2 md:grid-cols-4) | 모든 페이지 |
| ConfirmModal + useToast (native dialog 0건) | 모든 페이지 |
| 모달 (`bg-slate-900` + `border-white/10` + `rounded-2xl` + `shadow-2xl`) | 모든 모달 |

> 라벨 3단 정책·1클릭 UX 정합·절대금지 항목은 **CLAUDE.md가 소유**한다(`design_quality_minimum_journey_level` / `marketing_user_ux_priority`). 여기 복사하지 않는다.

---

## 자가 검증 매트릭스 (Frontend 작업 시)

- [ ] 모델명 (Opus/Sonnet/GPT/Claude) 단어 grep = 0건
- [ ] native dialog (alert/confirm/prompt) grep = 0건 (ConfirmModal + useToast 활용)
- [ ] 다크 톤 정합 (`bg-slate-950` + violet 액센트)
- [ ] `@media (max-width: 767px)` 모바일 반응형 default
- [ ] 대량 처리 영역 (5초+) = 로딩 오버레이 + close 차단 + disabled
- [ ] CSS `pointer-events-none + select-none` wrapper 광범위 적용 시 자식 영역 차단 검토
- [ ] Source caption 모든 카드/차트 명시
- [ ] 박-단어 (박음/박힘/박는/박지/박을) 자가 grep = 0건 (사용자 노출 영역)
- [ ] AI 임의 혜택 (%/원/쿠폰/무료) 0건 — `[직접 작성해주세요]` placeholder
