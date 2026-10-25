/**
 * ★ 2026-10-25 원장 #38 · #40 · #62 — 서버가 가진 발송 규칙 값(GET /api/send-policy · 무인증 · 비밀 0).
 *   발송 가능 시각(SEND_HOURS · 환경 변수로 바뀐다) · 야간 이월 시각 · 플래너 승인 마감 · 확인 요청 선행일 · 플래너 문안 상한.
 *   화면은 이 값으로만 말한다(옛: 화면마다 8 · 21 · 20 · 3 · 1000 을 숫자로 따로 적었다 · 환경 변수를 바꾸면 화면만 거짓).
 */
import { Router, Request, Response } from 'express';
import { SEND_HOURS } from '../config/defaults';
import { NIGHT_ARRIVE_HOUR } from '../utils/send-time-util';
import { PLANNER_APPROVAL_DEADLINE_HOUR } from '../utils/planner-confirm';
import { PLANNER_LINK_LEAD_DAYS } from '../utils/planner-review';
import { PLANNER_COPY_MAX } from '../utils/planner-copy';

export function sendPolicyValues() {
  return {
    startHour: SEND_HOURS.start,
    endHour: SEND_HOURS.end,
    nightArriveHour: NIGHT_ARRIVE_HOUR,
    plannerDeadlineHour: PLANNER_APPROVAL_DEADLINE_HOUR,
    plannerReviewLeadDays: PLANNER_LINK_LEAD_DAYS,
    plannerCopyMax: PLANNER_COPY_MAX,
  };
}

const router = Router();
router.get('/', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'public, max-age=300');
  return res.json({ success: true, policy: sendPolicyValues() });
});

export default router;
