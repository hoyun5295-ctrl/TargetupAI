/**
 * utils/agency-send-intake.ts — 대행발송 접수 코어 CT (★2026-08-26 §18 승격)
 *
 * `routes/agency-send.ts`에 있던 접수 생성 코어(`createRequestCore`)와 원스텝 분석(`analyzeOneStep`)을
 * **원본 복사**로 승격했다(설계서 §18-2 · 회의론자 필수 조건 5 = 라우트 쪽 정의 삭제 + 잔존 0 grep).
 * 입구 = ①화면 접수 ②요청서 원스텝 ③이메일 접수 워커. 입구가 늘어도 검증·트랜잭션은 이 한 곳이다.
 *
 * ⛔ 워커가 라우트를 import하는 방향 금지 — 그래서 이 파일이 있다. 라우트는 이 CT를 import한다.
 * ⛔ 리드타임은 코어가 집행한다(`pre.minLeadMinutes` · 회의론자 필수 조건 1). 어댑터(이메일 워커)에
 *   시각 판정 코드를 두지 않는다 — 화면 180(기본) · 이메일 240(`EMAIL_MIN_LEAD_MINUTES`)이 갈라져도
 *   판정 구현은 `validateRequestedAt` 한 벌이다.
 * ⛔ 확정 경로에서 AI를 부르지 마라(§17-6 계약) — `analyzeOneStep(aiSuggest=false)`가 그 게이트다.
 */
import pool, { query } from '../config/database';
import { getRegisteredCallbackSet, isCallbackRegistered } from './callback-filter';
import { validateMmsPayload } from './mms-validator';
import {
  parseAgencyRequestForm, parseAgencyRecipientList, pickPhoneColumn, resolveCallbackPlan, matchHeader,
  hasRecipientSheet,
  type AgencyFormError, type CallbackPlan,
} from './agency-send-form';
import { normalizePhone, normalizeAgencyPhone } from './normalize-phone';
import { validateRequestedAt } from './agency-send-state';
import { buildSlotPlan, extractAgencyVars, resolveVarColumns } from './agency-send-vars';
import { suggestVarColumnsWithAi } from './ai-column-mapper';
import { SEND_HOURS } from '../config/defaults';

/** 접수 1건에 담을 수 있는 수신자 상한. 그 이상은 나눠 접수한다(엑셀 업로드 권장값과 같은 축) */
export const MAX_RECIPIENTS = 30000;
export const MAX_CONTENT = 2000;
/**
 * 수신자 INSERT 한 문장에 넣을 행 수.
 * ⛔ PostgreSQL 바인드 파라미터 상한은 65535다. 행마다 3개를 쓰므로 3만 건을 한 문장에 넣으면 9만 개가 되어
 *   상한을 넘긴다(적재가 통째로 실패한다). 나눠 넣되 **한 트랜잭션 안**에서 처리해 부분 적재를 만들지 않는다.
 */
const RECIPIENT_INSERT_CHUNK = 2000;
/** 테스트 문자를 받을 담당자 수 상한. 그 이상은 실수로 명단을 넣은 것이다 */
export const MAX_MANAGER_PHONES = 10;
/** 회신번호 종류(=나뉘는 접수 수) 상한. 이 위는 사람이 승인할 수 있는 규모가 아니다 */
export const MAX_CALLBACK_GROUPS = 20;

/**
 * 회사 발송 허용 시간(없으면 CT 기본값).
 *
 * ⛔ 광고면 플랫폼 창(`SEND_HOURS`)과 **겹치는 구간**만 쓴다. 회사 설정이 그보다 넓어도 광고는
 *   야간 제한(정보통신망법)에 걸려 예약 단계에서 거절된다. 접수에서 안 막으면 담당자는
 *   발송 2시간 전에야 "나가지 않았다"를 알게 된다(★2026-08-23).
 */
export async function loadSendWindow(companyId: string, isAd: boolean): Promise<{ startHour: number | null; endHour: number | null }> {
  let startHour: number | null = null;
  let endHour: number | null = null;
  try {
    const r = await query(`SELECT send_start_hour, send_end_hour FROM companies WHERE id = $1`, [companyId]);
    const row = r.rows[0] || {};
    startHour = row.send_start_hour != null ? Number(row.send_start_hour) : null;
    endHour = row.send_end_hour != null ? Number(row.send_end_hour) : null;
  } catch {
    startHour = null;
    endHour = null;
  }
  if (!isAd) return { startHour, endHour };
  return {
    startHour: Math.max(startHour ?? SEND_HOURS.start, SEND_HOURS.start),
    endHour: Math.min(endHour ?? SEND_HOURS.end, SEND_HOURS.end),
  };
}

/**
 * ★0826(적대 2R) source 컬럼 존재 탐지 — 배포(코드) → DDL 순서에서 기존 입구가 죽지 않으면서도
 * 화면('screen')·원스텝('one_step') 라벨이 살아야 한다. 컬럼이 없으면 INSERT에서 빼고(DEFAULT 없음이므로
 * 그냥 구식 문장), 있으면 싣는다. 음성 결과는 5분 TTL로 재탐지한다(DDL이 재기동 없이 적용되는 창 대비).
 */
let sourceColumnCache: { value: boolean; checkedAt: number } | null = null;
async function hasSourceColumn(client: any): Promise<boolean> {
  const now = Date.now();
  if (sourceColumnCache && (sourceColumnCache.value || now - sourceColumnCache.checkedAt < 5 * 60 * 1000)) {
    return sourceColumnCache.value;
  }
  try {
    const r = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'agency_send_requests' AND column_name = 'source'`,
    );
    sourceColumnCache = { value: r.rows.length > 0, checkedAt: now };
  } catch {
    sourceColumnCache = { value: false, checkedAt: now };
  }
  return sourceColumnCache.value;
}

export async function logEvent(requestId: string, kind: string, payload: Record<string, any> = {}): Promise<void> {
  try {
    await query(`INSERT INTO agency_send_events (request_id, kind, payload) VALUES ($1::uuid, $2, $3::jsonb)`,
      [requestId, kind, JSON.stringify(payload)]);
  } catch (err: any) {
    console.warn('[agency-send] 이력 기록 실패(본 흐름은 계속):', err?.message);
  }
}

// ════════════════════════════════════════════════════════════
// 접수 생성 코어 — 검증·트랜잭션·이력이 전부 여기 있다 (★2026-08-25(3) 추출 · 0826 승격)
//   입구 = ①화면 접수(POST /) ②요청서 원스텝(POST /one-step, 회신번호 열 방식이면 여러 번)
//   ③이메일 접수 워커. 입구가 늘어도 검증은 이 한 곳이다.
// ════════════════════════════════════════════════════════════
export type CreateCoreResult =
  | { ok: true; request: any }
  | { ok: false; status: number; error: string; code?: string };

export async function createRequestCore(
  auth: { companyId: string; userId: string },
  input: any,
  /** 외부 트랜잭션(원스텝 다건 생성). 주어지면 BEGIN·COMMIT·이력은 호출부가 소유한다 */
  extClient?: any,
  /**
   * 사전 조회 컨텍스트(★Codex 적대 2R) — 외부 트랜잭션이 연결을 쥔 채 코어가 전역 풀을 다시 기다리면
   * 동시 요청이 풀을 서로 기다리다 말라붙는다. 원스텝은 트랜잭션을 열기 **전에** 같은 함수로 조회해
   * 여기로 넘긴다. 검증 규칙 자체는 그대로 코어가 집행한다.
   * `minLeadMinutes`(★0826 §18) = 입구별 최소 리드타임. 비우면 화면 기본(180). 이메일 워커는 240을 넘긴다.
   */
  pre?: { registeredSet?: Set<string>; window?: { startHour: number | null; endHour: number | null }; minLeadMinutes?: number },
): Promise<CreateCoreResult> {
  const {
    messageType = 'SMS', subject, content, isAd = false, callbackNumber,
    managerPhone, managerPhones, requestedAt, mmsImagePaths, fileName, phoneColumn, varMapping,
    recipients,
    /**
     * 접수 출처(★0826 §18 · 'screen' | 'one_step' | 'email'). ⛔ 배포 순서 안전 규약(회의론자 필수 8 · 적대 2R 정정):
     * 컬럼 존재를 탐지(hasSourceColumn)해 **있을 때만** INSERT에 싣는다 — DDL 전에 코드가 떠도 전 입구가 안 죽고,
     * DDL 후에는 화면·원스텝·이메일 전부 제 라벨을 갖는다(비우면 원스텝이 '직접 입력'으로 남는 결함이 있었다).
     */
    source = 'screen',
  } = input || {};

  // ── 문안
  const body = String(content || '').trim();
  if (!body) return { ok: false, status: 400, error: '보낼 문안을 입력해 주세요.' };
  if (body.length > MAX_CONTENT) return { ok: false, status: 400, error: `문안은 ${MAX_CONTENT}자까지 넣을 수 있습니다.` };

  // 문안 변수는 직접발송과 같은 주소록 슬롯 네 칸에 얹는다(치환 CT가 하나여야 하므로).
  // ⛔ 발송 직전에 조용히 잘리면 안 되므로 접수에서 막는다.
  const plan = buildSlotPlan(body);
  if (!plan.ok) return { ok: false, status: 400, error: plan.error || '문안 항목이 너무 많습니다.', code: 'TOO_MANY_VARS' };

  const type = String(messageType).toUpperCase();
  if (!['SMS', 'LMS', 'MMS'].includes(type)) {
    return { ok: false, status: 400, error: '보낼 수 있는 형식이 아닙니다.' };
  }
  if ((type === 'LMS' || type === 'MMS') && !String(subject || '').trim()) {
    return { ok: false, status: 400, error: '제목을 입력해 주세요.' };
  }
  const subjectVars = extractAgencyVars(String(subject || ''));
  if (subjectVars.length > 0) {
    return {
      ok: false, status: 400, code: 'SUBJECT_VARS',
      error: `제목에는 항목을 넣을 수 없습니다: ${subjectVars.map((v) => `%${v}%`).join(' ')}. 제목은 모든 수신자에게 같은 문장으로 나갑니다.`,
    };
  }
  // MMS는 이미지가 본체다. 0장이면 통신사가 파일 오류로 버린다(2026-04-21 9007 선례)
  const images = Array.isArray(mmsImagePaths) ? mmsImagePaths : [];
  const mmsCheck = validateMmsPayload(type, images);
  if (!mmsCheck.ok) return { ok: false, status: 400, error: mmsCheck.error || '이미지 구성을 확인해 주세요.', code: mmsCheck.code };

  // ── 발신번호(회사에 등록된 것만)
  const callback = normalizePhone(String(callbackNumber || ''));
  if (!callback) return { ok: false, status: 400, error: '보내는 번호를 골라 주세요.' };
  const callbackOk = pre?.registeredSet ? pre.registeredSet.has(callback) : await isCallbackRegistered(auth.companyId, callback, auth.userId);
  if (!callbackOk) {
    return { ok: false, status: 400, error: '등록되지 않은 보내는 번호입니다. 발신번호 등록을 먼저 해 주세요.' };
  }

  // ── 담당자 번호(테스트 문자를 받을 곳). **여러 명일 수 있다**(Harold 2026-08-23)
  const managerList: string[] = [];
  const managerSeen = new Set<string>();
  const managerRaw: any[] = Array.isArray(managerPhones) ? managerPhones : [managerPhone];
  for (const raw of managerRaw) {
    // 0 유실 복원 포함(★0826 §18-4 · 엑셀 숫자 셀 대비)
    const phone = normalizeAgencyPhone(raw);
    if (!phone || phone.length < 10 || managerSeen.has(phone)) continue;
    managerSeen.add(phone);
    managerList.push(phone);
    if (managerList.length >= MAX_MANAGER_PHONES) break;
  }
  if (managerList.length === 0) {
    return { ok: false, status: 400, error: '테스트 문자를 받을 담당자 휴대폰 번호를 넣어 주세요.' };
  }

  // ── 요청 시각(리드타임 + 회사 발송 허용 시간) — 리드타임 집행 지점은 여기 하나다(★0826 §18)
  const when = validateRequestedAt(
    requestedAt, new Date(), pre?.window ?? await loadSendWindow(auth.companyId, !!isAd), pre?.minLeadMinutes,
  );
  if (!when.valid) return { ok: false, status: 400, error: when.error || '보낼 시각을 확인해 주세요.' };

  // ── 수신자
  const rows: Array<{ phone: string; vars: Record<string, any> }> = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(recipients) ? recipients : []) {
    // 0 유실 복원 포함(★0826 §18-4) — 명단 값이 엑셀 숫자 셀이면 앞 0이 떨어져 온다
    const phone = normalizeAgencyPhone(raw?.phone ?? raw ?? '');
    if (!phone || phone.length < 10 || seen.has(phone)) continue;
    seen.add(phone);
    rows.push({ phone, vars: raw?.vars && typeof raw.vars === 'object' ? raw.vars : {} });
    if (rows.length >= MAX_RECIPIENTS) break;
  }
  if (rows.length === 0) {
    return { ok: false, status: 400, error: '보낼 번호가 없습니다. 명단을 확인해 주세요.' };
  }

  // ⛔ 접수 행과 수신자는 **한 트랜잭션**이다. 나뉘면 수신자 0건짜리 접수가 남고,
  //   워커가 그것을 집어 "보낼 사람이 없는 발송"을 만든다.
  //   원스텝(extClient)은 **여러 접수가 한 트랜잭션**이다 — 부분 생성 자체가 없다(★Codex 적대 1R).
  const client = extClient || await pool.connect();
  const own = !extClient;
  let request: any;
  try {
    if (own) await client.query('BEGIN');
    // 컬럼이 있을 때만 싣는다(위 주석 · DDL 후행 안전 + 라벨 보존)
    const withSource = await hasSourceColumn(client);
    const sourceCol = withSource ? ', source' : '';
    const sourceVal = withSource ? ', $16' : '';
    const inserted = await client.query(
      `INSERT INTO agency_send_requests (
         company_id, created_by, status, callback_number, message_type, subject, mms_image_paths, is_ad,
         original_content, current_content, content_version, requested_at, manager_phone, manager_phones,
         file_name, phone_column, var_mapping, recipient_count${sourceCol}
       ) VALUES ($1::uuid, $2::uuid, 'received', $3, $4, $5, $6::jsonb, $7, $8, $8, 1, $9, $10, $11::text[], $12, $13, $14::jsonb, $15${sourceVal})
       RETURNING *`,
      [
        auth.companyId, auth.userId, callback, type, subject || null,
        images.length > 0 ? JSON.stringify(images) : null, !!isAd,
        body, when.at, managerList[0], managerList,
        fileName || null, String(phoneColumn || '전화번호'),
        JSON.stringify(varMapping && typeof varMapping === 'object' ? varMapping : {}),
        rows.length,
        ...(source ? [String(source)] : []),
      ],
    );
    request = inserted.rows[0];

    for (let offset = 0; offset < rows.length; offset += RECIPIENT_INSERT_CHUNK) {
      const slice = rows.slice(offset, offset + RECIPIENT_INSERT_CHUNK);
      const values: any[] = [];
      const chunks: string[] = [];
      slice.forEach((r, i) => {
        const base = i * 3;
        chunks.push(`($1::uuid, $${base + 2}, $${base + 3}, $${base + 4}::jsonb)`);
        values.push(offset + i + 1, r.phone, JSON.stringify(r.vars));
      });
      await client.query(
        `INSERT INTO agency_send_recipients (request_id, row_no, phone, vars) VALUES ${chunks.join(',')}`,
        [request.id, ...values],
      );
    }

    // 적재 효과 검증 — 넣었다고 믿지 않고 센다(6원칙 ②). 어긋나면 접수 자체를 되돌린다
    const counted = await client.query(
      `SELECT COUNT(*)::int AS c FROM agency_send_recipients WHERE request_id = $1::uuid`, [request.id],
    );
    if ((counted.rows[0]?.c || 0) !== rows.length) {
      throw new Error(`수신자 적재 불일치: 기대 ${rows.length} 실제 ${counted.rows[0]?.c}`);
    }
    if (own) await client.query('COMMIT');
  } catch (txErr) {
    if (own) await client.query('ROLLBACK').catch(() => {});
    throw txErr;
  } finally {
    if (own) client.release();
  }

  if (own) {
    await logEvent(request.id, 'received', { recipientCount: rows.length, messageType: type });
    console.log(`[agency-send] 접수 company=${auth.companyId} id=${request.id} ${type} ${rows.length}건`);
  }
  return { ok: true, request };
}

// ════════════════════════════════════════════════════════════
// 요청서 원스텝 분석 (★2026-08-25(3) · 0826 승격)
// ════════════════════════════════════════════════════════════
export interface OneStepGroup { callback: string; count: number; registered: boolean; recipients: Array<{ phone: string; vars: Record<string, any> }> }

export interface OneStepAnalysis {
  subject: string;
  content: string;
  isAd: boolean;
  requestedAtIso: string | null;
  managerPhones: string[];
  callback: CallbackPlan;
  headers: string[];
  phoneColumn: string | null;
  varsMatched: Array<{ name: string; column: string | null; via: 'same' | 'override' | 'ai' | null }>;
  counts: { total: number; valid: number; dup: number; invalid: number; callbackMissing: number };
  groups: OneStepGroup[];
  sample: Array<{ phone: string; callback?: string }>;
  /**
   * 명단 미리보기용 **파일 순서 그대로**의 상위 50행 전체 열 값(★2026-08-25(5) · Harold "엑셀 형식 뷰").
   * 열 상한 100 × 50행이라 응답이 유계다 — "전 행 전송 금지"(§17) 계약은 그대로다.
   * 제외(중복·형식) 전의 원본 행이다: 집계 카드가 제외 사유를 숫자로 설명한다.
   */
  sampleRows: Array<Array<string | number | null>>;
  messageType: 'SMS' | 'LMS' | 'MMS';
  fileName: string | null;
  errors: AgencyFormError[];
}

/** 확인 화면에서 바꿀 수 있는 것: 시각 · 회신번호 선택 · 담당자 · 이미지 · 문안 항목의 열. 문안·제목은 요청서가 진실이다 */
export function parseOneStepOverrides(raw: any): {
  requestedAt?: string; callback?: { mode: string; number?: string; column?: string };
  managerPhones?: string[]; mmsImagePaths?: string[]; phoneColumn?: string;
  varMapping?: Record<string, string>;
} {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    if (!o || typeof o !== 'object') return {};
    // 문안 항목 매핑은 문자열 값만 남긴다(객체·배열이 끼면 열 이름 비교가 조용히 어긋난다)
    if (o.varMapping && typeof o.varMapping === 'object' && !Array.isArray(o.varMapping)) {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(o.varMapping)) {
        if (typeof v === 'string') clean[k] = v;
      }
      o.varMapping = clean;
    } else if (o.varMapping !== undefined) {
      delete o.varMapping;
    }
    return o;
  } catch {
    return {};
  }
}

export async function analyzeOneStep(
  auth: { companyId: string; userId: string },
  formBuf: Buffer | null, listBuf: Buffer | null, listName: string | null,
  overrides: ReturnType<typeof parseOneStepOverrides>,
  /** AI 항목 추천 허용 여부. **미리보기만 true** — 확정 경로에 AI 비결정성이 들어오면 안 된다(★Codex 1R) */
  aiSuggest: boolean,
  /** 입구별 최소 리드타임(★0826 §18 · 비우면 화면 기본 180). 판정 구현은 `validateRequestedAt` 한 벌이다 */
  minLeadMinutes?: number,
): Promise<OneStepAnalysis> {
  const errors: AgencyFormError[] = [];
  const empty: OneStepAnalysis = {
    subject: '', content: '', isAd: true, requestedAtIso: null, managerPhones: [],
    callback: { mode: 'none' }, headers: [], phoneColumn: null, varsMatched: [],
    counts: { total: 0, valid: 0, dup: 0, invalid: 0, callbackMissing: 0 },
    groups: [], sample: [], sampleRows: [], messageType: 'SMS', fileName: listName, errors,
  };
  if (!formBuf) { errors.push({ field: '요청서', error: '요청서 파일을 올려 주세요.' }); return empty; }
  // ★2026-08-26(2) 통일 양식 = 한 파일(시트1 내용 + 시트2 고객리스트). 명단 파일이 따로 없으면
  //   요청서 파일의 고객리스트 시트를 명단으로 쓴다(parseAgencyRecipientList가 시트 이름으로 골라 읽는다).
  //   별도 명단 파일이 오면 그 파일이 우선이다(구양식·두 파일 하위호환).
  const effectiveListBuf = listBuf || (hasRecipientSheet(formBuf) ? formBuf : null);
  if (!effectiveListBuf) {
    errors.push({ field: '명단', error: '고객리스트 시트를 찾지 못했습니다. 새 요청서 양식(고객리스트 시트 포함)에 명단을 채우거나, 명단 파일을 함께 올려 주세요.' });
    return empty;
  }

  const form = parseAgencyRequestForm(formBuf);
  errors.push(...form.errors);

  let headers: string[] = [];
  let rows: Record<string, any>[] = [];
  try {
    const list = parseAgencyRecipientList(effectiveListBuf);
    headers = list.headers;
    rows = list.rows;
    // ⛔ 같은 이름의 열·상한 초과는 조용히 못 넘어간다(★Codex 적대 1R — 열이 밀리거나 잘리면 다른 사람에게 간다)
    for (const d of list.duplicates) errors.push({ field: '명단', error: `명단에 "${d}" 열이 두 개 있습니다. 하나만 남겨 주세요.` });
    if (list.truncated) errors.push({ field: '명단', error: `명단이 너무 큽니다. 한 번에 ${MAX_RECIPIENTS.toLocaleString()}명까지 접수할 수 있으니 나눠 주세요.` });
    if (list.columnsOverflow) errors.push({ field: '명단', error: '명단의 열이 100개를 넘습니다. 발송에 쓸 열만 남겨 주세요.' });
  } catch {
    errors.push({ field: '명단', error: '명단 파일을 읽지 못했습니다. 엑셀 또는 CSV인지 확인해 주세요.' });
  }
  if (headers.length > 0 && rows.length === 0) errors.push({ field: '명단', error: '명단에 데이터 행이 없습니다.' });

  // 수신자 열: 확인 화면에서 직접 고를 수 있다(값 비율 자동 선정이 애매한 파일 대비).
  // ⛔ 지정했는데 명단에 없으면 자동 선정으로 **폴백하지 않는다**(★2R — 사용자가 본 것과 다른 열 금지)
  // ★0826 §18-4: 요청서의 "수신자 열 이름" 칸이 채워져 있으면 그것이 진실이다(추정 제거).
  //   그 이름이 명단에 없어도 자동 선정으로 폴백하지 않는다 — 적은 것과 다른 열은 다른 사람이다.
  let phoneColumn: string | null = null;
  if (overrides.phoneColumn !== undefined) {
    if (headers.includes(String(overrides.phoneColumn))) phoneColumn = String(overrides.phoneColumn);
    else errors.push({ field: '명단', error: '고르신 수신자 열이 명단에 없습니다. 다시 골라 주세요.' });
  } else if (form.phoneColumnName) {
    const hit = matchHeader(form.phoneColumnName, headers);
    if (hit) phoneColumn = hit;
    else errors.push({ field: '수신자 열 이름', error: `요청서에 적으신 수신자 열 "${form.phoneColumnName}"이 명단에 없습니다. 명단의 열 이름과 같게 적어 주세요.` });
  } else {
    phoneColumn = pickPhoneColumn(headers, rows);
    if (rows.length > 0 && !phoneColumn) {
      errors.push({ field: '명단', error: '휴대폰 번호 열을 찾지 못했습니다. 확인 화면에서 수신자 열을 직접 골라 주세요.' });
    }
  }

  // 확인 화면 조정값 반영(시각·회신번호·담당자).
  // ⛔ 값이 "있으면" 그것이 전부다 — 빈 문자열·빈 배열도 의도다(★Codex 적대 1R: 화면에서 지웠는데
  //   요청서 원값으로 조용히 복귀하면, 보이는 것과 다른 값으로 접수된다). fail-closed = 반려.
  const hasRequestedAtOverride = Object.prototype.hasOwnProperty.call(overrides, 'requestedAt');
  const requestedAt = hasRequestedAtOverride
    ? (overrides.requestedAt ? new Date(overrides.requestedAt) : null)
    : form.requestedAt;
  const requestedAtIso = requestedAt && !Number.isNaN(requestedAt.getTime()) ? requestedAt.toISOString() : null;
  if (hasRequestedAtOverride && !requestedAtIso) errors.push({ field: '보낼 시각', error: '보낼 시각을 정해 주세요.' });
  const hasManagerOverride = Array.isArray(overrides.managerPhones);
  const managerPhones = (hasManagerOverride ? overrides.managerPhones! : form.managerPhones)
    .map((p) => normalizeAgencyPhone(p)).filter((p) => p.length >= 10).slice(0, MAX_MANAGER_PHONES);
  if (managerPhones.length === 0 && !form.errors.find((e) => e.field === '담당자 번호')) {
    errors.push({ field: '담당자 번호', error: '테스트 문자를 받을 담당자 번호가 없습니다.' });
  }

  // ⛔ 회신번호 조정값도 유효하지 않으면 요청서 값으로 **폴백하지 않는다**(★2R)
  let callback: CallbackPlan;
  if (overrides.callback !== undefined) {
    if (overrides.callback?.mode === 'fixed' && overrides.callback.number) {
      callback = { mode: 'fixed', number: normalizePhone(String(overrides.callback.number)) };
    } else if (overrides.callback?.mode === 'column' && overrides.callback.column && headers.includes(overrides.callback.column)) {
      callback = { mode: 'column', column: overrides.callback.column };
    } else {
      callback = { mode: 'none' };
      errors.push({ field: '회신번호', error: '고르신 회신번호가 올바르지 않습니다. 다시 골라 주세요.' });
    }
  } else {
    callback = resolveCallbackPlan(form.callbackRaw, headers);
  }
  if (callback.mode === 'none' && form.callbackRaw) {
    errors.push({ field: '회신번호', error: `회신번호 칸의 "${form.callbackRaw}"를 번호로도 명단의 열 이름으로도 읽지 못했습니다.` });
  }

  // 문안 항목 ↔ 명단 열: 확인 화면 조정값 > 같은 이름(화면 접수와 같은 규칙 · CT 소유)
  const usedVars = extractAgencyVars(form.content);
  const varResolution = resolveVarColumns(usedVars, headers, overrides.varMapping);
  let varsMatched: OneStepAnalysis['varsMatched'] = varResolution.resolved;
  // 이름이 다른 항목은 **미리보기 초회 분석에서만** AI가 열을 추천해 미리 골라 둔다(★2026-08-25 §17-6).
  //   추천은 확정이 아니다 — 화면이 이 매핑을 조정값으로 다시 보내야 접수된다. 확정 경로는
  //   aiSuggest=false로 이 분기 자체가 닫혀 있다(옛 번들이 varMapping 없이 확정해도 재추론 불가).
  //   실패하면 추천 없이 진행한다(항목 반려가 남고 사용자가 직접 고른다 · 조용한 성공 위장 금지).
  if (aiSuggest && overrides.varMapping === undefined && rows.length > 0) {
    const unmatched = varsMatched.filter((v) => !v.column).map((v) => v.name);
    if (unmatched.length > 0) {
      try {
        const suggestions = await suggestVarColumnsWithAi({
          companyId: auth.companyId,
          vars: unmatched,
          columnNames: headers,
          sampleRows: rows.slice(0, 5).map((r) => headers.map((h) => r[h] ?? null)),
        });
        varsMatched = varsMatched.map((v) => {
          if (v.column) return v;
          const s = suggestions.find((x) => x.name === v.name);
          return s?.column ? { ...v, column: s.column, via: 'ai' as const } : v;
        });
      } catch (aiErr: any) {
        console.warn('[agency-send] 원스텝 문안 항목 AI 추천 실패(직접 선택으로 진행):', aiErr?.message || aiErr);
      }
    }
  }
  for (const vm of varsMatched) {
    // 조정값이 틀린 항목은 아래에서 그 사유로만 알린다(한 항목에 반려 두 줄 금지)
    if (!vm.column && !varResolution.badOverrides.includes(vm.name)) {
      errors.push({ field: '문안 항목', error: `문안의 %${vm.name}%에 맞는 열을 명단에서 찾지 못했습니다. 문안 항목 칸에서 골라 주세요.` });
    }
  }
  for (const name of varResolution.badOverrides) {
    errors.push({ field: '문안 항목', error: `%${name}%에 고르신 열이 명단에 없습니다. 다시 골라 주세요.` });
  }
  const varMappingColumns = varsMatched.filter((v) => v.column);

  // 수신자 정리 + 집계(서버가 다 세고, 화면에는 숫자와 상위 50만 보낸다)
  const seen = new Set<string>();
  let dup = 0; let invalid = 0; let callbackMissing = 0;
  const groupMap = new Map<string, Array<{ phone: string; vars: Record<string, any> }>>();
  let groupsOverflow = false;
  const sample: Array<{ phone: string; callback?: string }> = [];
  const ONLY_DIGITS = (s: any) => String(s ?? '').replace(/[^0-9]/g, '');
  if (phoneColumn) {
    for (const r of rows) {
      // 0 유실 복원 포함(★0826 §18-4)
      const phone = normalizeAgencyPhone(r[phoneColumn]);
      if (!phone || phone.length < 10) { invalid++; continue; }
      if (seen.has(phone)) { dup++; continue; }
      let groupKey = callback.mode === 'fixed' ? callback.number : '';
      if (callback.mode === 'column') {
        const cb = normalizeAgencyPhone(r[callback.column]);
        if (!cb || cb.length < 8) { callbackMissing++; continue; }
        groupKey = cb;
        // ⛔ 21종째가 나타나는 즉시 멈춘다(★2R) — 잘못 매핑된 열 하나가 수만 그룹을 만들며
        //   자원(그룹 축적·등록 조회)을 태우는 것을 그룹 생성 단계에서 끊는다
        if (!groupMap.has(groupKey) && groupMap.size >= MAX_CALLBACK_GROUPS + 1) { groupsOverflow = true; continue; }
      }
      seen.add(phone);
      const vars: Record<string, any> = {};
      for (const vm of varMappingColumns) {
        if (r[vm.column!] !== undefined && r[vm.column!] !== null) vars[vm.name] = r[vm.column!];
      }
      if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
      groupMap.get(groupKey)!.push({ phone, vars });
      if (sample.length < 50) sample.push({ phone, ...(callback.mode === 'column' ? { callback: groupKey } : {}) });
    }
  }
  const valid = [...groupMap.values()].reduce((a, g) => a + g.length, 0);
  if (rows.length > 0 && valid === 0 && errors.length === 0) {
    errors.push({ field: '명단', error: '보낼 수 있는 번호가 없습니다.' });
  }

  // 회신번호 그룹(열 방식이면 접수가 이 수만큼 나뉜다) + 등록 여부.
  //   등록 검증은 **집합 1회 조회**로 한다(★2R — 그룹마다 조회하면 열 오지정 한 번에 수만 조회가 된다)
  const groups: OneStepGroup[] = [];
  const overLimit = groupsOverflow || groupMap.size > MAX_CALLBACK_GROUPS;
  const registeredSet = overLimit ? new Set<string>() : await getRegisteredCallbackSet(auth.companyId, auth.userId);
  for (const [cb, recipients] of groupMap) {
    if (!cb) continue;
    groups.push({ callback: cb, count: recipients.length, registered: overLimit ? false : registeredSet.has(cb), recipients });
    if (recipients.length > MAX_RECIPIENTS) {
      errors.push({ field: '명단', error: `회신번호 ${cb} 건이 ${recipients.length.toLocaleString()}명입니다. 한 접수는 ${MAX_RECIPIENTS.toLocaleString()}명까지라 명단을 나눠 주세요.` });
    }
  }
  groups.sort((a, b) => b.count - a.count);
  if (overLimit) {
    errors.push({ field: '회신번호', error: `회신번호가 ${MAX_CALLBACK_GROUPS}종을 넘습니다. 접수가 그만큼 나뉘어 승인이 어렵습니다. 회신번호 열이 맞는지 확인하시고, 맞다면 ${MAX_CALLBACK_GROUPS}종 이하로 나눠 주세요.` });
  }
  const unregistered = overLimit ? [] : groups.filter((g) => !g.registered);
  if (unregistered.length > 0) {
    errors.push({
      field: '회신번호',
      error: `등록되지 않은 회신번호가 있습니다: ${unregistered.map((g) => g.callback).join(', ')}. 발신번호 등록을 먼저 해 주세요.`,
    });
  }
  if (callback.mode === 'fixed' && groups.length === 0 && valid > 0) {
    // fixed인데 그룹이 안 만들어진 경우는 없다(키 = 번호). 방어적 분기일 뿐이다.
    errors.push({ field: '회신번호', error: '회신번호를 확인해 주세요.' });
  }

  // 발송 시각(리드타임 + 발송 허용 시간) 사전 검증 — 확정에서 또 검증되지만 확인 화면에서 먼저 알린다
  if (requestedAtIso) {
    const when = validateRequestedAt(requestedAtIso, new Date(), await loadSendWindow(auth.companyId, form.isAd), minLeadMinutes);
    if (!when.valid) errors.push({ field: '보낼 시각', error: when.error || '보낼 시각을 확인해 주세요.' });
  }

  const images = Array.isArray(overrides.mmsImagePaths) ? overrides.mmsImagePaths : [];
  const messageType: 'SMS' | 'LMS' | 'MMS' = images.length > 0
    ? 'MMS' : (form.content.length > 45 || form.subject.trim() ? 'LMS' : 'SMS');

  return {
    subject: form.subject, content: form.content, isAd: form.isAd, requestedAtIso,
    managerPhones, callback, headers, phoneColumn, varsMatched,
    counts: { total: rows.length, valid, dup, invalid, callbackMissing },
    groups, sample,
    sampleRows: rows.slice(0, 50).map((r) => headers.map((h) => r[h] ?? null)),
    messageType, fileName: listName, errors,
  };
}
