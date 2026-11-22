/**
 * routes/ai-line.ts — AI 한줄로 (`/api/ai-line` · ★ 2026-10-18 · 설계서 docs/2026-10-18-ai-line-design.md §5 · §7 · §8)
 *
 * read(AI 0) → intake(대상 AI · 기본 2) → recount(0) → compose(문안 2 × 종류) / proceed(직접입력 · 알림톡 = 기본만) → decorate(1)
 * 게이트 = 로그인 · AI 오퍼레이터 요금제(isAiOperatorAllowed). ★ 2026-10-19 스위치 삭제(전 회사 · Harold).
 * retarget(0) = 직접 타겟 선택 · 「전체 고객」 답 뒤 다시 세기 + 칩 · 1위 고객 · 칼럼.
 * 실패 응답 = { success:false, error, code } · 크레딧 부족 402 INSUFFICIENT_CREDIT · 원장 조회 실패 503.
 */
import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { isCopyContentType } from '../utils/copy-content-type';
import { authenticate } from '../middlewares/auth';
import { aiZonePlanBlocked } from '../utils/plan-guard';
import { InsufficientCreditError } from '../utils/ai-credit';
import { isValidAttemptToken, isValidLineBenefit } from '../utils/one-line-facts';
import { readLinePeriod } from '../utils/one-line-steps';   // ★ C105 H1
import { matchAlimtalkTemplate } from '../utils/alimtalk-ai-matcher';
import { readAiLine, sanitizeLineTypes, readLineAnswers, LINE_LINK_ASK, type AiLineAnswer } from '../utils/ai-line';
import { voiceLearned } from '../utils/brand-voice-prompt';
import { variantNamesFor } from '../utils/copy-house-rules';
import {
  AiLineError, aiLineVarTokensFor,
  runLineIntake, runLineRecount, runLineRetarget, runLineProceed, runLineCompose, runLineDecorate, runLineAlimtalkMatch,
  audienceDetail, lineBodySendChannel,
  type AiLineViewer,
} from '../services/ai-line';
import { startLineSpamTest, readLineSpamTest } from '../services/ai-line-spam';
import { respondUserError } from '../utils/http-error';
import { findUneditedSendPlaceholder } from '../utils/send-placeholder-gate';
import {
  readAskLine, readAskPlan, readAskPrice, readAskPrices, countAskCells, countAskPlan, listAskAudience, askGroupMeta, askAudienceText, askComposeLicense,
  readAskPlace, askUngroundedWords, askStagingState, ASK_PLACE_Q, ASK_PLACE_ANSWER,
  askChannelOf, askAudienceWhere, askCellsOf, askAmount, stageAskAudience, dropAskStaging,
} from '../utils/ask-segments';
import { sendableCustomerSql } from '../utils/product-signal';
import { prepareFieldMappings } from '../utils/messageUtils';
import { sendBodyVars } from '../utils/var-tokens';
import { sealServerStaging } from '../utils/operator-recipients';
import { branchOfDirect } from '../utils/ad-send-gate-core';
import { parseSplitSetting } from '../utils/send-time-util';
import { answerAsk, readAskHistory, ASK_QUESTION_MIN, ASK_QUESTION_MAX, ASK_THREAD_FULL_TEXT, ASK_HISTORY_INVALID_TEXT } from '../services/ask-answer';   // ★ C152 B 질문에 답하기 · C155 대화
import { v3Live } from '../utils/v3-stage';
import { companyWideViewer } from '../utils/product-signal';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { readGroupPerformance, GROUP_PERF_WINDOW_DAYS, GROUP_PERF_MIN_N, ATTRIBUTION_DAYS } from '../utils/send-ledger-rollup';   // ★ C154 고객 묶음별 성과

const router = Router();
router.use(authenticate);

const LINE_MIN = 5;
const LINE_MAX = 2000;

function viewerOf(req: Request): AiLineViewer | null {
  const companyId = req.user?.companyId;
  if (!companyId) return null;
  return { companyId, userId: req.user?.userId || null, userType: req.user?.userType || null };
}

/** 요금제 — 통과면 viewer, 아니면 응답을 보내고 null */
async function lineGate(req: Request, res: Response): Promise<AiLineViewer | null> {
  const v = viewerOf(req);
  if (!v) { res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' }); return null; }
  // ★ 2026-10-24 요금제 = AI 존 서버 문 한 곳(뿌리 대장 R2)
  if (await aiZonePlanBlocked(req, res)) return null;
  return v;
}

function readLine(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t.length >= LINE_MIN && t.length <= LINE_MAX ? t : null;
}

const isPlainObject = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * facts = { benefit: string|null|undefined, period_end: 'YYYY-MM-DD'|null|undefined, answers?: [{q, a}] } · 틀리면 'invalid'
 * ★ 2026-10-20 answers = AI 가 물은 그 밖 질문의 답(설계서 §17) · 답이 있을 때만 싣는다(없으면 옛 모양 그대로 = 원장 키 지문 무변)
 */
function readFacts(raw: unknown): { benefit: string | null; periodEnd: string | null; periodStart?: string; answers?: AiLineAnswer[] } | 'invalid' {
  if (raw === undefined || raw === null) return { benefit: null, periodEnd: null };
  if (!isPlainObject(raw)) return 'invalid';
  const b = raw.benefit;
  if (b !== undefined && b !== null && !isValidLineBenefit(b)) return 'invalid';
  // ★ C105 H1 — 기간 = readLinePeriod CT(한줄 단계 몸통 읽기와 같은 함수 · 시작일은 값이 있을 때만 = 옛 원장 키 불변)
  const period = readLinePeriod(raw.period_start, raw.period_end, Date.now());
  if (period === 'invalid') return 'invalid';
  const answers = readLineAnswers(raw.answers);
  if (answers === 'invalid') return 'invalid';
  return {
    benefit: typeof b === 'string' && b.trim() ? b.trim() : null,
    periodEnd: period.end,
    ...(period.start ? { periodStart: period.start } : {}),
    ...(answers.length > 0 ? { answers } : {}),
  };
}

function readChannel(raw: unknown): 'SMS' | 'LMS' | 'MMS' | null {
  const c = String(raw || '').toUpperCase();
  return c === 'SMS' || c === 'LMS' || c === 'MMS' ? c : null;
}

/** 고른 칼럼 — allowed = 이 회사 칼럼 목록(표준 + 회사 칼럼 · aiLineVarTokensFor) */
function readVars(raw: unknown, allowed: ReadonlySet<string>): string[] | 'invalid' {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return 'invalid';
  const out: string[] = [];
  for (const x of raw) {
    const t = String(x || '').replace(/%/g, '').trim();
    if (!allowed.has(t)) return 'invalid';
    if (!out.includes(t)) out.push(t);
  }
  return out.length <= 8 ? out : 'invalid';
}

function fail(res: Response, err: any, where: string): Response {
  if (err instanceof InsufficientCreditError) {
    return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
  }
  if (err instanceof AiLineError) {
    return res.status(err.status).json({ success: false, error: err.message, code: err.code });
  }
  // ★ 2026-10-25 원장 쓰기 실패 = 결과 안 줌(503 · 성공 뒤 차감 한 규칙)
  if (respondUserError(res, err)) return res;
  const msg = String(err?.message || '');
  console.error(`[ai-line ${where}] 오류:`, msg);
  return res.status(500).json({ success: false, error: '처리 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.' });
}

// POST /read — AI 0 · DB 0 · 무과금
router.post('/read', async (req: Request, res: Response) => {
  const v = viewerOf(req);
  if (!v) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  const line = typeof req.body?.line === 'string' ? req.body.line.slice(0, LINE_MAX) : '';
  return res.json({ success: true, ...readAiLine(line) });
});

// POST /intake — 대상 AI · 승인 발송과 같은 세기 · 1위 고객 · 칼럼 채움 · 기본 2(1명 이상)
router.post('/intake', async (req: Request, res: Response) => {
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    const line = readLine(req.body?.line);
    if (!line) return res.status(400).json({ success: false, error: '한 줄을 5자 이상 적어 주세요.', code: 'LINE_INVALID' });
    const out = await runLineIntake(v, line);
    return res.json({ success: true, ...out });
  } catch (err: any) {
    return fail(res, err, 'intake');
  }
});

// POST /recount — 0크레딧 · 확인 판의 조건 켜기/끄기
router.post('/recount', async (req: Request, res: Response) => {
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    const filters = isPlainObject(req.body?.filters) ? req.body.filters : {};
    const out = await runLineRecount(v, filters, req.body?.allCustomers === true);
    return res.json({ success: true, ...out });
  } catch (err: any) {
    return fail(res, err, 'recount');
  }
});

// POST /retarget — 0크레딧 · 직접 타겟 선택 · 「전체 고객」 답 뒤(칩 · 1위 고객 · 칼럼까지)
router.post('/retarget', async (req: Request, res: Response) => {
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    const filters = isPlainObject(req.body?.filters) ? req.body.filters : {};
    const out = await runLineRetarget(v, filters, req.body?.allCustomers === true);
    return res.json({ success: true, ...out });
  } catch (err: any) {
    return fail(res, err, 'retarget');
  }
});

// POST /proceed — 직접입력만 · 알림톡 갈래 = 대상 확정 + 기본(아직이면)
router.post('/proceed', async (req: Request, res: Response) => {
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    const line = readLine(req.body?.line);
    if (!line) return res.status(400).json({ success: false, error: '한 줄을 5자 이상 적어 주세요.', code: 'LINE_INVALID' });
    const filters = isPlainObject(req.body?.filters) ? req.body.filters : {};
    const out = await runLineProceed(v, line, filters, req.body?.allCustomers === true);
    return res.json({ success: true, ...out });
  } catch (err: any) {
    return fail(res, err, 'proceed');
  }
});

// POST /compose — 고른 종류 × 고른 칼럼 · 2 × 나온 종류(+ 기본 미납분)
router.post('/compose', async (req: Request, res: Response) => {
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    const b = req.body || {};
    const line = readLine(b.line);
    if (!line) return res.status(400).json({ success: false, error: '한 줄을 5자 이상 적어 주세요.', code: 'LINE_INVALID' });
    const facts = readFacts(b.facts);
    if (facts === 'invalid') return res.status(400).json({ success: false, error: '혜택 · 기간 답이 올바르지 않아요.', code: 'FACTS_INVALID' });
    const types = sanitizeLineTypes(b.types);
    if (types === 'invalid') return res.status(400).json({ success: false, error: '만들 문안 종류를 골라 주세요.', code: 'TYPES_INVALID' });
    const vars = readVars(b.vars, await aiLineVarTokensFor(v.companyId));
    if (vars === 'invalid') return res.status(400).json({ success: false, error: '고른 칼럼을 쓸 수 없어요. 확인 판을 다시 열어 주세요.', code: 'VARS_INVALID' });
    const channel = readChannel(b.channel);
    if (!channel) return res.status(400).json({ success: false, error: '채널이 올바르지 않아요.', code: 'CHANNEL_INVALID' });
    if (!isValidAttemptToken(b.attemptToken)) return res.status(400).json({ success: false, error: '요청 형식이 올바르지 않아요. 화면을 새로 고쳐 주세요.', code: 'ATTEMPT_INVALID' });
    const out = await runLineCompose(v, {
      line, facts, filters: isPlainObject(b.filters) ? b.filters : {}, allCustomers: b.allCustomers === true,
      types, vars, channel, isAd: b.isAd !== false, attemptToken: b.attemptToken,
      // ★ 2026-10-28 K4-4 종류 칩(허용값 밖 = 없음)
      contentType: isCopyContentType(b.contentType) ? b.contentType : null,
    });
    return res.json({ success: true, ...out });
  } catch (err: any) {
    return fail(res, err, 'compose');
  }
});

// POST /decorate — 고른 문안 1개에 칼럼을 더 넣는다 · 1(글이 바뀐 때만)
router.post('/decorate', async (req: Request, res: Response) => {
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    const b = req.body || {};
    const body = typeof b.body === 'string' ? b.body.trim() : '';
    if (body.length < 5 || body.length > 2000) return res.status(400).json({ success: false, error: '꾸밀 문안이 너무 짧거나 길어요.', code: 'BODY_INVALID' });
    const vars = readVars(b.vars, await aiLineVarTokensFor(v.companyId));
    if (vars === 'invalid' || vars.length === 0) return res.status(400).json({ success: false, error: '넣을 칼럼을 1개 이상 골라 주세요.', code: 'VARS_INVALID' });
    const channel = readChannel(b.channel);
    if (!channel) return res.status(400).json({ success: false, error: '채널이 올바르지 않아요.', code: 'CHANNEL_INVALID' });
    if (!isValidAttemptToken(b.attemptToken)) return res.status(400).json({ success: false, error: '요청 형식이 올바르지 않아요. 화면을 새로 고쳐 주세요.', code: 'ATTEMPT_INVALID' });
    const out = await runLineDecorate(v, { body, vars, channel, isAd: b.isAd !== false, attemptToken: b.attemptToken });
    return res.json({ success: true, ...out });
  } catch (err: any) {
    return fail(res, err, 'decorate');
  }
});

// POST /alimtalk-match — 알림톡 갈래 · 승인 템플릿 매칭(매칭 AI 는 묶음 = 추가 차감 0 · 이 한 줄의 기본을 낸 뒤에만)
router.post('/alimtalk-match', async (req: Request, res: Response) => {
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    const line = readLine(req.body?.line);
    if (!line) return res.status(400).json({ success: false, error: '한 줄을 5자 이상 적어 주세요.', code: 'LINE_INVALID' });
    // ★ 2026-10-19 기본 미납(누구에게를 물은 경우) = 확정 대상 확인 → 매칭 → 성공 뒤 기본 · 이미 냈으면 매칭만(원장 조회 실패 = 503)
    const filters = isPlainObject(req.body?.filters) ? req.body.filters : {};
    const { result: m, charged, paid } = await runLineAlimtalkMatch(v, line, filters, req.body?.allCustomers === true,
      () => matchAlimtalkTemplate({ companyId: v.companyId, campaignObjective: line }),
      (r) => !!r.template || (r.alternativeTemplates?.length ?? 0) > 0);
    const list = [
      ...(m.template ? [{ template: m.template, matchScore: m.matchScore, matchReason: m.matchReason }] : []),
      ...m.alternativeTemplates,
    ].map((t) => ({
      id: t.template.id,
      templateCode: t.template.template_code,
      name: t.template.template_name,
      profileId: t.template.profile_id,
      profileName: t.template.profile_name || null,
      content: t.template.content,
      score: t.matchScore,
      reason: t.matchReason,
    }));
    return res.json({ success: true, matched: m.matched, templates: list, mappings: m.variableMappings, suggestion: m.suggestion, ...(m.note ? { note: m.note } : {}), charged, paid });
  } catch (err: any) {
    return fail(res, err, 'alimtalk-match');
  }
});

// ─────────────── ★ 2026-11-21 C151 한 줄로 묻기(설계서 docs/2026-11-21-c151-ask-entry-design.md §2 S2) ───────────────

const ASK_PLAN_INVALID = '고른 묶음 · 예산이 올바르지 않아요. 화면을 새로 고쳐 주세요.';
/** 예산인데 단가 미설정 = 400(돈 계산을 지어내지 않는다) */
const ASK_PRICE_UNSET = { success: false, error: '문자 단가가 정해지지 않아 예산으로 고를 수 없어요. 「모두에게 보내기」로 골라 주세요.', code: 'PRICE_UNSET' };

// POST /ask/read — AI 0 · DB 0 · 무과금(/read 와 같은 관문 = 로그인)
router.post('/ask/read', async (req: Request, res: Response) => {
  const v = viewerOf(req);
  if (!v) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  return res.json({ success: true, ...readAskLine(req.body?.line) });
});

// GET /ask/segments — 칸 15 + 구매 기록 없음 · 칸마다 범위 안 고객 · 보낼 수 있는 번호 수 · 장문 단가
router.get('/ask/segments', async (req: Request, res: Response) => {
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    // ★ 2026-11-22 C157 — unitPrices = 문자 종류 셋의 1통 값(2단계 종류 칩) · varNames = 발송 치환이 쓰는 매핑 이름들(화면이 「칼럼이 든 SMS = LMS」를 미리 보여 줄 때 쓰는 거울 · 주인은 적재 주소)
    const [counted, prices, learned, mappings] = await Promise.all([countAskCells(v.companyId, v.userId), readAskPrices(v.companyId), voiceLearned(v.companyId, 'marketing'), prepareFieldMappings(v.companyId)]);
    const price = prices.LMS;   // 옛 화면이 읽는 칸(unitPrice = LMS)
    // ★ 2026-11-22 C153 D3 — 종류 칩 이름(목소리를 배운 회사 = 서버 이름 · 문안 카드 이름과 같은 판정 = 광고 문자 목소리) · 아니면 null = 화면 기본 이름
    const typeNames = learned ? (([a, b, c]) => ({ emo: a, benefit: b, mz: c }))(variantNamesFor(true, '')) : null;
    return res.json({ success: true, groups: askGroupMeta(), ...counted, unitPrice: price, unitPrices: prices, varNames: Object.keys(mappings), typeNames });
  } catch (err: any) {
    return fail(res, err, 'ask-segments');
  }
});

// GET /ask/group-performance — ★ 2026-11-22 C154 고객 묶음별 성과(최근 90일 · 귀속이 닫힌 발송 · 보낸 뒤 7일 안에 받은 분이 산 금액)
//   관문 차례 = 요금제(lineGate) → 굴리기 단계(v3Live 'rollup') → 회사 전체를 보는 사용자(companyWideViewer · 굴린 표는 담당자 범위로 다시 자를 수 없다).
//   닫힘 · 담당자 = live:false 한 줄(화면은 카드 · 격자 칸을 그리지 않는다). 표가 없으면(DDL 전) 503 DB_MIGRATION_PENDING.
router.get('/ask/group-performance', async (req: Request, res: Response) => {
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    res.setHeader('Cache-Control', 'private, no-store');
    if (!(await v3Live('rollup', v.companyId)) || !(await companyWideViewer(req.user as any))) return res.json({ success: true, live: false });
    const out = await readGroupPerformance(v.companyId);
    return res.json({ success: true, live: true, windowDays: GROUP_PERF_WINDOW_DAYS, attributionDays: ATTRIBUTION_DAYS, minN: GROUP_PERF_MIN_N, ...out });
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'campaign_cell_results')) return;
    return fail(res, err, 'ask-group-performance');
  }
});

// POST /ask/count — 2단계 인원 · 금액(§2-1 세기 · 고른 묶음이 바뀔 때마다)
router.post('/ask/count', async (req: Request, res: Response) => {
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    const plan = readAskPlan(req.body?.plan);
    if (!plan) return res.status(400).json({ success: false, error: ASK_PLAN_INVALID, code: 'PLAN_INVALID' });
    const price = await readAskPrice(v.companyId, askChannelOf(plan));   // ★ C157 — 그 계획의 문자 종류 1통 값(없으면 LMS = 옛 요청 그대로)
    const out = await countAskPlan(v.companyId, v.userId, plan, price);
    if (!out) return res.status(400).json(ASK_PRICE_UNSET);
    return res.json({ success: true, ...out, unitPrice: price, channel: askChannelOf(plan) });
  } catch (err: any) {
    return fail(res, err, 'ask-count');
  }
});

// POST /ask/audience — 보낼 명단(지금 다시 셈 · §2-1 같은 문장)
//   ★ 2026-11-22 C157 D14 — 새 화면은 부르지 않는다(받는 분은 서버가 적재 = /ask/stage). 배포 때 열려 있던 옛 화면 번들이 4단계에서 부르므로 이번 배포에서는 남긴다(삭제 = 다음 배포).
router.post('/ask/audience', async (req: Request, res: Response) => {
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    const plan = readAskPlan(req.body?.plan);
    if (!plan) return res.status(400).json({ success: false, error: ASK_PLAN_INVALID, code: 'PLAN_INVALID' });
    const out = await listAskAudience(v.companyId, v.userId, plan, await readAskPrice(v.companyId, askChannelOf(plan)));
    if (!out) return res.status(400).json(ASK_PRICE_UNSET);
    return res.json({ success: true, ...out });
  } catch (err: any) {
    return fail(res, err, 'ask-audience');
  }
});

// POST /ask/compose — 문안(고른 종류마다 한 안 · 안마다 2크레딧 · 기본료 0) · hole = 발송 길목이 막을 자리가 남음 · ungrounded = 입력에 없는 말(알림)
// ★ 2026-11-22 C153 — 내용 = 사람이 적은 한 줄(필수 · 없으면 만들지 않는다) · 혜택 · 오실 곳 · 종류를 받은 뒤에만 만든다(설계서 docs/2026-11-22-c153-ask-step3-redesign-design.md §2 S1)
router.post('/ask/compose', async (req: Request, res: Response) => {
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    const b = req.body || {};
    const plan = readAskPlan(b.plan);
    if (!plan) return res.status(400).json({ success: false, error: ASK_PLAN_INVALID, code: 'PLAN_INVALID' });
    const line = readLine(b.line);
    if (!line) return res.status(400).json({ success: false, error: '무엇을 알릴지 한 줄(5자 이상) 적어 주세요.', code: 'LINE_REQUIRED' });
    const types = sanitizeLineTypes(b.types);
    if (types === 'invalid') return res.status(400).json({ success: false, error: '만들 문안 종류를 골라 주세요. 화면이 그대로면 새로 고쳐 주세요.', code: 'TYPES_INVALID' });
    const place = readAskPlace(b.place);
    if (!place) return res.status(400).json({ success: false, error: '오실 곳 고르기가 올바르지 않아요.', code: 'FACTS_INVALID' });
    const link = place === 'online' && typeof b.link === 'string' && b.link.trim() ? b.link.trim() : null;
    // 오실 곳 = 사람이 고른 사실(그 밖 답 = 근거 글의 「확인한 사실」) · 링크 = AI 한줄로의 링크 답과 같은 자리(1회용 링크 · 틀린 주소는 만들기가 거절)
    const answers = readLineAnswers([
      ...(place !== 'none' ? [{ q: ASK_PLACE_Q, a: ASK_PLACE_ANSWER[place] }] : []),
      ...(link ? [{ q: LINE_LINK_ASK.label, a: link }] : []),
    ]);
    if (answers === 'invalid') return res.status(400).json({ success: false, error: '오실 곳 · 링크가 올바르지 않아요.', code: 'FACTS_INVALID' });
    const mode = b.benefitMode === 'line' || b.benefitMode === 'custom' || b.benefitMode === 'none' ? b.benefitMode : null;
    if (!mode) return res.status(400).json({ success: false, error: '혜택 고르기가 올바르지 않아요.', code: 'FACTS_INVALID' });
    const benefit = mode === 'custom' && typeof b.benefit === 'string' && isValidLineBenefit(b.benefit) ? b.benefit.trim() : null;
    if (mode === 'custom' && !benefit) return res.status(400).json({ success: false, error: '혜택 칸을 적어 주세요.', code: 'FACTS_INVALID' });
    if (!isValidAttemptToken(b.attemptToken)) return res.status(400).json({ success: false, error: '요청 형식이 올바르지 않아요. 화면을 새로 고쳐 주세요.', code: 'ATTEMPT_INVALID' });
    const retry = b.retryBlocked === true;
    const channel = askChannelOf(plan);   // ★ C157 — 사람이 고른 문자 종류(없으면 LMS)
    const counted = await countAskPlan(v.companyId, v.userId, plan, await readAskPrice(v.companyId, channel));
    if (!counted) return res.status(400).json(ASK_PRICE_UNSET);
    const lic = askComposeLicense(line, mode, benefit, retry);
    const out = await runLineCompose(v, {
      line: lic.licenseLine, facts: { benefit: lic.benefit, periodEnd: null, ...(answers.length > 0 ? { answers } : {}) }, filters: {}, allCustomers: false,
      types, vars: [], channel, isAd: true, attemptToken: b.attemptToken,
      ask: {
        count: counted.planned,
        audienceText: askAudienceText(plan.groups),
        extraContext: lic.extraContext,
        ...(lic.benefitGround !== undefined ? { benefitGround: lic.benefitGround } : {}),
        // 과금 키 = 사람 입력만(한 줄 · 정렬한 묶음 키 · 혜택 갈래 · 혜택 글 · 오실 곳 · 링크 · 정렬한 종류 · 다시 고침)
        //   ★ C157 — 문자 종류는 LMS(기본)가 아닐 때만 넣는다(LMS = 옛 키와 글자 그대로 같다 = 이미 걷은 문안의 재생이 깨지지 않는다)
        keyInput: { line, groups: plan.groups, mode, benefit: benefit || '', place, link: link || '', types: [...types].sort(), retry, ...(plan.channel ? { channel: plan.channel } : {}) },
      },
    });
    // 안전망의 근거 = 사람이 준 글 전부(한 줄 · 혜택 칸 · 오실 곳 답 · 링크)
    const ground = [line, lic.benefit || '', ...answers.map((x) => x.a)].join('\n');   // 안전망 낱말의 근거(혜택 근거와 다르다 = 사람이 적은 글 전부)
    // ★ C157 D13 · S5 — 표본 고객 · 칼럼 목록 = 이 문안 실행에 하나로 묶는다(AI 한줄로의 대상 상세와 같은 함수 · 대상 = 고른 묶음의 보낼 수 있는 고객).
    //   실패해도 문안은 내준다(표본 없음 = 회사 기본 첫 고객으로 검사 · 칼럼 더 넣기 없음).
    const detail = await audienceDetail(v.companyId, {
      blocked: false, unresolved: false, empty: false,
      where: askAudienceWhere(await sendableCustomerSql(v.companyId, v.userId)), params: [v.companyId, askCellsOf(plan.groups)],
    }, counted.planned, []).catch((err: any) => {
      console.warn('[ai-line ask-compose] 표본 · 칼럼을 읽지 못해 뺀다:', err?.message || err);
      return { top: null, sampleCustomer: null, columns: [] };
    });
    return res.json({
      success: true,
      cards: out.cards.map((c) => ({
        type: c.type, label: c.label, body: c.body, subject: c.subject, byteCount: c.byteCount,
        hole: findUneditedSendPlaceholder(c.body, c.subject) !== null,
        ungrounded: askUngroundedWords(`${c.subject}\n${c.body}`, ground),
      })),
      channel: out.channel, count: out.count, charged: out.charged,
      sample: detail.top ? { id: detail.top.id, name: detail.top.name } : null, columns: detail.columns,
    });
  } catch (err: any) {
    return fail(res, err, 'ask-compose');
  }
});

// POST /ask/stage — ★ 2026-11-22 C157 받는 분을 서버가 적재한다(설계서 docs/2026-11-22-c157-ask-send-options-design.md §2 S2 · S4-b)
//   화면은 명단을 받지 않는다 · 확정 = /api/campaigns/direct-send/commit { stagingId, signature, msgType = 이 응답의 channel }(명단이 바뀌면 차감 전에 409).
//   나가는 문자 종류 = 사람이 고른 종류와 **최종 본문**으로 서버가 다시 정한다(변수 · 주소가 든 SMS = LMS) → 그 종류로 단가 · 예산 인원 · 적재.
//   마감(중복 제거 → 회신번호 제외 → 광고 관문 → 서명) = AI 한줄로와 같은 CT · 광고 관문의 기간 = 확정과 같은 함수(나눠 보내기 값 포함).
router.post('/ask/stage', async (req: Request, res: Response) => {
  let staged: string | null = null;
  let companyId = '';
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    companyId = v.companyId;
    const b = req.body || {};
    const plan = readAskPlan(b.plan);
    if (!plan) return res.status(400).json({ success: false, error: ASK_PLAN_INVALID, code: 'PLAN_INVALID' });
    const message = typeof b.message === 'string' ? b.message : '';
    if (!message.trim()) return res.status(400).json({ success: false, error: '보낼 문안이 비어 있어요.', code: 'MESSAGE_REQUIRED' });
    const split = parseSplitSetting(b.splitEnabled, b.splitCount, b.splitIntervalMinutes);
    if (!split.ok) return res.status(400).json({ success: false, error: split.error, code: split.code });
    // 나가는 종류 · 고객 원장을 찾아야 채워지는 변수가 있는가 = 발송 치환이 쓰는 매핑 이름으로(확정 · 일꾼과 같은 함수)
    const names = Object.keys(await prepareFieldMappings(v.companyId));
    const channel = lineBodySendChannel(askChannelOf(plan), message, names);
    const price = await readAskPrice(v.companyId, channel);
    const individual = b.individualCallback === true;
    const stagingId = randomUUID();
    const put = await stageAskAudience(v.companyId, v.userId, plan, price, {
      stagingId, individualCallback: individual, plainOnly: sendBodyVars(message, names).needsCustomer,
    });
    if (!put) return res.status(400).json(ASK_PRICE_UNSET);
    staged = stagingId;
    if (put.staged <= 0) {
      await dropAskStaging(v.companyId, stagingId);
      staged = null;
      return res.status(400).json({ success: false, error: '보낼 수 있는 분이 없어요.', code: 'NO_RECIPIENTS' });
    }
    const sealed = await sealServerStaging({
      stagingId, companyId: v.companyId, userId: v.userId, userType: v.userType, adEnabled: true, individualCallback: individual,
      sendPlan: {
        scheduled: b.scheduled === true, scheduledAt: typeof b.scheduledAt === 'string' ? b.scheduledAt : null,
        splitEnabled: b.splitEnabled, splitCount: b.splitCount, splitIntervalMinutes: b.splitIntervalMinutes,
      },
      branch: branchOfDirect('operator'),
    });
    if (sealed.total <= 0) {
      await dropAskStaging(v.companyId, stagingId);
      staged = null;
      const gateNote = sealed.adGateNotice ? ` ${sealed.adGateNotice}` : '';
      return res.status(400).json({ success: false, code: 'NO_RECIPIENTS', error: `중복 · 회신번호 · 수신거부를 빼면 보낼 수 있는 분이 0명이에요.${gateNote}` });
    }
    return res.json({
      success: true, stagingId, signature: sealed.signature, total: sealed.total,
      channel, unitPrice: price, amount: askAmount(sealed.total, price),
      excluded: { ...sealed.excluded, unfillable: put.unfillable },
      ...(sealed.adGateNotice !== undefined ? { adGateNotice: sealed.adGateNotice } : {}),
    });
  } catch (err: any) {
    // 적재한 뒤 마감에서 실패했으면 그 묶음을 지운다(서명을 주지 않은 명단을 남기지 않는다)
    if (staged && companyId) await dropAskStaging(companyId, staged).catch(() => undefined);
    return fail(res, err, 'ask-stage');
  }
});

// GET /ask/sent/:stagingId — 그 준비분의 접수 상태(★ C153 · 확정 응답을 못 받은 화면의 「다시 확인」 · 읽기만 · 회사 범위 · accepted · pending · none)
router.get('/ask/sent/:stagingId', async (req: Request, res: Response) => {
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    const out = await askStagingState(v.companyId, req.params.stagingId);
    if (out === null) return res.status(400).json({ success: false, error: '요청 형식이 올바르지 않아요.', code: 'STAGING_INVALID' });
    return res.json({ success: true, ...out });
  } catch (err: any) {
    return fail(res, err, 'ask-sent');
  }
});

// POST /ask/answer — 질문에 답(★ 2026-11-21 C152 B · 설계서 docs/2026-11-21-c152-snap-gap-upgrade-design.md §2-B-3)
//   답 글 + 근거 + 표(데이터 있는 것만) · 답 전체를 한 번만 걷는다(시도 표 + 질문) · 회사 전체 값 = 분류코드로 나뉜 담당자 403(판정 = services/ask-answer)
router.post('/ask/answer', async (req: Request, res: Response) => {
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (question.length < ASK_QUESTION_MIN || question.length > ASK_QUESTION_MAX) {
      return res.status(400).json({ success: false, error: `질문을 ${ASK_QUESTION_MIN}자 이상 ${ASK_QUESTION_MAX}자 안으로 적어 주세요.`, code: 'QUESTION_INVALID' });
    }
    if (!isValidAttemptToken(req.body?.attemptToken)) return res.status(400).json({ success: false, error: '요청 형식이 올바르지 않아요. 화면을 새로 고쳐 주세요.', code: 'ATTEMPT_INVALID' });
    // ★ 2026-11-22 C155 — 앞 문답(맥락 · 화면이 쥔 문답 줄) · 없으면 옛 요청 그대로 · 꼴이 틀리면 400 · 열 문답이 찼으면 새 대화로
    const history = readAskHistory(req.body?.history);
    if (history === 'invalid') return res.status(400).json({ success: false, error: ASK_HISTORY_INVALID_TEXT, code: 'HISTORY_INVALID' });
    if (history === 'full') return res.status(400).json({ success: false, error: ASK_THREAD_FULL_TEXT, code: 'THREAD_FULL' });
    const out = await answerAsk({
      user: { companyId: v.companyId, userId: v.userId || undefined, userType: v.userType || undefined },
      question, attemptToken: req.body.attemptToken, history,
    });
    return res.json({ success: true, ...out });
  } catch (err: any) {
    return fail(res, err, 'ask-answer');
  }
});

// POST /spam-test — 자동 스팸 검사(수동 검사와 같은 선불 경로 · 같은 글 24시간 재사용 · 사용자당 줄 1건)
router.post('/spam-test', async (req: Request, res: Response) => {
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    const b = req.body || {};
    const body = typeof b.body === 'string' ? b.body.trim() : '';
    if (body.length < 2 || body.length > 2000) return res.status(400).json({ success: false, error: '검사할 문안이 없어요.', code: 'BODY_INVALID' });
    const channel = readChannel(b.channel);
    if (!channel) return res.status(400).json({ success: false, error: '채널이 올바르지 않아요.', code: 'CHANNEL_INVALID' });
    const out = await startLineSpamTest(v, {
      body,
      subject: typeof b.subject === 'string' ? b.subject.slice(0, 60) : '',
      channel,
      isAd: b.isAd !== false,
      callback: typeof b.callback === 'string' ? b.callback : '',
      sampleCustomerId: typeof b.sampleCustomerId === 'string' ? b.sampleCustomerId : null,
    });
    return res.json({ success: true, ...out });
  } catch (err: any) {
    return fail(res, err, 'spam-test');
  }
});

// GET /spam-test/:id — 칩 상태(줄 대기 · 확인 중 · 통과 · 막힘 · 결과 없음)
router.get('/spam-test/:id', async (req: Request, res: Response) => {
  try {
    const v = await lineGate(req, res);
    if (!v) return;
    // 이 카드가 보낼 유형(SMS = 단문 · 그 밖 = 장문으로 검사)에 결속
    const msgType: 'SMS' | 'LMS' = String(req.query.type || '').toUpperCase() === 'SMS' ? 'SMS' : 'LMS';
    const out = await readLineSpamTest(v, String(req.params.id || ''), msgType);
    if (!out) return res.status(404).json({ success: false, error: '검사를 찾을 수 없어요.', code: 'NOT_FOUND' });
    return res.json({ success: true, ...out });
  } catch (err: any) {
    return fail(res, err, 'spam-read');
  }
});

export default router;
