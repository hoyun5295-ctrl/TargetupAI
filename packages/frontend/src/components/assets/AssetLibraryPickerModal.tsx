/**
 * AssetLibraryPickerModal — 에셋 라이브러리에서 이미지 선택 (2026-07-18 P3)
 *
 * 회사 저장소(cdp_assets)의 소재를 골라 onPick(url)로 돌려준다 — DM·이메일·인앱 등 전 채널 에디터 공용 픽커.
 * 업로드는 각 에디터의 기존 업로드 버튼이 담당(업로드 시 서버가 자동 등재) — 여기는 재사용 전용.
 * z-[2000] 인터럽트 티어 (MallProductPickerModal과 동일).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, FolderOpen, Loader2, Search, Trash2, X } from 'lucide-react';

export interface PickedAsset {
  id: string;
  url: string;
  filename: string | null;
  bytes: number;
  kind: string;
}

interface AssetUsage { usedBytes: number; limitBytes: number; planCode: string }

const mb = (n: number) => `${(Number(n) / 1024 / 1024).toFixed(1)}MB`;

export default function AssetLibraryPickerModal({ open, onClose, onPick, multiSelect = false, onPickMany }: {
  open: boolean;
  onClose: () => void;
  onPick: (asset: PickedAsset) => void;
  /** ★ 2026-07-19 P4: 다중 선택 모드 — 클릭=토글, 하단 [N개 선택 완료]가 onPickMany로 반환. 미전달=단일(하위호환). */
  multiSelect?: boolean;
  onPickMany?: (assets: PickedAsset[]) => void;
}) {
  const [assets, setAssets] = useState<PickedAsset[]>([]);
  const [sel, setSel] = useState<Record<string, PickedAsset>>({});
  const [usage, setUsage] = useState<AssetUsage | null>(null);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [migrationPending, setMigrationPending] = useState(false);

  const token = () => localStorage.getItem('token');
  // ★ Codex F1 — 요청 세대 가드: 늦게 도착한 이전 검색 응답이 최신 결과를 덮지 않게
  const reqSeq = useRef(0);

  const load = async (keyword?: string) => {
    const seq = ++reqSeq.current;
    setLoading(true);
    setErr(null);
    setMigrationPending(false);
    try {
      const url = `/api/assets${keyword ? `?q=${encodeURIComponent(keyword)}` : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (seq !== reqSeq.current) return; // 더 새 요청이 나감 — 이 응답 폐기
      if (res.status === 503 && data?.code === 'DB_MIGRATION_PENDING') {
        setMigrationPending(true);
        setAssets([]);
        return;
      }
      if (!res.ok || data?.success === false) throw new Error(String(data?.error || '라이브러리를 불러오지 못했습니다.'));
      setAssets(Array.isArray(data.assets) ? data.assets : []);
      setUsage(data.usage || null);
    } catch (e: any) {
      if (seq !== reqSeq.current) return;
      setErr(e?.message || '라이브러리를 불러오지 못했습니다.');
      setAssets([]);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setQ('');
    setSel({});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/assets/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (!res.ok || data?.success === false) throw new Error(String(data?.error || '삭제하지 못했습니다.'));
      // ★ Codex F2 — 목록·사용량 동시 갱신 (헤더 용량이 stale로 남지 않게)
      const removed = assets.find((a) => a.id === id);
      setAssets((list) => list.filter((a) => a.id !== id));
      if (removed) setUsage((u) => (u ? { ...u, usedBytes: Math.max(0, u.usedBytes - (removed.bytes || 0)) } : u));
    } catch (e: any) {
      setErr(e?.message || '삭제하지 못했습니다.');
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <FolderOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">에셋 라이브러리</h3>
              <p className="text-[11px] text-white/50">
                업로드한 소재가 자동으로 쌓입니다 — 골라서 바로 사용
                {usage && <span className="ml-2 text-white/35">({mb(usage.usedBytes)} / {mb(usage.limitBytes)})</span>}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded-lg hover:bg-white/10" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-3 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') load(q.trim()); }}
              placeholder="파일명 검색 후 Enter"
              className="w-full pl-9 pr-3 py-2 bg-slate-950/60 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50"
            />
          </div>
        </div>

        <div className="px-6 py-4 overflow-y-auto grow">
          {loading ? (
            <div className="flex items-center justify-center py-14 text-white/40 text-sm gap-2"><Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중...</div>
          ) : migrationPending ? (
            <div className="text-center py-12 text-white/45 text-xs leading-relaxed">
              라이브러리 준비 중입니다 — 운영자에게 DB 마이그레이션(cdp_assets) 실행을 요청해주세요.
            </div>
          ) : err ? (
            <div className="text-center py-12 text-rose-300/80 text-xs">{err}</div>
          ) : assets.length === 0 ? (
            <div className="text-center py-12 text-white/45 text-xs leading-relaxed">
              아직 저장된 소재가 없습니다.<br />각 에디터에서 이미지를 업로드하면 여기에 자동으로 쌓입니다.
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
              {assets.map((a) => (
                <div key={a.id} className="group relative">
                  <button
                    onClick={() => {
                      if (multiSelect) {
                        setSel((s) => {
                          const next = { ...s };
                          if (next[a.id]) delete next[a.id];
                          else next[a.id] = a;
                          return next;
                        });
                      } else {
                        onPick(a);
                        onClose();
                      }
                    }}
                    className={`block w-full aspect-square rounded-xl overflow-hidden border bg-slate-950/60 transition-colors ${multiSelect && sel[a.id] ? 'border-violet-400 ring-2 ring-violet-400/40' : 'border-white/10 hover:border-violet-400/60'}`}
                    title={a.filename || ''}
                  >
                    <img src={a.url} alt={a.filename || ''} loading="lazy" className="w-full h-full object-cover" />
                  </button>
                  {multiSelect && sel[a.id] && (
                    <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center pointer-events-none">
                      <Check className="w-3 h-3 text-white" />
                    </span>
                  )}
                  <button
                    onClick={() => remove(a.id)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white/70 hover:text-rose-300 hover:bg-black/80 hidden group-hover:flex items-center justify-center"
                    aria-label="라이브러리에서 삭제"
                    title="라이브러리에서만 삭제 — 이미 발행된 메시지의 이미지는 깨지지 않습니다"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  <div className="text-[9px] text-white/35 truncate mt-1">{a.filename || '이름 없음'} · {mb(a.bytes)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 다중 선택 확정 바 */}
        {multiSelect && (
          <div className="px-6 py-3.5 border-t border-white/10 shrink-0">
            <button
              onClick={() => {
                const picked = Object.values(sel);
                if (picked.length === 0) return;
                onPickMany?.(picked);
                onClose();
              }}
              disabled={Object.keys(sel).length === 0}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-30"
            >
              {Object.keys(sel).length > 0 ? `${Object.keys(sel).length}개 선택 완료` : '이미지를 선택해주세요'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
