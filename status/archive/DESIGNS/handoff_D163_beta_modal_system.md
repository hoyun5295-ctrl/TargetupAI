# Handoff — D163 베타 안내 시스템 인프라

> **진입 명령:** `status/handoff_D163_beta_modal_system.md 정독 + memory/project_d162_5_braze_grade_roadmap_kickoff.md 정독 + Step A-D 박음`
>
> **선행 조건:** D162-4 잔존(직접타겟발송 검증 + AlimtalkSendModal 수신자 리스트 수정) 종결. Harold님 신고 우선.

---

## 목적

Braze급 SaaS 9 세션 분할(D163~D171) 첫 진입 = **ENTERPRISE+ 베타 게이팅 + 아주 예쁜 안내 모달**. 검증 안 된 베타 기능을 무료체험에 활성화하면 사고 위험이라 ENT+ 한정 활성. 일반 사용자는 헤더 메뉴 + BetaFeatureModal로 "곧 어마어마한 기능 옵니다" 마케팅 효과 동시.

## 변경 파일 4건

### Step A — backend/utils/plan-guard.ts (CT-17 함수 신설)

위치: `packages/backend/src/utils/plan-guard.ts` L184 `// 기능별 체크 — canUseFeature` 위 또는 L183 직후 헬퍼 영역.

```typescript
// ═══════════════════════════════════════════════════════════
// 베타 기능 접근 판정 (D163 신설)
// ═══════════════════════════════════════════════════════════

/**
 * Braze급 베타 기능 접근 허용 여부.
 *
 * 정책 (D162-5 Harold님 확정):
 *   - ENTERPRISE / BUSINESS = 베타 기능 실제 진입 허용
 *   - 그 외 (TRIAL/FREE/STARTER/BASIC/PRO) = BetaFeatureModal 표시
 *
 * 안정성 검증 후 단계적 확장 예정 (PRO → BASIC).
 */
export function isBetaAccessAllowed(ctx: PlanContext): boolean {
  return ctx.planCode === 'ENTERPRISE' || ctx.planCode === 'BUSINESS';
}
```

### Step B — frontend/components/BetaFeatureModal.tsx (신규)

위치: `packages/frontend/src/components/BetaFeatureModal.tsx`

**디자인 가이드 (Harold님 명시 "아주 예쁘게"):**

- **배경:** `bg-gradient-to-br from-indigo-950 via-purple-950 to-fuchsia-950`
- **Backdrop:** `fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4`
- **모달 컨테이너:** `relative max-w-5xl w-full max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 shadow-2xl bg-gradient-to-br from-indigo-950 via-purple-950 to-fuchsia-950`
- **글래스 패널:** 내부 카드는 `bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl`
- **헤더 영역:**
  - 좌측: `<Sparkles className="text-amber-300" />` + 그라데이션 텍스트 (`bg-gradient-to-r from-amber-200 via-fuchsia-200 to-indigo-200 bg-clip-text text-transparent`) "곧 만나실 어마어마한 기능들"
  - 우측: 닫기 X 버튼 (`text-white/60 hover:text-white`)
  - 서브타이틀: "현재 베타테스트 진행 중 · 출시 예정 2026 Q3" + progress bar (`h-1.5 bg-white/10 rounded-full` + inner `bg-gradient-to-r from-amber-400 to-fuchsia-400 w-[35%]`)
- **7 엔진 카드 그리드** (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`):
  | 카드 | Lucide 아이콘 | 그라데이션 | 제목 | 설명 (50자 이내) |
  |------|--------------|-----------|------|------------------|
  | 1 | Target | from-rose-400 to-pink-500 | AI 타겟 엔진 | 자연어 한 줄로 고객군 자동 추출 + SQL 검증 loop |
  | 2 | MessageSquare | from-amber-400 to-orange-500 | AI 메시지 엔진 | 채널별 A/B 문구 + 스팸 검수 + 톤 자동 조절 |
  | 3 | Send | from-emerald-400 to-teal-500 | 채널 의사결정 | 고객별 최적 채널·시점·빈도 AI 자동 판단 |
  | 4 | Workflow | from-cyan-400 to-blue-500 | 여정 자동화 | 가입/재구매/휴면/생일 여정 AI 자동 설계 |
  | 5 | Zap | from-violet-400 to-purple-500 | 실시간 트리거 | 장바구니/예약/구매 이벤트 즉시 자동 발송 |
  | 6 | LineChart | from-fuchsia-400 to-pink-500 | 성과 + Next Action | 매출/ROI/LTV + 다음 캠페인 AI 자동 제안 |
  | 7 | Brain | from-amber-400 to-rose-500 | AI Operator | 6 sub-agent 협업 + 회사별 메모리 학습 |
- **각 카드 구조:** 아이콘 그라데이션 배경 (`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center` + 흰색 아이콘) + 제목 (`text-white font-semibold`) + 설명 (`text-white/70 text-sm`)
- **하단 CTA 영역:**
  - Primary: "엔터프라이즈 문의하기" (`bg-gradient-to-r from-amber-400 to-fuchsia-400 text-indigo-950 font-semibold px-8 py-3 rounded-xl hover:brightness-110`)
  - Secondary: "출시 알림 신청" (`bg-white/10 text-white px-8 py-3 rounded-xl hover:bg-white/20 border border-white/20`)
- **애니메이션:** modal `animate-in fade-in zoom-in-95 duration-300` + 카드별 stagger (`style={{ animationDelay: '${i*50}ms' }}` + `animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both`)
- **호버 효과:** 카드 `hover:bg-white/10 hover:scale-[1.02] transition-all`

**Props:** `{ show: boolean; onClose: () => void }`

### Step C — frontend/components/DashboardHeader.tsx (메뉴 추가)

위치: `packages/frontend/src/components/DashboardHeader.tsx`

신규 메뉴 항목 추가:
- 라벨: **"AI Operator"** (또는 Harold님 명시 시 변경)
- 아이콘: `Sparkles` (lucide-react) — amber 톤
- 위치: 기존 헤더 메뉴 우측 끝 (영구 노출, 등급 무관)
- 뱃지: "BETA" 작은 라벨 (`text-[10px] px-1.5 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-fuchsia-400 text-indigo-950 font-bold`)

### Step D — frontend/pages/Dashboard.tsx (가드 + 통합)

- BetaFeatureModal import 추가
- state: `const [showBetaModal, setShowBetaModal] = useState(false);`
- 메뉴 클릭 핸들러:
  ```typescript
  const handleAiOperatorClick = () => {
    const planCode = (user as any)?.company?.planCode || planInfo?.plan_code;
    if (planCode === 'ENTERPRISE' || planCode === 'BUSINESS') {
      navigate('/ai-operator');  // D164 진입점 (다음 세션)
    } else {
      setShowBetaModal(true);
    }
  };
  ```
- 렌더링: `<BetaFeatureModal show={showBetaModal} onClose={() => setShowBetaModal(false)} />`

## 검증 절차

1. **tsc 0 errors 확인** (backend + frontend 양쪽)
2. **로컬 동작 검증:**
   - TRIAL/FREE/STARTER/BASIC/PRO 등급 = 헤더 "AI Operator" 클릭 → BetaFeatureModal 표시
   - ENTERPRISE/BUSINESS 등급 = `/ai-operator` 라우트 진입 (D164 박힐 곳, 지금은 placeholder 페이지 OK)
3. **디자인 검증:** Harold님 명시 "아주 예쁜 디자인" 정합 확인 — 그라데이션/글래스모피즘/애니메이션/카드 hover 자연스러움
4. **atomic safe-build (`npm run build:safe`)** — frontend 단독 빌드 가능 (backend는 plan-guard 함수 추가만이라 영향 작음)
5. **반응형:** 모바일 (sm) / 태블릿 (md) / 데스크탑 (lg) 모두 정합

## D164 진입점 예고

D163 종결 후 D164 = `/ai-operator` 페이지 신설:
- 무료체험 진입 wizard (ENT+ 한정 실제 동작)
- 자연어 입력창 main hero 위치
- AiGuidePopup 재활용

## 금지 사항

- ✗ "휴머스온" 키워드 노출 (feedback_no_humuson_keyword_exposure.md)
- ✗ ENT+ 외 등급에서 실제 기능 진입 (게이팅 우회 금지)
- ✗ BetaFeatureModal 외부 의존성 (icons는 lucide-react만 사용, 외부 lottie/svg 별도 임포트 X)
- ✗ tp-deploy-full 사용 (atomic safe-build = `npm run build:safe`만)
