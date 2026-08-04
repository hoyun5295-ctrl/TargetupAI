/**
 * ★ 2026-07-30 최소과금 관리 모달 (서수란 접수 · Harold 확정)
 *
 * "금액이 너무 안 나오는 업체"를 등록해두면 일괄발급 담기에서 자동으로 빠지고,
 * 여기서 대상월을 골라 [일괄 발행]하면 회사마다 기본요금 정액 청구서(공급가+VAT)가 생성된다.
 * 이후 메일·컨펌·세금계산서는 기존 정산 흐름 그대로.
 *
 * 안전핀(서버): 그 달 실사용 공급가가 최소과금을 넘으면 발행 거부(일반 발행 안내) ·
 * 단가 미설정/요금제 회사/080 항목 있는 달 = 거부 · 겹침·수동완료 409. 결과에 사유가 그대로 표시된다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
// ★ 2026-08-04 회사 선택을 타이핑 검색으로 (서수란 접수) — 141개사를 스크롤로 찾게 두면 매달 그 짓을 한다.
//   080 매핑·부가서비스 입력 탭이 이미 쓰는 컴포넌트와 같은 것을 쓴다.
import SearchableSelect from './SearchableSelect';

interface CompanyOpt { id: string; company_name: string }
interface MinChargeRow { company_id: string; company_name: string; min_charge_supply: number; billed_id: string | null }

const won = (n: number) => `₩${Number(n || 0).toLocaleString()}`;
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });
const prevMonth = () => {
  // ★ setDate(1) 선행(Codex 수용) — 7/31에서 한 달을 빼면 "6/31"이 7/1로 보정돼 전월이 아니라 당월이 나온다.
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function MinimumChargeModal({ open, onClose, companies, onChanged }: {
  open: boolean;
  onClose: () => void;
  companies: CompanyOpt[];
  /** 등록/해제 후 호출 — 일괄발급 목록의 뱃지·담기 제외를 갱신하도록 부모에 알린다 */
  onChanged?: () => void;
}) {
  const [month, setMonth] = useState(prevMonth());
  const [rows, setRows] = useState<MinChargeRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [addCompany, setAddCompany] = useState('');
  const [addAmount, setAddAmount] = useState(50000);
  const [saving, setSaving] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [result, setResult] = useState<{ issued: any[]; skipped: any[] } | null>(null);
  const [removeAsk, setRemoveAsk] = useState<string | null>(null); // 2단 클릭 확인 (native dialog 금지)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/billing/minimum-charge?month=${m}`, { headers: auth() });
      const d = await r.json();
      if (d.success) setRows(d.companies || []);
      else say(d.error || '목록 조회 실패', 'error');
    } catch { say('목록 조회 실패', 'error'); } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) { setResult(null); load(month); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (companyId: string, amount: number | null) => {
    setSaving(true);
    try {
      const r = await fetch('/api/admin/billing/minimum-charge', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ company_id: companyId, min_charge_supply: amount }),
      });
      const d = await r.json();
      if (d.success) {
        say(amount == null ? '해제했습니다 — 일괄발급 대상으로 돌아갑니다.' : '저장했습니다.');
        setRemoveAsk(null); setAddCompany('');
        load(month);
        onChanged?.();
      } else say(d.error || '저장 실패', 'error');
    } catch { say('저장 실패', 'error'); } finally { setSaving(false); }
  };

  const issueAll = async () => {
    setIssuing(true); setResult(null);
    try {
      const r = await fetch('/api/admin/billing/minimum-charge/issue', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ month }),
      });
      const d = await r.json();
      if (d.success) {
        setResult({ issued: d.issued || [], skipped: d.skipped || [] });
        say(`${(d.issued || []).length}개사 발행 완료`);
        load(month);
      } else say(d.error || '발행 실패', 'error');
    } catch { say('발행 실패', 'error'); } finally { setIssuing(false); }
  };

  if (!open) return null;
  const registeredIds = new Set((rows || []).map((r) => r.company_id));
  const unbilledCount = (rows || []).filter((r) => !r.billed_id).length;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h3 className="text-base font-semibold text-gray-800">최소과금 관리</h3>
            <p className="text-xs text-gray-500 mt-0.5">등록 회사는 일괄발급에서 빠지고, 여기서 기본요금 정액 청구서를 발행합니다. 금액은 공급가 기준(VAT는 자동 가산).</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400" aria-label="닫기">✕</button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          {/* 등록 */}
          <div className="border rounded-lg p-4 bg-gray-50 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[11px] text-gray-500 mb-1">회사</label>
              <SearchableSelect
                options={companies.filter((c) => !registeredIds.has(c.id)).map((c) => ({ value: c.id, label: c.company_name }))}
                value={addCompany}
                onChange={setAddCompany}
                placeholder="회사명을 입력해 검색"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">최소과금 (공급가)</label>
              <input type="number" min={1} value={addAmount}
                onChange={(e) => setAddAmount(Math.max(1, Math.floor(Number(e.target.value) || 0)))}
                className="w-40 px-3 py-2 border rounded-lg text-sm" />
              <div className="text-[10px] text-gray-400 mt-0.5">VAT 포함 {won(Math.round(addAmount * 1.1))}</div>
            </div>
            <button onClick={() => addCompany && save(addCompany, addAmount)} disabled={saving || !addCompany}
              className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
              등록
            </button>
          </div>

          {/* 목록 + 발행 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setResult(null); load(e.target.value); }}
                className="px-3 py-2 border rounded-lg text-sm" />
              <span className="text-xs text-gray-500">{loading ? '조회 중...' : rows ? `등록 ${rows.length}개사 · 이 달 미발행 ${unbilledCount}개사` : ''}</span>
            </div>
            <button onClick={issueAll} disabled={issuing || !rows || unbilledCount === 0}
              className="px-5 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
              {issuing ? '발행 중...' : `${month}월 기본요금 일괄 발행`}
            </button>
          </div>

          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[11px] text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">회사</th>
                  <th className="px-3 py-2 text-right">기본요금 (공급가)</th>
                  <th className="px-3 py-2 text-right">VAT 포함</th>
                  <th className="px-3 py-2 text-center">{month}월 발행</th>
                  <th className="px-3 py-2 text-right">관리</th>
                </tr>
              </thead>
              <tbody>
                {(rows || []).length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">{loading ? '불러오는 중...' : '등록된 회사가 없습니다 — 위에서 등록해주세요.'}</td></tr>
                ) : (rows || []).map((r) => (
                  <tr key={r.company_id} className="border-t">
                    <td className="px-3 py-2">{r.company_name}</td>
                    <td className="px-3 py-2 text-right">{won(Number(r.min_charge_supply))}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{won(Math.round(Number(r.min_charge_supply) * 1.1))}</td>
                    <td className="px-3 py-2 text-center">
                      {r.billed_id
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">발행됨</span>
                        : <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">미발행</span>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {removeAsk === r.company_id ? (
                        <>
                          <button onClick={() => save(r.company_id, null)} className="text-red-600 font-medium text-xs mr-2">정말 해제</button>
                          <button onClick={() => setRemoveAsk(null)} className="text-gray-500 text-xs">취소</button>
                        </>
                      ) : (
                        <button onClick={() => setRemoveAsk(r.company_id)} className="text-gray-400 hover:text-red-600 text-xs">해제</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result && (
            <div className="border rounded-lg px-4 py-3 text-sm space-y-1.5">
              <div className="font-medium text-gray-700">발행 결과</div>
              {result.issued.map((a: any) => (
                <div key={a.company_id} className="text-emerald-700 text-xs">{a.company_name} — 합계 {won(Number(a.total_amount))} 발행</div>
              ))}
              {result.skipped.map((s: any, i: number) => (
                <div key={i} className="text-amber-700 text-xs">{s.company_name} — {s.reason}</div>
              ))}
              {result.issued.length > 0 && (
                <div className="text-[11px] text-gray-400 pt-1">발행분 메일 발송·컨펌은 정산 목록의 기존 흐름(메일 재시도 버튼)으로 진행됩니다.</div>
              )}
            </div>
          )}
        </div>

        {toast && (
          <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm text-white shadow-lg ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
            {toast.msg}
          </div>
        )}
      </div>
    </div>
  );
}
