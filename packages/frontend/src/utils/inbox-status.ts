/**
 * inbox-status.ts — 답장 상담(★ 2026-11-14 C133 F5)의 입구를 그릴지(헤더의 「상담함」 · 편집기의 「상담 번호 넣기」)
 *   서버 = GET /api/inbox/status · 판정 = backend routes/inbox.ts(회사 관리자 · 단계 개방) 한 곳.
 *
 * 단계가 열린 회사(useV3Feature('inbox'))에서만 서버에 묻는다 = 닫힌 회사는 요청 0.
 * 모르면 그리지 않는다(실패 · 시간 제한 = 닫힘).
 */
import { useEffect, useState } from 'react';
import { fetchJson } from './dashboard-live';
import { useV3Feature } from './v3-features';

export interface InboxEntry {
  /** 이 계정이 상담함을 쓸 수 있다(열린 회사의 관리자) */
  live: boolean;
  /** 상담을 켜 두었다 */
  enabled: boolean;
  /** 이 회사에 묶인 상담 번호(먼저 묶인 순) */
  numbers: string[];
  /** 사람이 답해야 하는 문의 수 */
  human: number;
}
const CLOSED: InboxEntry = { live: false, enabled: false, numbers: [], human: 0 };

export function useInboxEntry(refreshKey: unknown = 0): InboxEntry {
  const open = useV3Feature('inbox');
  const [entry, setEntry] = useState<InboxEntry>(CLOSED);
  useEffect(() => {
    if (!open) { setEntry(CLOSED); return; }
    let alive = true;
    void fetchJson('/api/inbox/status').then((r) => {
      if (!alive) return;
      setEntry(r.ok && r.body?.live === true
        ? { live: true, enabled: r.body.enabled === true, numbers: Array.isArray(r.body.numbers) ? r.body.numbers.map(String) : [], human: Number(r.body.human) || 0 }
        : CLOSED);
    });
    return () => { alive = false; };
  }, [open, refreshKey]);
  return entry;
}
