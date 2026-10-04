/**
 * planner-channel-gate.ts — 플래너 채널 준비 판정 CT (★ 2026-08-12 Phase 1 · ★ 2026-10-04 보강 F2 = 판정 한 곳)
 *
 * **계약: 필수 재료가 없으면 그 채널은 정직하게 잠그고, 잠긴 이유를 그 자리에서 말한다.**
 * 기능 가능 여부는 고객사 데이터가 결정한다 — 정답표 하드코딩 금지(영구 원칙).
 *
 * ★ 2026-10-04 F2 — 옛 판정은 "발신번호가 하나라도 있다 · 이메일 고객이 있다"만 봐서, 기입·결재를 통과한 행사가
 *   발송 날에야 "기본 발신번호 없음 · 080 없음 · 회사 메일 미연결"로 잠겼다(돈은 이미 나간 뒤). 판정을 이 파일 하나로 모으고
 *   **재료 창(기입) · 승인 · 발송 당일 세 곳이 같은 함수를 부른다**(설계서 §3-7 · §6-10).
 *   sms   → 기본 발신번호(is_default) + 광고 무료거부 080(사용자 → 회사 · getOpt080Number = 발송부와 같은 CT)
 *   dm    → 요금제(mobile_dm) + 완성본 엔진 개방 + **문자 준비**(DM은 문자 1통에 링크로 실려 나간다)
 *   email → 요금제(CDP 축) + 회사 메일 연결(emailSmtpBlocker = 완성·발송 라우트와 같은 CT) + 이메일 보유 고객 + 엔진 개방
 *   inapp · alimtalk → 1차 밖(설계서 Q6) — 기입에서 고르지 못한다.
 *
 * 판정 실패(조회 오류)는 잠금 + "확인 실패" — **못 확인한 것을 열어주지 않는다**(fail-closed).
 * `phase` = 'plan'(기입·승인: 완성본을 만들 수 있어야 한다) / 'send'(발송 당일: 이미 만든 소재를 보낼 수 있어야 한다).
 */
import { query } from '../config/database';
import { loadPlanContext, canUseFeature } from './plan-guard';
import { getOpt080Number } from './messageUtils';
import { emailSmtpBlocker } from './email/email-send-gate';
import { aiAutoBuildEnabled } from './ai-auto-build-materials';
import { isCdpEnabledForPlan } from './cdp-auth';
import { PLANNER_CHANNELS, PlannerChannel, estimateChannelCredits } from './marketing-planner';
import { READINESS_REASON, ReadinessCode } from './planner-reasons';

/** 1차 채널(설계서 Q6) — 인앱 · 알림톡 · 참여 체인은 2차. */
export const PLANNER_PHASE1_CHANNELS: PlannerChannel[] = ['sms', 'dm', 'email'];

export function isPhase1Channel(channel: PlannerChannel): boolean {
  return PLANNER_PHASE1_CHANNELS.includes(channel);
}

export interface ChannelReadiness {
  ok: boolean;
  code: ReadinessCode | null;
  /** 고객 문장(내부 코드명 0) · ok면 null */
  reason: string | null;
  /** 풀 수 있는 설정 화면(있으면) */
  settingsPath: string | null;
}

export interface ChannelAvailability extends ChannelReadiness {
  channel: PlannerChannel;
  /** 하위 호환 — 기입 화면이 읽던 이름(= ok) */
  available: boolean;
  /** 표시용 예상 제작 크레딧(실제 금액은 서버 견적만 · null = 실행 시 별도) */
  estCredits: number | null;
}

const OK: ChannelReadiness = { ok: true, code: null, reason: null, settingsPath: null };

export function blocked(code: ReadinessCode): ChannelReadiness {
  return { ok: false, code, reason: READINESS_REASON[code].text, settingsPath: READINESS_REASON[code].path };
}

export interface ReadinessDeps {
  hasDefaultCallback: (companyId: string) => Promise<boolean>;
  opt080: (userId: string | null, companyId: string) => Promise<string>;
  dmPlanAllowed: (companyId: string) => Promise<boolean>;
  emailPlanAllowed: (companyId: string) => Promise<boolean>;
  smtpReady: (companyId: string) => Promise<boolean>;
  hasEmailCustomers: (companyId: string) => Promise<boolean>;
  autoBuildEnabled: (companyId: string) => boolean;
}

export const defaultReadinessDeps: ReadinessDeps = {
  hasDefaultCallback: async (companyId) => {
    // 발송부(loadDefaultCallback)와 같은 조건 — 기본 지정이 없으면 발송이 잠긴다.
    const r = await query(`SELECT 1 FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1`, [companyId]);
    return r.rows.length > 0;
  },
  opt080: (userId, companyId) => getOpt080Number(userId, companyId),
  dmPlanAllowed: async (companyId) => {
    const ctx = await loadPlanContext(companyId);
    return !!ctx && canUseFeature(ctx, 'mobile_dm').allowed;
  },
  emailPlanAllowed: (companyId) => isCdpEnabledForPlan(companyId),
  smtpReady: async (companyId) => (await emailSmtpBlocker(companyId)) == null,
  hasEmailCustomers: async (companyId) => {
    const r = await query(
      `SELECT 1 FROM customers WHERE company_id = $1 AND email IS NOT NULL AND email <> '' LIMIT 1`,
      [companyId],
    );
    return r.rows.length > 0;
  },
  autoBuildEnabled: (companyId) => aiAutoBuildEnabled(companyId),
};

/** 문자 준비 — 문자 접점과 DM 캐리어가 같은 판정을 쓴다. */
async function smsReadiness(companyId: string, userId: string | null, deps: ReadinessDeps): Promise<ChannelReadiness> {
  if (!(await deps.hasDefaultCallback(companyId))) return blocked('NO_DEFAULT_CALLBACK');
  if (!String(await deps.opt080(userId, companyId) || '').trim()) return blocked('NO_080');
  return OK;
}

/**
 * 채널 1개의 준비 판정 — 재료 창 · 승인 · 발송 당일이 같은 함수를 부른다.
 * `userId` = 080 번호의 주인(기입 화면 = 지금 사용자 · 승인·발송 = 행사를 만든 계정 · 발송부와 같은 축).
 * 조회 실패는 throw하지 않고 CHECK_FAILED로 잠근다(fail-closed · 호출부가 사유를 그대로 말한다).
 */
export async function checkChannelReadiness(
  channel: PlannerChannel,
  ctx: { companyId: string; userId: string | null; phase: 'plan' | 'send' },
  deps: ReadinessDeps = defaultReadinessDeps,
): Promise<ChannelReadiness> {
  try {
    if (!isPhase1Channel(channel)) return blocked('NOT_IN_PHASE1');
    if (channel === 'sms') return await smsReadiness(ctx.companyId, ctx.userId, deps);
    if (channel === 'dm') {
      if (ctx.phase === 'plan') {
        if (!(await deps.dmPlanAllowed(ctx.companyId))) return blocked('DM_PLAN');
        if (!deps.autoBuildEnabled(ctx.companyId)) return blocked('AUTO_BUILD_OFF');
      }
      return await smsReadiness(ctx.companyId, ctx.userId, deps);
    }
    // email
    if (ctx.phase === 'plan') {
      if (!(await deps.emailPlanAllowed(ctx.companyId))) return blocked('EMAIL_PLAN');
      if (!deps.autoBuildEnabled(ctx.companyId)) return blocked('AUTO_BUILD_OFF');
      if (!(await deps.hasEmailCustomers(ctx.companyId))) return blocked('NO_EMAIL_CUSTOMERS');
    }
    if (!(await deps.smtpReady(ctx.companyId))) return blocked('SMTP_NOT_CONFIGURED');
    return OK;
  } catch (err: any) {
    console.warn(`[planner-gate] ${channel} 판정 실패(fail-closed):`, err?.message || err);
    return blocked('CHECK_FAILED');
  }
}

/** 여러 채널의 준비 판정을 한 번에(같은 채널은 한 번만 묻는다) — 첫 잠금을 돌려준다. */
export async function firstBlockedChannel(
  channels: PlannerChannel[],
  ctx: { companyId: string; userId: string | null; phase: 'plan' | 'send' },
  deps: ReadinessDeps = defaultReadinessDeps,
): Promise<{ channel: PlannerChannel; readiness: ChannelReadiness } | null> {
  for (const channel of Array.from(new Set(channels))) {
    const readiness = await checkChannelReadiness(channel, ctx, deps);
    if (!readiness.ok) return { channel, readiness };
  }
  return null;
}

/** 기입 화면 체크박스의 소스 — 1차 채널만 돌려준다(인앱·알림톡은 화면에 나오지 않는다 · Q6). */
export async function getPlannerChannelAvailability(companyId: string, userId: string | null = null): Promise<ChannelAvailability[]> {
  return Promise.all(
    PLANNER_CHANNELS.filter(isPhase1Channel).map(async (channel): Promise<ChannelAvailability> => {
      const r = await checkChannelReadiness(channel, { companyId, userId, phase: 'plan' });
      return { ...r, channel, available: r.ok, estCredits: estimateChannelCredits(channel) };
    }),
  );
}
