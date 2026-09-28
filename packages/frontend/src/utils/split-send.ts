/**
 * split-send.ts — 분할 전송 화면 공용 (★ 2026-09-28 Harold 지시 · 목업 승인)
 *
 * 규칙·한도·시각표 계산은 서버 CT가 소유한다(backend `utils/send-time-util.ts` parseSplitSetting · planSplitSchedule).
 * 화면은 입력 범위만 알고, "언제 몇 건씩 나가는가"는 서버에 묻는다 — 전에는 화면이 「시작 + 회차×1분」으로 따로 세서
 * 밤 9시~아침 8시 건너뜀이 빠졌다.
 */

/** 서버 SPLIT_LIMITS 와 같은 값(계약 테스트가 둘을 맞춘다) */
export const SPLIT_COUNT_RANGE = { min: 1, max: 9999 } as const;
export const SPLIT_INTERVAL_RANGE = { min: 1, max: 60 } as const;
export const SPLIT_MAX_SPAN_DAYS = 11;

/** 분할 칸 글자 — 직접발송·알림톡 같은 함수 */
export function splitTileLabel(count: number, intervalMinutes: number): string {
  return `${Number(count || 0).toLocaleString()}건 · ${intervalMinutes || 1}분마다`;
}

export interface SplitPreviewSlot { index: number; at: string; count: number }
export interface SplitPreview {
  rounds: number;
  lastCount: number;
  startAt: string;
  lastAt: string;
  withinLimit: boolean;
  slots: SplitPreviewSlot[];
}

/** 서버 미리보기. 실패하면 null(풍선은 시각표 없이 안내만 한다 · 실제 검사는 보낼 때 서버가 다시 한다) */
export async function fetchSplitPreview(
  q: { total: number; count: number; interval: number; startAt: string | null },
  signal?: AbortSignal,
): Promise<SplitPreview | null> {
  const params = new URLSearchParams({ total: String(q.total), count: String(q.count), interval: String(q.interval) });
  if (q.startAt) params.set('startAt', q.startAt);
  try {
    const res = await fetch(`/api/campaigns/split-preview?${params}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data.plan) return null;
    return data.plan as SplitPreview;
  } catch {
    return null;
  }
}

/** 한국 날짜 "YYYY-MM-DD" (en-CA 형식이 이 모양이다) */
const KST_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
/** 한국 시각 "HH:MM" */
const KST_HM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });

/** 한국 시각 "14:05" */
export function kstHourMinute(iso: string): string {
  return KST_HM.format(new Date(iso));
}

/** 한국 날짜 기준 오늘·내일·"10월 2일" */
export function kstDayLabel(iso: string, now: Date = new Date()): string {
  const day = (d: Date) => KST_DAY.format(d);
  const target = day(new Date(iso));
  if (target === day(now)) return '오늘';
  if (target === day(new Date(now.getTime() + 24 * 60 * 60 * 1000))) return '내일';
  const [, m, d] = target.split('-');
  return `${Number(m)}월 ${Number(d)}일`;
}
