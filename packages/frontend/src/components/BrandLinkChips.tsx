/**
 * BrandLinkChips.tsx — 브랜드 링크 칩 공용 컴포넌트 (2026-07-02)
 *
 * 용도: 문안 생성/편집 화면에서 회사 등록 URL을 칩 클릭 한 번으로 커서 위치에 삽입.
 *   - 실제 URL은 고객사 소유 — 한 번 등록하면 모든 문안 편집기에서 재사용.
 *   - AI 자동 배치({{LINK:라벨}} 토큰 치환)와 같은 데이터(ai_company_memory brand_link)를 공유.
 *   - onInsert 미전달 = 관리 모드(AI 학습 메모리 페이지 — 목록/추가/삭제만).
 *
 * 삽입 방식은 호스트가 결정: onInsert(url)에 textInsert CT(insertAtCursor 등)를 연결한다.
 * native dialog 0건(삭제 = 2단계 인라인 확인) · 모델명 노출 0건 · 모바일 flex-wrap.
 */
import { useEffect, useRef, useState } from 'react';
import { Link2, Plus, Trash2, Loader2, X, Check } from 'lucide-react';

export interface BrandLinkItem {
  id: string;
  label: string;
  url: string;
}

interface BrandLinkChipsProps {
  /** 칩 클릭 시 URL 삽입 콜백 — 미전달 시 관리 모드 */
  onInsert?: (url: string) => void;
  tone?: 'dark' | 'light';
  onToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
  className?: string;
}

const API_BASE = '/api/ai-memory/brand-links';

export default function BrandLinkChips({ onInsert, tone = 'light', onToast, className = '' }: BrandLinkChipsProps) {
  const [links, setLinks] = useState<BrandLinkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dark = tone === 'dark';

  useEffect(() => {
    loadLinks();
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  function notify(message: string, type: 'success' | 'error' | 'info' = 'info') {
    if (onToast) onToast(message, type);
    else if (type === 'error') setError(message);
  }

  async function loadLinks() {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(API_BASE, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) setLinks(data.links || []);
    } catch {
      // 조회 실패 = 칩 미표시 (편집 흐름 영향 0)
    } finally {
      setLoading(false);
    }
  }

  async function saveLink() {
    const trimmedLabel = label.trim();
    const trimmedUrl = url.trim();
    if (!trimmedLabel) {
      setError('링크 이름을 입력해주세요. 예: 공식몰, 쿠폰함');
      return;
    }
    if (!/^https?:\/\/\S+\.\S+/.test(trimmedUrl)) {
      setError('올바른 URL을 입력해주세요. (http:// 또는 https:// 로 시작)');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ label: trimmedLabel, url: trimmedUrl }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '저장 실패');
      setLabel('');
      setUrl('');
      setAdding(false);
      await loadLinks();
      notify(`브랜드 링크 "${trimmedLabel}" 저장 완료 — 모든 문안 편집기에서 재사용됩니다.`, 'success');
    } catch (err: any) {
      setError(err?.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  async function deleteLink(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    setConfirmDeleteId(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '삭제 실패');
      await loadLinks();
      notify('브랜드 링크 삭제 완료.', 'success');
    } catch (err: any) {
      notify(err?.message || '삭제 실패', 'error');
    }
  }

  const wrapCls = dark
    ? 'rounded-xl bg-white/5 border border-white/10 p-3'
    : 'rounded-xl bg-slate-50 border border-slate-200 p-3';
  const titleCls = dark ? 'text-white/70' : 'text-slate-600';
  const chipCls = dark
    ? 'bg-violet-500/15 text-violet-200 border-violet-400/30 hover:bg-violet-500/30 hover:text-white'
    : 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100 hover:border-violet-300';
  const inputCls = dark
    ? 'bg-slate-950 border-white/10 text-white placeholder-white/30 focus:border-violet-500'
    : 'bg-white border-slate-200 text-slate-800 placeholder-slate-400 focus:border-violet-400';

  return (
    <div className={`${wrapCls} ${className}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className={`flex items-center gap-1.5 text-xs font-semibold ${titleCls}`}>
          <Link2 className="w-3.5 h-3.5" />
          브랜드 링크
          {onInsert && <span className={`font-normal ${dark ? 'text-white/40' : 'text-slate-400'}`}>— 클릭 시 커서 위치에 삽입</span>}
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => { setAdding(true); setError(''); }}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg border transition-colors ${chipCls}`}
          >
            <Plus className="w-3 h-3" /> 링크 추가
          </button>
        )}
      </div>

      {loading ? (
        <div className={`flex items-center gap-1.5 text-[11px] ${dark ? 'text-white/40' : 'text-slate-400'}`}>
          <Loader2 className="w-3 h-3 animate-spin" /> 불러오는 중
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {links.length === 0 && !adding && (
            <span className={`text-[11px] ${dark ? 'text-white/40' : 'text-slate-400'}`}>
              등록된 링크가 없습니다. 링크 추가로 URL을 한 번만 등록하면 AI 문안에도 자동 배치됩니다.
            </span>
          )}
          {links.map((l) => (
            <span key={l.id} className={`inline-flex items-center gap-1 rounded-lg border overflow-hidden ${chipCls}`}>
              {onInsert ? (
                <button
                  type="button"
                  onClick={() => onInsert(l.url)}
                  title={l.url}
                  className="px-2 py-1 text-[11px] font-medium"
                >
                  {l.label}
                </button>
              ) : (
                <span title={l.url} className="px-2 py-1 text-[11px] font-medium">{l.label}</span>
              )}
              <button
                type="button"
                onClick={() => deleteLink(l.id)}
                title={confirmDeleteId === l.id ? '한 번 더 클릭하면 삭제됩니다' : '삭제'}
                className={`px-1.5 py-1 border-l transition-colors ${
                  confirmDeleteId === l.id
                    ? 'bg-rose-500/20 text-rose-400 border-rose-300/40'
                    : dark ? 'border-white/10 text-white/40 hover:text-rose-300' : 'border-violet-200 text-slate-400 hover:text-rose-500'
                }`}
              >
                {confirmDeleteId === l.id ? <Check className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
              </button>
            </span>
          ))}
        </div>
      )}

      {adding && (
        <div className="mt-2 flex flex-col md:flex-row gap-1.5 md:items-center">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="이름 (예: 공식몰)"
            maxLength={40}
            className={`w-full md:w-32 px-2 py-1.5 text-[11px] rounded-lg border focus:outline-none ${inputCls}`}
          />
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveLink(); } }}
            placeholder="https://..."
            maxLength={500}
            className={`flex-1 px-2 py-1.5 text-[11px] rounded-lg border focus:outline-none ${inputCls}`}
          />
          <div className="flex gap-1.5 shrink-0">
            <button
              type="button"
              onClick={saveLink}
              disabled={saving}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} 추가
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setError(''); }}
              className={`flex items-center gap-1 px-2 py-1.5 text-[11px] rounded-lg border transition-colors ${
                dark ? 'border-white/15 text-white/60 hover:bg-white/10' : 'border-slate-200 text-slate-500 hover:bg-slate-100'
              }`}
            >
              <X className="w-3 h-3" /> 취소
            </button>
          </div>
        </div>
      )}

      {error && <div className="mt-1.5 text-[11px] text-rose-400">{error}</div>}
    </div>
  );
}
