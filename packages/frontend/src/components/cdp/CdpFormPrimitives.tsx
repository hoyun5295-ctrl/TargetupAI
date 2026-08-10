/**
 * components/cdp/CdpFormPrimitives.tsx — 연동 폼 공용 조각 (★2026-08-10 Phase 5-3)
 *
 * 연결 안내의 단계 표시. 페이지와 몰별 연결 폼이 함께 쓰므로 한 곳에 둔다 —
 * 폼을 옮기면서 각자 복사하면 그 순간 두 벌이 되고, 곧 한쪽만 고쳐진다.
 */

import type { ReactNode } from 'react';

export function GuideStep({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 w-4 h-4 mt-0.5 rounded-full bg-violet-500/30 text-violet-100 text-[10px] flex items-center justify-center font-bold">{n}</span>
      <div className="flex-1 text-xs text-white/70 leading-relaxed">{children}</div>
    </div>
  );
}
