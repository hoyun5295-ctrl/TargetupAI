/**
 * PlannerBriefPage.tsx — 마케팅 플래너 월간 브리핑·결재 (★ 2026-08-13 Phase 2)
 *
 * 설계서 = docs/2026-08-12-ax-marketing-planner-design.md §5-3 · 기능 문서 §3
 *
 * 이 화면이 결재 서류다. 담당자는 여기서 그 달 계획 전체(행사 × 채널 × 시점 × 대상 수 × 크레딧)를 보고
 * 한 번 승인한다. 승인 = 그 달 대행 계약 — 그 전에는 제작도 발송도 차감도 없다.
 *
 * ⛔ 화면이 지켜야 하는 것
 *   - 수치는 서버 실쿼리 그대로 쓴다. 화면에서 다시 세거나 추정하지 않는다(보여준 수 = 나가는 수).
 *   - 못 센 축(인앱·알림톡)은 0으로 그리지 않고 사유를 그대로 보여준다.
 *   - 문자 문안은 결재 대상이 아니다(당일 생성) — 그 사실을 숨기지 않고 말한다.
 *   - 승인 버튼은 차감액을 명시한 확인 모달을 거친다. native dialog 금지 · 모델명 노출 금지.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, ClipboardCheck, Clock,
  Coins, Loader2, Send, Sparkles, Users, Wallet,
} from 'lucide-react';
import { goBackOr } from '../lib/scroll-restoration';
import { useToast } from '../components/ToastProvider';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';

// ── 타입 (백엔드 CT 미러 — 서버가 진실) ───────────────────────────────
/** state — known(셌다) / deferred(사후 확정 축) / error(못 셌다 = 승인 차단) */
interface ChannelAudience { count: number | null; state: 'known' | 'deferred' | 'error'; note: string }
interface BriefTouchpoint {
  id: string; channel: string; label: string;
  timing: { anchor: string; offsetDays?: number };
  scheduledOn: string; estCredits: number | null; audience: ChannelAudience;
}
interface BriefEvent {
  id: string; title: string; startsOn: string; endsOn: string;
  benefitText: string | null; products: Array<{ name: string }>;
  status: string; touchpoints: BriefTouchpoint[]; estCredits: number;
}
interface BriefTotals {
  eventCount: number; touchpointCount: number;
  productionCredits: number; agencyCredits: number; totalCredits: number;
}
interface ApprovalRecord {
  status: 'pending' | 'approving' | 'approved' | 'cancelled';
  submittedAt: string | null; approvedAt: string | null;
  agencyCredits: number; deductedAt: string | null; tokenExpiresAt: string | null;
  /** 결재에 올린 시점의 행사 수 — 승인 대상은 그 스냅샷이다 */
  eventCount: number;
}
interface MonthlyBrief {
  month: string; events: BriefEvent[]; totals: BriefTotals;
  balance: { total: number; creditEnabled: boolean };
  gate: { ok: boolean; shortfall: number; reason: string | null };
  approval: ApprovalRecord | null;
  /** 결재에 올린 뒤 계획이 바뀌었다 — 다시 올려야 그 변경이 승인 대상이 된다 */
  revisionChanged: boolean;
  /** 그 달 대행료가 이미 결제됐다 — 다시 올려 승인해도 추가 차감이 없다 */
  agencyPaid: boolean;
  pastMonth: boolean;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: '결재 대기', cls: 'bg-amber-500/20 text-amber-200 border-amber-400/30' },
  approving: { label: '승인 처리 중', cls: 'bg-amber-500/20 text-amber-200 border-amber-400/30' },
  approved: { label: '승인 완료', cls: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30' },
  cancelled: { label: '취소됨', cls: 'bg-white/10 text-white/60 border-white/15' },
};

const timingLabel = (t: BriefTouchpoint['timing']) => {
  if (t.anchor === 'end') return '행사 종료일';
  if (t.anchor === 'before_start') return `시작 ${t.offsetDays || 0}일 전`;
  return '행사 시작일';
};

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function PlannerBriefPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { month: monthParam } = useParams();
  const month = MONTH_RE.test(String(monthParam || '')) ? String(monthParam) : '';
  const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const [brief, setBrief] = useState<MonthlyBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'submit' | 'approve' | null>(null);
  const [migrationPending, setMigrationPending] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(async () => {
    if (!month) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/marketing-planner/brief?month=${month}`, { headers: auth() });
      if (r.status === 503) { setMigrationPending(true); setBrief(null); return; }
      if (!r.ok) { toast.error('브리핑을 불러오지 못했습니다'); return; }
      setMigrationPending(false);
      setBrief(await r.json());
    } catch {
      toast.error('네트워크 오류 — 다시 시도해 주세요');
    } finally {
      setLoading(false);
    }
  }, [month, toast]);

  useEffect(() => {
    if (!month) { navigate('/marketing-planner', { replace: true }); return; }
    load();
  }, [month, load, navigate]);

  const call = async (path: string, kind: 'submit' | 'approve') => {
    setBusy(kind);
    try {
      const r = await fetch(path, { method: 'POST', headers: auth() });
      const d = await r.json().catch(() => ({}));
      if (r.status === 503) { setMigrationPending(true); toast.error('준비 중입니다 — 잠시 후 다시 시도해 주세요'); return; }
      if (!r.ok) { toast.error(d.error || '처리하지 못했습니다'); return; }
      if (kind === 'submit') {
        toast.success(d.notified ? '결재 요청을 올렸습니다 — 담당자에게 안내 문자를 보냈습니다' : '결재 요청을 올렸습니다');
      } else {
        toast.success(d.deducted ? '이번 달 계획을 승인했습니다' : '이번 달 계획을 승인했습니다 (차감 대상 아님)');
      }
      await load();
    } catch {
      toast.error('네트워크 오류 — 다시 시도해 주세요');
    } finally {
      setBusy(null);
    }
  };

  const askApprove = () => {
    if (!brief) return;
    setConfirm({
      mode: 'default',
      title: '이번 달 계획 승인',
      description: brief.agencyPaid
        ? `이번 달 대행료는 이미 결제되어 추가 차감이 없습니다. ` +
          `소재 제작분(예상 ${brief.totals.productionCredits.toLocaleString()}크레딧)은 각 제작 시점에 차감됩니다. ` +
          `승인하면 변경된 계획대로 제작과 발송이 진행됩니다.`
        : `승인하면 월간 대행 ${brief.totals.agencyCredits.toLocaleString()}크레딧이 지금 차감됩니다. ` +
          `소재 제작분(예상 ${brief.totals.productionCredits.toLocaleString()}크레딧)은 각 제작 시점에 차감됩니다. ` +
          `승인 후에는 계획대로 제작과 발송이 진행됩니다.`,
      confirmLabel: '승인하고 대행 시작',
      onConfirm: async () => {
        setConfirm(null);
        await call(`/api/marketing-planner/brief/${month}/approve`, 'approve');
      },
    });
  };

  const monthLabel = month ? `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월` : '';
  const approval = brief?.approval || null;
  const approved = approval?.status === 'approved';
  const submitted = approval?.status === 'pending' || approval?.status === 'approving';
  const hasSmsLike = useMemo(
    () => (brief?.events || []).some((e) => e.touchpoints.some((t) => t.channel === 'sms' || t.channel === 'dm')),
    [brief],
  );
  // 결재에 올린 뒤 계획이 바뀌었으면 다시 올려야 한다 — 서류에 없던 행사는 승인 대상이 아니다.
  // 대행료는 그 달 멱등키가 막아 다시 나가지 않는다(설계서 §3-4).
  const revisionChanged = !!brief?.revisionChanged;
  const needsResubmit = revisionChanged && !brief?.pastMonth;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* ── sticky 헤더 ───────────────────────────────────────────── */}
      <div className="bg-slate-900/70 backdrop-blur-md border-b border-white/10 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
          <button onClick={() => goBackOr(navigate, '/marketing-planner')} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="플래너로 돌아가기">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/20">
            <ClipboardCheck className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-semibold">{monthLabel} 마케팅 브리핑</h1>
              {approval && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${(STATUS_BADGE[approval.status] || STATUS_BADGE.pending).cls}`}>
                  {(STATUS_BADGE[approval.status] || STATUS_BADGE.pending).label}
                </span>
              )}
            </div>
            <p className="text-xs md:text-sm text-white/50 mt-0.5 hidden md:block">
              한 번 승인하면 제작·발송·결과 보고까지 이어서 진행합니다
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 md:px-6 py-5 space-y-4">
        {migrationPending && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            결재 기능 준비 작업이 진행 중입니다. 잠시 후 새로고침해 주세요.
          </div>
        )}

        {loading ? (
          <div className="py-24 flex items-center justify-center text-white/40 text-sm">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> 브리핑을 불러오는 중...
          </div>
        ) : !brief ? (
          !migrationPending && (
            <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center text-sm text-white/50">
              브리핑을 불러오지 못했습니다.
            </div>
          )
        ) : (
          <>
            {/* ── 요약 4카드 ──────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="flex items-center gap-1.5 text-[11px] text-white/45"><CalendarDays className="w-3.5 h-3.5" /> 행사</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{brief.totals.eventCount}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="flex items-center gap-1.5 text-[11px] text-white/45"><Send className="w-3.5 h-3.5" /> 채널 접점</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{brief.totals.touchpointCount}</div>
              </div>
              <div className="rounded-2xl border border-violet-400/25 bg-violet-500/[0.08] px-4 py-3">
                <div className="flex items-center gap-1.5 text-[11px] text-violet-200/70"><Coins className="w-3.5 h-3.5" /> 예상 크레딧</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-violet-100">{brief.totals.totalCredits.toLocaleString()}</div>
                <div className="mt-0.5 text-[10px] text-white/40 tabular-nums">
                  대행 {brief.totals.agencyCredits.toLocaleString()} + 제작 {brief.totals.productionCredits.toLocaleString()}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="flex items-center gap-1.5 text-[11px] text-white/45"><Wallet className="w-3.5 h-3.5" /> 보유 크레딧</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {brief.balance.creditEnabled ? brief.balance.total.toLocaleString() : '—'}
                </div>
                {!brief.balance.creditEnabled && <div className="mt-0.5 text-[10px] text-white/40">크레딧 차감 대상 아님</div>}
              </div>
            </div>

            {/* ── 결재 카드 ───────────────────────────────────────── */}
            <div className="rounded-2xl border border-violet-400/25 bg-gradient-to-br from-violet-500/[0.12] to-fuchsia-500/[0.08] px-4 md:px-5 py-4">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-violet-300 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  {approved ? (
                    <>
                      <p className="text-sm font-semibold text-emerald-200 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" /> {monthLabel} 대행이 시작되었습니다
                      </p>
                      <p className="mt-1 text-xs text-white/60">
                        승인 {fmtDateTime(approval?.approvedAt || null)}
                        {approval?.deductedAt ? ` · 대행 ${approval.agencyCredits.toLocaleString()}크레딧 차감` : ' · 차감 대상 아님'}
                        {' · 소재 제작분은 각 제작 시점에 차감됩니다'}
                      </p>
                      {needsResubmit && (
                        <p className="mt-2 text-xs text-amber-200 flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                          승인 뒤 계획이 바뀌었습니다 — 변경분을 다시 결재에 올려 승인하면 같은 계약에 들어갑니다(대행료 추가 차감 없음).
                        </p>
                      )}
                    </>
                  ) : brief.pastMonth ? (
                    <p className="text-sm text-white/70">지난 달 계획은 결재하지 않습니다.</p>
                  ) : (
                    <>
                      <p className="text-sm font-semibold">
                        {needsResubmit
                          ? '결재에 올린 뒤 계획이 바뀌었습니다'
                          : submitted ? '승인만 하면 대행이 시작됩니다' : '이번 달 계획을 결재에 올리세요'}
                      </p>
                      <p className="mt-1 text-xs text-white/60">
                        {needsResubmit
                          ? '바뀐 계획으로 다시 올려야 그 내용이 승인 대상이 됩니다. 서류에 없던 행사는 승인되지 않습니다.'
                          : submitted
                            ? '승인 전에는 제작·발송·차감이 일어나지 않습니다.'
                            : '결재에 올리면 담당자에게 안내 문자가 나가고, 이 화면에서 바로 승인할 수 있습니다.'}
                      </p>
                      {!brief.gate.ok && brief.gate.reason && (
                        <p className="mt-2 text-xs text-amber-200 flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                          {brief.gate.reason}
                        </p>
                      )}
                    </>
                  )}
                </div>
                {((!approved && !brief.pastMonth) || needsResubmit) && (
                  <button
                    onClick={() => {
                      if (needsResubmit || !submitted) { call(`/api/marketing-planner/brief/${month}/submit`, 'submit'); return; }
                      askApprove();
                    }}
                    disabled={busy !== null || brief.totals.eventCount === 0 || (submitted && !needsResubmit && !brief.gate.ok)}
                    className="flex-shrink-0 px-4 md:px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                  >
                    {busy ? '처리 중...' : needsResubmit ? '변경분 다시 결재 올리기' : submitted ? '승인' : '결재 올리기'}
                  </button>
                )}
              </div>
            </div>

            {/* 문자 문안은 결재 대상이 아니다 — 그 사실을 화면이 말한다 */}
            {hasSmsLike && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-[11px] text-white/50 flex items-start gap-2">
                <Clock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-white/40" />
                문자 문안은 통신사 필터 때문에 <b className="text-white/70">발송 당일</b>에 만듭니다. 이번 결재 대상은 계획(채널·시점·형식)입니다.
              </div>
            )}

            {/* ── 행사별 상세 ─────────────────────────────────────── */}
            {brief.events.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 py-14 text-center">
                <CalendarDays className="w-6 h-6 text-violet-300/50 mx-auto mb-2" />
                <p className="text-sm text-white/60">이번 달 계획에 담긴 행사가 없습니다</p>
                <button onClick={() => navigate('/marketing-planner')} className="mt-3 text-xs text-violet-200 border border-violet-400/30 hover:bg-violet-500/20 px-3 py-1.5 rounded-lg transition-colors">
                  캘린더에서 행사 담기
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {brief.events.map((ev) => (
                  <div key={ev.id} className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                    <div className="px-4 md:px-5 py-3 border-b border-white/5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-semibold">{ev.title}</span>
                      {approved && ev.status !== 'approved' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200">결재 미포함</span>
                      )}
                      <span className="text-xs text-white/40 tabular-nums">{ev.startsOn} ~ {ev.endsOn}</span>
                      {ev.estCredits > 0 && (
                        <span className="ml-auto text-[11px] text-violet-200/80 tabular-nums">제작 예상 {ev.estCredits.toLocaleString()}크레딧</span>
                      )}
                    </div>

                    {(ev.benefitText || (ev.products || []).length > 0) && (
                      <div className="px-4 md:px-5 py-2.5 border-b border-white/5 space-y-1.5">
                        {ev.benefitText && (
                          <p className="text-xs text-white/70">
                            <span className="text-white/40">혜택 </span>{ev.benefitText}
                          </p>
                        )}
                        {(ev.products || []).length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {ev.products.map((p, i) => (
                              <span key={i} className="text-[10px] px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 text-white/60">{p.name}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="divide-y divide-white/5">
                      {ev.touchpoints.map((t) => (
                        <div key={t.id} className="px-4 md:px-5 py-3 flex flex-wrap items-start gap-x-4 gap-y-1.5">
                          <div className="min-w-[9rem]">
                            <div className="text-sm">{t.label}</div>
                            <div className="text-[11px] text-white/40">{timingLabel(t.timing)} · {t.scheduledOn}</div>
                          </div>
                          <div className="flex-1 min-w-[12rem]">
                            <div className="text-xs text-white/70 flex items-center gap-1.5">
                              <Users className="w-3.5 h-3.5 text-white/35" />
                              {t.audience.state === 'known' && t.audience.count != null
                                ? <span className="tabular-nums">{t.audience.count.toLocaleString()}명</span>
                                : t.audience.state === 'error'
                                  ? <span className="text-amber-200">확인 실패</span>
                                  : <span className="text-white/45">사전 인원 없음</span>}
                            </div>
                            <div className={`text-[11px] mt-0.5 ${t.audience.state === 'error' ? 'text-amber-200/70' : 'text-white/35'}`}>{t.audience.note}</div>
                          </div>
                          <div className="text-[11px] tabular-nums text-white/50 ml-auto">
                            {t.estCredits != null ? `제작 ${t.estCredits.toLocaleString()}크레딧` : '실행 시 과금'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[10px] text-white/30 italic">
              Data source — 행사·채널은 플래너 계획 원장, 대상 수는 발송 게이트를 적용한 고객 데이터 실조회,
              크레딧은 소재 제작 단가와 월간 대행 요금 기준입니다. 문자·알림톡은 실행 시 별도 과금됩니다.
            </p>
          </>
        )}
      </div>

      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
