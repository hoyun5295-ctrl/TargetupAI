/**
 * planner-dm.ts — 마케팅 플래너 모바일 DM 단계 사전 (★ 2026-09-02 · 접수 cmtibk3d50694jnottwllnrbg)
 *
 * 캘린더(실행 예정·상세)와 결재 브리핑이 **같은 라벨**을 쓴다(두 벌이면 다음에 한쪽만 고쳐진다).
 * 서버 응답 `touchpoint.dm.stage`(planner-production `TouchpointDmInfo`)의 미러 — 서버가 진실이다.
 *
 * 정책(서버 소유 · 여기서는 문구만): 모바일 DM은 AI 초안을 담당자가 완성해 발행한 뒤 **같은 시점 문자 1통에 링크로** 실린다.
 * 발행 전에는 그 시점 문자가 나가지 않는다(fail-closed). 그래서 "마무리 필요"는 담당자가 할 일이 있다는 뜻이다.
 */
export type PlannerDmStage = 'pending' | 'drafted' | 'incomplete' | 'published' | 'stopped';

export interface PlannerDmInfo {
  stage: PlannerDmStage;
  dmId: string | null;
  /** 담당자 편집 화면 경로(1클릭). 초안이 없거나 이미 끝난 접점이면 null. */
  editPath: string | null;
  url: string | null;
  /** 발행됐지만 남은 빈 자리 요약(예: "이미지 2곳 · 직접 작성 문구 1곳"). */
  residue: string | null;
}

export const DM_STAGE_BADGE: Record<PlannerDmStage, { label: string; cls: string }> = {
  pending: { label: 'DM 초안 준비 중', cls: 'bg-white/10 text-white/55 border-white/15' },
  drafted: { label: 'DM 완성 필요', cls: 'bg-amber-500/20 text-amber-100 border-amber-400/40' },
  incomplete: { label: 'DM 빈 자리 남음', cls: 'bg-amber-500/20 text-amber-100 border-amber-400/40' },
  published: { label: 'DM 발행 완료', cls: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/25' },
  stopped: { label: 'DM 발행 중지', cls: 'bg-rose-500/15 text-rose-200 border-rose-400/25' },
};

/** 사전에 없는 단계(배포 스큐)는 배지를 그리지 않는다 — undefined.cls로 화면이 죽지 않게. */
export function dmBadgeOf(stage: string | null | undefined): { label: string; cls: string } | null {
  return stage && (DM_STAGE_BADGE as Record<string, { label: string; cls: string }>)[stage] ? DM_STAGE_BADGE[stage as PlannerDmStage] : null;
}

/** 담당자가 지금 해야 할 일이 있는 단계 — 버튼을 띄운다(완성 필요·빈 자리·발행 중지). */
export const DM_NEEDS_ACTION: ReadonlySet<PlannerDmStage> = new Set<PlannerDmStage>(['drafted', 'incomplete', 'stopped']);

/** 버튼 문안 — 배지·설명과 같은 낱말("완성")을 쓴다. 중지는 재개가 할 일이다. */
export function dmActionLabel(stage: PlannerDmStage): string {
  return stage === 'stopped' ? 'DM 열어 재개하기' : 'DM 완성하기';
}

/** 단계별 한 줄 설명 — 상세·브리핑이 같은 문장을 쓴다. `carrierDone` = 실을 문자가 이미 끝났다. */
export function describeDmStage(info: PlannerDmInfo, carriedBySms: boolean, carrierDone = false): string {
  if (carrierDone && info.stage !== 'published') {
    return '같은 날의 문자가 이미 발송되거나 생략되어 이 DM은 실리지 않습니다. 필요하면 계획을 다시 세워 결재에 올려주세요.';
  }
  switch (info.stage) {
    case 'pending':
      return '승인 뒤 AI가 초안을 만듭니다. 초안이 준비되면 알려드립니다.';
    case 'drafted':
      return carriedBySms
        ? '사진과 문구를 채워 발행하면 같은 시점 문자 1통에 링크로 함께 나갑니다. 발행 전에는 그 문자가 나가지 않습니다.'
        : '사진과 문구를 채워 발행하면 예정일에 링크를 실은 문자가 나갑니다. 발행 전에는 나가지 않습니다.';
    case 'incomplete':
      return `발행됐지만 아직 채워지지 않은 자리가 있습니다${info.residue ? `: ${info.residue}` : ''}. 채운 뒤 다시 발행하면 문자에 실립니다.`;
    case 'published':
      return carriedBySms ? '발행이 확인됐습니다. 같은 시점 문자 1통에 링크로 함께 나갑니다.' : '발행이 확인됐습니다. 예정일에 링크를 실은 문자가 나갑니다.';
    case 'stopped':
      return '발행이 중지돼 있습니다. DM 빌더에서 재개해야 문자에 실립니다.';
    default:
      return '';
  }
}
