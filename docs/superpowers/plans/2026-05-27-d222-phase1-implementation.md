# D222+ Phase 1 Dashboard 전면 정정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard 전면 정정 (헤더 nav + 메인 카드 3건 색감 시프트 + DB 현황 본격 전면 수정 + 기존 캠페인/발송 탭 + 하단 4 카드 삭제) + AiOperatorPage 보라 톤 다운 + 시인성 강화 정정.

**Architecture:** AI 11 페이지만 보라 그라데이션 톤 다운 통일 / Dashboard + 기존 흰 톤 페이지 그대로 유지 (직원 의견 + 본 AI 분석 수렴). 신규 backend endpoint 2건 (customer-trend + customer-distribution) + recharts (이미 설치 ^3.8.1) 활용 시계열 + 도넛 차트.

**Tech Stack:** React + TypeScript + Tailwind CSS + recharts (frontend) / Express + PostgreSQL (backend). 핸드오프 spec = `docs/superpowers/specs/2026-05-27-d222-phase1-dashboard-design.md` 정합.

---

## File Structure

| 파일 | 작업 | 책임 |
|---|---|---|
| `packages/backend/src/routes/dashboard.ts` | **신규** | customer-trend (시계열) + customer-distribution (등급/채널) 2 endpoint |
| `packages/backend/src/app.ts` | 수정 | dashboard 라우터 등록 |
| `packages/frontend/src/components/DashboardHeader.tsx` | 수정 | AI Operator 메뉴 제거 + 매뉴얼 NEW 추가 + 세그먼트 violet 정정 + newBadge 분기 |
| `packages/frontend/src/pages/Dashboard.tsx` | 수정 | 메인 카드 3건 색감 시프트 + AiSendTypeModal 폐기 + 기존 캠페인/발송 탭 + 하단 4 카드 삭제 + DB 현황 본격 전면 수정 + footer link 색상 |
| `packages/frontend/src/pages/AiOperatorPage.tsx` | 수정 | 보라 톤 다운 (indigo-950 → violet-900) + 시인성 강화 (text-white/85 → /95, /40 → /55) |

---

## Task 1: Backend 신규 routes/dashboard.ts 작성 + 라우터 등록

**Files:**
- Create: `packages/backend/src/routes/dashboard.ts`
- Modify: `packages/backend/src/app.ts`

- [ ] **Step 1: routes/dashboard.ts 신규 작성**

```typescript
// packages/backend/src/routes/dashboard.ts
import { Router } from 'express';
import { pgPool } from '../db/pg';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// 등급 분포 색상 매핑 (frontend 매핑 정합)
const TIER_COLORS = ['#8b5cf6', '#d946ef', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#a855f7'];

/**
 * GET /api/dashboard/customer-trend?days=30
 * 30일 추이 시계열 (line chart) + 30일 대비 델타
 */
router.get('/customer-trend', authMiddleware, async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 90);
  const companyId = (req as any).user.companyId;
  try {
    // 일별 추이
    const trendR = await pgPool.query(
      `SELECT
         date_trunc('day', created_at)::date::text AS date,
         COUNT(*)                                  AS total,
         COUNT(*) FILTER (WHERE sms_opt_in = true) AS "optIn",
         COUNT(*) FILTER (WHERE is_unsubscribed = true) AS "optOut"
       FROM customers
       WHERE company_id = $1
         AND created_at >= NOW() - ($2 || ' days')::INTERVAL
       GROUP BY 1
       ORDER BY 1`,
      [companyId, days]
    );

    // 델타 계산 — 직전 N일 vs 그 이전 N일
    const deltaR = await pgPool.query(
      `WITH cur AS (
         SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE sms_opt_in = true) AS opt_in,
           COUNT(*) FILTER (WHERE is_unsubscribed = true) AS opt_out
         FROM customers
         WHERE company_id = $1
           AND created_at >= NOW() - ($2 || ' days')::INTERVAL
       ),
       prev AS (
         SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE sms_opt_in = true) AS opt_in,
           COUNT(*) FILTER (WHERE is_unsubscribed = true) AS opt_out
         FROM customers
         WHERE company_id = $1
           AND created_at >= NOW() - ($2 || ' days')::INTERVAL * 2
           AND created_at < NOW() - ($2 || ' days')::INTERVAL
       )
       SELECT
         cur.total AS cur_total, prev.total AS prev_total,
         cur.opt_in AS cur_opt_in, prev.opt_in AS prev_opt_in,
         cur.opt_out AS cur_opt_out, prev.opt_out AS prev_opt_out
       FROM cur, prev`,
      [companyId, days]
    );

    const d = deltaR.rows[0] || {};
    const pctDelta = (cur: number, prev: number) =>
      prev > 0 ? Number(((cur - prev) / prev * 100).toFixed(1)) : null;

    const deltas = {
      totalDelta30: pctDelta(Number(d.cur_total), Number(d.prev_total)),
      optInDelta30: pctDelta(Number(d.cur_opt_in), Number(d.prev_opt_in)),
      optOutDelta30: pctDelta(Number(d.cur_opt_out), Number(d.prev_opt_out)),
      activeRateDelta30: null as number | null,
    };
    // 활성도 (옵트인 / 전체) 델타
    if (Number(d.cur_total) > 0 && Number(d.prev_total) > 0) {
      const curRate = Number(d.cur_opt_in) / Number(d.cur_total) * 100;
      const prevRate = Number(d.prev_opt_in) / Number(d.prev_total) * 100;
      deltas.activeRateDelta30 = Number((curRate - prevRate).toFixed(1));
    }

    res.json({ success: true, trend: trendR.rows, deltas });
  } catch (err: any) {
    // DB ALTER 안전망 (LESSONS_META 4-25 정합)
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 ALTER 실행 요청 의무',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('[dashboard/customer-trend] 오류:', err);
    res.status(500).json({ success: false, error: err.message || '추이 조회 실패' });
  }
});

/**
 * GET /api/dashboard/customer-distribution
 * 등급/채널 분포 (donut chart)
 */
router.get('/customer-distribution', authMiddleware, async (req, res) => {
  const companyId = (req as any).user.companyId;
  try {
    // 등급 분포
    const tiersR = await pgPool.query(
      `SELECT
         COALESCE(NULLIF(grade, ''), '미분류') AS label,
         COUNT(*) AS value
       FROM customers
       WHERE company_id = $1
       GROUP BY 1
       ORDER BY 2 DESC
       LIMIT 8`,
      [companyId]
    );

    // 채널 분포
    const channelsR = await pgPool.query(
      `SELECT
         SUM(CASE WHEN sms_opt_in = true THEN 1 ELSE 0 END)::int AS sms,
         SUM(CASE WHEN kakao_opt_in = true THEN 1 ELSE 0 END)::int AS kakao,
         SUM(CASE WHEN email_opt_in = true THEN 1 ELSE 0 END)::int AS email
       FROM customers
       WHERE company_id = $1`,
      [companyId]
    );

    const channelRow = channelsR.rows[0] || { sms: 0, kakao: 0, email: 0 };

    res.json({
      success: true,
      tiers: tiersR.rows.map((r, i) => ({
        label: r.label,
        value: Number(r.value),
        color: TIER_COLORS[i % TIER_COLORS.length],
      })),
      channels: [
        { label: 'SMS', value: channelRow.sms, color: '#8b5cf6' },
        { label: 'KAKAO', value: channelRow.kakao, color: '#f59e0b' },
        { label: 'EMAIL', value: channelRow.email, color: '#06b6d4' },
      ],
    });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 ALTER 실행 요청 의무',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('[dashboard/customer-distribution] 오류:', err);
    res.status(500).json({ success: false, error: err.message || '분포 조회 실패' });
  }
});

export default router;
```

- [ ] **Step 2: app.ts 안 dashboard 라우터 등록**

`packages/backend/src/app.ts` 안 다른 라우터 등록 영역 정합 (예: `app.use('/api/customers', customersRouter)` 영역 직후):

```typescript
import dashboardRouter from './routes/dashboard';
// ...
app.use('/api/dashboard', dashboardRouter);
```

기존 import 영역 + 기존 app.use 영역 정합 — 충돌 X 의무.

- [ ] **Step 3: tsc 검증**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: EXIT_CODE=0 + 0 errors

- [ ] **Step 4: 자가 grep 검증 (박-단어/옛/진정/영영/모델명 0건)**

```bash
grep -nE "박[가-힣]|옛 |진정 |영영|Opus|Sonnet|Claude|Anthropic|GPT" packages/backend/src/routes/dashboard.ts
```

Expected: 0건

---

## Task 2: DashboardHeader 메뉴 변경 + NEW 배지 추가

**Files:**
- Modify: `packages/frontend/src/components/DashboardHeader.tsx:36-44` (MenuItem interface)
- Modify: `packages/frontend/src/components/DashboardHeader.tsx:100-150` (메뉴 list)
- Modify: `packages/frontend/src/components/DashboardHeader.tsx:194-216` (메뉴 렌더링)

- [ ] **Step 1: MenuItem interface 안 newBadge 추가**

기존 `interface MenuItem` (line 36~44) — `betaBadge?: boolean;` 직후 추가:

```typescript
interface MenuItem {
  label: string;
  onClick: () => void;
  color: MenuColor;
  emphasized?: boolean;
  locked?: boolean;
  betaBadge?: boolean;
  newBadge?: boolean; // ★ D222+ Phase 1 (2026-05-27): NEW 배지 — 매뉴얼 메뉴 영역
  path?: string;
}
```

- [ ] **Step 2: 메뉴 list 정정 — AI Operator 제거 + 매뉴얼 NEW 추가 + 세그먼트 violet**

기존 `menuItems` 배열 (line 100~150) — 다음 정정:

```typescript
const menuItems: MenuItem[] = [
  // ★ D222+ Phase 1 (2026-05-27): AI Operator 메뉴 영구 제거
  //   → Dashboard 메인 카드 단일 진입 흐름 정합 (AiSendTypeModal 영구 폐기 동시).
  // ★ D222+ Phase 1 (2026-05-27): 매뉴얼 메뉴 신규 추가 — NEW 배지 violet 톤
  {
    label: '매뉴얼',
    onClick: () => window.open('/manual/manual.html', '_blank'),
    color: 'beta',
    newBadge: true,
  },
  {
    label: '카카오&RCS',
    onClick: () => enterpriseGuard('카카오 & RCS', '알림톡 템플릿 · 브랜드메시지 · RCS 통합 관리 기능입니다.',
      () => navigate('/kakao-rcs')),
    color: 'green',
    locked: isEnterpriseLocked,
    path: '/kakao-rcs',
  },
  { label: '직접발송', onClick: onDirectSend, color: 'green', path: '/' },
  // ★ D222+ Phase 1 (2026-05-27): 세그먼트 메뉴 color 'gold' → 'beta' (violet 액센트 정합)
  {
    label: '세그먼트',
    onClick: () => {
      if (aiMessagingEnabled === false) {
        onFeatureLocked?.('고객 세그먼트', '베이직');
        return;
      }
      navigate('/segments');
    },
    color: 'beta',
    locked: aiMessagingEnabled === false,
    path: '/segments',
  },
  { label: '발송결과', onClick: onResults, color: 'green', path: '/' },
  { label: '수신거부', onClick: () => navigate('/unsubscribes'), color: 'gold', path: '/unsubscribes' },
  { label: '설정', onClick: () => navigate('/settings'), color: 'green', path: '/settings' },
  ...(isCompanyAdmin
    ? [{ label: '관리', onClick: () => navigate('/manage'), color: 'gold' as MenuColor, path: '/manage' }]
    : []),
  { label: '로그아웃', onClick: onLogout, color: 'gray' as MenuColor },
];
```

기존 첫 영역 (`...(onAiOperatorClick ? [{ label: 'AI Operator', ... }] : [])`) = 영구 제거 의무.

- [ ] **Step 3: 메뉴 렌더링 영역 NEW 배지 출력 분기 추가**

기존 메뉴 렌더링 (line 194~216) — `{item.betaBadge && (...)}` 직후 추가:

```typescript
{item.betaBadge && (
  <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-fuchsia-500 text-white shadow-sm">
    BETA
  </span>
)}
{item.newBadge && (
  <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-sm">
    NEW
  </span>
)}
```

- [ ] **Step 4: tsc 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: EXIT_CODE=0 + 0 errors

- [ ] **Step 5: 자가 grep 검증**

```bash
grep -nE "박[가-힣]|옛 |진정 |영영|Opus|Sonnet|Claude|Anthropic|GPT" packages/frontend/src/components/DashboardHeader.tsx
grep -nE "alert\(|confirm\(|prompt\(" packages/frontend/src/components/DashboardHeader.tsx
```

Expected: 0건

---

## Task 3: Dashboard 기존 캠페인/발송 탭 + 하단 4 카드 + activeTab state 전수 삭제

**Files:**
- Modify: `packages/frontend/src/pages/Dashboard.tsx`

본 task = 큰 영역 삭제 (line 2740~2998 영역 — 약 260 라인 제거 + state 정리).

- [ ] **Step 1: activeTab state + setActiveTab 호출 영역 제거**

기존 line 186 `const [activeTab, setActiveTab] = useState<'target' | 'campaign' | 'send'>('target');` 영역 제거.

기존 `setActiveTab(...)` 호출 영역 grep + 모두 제거:

```bash
grep -nE "setActiveTab|activeTab" packages/frontend/src/pages/Dashboard.tsx
```

발견 영역 모두 정리.

- [ ] **Step 2: 기존 탭 영역 전수 삭제 (line 2740~2998 영역)**

기존 `<div className="bg-transparent rounded-lg mb-4">` ~ `</div>` 전체 영역 (3 탭 + 5 카드 + 캠페인 폼 + 발송 영역) 전수 제거.

핵심 삭제 영역 매핑:
- 3 탭 헤더 (`<div className="flex border-b hidden">` ~ `</div>`)
- 'target' 탭 = 5 카드 (최근 캠페인 / AI 발송 템플릿 / AI 분석 / 예약 대기) 영구 폐기
- 'campaign' 탭 = 캠페인 폼 + AI 메시지 모달 영구 폐기
- 'send' 탭 = 단순 안내 영구 폐기

- [ ] **Step 3: 기존 모달 (showAiMessage / showPromptAlert 등) 영역 정리**

`'campaign'` 탭 내부 모달 영역 (`{showAiMessage && (...)}` 등) 영구 폐기. 관련 state (`showAiMessage` / `aiMessages` / `aiPrompt` / `campaign` / `campaignContext` 등) — 다른 영역 사용 X 확인 후 정리. 사용 영역 잔존 시 보존.

```bash
grep -nE "showAiMessage|aiMessages|campaignContext" packages/frontend/src/pages/Dashboard.tsx
```

- [ ] **Step 4: 기존 캠페인 진입 link (5 카드 영역) 호출 영역 정리**

```bash
grep -nE "loadRecentCampaigns|loadScheduledCampaigns|setShowTemplates|setShowAnalysis|setShowRecentCampaigns|setShowScheduled" packages/frontend/src/pages/Dashboard.tsx
```

→ Dashboard 안 5 카드 클릭 흐름 영구 폐기. 단 외부 호출 (예: 발송 완료 후 자동 새로고침 — `loadRecentCampaigns()` 영역) = 보존 의무.

- [ ] **Step 5: tsc 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: EXIT_CODE=0 + 0 errors (state 잔존 X 의무)

- [ ] **Step 6: 자가 grep 검증 — native dialog 잔존 0건**

```bash
grep -nE "alert\(|confirm\(|prompt\(" packages/frontend/src/pages/Dashboard.tsx
```

Expected: 0건 (기존 잔존 영역 발견 시 ConfirmModal + useToast 정합)

---

## Task 4: Dashboard 우측 40% 메인 카드 3건 색감 시프트

**Files:**
- Modify: `packages/frontend/src/pages/Dashboard.tsx:2643~2735` (메인 카드 3건 영역)

회사 로고 아이덴티티 정합 = AI Operator 보라 / 직접 타겟 발송 녹색 / 고객 DB 업로드 앰버.

- [ ] **Step 1: AI Operator 카드 (기존 AI 추천 발송) — 보라 그라데이션 + 라벨 정정**

기존 line 2646~2697 영역 (AI 추천 발송 카드) 정정:

```tsx
{/* ★ D222+ Phase 1 (2026-05-27): AI Operator 단일 진입 — 보라 그라데이션 + MAIN 배지 violet */}
<button
  onClick={async () => {
    if (isSubscriptionLocked) { setShowSubscriptionLock(true); return; }
    if (isAiMessagingLocked) { setPlanUpgradeFeature('AI Operator'); setPlanUpgradeRequired('베이직'); setShowPlanUpgradeModal(true); return; }
    // ★ D222+ Phase 1: AI Operator access 직접 호출 (AiSendTypeModal 폐기)
    try {
      const t = localStorage.getItem('token');
      const res = await fetch('/api/ai/operator/access', {
        headers: { Authorization: `Bearer ${t}` },
      });
      const data = await res.json();
      if (data.success && data.allowed) {
        navigate('/ai-operator');
      } else {
        setShowWalkthroughModal(true);
      }
    } catch {
      setShowWalkthroughModal(true);
    }
  }}
  disabled={aiLoading}
  className={`p-6 bg-gradient-to-br from-violet-600 via-fuchsia-600 to-purple-700 hover:shadow-xl hover:shadow-violet-500/50 hover:scale-[1.02] rounded-xl transition-all shadow-lg shadow-violet-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-right flex-1 flex flex-col justify-between relative group ${isSubscriptionLocked || isAiMessagingLocked ? 'opacity-60' : ''}`}
>
  <div className="absolute -top-2 right-3 bg-white text-violet-700 text-xs font-bold px-2 py-0.5 rounded-full shadow">
    MAIN
  </div>
  {aiLoading ? (
    <>
      <div>
        <div className="text-2xl font-bold text-white mb-1">AI 분석 중...</div>
        <div className="text-sm text-white/85 font-medium">잠시만 기다려주세요</div>
      </div>
      <div className="text-3xl text-white/60 self-end animate-pulse">…</div>
    </>
  ) : (
    <>
      <div>
        <div className="text-2xl font-bold text-white mb-1">{(isSubscriptionLocked || isAiMessagingLocked) ? '잠금 ' : ''}AI Operator</div>
        <div className="text-sm text-white/85 font-medium">자연어로 AI가 자동 설계</div>
      </div>
      <div className="text-3xl text-white/60 self-end group-hover:text-white group-hover:translate-x-1 transition-all">→</div>
    </>
  )}
</button>
```

이모지 제거 의무 (기존 `🔒` / `⏳` → 정상 텍스트 정합 — D215+ feedback_no_emoji 정합).

- [ ] **Step 2: 직접 타겟 발송 카드 — 녹색 그라데이션 (회사 로고)**

기존 line 2699~2714 영역 정정:

```tsx
{/* ★ D222+ Phase 1 (2026-05-27): 직접 타겟 발송 — 녹색 그라데이션 (회사 로고 아이덴티티) */}
<button
  onClick={() => {
    if (isSubscriptionLocked) { setShowSubscriptionLock(true); return; }
    if (isCustomerDbLocked) { setPlanUpgradeFeature('직접 타겟 발송'); setPlanUpgradeRequired('스타터'); setShowPlanUpgradeModal(true); return; }
    setShowDirectTargeting(true);
  }}
  className={`p-6 bg-gradient-to-br from-emerald-500 via-green-500 to-emerald-600 hover:shadow-xl hover:shadow-emerald-500/50 hover:scale-[1.02] rounded-xl transition-all shadow-lg shadow-emerald-500/30 text-right flex-1 flex flex-col justify-between group ${isSubscriptionLocked || isCustomerDbLocked ? 'opacity-60' : ''}`}
>
  <div>
    <div className="text-2xl font-bold text-white mb-1">{(isSubscriptionLocked || isCustomerDbLocked) ? '잠금 ' : ''}직접 타겟 발송</div>
    <div className="text-sm text-white/85 font-medium">원하는 고객을 직접 필터링</div>
  </div>
  <div className="text-3xl text-white/60 self-end group-hover:text-white group-hover:translate-x-1 transition-all">→</div>
</button>
```

- [ ] **Step 3: 고객 DB 업로드 카드 — 앰버 그라데이션**

기존 line 2716~2733 영역 정정:

```tsx
{/* ★ D222+ Phase 1 (2026-05-27): 고객 DB 업로드 — 앰버 그라데이션 (기존 직접 타겟 색감 시프트) */}
<button
  onClick={() => {
    if (syncBlockActive) { setShowSyncActiveBlock(true); return; }
    if (isSubscriptionLocked) { setShowSubscriptionLock(true); return; }
    if (isCustomerDbLocked) { setPlanUpgradeFeature('고객 DB 업로드'); setPlanUpgradeRequired('스타터'); setShowPlanUpgradeModal(true); return; }
    setShowFileUpload(true);
  }}
  className={`p-6 bg-gradient-to-br from-amber-500 via-orange-500 to-amber-600 hover:shadow-xl hover:shadow-amber-500/50 hover:scale-[1.02] rounded-xl transition-all shadow-lg shadow-amber-500/30 text-right flex-1 flex flex-col justify-between group ${isSubscriptionLocked || isCustomerDbLocked ? 'opacity-60' : ''}`}
>
  <div>
    <div className="text-2xl font-bold text-white mb-1">{(isSubscriptionLocked || isCustomerDbLocked) ? '잠금 ' : ''}고객 DB 업로드</div>
    <div className="text-sm text-white/85 font-medium">엑셀/CSV로 고객 추가</div>
  </div>
  <div className="text-3xl text-white/60 self-end group-hover:text-white group-hover:translate-x-1 transition-all">→</div>
</button>
```

- [ ] **Step 4: hideAi 영역 (DB 미설정 영역) 색감 정정**

기존 `{hideAi ? (...)` 영역 (line 2618~2641) — 직접 타겟 발송 + 고객 DB 업로드 단색 색감 = 그라데이션 영역 동일 정정 의무 (위 Step 2~3 색감 정합).

- [ ] **Step 5: tsc 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: EXIT_CODE=0 + 0 errors

- [ ] **Step 6: 자가 grep 검증 (이모지/박-단어/모델명)**

```bash
grep -nE "🔒|⏳|🎯|✨|박[가-힣]|옛 |Opus|Sonnet" packages/frontend/src/pages/Dashboard.tsx
```

Expected: 0건 (이모지 제거 정합)

---

## Task 5: Dashboard AiSendTypeModal 영구 폐기 + AI Operator 단일 진입

**Files:**
- Modify: `packages/frontend/src/pages/Dashboard.tsx`

- [ ] **Step 1: AiSendTypeModal import 제거**

기존 line 12 영역:

```typescript
import AiSendTypeModal from '../components/AiSendTypeModal';
```

→ 영구 제거.

- [ ] **Step 2: AiSendTypeModal JSX 영역 제거**

기존 line 2101 영역 + 모든 `<AiSendTypeModal ... />` 호출 영역 grep + 제거:

```bash
grep -nE "AiSendTypeModal|showAiSendType|setShowAiSendType" packages/frontend/src/pages/Dashboard.tsx
```

발견 영역 모두 정리.

- [ ] **Step 3: showAiSendType state 영구 폐기**

```typescript
const [showAiSendType, setShowAiSendType] = useState(false);
```

→ 영구 제거. 관련 setState 호출 영역 모두 정리.

- [ ] **Step 4: DashboardHeader 안 onAiOperatorClick prop 제거**

기존 line 2262~2281 (DashboardHeader props 안 `onAiOperatorClick` callback) = 영구 폐기. DashboardHeader 안 AI Operator 메뉴 제거 정합 (Task 2 Step 2).

- [ ] **Step 5: tsc 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: EXIT_CODE=0 + 0 errors

---

## Task 6: Dashboard 배경 + DB 현황 영역 컨테이너 보라 액센트

**Files:**
- Modify: `packages/frontend/src/pages/Dashboard.tsx:2062` (배경 wrapper)
- Modify: `packages/frontend/src/pages/Dashboard.tsx:2435` (DB 현황 헤더)

- [ ] **Step 1: 배경 wrapper 그대로 유지 (흰 톤 default)**

기존 line 2062 `<div className="min-h-screen bg-gray-100">` 영역 = 그대로 유지 (직원 의견 + 본 AI 분석 수렴 — 흰 톤 default 정합).

변경 X — 확인만 의무.

- [ ] **Step 2: DB 현황 헤더 색상 정정 (emerald → violet)**

기존 line 2435 `<div className="w-1 h-4 bg-green-600 rounded-full" />` 영역 정정:

```tsx
<div className="w-1 h-4 bg-violet-600 rounded-full" />
```

- [ ] **Step 3: tsc 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: EXIT_CODE=0 + 0 errors

---

## Task 7: Dashboard DB 현황 상단 4 mini metric 카드 신규 추가

**Files:**
- Modify: `packages/frontend/src/pages/Dashboard.tsx` (DB 현황 섹션 안 상단 영역)

DB 현황 헤더 직후 + 기존 동적 카드 그리드 직전 영역에 신규 4 mini metric + spark line 삽입.

- [ ] **Step 1: recharts import 추가**

기존 import 영역 안 (lucide-react import 직후 정합):

```typescript
import { LineChart, Line, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
// ★ D222+ Phase 1 (2026-05-27): TrendingUp/Down — 델타 표시 아이콘
import { TrendingUp, TrendingDown, Zap } from 'lucide-react';
```

- [ ] **Step 2: customer-trend fetch state + useEffect 추가**

Dashboard 컴포넌트 상단 state 영역 안 (기존 stats state 영역 정합):

```typescript
// ★ D222+ Phase 1 (2026-05-27): 30일 추이 시계열 + 델타 (DB 현황 본격 영역)
interface CustomerTrendItem {
  date: string;
  total: number;
  optIn: number;
  optOut: number;
}
interface CustomerTrendDeltas {
  totalDelta30: number | null;
  optInDelta30: number | null;
  optOutDelta30: number | null;
  activeRateDelta30: number | null;
}
const [customerTrend, setCustomerTrend] = useState<CustomerTrendItem[]>([]);
const [trendDeltas, setTrendDeltas] = useState<CustomerTrendDeltas>({
  totalDelta30: null, optInDelta30: null, optOutDelta30: null, activeRateDelta30: null,
});
```

기존 stats fetch 영역 직후 신규 useEffect 추가:

```typescript
// ★ D222+ Phase 1 (2026-05-27): 30일 추이 fetch (DB 현황 본격 영역)
useEffect(() => {
  const fetchTrend = async () => {
    try {
      const t = localStorage.getItem('token');
      const r = await fetch('/api/dashboard/customer-trend?days=30', {
        headers: { Authorization: `Bearer ${t}` },
      });
      const d = await r.json();
      if (d.success) {
        setCustomerTrend(d.trend || []);
        setTrendDeltas(d.deltas || { totalDelta30: null, optInDelta30: null, optOutDelta30: null, activeRateDelta30: null });
      }
    } catch (err) {
      // 503 = DB 마이그레이션 영역 / 500 = 일반 오류 — UI 빈 영역 처리
      console.error('[customer-trend] fetch 오류:', err);
    }
  };
  fetchTrend();
}, []);
```

- [ ] **Step 3: 4 mini metric 카드 컴포넌트 신규 함수 추가**

Dashboard 컴포넌트 외부 (파일 상단 영역) 신규 helper 함수 추가:

```typescript
// ★ D222+ Phase 1 (2026-05-27): DB 현황 mini metric 카드 (spark line 포함)
interface DbMiniMetricCardProps {
  label: string;
  value: number | string;
  suffix?: string;
  delta: number | null;
  deltaSuffix?: string; // '%' (옵트인/거부 등) / '%p' (활성도)
  trend: number[]; // 7일 spark line 데이터
  positiveIsGood?: boolean; // true = 상승 emerald / false = 상승 rose (수신거부 영역 정합)
}

function DbMiniMetricCard({ label, value, suffix = '', delta, deltaSuffix = '%', trend, positiveIsGood = true }: DbMiniMetricCardProps) {
  const showDelta = delta !== null && Number.isFinite(delta);
  const isUp = showDelta && (delta as number) > 0;
  const isDown = showDelta && (delta as number) < 0;
  const deltaColor = showDelta
    ? (isUp ? (positiveIsGood ? 'text-emerald-600' : 'text-rose-600')
       : isDown ? (positiveIsGood ? 'text-rose-600' : 'text-emerald-600')
       : 'text-gray-500')
    : 'text-gray-400';
  const DeltaIcon = isUp ? TrendingUp : isDown ? TrendingDown : null;
  const sparkData = trend.map((v, i) => ({ x: i, value: v }));

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
      <div className="text-xs text-gray-500 font-medium mb-1">{label}</div>
      <div className="flex items-end justify-between gap-2 mb-2">
        <div className="text-2xl md:text-3xl font-bold text-gray-900 tabular-nums">
          {typeof value === 'number' ? value.toLocaleString() : value}
          {suffix && <span className="text-base font-normal text-gray-400 ml-0.5">{suffix}</span>}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className={`flex items-center gap-1 text-xs font-semibold ${deltaColor}`}>
          {DeltaIcon && <DeltaIcon className="w-3 h-3" />}
          <span>{showDelta ? `${(delta as number) > 0 ? '+' : ''}${delta}${deltaSuffix}` : '—'}</span>
        </div>
        {sparkData.length > 0 && (
          <div className="flex-shrink-0">
            <ResponsiveContainer width={80} height={20}>
              <LineChart data={sparkData}>
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#8b5cf6"
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 4 mini metric grid 영역 신규 삽입 (DB 현황 헤더 직후)**

기존 line 2442 (`{(!dashboardCards || !dashboardCards.configured) && (...)}` 직전) 신규 삽입:

```tsx
{/* ★ D222+ Phase 1 (2026-05-27): DB 현황 상단 4 mini metric — 큰 숫자 + 30일 대비 ±% + spark line */}
{stats && (() => {
  const total = Number(stats.total) || 0;
  const optIn = Number(stats.sms_opt_in_count) || 0;
  const optOut = Number(stats.unsubscribe_count) || 0;
  const activeRate = total > 0 ? Number(((optIn / total) * 100).toFixed(1)) : 0;
  // spark line 데이터 — 직전 7일 추이 (customerTrend 안 마지막 7건)
  const last7 = customerTrend.slice(-7);
  const sparkTotal = last7.map((d) => d.total);
  const sparkOptIn = last7.map((d) => d.optIn);
  const sparkOptOut = last7.map((d) => d.optOut);
  const sparkActive = last7.map((d) => d.total > 0 ? Number(((d.optIn / d.total) * 100).toFixed(1)) : 0);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      <DbMiniMetricCard label="전체 고객" value={total} suffix="명" delta={trendDeltas.totalDelta30} trend={sparkTotal} positiveIsGood={true} />
      <DbMiniMetricCard label="SMS 동의" value={optIn} suffix="명" delta={trendDeltas.optInDelta30} trend={sparkOptIn} positiveIsGood={true} />
      <DbMiniMetricCard label="수신거부" value={optOut} suffix="명" delta={trendDeltas.optOutDelta30} trend={sparkOptOut} positiveIsGood={false} />
      <DbMiniMetricCard label="활성도" value={activeRate} suffix="%" delta={trendDeltas.activeRateDelta30} deltaSuffix="%p" trend={sparkActive} positiveIsGood={true} />
    </div>
  );
})()}
```

- [ ] **Step 5: tsc 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: EXIT_CODE=0 + 0 errors

- [ ] **Step 6: 자가 grep 검증**

```bash
grep -nE "박[가-힣]|옛 |진정 |영영" packages/frontend/src/pages/Dashboard.tsx | head -10
```

Expected: 0건 (D222+ Phase 1 신규 영역만)

---

## Task 8: Dashboard DB 현황 시계열 line chart + 도넛 chart

**Files:**
- Modify: `packages/frontend/src/pages/Dashboard.tsx`

- [ ] **Step 1: 등급 분포 fetch state + useEffect 추가**

state 영역 안 신규 추가:

```typescript
// ★ D222+ Phase 1 (2026-05-27): 등급/채널 분포 (donut chart 영역)
interface DistributionItem {
  label: string;
  value: number;
  color: string;
}
const [tierDistribution, setTierDistribution] = useState<DistributionItem[]>([]);
```

기존 customer-trend fetch useEffect 영역 직후 신규 추가:

```typescript
// ★ D222+ Phase 1 (2026-05-27): 등급 분포 fetch
useEffect(() => {
  const fetchDistribution = async () => {
    try {
      const t = localStorage.getItem('token');
      const r = await fetch('/api/dashboard/customer-distribution', {
        headers: { Authorization: `Bearer ${t}` },
      });
      const d = await r.json();
      if (d.success) {
        setTierDistribution(d.tiers || []);
      }
    } catch (err) {
      console.error('[customer-distribution] fetch 오류:', err);
    }
  };
  fetchDistribution();
}, []);
```

- [ ] **Step 2: recharts 추가 import**

기존 recharts import 라인 정정 (Task 7 Step 1 영역 + 차트 컴포넌트 추가):

```typescript
import { LineChart, Line, ResponsiveContainer, Tooltip as RechartsTooltip, CartesianGrid, XAxis, YAxis, Legend, PieChart, Pie, Cell } from 'recharts';
```

- [ ] **Step 3: 시계열 + 도넛 차트 영역 신규 삽입 (4 mini metric 직후)**

Task 7 Step 4 영역 직후 신규 삽입:

```tsx
{/* ★ D222+ Phase 1 (2026-05-27): DB 현황 중앙 차트 — 시계열 + 도넛 */}
<div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-5">
  {/* 좌측 — 30일 추이 line chart */}
  <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
    <div className="text-sm font-semibold text-gray-800 mb-3">30일 추이</div>
    {customerTrend.length > 0 ? (
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={customerTrend}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: '#6b7280' }}
            tickFormatter={(d) => {
              const [, m, day] = (d || '').split('-');
              return m && day ? `${Number(m)}/${Number(day)}` : d;
            }}
            interval={Math.max(0, Math.floor(customerTrend.length / 5) - 1)}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#6b7280' }}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v)}
          />
          <RechartsTooltip
            formatter={(value: any) => Number(value).toLocaleString()}
            labelFormatter={(date) => `${date}`}
            contentStyle={{ fontSize: 11, borderRadius: 8 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="total" name="전체" stroke="#8b5cf6" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="optIn" name="동의" stroke="#10b981" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="optOut" name="거부" stroke="#f43f5e" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    ) : (
      <div className="flex items-center justify-center h-[240px] text-gray-400 text-sm">
        데이터 누적 중 — 7일 후 표시
      </div>
    )}
  </div>

  {/* 우측 — 등급 분포 donut chart */}
  <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
    <div className="text-sm font-semibold text-gray-800 mb-3">등급 분포</div>
    {tierDistribution.length > 0 ? (
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={tierDistribution}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={2}
            dataKey="value"
            nameKey="label"
          >
            {tierDistribution.map((entry, idx) => (
              <Cell key={`cell-${idx}`} fill={entry.color} />
            ))}
          </Pie>
          <RechartsTooltip
            formatter={(value: any) => Number(value).toLocaleString() + '명'}
            contentStyle={{ fontSize: 11, borderRadius: 8 }}
          />
          <Legend
            layout="vertical"
            verticalAlign="middle"
            align="right"
            wrapperStyle={{ fontSize: 11 }}
          />
        </PieChart>
      </ResponsiveContainer>
    ) : (
      <div className="flex items-center justify-center h-[240px] text-gray-400 text-sm">
        등급 정보 미설정
      </div>
    )}
  </div>
</div>
```

- [ ] **Step 4: tsc 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: EXIT_CODE=0 + 0 errors

---

## Task 9: Dashboard DB 현황 AI 인사이트 카드

**Files:**
- Modify: `packages/frontend/src/pages/Dashboard.tsx`

- [ ] **Step 1: AI 인사이트 fetch state + useEffect 추가**

state 영역 안 신규 추가:

```typescript
// ★ D222+ Phase 1 (2026-05-27): AI 인사이트 (self-diagnosis 활용)
interface AiInsight {
  title: string;
  reason: string;
  oneClickObjective: string;
}
const [aiInsight, setAiInsight] = useState<AiInsight | null>(null);
```

신규 useEffect 추가:

```typescript
// ★ D222+ Phase 1 (2026-05-27): AI 인사이트 fetch (self-diagnosis 활용)
useEffect(() => {
  const fetchInsight = async () => {
    try {
      const t = localStorage.getItem('token');
      const r = await fetch('/api/ai/operator/self-diagnosis', {
        headers: { Authorization: `Bearer ${t}` },
      });
      const d = await r.json();
      if (d.success && d.diagnosis?.recommendations?.length > 0) {
        const top = d.diagnosis.recommendations[0];
        setAiInsight({
          title: top.title || '',
          reason: top.reason || '',
          oneClickObjective: top.oneClickObjective || '',
        });
      }
    } catch (err) {
      console.error('[ai-insight] fetch 오류:', err);
    }
  };
  fetchInsight();
}, []);
```

- [ ] **Step 2: AI 인사이트 카드 영역 신규 삽입 (시계열/도넛 차트 직후)**

Task 8 Step 3 영역 직후 신규 삽입:

```tsx
{/* ★ D222+ Phase 1 (2026-05-27): DB 현황 AI 인사이트 카드 — 오늘 하루 주요 변화 1줄 */}
{aiInsight && (
  <div
    onClick={() => {
      if (aiInsight.oneClickObjective) {
        sessionStorage.setItem('ai_operator_prefill_objective', aiInsight.oneClickObjective);
      }
      navigate('/ai-operator');
    }}
    className="bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-200 rounded-xl p-4 shadow-sm cursor-pointer hover:shadow-md hover:border-violet-300 transition-all mb-5 flex items-center gap-3"
  >
    <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
      <Zap className="w-5 h-5 text-violet-600" />
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-[10px] text-violet-600 font-semibold uppercase tracking-wider mb-1">AI 인사이트</div>
      <div className="text-sm font-medium text-violet-900 truncate">
        {aiInsight.title} — {aiInsight.reason}
      </div>
    </div>
    <ChevronRight className="w-5 h-5 text-violet-600 flex-shrink-0" />
  </div>
)}
```

기존 lucide-react import 안 `ChevronRight` 영역 존재 확인 (line 1 영역) — 잔존 의무 (영역 부재 시 추가).

- [ ] **Step 3: tsc 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: EXIT_CODE=0 + 0 errors

---

## Task 10: Dashboard DB 현황 기존 동적 카드 violet 액센트 통일

**Files:**
- Modify: `packages/frontend/src/pages/Dashboard.tsx:2483~2612` (기존 동적 카드 영역)

- [ ] **Step 1: 카드 hover 영역 violet 정정**

기존 line 2518 / 2557 `hover:border-violet-200` 영역 → `hover:border-violet-300` (영역 명확 정합).

기존 distribution 카드 hover + count/rate/sum 카드 hover 영역 모두 정정.

- [ ] **Step 2: 아이콘 컨테이너 색감 violet 통일**

기존 `CARD_COLORS` 8 색상 매핑 영역 (line 110~119) — 액센트만 violet 통일 정정:

```typescript
// ★ D222+ Phase 1 (2026-05-27): 아이콘 액센트 violet 통일 (배경 흰 톤 유지)
const CARD_COLORS = [
  { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-900', accent: 'text-violet-600', iconBg: 'bg-violet-50', barColor: 'bg-violet-500' },
  { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-900', accent: 'text-fuchsia-600', iconBg: 'bg-fuchsia-50', barColor: 'bg-fuchsia-500' },
  { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-900', accent: 'text-cyan-600', iconBg: 'bg-cyan-50', barColor: 'bg-cyan-500' },
  { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-900', accent: 'text-amber-600', iconBg: 'bg-amber-50', barColor: 'bg-amber-500' },
  { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-900', accent: 'text-emerald-600', iconBg: 'bg-emerald-50', barColor: 'bg-emerald-500' },
  { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-900', accent: 'text-rose-600', iconBg: 'bg-rose-50', barColor: 'bg-rose-500' },
  { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-900', accent: 'text-indigo-600', iconBg: 'bg-indigo-50', barColor: 'bg-indigo-500' },
  { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-900', accent: 'text-purple-600', iconBg: 'bg-purple-50', barColor: 'bg-purple-500' },
];
```

violet 계열 = violet / fuchsia / purple / indigo (앞 8 영역 안 4건) — Dashboard 카드 색감 통일성 강화.

- [ ] **Step 3: 페이지네이션 dot indicator violet 정정**

기존 line 2596 `bg-gray-800` (active dot) → `bg-violet-600` 정정:

```tsx
<button
  key={idx}
  onClick={() => setDbCardPage(idx)}
  className={`h-1.5 rounded-full transition-all duration-300 ${
    idx === safePage ? 'bg-violet-600 w-5' : 'bg-gray-200 w-1.5 hover:bg-gray-400'
  }`}
/>
```

기존 좌우 화살표 `text-green-600 hover:bg-green-50` (line 2586 / 2604) → `text-violet-600 hover:bg-violet-50` 정정.

- [ ] **Step 4: 요금제 + 발송 현황 카드 액센트 정정 (좌측 60% 1행)**

기존 line 2347 / 2407 `bg-green-600` (요금제/발송 현황 카드 좌측 라인) → `bg-violet-600` 정정 (DB 현황 헤더 정합).

기존 line 2350 / 2411 `hover:text-green-700` → `hover:text-violet-700` 정정.

- [ ] **Step 5: tsc 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: EXIT_CODE=0 + 0 errors

---

## Task 11: Dashboard footer 매뉴얼 link 색상 정정 + 기존 토스트/모달 영역 색상 정합

**Files:**
- Modify: `packages/frontend/src/pages/Dashboard.tsx:3873` (footer 매뉴얼 link)
- Modify: `packages/frontend/src/pages/Dashboard.tsx:2228` (showPromptAlert 모달 — 잔존 영역 확인)

- [ ] **Step 1: footer 매뉴얼 link 색상 정정**

기존 line 3873:

```tsx
<a href="/manual/manual.html" target="_blank" rel="noopener" className="hover:text-emerald-600 transition">사용자 매뉴얼</a>
```

→ 정정:

```tsx
<a href="/manual/manual.html" target="_blank" rel="noopener" className="hover:text-violet-600 transition">사용자 매뉴얼</a>
```

- [ ] **Step 2: 기존 showPromptAlert 모달 정리 (Task 3 잔존 영역 확인)**

기존 line 2201~2235 `{showPromptAlert && (...)}` 영역 = 기존 캠페인 영역 사용 X 모달 = Task 3 영역 안 정리 의무. 잔존 확인:

```bash
grep -nE "showPromptAlert|setShowPromptAlert" packages/frontend/src/pages/Dashboard.tsx
```

발견 시 = 영구 폐기.

- [ ] **Step 3: tsc 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: EXIT_CODE=0 + 0 errors

---

## Task 12: AiOperatorPage 보라 톤 다운 + 시인성 강화

**Files:**
- Modify: `packages/frontend/src/pages/AiOperatorPage.tsx`

- [ ] **Step 1: 배경 색상 정정 (indigo-950 → violet-900 톤 다운)**

기존 line 519:

```tsx
<div className="min-h-screen bg-gradient-to-br from-indigo-950 via-purple-950 to-fuchsia-950 text-white">
```

→ 정정:

```tsx
<div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white">
```

- [ ] **Step 2: 헤더 sticky 색상 정정**

기존 line 528:

```tsx
<header className="relative border-b border-white/10 backdrop-blur-md bg-white/5 sticky top-0 z-30">
```

→ 정정:

```tsx
<header className="relative border-b border-violet-400/30 backdrop-blur-md bg-violet-800/50 sticky top-0 z-30">
```

- [ ] **Step 3: BETA 배지 + Hero 그라데이션 텍스트 정정 (indigo → violet)**

기존 line 547 BETA 배지:

```tsx
<span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-fuchsia-400 text-indigo-950">
```

→ 정정:

```tsx
<span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-fuchsia-400 text-violet-950">
```

기존 line 565 Hero 그라데이션:

```tsx
<h1 className="text-4xl md:text-5xl font-bold mb-5 leading-tight bg-gradient-to-r from-amber-200 via-fuchsia-200 to-indigo-200 bg-clip-text text-transparent">
```

→ 정정:

```tsx
<h1 className="text-4xl md:text-5xl font-bold mb-5 leading-tight bg-gradient-to-r from-amber-200 via-fuchsia-200 to-violet-200 bg-clip-text text-transparent">
```

기존 line 544 Hero 아래 라벨 그라데이션:

```tsx
<span className="text-lg font-bold bg-gradient-to-r from-amber-200 via-fuchsia-200 to-indigo-200 bg-clip-text text-transparent">
```

→ 정정 (Hero h1 영역 정합).

- [ ] **Step 4: 자연어 입력 배경 정정 (indigo-950 → violet-950)**

기존 line 580:

```tsx
<div className="relative flex items-end gap-3 p-2 rounded-2xl bg-indigo-950/80 backdrop-blur-xl border border-white/10">
```

→ 정정:

```tsx
<div className="relative flex items-end gap-3 p-2 rounded-2xl bg-violet-950/80 backdrop-blur-xl border border-white/10">
```

기존 line 542 아이콘 영역 색상:

```tsx
<Sparkles className="w-5 h-5 text-indigo-950" />
```

→ 정정:

```tsx
<Sparkles className="w-5 h-5 text-violet-950" />
```

기존 line 598 submit 버튼 텍스트 색상:

```tsx
className="flex-shrink-0 px-5 py-3 rounded-xl bg-gradient-to-r from-amber-400 to-fuchsia-400 text-indigo-950 font-semibold ..."
```

→ 정정 = `text-violet-950`.

- [ ] **Step 5: 시인성 매트릭스 정정 (text-white/85 → /95, /70 → /80, /40 → /55)**

기존 자주 사용된 색상 클래스 광범위 grep + 정정:

```bash
grep -nE "text-white/85|text-white/70|text-white/40|text-white/35|text-white/30" packages/frontend/src/pages/AiOperatorPage.tsx
```

전수 매트릭스 정정:
- `text-white/85` → `text-white/95`
- `text-white/70` → `text-white/80`
- `text-white/40` → `text-white/55`
- `text-white/35` → `text-white/55`
- `text-white/30` → `text-white/55`

단 일부 영역 (caption 본문 / 보조 영역) = 본질 영역 정합 — 의도적 매핑만 정정 (시각 분리 영역 보존 가능).

- [ ] **Step 6: 강조 텍스트 정정 (violet-300 → violet-200 + fuchsia-300 → fuchsia-200)**

기존 ACCENT_TOKENS (line 148~155) 안 `text` 영역:

```typescript
violet:  { iconBg: 'from-violet-400 to-purple-500',   border: 'border-violet-400/20',  glow: 'hover:shadow-violet-500/20',  text: 'text-violet-200' },
fuchsia: { iconBg: 'from-fuchsia-400 to-pink-500',    border: 'border-fuchsia-400/20', glow: 'hover:shadow-fuchsia-500/20', text: 'text-fuchsia-200' },
```

→ 기존 200 영역 = 정합. 200 → 100 정정 X (200 영역 본격 강조 정합).

기존 line 1428 `text-violet-300/70` → `text-violet-200/80` 정정 (강조 강화).

- [ ] **Step 7: 발송 결과 모달 indigo → violet 정정**

기존 line 1254 모달 배경:

```tsx
<div className="relative w-full max-w-md rounded-3xl border border-white/10 shadow-2xl bg-gradient-to-br from-emerald-950 via-teal-950 to-indigo-950 ...">
```

→ 정정:

```tsx
<div className="relative w-full max-w-md rounded-3xl border border-white/10 shadow-2xl bg-gradient-to-br from-emerald-950 via-teal-950 to-violet-950 ...">
```

기존 line 1315 CTA 버튼 텍스트 색상 `text-emerald-950` = 정합 (emerald 본격 영역) — 정정 X.

- [ ] **Step 8: tsc 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: EXIT_CODE=0 + 0 errors

- [ ] **Step 9: 자가 grep 검증 (indigo 잔존 0건 + 박-단어 0건)**

```bash
grep -nE "indigo-9|indigo-8" packages/frontend/src/pages/AiOperatorPage.tsx
grep -nE "박[가-힣]|옛 |진정 |영영|Opus|Sonnet|Claude" packages/frontend/src/pages/AiOperatorPage.tsx
```

Expected: indigo-9 / indigo-8 = 0건 / 박/옛/진정/영영/모델명 = 0건

---

## Task 13: 자가 검증 매트릭스 — 전수 grep + tsc 0 errors

**Files:** 검증 명령어만

- [ ] **Step 1: frontend tsc 0 errors 검증**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: EXIT_CODE=0 + 0 errors

- [ ] **Step 2: backend tsc 0 errors 검증**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: EXIT_CODE=0 + 0 errors

- [ ] **Step 3: 박-단어 전수 grep (frontend + backend)**

Run:
```bash
grep -rnE "박[가-힣]" packages/frontend/src packages/backend/src --include="*.ts" --include="*.tsx" | grep -vE "박스|박물|박사|박힌|박혀" | head -30
```

Expected: 0건 (정상 명사 제외 — "박스" / "박물" 등은 OK)

- [ ] **Step 4: 옛/진정/영영 단어 전수 grep**

Run:
```bash
grep -rnE "옛 |진정 |영영" packages/frontend/src packages/backend/src --include="*.ts" --include="*.tsx" | head -30
```

Expected: 0건 (D219+/D218+/D217+ 영구 룰 정합)

- [ ] **Step 5: 모델명 UI 노출 grep**

Run:
```bash
grep -rnE "Opus 4|Sonnet 4|Claude|Anthropic|GPT" packages/frontend/src/pages/Dashboard.tsx packages/frontend/src/pages/AiOperatorPage.tsx packages/frontend/src/components/DashboardHeader.tsx | head -20
```

Expected: 0건 (사용자 노출 영역만 — D214+ 영구 룰 정합)

- [ ] **Step 6: native dialog 전수 grep**

Run:
```bash
grep -nE "alert\(|confirm\(|prompt\(" packages/frontend/src/pages/Dashboard.tsx packages/frontend/src/pages/AiOperatorPage.tsx packages/frontend/src/components/DashboardHeader.tsx
```

Expected: 0건

- [ ] **Step 7: 이모지 grep**

Run:
```bash
grep -rnE "✨|📌|💬|🖼|📷|✏|👁|⏳|📝|📢|⚠|📱|🔒|🎯|✅" packages/frontend/src/pages/Dashboard.tsx packages/frontend/src/pages/AiOperatorPage.tsx packages/frontend/src/components/DashboardHeader.tsx | head -10
```

Expected: 0건 (사용자 데이터 영역 EMOJI_OPTIONS 제외)

- [ ] **Step 8: 휴머스온 / Humuson grep**

Run:
```bash
grep -rnE "휴머스온|Humuson" packages/frontend/src packages/backend/src --include="*.ts" --include="*.tsx" | head -10
```

Expected: 0건

---

## Task 14: verification-before-completion skill 호출

**Files:** N/A (skill 호출만)

- [ ] **Step 1: superpowers:verification-before-completion skill 호출**

본 Phase 1 종결 보고 직전 의무 호출 (D217+ 영구 룰 정합 — "완료/passing/fixed/통과" 단어 출력 직전).

- [ ] **Step 2: evidence 출력 매트릭스**

본 Phase 1 자가 검증 결과 매트릭스 명시:
- frontend tsc 결과 (EXIT_CODE + 0 errors)
- backend tsc 결과 (EXIT_CODE + 0 errors)
- 박-단어 grep 결과 (0건)
- 옛/진정/영영 grep 결과 (0건)
- 모델명 grep 결과 (0건)
- native dialog grep 결과 (0건)
- 이모지 grep 결과 (0건)
- 휴머스온 grep 결과 (0건)
- 시인성 매트릭스 자가 점검 (text-white/95/80/55 + violet-200 강조)

---

## Task 15: Harold 직접 배포 안내 (표준 종료 멘트)

**Files:** N/A (안내만)

- [ ] **Step 1: tp-push 표준 형식 안내**

본 Phase 1 변경 영역 = backend 신규 routes/dashboard.ts + app.ts 라우터 등록 + frontend 4 파일 (DashboardHeader + Dashboard + AiOperatorPage + package.json X — recharts 이미 설치 종결).

DB 변경 X = SQL 안내 영역 X.

표준 push 명령어:

```
tp-push "D222+ Phase 1 종결 — Dashboard 전면 정정 + AiOperatorPage 보라 톤 다운 + 시인성 강화 (헤더 nav AI Operator 제거 + 매뉴얼 NEW 추가 + 세그먼트 violet / 메인 카드 3건 색감 시프트 — AI Operator 보라 그라데이션 + 직접 타겟 발송 녹색 (회사 로고) + 고객 DB 업로드 앰버 / AiSendTypeModal 영구 폐기 + AI Operator 단일 진입 / 기존 캠페인+발송 탭 + 하단 4 카드 영구 폐기 / DB 현황 본격 전면 수정 — 4 mini metric + 30일 시계열 + 등급 도넛 + AI 인사이트 카드 + 기존 동적 카드 violet 통일 / AiOperatorPage indigo → violet 톤 다운 + text-white/95/80/55 시인성 강화 / backend routes/dashboard.ts 신규 + customer-trend + customer-distribution 2 endpoint)"
```

서버 SSH 후:

```
cd ~/targetup-app && git pull
cd ~/targetup-app/packages/backend && npm run build:safe
cd ~/targetup-app/packages/frontend && npm run build:safe
pm2 restart all
```

- [ ] **Step 2: 표준 종료 멘트 (CLAUDE.md 명시 정합)**

```
작업이 완료되었습니다. Harold님, 직접 git add/commit/push 및 배포를 진행해 주세요.
```

---

## Self-Review 매트릭스

본 plan 작성 종결 후 spec 정합 자가 점검:

### 1. Spec coverage
- [x] § 2 헤더 nav 정정 → Task 2
- [x] § 3-2 메인 카드 3건 색감 시프트 → Task 4
- [x] § 3-3 AI Operator 단일 진입 → Task 5
- [x] § 3-4 기존 캠페인/발송 탭 + 하단 4 카드 삭제 → Task 3
- [x] § 3-5 footer 매뉴얼 link → Task 11
- [x] § 4 DB 현황 본격 전면 수정 → Task 6 (배경) + Task 7 (4 metric) + Task 8 (차트) + Task 9 (AI 인사이트) + Task 10 (기존 동적 카드)
- [x] § 4-7 신규 endpoint 2건 → Task 1
- [x] § 5 AiOperatorPage 톤 다운 → Task 12
- [x] § 6 native dialog 정정 → Task 3 (Dashboard 잔존 영역) + Task 13 (전수 grep)
- [x] § 7 자가 검증 매트릭스 → Task 13 + Task 14

### 2. Placeholder scan
- 본 plan 안 TBD / TODO / "implement later" / "fill in details" 영역 = 0건
- 모든 코드 영역 본격 명시 (Express endpoint 본격 + React 컴포넌트 본격 + 색상 class 본격)
- 검증 명령어 = exact bash 영역 명시

### 3. Type consistency
- DashboardHeader `newBadge` 영역 = Task 2 안 interface 추가 + 메뉴 list 안 사용 + 렌더링 안 출력 = 일관
- `CustomerTrendItem` / `DistributionItem` / `AiInsight` interface 영역 = Task 7 / 8 / 9 안 정의 + 사용 = 일관
- `DbMiniMetricCard` props 영역 = Task 7 안 정의 + 사용 = 일관

### 4. Spec 추가 검토

본 plan 본격 spec 매트릭스 (10건 결정 영역) 정합 확인 종결 — gap 0건.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-27-d222-phase1-implementation.md`.**

본 Plan 실행 흐름 = subagent-driven-development (추천) 또는 inline executing-plans 본격 진입.

### Phase 1 추정 분량
- Task 1 (backend endpoint 신규) — 1.5h
- Task 2 (DashboardHeader 정정) — 0.5h
- Task 3 (Dashboard 기존 탭 삭제) — 1h
- Task 4 (메인 카드 색감 시프트) — 0.5h
- Task 5 (AiSendTypeModal 폐기) — 0.5h
- Task 6 (배경 + DB 현황 헤더) — 0.5h
- Task 7 (DB 현황 4 mini metric) — 2h
- Task 8 (DB 현황 시계열 + 도넛) — 2h
- Task 9 (DB 현황 AI 인사이트) — 1h
- Task 10 (DB 현황 기존 동적 카드 정정) — 0.5h
- Task 11 (footer link) — 0.25h
- Task 12 (AiOperatorPage 톤 다운) — 1.5h
- Task 13 (자가 검증) — 0.5h
- Task 14 (verification skill) — 0.25h
- Task 15 (배포 안내) — 0.25h

**총 분량** = 약 12.75h (spec 명시 12~14h 정합)

---

> 본 plan 종결. Harold 컨펌 후 subagent-driven-development 또는 executing-plans 호출 + 본격 진입.
