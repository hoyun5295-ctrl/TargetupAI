/**
 * GradeOrderModal — 회사 등급 서열을 한 번 확인받는 자리 (2026-08-02)
 *
 * 왜 사람에게 묻는가
 *   고객사마다 등급 체계가 다르다(VIP·VVIP·일반 / 브론즈~다이아 / A·B·C / 1·2·3).
 *   우리가 사전을 들고 있으면 다음 고객사에서 깨지고, 구매액으로 추론하면 표본이 적은 등급에서 뒤집힌다.
 *   뒤집히면 **등급이 떨어진 고객에게 축하가 나간다** — 틀렸을 때 대가가 발송이라 추정을 쓸 자리가 아니다.
 *
 * 사용자가 하는 일은 **순서 확인 한 번**이다
 *   값 목록은 그 회사 데이터에서 실측으로 나오고(인원수 함께), 초안 순서가 이미 매겨진 채로 뜬다.
 *   드래그가 아니라 위/아래 버튼이 기본이다 — 모바일에서 드래그는 정확히 집기 어렵다.
 *
 * 저장 규약(서버와 동일)
 *   같은 순위 = 같은 급(그 사이 이동은 상승이 아니다) · 순서 없음 = 등급이 아닌 값(그 값은 판정에서 빠진다).
 */
import { useEffect, useMemo, useState } from 'react';
import { Layers, ChevronUp, ChevronDown, Loader2, Save, X, Info } from 'lucide-react';
import JourneyModalShell from './JourneyModalShell';

export interface GradeValueRow {
  gradeValue: string;
  customerCount: number;
  ranked: boolean;
  rankOrder: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 저장이 끝난 뒤 — 잠겨 있던 자리를 다시 판정하게 한다. */
  onSaved?: () => void;
  token: string;
}

/** 초안 순서 — 흔한 체계의 아래→위 순. 맞히려는 게 아니라 **사람이 고칠 출발점**을 주는 것이다. */
const DRAFT_HINTS = [
  '일반', '기본', '신규', 'basic', 'normal', 'bronze', '브론즈', 'family', '패밀리',
  'silver', '실버', 'green', '그린', 'gold', '골드', 'blue', '블루',
  'platinum', '플래티넘', '프리미엄', 'premium', 'vip', '우수',
  'diamond', '다이아', '다이아몬드', 'vvip', '최우수', 'royal', '로얄',
];

function draftScore(value: string): number {
  const v = String(value || '').trim().toLowerCase();
  const num = v.match(/^\D*(\d+)\D*$/);
  if (num) return Number(num[1]);                       // 1·2·3 / 1등급 → 숫자 그대로
  const idx = DRAFT_HINTS.findIndex((h) => v.includes(h));
  return idx >= 0 ? 100 + idx : 50;                     // 못 알아본 값은 가운데
}

export default function GradeOrderModal({ open, onClose, onSaved, token }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * **위가 높은 등급**인 목록(화면 안내와 같은 방향). 같은 급은 sameAsPrev로 묶는다.
   * ⛔ 2026-08-02 Codex — 순서 없음은 **행마다** 갖는다. 전역 토글이면 정상 등급과
   *   '직장인' 같은 비등급 값이 섞인 회사에서 그 값만 뺄 수 없고, 저장된 상태도 복원되지 않는다.
   */
  const [rows, setRows] = useState<Array<GradeValueRow & { sameAsPrev: boolean; unranked: boolean }>>([]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/ai/operator/grade-ranks', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (!alive) return;
        if (!res.ok || !data?.success) {
          setError(data?.error || '등급 목록을 불러오지 못했습니다.');
          setRows([]);
          return;
        }
        const values: GradeValueRow[] = data.values || [];
        const configured = data.configured === true;   // 저장한 적이 있는가(전부 순서 없음도 포함)
        // 위가 높은 등급 — 저장본은 순위 내림차순, 처음이면 초안 점수 내림차순.
        const sorted = [...values].sort((a, b) =>
          configured
            ? (b.rankOrder ?? -1) - (a.rankOrder ?? -1)
            : draftScore(b.gradeValue) - draftScore(a.gradeValue)
        );
        setRows(sorted.map((v, i) => ({
          ...v,
          unranked: configured ? v.rankOrder == null : false,
          sameAsPrev: configured && i > 0 && v.rankOrder != null && v.rankOrder === sorted[i - 1].rankOrder,
        })));
      } catch (e: any) {
        if (alive) setError(e?.message || '등급 목록 조회 중 오류');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, token]);

  const move = (idx: number, dir: -1 | 1) => {
    setRows((prev) => {
      const next = [...prev];
      const to = idx + dir;
      if (to < 0 || to >= next.length) return prev;
      [next[idx], next[to]] = [next[to], next[idx]];
      // 맨 위로 올라간 줄은 "위와 같은 급"일 수 없다.
      return next.map((r, i) => (i === 0 ? { ...r, sameAsPrev: false } : r));
    });
  };

  /**
   * 화면 순서 → 저장할 순위.
   * ⛔ 2026-08-02 Codex — **위가 큰 숫자**다. 화면은 "위로 갈수록 높은 등급"이라 안내하는데
   *   위에 작은 숫자를 주면 서버의 `새 순위 > 옛 순위`(상승) 판정이 뒤집혀 **하락에 축하가 나간다.**
   *   순서 없음으로 표시한 줄은 급 계산에서 빠진다(그 값은 판정 대상이 아니다).
   */
  const payload = useMemo(() => {
    const groups: number[] = [];              // 각 행이 속한 급 번호(위에서부터 0,1,2…)
    let g = -1;
    rows.forEach((r, i) => {
      if (r.unranked) { groups.push(-1); return; }
      const prevRanked = rows.slice(0, i).some((x) => !x.unranked);
      if (!prevRanked || !r.sameAsPrev) g += 1;
      groups.push(g);
    });
    const total = g + 1;                      // 급 개수
    return rows.map((r, i) => ({
      gradeValue: r.gradeValue,
      rankOrder: r.unranked ? null : total - groups[i],   // 맨 위 급 = total
    }));
  }, [rows]);

  const rankedCount = useMemo(
    () => new Set(payload.filter((p) => p.rankOrder != null).map((p) => p.rankOrder)).size,
    [payload]
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/operator/grade-ranks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ranks: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setError(data?.error || '저장하지 못했습니다.');
        return;
      }
      onSaved?.();
      onClose();
    } catch (e: any) {
      setError(e?.message || '저장 중 오류');
    } finally {
      setSaving(false);
    }
  };

  return (
    <JourneyModalShell open={open} onClose={onClose} labelledBy="grade-order-modal-title" zIndexClassName="z-[75]">
      <>
        <div className="flex items-start gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500">
            <Layers className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="grade-order-modal-title" className="text-base font-bold text-white">등급 순서 정하기</h3>
            <p className="text-[11px] text-white/50">어느 등급이 위인지 알아야 <span className="text-amber-200">올라간 분에게만</span> 보낼 수 있습니다</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white/70" aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" /> 등급을 불러오는 중
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4 text-center text-[12.5px] text-white/55">
              고객 정보에 등급이 아직 없습니다. 등급이 들어오면 여기에서 순서를 정할 수 있습니다.
            </div>
          ) : (
            <>
              <div className="flex gap-2 rounded-xl border border-white/10 bg-slate-950/50 p-3 text-[11.5px] leading-relaxed text-white/55">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />
                <span>
                  <strong className="text-white/80">아래가 낮은 등급, 위로 갈수록 높은 등급</strong>입니다. 초안을 매겨 뒀으니 어긋난 것만 고쳐 주세요.
                  같은 급이면 <span className="text-white/75">같은 급으로 묶기</span>를 켜면 됩니다.
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2.5 text-[11.5px] text-white/55">
                <span>등급이 아닌 값은 줄마다 <span className="text-white/75">등급 아님</span>을 켜서 빼세요.</span>
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.map((r) => ({ ...r, unranked: true })))}
                  className="ml-auto rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/60 hover:bg-white/5"
                >
                  전부 등급 아님
                </button>
              </div>

              <ol className="space-y-1.5">
                {rows.map((r, i) => (
                  <li key={r.gradeValue} className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2.5">
                    <span className="w-7 shrink-0 text-center text-[11px] tabular-nums text-white/35">
                      {payload[i]?.rankOrder ?? '—'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-white/90">{r.gradeValue}</div>
                      <div className="text-[10.5px] text-white/40">{r.customerCount.toLocaleString()}명</div>
                    </div>
                    <label className="flex shrink-0 items-center gap-1 text-[10.5px] text-white/45">
                      <input
                        type="checkbox"
                        checked={r.unranked}
                        onChange={(e) =>
                          setRows((prev) => prev.map((x, xi) => (xi === i ? { ...x, unranked: e.target.checked, sameAsPrev: false } : x)))
                        }
                        className="h-3 w-3 rounded border-white/20 bg-slate-950"
                      />
                      등급 아님
                    </label>
                    {i > 0 && !r.unranked && (
                      <label className="flex shrink-0 items-center gap-1 text-[10.5px] text-white/45">
                        <input
                          type="checkbox"
                          checked={r.sameAsPrev}
                          onChange={(e) =>
                            setRows((prev) => prev.map((x, xi) => (xi === i ? { ...x, sameAsPrev: e.target.checked } : x)))
                          }
                          className="h-3 w-3 rounded border-white/20 bg-slate-950"
                        />
                        위와 같은 급
                      </label>
                    )}
                    <div className="flex shrink-0 flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        aria-label={`${r.gradeValue} 한 칸 위로`}
                        className="rounded border border-white/10 p-1 text-white/50 transition-colors hover:bg-white/10 disabled:opacity-20"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === rows.length - 1}
                        aria-label={`${r.gradeValue} 한 칸 아래로`}
                        className="rounded border border-white/10 p-1 text-white/50 transition-colors hover:bg-white/10 disabled:opacity-20"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-[10px] italic text-white/30">Data source — 회사 고객 데이터에 실제로 있는 등급 값과 인원수</p>
            </>
          )}

          {error && <p className="text-[11.5px] text-rose-200/85">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-slate-900/95 px-5 py-3.5">
          <span className="text-[11px] text-white/45">
            {rankedCount === 0
              ? '순서 없음으로 저장합니다 (등급 여정은 잠긴 채로 둡니다)'
              : rankedCount < 2
                ? '한 급뿐이라 올라갈 자리가 없어요 — 등급 여정은 잠긴 채로 둡니다'
                : `${rankedCount}단계로 저장합니다`}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={saving || loading || rows.length === 0}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-slate-900 transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            이 순서로 저장
          </button>
        </div>
      </>
    </JourneyModalShell>
  );
}
