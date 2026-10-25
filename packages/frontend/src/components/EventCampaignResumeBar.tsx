/**
 * EventCampaignResumeBar — 임시 보관한 행사 캠페인 재개 (2026-07-08)
 *
 * 3채널 생성 후 하나를 편집하러 나가면 나머지 채널은 계정 DB(event_campaign_drafts)에 보관된다.
 * 이 바에서 보관된 세트를 클릭 → EventCampaignModal을 resumeDraftId로 열어 남은 채널을 이어서 편집.
 * 활성 세트가 없으면 아무것도 렌더하지 않는다. (마케팅 캘린더 · AI Operator 진입 페이지 공용)
 */
import { useEffect, useState } from 'react';
import { CalendarClock, ChevronRight, X } from 'lucide-react';
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
  // ★ 2026-10-25 원장 #100 — 잘림 표시 · [치우기](보관 종료 주소 · 옛: 주소는 있는데 버튼 0 → 30일 동안 칩이 쌓였다)
  const [truncated, setTruncated] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch('/api/event-campaigns/drafts', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((r) => (r.ok ? r.json() : { drafts: [] }))
      .then((data) => { if (alive) { setDrafts(Array.isArray(data?.drafts) ? data.drafts : []); setTruncated(data?.truncated === true); } })
      .catch(() => { if (alive) setDrafts([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [refreshKey]);

  const archive = async (id: string) => {
    if (removing) return;
    setRemoving(id);
    setRemoveError(null);
    try {
      const r = await fetch(`/api/event-campaigns/drafts/${encodeURIComponent(id)}/archive`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      if (r.ok) setDrafts((prev) => prev.filter((d) => d.id !== id));
      else setRemoveError('치우지 못했어요. 잠시 후 다시 시도해 주세요.');
    } catch {
      setRemoveError('치우지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setRemoving(null);
    }
  };

  if (loading || drafts.length === 0) return null;

  // ★ 2026-08-08 (임은지 접수) **어느 채널인지를 목록에서 보여준다.**
  //   그전에는 같은 판정으로 개수만 세어(`N채널`) 버려서, DM인지 이메일인지 알려면 하나씩 열어봐야 했다.
  //   라벨은 EventCampaignModal의 CHANNELS 하나에서만 나온다(순서도 그 배열이 정한다 — 모달과 같은 차례로 읽힌다).
  const savedChannels = (ch: any) => CHANNELS.filter((c) => ch?.[c.key]?.payload);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 mb-4">
      <div className="flex items-center gap-1.5 mb-2">
        <CalendarClock className="w-3.5 h-3.5 text-violet-700" />
        <span className="text-xs font-bold text-slate-700">임시 보관한 행사 캠페인</span>
        <span className="text-[10px] text-slate-400">(이어서 편집할 수 있어요)</span>
      </div>
      {truncated && <p className="text-[10.5px] text-slate-500 mb-1.5">최근 {drafts.length}개만 보여요. 다 쓴 것은 [치우기]로 정리해 주세요.</p>}
      {removeError && <p className="text-[10.5px] text-rose-600 mb-1.5">{removeError}</p>}
      <div className="flex flex-wrap gap-2">
        {drafts.map((d) => (
          <span key={d.id} className="inline-flex items-stretch max-w-full">
          <button
            type="button"
            onClick={() => onResume(d.id)}
            className="inline-flex items-center gap-1.5 text-[11px] text-violet-900 border border-violet-300 bg-violet-50 hover:bg-violet-100 rounded-l-lg px-2.5 py-1.5 transition-colors max-w-full"
          >
            <span className="truncate max-w-[220px]">{d.title || '행사 캠페인'}</span>
            {savedChannels(d.channels).map((c) => (
              <span
                key={c.key}
                className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5"
              >
                <c.icon className="w-2.5 h-2.5" />
                {c.label}
              </span>
            ))}
            <ChevronRight className="w-3 h-3 shrink-0" />
          </button>
          <button
            type="button"
            onClick={() => { void archive(d.id); }}
            disabled={removing === d.id}
            aria-label={`${d.title || '행사 캠페인'} 치우기`}
            title="치우기"
            className="inline-flex items-center px-1.5 text-violet-700 border border-l-0 border-violet-300 bg-violet-50 hover:bg-violet-100 rounded-r-lg disabled:opacity-50"
          >
            <X className="w-3 h-3" />
          </button>
          </span>
        ))}
      </div>
    </div>
  );
}
