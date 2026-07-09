// CRM 캠페인 대행 — 고객사 접수 (2026-07-09, 비즈니스+ 전용 특별 서비스)
// 스펙: docs/superpowers/specs/2026-07-09-crm-campaign-agency-design.md §3
// 접수만: 양식 다운로드 → 작성 → 업로드 제출 → 이력(상태 읽기 전용). 제안서 설계·전달·대행은 한줄로 운영팀.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import {
  ArrowLeft, Handshake, Download, Upload, FileSpreadsheet, Loader2, Sparkles, ClipboardList,
} from 'lucide-react';
import { useToast } from '../components/ToastProvider';

interface AgencyRequestRow {
  id: string;
  title: string;
  memo: string | null;
  status: string;
  created_at: string;
  designed_at: string | null;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  received: { label: '접수됨', cls: 'bg-sky-500/15 text-sky-300' },
  designing: { label: '설계 중', cls: 'bg-violet-500/15 text-violet-300' },
  delivered: { label: '제안서 전달', cls: 'bg-emerald-500/15 text-emerald-300' },
  done: { label: '완료', cls: 'bg-white/10 text-white/60' },
  on_hold: { label: '보류', cls: 'bg-amber-500/15 text-amber-300' },
};

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

export default function CampaignAgencyPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [requests, setRequests] = useState<AgencyRequestRow[]>([]);
  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadRequests = async () => {
    try {
      const res = await fetch('/api/campaign-agency/requests', { headers: auth() });
      const d = await res.json();
      if (d.success) setRequests(d.requests || []);
    } catch { /* 이력 조회 실패 — 접수는 가능하므로 조용히 유지 */ }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/campaign-agency/eligibility', { headers: auth() });
        const d = await res.json();
        setEligible(!!d.eligible);
        if (d.eligible) await loadRequests();
      } catch { setEligible(false); }
    })();
  }, []);

  const downloadTemplate = async () => {
    try {
      const res = await fetch('/api/campaign-agency/template', { headers: auth() });
      if (!res.ok) { toast.error('양식 다운로드에 실패했습니다.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = '한줄로_캠페인대행요청서.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('양식 다운로드에 실패했습니다.'); }
  };

  const submit = async () => {
    if (!title.trim()) { toast.error('행사명을 입력해 주세요.'); return; }
    if (!file) { toast.error('작성한 요청서 파일을 첨부해 주세요.'); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('title', title.trim());
      fd.append('memo', memo.trim());
      fd.append('file', file);
      const res = await fetch('/api/campaign-agency/requests', { method: 'POST', headers: auth(), body: fd });
      const d = await res.json();
      if (d.success) {
        toast.success('접수되었습니다. 한줄로 운영팀이 확인 후 제안서를 준비해 드립니다.');
        setTitle(''); setMemo(''); setFile(null);
        if (fileRef.current) fileRef.current.value = '';
        await loadRequests();
      } else {
        toast.error(d.error || '접수에 실패했습니다.');
      }
    } catch {
      toast.error('접수에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally { setSubmitting(false); }
  };

  if (eligible === null) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
      </div>
    );
  }

  if (!eligible) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 max-w-md text-center">
          <div className="text-white font-semibold mb-2">비즈니스·엔터프라이즈 요금제 전용 서비스입니다</div>
          <div className="text-sm text-white/50 mb-5">캠페인 설계 대행은 비즈니스 요금제 이상에서 이용하실 수 있습니다.</div>
          <button onClick={() => navigate('/')} className="text-sm text-indigo-300 hover:text-indigo-200 px-4 py-2 border border-indigo-400/30 rounded-lg">대시보드로</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* sticky 헤더 */}
      <div className="bg-slate-950/80 backdrop-blur-sm sticky top-0 z-30 border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => goBackOr(navigate, '/')} className="text-white/60 hover:text-white p-1.5 -ml-1.5 rounded-lg hover:bg-white/5">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
            <Handshake className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-white font-semibold leading-tight">캠페인 설계 대행</div>
            <div className="text-[11px] text-white/40">비즈니스 요금제 전용 — 한줄로 운영팀이 설계해 드립니다</div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        {/* 서비스 안내 */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-violet-300" />
            <span className="text-sm font-semibold text-white">이렇게 진행됩니다</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              ['1. 요청서 접수', '신제품·행사 내용을 요청서 양식에 채워 업로드하시면 접수 완료.'],
              ['2. 분석 · 제안서 전달', '귀사의 고객 데이터와 캠페인 이력을 분석해 "한줄로 마케팅 제안서"를 전달해 드립니다.'],
              ['3. 컨펌 후 대행 진행', '제안서를 확인해 주시면, 확정된 캠페인을 한줄로 운영팀이 설정·예약해 드립니다.'],
            ].map(([t, d]) => (
              <div key={t} className="bg-slate-950/40 border border-white/10 rounded-xl p-3.5">
                <div className="text-[13px] font-medium text-white mb-1">{t}</div>
                <div className="text-[12px] text-white/50 leading-relaxed">{d}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 접수 폼 */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 relative">
          {submitting && (
            <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm rounded-2xl z-10 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-6 h-6 text-violet-300 animate-spin" />
              <div className="text-sm text-white/70">접수 중입니다 — 창을 닫지 마세요</div>
            </div>
          )}
          <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-violet-300" />
              <span className="text-sm font-semibold text-white">캠페인 대행 요청 접수</span>
            </div>
            <button onClick={downloadTemplate} className="inline-flex items-center gap-1.5 text-[13px] text-indigo-200 border border-indigo-400/30 hover:bg-indigo-500/20 px-3 py-1.5 rounded-lg transition-colors">
              <Download className="w-3.5 h-3.5" />요청서 양식 다운로드
            </button>
          </div>
          <div className="space-y-3">
            <input
              value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
              placeholder="행사명 (예: 7월 신제품 런칭 프로모션)"
              className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-400/60"
            />
            <textarea
              value={memo} onChange={(e) => setMemo(e.target.value)} rows={2}
              placeholder="전달하고 싶은 내용 (선택)"
              className="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-400/60 resize-y"
            />
            <label className="flex items-center gap-3 bg-slate-950/60 border border-dashed border-white/20 hover:border-violet-400/50 rounded-xl px-3.5 py-3 cursor-pointer transition-colors">
              <FileSpreadsheet className="w-5 h-5 text-emerald-300 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-white/80 truncate">{file ? file.name : '작성한 요청서(xlsx) 파일 선택'}</div>
                <div className="text-[11px] text-white/35">양식을 내려받아 작성한 뒤 그대로 올려주세요 (최대 10MB)</div>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx" className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <button
              onClick={submit} disabled={submitting}
              className="w-full md:w-auto inline-flex items-center justify-center gap-1.5 bg-violet-500/40 hover:bg-violet-500/60 disabled:opacity-40 text-violet-50 text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
            >
              <Upload className="w-4 h-4" />접수하기
            </button>
          </div>
        </div>

        {/* 내 접수 이력 */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList className="w-4 h-4 text-violet-300" />
            <span className="text-sm font-semibold text-white">접수 이력</span>
          </div>
          {requests.length === 0 ? (
            <div className="text-sm text-white/40 py-6 text-center">아직 접수한 요청이 없습니다.</div>
          ) : (
            <div className="space-y-2">
              {requests.map((r) => {
                const st = STATUS_LABEL[r.status] || STATUS_LABEL.received;
                return (
                  <div key={r.id} className="flex items-center gap-3 bg-slate-950/40 border border-white/10 rounded-xl px-3.5 py-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-white/85 truncate">{r.title}</div>
                      {r.memo && <div className="text-[11px] text-white/40 truncate">{r.memo}</div>}
                    </div>
                    <span className={`text-[11px] px-2 py-1 rounded-full shrink-0 ${st.cls}`}>{st.label}</span>
                    <span className="text-[11px] text-white/35 shrink-0">{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="text-[10px] text-white/30 italic mt-3">Data source — 캠페인 대행 접수 이력(실시간)</div>
        </div>
      </div>
    </div>
  );
}
