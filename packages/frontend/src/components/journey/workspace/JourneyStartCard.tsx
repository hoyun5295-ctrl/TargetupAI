/**
 * JourneyStartCard — 작업 화면 「시작」 카드(★ 2026-10-20 여정 V.3 §7-1 · §8-1 · §11 · 옛 JourneyOptionsEditor 대체)
 *
 * 언제(시작 사건) + 누구에게(고객 조건 · 회사 실제 값에서 고름) + 한도 · 재진입 · 마지막 날 · 하루 몫 · 흐름 옵션을 문장 + 토글로.
 *   값은 작업 화면이 들고 있는 고친 값(form)이고, 저장은 바닥 확정 바가 한 번에 한다(옵션 주소 · 켜진 여정도 그 자리 · 새 모양은 서버 판정).
 * ⛔ 내부 코드(시작 사건 영문 · 칸 키)는 보이지 않는다. 시작 사건 이름 = 서버 지도 triggerLabel(없으면 사건 사전 이름).
 * ⛔ 고친 값 계산(optionsDiff)은 순수 함수 — 바뀐 키만 서버로(부분 저장 · 서버가 DB 안에서 병합).
 */
import { useState } from 'react';
import { CalendarClock, ChevronDown, ChevronUp, Loader2, Plus, Unlink, Users } from 'lucide-react';
import { ConditionRow, COND_FIELDS, condLabel, condValueText, useConditionValueOptions, type AudienceCondition } from '../JourneyBuilderUi';
import { TIMING, STANDING_TRIGGERS, numOrNull, type OptionForm } from '../../../utils/journey-start-form';

export type { OptionForm } from '../../../utils/journey-start-form';
export interface EntryCount { loading: boolean; matched: number | null; cap: number | null; approximate: boolean; message: string | null }

interface Props {
  journey: any;
  triggerLabel: string;
  form: OptionForm;
  setField: (k: string, v: any) => void;
  count: EntryCount;
  onCount: () => void;
  locked: boolean;
  isActive: boolean;
  /** 진행 중 인원(「진행 중 N명은 원래 조건으로 끝까지」 한 줄). */
  inProgress: number;
  /** ★ V.3 §18 — 다른 여정 뒤에 붙은 여정이면 넘기는 고객(지도 서버 값) · 떼기. */
  attachedAfter?: { journeyId: string | null; name: string; outcomeLabel: string } | null;
  onDetach?: () => void;
}

function Toggle({ on, onChange, label, desc, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; desc?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 rounded-xl px-1 py-1.5 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
        className={`relative mt-0.5 h-[22px] w-10 shrink-0 rounded-full transition-colors ${on ? 'bg-indigo-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${on ? 'left-[20px]' : 'left-0.5'}`} />
      </button>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-slate-800">{label}</span>
        {desc && <span className="mt-0.5 block text-[12px] leading-relaxed text-slate-500">{desc}</span>}
      </span>
    </label>
  );
}

function NumField({ value, onChange, unit, placeholder, disabled, label, min, max }: {
  value: any; onChange: (v: number | null) => void; unit: string; placeholder?: string; disabled?: boolean; label: string; min?: number; max?: number;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <input type="number" inputMode="numeric" aria-label={label} min={min} max={max} disabled={disabled} value={value ?? ''} placeholder={placeholder}
        onChange={(e) => onChange(numOrNull(e.target.value))}
        className="h-9 w-24 rounded-lg border border-slate-300 bg-white px-2 text-[13px] tabular-nums text-slate-900 disabled:bg-slate-100" />
      <span className="text-[13px] text-slate-600">{unit}</span>
    </span>
  );
}

const GOAL_KINDS: Array<{ key: string; label: string; only?: string }> = [
  { key: 'purchase', label: '구매' }, { key: 'click', label: '링크 클릭' }, { key: 'visit', label: '몰 방문' },
  { key: 'points_used', label: '포인트 사용', only: 'customer.points_expiring' }, { key: 'product', label: '같은 상품 재구매', only: 'purchase.product' },
];

export default function JourneyStartCard({ journey, triggerLabel, form, setField, count, onCount, locked, isActive, inProgress, attachedAfter, onDetach }: Props) {
  const valueOptions = useConditionValueOptions();
  const [more, setMore] = useState(false);
  const te = String(journey?.trigger_event || '');
  const timing = TIMING[te];
  const conds: AudienceCondition[] = (form.customer_conditions || []) as AudienceCondition[];
  const setConds = (next: AudienceCondition[]) => setField('customer_conditions', next);
  const isCustom = te === 'custom';
  const editableCond = (c: any) => !Array.isArray(c?.value) && !['in', 'not_in', 'is_null', 'not_null'].includes(String(c?.op)) && COND_FIELDS.some((f) => f.key === c?.field);

  const sec = 'border-t border-slate-100 pt-3 mt-3';
  return (
    <section aria-labelledby="jws-start-title" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
      <h3 id="jws-start-title" className="text-[13px] font-semibold text-slate-500">시작</h3>

      {/* 언제 */}
      <div className="mt-2">
        <div className="text-[12px] text-slate-500">언제</div>
        <div className="mt-0.5 text-[15px] font-semibold text-slate-900">{triggerLabel}</div>
        {te === 'journey.after' && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-slate-700">
            <span>{attachedAfter?.journeyId ? `넘겨받는 고객: ${attachedAfter.outcomeLabel}` : '앞 여정이 없어져 넘어오는 고객이 없어요.'}</span>
            {onDetach && !locked && (
              <button type="button" onClick={onDetach} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] font-semibold text-slate-700 hover:border-rose-200 hover:text-rose-700">
                <Unlink className="h-3.5 w-3.5" aria-hidden />앞 여정에서 떼기
              </button>
            )}
          </div>
        )}
        {timing && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] text-slate-700">
            <span>{timing.before}</span>
            <NumField label={timing.before} value={form[timing.key]} onChange={(v) => setField(timing.key, v ?? timing.def)} unit="" min={timing.min} max={timing.max} disabled={locked} />
            <span>{timing.after}</span>
            {timing.note && <span className="basis-full text-[12px] text-slate-500">{timing.note}</span>}
          </div>
        )}
        {te === 'customer.points_expiring' && (
          <div className="mt-2 space-y-2 text-[13px] text-slate-700">
            <div className="flex flex-wrap items-center gap-1.5">포인트가 <NumField label="최소 포인트" value={form.points_min} onChange={(v) => setField('points_min', v ?? 0)} unit="P 이상" disabled={locked} />인 고객</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <select aria-label="소멸 기준" disabled={locked} value={form.expiry_mode} onChange={(e) => setField('expiry_mode', e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-[13px]">
                <option value="inactivity">쓰지 않은 기간</option>
                <option value="annual_date">해마다 정한 날</option>
              </select>
              {form.expiry_mode === 'annual_date'
                ? <input aria-label="소멸일" disabled={locked} value={form.expiry_month_day || ''} placeholder="12-31" onChange={(e) => setField('expiry_month_day', e.target.value.slice(0, 5))} className="h-9 w-20 rounded-lg border border-slate-300 bg-white px-2 text-[13px]" />
                : <NumField label="쓰지 않은 일수" value={form.inactive_days} onChange={(v) => setField('inactive_days', v ?? 180)} unit="일" disabled={locked} />}
              <span>기준으로 소멸</span>
              <NumField label="소멸 며칠 전" value={form.days_before} onChange={(v) => setField('days_before', v ?? 14)} unit="일 전에 알려요" disabled={locked} />
            </div>
          </div>
        )}
      </div>

      {/* 누구에게 */}
      <div className={sec}>
        <div className="flex items-center gap-1.5 text-[12px] text-slate-500"><Users className="h-3.5 w-3.5" aria-hidden />누구에게</div>
        {conds.length === 0 ? (
          <p className="mt-1 text-[13px] text-slate-700">{isCustom ? (form.all_customers ? '전체 고객' : '아직 조건이 없어요') : te === 'journey.after' ? '앞 여정을 마친 모든 고객' : '이 사건이 생긴 모든 고객'}</p>
        ) : (
          <div className="mt-2 space-y-2">
            {conds.map((c, i) => (editableCond(c) ? (
              <ConditionRow key={i} c={{ field: c.field, op: c.op, value: String(c.value ?? '') }} valueOptions={valueOptions}
                onChange={(p) => setConds(conds.map((x, idx) => (idx === i ? { ...x, ...p } : x)))}
                onRemove={() => setConds(conds.filter((_, idx) => idx !== i))} />
            ) : (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[13px] text-slate-700">
                <span className="min-w-0 flex-1 truncate">{condLabel(c.field)} {Array.isArray(c.value) ? `${c.value.map((v: unknown) => condValueText(c.field, v)).join(', ')} 중 하나${c.op === 'not_in' ? '가 아님' : ''}` : c.op === 'is_null' ? '값 없음' : c.op === 'not_null' ? '값 있음' : condValueText(c.field, c.value)}</span>
                {!locked && <button type="button" onClick={() => setConds(conds.filter((_, idx) => idx !== i))} className="shrink-0 text-[12px] text-slate-500 hover:text-rose-700">빼기</button>}
              </div>
            )))}
            {conds.length >= 2 && (
              <div className="flex items-center gap-1.5 text-[12px] text-slate-600">
                <span>조건을</span>
                {(['AND', 'OR'] as const).map((l) => (
                  <button key={l} type="button" disabled={locked} onClick={() => setField('logic', l)} aria-pressed={form.logic === l}
                    className={`h-7 rounded-full px-2.5 font-medium ${form.logic === l ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    {l === 'AND' ? '모두 만족' : '하나라도 만족'}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {!locked && (
          <button type="button" onClick={() => setConds([...conds, { field: 'grade', op: '==', value: '' }])}
            className="mt-2 inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-indigo-700 hover:bg-indigo-50">
            <Plus className="h-3.5 w-3.5" aria-hidden />조건 더하기
          </button>
        )}
        {isCustom && conds.length === 0 && (
          <Toggle on={form.all_customers === true} onChange={(v) => setField('all_customers', v)} disabled={locked} label="전체 고객에게 보내기" desc="조건 없이 보내려면 이것을 켜야 해요." />
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
          {count.loading ? (
            <span className="inline-flex items-center gap-1.5 text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />세는 중</span>
          ) : count.message ? (
            <span className="text-slate-500">{count.message}</span>
          ) : count.matched != null ? (
            <span className={count.matched === 0 ? 'font-semibold text-rose-700' : count.cap != null && count.matched > count.cap ? 'font-semibold text-amber-800' : 'font-semibold text-slate-900'}>
              {count.matched === 0 ? '지금 맞는 고객이 없어요'
                : count.cap != null && count.matched > count.cap ? `한 번에 보낼 최대 ${count.cap.toLocaleString('ko-KR')}명보다 많아요`
                : `${count.approximate ? '최근 사건 기준 약 ' : '지금 맞는 '}${count.matched.toLocaleString('ko-KR')}명`}
            </span>
          ) : null}
          {!count.loading && <button type="button" onClick={onCount} className="text-[12px] text-indigo-700 hover:underline">{count.matched == null ? '지금 몇 명인지 보기' : '다시 세기'}</button>}
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">조건에 맞으면 한 번 들어와요. 다시 들어오게 하려면 재진입을 켜요.{isActive && inProgress > 0 ? ` 지금 진행 중인 ${inProgress.toLocaleString('ko-KR')}명은 원래 조건으로 끝까지 받아요.` : ''}</p>
      </div>

      {/* 받는 양 */}
      <div className={`${sec} space-y-2.5`}>
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-slate-700">
          한 번에 최대 <NumField label="한 번에 보낼 최대 인원" value={form.thresholdRecipients} onChange={(v) => setField('thresholdRecipients', v)} unit="명" placeholder="꼭 정해요" disabled={locked} min={1} />
        </div>
        {STANDING_TRIGGERS.includes(te) && (
          <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-slate-700">
            하루에 <NumField label="하루 몫" value={form.backfill_per_day} onChange={(v) => setField('backfill_per_day', v)} unit="명씩 나눠 받기" placeholder="안 나눔" disabled={locked} min={1} max={100000} />
          </div>
        )}
        {te === 'customer.dormant' && (
          <Toggle on={form.include_existing === true} onChange={(v) => setField('include_existing', v)} disabled={locked}
            label="이미 쉬고 있는 고객도 받기" desc="오래 쉰 고객까지 최근에 쉰 순서로 받아요. 하루 몫을 정하면 나눠서 받아요." />
        )}
        {'entryEndsOn' in form && (
          <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-slate-700">
            <CalendarClock className="h-4 w-4 text-slate-400" aria-hidden />새 고객은
            <input type="date" aria-label="새 고객 받는 마지막 날" disabled={locked} value={form.entryEndsOn || ''} onChange={(e) => setField('entryEndsOn', e.target.value)}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-[13px] text-slate-900" />
            <span>{form.entryEndsOn ? '까지 받아요' : '계속 받아요'}</span>
            {form.entryEndsOn && !locked && <button type="button" onClick={() => setField('entryEndsOn', '')} className="text-[12px] text-slate-500 hover:underline">비우기</button>}
          </div>
        )}
      </div>

      {/* 흐름 */}
      <div className={`${sec} space-y-1`}>
        <Toggle on={form.goalExitEnabled === true} onChange={(v) => setField('goalExitEnabled', v)} disabled={locked}
          label={`${GOAL_KINDS.find((g) => g.key === form.goalKind)?.label || '구매'}하면 남은 문자 안 보냄`}
          desc={isActive ? '켜기는 바로 돼요. 끄거나 목표를 바꾸면 새로 들어오는 고객부터 바뀐 모양으로 받아요.' : undefined} />
        {form.goalExitEnabled && (
          <div className="flex flex-wrap gap-1.5 pl-12">
            {GOAL_KINDS.filter((g) => !g.only || g.only === te).map((g) => (
              <button key={g.key} type="button" disabled={locked} onClick={() => setField('goalKind', g.key)} aria-pressed={form.goalKind === g.key}
                className={`h-7 rounded-full border px-2.5 text-[12px] font-medium ${form.goalKind === g.key ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                {g.label}
              </button>
            ))}
          </div>
        )}
        {'entry_replace' in form && (
          <Toggle on={form.entry_replace === true} onChange={(v) => setField('entry_replace', v)} disabled={locked} label="같은 고객이 다시 사면 처음부터" desc="진행 중인 흐름을 마치고 처음부터 다시 시작해요." />
        )}
        {'exclude_first_purchase' in form && (
          <Toggle on={form.exclude_first_purchase === true} onChange={(v) => setField('exclude_first_purchase', v)} disabled={locked} label="첫 구매 고객 빼기" desc="첫 구매 여정이 맡아요. 같은 구매에 문자 두 통이 가지 않아요." />
        )}
        {'exclude_dormant_return' in form && (
          <Toggle on={form.exclude_dormant_return === true} onChange={(v) => setField('exclude_dormant_return', v)} disabled={locked} label="돌아온 고객은 환영만" desc="휴면에서 돌아온 고객은 휴면 복귀 여정만 받아요." />
        )}
        <Toggle on={form.allowReentry === true} onChange={(v) => setField('allowReentry', v)} disabled={locked} label="다시 들어오게 하기" desc="여정을 마친 고객이 다시 조건에 맞으면 또 받아요." />
        {form.allowReentry && (
          <div className="space-y-1 pl-12">
            <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-slate-700">
              마친 뒤 <NumField label="재진입 대기" value={form.reentryCooldownDays} onChange={(v) => setField('reentryCooldownDays', v ?? 0)} unit="일 지나면" disabled={locked} min={0} max={365} />
            </div>
            <Toggle on={form.autoReentryEnabled === true} onChange={(v) => setField('autoReentryEnabled', v)} disabled={locked}
              label="자동으로 다시 받기" desc="대기 일수가 지난 고객을 6시간마다 다시 넣어요. 광고 수신 동의 고객만, 한 고객당 진행 중 하나만이에요." />
          </div>
        )}
      </div>

      {/* 더 보기 */}
      <div className={sec}>
        <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-slate-800">
          {more ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}비용 · 예산 · 대조군
        </button>
        {more && (
          <div className="mt-2 space-y-2.5 text-[13px] text-slate-700">
            <div className="flex flex-wrap items-center gap-1.5">칸 하나에 <NumField label="칸당 비용 한도" value={form.thresholdCost} onChange={(v) => setField('thresholdCost', v)} unit="원까지" placeholder="제한 없음" disabled={locked} min={0} /></div>
            <div className="flex flex-wrap items-center gap-1.5">한 달에 <NumField label="월 예산" value={form.budgetMonthly} onChange={(v) => setField('budgetMonthly', v)} unit="원까지" placeholder="제한 없음" disabled={locked} min={0} /></div>
            <div className="flex flex-wrap items-center gap-1.5">
              스팸 위험도
              <select aria-label="위험도" disabled={locked} value={form.thresholdRiskLevel} onChange={(e) => setField('thresholdRiskLevel', e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-[13px]">
                <option value="low">낮음까지만</option><option value="medium">보통까지</option><option value="high">높음까지</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">들어온 고객의 <NumField label="대조군 비율" value={form.holdoutPct} onChange={(v) => setField('holdoutPct', Math.max(0, Math.min(30, v ?? 0)))} unit="%는 보내지 않고 비교해요" disabled={locked} min={0} max={30} /></div>
            <Toggle on={form.personalSendTime === true} onChange={(v) => setField('personalSendTime', v)} disabled={locked} label="고객이 잘 보는 시간에 보내기" desc="보낼 시각을 정한 칸은 고객이 최근 90일 동안 반응한 시간대로 맞춰요." />
          </div>
        )}
      </div>
    </section>
  );
}
