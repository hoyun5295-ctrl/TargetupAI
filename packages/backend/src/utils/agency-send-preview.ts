/**
 * agency-send-preview.ts — 대행발송 실물 문장 조립 CT (★ 2026-08-28 신설 · 서수란 접수 cmtcle8gn04bnjnot641p0fvq)
 *
 * 경위: 발송 2시간 이상 남은 접수는 큐 적재(T-2h 재검사 통과 뒤)까지 예약내역에 아무것도 없어
 *   고객사가 치환(머지) 내용을 검토할 수 없었다. 파이프라인은 그대로 두고(불변 1·2 = 당일 검사 없는
 *   발송 0 · 적재는 검사 통과 뒤 1회) 접수 상세에 치환 미리보기를 보여 준다.
 *
 * ⛔ 조립은 `prepareSendMessage` 하나를 지난다 — 실제 발송(`direct-send-processor`)이 부르는 함수와
 *   같아야 **검사한 문장 = 담당자가 본 문장 = 미리보기 = 나가는 문장**이 된다(불변 4).
 * ⛔ 수신자 값은 문안 변수명이 아니라 **주소록 슬롯**으로 넘긴다. 치환 함수는 값을 DB 컬럼 이름으로
 *   찾기 때문에, 변수명을 키로 넘기면 하나도 못 찾고 전부 빈 문자열이 된다(2026-08-23 정정).
 * ⛔ 미리보기를 프론트에서 재구현하지 않는다 — 폭 고정 미리보기가 거짓말하던 것과 같은 부류로,
 *   실물과 다른 코드가 만든 미리보기는 결국 다른 문장을 보여 준다.
 *
 * 워커(스팸 검사·테스트 문자)의 옛 `buildSample`이 이 파일로 이동했다(원문 복사 · 1행 = 첫 수신자).
 * 상세 화면 미리보기는 같은 조립을 상위 N행에 돌린 것뿐이다.
 */
import { query } from '../config/database';
import { buildSlotPlan, toSlotValues } from './agency-send-vars';
import { getOpt080Number, prepareFieldMappings, prepareSendMessage } from './messageUtils';

/** 상세 미리보기 상한. 검토용 표본이다 — 전건 최종 보증은 담당자 테스트 문자와 발송이 맡는다. */
export const AGENCY_PREVIEW_LIMIT = 50;

export interface RenderedSample {
  phone: string;
  text: string;
  subject: string;
}

interface RenderCtx {
  plan: ReturnType<typeof buildSlotPlan>;
  mappings: Awaited<ReturnType<typeof prepareFieldMappings>>;
  opt080: string;
}

/** 접수 한 건의 조립 재료(문안 슬롯 계획 · 필드 매핑 · 080)를 한 번만 읽는다. */
async function loadRenderCtx(row: any): Promise<RenderCtx> {
  const plan = buildSlotPlan(String(row.current_content || ''));
  const mappings = await prepareFieldMappings(row.company_id);
  const opt080 = row.is_ad ? await getOpt080Number(row.created_by || null, row.company_id) : '';
  return { plan, mappings, opt080 };
}

/** 수신자 한 명 몫의 실물 문장. 인자 구성은 옛 buildSample과 문자 단위로 같다. */
function renderOne(ctx: RenderCtx, row: any, phone: string, vars: Record<string, any> | null | undefined): RenderedSample {
  const slotValues = toSlotValues(vars, ctx.plan.order);
  const { message, subject } = prepareSendMessage(ctx.plan.slotContent, {}, ctx.mappings, {
    msgType: row.message_type,
    isAd: !!row.is_ad,
    opt080Number: ctx.opt080,
    addressBookFields: slotValues,
    subject: String(row.subject || ''),
    skipNumberFormatting: true,
  });
  return { phone, text: message, subject };
}

/**
 * 검사·테스트 문자에 쓸 문안 한 벌(첫 수신자 기준 변수 치환 + 광고 부착).
 * 옛 워커 `buildSample`과 같은 동작 — 수신자 0건이어도 빈 슬롯으로 한 벌을 만든다(검사는 돌아야 한다).
 */
export async function buildRenderedSample(row: any): Promise<{ text: string; subject: string }> {
  const first = await query(
    `SELECT phone, vars FROM agency_send_recipients WHERE request_id = $1::uuid ORDER BY row_no LIMIT 1`,
    [row.id],
  );
  const ctx = await loadRenderCtx(row);
  const r = renderOne(ctx, row, String(first.rows[0]?.phone || ''), first.rows[0]?.vars);
  return { text: r.text, subject: r.subject };
}

/**
 * 접수 상세 미리보기: 상위 N명 각자의 실물 문장.
 * 수신자 0건이면 빈 배열(미리보기는 보여 줄 사람이 있어야 의미가 있다 · 1행 함수와 다른 점).
 */
export async function buildRenderedSamples(row: any, limit: number = AGENCY_PREVIEW_LIMIT): Promise<RenderedSample[]> {
  const n = Math.max(1, Math.min(Number(limit) || AGENCY_PREVIEW_LIMIT, AGENCY_PREVIEW_LIMIT));
  const recipients = await query(
    `SELECT phone, vars FROM agency_send_recipients WHERE request_id = $1::uuid ORDER BY row_no LIMIT $2::int`,
    [row.id, n],
  );
  if (recipients.rows.length === 0) return [];
  const ctx = await loadRenderCtx(row);
  return recipients.rows.map((r: any) => renderOne(ctx, row, String(r.phone || ''), r.vars));
}
