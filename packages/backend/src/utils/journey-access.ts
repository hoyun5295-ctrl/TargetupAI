/**
 * journey-access.ts — 여정 주인 판정 한 곳 (★ 2026-10-23 여정 결함 0 · 무거운 의존 0 · builder · lifecycle-map · route 가 같이 쓴다)
 *   관리자(슈퍼관리자 포함) = 회사 전체 · 담당자(company_user) = 자기가 만든 여정만(캠페인 · 자동발송과 같다).
 */
import type { Request } from 'express';
import { query } from '../config/database';
import { isUuid } from './normalize';
import { resolveOwnerScope } from './owner-scope';

export interface JourneyViewer {
  companyId: string;
  userId: string | null;
  /** 담당자면 자기가 만든 여정만 · 관리자(슈퍼관리자 포함)면 회사 전체. */
  ownOnly: boolean;
}

export function journeyViewerOf(req: Request): JourneyViewer | null {
  const companyId = req.user?.companyId;
  if (!companyId) return null;
  // ★ 2026-10-24 주인 판정 = owner-scope 한 함수(자동 마케팅 문 operator-route 도 이 함수 · 관리자 · 슈퍼관리자 = 회사 전체 · 그 밖 = 자기 것만)
  return { companyId, userId: req.user?.userId || null, ownOnly: resolveOwnerScope(req) !== null };
}

/** 목록 · 집계 SQL 조각 — 담당자는 자기가 만든 여정만(관리자 = 빈 조각). params 에 값을 붙이고 조각을 돌려준다. */
export function journeyOwnerSql(viewer: JourneyViewer, params: any[], alias = 'j'): string {
  if (!viewer.ownOnly) return '';
  params.push(viewer.userId);
  return ` AND ${alias}.created_by::text = $${params.length}::text`;   // 칸 타입과 상관없이(uuid · 문자) 같은 비교
}

/** 이 사람이 이 여정을 볼 · 고칠 수 있는가(회사 · 주인). */
export async function canAccessJourney(viewer: JourneyViewer, journeyId: string): Promise<boolean> {
  if (!isUuid(journeyId)) return false;
  const params: any[] = [journeyId, viewer.companyId];
  const r = await query(`SELECT 1 FROM journeys j WHERE j.id = $1::uuid AND j.company_id = $2::uuid${journeyOwnerSql(viewer, params)}`, params);
  return r.rows.length > 0;
}

/** 이 사용자가 담당자(users.user_type 'user')인가 — 토큰 없이 사용자 id 만 있는 자리(지도 · 집계)의 같은 판정. */
export async function ownsOnlyOwnJourneys(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const u = await query('SELECT user_type FROM users WHERE id = $1', [userId]);
  return u.rows[0]?.user_type === 'user';
}

/** 이 사람이 볼 수 있는 여정 id 집합(목록 거르기 · 여러 여정 주소용). 관리자 = null(거르지 않음). */
export async function accessibleJourneyIds(viewer: JourneyViewer): Promise<Set<string> | null> {
  if (!viewer.ownOnly) return null;
  const params: any[] = [viewer.companyId];
  const r = await query(`SELECT j.id FROM journeys j WHERE j.company_id = $1::uuid${journeyOwnerSql(viewer, params)}`, params);
  return new Set(r.rows.map((x: any) => String(x.id)));
}
