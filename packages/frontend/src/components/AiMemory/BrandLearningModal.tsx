/**
 * BrandLearningModal — 브랜드 학습 단일 모달 + 3탭 (2026-07-21 통합).
 *
 * Harold 확정: "브랜드 학습" 진입 1개 → 이 모달 하나 → 상단 탭 3개(기본정보/브랜드킷/브랜드보이스).
 * 기존 흩어진 BrandStudioCard·BrandVoiceCard 카드 2개 폐기·통합. 다크 모던·시인성.
 * 전 채널(DM·이메일·인앱)·문안 생성이 참조하는 브랜드 정보의 유일한 편집 창구.
 */
import { useState } from 'react';
import { Palette, X, IdCard, Sparkles, Mic } from 'lucide-react';
import BrandBasicInfoTab from './BrandBasicInfoTab';
import BrandKitTab from './BrandKitTab';
import BrandVoiceCard from './BrandVoiceCard';

type Toast = (msg: string, type?: 'success' | 'error' | 'info') => void;
// BrandVoiceCard.onConfirm 시그니처와 정확히 일치(description·onConfirm 필수)
type ConfirmOpts = { title: string; description: string; confirmLabel?: string; cancelLabel?: string; onConfirm: () => void };

interface Props {
  open: boolean;
  onClose: () => void;
  apiBase: string;
  token: string;
  onToast: Toast;
  onConfirm: (opts: ConfirmOpts) => void; // 브랜드보이스 카드의 삭제 확인용
}

type TabKey = 'basic' | 'kit' | 'voice';
const TABS: Array<{ key: TabKey; label: string; icon: typeof IdCard }> = [
  { key: 'basic', label: '기본정보', icon: IdCard },
  { key: 'kit', label: '브랜드킷', icon: Palette },
  { key: 'voice', label: '브랜드보이스', icon: Mic },
];

export default function BrandLearningModal({ open, onClose, apiBase, token, onToast, onConfirm }: Props) {
  const [tab, setTab] = useState<TabKey>('basic');
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl my-8">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">브랜드 학습</div>
              <div className="text-[11px] text-white/50">한 곳에 학습해두면 DM · 이메일 · 인앱 · 문안 생성이 모두 참고합니다</div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors" aria-label="닫기">
            <X className="w-4 h-4 text-white/70" />
          </button>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 px-5 pt-4">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-semibold border-b-2 transition-colors ${
                  active ? 'text-white border-sky-400 bg-white/5' : 'text-white/50 border-transparent hover:text-white/80'
                }`}
              >
                <Icon className="w-4 h-4" /> {t.label}
              </button>
            );
          })}
        </div>

        {/* 콘텐츠 */}
        <div className="p-5 border-t border-white/10">
          {tab === 'basic' && <BrandBasicInfoTab apiBase={apiBase} token={token} onToast={onToast} />}
          {tab === 'kit' && <BrandKitTab apiBase={apiBase} token={token} onToast={onToast} />}
          {tab === 'voice' && <BrandVoiceCard apiBase={apiBase} token={token} onToast={onToast} onConfirm={onConfirm} />}
        </div>
      </div>
    </div>
  );
}
