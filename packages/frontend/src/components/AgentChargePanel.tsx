import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * ★ 2026-07-24 §5-3 — 에이전트 충전 실행 패널 (슈퍼관리자 · 충전 관리 탭)
 * 62 pay-ingest-db RSRM_FillAmtHist에 'N' 행을 등록하면 게이트웨이 엔진이 잔액을 증액한다.
 * 성공 표시는 반영 폴링(applied=true, RsApplyFlag='Y')만 근거 — 등록 직후는 "반영 대기"(6원칙 ②).
 * 음수 = 상계(차감). 웹 잔액(balance)과는 별개 지갑.
 */

interface Target { company_id: string; company_name: string; agent_send_id: string; billing_type?: string | null }
interface ChargeFormRow { agentSendId: string; amount: string }
interface RegisteredRow { seqNo: number; agentSendId: string; amount: number; applied: boolean; appliedAt?: string | null }
interface HistoryRow { seqNo: number; agentSendId: string; amount: number; filledAt: string; applied: boolean; appliedAt: string | null; companyName: string | null }

// 금액 입력 정제 — 선행 '-' 하나 + 숫자 + 점 하나만 허용
const sanitizeAmountInput = (v: string) => {
  let c = v.replace(/[^0-9.-]/g, '');
  const neg = c.startsWith('-');
  c = c.replace(/-/g, '');
  const i = c.indexOf('.');
  if (i !== -1) c = c.slice(0, i + 1) + c.slice(i + 1).replace(/\./g, '');
  return (neg ? '-' : '') + c;
};

const MAX_POLLS = 36; // 5초 × 36 = 3분

export default function AgentChargePanel() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [companyFilter, setCompanyFilter] = useState('');
  const [rows, setRows] = useState<ChargeFormRow[]>([{ agentSendId: '', amount: '' }]);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [registered, setRegistered] = useState<RegisteredRow[]>([]);
  const [pollNote, setPollNote] = useState('');
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCount = useRef(0);
  // 멱등키 — 네트워크 오류(응답 유실)로 재시도해도 같은 키 재전송 = 서버가 중복 충전 차단 (Codex 7R-1).
  //   키는 페이로드에 바인딩 — 재시도 전에 금액/사유를 고치면 새 키 발급(다른 요청이므로, Codex 8R-1c)
  const pendingKeyRef = useRef<{ key: string; payload: string } | null>(null);
  // 배치 격리 — 연속 등록 시 이전 배치의 늦은 콜백이 새 배치 상태를 못 건드리게 (Codex 7R-4)
  const pollBatchRef = useRef(0);
  const currentPollReqRef = useRef<string | null>(null);
  // 반영 불확실 잠금 — 이력 확인 전 재등록 차단. 진짜 게이트는 서버(409 UNCERTAIN_PENDING)이고
  // 이 상태는 즉시 UX용. 해소는 서버 resolve 호출로만 가능 (Codex 9R-1a·10R-1a)
  const [uncertainHold, setUncertainHold] = useState(false);
  const [uncertainList, setUncertainList] = useState<{ id: string; reason: string; abs_total: any; created_at: string }[]>([]);
  const [resolveNote, setResolveNote] = useState('');

  const token = () => localStorage.getItem('token');

  const loadTargets = async () => {
    try {
      const res = await fetch('/api/admin/agent-charges/targets', { headers: { Authorization: `Bearer ${token()}` } });
      if (res.ok) {
        const d = await res.json();
        setTargets(Array.isArray(d.targets) ? d.targets : []);
      }
    } catch { /* 대상 로드 실패 시 빈 목록 유지 */ }
  };

  const loadHistory = async () => {
    try {
      const res = await fetch('/api/admin/agent-charges?limit=30', { headers: { Authorization: `Bearer ${token()}` } });
      if (res.ok) {
        const d = await res.json();
        setHistory(Array.isArray(d.rows) ? d.rows : []);
      }
    } catch { /* 이력 로드 실패 시 기존 유지 */ }
  };

  useEffect(() => {
    loadTargets();
    loadHistory();
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  }, []);

  const companies = useMemo(() => {
    const m = new Map<string, string>();
    targets.forEach((t) => m.set(t.company_id, t.company_name));
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }));
  }, [targets]);

  const idOptions = useMemo(
    () => (companyFilter ? targets.filter((t) => t.company_id === companyFilter) : targets),
    [targets, companyFilter]
  );

  const stopPolling = () => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
  };

  const startPolling = (requestId: string, seqNos: number[]) => {
    stopPolling();
    const myBatch = ++pollBatchRef.current;
    currentPollReqRef.current = requestId;
    pollCount.current = 0;
    setPollNote('반영 대기 중 — 엔진 주기(약 1분) 확인 중입니다.');
    pollTimer.current = setInterval(async () => {
      pollCount.current += 1;
      try {
        // seqNos 동봉 = 확정 기록 유실 시 서버 자가 복구 경로(Codex 9R-1b)
        const res = await fetch(`/api/admin/agent-charges/status?requestId=${encodeURIComponent(requestId)}&seqNos=${seqNos.join(',')}`, { headers: { Authorization: `Bearer ${token()}` } });
        if (pollBatchRef.current !== myBatch) return; // 이전 배치의 늦은 콜백 — 무시
        if (res.ok) {
          const d = await res.json();
          const byNo = new Map<number, any>((d.rows || []).map((r: any) => [Number(r.seqNo), r]));
          setRegistered((prev) => prev.map((r) => {
            const s = byNo.get(r.seqNo);
            return s ? { ...r, applied: !!s.applied, appliedAt: s.appliedAt || null } : r;
          }));
          const allApplied = seqNos.every((n) => byNo.get(n)?.applied);
          if (allApplied) {
            stopPolling();
            setPollNote('전건 반영 완료.');
            loadHistory();
            return;
          }
        }
      } catch { /* 일시 오류 — 다음 주기 재시도 */ }
      if (pollBatchRef.current !== myBatch) return;
      if (pollCount.current >= MAX_POLLS) {
        stopPolling();
        setPollNote('3분 내 반영 확인 실패 — 성공 아님. 잠시 후 이력에서 상태를 재확인하고, 계속 N이면 수집 엔진 점검이 필요합니다.');
      }
    }, 5000);
  };

  const handleSubmit = async () => {
    setErrorMsg('');
    if (uncertainHold) {
      setErrorMsg('반영 불확실 건이 있습니다 — 이력 확인 후 잠금을 해제해야 등록할 수 있습니다.');
      return;
    }
    const cleaned = rows
      .map((r) => ({ agentSendId: r.agentSendId.trim(), amount: r.amount.trim() }))
      .filter((r) => r.agentSendId || r.amount);
    if (cleaned.length === 0) { setErrorMsg('입력된 행이 없습니다.'); return; }
    for (const r of cleaned) {
      if (!r.agentSendId) { setErrorMsg('발송ID를 선택하지 않은 행이 있습니다.'); return; }
      const n = Number(r.amount);
      if (!r.amount || r.amount === '-' || r.amount === '.' || !Number.isFinite(n) || n === 0) {
        setErrorMsg(`금액이 올바르지 않습니다. (${r.agentSendId})`);
        return;
      }
    }
    if (!reason.trim()) { setErrorMsg('충전 사유를 입력하세요. (예: 7월 선불 충전 — 계좌이체 확인)'); return; }
    setSubmitting(true);
    // 네트워크 오류 재시도에만 같은 키 재사용(같은 페이로드 한정) — 서버 응답을 받은 뒤에는 항상 새 키
    const payload = {
      reason: reason.trim(),
      charges: cleaned.map((r) => ({ agentSendId: r.agentSendId, amount: Number(r.amount) })),
    };
    const payloadJson = JSON.stringify(payload);
    const idempotencyKey =
      pendingKeyRef.current && pendingKeyRef.current.payload === payloadJson
        ? pendingKeyRef.current.key
        : crypto.randomUUID();
    pendingKeyRef.current = { key: idempotencyKey, payload: payloadJson };
    try {
      const res = await fetch('/api/admin/agent-charges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ idempotencyKey, ...payload }),
      });
      const d = await res.json();
      if (!res.ok) {
        if (d.uncertain) {
          // 키 유지 + 폼 잠금(Codex 9R-1a) — 서버에도 uncertain 게이트가 걸려 어떤 경로로도 신규 충전 불가.
          // 방금 요청 정보로 해소 UI를 즉시 구성(Codex 10R-1a)
          setUncertainHold(true);
          if (d.requestId) {
            setUncertainList([{ id: String(d.requestId), reason: payload.reason, abs_total: payload.charges.reduce((s, c) => s + Math.abs(c.amount), 0), created_at: new Date().toISOString() }]);
          }
          setErrorMsg(d.error || '반영 여부 불확실');
          setPollNote('반영 여부 불확실 — 아래 이력에서 해당 발송ID의 최신 행을 확인한 뒤 해소 처리하세요.');
          loadHistory();
        } else if (res.status === 409 && d.code === 'UNCERTAIN_PENDING') {
          // 서버 전역 게이트 — 미해소 불확실 건 목록 표시(다른 세션/탭에서 발생한 건 포함)
          pendingKeyRef.current = null;
          setUncertainHold(true);
          setUncertainList(Array.isArray(d.uncertainRequests) ? d.uncertainRequests.map((u: any) => ({ id: String(u.id), reason: String(u.reason || ''), abs_total: u.abs_total, created_at: String(u.created_at || '') })) : []);
          setErrorMsg(d.error || '반영 불확실 건 해소가 필요합니다.');
          loadHistory();
        } else {
          pendingKeyRef.current = null; // 명확한 거부 응답 — 키 소진
          setErrorMsg(d.error || '충전 등록 실패');
        }
      } else {
        pendingKeyRef.current = null; // 접수 확정 — 키 소진 (예약이 남아 같은 키 재전송은 서버가 차단)
        const reg: RegisteredRow[] = (d.registered || []).filter((r: any) => Number.isInteger(r?.seqNo));
        setRows([{ agentSendId: '', amount: '' }]);
        setReason('');
        if (d.duplicated) {
          // 이미 접수된 요청 — 반영 확인이 안 끝났을 수 있으니 폴링 재개(Codex 8R-4).
          // 단 다른 배치가 확인 중이면 그 폴러를 뺏지 않는다(Codex 9R-4 — 이력에서 확인 안내).
          if (d.requestId && reg.length > 0) {
            if (pollTimer.current && currentPollReqRef.current && currentPollReqRef.current !== String(d.requestId)) {
              setPollNote('다른 배치의 반영 확인이 진행 중 — 이 요청은 중복 충전이 차단됐고, 상태는 아래 이력에서 확인하세요.');
            } else {
              setRegistered(reg);
              startPolling(String(d.requestId), reg.map((r) => r.seqNo));
              setPollNote('이미 접수된 요청 — 중복 충전은 차단됐고, 반영 상태를 이어서 확인합니다.');
            }
          } else {
            setPollNote('이미 접수된 요청입니다(중복 충전 차단) — 아래 이력에서 상태를 확인하세요.');
          }
        } else if (d.requestId && reg.length > 0) {
          setRegistered(reg);
          startPolling(String(d.requestId), reg.map((r) => r.seqNo));
        }
        loadHistory();
      }
    } catch {
      // 응답 유실 — 키 유지: 같은 입력으로 다시 등록하면 같은 키로 재시도돼 중복 충전이 차단된다
      setErrorMsg('네트워크 오류 — 입력을 바꾸지 말고 다시 등록을 누르면 같은 요청으로 재시도합니다(중복 충전 없음).');
    } finally {
      setSubmitting(false);
    }
  };

  // 불확실 해소 — 서버 전역 게이트의 유일한 해제 경로 (이력에서 실반영 여부 확인 후 확정). 사유 필수.
  const resolveUncertain = async (id: string, outcome: 'confirmed' | 'not_applied') => {
    const note = resolveNote.trim();
    if (!note) { setErrorMsg('해소 사유를 입력하세요. (감사 기록에 남습니다)'); return; }
    try {
      const res = await fetch(`/api/admin/agent-charges/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ outcome, note }),
      });
      const d = await res.json();
      if (!res.ok) {
        setErrorMsg(d.error || '해소 처리 실패');
        return;
      }
      setResolveNote('');
      setUncertainList((prev) => {
        const next = prev.filter((u) => u.id !== id);
        if (next.length === 0) {
          setUncertainHold(false);
          setErrorMsg('');
          setPollNote('');
        }
        return next;
      });
      loadHistory();
    } catch {
      setErrorMsg('네트워크 오류 — 해소 처리를 다시 시도하세요.');
    }
  };

  const targetLabel = (t: Target) =>
    `${t.agent_send_id} — ${t.company_name}${t.billing_type === 'prepaid' ? ' · 선불' : ''}`;

  return (
    <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
      <div className="px-6 py-4 border-b">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">에이전트 충전 실행</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              발송ID(게이트웨이) 지갑 충전 — 음수 입력 = 상계 차감. 반영 완료 표시 전까지는 성공이 아닙니다.
            </p>
          </div>
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="">전체 회사</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="px-6 py-4 space-y-2">
        {rows.map((r, idx) => (
          <div key={idx} className="flex gap-2">
            <select
              value={r.agentSendId}
              onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, agentSendId: e.target.value } : x)))}
              className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">발송ID 선택</option>
              {idOptions.map((t) => (
                <option key={`${t.agent_send_id}`} value={t.agent_send_id}>{targetLabel(t)}</option>
              ))}
            </select>
            <input
              type="text"
              value={r.amount}
              onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, amount: sanitizeAmountInput(e.target.value) } : x)))}
              className="w-40 px-3 py-2 border rounded-lg text-sm text-right tabular-nums focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="금액 (음수=차감)"
            />
            <button
              type="button"
              onClick={() => setRows(rows.length === 1 ? [{ agentSendId: '', amount: '' }] : rows.filter((_, i) => i !== idx))}
              className="px-2.5 py-2 text-gray-400 hover:text-red-500 text-sm shrink-0"
            >
              제거
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => rows.length < 50 && setRows([...rows, { agentSendId: '', amount: '' }])}
            className="text-sm text-blue-600 hover:text-blue-800 shrink-0"
          >
            + 행 추가
          </button>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 200))}
            className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="충전 사유 (필수 — 감사 기록에 남습니다)"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || uncertainHold}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition-colors shrink-0"
          >
            {submitting ? '등록 중...' : uncertainHold ? '확인 대기' : '충전 등록'}
          </button>
        </div>
        {errorMsg && <p className="text-sm text-red-500">{errorMsg}</p>}
        {uncertainHold && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-1.5">
            <p className="text-xs text-amber-700">
              반영 불확실 건 해소 전 — 등록이 잠겨 있습니다(서버 차단). 아래 이력에서 해당 발송ID 최신 행의 실반영 여부를 확인한 뒤 확정하세요.
            </p>
            <input
              type="text"
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value.slice(0, 200))}
              className="w-full px-2.5 py-1.5 border border-amber-200 rounded-lg text-xs focus:ring-2 focus:ring-amber-400 outline-none"
              placeholder="해소 사유 (필수 — 예: 이력에서 SeqNo 확인·실반영됨)"
            />
            {uncertainList.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white border border-amber-100 px-2.5 py-1.5">
                <span className="text-xs text-gray-600">
                  절대합 {Number(u.abs_total || 0).toLocaleString()}원 · {u.reason || '(사유 없음)'}
                </span>
                <span className="flex gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => resolveUncertain(u.id, 'confirmed')}
                    className="px-2.5 py-1 text-xs border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50"
                  >
                    실반영 확인됨
                  </button>
                  <button
                    type="button"
                    onClick={() => resolveUncertain(u.id, 'not_applied')}
                    className="px-2.5 py-1 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
                  >
                    미반영 확인됨
                  </button>
                </span>
              </div>
            ))}
            {uncertainList.length === 0 && (
              <button
                type="button"
                onClick={() => { setUncertainHold(false); setErrorMsg(''); setPollNote(''); }}
                className="px-2.5 py-1 text-xs border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-100"
              >
                이력 확인 완료 — 잠금 해제
              </button>
            )}
          </div>
        )}

        {registered.length > 0 && (
          <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
            <p className="text-xs font-medium text-gray-600 mb-1.5">이번 등록 반영 상태</p>
            <div className="space-y-1">
              {registered.map((r) => (
                <div key={r.seqNo} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 tabular-nums">#{r.seqNo} {r.agentSendId} · {r.amount.toLocaleString()}원</span>
                  {r.applied ? (
                    <span className="text-emerald-600 font-medium text-xs">반영 완료 {r.appliedAt || ''}</span>
                  ) : (
                    <span className="text-amber-600 text-xs">반영 대기</span>
                  )}
                </div>
              ))}
            </div>
            {pollNote && <p className="mt-1.5 text-[11px] text-gray-400">{pollNote}</p>}
          </div>
        )}
      </div>

      <div className="px-6 pb-5">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-gray-500">최근 충전 이력 (게이트웨이 원장)</p>
          <button type="button" onClick={loadHistory} className="text-xs text-gray-400 hover:text-gray-600">새로고침</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b">
                <th className="py-1.5 pr-3">SeqNo</th>
                <th className="py-1.5 pr-3">발송ID</th>
                <th className="py-1.5 pr-3">회사</th>
                <th className="py-1.5 pr-3 text-right">금액</th>
                <th className="py-1.5 pr-3">충전 시각</th>
                <th className="py-1.5">반영</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.seqNo} className="border-b border-gray-50">
                  <td className="py-1.5 pr-3 tabular-nums text-gray-400">{h.seqNo}</td>
                  <td className="py-1.5 pr-3 font-mono text-gray-700">{h.agentSendId}</td>
                  <td className="py-1.5 pr-3 text-gray-600">{h.companyName || <span className="text-amber-600">매핑 없음</span>}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums font-medium ${h.amount < 0 ? 'text-rose-500' : 'text-gray-800'}`}>{h.amount.toLocaleString()}</td>
                  <td className="py-1.5 pr-3 text-xs text-gray-400">{h.filledAt}</td>
                  <td className="py-1.5 text-xs">
                    {h.applied ? <span className="text-emerald-600">반영 {h.appliedAt || ''}</span> : <span className="text-amber-600">대기</span>}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={6} className="py-3 text-center text-xs text-gray-300">이력이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[10px] italic text-gray-300">Data source — 발송 게이트웨이 충전 원장 실시간 조회 (저장 없음)</p>
      </div>
    </div>
  );
}
