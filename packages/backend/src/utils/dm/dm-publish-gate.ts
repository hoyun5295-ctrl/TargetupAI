/**
 * dm-publish-gate.ts — DM "첫 발행" 잠금 · 발행비 판정 CT (★ 2026-09-27 만들기 개편 S6)
 *
 * 왜 한 곳인가:
 *   DM 이 처음 발행되는 문은 둘이다 — `POST /:id/publish`(편집기 발행 · 목록 주소 복사) 와
 *   `POST /:id/send-to-target`(미발행 DM 을 보내면 안에서 발행). 옛 코드는 링크 결함 검사가 `/publish` 에만 있었고
 *   검수 치명(URL 빈 버튼 · 지난 카운트다운 등)은 **화면만** 막았다. 그래서 목록 [보내기]·[주소 복사]로 들어가면
 *   검수를 안 거친 DM 이 발행·발송됐다(브레인스토밍 0927 기획·백엔드 지적). 게이트는 효과를 만드는 자리에 둔다.
 *
 * ⛔ **첫 발행에만** 건다. 이미 발행된 DM 의 재발행(주소 복사)·재발송은 기존 동작 그대로 둔다(발행 뒤 카운트다운이
 *    지났다고 주소 복사가 막히면 쓰던 기능이 깨진다 · Harold 0926 "기존 서비스를 깨지 마라").
 * ⛔ 무시 가능한 치명(required_info · `overridable`)은 막지 않는다 — 화면이 사용자 확인을 받고 넘긴다(0728 서수란 접수).
 * ⛔ 발행비 판정 두 벌은 옛 라우트 인라인과 **같은 식**이다(동작 무변경 · 계약 테스트가 고정).
 */
import { query } from '../../config/database';
import { findLinkDefectDeep } from '../normalize';
import { hasUneditedPlaceholder } from '../email-ai';
import { isCreditEnabledStrict } from '../ai-credit';
import { getCreditCost } from '../ai-credit-calc';
import { validateDm, type ValidationItem } from './dm-validate';
import { extractFlatSectionsFromDm } from './dm-builder';
import { isInteractionCampaign } from './dm-interaction';

export type DmPublishBlock = {
  status: 400;
  code: 'LINK_DEFECT' | 'UNEDITED_PLACEHOLDER' | 'VALIDATION_BLOCKED';
  error: string;
  items?: Array<Pick<ValidationItem, 'area' | 'message' | 'section_id'>>;
};

type DmBodyRow = {
  sections?: unknown;
  pages?: unknown;
  header_data?: unknown;
  footer_data?: unknown;
  brand_kit?: unknown;
  scheduled_at?: string | null;
};

/** 객체 트리의 문자열 전부(깊이 12 · 채울 자리 검사용 · 순수) */
function stringsOf(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 12 || node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { for (const v of node) stringsOf(v, out, depth + 1); return out; }
  if (typeof node === 'object') { for (const v of Object.values(node as Record<string, unknown>)) stringsOf(v, out, depth + 1); }
  return out;
}

function parseMaybe(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

/**
 * 첫 발행 잠금 — 링크 결함 → 채울 자리 → 무시 불가 검수 치명 순. 없으면 null.
 * 링크 판정은 옛 `/publish` 인라인과 같은 입력(sections·pages·header·footer)과 같은 문구다.
 */
export async function dmPublishBlocker(dm: DmBodyRow): Promise<DmPublishBlock | null> {
  const body = {
    sections: parseMaybe(dm.sections),
    pages: parseMaybe(dm.pages),
    header_data: parseMaybe(dm.header_data),
    footer_data: parseMaybe(dm.footer_data),
  };
  const link = findLinkDefectDeep(body, '링크는');
  if (link) return { status: 400, code: 'LINK_DEFECT', error: link };

  const texts = stringsOf(body);
  if (hasUneditedPlaceholder(...texts)) {
    return {
      status: 400,
      code: 'UNEDITED_PLACEHOLDER',
      error: '직접 입력이 필요한 자리가 남아 있어요. 그 자리를 채운 뒤 보내 주세요.',
    };
  }

  // ★ 2026-09-27 Codex 1R — 옛 슬라이드 DM(장마다 사진 · 장에 sections 가 없다)은 검수 기준(섹션)이 없다.
  //   뷰어는 그 구조를 그대로 그리므로 옛 동작처럼 링크·채울 자리만 보고 넘긴다(복제본 첫 발행이 "섹션 0"으로 막히던 경로).
  const flat = extractFlatSectionsFromDm({ ...dm, sections: body.sections, pages: body.pages });
  const pagesArr = Array.isArray(body.pages) ? (body.pages as any[]) : [];
  const legacySlides = flat.length === 0 && pagesArr.length > 0 && !!pagesArr[0] && !Array.isArray(pagesArr[0].sections);
  if (legacySlides) return null;
  const v = await validateDm({
    sections: flat,
    brand_kit: parseMaybe(dm.brand_kit) as any,
    scheduled_at: dm.scheduled_at || null,
    publish_mode: 'now',
  });
  const blocking = v.items.filter((i) => i.severity === 'fatal' && !i.overridable);
  if (blocking.length > 0) {
    return {
      status: 400,
      code: 'VALIDATION_BLOCKED',
      error: blocking.length === 1
        ? `보내기 전에 고칠 곳이 있어요: ${blocking[0].message}`
        : `보내기 전에 고칠 곳이 ${blocking.length}곳 있어요. 첫 번째: ${blocking[0].message}`,
      items: blocking.map((i) => ({ area: i.area, message: i.message, section_id: i.section_id })),
    };
  }
  return null;
}

/** 이 DM 의 발행비 키·금액(참여형 = 120 · 일반 = 100) — 옛 두 라우트 인라인과 같은 판정 */
export async function dmPublishFeeSourceOf(companyId: string, dmId: string): Promise<{ source: 'dm-interaction-publish' | 'dm-builder'; cost: number }> {
  const isInteraction = await isInteractionCampaign(companyId, dmId);
  const source = isInteraction ? 'dm-interaction-publish' : 'dm-builder';
  return { source, cost: getCreditCost(source) };
}

/** 발행비가 이미 원장에 있는가(멱등키 `dm-publish:{id}`) */
export async function isDmPublishFeeCharged(companyId: string, dmId: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM ai_credit_transactions WHERE company_id = $1::uuid AND idempotency_key = $2 LIMIT 1`,
    [companyId, `dm-publish:${dmId}`],
  );
  return r.rows.length > 0;
}

/**
 * `send-to-target` 발행비 게이트 — 미납 + 실발송 이력 없음 + 크레딧제 적용 회사일 때만 {source,cost}.
 * 판정 조회 실패 = null(옛 동작: 발송 우선 · 발송 무결 최우선) — 옛 인라인 try/catch 와 같다.
 */
export async function resolveSendPublishFeeGate(companyId: string, dmId: string): Promise<{ source: string; cost: number } | null> {
  try {
    return await sendPublishFeeGateStrict(companyId, dmId);
  } catch (feeErr: any) {
    console.warn('[DM 타겟 발송] 발행비 판정 실패 — 기존 동작으로 진행:', feeErr?.message);
    return null;
  }
}

/**
 * ★ 2026-09-27 Codex 1R — 같은 판정의 엄격판(조회 실패 = 던진다). 발송 경로는 위 함수가 옛 동작대로 삼키고,
 * 선견적은 이 함수를 불러 "모르는 발행비"를 0 크레딧 견적으로 접지 않는다(화면은 견적을 모르면 [링크만 받기]를 막는다).
 * 크레딧제 판정 = isCreditEnabledStrict(행 부재 = 미적용 · 조회 실패 = throw) — 행이 있을 때의 판정식은 getCreditState 와 같다.
 */
async function sendPublishFeeGateStrict(companyId: string, dmId: string): Promise<{ source: string; cost: number } | null> {
  if (await isDmPublishFeeCharged(companyId, dmId)) return null;
  const [legacyR, creditEnabled] = await Promise.all([
    query(`SELECT 1 FROM dm_recipient_tokens WHERE dm_id = $1::uuid AND company_id = $2::uuid LIMIT 1`, [dmId, companyId]),
    isCreditEnabledStrict(companyId),
  ]);
  if (legacyR.rows.length === 0 && creditEnabled) return dmPublishFeeSourceOf(companyId, dmId);
  return null;
}

/**
 * 선견적(표시용 · `GET /:id/publish-quote`) — 누르는 순간의 판정은 각 라우트가 다시 한다(불변 5).
 * via='send' = 보내기 경로(send-to-target 규칙) · via='publish' = 링크만 받기(첫 발행 규칙).
 */
export async function quoteDmPublishFee(companyId: string, dmId: string, via: 'send' | 'publish'): Promise<{ required: boolean; cost: number; source: string | null }> {
  if (via === 'send') {
    const gate = await sendPublishFeeGateStrict(companyId, dmId);
    return gate ? { required: true, cost: gate.cost, source: gate.source } : { required: false, cost: 0, source: null };
  }
  if (await isDmPublishFeeCharged(companyId, dmId)) return { required: false, cost: 0, source: null };
  if (!(await isCreditEnabledStrict(companyId))) return { required: false, cost: 0, source: null };
  const fee = await dmPublishFeeSourceOf(companyId, dmId);
  return { required: true, cost: fee.cost, source: fee.source };
}
