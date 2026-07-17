/**
 * ★ 2026-06-11 감사 로그 컨트롤타워 — 에이치피오 예약취소 사고 후속 (라인 지정/해제 책임 추적 부재 해소).
 *
 * - 기존 audit_logs 테이블(로그인 추적용) 재사용 — 신규 테이블/ALTER 0.
 *   INSERT 형식은 기존 admin.ts customer_delete_by_user 기록(7컬럼)과 동일.
 * - recordAuditLog는 실패를 내부에서 흡수 — 본 동작(사용자 수정/라인그룹 변경 등)에 절대 영향 없음.
 * - 열람 권한: ENV AUDIT_LOG_VIEWER_IDS (콤마 구분 super_admins.login_id, 기본 'ceo')만 허용.
 */
import { query } from '../config/database';

export interface AuditLogInput {
  actorUserId?: string | null;   // 행위자 id (super_admins.id 또는 users.id)
  action: string;                // 'user_update' / 'line_group_update' 등
  targetType?: string | null;    // 'user' | 'line_group' | 'company' 등
  targetId?: string | null;
  details?: any;                 // { before, after, changed } 등
  req?: any;                     // Express req — ip / user-agent 자동 수집
}

/** 감사 로그 기록 — 실패해도 본 동작에 영향 0 (모든 예외 내부 흡수) */
export async function recordAuditLog(input: AuditLogInput): Promise<void> {
  try {
    const req = input.req;
    await query(
      `INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.actorUserId || null,
        input.action,
        input.targetType || null,
        input.targetId || null,
        input.details !== undefined ? JSON.stringify(input.details) : null,
        req?.ip || null,
        req?.headers?.['user-agent'] || '',
      ]
    );
  } catch (err: any) {
    console.log('[audit-log] 기록 실패 (본 동작 영향 없음):', err?.message);
  }
}

/**
 * 슈퍼관리자 계정 화이트리스트 판정 (공통 코어) — ENV(콤마 구분 super_admins.login_id) 기준.
 * 미로그인·미등록·조회 실패는 전부 false(닫힘). 권한 판정은 실패 시 열리면 안 된다.
 */
async function isSuperAdminAllowed(
  superAdminId: string | null | undefined,
  envKey: string,
  fallbackIds: string,
  tag: string,
): Promise<boolean> {
  if (!superAdminId) return false;
  try {
    const me = await query('SELECT login_id FROM super_admins WHERE id = $1', [superAdminId]);
    const allowed = (process.env[envKey] || fallbackIds)
      .split(',').map((s) => s.trim()).filter(Boolean);
    return me.rows.length > 0 && allowed.includes(me.rows[0].login_id);
  } catch (err: any) {
    console.log(`[${tag}] 열람 권한 확인 실패:`, err?.message);
    return false;
  }
}

/**
 * 감사 로그 열람 권한 — AUDIT_LOG_VIEWER_IDS(기본 'ceo')에 포함된 super_admins.login_id만 허용.
 * Harold 명시 2026-06-11: 감사 로그는 ceo 계정에서만 열람.
 */
export function isAuditLogViewer(superAdminId?: string | null): Promise<boolean> {
  return isSuperAdminAllowed(superAdminId, 'AUDIT_LOG_VIEWER_IDS', 'ceo', 'audit-log');
}

/**
 * AI 학습 데이터 열람 권한 — AI_TRAINING_VIEWER_IDS(기본 'ceo')에 포함된 super_admins.login_id만 허용.
 * 인비토AI 학습 데이터는 전사 비식별 집계라 소유자(ceo) 전용. 감사 로그와 분리된 별도 env.
 */
export function isAiTrainingViewer(superAdminId?: string | null): Promise<boolean> {
  return isSuperAdminAllowed(superAdminId, 'AI_TRAINING_VIEWER_IDS', 'ceo', 'ai-training');
}

/**
 * ★ 2026-07-17 발송 라인그룹 쓰기(생성/수정/삭제) 권한 — LINE_GROUP_ADMIN_USERS(기본 'ceo,admin').
 * Harold 명시: 라인 설정은 ceo·admin 두 계정만.
 * 라인그룹은 발송 라우팅 축이라 잘못 건드리면 적재·취소·집계·정산이 한꺼번에 어긋난다
 * (2026-06-11 에이치피오 예약취소 미삭제 사고 = 적재 라인과 취소 라인 불일치가 직접 원인).
 * 조회(GET)는 이 게이트를 걸지 않는다 — 고객사/사용자 편집 모달의 발송 라인 드롭다운이
 * 같은 API를 쓰므로, 걸면 다른 슈퍼관리자의 라인 배정 화면이 조용히 깨진다.
 */
export function isLineGroupAdmin(superAdminId?: string | null): Promise<boolean> {
  return isSuperAdminAllowed(superAdminId, 'LINE_GROUP_ADMIN_USERS', 'ceo,admin', 'line-group');
}

/** 변경 전/후 객체에서 달라진 필드만 추출 — details 용량 최소화 + 변경 없는 수정은 기록 생략용 */
export function diffFields(
  before: Record<string, any>,
  after: Record<string, any>,
  keys: string[]
): { before: Record<string, any>; after: Record<string, any>; changed: string[] } {
  const b: Record<string, any> = {};
  const a: Record<string, any> = {};
  const changed: string[] = [];
  for (const k of keys) {
    const bv = before?.[k] ?? null;
    const av = after?.[k] ?? null;
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      b[k] = bv; a[k] = av; changed.push(k);
    }
  }
  return { before: b, after: a, changed };
}
