/**
 * JourneyOptionsEditor — 여정별 운영 옵션 편집 (Phase 9 · 2026-07-10 2단 재편)
 *   상단 = 자주 쓰는 토글(목표 달성 시 자동 종료 — 운영 중에도 변경 가능) / 하단 = 고급 설정 접기(타이밍·한도·예산·재진입).
 *   PATCH /api/ai/operator/journeys/:id/options — 고급은 draft/paused만, 목표 토글은 active 포함. useToast(네이티브 다이얼로그 0).
 *   고객 복합 조건은 읽기 전용(편집은 범위 밖).
 */
import { useEffect, useState } from 'react';
import { Settings, Save, Loader2, Target, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '../ToastProvider';

interface Props {
  journey: any;
  token: string;
  onSaved: () => void;
}

// 트리거별 기본 타이밍 파라미터 (key는 trigger_filters jsonb 키)
const TRIGGER_TIMING: Record<string, { key: string; label: string; unit: string; def: number }> = {
  'customer.created': { key: 'recent_hours', label: '가입 후 진입 창', unit: '시간', def: 24 },
  'customer.dormant': { key: 'dormant_days', label: '휴면 기준', unit: '일', def: 30 },
  'customer.birthday_approaching': { key: 'days_before', label: '생일 며칠 전', unit: '일', def: 7 },
  'cdp.cart_abandon': { key: 'abandon_hours', label: '장바구니 방치', unit: '시간', def: 24 },
};

export default function JourneyOptionsEditor({ journey, token, onSaved }: Props) {
  const toast = useToast();
  const tf = journey.trigger_filters || {};
  const editable = journey.status === 'draft' || journey.status === 'paused';
  // ★ 목표 달성 자동 종료 토글만 운영(active) 중에도 변경 가능 — 발송을 줄이는 안전 방향(backend 동일 게이트)
  const goalEditable = editable || journey.status === 'active';
  const isPoints = journey.trigger_event === 'customer.points_expiring';
  const timing = TRIGGER_TIMING[journey.trigger_event];
  const conditions: any[] = Array.isArray(tf.customer_conditions) ? tf.customer_conditions : [];

  const [goalExit, setGoalExit] = useState<boolean>(journey.goal_exit_enabled === true);
  const [goalSaving, setGoalSaving] = useState(false);
  // ★ 2026-07-11 목표 종류 — purchase(구매)/click(발송 링크 클릭)/visit(자사몰 방문). 컬럼 미마이그레이션이면 undefined → purchase.
  const [goalKind, setGoalKind] = useState<string>(journey.goal_kind || 'purchase');
  // 부모 상세 캐시 갱신 시 서버 값으로 재동기화 — 접었다 펼칠 때 stale 표시 차단(Codex P2 정정)
  useEffect(() => { setGoalExit(journey.goal_exit_enabled === true); }, [journey.id, journey.goal_exit_enabled]);
  useEffect(() => { setGoalKind(journey.goal_kind || 'purchase'); }, [journey.id, journey.goal_kind]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({
    recent_hours: tf.recent_hours, dormant_days: tf.dormant_days, days_before: tf.days_before, abandon_hours: tf.abandon_hours,
    points_min: tf.points_min, expiry_mode: tf.expiry_mode || 'inactivity', inactive_days: tf.inactive_days, expiry_month_day: tf.expiry_month_day || '',
    thresholdRecipients: journey.threshold_recipients_per_step, thresholdCost: journey.threshold_cost_per_step,
    thresholdRiskLevel: journey.threshold_risk_level || 'low', budgetMonthly: journey.budget_monthly,
    reentryCooldownDays: journey.reentry_cooldown_days,
    // ★ 2026-07-11 홀드아웃·send-time 개인화 (신규 컬럼 — 미마이그레이션이면 undefined → 0/false 표시)
    holdoutPct: journey.holdout_pct ?? 0,
    personalSendTime: journey.personal_send_time === true,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));
  const numOrNull = (v: any) => (v === '' || v == null ? null : Number(v));

  const patchOptions = async (body: Record<string, any>): Promise<boolean> => {
    const res = await fetch(`/api/ai/operator/journeys/${journey.id}/options`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.success) { toast.error(data.error || '옵션 저장에 실패했습니다.'); return false; }
    return true;
  };

  // 목표 토글 = 즉시 저장(별도 저장 버튼 없음 — 1클릭)
  const toggleGoalExit = async () => {
    if (!goalEditable || goalSaving) return;
    const next = !goalExit;
    setGoalSaving(true);
    try {
      const ok = await patchOptions({ goalExitEnabled: next });
      if (ok) {
        setGoalExit(next);
        toast.success(next
          ? '목표 달성 시 자동 종료를 켰습니다. 진입 후 목표 달성이 확인된 고객은 남은 메시지를 받지 않습니다.'
          : '목표 달성 시 자동 종료를 껐습니다.');
        onSaved();
      }
    } catch (e: any) {
      toast.error(e?.message || '옵션 저장 중 오류가 났습니다.');
    } finally { setGoalSaving(false); }
  };

  // ★ 2026-07-11 목표 종류 선택 = 즉시 저장(토글과 동일 1클릭 패턴 — 운영 중에도 변경 가능)
  const GOAL_KIND_META: Record<string, { label: string; desc: string }> = {
    purchase: { label: '구매', desc: '진입 후 구매(연동몰 실시간 · ERP는 반영분)가 확인되면 종료' },
    click: { label: '링크 클릭', desc: '이 여정이 보낸 메시지의 링크를 클릭하면 종료' },
    visit: { label: '몰 방문', desc: '자사몰 재방문(사이트 스크립트 설치 몰)이 확인되면 종료' },
  };
  const selectGoalKind = async (kind: string) => {
    if (!goalEditable || goalSaving || kind === goalKind) return;
    setGoalSaving(true);
    try {
      const ok = await patchOptions({ goalKind: kind });
      if (ok) {
        setGoalKind(kind);
        toast.success(`목표 종류를 "${GOAL_KIND_META[kind]?.label || kind}"(으)로 바꿨습니다.`);
        onSaved();
      }
    } catch (e: any) {
      toast.error(e?.message || '옵션 저장 중 오류가 났습니다.');
    } finally { setGoalSaving(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, any> = {};
      if (timing) body[timing.key] = Number(form[timing.key] ?? timing.def);
      if (isPoints) {
        body.points_min = Number(form.points_min ?? 0);
        body.expiry_mode = form.expiry_mode;
        body.days_before = Number(form.days_before ?? 14);
        if (form.expiry_mode === 'annual_date') body.expiry_month_day = form.expiry_month_day;
        else body.inactive_days = Number(form.inactive_days ?? 180);
      }
      body.thresholdRecipients = numOrNull(form.thresholdRecipients);
      body.thresholdCost = numOrNull(form.thresholdCost);
      body.thresholdRiskLevel = form.thresholdRiskLevel;
      body.budgetMonthly = numOrNull(form.budgetMonthly);
      body.reentryCooldownDays = Number(form.reentryCooldownDays ?? 0);
      body.holdoutPct = Number(form.holdoutPct ?? 0);
      body.personalSendTime = form.personalSendTime === true;

      const ok = await patchOptions(body);
      if (ok) { toast.success('여정 옵션을 저장했습니다.'); onSaved(); }
    } catch (e: any) {
      toast.error(e?.message || '옵션 저장 중 오류가 났습니다.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-2 py-1.5 bg-slate-900 border border-white/10 rounded text-xs disabled:opacity-50';
  const mmddOk = /^\d{2}-\d{2}$/.test(form.expiry_month_day || '');

  return (
    <div className="p-3 bg-violet-500/5 border border-violet-400/20 rounded-lg space-y-3">
      <div className="flex items-center gap-2">
        <Settings className="w-4 h-4 text-violet-300" />
        <span className="text-sm font-semibold text-violet-100">여정 옵션</span>
        <span className="ml-auto text-[10px] text-white/40 font-mono">{journey.trigger_event || 'custom'}</span>
      </div>

      {/* ★ 자주 쓰는 토글 — 목표 달성 시 자동 종료 (2026-07-10, 시세이도 시연 기원) */}
      <div className="p-2.5 bg-slate-950/50 border border-emerald-400/20 rounded-lg">
        <div className="flex items-start gap-2.5">
          <Target className="w-4 h-4 text-emerald-300 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-white">목표 달성 시 자동 종료</div>
            <div className="text-[10px] text-white/45 leading-relaxed mt-0.5">
              여정 진입 후 목표 달성이 확인된 고객은 남은 메시지를 받지 않고 "목표 달성"으로 종료됩니다.
              운영 중에도 바꿀 수 있습니다.
            </div>
          </div>
          <button onClick={toggleGoalExit} disabled={!goalEditable || goalSaving} aria-label="목표 달성 시 자동 종료"
            className={`relative w-10 h-[22px] rounded-full transition-colors shrink-0 disabled:opacity-40 ${goalExit ? 'bg-emerald-500/70' : 'bg-white/15'}`}>
            {goalSaving
              ? <Loader2 className="w-3 h-3 animate-spin text-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              : <span className={`absolute top-0.5 w-[18px] h-[18px] bg-white rounded-full transition-all ${goalExit ? 'left-[20px]' : 'left-0.5'}`} />}
          </button>
        </div>
        {/* ★ 2026-07-11 목표 종류 — 토글 on일 때만 노출, 선택 즉시 저장 */}
        {goalExit && (
          <div className="mt-2 pl-6">
            <div className="flex gap-1.5">
              {Object.entries(GOAL_KIND_META).map(([kind, meta]) => (
                <button key={kind} onClick={() => selectGoalKind(kind)} disabled={!goalEditable || goalSaving}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-40 ${
                    goalKind === kind
                      ? 'bg-emerald-500/25 border-emerald-400/50 text-emerald-100'
                      : 'bg-white/5 border-white/10 text-white/50 hover:text-white/80 hover:border-white/25'
                  }`}>
                  {meta.label}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-white/40 mt-1.5">{GOAL_KIND_META[goalKind]?.desc || ''}</div>
          </div>
        )}
      </div>

      {/* 고급 설정 — 접기 */}
      <button onClick={() => setShowAdvanced((v) => !v)}
        className="w-full flex items-center gap-1.5 text-[11px] text-white/50 hover:text-white/80 transition-colors">
        {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        고급 설정 (진입 타이밍 · 한도 · 예산 · 재진입)
        {!editable && <span className="ml-auto text-[10px] text-amber-200/70">일시정지 후 편집 가능</span>}
      </button>

      {showAdvanced && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {timing && (
              <div>
                <label className="block text-[10px] text-white/50 mb-1">{timing.label} ({timing.unit})</label>
                <input type="number" disabled={!editable} className={inputCls} value={form[timing.key] ?? ''} placeholder={String(timing.def)} onChange={(e) => set(timing.key, e.target.value)} />
              </div>
            )}
            {isPoints && (
              <>
                <div>
                  <label className="block text-[10px] text-white/50 mb-1">최소 보유 포인트</label>
                  <input type="number" disabled={!editable} className={inputCls} value={form.points_min ?? ''} placeholder="0" onChange={(e) => set('points_min', e.target.value)} />
                </div>
                <div>
                  <label className="block text-[10px] text-white/50 mb-1">소멸 기준</label>
                  <select disabled={!editable} className={inputCls} value={form.expiry_mode} onChange={(e) => set('expiry_mode', e.target.value)}>
                    <option value="inactivity">미사용 기간</option>
                    <option value="annual_date">연 소멸일</option>
                  </select>
                </div>
                {form.expiry_mode === 'annual_date' ? (
                  <div>
                    <label className="block text-[10px] text-white/50 mb-1">연 소멸일 (MM-DD)</label>
                    <input type="text" disabled={!editable} className={inputCls} value={form.expiry_month_day} placeholder="12-31" onChange={(e) => set('expiry_month_day', e.target.value)} />
                    {!mmddOk && <div className="text-[10px] text-amber-200/80 mt-0.5">소멸일을 MM-DD로 설정하지 않으면 발송이 0건입니다.</div>}
                  </div>
                ) : (
                  <div>
                    <label className="block text-[10px] text-white/50 mb-1">미사용 일수</label>
                    <input type="number" disabled={!editable} className={inputCls} value={form.inactive_days ?? ''} placeholder="180" onChange={(e) => set('inactive_days', e.target.value)} />
                  </div>
                )}
                <div>
                  <label className="block text-[10px] text-white/50 mb-1">소멸 며칠 전</label>
                  <input type="number" disabled={!editable} className={inputCls} value={form.days_before ?? ''} placeholder="14" onChange={(e) => set('days_before', e.target.value)} />
                </div>
              </>
            )}
            <div>
              <label className="block text-[10px] text-white/50 mb-1">1회 진입 상한 (명, 비우면 무제한)</label>
              <input type="number" disabled={!editable} className={inputCls} value={form.thresholdRecipients ?? ''} onChange={(e) => set('thresholdRecipients', e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] text-white/50 mb-1">단계당 비용 한도 (원, 비우면 무제한)</label>
              <input type="number" disabled={!editable} className={inputCls} value={form.thresholdCost ?? ''} onChange={(e) => set('thresholdCost', e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] text-white/50 mb-1">월 예산 (원, 비우면 무제한)</label>
              <input type="number" disabled={!editable} className={inputCls} value={form.budgetMonthly ?? ''} onChange={(e) => set('budgetMonthly', e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] text-white/50 mb-1">재진입 대기 (일)</label>
              <input type="number" disabled={!editable} className={inputCls} value={form.reentryCooldownDays ?? ''} placeholder="0" onChange={(e) => set('reentryCooldownDays', e.target.value)} />
            </div>
            <div>
              <label className="block text-[10px] text-white/50 mb-1">위험도</label>
              <select disabled={!editable} className={inputCls} value={form.thresholdRiskLevel} onChange={(e) => set('thresholdRiskLevel', e.target.value)}>
                <option value="low">낮음</option>
                <option value="medium">보통</option>
                <option value="high">높음</option>
              </select>
            </div>
            {/* ★ 2026-07-11 홀드아웃 대조군 — 신규 진입의 N%를 미발송 대조군으로(증분 성과 비교). 0=사용 안 함 */}
            <div>
              <label className="block text-[10px] text-white/50 mb-1">홀드아웃 대조군 (%, 0~30 · 0=사용 안 함)</label>
              <input type="number" min={0} max={30} disabled={!editable} className={inputCls} value={form.holdoutPct ?? 0}
                onChange={(e) => set('holdoutPct', Math.max(0, Math.min(30, Number(e.target.value) || 0)))} />
              <div className="text-[9px] text-white/35 mt-0.5">진입 고객 일부를 발송하지 않고 남겨 "보냈을 때 vs 안 보냈을 때" 전환을 비교합니다.</div>
            </div>
            {/* ★ 2026-07-11 send-time 개인화 — 시각 지정 단계의 발송 시각을 고객 반응 시간대로 */}
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" disabled={!editable} checked={form.personalSendTime === true}
                  onChange={(e) => set('personalSendTime', e.target.checked)} className="w-3.5 h-3.5 rounded accent-violet-500" />
                <span className="text-[10px] text-white/60 leading-snug">발송 시각 개인화: 시각 지정 단계를 고객이 반응한 시간대(최근 90일)로 보정</span>
              </label>
            </div>
          </div>

          {conditions.length > 0 && (
            <div className="pt-2 border-t border-white/10 space-y-1">
              <div className="text-[10px] text-white/40 font-semibold">고객 복합 조건 ({tf.logic || 'AND'}) · 읽기 전용</div>
              <div className="flex flex-wrap gap-1">
                {conditions.map((c: any, i: number) => (
                  <span key={i} className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[10px] text-white/70 font-mono">
                    {c.field} {c.op} {Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {editable && (
            <button onClick={save} disabled={saving} className="px-3 py-1.5 bg-violet-500/30 hover:bg-violet-500/50 disabled:opacity-50 text-violet-100 rounded text-xs flex items-center gap-1.5">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              고급 설정 저장
            </button>
          )}
        </>
      )}
      <div className="text-[10px] text-white/30 italic">Data source: journeys.trigger_filters + 옵션 컬럼. 고객 복합 조건 편집은 별도.</div>
    </div>
  );
}
