/**
 * callback-lookup.ts — 발신번호 조회 CT (★ 2026-11-23 특수한 유형의 부가통신사업 갱신 1-1 ④
 *   「발신번호로 계정 ID, 이용자명, 발신일 등을 조회할 수 있도록 조치」 · Harold 「슈퍼관리자에 만들어야지」)
 *
 * 쓰는 곳 = 슈퍼관리자 「발신번호 관리 → 발신번호 조회」 하나(POST /api/admin/callback-lookup · 번호가 주소에 남지 않게 본문).
 * 읽기만 한다 · 새 표 · 칸 0(DDL 0). 칸 존재 = 1123 information_schema 실측(Harold 실행).
 *
 * 등록 정보 = callback_numbers 에서 그 번호(숫자만 비교) + 배정 계정 · 사용 범위(판정 = callback-filter CT 그대로).
 * 발송 이력 = campaigns.callback_number 가 그 번호인 캠페인(작성 중 draft 제외) · 보낸 계정 = campaigns.user_id.
 *   ⛔ 대상 밖(설계 1123 Harold 승인): 수신자마다 회신번호가 다른 캠페인의 번호별 사용(발송 큐에만 있음 · 큐 전체 훑기 = 발송 DB 부하) ·
 *      비토 게이트웨이 사설발송(비토 콘솔 소관).
 */
import { query } from '../config/database';
import { normalizePhone } from './normalize-phone';
import { CALLBACK_ASSIGNEES_SQL, describeCallbackUsage } from './callback-filter';
import { sendTypeLabel } from './send-type-axis';

export const CALLBACK_LOOKUP_PAGE_SIZE = 20;

/** 조회할 수 있는 번호 꼴 — 숫자만 8 ~ 12자리(발신번호 규격 = 8 ~ 11자리 · 030 · 050 = 12자리) */
export function parseLookupPhone(raw: unknown): string | null {
  const digits = normalizePhone(String(raw ?? ''));
  return /^\d{8,12}$/.test(digits) ? digits : null;
}

/** 쪽 번호 — 1 이상 정수 · 그 밖은 1 */
export function parseLookupPage(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export interface CallbackLookupResult {
  phone: string;
  registrations: Array<{
    id: string;
    companyName: string | null;
    phone: string;
    label: string | null;
    createdAt: string | null;
    usageScope: string;
    assignees: Array<{ loginId: string; name: string | null }>;
  }>;
  sends: Array<{
    campaignId: string;
    sentAt: string | null;
    scheduledAt: string | null;
    createdAt: string | null;
    companyName: string | null;
    loginId: string | null;
    userName: string | null;
    campaignName: string | null;
    sendType: string;
    status: string | null;
    targetCount: number | null;
    successCount: number | null;
    failCount: number | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

const iso = (v: any): string | null => (v ? new Date(v).toISOString() : null);
const num = (v: any): number | null => (v === null || v === undefined ? null : Number(v));

export async function lookupCallbackNumber(phone: string, page: number): Promise<CallbackLookupResult> {
  const reg = await query(
    `SELECT cn.id, cn.company_id, cn.phone, cn.label, cn.assignment_scope, cn.created_at, c.company_name, ${CALLBACK_ASSIGNEES_SQL}
       FROM callback_numbers cn
       LEFT JOIN companies c ON c.id = cn.company_id
      WHERE regexp_replace(COALESCE(cn.phone, ''), '\\D', '', 'g') = $1
      ORDER BY c.company_name NULLS LAST, cn.created_at`,
    [phone],
  );
  const usage = await describeCallbackUsage(reg.rows as any[]);

  const where = `regexp_replace(COALESCE(ca.callback_number, ''), '\\D', '', 'g') = $1 AND COALESCE(ca.status, '') <> 'draft'`;
  const cnt = await query(`SELECT COUNT(*)::int AS n FROM campaigns ca WHERE ${where}`, [phone]);
  const total = Number(cnt.rows[0]?.n || 0);
  const sends = await query(
    `SELECT ca.id, ca.campaign_name, ca.send_type, ca.status, ca.sent_at, ca.scheduled_at, ca.created_at,
            ca.target_count, ca.success_count, ca.fail_count,
            co.company_name, u.login_id, u.name AS user_name
       FROM campaigns ca
       LEFT JOIN companies co ON co.id = ca.company_id
       LEFT JOIN users u ON u.id = ca.user_id
      WHERE ${where}
      ORDER BY COALESCE(ca.sent_at, ca.scheduled_at, ca.created_at) DESC, ca.id DESC
      LIMIT $2 OFFSET $3`,
    [phone, CALLBACK_LOOKUP_PAGE_SIZE, (page - 1) * CALLBACK_LOOKUP_PAGE_SIZE],
  );

  return {
    phone,
    registrations: (reg.rows as any[]).map((r) => {
      const u = usage.get(r.id);
      return {
        id: r.id,
        companyName: r.company_name ?? null,
        phone: r.phone,
        label: r.label ?? null,
        createdAt: iso(r.created_at),
        usageScope: u?.usage_scope || 'all',
        assignees: (u?.assignees || []).map((a: any) => ({ loginId: String(a.loginId ?? ''), name: a.name ?? null })),
      };
    }),
    sends: (sends.rows as any[]).map((s) => ({
      campaignId: s.id,
      sentAt: iso(s.sent_at),
      scheduledAt: iso(s.scheduled_at),
      createdAt: iso(s.created_at),
      companyName: s.company_name ?? null,
      loginId: s.login_id ?? null,
      userName: s.user_name ?? null,
      campaignName: s.campaign_name ?? null,
      sendType: sendTypeLabel(s.send_type),
      status: s.status ?? null,
      targetCount: num(s.target_count),
      successCount: num(s.success_count),
      failCount: num(s.fail_count),
    })),
    total,
    page,
    pageSize: CALLBACK_LOOKUP_PAGE_SIZE,
  };
}
