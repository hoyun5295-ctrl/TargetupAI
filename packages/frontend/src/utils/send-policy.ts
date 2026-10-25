/**
 * ★ 2026-10-25 원장 #38 · #40 · #62 — 서버 발송 규칙 값(GET /api/send-policy) 한 곳.
 *   발송 가능 시각 · 야간 이월 시각 · 플래너 승인 마감 · 확인 요청 선행일 · 플래너 문안 상한.
 *   화면은 이 값으로만 말한다(옛: 화면마다 8 · 21 · 20 · 3 · 1000 을 숫자로 따로 적었다 · 서버 환경 변수를 바꾸면 화면만 거짓).
 *   첫 화면이 뜰 때 한 번 받는다(main.tsx) · 받기 전 = null(숫자 없이 말한다 · 서버가 다시 검사한다).
 */
import { useEffect, useState } from 'react';

export interface SendPolicy {
  startHour: number;
  endHour: number;
  nightArriveHour: number;
  plannerDeadlineHour: number;
  plannerReviewLeadDays: number;
  plannerCopyMax: number;
}

let cached: SendPolicy | null = null;
let pending: Promise<SendPolicy | null> | null = null;

export function loadSendPolicy(): Promise<SendPolicy | null> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = fetch('/api/send-policy')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const p = d?.policy;
        const ok = p && ['startHour', 'endHour', 'nightArriveHour', 'plannerDeadlineHour', 'plannerReviewLeadDays', 'plannerCopyMax'].every((k) => Number.isFinite(Number(p[k])));
        if (ok) cached = p as SendPolicy;
        return cached;
      })
      .catch(() => null)
      .finally(() => { if (!cached) pending = null; });   // 실패면 다음에 다시 받는다
  }
  return pending;
}

/** 받아 둔 값(없으면 null) — 이벤트 처리 안에서 쓴다 */
export function getSendPolicy(): SendPolicy | null { return cached; }

/** 화면용 — 받기 전 null · 받으면 다시 그린다 */
export function useSendPolicy(): SendPolicy | null {
  const [p, setP] = useState<SendPolicy | null>(cached);
  useEffect(() => {
    if (cached) { setP(cached); return; }
    let alive = true;
    void loadSendPolicy().then((x) => { if (alive && x) setP(x); });
    return () => { alive = false; };
  }, []);
  return p;
}

/** 0~23 시 → 「밤 9시」 · 「아침 8시」 · 「오전 9시」 · 「오후 2시」 · 「새벽 3시」 */
export function koHour(h: number, style: 'day' | 'ampm' = 'day'): string {
  const n = ((Math.floor(h) % 24) + 24) % 24;
  const twelve = n % 12 === 0 ? 12 : n % 12;
  if (style === 'ampm') return `${n < 12 ? '오전' : '오후'} ${twelve}시`;
  if (n < 6) return `새벽 ${twelve}시`;
  if (n < 12) return `아침 ${twelve}시`;
  if (n < 18) return `오후 ${twelve}시`;
  return `밤 ${twelve}시`;
}

export const hh = (h: number) => String(Math.floor(h)).padStart(2, '0');

/** 플래너 발송 시각 문장 — 「오전 8시」(받기 전 = 빈 글 · ★ 2026-10-25 원장 #62 옛: 화면마다 「오전 8시」를 박았다) */
export function plannerSendAtText(p: SendPolicy | null): string {
  return p ? koHour(p.startHour, 'ampm') : '';
}

/** 「밤 9시~아침 8시」(야간 광고 제한 구간) */
export function nightRangeText(p: SendPolicy): string {
  return `${koHour(p.endHour)}~${koHour(p.startHour)}`;
}

/** 「08:00~21:00」(발송 가능 구간) */
export function sendWindowText(p: SendPolicy): string {
  return `${hh(p.startHour)}:00~${hh(p.endHour)}:00`;
}

/** 이 KST 시각(0~23)에 광고를 보낼 수 있나 */
export function isSendableHour(p: SendPolicy, hour: number): boolean {
  return hour >= p.startHour && hour < p.endHour;
}

/** 한국 시각(KST)의 시 — 브라우저 지역 시각이 아니다(옛: getHours() 라 한국 밖 브라우저에서 엇갈렸다) */
export function kstHourOf(d: Date): number {
  return new Date(d.getTime() + 9 * 3600 * 1000).getUTCHours();
}

/** 광고 야간 제한 시각인가(서버 NIGHT_AD_RESTRICTED 와 같은 경계 · 같은 값) */
export function isNightAdTime(p: SendPolicy, d: Date): boolean {
  return !isSendableHour(p, kstHourOf(d));
}
