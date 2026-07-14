/**
 * DmPublicLinkStatsPanel — 기본형(공용 링크) 추적 패널 (2026-07-15 Harold 확정 — 추적 2원화)
 *
 * 개인화 발송 추적(수신자별)과 분리된 두 번째 축: 공용 링크(한글 주소·발행 주소)로 들어온
 * 익명 열람의 집계 — 클릭 → 열람 → 유니크 방문 → 평균 스크롤·체류 + 링크별 분해 + 일별 추이.
 * Data source = dm_views(익명 행) + dm_custom_short_links 클릭 집계.
 */
import { useEffect, useState } from 'react';
import { Loader2, Copy, MousePointerClick, Eye, Users, ArrowDownWideNarrow, Timer, AlertTriangle } from 'lucide-react';
import { useToast } from '../ToastProvider';

interface PublicStats {
  alias: { code: string; clickCount: number; shortUrl: string | null } | null;
  publicUrl: string | null;
  totals: { views: number; unique_visitors: number; opens: number; avg_scroll_pct: string | null; avg_duration_seconds: string | null } | null;
  bySource: Array<{ entry_source: string; views: number; unique_visitors: number; opens: number; avg_scroll_pct: string | null; avg_duration_seconds: string | null }>;
  daily: Array<{ day: string; views: number }>;
}

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

const fmtDur = (v: string | null | undefined) => {
  const n = Math.round(Number(v || 0));
  if (!n) return '0초';
  if (n < 60) return `${n}초`;
  return `${Math.floor(n / 60)}분 ${n % 60}초`;
};

export default function DmPublicLinkStatsPanel({ dmId }: { dmId: string }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migrationPending, setMigrationPending] = useState(false);
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      setMigrationPending(false);
      try {
        const res = await fetch(`/api/dm/${dmId}/public-link-stats`, { headers: auth() });
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) {
          if (data.code === 'DB_MIGRATION_PENDING') { setMigrationPending(true); return; }
          throw new Error(data.error || '공용 링크 추적 조회에 실패했습니다.');
        }
        setStats(data);
      } catch (e: any) {
        if (alive) setError(e?.message || '공용 링크 추적 조회에 실패했습니다.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [dmId]);

  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('복사되었습니다.'); }
    catch { toast.error('복사에 실패했습니다.'); }
  };

  if (loading) return <div className="py-12 flex justify-center text-white/50"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (migrationPending) {
    return (
      <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.07] p-4 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-100/90 leading-relaxed">공용 링크 추적 준비 중입니다. 운영자의 DB 반영 후 사용할 수 있어요.</p>
      </div>
    );
  }
  if (error) return <p className="text-xs text-rose-300 py-6 text-center">{error}</p>;
  if (!stats) return null;

  const t = stats.totals;
  const maxDaily = Math.max(1, ...stats.daily.map((d) => d.views));

  return (
    <div className="space-y-4">
      {/* 링크 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="rounded-xl border border-sky-400/25 bg-sky-400/[0.06] p-3.5">
          <p className="text-[10px] text-white/40 mb-1">한글 주소</p>
          {stats.alias?.shortUrl ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-sky-200 truncate">{stats.alias.shortUrl.replace(/^https?:\/\//, '')}</span>
              <button onClick={() => copyText(stats.alias!.shortUrl!)} className="p-1.5 rounded-lg text-sky-200/70 hover:text-sky-100 hover:bg-white/10 flex-shrink-0" aria-label="한글 주소 복사"><Copy className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <p className="text-xs text-white/35">아직 없어요 — DM 카드의 [한글 주소]에서 만들 수 있어요</p>
          )}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
          <p className="text-[10px] text-white/40 mb-1">발행 주소 (기본)</p>
          {stats.publicUrl ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-white/70 truncate">{stats.publicUrl.replace(/^https?:\/\//, '')}</span>
              <button onClick={() => copyText(stats.publicUrl!)} className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 flex-shrink-0" aria-label="발행 주소 복사"><Copy className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <p className="text-xs text-white/35">발행 후 생성됩니다</p>
          )}
        </div>
      </div>

      {/* 퍼널 지표 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {[
          { l: '링크 클릭', v: stats.alias?.clickCount ?? 0, c: 'text-sky-300', icon: MousePointerClick, sub: '한글 주소' },
          { l: '열람', v: t?.views ?? 0, c: 'text-cyan-300', icon: Eye, sub: `재열람 포함 ${Number(t?.opens ?? 0).toLocaleString()}회` },
          { l: '방문자', v: t?.unique_visitors ?? 0, c: 'text-violet-300', icon: Users, sub: '기기 기준' },
          { l: '평균 스크롤', v: `${Math.round(Number(t?.avg_scroll_pct || 0))}%`, c: 'text-emerald-300', icon: ArrowDownWideNarrow, raw: true },
          { l: '평균 체류', v: fmtDur(t?.avg_duration_seconds), c: 'text-amber-300', icon: Timer, raw: true },
        ].map((m: any) => (
          <div key={m.l} className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
            <p className="text-[10px] text-white/40 flex items-center justify-center gap-1"><m.icon className="w-3 h-3" /> {m.l}</p>
            <p className={`text-xl font-bold ${m.c}`}>{m.raw ? m.v : Number(m.v).toLocaleString()}</p>
            {m.sub && <p className="text-[9.5px] text-white/30">{m.sub}</p>}
          </div>
        ))}
      </div>

      {/* 유입 링크별 분해 */}
      {stats.bySource.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3.5">
          <p className="text-[11px] font-semibold text-white/50 mb-2">유입 링크별</p>
          <div className="space-y-1.5">
            {stats.bySource.map((s) => (
              <div key={s.entry_source} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-sky-200 font-semibold truncate">hlj.kr/{s.entry_source}</span>
                <span className="text-white/55 flex-shrink-0">
                  열람 {Number(s.views).toLocaleString()} · 방문자 {Number(s.unique_visitors).toLocaleString()} · 스크롤 {Math.round(Number(s.avg_scroll_pct || 0))}% · 체류 {fmtDur(s.avg_duration_seconds)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 일별 추이 (최근 14일) */}
      {stats.daily.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3.5">
          <p className="text-[11px] font-semibold text-white/50 mb-2">일별 열람 추이 (최근 14일)</p>
          <div className="flex items-end gap-1 h-16">
            {stats.daily.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${d.day} — ${d.views.toLocaleString()}회`}>
                <div className="w-full rounded-t bg-gradient-to-t from-sky-500/60 to-cyan-400/60" style={{ height: `${Math.max(6, Math.round((d.views / maxDaily) * 100))}%` }} />
                <span className="text-[8.5px] text-white/30 truncate">{d.day.slice(3)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10.5px] text-white/40 leading-relaxed">공용 링크는 전체 대상 발송·공유용이라 개인 단위 추적 없이 집계로 보여드려요. 누가 열었는지는 [개인화 발송] 탭(문자 개인화 링크)이 담당합니다.</p>
      <div className="text-[10px] text-white/30 italic">Data source — dm_views 익명 열람(개인화 링크 외 유입 전체) + dm_custom_short_links 클릭 집계 · 링크별 행은 한글 주소 유입만 귀속</div>
    </div>
  );
}
