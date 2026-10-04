/**
 * PlannerBriefPage.tsx — 마케팅 플래너 이달 결과 (★ 2026-08-13 Phase 2 · ★ 2026-10-04 보강 · 설계서 §5-5)
 *
 * ★ 2026-10-04 월간 결재(결재 카드 · 결재 올리기 · 월 승인) 폐지 — 승인은 행사마다(행사 상세 · 휴대폰 확인 화면).
 * 이 화면에 남은 것 = 이달 결과(실측 집계) + 월 대행 취소(⋯ 메뉴 · 회사 관리자). 행사를 누르면 행사 상세.
 * ⛔ 수치는 서버 실측 그대로(보여준 수 = 나간 수) · 금액 하드코딩 0 · native dialog 0 · 모델명 0.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, ChevronRight, Loader2 } from 'lucide-react';
import ZoneFrame from '../components/zone/ZoneFrame';
import { useToast } from '../components/ToastProvider';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';
import { PLANNER_TP_STATUS, plannerDay, plannerRange } from '../constants/planner-status';
import { plannerApi, plannerErrorText, won } from '../components/planner/planner-api';

interface ResultMetric { label: string; value: string }
interface ResultTouchpoint { id: string; channel: string; channelLabel: string; scheduledOn: string; status: string; lockReason: string | null; metrics: ResultMetric[] }
interface ResultEvent { id: string; title: string; startsOn: string; endsOn: string; status: string; participants: number; touchpoints: ResultTouchpoint[] }
interface MonthlyResult {
  month: string; events: ResultEvent[];
  totals: { touchpointCount: number; sentCount: number; successCount: number; participants: number };
  notifiedAt: string | null;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

export default function PlannerBriefPage() {
  const { month = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [result, setResult] = useState<MonthlyResult | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'fail' | 'pending'>('loading');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  useEffect(() => { if (!MONTH_RE.test(month)) navigate('/marketing-planner', { replace: true }); }, [month, navigate]);

  const load = useCallback(async () => {
    if (!MONTH_RE.test(month)) return;
    setState('loading');
    const r = await plannerApi<MonthlyResult>(`/api/marketing-planner/brief/${month}/result`);
    if (r.ok) { setResult(r.data); setState('ok'); return; }
    if (r.status === 503 && r.data?.code === 'DB_MIGRATION_PENDING') { setState('pending'); return; }
    setResult(null);
    setState('fail');
  }, [month]);
  useEffect(() => { void load(); }, [load]);

  const monthLabel = MONTH_RE.test(month) ? `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월` : '';
  const askCancel = () => setConfirm({
    mode: 'danger',
    title: `${monthLabel} 대행을 취소할까요?`,
    description: '이번 달 남은 발송이 모두 멈춰요. 이번 달에 나간 발송이 아직 없으면 대행료를 전액 돌려드려요. 승인 때 낸 모바일 DM 발행비·메일 완성비는 돌려드리지 않아요.',
    confirmLabel: '대행 취소',
    cancelLabel: '돌아가기',
    onConfirm: async () => {
      setConfirm(null);
      const r = await plannerApi<{ refunded: boolean; refundAmount: number; reason: string }>(`/api/marketing-planner/brief/${month}/cancel`, { body: {} });
      if (!r.ok) { toast.error(plannerErrorText(r, '월 대행을 취소하지 못했어요.')); return; }
      toast.success(r.data.refunded ? `이번 달 대행을 취소하고 ${won(r.data.refundAmount)}크레딧을 돌려드렸어요.` : `이번 달 대행을 취소했어요. ${r.data.reason || ''}`.trim());
      void load();
    },
  });

  const t = result?.totals;
  return (
    <ZoneFrame
      moduleId="planner"
      sub={`${monthLabel} 결과`}
      backTo="/marketing-planner"
      backLabel="캘린더로"
      kpis={[
        { label: '행사', value: result ? `${result.events.length}건` : '확인 불가' },
        { label: '발송', value: t ? won(t.sentCount) : '확인 불가' },
        { label: '성공', value: t ? won(t.successCount) : '확인 불가', tone: 'emerald' },
      ]}
      links={[{ label: '캘린더', icon: CalendarDays, onClick: () => navigate(`/marketing-planner?month=${month}`) }]}
      stamp={{ text: '다시 읽기', onRefresh: () => { void load(); }, loading: state === 'loading' }}
      more={[{ label: '이번 달 대행 취소', onClick: askCancel, danger: true }]}
      blocks={[
        ...(state === 'fail' ? [{ text: '이달 결과를 불러오지 못했어요.', actionLabel: '다시 읽기', onAction: () => { void load(); }, tone: 'rose' as const }] : []),
        ...(state === 'pending' ? [{ text: '플래너 준비 작업이 진행 중이에요. 몇 분 뒤 다시 읽어 주세요.', actionLabel: '다시 읽기', onAction: () => { void load(); } }] : []),
      ]}
    >
      {state === 'loading' ? (
        <div className="py-20 flex items-center justify-center text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" />결과를 불러오는 중</div>
      ) : state === 'ok' && result ? (
        result.events.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-14 text-center">
            <p className="text-[14px] font-semibold text-slate-700">아직 모을 결과가 없어요</p>
            <p className="text-[12.5px] text-slate-500 mt-1">발송이 시작되면 실제 수치가 여기에 쌓여요</p>
          </div>
        ) : (
          <div className="space-y-3">
            {result.events.map((ev) => (
              <section key={ev.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <button type="button" onClick={() => navigate(`/marketing-planner/events/${ev.id}`)} className="w-full text-left px-4 md:px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-slate-50">
                  <span className="text-[14px] font-semibold">{ev.title}</span>
                  <span className="text-[12px] text-slate-500 tabular-nums">{plannerRange(ev.startsOn, ev.endsOn)}</span>
                  {ev.participants > 0 && <span className="text-[12px] text-emerald-800 tabular-nums">참여 신청 {won(ev.participants)}명</span>}
                  <ChevronRight className="ml-auto w-4 h-4 text-slate-400" />
                </button>
                <div className="divide-y divide-slate-100">
                  {ev.touchpoints.map((tp) => {
                    const st = PLANNER_TP_STATUS[tp.status];
                    return (
                      <div key={tp.id} className="px-4 md:px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <div className="min-w-[9rem]">
                          <div className="text-[13.5px]">{tp.channelLabel}</div>
                          <div className="text-[12px] text-slate-500 tabular-nums">{plannerDay(tp.scheduledOn)}</div>
                        </div>
                        {st && <span className={`text-[11.5px] font-semibold h-6 px-2 inline-flex items-center rounded-md border ${st.cls}`}>{st.label}</span>}
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 ml-auto">
                          {tp.metrics.map((m, i) => (
                            <div key={i} className="text-right">
                              <div className="text-[11px] text-slate-500">{m.label}</div>
                              <div className="text-[14px] font-semibold tabular-nums">{m.value}</div>
                            </div>
                          ))}
                        </div>
                        {tp.lockReason && <div className="w-full text-[12px] text-amber-800">{tp.lockReason}</div>}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            <p className="text-[10px] text-slate-500 italic">Data source: 문자는 발송 결과 집계, 메일은 발송·열어봄·클릭 실측, 참여 신청은 안내 메일의 참여 버튼 클릭 실측입니다. 추정값은 쓰지 않습니다.</p>
          </div>
        )
      ) : null}
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
    </ZoneFrame>
  );
}
