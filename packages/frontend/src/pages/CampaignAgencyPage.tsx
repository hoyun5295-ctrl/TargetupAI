// CRM 캠페인 대행 — 고객사 접수 (비즈니스+ 전용 특별 서비스)
// 스펙: docs/superpowers/specs/2026-07-09-crm-agency-webform-redesign-design.md
// ★ 2026-07-09 웹 폼 전환(Harold): xlsx 양식 다운로드/업로드 폐지 — 풀화면급 폼 모달 + 행사 이미지(≤5장) 접수.
// 접수만: 폼 작성 → 접수 → 이력(상태 읽기 전용 + 상세 모달). 제안서 설계·전달·대행은 한줄로 운영팀.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import {
  ArrowLeft, Handshake, Loader2, Sparkles, ClipboardList, PenSquare, X, Images as ImagesIcon, Send, FileDown,
} from 'lucide-react';
import { useToast } from '../components/ToastProvider';
// ★ 2026-08-20 제안서 다운로드 — 관리자 페이지와 같은 공용 헬퍼(lib/auth-download.ts).
import { downloadAuthFile } from '../lib/auth-download';
import AgencyRequestForm, {
  AgencyFormValue, EMPTY_AGENCY_FORM, agencyMissingLabels, buildAgencyPayload, parsedToFormValue, mergeAnalyzedIntoForm,
} from '../components/agency/AgencyRequestForm';

interface AgencyRequestRow {
  id: string;
  title: string;
  memo: string | null;
  status: string;
  parsed_json: any;
  images: Array<{ name: string }>;
  created_at: string;
  designed_at: string | null;
  /** ★ 2026-08-20 전달된 제안서 존재 — 서버가 다운로드 endpoint와 같은 판정(전달 이후 + PDF 실존)으로 내린다 */
  has_proposal?: boolean;
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
  // 접수 폼 모달
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AgencyFormValue>(EMPTY_AGENCY_FORM);
  const [images, setImages] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  // 접수 상세 모달
  const [detail, setDetail] = useState<AgencyRequestRow | null>(null);
  const [detailImageUrls, setDetailImageUrls] = useState<string[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

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

  // 상세 모달 이미지 로드 (인증 endpoint → blob URL)
  useEffect(() => {
    if (!detail || detail.images.length === 0) { setDetailImageUrls([]); return; }
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      for (let i = 0; i < detail.images.length; i++) {
        try {
          const res = await fetch(`/api/campaign-agency/requests/${detail.id}/images/${i}`, { headers: auth() });
          if (!res.ok) continue;
          const blob = await res.blob();
          if (cancelled) return;
          urls.push(URL.createObjectURL(blob));
          setDetailImageUrls([...urls]);
        } catch { /* 개별 이미지 실패 — 나머지 계속 */ }
      }
    })();
    return () => { cancelled = true; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [detail?.id]);

  const openForm = () => { setForm(EMPTY_AGENCY_FORM); setImages([]); setShowForm(true); };

  // 이미지 → AI 자동 입력 (빈 필드만 채움 + 상품 추가 — 입력분은 보존)
  const analyzeImages = async () => {
    if (images.length === 0) { toast.error('이미지를 먼저 올려주세요.'); return; }
    setAnalyzing(true);
    try {
      const fd = new FormData();
      images.forEach((f) => fd.append('images', f));
      const res = await fetch('/api/campaign-agency/requests/analyze-images', { method: 'POST', headers: auth(), body: fd });
      const d = await res.json();
      if (d.success && d.form) {
        setForm((cur) => mergeAnalyzedIntoForm(cur, d.form));
        toast.success('이미지 내용을 자동 입력했습니다 — 확인 후 접수해 주세요.');
      } else {
        toast.error(d.error || '이미지 판독에 실패했습니다.');
      }
    } catch {
      toast.error('이미지 판독에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally { setAnalyzing(false); }
  };

  const submit = async () => {
    const missing = agencyMissingLabels(form);
    if (missing.length > 0) { toast.error(`필수 항목을 입력해 주세요: ${missing.join(' / ')}`); return; }
    if (form.periodStart && form.periodEnd && form.periodEnd < form.periodStart) {
      toast.error('행사 종료일이 시작일보다 빠릅니다.'); return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('payload', JSON.stringify(buildAgencyPayload(form)));
      images.forEach((f) => fd.append('images', f));
      const res = await fetch('/api/campaign-agency/requests', { method: 'POST', headers: auth(), body: fd });
      const d = await res.json();
      if (d.success) {
        toast.success('접수되었습니다. 한줄로 운영팀이 확인 후 제안서를 준비해 드립니다.');
        setShowForm(false); setForm(EMPTY_AGENCY_FORM); setImages([]);
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

  const detailParsed = detail ? parsedToFormValue(detail.parsed_json || {}) : null;

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
              ['1. 요청 작성', '행사 내용을 폼에 적고 행사 이미지(최대 5장)를 올리면 접수 완료.'],
              ['2. 분석 · 제안서 전달', '귀사의 고객 데이터·캠페인 이력·행사 이미지를 분석해 "한줄로 마케팅 제안서"를 전달해 드립니다.'],
              ['3. 컨펌 후 대행 진행', '제안서를 확인해 주시면, 확정된 캠페인을 한줄로 운영팀이 설정·예약해 드립니다.'],
            ].map(([t, d]) => (
              <div key={t} className="bg-slate-950/40 border border-white/10 rounded-xl p-3.5">
                <div className="text-[13px] font-medium text-white mb-1">{t}</div>
                <div className="text-[12px] text-white/50 leading-relaxed">{d}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 요청 작성 CTA */}
        <div className="bg-gradient-to-r from-violet-500/15 via-fuchsia-500/10 to-indigo-500/15 border border-violet-400/25 rounded-2xl p-5 flex items-center gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-white mb-1">새 캠페인 대행 요청</div>
            <div className="text-[12px] text-white/50">행사 내용과 이미지를 알려주시면, 귀사 데이터만으로 맞춤 캠페인을 설계해 드립니다.</div>
          </div>
          <button onClick={openForm}
            className="inline-flex items-center gap-2 bg-violet-500/50 hover:bg-violet-500/70 text-violet-50 text-sm font-semibold px-5 py-3 rounded-xl transition-colors shrink-0">
            <PenSquare className="w-4 h-4" />대행 요청 작성
          </button>
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
                  <button key={r.id} onClick={() => setDetail(r)}
                    className="w-full text-left flex items-center gap-3 bg-slate-950/40 border border-white/10 hover:border-violet-400/40 rounded-xl px-3.5 py-3 flex-wrap transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-white/85 truncate">{r.title}</div>
                      {r.memo && <div className="text-[11px] text-white/40 truncate">{r.memo}</div>}
                    </div>
                    {r.images.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-white/45 shrink-0">
                        <ImagesIcon className="w-3.5 h-3.5" />{r.images.length}장
                      </span>
                    )}
                    {/* ★ 2026-08-20 전달된 제안서 — 상세 모달에서 바로 받을 수 있다는 신호 */}
                    {r.has_proposal && (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 shrink-0">
                        <FileDown className="w-3 h-3" />제안서 도착
                      </span>
                    )}
                    <span className={`text-[11px] px-2 py-1 rounded-full shrink-0 ${st.cls}`}>{st.label}</span>
                    <span className="text-[11px] text-white/35 shrink-0">{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="text-[10px] text-white/30 italic mt-3">Data source — 캠페인 대행 접수 이력(실시간)</div>
        </div>
      </div>

      {/* ══ 접수 폼 모달 (풀화면급) ══ */}
      {showForm && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 md:p-6">
          <div className="relative bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-4xl h-[94vh] md:h-[90vh] flex flex-col overflow-hidden">
            {submitting && (
              <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm z-20 flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-7 h-7 text-violet-300 animate-spin" />
                <div className="text-sm text-white/70">접수 중입니다 — 창을 닫지 마세요</div>
              </div>
            )}
            {/* 모달 헤더 */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10 shrink-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
                <PenSquare className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-white font-semibold leading-tight">캠페인 대행 요청 작성</div>
                <div className="text-[11px] text-white/40">적어주신 내용과 이미지 그대로 분석에 사용됩니다</div>
              </div>
              <button onClick={() => setShowForm(false)} disabled={submitting}
                className="text-white/50 hover:text-white p-2 rounded-lg hover:bg-white/5 disabled:opacity-30" aria-label="닫기">
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* 모달 본문 */}
            <div className="flex-1 overflow-y-auto p-4 md:p-5">
              <AgencyRequestForm theme="dark" value={form} onChange={setForm} disabled={submitting || analyzing}
                images={images} onImagesChange={setImages} onImageError={(m) => toast.error(m)}
                onAnalyzeImages={analyzeImages} analyzing={analyzing} />
            </div>
            {/* 모달 푸터 */}
            <div className="px-5 py-4 border-t border-white/10 shrink-0 flex items-center gap-3 flex-wrap">
              <div className="text-[11px] text-white/35 min-w-0 flex-1">접수 후 한줄로 운영팀이 확인하고, 귀사 데이터만으로 분석한 제안서를 전달해 드립니다.</div>
              <button onClick={submit} disabled={submitting || analyzing}
                className="inline-flex items-center gap-2 bg-violet-500/50 hover:bg-violet-500/70 disabled:opacity-40 text-violet-50 text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}접수하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ 접수 상세 모달 (읽기 전용) ══ */}
      {detail && detailParsed && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 md:p-6">
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10 shrink-0">
              <div className="min-w-0 flex-1">
                <div className="text-white font-semibold leading-tight truncate">{detail.title}</div>
                <div className="text-[11px] text-white/40">{new Date(detail.created_at).toLocaleDateString('ko-KR')} 접수</div>
              </div>
              <span className={`text-[11px] px-2 py-1 rounded-full shrink-0 ${(STATUS_LABEL[detail.status] || STATUS_LABEL.received).cls}`}>
                {(STATUS_LABEL[detail.status] || STATUS_LABEL.received).label}
              </span>
              {/* ★ 2026-08-20 제안서 다운로드 — 서버가 전달 이후에만 has_proposal을 내리고, endpoint도 같은 판정으로 재검증한다 */}
              {detail.has_proposal && (
                <button
                  onClick={() => downloadAuthFile(
                    `/api/campaign-agency/requests/${detail.id}/proposal`,
                    `한줄로_마케팅제안서_${detail.title.slice(0, 40)}.pdf`,
                    (m) => toast.error(m),
                  )}
                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 transition-colors shrink-0">
                  <FileDown className="w-3.5 h-3.5" />제안서 다운로드
                </button>
              )}
              <button onClick={() => setDetail(null)} className="text-white/50 hover:text-white p-2 rounded-lg hover:bg-white/5" aria-label="닫기">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {detailImageUrls.length > 0 && (
                <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                  {detailImageUrls.map((u, i) => (
                    <button key={i} onClick={() => setLightboxUrl(u)} className="border border-white/10 rounded-xl overflow-hidden aspect-square cursor-zoom-in">
                      <img src={u} alt={detail.images[i]?.name || `이미지 ${i + 1}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  ['행사 기간', `${detailParsed.periodStart || '-'} ~ ${detailParsed.periodEnd || '-'}`],
                  ['희망 채널', detailParsed.channels.length ? detailParsed.channels.join(', ') : '미지정 (운영팀 추천)'],
                  ['예산', detailParsed.budget ? `${Number(detailParsed.budget).toLocaleString()}원` : '미지정'],
                  ['혜택', detailParsed.benefit || '-'],
                ].map(([label, v]) => (
                  <div key={label} className="bg-slate-950/40 border border-white/10 rounded-xl px-3.5 py-2.5">
                    <div className="text-[11px] text-white/40 mb-0.5">{label}</div>
                    <div className="text-[13px] text-white/85 break-words">{v}</div>
                  </div>
                ))}
              </div>
              <div className="bg-slate-950/40 border border-white/10 rounded-xl px-3.5 py-2.5">
                <div className="text-[11px] text-white/40 mb-0.5">행사 내용</div>
                <div className="text-[13px] text-white/85 whitespace-pre-wrap leading-relaxed">{detailParsed.description || '-'}</div>
              </div>
              {detailParsed.products.length > 0 && (
                <div className="bg-slate-950/40 border border-white/10 rounded-xl px-3.5 py-2.5">
                  <div className="text-[11px] text-white/40 mb-1">대상 상품</div>
                  <div className="space-y-1">
                    {detailParsed.products.map((p, i) => (
                      <div key={i} className="text-[13px] text-white/80">
                        · {p.name}{p.price && ` — 정가 ${Number(p.price).toLocaleString()}원`}{p.salePrice && ` → 할인 ${Number(p.salePrice).toLocaleString()}원`}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {detailParsed.note && (
                <div className="bg-slate-950/40 border border-white/10 rounded-xl px-3.5 py-2.5">
                  <div className="text-[11px] text-white/40 mb-0.5">참고사항</div>
                  <div className="text-[13px] text-white/80 whitespace-pre-wrap">{detailParsed.note}</div>
                </div>
              )}
              <div className="text-[10px] text-white/30 italic">Data source — 접수 원문(실시간) · 상태는 운영팀 진행에 따라 갱신됩니다</div>
            </div>
          </div>
        </div>
      )}

      {/* 이미지 라이트박스 */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-[80] bg-black/85 flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
          <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2" aria-label="닫기" onClick={() => setLightboxUrl(null)}>
            <X className="w-6 h-6" />
          </button>
          <img src={lightboxUrl} alt="행사 이미지 확대" className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
