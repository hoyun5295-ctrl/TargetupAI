/**
 * ★ 2026-10-01 미리 만든 모바일 DM 불러오기 창(서수란 접수 · AI 영업 4단계 「담당자가 열 주소 > 모바일 DM」)
 *
 * - 지원팀이 mobile 계정에서 발행한 DM 을 이 건의 DM 으로 쓴다. 후보 = 서버(GET /api/sales-outreach/importable-dms ·
 *   AI 영업이 만든 DM 제외 · 최근 수정 순). 이 업체 이름이 들어간 DM 을 앞에 둔다.
 * - 카드를 한 번 누르면 바로 바꾼다(1클릭). 주소 붙여넣기도 같은 동작. 서버가 첫 화면을 찍고 메일을 다시 조립한다(AI 0 · 제목·서두 보존).
 * - 바꾸는 동안(첫 화면 캡처 · 수십 초 가능) 창을 닫지 못하게 막고 진행 안내를 띄운다.
 * - portal + z-[60](앱 모달 티어 · AI 영업 창 z-50 위) · ESC 닫힘(진행 중 제외) · 배경 클릭 닫힘 0 · native dialog 0.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Link2, Smartphone, Check } from 'lucide-react';
import { outreachFetch as authFetch } from './sales-outreach-shared';

interface Candidate { id: string; title: string; dmUrl: string; updatedAt: string; cover: string | null }

interface Props {
  open: boolean;
  jobId: string;
  companyName: string;
  currentDmId: string | null;
  onClose: () => void;
  onImported: (r: { unchanged: boolean }) => void;
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}월 ${d.getDate()}일 수정`;
}

/** 이 업체 이름(공백 제거)이 제목에 들어간 DM 을 앞으로(서버 순서 = 최근 수정 순은 그대로 유지) */
function sortForCompany(items: Candidate[], companyName: string): Candidate[] {
  const key = String(companyName || '').replace(/\s+/g, '').toLowerCase();
  if (!key) return items;
  const hit = (c: Candidate) => c.title.replace(/\s+/g, '').toLowerCase().includes(key);
  return [...items.filter(hit), ...items.filter((c) => !hit(c))];
}

export default function OutreachDmImportModal({ open, jobId, companyName, currentDmId, onClose, onImported }: Props) {
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [working, setWorking] = useState<string | null>(null); // 'link' | 후보 id
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setItems(null); setLoadError(null); setError(null); setLink('');
    (async () => {
      try {
        const r = await authFetch('/api/sales-outreach/importable-dms');
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) { setLoadError(d?.error || '지원팀 DM 목록을 불러오지 못했습니다.'); setItems([]); return; }
        setItems(Array.isArray(d?.items) ? d.items : []);
      } catch {
        if (alive) { setLoadError('지원팀 DM 목록을 불러오지 못했습니다. 네트워크를 확인해 주세요.'); setItems([]); }
      }
    })();
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !working) { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, working, onClose]);

  const sorted = useMemo(() => sortForCompany(items || [], companyName), [items, companyName]);

  if (!open) return null;

  const run = async (body: { dmId?: string; link?: string }, key: string) => {
    if (working) return;
    setWorking(key);
    setError(null);
    try {
      const r = await authFetch(`/api/sales-outreach/jobs/${jobId}/import-dm`, { method: 'POST', body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d?.error || 'DM을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.'); return; }
      onImported({ unchanged: d?.unchanged === true });
    } catch {
      setError('요청에 실패했습니다. 네트워크를 확인해 주세요.');
    } finally {
      setWorking(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-3 md:p-6" role="dialog" aria-modal="true" aria-labelledby="outreach-dm-import-title">
      <div className="relative w-full max-w-3xl max-h-[92vh] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-gray-100">
          <div className="min-w-0">
            <h3 id="outreach-dm-import-title" className="text-base font-bold text-gray-900">미리 만든 모바일 DM으로 바꾸기</h3>
            <p className="mt-1 text-xs text-gray-500 leading-relaxed">
              지원팀이 mobile 계정에서 발행한 DM을 {companyName ? `${companyName} 건의` : '이 건의'} DM으로 씁니다.
              제안 메일의 DM 링크와 첫 화면 사진이 함께 바뀌고, 제목·서두는 그대로입니다.
            </p>
          </div>
          <button onClick={onClose} disabled={!!working} aria-label="닫기" className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
          <label htmlFor="outreach-dm-import-link" className="text-[11px] font-semibold text-gray-500">주소로 바꾸기</label>
          <div className="mt-1.5 flex flex-col sm:flex-row gap-2">
            <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 bg-white focus-within:border-indigo-400">
              <Link2 className="w-4 h-4 shrink-0 text-gray-400" />
              <input
                id="outreach-dm-import-link"
                value={link}
                onChange={(e) => { setLink(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && link.trim()) void run({ link: link.trim() }, 'link'); }}
                placeholder="https://hlj.kr/…"
                disabled={!!working}
                className="flex-1 min-w-0 text-sm text-gray-800 bg-transparent outline-none placeholder:text-gray-300"
              />
            </div>
            <button
              onClick={() => void run({ link: link.trim() }, 'link')}
              disabled={!!working || !link.trim()}
              className="shrink-0 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40"
            >
              {working === 'link' ? <Loader2 className="w-4 h-4 animate-spin" /> : null} 이 주소로 바꾸기
            </button>
          </div>
          {error && <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p>}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          <div className="flex items-baseline justify-between gap-2 mb-3">
            <h4 className="text-xs font-semibold text-gray-500">지원팀이 발행한 DM{items ? ` ${items.length}개` : ''}</h4>
            <span className="text-[11px] text-gray-400">누르면 바로 바뀝니다 · 이 업체 이름이 들어간 DM이 앞에 옵니다</span>
          </div>
          {items === null ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> 목록을 불러오고 있습니다</div>
          ) : loadError ? (
            <p className="py-12 text-center text-sm text-rose-600">{loadError}</p>
          ) : sorted.length === 0 ? (
            <div className="py-12 text-center">
              <Smartphone className="w-8 h-8 mx-auto text-gray-300" />
              <p className="mt-2 text-sm text-gray-600">발행된 지원팀 DM이 아직 없습니다</p>
              <p className="mt-1 text-xs text-gray-400">mobile 계정의 모바일 DM에서 만들고 발행하면 여기에 보입니다.</p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {sorted.map((c) => {
                const current = c.id === currentDmId;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => { if (!current) void run({ dmId: c.id }, c.id); }}
                      disabled={!!working || current}
                      className={`w-full text-left rounded-xl border overflow-hidden transition ${current ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-gray-200 hover:border-indigo-300 hover:shadow-md'} disabled:cursor-default`}
                    >
                      <div className="relative aspect-[3/4] bg-gray-100">
                        {c.cover
                          ? <img src={c.cover} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                          : <div className="absolute inset-0 flex items-center justify-center"><Smartphone className="w-7 h-7 text-gray-300" /></div>}
                        {current && <span className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-semibold"><Check className="w-3 h-3" /> 지금 쓰는 DM</span>}
                        {working === c.id && <span className="absolute inset-0 flex items-center justify-center bg-white/70"><Loader2 className="w-5 h-5 animate-spin text-indigo-600" /></span>}
                      </div>
                      <div className="px-2.5 py-2">
                        <p className="text-xs font-semibold text-gray-800 line-clamp-2 break-keep">{c.title}</p>
                        <p className="mt-0.5 text-[11px] text-gray-400">{fmtDay(c.updatedAt)}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {working && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/80 text-center px-6">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            <p className="text-sm font-semibold text-gray-800">DM을 바꾸고 있습니다</p>
            <p className="text-xs text-gray-500">첫 화면 사진을 찍는 데 수십 초가 걸릴 수 있습니다. 창을 닫지 말아 주세요.</p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
