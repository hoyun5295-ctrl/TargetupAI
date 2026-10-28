/**
 * OAuthConfirmPage — 몰 승인 확정(★ 2026-10-28 자사몰 대비 M24)
 *
 * 몰 승인 콜백은 로그인 정보 없이 와서 토큰을 미확정으로 담고 이 화면(?provider · oauth_confirm)으로 돌려보낸다.
 * 로그인된 회사 관리자가 이 화면에서 확정해야 연동 행에 들어간다(남이 시작한 승인 링크를 몰 주인이 눌러도 남의 회사에 묶이지 않는다).
 * 요금제 문(PlanGate) 밖 = 미가입 계정의 카페24 앱 실행 동선(심사)도 확정까지 간다 · 승인 창이면 확정 뒤 스스로 닫는다.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

export default function OAuthConfirmPage() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const provider = sp.get('provider');
  const confirm = sp.get('oauth_confirm') || '';
  const [state, setState] = useState<{ kind: 'working' | 'done' | 'error'; text: string; mall?: string }>({ kind: 'working', text: '연결을 마치는 중이에요' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if ((provider !== 'cafe24' && provider !== 'imweb') || !confirm) {
      setState({ kind: 'error', text: '연결 확인 주소가 올바르지 않아요. 자사몰 연동에서 다시 연결해 주세요.' });
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/${provider}/oauth/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
          body: JSON.stringify({ confirm }),
        });
        const data = await res.json().catch(() => ({}));
        if (!data.success) { setState({ kind: 'error', text: data.error || '연결을 마치지 못했어요. 다시 연결해 주세요.' }); return; }
        if (window.opener && !window.opener.closed) { window.close(); }
        setState({ kind: 'done', text: provider === 'cafe24' ? '카페24 연결을 마쳤어요.' : '아임웹 연결을 마쳤어요.', mall: data.mall_id || data.site_code });
      } catch {
        setState({ kind: 'error', text: '연결을 마치지 못했어요. 네트워크를 확인해 주세요.' });
      }
    })();
  }, [provider, confirm]);

  const next = () => {
    if (provider === 'cafe24' && state.mall) navigate(`/cafe24/launch?mall_id=${encodeURIComponent(state.mall)}`, { replace: true });
    else navigate('/cdp-settings', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4" role="status" aria-live="polite">
        {state.kind === 'working' && <Loader2 className="w-7 h-7 animate-spin text-violet-600 mx-auto" />}
        {state.kind === 'done' && <CheckCircle2 className="w-7 h-7 text-emerald-600 mx-auto" />}
        {state.kind === 'error' && <AlertCircle className="w-7 h-7 text-rose-600 mx-auto" />}
        <p className="text-sm text-slate-700">{state.text}</p>
        {state.kind !== 'working' && (
          <button type="button" onClick={next} className="w-full px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
            {state.kind === 'done' ? '연동 화면으로' : '자사몰 연동으로'}
          </button>
        )}
      </div>
    </div>
  );
}
