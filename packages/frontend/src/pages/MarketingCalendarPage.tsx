// 마케팅 캘린더 — 1년 시즌 캠페인 AI 설계 → 선택 등록 (2026-07-02 4차, Harold 확정)
// 흐름(1클릭 원칙): [AI로 1년 설계] → 12개월 카드 → 원하는 달 선택 → [등록] → 크레딧 확인 → 자동마케팅(월간) 일괄 등록.
// 다크 slate + 단일 액센트, native dialog 0(useToast + CreditConfirmModal), 생성 중 로딩 오버레이 + 닫기 차단(D185).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Sparkles, Loader2, Check } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import CreditConfirmModal from '../components/credit/CreditConfirmModal';

interface CalendarEntry {
  month: number;
  title: string;
  objective: string;
  suggestedDay: number;
}

const MONTH_LABEL = ['', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

export default function MarketingCalendarPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/operator/marketing-calendar/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: '{}',
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || '설계 생성에 실패했습니다.');
        toast.error(data.error || '설계 생성에 실패했습니다.');
        return;
      }
      setEntries(data.entries || []);
      setSelected(new Set((data.entries || []).map((e: CalendarEntry) => e.month)));
      toast.success('1년 캘린더 설계가 준비됐습니다. 원하는 달을 골라 등록하세요.');
    } catch (e: any) {
      setError(e?.message || '네트워크 오류');
      toast.error(e?.message || '네트워크 오류가 발생했습니다.');
    } finally {
      setGenerating(false);
    }
  };

  const toggle = (month: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month); else next.add(month);
      return next;
    });
  };

  const setDay = (month: number, day: number) => {
    setEntries((prev) => prev.map((e) => (e.month === month ? { ...e, suggestedDay: day } : e)));
  };

  const registerSelected = async () => {
    const picks = entries.filter((e) => selected.has(e.month));
    if (picks.length === 0) return;
    setRegistering(true);
    let ok = 0;
    let fail = 0;
    for (const e of picks) {
      try {
        const res = await fetch('/api/ai/operator/continuous', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth() },
          body: JSON.stringify({
            name: `${MONTH_LABEL[e.month]} ${e.title}`.slice(0, 100),
            objective: e.objective,
            schedule: 'monthly',
            schedule_time: '10:00',
            schedule_day_of_month: e.suggestedDay,
            channel: 'lms',
            send_time_mode: 'fixed',
            delivery_policy: 'monthly',
          }),
        });
        const data = await res.json();
        if (data.success) ok++; else fail++;
      } catch { fail++; }
    }
    setRegistering(false);
    if (ok > 0) toast.success(`${ok}건을 자동마케팅으로 등록했습니다.${fail > 0 ? ` (${fail}건 실패)` : ''}`);
    else toast.error('등록에 실패했습니다. 크레딧과 권한을 확인해주세요.');
    if (ok > 0) navigate('/continuous-operator');
  };

  const pickedCount = entries.filter((e) => selected.has(e.month)).length;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="bg-slate-950/80 backdrop-blur-sm border-b border-white/10 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3 flex-wrap">
          <button onClick={() => navigate('/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="뒤로">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-rose-500/20">
            <CalendarDays className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-semibold">마케팅 캘린더</h1>
              <span className="text-[10px] bg-gradient-to-r from-amber-400 to-orange-500 text-white px-2 py-0.5 rounded-full font-bold tracking-wide">BETA</span>
            </div>
            <p className="text-xs md:text-sm text-white/50 mt-0.5">업종·시즌·회사 데이터로 1년치 캠페인을 AI가 설계 — 고른 달은 그대로 자동마케팅으로</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-5 relative">
        {entries.length === 0 && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-10 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-orange-400/30 to-rose-500/30 flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-orange-300" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">1년치 마케팅, 한 번에 설계합니다</h2>
            <p className="mt-1.5 text-[13px] text-white/55 leading-relaxed">
              설날·여름 휴가·추석·연말 같은 시즌과 업종 성수기를 조합해 12개월 캠페인을 제안합니다.<br />
              마음에 드는 달만 골라 등록하면 매월 정해진 날, 2시간 전 문안 안내와 함께 자동 발송됩니다.
            </p>
            <button
              onClick={generate}
              disabled={generating}
              className="mt-5 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-orange-500/80 to-rose-500/80 hover:opacity-90 disabled:opacity-40 text-sm font-semibold transition-opacity"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              AI로 1년 설계하기
            </button>
            {error && <div className="mt-4 text-xs text-rose-300">{error}</div>}
            <div className="mt-4 text-[10px] text-white/30 italic">Data source — 회사 업종·브랜드·고객 규모 + 한국 시즌 달력</div>
          </div>
        )}

        {entries.length > 0 && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm text-white/70">원하는 달을 선택하세요 — 선택 {pickedCount}건</div>
              <button onClick={generate} disabled={generating} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 transition-colors">
                다시 설계
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {entries.map((e) => {
                const on = selected.has(e.month);
                return (
                  <div key={e.month} className={`rounded-2xl border p-4 transition-colors ${on ? 'bg-orange-500/10 border-orange-400/40' : 'bg-white/5 border-white/10'}`}>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">{MONTH_LABEL[e.month]} · {e.title}</div>
                      <button
                        onClick={() => toggle(e.month)}
                        className={`w-6 h-6 rounded-md border flex items-center justify-center transition-colors ${on ? 'bg-orange-500/60 border-orange-400/60' : 'bg-white/5 border-white/20'}`}
                        aria-label={`${MONTH_LABEL[e.month]} 선택`}
                      >
                        {on && <Check className="w-4 h-4 text-white" />}
                      </button>
                    </div>
                    <p className="mt-2 text-[12px] text-white/60 leading-relaxed">{e.objective}</p>
                    <div className="mt-3 flex items-center gap-2 text-[11px] text-white/50">
                      <span>발송일</span>
                      <select
                        value={e.suggestedDay}
                        onChange={(ev) => setDay(e.month, Number(ev.target.value))}
                        className="px-2 py-1 bg-white/5 border border-white/10 rounded text-white text-[11px] focus:outline-none focus:border-orange-400/50"
                      >
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}일</option>)}
                      </select>
                      <span>· 오전 10:00 · 발송 2시간 전 문안 안내</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="sticky bottom-4 flex justify-center">
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={pickedCount === 0 || registering}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-orange-500/90 to-rose-500/90 hover:opacity-90 disabled:opacity-40 text-sm font-semibold shadow-2xl shadow-rose-500/20 transition-opacity"
              >
                {registering ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}
                선택 {pickedCount}건 자동마케팅으로 등록
              </button>
            </div>
            <div className="text-center text-[11px] text-white/40">등록 시 건당 자동마케팅 저장 크레딧이 차감됩니다. 혜택 문구는 등록 후 각 항목에서 직접 입력할 수 있습니다.</div>
          </>
        )}

        {generating && (
          <div className="fixed inset-0 z-40 bg-slate-950/85 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-7 h-7 text-orange-300 animate-spin" />
            <div className="text-sm text-white/80">AI가 1년치 캘린더를 설계하고 있습니다</div>
            <div className="text-xs text-white/40">창을 닫지 마세요</div>
          </div>
        )}
      </div>

      <CreditConfirmModal
        open={confirmOpen}
        source="continuous-operator"
        onConfirm={() => { setConfirmOpen(false); registerSelected(); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
