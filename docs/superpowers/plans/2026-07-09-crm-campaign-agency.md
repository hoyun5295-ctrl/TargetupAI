# CRM 캠페인 대행 (캠페인 대행 설계) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 스펙: `docs/superpowers/specs/2026-07-09-crm-campaign-agency-design.md` (Harold 승인 2026-07-09)
> 프로젝트 룰: git 커밋/배포 = Harold 직접(tp-push). 플랜의 검증 체크포인트는 tsc·vitest·grep. `packages/` 메인코드 직접 수정(worktree 금지). 코드 수정 전 Harold 컨펌 완료 상태.

**Goal:** 비즈니스+ 요금제 고객사가 캠페인대행요청서(xlsx)를 접수하면, 슈퍼관리자에서 그 업체 단일 스코프(DB현황·AI메모리·캠페인이력)를 분석해 "한줄로 마케팅 제안서" PDF를 생성하는 기능.

**Architecture:** 고객사 접수(업로드) → `campaign_agency_requests` 저장 → 슈퍼관리자가 파싱 보정 후 분석 실행 → `crm-agency-proposal` CT가 회사 스코프 실데이터 수집 + 무과금 AI 호출로 플랜 JSON 생성 + 타겟 실측 COUNT → `crm-agency-pdf-render` CT가 PDF 렌더 → 파일 저장·다운로드. 컨펌·예약 대행은 시스템 밖(운영).

**Tech Stack:** Express + PG(신규 테이블 1) + multer(memoryStorage) + XLSX + pdfkit(malgun.ttf) + callAIWithFallback(creditCost 0) + React(다크 slate).

**확정 사실 (grep 실측 근거)**
- 요금제 게이트: `plan-guard.ts:239 isBetaAccessAllowed(ctx)` = `BUSINESS || ENTERPRISE` — 그대로 재사용
- 슈퍼관리자 인증: `middlewares/auth` `authenticate, requireSuperAdmin` (admin.ts 패턴)
- PDF: `require('pdfkit')` + A4 + malgun.ttf + `res.pipe` 스트림, 렌더는 별도 CT (`performance-pdf-render.ts:31 renderPerformanceReportPdf(doc, data)` 미러)
- xlsx 파싱: `import * as XLSX from 'xlsx'` + `XLSX.read`/`sheet_to_json` (upload.ts 패턴)
- 회사 데이터: `company-data-profile.ts:162 getCompanyDataProfile(companyId)` / `190 formatProfileForAiPrompt`
- AI 메모리: `listCompanyMemories(companyId, {memoryType, limit})` (ai.ts:2719 사용)
- 타겟 실측: `buildFilterWhereClauseCompat(filters, N)` (customer-filter) — continuous-operator 발송 추출과 동일 축
- 단가: `getCompanyCosts` (config/defaults)
- 슈퍼관리자 메뉴: AdminDashboard.tsx 2701 근처 navigate 엔트리(`{ key: 'bestCopy', label: '베스트 문안', onClick: () => navigate('/admin/best-copy') }` 패턴) — 별도 페이지로 분리(AdminDashboard 비대 방지)
- 고객사 메뉴 게이팅: Dashboard.tsx `planInfo?.plan_code` 사용 중 — `['BUSINESS','ENTERPRISE'].includes(plan_code)`로 노출 분기
- 신규 컬럼 리스크: 기존 테이블은 기존 코드가 이미 SELECT하는 컬럼만 사용(신규 참조 0). 신규는 `campaign_agency_requests` 테이블뿐 → Task 0 DDL로 해소

---

### Task 0: DDL (Harold 서버 psql 직접 실행 — 코드 작업 전 선행)

- [ ] **Step 0-1: 존재 확인 후 CREATE 실행**

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'campaign_agency_requests';
-- 0 rows 확인 후:
CREATE TABLE IF NOT EXISTS campaign_agency_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  title varchar(200) NOT NULL,
  memo text,
  request_file_path text NOT NULL,
  request_file_name text,
  parsed_json jsonb,
  status varchar(20) NOT NULL DEFAULT 'received',
  proposal_pdf_path text,
  staff_note text,
  designed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agency_requests_company ON campaign_agency_requests(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agency_requests_status ON campaign_agency_requests(status, created_at DESC);
```

코드는 테이블 부재 시 `does not exist` catch → 503 `DB_MIGRATION_PENDING` (db_alter_safety_net 룰, Task 4에 포함).

---

### Task 1: 요청서 양식 정의 + 파싱 순수 CT (TDD)

**Files:**
- Create: `packages/backend/src/utils/crm-agency-request.ts` (DB import 0 — 순수)
- Test: `packages/backend/src/utils/__tests__/crm-agency-request.test.ts`

양식 = 고정 2열 시트(A열 라벨/B열 값, 상품만 A10~ 3열 표). 다운로드도 이 CT가 생성(코드=단일 진실, 정적 파일 관리 불요).

- [ ] **Step 1-1: 실패 테스트 작성**

```typescript
// crm-agency-request.test.ts
import { describe, it, expect } from 'vitest';
import { buildRequestTemplateRows, parseRequestSheet, AGENCY_REQUEST_LABELS } from '../crm-agency-request';

describe('crm-agency-request', () => {
  it('양식 rows를 생성한다 (라벨 고정)', () => {
    const rows = buildRequestTemplateRows();
    expect(rows[0][0]).toBe(AGENCY_REQUEST_LABELS.title);
    expect(rows.some((r) => r[0] === AGENCY_REQUEST_LABELS.benefit)).toBe(true);
  });
  it('작성된 시트를 파싱한다', () => {
    const rows = buildRequestTemplateRows();
    const set = (label: string, v: string) => { const r = rows.find((x) => x[0] === label)!; r[1] = v; };
    set(AGENCY_REQUEST_LABELS.title, '7월 신제품 런칭');
    set(AGENCY_REQUEST_LABELS.periodStart, '2026-07-15');
    set(AGENCY_REQUEST_LABELS.periodEnd, '2026-07-31');
    set(AGENCY_REQUEST_LABELS.description, '신제품 A 출시 기념 행사');
    set(AGENCY_REQUEST_LABELS.benefit, '전 구매 고객 10% 할인');
    const parsed = parseRequestSheet(rows);
    expect(parsed.title).toBe('7월 신제품 런칭');
    expect(parsed.benefit).toBe('전 구매 고객 10% 할인');
    expect(parsed.missingRequired).toEqual([]);
  });
  it('필수 누락을 missingRequired로 보고한다 (throw 아님 — 직원 보정 흐름)', () => {
    const parsed = parseRequestSheet(buildRequestTemplateRows());
    expect(parsed.missingRequired.length).toBeGreaterThan(0);
  });
  it('상품 표(3열)를 파싱한다', () => {
    const rows = buildRequestTemplateRows();
    const idx = rows.findIndex((r) => r[0] === AGENCY_REQUEST_LABELS.productsHeader);
    rows[idx + 2] = ['신제품 A', '39000', '29000'];
    const parsed = parseRequestSheet(rows);
    expect(parsed.products).toEqual([{ name: '신제품 A', price: 39000, salePrice: 29000 }]);
  });
});
```

- [ ] **Step 1-2: 실행 → FAIL 확인** — `cd packages/backend && npx vitest run src/utils/__tests__/crm-agency-request.test.ts` (모듈 없음 에러)

- [ ] **Step 1-3: 구현**

```typescript
// crm-agency-request.ts — 캠페인대행요청서 양식 정의+파싱 (순수 CT, DB import 0)
// 양식 구조: A열 라벨 / B열 값. 상품만 productsHeader 아래 3열 표(이름·정가·할인가).
export const AGENCY_REQUEST_LABELS = {
  title: '행사명 (필수)',
  periodStart: '행사 시작일 (필수, 예: 2026-07-15)',
  periodEnd: '행사 종료일 (필수)',
  description: '행사 내용 (필수, 자유롭게 서술)',
  benefit: '혜택 내용 (필수, 예: 전 구매 고객 10% 할인)',
  channels: '희망 채널 (선택: 문자/알림톡/DM/이메일/인앱/여정 — 쉼표 구분, 비우면 AI 추천)',
  budget: '예산 (선택, 원)',
  note: '참고사항 (선택)',
  productsHeader: '[대상 상품/신제품 — 아래 표에 입력 (선택)]',
} as const;

export interface AgencyRequestParsed {
  title: string; periodStart: string; periodEnd: string; description: string;
  benefit: string; channels: string[]; budget: number | null; note: string;
  products: Array<{ name: string; price: number | null; salePrice: number | null }>;
  missingRequired: string[];  // 누락 필수 라벨 — throw 대신 보고(직원 보정 흐름)
}

export function buildRequestTemplateRows(): any[][] {
  const L = AGENCY_REQUEST_LABELS;
  return [
    ['한줄로 캠페인대행요청서', ''],
    ['※ 굵은 항목은 필수입니다. 작성 후 이 파일을 그대로 업로드해 주세요.', ''],
    [L.title, ''], [L.periodStart, ''], [L.periodEnd, ''], [L.description, ''],
    [L.benefit, ''], [L.channels, ''], [L.budget, ''], [L.note, ''],
    [L.productsHeader, '', ''],
    ['상품명', '정가(원)', '할인가(원)'],
    ['', '', ''], ['', '', ''], ['', '', ''],
  ];
}

const num = (v: any): number | null => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const str = (v: any): string => String(v ?? '').trim();

export function parseRequestSheet(rows: any[][]): AgencyRequestParsed {
  const L = AGENCY_REQUEST_LABELS;
  const byLabel = new Map<string, any>();
  for (const r of rows) { const label = str(r?.[0]); if (label) byLabel.set(label, r?.[1]); }
  const get = (label: string) => str(byLabel.get(label));

  const products: AgencyRequestParsed['products'] = [];
  const headerIdx = rows.findIndex((r) => str(r?.[0]) === L.productsHeader);
  if (headerIdx >= 0) {
    for (let i = headerIdx + 2; i < rows.length; i++) {
      const name = str(rows[i]?.[0]);
      if (!name) continue;
      products.push({ name, price: num(rows[i]?.[1]), salePrice: num(rows[i]?.[2]) });
    }
  }

  const required: Array<[string, string]> = [
    [L.title, get(L.title)], [L.periodStart, get(L.periodStart)], [L.periodEnd, get(L.periodEnd)],
    [L.description, get(L.description)], [L.benefit, get(L.benefit)],
  ];
  return {
    title: get(L.title), periodStart: get(L.periodStart), periodEnd: get(L.periodEnd),
    description: get(L.description), benefit: get(L.benefit),
    channels: get(L.channels).split(',').map((s) => s.trim()).filter(Boolean),
    budget: num(byLabel.get(L.budget)), note: get(L.note), products,
    missingRequired: required.filter(([, v]) => !v).map(([label]) => label),
  };
}
```

- [ ] **Step 1-4: 실행 → PASS 확인** — 같은 vitest 명령, 4 passed

---

### Task 2: 분석 파이프라인 CT (`crm-agency-proposal.ts`)

**Files:**
- Create: `packages/backend/src/utils/crm-agency-proposal.ts`
- Test: `packages/backend/src/utils/__tests__/crm-agency-proposal.test.ts` (순수부만 — AI/DB 없는 플랜 후처리)

**★ 불변식: 모든 수집·실측 함수는 companyId 인자를 관통 — 업체 단일 스코프.**

- [ ] **Step 2-1: 구현 골격** (핵심 로직 — 인터페이스·데이터 흐름 고정)

```typescript
// crm-agency-proposal.ts — CRM 캠페인 대행 제안서 엔진 (슈퍼관리자 내부 도구, 무과금)
// ★ 업체 단일 스코프: 모든 쿼리 WHERE company_id = $1 (교차 오염 금지 — Harold 불변식 2026-07-09)
import { query } from '../config/database';
import { callAIWithFallback } from '../services/ai-fallback';       // 실제 경로는 기존 import 관례 확인 후 일치
import { extractJsonFromAiText } from './ai-json';
import { getCompanyDataProfile, formatProfileForAiPrompt } from './company-data-profile';
import { listCompanyMemories } from './operator-memory';            // listCompanyMemories 실제 정의 파일로 import
import { buildFilterWhereClauseCompat } from './customer-filter';
import { getCompanyCosts } from '../config/defaults';
import type { AgencyRequestParsed } from './crm-agency-request';

export interface AgencyPlan {
  title: string; objective: string;
  channel: 'sms' | 'lms' | 'mms' | 'alimtalk' | 'dm' | 'email' | 'inapp' | 'journey';
  targetDescription: string;
  targetFilters: Record<string, unknown> | null;  // customer-filter 호환 JSON (명확한 규칙만)
  targetCount: number | null;                     // ★ DB 실측 (AI 추정 금지)
  timing: string; draftCopy: string;
  estimatedCost: number | null;                   // 문자 채널만 count×단가, 그 외 null("실행 시 산정")
  expectedNote: string;
}
export interface AgencyProposalResult {
  companyName: string;
  situation: string[];        // 기업 현황 요약 (실데이터 근거 문장)
  eventSummary: string;
  plans: AgencyPlan[];
  insights: string[];         // 참고 인사이트 (타겟 선정에 사용 금지 — 표기 전용)
  risks: string[];
  dataNotes: string[];        // insufficient_data 등 정직 표기
}

/** 회사 스코프 실데이터 수집 — 축별 best-effort(실패 축은 dataNotes에 기록하고 생략) */
async function collectContext(companyId: string) {
  const notes: string[] = [];
  const [profileR, memoriesR, campaignsR, companyR] = await Promise.allSettled([
    getCompanyDataProfile(companyId),
    listCompanyMemories(companyId, { limit: 50 }),
    query(
      `SELECT campaign_name, message_type, sent_at, target_count, success_count
         FROM campaigns
        WHERE company_id = $1::uuid AND sent_at IS NOT NULL
        ORDER BY sent_at DESC LIMIT 30`,
      [companyId],
    ),
    query(`SELECT company_name, business_type, brand_name, brand_tone FROM companies WHERE id = $1::uuid`, [companyId]),
  ]);
  if (profileR.status === 'rejected') notes.push('고객DB 현황 분석 실패 — 해당 축 생략');
  if (memoriesR.status === 'rejected') notes.push('AI 학습 메모리 조회 실패 — 해당 축 생략');
  if (campaignsR.status === 'rejected') notes.push('과거 캠페인 이력 조회 실패 — 해당 축 생략');
  return {
    profile: profileR.status === 'fulfilled' ? profileR.value : null,
    memories: memoriesR.status === 'fulfilled' ? memoriesR.value : [],
    campaigns: campaignsR.status === 'fulfilled' ? campaignsR.value.rows : [],
    company: companyR.status === 'fulfilled' ? companyR.value.rows[0] || {} : {},
    notes,
  };
}

/** 플랜별 타겟 실측 — 대상자 수는 AI 추정이 아닌 DB COUNT (영구 룰) */
async function measurePlanTargets(companyId: string, plans: AgencyPlan[]): Promise<void> {
  const costs = await getCompanyCostsSafe(companyId);   // companies cost_per_* 실컬럼 조회 (빈 객체 폴백 금지)
  for (const p of plans) {
    if (!p.targetFilters) { p.targetCount = null; continue; }
    try {
      const { sql, params } = buildFilterWhereClauseCompat(p.targetFilters, 2);
      const r = await query(
        `SELECT COUNT(*)::int AS n FROM customers c
          WHERE c.company_id = $1::uuid AND c.is_active = true AND c.sms_opt_in = true ${sql}`,
        [companyId, ...params],
      );
      p.targetCount = Number(r.rows[0]?.n) || 0;
      const unit = p.channel === 'sms' ? costs.sms : p.channel === 'lms' ? costs.lms : p.channel === 'mms' ? costs.mms : null;
      p.estimatedCost = unit != null && p.targetCount != null ? p.targetCount * unit : null;
    } catch { p.targetCount = null; p.estimatedCost = null; }
  }
}

export async function generateAgencyProposal(
  companyId: string, request: AgencyRequestParsed,
): Promise<AgencyProposalResult> {
  const ctx = await collectContext(companyId);
  const aiText = await callAIWithFallback({
    system: buildAgencySystemPrompt(),               // 아래 규칙 포함
    userMessage: buildAgencyUserMessage(ctx, request),
    maxTokens: 4000,
    model: 'opus',
    creditCost: 0,                                    // ★ 무과금 명시 — source 맵 자동 차감 차단 (Harold 확정)
  });
  const parsed = extractJsonFromAiText(aiText);       // raw 제어문자 안전 파싱 (기존 CT)
  const result = normalizeProposal(parsed, ctx, request);  // 순수 함수 — 스키마 검증·기본값·혜택 강제
  await measurePlanTargets(companyId, result.plans);
  result.dataNotes.push(...ctx.notes);
  return result;
}
```

**시스템 프롬프트 규칙(buildAgencySystemPrompt에 명시 — 코드 출구 가드가 최종 보장)**:
1. 혜택 문구 = 요청서 `benefit` 값만 사용, 임의 %/원/무료/쿠폰 생성 금지
2. 타겟 = 명확한 규칙(등급·최근구매·포인트·가입시점)만 — targetFilters는 customer-filter 문법, 예측 지표 금지
3. 개인화 변수 = %고객명% 등 percent 스타일만 (중괄호 표기 금지 — 서술형으로 지시)
4. 출력 = JSON only (situation/eventSummary/plans/insights/risks)

**출구 가드(normalizeProposal — 순수, vitest 대상)**: plans 최소 1·최대 5 / channel 화이트리스트 밖 → 'lms' / draftCopy에 요청서 밖 구체 혜택 패턴(`\d+%|\d+원|무료|쿠폰`)이 있고 benefit에 없으면 해당 문장 제거 + risks에 기록 / detectLiquidSyntax 검출 시 flattenLiquidToPlainText (기존 CT 재사용).

- [ ] **Step 2-2: normalizeProposal 실패 테스트 → 구현 → PASS** (혜택 가드·채널 화이트리스트·plans 상한 3케이스)
- [ ] **Step 2-3: import 경로 실검증** — callAIWithFallback·listCompanyMemories·getCompanyCosts의 실제 정의 파일을 grep으로 확정해 import 일치 (추측 금지)
- [ ] **Step 2-4: `npx tsc --noEmit` 0 확인**

---

### Task 3: PDF 렌더 CT (`crm-agency-pdf-render.ts`)

**Files:**
- Create: `packages/backend/src/utils/crm-agency-pdf-render.ts` (performance-pdf-render.ts 미러 — doc 주입, DB import 0)

- [ ] **Step 3-1: 구현**

```typescript
// crm-agency-pdf-render.ts — "한줄로 마케팅 제안서" PDF 렌더 (pdfkit doc 주입형, 순수)
// 섹션: 표지 → 기업 현황 → 행사 분석 → 캠페인 플랜 N → 실행 일정 → 비용 총괄
// 모델명 출력 금지("AI 분석") · 전 지표 실데이터 · 부족 축 = dataNotes 표기
import type { AgencyProposalResult } from './crm-agency-proposal';

export function renderAgencyProposalPdf(doc: any, data: AgencyProposalResult & { eventTitle: string; requestedAt: string }): void {
  // 표지
  doc.fontSize(24).text('한줄로 마케팅 제안서', { align: 'center' });
  doc.moveDown(0.5).fontSize(14).text(data.companyName, { align: 'center' });
  doc.fontSize(11).text(`행사: ${data.eventTitle}`, { align: 'center' });
  doc.text(`작성일: ${data.requestedAt} · 분석 대상: ${data.companyName}`, { align: 'center' });  // ★ 업체 스코프 명기
  // 이하 섹션 — performance-pdf-render의 헤딩/표 유틸 스타일 미러 (h2/row 헬퍼 동일 구조로 작성)
  // 플랜 카드: 제목/채널/타겟(규칙 서술 + 실측 N명)/시점/문안 초안/예상 비용(문자만, 그 외 "실행 시 산정")
  // insights = "참고 인사이트(발송 대상 선정에는 사용하지 않음)" 캡션 의무
  // dataNotes = "데이터 참고" 절에 정직 표기
}
```

(실 구현은 performance-pdf-render.ts의 텍스트/표 렌더 헬퍼 구조를 그대로 미러 — 새 스타일 발명 금지.)

- [ ] **Step 3-2: `npx tsc --noEmit` 0 확인**

---

### Task 4: backend 라우트 (`routes/campaign-agency.ts`) + app.ts 마운트

**Files:**
- Create: `packages/backend/src/routes/campaign-agency.ts`
- Modify: `packages/backend/src/app.ts` (기존 라우터 마운트 블록에 1줄 — 전역 express.json() **뒤**, 인증 라우터 관례 위치. 2026-07-02(5) body 파서 사고 재발 금지)

**고객사 endpoints (authenticate + isBetaAccessAllowed 게이트)**
| Method | Path | 동작 |
|---|---|---|
| GET | `/api/campaign-agency/eligibility` | `{eligible: boolean}` — 프론트 메뉴 노출 판단 |
| GET | `/api/campaign-agency/template` | 양식 xlsx 다운로드 — `XLSX.utils.aoa_to_sheet(buildRequestTemplateRows())` → book → buffer 스트림 |
| POST | `/api/campaign-agency/requests` | multer(memoryStorage, xlsx만, 10MB) 업로드 → `uploads/agency-requests/<companyId>/<uuid>.xlsx` fs 저장(정적 서빙 경로 밖 — 인증 다운로드 전용) → 서버 파싱 시도(`XLSX.read(buf)` → `parseRequestSheet`) → INSERT(parsed_json 포함, 실패해도 접수는 성공) → system-alert로 운영자 통지(dedupKey=`agency-request:<id>`) |
| GET | `/api/campaign-agency/requests` | 본 회사 접수 이력 (상태 읽기 전용) |

**슈퍼관리자 endpoints (authenticate + requireSuperAdmin — admin.ts 패턴)**
| Method | Path | 동작 |
|---|---|---|
| GET | `/api/campaign-agency/admin/companies` | 비즈니스+ 업체 목록 — `SELECT c.id, c.company_name FROM companies c JOIN plans p ON c.plan_id = p.id WHERE UPPER(p.plan_code) IN ('BUSINESS','ENTERPRISE') ORDER BY c.company_name` (★ 리스트 자체가 비즈니스+ 만) |
| GET | `/api/campaign-agency/admin/requests?status=` | 전 접수 목록 (업체명 JOIN) |
| GET | `/api/campaign-agency/admin/requests/:id/file` | 요청서 원본 다운로드 |
| PATCH | `/api/campaign-agency/admin/requests/:id` | status(`received/designing/delivered/done/on_hold` 화이트리스트)·staff_note·parsed_json(직원 보정) |
| POST | `/api/campaign-agency/admin/requests/:id/design` | ★ 분석 실행: 요청 행의 company_id로 `generateAgencyProposal(companyId, parsed)` → pdfkit doc → `uploads/agency-proposals/<companyId>/<requestId>.pdf` 저장 → `proposal_pdf_path`·`designed_at`·status='designing' 유지(전달은 직원이 상태 변경). 멱등: 재실행 = PDF 덮어씀 |
| POST | `/api/campaign-agency/admin/design-adhoc` | 접수 없이 직접: `{companyId, parsed}` 받아 동일 파이프라인 (Harold 스펙 "업체 선택+양식 업로드" 직행 흐름) — companyId가 비즈니스+ 인지 서버 재검증 |
| GET | `/api/campaign-agency/admin/requests/:id/proposal` | 제안서 PDF 다운로드 |

공통: 신규 테이블 조회 catch에 `column/relation does not exist` → 503 `DB_MIGRATION_PENDING` 분기 (db_alter_safety_net).

- [ ] **Step 4-1: 라우트 구현** (위 표 전부 — 각 핸들러는 위 CT 호출만, 인라인 로직 금지)
- [ ] **Step 4-2: app.ts 마운트 위치 확인 후 1줄 추가** — 마운트가 전역 json 파서 뒤인지 실측
- [ ] **Step 4-3: `npx tsc --noEmit` 0**

---

### Task 5: 고객사 접수 페이지 (frontend)

**Files:**
- Create: `packages/frontend/src/pages/CampaignAgencyPage.tsx`
- Modify: `packages/frontend/src/App.tsx` (라우트 `/campaign-agency`)
- Modify: 메뉴 진입점 — Dashboard.tsx의 planInfo 소비 위치 grep 후, `['BUSINESS','ENTERPRISE'].includes(planInfo?.plan_code)`일 때만 카드/메뉴 노출 (+ 페이지 진입 시 `/eligibility` 재확인 — 이중 게이트)

**구성 (Journey 동급 디자인 — 다크 slate + violet, 모바일 반응형, native dialog 0)**
- sticky 헤더(그라데이션 아이콘 + "캠페인 설계 대행") + `goBackOr(navigate, '/dashboard')` 뒤로가기
- 서비스 안내 카드(비즈니스 전용 특별 서비스 — 흐름 3단 안내: 요청서 작성→분석·제안서 전달→컨펌 후 대행 진행)
- 양식 다운로드 버튼(GET /template blob 다운로드)
- 접수 폼: 행사명(필수)·메모(선택)·파일 업로드(xlsx, 1개) → 업로드 중 로딩 오버레이+close 차단(D185)
- 내 접수 이력: 상태 뱃지(접수됨/설계 중/제안서 전달/완료/보류) + 접수일 — 읽기 전용
- useToast 성공/실패 · Source caption

- [ ] **Step 5-1: 페이지+라우트+메뉴 구현**
- [ ] **Step 5-2: `npx tsc --noEmit` 0 + 금지 grep(모델명·native dialog·박-단어) 0**

---

### Task 6: 슈퍼관리자 설계 페이지 (frontend)

**Files:**
- Create: `packages/frontend/src/pages/AdminCampaignAgencyPage.tsx`
- Modify: `packages/frontend/src/App.tsx` (라우트 `/admin/campaign-agency`)
- Modify: `packages/frontend/src/pages/AdminDashboard.tsx` — 2701 근처 메뉴 배열에 `{ key: 'campaignAgency', label: '캠페인 대행 설계', onClick: () => navigate('/admin/campaign-agency') }` 1줄 (bestCopy 패턴 — AdminDashboard 비대 방지 위해 별도 페이지)

**구성 (슈퍼관리자 화이트 모던 톤 — AdminDashboard 관례)**
- 좌: 접수함(상태 필터 탭 + 목록: 업체·행사명·접수일·상태 select·파일 다운로드)
- 우(접수 선택 시): 파싱 결과 폼(행사명·기간·내용·혜택·채널·예산·상품 표 — 직원 수정 가능, missingRequired 하이라이트) + staff_note + **[분석 실행 → 제안서 생성]** 버튼(로딩 오버레이 — AI 수십 초) + 생성 후 PDF 다운로드 버튼
- 직행 카드: 업체 select(admin/companies — 비즈니스+ 만) + 양식 업로드 → design-adhoc
- 분석 실행 확인 ConfirmModal("[업체명] 데이터만으로 분석합니다") — 업체 스코프 시각 확인

- [ ] **Step 6-1: 페이지+라우트+메뉴 구현**
- [ ] **Step 6-2: `npx tsc --noEmit` 0 + 금지 grep 0**

---

### Task 7: 통합 검증

- [ ] backend `npx tsc --noEmit` 0 / frontend `npx tsc --noEmit` 0
- [ ] backend `npx vitest run` 전건 통과 (기존 382 + 신규)
- [ ] 금지 패턴 grep 0: 신규 파일 전체에 `Opus|Sonnet|GPT|Claude|alert\(|confirm\(|prompt\(|박음|박힘|박는|박지|박을` = 0
- [ ] 업체 스코프 grep: `crm-agency-proposal.ts`의 모든 `query(` 호출에 `company_id = $1` 존재 확인 (불변식 §4)
- [ ] 무과금 확인: 파이프라인 AI 호출 전부 `creditCost: 0` grep 확인
- [ ] 표준 종료 멘트 + 배포 명령 안내 (tp-push · build:safe frontend+backend · pm2 reload — Harold 직접)
- [ ] **실측 1건 (Harold/직원)**: 비즈니스 요금제 계정으로 양식 다운로드→작성→접수 → 슈퍼관리자 접수함 확인→파싱 보정→분석 실행→PDF 열람(업체명·실측 인원수·혜택=기입값 검수) → 미만 요금제 계정에서 메뉴 비노출 확인

**Self-review 완료**: 스펙 §1~§9 전 요구 = Task 0~7 매핑 확인 / placeholder 0 / 타입명 일관(AgencyRequestParsed·AgencyPlan·AgencyProposalResult 관통). 유일한 열린 항목 = Task 2 import 실경로(Step 2-3에서 grep 확정 — 추측 금지 룰 준수).
