/**
 * planner-channel-gate.ts — 플래너 채널 가용성 판정 CT (★ 2026-08-12 Phase 1 · 설계서 §4-2)
 *
 * **계약: 필수 재료가 없으면 그 채널은 정직하게 잠그고, 잠긴 이유를 그 자리에서 말한다.**
 * 기능 가능 여부는 고객사 데이터가 결정한다 — 정답표 하드코딩 금지(영구 원칙).
 *
 * 판정은 전부 **기존 신호 재사용**이다. 새 판정 로직을 만들지 않는다:
 *   sms     → `callback_numbers` 보유 (발신번호 없이는 어떤 문자도 못 나간다)
 *   alimtalk→ `kakao_sender_profiles` 보유 (프로필 없으면 검수 대행 §5-6도 시작 못 한다)
 *   email   → 이메일 보유 고객 존재 (customers.email)
 *   dm      → 요금제 `mobile_dm_enabled` (plan-guard가 진실 — plan_code 하드코딩 금지)
 *   inapp   → `getInAppDisplayEligibility` (SDK 설치 몰 판정 CT 그대로)
 *
 * 판정 실패(쿼리 오류)는 available=false + "확인 실패" 사유 — **못 확인한 것을 열어주지 않는다**(fail-closed).
 */
import { query } from '../config/database';
import { loadPlanContext } from './plan-guard';
import { getInAppDisplayEligibility } from './inapp-display-eligibility';
import { PLANNER_CHANNELS, PlannerChannel, estimateChannelCredits } from './marketing-planner';

export interface ChannelAvailability {
  channel: PlannerChannel;
  available: boolean;
  /** 잠금 사유(고객 언어 — 내부 코드명·테이블명 금지). available=true면 null */
  reason: string | null;
  /** 소재 제작 예상 크레딧. null = 실행 시 별도(문자·알림톡) */
  estCredits: number | null;
}

async function checkOne(channel: PlannerChannel, companyId: string): Promise<{ available: boolean; reason: string | null }> {
  switch (channel) {
    case 'sms': {
      const r = await query(`SELECT 1 FROM callback_numbers WHERE company_id = $1 LIMIT 1`, [companyId]);
      return r.rows.length > 0
        ? { available: true, reason: null }
        : { available: false, reason: '등록된 발신번호가 없습니다. 발신번호 등록 후 이용할 수 있습니다.' };
    }
    case 'alimtalk': {
      const r = await query(`SELECT 1 FROM kakao_sender_profiles WHERE company_id = $1 LIMIT 1`, [companyId]);
      return r.rows.length > 0
        ? { available: true, reason: null }
        : { available: false, reason: '카카오 발신프로필이 없습니다. 채널 연결 후 이용할 수 있습니다.' };
    }
    case 'email': {
      const r = await query(
        `SELECT 1 FROM customers WHERE company_id = $1 AND email IS NOT NULL AND email <> '' LIMIT 1`,
        [companyId],
      );
      return r.rows.length > 0
        ? { available: true, reason: null }
        : { available: false, reason: '이메일이 등록된 고객이 없습니다. 고객 데이터에 이메일이 있어야 보낼 수 있습니다.' };
    }
    case 'dm': {
      const ctx = await loadPlanContext(companyId);
      return ctx?.features?.mobile_dm_enabled
        ? { available: true, reason: null }
        : { available: false, reason: '모바일 DM은 현재 요금제에서 제공되지 않습니다.' };
    }
    case 'inapp': {
      const e = await getInAppDisplayEligibility(companyId);
      return e.canCreateWeb
        ? { available: true, reason: null }
        : { available: false, reason: e.blockReasonWeb || '인앱 메시지를 표시할 수 있는 쇼핑몰 연동이 없습니다.' };
    }
  }
}

/** 회사의 채널 5종 가용성 — 축별 실패 격리(한 판정이 죽어도 나머지는 산다). */
export async function getPlannerChannelAvailability(companyId: string): Promise<ChannelAvailability[]> {
  return Promise.all(
    PLANNER_CHANNELS.map(async (channel): Promise<ChannelAvailability> => {
      try {
        const { available, reason } = await checkOne(channel, companyId);
        return { channel, available, reason, estCredits: estimateChannelCredits(channel) };
      } catch (err: any) {
        console.warn(`[planner-gate] ${channel} 판정 실패(fail-closed):`, err?.message || err);
        return {
          channel,
          available: false,
          reason: '채널 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
          estCredits: estimateChannelCredits(channel),
        };
      }
    }),
  );
}
