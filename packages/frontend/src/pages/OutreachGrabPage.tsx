/**
 * ★ 2026-09-24 네이버 스토어 화면 받기(슈퍼관리자 · 북마크 [한줄로 가져오기]가 연 새 탭 · 설계서 docs/2026-09-23-outreach-direct-send-design.md §9-1)
 * 흐름: 주소 # 읽기 → 즉시 지우기(방문 기록에 안 남게) → 판·설치 열쇠 확인 → 압축 풀기 → 서버 store-grab → 원래 AI 영업 창에 알림 → 스스로 닫힘.
 * 같은 스토어로 받을 수 있는 건이 여럿이면 고르기(1클릭) · 없으면 안내만. 톤 = AI 영업 모달(라이트 · 블루).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Store, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  OUTREACH_GRAB_VERSION, parseGrabHash, inflateGrab, readGrabKey, notifyStoreGrab,
} from '../components/admin/outreach-store-grab';

type Phase = 'working' | 'attached' | 'choose' | 'none' | 'error' | 'empty';
interface Choice { jobId: string; companyName: string; stage: string; createdAt: string }

const STAGE_LABEL: Record<string, string> = { queued: '대기 중', crawling: '홈페이지 읽는 중', analyzing: '행사 정리 중', awaiting_confirm: '확인 대기' };

export default function OutreachGrabPage() {
  const [phase, setPhase] = useState<Phase>('working');
  const [message, setMessage] = useState('');
  const [attached, setAttached] = useState<{ companyName: string; campaigns: number; products: number } | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [busy, setBusy] = useState(false);
  const [closeFailed, setCloseFailed] = useState(false);
  const payloadRef = useRef<{ u: string; s: Record<string, unknown> } | null>(null);
  // StrictMode 이중 실행에도 한 번만(첫 렌더의 # 을 붙잡는다)
  const hashRef = useRef(window.location.hash);
  const startedRef = useRef(false);

  const send = useCallback(async (jobId?: string) => {
    const p = payloadRef.current;
    if (!p) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('pageUrl', p.u);
      if (jobId) fd.append('jobId', jobId);
      // ★ 2026-09-24 B 판 2 — 스토어 상태 허용 칸(JSON)
      fd.append('file', new Blob([JSON.stringify(p.s)], { type: 'application/json' }), 'state.json');
      const token = localStorage.getItem('token');
      const r = await fetch('/api/sales-outreach/store-grab', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setPhase('error'); setMessage(d?.error || '가져오기에 실패했습니다. 잠시 후 스토어 화면에서 다시 눌러 주세요.'); return; }
      if (d?.attached) {
        payloadRef.current = null;
        setAttached({ companyName: String(d.attached.companyName), campaigns: Number(d.attached.campaigns) || 0, products: Number(d.attached.products) || 0 });
        setPhase('attached');
        notifyStoreGrab(String(d.attached.jobId));
        // 버튼이 연 창이라 스스로 닫을 수 있다 · 닫히지 않으면 안내만
        window.setTimeout(() => { window.close(); window.setTimeout(() => setCloseFailed(true), 400); }, 2500);
        return;
      }
      if (Array.isArray(d?.choices) && d.choices.length > 0) { setChoices(d.choices); setPhase('choose'); return; }
      setPhase('none');
      setMessage(d?.reason === 'past_confirm'
        ? '이 스토어로 등록된 업체는 이미 행사를 확정했거나 멈춘 상태라 붙일 곳이 없습니다.'
        : '이 스토어 주소로 등록된 업체가 없습니다. AI 영업에서 업체를 등록할 때 네이버 스토어 주소를 함께 적어 주세요.');
    } catch {
      setPhase('error');
      setMessage('요청에 실패했습니다. 네트워크를 확인한 뒤 스토어 화면에서 다시 눌러 주세요.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const raw = hashRef.current;
    if (raw) window.history.replaceState(null, '', window.location.pathname);
    (async () => {
      const h = parseGrabHash(raw);
      if (!h) { setPhase('empty'); return; }
      if (h.v !== OUTREACH_GRAB_VERSION) { setPhase('error'); setMessage('북마크 버튼이 옛 판입니다. AI 영업 화면에서 [한줄로 가져오기] 버튼을 다시 끌어다 놓아 주세요.'); return; }
      const key = readGrabKey();
      if (!key || key !== h.k) { setPhase('error'); setMessage('이 브라우저에서 설치한 버튼이 아닙니다. AI 영업 화면에서 [한줄로 가져오기] 버튼을 다시 끌어다 놓아 주세요.'); return; }
      const p = await inflateGrab(h.g);
      if (!p) { setPhase('error'); setMessage('화면 내용을 풀지 못했습니다. 스토어 화면에서 다시 눌러 주세요.'); return; }
      payloadRef.current = p;
      await send();
    })();
  }, [send]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200/70 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shrink-0"><Store className="w-5 h-5" /></span>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-gray-900">네이버 스토어 화면 가져오기</h1>
            <p className="text-xs text-gray-500">AI 영업 · 지금 보던 스토어 화면의 행사 문구</p>
          </div>
        </div>
        <div className="px-5 py-5 text-sm text-gray-700">
          {phase === 'working' && (
            <div className="flex items-center gap-2 text-gray-600"><Loader2 className="w-4 h-4 animate-spin text-blue-600" /> 스토어 기획·상품을 읽어 같은 스토어로 등록된 업체에 넣는 중입니다</div>
          )}
          {phase === 'attached' && attached && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-emerald-700"><CheckCircle2 className="w-5 h-5 shrink-0" /><span><b>{attached.companyName}</b>에 네이버 스토어 기획 {attached.campaigns}개 · 상품 {attached.products}개를 넣었습니다.</span></div>
              <p className="text-xs text-gray-500">AI 영업 확인 화면의 행사 후보에 "네이버 스토어" 표시로 보입니다. 가격은 지금 스토어에 보이는 값입니다.</p>
              <p className="text-xs text-gray-400">{closeFailed ? '이 창은 닫으셔도 됩니다.' : '이 창은 곧 닫힙니다.'}</p>
            </div>
          )}
          {phase === 'choose' && (
            <div className="space-y-2">
              <p>같은 스토어로 등록된 업체가 {choices.length}곳입니다. 붙일 곳을 고르세요.</p>
              <div className="space-y-1.5">
                {choices.map((c) => (
                  <button key={c.jobId} onClick={() => send(c.jobId)} disabled={busy}
                    className="w-full text-left px-3 py-2.5 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-40 flex items-center gap-2">
                    <span className="font-medium text-gray-900 truncate">{c.companyName}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-gray-500">{STAGE_LABEL[c.stage] || c.stage} · {String(c.createdAt).slice(0, 10)}</span>
                  </button>
                ))}
              </div>
              {busy && <div className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> 붙이는 중</div>}
            </div>
          )}
          {(phase === 'none' || phase === 'error') && (
            <div className={`flex items-start gap-2 ${phase === 'error' ? 'text-rose-700' : 'text-amber-800'}`}><AlertTriangle className="w-5 h-5 shrink-0" /><span>{message}</span></div>
          )}
          {phase === 'empty' && (
            <p className="text-gray-600">이 페이지는 네이버 스토어 화면에서 북마크 [한줄로 가져오기]를 누르면 열립니다. 버튼은 AI 영업 확인 화면에서 설치합니다.</p>
          )}
        </div>
        <div className="px-5 py-2.5 border-t border-gray-100">
          <span className="text-[10px] text-gray-400 italic">Data source: 직원 브라우저에 떠 있던 스토어 화면의 기획·상품 정보 · 한줄로 서버는 네이버에 접속하지 않습니다</span>
        </div>
      </div>
    </div>
  );
}
