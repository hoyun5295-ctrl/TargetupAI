/**
 * SeedCurationModal.tsx — 업종 베스트 문안 시드 큐레이션(하이브리드 검수).
 *   슈퍼관리자 전용. 9천 코퍼스에서 업종 베스트 후보를 채굴(탈색·누출/스팸 게이트 적용)해 검수 후 승인 →
 *   승인분만 sentinel 시드로 저장되어 브랜드보이스 미등록 업체(Track B) 생성 프롬프트의 참고 원문이 된다.
 *   native dialog 0(useToast + 인라인 확인), 모델명 미노출, 다크 테마.
 */
import { useEffect, useState } from 'react';
import { X, Sparkles, Search, Loader2, Trash2, Check, Layers } from 'lucide-react';
import { useToast } from './ToastProvider';

interface Seed {
  id: string; text: string; industryCode: string; messageType: string; isAd: boolean;
}
interface Candidate { text: string; selected: boolean; }

const CHANNELS = ['SMS', 'LMS', 'MMS', 'KAKAO'] as const;

export default function SeedCurationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [industryCode, setIndustryCode] = useState('');
  const [channel, setChannel] = useState<string>('SMS');
  const [isAd, setIsAd] = useState(false);
  const [mining, setMining] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [saving, setSaving] = useState(false);
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [loadingSeeds, setLoadingSeeds] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 5;

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const loadSeeds = async () => {
    setLoadingSeeds(true);
    try {
      const q = industryCode ? `?industryCode=${encodeURIComponent(industryCode)}` : '';
      const r = await fetch(`/api/admin/ai-training/seed/list${q}`, { headers: authHeader() });
      const j = await r.json();
      if (j.success) setSeeds(j.seeds || []);
      else toast.error(`시드 조회 실패 — ${j.error || '오류'}`);
    } catch (e: any) {
      toast.error(`시드 조회 실패 — ${e?.message || '네트워크 오류'}`);
    } finally {
      setLoadingSeeds(false);
    }
  };

  useEffect(() => { if (open) void loadSeeds(); /* eslint-disable-next-line */ }, [open]);

  const mine = async () => {
    if (!industryCode.trim()) { toast.error('업종 코드를 입력하세요.'); return; }
    setMining(true);
    setCandidates([]);
    setPage(0);
    try {
      const params = new URLSearchParams({ industryCode: industryCode.trim(), channel, isAd: String(isAd) });
      const r = await fetch(`/api/admin/ai-training/seed/mine?${params.toString()}`, { headers: authHeader() });
      const j = await r.json();
      if (j.success) {
        const list: string[] = j.candidates || [];
        setCandidates(list.map((t) => ({ text: t, selected: true })));
        if (list.length === 0) toast.info('채굴된 후보가 없습니다(표본 부족).');
      } else {
        toast.error(`채굴 실패 — ${j.error || '오류'}`);
      }
    } catch (e: any) {
      toast.error(`채굴 실패 — ${e?.message || '네트워크 오류'}`);
    } finally {
      setMining(false);
    }
  };

  const approve = async () => {
    const items = candidates
      .filter((c) => c.selected && c.text.trim())
      .map((c) => ({ text: c.text.trim(), industryCode: industryCode.trim(), messageType: channel, isAd }));
    if (items.length === 0) { toast.error('승인할 후보를 선택하세요.'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/admin/ai-training/seed/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ items }),
      });
      const j = await r.json();
      if (j.success) {
        toast.success(`${j.inserted}건 시드 저장 완료`);
        setCandidates([]);
        void loadSeeds();
      } else {
        toast.error(`저장 실패 — ${j.error || '오류'}`);
      }
    } catch (e: any) {
      toast.error(`저장 실패 — ${e?.message || '네트워크 오류'}`);
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    try {
      const r = await fetch(`/api/admin/ai-training/seed/${id}`, { method: 'DELETE', headers: authHeader() });
      const j = await r.json();
      if (j.success) { toast.success('시드 삭제됨'); setSeeds((s) => s.filter((x) => x.id !== id)); }
      else toast.error('삭제 실패');
    } catch (e: any) {
      toast.error(`삭제 실패 — ${e?.message || '네트워크 오류'}`);
    } finally {
      setConfirmDeleteId(null);
    }
  };

  if (!open) return null;

  const selectedCount = candidates.filter((c) => c.selected).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-white">업종 베스트 시드 큐레이션</h2>
            <p className="text-xs text-white/50">채굴 → 검수 → 승인. 승인분만 미등록 업체 생성에 참고 원문으로 쓰입니다.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-white/70" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* 채굴 조건 */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs text-white/60 mb-1">업종 코드</label>
              <input
                value={industryCode}
                onChange={(e) => setIndustryCode(e.target.value)}
                placeholder="예: cafe, beauty, fashion"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-400"
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">채널</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-400"
              >
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <button
              onClick={() => setIsAd((v) => !v)}
              className={`px-3 py-2 rounded-lg text-sm border transition-colors ${isAd ? 'bg-amber-500/20 border-amber-400/40 text-amber-200' : 'bg-slate-800 border-white/10 text-white/60'}`}
            >
              {isAd ? '광고성' : '정보성'}
            </button>
            <button
              onClick={mine}
              disabled={mining}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              {mining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              채굴
            </button>
          </div>

          {/* 후보 검수 */}
          {candidates.length > 0 && (() => {
            const totalPages = Math.ceil(candidates.length / PAGE_SIZE);
            const cur = Math.min(page, totalPages - 1);
            const start = cur * PAGE_SIZE;
            const pageItems = candidates.slice(start, start + PAGE_SIZE);
            return (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-white/50">후보 {candidates.length}건 · 선택 {selectedCount}건 (탈색·누출/스팸 게이트 통과분)</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCandidates((arr) => arr.map((x) => ({ ...x, selected: selectedCount < arr.length })))}
                      className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 text-xs"
                    >
                      {selectedCount < candidates.length ? '전체 선택' : '전체 해제'}
                    </button>
                    <button
                      onClick={approve}
                      disabled={saving || selectedCount === 0}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/90 hover:bg-emerald-500 text-white text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      선택 {selectedCount}건 승인 저장
                    </button>
                  </div>
                </div>
                {pageItems.map((c, k) => {
                  const i = start + k;
                  return (
                    <div key={i} className={`rounded-xl border p-3 flex gap-3 ${c.selected ? 'border-violet-400/40 bg-violet-500/5' : 'border-white/10 bg-slate-800/40'}`}>
                      <button
                        onClick={() => setCandidates((arr) => arr.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)))}
                        className={`mt-1 w-6 h-6 rounded-md flex-shrink-0 flex items-center justify-center border ${c.selected ? 'bg-violet-500 border-violet-500' : 'border-white/30'}`}
                        aria-label="선택"
                      >
                        {c.selected && <Check className="w-4 h-4 text-white" />}
                      </button>
                      <textarea
                        value={c.text}
                        onChange={(e) => setCandidates((arr) => arr.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                        rows={4}
                        className="flex-1 bg-slate-900/40 border border-white/5 rounded-lg px-3 py-2 text-sm leading-relaxed text-white/90 resize-y focus:outline-none focus:border-violet-400/40 min-h-[92px]"
                      />
                    </div>
                  );
                })}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 pt-1">
                    <button onClick={() => setPage(Math.max(0, cur - 1))} disabled={cur === 0}
                      className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 text-xs disabled:opacity-40">이전</button>
                    <span className="text-xs text-white/60">{cur + 1} / {totalPages}</span>
                    <button onClick={() => setPage(Math.min(totalPages - 1, cur + 1))} disabled={cur >= totalPages - 1}
                      className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 text-xs disabled:opacity-40">다음</button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* 저장된 시드 */}
          <div className="pt-2 border-t border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <Layers className="w-4 h-4 text-white/50" />
              <p className="text-sm text-white/70">저장된 시드 {seeds.length}건</p>
              {loadingSeeds && <Loader2 className="w-3.5 h-3.5 animate-spin text-white/40" />}
            </div>
            <div className="space-y-2">
              {seeds.map((s) => (
                <div key={s.id} className="rounded-xl border border-white/10 bg-slate-800/40 p-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex gap-1.5 mb-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">{s.industryCode}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">{s.messageType}</span>
                      {s.isAd && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200">광고</span>}
                    </div>
                    <p className="text-sm text-white/80 break-words">{s.text}</p>
                  </div>
                  {confirmDeleteId === s.id ? (
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => del(s.id)} className="px-2 py-1 rounded bg-rose-500 text-white text-xs">확인</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="px-2 py-1 rounded bg-white/10 text-white/70 text-xs">취소</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteId(s.id)} className="p-1.5 rounded-lg hover:bg-rose-500/20 text-rose-300 flex-shrink-0" aria-label="삭제">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
              {seeds.length === 0 && !loadingSeeds && (
                <p className="text-xs text-white/30 italic py-4 text-center">저장된 시드가 없습니다. 위에서 업종을 지정해 채굴·승인하세요.</p>
              )}
            </div>
          </div>

          <p className="text-[10px] text-white/30 italic">
            Data source — ai_training_logs 자사 코퍼스(탈색·검수). 저장 시드는 브랜드보이스 미등록 업체 생성에만 참고 원문으로 활용됩니다.
          </p>
        </div>
      </div>
    </div>
  );
}
