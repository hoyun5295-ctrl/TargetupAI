/**
 * VoiceHabitsCard — 쓸수록 배우는 습관 · 고친 말투 (★ 2026-10-28 AI 메모리 설계 K14 · docs/2026-10-28-ai-memory-brand-voice-design.md)
 *
 * 숫자 띠(ZoneStatStrip) + 조언 한 장(서버가 숫자로 만든 문장 · 페이지를 열 때 AI 0) + 고친 말투 후보 칩(사람이 받아들인 것만 문안에 쓰인다).
 * 재료가 없으면 「아직 배울 재료가 없어요」(습관이 없다는 뜻과 구분).
 */
import { useEffect, useState } from 'react';
import { Lightbulb, Check, X, Loader2, MessageSquareQuote } from 'lucide-react';
import ZoneStatStrip from '../zone/ZoneStatStrip';

interface Habit { samples: number; topWeekdays: number[]; topHours: number[]; intervalMedianDays: number | null; channels: Record<string, number>; adRatio: number }
interface Candidate { id: string; mode: 'use' | 'avoid'; text: string; count: number }
interface HabitsData {
  habit: Habit | null;
  advice: string[];
  candidates: Candidate[];
  accepted: { use: Array<{ text: string }>; avoid: Array<{ text: string }> };
  editSamples: number;
  canEdit: boolean;
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const hourLabel = (h: number) => `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}시`;

export default function VoiceHabitsCard({ apiBase, token, onToast }: { apiBase: string; token: string; onToast: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const [data, setData] = useState<HabitsData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const auth = { Authorization: `Bearer ${token}` };

  const load = async () => {
    try {
      const r = await fetch(`${apiBase}/api/ai-memory/voice-habits`, { headers: auth });
      const d = await r.json();
      if (r.ok && d.success) setData(d);
    } catch { /* 카드만 비움 */ }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const decide = async (c: Candidate, action: 'accept' | 'dismiss') => {
    setBusy(c.id);
    try {
      const r = await fetch(`${apiBase}/api/ai-memory/voice-habits/candidates/${c.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ action }) });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || '저장하지 못했어요.');
      onToast(action === 'accept' ? '다음 문안부터 반영해요.' : '이 후보는 다시 묻지 않아요.', 'success');
      await load();
    } catch (e: any) {
      onToast(e.message || '저장하지 못했어요.', 'error');
    } finally {
      setBusy(null);
    }
  };
  const removeAccepted = async (mode: 'use' | 'avoid', text: string) => {
    setBusy(text);
    try {
      const r = await fetch(`${apiBase}/api/ai-memory/voice-habits/accepted/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ mode, text }) });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || '바꾸지 못했어요.');
      await load();
    } catch (e: any) {
      onToast(e.message || '바꾸지 못했어요.', 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!data) return null;
  const h = data.habit;
  const mainCh = h ? Object.entries(h.channels).sort((a, b) => b[1] - a[1])[0] : null;

  return (
    <div className="space-y-3">
      <ZoneStatStrip
        title="쓸수록 배운 습관"
        cells={[
          { label: '배운 발송', value: h ? `${h.samples}건` : '재료 없음' },
          { label: '자주 보내는 요일', value: h && h.topWeekdays.length ? h.topWeekdays.map((d) => WD[d]).join(' · ') : '고르게' },
          { label: '자주 보내는 시각', value: h && h.topHours.length ? h.topHours.map(hourLabel).join(' · ') : '고르게' },
          { label: '보내는 간격', value: h?.intervalMedianDays ? `${h.intervalMedianDays}일` : '재는 중' },
          { label: '주 채널', value: mainCh ? mainCh[0] : '재는 중' },
        ]}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="p-4 bg-white border border-slate-200 rounded-2xl">
          <div className="flex items-center gap-2 mb-2"><Lightbulb className="w-4 h-4 text-amber-600" /><h3 className="text-sm font-semibold text-slate-900">발송 습관 조언</h3></div>
          {data.advice.length > 0
            ? <ul className="space-y-1 text-sm text-slate-800">{data.advice.map((a, i) => <li key={i}>{a}</li>)}</ul>
            : <p className="text-sm text-slate-600">아직 배울 재료가 없어요. 직접 보낸 문자가 10건 넘게 쌓이면 보내는 때 · 간격을 알려 드려요.</p>}
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-2xl">
          <div className="flex items-center gap-2 mb-2"><MessageSquareQuote className="w-4 h-4 text-violet-700" /><h3 className="text-sm font-semibold text-slate-900">담당자가 고쳐 온 말투</h3></div>
          {data.candidates.length === 0 && data.accepted.use.length + data.accepted.avoid.length === 0 && (
            <p className="text-sm text-slate-600">{data.editSamples > 0 ? '아직 세 번 넘게 반복된 고침이 없어요.' : '아직 배울 재료가 없어요. AI 안을 고쳐 보내면 그 습관을 모아요.'}</p>
          )}
          <div className="space-y-2">
            {data.candidates.map((c) => (
              <div key={c.id} className="rounded-xl border border-violet-200 bg-violet-50/60 p-2.5">
                <div className="text-[12px] text-slate-600 mb-1">{c.mode === 'use' ? `${c.count}번 넣으셨어요. 이 문구를 우리 말투로 쓸까요?` : `${c.count}번 지우셨어요. 이 표현은 앞으로 쓰지 말까요?`}</div>
                <div className="text-sm font-semibold text-slate-900 mb-2">「{c.text}」</div>
                {data.canEdit && (
                  <div className="flex gap-2">
                    <button disabled={busy === c.id} onClick={() => decide(c, 'accept')} className="px-3 py-1.5 text-xs rounded-lg bg-violet-600 text-white font-semibold flex items-center gap-1 disabled:opacity-50">{busy === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}{c.mode === 'use' ? '쓸게요' : '안 쓸게요'}</button>
                    <button disabled={busy === c.id} onClick={() => decide(c, 'dismiss')} className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-700">아니요</button>
                  </div>
                )}
              </div>
            ))}
            {(['use', 'avoid'] as const).map((mode) => data.accepted[mode].length > 0 && (
              <div key={mode}>
                <div className="text-[12px] font-semibold text-slate-700 mb-1">{mode === 'use' ? '쓸 것' : '피할 것'}</div>
                <div className="flex flex-wrap gap-1.5">
                  {data.accepted[mode].map((a) => (
                    <span key={a.text} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-slate-300 bg-white text-slate-800">
                      {a.text}
                      {data.canEdit && <button aria-label="지우기" disabled={busy === a.text} onClick={() => removeAccepted(mode, a.text)} className="p-0.5 rounded hover:bg-slate-100"><X className="w-3 h-3" /></button>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
