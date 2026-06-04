/**
 * JourneyOptionsEditor — 여정별 운영 옵션 편집 (Phase 9)
 *   트리거 타이밍·포인트 소멸 설정 + 한도·예산·재진입을 한 패널에서 편집.
 *   PATCH /api/ai/operator/journeys/:id/options (draft/paused만). useToast(네이티브 다이얼로그 0).
 *   고객 복합 조건은 읽기 전용(편집은 범위 밖).
 */
import { useState } from 'react';
import { Settings, Save, Loader2 } from 'lucide-react';
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
  const isPoints = journey.trigger_event === 'customer.points_expiring';
  const timing = TRIGGER_TIMING[journey.trigger_event];
  const conditions: any[] = Array.isArray(tf.customer_conditions) ? tf.customer_conditions : [];

  const [form, setForm] = useState<Record<string, any>>({
    recent_hours: tf.recent_hours, dormant_days: tf.dormant_days, days_before: tf.days_before, abandon_hours: tf.abandon_hours,
    points_min: tf.points_min, expiry_mode: tf.expiry_mode || 'inactivity', inactive_days: tf.inactive_days, expiry_month_day: tf.expiry_month_day || '',
    thresholdRecipients: journey.threshold_recipients_per_step, thresholdCost: journey.threshold_cost_per_step,
    thresholdRiskLevel: journey.threshold_risk_level || 'low', budgetMonthly: journey.budget_monthly,
    reentryCooldownDays: journey.reentry_cooldown_days,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));
  const numOrNull = (v: any) => (v === '' || v == null ? null : Number(v));

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

      const res = await fetch(`/api/ai/operator/journeys/${journey.id}/options`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { toast.error(data.error || '옵션 저장에 실패했습니다.'); return; }
      toast.success('여정 옵션을 저장했습니다.');
      onSaved();
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
      {!editable && (
        <div className="text-[11px] text-amber-200/80">운영 중에는 옵션을 바꿀 수 없습니다. 일시정지한 뒤 편집해 주세요.</div>
      )}

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
      </div>

      {conditions.length > 0 && (
        <div className="pt-2 border-t border-white/10 space-y-1">
          <div className="text-[10px] text-white/40 font-semibold">고객 복합 조건 ({tf.logic || 'AND'}) — 읽기 전용</div>
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
          옵션 저장
        </button>
      )}
      <div className="text-[10px] text-white/30 italic">Data source — journeys.trigger_filters + 옵션 컬럼. 고객 복합 조건 편집은 별도.</div>
    </div>
  );
}
