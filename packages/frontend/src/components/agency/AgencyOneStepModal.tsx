/**
 * AgencyOneStepModal — 요청서 원스텝 접수 (★ 2026-08-25(3) 신설 · Harold "요청서 규격화 + 원스텝")
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §17. ★2026-08-26(2) 통일 양식(Harold 승인) =
 * **파일 하나**(시트1 내용 + 시트2 고객리스트)를 올리면 서버가 파싱·검증·집계하고, 화면은
 * **상위 50건 샘플과 집계 숫자만** 받아 확인 화면을 그린다.
 * 접수하기를 누르면 같은 파일을 다시 보내 서버가 같은 분석을 거쳐 접수를 만든다(중간 상태 없음).
 *
 * ⛔ 문안·제목·광고는 요청서가 진실이다 — 여기서 고치지 않는다(고치려면 요청서를 고쳐 다시 올린다).
 *   확인 화면에서 바꿀 수 있는 것 = 보낼 시각 · 회신번호 선택 · 담당자 번호 · 이미지.
 * ⛔ 회신번호를 열로 지정하면 접수가 회신번호별로 나뉜다 — 그 사실을 화면이 숫자로 안내한다.
 * ⛔ 문구에 줄표 0. 톤 = 인디고 콘솔(CUI_*).
 */
import { useRef, useState } from 'react';
// (useRef = 파일 입력과 분석 세대 가드에 쓴다)
import { createPortal } from 'react-dom';
import {
  AlertTriangle, ArrowLeft, Check, ChevronLeft, ChevronRight, Download, FileSpreadsheet,
  Image as ImageIcon, Loader2, Send, Upload, X,
} from 'lucide-react';
import { useToast } from '../ToastProvider';
import { useMmsUpload } from '../../hooks/useMmsUpload';
import MmsUploadModal from '../MmsUploadModal';
import {
  CUI_BTN_GHOST, CUI_BTN_OUTLINE, CUI_BTN_PRIMARY, CUI_DANGER_BOX, CUI_DANGER_ICON, CUI_DANGER_TEXT,
  CUI_HINT, CUI_INPUT, CUI_LABEL, CUI_MODAL, CUI_MODAL_BODY, CUI_MODAL_CLOSE, CUI_MODAL_DESC,
  CUI_MODAL_FOOT, CUI_MODAL_HEAD, CUI_MODAL_TITLE, CUI_SELECT,
} from '../../utils/console-ui';
import {
  formatWhen, previewOneStep, submitOneStep, toLocalInput,
  type AgencySendRequest, type OneStepAnalysisView, type OneStepOverrides,
} from './agency-send-api';

interface SenderNumber { phone_number?: string; phone?: string; is_default?: boolean }

interface Props {
  show: boolean;
  onClose: () => void;
  onCreated: (requests: AgencySendRequest[]) => void;
}

const ONLY_DIGITS = (s: string) => String(s || '').replace(/[^0-9]/g, '');

/** 파일 받는 칸 하나(드래그 + 클릭) */
function FileSlot({ label, hint, file, onFile, accent }: {
  label: string; hint: string; file: File | null; onFile: (f: File) => void; accent?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <label className={CUI_LABEL}>{label}</label>
      <input ref={ref} type="file" accept=".xlsx,.xls,.csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      <div
        role="button"
        tabIndex={0}
        onClick={() => ref.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') ref.current?.click(); }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        className={`rounded-xl border-2 border-dashed transition cursor-pointer grid place-items-center py-7 px-5 text-center focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-600/15 ${
          file ? 'border-emerald-300 bg-emerald-50/40' : accent ? 'border-indigo-300 bg-indigo-50/40 hover:border-indigo-400' : 'border-neutral-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/40'
        }`}
      >
        {file ? (
          <span className="flex items-center gap-2 text-[13.5px] font-semibold text-neutral-800">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" strokeWidth={2} />
            <span className="truncate max-w-[220px]">{file.name}</span>
          </span>
        ) : (
          <>
            <span className="h-9 w-9 rounded-xl bg-white ring-1 ring-neutral-200 text-indigo-600 grid place-items-center mb-2">
              <Upload className="w-4 h-4" strokeWidth={2} />
            </span>
            <p className="text-[13px] font-semibold text-neutral-800">{label} 올리기</p>
            <p className={`${CUI_HINT} mt-0.5`}>{hint}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function AgencyOneStepModal({ show, onClose, onCreated }: Props) {
  const toast = useToast();
  const [phase, setPhase] = useState<'upload' | 'confirm'>('upload');
  // ★2026-08-26(2) 통일 양식 = 파일 하나(내용 + 고객리스트 시트). 명단 슬롯은 폐지했다.
  const [formFile, setFormFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<OneStepAnalysisView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 확인 화면에서 바꾸는 것들
  const [requestedAt, setRequestedAt] = useState('');
  const [callbackChoice, setCallbackChoice] = useState('');
  const [phoneColumnChoice, setPhoneColumnChoice] = useState('');
  // 문안 항목 → 명단 열. 초회 분석의 결과(같은 이름 자동 + AI 추천)로 채우고, 이후엔 화면이 진실이다
  const [varMapping, setVarMapping] = useState<Record<string, string>>({});
  const [aiPickedVars, setAiPickedVars] = useState<Set<string>>(new Set());
  const [managerPhones, setManagerPhones] = useState<string[]>([]);
  const [managerInput, setManagerInput] = useState('');
  const [senders, setSenders] = useState<string[]>([]);
  const [samplePage, setSamplePage] = useState(0);
  // 명단 미리보기(엑셀 모양 상위 50행) 창. CUI_MODAL 껍데기가 overflow-hidden이라 포탈로 띄운다
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mmsOpen, setMmsOpen] = useState(false);
  const mms = useMmsUpload((m) => toast.error(m));
  // 재분석 응답의 세대 번호 — 늦게 도착한 옛 응답이 최신 화면을 덮지 못하게 한다
  const analyzeSeq = useRef(0);

  const reset = () => {
    setPhase('upload'); setFormFile(null); setAnalysis(null);
    setRequestedAt(''); setCallbackChoice(''); setPhoneColumnChoice(''); setManagerPhones([]); setManagerInput('');
    setVarMapping({}); setAiPickedVars(new Set());
    setSamplePage(0); setPreviewOpen(false); mms.setMmsUploadedImages([]);
    analyzeSeq.current += 1;
  };
  const close = () => {
    if (saving) return; // 접수 확정 중에는 닫지 못한다 — 결과를 못 본 채 화면이 사라지면 재제출로 이어진다
    reset(); onClose();
  };

  /** 파일이 바뀌면 이전 분석은 전부 무효다(★Codex 적대 2R — 옛 파일의 분석으로 새 파일을 접수하면 안 된다) */
  const replaceFile = (f: File) => {
    if (loading || saving) return;
    analyzeSeq.current += 1;
    setAnalysis(null);
    setFormFile(f);
  };

  const loadSenders = async () => {
    try {
      const res = await fetch('/api/companies/callback-numbers', { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } });
      const data = await res.json();
      const list: SenderNumber[] = data?.numbers || [];
      setSenders([...new Set(list.map((s) => ONLY_DIGITS(s.phone || s.phone_number || '')).filter(Boolean))]);
    } catch {
      setSenders([]);
    }
  };

  /**
   * 확인 화면 스냅샷 **전체**를 항상 보낸다. 비운 시각·전부 지운 담당자도 그대로 보내 서버가 반려하게
   * 한다 — 값을 안 보내면 서버가 요청서 원값으로 조용히 복귀해, 화면과 다른 값으로 접수된다.
   */
  const currentOverrides = (a: OneStepAnalysisView | null): OneStepOverrides => {
    const o: OneStepOverrides = {
      mmsImagePaths: mms.mmsUploadedImages.map((i) => i.serverPath),
      requestedAt: requestedAt ? new Date(requestedAt).toISOString() : '',
      managerPhones,
      // 항목이 없어도 빈 객체를 보낸다 — 접수 확정은 화면이 보여준 매핑으로만 간다
      varMapping,
    };
    if (phoneColumnChoice) o.phoneColumn = phoneColumnChoice;
    if (callbackChoice) {
      o.callback = callbackChoice.startsWith('col:')
        ? { mode: 'column', column: callbackChoice.slice(4) }
        : { mode: 'fixed', number: callbackChoice };
    } else if (a?.callback && a.callback.mode !== 'none') {
      o.callback = a.callback;
    }
    return o;
  };

  const analyze = async (withOverrides: boolean) => {
    if (saving) return;
    if (!formFile) { toast.error('요청서 파일을 올려 주세요.'); return; }
    const seq = ++analyzeSeq.current;
    setLoading(true);
    try {
      const a = await previewOneStep(formFile, null, withOverrides ? currentOverrides(analysis) : { mmsImagePaths: mms.mmsUploadedImages.map((i) => i.serverPath) });
      if (seq !== analyzeSeq.current) return; // 그 사이 새 분석이 시작됐다 — 이 응답은 버린다
      setAnalysis(a);
      setSamplePage(0);
      if (!withOverrides) {
        setRequestedAt(a.requestedAt ? toLocalInput(new Date(a.requestedAt)) : '');
        setManagerPhones(a.managerPhones);
        setCallbackChoice(a.callback.mode === 'fixed' ? a.callback.number : a.callback.mode === 'column' ? `col:${a.callback.column}` : '');
        setPhoneColumnChoice(a.phoneColumn || '');
        // 서버 초회 분석의 매핑(같은 이름 자동 + AI 추천)을 그대로 물려받는다.
        // 이후 접수 확정은 이 상태를 조정값으로 보내므로, 화면에 보인 열 그대로 접수된다.
        setVarMapping(Object.fromEntries(a.varsMatched.filter((v) => v.column).map((v) => [v.name, v.column!])));
        setAiPickedVars(new Set(a.varsMatched.filter((v) => v.via === 'ai').map((v) => v.name)));
      }
      if (senders.length === 0) loadSenders();
      setPhase('confirm');
    } catch (e: any) {
      if (seq === analyzeSeq.current) toast.error(e?.message || '파일을 분석하지 못했습니다.');
    } finally {
      if (seq === analyzeSeq.current) setLoading(false);
    }
  };

  const submit = async () => {
    if (saving || loading || !formFile || !analysis) return;
    if (analysis.errors.length > 0) { toast.error('반려 사유를 먼저 해결해 주세요.'); return; }
    const seq = analyzeSeq.current; // 제출은 지금 보고 있는 분석 세대에 묶인다
    setSaving(true);
    try {
      const created = await submitOneStep(formFile, null, currentOverrides(analysis));
      if (seq !== analyzeSeq.current) return; // 그 사이 파일이 바뀌었다 — 이 응답으로 화면을 건드리지 않는다
      toast.success(`${created.length}건 접수했습니다. 스팸 검사를 마치면 담당자 번호로 문자를 보내 드립니다.`);
      onCreated(created);
      close();
    } catch (e: any) {
      if (seq !== analyzeSeq.current) return;
      if (Array.isArray(e?.errors) && e.errors.length > 0) {
        setAnalysis({ ...analysis, errors: e.errors });
        toast.error(e.errors[0]?.error || e.message);
      } else {
        toast.error(e?.message || '접수하지 못했습니다.');
      }
    } finally {
      setSaving(false);
    }
  };

  const addManager = () => {
    const phone = ONLY_DIGITS(managerInput);
    if (phone.length < 10) { toast.error('휴대폰 번호를 확인해 주세요.'); return; }
    if (!managerPhones.includes(phone) && managerPhones.length < 10) setManagerPhones([...managerPhones, phone]);
    setManagerInput('');
  };

  if (!show) return null;
  const a = analysis;
  const columnMode = a?.callback.mode === 'column' || callbackChoice.startsWith('col:');
  // 명단 미리보기의 역할 열 표시(수신자·회신번호·문안 항목) — 화면 상태가 진실이다
  const phoneCol = phoneColumnChoice || a?.phoneColumn || null;
  const cbCol = callbackChoice.startsWith('col:')
    ? callbackChoice.slice(4)
    : (a?.callback.mode === 'column' ? a.callback.column : null);
  const varsFor = (h: string) => Object.entries(varMapping).filter(([, c]) => c === h).map(([n]) => n);
  const previewRows = a ? a.sampleRows.slice(samplePage * 10, samplePage * 10 + 10) : [];
  const messageType: 'SMS' | 'LMS' | 'MMS' = mms.mmsUploadedImages.length > 0 ? 'MMS' : (a?.messageType === 'MMS' ? 'LMS' : a?.messageType || 'SMS');

  return (
    <div className="fixed inset-0 z-[60] bg-neutral-900/45 flex items-center justify-center p-4">
      <div className={`${CUI_MODAL} max-w-[960px]`} role="dialog" aria-modal="true" aria-label="요청서로 접수">
        <div className={CUI_MODAL_HEAD}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-indigo-600 text-white grid place-items-center">
              <FileSpreadsheet className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h3 className={CUI_MODAL_TITLE}>요청서로 접수</h3>
              <p className={CUI_MODAL_DESC}>
                {phase === 'upload'
                  ? '요청서 파일 하나면 끝납니다'
                  : a ? `보낼 번호 ${a.counts.valid.toLocaleString()}건이 준비됐습니다` : ''}
              </p>
            </div>
          </div>
          <button type="button" onClick={close} className={CUI_MODAL_CLOSE} aria-label="닫기">
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className={CUI_MODAL_BODY}>
          {phase === 'upload' ? (
            <div className="max-w-[560px] mx-auto space-y-5">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-indigo-600/15 bg-indigo-50 px-4 py-3">
                <p className="text-[13px] text-indigo-900 leading-relaxed">
                  처음이시면 요청서 양식부터 받아 주세요. 첫 시트(내용)에 문안과 보낼 시각, 회신번호, 담당자 번호를 적고, 고객리스트 시트에 명단을 채우면 파일 하나로 접수가 끝납니다.
                </p>
                <a href="/agency-request-form.xlsx" download="대행발송_요청서_양식.xlsx" className={`${CUI_BTN_OUTLINE} shrink-0`}>
                  <Download className="w-[15px] h-[15px]" />양식 내려받기
                </a>
              </div>
              <FileSlot label="요청서" hint="내용 시트와 고객리스트 시트를 채운 엑셀 파일 하나" file={formFile} onFile={replaceFile} accent />
              <p className={CUI_HINT}>이미지 문자가 필요하면 다음 화면에서 이미지를 넣을 수 있습니다.</p>
            </div>
          ) : a && (
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_320px] gap-6">
              {/* ══ 왼쪽: 요청서 내용 확인 ══ */}
              <div className="space-y-5 min-w-0">
                {a.errors.length > 0 && (
                  <div className={CUI_DANGER_BOX}>
                    <AlertTriangle className={CUI_DANGER_ICON} size={16} strokeWidth={2} />
                    <div className={CUI_DANGER_TEXT}>
                      <p className="font-bold mb-1">접수 전에 해결할 것이 {a.errors.length}건 있습니다</p>
                      {a.errors.map((e, i) => <p key={i}>{e.field}: {e.error}</p>)}
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[14px] font-bold tracking-[-0.01em]">{a.subject || '(제목 없음)'}</p>
                    <span className="inline-flex items-center h-[21px] px-2 rounded-md bg-indigo-100 text-indigo-700 text-[11.5px] font-bold">{messageType}</span>
                    {a.isAd && <span className="inline-flex items-center h-[21px] px-2 rounded-md bg-amber-100 text-amber-800 text-[11.5px] font-bold">광고</span>}
                    {mms.mmsUploadedImages.length > 0 && (
                      <span className="inline-flex items-center h-[21px] px-2 rounded-md bg-neutral-100 text-neutral-600 text-[11.5px] font-bold">이미지 {mms.mmsUploadedImages.length}장</span>
                    )}
                  </div>
                  <div className="mt-2 rounded-xl bg-neutral-100 px-4 py-3 text-[13px] leading-relaxed text-neutral-900 max-h-[150px] overflow-y-auto">
                    <p className="whitespace-pre-wrap break-words">{a.content}</p>
                  </div>
                  <p className={CUI_HINT}>
                    문안과 제목을 고치려면 요청서를 고쳐 다시 올려 주세요.
                    {a.varsMatched.length > 0 && ' %항목% 자리는 아래 문안 항목 칸에서 명단의 열과 맞춥니다.'}
                  </p>
                </div>

                {a.varsMatched.length > 0 && (
                  <div>
                    <label className={CUI_LABEL}>문안 항목</label>
                    <div className="space-y-2">
                      {a.varsMatched.map((v) => (
                        <div key={v.name} className="flex items-center gap-2">
                          <span className="inline-flex items-center shrink-0 h-[34px] px-2.5 rounded-lg bg-indigo-50 text-indigo-700 text-[12.5px] font-bold max-w-[160px]">
                            <span className="truncate">%{v.name}%</span>
                          </span>
                          <select
                            value={varMapping[v.name] || ''}
                            onChange={(e) => {
                              setVarMapping({ ...varMapping, [v.name]: e.target.value });
                              setAiPickedVars((prev) => { const next = new Set(prev); next.delete(v.name); return next; });
                            }}
                            onBlur={() => analyze(true)}
                            disabled={saving}
                            className={CUI_SELECT}
                            aria-label={`${v.name} 항목에 넣을 명단의 열`}
                          >
                            {!varMapping[v.name] && <option value="">맞는 열을 못 찾았습니다. 골라 주세요</option>}
                            {a.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                          </select>
                          {aiPickedVars.has(v.name) && !!varMapping[v.name] && (
                            <span className="shrink-0 text-[11.5px] font-semibold text-indigo-600">AI가 골랐습니다</span>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className={CUI_HINT}>각 고객의 이 열 값이 문안의 %항목% 자리에 들어갑니다. 이름이 같은 열은 자동으로 맞습니다.</p>
                  </div>
                )}

                <div>
                  <label className={CUI_LABEL}>보낼 시각 <span className="text-rose-500">*</span></label>
                  <input type="datetime-local" value={requestedAt} onChange={(e) => setRequestedAt(e.target.value)} disabled={saving} className={CUI_INPUT} />
                  {/* ★0826(6) 촉박한 요청은 거절하지 않고 뒤로 미뤄 접수한다. 그 사실을 접수 전에 알린다(조용한 조정 금지) */}
                  {a.timeShifted && a.shiftedAt && (
                    <p className="mt-1.5 text-[12.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      적으신 시각은 문안 검사와 승인에 필요한 시간이 촉박해, 접수하면 <b>{formatWhen(a.shiftedAt)}</b>으로 잡힙니다.
                      다른 시각을 원하시면 위에서 바꿔 주세요.
                    </p>
                  )}
                </div>

                <div>
                  <label className={CUI_LABEL}>회신번호 <span className="text-rose-500">*</span></label>
                  <select
                    value={callbackChoice}
                    onChange={(e) => setCallbackChoice(e.target.value)}
                    onBlur={() => analyze(true)}
                    disabled={saving}
                    className={CUI_SELECT}
                  >
                    {callbackChoice && !callbackChoice.startsWith('col:') && !senders.includes(callbackChoice) && (
                      <option value={callbackChoice}>{callbackChoice} (요청서)</option>
                    )}
                    {senders.map((s) => <option key={s} value={s}>{s}</option>)}
                    {a.headers.filter((h) => h !== a.phoneColumn).map((h) => (
                      <option key={`col:${h}`} value={`col:${h}`}>명단의 열: {h}</option>
                    ))}
                  </select>
                  <p className={CUI_HINT}>명단의 열을 고르면 회신번호별로 접수가 나뉩니다. 바꾸면 집계를 다시 계산합니다.</p>
                </div>

                <div>
                  <label className={CUI_LABEL}>테스트 문자를 받을 담당자 <span className="text-rose-500">*</span></label>
                  {managerPhones.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {managerPhones.map((phone) => (
                        <span key={phone} className="inline-flex items-center gap-1.5 h-[30px] pl-2.5 pr-1.5 rounded-lg bg-neutral-100 text-[13px] font-semibold text-neutral-700 tabular-nums">
                          {phone}
                          <button type="button" onClick={() => setManagerPhones(managerPhones.filter((p) => p !== phone))} disabled={saving}
                            className="h-5 w-5 grid place-items-center rounded-md text-neutral-400 hover:text-rose-500 hover:bg-rose-50 disabled:opacity-40 disabled:pointer-events-none" aria-label="이 번호 빼기">
                            <X className="w-3 h-3" strokeWidth={2.4} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input value={managerInput} onChange={(e) => setManagerInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManager(); } }}
                      disabled={saving} className={CUI_INPUT} placeholder="번호를 넣고 Enter를 누르면 추가됩니다" />
                    <button type="button" onClick={addManager} disabled={saving} className={`${CUI_BTN_OUTLINE} shrink-0`}>추가</button>
                  </div>
                </div>

                <button type="button" onClick={() => setMmsOpen(true)} disabled={saving} className={CUI_BTN_OUTLINE}>
                  <ImageIcon className="w-[15px] h-[15px]" />
                  {mms.mmsUploadedImages.length > 0 ? `이미지 ${mms.mmsUploadedImages.length}장 첨부됨` : '이미지 넣기 (이미지 문자로 전환)'}
                </button>
              </div>

              {/* ══ 오른쪽: 집계·샘플 ══ */}
              <div className="space-y-4 min-w-0">
                <div className="rounded-xl border border-neutral-200 bg-white p-4">
                  <p className="text-[13px] font-bold mb-2.5">보낼 번호 <span className="tabular-nums text-indigo-600">{a.counts.valid.toLocaleString()}</span>건</p>
                  <div className="space-y-1.5 text-[12.5px] text-neutral-500">
                    <p className="flex justify-between"><span>명단의 행</span><b className="tabular-nums text-neutral-900">{a.counts.total.toLocaleString()}</b></p>
                    <p className="flex justify-between"><span>같은 번호 제외</span><b className="tabular-nums text-neutral-900">{a.counts.dup.toLocaleString()}</b></p>
                    <p className="flex justify-between"><span>형식이 다른 번호 제외</span><b className="tabular-nums text-neutral-900">{a.counts.invalid.toLocaleString()}</b></p>
                    {columnMode && (
                      <p className="flex justify-between"><span>회신번호 없는 행 제외</span><b className="tabular-nums text-neutral-900">{a.counts.callbackMissing.toLocaleString()}</b></p>
                    )}
                  </div>
                </div>

                {columnMode && a.groups.length > 0 && (
                  <div className="rounded-xl border border-indigo-600/20 bg-indigo-50/50 p-4">
                    <p className="text-[13px] font-bold text-indigo-900 mb-1">회신번호 {a.groups.length}종, 접수가 {a.groups.length}건으로 나뉩니다</p>
                    <p className="text-[12px] text-indigo-900/70 leading-snug mb-2.5">각 건마다 문안 검사와 담당자 문자, 승인이 따로 갑니다.</p>
                    <div className="space-y-1.5">
                      {a.groups.slice(0, 8).map((g) => (
                        <p key={g.callback} className="flex items-center justify-between text-[12.5px]">
                          <span className="tabular-nums font-semibold text-neutral-800">{g.callback}</span>
                          <span className="flex items-center gap-1.5">
                            <b className="tabular-nums text-neutral-900">{g.count.toLocaleString()}명</b>
                            {!g.registered && <span className="inline-flex items-center h-[19px] px-1.5 rounded bg-rose-100 text-rose-800 text-[11px] font-bold">미등록</span>}
                          </span>
                        </p>
                      ))}
                      {a.groups.length > 8 && <p className="text-[12px] text-neutral-500">그 외 {a.groups.length - 8}종</p>}
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-neutral-200 bg-white p-4">
                  <p className="text-[13px] font-bold mb-2.5">명단</p>
                  <div className="mb-2.5">
                    <label className={CUI_LABEL}>수신자(휴대폰 번호) 열</label>
                    <select
                      value={phoneColumnChoice}
                      onChange={(e) => { setPhoneColumnChoice(e.target.value); }}
                      onBlur={() => analyze(true)}
                      disabled={saving}
                      className={CUI_SELECT}
                    >
                      {!phoneColumnChoice && <option value="">자동으로 못 찾았습니다. 골라 주세요</option>}
                      {a.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSamplePage(0); setPreviewOpen(true); }}
                    disabled={a.sampleRows.length === 0}
                    className={`${CUI_BTN_OUTLINE} w-full justify-center`}
                  >
                    <FileSpreadsheet className="w-[15px] h-[15px]" />명단 미리보기 (상위 50건)
                  </button>
                  <p className={`${CUI_HINT} mt-1.5`}>올린 파일 모양 그대로 봅니다. 수신자·문안 항목·회신번호 열이 표시됩니다.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className={CUI_MODAL_FOOT}>
          {phase === 'confirm' && (
            <button type="button" onClick={() => setPhase('upload')} disabled={loading || saving} className={`${CUI_BTN_GHOST} mr-auto`}>
              <ArrowLeft className="w-[15px] h-[15px]" />파일 다시 고르기
            </button>
          )}
          {phase === 'upload' ? (
            <button type="button" onClick={() => analyze(false)} disabled={loading} className={CUI_BTN_PRIMARY}>
              {loading ? <Loader2 className="w-[15px] h-[15px] animate-spin" /> : <Check className="w-[15px] h-[15px]" strokeWidth={2.4} />}
              내용 확인
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={saving || loading || !a || a.errors.length > 0} className={CUI_BTN_PRIMARY}>
              {saving ? <Loader2 className="w-[15px] h-[15px] animate-spin" /> : <Send className="w-[15px] h-[15px]" />}
              {a && a.groups.length > 1 ? `${a.groups.length}건 접수하기` : '접수하기'}
            </button>
          )}
        </div>
      </div>

      {/* 명단 미리보기 — 올린 파일 모양 그대로 상위 50행. 중첩 오버레이라 포탈로 몸통 밖에 띄운다 */}
      {previewOpen && a && createPortal(
        <div className="fixed inset-0 z-[80] bg-neutral-900/45 flex items-center justify-center p-4">
          <div className={`${CUI_MODAL} max-w-[960px]`} role="dialog" aria-modal="true" aria-label="명단 미리보기">
            <div className={CUI_MODAL_HEAD}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-9 w-9 shrink-0 rounded-xl bg-indigo-600 text-white grid place-items-center">
                  <FileSpreadsheet className="w-4 h-4" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <h3 className={CUI_MODAL_TITLE}>명단 미리보기</h3>
                  <p className={CUI_MODAL_DESC}>{a.fileName ? `${a.fileName} · ` : ''}올린 파일 모양 그대로, 앞 {a.sampleRows.length}행입니다</p>
                </div>
              </div>
              <button type="button" onClick={() => setPreviewOpen(false)} className={CUI_MODAL_CLOSE} aria-label="닫기">
                <X className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-5">
              <table className="w-full text-[12px]">
                <thead>
                  <tr>
                    {a.headers.map((h) => {
                      const isPhone = h === phoneCol;
                      const isCb = h === cbCol;
                      const vars = varsFor(h);
                      return (
                        <th key={h} className={`text-left px-2.5 py-2 border-b-2 whitespace-nowrap font-bold ${
                          isPhone ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-neutral-50 text-neutral-700 border-neutral-200'
                        }`}>
                          {h}
                          {isPhone && <span className="ml-1.5 inline-flex items-center h-[17px] px-1.5 rounded bg-indigo-600 text-white text-[10px] font-bold align-middle">수신자</span>}
                          {isCb && <span className="ml-1.5 inline-flex items-center h-[17px] px-1.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold align-middle">회신번호</span>}
                          {vars.map((name) => (
                            <span key={name} className="ml-1.5 inline-flex items-center h-[17px] px-1.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-bold align-middle">%{name}%</span>
                          ))}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, ri) => (
                    <tr key={ri}>
                      {a.headers.map((h, ci) => (
                        <td key={ci} className={`px-2.5 py-1.5 border-b border-neutral-100 whitespace-nowrap max-w-[220px] truncate tabular-nums ${
                          h === phoneCol ? 'bg-indigo-50/40 text-neutral-900' : 'text-neutral-700'
                        }`}>
                          {row[ci] === null || row[ci] === undefined ? '' : String(row[ci])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={CUI_MODAL_FOOT}>
              <p className="mr-auto text-[11.5px] text-neutral-400">명단의 앞 {a.sampleRows.length}행만 보여드립니다. 같은 번호·형식 제외 전의 원본입니다.</p>
              {a.sampleRows.length > 10 && (
                <span className="flex items-center gap-1.5 text-[12px] text-neutral-500">
                  <button type="button" disabled={samplePage <= 0} onClick={() => setSamplePage(samplePage - 1)}
                    className="h-7 w-7 grid place-items-center rounded-lg border border-neutral-200 bg-white disabled:opacity-40" aria-label="이전">
                    <ChevronLeft className="w-3.5 h-3.5" strokeWidth={2.4} />
                  </button>
                  <span className="tabular-nums">{samplePage + 1} / {Math.ceil(a.sampleRows.length / 10)}</span>
                  <button type="button" disabled={(samplePage + 1) * 10 >= a.sampleRows.length} onClick={() => setSamplePage(samplePage + 1)}
                    className="h-7 w-7 grid place-items-center rounded-lg border border-neutral-200 bg-white disabled:opacity-40" aria-label="다음">
                    <ChevronRight className="w-3.5 h-3.5" strokeWidth={2.4} />
                  </button>
                </span>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      <MmsUploadModal
        show={mmsOpen}
        onClose={() => setMmsOpen(false)}
        mmsUploadedImages={mms.mmsUploadedImages}
        mmsUploading={mms.mmsUploading}
        handleMmsSlotUpload={mms.handleMmsSlotUpload}
        handleMmsMultiUpload={mms.handleMmsMultiUpload}
        handleMmsImageRemove={mms.handleMmsImageRemove}
        handleMmsFromAsset={mms.handleMmsFromAsset}
        onConfirm={() => setMmsOpen(false)}
      />
    </div>
  );
}
