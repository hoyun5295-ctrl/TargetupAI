# 한줄로 매뉴얼 — Claude Design 마스터 프롬프트

> **작성일**: 2026-05-27
> **활용 흐름**: Harold 직접 Claude Design (Anthropic Labs) 호출 시 복붙
> **입력 자료**: `docs/manual/manual-content-v2.md` (9 카테고리 매뉴얼 본문)
> **출력 흐름**: 다크 톤 + 보라 그라데이션 매뉴얼 HTML 단일 파일

---

## 마스터 프롬프트 (복붙 영역)

```markdown
당신은 사용자 매뉴얼 페이지 디자이너입니다. 마케팅 자동화 SaaS의 사용자 매뉴얼을 디자인합니다.

═══════════════════════════════════════
[디자인 톤 표준 — 톤 다운 정합 (직원 "어둡다" 신고 본질 차단)]
═══════════════════════════════════════

배경:
- bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900
- 매뉴얼 영역 = 가독성 우선 + 보라 톤 일부 + 톤 다운 흐름

sticky 헤더:
- bg-violet-800/50 backdrop-blur-md border-b border-violet-400/30
- 좌측: 그라데이션 아이콘 (violet→fuchsia 10x10 rounded-xl) + 서비스명 + 매뉴얼 배지
- 우측: 매뉴얼 검색 input + 닫기 (대시보드로 돌아가기 link)

좌측 사이드바:
- bg-violet-800/40 backdrop-blur (직전 slate-900/40 → violet-800/40 톤 다운)
- 9 카테고리 목록 (각 number + 라벨)
- active 상태 = violet 그라데이션 배경 + 흰 텍스트
- hover = 부드러운 violet 배경 변화

메인 컨텐츠:
- max-w-4xl 중앙 정렬
- 챕터별 활성 표시 (한 번에 한 챕터만)
- 챕터 간 페이지네이션 (이전/다음 버튼)

챕터 헤더:
- chapter-num (small caps "CHAPTER 01" — violet-300)
- chapter-title (text-3xl font-semibold + 흰 텍스트)
- chapter-sub (text-white/50 보조 안내)
- 하단 violet 그라데이션 border 라인

단계 카드 (.step):
- bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-transparent
- border border-violet-400/20
- hover:border-violet-400/40 transition-colors (translate X / shadow X — 미니멀)
- p-5 + gap-4 충분한 여백
- step-num = 그라데이션 박스 + 흰 번호

step-num 컬러 매트릭스 (의미별 액센트):
- 기본 = violet → fuchsia 그라데이션
- amber (검증) = amber → orange 그라데이션
- emerald (성공) = emerald → teal 그라데이션
- rose (위험) = rose → pink 그라데이션
- cyan (정보) = cyan → blue 그라데이션
- slate (정적) = slate → gray 그라데이션

Tip / Warn / Info 박스:
- Tip = bg-emerald-500/10 + border-emerald-400/30 + text-emerald-200 + Lightbulb 아이콘
- Warn = bg-amber-500/10 + border-amber-400/30 + text-amber-200 + AlertTriangle 아이콘
- Info = bg-violet-500/10 + border-violet-400/30 + text-violet-200 + Info 아이콘
- rounded-xl + p-4 + 가독성 충분한 line-height

표 (spec):
- bg-white/5 border border-white/10 rounded-xl overflow-hidden
- th = bg-white/10 + text-white/70 font-semibold
- td = border-b border-white/10 + text-white/80
- code 영역 = bg-violet-500/10 + text-violet-200 rounded px-1.5 py-0.5

이미지 카드 (.shot):
- bg-slate-900/50 + border-violet-400/20 + rounded-xl overflow-hidden
- max-w-720px + shadow-2xl shadow-violet-500/10
- hover:border-violet-400/40 (cursor: zoom-in)
- 클릭 = 라이트박스 진입 (원본 크기 풀스크린)

라이트박스 (이미지 확대):
- fixed inset-0 + bg-black/90 backdrop-blur-md
- 중앙 이미지 max-width 96vw / max-height 92vh
- 우상단 닫기 버튼 (rounded-full bg-white/10)
- ESC / 배경 클릭 / × 버튼 = 닫기

폰트:
- Pretendard Variable (한글) + system-ui (영문)
- font-feature-settings: "ss01", "ss02"
- weight: font-semibold (extrabold X) + font-medium (보조)

텍스트 컬러 (가독성 강화 — 직전 톤 정정):
- 본문 = text-white/95 (직전 90 → 95 강화)
- 보조 = text-white/80 (직전 60 → 80 강화)
- caption = text-white/55 (직전 40 → 55 강화 — 40 이하 금지 의무)
- 강조 = text-violet-200 또는 text-fuchsia-200 (직전 300 → 200 강화)

페이지네이션 (이전/다음):
- bg-violet-500/10 + border-violet-400/30 + rounded-xl
- hover:bg-violet-500/20 + border-violet-400/50
- nav-label = text-violet-300 font-mono small caps
- nav-title = text-white font-semibold

═══════════════════════════════════════
[필수 인터랙션 흐름]
═══════════════════════════════════════

1. 챕터 페이지네이션
- 좌측 사이드바 클릭 = 활성 챕터 전환 (다른 챕터 숨김)
- 키보드 좌우 화살표 = 이전/다음 챕터
- URL hash 동기 (예: #ch3)

2. 모바일 사이드바
- max-md 영역에서 사이드바 = fixed 좌측 슬라이드
- 햄버거 메뉴 버튼 = sidebar.classList.toggle('open')
- 본문 클릭 = 사이드바 자동 닫힘

3. 라이트박스
- .shot 클릭 = 원본 이미지 확대 표시
- ESC / 배경 클릭 / × 버튼 = 닫기
- 본문 스크롤 차단 (overflow:hidden)

4. 사이드바 검색
- 매뉴얼 본문 fuzzy 검색
- 키워드 매칭 챕터 강조 표시
- 검색 결과 0건 시 안내 메시지

═══════════════════════════════════════
[필수 보안 흐름 (절대 의무)]
═══════════════════════════════════════

1. 세션 검증 (스크립트 안 활용 영역):
```javascript
(function () {
  var token = localStorage.getItem('token');
  if (!token) { location.replace('/'); return; }
  fetch('/api/companies/my-plan', {
    headers: { Authorization: 'Bearer ' + token },
    cache: 'no-store'
  }).then(function (r) {
    if (!r.ok) throw new Error('unauth');
  }).catch(function () {
    localStorage.removeItem('token');
    location.replace('/');
  });
})();
```

2. DevTools 열림 감지 + 콘텐츠 블러:
```javascript
(function () {
  var threshold = 200;
  var blurred = false;
  function check() {
    var open = (window.outerWidth - window.innerWidth > threshold) ||
               (window.outerHeight - window.innerHeight > threshold);
    if (open && !blurred) {
      document.documentElement.style.filter = 'blur(24px)';
      document.documentElement.style.pointerEvents = 'none';
      blurred = true;
    } else if (!open && blurred) {
      document.documentElement.style.filter = '';
      document.documentElement.style.pointerEvents = '';
      blurred = false;
    }
  }
  setInterval(check, 800);
  window.addEventListener('resize', check);
})();
```

3. 인쇄 / 저장 / 개발자도구 차단:
```javascript
(function () {
  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase();
    if (e.ctrlKey && (k === 'p' || k === 's' || k === 'u')) { e.preventDefault(); e.stopPropagation(); return false; }
    if (e.key === 'F12') { e.preventDefault(); return false; }
    if (e.ctrlKey && e.shiftKey && (k === 'i' || k === 'j' || k === 'c' || k === 'p')) { e.preventDefault(); return false; }
  }, true);
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.print = function () { return false; };
})();
```

4. CSS 보안 흐름:
- 텍스트 드래그 선택 차단: user-select:none
- 이미지 드래그 / 길게 누르기 차단: user-drag:none + pointer-events:none
- 인쇄 / PDF 변환 차단: @media print { body * { display:none !important; } body::before { content:"인쇄 및 PDF 저장은 허용되지 않습니다."; ... } }

5. 메타 태그:
```html
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex" />
<meta name="referrer" content="strict-origin-when-cross-origin" />
```

═══════════════════════════════════════
[입력 자료]
═══════════════════════════════════════

9 카테고리 매뉴얼 본문 (별 첨부):

1. 시작하기 — 메인 대시보드
2. 고객 데이터 관리
3. AI 자동발송
4. 직접발송
5. 직접 타겟 발송
6. 자동발송 (BETA)
7. 세그먼트
8. 발송 결과 & 분석
9. 부가 기능 (템플릿 · 수신거부 · 예약)

각 카테고리 안 단계별 가이드 + 사용자 흐름 + Tip / Warn / Info 박스 매트릭스.

═══════════════════════════════════════
[출력 형식]
═══════════════════════════════════════

- 단일 HTML 파일 (외부 의존 최소 — Tailwind CDN + Pretendard CDN만)
- React 활용 X (vanilla JS + Tailwind)
- 모바일 반응형 100% 작동
- 위 보안 흐름 5건 전수 통합
- 좌측 사이드바 + 메인 컨텐츠 + 챕터 페이지네이션 흐름
- 라이트박스 흐름 (이미지 확대)
- 키보드 좌우 화살표 / ESC 단축키

═══════════════════════════════════════
[금지 영역]
═══════════════════════════════════════

- 이모지 사용 X (lucide-react 또는 SVG inline 아이콘만)
- alert / confirm / prompt 사용 X (필요 시 커스텀 모달)
- 외부 link (Notion / Google Docs 등) X — 본 단일 HTML 안에서 모든 흐름 종결
- 흰 톤 영역 X — 메시지 영역 흰 톤만 예외 (실제 폰 시각 보존 흐름 시)
- 그라데이션 텍스트 (bg-clip-text from-white to-color-200) X — 미니멀 단색 흐름
- font-extrabold X — font-semibold 단일 흐름
- blur 원 효과 (absolute -top-6 -right-6 blur-2xl) X — 시각 노이즈 차단
- hover lift (translate / shadow 강조) X — 단순 색상 변화만

═══════════════════════════════════════
[추가 강조]
═══════════════════════════════════════

- 가독성 강화 = 정보 밀도 + 폰트 weight + 여백 균형 (직원 피드백 정합 — "어둡고 보기 힘들다" 차단 흐름)
- 보라 그라데이션 톤 = 깊이감 + 임팩트 + 차별점 (기존 블랙톤 단순 흐름 차단)
- AI 자동발송 영역 강조 = 가장 큰 카드 + 색상 임팩트 + 본 서비스 차별점 명확 표현
- 모바일 사용자 = 사이드바 슬라이드 + 본문 자동 풀스크린 + 가독성 보장

═══════════════════════════════════════
[참고 디자인 흐름]
═══════════════════════════════════════

- Linear (linear.app) 미니멀 흐름
- Notion 깔끔 사이드바 + 본문 흐름
- Vercel Dashboard 다크 톤 + 그라데이션 액센트 흐름
- 본 서비스 AI Operator 메인 페이지 (보라 그라데이션 + 큰 카드 흐름)
- 본 서비스 Journey Builder 페이지 (다크 톤 + 자연어 입력 + 빠른 시작 카드 흐름)

═══════════════════════════════════════

위 매트릭스 100% 정합 + 9 카테고리 매뉴얼 본문 통합 + 보안 흐름 5건 통합 + 모바일 반응형 + 키보드 단축키 + 라이트박스 흐름 = 단일 HTML 파일 출력해주세요.
```

---

## 활용 흐름

### Step 1 — Harold 본 PC에서 Claude Design 호출
- Anthropic Labs Claude Design (Research Preview) 접속
- 신규 프로젝트 생성

### Step 2 — 위 마스터 프롬프트 복붙
- 본 `.md` 파일 안 "마스터 프롬프트 (복붙 영역)" 블록 전체 복사
- Claude Design 입력창 붙여넣기

### Step 3 — 매뉴얼 본문 첨부
- `docs/manual/manual-content-v2.md` 파일 전체 복사
- Claude Design 두 번째 메시지로 첨부 (또는 첨부 파일 형식)

### Step 4 — Claude Design 출력 HTML 수령
- 단일 HTML 파일 출력
- 다운로드 또는 복사

### Step 5 — 기존 매뉴얼 정정 또는 신규 라우트
- 기존 `packages/frontend/public/manual/manual.html` 정정 (기존 흐름 그대로 정정)
- 또는 신규 `/manual` 라우트 신설 (React 컴포넌트 변환 의무)

### Step 6 — 헤더 매뉴얼 메뉴 진입 흐름 정합
- DashboardHeader 안 매뉴얼 메뉴 추가 (`/manual/manual.html` 또는 `/manual` 진입)
- 기존 footer 매뉴얼 link 정리 (제거 또는 유지)

### Step 7 — 운영 검증 (Harold + 직원 직접)
- 신규 매뉴얼 시각 확인
- 직원 피드백 수렴
- 정정 영역 있으면 재 Claude Design 호출

---

## 정정 흐름 (재호출 시)

신규 매뉴얼 HTML 정정 의무 시:

1. 본 마스터 프롬프트 안 정정 영역 명시 (예: "단계 카드 padding을 더 크게 정정 / 이미지 카드 max-width 줄이기")
2. Claude Design 재 호출
3. 신규 HTML 수령

---

## 본 마스터 프롬프트 정합 매트릭스

- [x] 민감 정보 (도메인 / 사용자 매트릭스 / 회사 정보) 노출 X
- [x] 박-단어 / D219+ 영구 룰 단어 / 모델명 0건
- [x] 디자인 톤 매트릭스 명시 (배경 + 헤더 + 카드 + 색상 + 폰트)
- [x] 보안 흐름 5건 명시 (세션 검증 + DevTools 차단 + 인쇄 차단 + 이미지 드래그 차단 + 메타 태그)
- [x] 인터랙션 흐름 명시 (페이지네이션 + 모바일 사이드바 + 라이트박스 + 검색)
- [x] 출력 형식 명시 (단일 HTML + Tailwind CDN + Pretendard + 모바일 반응형)
- [x] 금지 영역 명시 (이모지 / native dialog / 외부 link / 흰 톤 / 그라데이션 텍스트 / extrabold / blur 원 / hover lift)

---

> **본 마스터 프롬프트 종결.** Harold 직접 Claude Design 호출 시 복붙 → 신규 매뉴얼 HTML 수령 흐름.
