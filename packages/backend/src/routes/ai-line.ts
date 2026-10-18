/**
 * routes/ai-line.ts — AI 한줄로 (`/api/ai-line` · ★ 2026-10-18 · 설계서 docs/2026-10-18-ai-line-design.md §5 · §7 · §8)
 *
 * read(AI 0) → intake(대상 AI · 기본 2) → recount(0) → compose(문안 2 × 종류) / proceed(직접입력 · 알림톡 = 기본만) → decorate(1)
 * 게이트 = 로그인 · AI 오퍼레이터 요금제(isAiOperatorAllowed) · 새 흐름 스위치(AI_LINE_V2_COMPANY_IDS). read 는 스위치만 알려 준다.
 * 실패 응답 = { success:false, error, code } · 크레딧 부족 402 INSUFFICIENT_CREDIT · 원장 조회 실패 503.
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import { loadPlanContext, isAiOperatorAllowed } from '../utils/plan-guard';
import { InsufficientCreditError } from '../utils/ai-credit';
import { isValidAttemptToken } from '../utils/one-line-facts';
import { isValidLinePeriodEnd } from '../utils/one-line-steps';
import { validateAnswer } from '../utils/content-interview';
import { runInCreditBundle } from '../utils/ai-credit-context';
import { matchAlimtalkTemplate } from '../utils/alimtalk-ai-matcher';
import { aiLineEnabled, readAiLine, sanitizeLineTypes } from '../utils/ai-line';
import {
  AiLineError, aiLineBasePaid, aiLineVarTokens,
  runLineIntake, runLineRecount, runLineProceed, runLineCompose, runLineDecorate,
  type AiLineViewer,
} from '../services/ai-line';
import { startLineSpamTest, readLineSpamTest } from '../services/ai-line-spam';

const router = Router();
router.use(authenticate);

const LINE_MIN = 5;
const LINE_MAX = 2000;

function viewerOf(req: Request): AiLineViewer | null {
  const companyId = req.user?.companyId;
  if (!companyId) return null;
  return { companyId, userId: req.user?.userId || null, userType: req.user?.userType || null };
}

/** 요금제 · 스위치 — 통과면 viewer, 아니면 응답을 보내고 null */
async function gate(req: Request, res: Response): Promise<AiLineViewer | null> {
  const v = viewerOf(req);
  if (!v) { res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' }); return null; }
  const plan = await loadPlanContext(v.companyId);
  if (!plan) { res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' }); return null; }
  if (!isAiOperatorAllowed(plan, req.user)) {
    res.status(403).json({ success: false, error: '이 기능은 요금제 가입 후 이용할 수 있어요.', code: 'BETA_GATE' });
    return null;
  }
  if (!aiLineEnabled(v.companyId)) {
    res.status(400).json({ success: false, error: '이 기능은 아직 열리지 않았습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.', code: 'FEATURE_DISABLED' });
    return null;
  }
  return v;
}

function readLine(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t.length >= LINE_MIN && t.length <= LINE_MAX ? t : null;
}

const isPlainObject = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** facts = { benefit: string|null|undefined, period_end: 'YYYY-MM-DD'|null|undefined } · 틀리면 'invalid' */
function readFacts(raw: unknown): { benefit: string | null; periodEnd: string | null } | 'invalid' {
  if (raw === undefined || raw === null) return { benefit: null, periodEnd: null };
  if (!isPlainObject(raw)) return 'invalid';
  const b = raw.benefit;
  if (b !== undefined && b !== null && !validateAnswer('benefit', b).ok) return 'invalid';
  const pe = raw.period_end;
  if (pe !== undefined && pe !== null && !isValidLinePeriodEnd(pe, Date.now())) return 'invalid';
  return { benefit: typeof b === 'string' && b.trim() ? b.trim() : null, periodEnd: typeof pe === 'string' ? pe : null };
}

function readChannel(raw: unknown): 'SMS' | 'LMS' | 'MMS' | null {
  const c = String(raw || '').toUpperCase();
  return c === 'SMS' || c === 'LMS' || c === 'MMS' ? c : null;
}

function readVars(raw: unknown): string[] | 'invalid' {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return 'invalid';
  const allowed = aiLineVarTokens();
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
  const msg = String(err?.message || '');
  console.error(`[ai-line ${where}] 오류:`, msg);
  return res.status(500).json({ success: false, error: '처리 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.' });
}

// POST /read — AI 0 · DB 0 · 무과금(스위치 밖 = enabled:false · 화면은 지금 흐름)
router.post('/read', async (req: Request, res: Response) => {
  const v = viewerOf(req);
  if (!v) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  const enabled = aiLineEnabled(v.companyId);
  const line = typeof req.body?.line === 'string' ? req.body.line.slice(0, LINE_MAX) : '';
  return res.json({ success: true, enabled, ...(enabled ? readAiLine(line) : {}) });
});

// POST /intake — 대상 AI · 승인 발송과 같은 세기 · 1위 고객 · 칼럼 채움 · 기본 2(1명 이상)
router.post('/intake', async (req: Request, res: Response) => {
  try {
    const v = await gate(req, res);
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
    const v = await gate(req, res);
    if (!v) return;
    const filters = isPlainObject(req.body?.filters) ? req.body.filters : {};
    const out = await runLineRecount(v, filters, req.body?.allCustomers === true);
    return res.json({ success: true, ...out });
  } catch (err: any) {
    return fail(res, err, 'recount');
  }
});

// POST /proceed — 직접입력만 · 알림톡 갈래 = 대상 확정 + 기본(아직이면)
router.post('/proceed', async (req: Request, res: Response) => {
  try {
    const v = await gate(req, res);
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
    const v = await gate(req, res);
    if (!v) return;
    const b = req.body || {};
    const line = readLine(b.line);
    if (!line) return res.status(400).json({ success: false, error: '한 줄을 5자 이상 적어 주세요.', code: 'LINE_INVALID' });
    const facts = readFacts(b.facts);
    if (facts === 'invalid') return res.status(400).json({ success: false, error: '혜택 · 기간 답이 올바르지 않아요.', code: 'FACTS_INVALID' });
    const types = sanitizeLineTypes(b.types);
    if (types === 'invalid') return res.status(400).json({ success: false, error: '만들 문안 종류를 골라 주세요.', code: 'TYPES_INVALID' });
    const vars = readVars(b.vars);
    if (vars === 'invalid') return res.status(400).json({ success: false, error: '고른 칼럼을 쓸 수 없어요. 확인 판을 다시 열어 주세요.', code: 'VARS_INVALID' });
    const channel = readChannel(b.channel);
    if (!channel) return res.status(400).json({ success: false, error: '채널이 올바르지 않아요.', code: 'CHANNEL_INVALID' });
    if (!isValidAttemptToken(b.attemptToken)) return res.status(400).json({ success: false, error: '요청 형식이 올바르지 않아요. 화면을 새로 고쳐 주세요.', code: 'ATTEMPT_INVALID' });
    const out = await runLineCompose(v, {
      line, facts, filters: isPlainObject(b.filters) ? b.filters : {}, allCustomers: b.allCustomers === true,
      types, vars, channel, isAd: b.isAd !== false, attemptToken: b.attemptToken,
    });
    return res.json({ success: true, ...out });
  } catch (err: any) {
    return fail(res, err, 'compose');
  }
});

// POST /decorate — 고른 문안 1개에 칼럼을 더 넣는다 · 1(글이 바뀐 때만)
router.post('/decorate', async (req: Request, res: Response) => {
  try {
    const v = await gate(req, res);
    if (!v) return;
    const b = req.body || {};
    const body = typeof b.body === 'string' ? b.body.trim() : '';
    if (body.length < 5 || body.length > 2000) return res.status(400).json({ success: false, error: '꾸밀 문안이 너무 짧거나 길어요.', code: 'BODY_INVALID' });
    const vars = readVars(b.vars);
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
    const v = await gate(req, res);
    if (!v) return;
    const line = readLine(req.body?.line);
    if (!line) return res.status(400).json({ success: false, error: '한 줄을 5자 이상 적어 주세요.', code: 'LINE_INVALID' });
    const paid = await aiLineBasePaid(v.companyId, line, new Date());   // 원장 조회 실패 = 503(AiLineError)
    if (!paid) return res.status(409).json({ success: false, error: '대상을 먼저 찾아 주세요.', code: 'BASE_REQUIRED' });
    const m = await runInCreditBundle(() => matchAlimtalkTemplate({ companyId: v.companyId, campaignObjective: line }));
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
    return res.json({ success: true, matched: m.matched, templates: list, mappings: m.variableMappings, suggestion: m.suggestion });
  } catch (err: any) {
    return fail(res, err, 'alimtalk-match');
  }
});

// POST /spam-test — 자동 스팸 검사(수동 검사와 같은 선불 경로 · 같은 글 24시간 재사용 · 사용자당 줄 1건)
router.post('/spam-test', async (req: Request, res: Response) => {
  try {
    const v = await gate(req, res);
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
    const v = await gate(req, res);
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
