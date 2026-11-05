/**
 * FallbackPhoneModal — 카카오(브랜드 · 알림톡)가 실패하면 나갈 문자를 **휴대폰 모양 창**에서 쓰고 [저장] (★ 2026-11-05 C107 · 접수 T1 · Harold H1 · H2)
 *
 * 왜 창인가: 발송 바 풍선(2줄 입력칸)에서 대체 문안을 쓰게 하니 칸이 비좁고, 늘리면 창 전체가 아래로 길어졌다(박성용 접수).
 *   - 창 높이는 화면 안에 고정 · 긴 글은 말풍선 안에서만 스크롤
 *   - 받는 사람이 보는 모양(문자 말풍선) 그대로 쓴다 · 광고면 (광고) · 무료거부 줄이 고정으로 보인다(서버 resolveBrandFallback 과 같은 글 = buildAdMessageFront 미러)
 *   - 바이트 = calculateSmsBytes(서버 eucKrByteLength 와 같은 규칙) · SMS 90 / LMS 2,000 넘으면 [저장]을 막는다(서버도 같은 판정)
 *   - 초안은 창이 들고 있다가 [저장] 때만 부모로 · [취소] · ESC · 바깥 = 버림
 *
 * 판정은 부모가 넘긴 종류표(options)가 소유한다 — 브랜드 = 대체 안 함 · SMS · LMS / 알림톡 = 대체 안 함 · 원문 그대로 LMS · 대체문안 LMS.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Smartphone, FileDown, AlertTriangle } from 'lucide-react';
import { buildAdMessageFront, calculateSmsBytes } from '../../utils/formatDate';

export interface FallbackOption {
  code: string;
  label: string;
  desc?: string;
  /** 무엇으로 나가나 — none = 대체 안 함 */
  kind: 'none' | 'SMS' | 'LMS';
  /** 말풍선을 고칠 수 있나(알림톡 「원문 그대로」 = 템플릿 본문 · 읽기만) */
  editable: boolean;
  /** LMS 제목이 필요한가 */
  needsTitle: boolean;
  /** 말풍선이 비면 본문을 그대로 보내나(브랜드 = 예 · 서버 resolveBrandFallback 재사용 · 알림톡 대체문안 = 아니오 · 필수) */
  reuseBodyWhenEmpty?: boolean;
}

export interface FallbackValue {
  type: string;
  contents: string;
  title: string;
  from?: string;
}

const SMS_MAX = 90;
const LMS_MAX = 2000;

export default function FallbackPhoneModal({
  open, heading, options, value, bodyText, isAd, optOutNumber, callbackNumbers, accent = 'violet', footnote, onSave, onClose,
}: {
  open: boolean;
  /** 창 제목 — 「브랜드메시지가 실패하면」 */
  heading: string;
  options: FallbackOption[];
  value: FallbackValue;
  /** 본문(브랜드 = 편집기 본문 · 알림톡 = 템플릿 본문) — [본문 가져오기] · 원문 그대로 · 빈칸일 때 재사용 미리보기 */
  bodyText: string;
  isAd: boolean;
  optOutNumber?: string;
  /** 대체 발신번호 고르기(브랜드만 · 등록 회신번호 목록 · 없으면 칸을 그리지 않는다) */
  callbackNumbers?: Array<{ phone: string; label?: string; is_default?: boolean }>;
  accent?: 'violet' | 'amber' | 'indigo';
  /** 창 아래 한 줄 안내(선택) */
  footnote?: string;
  onSave: (v: FallbackValue) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<FallbackValue>(value);
  // 열 때마다 부모 값으로 초안을 새로 잡는다(직전에 취소한 초안이 남지 않게)
  useEffect(() => { if (open) setDraft(value); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);   // 캡처 단계 = 부모 발송 창 ESC 보다 먼저
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const opt = options.find((o) => o.code === draft.type) || options[0];
  const kind = opt?.kind || 'none';
  // 실제로 나갈 글 = (편집 칸 · 비면 본문 재사용) + 광고 표기(서버와 같은 함수 미러)
  const effectiveBody = opt?.editable ? (draft.contents.trim() ? draft.contents : (opt.reuseBodyWhenEmpty ? bodyText : '')) : bodyText;
  const finalText = useMemo(
    () => (kind === 'none' ? '' : buildAdMessageFront(effectiveBody || '', kind, isAd, optOutNumber || '')),
    [kind, effectiveBody, isAd, optOutNumber],
  );
  const bytes = calculateSmsBytes(finalText);
  const limit = kind === 'SMS' ? SMS_MAX : LMS_MAX;
  const over = kind !== 'none' && bytes > limit;
  const titleMissing = kind !== 'none' && opt?.needsTitle && !draft.title.trim();
  const bodyMissing = kind !== 'none' && !String(effectiveBody || '').trim();
  const lmsOption = options.find((o) => o.kind === 'LMS' && o.editable);
  const blockReason = over
    ? (kind === 'SMS' ? `SMS는 ${SMS_MAX}바이트까지예요(지금 ${bytes}바이트${isAd ? ' · 광고 표기 포함' : ''}).` : `LMS는 ${LMS_MAX}바이트까지예요(지금 ${bytes}바이트).`)
    : titleMissing ? 'LMS 제목을 넣어 주세요.'
      : bodyMissing ? '보낼 문구를 넣어 주세요.'
        : '';

  // 겉모양 — 고정 줄((광고) · 무료거부)은 말풍선 안에서 고칠 수 없는 줄로 보인다
  const adHead = isAd && kind !== 'none' ? (kind === 'SMS' ? '(광고)' : '(광고) ') : '';
  const adTail = isAd && kind !== 'none' ? finalText.slice(finalText.lastIndexOf('\n') + 1) : '';
  const ring = accent === 'amber' ? 'focus:ring-amber-300' : accent === 'indigo' ? 'focus:ring-indigo-300' : 'focus:ring-violet-300';
  const onTone = accent === 'amber' ? 'bg-amber-500 text-white' : accent === 'indigo' ? 'bg-indigo-600 text-white' : 'bg-violet-600 text-white';

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-slate-900/45 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={heading}
        className="flex w-full max-w-[860px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        style={{ height: 'min(720px, calc(100dvh - 48px))' }}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-600"><Smartphone size={16} strokeWidth={2} /></span>
            <div>
              <p className="m-0 text-[15px] font-bold text-slate-900">{heading}</p>
              <p className="m-0 text-[12px] text-slate-500">받는 사람 휴대폰에 보이는 모양 그대로 써 주세요</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="닫기"><X size={18} /></button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 md:grid-cols-[minmax(0,1fr)_280px]">
          {/* 휴대폰 */}
          <div className="flex min-h-0 justify-center overflow-hidden bg-slate-50 px-4 py-4">
            <div className="flex h-full w-full max-w-[360px] flex-col overflow-hidden rounded-[34px] border-[10px] border-slate-800 bg-white shadow-xl">
              <div className="flex shrink-0 items-center justify-between bg-slate-100 px-4 py-2.5">
                <span className="text-[12px] font-semibold text-slate-700">{draft.from || callbackNumbers?.find((c) => c.is_default)?.phone || '기본 회신번호'}</span>
                <span className="text-[11px] text-slate-400">{kind === 'none' ? '대체 안 함' : kind}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
                {kind === 'none' ? (
                  <p className="mt-10 text-center text-[13px] text-slate-400">카카오가 실패해도 문자를 보내지 않아요.</p>
                ) : (
                  <div className="max-w-[92%] rounded-2xl rounded-tl-md bg-slate-100 px-3.5 py-3">
                    {opt.needsTitle && (
                      <input type="text" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                        placeholder="LMS 제목(필수)" aria-label="LMS 제목"
                        className={`mb-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-800 outline-none focus:ring-2 ${ring}`} />
                    )}
                    {adHead && <p className="m-0 select-none text-[13px] text-slate-500">{adHead.trim()}</p>}
                    {opt.editable ? (
                      <textarea value={draft.contents} onChange={(e) => setDraft({ ...draft, contents: e.target.value })}
                        placeholder={opt.reuseBodyWhenEmpty && bodyText ? `비우면 본문을 그대로 보내요\n\n${bodyText}` : '보낼 문구를 써 주세요'}
                        aria-label="대체 문구"
                        className={`min-h-[180px] w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13.5px] leading-relaxed text-slate-800 outline-none focus:ring-2 ${ring}`} />
                    ) : (
                      <p className="m-0 whitespace-pre-wrap text-[13.5px] leading-relaxed text-slate-800">{bodyText || '템플릿을 먼저 고르세요'}</p>
                    )}
                    {adTail && <p className="m-0 mt-1 select-none text-[12.5px] text-slate-500">{adTail}</p>}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 고르기 · 바이트 */}
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-t border-slate-100 px-5 py-4 md:border-l md:border-t-0">
            <div>
              <p className="m-0 mb-2 text-[12px] font-semibold text-slate-500">문자 종류</p>
              <div className="flex flex-col gap-1.5">
                {options.map((o) => (
                  <button key={o.code} type="button" onClick={() => setDraft({ ...draft, type: o.code })}
                    className={`rounded-xl border px-3 py-2 text-left transition ${draft.type === o.code ? 'border-transparent ' + onTone : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
                    <span className="block text-[13px] font-bold">{o.label}</span>
                    {o.desc && <span className={`block text-[11.5px] ${draft.type === o.code ? 'text-white/85' : 'text-slate-500'}`}>{o.desc}</span>}
                  </button>
                ))}
              </div>
            </div>

            {kind !== 'none' && callbackNumbers && callbackNumbers.length > 0 && (
              <div>
                <p className="m-0 mb-1.5 text-[12px] font-semibold text-slate-500">보내는 번호</p>
                <select value={draft.from || ''} onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                  className={`h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-800 outline-none focus:ring-2 ${ring}`}>
                  <option value="">기본 회신번호</option>
                  {callbackNumbers.map((c) => <option key={c.phone} value={c.phone}>{c.phone}{c.label ? ` · ${c.label}` : ''}</option>)}
                </select>
              </div>
            )}

            {kind !== 'none' && opt.editable && bodyText && (
              <button type="button" onClick={() => setDraft({ ...draft, contents: bodyText })}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-[12.5px] font-semibold text-slate-700 hover:border-slate-300">
                <FileDown size={14} strokeWidth={2} /> 본문 가져오기
              </button>
            )}

            {kind !== 'none' && (
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] text-slate-500">길이{isAd ? ' · 광고 표기 포함' : ''}</span>
                  <span className={`text-[13px] font-bold tabular-nums ${over ? 'text-rose-600' : 'text-slate-800'}`}>{bytes.toLocaleString()} / {limit.toLocaleString()}바이트</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div className={`h-full rounded-full ${over ? 'bg-rose-500' : 'bg-slate-500'}`} style={{ width: `${Math.min(100, (bytes / limit) * 100)}%` }} />
                </div>
              </div>
            )}

            {footnote && <p className="m-0 text-[11.5px] text-slate-400">{footnote}</p>}

            {blockReason && (
              <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-[12.5px] text-rose-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="m-0">{blockReason}</p>
                  {over && kind === 'SMS' && lmsOption && (
                    <button type="button" onClick={() => setDraft({ ...draft, type: lmsOption.code })}
                      className="mt-1.5 rounded-lg bg-white px-2.5 py-1 text-[12px] font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100">LMS로 바꾸기</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className="h-10 rounded-xl px-4 text-[13px] font-semibold text-slate-600 hover:bg-slate-100">취소</button>
          <button type="button" disabled={!!blockReason}
            onClick={() => { onSave({ ...draft, contents: opt?.editable ? draft.contents : '' }); onClose(); }}
            className={`h-10 rounded-xl px-5 text-[13px] font-bold disabled:opacity-40 ${onTone}`}>저장</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
