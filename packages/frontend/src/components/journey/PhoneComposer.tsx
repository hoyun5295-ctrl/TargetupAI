/**
 * PhoneComposer — 받은 문자 모양 그대로 쓰는 큰 휴대폰 (★ 2026-10-20 여정 V.3 §9-4 · 편집기 한 벌)
 *
 * 쓰는 자리 = 고객 휴대폰에 도착한 회색 말풍선 안. 보이는 것과 세는 것이 **실제 나가는 형태**다.
 *   - (광고) · 무료수신거부 줄은 발송이 붙이는 회색 잠금 줄로 보인다(저장 본문에는 넣지 않는다 · 이중 부착 차단 규약).
 *   - 바이트 = 그 합성 그대로(buildAdMessageFront · 직접발송 화면과 같은 함수).
 *   - [받는 모습] = 서버 미리보기 1회(발송 치환 함수 · 이 여정 대상 고객 1명). 서버가 정답이다.
 * ⛔ 080 번호 · 샘플 고객은 호출부가 넘긴다(작업 화면 훅이 채운다). 비어 있으면 「무료수신거부」만 보인다(지어내지 않는다).
 * ⛔ 제목 상한 = LMS_SUBJECT_MAX_CHARS(서버 JOURNEY_SUBJECT_MAX_CHARS 와 같은 40). 이미 넘은 제목은 자르지 않고 알린다(고객 문안을 몰래 바꾸지 않는다).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Eye, Image as ImageIcon, Loader2, Lock, PenLine, User } from 'lucide-react';
import { buildAdMessageFront, buildAdSubjectFront, calculateSmsBytes, LMS_SUBJECT_MAX_CHARS, startsWithAdMark } from '../../utils/formatDate';
import { highlightVars, mergeVarsPlain } from '../../utils/highlightVars';
import { renderLiquid, flattenCustomerForLiquid } from '../../utils/liquid-templating';
import { stepChannelLabel } from '../../utils/journey-labels';

export type ComposerChannel = 'sms' | 'lms' | 'mms';

interface Props {
  channel: ComposerChannel;
  subject: string;
  body: string;
  isAd: boolean;
  opt080Number?: string;
  /** 없으면 읽기 전용(켜진 여정 잠금 · 알림 칸 등). */
  onSubject?: (v: string) => void;
  onBody?: (v: string) => void;
  textareaRef?: RefObject<HTMLTextAreaElement>;
  /** [받는 모습]을 서버에 묻는 여정(저장된 여정). 없으면 아래 샘플 고객으로 화면이 치환한다(만드는 중인 초안). */
  journeyId?: string;
  sampleCustomer?: Record<string, string | number | null> | null;
  sampleCustomerFields?: Record<string, any> | null;
  /** 머리 줄 보낸 사람(회신번호 등) · 없으면 「문자 메시지」. */
  senderLabel?: string;
  imageCount?: number;
  placeholder?: string;
  /** 휴대폰 아래 한 줄(편집 정책 이유 등). */
  footer?: ReactNode;
  /** 칸이 바뀌면 [쓰기]로 돌아간다(다른 칸의 받는 모습을 보여 주지 않게). */
  resetKey?: string | number;
}

const MAX_BYTES: Record<ComposerChannel, number> = { sms: 90, lms: 2000, mms: 2000 };

export default function PhoneComposer({
  channel, subject, body, isAd, opt080Number = '', onSubject, onBody, textareaRef, journeyId,
  sampleCustomer = null, sampleCustomerFields = null, senderLabel, imageCount = 0, placeholder, footer, resetKey,
}: Props) {
  const msgType = channel.toUpperCase();
  const readOnly = !onBody;
  const [mode, setMode] = useState<'write' | 'see'>('write');
  const [server, setServer] = useState<{ message: string; subject: string; sampleName: string | null; hasSample: boolean } | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const reqSeq = useRef(0);
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const taRef = textareaRef || innerRef;

  useEffect(() => { setMode('write'); }, [resetKey]);
  // ★ Codex 적대 B8 — 받는 모습 응답은 그 입력의 것이다. 칸 · 문안 · 제목 · 채널 · 광고 표기가 바뀌면 지난 응답 · 진행 중 요청을 버린다.
  useEffect(() => { reqSeq.current++; setServer(null); setServerErr(null); setServerBusy(false); }, [resetKey, body, subject, channel, isAd, journeyId]);

  const composed = useMemo(() => buildAdMessageFront(body || '', msgType, isAd, opt080Number), [body, msgType, isAd, opt080Number]);
  // 잠금 줄 = 합성이 실제로 붙인 것만(본문에 이미 있으면 다시 그리지 않는다).
  const adPrefix = isAd && !startsWithAdMark(body || '') ? (channel === 'sms' ? '(광고)' : '(광고) ') : '';
  const footerLine = useMemo(() => {
    if (!isAd) return '';
    const trimmed = (body || '').replace(/\n+$/, '');
    const rest = composed.slice((adPrefix + trimmed).length);
    return rest.startsWith('\n') ? rest.trim() : '';
  }, [composed, body, adPrefix, isAd]);
  const bytes = useMemo(() => calculateSmsBytes(composed), [composed]);
  const maxBytes = MAX_BYTES[channel];
  const serverBytes = server ? calculateSmsBytes(server.message) : null;
  const shownBytes = mode === 'see' && serverBytes != null ? serverBytes : bytes;
  const over = shownBytes > maxBytes;
  const subjectOver = channel !== 'sms' && (subject || '').length > LMS_SUBJECT_MAX_CHARS;

  /** 화면 치환(초안 · 서버 미리보기를 못 쓸 때) — 샘플이 없으면 원문 그대로(지어낸 값 0). */
  const localSeen = useMemo(() => {
    const raw = body || '';
    const merged = sampleCustomer
      ? mergeVarsPlain(renderLiquid(raw, { customer: flattenCustomerForLiquid(sampleCustomerFields || {}) }).rendered, sampleCustomer, sampleCustomerFields || undefined)
      : raw;
    return buildAdMessageFront(merged, msgType, isAd, opt080Number);
  }, [body, sampleCustomer, sampleCustomerFields, msgType, isAd, opt080Number]);

  const openSee = async () => {
    setMode('see');
    const seq = ++reqSeq.current;
    setServer(null);
    setServerErr(null);
    if (!journeyId || !(body || '').trim()) { setServerBusy(false); return; }
    setServerBusy(true);
    try {
      const r = await fetch('/api/ai/operator/journeys/preview-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ journeyId, message: body, subject, isAd, channel }),
      });
      const d = await r.json().catch(() => ({}));
      if (seq !== reqSeq.current) return;
      if (!r.ok || !d?.success) throw new Error(d?.error || '받는 모습을 불러오지 못했어요.');
      setServer({ message: String(d.previewMessage || ''), subject: String(d.previewSubject || ''), sampleName: d.sampleName || null, hasSample: !!d.hasSample });
    } catch (e: any) {
      if (seq === reqSeq.current) setServerErr(e?.message || '받는 모습을 불러오지 못했어요.');
    } finally {
      if (seq === reqSeq.current) setServerBusy(false);
    }
  };

  const lines = (body || '').split('\n').length;
  const subjectSeen = mode === 'see' && server ? server.subject : buildAdSubjectFront(subject || '', msgType, isAd);
  const seeText = server ? server.message : localSeen;
  const sampleNote = mode !== 'see' ? null
    : journeyId
      ? (server ? (server.hasSample ? `${server.sampleName || '대상'} 고객에게 가는 모습이에요` : '아직 이 조건의 고객이 없어 고객 정보 자리는 비워 보여요') : null)
      : (sampleCustomer ? '대상 고객 1명 기준으로 채워 보여요' : '아직 이 조건의 고객이 없어 원문으로 보여요');

  const tab = (id: 'write' | 'see', label: string, Icon: typeof Eye) => (
    <button type="button" role="tab" aria-selected={mode === id} onClick={() => (id === 'see' ? void openSee() : setMode('write'))}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-medium transition-colors ${mode === id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200/70'}`}>
      <Icon className="w-3.5 h-3.5" aria-hidden />{label}
    </button>
  );

  return (
    <div className="flex w-full min-w-0 flex-col items-center">
      <div role="tablist" aria-label="휴대폰 보기" className="mb-3 inline-flex items-center gap-1 rounded-full bg-slate-100 p-1">
        {tab('write', readOnly ? '문안' : '쓰기', PenLine)}
        {tab('see', '받는 모습', Eye)}
      </div>

      {/* 휴대폰 틀 — 폭 360~380 · 좁은 화면은 화면 폭에 맞춘다 */}
      <div className="w-full max-w-[380px] rounded-[2.6rem] bg-slate-900 p-[10px] shadow-[0_24px_60px_-20px_rgba(15,23,42,0.45)]">
        <div className="relative flex min-h-[520px] flex-col overflow-hidden rounded-[2.1rem] bg-white">
          <div className="flex justify-center pt-2.5"><span className="h-[22px] w-[96px] rounded-full bg-slate-900" aria-hidden /></div>
          <div className="flex flex-col items-center gap-1 border-b border-slate-100 px-5 pb-3 pt-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-500" aria-hidden>
              <User className="h-5 w-5" />
            </span>
            <span className="max-w-full truncate text-[12px] text-slate-500">{senderLabel || '문자 메시지'}</span>
          </div>

          <div className="flex-1 px-4 pb-4 pt-3">
            <div className="mb-2 text-center text-[12px] text-slate-400">{stepChannelLabel(channel)}</div>
            <div className={`max-w-[92%] rounded-[22px] rounded-bl-md bg-[#e9e9eb] px-4 py-3 text-slate-900 ${mode === 'write' && !readOnly ? 'focus-within:ring-2 focus-within:ring-indigo-300' : ''}`}>
              {mode === 'see' && serverBusy ? (
                <div className="flex items-center gap-2 py-6 text-[14px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />받는 모습을 만드는 중</div>
              ) : mode === 'see' ? (
                <>
                  {channel !== 'sms' && subjectSeen && <div className="mb-2 border-b border-slate-300/70 pb-2 text-[16px] font-semibold leading-snug">{subjectSeen}</div>}
                  {imageCount > 0 && <ImageChip n={imageCount} />}
                  <div className="whitespace-pre-wrap break-words text-[16px] leading-[1.65]">
                    {seeText ? (server || sampleCustomer ? seeText : highlightVars(seeText)) : <span className="text-slate-400">문안이 비어 있어요.</span>}
                  </div>
                </>
              ) : (
                <>
                  {channel !== 'sms' && (
                    <div className="mb-2 flex items-center gap-1.5 border-b border-slate-300/70 pb-2">
                      {isAd && !startsWithAdMark(subject || '') && <LockedMark text="(광고)" />}
                      <input
                        value={subject || ''}
                        readOnly={!onSubject}
                        onChange={(e) => {
                          const v = e.target.value;
                          // 넘는 입력은 받지 않되 이미 넘은 제목은 줄이는 쪽 입력만 받는다(자르지 않는다).
                          if (v.length <= LMS_SUBJECT_MAX_CHARS || v.length < (subject || '').length) onSubject?.(v);
                        }}
                        placeholder="제목"
                        aria-label="제목"
                        className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold leading-snug placeholder:font-normal placeholder:text-slate-400 focus:outline-none"
                      />
                    </div>
                  )}
                  {imageCount > 0 && <ImageChip n={imageCount} />}
                  {adPrefix && <div className="mb-0.5"><LockedMark text={adPrefix.trim()} /></div>}
                  <textarea
                    ref={taRef}
                    value={body || ''}
                    readOnly={readOnly}
                    onChange={(e) => onBody?.(e.target.value)}
                    rows={Math.min(18, Math.max(5, lines + 1))}
                    placeholder={placeholder || '고객에게 보낼 문안을 여기에 써요.'}
                    aria-label="문안"
                    className="block w-full resize-none bg-transparent text-[16px] leading-[1.65] placeholder:text-slate-400 focus:outline-none"
                  />
                  {footerLine && <div className="mt-1"><LockedMark text={footerLine} /></div>}
                </>
              )}
            </div>
            {mode === 'see' && serverErr && <p className="mt-2 text-[12px] text-rose-700">{serverErr}</p>}
          </div>
        </div>
      </div>

      {/* 바이트 막대 — 실제 나가는 형태 기준 */}
      <div className="mt-3 w-full max-w-[380px]">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div className={`h-full rounded-full transition-[width] ${over ? 'bg-rose-500' : shownBytes / maxBytes > 0.85 ? 'bg-amber-400' : 'bg-indigo-500'}`}
            style={{ width: `${Math.min(100, Math.max(2, (shownBytes / maxBytes) * 100))}%` }} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
          <span className={`tabular-nums ${over ? 'font-semibold text-rose-700' : 'text-slate-600'}`}>{shownBytes.toLocaleString('ko-KR')} / {maxBytes.toLocaleString('ko-KR')}바이트</span>
          {isAd && <span className="text-slate-400">광고 표기 포함</span>}
          {mode === 'see' && serverBytes != null && serverBytes !== bytes && (
            <span className="text-slate-500">고객 값이 들어가면 {bytes.toLocaleString('ko-KR')}바이트에서 {serverBytes.toLocaleString('ko-KR')}바이트가 돼요</span>
          )}
          {over && channel === 'sms' && <span className="text-rose-700">90바이트를 넘으면 문자가 잘리지 않게 장문 문자로 보내야 해요</span>}
          {subjectOver && <span className="text-rose-700">제목이 {LMS_SUBJECT_MAX_CHARS}자를 넘어요. 줄여 주세요</span>}
        </div>
        {sampleNote && <p className="mt-1 text-[12px] text-slate-500">{sampleNote}</p>}
        {footer && <div className="mt-2">{footer}</div>}
      </div>
    </div>
  );
}

function LockedMark({ text }: { text: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-300/50 px-1.5 py-0.5 text-[13px] text-slate-500" title="발송할 때 자동으로 붙어요">
      <Lock className="h-3 w-3 shrink-0" aria-hidden /><span className="truncate">{text}</span>
    </span>
  );
}

function ImageChip({ n }: { n: number }) {
  return (
    <div className="mb-2 flex h-24 items-center justify-center gap-1.5 rounded-xl bg-slate-300/60 text-[13px] text-slate-600">
      <ImageIcon className="h-4 w-4" aria-hidden />사진 {n}장이 함께 가요
    </div>
  );
}
