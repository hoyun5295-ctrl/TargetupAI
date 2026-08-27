/**
 * ★ 2026-06-11 감사 로그 컨트롤타워 — 에이치피오 예약취소 사고 후속 (라인 지정/해제 책임 추적 부재 해소).
 *
 * - 기존 audit_logs 테이블(로그인 추적용) 재사용 — 신규 테이블/ALTER 0.
 *   INSERT 형식은 기존 admin.ts customer_delete_by_user 기록(7컬럼)과 동일.
 * - recordAuditLog는 실패를 내부에서 흡수 — 본 동작(사용자 수정/라인그룹 변경 등)에 절대 영향 없음.
 * - 열람 권한: ENV AUDIT_LOG_VIEWER_IDS (콤마 구분 super_admins.login_id, 기본 'ceo')만 허용.
 */
import { query } from '../config/database';
import { fetchAdminRole, canRead } from './admin-role';

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
 * 슈퍼관리자 계정 화이트리스트 판정 (공통 코어) — **등급 AND ENV** 두 관문을 모두 통과해야 열린다.
 * 미로그인·미등록·조회 실패는 전부 false(닫힘). 권한 판정은 실패 시 열리면 안 된다.
 *
 * ★ 2026-08-27 등급 관문 추가(전송자격인증 3.2) — 근거 = utils/admin-role.ts 권한분류표.
 *   ⛔ **AND로 붙인다.** 등급이 열어도 ENV가 막으면 막힌 채로 둔다. 그래야 이 축을 도입하면서
 *      지금 닫혀 있는 것이 열리는 일이 구조적으로 불가능하다(권한 축 도입이 권한 개방이 되면 안 된다).
 *   ⚠ `permKey`가 없으면 등급 관문을 건너뛴다 — 분류표에 아직 올리지 않은 축을 조용히 막지 않기 위해서다.
 *      새 축을 만들 때 permKey를 함께 넘기는 것이 규율이다.
 */
async function isSuperAdminAllowed(
  superAdminId: string | null | undefined,
  envKey: string,
  fallbackIds: string,
  tag: string,
  permKey?: string,
): Promise<boolean> {
  if (!superAdminId) return false;
  try {
    if (permKey) {
      const role = await fetchAdminRole(superAdminId);
      if (!canRead(role, permKey)) return false;
    }
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
  return isSuperAdminAllowed(superAdminId, 'AUDIT_LOG_VIEWER_IDS', 'ceo', 'audit-log', 'auditLogs');
}

/**
 * 국외 접근 이력(/geo/hits) 열람 권한 — GEO_HITS_VIEWER_IDS(기본 'ceo,suran')에 포함된 super_admins.login_id만 허용.
 * Harold 명시 2026-08-24: 감사 로그는 ceo만, **국외 접근 이력은 suran도** 본다(방통위 대응 운영 담당).
 * 그래서 감사 로그 게이트(isAuditLogViewer)를 재사용하지 않고 축을 나눈다 — 합치면 한쪽을 열 때 다른 쪽도 열린다.
 */
export function isGeoHitsViewer(superAdminId?: string | null): Promise<boolean> {
  return isSuperAdminAllowed(superAdminId, 'GEO_HITS_VIEWER_IDS', 'ceo,suran', 'geo-hits', 'geoHits');
}

/**
 * 도움말 질문 이력 열람 권한 — HELP_QUESTION_VIEWER_IDS(기본 'ceo')에 포함된 super_admins.login_id만 허용.
 * Harold 명시 2026-08-24: 어떤 업체가 어떤 질문을 했는지는 ceo 계정에서만 본다(감사 로그와 같은 규약).
 */
export function isHelpQuestionViewer(superAdminId?: string | null): Promise<boolean> {
  return isSuperAdminAllowed(superAdminId, 'HELP_QUESTION_VIEWER_IDS', 'ceo', 'help-questions', 'helpQuestions');
}

/**
 * AI 학습 데이터 열람 권한 — AI_TRAINING_VIEWER_IDS(기본 'ceo')에 포함된 super_admins.login_id만 허용.
 * 인비토AI 학습 데이터는 전사 비식별 집계라 소유자(ceo) 전용. 감사 로그와 분리된 별도 env.
 */
export function isAiTrainingViewer(superAdminId?: string | null): Promise<boolean> {
  return isSuperAdminAllowed(superAdminId, 'AI_TRAINING_VIEWER_IDS', 'ceo', 'ai-training', 'aiTraining');
}

/**
 * ★ 2026-08-16 마케팅 진단 관리(신규마케팅진단) 열람 권한 — MARKETING_DIAGNOSIS_VIEWER_IDS(기본 'ceo').
 * 신규 리드·진단 파이프라인은 영업 자산이라 소유자(ceo) 전용. 다른 축과 별도 env(한 계정을 열어줄 때
 * 다른 축까지 함께 열리면 안 된다). ⚠ 인자 = req.user.userId(super_admins.id uuid) — loginId 문자열을
 * 넘기면 uuid 비교 예외를 코어 catch가 삼켜 전원 차단된다(설계서 §4-6 D1).
 */
export function isDiagnosisViewer(superAdminId?: string | null): Promise<boolean> {
  return isSuperAdminAllowed(superAdminId, 'MARKETING_DIAGNOSIS_VIEWER_IDS', 'ceo', 'marketing-diagnosis', 'marketingDiagnosis');
}

/**
 * ★ 2026-08-05 총 정산표 열람 권한 — SETTLEMENT_OVERVIEW_VIEWER_IDS(기본 'ceo').
 * 전 고객사의 총 청구금·수금·미납을 한 화면에 모으는 소유자용 집계라 감사 로그와 같은 급으로 잠근다.
 * 직원 계정은 자기 담당 정산만 보고, 회사 전체 미납 총액은 보지 않는다(Harold 명시 2026-08-05).
 * 감사 로그·AI 학습과 **별도 env** — 한 계정을 열어줄 때 다른 축까지 함께 열리면 안 된다.
 */
export function isSettlementOverviewViewer(superAdminId?: string | null): Promise<boolean> {
  return isSuperAdminAllowed(superAdminId, 'SETTLEMENT_OVERVIEW_VIEWER_IDS', 'ceo', 'settlement-overview', 'settlementOverview');
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
  return isSuperAdminAllowed(superAdminId, 'LINE_GROUP_ADMIN_USERS', 'ceo,admin', 'line-group', 'lineGroups');
}

/**
 * ★ 2026-08-24 AI 영업 아웃리치 실행 권한 — SALES_OUTREACH_ALLOWED_USERS(기본 'ceo').
 * 영업 산출물 생성·자사 메일 발송을 만드는 축이라 소유자(ceo) 전용. 다른 축과 별도 env
 * (한 계정을 열 때 다른 축까지 함께 열리면 안 된다). fail-closed 코어 재사용 —
 * super_admin이라는 이유만으로 통과하는 분기를 만들지 않는다(plan-guard의 fail-open 패턴 금지).
 * 설계 = docs/2026-07-31-ai-sales-outreach-design.md §15-6.
 */
export function isSalesOutreachOperator(superAdminId?: string | null): Promise<boolean> {
  return isSuperAdminAllowed(superAdminId, 'SALES_OUTREACH_ALLOWED_USERS', 'ceo', 'sales-outreach', 'salesOutreach');
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
