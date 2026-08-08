/**
 * EventCampaignResumeBar — 임시 보관한 행사 캠페인 재개 (2026-07-08)
 *
 * 3채널 생성 후 하나를 편집하러 나가면 나머지 채널은 계정 DB(event_campaign_drafts)에 보관된다.
 * 이 바에서 보관된 세트를 클릭 → EventCampaignModal을 resumeDraftId로 열어 남은 채널을 이어서 편집.
 * 활성 세트가 없으면 아무것도 렌더하지 않는다. (마케팅 캘린더 · AI Operator 진입 페이지 공용)
 */
import { useEffect, useState } from 'react';
import { CalendarClock, ChevronRight } from 'lucide-react';
import { CHANNELS } from './EventCampaignModal';

interface DraftRow {
  id: string;
  title: string;
  channels: Record<string, any>;
  updated_at: string;
}

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

  // ★ 2026-08-08 (임은지 접수) **어느 채널인지를 목록에서 보여준다.**
  //   그전에는 같은 판정으로 개수만 세어(`N채널`) 버려서, DM인지 이메일인지 알려면 하나씩 열어봐야 했다.
  //   라벨은 EventCampaignModal의 CHANNELS 하나에서만 나온다(순서도 그 배열이 정한다 — 모달과 같은 차례로 읽힌다).
  const savedChannels = (ch: any) => CHANNELS.filter((c) => ch?.[c.key]?.payload);

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
            {savedChannels(d.channels).map((c) => (
              <span
                key={c.key}
                className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium text-white/70 bg-white/10 border border-white/10 rounded px-1.5 py-0.5"
              >
                <c.icon className="w-2.5 h-2.5" />
                {c.label}
              </span>
            ))}
            <ChevronRight className="w-3 h-3 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
