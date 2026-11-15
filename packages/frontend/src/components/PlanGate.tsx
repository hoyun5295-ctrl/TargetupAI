/**
 * PlanGate — AI Operator 기능 화면 입구 (★ 2026-09-15 Harold 지시)
 *
 * 기능을 못 쓰는 회사가 기능 화면 주소를 직접 쳐서 들어오면, 화면을 그리지 않고 AI Operator 허브로 보내
 * 그 기능의 요금제 공통 안내 창을 연다(`/ai-operator?intro=기능id`). 허브 카드를 눌렀을 때와 같은 안내가 된다.
 *
 * 판정 = `utils/ai-operator-access.ts`(서버 값). 모름(조회 실패)은 막지 않는다 — 기능마다 서버가 다시 막는다.
 * ⛔ 이 입구는 안내를 통일하는 장치다. 막는 힘은 서버 게이트가 갖는다(주소 우회로 기능이 열리지 않는다).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { fetchAiOperatorAccess, isAiOperatorAccessKnownAllowed } from '../utils/ai-operator-access';
import { fetchStudioTrial } from '../utils/studio-trial';

/** ★ 2026-11-15 C135 — 무료체험 3회가 닿는 기능 화면(이 화면 하나뿐 · 서버도 생성 주소 하나에만 체험 길을 둔다) */
const TRIAL_FEATURE_ID = 'image-studio';

export default function PlanGate({ featureId, children }: { featureId: string; children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'open' | 'locked'>(() => (isAiOperatorAccessKnownAllowed() ? 'open' : 'loading'));

  useEffect(() => {
    if (state !== 'loading') return;
    let alive = true;
    void (async () => {
      const allowed = await fetchAiOperatorAccess();
      if (!alive) return;
      if (allowed !== false) { setState('open'); return; }
      // ★ C135 요금제로 잠긴 회사라도 이미지 스튜디오 무료체험을 신청했으면 연다(판정 = 서버 · 다른 기능 입구는 그대로 · 모르면 잠근 채)
      if (featureId === TRIAL_FEATURE_ID) {
        const trial = await fetchStudioTrial();
        if (!alive) return;
        if (trial?.eligible && trial.requested) { setState('open'); return; }
      }
      setState('locked');
    })();
    return () => { alive = false; };
  }, [state, featureId]);

  if (state === 'locked') return <Navigate to={`/ai-operator?intro=${encodeURIComponent(featureId)}`} replace />;
  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-label="불러오는 중">
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
      </div>
    );
  }
  return <>{children}</>;
}
