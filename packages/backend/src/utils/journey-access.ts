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

/**
 * ★ 2026-10-25 여정 구조체크 2차 #9(결정 D1 = A) — 추천 판정(AI 진단 · 여정 기회 · 한 줄 묻기)이 「이 구간을 맡은 여정」으로 세는 여정.
 *   관리자 · 사용자 id 없음 = 회사 전체(빈 조각) · 담당자 = 자기가 만든 여정 + 담당자가 아닌 사람(관리자 · 시스템)이 켠 여정
 *   (그 여정은 회사 전체 고객에게 나가 겹치면 같은 고객이 두 통 받는다 · 관리자 초안 · 멈춤은 나가지 않아 세지 않는다).
 *   옛: 회사 전체로 세어 담당자 B 가 A 의 초안 때문에 그 구간 추천을 못 받았다(B 화면엔 없는 초안).
 *   mine = 「자기가 만든 여정인가」 SQL 식(관리자 = TRUE) · 남이 켠 여정이 막을 때 이유 문장을 가른다.
 */
export async function journeyCoverSql(userId: string | null | undefined, params: any[], alias = 'j'): Promise<{ where: string; mine: string }> {
  if (!(await ownsOnlyOwnJourneys(userId))) return { where: '', mine: 'TRUE' };
  params.push(userId);
  const mine = `(${alias}.created_by::text = $${params.length}::text)`;
  return {
    where: ` AND (${mine} OR (${alias}.status = 'active' AND NOT EXISTS (SELECT 1 FROM users cu WHERE cu.id::text = ${alias}.created_by::text AND cu.user_type = 'user')))`,
    mine,
  };
}

/** 이 사람이 볼 수 있는 여정 id 집합(목록 거르기 · 여러 여정 주소용). 관리자 = null(거르지 않음). */
export async function accessibleJourneyIds(viewer: JourneyViewer): Promise<Set<string> | null> {
  if (!viewer.ownOnly) return null;
  const params: any[] = [viewer.companyId];
  const r = await query(`SELECT j.id FROM journeys j WHERE j.company_id = $1::uuid${journeyOwnerSql(viewer, params)}`, params);
  return new Set(r.rows.map((x: any) => String(x.id)));
}
