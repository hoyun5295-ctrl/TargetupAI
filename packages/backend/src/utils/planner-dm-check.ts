/**
 * planner-dm-check.ts — 문자에 실을 모바일 DM 실물 확인 CT (★ 2026-09-02 · ★ 2026-10-04 옛 제작 파일 planner-production.ts에서 옮김)
 *
 * 발송 당일 실행부가 승인 때 정해진 DM 주소가 **지금도 열리는가**(발행 · 중지 아님 · 빈 자리 0)를 본다.
 * 옛 소재 제작(produceTouchpoint) · 발행 감지(syncDmPublishState) · DM 리마인드는 2026-10-04 보강으로 삭제됐다
 * (완성본은 사람이 [담고 만들기]를 누를 때만 · DM 발행은 행사 승인 때 dm-publish-core가 한다).
 * 주소 규칙 = dm-publish-core `dmShortUrlOf` 하나(승인 각인 주소와 같은 함수 · 두 벌 금지).
 */
import { extractPagesFromDm, getDmDetail } from './dm/dm-builder';
import { renderDmViewerHtml } from './dm/dm-viewer';
import { dmShortUrlOf } from './dm/dm-publish-core';
import {
  DM_RESIDUE_NO_CONTENT,
  DmPlaceholderResidue,
  findDmDataResidue,
  findDmPlaceholderResidue,
  mergeDmResidue,
} from './planner-execution';

export interface DmCarryState {
  /** dm_pages 행이 있는가(없으면 삭제됨). */
  exists: boolean;
  /** 발행됨(status='published' AND short_code). 중지(stopped)는 발행이 아니다 — 뷰어가 열리지 않는다. */
  published: boolean;
  stopped: boolean;
  /** 발행 주소(발행됐을 때만). */
  url: string | null;
  /** 고객 화면에 남은 빈 자리 — 비어 있어야 문자에 실을 수 있다. */
  residue: DmPlaceholderResidue[];
  /** 완성 확인 자체가 실패했다(렌더 예외) — 담당자가 채울 자리가 아니라 시스템 확인 대상. 실을 수 없다(fail-closed). */
  checkError: string | null;
}

/** 실을 수 있는가 — 발행 + 빈 자리 0 + 확인 오류 없음. */
export function isDmCarryable(state: DmCarryState | null | undefined): boolean {
  return !!state && state.published && !state.checkError && state.residue.length === 0;
}

/**
 * DM 1건이 문자에 실릴 수 있는가 — **발행 + 완성(빈 자리 0)** 둘 다여야 한다.
 * 완성 판정 두 축 = ①고객이 보는 뷰어 렌더 결과의 빈 자리 문구 ②섹션 데이터의 빈 이미지 자리(렌더러가 문구를 찍지 않는 자리 — 적대 검토 critical).
 * 섹션이 0개면 빈 페이지다(`DM_RESIDUE_NO_CONTENT`).
 * ⛔ dm_pages는 읽기만 한다(플래너가 DM 원장을 쓰지 않는다). 컬럼 = id·company_id·status·short_code(+뷰어 렌더 입력).
 */
export async function inspectDmForCarry(companyId: string, dmId: string): Promise<DmCarryState> {
  const dm = await getDmDetail(dmId, companyId);
  if (!dm) return { exists: false, published: false, stopped: false, url: null, residue: [], checkError: null };
  const status = String(dm.status || '');
  const shortCode = dm.short_code ? String(dm.short_code) : '';
  const published = status === 'published' && !!shortCode;
  let residue: DmPlaceholderResidue[] = [];
  let checkError: string | null = null;
  if (published) {
    try {
      const sections = extractPagesFromDm(dm).flatMap((p) => (Array.isArray(p.sections) ? p.sections : []));
      if (sections.length === 0) residue = [{ label: DM_RESIDUE_NO_CONTENT, count: 1 }];
      else residue = mergeDmResidue(findDmPlaceholderResidue(renderDmViewerHtml(dm, '/api/dm/v')), findDmDataResidue(sections));
    } catch (e: any) {
      // 렌더가 죽으면 완성을 확인할 수 없다 — 못 확인한 것을 완성으로 두지 않는다(fail-closed). 담당자 몫이 아니라 시스템 확인 대상.
      console.error(`[planner-dm-check] DM 완성 확인 실패 dm=${dmId}:`, e?.message || e);
      checkError = String(e?.message || e).slice(0, 200);
    }
  }
  return {
    exists: true,
    published,
    stopped: status === 'stopped',
    url: published ? dmShortUrlOf(shortCode) : null,
    residue,
    checkError,
  };
}
