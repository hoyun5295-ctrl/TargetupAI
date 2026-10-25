/**
 * ★ 2026-10-25 원장 #75 — 「추천 시간」 = 이 DM 의 열람 시간대 실측(서버 hourDistribution · 한국 시각) · 표본이 모자라면 추천 표지 없이 기본 시각.
 *   옛: 두 화면이 늘 「내일 오전 10시」를 「추천」 · 「AI 추천」이라 부르고 「문자 열람이 많은 시간대예요」라고 말했다(근거 0).
 *   표본 하한 30 = 다른 성과 판정과 같은 통계 최소 표본(자동마케팅 정착 후보 · 변형 비교).
 */
import { isSendableHour, koHour, type SendPolicy } from './send-policy';

export const SEND_HOUR_MIN_SAMPLES = 30;
/** ★ 2026-10-25 R1 — 실측이 모자랄 때의 기본 시각 한 곳(두 화면 버튼 · 설명 글이 이 값을 읽는다 · 숫자 두 벌 0) */
export const DEFAULT_SEND_HOUR = 10;
export const DEFAULT_SLOT_LABEL = `내일 ${koHour(DEFAULT_SEND_HOUR, 'ampm')}`;

export interface SendSlot { local: string; hour: number; measured: boolean; samples: number }

const pad = (n: number) => String(n).padStart(2, '0');
const toLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function recommendSendSlot(dist: Array<{ hour: number; cnt: number }> | null | undefined, policy: SendPolicy | null, now: Date = new Date()): SendSlot {
  const rows = Array.isArray(dist) ? dist : [];
  const samples = rows.reduce((a, h) => a + (Number(h.cnt) || 0), 0);
  const top = samples >= SEND_HOUR_MIN_SAMPLES
    ? rows.filter((h) => !policy || isSendableHour(policy, Number(h.hour))).slice().sort((a, b) => (Number(b.cnt) || 0) - (Number(a.cnt) || 0))[0]
    : undefined;
  if (top) {
    const d = new Date(now);
    d.setHours(Number(top.hour), 0, 0, 0);
    if (d.getTime() <= now.getTime() + 30 * 60 * 1000) d.setDate(d.getDate() + 1);   // 30분 안이면 내일 같은 시각
    return { local: toLocal(d), hour: Number(top.hour), measured: true, samples };
  }
  const d = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  d.setHours(DEFAULT_SEND_HOUR, 0, 0, 0);
  return { local: toLocal(d), hour: DEFAULT_SEND_HOUR, measured: false, samples };
}

/** 고른 시각 설명 한 줄(실측이면 근거 · 아니면 「기본 시각」) */
export function sendSlotText(s: SendSlot): string {
  return s.measured
    ? `${koHour(s.hour, 'ampm')} · 이 DM 열람이 가장 많은 시간대예요(열람 ${s.samples.toLocaleString()}건 기준)`
    : `${DEFAULT_SLOT_LABEL} · 기본 시각이에요(열람 기록이 아직 적어 추천하지 않았어요)`;
}
