/**
 * ★ 2026-08-24 AI 영업 아웃리치 모달 (슈퍼관리자 ceo 전용 · 설계 = docs/2026-07-31-ai-sales-outreach-design.md §15-4)
 *
 * 톤 = 부모 화면(AdminDashboard 라이트 리터럴 · 블루 강조) 그대로. CUI/바이올렛 미사용(0824 도움말 탭 선례).
 * 산출물 미리보기 구역만 다크 액자(bg-slate-950) — 흰 이메일 카드가 라이트 지면에서 경계를 잃는 물리 문제의 해법.
 * 모달 1창 4단계: 입력 → 분석 → 읽은 것 확인(사람 게이트) → 제작·발송.
 *
 * 규율: portal + ESC 캡처 stopPropagation / 껍데기에 transform·backdrop-filter 0 / 백드롭 클릭 닫힘 0 /
 *   긴 작업은 close 차단 없이 서버 잡 + 2초 폴링("닫아도 계속됩니다") / 진행 표시는 실제 상태만(타이머 연출 0) /
 *   발송은 확인 모달 1회 경유 / 모델명·내부 용어 0.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, RefreshCw, Send, Check, ExternalLink, Pencil, Upload, Download, List } from 'lucide-react';
import ConfirmModal, { ConfirmState } from '../ConfirmModal';

interface IndustryOption { code: string; label: string }

interface OutreachAsset { kind: string; payload: any; created_at: string }

interface OutreachJob {
  id: string;
  company_name: string;
  industry_category: string | null;
  homepage_url: string;
  stage: string;
  stage_results?: Record<string, string> | null;
  event_quote?: { candidates?: any[]; selected?: any } | null;
  brand_profile?: { siteTitle?: string; excerpt?: string; imageCandidates?: string[]; selectedImageUrl?: string | null } | null;
  fail_stage?: string | null;
  fail_reason?: string | null;
  mail_result?: string | null;
  mail_sent_at?: string | null;
  mail_confirmed_at?: string | null;
  forwarded_at?: string | null;
  preview_code?: string | null;
  purged_at?: string | null;
  created_at?: string;
  assets?: OutreachAsset[];
}

const ACTIVE_STAGES = ['queued', 'crawling', 'analyzing', 'producing_copy', 'producing_image', 'producing_dm', 'producing_email'];
const STAGE_LABEL: Record<string, string> = {
  queued: '대기 중',
  crawling: '홈페이지 읽는 중',
  analyzing: '행사 정보 정리 중',
  awaiting_confirm: '확인 대기',
  producing_copy: '문안 만드는 중',
  producing_image: '이미지 만드는 중',
  producing_dm: '모바일 DM 만드는 중',
  producing_email: '제안 메일 조립 중',
  ready: '검토 대기',
  sent: '발송됨',
  failed: '실패',
};

async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem('token');
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
}

function latestAssetOf(job: OutreachJob | null, kind: string): any | null {
  if (!job?.assets) return null;
  const list = job.assets.filter((a) => a.kind === kind);
  return list.length ? list[list.length - 1].payload : null;
}

export default function SalesOutreachModal({ onClose }: { onClose: () => void }) {
  const [job, setJob] = useState<OutreachJob | null>(null);
  const [lastSummary, setLastSummary] = useState<OutreachJob | null>(null);
  const [industries, setIndustries] = useState<IndustryOption[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  // 입력 단계
  const [companyName, setCompanyName] = useState('');
  const [industryCode, setIndustryCode] = useState('');
  const [homepageUrl, setHomepageUrl] = useState('');

  // 확인 단계 선택
  const [eventChoice, setEventChoice] = useState<string>('none'); // 'none' | index 문자열 | 'manual'
  const [manualEventText, setManualEventText] = useState('');
  const [imageChoice, setImageChoice] = useState<string>('');     // '' = 이미지 없이

  // 검토 단계
  const [reviewTab, setReviewTab] = useState<'email' | 'copy' | 'dm' | 'image'>('email');
  const [copyDraft, setCopyDraft] = useState('');
  const [copyEditing, setCopyEditing] = useState(false);

  // 대량 업로드 · 진행 목록(0824 Harold: 일괄 등록 + 진행률 + 이력 + 건별 산출물 링크·메일 미리보기)
  const [listMode, setListMode] = useState(false);
  const [jobsList, setJobsList] = useState<OutreachJob[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<{ accepted: number; rejected: Array<{ label: string; reason: string }> } | null>(null);

  const jobRef = useRef<OutreachJob | null>(null);
  jobRef.current = job;

  // ESC 닫기(캡처 단계 · 부모로 전파 차단) — 확인 모달이 떠 있으면 그쪽이 우선
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmState) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, confirmState]);

  // 업종 목록 + 최근 실행 이어받기(mount 1회)
  useEffect(() => {
    (async () => {
      try {
        const r = await authFetch('/api/admin/industry-codes');
        const d = await r.json();
        if (Array.isArray(d?.industries)) setIndustries(d.industries);
      } catch { /* 목록 실패 = 셀렉트 비활성(폴백 축이라 치명 아님) */ }
      try {
        const r = await authFetch('/api/sales-outreach/jobs/latest');
        const d = await r.json();
        if (r.ok && d?.job) {
          setLastSummary(d.job);
          // 진행 중이거나 확인·검토 대기 건은 그대로 이어받는다(화면을 닫아도 잡은 계속 돈다)
          if (d.job.stage && d.job.stage !== 'sent') {
            await loadJob(d.job.id);
          }
        }
      } catch { /* 최근 건 없음 */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadJob = useCallback(async (id: string) => {
    try {
      const r = await authFetch(`/api/sales-outreach/jobs/${id}`);
      const d = await r.json();
      if (r.ok) {
        setJob(d);
        const copyAsset = latestAssetOf(d, 'copy');
        if (copyAsset?.body && !copyEditing) setCopyDraft(String(copyAsset.body));
      } else if (d?.code === 'DB_MIGRATION_PENDING') {
        setNotice(d.error || '준비 중입니다.');
      }
    } catch { /* 다음 폴링에서 회복 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyEditing]);

  // 진행 중 잡 2초 폴링 — 실제 상태만 그린다(연출 타이머 0)
  useEffect(() => {
    if (!job?.id || !ACTIVE_STAGES.includes(job.stage)) return;
    const t = setInterval(() => { loadJob(job.id); }, 2000);
    return () => clearInterval(t);
  }, [job?.id, job?.stage, loadJob]);

  const loadJobsList = useCallback(async () => {
    try {
      const r = await authFetch('/api/sales-outreach/jobs');
      const d = await r.json();
      if (r.ok && Array.isArray(d?.jobs)) setJobsList(d.jobs);
    } catch { /* 다음 폴링에서 회복 */ }
  }, []);

  // 목록 폴링(5초) — 진행 중 건이 있을 때만
  useEffect(() => {
    if (!listMode) return;
    loadJobsList();
    const t = setInterval(() => {
      setJobsList((cur) => {
        if (cur.some((j) => ACTIVE_STAGES.includes(j.stage))) loadJobsList();
        return cur;
      });
    }, 5000);
    return () => clearInterval(t);
  }, [listMode, loadJobsList]);

  const downloadTemplate = async () => {
    try {
      const r = await authFetch('/api/sales-outreach/template.xlsx');
      if (!r.ok) { setNotice('양식 다운로드에 실패했습니다.'); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'AI영업_업체목록_양식.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch { setNotice('양식 다운로드에 실패했습니다.'); }
  };

  const handleBulkFile = async (file: File | null) => {
    if (!file) return;
    setBulkBusy(true);
    setNotice(null);
    setBulkSummary(null);
    try {
      const token = localStorage.getItem('token');
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/sales-outreach/jobs/bulk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNotice(d?.error || '일괄 등록에 실패했습니다.');
        if (Array.isArray(d?.rejected) && d.rejected.length) {
          setBulkSummary({ accepted: 0, rejected: d.rejected.map((x: any) => ({ label: x.label || `${x.line}행`, reason: x.reason })) });
        }
        return;
      }
      setBulkSummary({ accepted: d.accepted || 0, rejected: Array.isArray(d.rejected) ? d.rejected : [] });
      setListMode(true);
      await loadJobsList();
    } catch {
      setNotice('업로드 요청에 실패했습니다. 네트워크를 확인해주세요.');
    } finally {
      setBulkBusy(false);
    }
  };

  const callAction = async (path: string, body?: any): Promise<boolean> => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await authFetch(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNotice(d?.error || '처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
        return false;
      }
      return true;
    } catch {
      setNotice('요청에 실패했습니다. 네트워크를 확인해주세요.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startAnalysis = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await authFetch('/api/sales-outreach/jobs', {
        method: 'POST',
        body: JSON.stringify({ companyName, industryCategory: industryCode || null, homepageUrl }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNotice(d?.error || '등록에 실패했습니다.');
        return;
      }
      setEventChoice('none');
      setManualEventText('');
      setImageChoice('');
      setCopyEditing(false);
      await loadJob(d.jobId);
    } catch {
      setNotice('요청에 실패했습니다. 네트워크를 확인해주세요.');
    } finally {
      setBusy(false);
    }
  };

  const confirmSelection = async () => {
    if (!job) return;
    const body: any = { imageUrl: imageChoice || null, industryCategory: industryCode || undefined };
    if (eventChoice === 'manual') body.manualEventText = manualEventText;
    else if (eventChoice !== 'none') body.eventIndex = Number(eventChoice);
    else body.eventIndex = null;
    if (await callAction(`/api/sales-outreach/jobs/${job.id}/confirm`, body)) {
      await loadJob(job.id);
    }
  };

  const sendMail = () => {
    if (!job) return;
    setConfirmState({
      mode: 'warning',
      title: '자사 수신함으로 발송합니다',
      description: '조립된 제안 메일을 회사 수신함으로 1통 발송합니다. 수신함에서 확인 후 업체에 전달하는 흐름입니다.',
      confirmLabel: '발송',
      onConfirm: async () => {
        setBusy(true);
        setNotice(null);
        try {
          const r = await authFetch(`/api/sales-outreach/jobs/${job.id}/send`, { method: 'POST' });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) {
            setNotice(d?.error || '발송에 실패했습니다.');
          } else if (d.outcome === 'sent') {
            setNotice(`발송되었습니다: ${d.to || '회사 수신함'}. 수신함 도착을 확인해주세요.`);
          } else if (d.outcome === 'rejected') {
            setNotice('수신 주소가 거부되었습니다. 수신함 주소 설정을 확인해주세요.');
          } else {
            setNotice(d.detail || '발송 결과를 확인하지 못했습니다. 수신함을 직접 확인해주세요.');
          }
          await loadJob(job.id);
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const saveCopy = async () => {
    if (!job) return;
    if (await callAction(`/api/sales-outreach/jobs/${job.id}/copy`, { body: copyDraft })) {
      setCopyEditing(false);
      setNotice('문안을 저장했습니다. 메일을 다시 조립하고 있습니다.');
      await loadJob(job.id);
    }
  };

  // ── 단계 판정 ──
  const stage = job?.stage || '';
  const step: 1 | 2 | 3 | 4 = !job ? 1
    : ['queued', 'crawling', 'analyzing'].includes(stage) ? 2
    : stage === 'awaiting_confirm' ? 3
    : 4;
  const failed = stage === 'failed';
  const producing = stage.startsWith('producing_');

  const candidates: any[] = Array.isArray(job?.event_quote?.candidates) ? job!.event_quote!.candidates! : [];
  const imageCandidates: string[] = Array.isArray(job?.brand_profile?.imageCandidates) ? job!.brand_profile!.imageCandidates! : [];
  const crawlUnavailable = job?.stage_results?.crawling === 'unavailable';
  const analyzeUnavailable = job?.stage_results?.analyzing === 'unavailable';

  const emailAsset = latestAssetOf(job, 'email_html');
  const dmAsset = latestAssetOf(job, 'dm');
  const imageAsset = latestAssetOf(job, 'studio_image');
  const copyAsset = latestAssetOf(job, 'copy');
  const previewUrl = job?.preview_code ? `${window.location.origin}/api/outreach/v/${job.preview_code}` : null;

  const stepChip = (n: 1 | 2 | 3 | 4, label: string) => {
    const isDone = step > n || (n === 4 && stage === 'sent');
    const isActive = step === n;
    return (
      <div key={n} className="flex items-center gap-2">
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
          failed && isActive ? 'bg-rose-100 text-rose-700'
          : isDone ? 'bg-emerald-100 text-emerald-700'
          : isActive ? 'bg-blue-600 text-white'
          : 'bg-gray-100 text-gray-400'
        }`}>
          {isDone ? <Check className="w-4 h-4" /> : n}
        </span>
        <span className={`text-sm ${isActive ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{label}</span>
      </div>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-[1100px] bg-white rounded-2xl border border-gray-200/70 shadow-2xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-gray-200/70 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">AI 영업</h2>
            <p className="text-xs text-gray-500 mt-0.5">업체 홈페이지를 읽고 맞춤 제안 세트를 만들어 회사 수신함으로 보냅니다</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setListMode(!listMode); if (!listMode) loadJobsList(); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border ${
                listMode ? 'border-blue-200 text-blue-600 bg-blue-50' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              <List className="w-4 h-4" /> {listMode ? '단건 등록' : '진행 목록'}
            </button>
            <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 스테퍼(단건 흐름 전용 — 목록 화면에서는 숨긴다) */}
        {!listMode && (
          <div className="px-6 py-3 border-b border-gray-200/70 flex items-center gap-6 shrink-0 flex-wrap">
            {stepChip(1, '입력')}
            {stepChip(2, '분석')}
            {stepChip(3, '읽은 것 확인')}
            {stepChip(4, '제작·발송')}
            {job && ACTIVE_STAGES.includes(stage) && (
              <span className="ml-auto flex items-center gap-2 text-xs text-gray-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                {STAGE_LABEL[stage] || '처리 중'} · 창을 닫아도 계속 진행됩니다
              </span>
            )}
          </div>
        )}

        {/* 알림 */}
        {notice && (
          <div className="mx-6 mt-3 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 shrink-0">
            {notice}
          </div>
        )}
        {/* 일괄 등록 결과 요약 — "전체 몇 곳 중 몇 곳 입력 OK" */}
        {bulkSummary && (
          <div className="mx-6 mt-3 px-4 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 shrink-0">
            전체 {bulkSummary.accepted + bulkSummary.rejected.length}곳 중 {bulkSummary.accepted}곳 입력 OK
            {bulkSummary.rejected.length > 0 && ` · 제외 ${bulkSummary.rejected.length}곳`}
            {bulkSummary.rejected.length > 0 && (
              <ul className="mt-1 text-xs text-blue-600 space-y-0.5">
                {bulkSummary.rejected.slice(0, 6).map((r, i) => <li key={i}>{r.label}: {r.reason}</li>)}
                {bulkSummary.rejected.length > 6 && <li>외 {bulkSummary.rejected.length - 6}건</li>}
              </ul>
            )}
          </div>
        )}

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* 진행 목록(이력) — 진행률 + 건별 산출물 링크 + 상세(메일 미리보기) 진입 */}
          {listMode && (() => {
            const total = jobsList.length;
            const activeN = jobsList.filter((j) => ACTIVE_STAGES.includes(j.stage)).length;
            const confirmN = jobsList.filter((j) => j.stage === 'awaiting_confirm').length;
            const readyN = jobsList.filter((j) => j.stage === 'ready').length;
            const sentN = jobsList.filter((j) => j.stage === 'sent').length;
            const failedN = jobsList.filter((j) => j.stage === 'failed').length;
            const processed = total - activeN;
            const pct = total ? Math.round((processed / total) * 100) : 0;
            const chip = (j: OutreachJob) => {
              if (j.stage === 'failed') return <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">실패</span>;
              if (j.stage === 'awaiting_confirm') return <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">확인 대기</span>;
              if (j.stage === 'ready') return <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">검토 대기</span>;
              if (j.stage === 'sent') return <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">발송됨</span>;
              return (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 inline-flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> {STAGE_LABEL[j.stage] || '진행 중'}
                </span>
              );
            };
            return (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="text-sm font-semibold text-gray-900">전체 {total}곳 · 자동 처리 완료 {processed}곳 ({pct}%)</div>
                    <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                      {activeN > 0 && <span>진행 중 {activeN}</span>}
                      {confirmN > 0 && <span className="text-amber-700 font-medium">확인 대기 {confirmN}</span>}
                      {readyN > 0 && <span className="text-blue-700">검토 대기 {readyN}</span>}
                      {sentN > 0 && <span className="text-emerald-700">발송됨 {sentN}</span>}
                      {failedN > 0 && <span className="text-rose-700">실패 {failedN}</span>}
                    </div>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                {total === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-gray-400 bg-gray-50 rounded-2xl">
                    아직 등록된 업체가 없습니다. 단건 등록 또는 엑셀 업로드로 시작해주세요.
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm divide-y divide-gray-100">
                    {jobsList.map((j) => {
                      const pv = j.preview_code && !j.purged_at ? `${window.location.origin}/api/outreach/v/${j.preview_code}` : null;
                      return (
                        <div key={j.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                              {j.company_name} {chip(j)}
                            </div>
                            <div className="text-xs text-gray-400 truncate">
                              {j.homepage_url}
                              {j.created_at ? ` · ${String(j.created_at).slice(0, 10)}` : ''}
                              {j.stage === 'failed' && j.fail_reason ? ` · ${j.fail_reason}` : ''}
                            </div>
                          </div>
                          {pv && (
                            <a href={pv} target="_blank" rel="noreferrer"
                              className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50">
                              <ExternalLink className="w-3.5 h-3.5" /> 산출물 페이지
                            </a>
                          )}
                          <button onClick={() => { loadJob(j.id); setListMode(false); }}
                            className="shrink-0 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium">
                            {j.stage === 'awaiting_confirm' ? '확인하기' : j.stage === 'ready' ? '검토·발송' : '열기'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-[10px] text-gray-400 italic">Data source: 등록된 업체별 자동 제작 진행 기록</p>
              </div>
            );
          })()}

          {/* 직전 실행 요약(재실행 경고 축) */}
          {!listMode && step === 1 && lastSummary && (
            <div className="mb-4 px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-200/70 text-xs text-gray-500">
              최근 실행: {lastSummary.company_name} · {STAGE_LABEL[lastSummary.stage] || lastSummary.stage}
              {lastSummary.created_at ? ` · ${String(lastSummary.created_at).slice(0, 10)}` : ''}
              {lastSummary.stage !== 'sent' && (
                <button onClick={() => loadJob(lastSummary.id)} className="ml-2 text-blue-600 hover:underline">이어서 보기</button>
              )}
            </div>
          )}

          {/* ① 입력 */}
          {!listMode && step === 1 && (
            <div className="max-w-lg space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">업체명</label>
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="예: 힐링뷰티"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">업종 <span className="text-gray-400 font-normal">(선택 · 홈페이지에서 못 읽으면 이 값을 씁니다)</span></label>
                <select value={industryCode} onChange={(e) => setIndustryCode(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  <option value="">선택 안 함</option>
                  {industries.map((i) => <option key={i.code} value={i.code}>{i.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">홈페이지 주소</label>
                <input value={homepageUrl} onChange={(e) => setHomepageUrl(e.target.value)}
                  placeholder="예: www.brand.co.kr"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <button onClick={startAnalysis} disabled={busy || !companyName.trim() || !homepageUrl.trim()}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                읽기 시작
              </button>

              {/* 대량 등록 — 엑셀 양식(옆에 작성 예시 포함)으로 한 번에 최대 20곳 */}
              <div className="mt-6 pt-5 border-t border-gray-200/70">
                <div className="text-sm font-medium text-gray-700 mb-1">여러 업체 한번에 등록</div>
                <p className="text-xs text-gray-500 mb-3">엑셀 양식을 받아 작성한 뒤 올리면 한 번에 최대 20곳을 순서대로 자동 처리합니다. 진행 상황은 [진행 목록]에서 봅니다.</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={downloadTemplate}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50">
                    <Download className="w-4 h-4" /> 엑셀 양식 받기
                  </button>
                  <label className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm cursor-pointer ${
                    bulkBusy ? 'bg-blue-300 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}>
                    {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    엑셀 업로드
                    <input type="file" accept=".xlsx,.xls" className="hidden" disabled={bulkBusy}
                      onChange={(e) => { handleBulkFile(e.target.files?.[0] || null); e.target.value = ''; }} />
                  </label>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 italic">Data source: 입력한 홈페이지를 읽고 AI가 분석합니다</p>
            </div>
          )}

          {/* ② 분석 중 */}
          {!listMode && step === 2 && job && (
            <div className="py-16 flex flex-col items-center gap-3 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              <div className="text-sm font-medium text-gray-900">{STAGE_LABEL[stage] || '분석 중'}</div>
              <div className="text-xs text-gray-500">{job.company_name} · {job.homepage_url}</div>
              <div className="text-xs text-gray-400">창을 닫아도 분석은 계속됩니다. 다시 열면 이어서 보입니다.</div>
            </div>
          )}

          {/* ③ 읽은 것 확인 */}
          {!listMode && step === 3 && job && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* 행사 후보 */}
                <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">홈페이지에서 읽은 행사</h3>
                  {crawlUnavailable && (
                    <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                      홈페이지를 읽지 못했습니다(접속 차단 또는 시간 초과). 아래에 행사 내용을 직접 붙여넣거나, 행사 없이 진행할 수 있습니다.
                    </div>
                  )}
                  {analyzeUnavailable && !crawlUnavailable && (
                    <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                      행사 분석이 일시적으로 실패했습니다. 직접 입력하거나 행사 없이 진행할 수 있습니다.
                    </div>
                  )}
                  <div className="space-y-2">
                    {candidates.map((c, i) => (
                      <label key={i} className={`block p-3 rounded-lg border cursor-pointer text-sm ${
                        eventChoice === String(i) ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                      }`}>
                        <input type="radio" name="so-event" className="mr-2" checked={eventChoice === String(i)}
                          onChange={() => setEventChoice(String(i))} />
                        <span className="text-gray-800">"{c.quote}"</span>
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                          {c.endDate && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">종료 {c.endDate}</span>}
                          {c.benefitLicensed
                            ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">혜택 문구 인용 가능</span>
                            : <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">혜택 숫자는 직접 입력 자리로</span>}
                        </div>
                      </label>
                    ))}
                    <label className={`block p-3 rounded-lg border cursor-pointer text-sm ${
                      eventChoice === 'none' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}>
                      <input type="radio" name="so-event" className="mr-2" checked={eventChoice === 'none'}
                        onChange={() => setEventChoice('none')} />
                      행사 없음 · 브랜드 일반형으로 제작
                    </label>
                    <label className={`block p-3 rounded-lg border cursor-pointer text-sm ${
                      eventChoice === 'manual' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}>
                      <input type="radio" name="so-event" className="mr-2" checked={eventChoice === 'manual'}
                        onChange={() => setEventChoice('manual')} />
                      행사 내용 직접 붙여넣기
                    </label>
                    {eventChoice === 'manual' && (
                      <textarea value={manualEventText} onChange={(e) => setManualEventText(e.target.value)}
                        rows={4} placeholder="홈페이지의 행사 안내 문구를 그대로 붙여넣어 주세요"
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    )}
                  </div>
                  {job.brand_profile?.excerpt && (
                    <p className="mt-3 text-[11px] text-gray-400">읽은 내용 일부: {job.brand_profile.excerpt.slice(0, 160)}…</p>
                  )}
                </div>

                {/* 이미지 후보 */}
                <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">대표 이미지</h3>
                  <p className="text-xs text-gray-500 mb-3">선택한 1장을 다듬어 포스터에 씁니다. 인물이 있는 사진은 자동 제외됩니다.</p>
                  {imageCandidates.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-gray-400 bg-gray-50 rounded-lg">
                      가져올 이미지를 찾지 못했습니다. 생성 이미지로만 제작합니다.
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {imageCandidates.map((url) => (
                        <button key={url} onClick={() => setImageChoice(imageChoice === url ? '' : url)}
                          className={`relative aspect-square rounded-lg overflow-hidden border-2 ${
                            imageChoice === url ? 'border-blue-500' : 'border-transparent hover:border-gray-300'
                          }`}>
                          <img src={url} alt="후보 이미지" className="w-full h-full object-cover" loading="lazy" />
                          {imageChoice === url && (
                            <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center">
                              <Check className="w-3 h-3" />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-[11px] text-gray-400">선택하지 않으면 생성 이미지로만 제작합니다.</p>
                  {industries.length > 0 && (
                    <div className="mt-4">
                      <label className="block text-xs font-medium text-gray-500 mb-1">업종 확인</label>
                      <select value={industryCode || job.industry_category || ''} onChange={(e) => setIndustryCode(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">선택 안 함</option>
                        {industries.map((i) => <option key={i.code} value={i.code}>{i.label}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={confirmSelection} disabled={busy || (eventChoice === 'manual' && !manualEventText.trim())}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  이 조합으로 제작 시작
                </button>
                <span className="text-[10px] text-gray-400 italic">Data source: 홈페이지 원문과 대조해 확인된 행사만 보입니다</span>
              </div>
            </div>
          )}

          {/* ④ 제작·검토·발송 */}
          {!listMode && step === 4 && job && (
            <div className="space-y-4">
              {failed && (
                <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-between gap-3">
                  <div className="text-sm text-rose-800">
                    {job.fail_reason || '처리에 실패했습니다.'}
                    <span className="ml-2 text-xs text-rose-400">({STAGE_LABEL[job.fail_stage || ''] || job.fail_stage})</span>
                  </div>
                  <button onClick={async () => { if (await callAction(`/api/sales-outreach/jobs/${job.id}/retry`)) await loadJob(job.id); }}
                    disabled={busy}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 text-sm hover:bg-rose-100 disabled:opacity-40">
                    <RefreshCw className="w-3.5 h-3.5" /> 재시도
                  </button>
                </div>
              )}
              {producing && (
                <div className="px-4 py-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {STAGE_LABEL[stage]} · 창을 닫아도 계속 진행됩니다
                </div>
              )}

              {(stage === 'ready' || stage === 'sent') && (
                <>
                  <div className="flex items-center gap-1 border-b border-gray-200/70">
                    {([['email', '제안 메일'], ['copy', '문안'], ['dm', '모바일 DM'], ['image', '이미지']] as const).map(([k, label]) => (
                      <button key={k} onClick={() => setReviewTab(k)}
                        className={`px-4 py-2 text-sm border-b-2 -mb-px ${
                          reviewTab === k ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
                    {/* 미리보기 — 다크 액자(흰 산출물의 경계 확보) */}
                    <div className="bg-slate-950 rounded-2xl p-4 min-h-[420px]">
                      {reviewTab === 'email' && (emailAsset?.html ? (
                        <iframe title="제안 메일 미리보기" srcDoc={emailAsset.html} sandbox=""
                          className="w-full h-[560px] bg-white rounded-xl border-0 mx-auto block max-w-[640px]" />
                      ) : <div className="text-white/40 text-sm p-8 text-center">조립된 메일이 없습니다</div>)}
                      {reviewTab === 'copy' && (
                        <div className="max-w-[640px] mx-auto">
                          {copyEditing ? (
                            <>
                              <textarea value={copyDraft} onChange={(e) => setCopyDraft(e.target.value)} rows={10}
                                className="w-full px-3 py-2 rounded-xl text-sm bg-white outline-none" />
                              <div className="mt-2 flex gap-2">
                                <button onClick={saveCopy} disabled={busy}
                                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm">저장하고 메일 재조립</button>
                                <button onClick={() => { setCopyEditing(false); setCopyDraft(String(copyAsset?.body || '')); }}
                                  className="px-4 py-2 rounded-lg text-sm text-white/70 hover:text-white">취소</button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="bg-white rounded-xl p-4 text-sm text-gray-800 whitespace-pre-wrap">{String(copyAsset?.body || '문안이 없습니다')}</div>
                              {stage === 'ready' && (
                                <button onClick={() => setCopyEditing(true)}
                                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white/80 hover:text-white border border-white/20">
                                  <Pencil className="w-3.5 h-3.5" /> 문안 수정
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                      {reviewTab === 'dm' && (
                        <div className="text-center py-16">
                          {dmAsset?.dmUrl ? (
                            <a href={dmAsset.dmUrl} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white text-gray-900 text-sm font-medium hover:bg-gray-100">
                              <ExternalLink className="w-4 h-4" /> 모바일 DM 열어보기
                            </a>
                          ) : <div className="text-white/40 text-sm">모바일 DM이 없습니다</div>}
                          {dmAsset?.dmUrl && <p className="mt-3 text-xs text-white/40 break-all">{dmAsset.dmUrl}</p>}
                        </div>
                      )}
                      {reviewTab === 'image' && (imageAsset?.url ? (
                        <img src={imageAsset.url} alt="대표 이미지" className="max-w-[480px] w-full mx-auto rounded-xl" />
                      ) : <div className="text-white/40 text-sm p-8 text-center">이미지가 없습니다</div>)}
                    </div>

                    {/* 근거 패널(화면에만 있는 것 · 메일에 안 들어감) */}
                    <div className="space-y-3">
                      <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-4">
                        <h4 className="text-xs font-semibold text-gray-500 mb-2">읽은 근거</h4>
                        {job.event_quote?.selected ? (
                          <p className="text-sm text-gray-700">"{job.event_quote.selected.quote}"</p>
                        ) : (
                          <p className="text-sm text-gray-400">행사 없이 일반형으로 제작했습니다.</p>
                        )}
                        {imageAsset?.skippedReason && (
                          <p className="mt-2 text-xs text-amber-600">{imageAsset.skippedReason}</p>
                        )}
                        {/* ★ 2026-09-03 참조 골격 — asset에 기록된 사실만 말한다(지어내지 않는다 · 설계서 §8-3) */}
                        {dmAsset?.structureRef ? (
                          <p className="mt-2 text-[11px] text-gray-500">
                            참조 골격 {Number(dmAsset.structureRef.sampleCount) || 0}건 중 1건을 모바일 DM 구성으로 참고했습니다.
                            {Array.isArray(dmAsset.structureRef.removed) && dmAsset.structureRef.removed.length > 0
                              ? ` 행사 근거·외부 콘텐츠 규칙으로 구성 ${dmAsset.structureRef.removed.length}개를 제외했습니다.`
                              : ''}
                          </p>
                        ) : copyAsset?.sampleTrained === false ? (
                          <p className="mt-2 text-[11px] text-gray-400">양식 샘플 학습 전(기본형)으로 제작되었습니다.</p>
                        ) : null}
                      </div>
                      {previewUrl && (
                        <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-4">
                          <h4 className="text-xs font-semibold text-gray-500 mb-2">공개 샘플 주소</h4>
                          <a href={previewUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 break-all hover:underline">{previewUrl}</a>
                          <p className="mt-1 text-[11px] text-gray-400">메일 속 [산출물 보기] 버튼이 여는 주소입니다. 기간이 지나면 닫힙니다.</p>
                        </div>
                      )}
                      <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-4 space-y-2">
                        {stage === 'ready' && (
                          <>
                            <button onClick={sendMail} disabled={busy}
                              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
                              <Send className="w-4 h-4" /> 자사 메일로 보내기
                            </button>
                            {job.mail_result && job.mail_result !== 'sent' && (
                              <p className="text-xs text-amber-600">직전 발송이 확인되지 않았습니다({job.mail_result === 'rejected' ? '수신 거부' : '결과 미확인'}). 다시 시도할 수 있습니다.</p>
                            )}
                          </>
                        )}
                        {stage === 'sent' && (
                          <>
                            <div className="text-sm text-emerald-700 font-medium flex items-center gap-1.5">
                              <Check className="w-4 h-4" /> 발송됨{job.mail_sent_at ? ` · ${String(job.mail_sent_at).slice(0, 16).replace('T', ' ')}` : ''}
                            </div>
                            {!job.mail_confirmed_at && (
                              <button onClick={async () => { if (await callAction(`/api/sales-outreach/jobs/${job.id}/mail-confirmed`)) await loadJob(job.id); }}
                                disabled={busy}
                                className="w-full px-4 py-2 rounded-lg border text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                                수신함에서 확인했습니다
                              </button>
                            )}
                            {!job.forwarded_at && (
                              <button onClick={async () => { if (await callAction(`/api/sales-outreach/jobs/${job.id}/forwarded`)) await loadJob(job.id); }}
                                disabled={busy}
                                className="w-full px-4 py-2 rounded-lg border text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                                업체에 전달했습니다
                              </button>
                            )}
                            {job.forwarded_at && <p className="text-xs text-gray-400">업체 전달 표시됨 · 공개 샘플 기간이 연장되었습니다.</p>}
                            <button onClick={() => { setJob(null); setLastSummary(job); setCompanyName(''); setHomepageUrl(''); setIndustryCode(''); }}
                              className="w-full px-4 py-2 rounded-lg border border-blue-200 text-sm text-blue-600 hover:bg-blue-50">
                              새 업체 시작
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
    </div>,
    document.body,
  );
}
