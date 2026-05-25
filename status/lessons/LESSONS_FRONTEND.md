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

---

## 사고 이력

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
