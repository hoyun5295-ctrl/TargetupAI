/**
 * BrandLearningCard — AI 메모리의 "브랜드 학습" 단일 진입점 (2026-07-21 통합).
 * 클릭 → BrandLearningModal(3탭) 오픈. 기존 BrandStudioCard·BrandVoiceCard 2개 카드를 대체.
 */
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Check, Palette } from 'lucide-react';
import BrandLearningModal from './BrandLearningModal';

type Toast = (msg: string, type?: 'success' | 'error' | 'info') => void;
type ConfirmOpts = { title: string; description: string; confirmLabel?: string; cancelLabel?: string; onConfirm: () => void };

interface Props { apiBase: string; token: string; onToast: Toast; onConfirm: (opts: ConfirmOpts) => void; }

export default function BrandLearningCard({ apiBase, token, onToast, onConfirm }: Props) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<{ color?: string; logo?: boolean; name?: string } | null>(null);
  const authHeaders = useRef({ Authorization: `Bearer ${token}` }).current;

  const loadSummary = async () => {
    try {
      const [k, b] = await Promise.all([
        fetch(`${apiBase}/api/dm/brand-kit`, { headers: authHeaders }).then((r) => r.json()).catch(() => ({})),
        fetch(`${apiBase}/api/dm/brand-basic-info`, { headers: authHeaders }).then((r) => r.json()).catch(() => ({})),
      ]);
      setSummary({ color: k?.brand_kit?.primary_color, logo: !!k?.brand_kit?.logo_url, name: b?.basic_info?.brand_name });
    } catch { /* 요약 실패 = 칩만 비움 */ }
  };
  useEffect(() => { loadSummary(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ★ Codex Low — primary_color는 GET이 항상 기본값을 채워 판정 불가 → 사용자가 실제 넣은 로고·브랜드명으로만 "학습됨" 판정.
  const learned = !!(summary?.logo || summary?.name);

  return (
    <>
      <div className="p-4 bg-gradient-to-br from-sky-500/15 via-indigo-500/10 to-violet-500/15 border border-sky-400/25 rounded-2xl">
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-sky-500/30">
            <Palette className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-[220px]">
            <h2 className="text-base font-bold text-white mb-1">브랜드 학습</h2>
            <p className="text-sm text-white/80 leading-relaxed">
              기본정보 · 브랜드킷 · 브랜드보이스를 한 곳에 학습해두면 DM · 이메일 · 인앱 메시지와 문안 생성이 전부 이 정보를 참고해서 만들어져요.
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {learned ? (
                <>
                  {summary?.name && <span className="text-[11px] text-white/70 bg-white/5 border border-white/10 rounded-full px-2 py-0.5">{summary.name}</span>}
                  {summary?.color && <span className="inline-flex items-center gap-1.5 text-[11px] text-white/70 bg-white/5 border border-white/10 rounded-full px-2 py-0.5"><span className="w-3 h-3 rounded-full border border-white/20" style={{ background: summary.color }} /> 브랜드 색</span>}
                  {summary?.logo && <span className="inline-flex items-center gap-1 text-[11px] text-white/70 bg-white/5 border border-white/10 rounded-full px-2 py-0.5"><Check className="w-3 h-3 text-emerald-300" /> 로고</span>}
                </>
              ) : (
                <span className="text-[11px] text-amber-200/90">아직 학습 전이에요. 3탭에 필요한 정보를 채워주세요.</span>
              )}
            </div>
            <div className="text-[10px] text-white/30 italic mt-2">Data source: companies + companies.brand_kit (DM·이메일·인앱·문안 생성 공용)</div>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="px-4 py-2.5 bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-400 hover:to-indigo-400 text-white text-sm font-semibold rounded-xl shadow-lg shadow-sky-500/25 transition-all flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" /> {learned ? '브랜드 학습 수정' : '브랜드 학습하기'}
          </button>
        </div>
      </div>

      <BrandLearningModal
        open={open}
        onClose={() => { setOpen(false); loadSummary(); }}
        apiBase={apiBase}
        token={token}
        onToast={onToast}
        onConfirm={onConfirm}
      />
    </>
  );
}
