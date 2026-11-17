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
import { eucKrByteLength, SMS_MAX_BYTES } from './message-byte';
import { agencyAdTextApplies } from './agency-send-optout';   // ★ 2026-11-13 C132 이메일 대행 = 문안 그대로(표기 판정 한 곳)

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
  /** ★ C132 — (광고) · 무료수신거부를 붙이는가(agencyAdTextApplies · 이메일 접수 = false) */
  adText: boolean;
}

/** 접수 한 건의 조립 재료(문안 슬롯 계획 · 필드 매핑 · 080)를 한 번만 읽는다. */
async function loadRenderCtx(row: any): Promise<RenderCtx> {
  const plan = buildSlotPlan(String(row.current_content || ''));
  const mappings = await prepareFieldMappings(row.company_id);
  const adText = agencyAdTextApplies({ isAd: row.is_ad, adText: row.ad_text });
  const opt080 = adText ? await getOpt080Number(row.created_by || null, row.company_id) : '';
  return { plan, mappings, opt080, adText };
}

/** 수신자 한 명 몫의 실물 문장. 인자 구성은 옛 buildSample과 문자 단위로 같다. */
function renderOne(ctx: RenderCtx, row: any, phone: string, vars: Record<string, any> | null | undefined): RenderedSample {
  const slotValues = toSlotValues(vars, ctx.plan.order);
  const { message, subject } = prepareSendMessage(ctx.plan.slotContent, {}, ctx.mappings, {
    msgType: row.message_type,
    isAd: ctx.adText,
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

/** SMS 길이 측정 재료(문안 한 벌 · 접수 한 건) — 조립 인자는 renderOne 과 같다(msgType 만 'SMS') */
interface SmsMeasureCtx {
  plan: ReturnType<typeof buildSlotPlan>;
  mappings: Awaited<ReturnType<typeof prepareFieldMappings>>;
  adText: boolean;
  opt080: string;
}
/** adText = 표기 정책 판정 결과(부르는 쪽이 agencyAdTextApplies 로 · 행 정책 CT 를 지난 값만) */
async function smsMeasureCtx(companyId: string, userId: string | null, content: string, adText: boolean): Promise<SmsMeasureCtx> {
  const plan = buildSlotPlan(content);
  const mappings = await prepareFieldMappings(companyId);
  const opt080 = adText ? await getOpt080Number(userId || null, companyId) : '';
  return { plan, mappings, adText, opt080 };
}
function smsBytesOfOne(ctx: SmsMeasureCtx, vars: Record<string, any> | null | undefined): number {
  const { message } = prepareSendMessage(ctx.plan.slotContent, {}, ctx.mappings, {
    msgType: 'SMS',
    isAd: ctx.adText,
    opt080Number: ctx.opt080,
    addressBookFields: toSlotValues(vars ? toStoredVars(vars) : null, ctx.plan.order),
    subject: '',
    skipNumberFormatting: true,
  });
  return eucKrByteLength(message);
}
/** 측정 중 이벤트 루프에 양보하는 간격(줄) · 저장된 명단을 읽는 쪽 크기도 같다 */
export const AGENCY_SMS_MEASURE_PAGE = 2000;
const yieldLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * ★ 2026-11-17 C142(B-1117-3 · 뿌리 R68 길이 축 · Codex 설계 1R #3) — 넘겨받은 줄 **전부**를 실제 발송과 같은 조립으로 잰 최댓값.
 *   옛: 변수 값 길이 점수 상위 5명만 조립했다. 조립은 값의 앞뒤 공백 정리(이름) · Liquid · 남은 변수 지우기를 거쳐
 *   점수 순서가 문장 길이 순서와 같다는 보장이 없다(표본 밖 최장 문장을 놓친다). 표본을 두지 않는다.
 */
async function maxSmsBytesOfRows(ctx: SmsMeasureCtx, rows: ReadonlyArray<{ vars?: Record<string, any> | null } | null | undefined>, start = 0): Promise<number> {
  let max = 0;
  for (let i = 0; i < rows.length; i += 1) {
    max = Math.max(max, smsBytesOfOne(ctx, rows[i]?.vars ?? null));
    if ((start + i + 1) % AGENCY_SMS_MEASURE_PAGE === 0) await yieldLoop();
  }
  return max;
}

/**
 * ★ 2026-09-26 한줄로 V2 R1-08 — **SMS로 보냈을 때 가장 긴 수신자 문장의 EUC-KR 바이트**(입구 = 접수 코어 · 원스텝 · 메일 분석 · 화면 /sms-bytes).
 * 옛 원스텝·메일 접수는 글자 수 45로 SMS/LMS를 갈랐다(광고 표기·무료거부 줄·변수 값 무시) → 90바이트를 넘는 SMS 접수 ·
 * 90바이트 안인 영문 문안의 LMS 과금. 조립은 실제 발송·미리보기와 같은 한 벌(renderOne과 같은 인자 · msgType 'SMS').
 * ★ C142 — 넘겨받은 명단 전원을 잰다(옛 상위 5명 표본 삭제 · 저장된 접수용 measureAgencyRequestSmsBytes 와 같은 핵심).
 * 수신자가 없거나 문안에 변수가 없으면 한 번만 조립. 슬롯 계획이 실패하면(항목 과다) 문안 그대로의 바이트 — 그 반려는 호출부가 따로 한다.
 */
export async function measureAgencyMaxSmsBytes(input: {
  companyId: string;
  userId: string | null;
  content: string;
  isAd: boolean;
  /** ★ 2026-11-13 C132 — 표기 정책(행의 ad_text · 접수 전 = 입구가 agencyAdTextForSource 로 넘긴다 · false = 표기 없이 잰다) */
  adText: boolean | null | undefined;
  recipients: Array<{ vars?: Record<string, any> | null } | null | undefined>;
}): Promise<number> {
  const content = String(input.content || '');
  const adText = agencyAdTextApplies({ isAd: input.isAd, adText: input.adText });
  const ctx = await smsMeasureCtx(input.companyId, input.userId, content, adText);
  if (!ctx.plan.ok) return eucKrByteLength(content);
  const rows = input.recipients || [];
  if (ctx.plan.order.length === 0 || rows.length === 0) return smsBytesOfOne(ctx, null);
  return maxSmsBytesOfRows(ctx, rows);
}

/**
 * ★ C142 — 저장된 접수(명단 = agency_send_recipients)를 이 문안으로 보냈을 때 가장 긴 SMS 문장의 바이트.
 *   명단을 (row_no, id) 순 2,000줄씩 읽어 같은 핵심으로 잰다(앱 메모리 = 한 쪽 · 0912 「명단 크기 = 프로세스 메모리」 원칙).
 *   접수 뒤 명단은 바뀌지 않는다(바꾸는 길 0 · 문안 고치기는 명단을 건드리지 않는다).
 */
export async function measureAgencyRequestSmsBytes(row: any, content: string): Promise<number> {
  const text = String(content || '');
  const adText = agencyAdTextApplies({ isAd: row.is_ad, adText: row.ad_text });
  const ctx = await smsMeasureCtx(String(row.company_id), row.created_by || null, text, adText);
  if (!ctx.plan.ok) return eucKrByteLength(text);
  if (ctx.plan.order.length === 0) return smsBytesOfOne(ctx, null);
  let max = -1;
  let seen = 0;
  let lastRowNo = -2147483648;
  let lastId = '0';
  for (;;) {
    const page = await query(
      `SELECT id, row_no, vars FROM agency_send_recipients
        WHERE request_id = $1::uuid AND (row_no, id) > ($2::int, $3::bigint)
        ORDER BY row_no, id
        LIMIT ${AGENCY_SMS_MEASURE_PAGE}`,
      [row.id, lastRowNo, lastId],
    );
    if (page.rows.length === 0) break;
    max = Math.max(max, await maxSmsBytesOfRows(ctx, page.rows, seen));
    seen += page.rows.length;
    const tail = page.rows[page.rows.length - 1];
    lastRowNo = Number(tail.row_no);
    lastId = String(tail.id);
    if (page.rows.length < AGENCY_SMS_MEASURE_PAGE) break;
    await yieldLoop();
  }
  return max < 0 ? smsBytesOfOne(ctx, null) : max;
}

/** ★ C142 — SMS 접수를 이 문안으로 보내면 90바이트를 넘는가 · 넘으면 가장 긴 문장 바이트 · 아니면(LMS · MMS 포함) null */
export async function agencySmsBytesOver(row: any, content: string): Promise<number | null> {
  if (String(row?.message_type || '').toUpperCase() !== 'SMS') return null;
  const bytes = await measureAgencyRequestSmsBytes(row, content);
  return bytes > SMS_MAX_BYTES ? bytes : null;
}

/** ★ C142 — 고객에게 보이는 넘침 안내(고치기 저장 반려 · 화면 표시 · 담당자 문자가 같은 말) */
export function agencySmsBytesOverText(bytes: number): string {
  return `SMS는 ${SMS_MAX_BYTES}바이트까지 보낼 수 있어요. 이 문안은 실제로 나가는 문장 가운데 가장 긴 문장이 ${bytes}바이트예요. ${SMS_MAX_BYTES}바이트 안으로 줄이거나 LMS로 새로 접수해 주세요.`;
}
