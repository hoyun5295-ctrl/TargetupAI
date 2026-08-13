/**
 * planner-audience.ts — 플래너 발송 대상 단일 문 (★ 2026-08-13 Phase 3)
 *
 * **브리핑에 보여준 수 = 실제로 나가는 수.** 그것을 구조로 보장하려고 이 파일 하나만 대상을 정한다.
 * 세는 곳(결재 서류)·뽑는 곳(당일 staging 적재)이 같은 함수를 부르므로 게이트를 빠뜨릴 자리가 없다.
 *
 * 재사용 (새로 만들지 않는다 — 인계 §3):
 *   게이트 조합 = `resolveOperatorAudienceGates`(피로도·여정 겹침) · 조건 컴파일 = `compileOperatorAudience`
 *   WHERE 조립 = `buildAudienceWhere`(operator-recipients 순수 CT) · 매장 범위 = `resolveOperatorStoreScope`
 *
 * ⛔ **매장 범위는 행사를 만든 계정 권한으로 좁힌다**(읽기는 넓게, 보내기는 좁게 — 0803 5R 교훈).
 *    그래서 결재 서류의 대상 수도 행사별로 낸다. 회사 전체 수를 보여주고 좁게 보내면 그 수는 거짓말이 된다.
 * ⛔ 판정 실패(권한 미지정·조회 오류)는 열어주지 않는다 — blocked로 돌려 실행부가 보류·사유 통지한다.
 */
import { query } from '../config/database';
import { AudienceGates, buildSendableStagingInsertSql } from './operator-recipients';
import {
  compileOperatorAudience,
  countCompiledAudience,
  resolveOperatorAudienceGates,
  resolveOperatorStoreScope,
  CompiledAudience,
} from './operator-audience';
import { buildParticipantPredicate } from './planner-participation';
import { PlannerAudienceMode } from './planner-execution';

export interface PlannerAudienceResolution {
  /** 대상을 정할 수 없다(매장 권한 미지정 등) — 발송하지 않는다. */
  blocked: boolean;
  baseParams: any[];
  storeFilter: string;
  filterWhere: string;
  filterParams: any[];
  gates: AudienceGates;
}

/**
 * 그 터치포인트의 대상 조건 확정. 참여자 축이면 cdp_events를 읽는 **동적 술어**를 얹는다
 * (참여자 명단을 어디에도 굳히지 않는다 — 진실 복사 금지).
 */
export async function resolvePlannerAudience(input: {
  companyId: string;
  /** 행사를 만든 계정 — 매장 범위의 주인. 없으면 보류(blocked). */
  createdBy: string | null;
  mode: PlannerAudienceMode;
  plannerEventId: string;
}): Promise<PlannerAudienceResolution> {
  const scope = await resolveOperatorStoreScope(input.companyId, input.createdBy);
  const gates = await resolveOperatorAudienceGates(input.companyId, null);
  if (scope.blocked) {
    return { blocked: true, baseParams: scope.baseParams, storeFilter: '', filterWhere: '', filterParams: [], gates };
  }
  const compiled: CompiledAudience = await compileOperatorAudience({
    companyId: input.companyId,
    baseParams: scope.baseParams,
  });
  let filterWhere = compiled.filterWhere;
  const filterParams = [...compiled.filterParams];
  if (input.mode === 'participants') {
    // 파라미터 번호는 baseParams + filterParams 다음 자리다 — 게이트 파라미터는 그 뒤에 push되므로
    // 술어를 filterWhere 안에 넣어야 번호가 어긋나지 않는다(buildAudienceWhere 계약).
    const scratch = [...scope.baseParams, ...filterParams];
    filterWhere = `${filterWhere} ${buildParticipantPredicate(scratch, input.plannerEventId)}`;
    filterParams.push(...scratch.slice(scope.baseParams.length + filterParams.length));
  }
  return {
    blocked: false,
    baseParams: scope.baseParams,
    storeFilter: scope.storeFilter,
    filterWhere,
    filterParams,
    gates,
  };
}

/** 대상 수 — 결재 서류(브리핑)와 실행이 같은 이 문으로 센다. 실패는 throw(조용한 0 금지). */
export async function countPlannerAudience(input: {
  companyId: string;
  createdBy: string | null;
  mode: PlannerAudienceMode;
  plannerEventId: string;
}): Promise<{ count: number; blocked: boolean }> {
  const a = await resolvePlannerAudience(input);
  if (a.blocked) return { count: 0, blocked: true };
  const count = await countCompiledAudience({
    compiled: { filterWhere: a.filterWhere, filterParams: a.filterParams, segmentKey: null, basis: 'legacy_filters' },
    gates: a.gates,
    storeFilter: a.storeFilter,
    baseParams: a.baseParams,
  });
  return { count, blocked: false };
}

/**
 * 발송용 staging 적재 — 위 count와 **같은 WHERE·같은 게이트**를 쓴다(상한 없음).
 * 반환 = 실제 적재 건수(= 발송 대상). 0이면 호출부가 발송을 생략하고 통지한다(자동완화 금지).
 */
export async function loadPlannerStaging(input: {
  stagingId: string;
  audience: PlannerAudienceResolution;
}): Promise<number> {
  const { sql, params } = buildSendableStagingInsertSql(
    input.stagingId,
    input.audience.baseParams,
    input.audience.filterWhere,
    input.audience.filterParams,
    input.audience.storeFilter,
    input.audience.gates,
  );
  const res = await query(sql, params);
  return res.rowCount || 0;
}

/** 주인 없는 staging 정리 — 캠페인이 소유권을 갖기 전에 빠져나가면 전화번호가 남는다. */
export async function cleanupPlannerStaging(stagingId: string): Promise<void> {
  if (!stagingId) return;
  await query(`DELETE FROM campaign_send_staging WHERE staging_id = $1`, [stagingId]).catch((e: any) =>
    console.warn('[planner-audience] staging 정리 실패:', e?.message || e),
  );
}
