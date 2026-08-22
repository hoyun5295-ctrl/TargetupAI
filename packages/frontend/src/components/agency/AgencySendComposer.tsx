/**
 * AgencySendComposer — 대행발송 접수 (★ 2026-08-22 신설)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §4-2. 한 창에서 세 단계로 받는다:
 *   ① 수신 대상(엑셀 또는 붙여넣기) ② 문안·이미지 ③ 시각·담당자
 *
 * ⛔ 사용자에게 추가 입력을 요구하지 않는다 — 파일을 올리면 전화번호 열을 **추정해서 골라 두고**,
 *   문안의 %변수%도 같은 이름 열에 자동으로 맞춰 둔다. 사용자는 틀린 것만 고친다.
 * ⛔ MMS 이미지는 기존 `MmsUploadModal`(업로드 + 라이브러리)을 그대로 쓴다. 첨부하면 MMS로 전환된다.
 * ⛔ 문구에 줄표 0. 톤 = 인디고 콘솔(`CUI_*`).
 */
import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, FileSpreadsheet, Image as ImageIcon, Loader2, Send, Upload, X } from 'lucide-react';
import { useToast } from '../ToastProvider';
import { useMmsUpload } from '../../hooks/useMmsUpload';
import MmsUploadModal from '../MmsUploadModal';
import {
  CUI_BTN_GHOST, CUI_BTN_OUTLINE, CUI_BTN_PRIMARY, CUI_DANGER_BOX, CUI_DANGER_ICON, CUI_DANGER_TEXT,
  CUI_HINT, CUI_INFO, CUI_INFO_ICON, CUI_INFO_TEXT, CUI_INPUT, CUI_LABEL, CUI_MODAL, CUI_MODAL_BODY,
  CUI_MODAL_CLOSE, CUI_MODAL_DESC, CUI_MODAL_FOOT, CUI_MODAL_HEAD, CUI_MODAL_TITLE, CUI_SELECT,
  CUI_TEXTAREA,
} from '../../utils/console-ui';
import { createAgencyRequest, toLocalInput, type AgencySendRequest } from './agency-send-api';

interface SenderNumber { phone_number?: string; phone?: string }

interface Props {
  show: boolean;
  onClose: () => void;
  onCreated: (r: AgencySendRequest) => void;
}

type Step = 1 | 2 | 3;

/** 파일 헤더에서 전화번호 열을 추정한다. 사용자가 고르게 두되 기본값을 맞춰 둔다 */
function guessPhoneColumn(headers: string[]): string {
  const hit = headers.find((h) => /전화|휴대|핸드폰|폰|번호|phone|mobile|hp|tel/i.test(h));
  return hit || headers[0] || '';
}

/** 문안 안 %변수% 목록 */
function extractVars(content: string): string[] {
  const out = new Set<string>();
  for (const m of String(content || '').matchAll(/%([^%\s]{1,20})%/g)) out.add(m[1]);
  return [...out];
}

const ONLY_DIGITS = (s: string) => String(s || '').replace(/[^0-9]/g, '');

export default function AgencySendComposer({ show, onClose, onCreated }: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);

  // ① 대상
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [phoneColumn, setPhoneColumn] = useState('');
  const [pasted, setPasted] = useState('');
  const [parsing, setParsing] = useState(false);

  // ② 문안
  const [content, setContent] = useState('');
  const [subject, setSubject] = useState('');
  const [isAd, setIsAd] = useState(false);
  const [varMapping, setVarMapping] = useState<Record<string, string>>({});
  const [mmsOpen, setMmsOpen] = useState(false);
  const mms = useMmsUpload((m) => toast.error(m));

  // ③ 시각·담당자
  const [requestedAt, setRequestedAt] = useState('');
  const [managerPhone, setManagerPhone] = useState('');
  const [callbackNumber, setCallbackNumber] = useState('');
  const [senders, setSenders] = useState<string[]>([]);

  const messageType: 'SMS' | 'LMS' | 'MMS' = mms.mmsUploadedImages.length > 0
    ? 'MMS'
    : (content.length > 45 || subject.trim() ? 'LMS' : 'SMS');

  /** 파일에서 뽑은 번호 또는 붙여넣은 번호 */
  const recipients = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ phone: string; vars: Record<string, any> }> = [];
    if (rows.length > 0 && phoneColumn) {
      for (const r of rows) {
        const phone = ONLY_DIGITS(r[phoneColumn]);
        if (phone.length < 10 || seen.has(phone)) continue;
        seen.add(phone);
        const vars: Record<string, any> = {};
        for (const [varName, col] of Object.entries(varMapping)) {
          if (col && r[col] !== undefined) vars[varName] = r[col];
        }
        out.push({ phone, vars });
      }
      return out;
    }
    for (const raw of pasted.split(/[\s,;]+/)) {
      const phone = ONLY_DIGITS(raw);
      if (phone.length < 10 || seen.has(phone)) continue;
      seen.add(phone);
      out.push({ phone, vars: {} });
    }
    return out;
  }, [rows, phoneColumn, pasted, varMapping]);

  const usedVars = useMemo(() => extractVars(content), [content]);

  const reset = () => {
    setStep(1); setFileName(null); setHeaders([]); setRows([]); setPhoneColumn(''); setPasted('');
    setContent(''); setSubject(''); setIsAd(false); setVarMapping({});
    setRequestedAt(''); setManagerPhone(''); setCallbackNumber('');
    mms.setMmsUploadedImages([]);
  };

  const close = () => { reset(); onClose(); };

  // 직접발송이 쓰는 것과 같은 목록을 쓴다(등록·배정 규칙이 한 곳에 있다)
  const loadSenders = async () => {
    try {
      const res = await fetch('/api/companies/callback-numbers', { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } });
      const data = await res.json();
      const list: SenderNumber[] = data?.numbers || [];
      const phones = list.map((s) => ONLY_DIGITS(s.phone || s.phone_number || '')).filter(Boolean);
      setSenders([...new Set(phones)]);
      const def = list.find((s: any) => s.is_default);
      if (def) setCallbackNumber(ONLY_DIGITS(def.phone || def.phone_number || ''));
      else if (phones.length === 1) setCallbackNumber(phones[0]);
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
      setHeaders(hs);
      setRows(data.allData || data.preview || []);
      setFileName(file.name);
      setPhoneColumn(guessPhoneColumn(hs));
      setPasted('');
    } catch {
      toast.error('파일을 읽는 중 문제가 생겼습니다.');
    } finally {
      setParsing(false);
    }
  };

  /** 2단계로 넘어갈 때 문안 변수와 파일 열을 같은 이름끼리 자동으로 맞춘다 */
  const goStep2 = () => {
    if (recipients.length === 0) { toast.error('보낼 번호가 없습니다. 파일을 올리거나 번호를 넣어 주세요.'); return; }
    setStep(2);
  };

  const goStep3 = () => {
    if (!content.trim()) { toast.error('문안을 입력해 주세요.'); return; }
    if ((messageType === 'LMS' || messageType === 'MMS') && !subject.trim()) {
      toast.error('제목을 입력해 주세요. 긴 문자와 이미지 문자에는 제목이 필요합니다.');
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
    if (ONLY_DIGITS(managerPhone).length < 10) { toast.error('테스트 문자를 받을 담당자 번호를 넣어 주세요.'); return; }
    if (!requestedAt) { toast.error('보낼 시각을 정해 주세요.'); return; }

    setSaving(true);
    try {
      const created = await createAgencyRequest({
        messageType,
        subject: subject.trim() || undefined,
        content: content.trim(),
        isAd,
        callbackNumber,
        managerPhone: ONLY_DIGITS(managerPhone),
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

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-neutral-900/45 flex items-center justify-center p-4">
      <div className={`${CUI_MODAL} max-w-[720px]`} role="dialog" aria-modal="true" aria-label="대행발송 접수">
        <div className={CUI_MODAL_HEAD}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-indigo-600 text-white grid place-items-center">
              <Send className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h3 className={CUI_MODAL_TITLE}>대행발송 접수</h3>
              <p className={CUI_MODAL_DESC}>
                {step === 1 ? '1단계. 누구에게 보낼지' : step === 2 ? '2단계. 무엇을 보낼지' : '3단계. 언제 보낼지'}
              </p>
            </div>
          </div>
          <button type="button" onClick={close} className={CUI_MODAL_CLOSE} aria-label="닫기">
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className={CUI_MODAL_BODY}>
          {/* ── 1단계: 대상 ── */}
          {step === 1 && (
            <>
              <div>
                <label className={CUI_LABEL}>명단 파일</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
                />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={parsing} className={CUI_BTN_OUTLINE}>
                  {parsing ? <Loader2 className="w-[15px] h-[15px] animate-spin" /> : <Upload className="w-[15px] h-[15px]" />}
                  {fileName ? '다른 파일 고르기' : '엑셀 또는 CSV 올리기'}
                </button>
                {fileName && (
                  <div className="mt-2.5 flex items-center gap-2 text-[13px] text-neutral-700">
                    <FileSpreadsheet className="w-4 h-4 text-indigo-600" strokeWidth={2} />
                    <span className="font-medium truncate">{fileName}</span>
                    <span className="text-neutral-400 tabular-nums">{rows.length.toLocaleString()}행</span>
                  </div>
                )}
                <p className={CUI_HINT}>첫 줄은 열 이름으로 읽습니다. 이름 같은 항목이 있으면 문안에 넣을 수 있습니다.</p>
              </div>

              {headers.length > 0 && (
                <div>
                  <label className={CUI_LABEL}>전화번호 열</label>
                  <select value={phoneColumn} onChange={(e) => setPhoneColumn(e.target.value)} className={CUI_SELECT}>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              )}

              {!fileName && (
                <div>
                  <label className={CUI_LABEL}>또는 번호를 직접 넣기</label>
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    rows={5}
                    placeholder={'01012345678\n01087654321'}
                    className={CUI_TEXTAREA}
                  />
                  <p className={CUI_HINT}>줄바꿈이나 쉼표로 나눠 넣으세요.</p>
                </div>
              )}

              <div className={CUI_INFO}>
                <Check className={CUI_INFO_ICON} size={16} strokeWidth={2} />
                <p className={CUI_INFO_TEXT}>
                  보낼 번호 <b className="tabular-nums">{recipients.length.toLocaleString()}</b>건.
                  같은 번호와 형식이 맞지 않는 번호는 자동으로 뺐습니다.
                </p>
              </div>
            </>
          )}

          {/* ── 2단계: 문안 ── */}
          {step === 2 && (
            <>
              <div>
                <label className={CUI_LABEL}>제목 {(messageType === 'LMS' || messageType === 'MMS') && <span className="text-rose-500">*</span>}</label>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} className={CUI_INPUT} placeholder="가을 신상 행사 안내" />
              </div>

              <div>
                <label className={CUI_LABEL}>문안 <span className="text-rose-500">*</span></label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={7}
                  placeholder={'[한줄상회] %이름%님, 8월 24일 오후 2시부터 가을 신상 행사를 엽니다.'}
                  className={CUI_TEXTAREA}
                />
                <p className={CUI_HINT}>
                  퍼센트 기호로 감싼 낱말(예: %이름%)은 고객마다 다른 값이 들어갑니다.
                  지금 형식은 <b>{messageType}</b>입니다.
                </p>
              </div>

              {usedVars.length > 0 && headers.length > 0 && (
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

              {usedVars.length > 0 && headers.length === 0 && (
                <div className={CUI_DANGER_BOX}>
                  <AlertTriangle className={CUI_DANGER_ICON} size={16} strokeWidth={2} />
                  <p className={CUI_DANGER_TEXT}>
                    문안에 넣을 항목이 있는데 명단이 번호만 있습니다. 항목이 있는 파일을 올리거나 문안에서 그 부분을 빼 주세요.
                  </p>
                </div>
              )}

              <div>
                <label className={CUI_LABEL}>이미지</label>
                <button type="button" onClick={() => setMmsOpen(true)} className={CUI_BTN_OUTLINE}>
                  <ImageIcon className="w-[15px] h-[15px]" />
                  {mms.mmsUploadedImages.length > 0 ? `${mms.mmsUploadedImages.length}장 첨부됨` : '이미지 넣기'}
                </button>
                <p className={CUI_HINT}>이미지를 넣으면 이미지 문자로 나갑니다. 라이브러리 소재도 고를 수 있습니다.</p>
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={isAd} onChange={(e) => setIsAd(e.target.checked)} className="w-4 h-4 rounded accent-indigo-600" />
                <span className="text-[13px] text-neutral-700">광고 문자입니다</span>
              </label>
              {isAd && <p className={CUI_HINT}>맨 앞에 광고 표시와 무료 수신거부 번호가 자동으로 붙습니다.</p>}
            </>
          )}

          {/* ── 3단계: 시각·담당자 ── */}
          {step === 3 && (
            <>
              <div>
                <label className={CUI_LABEL}>보내는 번호 <span className="text-rose-500">*</span></label>
                <select value={callbackNumber} onChange={(e) => setCallbackNumber(e.target.value)} className={CUI_SELECT}>
                  <option value="">고르세요</option>
                  {senders.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                {senders.length === 0 && <p className={CUI_HINT}>등록된 번호가 없습니다. 발신번호 등록을 먼저 해 주세요.</p>}
              </div>

              <div>
                <label className={CUI_LABEL}>보낼 시각 <span className="text-rose-500">*</span></label>
                <input type="datetime-local" value={requestedAt} onChange={(e) => setRequestedAt(e.target.value)} className={CUI_INPUT} />
                <p className={CUI_HINT}>
                  지금부터 3시간 뒤부터 정할 수 있습니다. 문안 검사와 승인, 발송 직전 재검사에 필요한 시간입니다.
                </p>
              </div>

              <div>
                <label className={CUI_LABEL}>테스트 문자를 받을 담당자 번호 <span className="text-rose-500">*</span></label>
                <input value={managerPhone} onChange={(e) => setManagerPhone(e.target.value)} className={CUI_INPUT} placeholder="01012345678" />
                <p className={CUI_HINT}>검사를 통과한 문안을 이 번호로 먼저 보내 드립니다. 확인하고 승인하면 예약됩니다.</p>
              </div>

              <div className={CUI_INFO}>
                <Check className={CUI_INFO_ICON} size={16} strokeWidth={2} />
                <p className={CUI_INFO_TEXT}>
                  {recipients.length.toLocaleString()}건 · {messageType}
                  {mms.mmsUploadedImages.length > 0 ? ` · 이미지 ${mms.mmsUploadedImages.length}장` : ''}
                  {isAd ? ' · 광고' : ''}
                </p>
              </div>
            </>
          )}
        </div>

        <div className={CUI_MODAL_FOOT}>
          {step > 1 ? (
            <button type="button" onClick={() => setStep((step - 1) as Step)} className={CUI_BTN_GHOST}>
              <ArrowLeft className="w-[15px] h-[15px]" />이전
            </button>
          ) : <span />}
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
