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
// ★ 2026-07-31 업체 검색 + 청구 귀속(고객사 전체/사용자별) 공통 선택 — 부가서비스 입력 탭과 같은 컴포넌트.
import CompanyScopePicker from './CompanyScopePicker';

interface CompanyOpt { id: string; company_name: string }

interface Mapping {
  id: string;
  number: string;
  display_number: string;
  company_id: string;
  company_name?: string;
  user_id?: string | null;
  user_name?: string | null;
  user_login_id?: string | null;
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
  /**
   * ★ 2026-08-04 실제로 청구될 금액은 **서버가 발행과 같은 함수로 계산해** 내려준다.
   *   080은 스냅샷 1행(통화료)에서 이용료·부가서비스·통화료를 매핑 원장으로 파생하므로,
   *   화면이 `supply_amount`를 그대로 보여주면 매핑을 고쳐도 옛 금액이 보인다(접수 원인).
   */
  billable_parts: Array<{ type_key: string; label: string; amount: number }>;
  /** 발행에 실린 행은 null — 청구서는 굳어 있으므로 원장에서 다시 계산한 값을 보여주지 않는다 */
  billable_supply: number | null;
  /** 매핑이 사라진 반영분 — 그 회사 발행이 막힌다 */
  blocks_issue?: boolean;
  /** 매핑 비활성 = 청구 중단 */
  inactive?: boolean;
  /** 현행 스냅샷과 겹쳐 청구되지 않는 옛 행 — 정리 대상 */
  legacy_superseded?: boolean;
  map_found?: boolean | null;
  map_label?: string | null;
  map_charge_call_fee?: boolean | null;
  /** ★ 2026-07-31 청구 귀속 — null이면 고객사 전체(공통 장). 080은 매핑 원장이 소유한다 */
  sheet_user_id?: string | null; sheet_user_name?: string | null; sheet_user_login_id?: string | null;
}

const won = (n: number) => `₩${Number(n || 0).toLocaleString()}`;
const withVat = (n: number) => `${won(n)} (VAT 포함 ${won(Math.round(n * 1.1))})`;
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });
const prevMonth = () => {
  // ★ setDate(1) 선행(Codex 수용 — MinimumChargeModal 미러) — 7/31에서 한 달을 빼면 "6/31"→7/1 보정으로 당월이 나온다.
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// ★ 2026-07-31 `user_id` = 청구 귀속. null이면 고객사 전체(공통 장), 값이 있으면 그 계정 장으로 청구된다.
const EMPTY_FORM = {
  id: '', number: '', company_id: '', user_id: null as string | null, label: '',
  monthly_fee_supply: 9000, kt_fee_supply: 4000, charge_call_fee: true, is_active: true, memo: '',
};

export default function Billing080Modal({ open, onClose, companies }: {
  open: boolean;
  onClose: () => void;
  companies: CompanyOpt[];
}) {
  const [tab, setTab] = useState<'mapping' | 'upload' | 'manual' | 'status'>('mapping');
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
        say(`${(d.applied || []).length}개사 반영 완료 — 실제 청구 금액을 현황에서 확인해주세요.`);
        // ★ 2026-08-04 반영 직후 그 달 현황으로 바로 이동한다 — 이용료·부가서비스는 매핑 설정에서
        //   파생되므로 "얼마가 청구되는가"는 현황 탭이 답한다(추가 클릭 없이 그 화면을 띄운다).
        setStatusMonth(month);
        loadItems(month);
        setTab('status');
      } else say(d.error || '반영 실패', 'error');
    } catch { say('반영 실패', 'error'); } finally { setApplying(false); }
  };

  // ── ③ 부가서비스 수기 입력 (★2026-07-30 Harold — 시세이도 단축 URL 장당 5만 등) ──
  const [mCompany, setMCompany] = useState('');
  // ★ 2026-07-31 청구 귀속 — null이면 고객사 전체, 값이 있으면 그 계정 앞으로 청구된다.
  const [mUser, setMUser] = useState<string | null>(null);
  const [mMonth, setMMonth] = useState(prevMonth());
  const [mLabel, setMLabel] = useState('');
  const [mUnit, setMUnit] = useState(50000);
  const [mQty, setMQty] = useState(1);
  const [mSaving, setMSaving] = useState(false);

  const addManual = async () => {
    if (!mCompany || !mLabel.trim()) { say('회사와 항목 내용을 입력해주세요.', 'error'); return; }
    setMSaving(true);
    try {
      const r = await fetch('/api/admin/billing/extra-items', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ company_id: mCompany, user_id: mUser, month: mMonth, label: mLabel.trim(), unit_supply: mUnit, qty: mQty }),
      });
      const d = await r.json();
      if (d.success) {
        say(`추가했습니다 — 공급가 ${won(d.supplyTotal)} (${mQty}건). ${mMonth}월 발행 때 "부가서비스" 항목으로 실립니다.`);
        setMLabel(''); setMQty(1);
        if (statusMonth === mMonth) loadItems(mMonth);
      } else say(d.error || '추가 실패', 'error');
    } catch { say('추가 실패', 'error'); } finally { setMSaving(false); }
  };

  // ── ④ 반영 현황 ──
  const [statusMonth, setStatusMonth] = useState(prevMonth());
  const [items, setItems] = useState<ExtraItem[] | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [cancelAsk, setCancelAsk] = useState<string | null>(null);
  const [itemAsk, setItemAsk] = useState<string | null>(null); // 개별 항목 삭제 2단 확인
  // ★ 2026-08-04 **입력월과 화면에 실제로 실린 월을 분리한다**(Codex 적대검증 high 수용).
  //   하나로 두면 월 입력만 바꾸고 [조회]를 안 눌러도 취소가 살아 있어, 6월 목록을 보면서 7월 근거를
  //   지우는 요청이 나간다. 늦게 도착한 옛 응답이 새 목록을 덮는 것도 요청 순번으로 막는다.
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const removeItem = async (id: string) => {
    try {
      const r = await fetch(`/api/admin/billing/extra-items/${id}`, { method: 'DELETE', headers: auth() });
      const d = await r.json();
      if (d.success) { say('항목을 삭제했습니다.'); setItemAsk(null); if (loadedMonth) loadItems(loadedMonth); }
      else say(d.error || '삭제 실패', 'error');
    } catch { say('삭제 실패', 'error'); }
  };

  const loadItems = useCallback(async (m: string) => {
    const seq = ++loadSeq.current;
    setStatusLoading(true);
    setCancelAsk(null); setItemAsk(null);
    try {
      const r = await fetch(`/api/admin/billing/extra-items?month=${m}`, { headers: auth() });
      const d = await r.json();
      if (seq !== loadSeq.current) return; // 늦게 온 옛 응답은 버린다
      if (d.success) { setItems(d.items || []); setLoadedMonth(m); }
      else say(d.error || '조회 실패', 'error');
    } catch { if (seq === loadSeq.current) say('조회 실패', 'error'); } finally {
      if (seq === loadSeq.current) setStatusLoading(false);
    }
  }, []);

  // ★ 2026-08-04 범위 필수 — KT 반영을 되돌릴 때 사람이 손으로 넣은 부가서비스까지 지워지던 것을 막는다.
  //   월은 **화면에 실린 월**(loadedMonth)로 보낸다 — 입력값을 쓰면 안 본 달이 지워진다.
  const cancelCompany = async (companyId: string, kind: 'kt' | 'manual') => {
    if (!loadedMonth) return;
    try {
      const r = await fetch(`/api/admin/billing/extra-items?month=${loadedMonth}&company_id=${companyId}&kind=${kind}`, { method: 'DELETE', headers: auth() });
      const d = await r.json();
      if (d.success) { say(`${d.deleted}건 취소했습니다.`); setCancelAsk(null); loadItems(loadedMonth); }
      else say(d.error || '취소 실패', 'error');
    } catch { say('취소 실패', 'error'); }
  };

  if (!open) return null;

  const mappedRows = parse ? parse.rows.filter((r) => r.mapped) : [];
  const unmappedRows = parse ? parse.rows.filter((r) => !r.mapped) : [];
  // 회사별 그룹(반영 현황). billed = 발행에 이미 실린 항목 존재 — 취소 불가(발행 삭제 시 자동 복귀)
  //   ★ 2026-08-04 합계는 **파생 금액**(billable_supply)이다 — 실제 청구서에 실릴 값과 같다.
  const grouped = new Map<string, { name: string; rows: ExtraItem[]; total: number; billed: boolean; hasKt: boolean; hasManual: boolean; blocked: boolean }>();
  for (const it of items || []) {
    if (!grouped.has(it.company_id)) grouped.set(it.company_id, { name: it.company_name, rows: [], total: 0, billed: false, hasKt: false, hasManual: false, blocked: false });
    const g = grouped.get(it.company_id)!;
    g.rows.push(it); g.total += Number(it.billable_supply) || 0;
    if (it.billed_billing_id) g.billed = true;
    if (it.blocks_issue) g.blocked = true;
    if (it.kind === 'manual') g.hasManual = true; else g.hasKt = true;
  }
  // 화면에 실린 월과 입력월이 다르면 목록은 옛 달의 것이다 — 그 상태에서 취소를 허용하면 다른 달이 지워진다.
  const monthStale = loadedMonth !== null && loadedMonth !== statusMonth;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h3 className="text-base font-semibold text-gray-800">추가 청구 관리 (080 · 부가서비스)</h3>
            <p className="text-xs text-gray-500 mt-0.5">080 매핑이 활성이면 이용료·부가서비스는 매달 정산에 자동으로 실립니다. KT 명세서는 통화료 귀속에만 쓰이고, 부가서비스 수기 항목은 직접 입력하면 거래내역서 항목으로 실립니다.</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400" aria-label="닫기">✕</button>
        </div>

        <div className="flex gap-1 px-6 pt-3 border-b shrink-0">
          {([['mapping', '080 번호 매핑'], ['upload', 'KT 명세서 업로드'], ['manual', '부가서비스 입력'], ['status', '반영 현황']] as const).map(([k, label]) => (
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
                {/* ★ 2026-07-31 업체는 검색으로 고르고, 이 번호를 고객사 전체에 청구할지 특정 계정에 청구할지 함께 정한다. */}
                <div className="mb-3">
                  <CompanyScopePicker
                    companies={companies}
                    companyId={form.company_id}
                    userId={form.user_id}
                    disabled={saving}
                    onChange={({ companyId, userId }) => setForm({ ...form, company_id: companyId, user_id: userId })}
                  />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">080 번호</label>
                    <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="080-284-1300"
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
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
                      <th className="px-3 py-2 text-left">청구 귀속</th>
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
                      <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">불러오는 중...</td></tr>
                    ) : mappings.length === 0 ? (
                      <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">등록된 번호가 없습니다 — 위에서 등록해주세요.</td></tr>
                    ) : mappings.map((m) => (
                      <tr key={m.id} className={`border-t ${m.is_active ? '' : 'opacity-50'}`}>
                        <td className="px-3 py-2 font-mono">{m.display_number}</td>
                        <td className="px-3 py-2">{m.company_name}</td>
                        <td className="px-3 py-2">
                          {m.user_id ? (
                            <span className="inline-flex items-center rounded bg-violet-50 border border-violet-200 px-1.5 py-0.5 text-[11px] text-violet-700">
                              {m.user_name || m.user_login_id}
                            </span>
                          ) : (
                            <span className="text-[11px] text-gray-400">고객사 전체</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{m.label || '-'}</td>
                        <td className="px-3 py-2 text-right">{won(m.monthly_fee_supply)}</td>
                        <td className="px-3 py-2 text-right">{won(m.kt_fee_supply)}</td>
                        <td className="px-3 py-2 text-center">{m.charge_call_fee ? 'O' : '-'}</td>
                        <td className="px-3 py-2 text-center">{m.is_active ? 'O' : '중지'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => { setForm({
                            id: m.id, number: m.display_number, company_id: m.company_id,
                            user_id: m.user_id || null, label: m.label || '',
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
                        반영 = 매핑된 {mappedRows.length}개 번호의 <b>{month}</b>월 통화료가 기록됩니다.
                        이용료·부가서비스·청구 귀속은 번호 매핑 설정을 따르므로, <b>매핑을 고치면 발행에 바로 반영됩니다</b>(재반영 불필요).
                        {unmappedRows.length > 0 && ` 미매핑 ${unmappedRows.length}개는 보류됩니다.`}
                      </div>
                      <button onClick={applyParse} disabled={!parse.valid || applying || mappedRows.length === 0}
                        className="px-5 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50 whitespace-nowrap">
                        {applying ? '반영 중...' : `${month}월 청구에 반영`}
                      </button>
                    </div>
                  ) : (
                    <div className="border rounded-lg px-4 py-3 text-xs text-gray-500">
                      반영을 마쳤습니다 — 실제 청구될 금액은 <b>반영 현황</b> 탭에 있습니다.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'manual' && (
            <div className="space-y-4">
              <div className="border rounded-lg p-4 bg-gray-50">
                <div className="text-sm font-medium text-gray-700 mb-3">부가서비스 항목 추가</div>
                {/* ★ 2026-07-31 080 매핑 탭과 **같은 컴포넌트** — 귀속 축이 두 화면에서 다르게 동작하면 그대로 오청구가 된다. */}
                <div className="mb-3">
                  <CompanyScopePicker
                    companies={companies}
                    companyId={mCompany}
                    userId={mUser}
                    disabled={mSaving}
                    onChange={({ companyId, userId }) => { setMCompany(companyId); setMUser(userId); }}
                  />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">청구 대상월</label>
                    <input type="month" value={mMonth} onChange={(e) => setMMonth(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label className="block text-[11px] text-gray-500 mb-1">항목 내용</label>
                    <input value={mLabel} onChange={(e) => setMLabel(e.target.value)} placeholder="예: 단축 URL 제작" maxLength={180}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">건당 금액 (공급가)</label>
                    <input type="number" min={1} value={mUnit}
                      onChange={(e) => setMUnit(Math.max(1, Math.floor(Number(e.target.value) || 0)))}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                    <div className="text-[10px] text-gray-400 mt-0.5">VAT 포함 {won(Math.round(mUnit * 1.1))}</div>
                  </div>
                  <div className="flex items-end gap-2">
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-1">수량</label>
                      <input type="number" min={1} max={100} value={mQty}
                        onChange={(e) => setMQty(Math.min(100, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
                        className="w-20 px-3 py-2 border rounded-lg text-sm" />
                    </div>
                    <button onClick={addManual} disabled={mSaving}
                      className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
                      {mSaving ? '추가 중...' : '추가'}
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mt-2.5">
                  거래내역서에는 <b>"부가서비스 {mQty}건 × {won(mUnit)} = {won(mUnit * mQty)}"</b>로 인쇄됩니다.
                  입력 내용은 반영 현황 탭에서 확인·삭제할 수 있습니다. 이미 발행된 달에는 추가할 수 없습니다.
                </p>
              </div>
            </div>
          )}

          {tab === 'status' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <input type="month" value={statusMonth} onChange={(e) => setStatusMonth(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
                <button onClick={() => loadItems(statusMonth)} disabled={statusLoading}
                  className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
                  {statusLoading ? '조회 중...' : '조회'}
                </button>
                {loadedMonth && (
                  <span className={`text-xs ${monthStale ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                    {monthStale ? `아래 목록은 ${loadedMonth} 기준입니다 — 조회를 눌러야 ${statusMonth}로 바뀝니다` : `${loadedMonth} 기준`}
                  </span>
                )}
              </div>
              {applyResult && (
                <div className="border rounded-lg px-4 py-3 text-sm space-y-1.5">
                  <div className="font-medium text-gray-700">직전 반영 결과</div>
                  {applyResult.applied.map((a: any) => (
                    <div key={a.company_id} className="text-emerald-700 text-xs">{a.company_name} — 번호 {a.numbers}개 · 통화료 {won(a.call_supply)}</div>
                  ))}
                  {applyResult.skipped.map((s: any, i: number) => (
                    <div key={i} className="text-amber-700 text-xs">{[s.company_name, s.number].filter(Boolean).join(' ') || '-'} — {s.reason}</div>
                  ))}
                  <div className="text-[11px] text-gray-400 pt-0.5">이용료·부가서비스·청구 귀속은 번호 매핑 설정에서 나옵니다 — 아래 금액이 실제 청구액입니다.</div>
                </div>
              )}
              {items !== null && (grouped.size === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">이 달에 반영된 항목이 없습니다.</div>
              ) : (
                <div className="space-y-3">
                  {Array.from(grouped.entries()).map(([cid, g]) => (
                    <div key={cid} className="border rounded-lg">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 rounded-t-lg">
                        <div className="text-sm font-medium text-gray-700">
                          {g.name} <span className="text-gray-400 font-normal">— 청구 예정 {won(g.total)}</span>
                          {g.billed && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">청구서에 반영됨</span>}
                          {g.blocked && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">매핑 없음 — 이 회사 발행이 막힙니다</span>}
                        </div>
                        {/* ★ 2026-08-04 KT 반영분과 수기 입력분을 따로 지운다 — 한 버튼으로 묶여 있어서
                            KT를 다시 반영하려고 취소하면 손으로 넣은 부가서비스까지 사라졌다.
                            월 입력만 바꾼 상태(monthStale)에서는 취소를 아예 내리지 않는다. */}
                        {monthStale ? (
                          <span className="text-[11px] text-amber-600">조회 후 취소할 수 있습니다</span>
                        ) : g.billed ? (
                          <span className="text-[11px] text-gray-400">발행됨 — 취소 불가</span>
                        ) : cancelAsk?.startsWith(`${cid}:`) ? (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-gray-500">
                              {cancelAsk.endsWith(':kt') ? 'KT 반영분(080)만 지웁니다' : '수기 부가서비스만 지웁니다'}
                            </span>
                            <button onClick={() => cancelCompany(cid, cancelAsk.endsWith(':kt') ? 'kt' : 'manual')} className="text-xs text-red-600 font-medium">정말 취소</button>
                            <button onClick={() => setCancelAsk(null)} className="text-xs text-gray-500">닫기</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            {g.hasKt && (
                              <button onClick={() => setCancelAsk(`${cid}:kt`)} className="text-xs text-gray-400 hover:text-red-600">KT 반영 취소</button>
                            )}
                            {g.hasManual && (
                              <button onClick={() => setCancelAsk(`${cid}:manual`)} className="text-xs text-gray-400 hover:text-red-600">수기 항목 삭제</button>
                            )}
                          </div>
                        )}
                      </div>
                      {/* ★ 2026-08-04 각 행이 청구서에 어떻게 실릴지를 그대로 편다 — 080은 스냅샷(통화료) 1행에서
                          매핑 설정으로 이용료·부가서비스·통화료가 파생되므로, 매핑을 고치면 이 표가 바로 바뀐다. */}
                      <div className="px-4 py-2 text-xs text-gray-600 space-y-1.5">
                        {g.rows.map((it) => (
                          <div key={it.id} className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate">{it.label}{it.map_label ? ` ${it.map_label}` : ''}</span>
                                {it.legacy_superseded && (
                                  <span className="shrink-0 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] text-amber-700">옛 항목 — 새 반영분이 대신함 · 취소로 정리</span>
                                )}
                                {it.blocks_issue && (
                                  <span className="shrink-0 rounded bg-red-50 border border-red-200 px-1.5 py-0.5 text-[10px] text-red-700">매핑 없음 — 발행 차단</span>
                                )}
                                {it.inactive && (
                                  <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">비활성 — 청구 안 함</span>
                                )}
                                {it.kind === '080_call' && it.map_found && !it.inactive && !it.map_charge_call_fee && (
                                  <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">통화료 미청구</span>
                                )}
                              </div>
                              <div className="text-[11px] text-gray-400 mt-0.5">
                                {it.billed_billing_id
                                  ? '발행됨 — 금액은 발행된 청구서 기준'
                                  : it.billable_parts.length === 0
                                    ? '청구 항목 없음'
                                    : it.billable_parts.map((p) => `${p.label} ${won(p.amount)}`).join(' · ')}
                              </div>
                            </div>
                            {/* ★ 2026-07-31 귀속 — 계정 앞 항목만 표시한다(고객사 전체는 기본값이라 조용히 둔다). */}
                            {it.sheet_user_id && (
                              <span className="shrink-0 rounded bg-violet-50 border border-violet-200 px-1.5 py-0.5 text-[10px] text-violet-700">
                                {it.sheet_user_name || it.sheet_user_login_id}
                              </span>
                            )}
                            <span className="shrink-0 font-medium text-gray-700">{it.billable_supply === null ? '—' : won(Number(it.billable_supply))}</span>
                            {/* 개별 삭제 — 미소비만(서버 강제). 발행에 실린 행은 발행 삭제 시 자동 복귀 */}
                            {!it.billed_billing_id && (
                              itemAsk === it.id ? (
                                <span className="shrink-0">
                                  <button onClick={() => removeItem(it.id)} className="text-red-600 font-medium mr-1.5">삭제</button>
                                  <button onClick={() => setItemAsk(null)} className="text-gray-400">취소</button>
                                </span>
                              ) : (
                                <button onClick={() => setItemAsk(it.id)} className="shrink-0 text-gray-300 hover:text-red-500" aria-label="항목 삭제">✕</button>
                              )
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  <p className="text-[11px] text-gray-400">
                    금액은 <b>번호 매핑 설정에서 계산된 실제 청구액</b>입니다 — 이용료·부가서비스·통화료 청구 여부·청구 귀속을 매핑에서 고치면 여기와 청구서가 함께 바뀝니다(재반영 불필요).
                    취소는 그 달 정산이 발행되기 전까지만 가능하고, 발행된 뒤에는 발행 삭제 후 취소해주세요.
                  </p>
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
