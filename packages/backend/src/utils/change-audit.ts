/**
 * change-audit.ts — 2.1 · 4.2 변경 이력 감사 기록 (★2026-10-21 전송자격인증 현장 실사 준비 S1)
 *
 * 왜 있나
 *   발신번호 · 배정 · 계정 · 수신거부 · 주소록의 등록 · 변경 · 삭제가 표만 바꾸고 감사 기록을 남기지 않았다
 *   (10-21 모의 실사 = 결함 D-03 · D-24). 인증 기준 2.1 은 「등록 · 변경 · 삭제 이력」을, 4.2 는 개인정보 삭제 이력을 요구한다.
 *
 * 규칙
 *   - 기록은 감사 기록 CT `recordAuditLog` 로만 쓴다(실패해도 본 동작에 영향 없음 · 예외를 삼킨다).
 *   - 함수마다 기록 종류를 글자 그대로 적는다 — 라벨 계약 테스트(`__tests__/audit-action-labels.test.ts`)가
 *     소스에서 종류를 뽑아 화면 라벨 CT(`frontend/src/constants/audit-action-labels.ts`) 등재를 강제한다.
 *   - 수신거부 번호는 저장할 때 가린다(`maskPhone`) · 발신번호(사업자 번호)는 그대로 둔다.
 *   - `target_id` 는 uuid 칸이라 uuid 가 아닌 대상(주소록 그룹 이름 등)은 상세에만 적는다.
 */
import { recordAuditLog } from './audit-log';
import { maskPhone } from './mfa';

/** 이 변경이 들어온 길 — 화면에서 「누가 어디서」를 가른다 */
export type ChangeVia = 'admin' | 'company' | 'registration' | 'sync';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: any): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v : null);

interface Base {
  actorUserId?: string | null;
  req?: any;
}

interface CallbackBase extends Base {
  companyId: string | null;
  callbackId: string | null;
  phone: string | null;
  via: ChangeVia;
}

export function recordCallbackNumberCreated(p: CallbackBase & { label?: string | null; isDefault?: boolean; registrationId?: string | null }): Promise<void> {
  return recordAuditLog({
    actorUserId: p.actorUserId, action: 'callback_number_created', targetType: 'callback_number', targetId: asUuid(p.callbackId),
    details: { companyId: p.companyId, phone: p.phone, label: p.label ?? null, isDefault: !!p.isDefault, via: p.via, registrationId: p.registrationId ?? undefined },
    req: p.req,
  });
}

export function recordCallbackNumberUpdated(p: CallbackBase & { before: Record<string, any>; after: Record<string, any> }): Promise<void> {
  return recordAuditLog({
    actorUserId: p.actorUserId, action: 'callback_number_updated', targetType: 'callback_number', targetId: asUuid(p.callbackId),
    details: { companyId: p.companyId, phone: p.phone, via: p.via, before: p.before, after: p.after },
    req: p.req,
  });
}

export function recordCallbackNumberDefaultChanged(p: CallbackBase): Promise<void> {
  return recordAuditLog({
    actorUserId: p.actorUserId, action: 'callback_number_default_changed', targetType: 'callback_number', targetId: asUuid(p.callbackId),
    details: { companyId: p.companyId, phone: p.phone, via: p.via },
    req: p.req,
  });
}

export function recordCallbackNumberDeleted(p: CallbackBase): Promise<void> {
  return recordAuditLog({
    actorUserId: p.actorUserId, action: 'callback_number_deleted', targetType: 'callback_number', targetId: asUuid(p.callbackId),
    details: { companyId: p.companyId, phone: p.phone, via: p.via },
    req: p.req,
  });
}

/** 배정 변경 — 범위(전체 · 지정) · 배정 교체 · 배정 해제 */
export function recordCallbackAssignmentChanged(p: CallbackBase & {
  kind: 'scope' | 'replace' | 'unassign';
  before?: any;
  after?: any;
  userIds?: string[];
  removedUserId?: string | null;
}): Promise<void> {
  return recordAuditLog({
    actorUserId: p.actorUserId, action: 'callback_assignment_changed', targetType: 'callback_number', targetId: asUuid(p.callbackId),
    details: {
      companyId: p.companyId, phone: p.phone, via: p.via, kind: p.kind,
      before: p.before ?? undefined, after: p.after ?? undefined,
      userIds: p.userIds ?? undefined, removedUserId: p.removedUserId ?? undefined,
    },
    req: p.req,
  });
}

export function recordUserAccountDeleted(p: Base & { userId: string; loginId: string | null; companyId: string | null; via: ChangeVia }): Promise<void> {
  return recordAuditLog({
    actorUserId: p.actorUserId, action: 'user_account_deleted', targetType: 'user', targetId: asUuid(p.userId),
    details: { loginId: p.loginId, companyId: p.companyId, via: p.via },
    req: p.req,
  });
}

/** 수신거부 삭제 — 지운 건수가 0이면 남기지 않는다(동기화 정리처럼 자주 도는 경로의 소음 방지) */
export async function recordUnsubscribeDeleted(p: Base & {
  companyId: string | null;
  userId?: string | null;
  count: number;
  phones?: string[];
  via: ChangeVia;
}): Promise<void> {
  if (!(p.count > 0)) return;
  await recordAuditLog({
    actorUserId: p.actorUserId, action: 'unsubscribe_deleted', targetType: 'unsubscribe', targetId: asUuid(p.userId ?? null),
    details: {
      companyId: p.companyId, userId: p.userId ?? null, count: p.count, via: p.via,
      phonesMasked: (p.phones || []).slice(0, 5).map((ph) => maskPhone(ph)),
    },
    req: p.req,
  });
}

/** 주소록 그룹 삭제 — 그룹 = (주인, 이름) · ownerUserId null = 작성자 없는 옛 그룹 */
export function recordAddressBookDeleted(p: Base & { companyId: string | null; ownerUserId: string | null; groupName: string; count: number }): Promise<void> {
  return recordAuditLog({
    actorUserId: p.actorUserId, action: 'address_book_deleted', targetType: 'address_book', targetId: null,
    details: { companyId: p.companyId, ownerUserId: p.ownerUserId, groupName: String(p.groupName).slice(0, 100), count: p.count },
    req: p.req,
  });
}
