import { OUI_BACK, OUI_HEADER, OUI_ICON_TILE, OUI_PAGE, OUI_SUBTITLE, OUI_TITLE } from '../utils/operator-ui';
import OperatorAura from '../components/operator/OperatorAura';
// 마케팅 캘린더 — 1년 시즌 캠페인 AI 설계 → 선택 등록 (2026-07-02 4차, Harold 확정)
// 흐름(1클릭 원칙): [AI로 1년 설계] → 12개월 카드 → 원하는 달 선택 → [등록] → 크레딧 확인 → 자동마케팅 일괄 등록.
// ★ 2026-07-05 재점검: 등록 = 연 1회(yearly + 대상 월) — 옛 monthly는 시즌 캠페인이 매월 반복 발송되는 구조 결함.
//   설계는 서버 저장(새로고침에도 유지) + 등록된 달은 배지 표시·재등록 차단(200크레딧 중복 차감 방지).
// 다크 slate + 단일 액센트, native dialog 0(useToast + CreditConfirmModal), 생성 중 로딩 오버레이 + 닫기 차단(D185).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import { ArrowLeft, CalendarDays, CalendarRange, Sparkles, Loader2, Check, CheckCircle2, RefreshCcw } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import CreditConfirmModal from '../components/credit/CreditConfirmModal';
import EventCampaignModal from '../components/EventCampaignModal';
import EventCampaignResumeBar from '../components/EventCampaignResumeBar';

interface CalendarEntry {
  month: number;
  title: string;
  objective: string;
  suggestedDay: number;
  // ★ 2026-07-07 완비: 발송 대상 축 — backend TARGET_HINTS(autosend-policy) 화이트리스트와 동일 키.
  //   카드에서 사용자가 변경 → 등록 시 operator에 고정 → 발송 당일 타겟 AI가 이 축을 준수.
  targetHint: string;
}

const MONTH_LABEL = ['', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

// backend autosend-policy TARGET_HINTS와 동일 키·라벨 (화이트리스트 밖 값은 서버가 all로 정규화)
const TARGET_HINT_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'all', label: '전체 고객' },
  { key: 'dormant', label: '휴면 고객' },
  { key: 'recent_buyers', label: '최근 구매 고객' },
  { key: 'vip', label: 'VIP·상위 등급' },
  { key: 'birthday', label: '이달 생일 고객' },
  { key: 'new_customers', label: '신규 등록 고객' },
];
const normalizeHint = (h: unknown): string => (TARGET_HINT_OPTIONS.some((o) => o.key === h) ? (h as string) : 'all');

export default function MarketingCalendarPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // ★ 2026-07-05: 등록 상태 — { "월": operator_id }. 등록된 달 = 배지 + 재등록 차단
  const [registrations, setRegistrations] = useState<Record<string, string>>({});
  // ★ 2026-07-07 완비: 달별 혜택(선택 입력) — 등록 payload benefit_content로 동봉, 비우면 D-2 문자 + 발송 출구 가드가 담당
  const [benefits, setBenefits] = useState<Record<number, string>>({});
  // ★ 2026-07-07 완비: 발송 안내 받을 담당자 연락처(선택) — 비우면 등록 계정 연락처가 기본값(서버 처리)
  const [adminPhone, setAdminPhone] = useState('');
  const [generating, setGenerating] = useState(false);
  // ★ 2026-07-05 P3: 한 달만 다시 설계(10크레딧) — 진행 중인 달 표시
  const [regenMonth, setRegenMonth] = useState<number | null>(null);
  const [registering, setRegistering] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // ★ Harold 명시: 설계 생성·재생성 = 매회 크레딧 차감 → 생성 전 확인 모달
  const [genConfirmOpen, setGenConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ★ 2026-07-07(4) 행사 캠페인 — 등록된 행사로 DM·이메일·인앱 초안 생성 (행사 텍스트 재입력 0)
  const [eventCampaignText, setEventCampaignText] = useState<string | null>(null);
  // ★ 2026-07-08 소멸 방지 — 임시 보관 세트 재개 + 목록 새로고침 신호
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [resumeRefresh, setResumeRefresh] = useState(0);

  const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  // ★ 2026-07-05: 저장된 설계 로드 — 새로고침·재진입에도 50크레딧 재생성 없이 이어보기 + 등록 배지
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/ai/operator/marketing-calendar', { headers: auth() });
        const data = await res.json();
        if (data?.success && data.calendar) {
          // ★ 2026-07-07: targetHint 정규화 — 완비 이전 저장본(축 없음)은 all로 표시
          const saved: CalendarEntry[] = (Array.isArray(data.calendar.entries) ? data.calendar.entries : [])
            .map((e: any) => ({ ...e, targetHint: normalizeHint(e?.targetHint) }));
          const regs: Record<string, string> = data.calendar.registrations || {};
          if (saved.length > 0) {
            setEntries(saved);
            setSelected(new Set(saved.map((e) => e.month).filter((m) => !regs[String(m)])));
          }
          setRegistrations(regs);
        }
      } catch { /* 저장본 없음/조회 실패 — 새 설계 흐름 그대로 */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const fresh: CalendarEntry[] = (data.entries || []).map((e: any) => ({ ...e, targetHint: normalizeHint(e?.targetHint) }));
      setEntries(fresh);
      // 등록된 달은 기본 선택에서 제외 — 재등록(중복 차감) 방지
      setSelected(new Set(fresh.map((e) => e.month).filter((m) => !registrations[String(m)])));
      toast.success('1년 캘린더 설계가 준비됐습니다. 원하는 달을 골라 등록하세요.');
    } catch (e: any) {
      setError(e?.message || '네트워크 오류');
      toast.error(e?.message || '네트워크 오류가 발생했습니다.');
    } finally {
      setGenerating(false);
    }
  };

  const toggle = (month: number) => {
    if (registrations[String(month)]) return; // 등록된 달은 선택 불가(재등록 = 중복 차감)
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month); else next.add(month);
      return next;
    });
  };

  const setDay = (month: number, day: number) => {
    setEntries((prev) => prev.map((e) => (e.month === month ? { ...e, suggestedDay: day } : e)));
  };

  // ★ 2026-07-07 완비: 발송 대상 축 변경 — 발송일과 같은 자유도(등록 전 언제든)
  const setHint = (month: number, hint: string) => {
    setEntries((prev) => prev.map((e) => (e.month === month ? { ...e, targetHint: normalizeHint(hint) } : e)));
  };

  // ★ 2026-07-05 P3: 한 달만 다시 설계 — 10크레딧(20 미만 = 사전 모달 비대상, 버튼에 비용 명시 + 차감 후 토스트)
  const regenerateMonth = async (month: number) => {
    if (regenMonth !== null || generating || registering) return;
    setRegenMonth(month);
    try {
      const res = await fetch('/api/ai/operator/marketing-calendar/regenerate-month', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ month }),
      });
      const data = await res.json();
      if (data?.success && data.entry) {
        setEntries((prev) => prev.map((e) => (e.month === month ? { ...data.entry, targetHint: normalizeHint(data.entry?.targetHint) } : e)));
        toast.success(`${MONTH_LABEL[month]} 캠페인을 다시 설계했습니다. (10 크레딧)`);
      } else {
        toast.error(data?.error || '한 달 재설계에 실패했습니다.');
      }
    } catch (e: any) {
      toast.error(e?.message || '네트워크 오류가 발생했습니다.');
    } finally {
      setRegenMonth(null);
    }
  };

  const registerSelected = async () => {
    const picks = entries.filter((e) => selected.has(e.month) && !registrations[String(e.month)]);
    if (picks.length === 0) return;
    setRegistering(true);
    let ok = 0;
    let fail = 0;
    let firstError: string | null = null;
    // ★ 2026-07-07 완비: 담당자 연락처(선택) — 숫자만 추려 유효한 휴대폰이면 동봉, 아니면 서버가 등록 계정 연락처로 기본값
    const adminDigits = adminPhone.replace(/\D/g, '');
    const adminPhones = /^01\d{8,9}$/.test(adminDigits) ? [adminDigits] : undefined;
    for (const e of picks) {
      try {
        const benefit = (benefits[e.month] || '').trim();
        const res = await fetch('/api/ai/operator/continuous', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth() },
          body: JSON.stringify({
            name: `${MONTH_LABEL[e.month]} ${e.title}`.slice(0, 100),
            objective: e.objective,
            // ★ 2026-07-05: 시즌 캠페인 = 연 1회(yearly + 대상 월). 이전 monthly는 매월 반복 오발송 구조라 폐기.
            schedule: 'yearly',
            schedule_month: e.month,
            schedule_time: '10:00',
            schedule_day_of_month: e.suggestedDay,
            channel: 'lms',
            send_time_mode: 'fixed',
            delivery_policy: 'monthly',
            calendar_month: e.month, // 서버 등록 기록 + 같은 달 중복 등록 409 차단
            // ★ 2026-07-07 완비: 대상 축 고정 + 혜택(선택) + 담당자(선택 — 미입력 = 등록 계정 연락처)
            target_hint: e.targetHint,
            ...(benefit ? { benefit_content: benefit } : {}),
            ...(adminPhones ? { admin_phone_numbers: adminPhones } : {}),
          }),
        });
        const data = await res.json();
        if (data.success) {
          ok++;
          if (data.operator?.id) setRegistrations((prev) => ({ ...prev, [String(e.month)]: String(data.operator.id) }));
          setSelected((prev) => { const next = new Set(prev); next.delete(e.month); return next; });
        } else {
          fail++;
          if (!firstError) firstError = data.error || null;
        }
      } catch { fail++; }
    }
    setRegistering(false);
    if (ok > 0) toast.success(`${ok}건을 연 1회 캠페인으로 등록했습니다.${fail > 0 ? ` (${fail}건 실패)` : ''} 자동 마케팅 화면에서 관리할 수 있습니다.`);
    else toast.error(firstError || '등록에 실패했습니다. 크레딧과 권한을 확인해주세요.');
  };

  const pickedCount = entries.filter((e) => selected.has(e.month) && !registrations[String(e.month)]).length;

  return (
    <div className={OUI_PAGE}>
      <OperatorAura />
      <div className={OUI_HEADER}>
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3 flex-wrap">
          <button onClick={() => goBackOr(navigate, '/ai-operator')} className={OUI_BACK} aria-label="뒤로">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className={`${OUI_ICON_TILE} bg-gradient-to-br from-orange-400 to-rose-500`}>
            <CalendarDays className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className={OUI_TITLE}>마케팅 캘린더</h1>
            </div>
            <p className={OUI_SUBTITLE}>업종·시즌·회사 데이터로 1년치 캠페인을 AI가 설계. 고른 달은 그대로 자동마케팅으로</p>
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
              마음에 드는 달만 골라 등록하면 그 달 정해진 날 2시간 전에 문안·대상·비용이 담당자에게 안내되고,<br />
              자동 발송 설정 회사는 정각에 자동 발송, 그 외에는 승인 후 발송됩니다.
            </p>
            <button
              onClick={() => setGenConfirmOpen(true)}
              disabled={generating}
              className="mt-5 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-orange-500/80 to-rose-500/80 hover:opacity-90 disabled:opacity-40 text-sm font-semibold transition-opacity"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              AI로 1년 설계하기
            </button>
            {error && <div className="mt-4 text-xs text-rose-300">{error}</div>}
            <div className="mt-4 text-[10px] text-white/30 italic">Data source: 회사 업종·브랜드·고객 규모 + 한국 시즌 달력</div>
          </div>
        )}

        {entries.length > 0 && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm text-white/70">원하는 달을 선택하세요 · 선택 {pickedCount}건</div>
              <button onClick={() => setGenConfirmOpen(true)} disabled={generating} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 transition-colors">
                다시 설계
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {entries.map((e) => {
                const registered = !!registrations[String(e.month)];
                const on = !registered && selected.has(e.month);
                return (
                  <div key={e.month} className={`rounded-2xl border p-4 transition-colors ${registered ? 'bg-emerald-500/5 border-emerald-400/30' : on ? 'bg-orange-500/10 border-orange-400/40' : 'bg-white/5 border-white/10'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold min-w-0 truncate">{MONTH_LABEL[e.month]} · {e.title}</div>
                      {registered ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-400/30 rounded-full px-2 py-0.5 flex-shrink-0">
                          <CheckCircle2 className="w-3 h-3" /> 등록됨
                        </span>
                      ) : (
                        <button
                          onClick={() => toggle(e.month)}
                          className={`w-6 h-6 rounded-md border flex items-center justify-center transition-colors flex-shrink-0 ${on ? 'bg-orange-500/60 border-orange-400/60' : 'bg-white/5 border-white/20'}`}
                          aria-label={`${MONTH_LABEL[e.month]} 선택`}
                        >
                          {on && <Check className="w-4 h-4 text-white" />}
                        </button>
                      )}
                    </div>
                    <p className="mt-2 text-[12px] text-white/60 leading-relaxed">{e.objective}</p>
                    <div className="mt-3 flex items-center gap-2 flex-wrap text-[11px] text-white/50">
                      <span>발송일</span>
                      <select
                        value={e.suggestedDay}
                        onChange={(ev) => setDay(e.month, Number(ev.target.value))}
                        disabled={registered}
                        className="px-2 py-1 bg-white/5 border border-white/10 rounded text-white text-[11px] focus:outline-none focus:border-orange-400/50 disabled:opacity-40"
                      >
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}일</option>)}
                      </select>
                      <span>· 오전 10:00 · LMS · 연 1회 · 발송 2시간 전 문안 안내</span>
                    </div>
                    {/* ★ 2026-07-07 완비: 발송 대상 축 — 등록 후 발송 당일 타겟 AI가 이 축을 준수 */}
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-white/50">
                      <span>대상</span>
                      <select
                        value={e.targetHint}
                        onChange={(ev) => setHint(e.month, ev.target.value)}
                        disabled={registered}
                        className="px-2 py-1 bg-white/5 border border-white/10 rounded text-white text-[11px] focus:outline-none focus:border-orange-400/50 disabled:opacity-40"
                      >
                        {TARGET_HINT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                      <span className="text-white/35">· 발송 전 실제 인원으로 산출</span>
                    </div>
                    {/* ★ 2026-07-07 완비: 혜택(선택) — 입력하면 문안의 혜택 자리에 그대로, 비우면 발송 2일 전 입력 안내 문자 */}
                    {!registered && (
                      <input
                        type="text"
                        value={benefits[e.month] || ''}
                        onChange={(ev) => setBenefits((prev) => ({ ...prev, [e.month]: ev.target.value }))}
                        maxLength={200}
                        placeholder="혜택 (선택) 예: 아메리카노 1잔 증정 (비우면 발송 2일 전 입력 안내)"
                        className="mt-2 w-full px-2.5 py-1.5 bg-white/5 border border-white/10 rounded text-white text-[11px] placeholder-white/25 focus:outline-none focus:border-orange-400/50"
                      />
                    )}
                    <div className="mt-2.5 flex items-center gap-3 flex-wrap">
                      {!registered && (
                        <button
                          type="button"
                          onClick={() => regenerateMonth(e.month)}
                          disabled={regenMonth !== null || generating || registering}
                          className="inline-flex items-center gap-1.5 text-[11px] text-white/45 hover:text-white/80 disabled:opacity-40 transition-colors"
                        >
                          <RefreshCcw className={`w-3 h-3 ${regenMonth === e.month ? 'animate-spin' : ''}`} />
                          {regenMonth === e.month ? '다시 설계하는 중...' : '이 달만 다시 설계 (10 크레딧)'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { setResumeDraftId(null); setEventCampaignText(`${MONTH_LABEL[e.month]} ${e.title}\n${e.objective}\n발송 예정일: ${e.month}월 ${e.suggestedDay}일`); }}
                        disabled={generating || registering}
                        className="inline-flex items-center gap-1.5 text-[11px] text-amber-200/80 hover:text-amber-100 disabled:opacity-40 transition-colors"
                      >
                        <CalendarRange className="w-3 h-3" /> 이 행사로 채널 초안 만들기
                      </button>
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
            <div className="text-center text-[11px] text-white/40">설계 생성·다시 설계는 매회, 등록은 건당 크레딧이 차감됩니다. 혜택을 비워두면 발송 2일 전 입력 안내 문자가 가고, 미입력 상태로는 자동 발송되지 않습니다.</div>
          </>
        )}

        {generating && (
          <div className="fixed inset-0 z-40 bg-slate-950/85 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-7 h-7 text-orange-300 animate-spin" />
            <div className="text-sm text-white/80">AI가 1년치 캘린더를 설계하고 있습니다</div>
            <div className="text-xs text-white/40">창을 닫지 마세요</div>
          </div>
        )}

        {/* ★ 2026-07-08 임시 보관 행사 캠페인 재개 (소멸 방지) */}
        <EventCampaignResumeBar refreshKey={resumeRefresh} onResume={(id) => { setResumeDraftId(id); setEventCampaignText(''); }} />

        {/* ★ 2026-07-07(4) 행사 캠페인 — 캘린더 행사 → 채널별 초안 */}
        <EventCampaignModal
          open={eventCampaignText !== null}
          initialText={eventCampaignText || ''}
          resumeDraftId={resumeDraftId || undefined}
          onClose={() => { setEventCampaignText(null); setResumeDraftId(null); setResumeRefresh((v) => v + 1); }}
        />
      </div>

      {/* ★ 2026-07-05: 표시=실차감 일치 — N건 선택 등록은 단가×N로 표시(quantity) */}
      {/* ★ 2026-07-07 완비: 발송 안내 담당자 연락처(선택) — 비우면 등록 계정 연락처로 자동. 통지 수신처 없는 등록 차단 */}
      <CreditConfirmModal
        open={confirmOpen}
        source="continuous-operator"
        quantity={pickedCount}
        extraContent={
          <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5">
            <label className="text-[11px] text-white/60 block mb-1">발송 안내 받을 담당자 연락처 (선택)</label>
            <input
              type="tel"
              value={adminPhone}
              onChange={(ev) => setAdminPhone(ev.target.value)}
              placeholder="비우면 등록 계정 연락처로 안내"
              className="w-full px-2.5 py-1.5 bg-white/5 border border-white/10 rounded text-white text-[12px] placeholder-white/25 focus:outline-none focus:border-orange-400/50"
            />
            <div className="mt-1.5 text-[10px] text-white/35 leading-relaxed">발송 2시간 전 문안·대상·비용 안내와 승인 요청 문자가 이 번호로 발송됩니다.</div>
          </div>
        }
        onConfirm={() => { setConfirmOpen(false); registerSelected(); }}
        onCancel={() => setConfirmOpen(false)}
      />
      {/* 설계 생성·재생성 — 매회 차감 확인 (Harold 명시) */}
      <CreditConfirmModal
        open={genConfirmOpen}
        source="marketing-calendar"
        onConfirm={() => { setGenConfirmOpen(false); generate(); }}
        onCancel={() => setGenConfirmOpen(false)}
      />
    </div>
  );
}
