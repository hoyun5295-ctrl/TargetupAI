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
import { buildSlotPlan, toSlotValues, toStoredVars } from './agency-send-vars';
import { getOpt080Number, prepareFieldMappings, prepareSendMessage } from './messageUtils';
import { eucKrByteLength } from './message-byte';

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

/** ★ 2026-09-26 R1-08(Codex 8차 1R) — 접수 화면이 SMS 판정을 물을 때 보내는 후보 수신자 상한(화면이 가중 점수 상위만 고른다) */
export const AGENCY_SMS_BYTES_MAX_CANDIDATES = 20;

/**
 * ★ 2026-09-26 한줄로 V2 R1-08 — **SMS로 보냈을 때 가장 긴 수신자 문장의 EUC-KR 바이트**.
 * 옛 원스텝·메일 접수는 글자 수 45로 SMS/LMS를 갈랐다(광고 표기·무료거부 줄·변수 값 무시) → 90바이트를 넘는 SMS 접수 ·
 * 90바이트 안인 영문 문안의 LMS 과금. 조립은 실제 발송·미리보기와 같은 한 벌(renderOne과 같은 인자 · msgType 'SMS').
 * 후보 = 변수 값 바이트(문안 등장 횟수 가중) 상위 5명만 실제로 조립한다 — 치환은 값이 길수록 문장이 길어지므로
 * 최장 후보에 최장 문장이 있다(날짜 서식 등 예외를 덮으려고 1명이 아니라 5명). 수신자가 없으면 빈 값으로 한 벌.
 * 슬롯 계획이 실패하면(항목 과다) 문안 그대로의 바이트 — 그 반려는 호출부가 따로 한다.
 */
export async function measureAgencyMaxSmsBytes(input: {
  companyId: string;
  userId: string | null;
  content: string;
  isAd: boolean;
  recipients: Array<{ vars?: Record<string, any> | null } | null | undefined>;
}): Promise<number> {
  const content = String(input.content || '');
  const plan = buildSlotPlan(content);
  if (!plan.ok) return eucKrByteLength(content);
  const occurrences: Record<string, number> = {};
  for (const name of plan.order) {
    occurrences[name] = content.split(`%${name}%`).length - 1;
  }
  const stored = (input.recipients || []).map((r) => toStoredVars(r?.vars));
  let candidates: Array<Record<string, string | null> | null> = [null];
  if (plan.order.length > 0 && stored.length > 0) {
    const scored = stored.map((vars, idx) => ({
      idx,
      score: plan.order.reduce((acc, name) => acc + (occurrences[name] || 1) * eucKrByteLength(String(vars?.[name] ?? '')), 0),
    }));
    scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
    candidates = scored.slice(0, 5).map((x) => stored[x.idx]);
  }
  const mappings = await prepareFieldMappings(input.companyId);
  const opt080 = input.isAd ? await getOpt080Number(input.userId || null, input.companyId) : '';
  let max = 0;
  for (const vars of candidates) {
    const { message } = prepareSendMessage(plan.slotContent, {}, mappings, {
      msgType: 'SMS',
      isAd: !!input.isAd,
      opt080Number: opt080,
      addressBookFields: toSlotValues(vars, plan.order),
      subject: '',
      skipNumberFormatting: true,
    });
    max = Math.max(max, eucKrByteLength(message));
  }
  return max;
}
