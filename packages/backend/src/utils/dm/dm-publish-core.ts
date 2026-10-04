/**
 * dm-publish-core.ts — DM 발행 코어 CT (★ 2026-10-04 플래너 보강 B4 · 설계서 §3-9 · §6-5 7 · 회의론자 C3)
 *
 * `POST /api/dm/:id/publish` 라우트 본문을 **그대로** 옮겼다. 발행의 문이 둘이 됐기 때문이다:
 *   ① 편집기 발행 · 목록 [발행 주소 복사](라우트)  ② 마케팅 플래너 행사 승인(planner-approve)
 * 두 문이 각자 판정을 쓰면 한쪽만 고쳐진다 — 차단 판정(중지 · 첫 발행 잠금 · 링크 결함) · 단가 분기(참여형 120 · 일반 100) ·
 * 경품 동기화 · 차감(멱등키 `dm-publish:{id}`)을 이 함수 하나가 소유한다(동작 무변경 · 계약 = dm-publish-core 테스트).
 *
 * 반환 = 성공(주소·청구 여부) 또는 거절(라우트가 그대로 HTTP로 옮길 status·code·문구). 잔액 부족(checkCredit)은 던진다(호출부 402).
 */
import { query } from '../../config/database';
import { checkCredit, deductCreditSafe, isCreditEnabledStrict } from '../ai-credit';
import { findLinkDefectDeep } from '../normalize';
import { dmPublishBlocker, dmPublishFeeSourceOf, isDmPublishFeeCharged } from './dm-publish-gate';
import { getDmDetail, isDmStopped, publishDm } from './dm-builder';
import { syncPrizesFromSections } from './dm-interaction';

export type DmPublishCoreResult =
  | { ok: true; shortCode: string; shortUrl: string; charged: boolean; cost: number; source: string }
  | { ok: false; status: number; code: string | null; error: string; items?: unknown[]; extra?: Record<string, unknown> };

/** 발행 주소 — 단축 도메인(설정 시) 또는 긴 뷰어 주소(옛 라우트와 같은 규칙). */
export function dmShortUrlOf(shortCode: string): string {
  const pubShortBase = String(process.env.DM_SHORT_LINK_BASE || '').trim().replace(/\/+$/, '');
  return pubShortBase
    ? `${pubShortBase}/${shortCode}`
    : `${process.env.HANJUL_BASE_URL || 'https://hanjul.ai'}/api/dm/v/dm-${shortCode}`;
}

export type DmPublishBlock = { status: number; code: string | null; error: string; items?: unknown[] };

/**
 * 발행 차단 판정(★ 2026-10-04 Codex 1R) — 중지 · 첫 발행 잠금 · 재발행 링크 결함. 돈이 움직이기 **전에** 같은 판정으로 멈추려고
 * 함수로 뺐다(플래너 승인이 메일 완성 · 대행료보다 먼저 부른다). 코어는 이 함수를 그대로 부른다(판정 한 벌).
 */
export async function dmPublishBlockOf(companyId: string, dmId: string): Promise<DmPublishBlock | null> {
  // ★ 2026-08-06 중지된 DM은 이 경로로 되살아나지 않는다(서수란 접수).
  //   화면의 [발행 주소 복사]가 이 엔드포인트를 부르므로, 막지 않으면 **주소를 복사하는 순간 중지가 풀린다.**
  //   되살리는 문은 [재개] 하나여야 한다 — 그래야 "왜 다시 열렸는지"가 기록으로 남는다.
  if (await isDmStopped(dmId, companyId)) {
    return { status: 409, code: 'DM_STOPPED', error: '중지된 DM입니다. 다시 열려면 [재개]를 눌러주세요.' };
  }
  // ★2026-09-22 링크 결함(실존하지 않는 도메인) = 발행 차단. **차감 앞이다** — 뒤에서 막으면 크레딧만
  //   나가고 발행은 안 된다. DM은 발행 자체는 되고 **보는 사람이 눌렀을 때** 안 열려 더 늦게 드러난다.
  // ★ 2026-09-27 만들기 개편 S7 — **첫 발행**(short_code 없음)은 CT 잠금 전체(링크 결함 · 채울 자리 · 무시 불가 검수 치명).
  //   재발행(목록 [발행 주소 복사])은 옛 링크 검사만 그대로 — 발행 뒤 사정(지난 카운트다운 등)으로 주소 복사가 막히지 않게.
  const dmBodyRow = await getDmDetail(dmId, companyId);
  if (dmBodyRow) {
    if (!dmBodyRow.short_code) {
      const block = await dmPublishBlocker(dmBodyRow);
      if (block) return { status: block.status, code: block.code, error: block.error, items: block.items || [] };
    } else {
      const dmLinkDefect = findLinkDefectDeep(
        { sections: dmBodyRow.sections, pages: dmBodyRow.pages, header_data: dmBodyRow.header_data, footer_data: dmBodyRow.footer_data },
        '링크는',
      );
      if (dmLinkDefect) return { status: 400, code: 'LINK_DEFECT', error: dmLinkDefect };
    }
  }
  return null;
}

export async function publishDmCore(input: {
  companyId: string;
  dmId: string;
  userId: string | null;
  /** 화면이 확인한 발행비(있으면 지금 발행비가 더 클 때 402 · 청구 여부를 여기서 한 번 정한다) */
  expectedFee?: number;
  /** 무시 가능한 치명을 넘긴 기록(편집기) */
  validationOverride?: { items?: Array<{ area?: unknown; message?: unknown }> } | null;
}): Promise<DmPublishCoreResult> {
  const { companyId, dmId } = input;
  const block = await dmPublishBlockOf(companyId, dmId);
  if (block) return { ok: false, ...block };

  // ★ 종량제: 발행(단축URL 확정) 최초 1회만(멱등키 dm-publish:dmId). 인터랙션 캠페인 · 일반 DM 단가 = 단가표. 재발행은 멱등 0.
  const { source: costSource, cost: pubCost } = await dmPublishFeeSourceOf(companyId, dmId);
  const firstPublish = !(await isDmPublishFeeCharged(companyId, dmId));
  // ★ 2026-09-27 Codex 3R·4R — 화면이 확인한 발행비(expected_fee)가 오면 **청구 여부를 여기서 한 번 정하고** 차감까지 그대로 쓴다.
  //   지금 발행비가 더 크면 차감 전에 402 · 크레딧제 미적용으로 통과한 요청은 뒤에 켜져도 걷지 않는다.
  //   값을 싣지 않는 옛 호출부(편집기 발행 · 목록 주소 복사)는 동작 그대로(chargeNow = firstPublish).
  const expectedFee = input.expectedFee;
  let chargeNow = firstPublish;
  if (typeof expectedFee === 'number' && firstPublish) {
    const creditOn = await isCreditEnabledStrict(companyId);
    if (creditOn && pubCost > expectedFee) {
      return { ok: false, status: 402, code: 'PUBLISH_FEE_REQUIRED', error: '발행 비용을 다시 확인해 주세요.', extra: { costSource, cost: pubCost } };
    }
    chargeNow = creditOn;
  }
  if (chargeNow) await checkCredit(companyId, pubCost);
  const result = await publishDm(dmId, companyId);
  if (!result) return { ok: false, status: 404, code: null, error: 'DM을 찾을 수 없습니다.' };

  // ★ 2026-07-28 검수 치명 무시 발행 기록 — 무시 가능한 치명(required_info)만 프론트가 넘길 수 있고 "누가 언제 무엇을 넘겼는지"를 남긴다.
  //   실패해도 발행은 유지한다(경품 동기화와 같은 원칙).
  const overrideReq = input.validationOverride;
  if (overrideReq && Array.isArray(overrideReq.items) && overrideReq.items.length > 0) {
    try {
      await query(
        // dm_pages.validation_result = jsonb (2026-07-28 information_schema 실측 확정).
        `UPDATE dm_pages
            SET validation_result = (COALESCE(validation_result::jsonb, '{}'::jsonb) || $1::jsonb),
                updated_at = NOW()
          WHERE id = $2 AND company_id = $3`,
        [
          JSON.stringify({
            overridden_at: new Date().toISOString(),
            overridden_by: input.userId || null,
            overridden_items: overrideReq.items
              .filter((i: any) => i && typeof i.message === 'string')
              .map((i: any) => ({ area: String(i.area || ''), message: String(i.message) })),
          }),
          dmId,
          companyId,
        ],
      );
    } catch (e: any) {
      console.error('[DM발행] 검수 무시 기록 실패:', e?.message);
    }
  }
  // ★ B 연계: lucky_draw/roulette 경품 설정 → dm_prizes 동기화 (실패해도 발행은 유지)
  try { await syncPrizesFromSections(companyId, dmId); }
  catch (e: any) { console.error('[DM발행] 경품 동기화 오류:', e?.message); }
  if (chargeNow) {
    await deductCreditSafe({
      companyId, cost: pubCost, source: costSource, createdBy: input.userId,
      idempotencyKey: `dm-publish:${dmId}`,
    });
  }
  return { ok: true, shortCode: result.short_code, shortUrl: dmShortUrlOf(result.short_code), charged: chargeNow, cost: chargeNow ? pubCost : 0, source: costSource };
}
