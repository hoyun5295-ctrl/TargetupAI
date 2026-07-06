# LESSONS — Frontend / UI / 모달 / 모바일 / 모델명 노출 사고

> **참조**: Frontend 페이지/컴포넌트/모달 작성 / UI 노출 영역 작업 시 우선 정독.
> **원본**: 옛 `LESSONS_LEARNED.md` §3 안 UI 관련 사고 분할 (D215+ 도메인 분할 — 2026-05-24).

---

## 핵심 원칙

- **모델명 UI 노출 절대 금지** — Opus / Sonnet / GPT / Claude 단어 Frontend grep = 0건 (D190-fix1 + D214+ 반복 사고)
- **native dialog 절대 금지** — alert / confirm / prompt 0건. ConfirmModal + useToast 의무 (D211+ + D212+)
- **모바일 반응형 default** — `@media (max-width: 767px)` 매트릭스 항상 박을 것 (D186)
- **대량 처리 사용자 안내** — 5초+ 작업 영역 = 로딩 오버레이 + close 차단 + disabled 의무 (D185)
- **CSS pointer-events-none + select-none wrapper 광범위 X** — 자식 textarea/scroll/copy 차단 사고 (D188)
- **모달 z-index 티어 통일** (2026-06-25) — 앱 모달 z-[55]~[140] / DM `ModalBase` 1000(outlier) / **확인·차단 인터럽트 모달 = z-[2000]**(ConfirmModal·CreditConfirmModal·CustomerDataGate) / 시스템 9997~99999. 인터럽트 모달이 자신을 띄운 모달보다 z-index 낮으면 뒤로 깔림 — 새 확인/차단 모달은 z-[2000] 의무.

---

## 사고 이력

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
