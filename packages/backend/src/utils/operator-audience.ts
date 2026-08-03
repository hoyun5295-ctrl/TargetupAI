/**
 * operator-audience.ts — 자동마케팅 대상 판정 단일 문 (2026-08-03 타겟팅 재설계 A-1)
 *
 * 왜 있나 (0803 전수점검 실측):
 *   같은 제안의 대상을 세거나 뽑는 곳이 넷이었고 게이트 조합이 서로 달랐다.
 *   제안 수·화면 수·사전 통지 수는 피로도·미클릭을 안 보고, 실발송 추출만 봤다.
 *   그래서 "보여준 수 ≠ 나가는 수"였고, 담당자가 정지 여부를 판단하는 통지 문자에 실제보다 큰 수가 갔다.
 *   게이트를 빠뜨릴 수 있는 자리가 넷이면 언젠가 빠진다 — 조합을 이 파일 하나가 소유해서 그 자리를 없앤다.
 *
 * 계약:
 *   1. 게이트 조합은 resolveOperatorAudienceGates 하나가 정한다. 호출부가 직접 조립하지 않는다.
 *   2. WHERE 조립은 operator-recipients.buildAudienceWhere 하나뿐(순수 CT — DB import 0 유지).
 *   3. 자동마케팅의 count·명단·staging 적재는 언제 세든 같은 게이트를 쓴다. 다른 것은 "언제 셌나"뿐이다.
 *   4. 이 문은 자동마케팅 전용이다. 캠페인 미리보기·대행 제안서는 발송 게이트가 다른 경로라 여기 묶지 않는다.
 */
import { query } from '../config/database';
import { getFatigueCap } from './fatigue-guard';
import { getStoreScope } from './store-scope';
import { buildFilterWhereClauseCompat } from './customer-filter';
import { buildAudienceCountSql, AudienceGates } from './operator-recipients';
import { hasUsableGradeOrder } from './customer-grade-rank';
import {
  CompanySegmentFacts, SegmentAvailability, SegmentKey,
  buildSegmentPredicate, normalizeSegmentKey, resolveSegmentAvailability, getSegmentContract,
} from './automarketing-segment';

/**
 * 자동마케팅 발송 게이트 조합 확정.
 *  - 피로도: 회사 opt-in 설정(getFatigueCap). 미설정 회사는 null = 게이트 없음.
 *  - 미클릭: 다단계 시퀀스 리마인드 제안만 meta.excludeClickedSince를 갖는다(1차 제안은 null).
 * proposalJson 미전달(등록 시점·1차 제안 생성 시점) = 미클릭 게이트 없음.
 */
export async function resolveOperatorAudienceGates(
  companyId: string,
  proposalJson?: { meta?: { excludeClickedSince?: string | null } | null } | null,
): Promise<AudienceGates> {
  const parse = (v: unknown): Date | null => {
    if (typeof v !== 'string' || !v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return {
    excludeClickedSince: parse(proposalJson?.meta?.excludeClickedSince),
    fatigueCap: await getFatigueCap(companyId),
  };
}

/**
 * 자동마케팅 대상 수 — 명단·발송 추출과 같은 WHERE, 같은 게이트.
 *
 * ⛔ 2026-08-03 1R 정정: filters를 직접 받는 문을 없앴다. 그 문이 열려 있으니 리마인드가 계약을 무시하고
 *   빈 filters로 세어 전체 고객 수를 통지했다(계약 제안은 filters가 비어 있다). 조건은 반드시
 *   compileOperatorAudience를 거친 결과로만 받는다 — 우회할 자리가 있으면 언젠가 우회한다.
 *  에러는 삼키지 않고 전파한다(조용한 0은 0건 게이트를 오작동시켜 제안을 통째로 없앤다).
 */
export async function countCompiledAudience(input: {
  compiled: CompiledAudience;
  gates: AudienceGates;
  storeFilter?: string;
  baseParams: any[];    // [companyId, ...storeScope] — compileOperatorAudience에 넘긴 것과 같아야 한다
}): Promise<number> {
  const { sql, params } = buildAudienceCountSql(
    input.compiled.filterWhere,
    input.compiled.filterParams,
    input.baseParams,
    input.storeFilter || '',
    input.gates,
  );
  const res = await query(sql, params);
  return Number(res.rows[0]?.count) || 0;
}

// ════════════════════════════════════════════════════════════════════
// 세그먼트 계약 — 근거 판정(facts) · 컴파일 (2026-08-03 A-6·A-7)
// ════════════════════════════════════════════════════════════════════

/**
 * 이 회사가 실제로 준 것. 판정은 여기서 실측하고, 가능/불가 결정은 순수 모듈이 한다.
 * ⛔ 조회 실패를 false로 뭉개지 않는다 — 전파해서 화면이 "판정 못 함"을 알게 한다(잠긴 축을 열지 않는 방향).
 */
export async function loadCompanySegmentFacts(companyId: string): Promise<CompanySegmentFacts> {
  const [fill, gradeOrder] = await Promise.all([
    query(
      `SELECT
         COUNT(*) FILTER (WHERE recent_purchase_date IS NOT NULL)::int AS recent_purchase,
         COUNT(*) FILTER (WHERE birth_date IS NOT NULL)::int           AS birthday,
         COUNT(*) FILTER (WHERE COALESCE(grade, '') <> '')::int        AS grade_values
       FROM customers WHERE company_id = $1::uuid AND is_active = true`,
      [companyId],
    ),
    hasUsableGradeOrder(companyId),
  ]);
  const r = fill.rows[0] || {};
  return {
    hasRecentPurchaseDate: Number(r.recent_purchase) > 0,
    hasBirthday: Number(r.birthday) > 0,
    hasGradeValues: Number(r.grade_values) > 0,
    hasGradeOrder: !!gradeOrder,
  };
}

/**
 * ⛔ 2026-08-03 5R 정정 — 매장 제한 사용자의 발송 범위.
 *   미리보기·명단은 getStoreScope를 적용했는데 제안 수와 실발송은 회사 전체를 봤다. 화면엔 A매장 1명이 뜨고
 *   실제로는 A+B 2명에게 나가 2건이 차감되는 구조였다(매장 미할당 사용자는 0명을 보고 회사 전체 발송).
 *   보여준 명단 = 나가는 명단을 지키려면 세는 곳·뽑는 곳·보내는 곳이 같은 범위를 써야 한다.
 *   범위는 오퍼레이터를 만든 계정의 현재 권한으로 해석한다 — 권한이 바뀌면 발송 범위도 따라간다.
 */
/**
 * 회사 전체 범위를 가질 수 있는 역할 — 관리자 계열만. 그 외(일반 사용자·미지 값)는 제한 사용자로 본다.
 *
 * ⛔ 6R 정정 — **DB 표기와 토큰 표기가 다르다.** 실측(2026-08-03): `users.user_type` = admin 126 / user 101 / system 75.
 *   `company_user`·`company_admin`은 JWT 변환값이라 DB에는 없다. 토큰 어휘로 판정하면 제한 사용자(`user`)가
 *   조건을 빠져나가 회사 전체 범위로 승격된다 — 화면은 자기 매장만 보여주는데 실발송은 전사로 나간다.
 *   그래서 양쪽 어휘를 모두 받고, 모르는 값은 승격하지 않는다(승격 오판 = 비인가 발송, 제한 오판 = 보류에 그침).
 */
function isFullScopeRole(raw: unknown): boolean {
  const t = String(raw || '').trim().toLowerCase();
  return t === 'admin' || t === 'company_admin' || t === 'super_admin' || t === 'system';
}

export async function resolveOperatorStoreScope(
  companyId: string,
  createdBy: string | null | undefined,
): Promise<{ storeFilter: string; baseParams: any[]; blocked: boolean }> {
  const full = { storeFilter: '', baseParams: [companyId] as any[], blocked: false };
  const blocked = { storeFilter: '', baseParams: [companyId] as any[], blocked: true };

  // ⛔ 6R 정정: 소유자가 없거나 사라졌으면 전체로 넓히지 않는다. 종전엔 사용자를 지우면 그 사람이 만든
  //   자동마케팅의 발송 범위가 오히려 회사 전체로 커졌다(스키마가 삭제 시 created_by를 NULL로 만든다).
  if (!createdBy) return blocked;
  // ⛔ 7R·8R 정정: 로그인과 같은 자격을 요구한다 — routes/auth.ts는 is_active AND status='active'를 본다.
  //   is_active만 보면 해지된 회사가 통과한다: 회사 해지는 routes/admin.ts가 그 회사 전 사용자를
  //   status='dormant'로 바꾸고 is_active는 그대로 두기 때문이다(해지 전 예약분이 그대로 나가 차감까지 됐다).
  const u = await query(
    `SELECT user_type FROM users
      WHERE id = $1::uuid AND company_id = $2::uuid AND is_active = true AND status = 'active'`,
    [createdBy, companyId],
  );
  if (u.rows.length === 0) return blocked;              // 삭제·비활성·타사 계정
  if (isFullScopeRole(u.rows[0].user_type)) return full;

  const scope = await getStoreScope(companyId, createdBy);
  if (scope.type === 'blocked') return blocked;
  if (scope.type === 'filtered') {
    return {
      storeFilter: ' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))',
      baseParams: [companyId, scope.storeCodes],
      blocked: false,
    };
  }
  // ⛔ 6R 정정: getStoreScope는 배정 코드가 하나도 매칭되지 않으면 no_filter로 폴백한다(D136 유령 배정 방어 —
  //   조회 화면이 빈 목록이 되는 것을 막는 판단이다). 발송은 판단이 달라야 한다. 매장 체계가 있는 회사에서
  //   배정이 안 맞으면 전체로 넓히는 대신 보류한다 — 읽기는 넓게, 보내기는 좁게.
  const hasStores = await query(
    `SELECT EXISTS(SELECT 1 FROM customer_stores WHERE company_id = $1::uuid LIMIT 1) AS e`,
    [companyId],
  );
  if (hasStores.rows[0]?.e === true) return blocked;
  return full;   // 매장 체계 자체가 없는 회사 = 나눌 범위가 없다
}

/** 화면·등록 검증이 보는 축 목록(가능 여부 + 사유 + 파라미터 정의). */
export async function listSegmentAvailability(companyId: string): Promise<SegmentAvailability[]> {
  return resolveSegmentAvailability(await loadCompanySegmentFacts(companyId));
}

/**
 * 상위 등급 값 — 회사가 정한 서열 중 **지금 고객에게 실제로 있는** 등급만 놓고 가장 위 급을 고른다.
 * 사라진 등급의 옛 서열행이 상위로 잡히면 그 축은 영영 0건이 된다(등급 상승 여정과 같은 판정 축).
 * 테이블 미생성(42P01) = 빈 배열 → vip 축은 잠긴 채로 둔다.
 */
async function resolveTopGradeValues(companyId: string): Promise<string[]> {
  try {
    const r = await query(
      `SELECT r.grade_value, r.rank_order
         FROM customer_grade_ranks r
         JOIN (SELECT DISTINCT grade FROM customers
                WHERE company_id = $1::uuid AND is_active = true AND COALESCE(grade, '') <> '') g
           ON g.grade = r.grade_value
        WHERE r.company_id = $1::uuid AND r.rank_order IS NOT NULL
        ORDER BY r.rank_order DESC`,
      [companyId],
    );
    if (r.rows.length === 0) return [];
    const top = Number(r.rows[0].rank_order);
    return r.rows.filter((x: any) => Number(x.rank_order) === top).map((x: any) => String(x.grade_value));
  } catch (e: any) {
    if (e?.code === '42P01') return [];   // 마이그레이션 전
    throw e;
  }
}

/** 대상 조건이 어디서 왔는지 — 화면·로그가 이 값으로 "계약인지 옛 방식인지"를 구분한다. */
export type AudienceBasis = 'segment' | 'legacy_filters';

export interface CompiledAudience {
  filterWhere: string;
  filterParams: any[];
  segmentKey: SegmentKey | null;
  basis: AudienceBasis;
}

/**
 * 대상 조건 컴파일 — 결정성의 실체(A-7).
 *
 *  - `segmentKey`가 있으면 계약이 SQL을 만든다. 회차마다 AI가 다시 해석하지 않는다.
 *    잠긴 축은 컴파일하지 않고 사유와 함께 throw — 조용히 0건을 내면 담당자가 이유를 모른다.
 *  - `segmentKey`가 없으면 저장된 filters를 종전대로 컴파일한다(옛 오퍼레이터는 옛 방식 그대로 — 마이그레이션 없음).
 *  - 계약과 filters를 섞지 않는다. 섞는 순간 "무엇이 조건인가"가 다시 두 곳이 된다.
 */
export async function compileOperatorAudience(input: {
  companyId: string;
  segmentKey?: string | null;
  segmentParams?: unknown;
  legacyFilters?: Record<string, any> | null;
  baseParams?: any[];    // [companyId, ...storeScope] — 미전달 시 [companyId]
  now?: Date;
}): Promise<CompiledAudience> {
  const baseParams = input.baseParams && input.baseParams.length > 0 ? input.baseParams : [input.companyId];
  const raw = typeof input.segmentKey === 'string' ? input.segmentKey.trim() : '';
  const key = normalizeSegmentKey(raw || null);

  // ⛔ 2026-08-03 1R 정정 (fail-closed): "계약 없음"과 "알 수 없는 계약"을 같은 값으로 뭉개면 안 된다.
  //   종전엔 미등록 키가 조용히 legacy로 강등됐고, 그때 filters가 비어 있으면 WHERE가 통째로 비어
  //   전체 고객이 열렸다. 값이 있는데 우리가 모르는 축이면 멈춘다 — 버전 스큐·손상된 제안이 여기서 걸린다.
  if (raw && !key) {
    throw new Error(`알 수 없는 발송 대상 축이라 대상을 만들 수 없습니다: ${raw.slice(0, 40)}`);
  }

  if (!key) {
    const compiled = buildFilterWhereClauseCompat(input.legacyFilters || {}, baseParams.length + 1);
    return { filterWhere: compiled.sql, filterParams: compiled.params, segmentKey: null, basis: 'legacy_filters' };
  }

  const facts = await loadCompanySegmentFacts(input.companyId);
  const availability = resolveSegmentAvailability(facts).find((a) => a.key === key);
  if (!availability || !availability.available) {
    throw new Error(availability?.reason || '이 발송 대상 축을 지금은 쓸 수 없습니다.');
  }

  const scratch = [...baseParams];
  const filterWhere = buildSegmentPredicate(key, input.segmentParams, scratch, {
    now: input.now || new Date(),
    topGradeValues: key === 'vip' ? await resolveTopGradeValues(input.companyId) : undefined,
  });
  return {
    filterWhere,
    filterParams: scratch.slice(baseParams.length),
    segmentKey: key,
    basis: 'segment',
  };
}

/**
 * 자동마케팅 대상 수 — 조건 컴파일부터 게이트까지 한 번에. 제안 생성·리마인드가 이 문 하나만 쓴다.
 *  ⛔ 2026-08-03 1R 정정: 리마인드가 이 문을 안 쓰고 filters를 직접 넘겨 계약을 무시했다(VIP 20명을 전체 10,000명으로
 *    세어 저장·통지·예산 가드까지 오염). 조건이 무엇이든 컴파일 → 같은 게이트로 count 한 경로만 남긴다.
 */
export async function countOperatorAudienceFor(input: {
  companyId: string;
  segmentKey?: string | null;
  segmentParams?: unknown;
  legacyFilters?: Record<string, any> | null;
  /** 리마인드 등 게이트가 다른 회차 — 미전달 시 이 회사 기본 게이트(피로도만). */
  gates?: AudienceGates;
  storeFilter?: string;
  baseParams?: any[];
  /** 계약 축 컴파일 결과를 호출부가 다시 쓸 때(발송 추출 등) 받아 간다. */
}): Promise<{ count: number; compiled: CompiledAudience; gates: AudienceGates; label: string }> {
  const baseParams = input.baseParams && input.baseParams.length > 0 ? input.baseParams : [input.companyId];
  const compiled = await compileOperatorAudience({
    companyId: input.companyId,
    segmentKey: input.segmentKey ?? null,
    segmentParams: input.segmentParams,
    legacyFilters: input.legacyFilters ?? null,
    baseParams,
  });
  const gates = input.gates ?? (await resolveOperatorAudienceGates(input.companyId, null));
  const count = await countCompiledAudience({ compiled, gates, storeFilter: input.storeFilter, baseParams });
  return {
    count,
    compiled,
    // ⛔ 4R 정정: 성과 추정도 이 수와 같은 최종 WHERE를 써야 한다 — 게이트를 함께 돌려준다.
    gates,
    label: compiled.segmentKey ? (getSegmentContract(compiled.segmentKey)?.label || '') : '',
  };
}
