/**
 * EventCampaignResumeBar — 임시 보관한 행사 캠페인 재개 (2026-07-08)
 *
 * 3채널 생성 후 하나를 편집하러 나가면 나머지 채널은 계정 DB(event_campaign_drafts)에 보관된다.
 * 이 바에서 보관된 세트를 클릭 → EventCampaignModal을 resumeDraftId로 열어 남은 채널을 이어서 편집.
 * 활성 세트가 없으면 아무것도 렌더하지 않는다. (마케팅 캘린더 · AI Operator 진입 페이지 공용)
 */
import { useEffect, useState } from 'react';
import { CalendarClock, ChevronRight } from 'lucide-react';

interface DraftRow {
  id: string;
  title: string;
  channels: Record<string, any>;
  updated_at: string;
}

const CH_KEYS = ['dm', 'email', 'inapp'];

export default function EventCampaignResumeBar({ refreshKey, onResume }: {
  refreshKey?: number;
  onResume: (id: string) => void;
}) {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch('/api/event-campaigns/drafts', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((r) => (r.ok ? r.json() : { drafts: [] }))
      .then((data) => { if (alive) setDrafts(Array.isArray(data?.drafts) ? data.drafts : []); })
      .catch(() => { if (alive) setDrafts([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [refreshKey]);

  if (loading || drafts.length === 0) return null;

  const channelCount = (ch: any) => CH_KEYS.filter((k) => ch?.[k]?.payload).length;

  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3 mb-4">
      <div className="flex items-center gap-1.5 mb-2">
        <CalendarClock className="w-3.5 h-3.5 text-violet-300" />
        <span className="text-xs font-bold text-white/80">임시 보관한 행사 캠페인</span>
        <span className="text-[10px] text-white/40">— 이어서 편집할 수 있어요</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {drafts.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onResume(d.id)}
            className="inline-flex items-center gap-1.5 text-[11px] text-violet-100 border border-violet-400/40 bg-violet-500/10 hover:bg-violet-500/20 rounded-lg px-2.5 py-1.5 transition-colors max-w-full"
          >
            <span className="truncate max-w-[220px]">{d.title || '행사 캠페인'}</span>
            <span className="text-white/40 shrink-0">· {channelCount(d.channels)}채널</span>
            <ChevronRight className="w-3 h-3 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
