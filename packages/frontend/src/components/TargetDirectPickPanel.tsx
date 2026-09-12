/**
 * TargetDirectPickPanel — 조건을 직접 골라 타겟을 잡는 패널 (★ 2026-09-12 · 접수 `cmtwb4drj009rjnluzpgntxkt`)
 *
 *   모바일DM 발송 화면의 타겟 추출은 자연어 입력만 있었다. 보낼 대상이 머릿속에 이미 정해져 있는
 *   담당자는 "30대 · VIP · 서울"을 문장으로 다시 쓰는 대신 **골라서** 잡고 싶다.
 *
 *   - 필드·선택지는 회사 스키마 그대로(`/api/customers/enabled-fields`) — 하드코딩 매핑 0.
 *   - 조건 → filter 변환은 프론트 CT(`utils/customerFilterBuild`) 한 벌. 직접발송 조건 선택과 같은 규칙이다.
 *   - 인원은 고르는 대로 자동 갱신(`/api/targets/count`) — 버튼을 한 번 더 누르게 하지 않는다.
 *   - 수신동의·수신거부·무효번호는 채널 자격이 이미 걸러서 "발송 가능"에 반영한다. 그래서 그 필드는 고르는 목록에 두지 않는다.
 *   - 0건이어도 조건은 자동으로 넓히지 않는다(D171) — 숫자를 그대로 보여 주고 진행만 막는다.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Filter, Loader2, RotateCcw, Search } from 'lucide-react';
import { FRONT_FIELD_DISPLAY_MAP, reverseDisplayValueFront } from '../utils/formatDate';
import { buildDynamicFiltersFromSelection } from '../utils/customerFilterBuild';

export interface DirectPickResult {
  filter: Record<string, { operator: string; value: any }>;
  isAll: boolean;
  explanation: string;
  matchCount: number;
  channelEligibleCount: number;
  samples: Array<{
    id: string;
    phone: string;
    name: string | null;
    gender: string | null;
    grade?: string | null;
    region: string | null;
    last_purchase_date: string | null;
    total_purchase_amount: number | null;
  }>;
}

interface Props {
  channel: 'email' | 'dm' | 'inapp' | 'kakao';
  /** 조건이 바뀌어 인원을 새로 센 결과. 아직 못 셌으면 null */
  onResult: (result: DirectPickResult | null) => void;
  /** 인원을 세는 중인지 — 부모가 진행 버튼을 잠그는 데 쓴다 */
  onCountingChange?: (counting: boolean) => void;
}

/** 채널 자격이 이미 보는 축이라 고르는 목록에서 뺀다(골라도 filter에 실리지 않아 혼란만 준다) */
const HIDDEN_FIELD_KEYS = new Set(['sms_opt_in', 'opt_in_sms']);

const AGE_PRESETS = [
  { label: '10대', value: '10' }, { label: '20대', value: '20' },
  { label: '30대', value: '30' }, { label: '40대', value: '40' },
  { label: '50대', value: '50' }, { label: '60+', value: '60' },
];
const DAYS_PRESETS = [
  { label: '7일', value: '7' }, { label: '30일', value: '30' },
  { label: '90일', value: '90' }, { label: '180일', value: '180' },
  { label: '1년', value: '365' },
];
const BIRTH_MONTH_PRESETS = Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1}월`, value: `month:${i + 1}` }));
const AMOUNT_PRESETS = [
  { label: '10만', value: 100000 }, { label: '50만', value: 500000 },
  { label: '100만', value: 1000000 }, { label: '500만', value: 5000000 },
];

const PILL_ON = 'bg-violet-500/30 text-violet-100 border-violet-400/50';
const PILL_OFF = 'bg-white/5 text-white/55 border-white/10 hover:bg-white/10 hover:text-white/80';
const INPUT_DARK =
  'w-full bg-slate-950/60 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-400/60';

export default function TargetDirectPickPanel({ channel, onResult, onCountingChange }: Props) {
  const [enabledFields, setEnabledFields] = useState<any[]>([]);
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>({});
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [fieldsError, setFieldsError] = useState<string | null>(null);

  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [filterValues, setFilterValues] = useState<Record<string, any>>({});
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({ basic: true });

  const [counting, setCounting] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);
  // 늦게 도착한 응답이 최신 조건의 결과를 덮지 않게 한다
  const reqSeq = useRef(0);
  // 직전에 물어본 조건 — 같은 조건이면 다시 묻지 않는다
  const lastFilterKey = useRef('');

  useEffect(() => { onCountingChange?.(counting); }, [counting]);

  // 필드·선택지 로드 (회사 스키마 그대로)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/customers/enabled-fields', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        if (!res.ok) {
          setFieldsError('고객 항목을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
          return;
        }
        const data = await res.json();
        setEnabledFields((data.fields || []).filter((f: any) => !HIDDEN_FIELD_KEYS.has(f.field_key)));
        setFilterOptions(data.options || {});
        if (data.categories) setCategoryLabels(data.categories);
      } catch {
        setFieldsError('서버에 연결할 수 없습니다.');
      } finally {
        setFieldsLoading(false);
      }
    })();
  }, []);

  // 카테고리 묶음 (응답 순서 유지)
  const grouped = useMemo(() => {
    const out: Array<{ cat: string; label: string; fields: any[] }> = [];
    for (const f of enabledFields) {
      const cat = f.category || 'basic';
      let g = out.find((x) => x.cat === cat);
      if (!g) { g = { cat, label: categoryLabels[cat] || cat, fields: [] }; out.push(g); }
      g.fields.push(f);
    }
    return out;
  }, [enabledFields, categoryLabels]);

  const isGenderField = (key: string) => !!FRONT_FIELD_DISPLAY_MAP[key];
  const optionLabel = (fk: string, opt: string) => (isGenderField(fk) ? reverseDisplayValueFront('gender', opt) : opt);
  const fieldLabel = (f: any) => f.display_name || f.field_key;

  const toggleField = (fieldKey: string) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) {
        next.delete(fieldKey);
        setFilterValues((fv) => {
          const u = { ...fv };
          delete u[fieldKey];
          delete u[`${fieldKey}_min`];
          delete u[`${fieldKey}_max`];
          return u;
        });
      } else {
        next.add(fieldKey);
      }
      return next;
    });
  };

  const toggleMultiOption = (fieldKey: string, option: string) => {
    setFilterValues((prev) => {
      const current = Array.isArray(prev[fieldKey]) ? [...prev[fieldKey]] : [];
      const idx = current.indexOf(option);
      if (idx >= 0) current.splice(idx, 1);
      else current.push(option);
      return { ...prev, [fieldKey]: current };
    });
  };

  const resetAll = () => {
    setSelectedFields(new Set());
    setFilterValues({});
  };

  // ── 고른 조건을 사람 말로 (AI 해석 자리에 그대로 표시) ────────────────────
  const describeValue = (f: any): string => {
    const fk = f.field_key;
    const v = filterValues[fk];
    if (fk === 'age') {
      if (v?.mode === 'range') {
        if (v.min && v.max) return `${v.min}~${v.max}세`;
        if (v.min) return `${v.min}세 이상`;
        if (v.max) return `${v.max}세 이하`;
        return '';
      }
      const presets: string[] = v?.presets || [];
      if (presets.length === 0) return '';
      return presets.map((p) => (p === '60' ? '60대 이상' : `${p}대`)).join('·');
    }
    if (f.data_type === 'number') {
      const min = filterValues[`${fk}_min`];
      const max = filterValues[`${fk}_max`];
      if (min && max) return `${Number(min).toLocaleString()} ~ ${Number(max).toLocaleString()}`;
      if (min) return `${Number(min).toLocaleString()} 이상`;
      if (max) return `${Number(max).toLocaleString()} 이하`;
      return '';
    }
    if (f.data_type === 'date') {
      if (!v) return '';
      if (String(v).startsWith('month:')) return `${String(v).replace('month:', '')}월`;
      return `최근 ${v}일 안`;
    }
    if (f.data_type === 'boolean') return v === 'false' ? '아니오' : '예';
    if (Array.isArray(v)) return v.length ? v.map((o) => optionLabel(fk, o)).join(', ') : '';
    if (typeof v === 'string' && v.trim()) return `'${v.trim()}' 포함`;
    return '';
  };

  const explanation = useMemo(() => {
    const parts: string[] = [];
    for (const f of enabledFields) {
      if (!selectedFields.has(f.field_key)) continue;
      const desc = describeValue(f);
      if (desc) parts.push(`${fieldLabel(f)} ${desc}`);
    }
    return parts.length ? parts.join(' · ') : '';
  }, [enabledFields, selectedFields, filterValues]);

  // 고른 항목 중 값까지 정해져 실제 조건이 된 것 — 항목만 체크하고 값을 안 고르면 조건이 아니다.
  const built = useMemo(
    () => buildDynamicFiltersFromSelection(selectedFields, filterValues, enabledFields),
    [selectedFields, filterValues, enabledFields],
  );
  const activeCount = Object.keys(built.dynamicFilters).length;

  // ── 조건이 바뀌면 인원을 다시 센다 (자동 · 늦은 응답 무시) ────────────────
  useEffect(() => {
    if (fieldsLoading) return;
    const dynamicFilters = built.dynamicFilters;

    // 조건이 하나도 없으면 세지 않는다 — 아무것도 안 고른 상태가 곧 "전체 고객 발송"이 되면 안 된다.
    //   전체 발송은 자연어 탭에서 "전체 고객"으로 확정하는 길이 이미 있고, 그게 의사를 명시하는 자리다.
    if (Object.keys(dynamicFilters).length === 0) {
      reqSeq.current += 1;   // 앞서 나간 응답이 뒤늦게 결과를 채우지 못하게 한다
      lastFilterKey.current = '';   // 다시 고르면 새로 센다
      setCounting(false);
      setCountError(null);
      onResult(null);
      return;
    }

    // 값이 그대로면 다시 묻지 않는다(선택지 검색어 타이핑 등 — 조건이 아닌 입력으로 서버를 두드리지 않는다)
    const filterKey = JSON.stringify(dynamicFilters);
    if (filterKey === lastFilterKey.current) return;
    lastFilterKey.current = filterKey;

    const seq = ++reqSeq.current;
    const timer = setTimeout(async () => {
      setCounting(true);
      setCountError(null);
      try {
        const res = await fetch('/api/targets/count', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
          body: JSON.stringify({ channel, filter: dynamicFilters }),
        });
        const data = await res.json();
        if (seq !== reqSeq.current) return;   // 더 최근 조건이 이미 나갔다
        if (!res.ok || !data.success) {
          setCountError(data?.error || '인원을 세지 못했습니다.');
          onResult(null);
          return;
        }
        onResult({
          filter: data.filter || {},
          isAll: !!data.isAll,
          explanation,
          matchCount: data.matchCount,
          channelEligibleCount: data.channelEligibleCount,
          samples: data.samples || [],
        });
      } catch (e: any) {
        if (seq !== reqSeq.current) return;
        setCountError(e?.message || '서버에 연결할 수 없습니다.');
        onResult(null);
      } finally {
        if (seq === reqSeq.current) setCounting(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [built, fieldsLoading, channel, explanation]);

  // ── 조건 입력 ────────────────────────────────────────────────────────────
  const renderCondition = (field: any) => {
    const fk = field.field_key;

    if (fk === 'age') {
      const age = filterValues.age || { mode: 'preset', presets: [] };
      return (
        <div className="mt-1.5 space-y-2">
          <div className="flex items-center gap-1">
            {([['preset', '연령대'], ['range', '직접입력']] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setFilterValues((prev) => ({ ...prev, age: { mode: m, presets: [], min: '', max: '' } }))}
                className={`px-2.5 py-1 text-[11px] rounded-lg font-medium border transition-colors ${age.mode === m ? PILL_ON : PILL_OFF}`}
              >{label}</button>
            ))}
          </div>
          {age.mode === 'range' ? (
            <div className="flex items-center gap-1.5">
              <input type="number" value={age.min || ''} placeholder="최소"
                onChange={(e) => setFilterValues((prev) => ({ ...prev, age: { ...(prev.age || { mode: 'range' }), mode: 'range', min: e.target.value } }))}
                className={`${INPUT_DARK} w-20 text-center`} />
              <span className="text-xs text-white/40">~</span>
              <input type="number" value={age.max || ''} placeholder="최대"
                onChange={(e) => setFilterValues((prev) => ({ ...prev, age: { ...(prev.age || { mode: 'range' }), mode: 'range', max: e.target.value } }))}
                className={`${INPUT_DARK} w-20 text-center`} />
              <span className="text-xs text-white/40">세</span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {AGE_PRESETS.map((p) => {
                const sel = (age.presets || []).includes(p.value);
                return (
                  <button key={p.value}
                    onClick={() => setFilterValues((prev) => {
                      const cur = prev.age || { mode: 'preset', presets: [] };
                      const presets = [...(cur.presets || [])];
                      const i = presets.indexOf(p.value);
                      if (i >= 0) presets.splice(i, 1); else presets.push(p.value);
                      return { ...prev, age: { ...cur, mode: 'preset', presets } };
                    })}
                    className={`px-2.5 py-1 text-[11px] rounded-lg font-medium border transition-colors ${sel ? PILL_ON : PILL_OFF}`}
                  >{p.label}</button>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    if (field.data_type === 'boolean') {
      const val = filterValues[fk] || 'true';
      return (
        <div className="flex gap-1 mt-1.5">
          {([['true', '예'], ['false', '아니오']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setFilterValues((prev) => ({ ...prev, [fk]: v }))}
              className={`px-3 py-1 text-[11px] rounded-lg font-medium border transition-colors ${val === v ? PILL_ON : PILL_OFF}`}
            >{label}</button>
          ))}
        </div>
      );
    }

    // 선택지가 있는 문자열 = 다중 선택 (많으면 검색)
    if (field.data_type === 'string' && (filterOptions[fk]?.length || 0) > 0) {
      const selected: string[] = Array.isArray(filterValues[fk]) ? filterValues[fk] : [];
      const allOpts = filterOptions[fk];
      const searchKey = `__search_${fk}`;
      const term = String(filterValues[searchKey] || '').toLowerCase();
      const shown = allOpts.length > 15 && term
        ? allOpts.filter((o) => optionLabel(fk, o).toLowerCase().includes(term))
        : allOpts;
      return (
        <div className="mt-1.5">
          {allOpts.length > 15 && (
            <div className="relative mb-1.5">
              <Search className="w-3.5 h-3.5 text-white/30 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input type="text" value={filterValues[searchKey] || ''} placeholder={`검색 (${allOpts.length}개 중)`}
                onChange={(e) => setFilterValues((prev) => ({ ...prev, [searchKey]: e.target.value }))}
                className={`${INPUT_DARK} pl-8`} />
            </div>
          )}
          {selected.length > 0 && <p className="text-[10px] text-violet-200 mb-1">{selected.length}개 선택</p>}
          <div className={`flex flex-wrap gap-1.5 ${allOpts.length > 15 ? 'max-h-[132px] overflow-y-auto pr-1' : ''}`}>
            {shown.map((opt) => {
              const sel = selected.includes(opt);
              return (
                <button key={opt} onClick={() => toggleMultiOption(fk, opt)}
                  className={`px-2.5 py-1 text-[11px] rounded-lg font-medium border transition-colors ${sel ? PILL_ON : PILL_OFF}`}
                >{optionLabel(fk, opt)}</button>
              );
            })}
          </div>
        </div>
      );
    }

    if (field.data_type === 'number') {
      const minKey = `${fk}_min`;
      const maxKey = `${fk}_max`;
      const isAmount = fk.includes('amount') || fk.includes('price') || fk === 'points';
      return (
        <div className="mt-1.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input type="text" inputMode="numeric" placeholder="최소"
              value={filterValues[minKey] ? Number(filterValues[minKey]).toLocaleString() : ''}
              onChange={(e) => setFilterValues((prev) => ({ ...prev, [minKey]: e.target.value.replace(/[^0-9]/g, '') }))}
              className={INPUT_DARK} />
            <span className="text-xs text-white/40">~</span>
            <input type="text" inputMode="numeric" placeholder="최대"
              value={filterValues[maxKey] ? Number(filterValues[maxKey]).toLocaleString() : ''}
              onChange={(e) => setFilterValues((prev) => ({ ...prev, [maxKey]: e.target.value.replace(/[^0-9]/g, '') }))}
              className={INPUT_DARK} />
          </div>
          {isAmount && (
            <div className="flex flex-wrap gap-1">
              {AMOUNT_PRESETS.map((p) => (
                <button key={p.value} type="button"
                  onClick={() => setFilterValues((prev) => ({ ...prev, [minKey]: prev[minKey] === String(p.value) ? '' : String(p.value) }))}
                  className={`px-2 py-0.5 text-[10px] rounded font-medium border transition-colors ${filterValues[minKey] === String(p.value) ? PILL_ON : PILL_OFF}`}
                >{p.label}↑</button>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (field.data_type === 'date') {
      const val = filterValues[fk] || '';
      const isBirthday = fk === 'birthday' || fk === 'birth_date';
      const presets = isBirthday ? BIRTH_MONTH_PRESETS : DAYS_PRESETS;
      return (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {presets.map((p) => (
            <button key={p.value}
              onClick={() => setFilterValues((prev) => ({ ...prev, [fk]: prev[fk] === p.value ? '' : p.value }))}
              className={`px-2.5 py-1 text-[11px] rounded-lg font-medium border transition-colors ${val === p.value ? PILL_ON : PILL_OFF}`}
            >{p.label}</button>
          ))}
        </div>
      );
    }

    return (
      <input type="text" value={filterValues[fk] || ''} placeholder="포함하는 값 입력"
        onChange={(e) => setFilterValues((prev) => ({ ...prev, [fk]: e.target.value }))}
        className={`${INPUT_DARK} mt-1.5`} />
    );
  };

  if (fieldsLoading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 flex items-center justify-center gap-2 text-white/50 text-xs">
        <Loader2 className="w-4 h-4 animate-spin" /> 고객 항목을 불러오는 중...
      </div>
    );
  }
  if (fieldsError) {
    return <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200">{fieldsError}</div>;
  }
  if (enabledFields.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-white/50">
        고를 수 있는 고객 항목이 없습니다. 고객 데이터를 올린 뒤 이용해주세요.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-violet-300" />
          <p className="text-[11px] text-white/70 font-medium">조건 직접 선택</p>
          {counting && <Loader2 className="w-3 h-3 animate-spin text-violet-300" />}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/35">
            {activeCount > 0 ? `${activeCount}개 조건` : selectedFields.size > 0 ? '값을 정해주세요' : '조건 없음'}
          </span>
          {selectedFields.size > 0 && (
            <button onClick={resetAll} className="flex items-center gap-1 text-[10px] text-white/50 hover:text-white px-1.5 py-0.5 rounded border border-white/10 bg-white/5 hover:bg-white/10 transition-colors">
              <RotateCcw className="w-3 h-3" /> 초기화
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
        {grouped.map((g) => {
          const open = !!expandedCats[g.cat];
          const picked = g.fields.filter((f) => selectedFields.has(f.field_key)).length;
          return (
            <div key={g.cat} className="rounded-lg border border-white/10 bg-slate-950/40 overflow-hidden">
              <button
                onClick={() => setExpandedCats((prev) => ({ ...prev, [g.cat]: !prev[g.cat] }))}
                className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-white/5 transition-colors"
              >
                <span className="text-[11px] font-semibold text-white/80">
                  {g.label}
                  {picked > 0 && <span className="ml-1.5 text-[10px] text-violet-200">{picked}</span>}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <div className="px-3 pb-2.5 space-y-2.5">
                  {g.fields.map((f) => {
                    const on = selectedFields.has(f.field_key);
                    return (
                      <div key={f.field_key}>
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input type="checkbox" checked={on} onChange={() => toggleField(f.field_key)}
                            className="rounded accent-violet-500" />
                          <span className={`text-[11.5px] ${on ? 'text-white font-medium' : 'text-white/55'}`}>{fieldLabel(f)}</span>
                        </label>
                        {on && renderCondition(f)}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {countError && (
        <p className="mt-2 text-[11px] text-rose-200">{countError}</p>
      )}
      {activeCount === 0 && (
        <p className="mt-2 text-[11px] text-white/50">
          조건을 하나 이상 골라주세요. 모든 고객에게 보내려면 'AI 자연어' 탭에서 '전체 고객'으로 확정합니다.
        </p>
      )}
      <p className="mt-2 text-[10px] text-white/30">
        고르는 대로 인원이 갱신됩니다. 수신동의·수신거부·무효번호는 자동으로 걸러 '발송 가능'에 반영됩니다.
      </p>
    </div>
  );
}
