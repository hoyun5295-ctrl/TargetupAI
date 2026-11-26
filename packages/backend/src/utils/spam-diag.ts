/**
 * spam-diag.ts — 스팸 검사 「막힌 부분 짚어 보기」의 읽기 · 자격 · 판 만들기 · 등록 · 닫기 · 정본 문구 CT
 *   (★2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §5 · §6-2-2
 *    ★2026-11-26 C164 재작성 · 설계서 docs/2026-11-25-spam-diag-rewrite-design.md — 확인 판 = 「뺀 글」이 아니라 「목적(주소 · 혜택)을 지킨 채 바꾼 글」)
 *
 * 순수 판단 = spam-block-hint.ts(조각 · 의심 순서 · 고칠 줄 · 판 상태 · 받기) · 발송 관문 = spam-diag-gate.ts · 주소 바꾸기 = spam-link-swap.ts.
 * 이 파일 = DB 를 읽어 그 순수 함수에 넣고, 판 글을 만들고(표현 = AI · 주소 = 짧은 주소), 판을 등록(enqueueSpamTest)하고, 진단을 닫는다.
 *   판 = 출처 spam_diag · diag_of = 부모 검사 · variant_id = R1 ~ R3(보낸 순) · 결과 행 = 그때 막힘인 통신사마다 · 계획 = diag_plan(소유 · 종류 · 원문 · 고칠 줄 · 바꿈 목록 · 주소 · 닫힘 · 끝).
 *   옛 판(K1 · L2 … = 빼기 판)은 이 파일이 읽지 않는다.
 *
 * ⛔ spam-test-queue 는 이 파일을 import 하지 않는다(이 파일이 spam-test-queue 를 import 한다 · 순환 0).
 * ⛔ diag_of · diag_plan 칸이 없으면(DDL 전) 판 읽기 · 닫기는 「판 없음」으로 접는다(A 는 그대로 · 화면 깨짐 0).
 *   칸 유무는 문장을 던지기 전에 information_schema 로 본다(트랜잭션 안에서 42703 으로 트랜잭션을 깨지 않게 · hasAgencyColumn CT).
 */
import pool, { query } from '../config/database';
import { SPAM_DIAG_SOURCE, spamCustomerTestSql, isAutoSpamSource, notAutoSpamSourceSql } from './spam-trial';
import { enqueueSpamTest, isRenderedSample } from './spam-test-queue';
import { loadActiveRules, evaluateContent } from './spam-block';
import { KST_TODAY_START_SQL } from './stats-aggregation';
import { hasAgencyColumn } from './agency-send-intake';
import { sendSystemAlert } from './system-alert';
import { getCarrierLabel } from './sms-result-map';
import {
  tokenizeSpamText, rankSuspects, editableLines, plateFixes, classifyRewrite, applySpamFixes, isRewordable, hasValueSlot, REWRITE_MAX_PLATES,
  type Suspect, type DiagCheckState, type PlateKind, type PlateState, type EditableLine, type SpamFix, type RewriteStep,
} from './spam-block-hint';
import { diagEnabledFor, diagCallbackAllowed, DIAG_LOCK_SQL, diagLockKey } from './spam-diag-gate';
import { swappableUrls, swapUrlsInPlate, type SwappedUrl } from './spam-link-swap';
import { refineForSpam } from './agency-send-refine';
import { prepareFieldMappings, getOpt080Number, prepareSendMessage, buildAdMessage, AD_REJECT_FOOTER_RE } from './messageUtils';

type SqlRun = (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
/**
 * 원문(변수 칸 그대로인 글)을 그 검사의 첫 수신자 기준 실물 글로 조립하는 함수(재료는 미리 읽어 둔다 · 부를 때 읽기 0 · 못 만들면 null).
 *   ★ Codex 구현 1R · 2R · 3R 같은 부류 세 번 = 구조 답 — 보낸 글의 어느 줄이 원문의 어느 줄에서 나왔는지를 글자 · 자리로 **추정하지 않는다**.
 *   실제 발송이 쓰는 조립기(prepareSendMessage)로 ① 원문을 조립하면 검사한 글이 글자 그대로 나오는가 ② 바꿈을 넣은 원문을 조립하면 판 글과 글자 그대로 같은가 를 본다.
 *   어떤 식으로 줄이 어긋나도(값 속 줄바꿈 · 광고 표기 · 값이 다른 줄과 같은 글자 · 법정 표기를 건드린 다듬기) ② 가 다르면 그 판은 버려진다 = 검사한 판 = 고객이 받아서 보낼 글.
 */
export type TemplateRender = (templateBody: string) => string | null;

/** 하루 상한 — 발신번호(숫자만)마다 · 전체(설계서 §5-3 · 셈 = 판 행 수) */
export const DIAG_DAILY_CAP_PER_CALLBACK = 10;
export const DIAG_DAILY_CAP_TOTAL = 100;
/** 표현 판 AI 호출의 원가 기록 이름(과금 0 · CREDIT_COST_MAP 미등록) */
export const SPAM_REWRITE_AI_SOURCE = 'spam-diag-rewrite';
const VAR_SLOT_RE = /%[^%\s]+%/;

/** 칸이 없을 때(DDL 전)의 오류인가 — db_alter_safety_net 과 같은 판정 */
export function isDiagColumnMissing(err: any): boolean {
  const m = String(err?.message || '');
  return err?.code === '42703' || (m.includes('column') && m.includes('does not exist'));
}

/** diag_of 칸이 있는가(있음 = 캐시 · 없음 = 5분 뒤 다시 · 조회 실패 = 던짐) — 문장을 던지기 전에 본다 */
export function hasDiagColumn(run: SqlRun = query): Promise<boolean> {
  return hasAgencyColumn({ query: run }, 'diag_of', 'spam_filter_tests');
}
/** ★ 1126 C164 DDL-5 — diag_plan 칸이 있는가(같은 규칙) */
export function hasPlanColumn(run: SqlRun = query): Promise<boolean> {
  return hasAgencyColumn({ query: run }, 'diag_plan', 'spam_filter_tests');
}

export interface DiagParent {
  id: string; companyId: string; userId: string; callback: string; source: string | null; diagOf: string | null;
  subject: string | null; status: string; firstRecipient: unknown; messageType: 'SMS' | 'LMS';
  storedText: string; createdAt: string;
  carriers: Array<{ carrier: string; result: string | null }>;
}

/** 부모 검사 한 건 + 결과 행 — diag_of 는 to_jsonb 로만 읽는다(DDL 전에도 문장 무결) */
export async function readDiagParent(testId: string, run: SqlRun = query): Promise<DiagParent | null> {
  const t = await run(
    `SELECT t.id, t.company_id, t.user_id, t.callback_number, t.source, t.subject, t.status, t.first_recipient,
            t.message_content_sms, t.message_content_lms, t.created_at, (to_jsonb(t) ->> 'diag_of') AS diag_of
       FROM spam_filter_tests t WHERE t.id = $1::uuid`,
    [testId],
  );
  const row = t.rows[0];
  if (!row) return null;
  const r = await run(`SELECT carrier, message_type, result FROM spam_filter_test_results WHERE test_id = $1::uuid ORDER BY carrier`, [testId]);
  const messageType: 'SMS' | 'LMS' = r.rows.some((x: any) => x.message_type === 'LMS' || x.message_type === 'MMS') ? 'LMS' : 'SMS';
  return {
    id: String(row.id), companyId: String(row.company_id), userId: String(row.user_id), callback: String(row.callback_number || ''),
    source: row.source ?? null, diagOf: row.diag_of ? String(row.diag_of) : null, subject: row.subject ?? null, status: String(row.status),
    firstRecipient: row.first_recipient, messageType,
    storedText: String((messageType === 'LMS' ? row.message_content_lms : row.message_content_sms) || ''),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    carriers: r.rows.map((x: any) => ({ carrier: String(x.carrier), result: x.result ?? null })),
  };
}

/**
 * 보낸 글(§5-1) — 렌더 끝난 검사는 저장 글 · 렌더 안 된 검사는 변수 칸이 없을 때만 저장 원문(치환해도 같은 글).
 *   변수 칸이 있으면 보낸 글을 복원할 수 없다 → sendable = false(A 는 원문으로만 · 판 없음).
 */
export function diagSentText(p: Pick<DiagParent, 'storedText' | 'firstRecipient'>): { sentText: string; sendable: boolean } {
  if (isRenderedSample(p.firstRecipient)) return { sentText: p.storedText, sendable: true };
  return { sentText: p.storedText, sendable: !VAR_SLOT_RE.test(p.storedText) };
}

function stateOf(status: string, result: string | null): DiagCheckState {
  if (result === 'pass') return 'arrived';
  if (result === 'blocked') return 'blocked';
  if (result === 'unconfirmed') return 'checking';
  if (result === null) return status === 'queued' ? 'queued' : status === 'active' ? 'checking' : 'unknown';
  return 'unknown';
}

/**
 * 발송 조립기가 그 글의 맨 앞을 광고 머리말로 인정하는가 — 조립기에 묻는다(식을 여기 따로 두지 않는다 = 조립기가 인정하는 꼴이 바뀌면 함께 바뀐다).
 *   수신거부 줄을 붙여 조립기의 꼬리말 갈래를 끄고, 머리말을 더 붙이는지만 본다.
 */
const hasAdHead = (text: string): boolean => { const t = `${text}\n무료거부`; return buildAdMessage(t, 'SMS', true, '') === t; };

/** 발송 조립기가 법정 줄로 인정하는 줄(★ Codex 구현 3R) — 광고 머리말 · 수신거부 꼬리말(조립기의 그 식). 이런 줄은 고칠 줄에서 뺀다(AI 로 가지 않는다). */
export const assemblerLegalLine = (line: string): boolean => AD_REJECT_FOOTER_RE.test(line) || hasAdHead(line);

/**
 * 판 글이 검사한 글의 법정 표기를 지키는가(★ Codex 구현 4R) — **글 전체**로 조립기가 보는 그대로(머리말 인정 여부 · 꼬리말 인정 여부가 같아야 한다).
 *   줄마다 보는 판정(assemblerLegalLine)은 한 줄 안의 표기만 본다 → 줄을 넘는 표기(「(광고」 줄바꿈 「)」 · 「무료」 줄바꿈 「수신 거부」)가 깨진 판은 이 대조가 버린다.
 */
const keepsLegalMarks = (sent: string, plate: string): boolean => hasAdHead(sent) === hasAdHead(plate) && AD_REJECT_FOOTER_RE.test(sent) === AD_REJECT_FOOTER_RE.test(plate);

// ─────────────── 판 읽기 ───────────────

/**
 * 화면 소유 검사의 조립 함수 — 발송과 같은 조립기로 원문을 조립한다. 재료는 그 검사 행이 가진 것뿐이다(화면에서 받지 않는다):
 *   첫 수신자 값 = 검사가 저장한 first_recipient · 광고 표기 = 켬 / 끔 둘 다 · 꼴 = 직접발송(명단 칸 = 이름 · 기타1 ~ 3 · 회신번호) / 타겟 발송(고객 표본 행).
 *   이 조합 중 **원문을 조립했을 때 검사한 글이 글자 그대로 나오는 것**만 쓴다. 어느 것으로도 안 나오면 조립을 믿을 수 없다 = 늘 null(고칠 줄 없음으로 닫힌다).
 *   둘 이상이 맞으면 어느 것이 그 화면의 조립인지 알 수 없다 → 맞는 조합 **전부가 같은 글을 낼 때만** 그 글(하나라도 다르면 null = 그 판은 버린다 · ★ Codex 구현 4R).
 */
export async function screenRenderer(h: Pick<SpamBlockHints, 'parent' | 'sentText'>, templateBody: string): Promise<TemplateRender> {
  const p = h.parent;
  const raw = p.firstRecipient;
  const fr = raw && typeof raw === 'object' && !Array.isArray(raw) && !isRenderedSample(raw) ? raw as Record<string, any> : null;
  const mappings = await prepareFieldMappings(p.companyId);
  const opt080 = await getOpt080Number(p.userId, p.companyId);
  const shapes: TemplateRender[] = [false, true].flatMap((isAd): TemplateRender[] => [
    (body) => prepareSendMessage(body, null, {}, {
      msgType: p.messageType, isAd, opt080Number: opt080, subject: '', skipNumberFormatting: true,
      addressBookFields: { name: fr?.name, extra1: fr?.extra1, extra2: fr?.extra2, extra3: fr?.extra3, callback: fr?.callback || p.callback },
    }).message,
    (body) => prepareSendMessage(body, fr, mappings, { msgType: p.messageType, isAd, opt080Number: opt080, subject: '' }).message,
  ]);
  const safe = (fn: TemplateRender): TemplateRender => (body) => { try { return fn(body); } catch { return null; } };
  const fits = shapes.map(safe).filter((fn) => fn(templateBody) === h.sentText);
  return (body) => { const outs = fits.map((fn) => fn(body)); return outs.length > 0 && outs.every((o) => o === outs[0]) ? outs[0] : null; };
}

/** 판 계획(diag_plan · 설계서 §11) — 판 행에만 쓴다 */
export interface DiagPlan {
  v: 1; owner: 'screen' | 'agency'; kind: PlateKind;
  /** 원문(변수 칸 그대로) — 직접발송 = 찾기를 누를 때의 작성 칸 글 · 제목 / 대행 = 그 문안 버전의 글 */
  template: { body: string; subject: string | null };
  editable: EditableLine[]; targets: string[]; fixes: SpamFix[]; urls: SwappedUrl[];
  closed?: boolean; ended?: { reason: string; at: string };
  /** 대행 판만 — 진단 대기 되찾기(§8) */
  agency?: { requestId: string; version: number; rounds: number };
}
export interface Plate {
  testId: string; n: number; userId: string; plan: DiagPlan; text: string; subject: string | null; createdAt: string;
  results: Array<{ carrier: string; state: DiagCheckState }>;
}

/** 이 부모의 판(R1 ~ R3 · 보낸 순) — 칸이 없으면 빈 목록 · 계획이 없는 행(옛 꼴)은 판이 아니다 */
export async function readPlates(parentTestId: string, run: SqlRun = query): Promise<Plate[]> {
  if (!(await hasDiagColumn(run)) || !(await hasPlanColumn(run))) return [];
  const res = await run(
    `SELECT t.id, t.user_id, t.variant_id, t.status, t.subject, t.message_content_sms, t.message_content_lms, t.created_at, t.diag_plan, r.carrier, r.result
       FROM spam_filter_tests t LEFT JOIN spam_filter_test_results r ON r.test_id = t.id
      WHERE t.diag_of = $1::uuid AND t.source = '${SPAM_DIAG_SOURCE}' AND t.variant_id ~ '^R[1-3]$' AND t.diag_plan IS NOT NULL
      ORDER BY t.variant_id, r.carrier`,
    [parentTestId],
  );
  const byId = new Map<string, Plate>();
  for (const x of res.rows as any[]) {
    let p = byId.get(String(x.id));
    if (!p) {
      p = {
        testId: String(x.id), n: Number(String(x.variant_id).slice(1)), userId: String(x.user_id), plan: x.diag_plan as DiagPlan,
        text: String(x.message_content_lms || x.message_content_sms || ''), subject: x.subject ?? null,
        createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : String(x.created_at), results: [],
      };
      byId.set(p.testId, p);
    }
    if (x.carrier) p.results.push({ carrier: String(x.carrier), state: stateOf(String(x.status), x.result ?? null) });
  }
  return [...byId.values()].sort((a, b) => a.n - b.n);
}

/** 판 목록 → 순수 판정에 넣는 꼴 */
export const plateStatesOf = (plates: ReadonlyArray<Plate>): PlateState[] =>
  plates.map((p) => ({ kind: p.plan.kind, results: p.results, closed: !!p.plan.closed, ended: p.plan.ended ?? null }));

/** 그 판이 이 진단 주인의 것인가 — 소유가 같고, 대행이면 같은 접수 · 같은 문안 버전(같은 검사를 두 접수가 이어 봐도 서로의 판을 자기 것으로 보지 않는다) */
function samePlateOwner(plan: DiagPlan, owner: 'screen' | 'agency', agency?: { requestId: string; version: number }): boolean {
  if (plan.owner !== owner) return false;
  return owner !== 'agency' || (!!agency && plan.agency?.requestId === agency.requestId && Number(plan.agency?.version) === Number(agency.version));
}

/** 앞 판들이 만든 짧은 주소(같은 원래 주소는 한 번 · §7) */
const knownUrls = (plates: ReadonlyArray<Plate>): SwappedUrl[] => {
  const out: SwappedUrl[] = [];
  for (const p of plates) for (const u of p.plan.urls || []) if (!out.some((k) => k.from === u.from)) out.push(u);
  return out;
};

// ─────────────── A(의심 부분) + 판 ───────────────

/** 그 통신사의 의심 조각(A · 앞 설계서 §5 그대로) */
export interface DiagCarrierHint { carrier: string; suspects: Suspect[]; baseline: { at: string } | null }
export type SpamBlockHints = { parent: DiagParent; sentText: string; sendable: boolean; carriers: DiagCarrierHint[]; plates: Plate[] };

/**
 * A 를 그 부모 검사에 대해 조립(앞 설계서 §5) + 판 목록 — 막힌 통신사마다. 막힌 통신사가 없거나 부모가 판이면 null.
 *   templateText = 원문(대행 = 그 문안 버전의 글 · 직접발송 = 판이 있으면 판에 저장한 원문 · 없으면 저장 글).
 */
export async function buildSpamBlockHints(testId: string, opts: { templateText?: string } = {}, run: SqlRun = query): Promise<SpamBlockHints | null> {
  const parent = await readDiagParent(testId, run);
  if (!parent || parent.source === SPAM_DIAG_SOURCE || parent.diagOf) return null;
  const blocked = parent.carriers.filter((c) => c.result === 'blocked').map((c) => c.carrier);
  if (blocked.length === 0) return null;
  const { sentText, sendable } = diagSentText(parent);
  const plates = await readPlates(parent.id, run);
  const templateText = opts.templateText ?? plates[0]?.plan.template.body ?? parent.storedText;
  const cb = parent.callback.replace(/\D/g, '');
  const textCol = parent.messageType === 'LMS' ? 't.message_content_lms' : 't.message_content_sms';
  const near = await run(
    `SELECT r.carrier, r.result, ${textCol} AS body, t.created_at, (t.created_at >= ${KST_TODAY_START_SQL}) AS today
       FROM spam_filter_tests t JOIN spam_filter_test_results r ON r.test_id = t.id
      WHERE t.company_id = $1::uuid AND REPLACE(t.callback_number, '-', '') = $2 AND r.carrier = ANY($3::text[])
        AND r.message_type = $4 AND t.subject IS NOT DISTINCT FROM $5 AND t.id <> $6::uuid
        AND r.result IN ('pass', 'blocked') AND t.created_at > NOW() - INTERVAL '90 days'
        AND COALESCE(${textCol}, '') <> '' AND ${spamCustomerTestSql('t')}
      ORDER BY t.created_at DESC LIMIT 200`,
    [parent.companyId, cb, blocked, parent.messageType, parent.subject, parent.id],
  );
  let ruleTokens: string[] = [];
  try {
    const rules = await loadActiveRules();
    const hitIds = new Set(evaluateContent(sentText, rules, parent.companyId).hits.map((h) => h.ruleId));
    ruleTokens = rules.filter((r) => hitIds.has(r.id)).flatMap((r) => r.elements.filter((e) => e.type !== 'phone').map((e) => e.value));
  } catch { ruleTokens = []; }
  const carriers: DiagCarrierHint[] = blocked.map((carrier) => {
    const rows = (near.rows as any[]).filter((x) => String(x.carrier) === carrier);
    const ranked = rankSuspects({
      sentText, templateText,
      passedTexts: rows.filter((x) => x.result === 'pass').map((x) => ({ text: String(x.body), at: x.created_at instanceof Date ? x.created_at.toISOString() : String(x.created_at) })),
      blockedSiblings: rows.filter((x) => x.result === 'blocked' && x.today).map((x) => String(x.body)),
      ruleTokens,
    });
    return { carrier, suspects: ranked.suspects, baseline: ranked.baseline };
  });
  return { parent, sentText, sendable, carriers, plates };
}

// ─────────────── 자격 · 지금 단계 ───────────────

export type DiagIneligible = 'off' | 'diag_parent' | 'not_blocked' | 'not_sendable' | 'no_editable' | 'no_variant' | 'permission' | 'cap' | 'owned' | 'closed';
/** 판을 못 만든 사유 — 자격 사유 + url(주소를 못 바꿈) · no_plate(바꾼 글을 못 만듦) · error */
export type RewriteFail = DiagIneligible | 'url' | 'no_plate' | 'error';

/** 사유의 화면 문장(설계서 §10-2 정본 문구 · 화면 · 단추 응답이 같은 문장) */
export function diagReasonText(reason: RewriteFail | null | undefined): string {
  if (reason === 'permission') return '이 발신번호로는 다시 확인할 수 없어요.';
  if (reason === 'cap') return '오늘은 더 확인할 수 없어요. 내일 다시 해 주세요.';
  if (reason === 'no_editable') return '이 글은 바꿔 볼 줄이 없어요.';
  if (reason === 'url') return '주소는 바꾸지 못했어요.';
  return '지금은 다시 확인할 수 없어요.';
}

/**
 * 지금 단계(§5 · 순수 판단에 넣을 값을 모은다) — 원문 · 고칠 줄은 첫 판에 저장한 것(다음 판 · 받기가 같은 원문) · 판이 없으면 넘겨받은 원문.
 *   소유 = 판이 있으면 그 판의 소유.
 */
export function rewriteStepOf(h: SpamBlockHints, owner: 'screen' | 'agency', template?: { body: string; subject: string | null }): {
  step: RewriteStep; owner: 'screen' | 'agency'; editable: EditableLine[]; hasUrl: boolean; template: { body: string; subject: string | null } | null;
} {
  const first = h.plates[0];
  const tpl = first ? first.plan.template : template ?? null;
  const editable = first ? first.plan.editable : tpl ? editableLines(h.sentText, tpl.body, assemblerLegalLine) : [];
  const own = first ? first.plan.owner : owner;
  const hasUrl = swappableUrls(h.sentText, editable).length > 0;
  return { step: classifyRewrite({ plates: plateStatesOf(h.plates), owner: own, hasUrl }), owner: own, editable, hasUrl, template: tpl };
}

/**
 * 판을 만들 자격(설계서 §4 F3) — 상한은 등록 트랜잭션이 잠금 아래에서 센다 · 소유 · 닫힘은 등록 잠금 아래에서 한 번 더 본다.
 *   actorUserId = 판 행의 user_id 로 고정될 등록 계정(직접발송 = 누른 사용자 · 대행 = 접수 계정).
 */
export async function rewriteEligibility(i: { hint: SpamBlockHints; owner: 'screen' | 'agency'; actorUserId: string }): Promise<{ ok: true } | { ok: false; reason: DiagIneligible }> {
  const { parent, sendable, carriers, plates } = i.hint;
  // ★ 2026-11-24 회사 스위치(슈퍼관리자 · companies.spam_diag_enabled · 조회 실패 = 꺼짐)
  if (!(await diagEnabledFor(parent.companyId))) return { ok: false, reason: 'off' };
  if (parent.source === SPAM_DIAG_SOURCE || parent.diagOf) return { ok: false, reason: 'diag_parent' };
  if (carriers.length === 0 || parent.status !== 'completed') return { ok: false, reason: 'not_blocked' };
  if (!sendable) return { ok: false, reason: 'not_sendable' };
  if (plates.some((p) => p.plan.closed)) return { ok: false, reason: 'closed' };
  if (plates.some((p) => p.plan.owner !== i.owner)) return { ok: false, reason: 'owned' };
  if (!(await diagCallbackAllowed(parent.companyId, i.actorUserId, parent.callback))) return { ok: false, reason: 'permission' };
  return { ok: true };
}

// ─────────────── 판 글 만들기(AI · 잠금 밖) ───────────────

/** 다른 말로 바꿔 달라고 할 표현(§6-2) — A 의 의심 조각 중 숫자 · 주소가 아닌 것 · 고칠 줄에 있는 것만 */
function avoidTokens(h: SpamBlockHints, editable: ReadonlyArray<EditableLine>): string[] {
  const lines = new Set(editable.map((e) => e.sentLine));
  const inEditable = new Set(tokenizeSpamText(h.sentText).tokens.filter((t) => lines.has(t.line)).map((t) => t.token));
  const sus = h.carriers.flatMap((c) => c.suspects.filter((s) => !s.demoted && (s.kind === 'new_vs_passed' || s.kind === 'rule')).map((s) => s.token));
  return [...new Set(sus)].filter((t) => isRewordable(t) && inEditable.has(t));
}

/**
 * 그 종류의 판 글(§5-1 · §6-2) — 못 만들면 null.
 *   w1 · w2 = AI 가 고칠 줄만 다시 쓴 글(검사 = 글 전체 · 숫자 · 날짜 · 주소가 사라지거나 생기면 버림) · w2 는 화면 소유일 때 고칠 수 있는 제목도.
 *   w1u · w2u = 앞의 그 본문 그대로(주소는 등록 트랜잭션이 바꾼다). swap = 등록 때 주소를 짧은 주소로(주소 판 · 앞에서 이미 바꾼 주소를 이어 쓰는 w2).
 */
async function buildPlate(i: { hint: SpamBlockHints; owner: 'screen' | 'agency'; kind: PlateKind; editable: EditableLine[]; template: { body: string; subject: string | null } }): Promise<{ text: string; subject: string | null; swap: boolean } | null> {
  const h = i.hint;
  const p = h.parent;
  if (i.kind === 'w1u' || i.kind === 'w2u') {
    const base = [...h.plates].reverse().find((x) => x.plan.kind === (i.kind === 'w1u' ? 'w1' : 'w2'));
    return base ? { text: base.text, subject: base.subject, swap: true } : null;
  }
  const r = await refineForSpam({
    companyId: p.companyId, original: h.sentText, round: i.kind === 'w1' ? 1 : 2,
    editable: i.editable.map((e) => e.sentLine), avoid: avoidTokens(h, i.editable), source: SPAM_REWRITE_AI_SOURCE,
  });
  if (!r.ok || !r.content) return null;
  let subject = p.subject;
  // 제목(w2 · 화면 소유만) — 원문 제목이 보낸 제목에 글자 그대로이고 수신자 값 자리가 없을 때만 한 줄 · 실패면 그대로(대행은 제목을 바꾸지 않는다)
  if (i.kind === 'w2' && i.owner === 'screen' && p.subject && p.subject.trim() && i.template.subject === p.subject && !hasValueSlot(p.subject) && !p.subject.includes('\n')) {
    const s = await refineForSpam({ companyId: p.companyId, original: p.subject, round: 2, editable: [0], source: SPAM_REWRITE_AI_SOURCE });
    if (s.ok && s.content && !s.content.includes('\n')) subject = s.content;
  }
  return { text: r.content, subject, swap: knownUrls(h.plates).length > 0 };
}

// ─────────────── 등록 ───────────────

/**
 * 판 등록(§5-2 · §7 · §8) — 판 글(text)을 그때 막힘인 통신사 전부로 한 판.
 *   등록 트랜잭션의 부모 진단 잠금 아래에서 다시 본다: 닫힘 · 다른 소유 · 그 사이 판이 더 생김 · 직전 판 상태가 이 종류를 아직 허용하는가 · 부르는 쪽 조건(guard).
 *   swap = INSERT 직전 같은 연결로 고칠 줄의 주소를 짧은 주소로(못 바꾸면 등록 0 = url · 되돌림으로 만든 링크도 사라진다).
 *   고칠 줄에서 바뀐 곳이 없으면 그 종류는 못 만든 것(no_variant).
 */
export async function registerPlate(i: {
  hint: SpamBlockHints; owner: 'screen' | 'agency'; kind: PlateKind; actorUserId: string;
  template: { body: string; subject: string | null }; editable: EditableLine[];
  text: string; subject: string | null; swap: boolean;
  /** 원문 조립 함수(읽기 0 · 잠금 안에서도 부른다) */
  render: TemplateRender;
  agency?: { requestId: string; version: number; rounds: number };
  guard?: (run: SqlRun) => Promise<boolean>;
}): Promise<{ ok: true; testId: string; reused: boolean } | { ok: false; reason: RewriteFail }> {
  const h = i.hint;
  const p = h.parent;
  const n = h.plates.length + 1;
  if (n > REWRITE_MAX_PLATES) return { ok: false, reason: 'no_variant' };
  const hasUrl = swappableUrls(h.sentText, i.editable).length > 0;
  const known = knownUrls(h.plates);
  const subjectFix: SpamFix[] = i.subject !== p.subject && i.template.subject !== null && i.subject !== null
    ? [{ field: 'subject', tplLine: 0, before: i.template.subject, after: i.subject, kind: 'text' }] : [];
  const bodyFixes = i.swap ? [] : plateFixes(h.sentText, i.text, i.editable, []);
  if (!bodyFixes) return { ok: false, reason: 'no_plate' };
  // 조립 관문 ② — 바꿈을 넣은 원문을 조립한 글이 이 판 글과 글자 그대로 같을 때만(다르면 검사할 판과 고객이 받아서 보낼 글이 다르다 = 버린다) · 판 글은 검사한 글의 법정 표기를 지켜야 한다
  const rendersTo = (fixes: ReadonlyArray<SpamFix>, plateText: string): boolean => {
    const tpl = { body: i.template.body, subject: null };
    const fixed = applySpamFixes(tpl, tpl, fixes.filter((f) => f.field === 'body'));
    return fixed.ok && keepsLegalMarks(h.sentText, plateText) && i.render(fixed.body) === plateText;
  };
  if (!i.swap && !rendersTo(bodyFixes, i.text)) return { ok: false, reason: 'no_plate' };
  if (!i.swap && bodyFixes.length + subjectFix.length === 0) return { ok: false, reason: 'no_variant' };
  const plan: DiagPlan = {
    v: 1, owner: i.owner, kind: i.kind, template: i.template, editable: i.editable, targets: [],
    fixes: [...bodyFixes, ...subjectFix], urls: [], ...(i.agency ? { agency: i.agency } : {}),
  };
  let why: DiagIneligible = 'closed';
  const guard = async (run: SqlRun): Promise<boolean> => {
    const now = await readPlates(p.id, run);
    // 닫힘 · 소유 · 부르는 쪽 조건은 같은 번호의 판이 이미 있어도 먼저 본다(★ Codex 구현 1R — 화면과 대행이 첫 판을 함께 걸 때 늦은 쪽이 남의 판을 자기 것으로 받지 않게)
    if (now.some((x) => x.plan.closed)) { why = 'closed'; return false; }
    if (now.some((x) => !samePlateOwner(x.plan, i.owner, i.agency))) { why = 'owned'; return false; }
    if (i.guard && !(await i.guard(run))) { why = 'closed'; return false; }
    // 같은 판이 이미 있다(두 번 누름 · 일꾼 두 번) = 종류까지 같을 때만 등록의 「같은 판 찾기」가 그 판을 돌려준다
    const same = now.find((x) => x.n === n);
    if (same) { if (same.plan.kind === i.kind) return true; why = 'closed'; return false; }
    const step = classifyRewrite({ plates: plateStatesOf(now), owner: i.owner, hasUrl });
    const allowed = step.kind === 'next' ? step.candidates : step.kind === 'ask_url' ? step.options : [];
    if (now.length !== n - 1 || !allowed.includes(i.kind)) { why = 'closed'; return false; }
    return true;
  };
  const prepare = !i.swap ? undefined : async (run: SqlRun) => {
    // 새 링크 = 주소 판(고객이 [주소도 바꿔서 확인]을 누른 요청 · 대행의 주소 판)에서만 · 앞에서 바꾼 주소를 이어 쓰는 표현 판은 있는 링크만 쓴다(★ Codex 구현 1R)
    const swapped = await swapUrlsInPlate({ companyId: p.companyId, userId: i.actorUserId, text: i.text, editable: i.editable, known, create: i.kind === 'w1u' || i.kind === 'w2u', run: run as any });
    const fixes = swapped ? plateFixes(h.sentText, swapped.text, i.editable, swapped.urls) : null;
    if (!swapped || !fixes || !rendersTo(fixes, swapped.text)) return null;
    return { text: swapped.text, plan: { ...plan, urls: swapped.urls, fixes: [...fixes, ...subjectFix] } };
  };
  const out = await enqueueSpamTest({
    companyId: p.companyId, userId: i.actorUserId, callbackNumber: p.callback,
    ...(p.messageType === 'LMS' ? { messageContentLms: i.text } : { messageContentSms: i.text }),
    messageType: p.messageType, subject: i.subject || undefined,
    source: SPAM_DIAG_SOURCE, skipPrepaid: true, rendered: true, variantId: `R${n}`,
    diag: { parentTestId: p.id, carriers: h.carriers.map((c) => c.carrier), capPerCallback: DIAG_DAILY_CAP_PER_CALLBACK, capTotal: DIAG_DAILY_CAP_TOTAL, plan, guard, prepare },
  });
  if (out.ok && out.testId) return { ok: true, testId: out.testId, reused: !!out.reused };
  if (out.errorCode === 'DIAG_NOT_BLOCKED') return { ok: false, reason: 'not_blocked' };
  if (out.errorCode === 'DIAG_CLOSED') return { ok: false, reason: why };
  if (out.errorCode === 'DIAG_PREPARE') return { ok: false, reason: 'url' };
  if (out.errorCode === 'DIAG_CAP') {
    if (out.error === 'total') {
      // 전체 하루 상한 = 그날 판 0 + 운영 경보 1회(경보 CT 의 중복 키 = 한국 날짜)
      const kstDay = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
      void sendSystemAlert({
        dedupKey: `spam-diag-cap:${kstDay}`, companyId: null,
        message: `스팸 검사 확인 판이 오늘 전체 상한(${DIAG_DAILY_CAP_TOTAL}판)에 닿아 오늘은 더 만들지 않습니다.`,
      }).catch(() => undefined);
    }
    return { ok: false, reason: 'cap' };
  }
  if (out.errorCode === 'DB_MIGRATION_PENDING') throw Object.assign(new Error('column diag_plan does not exist'), { code: '42703' });
  return { ok: false, reason: 'error' };
}

/** 마지막 판에 「다음 판을 못 만들었다」를 적는다(§5-2 · 부모 진단 잠금 아래 · 다음 주기가 같은 AI 호출을 되풀이하지 않게) */
export async function markPlateEnded(parentTestId: string, plateTestId: string, reason: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(DIAG_LOCK_SQL, [diagLockKey(parentTestId)]);
    await client.query(
      `UPDATE spam_filter_tests SET diag_plan = jsonb_set(diag_plan, '{ended}', $3::jsonb)
        WHERE id = $1::uuid AND diag_of = $2::uuid AND source = '${SPAM_DIAG_SOURCE}' AND diag_plan IS NOT NULL AND NOT (diag_plan ? 'ended')`,
      [plateTestId, parentTestId, JSON.stringify({ reason, at: new Date().toISOString() })],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 후보 종류를 차례로 만들어 등록(§5-1 「못 만든 종류는 건너뛰고 다음 종류」) — 하나라도 등록되면 그 판.
 *   자격 · 상한 · 닫힘으로 막히면 다음 후보도 같으니 멈춘다. markEnded = 자동으로 이어 돌리는 길(일꾼 · 대행)은 못 만든 사유를 마지막 판에 적는다.
 */
export async function advanceRewrite(i: {
  hint: SpamBlockHints; owner: 'screen' | 'agency'; actorUserId: string; candidates: ReadonlyArray<PlateKind>;
  template: { body: string; subject: string | null }; editable: EditableLine[];
  /** 원문 조립 함수 */
  render: TemplateRender;
  agency?: { requestId: string; version: number; rounds: number };
  guard?: (run: SqlRun) => Promise<boolean>; markEnded?: boolean;
}): Promise<{ ok: true; testId: string; kind: PlateKind; reused: boolean } | { ok: false; reason: RewriteFail }> {
  let last: { ok: false; reason: RewriteFail } = { ok: false, reason: 'no_plate' };
  // 판 계획 칸(DDL-5)이 없으면 판을 만들 수 없다 → AI 를 부르기 전에 멈춘다(화면 입구 = 503 · 대행 = 지금처럼 다듬기)
  await requirePlanColumn();
  // 자격(스위치 · 부모 · 보낸 글 · 소유 · 닫힘 · 발신번호 권한) = 판을 만드는 길 전부가 지나는 이 한 곳
  const el = await rewriteEligibility({ hint: i.hint, owner: i.owner, actorUserId: i.actorUserId });
  if (!el.ok) last = el;
  // 조립 관문 ① — 원문을 조립하면 검사한 글이 글자 그대로 나와야 한다(아니면 이 원문 · 재료로는 판과 받기의 짝을 보장할 수 없다 = 고칠 줄 없음)
  const reproduces = el.ok && i.render(i.template.body) === i.hint.sentText;
  if (el.ok && !reproduces) last = { ok: false, reason: 'no_editable' };
  for (const kind of reproduces ? i.candidates : []) {
    const built = await buildPlate({ hint: i.hint, owner: i.owner, kind, editable: i.editable, template: i.template }).catch((e: any) => {
      console.warn(`[spam-diag] 판 글 만들기 실패 parent=${i.hint.parent.id} kind=${kind}:`, e?.message || e);
      return null;
    });
    if (!built) { last = { ok: false, reason: kind.endsWith('u') ? 'url' : 'no_plate' }; continue; }
    const r = await registerPlate({ hint: i.hint, owner: i.owner, kind, actorUserId: i.actorUserId, template: i.template, editable: i.editable, text: built.text, subject: built.subject, swap: built.swap, render: i.render, agency: i.agency, guard: i.guard });
    if (r.ok) return { ...r, kind };
    last = r;
    if (r.reason !== 'url' && r.reason !== 'no_variant' && r.reason !== 'no_plate') break;
  }
  const lastPlate = i.hint.plates[i.hint.plates.length - 1];
  if (i.markEnded && lastPlate) {
    await markPlateEnded(i.hint.parent.id, lastPlate.testId, last.reason).catch((e: any) => console.warn(`[spam-diag] 끝 사유 기록 실패 parent=${i.hint.parent.id}:`, e?.message || e));
  }
  return last;
}

// ─────────────── 화면 소유(직접발송) ───────────────

/** 받기 실패 문장(설계서 §10-2 정본 문구 · 화면은 그대로 쓴다) — 글이 바뀜 · 바꾼 글이 SMS 길이를 넘음(길이는 화면이 잰다) */
export const SPAM_FIX_TEXT = { changed: '글이 바뀌어 넣을 수 없어요. 지금 글로 다시 검사해 주세요.', smsTooLong: '바꾼 글이 SMS 길이를 넘어 넣을 수 없어요.' } as const;

/**
 * 이 사용자가 화면에서 찾기를 누를 수 있는 검사인가 — 그 회사 · (담당자면 본인 것) · 사람이 건 검사만(확인 판 · 자동 검사 제외 · GET /tests/:id 와 같은 사용자 범위).
 *   돌려줌 = DB 가 가진 정본 id(대문자 id 로 소유 · 잠금 키가 어긋나지 않게 · 배포 2 Codex 3R) · 없으면 null.
 */
export async function ownManualSpamTestId(companyId: string, testId: string, ownerId: string | null): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(testId)) return null;
  const own = await query(
    `SELECT t.id FROM spam_filter_tests t WHERE t.id = $1 AND t.company_id = $2${ownerId ? ' AND t.user_id = $3' : ''} AND ${spamCustomerTestSql('t')} AND ${notAutoSpamSourceSql('t.source')}`,
    ownerId ? [testId, companyId, ownerId] : [testId, companyId],
  );
  return own.rows[0] ? String(own.rows[0].id) : null;
}

/** 판 칸(diag_of · diag_plan)이 준비됐는가 — 아니면 「칸 없음」으로 던진다(화면 입구 = 503 DB_MIGRATION_PENDING · 판 상태 충돌로 보이지 않게 · ★ Codex 구현 1R) */
async function requirePlanColumn(): Promise<void> {
  if (!(await hasDiagColumn()) || !(await hasPlanColumn())) throw Object.assign(new Error('column diag_plan does not exist'), { code: '42703' });
}

/** 화면 등록의 부르는 쪽 조건 — 대행이 그 검사의 진단을 가졌으면 화면은 판을 더하지 않는다(부모 진단 잠금 아래에서 한 번 더) */
const screenGuard = (parentTestId: string) => async (run: SqlRun) => !(await agencyOwnsDiag(parentTestId, run));

/** [닿는 글 찾기] — 지금 작성 칸 글 · 제목을 원문으로 첫 판(표현을 바꾼 글)을 만든다 · 이미 판이 있으면 그대로 둔다(두 번 누름) */
export async function startScreenRewrite(i: { parentTestId: string; actorUserId: string; template: { body: string; subject: string | null } }): Promise<{ ok: true } | { ok: false; reason: RewriteFail }> {
  await requirePlanColumn();
  const h = await buildSpamBlockHints(i.parentTestId, { templateText: i.template.body });
  if (!h) return { ok: false, reason: 'not_blocked' };
  if (await agencyOwnsDiag(h.parent.id)) return { ok: false, reason: 'owned' };
  if (h.plates.length > 0) return h.plates[0].plan.owner === 'screen' ? { ok: true } : { ok: false, reason: 'owned' };
  const s = rewriteStepOf(h, 'screen', i.template);
  if (s.editable.length === 0) return { ok: false, reason: 'no_editable' };
  const render = await screenRenderer(h, i.template.body);
  const r = await advanceRewrite({ hint: h, owner: 'screen', actorUserId: i.actorUserId, candidates: ['w1'], template: i.template, editable: s.editable, render, guard: screenGuard(h.parent.id) });
  return r.ok ? { ok: true } : r;
}

/** 주소 물음의 답 — url = 주소도 바꿔서 확인(짧은 주소는 이때 만든다) · rewrite = 주소는 그대로 두고 글을 새로 써서 확인 */
export async function nextScreenRewrite(i: { parentTestId: string; actorUserId: string; choice: 'url' | 'rewrite' }): Promise<{ ok: true } | { ok: false; reason: RewriteFail }> {
  await requirePlanColumn();
  const h = await buildSpamBlockHints(i.parentTestId);
  if (!h) return { ok: false, reason: 'not_blocked' };
  const s = rewriteStepOf(h, 'screen');
  if (s.owner !== 'screen') return { ok: false, reason: 'owned' };
  if (s.step.kind !== 'ask_url' || !s.template) return { ok: false, reason: 'no_variant' };
  const kind = s.step.options.find((k) => (i.choice === 'url' ? k.endsWith('u') : k === 'w2'));
  if (!kind) return { ok: false, reason: 'no_variant' };
  const render = await screenRenderer(h, s.template.body);
  const r = await advanceRewrite({ hint: h, owner: 'screen', actorUserId: i.actorUserId, candidates: [kind], template: s.template, editable: s.editable, render, guard: screenGuard(h.parent.id) });
  return r.ok ? { ok: true } : r;
}

/** 받기(§9-1) — 찾은 판의 바꿈 목록을 지금 작성 칸 글 · 제목에 넣은 글 · 찾은 판이 없으면 not_found */
export async function applyScreenFix(i: { parentTestId: string; current: { body: string; subject: string | null } }): Promise<{ ok: true; body: string; subject: string | null } | { ok: false; reason: 'not_found' | 'changed' }> {
  await requirePlanColumn();
  const plates = await readPlates(i.parentTestId);
  const step = classifyRewrite({ plates: plateStatesOf(plates), owner: 'screen', hasUrl: false });
  if (step.kind !== 'found' || plates[step.plate].plan.owner !== 'screen') return { ok: false, reason: 'not_found' };
  // 회사 스위치를 끈 뒤에는 받기도 닫는다(설계서 §13 · ★ Codex 구현 1R)
  const parent = await readDiagParent(i.parentTestId);
  if (!parent || !(await diagEnabledFor(parent.companyId))) return { ok: false, reason: 'not_found' };
  const plan = plates[step.plate].plan;
  return applySpamFixes(i.current, plan.template, plan.fixes);
}

let rewriteCycleRunning = false;
let rewriteTimer: NodeJS.Timeout | null = null;
/** 이어 돌리기 일꾼 시작(app.ts · 30초 주기 · 한 번만) */
export function startSpamRewriteWorker(): void {
  if (rewriteTimer) return;
  rewriteTimer = setInterval(() => { void runSpamRewriteCycle(); }, 30_000);
}

/**
 * 이어 돌리기(§8 · 30초) — 화면 소유 · 닫히지 않은 진단 중 지금 단계가 「다음 표현 판」인 것만 판을 만들어 등록한다.
 *   주소 판은 여기서 만들지 않는다(사람이 눌러야 한다 = 단계가 ask_url 이면 아무것도 안 한다) · 못 만들면 마지막 판에 사유를 적어 되풀이하지 않는다.
 *   ponytail: 주기마다 최근 2시간의 열린 부모를 훑는다 — 하루 상한이 100판이라 충분 · 늘면 「다음 할 일」 칸을 둔다.
 */
export async function runSpamRewriteCycle(): Promise<void> {
  if (rewriteCycleRunning) return;
  rewriteCycleRunning = true;
  try {
    if (!(await hasDiagColumn()) || !(await hasPlanColumn())) return;
    const open = await query(
      `SELECT t.diag_of AS parent FROM spam_filter_tests t
        WHERE t.source = '${SPAM_DIAG_SOURCE}' AND t.variant_id ~ '^R[1-3]$' AND t.diag_plan IS NOT NULL AND t.created_at > NOW() - INTERVAL '2 hours'
        GROUP BY t.diag_of
       HAVING bool_and(t.diag_plan ->> 'owner' = 'screen') AND NOT bool_or(t.diag_plan ? 'closed' OR t.diag_plan ? 'ended') AND COUNT(*) < ${REWRITE_MAX_PLATES}
        ORDER BY MIN(t.created_at)
        LIMIT 50`,
    );
    for (const row of open.rows as any[]) {
      const parentId = String(row.parent);
      try {
        const plates = await readPlates(parentId);
        const parent = plates.length > 0 ? await readDiagParent(parentId) : null;
        if (!parent) continue;
        const quick = classifyRewrite({ plates: plateStatesOf(plates), owner: 'screen', hasUrl: swappableUrls(diagSentText(parent).sentText, plates[0].plan.editable).length > 0 });
        if (quick.kind !== 'next') continue;
        const h = await buildSpamBlockHints(parentId);
        const last = plates[plates.length - 1];
        if (!h) { await markPlateEnded(parentId, last.testId, 'not_blocked'); continue; }
        const s = rewriteStepOf(h, 'screen');
        if (s.step.kind !== 'next' || !s.template) continue;
        const render = await screenRenderer(h, s.template.body);
        await advanceRewrite({ hint: h, owner: 'screen', actorUserId: plates[0].userId, candidates: s.step.candidates, template: s.template, editable: s.editable, render, guard: screenGuard(parentId), markEnded: true });
      } catch (e: any) {
        console.warn(`[spam-diag] 이어 돌리기 실패 parent=${parentId}:`, e?.message || e);
      }
    }
  } catch (e: any) {
    console.warn('[spam-diag] 이어 돌리기 주기 실패:', e?.message || e);
  } finally {
    rewriteCycleRunning = false;
  }
}

// ─────────────── 잠금 · 닫기 ───────────────

/**
 * 판 행 잠그기 = 진단 잠금 → 판의 확인 문자 → 판 결과 행(앞 설계서 §7 절차 3 · 진단 닫기가 이 함수 하나로 잡는다) · 칸이 없으면 할 것 0.
 *   ★ 배포 2 Codex 3R · 4R 구조 — 행 잠금 순서를 이 함수가 소유한다. 확인 문자 → 결과 행 = 기한 처리 · 보고 매칭(spam-probe closeProbes)과 같은 순이라
 *   진단 잠금을 안 잡는 그쪽과 겹쳐도 서로 기다리지 않는다. 진단 잠금을 쥔 쪽은 판 행을 이 함수로만 잠근다(판 행 쓰기는 그 뒤).
 */
export async function lockDiagResultRows(parentTestId: string, run: SqlRun): Promise<boolean> {
  if (!(await hasDiagColumn(run))) return false;
  await run(DIAG_LOCK_SQL, [diagLockKey(parentTestId)]);
  await run(
    `SELECT p.id FROM spam_test_probes p
      WHERE p.result_id IN (SELECT r.id FROM spam_filter_test_results r JOIN spam_filter_tests t ON t.id = r.test_id
                             WHERE t.diag_of = $1::uuid AND t.source = '${SPAM_DIAG_SOURCE}')
      ORDER BY p.id FOR UPDATE`,
    [parentTestId],
  );
  await run(
    `SELECT r.id FROM spam_filter_test_results r JOIN spam_filter_tests t ON t.id = r.test_id
      WHERE t.diag_of = $1::uuid AND t.source = '${SPAM_DIAG_SOURCE}' ORDER BY r.id FOR UPDATE OF r`,
    [parentTestId],
  );
  return true;
}

/**
 * 진단 닫기(앞 설계서 §6-2-2 · 재작성 §8) — 부모 진단 잠금을 잡고 그 부모의 열린 판을 행 상태로 닫고, 판 전부에 「닫힘」을 적는다(부르는 쪽 트랜잭션 run 으로).
 *   NULL · unconfirmed 결과 = error / queued 판 = completed / 그 판들의 claimed · sent 확인 문자 = expired / diag_plan.closed = true.
 *   닫힘 표시가 선 뒤에는 등록이 같은 잠금 아래에서 그것을 보고 판을 더하지 않는다.
 *   잠금 순서 = (부르는 쪽이 이미 잡은 접수 행 · T 결과 행) → 진단 잠금 → 판 행. 칸이 없으면 할 것 0.
 *   ponytail: 잠금 대기 상한 없음 — 두 적재 함수는 잠금 아래에서 PG 판정 · 표시만 하고 MySQL 적재는 커밋 뒤라 대기는 짧다.
 */
export async function closeDiagnosis(parentTestId: string, run?: SqlRun): Promise<void> {
  // ★ 배포 2 Codex 2R — 부르는 쪽 트랜잭션이 없으면 자기 트랜잭션 하나로(진단 잠금 · 닫기 쓰기가 한 덩어리 · 잠금이 문장 끝에 풀리지 않게)
  if (!run) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await closeDiagnosis(parentTestId, (sql, params) => client.query(sql, params));
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return;
  }
  // ★ 배포 2 Codex 4R 구조 — 판 행은 lockDiagResultRows 가 정한 순서(진단 잠금 → 확인 문자 → 결과 행)로 먼저 다 잡고 쓴다(아래 쓰기 순서와 무관)
  if (!(await lockDiagResultRows(parentTestId, run))) return;
  await run(
    `UPDATE spam_test_probes SET status = 'expired', decided_at = NOW()
      WHERE status IN ('claimed', 'sent')
        AND result_id IN (SELECT r.id FROM spam_filter_test_results r JOIN spam_filter_tests t ON t.id = r.test_id WHERE t.diag_of = $1::uuid AND t.source = '${SPAM_DIAG_SOURCE}')`,
    [parentTestId],
  );
  await run(
    `UPDATE spam_filter_test_results SET result = 'error'
      WHERE (result IS NULL OR result = 'unconfirmed')
        AND test_id IN (SELECT id FROM spam_filter_tests WHERE diag_of = $1::uuid AND source = '${SPAM_DIAG_SOURCE}')`,
    [parentTestId],
  );
  await run(
    `UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW()
      WHERE diag_of = $1::uuid AND source = '${SPAM_DIAG_SOURCE}' AND status = 'queued'`,
    [parentTestId],
  );
  // ★ 1126 C164 §8 — 닫힘을 판 행에 남긴다(같은 잠금 · 같은 판 행)
  if (await hasPlanColumn(run)) {
    await run(
      `UPDATE spam_filter_tests SET diag_plan = jsonb_set(diag_plan, '{closed}', 'true'::jsonb)
        WHERE diag_of = $1::uuid AND source = '${SPAM_DIAG_SOURCE}' AND diag_plan IS NOT NULL`,
      [parentTestId],
    );
  }
}

// ─────────────── 보이는 문장(재작성 설계서 §10-2 정본 문구 · 화면 = 해요체 · 문자 · 메일 = 합니다체) ───────────────

const labels = (carriers: ReadonlyArray<string>) => [...new Set(carriers)].map(getCarrierLabel).join(', ');
const PLATE_NAME: Record<PlateKind, string> = { w1: '표현을 바꾼 글', w1u: '주소도 바꾼 글', w2: '글을 새로 쓴 글', w2u: '새로 쓴 글에 주소도 바꾼 글' };
export const plateName = (kind: PlateKind): string => PLATE_NAME[kind];

/** 판 한 줄의 상태 — 확인 중 · 닿음(보낸 통신사 전부) · 확인 못 함 · 막힘(막은 통신사) */
export function plateStateOf(p: Pick<Plate, 'results'>): { tone: 'wait' | 'ok' | 'no' | 'unknown'; carriers: string[] } {
  if (p.results.some((r) => r.state === 'queued' || r.state === 'checking')) return { tone: 'wait', carriers: [] };
  if (p.results.length > 0 && p.results.every((r) => r.state === 'arrived')) return { tone: 'ok', carriers: p.results.map((r) => r.carrier) };
  if (p.results.length === 0 || p.results.some((r) => r.state === 'unknown')) return { tone: 'unknown', carriers: [] };
  return { tone: 'no', carriers: p.results.filter((r) => r.state === 'blocked').map((r) => r.carrier) };
}
export function plateStateText(p: Pick<Plate, 'results'>, formal = false): string {
  const s = plateStateOf(p);
  if (s.tone === 'wait') return formal ? '확인하고 있습니다' : '확인하고 있어요';
  if (s.tone === 'ok') return formal ? `${labels(s.carriers)}에 닿았습니다` : `${labels(s.carriers)}에 닿았어요`;
  if (s.tone === 'unknown') return formal ? '확인을 마치지 못했습니다' : '확인을 마치지 못했어요';
  return formal ? `${labels(s.carriers)}에서 막혔습니다` : `${labels(s.carriers)}에서 막혔어요`;
}

/** 「해 본 것」 한 줄 — 결과가 정해진 판마다 「판 이름: 상태.」(확인 중인 판은 뺀다 · 없으면 빈 줄) */
export function triedPlatesLine(plates: ReadonlyArray<Plate>, formal = false): string {
  return plates.filter((p) => plateStateOf(p).tone !== 'wait').map((p) => `${plateName(p.plan.kind)}: ${plateStateText(p, formal)}.`).join(' ');
}

/**
 * 한 줄 요약(보내기 전 경고 창 · 담당자 문자 · 회신 메일) — 결과가 정해진 판이 있으면 「해 본 것」(판 이름: 상태) · 없으면 의심 부분(주소가 앞이면 「글 속 주소」).
 *   확인 중은 쓰지 않는다(확정 상태만 근거).
 */
export function spamHintLine(h: SpamBlockHints, formal = false): string {
  const tried = triedPlatesLine(h.plates, formal);
  if (tried) return tried;
  const top = h.carriers[0]?.suspects.find((s) => !s.demoted);
  if (top?.kind === 'url') return '막혔을 수 있는 부분: 글 속 주소';
  return '';
}

/**
 * ★ 배포 2 Codex 2R — 이 검사의 진단을 대행이 가졌는가(대행 진단 사건 spam_hint 의 T). 대행은 같은 날 같은 글이면 사람이 건 검사도 이어 보므로,
 *   그 검사의 진단은 대행 진단 대기(접수 · 문안 버전 · 닫기)가 소유한다 → 화면 단추 · 화면 등록은 열지 않는다(닫힌 진단에 화면이 판을 더하지 않게).
 */
export async function agencyOwnsDiag(parentTestId: string, run: SqlRun = query): Promise<boolean> {
  const r = await run(`SELECT 1 FROM agency_send_events WHERE kind = 'spam_hint' AND payload ->> 'parentTestId' = $1 LIMIT 1`, [parentTestId]);
  return r.rows.length > 0;
}

/** 검사 창 카드(§10-1) — 문장은 전부 여기서 만든다(화면은 그대로 그린다) */
export interface RewriteCard {
  /** hidden = 찾기 칸째 숨김(스위치 꺼짐 · 자동 검사 · 판 없음) */
  state: 'hidden' | 'idle' | 'working' | 'ask_url' | 'found' | 'end';
  /** 찾기 단추(자격이 될 때만) */
  start: { label: string; note: string } | null;
  /** 자격이 안 될 때의 문장 */
  reasonText: string;
  plates: Array<{ name: string; change: string; stateText: string; tone: 'wait' | 'ok' | 'no' | 'unknown' }>;
  ask: { text: string; note: string; options: Array<{ choice: 'url' | 'rewrite'; label: string }> } | null;
  found: { title: string; note: string; keepLine: string; urlLine: string; fixes: Array<{ before: string; after: string }>; applyLabel: string } | null;
  endText: string;
}

const showUrl = (u: string) => u.replace(/^https?:\/\//i, '');

function changeLine(plan: DiagPlan): string {
  const lines = plan.fixes.filter((f) => f.kind === 'text').length;
  const parts = [lines > 0 ? `바꾼 곳 ${lines}줄` : '', plan.urls.length > 0 ? `주소 ${plan.urls.length}개` : ''].filter(Boolean);
  return parts.join(', ');
}

/** 화면 응답(GET /tests/:id 의 hints) — A(의심 부분) + 찾기 카드(이 사용자 기준 자격 · 판 진행 · 물음 · 찾은 글 · 끝) */
export async function spamHintsResponse(h: SpamBlockHints, actorUserId: string): Promise<{ sendable: boolean; carriers: DiagCarrierHint[]; rewrite: RewriteCard }> {
  const view = await rewriteCardOf(h, actorUserId);
  // 배포 때 열려 있던 옛 화면은 통신사마다 checks · next 를 읽는다 → 그 칸을 빈 값으로 싣는다(옛 화면 = 의심 부분만 · 단추 없음 · 깨짐 0 · 다음 정리 때 지운다)
  const legacy = { checks: {}, next: null, nextBasis: null, nextLines: [], eligible: false, reason: 'off', reasonText: '' };
  return { sendable: h.sendable, carriers: h.carriers.map((c) => ({ ...legacy, ...c })), rewrite: view };
}

async function rewriteCardOf(h: SpamBlockHints, actorUserId: string): Promise<RewriteCard> {
  const C = labels(h.carriers.map((c) => c.carrier));
  const s = rewriteStepOf(h, 'screen');
  // 화면 단추 = 사람이 건 검사만(자동 검사 · 대행이 가진 진단은 그 길이 맡는다)
  const auto = isAutoSpamSource(h.parent.source) || s.owner !== 'screen' || await agencyOwnsDiag(h.parent.id);
  const el = auto ? { ok: false as const, reason: 'off' as DiagIneligible }
    : await rewriteEligibility({ hint: h, owner: 'screen', actorUserId }).catch(() => ({ ok: false as const, reason: 'off' as DiagIneligible }));
  const plates = h.plates.map((p) => ({ name: plateName(p.plan.kind), change: changeLine(p.plan), stateText: plateStateText(p), tone: plateStateOf(p).tone }));
  const card: RewriteCard = { state: 'idle', start: null, reasonText: '', plates, ask: null, found: null, endText: '' };
  const step = s.step;
  // 닫힌 진단(대행이 끝낸 것) = 화면은 의심 부분만 보인다(판 줄 · 단추 0)
  if (step.kind === 'closed') { card.state = 'hidden'; card.plates = []; return card; }
  if (step.kind === 'found') {
    const plan = h.plates[step.plate].plan;
    const swapped = plan.urls.length > 0;
    card.state = 'found';
    card.found = {
      title: `${C}에 닿는 글을 찾았어요`,
      note: '한 통을 보내 확인한 결과예요. 보내는 양과 시점에 따라 달라질 수 있어요.',
      keepLine: swapped ? '숫자와 날짜는 그대로예요.' : '숫자, 날짜, 주소는 그대로예요.',
      urlLine: swapped ? '글 속 주소를 한줄로 짧은 주소로 바꿨어요. 누르면 지금 주소로 넘어가요. 클릭 수는 이 주소에도 잡혀요.' : '',
      fixes: plan.fixes.map((f) => ({ before: f.before, after: f.after })),
      applyLabel: auto || !el.ok ? '' : '이 글로 바꾸고 다시 검사',
    };
    return card;
  }
  if (h.plates.length === 0) {
    if (!el.ok) {
      card.state = el.reason === 'off' ? 'hidden' : 'idle';
      card.reasonText = el.reason === 'off' ? '' : diagReasonText(el.reason);
      return card;
    }
    card.start = { label: `주소와 혜택은 그대로 두고 ${C}에 닿는 글 찾기`, note: `표현을 바꾼 글을 ${C}로만 보내 닿는지 확인해요. 요금은 없어요. 창을 닫아도 계속 찾아요.` };
    return card;
  }
  if (step.kind === 'wait' || step.kind === 'next') { card.state = 'working'; return card; }
  if (step.kind === 'ask_url' && el.ok) {
    card.state = 'ask_url';
    card.ask = {
      text: `표현을 바꿔도 ${C}에서 막혔어요. 글 속 주소(${swappableUrls(h.sentText, s.editable).map(showUrl).join(', ')})가 막는 것일 수 있어요. 같은 곳으로 가는 한줄로 짧은 주소로 바꿔서 확인해 볼까요?`,
      note: '바꾸면 내 단축 주소 목록에 주소가 하나 생겨요. 보낼 글은 받기를 눌러야 바뀌어요.',
      options: [
        { choice: 'url' as const, label: '주소도 바꿔서 확인' },
        ...(step.options.includes('w2') ? [{ choice: 'rewrite' as const, label: '주소는 그대로 두고 글을 새로 써서 확인' }] : []),
      ],
    };
    return card;
  }
  // 끝 — 못 찾음 · 확인 못 함 · 물음 단계인데 자격이 사라짐(해 본 것 = plates)
  card.state = 'end';
  const endedReason = step.kind === 'end' ? step.reason : null;
  card.endText = step.kind === 'end_unknown' ? '확인을 마치지 못했어요.'
    : endedReason === 'cap' || endedReason === 'permission' ? diagReasonText(endedReason)
      : step.kind === 'ask_url' && !el.ok ? diagReasonText(el.reason)
        : `${C}에 닿는 글을 찾지 못했어요. 막힌 표현을 바꾼 뒤 다시 검사해 주세요.`;
  return card;
}

/** 글에 주소가 있는가(지난 검사 줄 · 순수) */
export function textHasUrl(text: string): boolean {
  return tokenizeSpamText(text).tokens.some((t) => t.url && !t.legal);
}

/** 회신 메일의 원문 줄(의심 조각이 든 줄 앞 「▶」 · 원문 = 고객이 쓴 글 · 변수 값 0 · 앞 설계서 §8-2 M3) */
export function markedTemplateLines(templateText: string, h: SpamBlockHints | null): string[] {
  const marks = new Set((h?.carriers || []).flatMap((c) => c.suspects.filter((s) => !s.demoted && s.kind !== 'other').map((s) => s.token)));
  const { tokens } = tokenizeSpamText(templateText);
  const marked = new Set(tokens.filter((t) => marks.has(t.token)).map((t) => t.line));
  return String(templateText || '').split('\n').map((l, i) => (marked.has(i) ? `▶ ${l}` : l));
}
