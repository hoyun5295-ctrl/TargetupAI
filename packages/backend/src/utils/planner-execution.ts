/**
 * planner-execution.ts — 마케팅 플래너 실행 축 판정 CT (순수 · ★ 2026-08-13 Phase 3·4)
 *
 * 인계 원장 = docs/2026-08-13-planner-phase34-handoff.md (§3 재사용 표 · §4 순서)
 * 기능 상설 = docs/FEATURE-MARKETING-PLANNER.md (불변 원칙 §3 · 요금 §5)
 *
 * 이 파일이 소유하는 것 = **실행이 쓰는 판정 전부(DB·AI 미import → 순수 테스트)**:
 *   실행 창 판정 · 멱등키 · 대상 축(전체/참여자) · 취소 환불 자격 · 알림톡 정보성 문안 ·
 *   문안 생성 지시문 · 리드타임(영업일) · 참여 버튼 섹션.
 * DB를 만지는 것은 planner-executor / planner-production / planner-alimtalk / planner-reconcile이 하고,
 * 그것들은 여기 판정을 부르기만 한다 — 인라인 판정 금지.
 *
 * ⛔ 불변 (기능 문서 §3)
 *   - 미승인 = 미발송 = 미차감. 실행 대상은 **승인된 행사의 터치포인트뿐**이다.
 *   - 혜택은 고객사 기입 verbatim — 여기서 생성·보정·요약하지 않는다.
 *   - 발송 예정일은 저장하지 않는다(computeTouchpointDate 계산). 실행 창도 그 계산값으로 본다.
 *   - 알림톡은 정보성 안내 전용 — 혜택·할인·광고 표현을 **문안 조립 단계에서 구조적으로 배제**한다.
 *   - 0건·재료 없음·크레딧 부족은 자동완화하지 않는다. 보류·생략 + 사유 통지가 정답이다.
 */
import { PlannerChannel, TimingRule } from './marketing-planner';

// ── 요금 축 ──────────────────────────────────────────────────────────
/**
 * 문자 문안 당일 생성 source. 단가는 CREDIT_COST_MAP이 소유한다(여기 숫자를 쓰지 않는다).
 * ⛔ OPERATION_SOURCES에 넣지 않는다 — 플래너는 마이너스·자동충전 금지가 확정 정책이라
 *   잔액이 없으면 그 터치포인트만 보류(hold_credit)되고 통지가 나가야 한다.
 */
export const PLANNER_SEND_SOURCE = 'planner-touchpoint-send';

/**
 * ⛔ 제작물 과금 멱등키는 **그 채널이 원래 쓰는 키**다(`email-campaign-complete:{id}` ·
 *   `dm-publish:{id}` · `inapp-publish:{id}` — planner-production이 조립).
 *   플래너 전용 키를 만들면 같은 제작물이 화면 경로에서 한 번 더 과금된다.
 *   여기 남는 키는 라우트에 대응 키가 없는 **DM 생성분**뿐이다.
 */
export function plannerProduceGenKey(touchpointId: string): string {
  return `planner-produce-gen:${touchpointId}`;
}
/** 당일 문안 생성 멱등키 — 터치포인트 고정(같은 날 재시도가 두 번 과금되지 않는다). */
export function plannerSendKey(touchpointId: string): string {
  return `planner-send:${touchpointId}`;
}
/**
 * 대행 환불 멱등키 — 회사·월·**결제 회차** 고정(차감 키와 짝).
 *
 * ⛔ 회차(cycle)가 왜 필요한가: 승인 → 무작업 취소·환불 → 같은 달 새 계획 → 재승인이 가능하다.
 *   키가 월 고정이면 재승인의 차감이 duplicate로 끝나 **무료 대행**이 되고, 두 번째 환불도 막힌다.
 *   회차 = 그 달의 환불 수. 회차 0의 키는 종전 문자열과 같아 기존 원장이 그대로 유효하다.
 */
export function plannerRefundKey(companyId: string, planMonth: string, cycle = 0): string {
  const base = `planner-refund:${companyId}:${planMonth}`;
  return cycle > 0 ? `${base}#${cycle}` : base;
}

/** 대행 차감 멱등키 — 회사·월·결제 회차. 회차 0 = 종전 키(`planner:{회사}:{월}`). */
export function plannerAgencyDeductKey(companyId: string, planMonth: string, cycle = 0): string {
  const base = `planner:${companyId}:${planMonth}`;
  return cycle > 0 ? `${base}#${cycle}` : base;
}

/**
 * 플래너 담당자 통지 머리말 — 자동마케팅 문자와 섞이지 않게 축을 밝힌다.
 * ⛔ 여기(순수 모듈)에 두는 이유: 통지는 결재·제작·실행·대조 네 축이 모두 쓴다. 결재 CT에 두면
 *   원장 접근 CT가 결재 CT를 import해 순환이 생긴다.
 */
export const PLANNER_NOTICE_HEADER = '[한줄로 마케팅 플래너 안내문자]';

// ── 시각 ─────────────────────────────────────────────────────────────
/** (순수) KST 기준 'YYYY-MM-DD'. 예정일이 문자열 축이라 비교도 문자열로 한다(타임존 변환 섞기 금지). */
export function kstDateString(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** (순수) KST 기준 'YYYY-MM'. */
export function kstMonthString(now: Date = new Date()): string {
  return kstDateString(now).slice(0, 7);
}

/**
 * (순수) 실행 창 판정 — **예정일 당일만 실행한다.**
 *  - 'due'    = 오늘이다 → 실행.
 *  - 'future' = 아직이다 → 다음 주기에 다시 본다.
 *  - 'missed' = 지났다 → 실행하지 않는다. 대조 워커가 사유와 함께 생략으로 닫는다.
 * 지난 날짜를 뒤늦게 보내면 "그날이 왔다"가 깨진다(끝난 행사 안내가 나간다).
 */
export function classifyExecutionWindow(scheduledOn: string, today: string): 'due' | 'future' | 'missed' {
  if (scheduledOn === today) return 'due';
  return scheduledOn > today ? 'future' : 'missed';
}

/**
 * 실행 선점 lease(분) — 이 시간을 넘긴 producing은 고아로 보고 대조 워커가 회수한다.
 * ★ 2026-08-13 Codex 3R: 30 → 60. 스팸 실테스트(재생성 2회)와 대량 이메일 발송이 30분을 넘길 수 있고,
 *   그때 회수가 **살아 있는 작업의 행을 되돌려** 두 워커가 같은 행을 잡는다.
 *   회수는 그 위에 **소유권 값 CAS**(claimed_at 일치)로 한 겹 더 막고, 긴 단계 앞에서는 heartbeat로 갱신한다.
 */
export const PLANNER_CLAIM_LEASE_MINUTES = 60;

// ── 채널 축 ──────────────────────────────────────────────────────────
/** 소재를 만들어 두는 채널(승인 후 제작) — 문자·알림톡은 실행 축에서 문안이 생긴다. */
export const PLANNER_MATERIAL_CHANNELS: PlannerChannel[] = ['email', 'dm', 'inapp'];

export function isMaterialChannel(channel: PlannerChannel): boolean {
  return PLANNER_MATERIAL_CHANNELS.includes(channel);
}

/** 대상 축 — 전체 수신 가능 고객 / 그 행사 참여 신청자. */
export type PlannerAudienceMode = 'all' | 'participants';

/**
 * (순수) 그 터치포인트가 누구에게 가는가.
 * ⛔ 알림톡은 **언제나 참여자**다(기능 문서 §3-4 — 정보성 안내 채널이라 관계 근거가 대상 조건이다).
 *   그 밖 채널은 기입에서 고른 값(timing_rule.audience)을 따르고, 미지정은 전체다.
 */
export function resolveAudienceMode(channel: PlannerChannel, rule: TimingRule | null | undefined): PlannerAudienceMode {
  if (channel === 'alimtalk') return 'participants';
  return (rule as any)?.audience === 'participants' ? 'participants' : 'all';
}

/** (순수) 시점 라벨 — 통지·브리핑 문구에 쓰는 고객 언어. */
export function describeTiming(rule: TimingRule | null | undefined): string {
  const anchor = (rule as any)?.anchor;
  if (anchor === 'end') return '행사 종료일';
  if (anchor === 'before_start') return `행사 시작 ${Number((rule as any)?.offsetDays) || 0}일 전`;
  return '행사 시작일';
}

// ── 문안 생성 지시문 ─────────────────────────────────────────────────
export interface PlannerEventFacts {
  title: string;
  startsOn: string;
  endsOn: string;
  benefitText: string | null;
  products: Array<{ name: string }>;
}

/**
 * (순수) 당일 문자 문안 생성 지시문(orchestrate objective).
 * ⛔ 혜택은 **고객사가 쓴 문장을 그대로** 넣는다. 여기서 수치를 만들거나 다듬지 않는다.
 *   혜택 칸이 비면 지시문에 혜택을 넣지 않고, 대신 실행부가 placeholder 잔존을 검사해 보류한다.
 */
export function buildPlannerCopyObjective(ev: PlannerEventFacts, channelLabel: string, timingLabel: string): string {
  const lines = [
    `행사 '${ev.title}' 안내 문자를 작성한다. (${channelLabel} · ${timingLabel} 발송)`,
    `행사 기간: ${ev.startsOn} ~ ${ev.endsOn}`,
  ];
  if (ev.benefitText && ev.benefitText.trim()) {
    lines.push(`고객사가 직접 기입한 혜택(문구를 그대로 인용할 것, 수치·조건을 만들거나 바꾸지 말 것): ${ev.benefitText.trim()}`);
  }
  const names = (ev.products || []).map((p) => p?.name).filter(Boolean).slice(0, 10);
  if (names.length > 0) lines.push(`행사 상품: ${names.join(', ')}`);
  lines.push('행사 기간과 위 내용만 근거로 쓴다. 기입되지 않은 할인율·금액·쿠폰·사은품을 만들지 않는다.');
  return lines.join('\n');
}

/** (순수) DM 소재 생성 지시문 — 행사 원문(eventText) 축과 같은 재료를 쓴다. */
export function buildPlannerEventText(ev: PlannerEventFacts): string {
  const lines = [`[행사명] ${ev.title}`, `[기간] ${ev.startsOn} ~ ${ev.endsOn}`];
  if (ev.benefitText && ev.benefitText.trim()) lines.push(`[혜택] ${ev.benefitText.trim()}`);
  const names = (ev.products || []).map((p) => p?.name).filter(Boolean).slice(0, 30);
  if (names.length > 0) lines.push(`[상품] ${names.join(', ')}`);
  return lines.join('\n');
}

// ── 알림톡 정보성 문안 ───────────────────────────────────────────────
/**
 * 광고로 읽히는 표현 — 알림톡 문안 조립·검수 제출 전 자가 검사에 쓴다.
 * 검수가 광고성을 반려하므로 이건 품질이 아니라 **통과 조건**이다(기능 문서 §3-4).
 */
const AD_WORDS = ['할인', '세일', 'SALE', '쿠폰', '무료', '사은품', '특가', '이벤트 당첨', '광고', '％', '%'];

/** (순수) 그 문안에 광고성 표현이 있는가 — 있으면 알림톡으로 내보내지 않는다. */
export function hasAdToneForAlimtalk(body: string): boolean {
  const t = String(body || '');
  return AD_WORDS.some((w) => t.includes(w));
}

/**
 * (순수) 알림톡 정보성 안내 문안 — **AI를 쓰지 않는다.**
 * 참여 신청자에게 보내는 접수 확인·시작 안내이므로 담을 사실이 정해져 있고,
 * 자유 생성은 혜택 표현이 섞여 검수에서 반려되는 위험만 만든다(원가도 0이 된다).
 * 변수(#{...})를 쓰지 않는다 — 치환 축이 없어야 발송 스펙이 가장 단순하고 검수도 통과하기 쉽다.
 */
export function buildAlimtalkNoticeBody(ev: PlannerEventFacts, companyName: string, variant = 1): string {
  if (variant >= 2) {
    // 재제출본 — 문장을 더 줄인다(반려 사유가 대체로 "안내 성격이 불분명"이라 사실만 남긴다).
    return [
      `[${companyName}] 안내`,
      '',
      `'${ev.title}' 일정 안내입니다.`,
      `기간: ${ev.startsOn} ~ ${ev.endsOn}`,
    ].join('\n');
  }
  return [
    `[${companyName}] 행사 안내`,
    '',
    `신청하신 '${ev.title}' 행사 안내입니다.`,
    `행사 기간: ${ev.startsOn} ~ ${ev.endsOn}`,
    '',
    '본 메시지는 신청 내용에 대한 안내입니다.',
  ].join('\n');
}

/** (순수) 알림톡 템플릿 이름 — 회사·행사로 식별되게(검수 화면에서 사람이 찾는다). */
export function buildAlimtalkTemplateName(ev: PlannerEventFacts, planMonth: string): string {
  return `플래너 ${planMonth} ${ev.title}`.slice(0, 100);
}

// ── 리드타임(영업일) ─────────────────────────────────────────────────
/** 알림톡 검수 리드타임 = 5영업일(기능 문서 §4-5 — 실소요 2~3일 + 반려·재검수 1회 여유). */
export const ALIMTALK_LEAD_BUSINESS_DAYS = 5;

/**
 * (순수) from(포함 안 함) ~ to(포함) 사이 영업일 수. 공휴일은 보지 않는다 —
 * 공휴일표를 들이면 그 표가 또 하나의 진실이 된다. 주말만으로도 판정선의 목적(여유)은 달성된다.
 */
export function businessDaysUntil(fromDate: string, toDate: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return 0;
  if (toDate <= fromDate) return 0;
  let count = 0;
  const cur = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cur.getTime() < end.getTime()) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** (순수) 지금 검수를 제출해서 그 날짜까지 맞출 수 있는가. */
export function canMeetInspectionLeadTime(today: string, scheduledOn: string): boolean {
  return businessDaysUntil(today, scheduledOn) >= ALIMTALK_LEAD_BUSINESS_DAYS;
}

/** 검수 반려 재제출 상한 — 1회. 2회 반려면 보류 + 통지(기능 문서 §4-5). */
export const ALIMTALK_MAX_RESUBMIT = 1;

// ── 취소·환불 ────────────────────────────────────────────────────────
/**
 * (순수) 대행 취소 시 환불 자격 — **그 달 제작·실행이 0건일 때만 전액**(설계서 §3-4).
 * 일할 계산은 하지 않는다. 규칙이 단순해야 분쟁이 없다.
 */
export function evaluateCancelRefund(input: {
  agencyPaid: boolean;
  agencyCredits: number;
  producedCount: number;
  executedCount: number;
}): { refundable: boolean; amount: number; reason: string } {
  const worked = (input.producedCount || 0) + (input.executedCount || 0);
  if (worked > 0) {
    return {
      refundable: false,
      amount: 0,
      reason: '이번 달 제작 또는 발송이 이미 시작돼 대행료는 환불되지 않습니다.',
    };
  }
  if (!input.agencyPaid || input.agencyCredits <= 0) {
    return { refundable: false, amount: 0, reason: '환불할 대행료 차감 내역이 없습니다.' };
  }
  return { refundable: true, amount: input.agencyCredits, reason: '이번 달 제작·발송이 없어 대행료를 전액 환불합니다.' };
}

// ── 참여 버튼(이메일 소재) ───────────────────────────────────────────
/**
 * (순수) 이메일 소재에 얹는 [참여하기] CTA 섹션.
 * 링크는 **행사 단위 공개 주소**다 — 수신자 식별은 이메일 클릭 실측(email_events)이 이미 하고 있어
 * 주소에 개인 토큰을 심을 필요가 없다(심을 수도 없다: 섹션 렌더러가 https 아닌 url을 '#'로 바꾼다).
 * 문구에 "광고 수신동의와 별개"를 명시한다 — 참여 의사가 수신동의를 대체하지 않는다.
 */
export function buildParticipationCtaSection(joinUrl: string): any {
  return {
    id: 'planner-join',
    type: 'cta',
    props: {
      buttons: [{ label: '참여하기', url: joinUrl, style: 'primary' }],
      layout: 'stack',
      note: '참여 신청은 광고 수신동의와 별개이며, 신청하신 행사 안내에만 사용됩니다.',
    },
  };
}

/**
 * (순수) 참여 섹션을 소재에 끼운다 — footer 앞(있으면), 없으면 맨 뒤.
 * 사용자 콘텐츠를 지우지 않는다(비파괴 적용).
 */
export function insertParticipationSection(sections: any[], joinUrl: string): any[] {
  const list = Array.isArray(sections) ? [...sections] : [];
  const cta = buildParticipationCtaSection(joinUrl);
  const footerIdx = list.findIndex((s) => s && s.type === 'footer');
  if (footerIdx >= 0) {
    list.splice(footerIdx, 0, cta);
    return list;
  }
  list.push(cta);
  return list;
}
