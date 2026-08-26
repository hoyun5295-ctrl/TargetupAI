/**
 * AgencySendComposer — 대행발송 접수 (★ 2026-08-22 신설 · ★ 2026-08-25 전면 개편, Harold 시안 승인)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §4-2 · 개편 = §15(2026-08-25 목업 승인).
 * 한 창에서 세 단계로 받는다: ① 수신 대상 ② 문안·이미지 ③ 시각·담당자
 *
 * 2026-08-25 개편 축 4개:
 *   1. 넓은 2단 구성(960px) + 단계 표시줄 — 답답하지 않게(Harold 지시)
 *   2. AI 자동 매핑 — 파일을 올리면 전화번호 열을 AI가 고른다(기존 업로드 AI 매핑 endpoint 재사용,
 *      요금제 밖·실패면 기존 추정 규칙 폴백). 명단 미리보기 + 제외 사유 집계(중복·형식 오류)를 그 자리에서 보여준다
 *   3. 폰 미리보기 — 문안을 쓰는 대로 첫 수신자 값으로 치환해 받는 화면 그대로 그린다. 항목 칩을 누르면 문안에 들어간다
 *   4. 시각 후보 칩 + "접수하면 이렇게 진행됩니다" 예고 — 접수 후 다음이 안 보이는 불안을 없앤다
 *
 * ⛔ 사용자에게 추가 입력을 요구하지 않는다 — 틀린 것만 고치게 한다.
 * ⛔ 접수 payload·검증 규칙은 개편 전과 같다(서버 계약 무변경). MMS 이미지는 기존 `MmsUploadModal` 그대로.
 * ⛔ 문구에 줄표 0. 톤 = 인디고 콘솔(`CUI_*`).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, FileSpreadsheet,
  Image as ImageIcon, Loader2, Send, Sparkles, Upload, X,
} from 'lucide-react';
import { useToast } from '../ToastProvider';
import { useMmsUpload } from '../../hooks/useMmsUpload';
import MmsUploadModal from '../MmsUploadModal';
import {
  CUI_BTN_GHOST, CUI_BTN_OUTLINE, CUI_BTN_PRIMARY, CUI_DANGER_BOX, CUI_DANGER_ICON, CUI_DANGER_TEXT,
  CUI_HINT, CUI_INPUT, CUI_LABEL, CUI_MODAL, CUI_MODAL_BODY, CUI_MODAL_CLOSE, CUI_MODAL_DESC,
  CUI_MODAL_FOOT, CUI_MODAL_HEAD, CUI_MODAL_TITLE, CUI_SELECT, CUI_TEXTAREA,
} from '../../utils/console-ui';
import {
  aiGuessPhoneColumn, createAgencyRequest, extractAgencyVars, MAX_AGENCY_VARS, toLocalInput,
  type AgencySendRequest,
} from './agency-send-api';

interface SenderNumber { phone_number?: string; phone?: string }

/** 재접수(같은 내용으로 다시 접수) 프리필. 명단은 서버에서 받아 오고, 접수는 기존 API를 그대로 탄다 */
export interface AgencyComposerPrefill {
  content: string;
  subject: string | null;
  isAd: boolean;
  callbackNumber: string;
  managerPhones: string[];
  varMapping: Record<string, string>;
  fileName: string | null;
  messageType: 'SMS' | 'LMS' | 'MMS';
  recipients: Array<{ phone: string; vars: Record<string, any> }>;
  hadImages: boolean;
}

interface Props {
  show: boolean;
  onClose: () => void;
  onCreated: (r: AgencySendRequest) => void;
  prefill?: AgencyComposerPrefill | null;
}

type Step = 1 | 2 | 3;

/** 파일 헤더에서 전화번호 열을 추정한다(AI가 못 고르면 이것이 폴백이다) */
function guessPhoneColumn(headers: string[]): string {
  const hit = headers.find((h) => /전화|휴대|핸드폰|폰|번호|phone|mobile|hp|tel/i.test(h));
  return hit || headers[0] || '';
}

const ONLY_DIGITS = (s: string) => String(s || '').replace(/[^0-9]/g, '');

/**
 * 보낼 시각 후보 칩. 리드타임(★0826(6) 40분)에 여유 20분을 얹은 시각부터 낸다.
 * 칩은 "고르면 그냥 되는" 값만 담는 자리라 조정 구간(40분 미만)은 애초에 넣지 않는다.
 */
function timeCandidates(now: Date = new Date()): Array<{ label: string; value: string }> {
  const min = now.getTime() + 60 * 60 * 1000;
  const at = (dayOffset: number, hour: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, 0, 0, 0);
    return d;
  };
  const out: Array<{ label: string; value: string }> = [];
  for (const h of [14, 18]) {
    const d = at(0, h);
    if (d.getTime() >= min) out.push({ label: `오늘 ${h}:00`, value: toLocalInput(d) });
  }
  for (const h of [10, 14, 18]) out.push({ label: `내일 ${h}:00`, value: toLocalInput(at(1, h)) });
  out.push({ label: '모레 10:00', value: toLocalInput(at(2, 10)) });
  return out.slice(0, 4);
}

/** 단계 표시줄 */
function StepBar({ step }: { step: Step }) {
  const items: Array<{ n: Step; t: string }> = [
    { n: 1, t: '누구에게' }, { n: 2, t: '무엇을' }, { n: 3, t: '언제' },
  ];
  return (
    <div className="shrink-0 px-6 py-3.5 border-b border-neutral-200 flex items-center">
      {items.map((it, i) => {
        const done = step > it.n;
        const now = step === it.n;
        return (
          <div key={it.n} className="flex items-center">
            {i > 0 && <div className={`h-0.5 w-10 sm:w-16 mx-3 rounded-full ${step > items[i - 1].n ? 'bg-indigo-600' : 'bg-neutral-200'}`} />}
            <div className="flex items-center gap-2">
              <span className={`h-[22px] w-[22px] rounded-full grid place-items-center text-[11.5px] font-extrabold ${
                now ? 'bg-indigo-600 text-white' : done ? 'bg-indigo-100 text-indigo-700' : 'bg-neutral-100 text-neutral-500'}`}>
                {done ? <Check className="w-3 h-3" strokeWidth={3} /> : it.n}
              </span>
              <span className={`text-[13px] ${now ? 'font-extrabold text-neutral-900' : done ? 'font-semibold text-indigo-700' : 'font-medium text-neutral-500'}`}>{it.t}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AgencySendComposer({ show, onClose, onCreated, prefill }: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);

  // ① 대상
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [phoneColumn, setPhoneColumn] = useState('');
  const [pasted, setPasted] = useState('');
  const [pasteMode, setPasteMode] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [aiMapping, setAiMapping] = useState(false);
  const [aiPicked, setAiPicked] = useState(false);
  // 재접수 명단(서버에서 받아 온 이전 접수 수신자). 새 파일을 올리면 버린다
  const [prefillRecipients, setPrefillRecipients] = useState<Array<{ phone: string; vars: Record<string, any> }> | null>(null);

  // ② 문안
  const [content, setContent] = useState('');
  const [subject, setSubject] = useState('');
  // 광고 기본 = 켜짐(★Harold 2026-08-25 "(광고) 기본적용"). 대행발송 대부분이 광고성이라 끄는 쪽이 예외다
  const [isAd, setIsAd] = useState(true);
  const [varMapping, setVarMapping] = useState<Record<string, string>>({});
  const [mmsOpen, setMmsOpen] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);
  const mms = useMmsUpload((m) => toast.error(m));

  // ③ 시각·담당자
  const [requestedAt, setRequestedAt] = useState('');
  // 담당자 번호는 **여러 명**일 수 있다(★Harold 2026-08-23). 칩으로 쌓는다(최대 10)
  const [managerPhones, setManagerPhones] = useState<string[]>([]);
  const [managerInput, setManagerInput] = useState('');
  const [callbackNumber, setCallbackNumber] = useState('');
  const [senders, setSenders] = useState<string[]>([]);

  const messageType: 'SMS' | 'LMS' | 'MMS' = mms.mmsUploadedImages.length > 0
    ? 'MMS'
    : (content.length > 45 || subject.trim() ? 'LMS' : 'SMS');

  /** 파일·붙여넣기·재접수 명단을 하나로 정리하고, 왜 몇 건이 빠졌는지도 같이 센다 */
  const recipientInfo = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ phone: string; vars: Record<string, any> }> = [];
    let dup = 0;
    let invalid = 0;
    if (prefillRecipients) {
      for (const r of prefillRecipients) {
        const phone = ONLY_DIGITS(r.phone);
        if (phone.length < 10) { invalid++; continue; }
        if (seen.has(phone)) { dup++; continue; }
        seen.add(phone);
        list.push({ phone, vars: r.vars || {} });
      }
      return { list, dup, invalid, total: prefillRecipients.length, source: 'prefill' as const };
    }
    if (rows.length > 0 && phoneColumn) {
      // 폰 미리보기가 원본 행 값을 읽을 수 있게, 수신자 목록과 나란한 원본 행 배열을 같이 둔다(참조라 비용 0)
      const srcRows: Record<string, any>[] = [];
      for (const r of rows) {
        const phone = ONLY_DIGITS(r[phoneColumn]);
        if (phone.length < 10) { invalid++; continue; }
        if (seen.has(phone)) { dup++; continue; }
        seen.add(phone);
        const vars: Record<string, any> = {};
        for (const [varName, col] of Object.entries(varMapping)) {
          if (col && r[col] !== undefined) vars[varName] = r[col];
        }
        list.push({ phone, vars });
        srcRows.push(r);
      }
      return { list, dup, invalid, total: rows.length, source: 'file' as const, srcRows };
    }
    const tokens = pasted.split(/[\s,;]+/).filter((t) => t.trim());
    for (const raw of tokens) {
      const phone = ONLY_DIGITS(raw);
      if (phone.length < 10) { invalid++; continue; }
      if (seen.has(phone)) { dup++; continue; }
      seen.add(phone);
      list.push({ phone, vars: {} });
    }
    return { list, dup, invalid, total: tokens.length, source: 'paste' as const };
  }, [rows, phoneColumn, pasted, varMapping, prefillRecipients]);

  const recipients = recipientInfo.list;
  const usedVars = useMemo(() => extractAgencyVars(content), [content]);
  /** 문안 칩으로 쓸 열(전화번호 열은 뺀다) */
  const varColumns = useMemo(() => headers.filter((h) => h !== phoneColumn), [headers, phoneColumn]);

  const reset = () => {
    setStep(1); setFileName(null); setHeaders([]); setRows([]); setPhoneColumn(''); setPasted('');
    setPasteMode(false); setAiPicked(false); setPrefillRecipients(null);
    setContent(''); setSubject(''); setIsAd(true); setVarMapping({}); setPreviewIdx(0);
    setRequestedAt(''); setManagerPhones([]); setManagerInput(''); setCallbackNumber('');
    mms.setMmsUploadedImages([]);
  };

  const close = () => { reset(); onClose(); };

  // 재접수 프리필 — 열릴 때 1회만 적용한다
  const appliedRef = useRef(false);
  useEffect(() => {
    if (show && prefill && !appliedRef.current) {
      appliedRef.current = true;
      setContent(prefill.content || '');
      setSubject(prefill.subject || '');
      setIsAd(!!prefill.isAd);
      setVarMapping(prefill.varMapping || {});
      setManagerPhones((prefill.managerPhones || []).map(ONLY_DIGITS).filter((p) => p.length >= 10).slice(0, 10));
      setCallbackNumber(ONLY_DIGITS(prefill.callbackNumber || ''));
      setFileName(prefill.fileName);
      setPrefillRecipients(prefill.recipients || []);
      if (prefill.hadImages) {
        toast.info('이미지 문자였던 접수입니다. 이미지는 2단계에서 다시 첨부해 주세요.');
      }
    }
    if (!show) appliedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, prefill]);

  // 직접발송이 쓰는 것과 같은 목록을 쓴다(등록·배정 규칙이 한 곳에 있다)
  const loadSenders = async () => {
    try {
      const res = await fetch('/api/companies/callback-numbers', { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } });
      const data = await res.json();
      const list: SenderNumber[] = data?.numbers || [];
      const phones = list.map((s) => ONLY_DIGITS(s.phone || s.phone_number || '')).filter(Boolean);
      setSenders([...new Set(phones)]);
      // 재접수 프리필이 이미 골라 둔 번호를 덮지 않는다
      setCallbackNumber((cur) => {
        if (cur) return cur;
        const def = list.find((s: any) => s.is_default);
        if (def) return ONLY_DIGITS(def.phone || def.phone_number || '');
        return phones.length === 1 ? phones[0] : '';
      });
    } catch {
      setSenders([]);
    }
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload/parse?includeData=true', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: form,
      });
      const data = await res.json();
      if (!data?.success) { toast.error(data?.error || '파일을 읽지 못했습니다.'); return; }
      const hs: string[] = data.headers || [];
      const allRows: Record<string, any>[] = data.allData || data.preview || [];
      setHeaders(hs);
      setRows(allRows);
      setFileName(file.name);
      setPasted('');
      setPasteMode(false);
      setPrefillRecipients(null);
      setAiPicked(false);
      // 폴백 추정을 먼저 깔고, AI가 고르면 바꿔 얹는다(실패해도 접수는 막히지 않는다)
      setPhoneColumn(guessPhoneColumn(hs));
      setAiMapping(true);
      try {
        const sample = allRows.slice(0, 5).map((r) => hs.map((h) => r[h]));
        const ai = await aiGuessPhoneColumn(hs, sample);
        if (ai && hs.includes(ai.phoneColumn)) {
          setPhoneColumn(ai.phoneColumn);
          setAiPicked(true);
        }
      } finally {
        setAiMapping(false);
      }
    } catch {
      toast.error('파일을 읽는 중 문제가 생겼습니다.');
    } finally {
      setParsing(false);
    }
  };

  /** 항목 칩 — 커서 자리에 %열%을 넣는다. 표기를 외울 필요가 없다 */
  const insertVar = (name: string) => {
    const token = `%${name}%`;
    const el = contentRef.current;
    if (!el) { setContent((c) => c + token); return; }
    const start = el.selectionStart ?? content.length;
    const end = el.selectionEnd ?? content.length;
    const next = content.slice(0, start) + token + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const addManager = () => {
    const phone = ONLY_DIGITS(managerInput);
    if (phone.length < 10) { toast.error('휴대폰 번호를 확인해 주세요.'); return; }
    if (managerPhones.includes(phone)) { setManagerInput(''); return; }
    if (managerPhones.length >= 10) { toast.error('담당자 번호는 10개까지 넣을 수 있습니다.'); return; }
    setManagerPhones([...managerPhones, phone]);
    setManagerInput('');
  };

  const goStep2 = () => {
    if (recipients.length === 0) { toast.error('보낼 번호가 없습니다. 파일을 올리거나 번호를 넣어 주세요.'); return; }
    setPreviewIdx(0);
    setStep(2);
  };

  const goStep3 = () => {
    if (!content.trim()) { toast.error('문안을 입력해 주세요.'); return; }
    if ((messageType === 'LMS' || messageType === 'MMS') && !subject.trim()) {
      toast.error('제목을 입력해 주세요. 긴 문자와 이미지 문자에는 제목이 필요합니다.');
      return;
    }
    // 문안에 넣는 항목은 네 개까지다. 서버도 같은 자리에서 막지만, 여기서 알려야 다시 쓰지 않는다.
    if (usedVars.length > MAX_AGENCY_VARS) {
      toast.error(`문안에 넣을 항목은 ${MAX_AGENCY_VARS}개까지입니다. 지금 ${usedVars.length}개를 쓰고 있습니다.`);
      return;
    }
    // 제목은 모든 수신자에게 같은 문장으로 나간다. 항목을 넣으면 그 글자가 그대로 보인다.
    const subjectVars = extractAgencyVars(subject);
    if (subjectVars.length > 0) {
      toast.error(`제목에는 항목을 넣을 수 없습니다: ${subjectVars.map((v) => `%${v}%`).join(' ')}`);
      return;
    }
    // 자동 매핑: 문안 변수와 같은 이름의 열이 있으면 맞춰 둔다
    const next = { ...varMapping };
    for (const v of usedVars) {
      if (!next[v]) {
        const hit = headers.find((h) => h.replace(/\s+/g, '') === v.replace(/\s+/g, ''));
        if (hit) next[v] = hit;
      }
    }
    setVarMapping(next);
    if (!requestedAt) {
      const d = new Date(Date.now() + 4 * 60 * 60 * 1000);
      d.setMinutes(0, 0, 0);
      setRequestedAt(toLocalInput(d));
    }
    if (senders.length === 0) loadSenders();
    setStep(3);
  };

  const submit = async () => {
    if (saving) return;
    if (!callbackNumber) { toast.error('보내는 번호를 골라 주세요.'); return; }
    if (managerPhones.length === 0) { toast.error('테스트 문자를 받을 담당자 번호를 넣어 주세요.'); return; }
    if (!requestedAt) { toast.error('보낼 시각을 정해 주세요.'); return; }

    setSaving(true);
    try {
      const created = await createAgencyRequest({
        messageType,
        subject: subject.trim() || undefined,
        content: content.trim(),
        isAd,
        callbackNumber,
        managerPhones,
        requestedAt: new Date(requestedAt).toISOString(),
        mmsImagePaths: mms.mmsUploadedImages.map((i) => i.serverPath),
        fileName,
        phoneColumn: phoneColumn || '직접 입력',
        varMapping,
        recipients,
      });
      toast.success('접수했습니다. 스팸 검사를 마치면 담당자 번호로 문자를 보내 드립니다.');
      onCreated(created);
      close();
    } catch (e: any) {
      toast.error(e?.message || '접수하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  /** 폰 미리보기 — 문안을 이 수신자 값으로 치환해 조각으로 돌려준다. 못 채운 항목은 표기 그대로 붉게 */
  const previewParts = useMemo(() => {
    const idx = Math.min(previewIdx, Math.max(0, recipients.length - 1));
    const row = recipients[idx];
    const resolve = (name: string): string | null => {
      let v: any;
      if (recipientInfo.source === 'file') {
        // 매핑표가 아직 안 채워진 항목도 같은 이름 열이면 미리 채워 보여준다(3단계로 넘어갈 때 자동으로 맞는 것과 같은 규칙)
        const col = varMapping[name] || headers.find((h) => h.replace(/\s+/g, '') === name.replace(/\s+/g, ''));
        v = col ? recipientInfo.srcRows?.[idx]?.[col] : undefined;
      } else {
        v = row?.vars?.[name];
      }
      return v === undefined || v === null || String(v).trim() === '' ? null : String(v);
    };
    const parts: Array<{ kind: 'text' | 'var' | 'miss'; text: string }> = [];
    for (const seg of content.split(/(%[가-힣A-Za-z_][^%\s]{0,19}%)/g)) {
      if (!seg) continue;
      const m = seg.match(/^%([가-힣A-Za-z_][^%\s]{0,19})%$/);
      if (!m) { parts.push({ kind: 'text', text: seg }); continue; }
      const v = resolve(m[1]);
      if (v === null) parts.push({ kind: 'miss', text: seg });
      else parts.push({ kind: 'var', text: v });
    }
    return parts;
  }, [content, recipients, previewIdx, varMapping, headers, recipientInfo]);

  if (!show) return null;

  const stepDesc = step === 1
    ? (recipients.length > 0 ? `보낼 번호 ${recipients.length.toLocaleString()}건이 준비됐습니다` : '명단을 올리면 나머지는 이어서 채워집니다')
    : step === 2 ? `${recipients.length.toLocaleString()}건 · 받는 화면을 보면서 문안을 다듬으세요`
    : `${recipients.length.toLocaleString()}건 · ${messageType}${isAd ? ' · 광고' : ''}`;

  const candidates = timeCandidates();

  return (
    <div className="fixed inset-0 z-[60] bg-neutral-900/45 flex items-center justify-center p-4">
      <div className={`${CUI_MODAL} max-w-[960px]`} role="dialog" aria-modal="true" aria-label="대행발송 접수">
        <div className={CUI_MODAL_HEAD}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-indigo-600 text-white grid place-items-center">
              <Send className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h3 className={CUI_MODAL_TITLE}>대행발송 접수</h3>
              <p className={CUI_MODAL_DESC}>{stepDesc}</p>
            </div>
          </div>
          <button type="button" onClick={close} className={CUI_MODAL_CLOSE} aria-label="닫기">
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        <StepBar step={step} />

        <div className={CUI_MODAL_BODY}>
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_320px] gap-6">
            {/* ══ 왼쪽: 입력 ══ */}
            <div className="space-y-5 min-w-0">
              {/* ── 1단계: 대상 ── */}
              {step === 1 && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
                  />

                  {prefillRecipients ? (
                    <div>
                      <label className={CUI_LABEL}>명단</label>
                      <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3">
                        <span className="h-9 w-9 rounded-lg bg-indigo-50 text-indigo-600 grid place-items-center shrink-0">
                          <FileSpreadsheet className="w-4 h-4" strokeWidth={2} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] font-semibold truncate">{fileName || '이전 접수 명단'}</p>
                          <p className={`${CUI_HINT} mt-0`}>이전 접수의 명단 <b className="tabular-nums">{recipients.length.toLocaleString()}</b>건을 그대로 씁니다</p>
                        </div>
                        <button type="button" onClick={() => { setPrefillRecipients(null); setFileName(null); }} className={`${CUI_BTN_GHOST} h-8`}>
                          다른 명단 쓰기
                        </button>
                      </div>
                    </div>
                  ) : !pasteMode ? (
                    <>
                      {!fileName ? (
                        <div>
                          <label className={CUI_LABEL}>명단 파일</label>
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => fileRef.current?.click()}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
                            className="rounded-xl border-2 border-dashed border-neutral-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/40 transition cursor-pointer grid place-items-center py-10 px-6 text-center focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-600/15"
                          >
                            {parsing ? (
                              <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                            ) : (
                              <>
                                <span className="h-11 w-11 rounded-2xl bg-indigo-50 text-indigo-600 grid place-items-center mb-3">
                                  <Upload className="w-5 h-5" strokeWidth={2} />
                                </span>
                                <p className="text-[13.5px] font-semibold text-neutral-800">엑셀 또는 CSV를 끌어다 놓거나 눌러서 올리기</p>
                                <p className={`${CUI_HINT} mt-1`}>첫 줄은 열 이름으로 읽습니다. 이름 같은 항목이 있으면 문안에 넣을 수 있습니다.</p>
                              </>
                            )}
                          </div>
                          <p className={CUI_HINT}>
                            번호만 있으면 파일 없이도 됩니다.{' '}
                            <button type="button" onClick={() => setPasteMode(true)} className="font-semibold text-indigo-600 hover:text-indigo-700">번호 직접 넣기</button>
                          </p>
                        </div>
                      ) : (
                        <>
                          <div>
                            <label className={CUI_LABEL}>명단 파일</label>
                            <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3">
                              <span className="h-9 w-9 rounded-lg bg-emerald-50 text-emerald-700 grid place-items-center shrink-0">
                                <FileSpreadsheet className="w-4 h-4" strokeWidth={2} />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-[13.5px] font-semibold truncate">{fileName}</p>
                                <p className={`${CUI_HINT} mt-0`}><span className="tabular-nums">{rows.length.toLocaleString()}</span>행 · 열 {headers.length}개</p>
                              </div>
                              <button type="button" onClick={() => fileRef.current?.click()} disabled={parsing} className={`${CUI_BTN_GHOST} h-8`}>
                                {parsing ? <Loader2 className="w-[14px] h-[14px] animate-spin" /> : '다른 파일'}
                              </button>
                            </div>
                          </div>

                          <div>
                            <label className={`${CUI_LABEL} flex items-center gap-1.5`}>
                              <Sparkles className="w-3.5 h-3.5 text-indigo-600" strokeWidth={2} />
                              {aiMapping ? 'AI가 열을 읽고 있습니다' : aiPicked ? 'AI가 열을 읽고 자동으로 맞췄습니다' : '전화번호 열'}
                            </label>
                            <div className="rounded-xl border border-indigo-600/20 overflow-hidden">
                              <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-indigo-50">
                                <span className="w-[76px] shrink-0 text-[12.5px] font-bold text-indigo-700">전화번호</span>
                                <select value={phoneColumn} onChange={(e) => { setPhoneColumn(e.target.value); setAiPicked(false); }} className={`${CUI_SELECT} h-8 flex-1`}>
                                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                                </select>
                                {aiMapping ? (
                                  <Loader2 className="w-4 h-4 animate-spin text-indigo-600 shrink-0" />
                                ) : aiPicked ? (
                                  <span className="shrink-0 inline-flex items-center h-[21px] px-2 rounded-md bg-indigo-100 text-indigo-700 text-[11.5px] font-bold">자동 인식</span>
                                ) : null}
                              </div>
                            </div>
                            <p className={CUI_HINT}>다르면 바꿔 주세요. 나머지 열은 2단계에서 문안에 넣어 쓸 수 있습니다.</p>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <div>
                      <label className={CUI_LABEL}>번호 직접 넣기</label>
                      <textarea
                        value={pasted}
                        onChange={(e) => setPasted(e.target.value)}
                        rows={7}
                        placeholder={'01000001111\n01000002222'}
                        className={CUI_TEXTAREA}
                      />
                      <p className={CUI_HINT}>
                        줄바꿈이나 쉼표로 나눠 넣으세요.{' '}
                        <button type="button" onClick={() => { setPasteMode(false); setPasted(''); }} className="font-semibold text-indigo-600 hover:text-indigo-700">파일로 올리기</button>
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* ── 2단계: 문안 ── */}
              {step === 2 && (
                <>
                  <div>
                    <label className={CUI_LABEL}>제목 {(messageType === 'LMS' || messageType === 'MMS') && <span className="text-rose-500">*</span>}</label>
                    <input value={subject} onChange={(e) => setSubject(e.target.value)} className={CUI_INPUT} placeholder="가을 신상 행사 안내" />
                    <p className={CUI_HINT}>제목은 모든 수신자에게 같은 문장으로 나갑니다.</p>
                  </div>

                  <div>
                    <label className={CUI_LABEL}>문안 <span className="text-rose-500">*</span></label>
                    <textarea
                      ref={contentRef}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      rows={8}
                      placeholder={'[한줄상회] %이름%님, 8월 29일 오후 2시부터 가을 신상 행사를 엽니다.'}
                      className={CUI_TEXTAREA}
                    />
                    {varColumns.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {varColumns.map((h) => {
                          const used = content.includes(`%${h}%`);
                          return (
                            <button
                              key={h}
                              type="button"
                              onClick={() => insertVar(h)}
                              className={`inline-flex items-center gap-1 h-[26px] px-2.5 rounded-lg text-[12.5px] font-semibold transition ${
                                used
                                  ? 'bg-white border border-indigo-600/40 text-indigo-700'
                                  : 'bg-indigo-50 border border-dashed border-indigo-600/40 text-indigo-700 hover:bg-indigo-100'
                              }`}
                            >
                              {used ? <Check className="w-3 h-3" strokeWidth={2.6} /> : <span className="text-[13px] leading-none">+</span>}
                              {h}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <p className={CUI_HINT}>
                      {varColumns.length > 0
                        ? `올리신 파일의 항목입니다. 누르면 문안에 들어가고, 고객마다 그 사람 값으로 바뀝니다. ${MAX_AGENCY_VARS}개까지 넣을 수 있습니다.`
                        : `퍼센트 기호로 감싼 낱말(예: %이름%)은 고객마다 다른 값이 들어갑니다. ${MAX_AGENCY_VARS}개까지 넣을 수 있습니다.`}
                    </p>
                    {usedVars.length > MAX_AGENCY_VARS && (
                      <div className={`${CUI_DANGER_BOX} mt-2`}>
                        <AlertTriangle className={CUI_DANGER_ICON} size={16} strokeWidth={2} />
                        <p className={CUI_DANGER_TEXT}>
                          문안에 넣을 항목이 {usedVars.length}개입니다. {MAX_AGENCY_VARS}개까지만 넣을 수 있으니 일부를 빼 주세요.
                        </p>
                      </div>
                    )}
                  </div>

                  {usedVars.length > 0 && headers.length > 0 && usedVars.some((v) => !varMapping[v] && !headers.find((h) => h.replace(/\s+/g, '') === v.replace(/\s+/g, ''))) && (
                    <div>
                      <label className={CUI_LABEL}>문안에 넣을 항목 맞추기</label>
                      <div className="space-y-2">
                        {usedVars.map((v) => (
                          <div key={v} className="flex items-center gap-2.5">
                            <span className="w-[120px] shrink-0 text-[13px] font-medium text-neutral-700 truncate">%{v}%</span>
                            <select
                              value={varMapping[v] || ''}
                              onChange={(e) => setVarMapping({ ...varMapping, [v]: e.target.value })}
                              className={CUI_SELECT}
                            >
                              <option value="">넣지 않음</option>
                              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                      <p className={CUI_HINT}>같은 이름의 열은 미리 맞춰 두었습니다. 다르면 바꿔 주세요.</p>
                    </div>
                  )}

                  {usedVars.length > 0 && headers.length === 0 && recipientInfo.source === 'paste' && (
                    <div className={CUI_DANGER_BOX}>
                      <AlertTriangle className={CUI_DANGER_ICON} size={16} strokeWidth={2} />
                      <p className={CUI_DANGER_TEXT}>
                        문안에 넣을 항목이 있는데 명단이 번호만 있습니다. 항목이 있는 파일을 올리거나 문안에서 그 부분을 빼 주세요.
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-4">
                    <button type="button" onClick={() => setMmsOpen(true)} className={CUI_BTN_OUTLINE}>
                      <ImageIcon className="w-[15px] h-[15px]" />
                      {mms.mmsUploadedImages.length > 0 ? `${mms.mmsUploadedImages.length}장 첨부됨` : '이미지 넣기'}
                    </button>
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input type="checkbox" checked={isAd} onChange={(e) => setIsAd(e.target.checked)} className="w-4 h-4 rounded accent-indigo-600" />
                      <span className="text-[13px] text-neutral-700">광고 문자입니다</span>
                    </label>
                  </div>
                  <p className={`${CUI_HINT} mt-0`}>
                    이미지를 넣으면 이미지 문자로 나갑니다.{isAd ? ' 광고 표시와 무료 수신거부 번호는 자동으로 붙습니다.' : ''}
                  </p>
                </>
              )}

              {/* ── 3단계: 시각·담당자 ── */}
              {step === 3 && (
                <>
                  <div>
                    <label className={CUI_LABEL}>보낼 시각 <span className="text-rose-500">*</span></label>
                    <div className="flex flex-wrap gap-2 mb-2.5">
                      {candidates.map((c) => (
                        <button
                          key={c.value}
                          type="button"
                          onClick={() => setRequestedAt(c.value)}
                          className={`h-8 px-3 rounded-lg border text-[13px] font-semibold transition ${
                            requestedAt === c.value
                              ? 'border-indigo-600 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-600/15'
                              : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300'
                          }`}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                    <input type="datetime-local" value={requestedAt} onChange={(e) => setRequestedAt(e.target.value)} className={CUI_INPUT} />
                    <p className={CUI_HINT}>지금부터 40분 뒤부터 정할 수 있습니다. 더 이른 시각을 넣으시면 준비 시간을 감안해 30분 뒤로 잡아 드립니다.</p>
                  </div>

                  <div>
                    <label className={CUI_LABEL}>보내는 번호 <span className="text-rose-500">*</span></label>
                    <select value={callbackNumber} onChange={(e) => setCallbackNumber(e.target.value)} className={CUI_SELECT}>
                      <option value="">고르세요</option>
                      {(callbackNumber && !senders.includes(callbackNumber) ? [callbackNumber, ...senders] : senders).map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    {senders.length === 0 && <p className={CUI_HINT}>등록된 번호가 없습니다. 발신번호 등록을 먼저 해 주세요.</p>}
                  </div>

                  <div>
                    <label className={CUI_LABEL}>테스트 문자를 받을 담당자 <span className="text-rose-500">*</span></label>
                    {managerPhones.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {managerPhones.map((phone) => (
                          <span key={phone} className="inline-flex items-center gap-1.5 h-[30px] pl-2.5 pr-1.5 rounded-lg bg-neutral-100 text-[13px] font-semibold text-neutral-700 tabular-nums">
                            {phone}
                            <button
                              type="button"
                              onClick={() => setManagerPhones(managerPhones.filter((p) => p !== phone))}
                              className="h-5 w-5 grid place-items-center rounded-md text-neutral-400 hover:text-rose-500 hover:bg-rose-50"
                              aria-label="이 번호 빼기"
                            >
                              <X className="w-3 h-3" strokeWidth={2.4} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        value={managerInput}
                        onChange={(e) => setManagerInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManager(); } }}
                        className={CUI_INPUT}
                        placeholder="번호를 넣고 Enter를 누르면 추가됩니다"
                      />
                      <button type="button" onClick={addManager} className={`${CUI_BTN_OUTLINE} shrink-0`}>추가</button>
                    </div>
                    <p className={CUI_HINT}>검사를 통과한 문안을 이 번호들로 먼저 보내 드립니다. 확인하고 승인하면 예약됩니다.</p>
                  </div>
                </>
              )}
            </div>

            {/* ══ 오른쪽: 미리보기·예고 ══ */}
            <div className="space-y-4 min-w-0">
              {step === 1 && (
                <>
                  {recipientInfo.source === 'file' && rows.length > 0 && (
                    <div className="rounded-xl border border-neutral-200 bg-white p-4">
                      <p className="text-[13px] font-bold mb-2.5">명단 미리보기</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr>
                              {[phoneColumn, ...headers.filter((h) => h !== phoneColumn).slice(0, 2)].filter(Boolean).map((h) => (
                                <th key={h} className={`text-left px-2 py-1.5 font-bold whitespace-nowrap ${h === phoneColumn ? 'bg-indigo-50 text-indigo-700 rounded-md' : 'text-neutral-500 font-semibold'}`}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.slice(0, 3).map((r, i) => (
                              <tr key={i}>
                                {[phoneColumn, ...headers.filter((h) => h !== phoneColumn).slice(0, 2)].filter(Boolean).map((h) => (
                                  <td key={h} className={`px-2 py-1.5 border-b border-neutral-100 whitespace-nowrap ${h === phoneColumn ? 'tabular-nums font-medium' : 'text-neutral-600'}`}>
                                    {String(r[h] ?? '')}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  <div className="rounded-xl border border-neutral-200 bg-white p-4">
                    <p className="text-[13px] font-bold mb-2.5">보낼 번호 <span className="tabular-nums text-indigo-600">{recipients.length.toLocaleString()}</span>건</p>
                    <div className="space-y-1.5 text-[12.5px] text-neutral-500">
                      <p className="flex justify-between"><span>{recipientInfo.source === 'file' ? '파일의 행' : recipientInfo.source === 'prefill' ? '이전 접수 명단' : '넣은 번호'}</span><b className="tabular-nums text-neutral-900">{recipientInfo.total.toLocaleString()}</b></p>
                      <p className="flex justify-between"><span>같은 번호 제외</span><b className="tabular-nums text-neutral-900">{recipientInfo.dup.toLocaleString()}</b></p>
                      <p className="flex justify-between"><span>형식이 다른 번호 제외</span><b className="tabular-nums text-neutral-900">{recipientInfo.invalid.toLocaleString()}</b></p>
                    </div>
                  </div>
                </>
              )}

              {step === 2 && (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-full flex items-center justify-between">
                    <p className="text-[12.5px] font-bold text-neutral-700">받는 사람 화면</p>
                    <span className="flex gap-1.5">
                      <span className="inline-flex items-center h-[21px] px-2 rounded-md bg-indigo-100 text-indigo-700 text-[11.5px] font-bold">{messageType}</span>
                      <span className="inline-flex items-center h-[21px] px-2 rounded-md bg-neutral-100 text-neutral-600 text-[11.5px] font-bold tabular-nums">{content.length}자</span>
                    </span>
                  </div>
                  <div className="w-[250px] rounded-[26px] bg-neutral-900 px-2.5 pt-3 pb-4 shadow-xl shadow-neutral-900/25">
                    <div className="mx-auto mb-2.5 h-[5px] w-16 rounded-full bg-neutral-700" />
                    <div className="rounded-[18px] bg-white px-3 py-3 min-h-[300px]">
                      <div className="flex items-center gap-2 pb-2.5 mb-2.5 border-b border-neutral-100">
                        <span className="h-6 w-6 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center shrink-0">
                          <Send className="w-3 h-3" strokeWidth={2} />
                        </span>
                        <span className="text-[11.5px] font-bold text-neutral-600 tabular-nums">{callbackNumber || '보내는 번호'}</span>
                      </div>
                      <div className="rounded-tr-xl rounded-b-xl bg-neutral-100 px-3 py-2.5 text-[12px] leading-relaxed text-neutral-900 break-words">
                        {(messageType === 'LMS' || messageType === 'MMS') && (
                          <p className="font-extrabold mb-1">{isAd ? '(광고) ' : ''}{subject || '제목'}</p>
                        )}
                        {messageType === 'SMS' && isAd && <span className="font-extrabold">(광고) </span>}
                        {mms.mmsUploadedImages.length > 0 && (
                          <span className="inline-flex items-center gap-1 mb-1 mr-1 h-[20px] px-1.5 rounded bg-white text-neutral-500 text-[11px] font-semibold">
                            <ImageIcon className="w-3 h-3" strokeWidth={2} />이미지 {mms.mmsUploadedImages.length}장
                          </span>
                        )}
                        <span className="whitespace-pre-wrap">
                          {previewParts.length === 0
                            ? <span className="text-neutral-400">문안을 입력하면 여기 그대로 보입니다</span>
                            : previewParts.map((p, i) => p.kind === 'text'
                              ? <span key={i}>{p.text}</span>
                              : p.kind === 'var'
                                ? <span key={i} className="rounded bg-indigo-100 px-0.5 font-bold text-indigo-900">{p.text}</span>
                                : <span key={i} className="rounded bg-rose-100 px-0.5 font-bold text-rose-700">{p.text}</span>)}
                        </span>
                        {isAd && <p className="mt-2 text-[11px] text-neutral-500">무료 수신거부 번호가 자동으로 붙습니다</p>}
                      </div>
                    </div>
                  </div>
                  {recipients.length > 0 && (
                    <div className="flex items-center gap-2.5 text-[12px] text-neutral-500">
                      <button
                        type="button"
                        onClick={() => setPreviewIdx((i) => Math.max(0, i - 1))}
                        disabled={previewIdx <= 0}
                        className="h-6 w-6 grid place-items-center rounded-lg border border-neutral-200 bg-white text-neutral-500 hover:text-neutral-900 disabled:opacity-40"
                        aria-label="이전 수신자"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" strokeWidth={2.4} />
                      </button>
                      <span><b className="tabular-nums text-neutral-900">{Math.min(previewIdx + 1, recipients.length)}</b> / <span className="tabular-nums">{recipients.length.toLocaleString()}</span>번째 수신자</span>
                      <button
                        type="button"
                        onClick={() => setPreviewIdx((i) => Math.min(recipients.length - 1, i + 1))}
                        disabled={previewIdx >= recipients.length - 1}
                        className="h-6 w-6 grid place-items-center rounded-lg border border-neutral-200 bg-white text-neutral-500 hover:text-neutral-900 disabled:opacity-40"
                        aria-label="다음 수신자"
                      >
                        <ChevronRight className="w-3.5 h-3.5" strokeWidth={2.4} />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {step === 3 && (
                <div className="rounded-xl border border-neutral-200 bg-white p-4">
                  <p className="text-[13px] font-bold mb-3">접수하면 이렇게 진행됩니다</p>
                  {[
                    { t: '문안 검사', d: '통신사 기준으로 미리 검사하고, 걸리면 문안을 다듬어 다시 검사합니다' },
                    { t: '담당자 문자', d: `통과한 문안을 담당자 ${Math.max(managerPhones.length, 1)}명에게 실제 문자로 보내 드립니다` },
                    { t: '승인', d: '문자를 확인하고 이 화면에서 승인 버튼만 누르면 됩니다' },
                    { t: '자동 예약', d: '발송 2시간 전에 자동으로 예약을 잡습니다' },
                    { t: '발송', d: `정하신 시각에 ${recipients.length.toLocaleString()}명에게 나갑니다` },
                  ].map((s, i, arr) => (
                    <div key={s.t} className="relative flex gap-2.5 pb-4 last:pb-0">
                      {i < arr.length - 1 && <span className="absolute left-[10px] top-[22px] bottom-0 w-0.5 bg-neutral-100" aria-hidden="true" />}
                      <span className="relative z-10 h-[21px] w-[21px] shrink-0 rounded-full bg-indigo-50 ring-1 ring-indigo-600/30 text-indigo-700 grid place-items-center text-[10.5px] font-extrabold">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-bold text-neutral-900">{s.t}</p>
                        <p className="text-[12px] text-neutral-500 leading-snug">{s.d}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={CUI_MODAL_FOOT}>
          {step > 1 && (
            <button type="button" onClick={() => setStep((step - 1) as Step)} className={`${CUI_BTN_GHOST} mr-auto`}>
              <ArrowLeft className="w-[15px] h-[15px]" />이전
            </button>
          )}
          {step < 3 ? (
            <button type="button" onClick={step === 1 ? goStep2 : goStep3} className={CUI_BTN_PRIMARY}>
              다음<ArrowRight className="w-[15px] h-[15px]" />
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={saving} className={CUI_BTN_PRIMARY}>
              {saving ? <Loader2 className="w-[15px] h-[15px] animate-spin" /> : <Send className="w-[15px] h-[15px]" />}
              접수하기
            </button>
          )}
        </div>
      </div>

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
