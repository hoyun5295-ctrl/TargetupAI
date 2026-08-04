/**
 * SegmentPicker — 발송 대상 계약 선택 (2026-08-03 타겟팅 재설계 A)
 *
 * 원칙
 *  - 축 목록을 프런트가 갖지 않는다. 서버가 이 회사에서 되는 축과 안 되는 축을 사유와 함께 준다.
 *  - 안 되는 축을 숨기지 않는다. 숨기면 담당자는 왜 없는지 알 수 없다 — 잠금과 이유를 같이 보여준다.
 *  - 고르는 즉시 지금 기준 대상 수를 실측해 보여준다. 추가 입력·확인 단계 없음(클릭 1회).
 *  - 이 수는 발송이 쓰는 조건·게이트와 같은 기준이다(보여준 수 = 나가는 수).
 * 다크 톤 · native dialog 0.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Lock, Check, Users, AlertCircle, Sparkles } from 'lucide-react';
import { SegmentAvailability } from './types';

interface Props {
  value: string | null;
  params: Record<string, number> | null;
  onChange: (segmentKey: string | null, segmentParams: Record<string, number> | null) => void;
  disabled?: boolean;
  /**
   * 옛 방식으로 저장된 대상 축(target_hint). 계약 이전에 만들어진 자동마케팅만 갖는다.
   * ⛔ 숨기면 화면은 "목표 문장으로 자동 판단"이라 말하는데 실제로는 그 축으로 나간다 — 그대로 보여준다.
   */
  legacyHint?: string | null;
  /** "목표 문장으로 자동 판단"을 명시적으로 고른 순간 — 옛 축(target_hint)도 함께 해제해야 한다. */
  onClearLegacyHint?: () => void;
  /** 편집 중인 오퍼레이터 id — 있으면 그 오퍼레이터 소유자 기준으로 대상 수를 센다(관리자가 남의 것을 편집할 때). */
  operatorId?: string | null;
}

const LEGACY_HINT_LABEL: Record<string, string> = {
  all: '전체 고객', dormant: '휴면 고객', recent_buyers: '최근 구매 고객',
  vip: 'VIP·상위 등급', birthday: '이달 생일 고객', new_customers: '신규 등록 고객',
};

// ★ 2026-08-04: 자주 쓰는 값 목록(옛 QUICK_DAYS)을 여기서 제거했다. 축마다 자연스러운 구간이 달라
//   (일 단위 / 금액 단위) 화면이 목록을 들고 있으면 금액 축에 '30일' 버튼이 뜬다. 범위를 정하는 곳이 정한다.

export default function SegmentPicker({ value, params, onChange, disabled, legacyHint, onClearLegacyHint, operatorId }: Props) {
  const [segments, setSegments] = useState<SegmentAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);
  /** 늦게 온 응답이 최신 선택을 덮지 않도록 — 축을 빠르게 바꿀 때 수가 뒤섞이면 그 화면은 거짓이 된다. */
  const reqSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/ai/operator/segments', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (!alive) return;
        if (data?.success && Array.isArray(data.segments)) setSegments(data.segments);
        else setLoadError(data?.error || '발송 대상 목록을 불러오지 못했습니다.');
      } catch (e: any) {
        if (alive) setLoadError(e?.message || '발송 대상 목록을 불러오지 못했습니다.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const measure = useCallback(async (key: string, p: Record<string, number> | null) => {
    const seq = ++reqSeq.current;
    setCounting(true);
    setCountError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/ai/operator/target-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        // operator_id를 함께 보낸다 — 관리자가 남의 오퍼레이터를 편집할 때 화면 수와 실발송 범위가 갈리지 않게
        // 그 오퍼레이터 소유자 기준으로 세게 한다(신규 등록이면 미전송 = 지금 계정 기준).
        body: JSON.stringify({ segment_key: key, segment_params: p || {}, operator_id: operatorId || undefined }),
      });
      const data = await res.json();
      if (seq !== reqSeq.current) return;
      if (data?.success) setCount(Number(data.total) || 0);
      else { setCount(null); setCountError(data?.error || '대상 수를 확인하지 못했습니다.'); }
    } catch (e: any) {
      if (seq !== reqSeq.current) return;
      setCount(null);
      setCountError(e?.message || '대상 수를 확인하지 못했습니다.');
    } finally {
      if (seq === reqSeq.current) setCounting(false);
    }
  }, []);

  const selected = segments.find((s) => s.key === value) || null;

  /**
   * ★ 2026-08-04 — 변화 축을 신규 등록에서 고른 상태. 비교할 지난번이 아직 없다.
   * ⛔ 이때 대상 수를 세러 가지 않는다. 서버는 사유와 함께 멈추는데 화면에는 그게 붉은 오류로 보이고,
   *   담당자는 고장으로 읽는다. 이건 정상 흐름이라 안내를 대신 띄우고 호출 자체를 하지 않는다.
   */
  const awaitingBaseline = !!selected?.needsCycleBaseline && !operatorId;

  // 선택된 축·파라미터가 바뀌면 지금 기준으로 다시 센다. 파라미터 연타는 마지막 값만 센다.
  useEffect(() => {
    if (!value || awaitingBaseline) { setCount(null); setCountError(null); reqSeq.current++; return; }
    const t = setTimeout(() => { void measure(value, params); }, 350);
    return () => clearTimeout(t);
  }, [value, params, measure, operatorId, awaitingBaseline]);

  const pick = (s: SegmentAvailability) => {
    if (disabled || !s.available) return;
    const next: Record<string, number> = {};
    for (const d of s.params) next[d.key] = d.default;
    onChange(s.key, s.params.length > 0 ? next : null);
  };

  /** 파라미터는 축이 정의한 만큼 전부 보여준다 — 종전엔 'days' 하나만 그려서 금액 조건이 화면에 없었다. */
  const setParam = (key: string, n: number) => {
    const def = selected?.params?.find((p) => p.key === key);
    if (!def || !value) return;
    const clamped = Math.min(def.max, Math.max(def.min, Math.floor(n)));
    onChange(value, { ...(params || {}), [key]: clamped });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-6 text-xs text-white/50 bg-white/5 border border-white/10 rounded-lg">
        <Loader2 className="w-4 h-4 animate-spin" /> 이 계정에서 쓸 수 있는 발송 대상을 확인하는 중입니다
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-start gap-2 px-3 py-3 text-xs text-amber-200 bg-amber-500/10 border border-amber-400/30 rounded-lg">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{loadError}</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {/* 계약 없음 — 목표 문장을 해석하는 종전 방식. 고르면 회차마다 조건이 달라질 수 있다. */}
        <button
          type="button"
          onClick={() => { if (disabled) return; onChange(null, null); onClearLegacyHint?.(); }}
          disabled={disabled}
          className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${
            value === null
              ? 'bg-indigo-500/25 border-indigo-400/50'
              : 'bg-white/5 border-white/10 hover:border-white/25'
          } disabled:opacity-40`}
        >
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
            <span className="text-xs font-medium text-white">목표 문장으로 자동 판단</span>
            {value === null && <Check className="w-3.5 h-3.5 text-indigo-300 ml-auto shrink-0" />}
          </div>
          <div className="text-[10px] text-white/45 mt-1 leading-relaxed">
            {value === null && legacyHint
              ? `지금은 예전에 지정한 '${LEGACY_HINT_LABEL[legacyHint] || legacyHint}' 축으로 나갑니다. 아래에서 대상을 고르면 그 축으로 바뀝니다.`
              : '매 회차 목표 문장을 다시 해석합니다. 회차마다 대상이 달라질 수 있습니다.'}
          </div>
        </button>

        {segments.map((s) => {
          const on = value === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => pick(s)}
              disabled={disabled || !s.available}
              title={s.reason}
              className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${
                on ? 'bg-indigo-500/25 border-indigo-400/50'
                  : s.available ? 'bg-white/5 border-white/10 hover:border-white/25'
                  : 'bg-white/[0.02] border-white/5 cursor-not-allowed'
              } ${disabled ? 'opacity-40' : ''}`}
            >
              <div className="flex items-center gap-1.5">
                {!s.available && <Lock className="w-3.5 h-3.5 text-white/30 shrink-0" />}
                <span className={`text-xs font-medium ${s.available ? 'text-white' : 'text-white/40'}`}>{s.label}</span>
                {on && <Check className="w-3.5 h-3.5 text-indigo-300 ml-auto shrink-0" />}
              </div>
              <div className={`text-[10px] mt-1 leading-relaxed ${s.available ? 'text-white/45' : 'text-white/35'}`}>
                {s.reason}
              </div>
            </button>
          );
        })}
      </div>

      {(selected?.params || []).map((def) => {
        const cur = Number(params?.[def.key] ?? def.default);
        const presets = (def.presets || []).filter((p) => p >= def.min && p <= def.max);
        return (
          <div key={def.key} className="px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-white/60">{def.label}</span>
              <span className="text-[11px] text-white/80 font-medium">{cur.toLocaleString()}{def.unit}</span>
            </div>
            {presets.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {presets.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setParam(def.key, p)}
                    disabled={disabled}
                    className={`px-2.5 py-1 text-[11px] rounded-md border transition-colors ${
                      cur === p ? 'bg-indigo-500/30 border-indigo-400/50 text-indigo-100'
                        : 'bg-white/5 border-white/10 text-white/60 hover:text-white/90'
                    } disabled:opacity-40`}
                  >
                    {p.toLocaleString()}{def.unit}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* 변화 축 첫 회차 — 대상 수 대신 무슨 일이 일어날지 먼저 말한다(오류 아님). */}
      {awaitingBaseline && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-indigo-500/10 border border-indigo-400/30 rounded-lg">
          <Sparkles className="w-3.5 h-3.5 text-indigo-300 shrink-0 mt-0.5" />
          <span className="text-[11px] text-indigo-100/90 leading-relaxed">
            지난번 발송 때와 비교해서 대상을 정하는 조건입니다. 저장하면 <span className="font-semibold">첫 회차에 비교 기준을 잡고</span>,
            그다음 회차부터 달라진 분들이 대상으로 잡힙니다.
          </span>
        </div>
      )}

      {value && !awaitingBaseline && (
        <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg">
          <Users className="w-3.5 h-3.5 text-white/40 shrink-0" />
          {counting ? (
            <span className="flex items-center gap-1.5 text-[11px] text-white/50">
              <Loader2 className="w-3 h-3 animate-spin" /> 지금 기준으로 세는 중입니다
            </span>
          ) : countError ? (
            <span className="text-[11px] text-amber-200">{countError}</span>
          ) : count !== null ? (
            <span className="text-[11px] text-white/70">
              지금 기준 <span className="text-white font-semibold">{count.toLocaleString()}명</span>
              <span className="text-white/40"> · 수신거부·발송 피로도까지 걸러낸 실제 발송 대상입니다</span>
            </span>
          ) : null}
        </div>
      )}

      <div className="text-[10px] text-white/40 leading-relaxed">
        {value
          ? '고른 조건이 그대로 저장됩니다. 매 회차 같은 조건으로 대상을 뽑고, 발송 직전에 다시 한 번 추출합니다.'
          : '조건을 고르면 회차마다 같은 기준으로 대상을 뽑습니다.'}
      </div>
    </div>
  );
}
