import type { Request } from 'express';
import { isUuid } from './normalize';

/**
 * 데이터 격리 스코프 — 담당자(company_user)는 본인 생성분(created_by)만, 회사 관리자·슈퍼는 회사 전체.
 *
 * 반환값 = created_by 필터 인자.
 *  - 담당자(company_user): 본인 userId → 목록/조회/수정/삭제가 본인 것만.
 *  - 회사 관리자(company_admin)·슈퍼(super_admin): null → 필터 미적용(회사 전체).
 *
 * 정책(Harold 확정): 모든 기능은 담당자·관리자 동일하게 사용 가능하되, 데이터는 담당자별로 격리한다.
 * 회사 관리자는 회사 전체(하위 담당자 전원 생성분)를 본다.
 */
export function resolveOwnerScope(req: Request): string | null {
  const user = (req as any).user;
  const userType = user?.userType;
  if (userType === 'company_admin' || userType === 'super_admin') return null;
  // 담당자(비관리자) — userId 필수. 누락 시 fail-closed(존재하지 않는 id → 아무것도 못 봄, 무필터로 열리지 않게).
  return user?.userId || '00000000-0000-0000-0000-000000000000';
}

/**
 * ★ 2026-09-27 한줄로 V2 m103(SCOPE) — 한 건을 id로 열 때의 소유 판정(목록 필터와 같은 규칙).
 * 관리자·슈퍼 = 회사 전체(true) · 담당자 = 본인이 만든 행만 · 작성자가 비어 있으면 담당자에게 닫는다(fail-closed).
 * 목록은 created_by로 걸러 두고 id 라우트는 회사 조건만 보던 구멍을 닫는다.
 */
export function canAccessOwnedRow(req: Request, createdBy: string | null | undefined): boolean {
  const ownerId = resolveOwnerScope(req);
  if (ownerId === null) return true;
  return !!createdBy && String(createdBy) === ownerId;
}

/**
 * ★ 2026-09-27 한줄로 V2 R061(SCOPE) — 이름이 사용자마다 따로인 자원(주소록 그룹)을 한 건 열 때의 주인.
 * 담당자 = 늘 본인(요청의 owner는 무시) · 관리자 = 요청의 owner(그 사용자의 것) · 없거나 형식이 틀리면 본인.
 * 'none' = 작성자가 비어 있는 옛 행(관리자만) → null. 호출부는 null을 `user_id IS NULL`로 건다.
 */
export function resolveTargetOwner(req: Request, requested: unknown): string | null {
  const user = (req as any).user;
  const self = String(user?.userId || '00000000-0000-0000-0000-000000000000');
  if (resolveOwnerScope(req) !== null) return self;
  const r = String(requested ?? '').trim();
  if (r === 'none') return null;
  return isUuid(r) ? r : self;
}

/**
 * resolveTargetOwner 결과 → SQL 조건. 값은 params에 넣고 조각을 돌려준다(null = 작성자 없는 옛 행 → IS NULL).
 */
export function ownerClause(ownerId: string | null, params: any[], column = 'user_id'): string {
  if (ownerId === null) return ` AND ${column} IS NULL`;
  params.push(ownerId);
  return ` AND ${column} = $${params.length}`;
}
