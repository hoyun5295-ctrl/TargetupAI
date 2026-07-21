import type { Request } from 'express';

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
