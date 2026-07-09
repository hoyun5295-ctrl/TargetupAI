/**
 * QuickCampaignPage — 원클릭 캠페인 (2026-07-08)
 *
 * SUB_MODULE_CARDS "원클릭 캠페인" 타일(/quick-campaign)의 집. 옛 AI Operator "행사 캠페인" 알약을 타일로 승격.
 * 진입 즉시 EventCampaignModal이 열린다(1클릭 흐름). 모달을 닫으면 이 페이지에서
 * 임시 보관 세트 재개(EventCampaignResumeBar) + 새 캠페인 시작을 이어갈 수 있다.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import { ArrowLeft, Sparkles, Wand2 } from 'lucide-react';
import EventCampaignModal from '../components/EventCampaignModal';
import EventCampaignResumeBar from '../components/EventCampaignResumeBar';

export default function QuickCampaignPage() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(true); // 진입 즉시 모달
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [resumeRefresh, setResumeRefresh] = useState(0);

  const startNew = () => { setResumeDraftId(null); setOpen(true); };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* 헤더 (sticky) */}
      <div className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => goBackOr(navigate, '/ai-operator')}
            className="text-white/50 hover:text-white p-1.5 rounded-lg hover:bg-white/10"
            aria-label="AI Operator로 돌아가기"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-fuchsia-500/25">
            <Wand2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white">원클릭 캠페인</h1>
            <p className="text-[11px] text-white/50">행사 내용·이미지 한 번 입력 → DM·이메일·인앱 초안 한 번에</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
        <EventCampaignResumeBar
          refreshKey={resumeRefresh}
          onResume={(id) => { setResumeDraftId(id); setOpen(true); }}
        />

        {/* 새 캠페인 시작 카드 */}
        <div className="rounded-2xl border border-violet-400/30 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 p-6 text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-fuchsia-500/25 mb-3">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div className="text-sm font-bold text-white">새 캠페인 시작</div>
          <p className="text-[12px] text-white/50 mt-1 mb-4">행사 내용을 붙여넣거나 이미지를 올리면, 고른 채널(DM·이메일·인앱) 초안을 한 번에 만들어 드려요.</p>
          <button
            onClick={startNew}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-fuchsia-500 text-indigo-950 text-sm font-bold hover:brightness-110 transition-all"
          >
            <Wand2 className="w-4 h-4" /> 캠페인 만들기
          </button>
        </div>
      </div>

      <EventCampaignModal
        open={open}
        resumeDraftId={resumeDraftId || undefined}
        onClose={() => { setOpen(false); setResumeDraftId(null); setResumeRefresh((v) => v + 1); }}
      />
    </div>
  );
}
