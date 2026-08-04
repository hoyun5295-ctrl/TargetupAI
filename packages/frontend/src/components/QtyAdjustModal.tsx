/**
 * ★ 2026-08-04 수량 수정 발행 모달 (서수란 접수 — "정산서 발송 후 업체와 수량이 다를 경우")
 *
 * 업체가 "우리 집계는 9,435건인데 청구는 9,438건"이라고 하면 여기서 **실제 수량을 그대로 적는다.**
 * 델타(−3)는 서버가 준 `base`(조정 전 원래 수량)로 화면이 계산한다 — 사람에게 뺄셈을 시키지 않는다.
 *
 * 조정은 회사×기간×유형 축이라 정산을 지우고 다시 발행해도 살아남는다.
 * 그래서 [수정 재발행]은 삭제 → 재발행 두 단계이고, 조정은 그대로 다시 실린다.
 *
 * native dialog 0 — 확인은 2단 클릭.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface AdjLine {
  channel: string;
  type_key: string;
  label: string;
  unit_price: number;
  /** 지금 청구서에 인쇄된 수량(조정이 이미 반영된 값) */
  count: number;
  amount: number;
  /** 이 줄에 걸린 조정 합(저장된 값 — 아직 청구서에 안 실렸을 수 있다) */
  delta: number;
  /** 조정 전 원래 수량 — **이 청구서에 실제로 실린 델타만** 뺀 값이다(서버 계산) */
  base: number;
  /** 같은 유형에 단가가 여러 개면 조정 키가 어느 줄인지 정해지지 않아 잠근다 */
  adjustable?: boolean;
  not_adjustable_reason?: string | null;
}

export interface QtyAdjustTarget {
  id: string;
  companyName: string;
  scope?: string | null;
  accountName?: string | null;
}

const won = (n: number) => `₩${Number(n || 0).toLocaleString()}`;
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });

export default function QtyAdjustModal({ open, target, onClose, onReissued }: {
  open: boolean;
  target: QtyAdjustTarget | null;
  onClose: () => void;
  /** 재발행이 끝나면 목록을 갱신하도록 부모에 알린다 */
  onReissued?: () => void;
}) {
  const [lines, setLines] = useState<AdjLine[] | null>(null);
  const [period, setPeriod] = useState<{ start: string; end: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [reissueAsk, setReissueAsk] = useState(false);
  const [reissuing, setReissuing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadSeq = useRef(0);
  /** 지금 화면에 실린 값이 어느 장의 것인가 — 저장 직전에 현재 대상과 대조한다. */
  const loadedForRef = useRef<string | null>(null);
  const say = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };

  const keyOf = (l: AdjLine) => `${l.channel} ${l.type_key}`;

  /**
   * ★ 2026-08-04 요청 세대 + 대상 대조(Codex 재검증 high).
   *   A 장 조회가 느린 동안 B 장을 열면, 늦게 도착한 A 응답이 화면을 덮어쓰고 그 뒤 저장이
   *   **A의 항목을 B 정산으로** 보낸다 — 다른 회사 청구서가 바뀐다.
   */
  const load = useCallback(async (billingId: string) => {
    const seq = ++loadSeq.current;
    loadedForRef.current = billingId;
    setLoading(true);
    // 실패했을 때 옛 장의 값이 화면에 남으면 다른 정산을 보면서 이 정산을 고치게 된다.
    setLines(null); setPeriod(null); setDraft({}); setReason({});
    try {
      const r = await fetch(`/api/admin/billing/${billingId}/qty-adjustments`, { headers: auth() });
      const d = await r.json();
      if (seq !== loadSeq.current) return; // 늦게 온 옛 응답은 버린다
      if (d.success) {
        setLines(d.lines || []);
        setPeriod(d.period || null);
        const nextDraft: Record<string, string> = {};
        const nextReason: Record<string, string> = {};
        for (const l of (d.lines || []) as AdjLine[]) {
          nextDraft[`${l.channel} ${l.type_key}`] = String(l.count);
        }
        for (const a of (d.adjustments || []) as any[]) {
          nextReason[`${a.channel} ${a.type_key}`] = String(a.reason || '');
        }
        setDraft(nextDraft);
        setReason(nextReason);
      } else say(d.error || '조회 실패', 'error');
    } catch { if (seq === loadSeq.current) say('조회 실패', 'error'); } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && target) { setReissueAsk(false); load(target.id); }
  }, [open, target, load]);

  if (!open || !target) return null;

  const saveOne = async (l: AdjLine) => {
    // 화면에 실린 값이 지금 대상의 것이 아니면 저장하지 않는다 — 다른 회사 정산이 바뀐다.
    if (loadedForRef.current !== target.id) { say('화면이 다른 정산 기준입니다. 다시 열어주세요.', 'error'); return; }
    const k = keyOf(l);
    const typed = Math.round(Number(draft[k]));
    if (!Number.isSafeInteger(typed) || typed < 0) { say('실제 수량을 0 이상 정수로 입력해주세요.', 'error'); return; }
    const nextDelta = typed - l.base;
    const why = (reason[k] || '').trim();
    if (nextDelta !== 0 && why.length < 2) { say('조정 사유를 적어주세요 — 왜 고쳤는지가 없으면 다음 달에 알 수 없습니다.', 'error'); return; }
    setSaving(k);
    try {
      if (nextDelta === 0) {
        // 원래 수량으로 되돌렸다 = 조정 삭제. 서버는 0 델타를 저장하지 않는다.
        const cur = (lines || []).find((x) => keyOf(x) === k);
        if (!cur || cur.delta === 0) { say('바뀐 내용이 없습니다.'); return; }
        const list = await fetch(`/api/admin/billing/${target.id}/qty-adjustments`, { headers: auth() });
        const ld = await list.json();
        const hit = (ld.adjustments || []).find((a: any) => a.channel === l.channel && a.type_key === l.type_key);
        if (hit) {
          const dr = await fetch(`/api/admin/billing/qty-adjustments/${hit.id}`, { method: 'DELETE', headers: auth() });
          const dd = await dr.json();
          if (!dd.success) { say(dd.error || '조정 삭제 실패', 'error'); return; }
        }
        say('조정을 지웠습니다. 수정 재발행하면 원래 수량으로 나갑니다.');
        load(target.id);
        return;
      }
      const r = await fetch(`/api/admin/billing/${target.id}/qty-adjustments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ channel: l.channel, type_key: l.type_key, qty_delta: nextDelta, reason: why }),
      });
      const d = await r.json();
      if (d.success) { say(`저장했습니다 — ${l.label} ${l.base.toLocaleString()}건 → ${typed.toLocaleString()}건. 수정 재발행하면 반영됩니다.`); load(target.id); }
      else say(d.error || '저장 실패', 'error');
    } catch { say('저장 실패', 'error'); } finally { setSaving(null); }
  };

  /**
   * 수정 재발행 — **서버가 한 요청 안에서** 삭제하고 다시 발행한다.
   * 화면이 삭제·발행을 따로 부르면 사이의 어떤 실패도 "정산만 사라진 상태"를 남기고,
   * 조회가 실패해 남아 있던 옛 회사·기간으로 발행할 여지도 있었다(Codex 적대검증 critical).
   * 회사·기간·발행 단위는 서버가 잠근 행에서 다시 구한다 — 화면은 장 id만 넘긴다.
   */
  const reissue = async () => {
    setReissuing(true);
    try {
      const r = await fetch(`/api/admin/billing/${target.id}/reissue`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ reason: '수량 정정 후 수정 재발행' }),
      });
      const d = await r.json();
      if (!d.success) {
        say(d.error || '수정 재발행 실패', 'error');
        // 삭제까지는 끝난 경우 — 목록을 갱신해 사라진 정산이 화면에 남지 않게 한다.
        if (d.deleted) { onReissued?.(); onClose(); }
        return;
      }
      say('수정 재발행을 마쳤습니다. 새 정산서를 발송하면 새 컨펌 메일이 나갑니다.');
      setReissueAsk(false);
      onReissued?.();
      onClose();
    } catch { say('수정 재발행 실패', 'error'); } finally { setReissuing(false); }
  };

  const changed = (lines || []).filter((l) => {
    const typed = Math.round(Number(draft[keyOf(l)]));
    return Number.isSafeInteger(typed) && typed !== l.count;
  }).length;
  const adjusted = (lines || []).filter((l) => l.delta !== 0).length;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h3 className="text-base font-semibold text-gray-800">수량 수정 발행</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {target.companyName}{target.accountName ? ` · ${target.accountName}` : ''}
              {period ? ` · ${period.start} ~ ${period.end}` : ''}
              {' — '}업체와 맞춘 <b>실제 수량</b>을 적으면 청구서가 그 수량으로 나갑니다. 발송 실적 자체는 바뀌지 않습니다.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400" aria-label="닫기">✕</button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[11px] text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">항목</th>
                  <th className="px-3 py-2 text-right">원래 수량</th>
                  <th className="px-3 py-2 text-right">단가</th>
                  <th className="px-3 py-2 text-right">실제 수량</th>
                  <th className="px-3 py-2 text-left">조정 사유</th>
                  <th className="px-3 py-2 text-right">저장</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">불러오는 중...</td></tr>
                ) : (lines || []).length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">수량으로 청구된 항목이 없습니다.</td></tr>
                ) : (lines || []).map((l) => {
                  const k = keyOf(l);
                  const typed = Math.round(Number(draft[k]));
                  const dirty = Number.isSafeInteger(typed) && typed !== l.count;
                  return (
                    <tr key={k} className="border-t align-top">
                      <td className="px-3 py-2">
                        {l.label}
                        {l.delta !== 0 && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-violet-50 border border-violet-200 text-violet-700">
                            조정 {l.delta > 0 ? '+' : ''}{l.delta.toLocaleString()}건 적용 중
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500">{l.base.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{won(l.unit_price)}</td>
                      <td className="px-3 py-2 text-right">
                        <input type="number" min={0} value={draft[k] ?? ''} disabled={l.adjustable === false}
                          onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                          className={`w-28 px-2 py-1.5 border rounded-lg text-sm text-right disabled:bg-gray-100 disabled:text-gray-400 ${dirty ? 'border-violet-400 bg-violet-50' : ''}`} />
                        {dirty && (
                          <div className="text-[10px] text-violet-600 mt-0.5">
                            {typed - l.base > 0 ? '+' : ''}{(typed - l.base).toLocaleString()}건 · {won((typed - l.base) * l.unit_price)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input value={reason[k] ?? ''} onChange={(e) => setReason({ ...reason, [k]: e.target.value })}
                          placeholder="예: 업체 수량체크 결과 반영" maxLength={200}
                          className="w-full min-w-[180px] px-2 py-1.5 border rounded-lg text-sm" />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {l.adjustable === false && (
                          <div className="text-[10px] text-amber-600 mb-1 max-w-[160px] ml-auto text-left">{l.not_adjustable_reason}</div>
                        )}
                        <button onClick={() => saveOne(l)} disabled={saving === k || !dirty || l.adjustable === false}
                          className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-medium hover:bg-violet-700 disabled:opacity-40">
                          {saving === k ? '저장 중...' : '저장'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border rounded-lg px-4 py-3 bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-gray-600">
              {changed > 0
                ? `저장하지 않은 변경 ${changed}건이 있습니다 — 줄마다 [저장]을 눌러야 조정으로 기록됩니다.`
                : adjusted > 0
                  ? `조정 ${adjusted}건이 기록돼 있습니다. 수정 재발행하면 그 수량으로 청구서가 다시 만들어집니다.`
                  : '조정이 없습니다. 실제 수량을 고친 뒤 저장해주세요.'}
            </div>
            {reissueAsk ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-red-600">지금 정산서를 지우고 다시 만듭니다</span>
                <button onClick={reissue} disabled={reissuing}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                  {reissuing ? '재발행 중...' : '정말 재발행'}
                </button>
                <button onClick={() => setReissueAsk(false)} className="text-xs text-gray-500">취소</button>
              </div>
            ) : (
              <button onClick={() => setReissueAsk(true)} disabled={adjusted === 0 || changed > 0}
                className="px-5 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-40">
                수정 재발행
              </button>
            )}
          </div>

          <p className="text-[11px] text-gray-400">
            수정 재발행은 이 정산서를 삭제하고 같은 기간으로 다시 발행합니다. 조정은 회사·기간에 붙어 있어 재발행에도 그대로 반영됩니다.
            이미 세금계산서가 발행된 건은 여기서 고칠 수 없습니다 — 수정세금계산서 경로로 진행해주세요.
          </p>
        </div>

        {toast && (
          <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm text-white shadow-lg max-w-[90%] text-center ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
            {toast.msg}
          </div>
        )}
      </div>
    </div>
  );
}
