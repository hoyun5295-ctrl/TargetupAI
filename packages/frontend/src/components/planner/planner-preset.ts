/**
 * planner-preset.ts — 템플릿을 고르면 채워지는 보내는 순서 기본값(★ 2026-10-18 · 설계서 docs/2026-10-18-planner-v2-design.md §3-5 · H2)
 *
 * 빅세일 · 특별 이벤트 = 시작일 메일 + 시작일 문자+DM + 마지막 날 문자+DM / 신상품 · 계절 = 시작일 문자+DM + 시작일 메일.
 * 하루 행사는 같은 날 같은 채널을 접고, 지난 날(승인 마감이 지난 오늘 포함)은 뺀다 · 잠긴 채널은 뺀다.
 * ⛔ 순수 함수(React 0) · 판정은 화면 기본값일 뿐이다. 저장 때 서버가 시점을 다시 계산한다.
 */
import type { LineTemplateId } from '../../utils/one-line';

export type PresetChannel = 'sms' | 'dm' | 'email';
export interface PresetTp { channel: PresetChannel; timing: { anchor: 'start' | 'end' } }

const SALE: Array<[PresetChannel, 'start' | 'end']> = [['email', 'start'], ['sms', 'start'], ['dm', 'start'], ['sms', 'end'], ['dm', 'end']];
const LAUNCH: Array<[PresetChannel, 'start' | 'end']> = [['sms', 'start'], ['dm', 'start'], ['email', 'start']];
const PRESET: Record<LineTemplateId, Array<[PresetChannel, 'start' | 'end']>> = {
  'big-sale': SALE, 'special-event': SALE, 'new-launch': LAUNCH, season: LAUNCH,
};

/**
 * (순수) 보내는 순서 기본값.
 * @param minDate 보낼 수 있는 가장 이른 날(KST 'YYYY-MM-DD' · 오늘 20시 승인 마감이 지났으면 내일)
 * @param open 채널을 쓸 수 있는가(잠긴 채널 = 뺀다)
 */
export function plannerPreset(id: LineTemplateId, startsOn: string, endsOn: string, minDate: string, open: (ch: PresetChannel) => boolean): PresetTp[] {
  const out: PresetTp[] = [];
  const dateOf = (a: 'start' | 'end') => (a === 'end' ? endsOn : startsOn);
  for (const [channel, anchor] of PRESET[id] || []) {
    if (!open(channel) || dateOf(anchor) < minDate) continue;
    if (out.some((t) => t.channel === channel && dateOf(t.timing.anchor) === dateOf(anchor))) continue;
    out.push({ channel, timing: { anchor } });
  }
  return out;
}

/** (순수) 보낼 수 있는 가장 이른 날 — 오늘 승인 마감(KST 20시)이 지났으면 내일 */
export function plannerMinSendDate(now: Date, deadlineHour = 20): string {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  if (kst.getUTCHours() >= deadlineHour) kst.setUTCDate(kst.getUTCDate() + 1);
  return kst.toISOString().slice(0, 10);
}
