/**
 * ★ 2026-07-30 080 청구 관리 모달 (서수란 접수 — KT 명세서 분할 청구의 시스템화)
 *
 * 3탭: ①번호 매핑(billing_080_numbers CRUD — 손글씨 매핑 대체) ②KT 명세서 업로드(vision 판독 →
 * 코드 검산 → 사람 확인 → [반영]) ③반영 현황(월별 조회·발행 전 취소).
 *
 * 원칙:
 *  - 금액 입력·표시 = 공급가(VAT 별도) + "VAT 포함 N원" 병기(0726 부가세 기준 명시 원칙).
 *  - 판독 결과는 자동 저장하지 않는다 — 검산 통과 + 사람이 [반영]을 눌러야 청구 항목이 생긴다.
 *  - 미매핑 번호(시세이도 등 의도 보류 포함)는 보류로 표시만 하고 반영에서 빠진다.
 *  - native dialog 0 — 삭제·취소는 2단 클릭 확인.
 *
 * 슈퍼관리자 내부 도구 — AdminDashboard 라이트 톤 미러.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface CompanyOpt { id: string; company_name: string }

interface Mapping {
  id: string;
  number: string;
  display_number: string;
  company_id: string;
  company_name?: string;
  label: string | null;
  monthly_fee_supply: number;
  kt_fee_supply: number;
  charge_call_fee: boolean;
  is_active: boolean;
  memo: string | null;
}

interface ParseRow {
  number: string;
  display_number: string;
  call_fee: number;
  mapped: boolean;
  company_id?: string;
  company_name?: string;
  label?: string | null;
  monthly_fee_supply?: number;
  kt_fee_supply?: number;
  charge_call_fee?: boolean;
}

interface ParseResult {
  usage_period: string;
  count_080: number;
  total_080: number;
  valid: boolean;
  validation_errors: string[];
  rows: ParseRow[];
  /** 판독 결과 전문 — [반영]이 그대로 되보내고 서버가 서명·검산을 다시 확인한다 */
  entries: Array<{ number: string; call_fee: number; svc_fee: number; vat: number; subtotal: number }>;
  /** 서버 서명 — 검산 통과 결과에만 발급. 없으면 반영 자체가 거부된다 */
  signature: string | null;
}

interface ExtraItem {
  id: string; company_id: string; company_name: string;
  kind: string; label: string; supply_amount: number; source_ref: string | null;
  billed_billing_id: string | null;
}

const won = (n: number) => `₩${Number(n || 0).toLocaleString()}`;
const withVat = (n: number) => `${won(n)} (VAT 포함 ${won(Math.round(n * 1.1))})`;
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });
const prevMonth = () => {
  const d = new Date(); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const EMPTY_FORM = { id: '', number: '', company_id: '', label: '', monthly_fee_supply: 9000, kt_fee_supply: 4000, charge_call_fee: true, is_active: true, memo: '' };

export default function Billing080Modal({ open, onClose, companies }: {
  open: boolean;
  onClose: () => void;
  companies: CompanyOpt[];
}) {
  const [tab, setTab] = useState<'mapping' | 'upload' | 'status'>('mapping');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  // ── ① 번호 매핑 ──
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [form, setForm] = useState<typeof EMPTY_FORM>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [deleteAsk, setDeleteAsk] = useState<string | null>(null); // 2단 클릭 확인 (native dialog 금지)

  const loadMappings = useCallback(async () => {
    setMapLoading(true);
    try {
      const r = await fetch('/api/admin/billing/080-numbers', { headers: auth() });
      const d = await r.json();
      if (d.success) setMappings(d.numbers || []);
      else say(d.error || '목록 조회 실패', 'error');
    } catch { say('목록 조회 실패', 'error'); } finally { setMapLoading(false); }
  }, []);

  useEffect(() => { if (open) loadMappings(); }, [open, loadMappings]);

  const saveMapping = async () => {
    if (!form.number.trim() || !form.company_id) { say('번호와 회사를 입력해주세요.', 'error'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/admin/billing/080-numbers', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ ...form, id: form.id || undefined }),
      });
      const d = await r.json();
      if (d.success) { say(form.id ? '수정했습니다.' : '등록했습니다.'); setForm({ ...EMPTY_FORM }); loadMappings(); }
      else say(d.error || '저장 실패', 'error');
    } catch { say('저장 실패', 'error'); } finally { setSaving(false); }
  };

  const removeMapping = async (id: string) => {
    try {
      const r = await fetch(`/api/admin/billing/080-numbers/${id}`, { method: 'DELETE', headers: auth() });
      const d = await r.json();
      if (d.success) { say('삭제했습니다.'); setDeleteAsk(null); loadMappings(); }
      else say(d.error || '삭제 실패', 'error');
    } catch { say('삭제 실패', 'error'); }
  };

  // ── ② KT 명세서 업로드 ──
  const [month, setMonth] = useState(prevMonth()); // 대상월 — 기본 전월 (6월분 명세서가 7월에 온다)
  const [parsing, setParsing] = useState(false);
  const [parse, setParse] = useState<ParseResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ applied: any[]; skipped: any[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onUpload = async (f: File | null) => {
    if (!f) return;
    setParsing(true); setParse(null); setApplyResult(null);
    try {
      const fd = new FormData();
      fd.append('image', f);
      const r = await fetch('/api/admin/billing/kt-statement/parse', { method: 'POST', headers: auth(), body: fd });
      const d = await r.json();
      if (d.success) setParse(d);
      else say(d.error || '판독 실패', 'error');
    } catch { say('판독 실패', 'error'); } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const applyParse = async () => {
    if (!parse || !parse.valid || !parse.signature) return;
    if (parse.rows.filter((r) => r.mapped).length === 0) { say('반영할 매핑된 번호가 없습니다.', 'error'); return; }
    setApplying(true);
    try {
      // ★ 판독 결과 전문을 그대로 되보낸다 — 서버가 검산을 다시 실행한다(값을 골라 보내면 검산이 성립하지 않는다)
      const r = await fetch('/api/admin/billing/kt-statement/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({
          period_month: `${month}-01`,
          statement: {
            usage_period: parse.usage_period, count_080: parse.count_080,
            total_080: parse.total_080, entries: parse.entries,
          },
          signature: parse.signature,
        }),
      });
      const d = await r.json();
      if (d.success) {
        setApplyResult({ applied: d.applied || [], skipped: d.skipped || [] });
        say(`${(d.applied || []).length}개사 반영 완료`);
      } else say(d.error || '반영 실패', 'error');
    } catch { say('반영 실패', 'error'); } finally { setApplying(false); }
  };

  // ── ③ 반영 현황 ──
  const [statusMonth, setStatusMonth] = useState(prevMonth());
  const [items, setItems] = useState<ExtraItem[] | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [cancelAsk, setCancelAsk] = useState<string | null>(null);

  const loadItems = useCallback(async (m: string) => {
    setStatusLoading(true);
    try {
      const r = await fetch(`/api/admin/billing/extra-items?month=${m}`, { headers: auth() });
      const d = await r.json();
      if (d.success) setItems(d.items || []);
      else say(d.error || '조회 실패', 'error');
    } catch { say('조회 실패', 'error'); } finally { setStatusLoading(false); }
  }, []);

  const cancelCompany = async (companyId: string) => {
    try {
      const r = await fetch(`/api/admin/billing/extra-items?month=${statusMonth}&company_id=${companyId}`, { method: 'DELETE', headers: auth() });
      const d = await r.json();
      if (d.success) { say(`${d.deleted}건 취소했습니다.`); setCancelAsk(null); loadItems(statusMonth); }
      else say(d.error || '취소 실패', 'error');
    } catch { say('취소 실패', 'error'); }
  };

  if (!open) return null;

  const mappedRows = parse ? parse.rows.filter((r) => r.mapped) : [];
  const unmappedRows = parse ? parse.rows.filter((r) => !r.mapped) : [];
  // 회사별 그룹(반영 현황). billed = 발행에 이미 실린 항목 존재 — 취소 불가(발행 삭제 시 자동 복귀)
  const grouped = new Map<string, { name: string; rows: ExtraItem[]; total: number; billed: boolean }>();
  for (const it of items || []) {
    if (!grouped.has(it.company_id)) grouped.set(it.company_id, { name: it.company_name, rows: [], total: 0, billed: false });
    const g = grouped.get(it.company_id)!;
    g.rows.push(it); g.total += Number(it.supply_amount) || 0;
    if (it.billed_billing_id) g.billed = true;
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h3 className="text-base font-semibold text-gray-800">080 청구 관리</h3>
            <p className="text-xs text-gray-500 mt-0.5">번호↔회사 매핑을 등록해두면, KT 명세서 업로드만으로 통화료가 업체별 청구에 자동 귀속됩니다.</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400" aria-label="닫기">✕</button>
        </div>

        <div className="flex gap-1 px-6 pt-3 border-b shrink-0">
          {([['mapping', '번호 매핑'], ['upload', 'KT 명세서 업로드'], ['status', '반영 현황']] as const).map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); if (k === 'status' && items === null) loadItems(statusMonth); }}
              className={`px-4 py-2 text-sm rounded-t-lg border border-b-0 ${tab === k ? 'bg-violet-600 text-white border-violet-600 font-medium' : 'text-gray-600 border-transparent hover:bg-gray-50'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="p-6 overflow-y-auto">
          {tab === 'mapping' && (
            <div className="space-y-4">
              {/* 등록/수정 폼 */}
              <div className="border rounded-lg p-4 bg-gray-50">
                <div className="text-sm font-medium text-gray-700 mb-3">{form.id ? '번호 수정' : '번호 등록'}</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">080 번호</label>
                    <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="080-284-1300"
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">회사</label>
                    <select value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                      <option value="">선택</option>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">라벨 (부서/브랜드 — 선택)</label>
                    <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="예: Nars"
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">이용료 공급가 (기본 9,000)</label>
                    <input type="number" min={0} value={form.monthly_fee_supply}
                      onChange={(e) => setForm({ ...form, monthly_fee_supply: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                    <div className="text-[10px] text-gray-400 mt-0.5">{withVat(form.monthly_fee_supply)} · 무료 회사는 0</div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">KT 부가서비스 공급가 (기본 4,000)</label>
                    <input type="number" min={0} value={form.kt_fee_supply}
                      onChange={(e) => setForm({ ...form, kt_fee_supply: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                    <div className="text-[10px] text-gray-400 mt-0.5">{withVat(form.kt_fee_supply)}</div>
                  </div>
                  <div className="flex items-end gap-4 pb-1">
                    <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                      <input type="checkbox" checked={form.charge_call_fee} onChange={(e) => setForm({ ...form, charge_call_fee: e.target.checked })} className="w-4 h-4 accent-violet-600" />
                      통화료 청구
                    </label>
                    <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                      <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 accent-violet-600" />
                      활성
                    </label>
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label className="block text-[11px] text-gray-500 mb-1">메모 (선택)</label>
                    <input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="예: 7월부터 리스킨 사용"
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div className="flex items-end gap-2">
                    <button onClick={saveMapping} disabled={saving}
                      className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
                      {saving ? '저장 중...' : form.id ? '수정 저장' : '등록'}
                    </button>
                    {form.id && (
                      <button onClick={() => setForm({ ...EMPTY_FORM })} className="px-3 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-100">새로</button>
                    )}
                  </div>
                </div>
              </div>

              {/* 목록 */}
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-[11px] text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">번호</th>
                      <th className="px-3 py-2 text-left">회사</th>
                      <th className="px-3 py-2 text-left">라벨</th>
                      <th className="px-3 py-2 text-right">이용료</th>
                      <th className="px-3 py-2 text-right">부가서비스</th>
                      <th className="px-3 py-2 text-center">통화료</th>
                      <th className="px-3 py-2 text-center">활성</th>
                      <th className="px-3 py-2 text-right">관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapLoading ? (
                      <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">불러오는 중...</td></tr>
                    ) : mappings.length === 0 ? (
                      <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">등록된 번호가 없습니다 — 위에서 등록해주세요.</td></tr>
                    ) : mappings.map((m) => (
                      <tr key={m.id} className={`border-t ${m.is_active ? '' : 'opacity-50'}`}>
                        <td className="px-3 py-2 font-mono">{m.display_number}</td>
                        <td className="px-3 py-2">{m.company_name}</td>
                        <td className="px-3 py-2 text-gray-500">{m.label || '-'}</td>
                        <td className="px-3 py-2 text-right">{won(m.monthly_fee_supply)}</td>
                        <td className="px-3 py-2 text-right">{won(m.kt_fee_supply)}</td>
                        <td className="px-3 py-2 text-center">{m.charge_call_fee ? 'O' : '-'}</td>
                        <td className="px-3 py-2 text-center">{m.is_active ? 'O' : '중지'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => { setForm({
                            id: m.id, number: m.display_number, company_id: m.company_id, label: m.label || '',
                            monthly_fee_supply: m.monthly_fee_supply, kt_fee_supply: m.kt_fee_supply,
                            charge_call_fee: m.charge_call_fee, is_active: m.is_active, memo: m.memo || '',
                          }); }} className="text-violet-600 hover:underline text-xs mr-3">수정</button>
                          {deleteAsk === m.id ? (
                            <>
                              <button onClick={() => removeMapping(m.id)} className="text-red-600 font-medium text-xs mr-2">정말 삭제</button>
                              <button onClick={() => setDeleteAsk(null)} className="text-gray-500 text-xs">취소</button>
                            </>
                          ) : (
                            <button onClick={() => setDeleteAsk(m.id)} className="text-gray-400 hover:text-red-600 text-xs">삭제</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'upload' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">청구 대상월 (통화료가 귀속될 달)</label>
                  <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div className="flex-1 min-w-[220px]">
                  <label className="block text-[11px] text-gray-500 mb-1">KT 명세서 (PDF 또는 이미지 · 10MB 이하)</label>
                  <input ref={fileRef} type="file" accept=".pdf,image/jpeg,image/png,image/webp"
                    onChange={(e) => onUpload(e.target.files?.[0] || null)} disabled={parsing}
                    className="block w-full text-sm text-gray-600 file:mr-3 file:px-4 file:py-2 file:border-0 file:rounded-lg file:bg-violet-600 file:text-white file:text-sm hover:file:bg-violet-700" />
                </div>
              </div>
              <p className="text-xs text-gray-500">업로드하면 번호별 통화료를 읽어 매핑된 회사로 귀속합니다. 검산(번호별 소계 합 = 명세서 080 소계)을 통과해야 반영할 수 있고, 반영 전까지는 아무것도 저장되지 않습니다.</p>

              {parsing && <div className="py-8 text-center text-sm text-gray-500">명세서를 읽는 중... (약 20~30초)</div>}

              {parse && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-4 text-sm bg-gray-50 border rounded-lg px-4 py-3">
                    <span className="text-gray-600">이용기간 <b>{parse.usage_period || '-'}</b></span>
                    <span className="text-gray-600">080 번호 <b>{parse.rows.length}대</b>{parse.count_080 ? ` / 명세서 ${parse.count_080}대` : ''}</span>
                    <span className="text-gray-600">080 소계 <b>{won(parse.total_080)}</b> (VAT 포함)</span>
                    {parse.valid
                      ? <span className="text-emerald-600 font-medium">검산 일치</span>
                      : <span className="text-red-600 font-medium">검산 불일치 — 반영 불가</span>}
                  </div>
                  {!parse.valid && (
                    <div className="border border-red-200 bg-red-50 rounded-lg px-4 py-3 text-xs text-red-700 space-y-1">
                      {parse.validation_errors.map((e, i) => <div key={i}>{e}</div>)}
                      <div className="text-red-500 pt-1">파일 화질을 높여 다시 올리거나, 명세서 원본과 대조해주세요. 검산이 안 맞는 결과는 반영할 수 없습니다.</div>
                    </div>
                  )}

                  <div className="border rounded-lg overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-[11px] text-gray-500">
                        <tr>
                          <th className="px-3 py-2 text-left">번호</th>
                          <th className="px-3 py-2 text-left">귀속 회사</th>
                          <th className="px-3 py-2 text-right">통화료 (공급가)</th>
                          <th className="px-3 py-2 text-right">이용료</th>
                          <th className="px-3 py-2 text-right">부가서비스</th>
                          <th className="px-3 py-2 text-left">상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parse.rows.map((r) => (
                          <tr key={r.number} className={`border-t ${r.mapped ? '' : 'bg-amber-50'}`}>
                            <td className="px-3 py-2 font-mono">{r.display_number}</td>
                            <td className="px-3 py-2">{r.mapped ? `${r.company_name}${r.label ? ` (${r.label})` : ''}` : '-'}</td>
                            <td className="px-3 py-2 text-right">{won(r.call_fee)}</td>
                            <td className="px-3 py-2 text-right text-gray-500">{r.mapped ? won(r.monthly_fee_supply || 0) : '-'}</td>
                            <td className="px-3 py-2 text-right text-gray-500">{r.mapped ? won(r.kt_fee_supply || 0) : '-'}</td>
                            <td className="px-3 py-2">
                              {r.mapped
                                ? (r.charge_call_fee ? <span className="text-emerald-600 text-xs">반영 대상</span> : <span className="text-gray-500 text-xs">통화료 미청구 (고정료만)</span>)
                                : <span className="text-amber-600 text-xs">미매핑 — 보류</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {!applyResult ? (
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500">
                        반영 = 매핑된 {mappedRows.length}개 번호의 이용료·부가서비스·통화료가 <b>{month}</b>월 청구 항목으로 생성됩니다.
                        {unmappedRows.length > 0 && ` 미매핑 ${unmappedRows.length}개는 보류됩니다.`}
                      </div>
                      <button onClick={applyParse} disabled={!parse.valid || applying || mappedRows.length === 0}
                        className="px-5 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
                        {applying ? '반영 중...' : `${month}월 청구에 반영`}
                      </button>
                    </div>
                  ) : (
                    <div className="border rounded-lg px-4 py-3 text-sm space-y-2">
                      <div className="font-medium text-gray-700">반영 결과</div>
                      {applyResult.applied.map((a: any) => (
                        <div key={a.company_id} className="text-emerald-700 text-xs">{a.company_name} — 번호 {a.numbers}개 · 항목 {a.items}건 · 공급가 {won(a.supply_total)}</div>
                      ))}
                      {applyResult.skipped.map((s: any, i: number) => (
                        <div key={i} className="text-amber-700 text-xs">{s.company_name || s.number} — {s.reason}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'status' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <input type="month" value={statusMonth} onChange={(e) => setStatusMonth(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
                <button onClick={() => loadItems(statusMonth)} disabled={statusLoading}
                  className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
                  {statusLoading ? '조회 중...' : '조회'}
                </button>
              </div>
              {items !== null && (grouped.size === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">이 달에 반영된 항목이 없습니다.</div>
              ) : (
                <div className="space-y-3">
                  {Array.from(grouped.entries()).map(([cid, g]) => (
                    <div key={cid} className="border rounded-lg">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 rounded-t-lg">
                        <div className="text-sm font-medium text-gray-700">
                          {g.name} <span className="text-gray-400 font-normal">— 공급가 {won(g.total)}</span>
                          {g.billed && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">청구서에 반영됨</span>}
                        </div>
                        {g.billed ? (
                          <span className="text-[11px] text-gray-400">발행됨 — 취소 불가</span>
                        ) : cancelAsk === cid ? (
                          <div className="flex items-center gap-2">
                            <button onClick={() => cancelCompany(cid)} className="text-xs text-red-600 font-medium">정말 취소</button>
                            <button onClick={() => setCancelAsk(null)} className="text-xs text-gray-500">닫기</button>
                          </div>
                        ) : (
                          <button onClick={() => setCancelAsk(cid)} className="text-xs text-gray-400 hover:text-red-600">반영 취소</button>
                        )}
                      </div>
                      <div className="px-4 py-2 text-xs text-gray-600 space-y-1">
                        {g.rows.map((it) => (
                          <div key={it.id} className="flex justify-between">
                            <span>{it.label}</span>
                            <span>{won(Number(it.supply_amount))}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  <p className="text-[11px] text-gray-400">반영 취소는 그 달 정산이 발행되기 전까지만 가능합니다. 발행된 뒤에는 발행 삭제 후 취소해주세요.</p>
                </div>
              ))}
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
