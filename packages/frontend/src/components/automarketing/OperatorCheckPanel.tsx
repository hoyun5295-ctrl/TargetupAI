/**
 * OperatorCheckPanel — 자동마케팅 점검 판(★ 2026-11-02 엔진 재설계 E7-3 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md)
 *
 * 그리는 값 = 서버 점검 응답(GET /api/ai/operator/continuous/:id/check) 그대로 · 여정 점검 판과 같은 부품(components/check/CheckPanel).
 * 저장한 설정 기준으로 본다(고친 곳은 저장한 뒤 다시 본다) · 화면은 판정하지 않는다.
 * ⛔ native dialog 0 · 줄표 0 · 모델명 0.
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckHead, CheckItemRow, type CheckItem, type CheckVerdict } from '../check/CheckPanel';

interface OperatorCheckData { verdict: CheckVerdict; items: CheckItem[] }

export default function OperatorCheckPanel({ operatorId, refreshKey }: { operatorId: string; refreshKey?: unknown }) {
  const [check, setCheck] = useState<OperatorCheckData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const r = await fetch(`/api/ai/operator/continuous/${encodeURIComponent(operatorId)}/check`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.success) throw new Error(d?.error || '점검을 불러오지 못했어요.');
      setCheck({ verdict: d.verdict, items: Array.isArray(d.items) ? d.items : [] });
    } catch (e: any) {
      setError(e?.message || '점검을 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, [operatorId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  return (
    <aside aria-label="점검" className="min-w-0 self-start rounded-2xl border border-slate-200 bg-white">
      <CheckHead verdict={check?.verdict} loaded={!!check} loading={loading} error={error} onRetry={() => void load()}>
        <p className="mt-1 text-[12px] text-slate-500">저장한 설정 기준이에요. 고친 곳은 저장한 뒤 다시 봐요.</p>
      </CheckHead>
      {check && check.items.length > 0 && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">{check.items.map((it) => <CheckItemRow key={it.key} it={it} />)}</ul>
      )}
    </aside>
  );
}
