/**
 * useRenderedHtml — 서버 렌더 미리보기 요청(★ 2026-09-27 만들기 개편 · 설계서 §1 불변 1)
 *
 * 입력이 바뀌면(key) 잠깐 기다렸다가 서버에 한 번만 그리게 한다. 새 요청이 나가면 앞 요청은 취소한다(늦게 온 옛 그림이 새 그림을 덮지 않게).
 * 렌더는 언제나 서버(DM 뷰어 · 이메일 렌더러)다 — 화면이 따로 그리지 않는다(세 번째 렌더러 0).
 */
import { useEffect, useRef, useState } from 'react';

export function useRenderedHtml(key: string | null, request: (signal: AbortSignal) => Promise<string>, delay = 450) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(request);
  reqRef.current = request;
  const seq = useRef(0);

  useEffect(() => {
    if (key === null) return;
    const ctrl = new AbortController();
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const out = await reqRef.current(ctrl.signal);
        if (my !== seq.current) return;
        setHtml(out);
        setError(null);
      } catch (e: any) {
        if (ctrl.signal.aborted || my !== seq.current) return;
        setError(e?.message || '미리보기를 그리지 못했어요.');
      } finally {
        if (my === seq.current) setLoading(false);
      }
    }, delay);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [key, delay]);

  return { html, loading, error };
}

const authJson = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` });

/** DM 무저장 미리보기(S10) — 저장본이 아니라 지금 고치는 모습 그대로 */
export async function fetchDmPreview(dmId: string, body: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const r = await fetch(`/api/dm/${encodeURIComponent(dmId)}/render-preview`, { method: 'POST', headers: authJson(), body: JSON.stringify(body), signal });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d?.success) throw new Error(d?.error || '미리보기를 그리지 못했어요.');
  return String(d.html || '');
}

/** 이메일 미리보기 — 실제 발송 HTML(광고면 법정 하단 문구까지) */
export async function fetchEmailPreview(body: { sections: unknown[]; design?: unknown; is_ad: boolean; campaign_id?: string | null; sampleCustomer?: unknown }, signal: AbortSignal): Promise<string> {
  const r = await fetch('/api/email/render-preview', {
    method: 'POST', headers: authJson(), signal,
    body: JSON.stringify({ sections: body.sections, design: body.design || undefined, is_ad: body.is_ad, campaign_id: body.campaign_id || undefined, sampleCustomer: body.sampleCustomer || undefined }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d?.success) throw new Error(d?.error || '미리보기를 그리지 못했어요.');
  return String(d.html || '');
}
