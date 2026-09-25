/**
 * send-checks.ts — 직접발송 "보내기 전 점검" 서버 입구 (2026-09-25 Harold 지시)
 * 설계 SoT = docs/2026-09-25-direct-send-precheck-design.md
 *
 *   GET  /api/send-checks/status — 스팸 검사 무료 체험 · 맞춤법 검사 이번 달 사용 현황(점검 칸·안내 창)
 *   POST /api/send-checks/spell  — 문자 맞춤법 검사(미가입 = 회사 월 5회 · 요금제 = 무제한 · 크레딧 0)
 *
 * ⛔ 판정은 CT가 소유한다: 요금제 = `plan-guard` · 체험 = `spam-trial` · 맞춤법 한도 = `spell-check-quota` · 검사 = `sms-spell-check`.
 * ⛔ 검사 결과로 글을 바꾸지 않는다(고치기는 화면에서 사람이 누를 때만).
 */
import { Request, Response, Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { isActivePaidPlan, loadPlanContext } from '../utils/plan-guard';
import { readSpamTrialStatus } from '../utils/spam-trial';
import {
  DIRECT_SPELL_SOURCE, SPELL_FREE_MONTHLY_LIMIT, finishSpellUse, readSpellUsage, reserveSpellUse, takeSpellMinuteSlot,
} from '../utils/spell-check-quota';
import { checkSmsSpelling, loadSmsSpellProtectedWords } from '../utils/sms-spell-check';
import { migrationPendingBody } from '../utils/db-errors';

const router = Router();

/** 검사할 글 최대 길이(장문 2,000바이트 ≒ 한글 1,000자를 넉넉히 덮는다) */
const SPELL_MAX_CHARS = 2000;
/** 검사하지 못한 응답(횟수에서 빠진다) */
const SPELL_FAILED_BODY = {
  success: false,
  code: 'SPELL_FAILED',
  error: '맞춤법 검사를 하지 못했어요. 잠시 뒤 다시 눌러 주세요. 이번 검사는 횟수에서 빠져요.',
};

function spellView(paid: boolean, usage: { ready: boolean; usedThisMonth: number; issuesThisMonth: number }) {
  return {
    unlimited: paid,
    limit: paid ? null : SPELL_FREE_MONTHLY_LIMIT,
    used: usage.usedThisMonth,
    remaining: paid ? null : Math.max(0, SPELL_FREE_MONTHLY_LIMIT - usage.usedThisMonth),
    issuesFound: usage.issuesThisMonth,
    ready: usage.ready,
  };
}

router.get('/status', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user.companyId;
    const ctx = await loadPlanContext(companyId);
    const paid = isActivePaidPlan(ctx);
    const [spamTrial, usage] = await Promise.all([readSpamTrialStatus(companyId), readSpellUsage(companyId)]);
    return res.json({ success: true, paid, spamTrial, spell: spellView(paid, usage) });
  } catch (err) {
    console.error('[send-checks] 현황 조회 실패:', err);
    return res.status(500).json({ success: false, error: '점검 현황을 불러오지 못했습니다.' });
  }
});

router.post('/spell', authenticate, async (req: Request, res: Response) => {
  const companyId = (req as any).user.companyId;
  const userId = (req as any).user.userId || null;
  const text = String(req.body?.text ?? '');
  if (!text.trim()) return res.status(400).json({ success: false, error: '검사할 글을 먼저 적어 주세요.' });
  if ([...text].length > SPELL_MAX_CHARS) {
    return res.status(400).json({ success: false, error: `맞춤법 검사는 ${SPELL_MAX_CHARS.toLocaleString()}자까지 할 수 있어요.` });
  }
  if (!takeSpellMinuteSlot(`${companyId}:${userId || '-'}`)) {
    return res.status(429).json({ success: false, code: 'SPELL_RATE_LIMITED', error: '잠시 뒤 다시 눌러 주세요.' });
  }

  let useId: number | null = null;
  try {
    const ctx = await loadPlanContext(companyId);
    const paid = isActivePaidPlan(ctx);
    const reserved = await reserveSpellUse({ companyId, userId, monthlyLimit: paid ? null : SPELL_FREE_MONTHLY_LIMIT });
    if (!reserved.ok) {
      if (reserved.code === 'SPELL_FREE_EXHAUSTED') {
        return res.status(403).json({
          success: false,
          code: 'SPELL_FREE_EXHAUSTED',
          error: `이번 달 무료 맞춤법 검사 ${reserved.limit}번을 모두 쓰셨어요.`,
          used: reserved.used,
          limit: reserved.limit,
        });
      }
      return res.status(503).json(migrationPendingBody('spell_check_uses CREATE TABLE'));
    }
    useId = reserved.useId;

    const words = await loadSmsSpellProtectedWords(companyId);
    const r = await checkSmsSpelling({
      companyId, userId, text, protectedWords: words, source: DIRECT_SPELL_SOURCE,
      // 단문 90바이트 잠금은 화면이 한다 — 발송 바이트는 명단 값·(광고)·수신거부 줄까지 더해 화면만 정확히 안다.
      smsByteLimit: null,
    });
    const recorded = await finishSpellUse(useId, companyId, { failed: r.failed, issueCount: r.issues.length });
    useId = null;
    // ★Codex 5R: 무료 회사는 원장에 done 으로 남은 검사만 결과를 준다(수명 지남·기록 오류 = 한도 밖 결과를 내주지 않는다).
    if (!r.failed && !recorded && !paid) return res.status(502).json(SPELL_FAILED_BODY);
    // ★Codex 4R: 검사는 끝났다 — 사용량 요약 조회가 실패해도 결과는 돌려준다(spell: null = 화면이 기존 표시 유지).
    const usage = await readSpellUsage(companyId).catch((err: any) => {
      console.warn('[send-checks] 사용량 조회 실패(결과는 그대로 반환):', err?.message);
      return null;
    });
    return res.json({
      success: true,
      textHash: r.textHash,
      issues: r.issues,
      failed: r.failed,
      spell: usage ? spellView(paid, usage) : null,
    });
  } catch (err: any) {
    await finishSpellUse(useId, companyId, { failed: true, issueCount: 0 });
    console.error('[send-checks] 맞춤법 검사 실패:', err?.message || err);
    return res.status(502).json(SPELL_FAILED_BODY);
  }
});

export default router;
