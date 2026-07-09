// 캠페인 대행 설계 — 슈퍼관리자 (2026-07-09)
// 스펙: docs/superpowers/specs/2026-07-09-crm-campaign-agency-design.md §4
// 접수함(파일·상태·보정) + 분석 실행(업체 단일 스코프) → "한줄로 마케팅 제안서" PDF + 직행(업체 선택+양식 업로드).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import {
  ArrowLeft, Handshake, Download, FileSpreadsheet, Loader2, Play, RefreshCw, Save,
} from 'lucide-react';
import ConfirmModal, { ConfirmState } from '../components/ConfirmModal';
import { useToast } from '../components/ToastProvider';

interface AdminAgencyRow {
  id: string;
  company_id: string;
  company_name: string;
  title: string;
  memo: string | null;
  status: string;
  staff_note: string | null;
  request_file_name: string | null;
  parsed_json: any;
  has_proposal: boolean;
  designed_at: string | null;
  created_at: string;
}

interface CompanyOption { id: string; company_name: string; plan_code: string }

const STATUS_OPTIONS = [
  { value: 'received', label: '접수됨' },
  { value: 'designing', label: '설계 중' },
  { value: 'delivered', label: '제안서 전달' },
  { value: 'done', label: '완료' },
  { value: 'on_hold', label: '보류' },
];

const REQUIRED_KEYS: Array<[string, string]> = [
  ['title', '행사명'], ['periodStart', '행사 시작일'], ['periodEnd', '행사 종료일'],
  ['description', '행사 내용'], ['benefit', '혜택 내용'],
];

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

async function downloadAuthFile(url: string, fallbackName: string, onError: (m: string) => void) {
  try {
    const res = await fetch(url, { headers: auth() });
    if (!res.ok) { onError('파일을 찾을 수 없습니다.'); return; }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i);
    const name = m ? decodeURIComponent(m[1]) : fallbackName;
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = name; a.click();
    URL.revokeObjectURL(href);
  } catch { onError('다운로드에 실패했습니다.'); }
}

export default function AdminCampaignAgencyPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState<AdminAgencyRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(null);          // 선택 요청의 parsed 보정 폼
  const [staffNote, setStaffNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runSummary, setRunSummary] = useState<any>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  // 직행 카드
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [adhocCompany, setAdhocCompany] = useState('');
  const [adhocFile, setAdhocFile] = useState<File | null>(null);
  const [adhocRunning, setAdhocRunning] = useState(false);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) || null, [rows, selectedId]);

  const loadRows = async (filter = statusFilter) => {
    try {
      const q = filter ? `?status=${filter}` : '';
      const res = await fetch(`/api/campaign-agency/admin/requests${q}`, { headers: auth() });
      const d = await res.json();
      if (d.success) setRows(d.requests || []);
      else toast.error(d.error || '접수함 조회 실패');
    } catch { toast.error('접수함 조회 실패'); }
  };

  useEffect(() => { loadRows(); }, [statusFilter]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/campaign-agency/admin/companies', { headers: auth() });
        const d = await res.json();
        if (d.success) setCompanies(d.companies || []);
      } catch { /* 직행 카드만 영향 */ }
    })();
  }, []);

  // 선택 변경 시 보정 폼 로드
  useEffect(() => {
    if (!selected) { setForm(null); setRunSummary(null); return; }
    const p = selected.parsed_json || {};
    setForm({
      title: p.title || '', periodStart: p.periodStart || '', periodEnd: p.periodEnd || '',
      description: p.description || '', benefit: p.benefit || '',
      channels: Array.isArray(p.channels) ? p.channels.join(', ') : '',
      budget: p.budget ?? '', note: p.note || '',
      products: Array.isArray(p.products) ? p.products : [],
    });
    setStaffNote(selected.staff_note || '');
    setRunSummary(null);
  }, [selectedId]);

  const missingRequired = useMemo(() => {
    if (!form) return [];
    return REQUIRED_KEYS.filter(([k]) => !String(form[k] || '').trim()).map(([, label]) => label);
  }, [form]);

  const buildParsedPayload = () => ({
    title: String(form.title || '').trim(),
    periodStart: String(form.periodStart || '').trim(),
    periodEnd: String(form.periodEnd || '').trim(),
    description: String(form.description || '').trim(),
    benefit: String(form.benefit || '').trim(),
    channels: String(form.channels || '').split(',').map((s: string) => s.trim()).filter(Boolean),
    budget: Number(String(form.budget || '').replace(/[^\d]/g, '')) || null,
    note: String(form.note || '').trim(),
    products: (form.products || []).filter((p: any) => String(p?.name || '').trim()),
    missingRequired: REQUIRED_KEYS.filter(([k]) => !String(form[k] || '').trim()).map(([k]) => k),
  });

  const saveCorrection = async () => {
    if (!selected || !form) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/campaign-agency/admin/requests/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ parsed: buildParsedPayload(), staff_note: staffNote }),
      });
      const d = await res.json();
      if (d.success) { toast.success('저장했습니다.'); await loadRows(); }
      else toast.error(d.error || '저장 실패');
    } catch { toast.error('저장 실패'); } finally { setSaving(false); }
  };

  const changeStatus = async (id: string, status: string) => {
    try {
      const res = await fetch(`/api/campaign-agency/admin/requests/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ status }),
      });
      const d = await res.json();
      if (d.success) await loadRows();
      else toast.error(d.error || '상태 변경 실패');
    } catch { toast.error('상태 변경 실패'); }
  };

  const runDesign = () => {
    if (!selected) return;
    if (missingRequired.length > 0) { toast.error(`필수 항목 누락: ${missingRequired.join(' / ')}`); return; }
    setConfirmState({
      mode: 'default', title: '분석 실행', confirmLabel: '분석 실행',
      description: `[${selected.company_name}] 업체의 데이터만으로 분석합니다.\n고객DB 현황 · AI 학습 메모리 · 캠페인 이력을 분석해 제안서 PDF를 생성합니다. (수십 초 소요)`,
      onConfirm: async () => {
        setRunning(true); setRunSummary(null);
        try {
          // 보정값 먼저 저장 → 실행 (저장분 기준 분석)
          await fetch(`/api/campaign-agency/admin/requests/${selected.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth() },
            body: JSON.stringify({ parsed: buildParsedPayload(), staff_note: staffNote }),
          });
          const res = await fetch(`/api/campaign-agency/admin/requests/${selected.id}/design`, { method: 'POST', headers: auth() });
          const d = await res.json();
          if (d.success) { setRunSummary(d.summary); toast.success('제안서가 생성되었습니다.'); await loadRows(); }
          else toast.error(d.error || '분석 실행 실패');
        } catch { toast.error('분석 실행 실패'); } finally { setRunning(false); }
      },
    });
  };

  const runAdhoc = () => {
    if (!adhocCompany) { toast.error('업체를 선택해 주세요.'); return; }
    if (!adhocFile) { toast.error('요청서 파일을 첨부해 주세요.'); return; }
    const comp = companies.find((c) => c.id === adhocCompany);
    setConfirmState({
      mode: 'default', title: '직접 설계 실행', confirmLabel: '분석 실행',
      description: `[${comp?.company_name || ''}] 업체의 데이터만으로 분석합니다.\n업로드한 요청서로 즉시 제안서 PDF를 생성합니다. (수십 초 소요)`,
      onConfirm: async () => {
        setAdhocRunning(true); setRunSummary(null);
        try {
          const fd = new FormData();
          fd.append('companyId', adhocCompany);
          fd.append('file', adhocFile);
          const res = await fetch('/api/campaign-agency/admin/design-adhoc', { method: 'POST', headers: auth(), body: fd });
          const d = await res.json();
          if (d.success) {
            setRunSummary(d.summary); setSelectedId(d.summary?.requestId || null);
            toast.success('제안서가 생성되었습니다.');
            setAdhocFile(null); await loadRows();
          } else toast.error(d.error || '실행 실패');
        } catch { toast.error('실행 실패'); } finally { setAdhocRunning(false); }
      },
    });
  };

  const busy = running || adhocRunning;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => goBackOr(navigate, '/admin')} className="text-gray-500 hover:text-gray-800 p-1.5 -ml-1.5 rounded-lg hover:bg-gray-100">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
            <Handshake className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-semibold text-gray-900 leading-tight">캠페인 대행 설계</div>
            <div className="text-[11px] text-gray-400">비즈니스+ 업체 전용 — 선택한 업체의 데이터만 분석합니다</div>
          </div>
          <button onClick={() => loadRows()} className="ml-auto inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-800 border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg">
            <RefreshCw className="w-3.5 h-3.5" />새로고침
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* 좌: 접수함 + 직행 */}
        <div className="lg:col-span-2 space-y-4">
          {/* 직행 카드 */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <div className="text-sm font-semibold text-gray-900 mb-3">직접 설계 (업체 선택 + 양식 업로드)</div>
            <div className="space-y-2.5">
              <select value={adhocCompany} onChange={(e) => setAdhocCompany(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white">
                <option value="">업체 선택 (비즈니스+ 만 표시)</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name} · {c.plan_code}</option>)}
              </select>
              <label className="flex items-center gap-2.5 border border-dashed border-gray-300 hover:border-violet-400 rounded-xl px-3 py-2.5 cursor-pointer">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-[13px] text-gray-600 truncate flex-1">{adhocFile ? adhocFile.name : '요청서(xlsx) 선택'}</span>
                <input type="file" accept=".xlsx" className="hidden" onChange={(e) => setAdhocFile(e.target.files?.[0] || null)} />
              </label>
              <button onClick={runAdhoc} disabled={busy}
                className="w-full inline-flex items-center justify-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2.5 rounded-xl">
                {adhocRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}분석 실행 → 제안서 생성
              </button>
            </div>
          </div>

          {/* 접수함 */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-gray-900">접수함</div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-[12px] text-gray-600 bg-white">
                <option value="">전체 상태</option>
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            {rows.length === 0 ? (
              <div className="text-sm text-gray-400 py-8 text-center">접수된 요청이 없습니다.</div>
            ) : (
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {rows.map((r) => (
                  <button key={r.id} onClick={() => setSelectedId(r.id)}
                    className={`w-full text-left border rounded-xl px-3 py-2.5 transition-colors ${selectedId === r.id ? 'border-violet-400 bg-violet-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-gray-900 truncate flex-1">{r.title}</span>
                      <span className="text-[11px] text-gray-400 shrink-0">{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[12px] text-gray-500 truncate flex-1">{r.company_name}</span>
                      <span className="text-[11px] text-gray-400 shrink-0">{STATUS_OPTIONS.find((s) => s.value === r.status)?.label || r.status}</span>
                      {r.has_proposal && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full shrink-0">PDF</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 우: 상세 · 보정 · 실행 */}
        <div className="lg:col-span-3">
          {!selected || !form ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-sm text-gray-400">
              접수 건을 선택하거나, 좌측 직접 설계로 바로 실행하세요.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 relative">
              {running && (
                <div className="absolute inset-0 bg-white/85 backdrop-blur-sm rounded-2xl z-10 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-7 h-7 text-violet-600 animate-spin" />
                  <div className="text-sm text-gray-600">[{selected.company_name}] 데이터 분석 중 — 수십 초 소요됩니다</div>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-sm font-semibold text-gray-900">{selected.company_name}</span>
                <select value={selected.status} onChange={(e) => changeStatus(selected.id, e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-[12px] text-gray-600 bg-white">
                  {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <div className="ml-auto flex items-center gap-2">
                  {selected.request_file_name && (
                    <button onClick={() => downloadAuthFile(`/api/campaign-agency/admin/requests/${selected.id}/file`, selected.request_file_name || 'request.xlsx', toast.error)}
                      className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-800 border border-gray-200 px-2.5 py-1.5 rounded-lg hover:bg-gray-50">
                      <Download className="w-3.5 h-3.5" />요청서
                    </button>
                  )}
                  {selected.has_proposal && (
                    <button onClick={() => downloadAuthFile(`/api/campaign-agency/admin/requests/${selected.id}/proposal`, '한줄로_마케팅제안서.pdf', toast.error)}
                      className="inline-flex items-center gap-1 text-[12px] text-emerald-700 border border-emerald-300 px-2.5 py-1.5 rounded-lg hover:bg-emerald-50">
                      <Download className="w-3.5 h-3.5" />제안서 PDF
                    </button>
                  )}
                </div>
              </div>
              <div className="text-[12px] text-gray-400 mb-4">{selected.title}{selected.memo ? ` — ${selected.memo}` : ''}</div>

              {missingRequired.length > 0 && (
                <div className="mb-3 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  필수 항목 누락: {missingRequired.join(' / ')} — 입력 후 실행할 수 있습니다.
                </div>
              )}

              {/* 파싱 보정 폼 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="행사명 (필수)"
                  className="md:col-span-2 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800" />
                <input value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} placeholder="시작일 (필수, 2026-07-15)"
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800" />
                <input value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} placeholder="종료일 (필수)"
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800" />
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="행사 내용 (필수)"
                  className="md:col-span-2 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 resize-y" />
                <input value={form.benefit} onChange={(e) => setForm({ ...form, benefit: e.target.value })} placeholder="혜택 내용 (필수 — 제안서 문안은 이 값만 사용)"
                  className="md:col-span-2 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800" />
                <input value={form.channels} onChange={(e) => setForm({ ...form, channels: e.target.value })} placeholder="희망 채널 (쉼표 구분, 선택)"
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800" />
                <input value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="예산 (원, 선택)"
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800" />
                <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} placeholder="참고사항 (선택)"
                  className="md:col-span-2 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 resize-y" />
                <textarea value={staffNote} onChange={(e) => setStaffNote(e.target.value)} rows={2} placeholder="직원 메모 (내부용)"
                  className="md:col-span-2 border border-violet-200 bg-violet-50/40 rounded-xl px-3 py-2 text-sm text-gray-800 resize-y" />
              </div>

              {/* 상품 표 간단 표시 (파싱분) */}
              {form.products?.length > 0 && (
                <div className="mt-3 text-[12px] text-gray-500">
                  대상 상품: {form.products.map((p: any) => `${p.name}${p.salePrice ? `(${Number(p.salePrice).toLocaleString()}원)` : ''}`).join(' · ')}
                </div>
              )}

              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <button onClick={saveCorrection} disabled={saving || busy}
                  className="inline-flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 disabled:opacity-40 text-gray-700 text-sm px-4 py-2 rounded-xl">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}보정 저장
                </button>
                <button onClick={runDesign} disabled={busy || missingRequired.length > 0}
                  className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-xl">
                  <Play className="w-4 h-4" />분석 실행 → 제안서 생성
                </button>
              </div>

              {/* 실행 결과 요약 */}
              {runSummary && (
                <div className="mt-4 border border-violet-200 bg-violet-50/50 rounded-xl p-3.5">
                  <div className="text-[13px] font-medium text-gray-900 mb-2">생성 결과 — 캠페인 플랜 {runSummary.plans?.length || 0}건</div>
                  <div className="space-y-1">
                    {(runSummary.plans || []).map((p: any, i: number) => (
                      <div key={i} className="text-[12px] text-gray-600">
                        · {p.title} — {String(p.channel || '').toUpperCase()} / 타겟 {p.targetCount != null ? `${Number(p.targetCount).toLocaleString()}명(실측)` : '실행 시 산정'} / 발송비 {p.estimatedCost != null ? `${Number(p.estimatedCost).toLocaleString()}원` : '실행 시 산정'}
                      </div>
                    ))}
                  </div>
                  {runSummary.dataNotes?.length > 0 && (
                    <div className="mt-2 text-[11px] text-gray-400">{runSummary.dataNotes.join(' · ')}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {confirmState && <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />}
    </div>
  );
}
