# D222+ Phase 1 — Dashboard 전면 정정 + AI Operator 톤 다운 디자인

> 작성일: 2026-05-27
> 단계: D221+ 핸드오프 매트릭스 정정 (직원 의견 + 본 AI 의견 + Harold 직감 일치)
> Harold 명시 (2026-05-27 brainstorming): "AI 오퍼레이션 안 다크 톤만 보라 그라데이션 통일 + 시인성 강화 / Dashboard 흰 톤 유지 + DB 현황 본격 전면 수정 세련 모던 / AI Operator 카드 보라 + 직접 타겟 발송 녹색 (회사 로고 아이덴티티) + 고객 DB 업로드 앰버"

---

## 1. 작업 본질

D221+ 핸드오프 매트릭스 = "보라 그라데이션 전 메뉴 통일 (17 페이지)" — 직원 피드백 ("다크 톤 어둡고 보기 힘들다 + 사이트 무거운 감 + AI Operator 영역만 보라 = 특별 기능 인상") + 본 AI 분석 (마케팅 SaaS = 일상 업무 도구 = 흰 톤 default 정합 — Braze/Salesforce/HubSpot 글로벌 흐름) 수렴 후 정정.

### 1-1. 정정 매트릭스 본질

- **AI 영역 (AI Operator + sub-module 10 페이지 + Onboarding = 11 페이지)** = 보라 그라데이션 톤 다운 통일 + 시인성 강화 (특별 기능 인상)
- **다른 모든 영역 (Dashboard 포함 + 헤더 nav 안 메뉴 진입 페이지)** = 흰 톤 default 그대로 유지 (일상 업무 본질)
- **모든 모달 (D220+ 종결 6건)** = 다크 톤 톤 다운 (slate-800) — D220+ 종결 유지
- **DashboardHeader (모든 페이지 공통 nav)** = 흰 톤 default 그대로 유지 (기존 흐름 영구 유지 — 동적 변경 X)

### 1-2. Phase 1 작업 범위

Phase 1 = Dashboard 전면 정정 (헤더 nav + 메인 카드 3건 + DB 현황 본격 전면 수정 + 기존 캠페인/발송 탭 + 하단 4 카드 삭제) + AiOperatorPage 보라 톤 다운 정정 (기준점 정합). 분량 = 12~14h.

---

## 2. 헤더 nav 정정 매트릭스

### 2-1. DashboardHeader 디자인 매트릭스

- 색상 = **흰 톤 default 그대로 유지** (기존 흐름 정합 — 동적 변경 X)
- 배경 = `bg-white border-b border-gray-200` (그대로)
- 메뉴 hover/active 색상 매핑 (COLOR_CONFIG green/gold/gray/beta) = 그대로

### 2-2. 메뉴 변경 매트릭스

| 변경 | 기존 흐름 | 정정 |
|---|---|---|
| **AI Operator 메뉴** | 헤더 첫 메뉴 (BETA badge + violet) | **제거** (Dashboard 메인 카드 진입 영역으로 이전) |
| **매뉴얼 메뉴** | 노출 X (footer link만) | **신규 추가** = `{ label: '매뉴얼', onClick: () => window.open('/manual/manual.html'), color: 'beta', badge: 'NEW' }` |
| **세그먼트 메뉴** | `color: 'gold'` | **`color: 'beta'`** (violet 액센트 정합) |
| 나머지 메뉴 (카카오&RCS / 직접발송 / 발송결과 / 수신거부 / 설정 / 관리 / 로그아웃) | 그대로 | 그대로 |

### 2-3. NEW 배지 추가 매트릭스

- 기존 BETA 배지 = `bg-gradient-to-r from-amber-400 to-fuchsia-500 text-white`
- 신규 NEW 배지 = `bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white` (violet 톤 통일 — BETA 영역 amber X / NEW = violet 정합)
- `MenuItem` interface 안 `newBadge?: boolean` 추가 (기존 `betaBadge?: boolean` 영역 정합)
- 동시 노출 X (NEW vs BETA 둘 중 하나)

### 2-4. DashboardHeader.tsx 수정 영역 매트릭스

- 메뉴 list (line 100~150) — AI Operator 제거 + 매뉴얼 NEW 추가 + 세그먼트 color 정정
- COLOR_CONFIG (line 48~53) = 그대로 유지
- MenuItem interface (line 36~44) = `newBadge?: boolean` 추가
- 메뉴 렌더링 영역 (line 194~216) = NEW 배지 출력 분기 추가

---

## 3. Dashboard 메인 영역 정정 매트릭스

### 3-1. 배경

- 배경 = `bg-gray-100` (그대로 유지 — 흰 톤 default)
- 본문 영역 wrapper = 기존 흐름 그대로

### 3-2. 우측 40% 메인 카드 3건 색감 시프트 매트릭스 (회사 로고 아이덴티티)

| # | 카드 | 색감 | 매트릭스 | 본질 |
|---|---|---|---|---|
| 1 | **AI Operator** (기존 AI 추천 발송) | 보라 그라데이션 | `bg-gradient-to-br from-violet-600 via-fuchsia-600 to-purple-700 + shadow-lg shadow-violet-500/30 hover:shadow-xl hover:shadow-violet-500/50 hover:scale-[1.02]` + MAIN 배지 (`bg-white text-violet-700`) | 특별 기능 인상 + 가장 화려 |
| 2 | **직접 타겟 발송** | 녹색 그라데이션 | `bg-gradient-to-br from-emerald-500 via-green-500 to-emerald-600 + shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/50 hover:scale-[1.02]` | 회사 로고 아이덴티티 |
| 3 | **고객 DB 업로드** | 앰버 그라데이션 | `bg-gradient-to-br from-amber-500 via-orange-500 to-amber-600 + shadow-lg shadow-amber-500/30 hover:shadow-xl hover:shadow-amber-500/50 hover:scale-[1.02]` | 기존 직접 타겟 색감 시프트 |

#### 카드 디자인 영역 강화

- padding = `p-6` (기존 p-5 → 강화)
- 큰 라벨 = `text-2xl font-bold text-white` (기존 text-xl → 강화 — 시인성)
- 보조 텍스트 = `text-sm text-white/85 font-medium`
- 우측 화살표 = `text-3xl text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all`
- 로딩 영역 (AI 분석 중) = `text-white/85` + 펄스 시계 → violet 톤 정합

#### MAIN 배지 (AI Operator 카드 영역만)

- 위치 = 그대로 (`absolute -top-2 right-3`)
- 디자인 = `bg-white text-violet-700 text-xs font-bold px-2 py-0.5 rounded-full shadow` (기존 green-700 → violet-700 정정)

### 3-3. AI Operator 진입 흐름 정정 (단일 진입)

- 기존 흐름 = AI 추천 발송 카드 클릭 → `setShowAiSendType(true)` → AiSendTypeModal → 2 선택 (AI 한줄로 / AI 맞춤한줄)
- **정정 흐름** = AI Operator 카드 클릭 → 기존 `onAiOperatorClick` 흐름 = `/api/ai/operator/access` 호출 → allowed = `navigate('/ai-operator')` 직접 진입 / not allowed = AiOperatorWalkthroughModal 표시
- **AiSendTypeModal 영구 폐기** = import 제거 + JSX 영역 제거 + 기존 흐름 (`setShowAiSendType` state) 영구 폐기
- **AiCampaignResultPopup + AiCustomSendFlow 진입 link 영구 폐기** = 기존 AI 한줄로 / 맞춤한줄 진입 link 모두 제거. 컴포넌트 자체 보존 (별 작업 영역 활용 가능 — 기존 D220+ Step 1 정정 보존)

### 3-4. 기존 캠페인+발송 탭 + 하단 4 카드 전수 삭제

- `<div className="bg-transparent rounded-lg mb-4">` ~ `</div>` 전체 영역 (line 2740 ~ 2998) 전수 삭제
- 3 탭 (`activeTab === 'target' | 'campaign' | 'send'`) 모두 삭제
- 하단 4 카드 (최근 캠페인 / AI 발송 템플릿 / AI 분석 / 예약 대기) 영구 폐기
- `activeTab` state 영구 폐기 + `setActiveTab` 호출 영역 모두 정리
- 기존 v0 흐름 (`'campaign'` / `'send'` 탭 — 캠페인 폼 + 발송 안내) = 사용 X 영구 폐기

### 3-5. footer 매뉴얼 link (line 3873) 정정

- 기존 흐름 = `<a href="/manual/manual.html" target="_blank">사용자 매뉴얼</a>` emerald hover
- 정정 = 그대로 유지 (이중 진입 link — 헤더 매뉴얼 메뉴 + footer link 동시 정합)
- 색상 정정 = emerald → violet (`hover:text-violet-600`)

---

## 4. DB 현황 본격 전면 수정 매트릭스 (본 spec 핵심 영역)

### 4-1. 구조 매트릭스 (한 시야 안 5 영역)

```
┌──────────────────────────────────────────────────┐
│ [4-A] DB 현황 헤더 + [상세보기 →]                 │
├──────────────────────────────────────────────────┤
│ [4-B] 상단 4 mini metric — 큰 숫자 + 30일 대비   │
│       ±% + 미니 spark line                        │
│ ┌────────┬────────┬────────┬────────┐           │
│ │전체    │동의    │거부    │활성도   │           │
│ │12,345  │11,234  │1,111   │87.3%   │           │
│ │+5.2%↑  │+6.1%↑  │-2.3%↓  │+1.2%↑  │           │
│ │spark   │spark   │spark   │spark   │           │
│ └────────┴────────┴────────┴────────┘           │
├──────────────────────────────────────────────────┤
│ [4-C] 중앙 차트 — 시계열 + 분포                  │
│ ┌──────────────────────┬───────────────────┐    │
│ │30일 추이 line chart  │등급 분포 donut    │    │
│ │전체 / 동의 / 거부     │VIP/Gold/Silver/B  │    │
│ └──────────────────────┴───────────────────┘    │
├──────────────────────────────────────────────────┤
│ [4-D] AI 인사이트 카드 — 오늘 하루 주요 변화 1줄│
│ "휴면 전환 위험 234명 발견 — VIP 회수 추천 →"  │
├──────────────────────────────────────────────────┤
│ [4-E] 기존 동적 카드 6개씩 페이징 — 세련 정정      │
│ ┌──┬──┬──┬──┬──┬──┐ ← → ●●○○○                │
│ └──┴──┴──┴──┴──┴──┘                              │
└──────────────────────────────────────────────────┘
```

### 4-2. 4-A 헤더 영역

- 컨테이너 = `<div className="flex items-center justify-between mb-5">` (그대로)
- 좌측 = `<div className="w-1 h-4 bg-violet-600 rounded-full" /> + <span className="text-sm font-semibold text-gray-800">DB 현황</span>` (기존 emerald → violet 정정)
- 우측 = `상세보기 →` 버튼 (그대로 — `text-xs font-medium text-gray-400 hover:text-violet-700`)

### 4-3. 4-B 상단 4 mini metric 영역

- 4 카드 grid = `grid grid-cols-2 md:grid-cols-4 gap-3 mb-5` (모바일 2열 + md+ 4열)
- 카드 매트릭스 = `bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-all`
- 라벨 = `text-xs text-gray-500 font-medium mb-1`
- 큰 숫자 = `text-3xl font-bold text-gray-900 tabular-nums`
- 델타 = `text-xs font-semibold` + 색상 (`text-emerald-600` 상승 / `text-rose-600` 하락) + TrendingUp/Down 아이콘 (`w-3 h-3`)
- 미니 spark line = recharts `<LineChart width={120} height={20} data={trend7d}><Line type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={1.5} dot={false} /></LineChart>` (violet stroke)

#### 4 metric 데이터 매핑

| 영역 | 값 | 델타 비교 |
|---|---|---|
| 전체 고객 | `stats.total` | 30일 대비 ±% (신규 endpoint 응답 안 totalDelta30) |
| SMS 동의 | `stats.sms_opt_in_count` | 30일 대비 ±% (optInDelta30) |
| 수신거부 | `stats.unsubscribe_count` | 30일 대비 ±% (optOutDelta30) |
| 활성도 | `(sms_opt_in_count / total) * 100` | 30일 대비 ±%p (activeRateDelta30) |

### 4-4. 4-C 중앙 차트 영역

#### 4-C-1. 좌측 — 30일 추이 line chart

- 컨테이너 = `<div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">`
- 차트 = `<ResponsiveContainer width="100%" height={240}><LineChart data={trend30d}>...`
- 3 line:
  - 전체 = `<Line dataKey="total" stroke="#8b5cf6" strokeWidth={2} dot={false} />` (violet)
  - 동의 = `<Line dataKey="optIn" stroke="#10b981" strokeWidth={2} dot={false} />` (emerald)
  - 거부 = `<Line dataKey="optOut" stroke="#f43f5e" strokeWidth={2} dot={false} />` (rose)
- 격자 = `<CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />`
- X축 = `<XAxis dataKey="date" tickFormatter={fmtMMDD} interval={6} />` (7일 간격)
- Y축 = `<YAxis tickFormatter={fmtAbbreviated} />` (1.2K / 12K 형태)
- Tooltip = `<Tooltip formatter={(value) => value.toLocaleString()} labelFormatter={fmtFullDate} />`
- 범례 = `<Legend wrapperStyle={{ fontSize: '11px' }} />`
- 헤더 = `text-sm font-semibold text-gray-800` "30일 추이"

#### 4-C-2. 우측 — 등급 분포 donut chart

- 컨테이너 = `<div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">`
- 차트 = `<ResponsiveContainer width="100%" height={240}><PieChart><Pie data={tierDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} dataKey="value">...`
- 색상 매핑 = violet (`#8b5cf6`) / fuchsia (`#d946ef`) / cyan (`#06b6d4`) / amber (`#f59e0b`)
- 중앙 텍스트 = 총 고객 수 큰 숫자 (`<text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">`)
- 범례 = 우측 (`<Legend layout="vertical" verticalAlign="middle" align="right" />`)
- 헤더 = `text-sm font-semibold text-gray-800` "등급 분포"

#### 4-C-3. 빈 데이터 영역

- 시계열 데이터 0건 = `<div className="flex items-center justify-center h-[240px] text-gray-400 text-sm">데이터 누적 중 — 7일 후 표시</div>`
- 등급 분포 0건 = `<div className="flex items-center justify-center h-[240px] text-gray-400 text-sm">등급 정보 미설정 — 설정 안내</div>`

### 4-5. 4-D AI 인사이트 카드 영역

- 컨테이너 = `bg-gradient-to-r from-violet-50 to-fuchsia-50 + border border-violet-200 + rounded-xl + p-4 + shadow-sm + cursor-pointer + hover:shadow-md hover:border-violet-300 transition-all`
- 좌측 = `<Zap className="w-5 h-5 text-violet-600" />` 아이콘 + 보조 텍스트 `text-xs text-violet-600 font-semibold uppercase tracking-wider mb-1` ("AI 인사이트")
- 큰 본문 = `text-sm font-medium text-violet-900` (1줄 압축 — `truncate`)
- 우측 = `<ChevronRight className="w-5 h-5 text-violet-600" />` + 호버 강화
- 클릭 시 = AI Operator 메인 진입 (`navigate('/ai-operator')`) + 추천 영역 prefill (`sessionStorage.setItem('ai_operator_prefill_objective', insight.oneClickObjective)`)
- 데이터 소스 = 기존 `/api/ai/operator/self-diagnosis` 활용 — `diagnosis.recommendations[0]` 영역 (기존 AiSelfDiagnosisCards 매트릭스 정합)
- fetch 실패 시 / 추천 0건 시 = 카드 자체 hide

### 4-6. 4-E 기존 동적 카드 6개씩 페이징 — 세련 정정

- 흐름 = `dashboardCards.cards` 6개씩 페이징 + 좌우 화살표 (그대로 유지)
- 카드 디자인 정정:
  - 컨테이너 = `bg-white border border-gray-200 rounded-xl p-4 cursor-pointer` (기존 정합)
  - 호버 = `hover:shadow-md hover:-translate-y-0.5 hover:border-violet-300 transition-all` (violet 액센트 강화)
  - 아이콘 컨테이너 = `w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center` (기존 8 색상 매핑 → violet 통일)
  - 라벨 = `text-xs text-gray-500 font-medium mb-1.5`
  - 큰 숫자 = `text-2xl font-bold text-gray-900 tabular-nums`
  - 단위 (명/원/건/%) = `text-sm font-normal text-gray-400 ml-0.5`
  - 델타 영역 = 기존 DeltaBadge 정합 (기존 흐름 그대로)
  - distribution 카드 (3 영역 progress bar) = 기존 흐름 + violet 톤 정합 (`bg-violet-500` bar)
- 페이지네이션 = 그대로 (좌우 화살표 + dot indicator — `bg-violet-600` 활성 + `bg-gray-200` 비활성)

### 4-7. 신규 endpoint 매트릭스

| endpoint | 본질 | 응답 매트릭스 |
|---|---|---|
| `GET /api/dashboard/customer-trend?days=30` | 30일 추이 시계열 | `{ success: true, trend: [{ date: 'YYYY-MM-DD', total, optIn, optOut }, ...], deltas: { totalDelta30, optInDelta30, optOutDelta30, activeRateDelta30 } }` |
| `GET /api/dashboard/customer-distribution` | 등급/채널 분포 | `{ success: true, tiers: [{ label, value, color }, ...], channels: [{ label, value, color }, ...] }` |
| `GET /api/ai/operator/self-diagnosis` | AI 인사이트 (기존 endpoint 활용) | 기존 흐름 정합 — `diagnosis.recommendations[0]` 1줄 압축 |

신규 endpoint 2건 = `packages/backend/src/routes/dashboard.ts` 안 신규 작성 (기존 X 시 신규 파일).

#### 신규 endpoint 구현 매트릭스

```typescript
// packages/backend/src/routes/dashboard.ts (신규 또는 기존 활용)
import { Router } from 'express';
import { pgPool } from '../db/pg';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// 30일 추이 시계열 (line chart 영역)
router.get('/customer-trend', authMiddleware, async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 90);
  const companyId = (req as any).user.companyId;
  try {
    const r = await pgPool.query(
      `WITH daily AS (
         SELECT date_trunc('day', created_at)::date AS day,
                COUNT(*) FILTER (WHERE TRUE)              AS total,
                COUNT(*) FILTER (WHERE sms_opt_in = true) AS opt_in,
                COUNT(*) FILTER (WHERE is_unsubscribed = true) AS opt_out
         FROM customers
         WHERE company_id = $1
           AND created_at >= NOW() - INTERVAL '${days} days'
         GROUP BY 1
         ORDER BY 1
       )
       SELECT day::text AS date, total, opt_in AS "optIn", opt_out AS "optOut"
       FROM daily`,
      [companyId]
    );
    // 델타 계산 — 직전 30일 vs 그 이전 30일
    const deltas = await calcDeltas(companyId, days);
    res.json({ success: true, trend: r.rows, deltas });
  } catch (err: any) {
    // DB ALTER 안전망 (LESSONS_META 4-25 정합)
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요', code: 'DB_MIGRATION_PENDING' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// 등급/채널 분포 (donut chart 영역)
router.get('/customer-distribution', authMiddleware, async (req, res) => {
  const companyId = (req as any).user.companyId;
  try {
    // 등급 분포 (기존 standard_fields 안 grade 컬럼 활용)
    const tiersR = await pgPool.query(
      `SELECT COALESCE(grade, '미분류') AS label, COUNT(*) AS value
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
         SUM(CASE WHEN sms_opt_in = true THEN 1 ELSE 0 END) AS sms,
         SUM(CASE WHEN kakao_opt_in = true THEN 1 ELSE 0 END) AS kakao,
         SUM(CASE WHEN email_opt_in = true THEN 1 ELSE 0 END) AS email
       FROM customers WHERE company_id = $1`,
      [companyId]
    );
    res.json({
      success: true,
      tiers: tiersR.rows.map((r, i) => ({ label: r.label, value: Number(r.value), color: TIER_COLORS[i % TIER_COLORS.length] })),
      channels: Object.entries(channelsR.rows[0] || {}).map(([k, v]) => ({ label: k.toUpperCase(), value: Number(v) })),
    });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요', code: 'DB_MIGRATION_PENDING' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

const TIER_COLORS = ['#8b5cf6', '#d946ef', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#a855f7'];

async function calcDeltas(companyId: string, days: number) {
  // N일 vs 그 이전 N일 비교 (단순 SQL — 본 spec 안 직접 구현)
  // ...
}

export default router;
```

- `app.ts` 안 `app.use('/api/dashboard', dashboardRouter);` 등록 의무
- 기존 인증 미들웨어 (`authMiddleware`) 활용 — 기존 흐름 정합

### 4-8. recharts 라이브러리 영역

- 신규 설치 = `cd packages/frontend && npm install recharts` (기존 X 시 의무)
- 기존 검토 (Performance / Predictive 페이지 안 chart 영역) = 기존 라이브러리 정합 = 신규 설치 X 가능

### 4-9. DB 현황 영역 분량

DB 현황 본격 전면 수정 = 5~7h (recharts 도입 + 신규 endpoint 2건 + 카드 디자인 + AI 인사이트 영역).

---

## 5. AiOperatorPage 톤 다운 정정 매트릭스 (기준점 정합)

### 5-1. 기존 흐름 → 정정

| 영역 | 기존 흐름 | 정정 |
|---|---|---|
| 배경 | `bg-gradient-to-br from-indigo-950 via-purple-950 to-fuchsia-950` | `bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900` (톤 다운 + indigo 제거) |
| 헤더 sticky | `border-b border-white/10 backdrop-blur-md bg-white/5 sticky top-0 z-30` | `border-b border-violet-400/30 backdrop-blur-md bg-violet-800/50 sticky top-0 z-30` |
| BETA 배지 그라데이션 | `from-amber-400 to-fuchsia-400 text-indigo-950` | `from-amber-400 to-fuchsia-400 text-violet-950` (indigo → violet) |
| Hero 그라데이션 텍스트 | `from-amber-200 via-fuchsia-200 to-indigo-200` | `from-amber-200 via-fuchsia-200 to-violet-200` (indigo → violet) |
| 자연어 입력 배경 | `bg-indigo-950/80` | `bg-violet-950/80` (indigo → violet) |
| 시인성 본문 | `text-white/85` | `text-white/95` (강화) |
| 시인성 보조 | `text-white/70` | `text-white/80` (강화) |
| 시인성 caption | `text-white/40` | `text-white/55` (40 이하 금지 의무) |
| 강조 텍스트 | `text-violet-300` | `text-violet-200` (300 → 200 강화) |
| 발송 결과 모달 배경 | `from-emerald-950 via-teal-950 to-indigo-950` | `from-emerald-950 via-teal-950 to-violet-950` (indigo → violet) |

### 5-2. 디자인 영역 변경 X — 톤 다운만

기존 흐름 (Hero / 자연어 입력 / 6 sub-agent / AiSelfDiagnosisCards / SUB_MODULE_CARDS / 결과 카드 / 발송 결과 모달) = 모두 기존 흐름 그대로 유지. 본격 디자인 영역 변경 X — 톤 다운 + 시인성 매트릭스 정정만.

### 5-3. 기존 사용자 안내

기존 안내 = "Enterprise Beta · Production 검증 중" + "AI Marketing Operations" + Hero 텍스트 = 그대로 유지.

### 5-4. AiOperatorPage 분량

AiOperatorPage 톤 다운 정정 = 2~3h (color class 정정 영역).

---

## 6. native dialog 정정 매트릭스 (Phase 1 Dashboard 영역만)

### 6-1. Dashboard.tsx 안 native dialog 검색

기존 흐름 = Dashboard.tsx 안 `alert(` / `confirm(` / `prompt(` 사용 영역 grep 자가 검증 의무. 발견 시 = ConfirmModal generic + useToast 정합.

### 6-2. 정정 매트릭스

- 기존 `alert('...')` → `setToast({ show: true, type: 'error', message: '...' })` (기존 toast state 정합) + 자동 dismiss
- 기존 `confirm('...')` → ConfirmModal generic 활용 (기존 components/ConfirmModal.tsx 정합) — 4 mode (default/info/warning/danger)
- 기존 `prompt('...')` → 커스텀 input 모달 정합 (단순 prompt 영역 거의 X — Dashboard 안 발견 시 정정)

### 6-3. 자가 검증 grep

```bash
grep -nE "alert\(|confirm\(|prompt\(" packages/frontend/src/pages/Dashboard.tsx
```

발견 0건 의무 (정정 후 잔존 X 영역).

---

## 7. 자가 검증 매트릭스

### 7-1. tsc 검증
- `cd packages/frontend && npx tsc --noEmit`
- EXIT_CODE=0 + 0 errors 의무

### 7-2. 자가 grep 검증 (0건 의무)
- 박-단어 (`박[가-힣]`) — D188+ 영구 룰
- "옛" 단어 — D219+ 영구 룰 (단순 제거 또는 "기존" 대체)
- "진정" 단어 — D218+ 영구 룰
- "영영" 단어 — D217+ 영구 룰
- 모델명 (Opus/Sonnet/GPT/Claude/Anthropic) — feedback_no_model_name_ui_exposure
- native dialog (alert/confirm/prompt) — feedback_no_native_browser_dialog
- 이모지 (✨/📌/💬/🖼️/📷/✏️/👁️/⏳/📝/📢/⚠️/📱) — feedback_no_emoji
- 휴머스온 / Humuson — feedback_no_humuson_keyword_exposure

### 7-3. 시인성 매트릭스 자가 점검
- AI 영역 = text-white/95 본문 + text-white/80 보조 + text-white/55 caption (40 이하 금지)
- 흰 톤 영역 = text-gray-900 본문 + text-gray-700 보조 + text-gray-500 caption
- 강조 영역 = violet-200 (AI 영역) / violet-700 (흰 톤 영역)

### 7-4. 영구 룰 정합 매트릭스 (17건 통과 의무)

1. feedback_cto_mandate_for_vito — CTO 사명감 + 단순 1 fix X = 영구 정합
2. feedback_design_quality_minimum_journey_level — Journey Builder 동급 + 시인성 강화
3. feedback_no_native_browser_dialog — ConfirmModal + useToast 활용
4. feedback_no_model_name_ui_exposure — 모델명 UI 노출 0건
5. feedback_marketing_user_ux_priority — 한 시야 + 1-click 흐름
6. feedback_ai_no_arbitrary_benefit — AI 생성 메시지 안 구체 혜택 X
7. feedback_no_target_auto_relax — 0건 매칭 자동 완화 X
8. feedback_no_inline_duplication — utils CT 활용
9. feedback_no_bakkeum_usage — 박-단어 + 옛/진정/영영 단어 0건
10. feedback_no_preview_verification — Claude_Preview MCP 0건
11. feedback_jondaetmal_to_harold — Harold 대상 존댓말
12. feedback_default_superpowers_workflow — brainstorming + writing-plans + verification-before-completion
13. feedback_no_humuson_keyword_exposure — 휴머스온/Humuson 0건
14. feedback_no_sudo_use_echo — sudo 0건
15. feedback_no_devtools_browser_diagnostic — F12 0건
16. feedback_push_and_deploy_commands — tp-push 표준
17. feedback_no_pm2_delete_before_git_push — pm2 reload / restart all

---

## 8. Phase 분할 전체 매트릭스 (참조용)

| Phase | 범위 | 분량 | 본 spec |
|---|---|---|---|
| **Phase 1** | Dashboard 전면 정정 (헤더 nav + 메인 카드 + DB 현황 본격 전면 수정 + 기존 탭/카드 삭제) + AiOperatorPage 톤 다운 정정 | 12~14h | **본 spec** |
| **Phase 2** | JourneysPage + PredictivePage + AiMemoryPage + AiUsagePage 보라 톤 다운 정정 (AI 핵심 4 영역) + native dialog 정정 | 8~10h | 별 spec (Phase 1 종결 후) |
| **Phase 3** | ContinuousOperatorPage + PerformancePage + CdpSettingsPage + InAppMessagesPage + EmailCampaignsPage + OnboardingWizardPage 보라 톤 다운 정정 (AI sub-module 6 영역) | 10~12h | 별 spec |
| **Phase 4** | 매뉴얼 페이지 (Claude Design 수령 HTML 정정 + 헤더 매뉴얼 메뉴 진입 link 정합) | 4~6h | 별 spec (Harold Claude Design 수령 후) |

**총 분량** = 약 34~42h × 4 세션 분할.

---

## 9. 본 spec 자가 검증 매트릭스

- [x] 민감 정보 (도메인 / 사용자 매트릭스 / 회사 정보) 노출 X
- [x] 박-단어 / D219+ 영구 룰 단어 / 모델명 0건
- [x] 영구 룰 17건 정합 매트릭스 명시
- [x] 핵심 결정 영역 10건 결정 명시 (헤더 흰 톤 / AI 11 영역 보라 / Dashboard 흰 톤 / DB 현황 본격 전면 수정 / 메인 카드 3건 색감 시프트 / 헤더 nav 메뉴 / AI Operator 단일 진입 / 기존 탭 카드 삭제 / 매뉴얼 진입 link / native dialog 정정)
- [x] Phase 분할 명시 (Phase 1 본 spec + Phase 2~4 별 spec)
- [x] 자가 검증 매트릭스 명시
- [x] 신규 endpoint 2건 + recharts 라이브러리 영역 명시
- [x] DB ALTER 안전망 (LESSONS_META 4-25) 명시

---

> 본 spec 종결. Harold 컨펌 후 writing-plans skill 호출 + Plan 작성 진입.
