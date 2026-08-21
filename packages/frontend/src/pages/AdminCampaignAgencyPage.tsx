// 캠페인 대행 설계 — 슈퍼관리자 (화이트 모던)
// 스펙: docs/superpowers/specs/2026-07-09-crm-agency-webform-redesign-design.md
// ★ 2026-07-09 웹 폼 전환(Harold): 요청 목록 → 행 클릭 → 상세 모달(이미지 갤러리·보정 폼·분석 실행·PDF).
//   직접 설계(adhoc)도 xlsx 업로드 폐지 — 업체 선택 + 같은 폼(+이미지)으로 즉시 분석.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import {
  ArrowLeft, Handshake, Download, Loader2, Play, RefreshCw, Save, X, PenSquare,
  Images as ImagesIcon, FileSpreadsheet, ClipboardList,
} from 'lucide-react';
import ConfirmModal, { ConfirmState } from '../components/ConfirmModal';
import { useToast } from '../components/ToastProvider';
import AgencyRequestForm, {
  AgencyFormValue, EMPTY_AGENCY_FORM, agencyMissingLabels, buildAgencyPayload, parsedToFormValue, mergeAnalyzedIntoForm,
} from '../components/agency/AgencyRequestForm';
// ★ 2026-08-20 로컬 헬퍼를 lib/auth-download.ts로 승격(원본 복사·동작 무변경) — 고객 페이지 제안서 다운로드와 공용.
import { downloadAuthFile } from '../lib/auth-download';

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
  images: Array<{ name: string }>;
  has_proposal: boolean;
  designed_at: string | null;
  created_at: string;
}

interface CompanyOption { id: string; company_name: string; plan_code: string }

const STATUS_OPTIONS = [
  { value: 'received', label: '접수됨', chip: 'bg-sky-100 text-sky-700' },
  { value: 'designing', label: '설계 중', chip: 'bg-violet-100 text-violet-700' },
  { value: 'delivered', label: '제안서 전달', chip: 'bg-emerald-100 text-emerald-700' },
  { value: 'done', label: '완료', chip: 'bg-gray-100 text-gray-500' },
  { value: 'on_hold', label: '보류', chip: 'bg-amber-100 text-amber-700' },
];

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

export default function AdminCampaignAgencyPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState<AdminAgencyRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  // 상세 모달
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<AgencyFormValue>(EMPTY_AGENCY_FORM);
  const [staffNote, setStaffNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runSummary, setRunSummary] = useState<any>(null);
  const [detailImageUrls, setDetailImageUrls] = useState<string[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // 직접 설계 모달
  const [showAdhoc, setShowAdhoc] = useState(false);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [adhocCompany, setAdhocCompany] = useState('');
  const [adhocForm, setAdhocForm] = useState<AgencyFormValue>(EMPTY_AGENCY_FORM);
  const [adhocImages, setAdhocImages] = useState<File[]>([]);
  const [adhocRunning, setAdhocRunning] = useState(false);
  const [adhocAnalyzing, setAdhocAnalyzing] = useState(false);
  // adhoc 성공 직후 상세 모달을 열 때, 선택 변경 effect의 runSummary 초기화에 지워지지 않도록 보존
  const pendingSummaryRef = useRef<any>(null);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) || null, [rows, selectedId]);
  const busy = running || adhocRunning;

  const loadRows = async (filter = statusFilter) => {
    try {
      const q = filter ? `?status=${filter}` : '';
      const res = await fetch(`/api/campaign-agency/admin/requests${q}`, { headers: auth() });
      const d = await res.json();
      if (d.success) setRows(d.requests || []);
      else toast.error(d.error || '요청 목록 조회 실패');
    } catch { toast.error('요청 목록 조회 실패'); }
  };

  useEffect(() => { loadRows(); }, [statusFilter]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/campaign-agency/admin/companies', { headers: auth() });
        const d = await res.json();
        if (d.success) setCompanies(d.companies || []);
      } catch { /* 직접 설계만 영향 */ }
    })();
  }, []);

  // 선택 변경 시 보정 폼 로드 (adhoc 직후에는 보존된 결과 요약을 이어받는다)
  useEffect(() => {
    if (!selected) { setForm(EMPTY_AGENCY_FORM); setRunSummary(null); return; }
    setForm(parsedToFormValue(selected.parsed_json || {}));
    setStaffNote(selected.staff_note || '');
    setRunSummary(pendingSummaryRef.current);
    pendingSummaryRef.current = null;
  }, [selectedId]);

  // 상세 모달 이미지 로드 (인증 endpoint → blob URL)
  useEffect(() => {
    if (!selected || selected.images.length === 0) { setDetailImageUrls([]); return; }
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      for (let i = 0; i < selected.images.length; i++) {
        try {
          const res = await fetch(`/api/campaign-agency/admin/requests/${selected.id}/images/${i}`, { headers: auth() });
          if (!res.ok) continue;
          const blob = await res.blob();
          if (cancelled) return;
          urls.push(URL.createObjectURL(blob));
          setDetailImageUrls([...urls]);
        } catch { /* 개별 이미지 실패 — 나머지 계속 */ }
      }
    })();
    return () => { cancelled = true; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [selectedId]);

  const missingRequired = useMemo(() => agencyMissingLabels(form), [form]);

  const saveCorrection = async (): Promise<boolean> => {
    if (!selected) return false;
    setSaving(true);
    try {
      const res = await fetch(`/api/campaign-agency/admin/requests/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ parsed: buildAgencyPayload(form), staff_note: staffNote }),
      });
      const d = await res.json();
      if (d.success) { await loadRows(); return true; }
      toast.error(d.error || '저장 실패');
      return false;
    } catch { toast.error('저장 실패'); return false; } finally { setSaving(false); }
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
      description: `[${selected.company_name}] 업체의 데이터만으로 분석합니다.\n고객DB 현황 · AI 학습 메모리 · 캠페인 이력${selected.images.length ? ' · 행사 이미지' : ''}를 분석해 제안서 PDF를 생성합니다. (수십 초 소요)`,
      onConfirm: async () => {
        setRunning(true); setRunSummary(null);
        try {
          // 보정값 먼저 저장 → 실행 (저장분 기준 분석)
          const saved = await saveCorrection();
          if (!saved) return;
          const res = await fetch(`/api/campaign-agency/admin/requests/${selected.id}/design`, { method: 'POST', headers: auth() });
          const d = await res.json();
          if (d.success) { setRunSummary(d.summary); toast.success('제안서가 생성되었습니다.'); await loadRows(); }
          else toast.error(d.error || '분석 실행 실패');
        } catch { toast.error('분석 실행 실패'); } finally { setRunning(false); }
      },
    });
  };

  const openAdhoc = () => { setAdhocCompany(''); setAdhocForm(EMPTY_AGENCY_FORM); setAdhocImages([]); setShowAdhoc(true); };

  // 직접 설계 이미지 → AI 자동 입력 (크레딧 컨텍스트용 업체 선택 선행)
  const analyzeAdhocImages = async () => {
    if (!adhocCompany) { toast.error('업체를 먼저 선택해 주세요.'); return; }
    if (adhocImages.length === 0) { toast.error('이미지를 먼저 올려주세요.'); return; }
    setAdhocAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append('companyId', adhocCompany);
      adhocImages.forEach((f) => fd.append('images', f));
      const res = await fetch('/api/campaign-agency/admin/design-adhoc/analyze-images', { method: 'POST', headers: auth(), body: fd });
      const d = await res.json();
      if (d.success && d.form) {
        setAdhocForm((cur) => mergeAnalyzedIntoForm(cur, d.form));
        toast.success('이미지 내용을 자동 입력했습니다. 확인 후 실행해 주세요.');
      } else toast.error(d.error || '이미지 판독에 실패했습니다.');
    } catch { toast.error('이미지 판독에 실패했습니다.'); } finally { setAdhocAnalyzing(false); }
  };

  const runAdhoc = () => {
    if (!adhocCompany) { toast.error('업체를 선택해 주세요.'); return; }
    const missing = agencyMissingLabels(adhocForm);
    if (missing.length > 0) { toast.error(`필수 항목을 입력해 주세요: ${missing.join(' / ')}`); return; }
    const comp = companies.find((c) => c.id === adhocCompany);
    setConfirmState({
      mode: 'default', title: '직접 설계 실행', confirmLabel: '분석 실행',
      description: `[${comp?.company_name || ''}] 업체의 데이터만으로 분석합니다.\n입력한 행사 내용으로 즉시 제안서 PDF를 생성합니다. (수십 초 소요)`,
      onConfirm: async () => {
        setAdhocRunning(true);
        try {
          const fd = new FormData();
          fd.append('companyId', adhocCompany);
          fd.append('payload', JSON.stringify(buildAgencyPayload(adhocForm)));
          adhocImages.forEach((f) => fd.append('images', f));
          const res = await fetch('/api/campaign-agency/admin/design-adhoc', { method: 'POST', headers: auth(), body: fd });
          const d = await res.json();
          if (d.success) {
            toast.success('제안서가 생성되었습니다.');
            setShowAdhoc(false); setAdhocForm(EMPTY_AGENCY_FORM); setAdhocImages([]);
            await loadRows();
            pendingSummaryRef.current = d.summary || null;
            setSelectedId(d.summary?.requestId || null);
          } else toast.error(d.error || '실행 실패');
        } catch { toast.error('실행 실패'); } finally { setAdhocRunning(false); }
      },
    });
  };

  const statusChip = (status: string) => {
    const st = STATUS_OPTIONS.find((s) => s.value === status);
    return <span className={`text-[11px] px-2 py-0.5 rounded-full ${st?.chip || 'bg-gray-100 text-gray-500'}`}>{st?.label || status}</span>;
  };

  const closeDetail = () => { if (!running && !saving) setSelectedId(null); };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => goBackOr(navigate, '/admin')} className="text-gray-500 hover:text-gray-800 p-1.5 -ml-1.5 rounded-lg hover:bg-gray-100">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
            <Handshake className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 leading-tight">캠페인 대행 설계</div>
            <div className="text-[11px] text-gray-400">비즈니스+ 업체 전용. 선택한 업체의 데이터만 분석합니다</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => loadRows()} className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-800 border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg">
              <RefreshCw className="w-3.5 h-3.5" />새로고침
            </button>
            <button onClick={openAdhoc}
              className="inline-flex items-center gap-1.5 text-[13px] bg-violet-600 hover:bg-violet-700 text-white font-medium px-3.5 py-1.5 rounded-lg">
              <PenSquare className="w-3.5 h-3.5" />직접 설계
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        {/* 상태 필터 칩 */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setStatusFilter('')}
            className={`text-[12px] px-3 py-1.5 rounded-full border transition-colors ${statusFilter === '' ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
            전체
          </button>
          {STATUS_OPTIONS.map((s) => (
            <button key={s.value} onClick={() => setStatusFilter(s.value)}
              className={`text-[12px] px-3 py-1.5 rounded-full border transition-colors ${statusFilter === s.value ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
              {s.label}
            </button>
          ))}
        </div>

        {/* 요청 목록 */}
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-violet-600" />
            <span className="text-sm font-semibold text-gray-900">캠페인 설계 요청</span>
            <span className="text-[12px] text-gray-400">{rows.length}건</span>
          </div>
          {rows.length === 0 ? (
            <div className="text-sm text-gray-400 py-14 text-center">접수된 요청이 없습니다.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {rows.map((r) => {
                const p = r.parsed_json || {};
                return (
                  <button key={r.id} onClick={() => setSelectedId(r.id)}
                    className="w-full text-left px-4 py-3.5 hover:bg-violet-50/40 transition-colors flex items-center gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-gray-900">{r.company_name}</span>
                        {statusChip(r.status)}
                        {r.has_proposal && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">PDF</span>}
                      </div>
                      <div className="text-[13px] text-gray-600 truncate mt-0.5">{r.title}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {p.periodStart ? `${p.periodStart} ~ ${p.periodEnd || ''}` : '기간 미입력'}
                        {r.memo ? ` · ${r.memo}` : ''}
                      </div>
                    </div>
                    {r.images.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 shrink-0">
                        <ImagesIcon className="w-3.5 h-3.5" />{r.images.length}장
                      </span>
                    )}
                    {r.request_file_name && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 shrink-0">
                        <FileSpreadsheet className="w-3.5 h-3.5" />요청서
                      </span>
                    )}
                    <span className="text-[11px] text-gray-400 shrink-0">{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="text-[10px] text-gray-400 italic">Data source: campaign_agency_requests(실시간) · 분석은 선택 업체 단일 스코프</div>
      </div>

      {/* ══ 상세 모달 ══ */}
      {selected && (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-2 md:p-6">
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[94vh] md:h-[90vh] flex flex-col overflow-hidden">
            {running && (
              <div className="absolute inset-0 bg-white/85 backdrop-blur-sm z-20 flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-8 h-8 text-violet-600 animate-spin" />
                <div className="text-sm font-medium text-gray-700">[{selected.company_name}] 데이터 분석 중</div>
                <div className="text-[12px] text-gray-400">고객DB 현황 · AI 메모리 · 캠페인 이력{selected.images.length ? ' · 행사 이미지' : ''} (수십 초 소요, 창을 닫지 마세요)</div>
              </div>
            )}
            {/* 모달 헤더 */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200 shrink-0 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[15px] font-semibold text-gray-900">{selected.company_name}</span>
                  {statusChip(selected.status)}
                </div>
                <div className="text-[12px] text-gray-400 truncate">{selected.title} · {new Date(selected.created_at).toLocaleDateString('ko-KR')} 접수</div>
              </div>
              <select value={selected.status} onChange={(e) => changeStatus(selected.id, e.target.value)} disabled={busy}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-[12px] text-gray-600 bg-white">
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
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
              <button onClick={closeDetail} disabled={busy || saving}
                className="text-gray-400 hover:text-gray-700 p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30" aria-label="닫기">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 모달 본문 */}
            <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
              {/* 이미지 갤러리 */}
              {selected.images.length > 0 && (
                <div className="bg-gray-50/70 border border-gray-200 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2.5">
                    <ImagesIcon className="w-4 h-4 text-violet-600" />
                    <span className="text-[13px] font-semibold text-gray-900">행사 이미지 {selected.images.length}장</span>
                    <span className="text-[11px] text-gray-400">클릭하면 크게 볼 수 있습니다. 분석 실행 시 함께 판독됩니다</span>
                  </div>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {selected.images.map((im, i) => (
                      detailImageUrls[i] ? (
                        <button key={i} onClick={() => setLightboxUrl(detailImageUrls[i])}
                          className="border border-gray-200 rounded-xl overflow-hidden aspect-square cursor-zoom-in bg-white">
                          <img src={detailImageUrls[i]} alt={im.name} className="w-full h-full object-cover" />
                        </button>
                      ) : (
                        <div key={i} className="border border-gray-200 rounded-xl aspect-square flex items-center justify-center bg-white">
                          <Loader2 className="w-4 h-4 text-gray-300 animate-spin" />
                        </div>
                      )
                    ))}
                  </div>
                </div>
              )}

              {/* 고객 전달 메모 */}
              {selected.memo && (
                <div className="bg-violet-50/60 border border-violet-200 rounded-xl px-3.5 py-2.5">
                  <div className="text-[11px] text-violet-500 mb-0.5">고객사 전달 메모</div>
                  <div className="text-[13px] text-gray-700 whitespace-pre-wrap">{selected.memo}</div>
                </div>
              )}

              {missingRequired.length > 0 && (
                <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  필수 항목 누락: {missingRequired.join(' / ')}. 입력 후 분석을 실행할 수 있습니다.
                </div>
              )}

              {/* 행사 내용 보정 폼 */}
              <AgencyRequestForm theme="light" value={form} onChange={setForm} disabled={busy || saving} />

              {/* 직원 메모 */}
              <div className="bg-violet-50/40 border border-violet-200 rounded-2xl p-4">
                <div className="text-[13px] font-semibold text-gray-900 mb-2">직원 메모 (내부용)</div>
                <textarea value={staffNote} onChange={(e) => setStaffNote(e.target.value)} rows={2} disabled={busy || saving}
                  placeholder="진행 상황·특이사항 메모"
                  className="w-full bg-white border border-violet-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 resize-y focus:outline-none focus:border-violet-400" />
              </div>

              {/* 실행 결과 요약 */}
              {runSummary && (
                <div className="border border-violet-200 bg-violet-50/50 rounded-2xl p-4">
                  <div className="text-[13px] font-semibold text-gray-900 mb-2">생성 결과: 캠페인 플랜 {runSummary.plans?.length || 0}건</div>
                  <div className="space-y-1">
                    {(runSummary.plans || []).map((p: any, i: number) => (
                      <div key={i} className="text-[12px] text-gray-600">
                        · {p.title}: {String(p.channel || '').toUpperCase()} / 타겟 {p.targetCount != null ? `${Number(p.targetCount).toLocaleString()}명(실측)` : '실행 시 산정'} / 발송비 {p.estimatedCost != null ? `${Number(p.estimatedCost).toLocaleString()}원` : '실행 시 산정'}
                      </div>
                    ))}
                  </div>
                  {runSummary.imageTranscript && (
                    <div className="mt-2.5 bg-white border border-gray-200 rounded-xl px-3 py-2">
                      <div className="text-[11px] text-gray-400 mb-0.5">행사 이미지 판독 내용(전사)</div>
                      <div className="text-[12px] text-gray-600 whitespace-pre-wrap max-h-40 overflow-y-auto">{runSummary.imageTranscript}</div>
                    </div>
                  )}
                  {runSummary.dataNotes?.length > 0 && (
                    <div className="mt-2 text-[11px] text-gray-400">{runSummary.dataNotes.join(' · ')}</div>
                  )}
                </div>
              )}
              <div className="text-[10px] text-gray-400 italic">Data source: 접수 원문 + 업체 단일 스코프 분석(실시간)</div>
            </div>

            {/* 모달 푸터 */}
            <div className="px-5 py-4 border-t border-gray-200 shrink-0 flex items-center gap-2 flex-wrap">
              <div className="text-[11px] text-gray-400 min-w-0 flex-1">분석 실행 전 보정값이 자동 저장됩니다.</div>
              <button onClick={() => { saveCorrection().then((ok) => { if (ok) toast.success('저장했습니다.'); }); }} disabled={saving || busy}
                className="inline-flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 disabled:opacity-40 text-gray-700 text-sm px-4 py-2 rounded-xl">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}보정 저장
              </button>
              <button onClick={runDesign} disabled={busy || saving || missingRequired.length > 0}
                className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-xl">
                <Play className="w-4 h-4" />분석 실행 → 제안서 생성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ 직접 설계 모달 ══ */}
      {showAdhoc && (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-2 md:p-6">
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[94vh] md:h-[90vh] flex flex-col overflow-hidden">
            {adhocRunning && (
              <div className="absolute inset-0 bg-white/85 backdrop-blur-sm z-20 flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-8 h-8 text-violet-600 animate-spin" />
                <div className="text-sm font-medium text-gray-700">분석 · 제안서 생성 중</div>
                <div className="text-[12px] text-gray-400">수십 초 소요, 창을 닫지 마세요</div>
              </div>
            )}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200 shrink-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
                <PenSquare className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-gray-900 leading-tight">직접 설계</div>
                <div className="text-[11px] text-gray-400">업체 선택 + 행사 내용 입력 → 즉시 분석·제안서 생성 (1단계)</div>
              </div>
              <button onClick={() => setShowAdhoc(false)} disabled={adhocRunning}
                className="text-gray-400 hover:text-gray-700 p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30" aria-label="닫기">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
              <div className="bg-gray-50/70 border border-gray-200 rounded-2xl p-4">
                <div className="text-[13px] font-semibold text-gray-900 mb-2">분석 대상 업체 <span className="text-violet-600">*</span></div>
                <select value={adhocCompany} onChange={(e) => setAdhocCompany(e.target.value)} disabled={adhocRunning}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 bg-white">
                  <option value="">업체 선택 (비즈니스+ 활성 구독만 표시)</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name} · {c.plan_code}</option>)}
                </select>
                <div className="text-[11px] text-gray-400 mt-1.5">선택한 업체의 데이터만 분석합니다. 교차 분석 없음.</div>
              </div>
              <AgencyRequestForm theme="light" value={adhocForm} onChange={setAdhocForm} disabled={adhocRunning || adhocAnalyzing}
                images={adhocImages} onImagesChange={setAdhocImages} onImageError={(m) => toast.error(m)}
                onAnalyzeImages={analyzeAdhocImages} analyzing={adhocAnalyzing} />
            </div>
            <div className="px-5 py-4 border-t border-gray-200 shrink-0 flex items-center gap-2">
              <div className="text-[11px] text-gray-400 min-w-0 flex-1">실행 시 접수함에 "설계 중" 건으로 등록되고 즉시 분석됩니다.</div>
              <button onClick={runAdhoc} disabled={adhocRunning || adhocAnalyzing}
                className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-semibold px-5 py-2.5 rounded-xl">
                {adhocRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}분석 실행 → 제안서 생성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 이미지 라이트박스 */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-[80] bg-black/85 flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 text-white/80 hover:text-white p-2" aria-label="닫기" onClick={() => setLightboxUrl(null)}>
            <X className="w-6 h-6" />
          </button>
          <img src={lightboxUrl} alt="행사 이미지 확대" className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {confirmState && <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />}
    </div>
  );
}
