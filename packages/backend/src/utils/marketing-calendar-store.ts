/**
 * marketing-calendar-store.ts — 마케팅 캘린더 저장·등록상태 CT (2026-07-05)
 *
 * 배경: 옛 캘린더는 프론트 useState뿐이라 새로고침이면 50크레딧 설계가 증발했고,
 *   등록 상태·같은 달 중복 등록(200 중복 차감)도 막지 못했다.
 * 구조: company_marketing_calendars 회사당 1행 UPSERT.
 *   - entries: AI 설계 12개월(JSONB 배열) — 재생성 시 통째 교체
 *   - registrations: { "월": operator_id } — 재생성해도 유지(등록 이력은 설계와 독립)
 * 안전망: 테이블 미생성(42P01/does not exist) = null/false 폴백 — CREATE 후 자동 활성 (db_alter_safety_net).
 *
 * DDL (Harold 서버 psql — 2026-07-05 information_schema 0행 실측 후 확정):
 *   CREATE TABLE company_marketing_calendars (
 *     company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
 *     entries jsonb NOT NULL DEFAULT '[]'::jsonb,
 *     registrations jsonb NOT NULL DEFAULT '{}'::jsonb,
 *     created_at timestamptz NOT NULL DEFAULT NOW(),
 *     updated_at timestamptz NOT NULL DEFAULT NOW()
 *   );
 */

import { query } from '../config/database';
import type { CalendarEntry, CalendarPromptInput } from './marketing-calendar-policy';

export interface SavedMarketingCalendar {
  entries: CalendarEntry[];
  registrations: Record<string, string>; // "1"~"12" → operator_id
  updatedAt: string | null;
}

function isMissingTable(err: unknown): boolean {
  const msg = (err as any)?.message || '';
  return msg.includes('does not exist');
}

/** 설계 저장(UPSERT) — 재생성 시 entries만 교체, registrations 유지. 테이블 미생성 = false(저장 생략). */
export async function saveCalendarEntries(companyId: string, entries: CalendarEntry[]): Promise<boolean> {
  try {
    await query(
      `INSERT INTO company_marketing_calendars (company_id, entries, created_at, updated_at)
       VALUES ($1::uuid, $2::jsonb, NOW(), NOW())
       ON CONFLICT (company_id) DO UPDATE SET
         entries = EXCLUDED.entries,
         updated_at = NOW()`,
      [companyId, JSON.stringify(entries)],
    );
    return true;
  } catch (err) {
    if (isMissingTable(err)) {
      console.warn('[MarketingCalendarStore] company_marketing_calendars 미생성 — 저장 생략 (CREATE 대기)');
      return false;
    }
    throw err;
  }
}

/** 저장된 캘린더 조회. 없거나 테이블 미생성 = null. */
export async function getSavedCalendar(companyId: string): Promise<SavedMarketingCalendar | null> {
  try {
    const r = await query(
      `SELECT entries, registrations, updated_at FROM company_marketing_calendars WHERE company_id = $1::uuid`,
      [companyId],
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    return {
      entries: Array.isArray(row.entries) ? row.entries : [],
      registrations: row.registrations && typeof row.registrations === 'object' ? row.registrations : {},
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    };
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/**
 * 그 달에 살아있는(보관 아님) 등록 오퍼레이터가 이미 있는지 — 같은 달 중복 등록(200 중복 차감) 차단용.
 * 등록 오퍼레이터를 사용자가 보관(archived)했으면 재등록 허용.
 */
export async function getActiveRegistration(companyId: string, month: number): Promise<string | null> {
  try {
    const r = await query(
      `SELECT c.registrations->>$2::text AS operator_id
         FROM company_marketing_calendars c
        WHERE c.company_id = $1::uuid`,
      [companyId, String(month)],
    );
    const operatorId = r.rows[0]?.operator_id;
    if (!operatorId) return null;
    const alive = await query(
      `SELECT id FROM continuous_operators WHERE id = $1::uuid AND company_id = $2::uuid AND status != 'archived'`,
      [operatorId, companyId],
    );
    return alive.rows.length > 0 ? String(operatorId) : null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/**
 * ★ 2026-07-05 P2-6: 캘린더 설계용 회사 실데이터 컨텍스트 — 축별 best-effort(실패 = 그 축만 생략, 설계는 진행).
 * - monthlyRevenue: cdp_events purchase/order 월별 집계(컬럼 전부 automarketing-roi 배포 실증분 재사용)
 * - memoryContext: ai_company_memory 요약(buildMemoryPromptContext CT 재사용, 상위 10)
 * - existingCampaigns: 활성 오퍼레이터 최근 20 — 같은 달 목적 중복 회피 지시용(schedule_month 42703 = 생략)
 */
export type CompanyCalendarContext = Pick<CalendarPromptInput, 'monthlyRevenue' | 'memoryContext' | 'existingCampaigns'>;

export async function buildCompanyCalendarContext(companyId: string): Promise<CompanyCalendarContext> {
  const ctx: CompanyCalendarContext = {};
  try {
    const rev = await query(
      `SELECT EXTRACT(MONTH FROM occurred_at)::int AS month,
              COUNT(*)::int AS purchases,
              COALESCE(SUM((properties->>'total_amount')::numeric), 0)::float AS revenue
         FROM cdp_events
        WHERE company_id = $1::uuid
          AND event_name IN ('purchase', 'order')
          AND occurred_at > NOW() - interval '365 days'
        GROUP BY 1 ORDER BY 1`,
      [companyId],
    );
    if (rev.rows.length > 0) {
      ctx.monthlyRevenue = rev.rows.map((r: any) => ({
        month: Number(r.month), purchases: Number(r.purchases) || 0, revenue: Number(r.revenue) || 0,
      }));
    }
  } catch (e: any) {
    console.log('[MarketingCalendarStore] 월별 구매 컨텍스트 생략:', e?.message || e);
  }
  try {
    const { buildMemoryPromptContext } = await import('./company-memory');
    const mem = await buildMemoryPromptContext(companyId, 10);
    if (mem && mem.trim()) ctx.memoryContext = mem;
  } catch (e: any) {
    console.log('[MarketingCalendarStore] 학습 메모리 컨텍스트 생략:', e?.message || e);
  }
  try {
    const ops = await query(
      `SELECT name, schedule, schedule_month, schedule_day_of_month
         FROM continuous_operators
        WHERE company_id = $1::uuid AND status = 'active'
        ORDER BY created_at DESC LIMIT 20`,
      [companyId],
    );
    if (ops.rows.length > 0) {
      ctx.existingCampaigns = ops.rows.map((r: any) => ({
        name: String(r.name || ''),
        schedule: String(r.schedule || 'daily'),
        scheduleMonth: r.schedule_month ?? null,
        scheduleDayOfMonth: r.schedule_day_of_month ?? null,
      }));
    }
  } catch (e: any) {
    console.log('[MarketingCalendarStore] 기존 캠페인 컨텍스트 생략:', e?.message || e);
  }
  return ctx;
}

/** 등록 기록 — registrations["월"] = operator_id. 행 없으면 생성. 테이블 미생성 = 생략. */
export async function markCalendarRegistration(companyId: string, month: number, operatorId: string): Promise<void> {
  try {
    await query(
      `INSERT INTO company_marketing_calendars (company_id, entries, registrations, created_at, updated_at)
       VALUES ($1::uuid, '[]'::jsonb, jsonb_build_object($2::text, $3::text), NOW(), NOW())
       ON CONFLICT (company_id) DO UPDATE SET
         registrations = company_marketing_calendars.registrations || jsonb_build_object($2::text, $3::text),
         updated_at = NOW()`,
      [companyId, String(month), operatorId],
    );
  } catch (err) {
    if (isMissingTable(err)) {
      console.warn('[MarketingCalendarStore] 테이블 미생성 — 등록 기록 생략 (CREATE 대기)');
      return;
    }
    throw err;
  }
}
