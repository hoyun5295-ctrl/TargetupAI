/**
 * admin-role.ts — 인비토 직원(슈퍼관리자) 계정 등급 컨트롤타워 (★2026-08-27 전송자격인증 3.2·3.3)
 *
 * 심사 기준 원문 —
 *   3.2 "계정ID·소속·Read/Write/Delete 등 권한 수준을 명시한 권한분류표 · 시스템과 문서의 일치 ·
 *        일부 설정만 가능하도록 제한된 UI"
 *   3.3 "접근권한 변경 이력 및 사유 관리대장 · 계정별 권한 조회 · 계정 생성/삭제 로그"
 *
 * ⛔ 설계 원칙 4개
 *  1. **권한분류표의 원본은 이 파일 하나다.** 화면은 이 매트릭스를 API로 받아 그린다.
 *     문서(docx)에 표를 따로 적어 두면 시스템과 갈라지고, 기준이 요구하는 "시스템과 문서의 일치"가 깨진다.
 *  2. **등급 판정은 실패 시 닫힌다.** 미로그인·미등록·조회 실패는 전부 최저 등급으로 본다.
 *     권한 판정이 실패할 때 열리면 통제가 아니다(= utils/audit-log.ts `isSuperAdminAllowed`와 같은 규율).
 *  3. **기존 ENV 화이트리스트를 대체하지 않는다.** 등급이 먼저 막고, 통과한 것만 기존 ENV가 한 번 더 본다(AND).
 *     그래야 이 축을 도입하면서 지금 닫혀 있는 것이 열리는 일이 구조적으로 불가능하다.
 *  4. **role 값이 비어 있거나 모르는 값이면 `support`로 본다.** 새 등급을 오타로 적었을 때 전권이 되면 안 된다.
 *     ⚠ 단 현재 운영 데이터는 4계정 전부 `super`다. 등급 배정 전까지는 아무도 좁혀지지 않는다.
 */
import { query } from '../config/database';

/** 등급 — 값은 `super_admins.role` 컬럼에 그대로 들어간다 */
export type AdminRole = 'super' | 'lead' | 'support';

export const ADMIN_ROLES: AdminRole[] = ['super', 'lead', 'support'];

export const ADMIN_ROLE_LABEL: Record<AdminRole, string> = {
  super: '대표',
  lead: '지원팀장',
  support: '지원팀원',
};

export const ADMIN_ROLE_DESC: Record<AdminRole, string> = {
  super: '전 영역 조회·변경·삭제. 관리자 계정과 감사 기록은 이 등급만 다룬다.',
  lead: '운영 전 영역 조회·변경·삭제. 감사 기록과 학습 데이터는 제외.',
  support: '운영 영역 조회·변경. 삭제와 시스템 설정은 제외.',
};

/** 권한 수준 — 심사 제출 표기와 같은 어휘를 쓴다 */
export type AccessLevel = 'RWD' | 'RW' | 'R' | 'NONE';

export const ACCESS_LEVEL_LABEL: Record<AccessLevel, string> = {
  RWD: '조회·변경·삭제',
  RW: '조회·변경',
  R: '조회',
  NONE: '접근 불가',
};

export interface PermissionRow {
  /** 화면 탭 key 또는 기능 축 id */
  key: string;
  /** 심사 제출 표기용 영역 이름 */
  area: string;
  /** 그 영역에 속한 화면 이름(심사관이 화면과 표를 대조한다) */
  screens: string;
  levels: Record<AdminRole, AccessLevel>;
}

/**
 * ★ 권한분류표 — 심사에 내는 표가 이것이다.
 * 배정 근거 = 2026-08-27 감사 로그 90일 실측(계정별 실제 수행 action)과 Harold 확정.
 *   · 단가 변경은 지원팀장이 90일 70건 수행 → 요금 영역을 대표 전용으로 두면 실무가 막힌다.
 *   · 지원팀원 2명은 90일간 고객DB 전체 삭제 0건 → 삭제만 빼도 실무 영향이 없다.
 */
export const PERMISSION_MATRIX: PermissionRow[] = [
  {
    key: 'customers',
    area: '고객사·사용자',
    screens: '고객사 관리 · 사용자 관리',
    levels: { super: 'RWD', lead: 'RWD', support: 'RW' },
  },
  {
    key: 'sending',
    area: '발송·발신번호',
    screens: '발신번호 관리 · 예약 관리 · 캠페인 관리 · 템플릿 관리 · 대행발송',
    levels: { super: 'RWD', lead: 'RWD', support: 'RW' },
  },
  {
    key: 'billing',
    area: '요금·정산',
    screens: '요금제 관리 · 플랜 신청 · 충전 관리 · 크레딧 관리 · 정산 관리',
    levels: { super: 'RWD', lead: 'RWD', support: 'RW' },
  },
  {
    key: 'customerDataDelete',
    area: '고객DB 전체 삭제',
    screens: '고객사 편집 · 고객DB 탭',
    levels: { super: 'RWD', lead: 'RWD', support: 'NONE' },
  },
  {
    key: 'settlementOverview',
    area: '정산 총괄',
    screens: '정산 총괄 현황',
    levels: { super: 'R', lead: 'R', support: 'NONE' },
  },
  {
    key: 'salesOutreach',
    area: 'AI 영업',
    screens: 'AI 영업',
    levels: { super: 'RWD', lead: 'RWD', support: 'NONE' },
  },
  {
    key: 'marketingDiagnosis',
    area: '신규마케팅진단',
    screens: '신규마케팅진단',
    levels: { super: 'RW', lead: 'RW', support: 'NONE' },
  },
  {
    key: 'lineGroups',
    area: '발송 라인 설정',
    screens: '발송 라인 설정',
    levels: { super: 'RWD', lead: 'RWD', support: 'NONE' },
  },
  {
    key: 'geoHits',
    area: '국외 접근 이력',
    screens: '국외 접근 통제 · 탐지 차단 로그',
    levels: { super: 'R', lead: 'R', support: 'NONE' },
  },
  {
    key: 'auditLogs',
    area: '감사 로그',
    screens: '감사 로그',
    levels: { super: 'R', lead: 'NONE', support: 'NONE' },
  },
  {
    key: 'aiTraining',
    area: 'AI 학습 데이터',
    screens: 'AI 학습 데이터',
    levels: { super: 'R', lead: 'NONE', support: 'NONE' },
  },
  {
    key: 'helpQuestions',
    area: '도움말 질문 이력',
    screens: '도움말 질문 이력',
    levels: { super: 'R', lead: 'NONE', support: 'NONE' },
  },
  {
    key: 'adminAccounts',
    area: '관리자 계정 관리',
    screens: '직원 계정·권한',
    levels: { super: 'RWD', lead: 'NONE', support: 'NONE' },
  },
];

/** 모르는 값·빈 값은 최저 등급으로 접는다 — 오타가 전권이 되면 안 된다 */
export function normalizeAdminRole(raw: string | null | undefined): AdminRole {
  const v = String(raw ?? '').trim().toLowerCase();
  return (ADMIN_ROLES as string[]).includes(v) ? (v as AdminRole) : 'support';
}

/**
 * 계정 등급 조회. 조회 실패·미등록은 `support`(최저)로 돌려준다.
 * ⚠ 여기서 `super`를 기본값으로 두면 DB 장애가 곧 전권 개방이 된다.
 */
export async function fetchAdminRole(superAdminId: string | null | undefined): Promise<AdminRole> {
  if (!superAdminId) return 'support';
  try {
    const r = await query('SELECT role FROM super_admins WHERE id = $1 AND is_active = true', [superAdminId]);
    if (r.rows.length === 0) return 'support';
    return normalizeAdminRole(r.rows[0].role);
  } catch (err: any) {
    console.log('[admin-role] 등급 조회 실패 — 최저 등급으로 본다:', err?.message);
    return 'support';
  }
}

/** 해당 축에 대한 등급의 권한 수준 */
export function levelFor(role: AdminRole, key: string): AccessLevel {
  const row = PERMISSION_MATRIX.find((r) => r.key === key);
  if (!row) return 'NONE';
  return row.levels[role];
}

/** 조회 이상 가능한가 */
export function canRead(role: AdminRole, key: string): boolean {
  return levelFor(role, key) !== 'NONE';
}

/** 변경 가능한가 */
export function canWrite(role: AdminRole, key: string): boolean {
  const lv = levelFor(role, key);
  return lv === 'RW' || lv === 'RWD';
}

/** 삭제 가능한가 */
export function canDelete(role: AdminRole, key: string): boolean {
  return levelFor(role, key) === 'RWD';
}
