/**
 * AgencyPreviewModal — 대행발송 치환 미리보기 (★2026-08-28(2) Harold 지시 신설)
 *
 * 서수란 접수 `cmtcle8gn04bnjnot641p0fvq`의 최종 형태. 상세 안에 목록으로 늘어놓지 않고 **별도 모달**로 뺀다:
 * 왼쪽에 받는 사람 목록(10건씩 페이징), 오른쪽에 받는 화면 그대로의 폰 미리보기. 목록을 누르면 폰이 바뀐다.
 *
 * ⛔ 문장은 **서버가 조립한 것만** 그린다(`samples[].text`). 화면에서 치환을 다시 만들지 않는다 —
 *   그 순간 미리보기가 실물(스팸 검사·담당자 테스트 문자·본 발송)과 갈린다(불변 4 · CT = agency-send-preview.ts).
 * ⛔ `createPortal`로 body에 붙인다. 이 모달은 **상세 모달 안에서** 열리는 중첩 오버레이인데,
 *   부모 `CUI_MODAL`에 `overflow-hidden`이 있어 그대로 두면 부모 박스 크기로 잘린다(console-ui 주석 · 2026-08-18 P0 선례).
 * ⛔ 톤은 부모(대행발송 인디고 콘솔)와 같게. 줄표 0 · native dialog 0.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Image as ImageIcon, Loader2, Send, X } from 'lucide-react';
import { calculateSmsBytes } from '../../utils/formatDate';
import MmsImagePreview from '../shared/MmsImagePreview';
import {
  CUI_MODAL, CUI_MODAL_CLOSE, CUI_MODAL_DESC, CUI_MODAL_HEAD, CUI_MODAL_TITLE,
} from '../../utils/console-ui';
import type { AgencyPreviewSample } from './agency-send-api';

/** 한 페이지에 보여 줄 사람 수. 서버 상한 50과 짝(50 = 10건씩 5페이지) */
export const PREVIEW_PAGE_SIZE = 10;

interface Props {
  show: boolean;
  onClose: () => void;
  /** 모달 제목 = 접수 이름(파일명). 부제는 건수·타입 등 한 줄 */
  title: string;
  subtitle?: string;
  samples: AgencyPreviewSample[];
  /** 표본 수(= samples.length) · 명단 전체 수 */
  shown: number;
  total: number;
  messageType: string;
  callbackNumber?: string | null;
  /** MMS 이미지(원장 `mms_image_paths` 그대로). 공용 MmsImagePreview가 서버 경로를 서빙 URL로 바꿔 그린다 */
  images?: any[];
  loading?: boolean;
  error?: string;
}

export default function AgencyPreviewModal({
  show, onClose, title, subtitle, samples, shown, total,
  messageType, callbackNumber, images = [], loading = false, error = '',
}: Props) {
  const imageList = Array.isArray(images) ? images : [];
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(0);

  // 접수가 바뀌면 첫 사람부터 다시 본다(앞 접수의 선택이 남으면 엉뚱한 사람이 켜져 있다)
  useEffect(() => {
    if (show) { setPage(0); setSelected(0); }
  }, [show, samples]);

  const pageCount = Math.max(1, Math.ceil(samples.length / PREVIEW_PAGE_SIZE));
  const pageItems = useMemo(
    () => samples.slice(page * PREVIEW_PAGE_SIZE, (page + 1) * PREVIEW_PAGE_SIZE),
    [samples, page],
  );
  const current: AgencyPreviewSample | null = samples[selected] || null;

  /** 페이지를 넘기면 그 페이지 첫 사람을 켠다(빈 폰이 남지 않게) */
  const movePage = (next: number) => {
    const p = Math.max(0, Math.min(pageCount - 1, next));
    setPage(p);
    setSelected(p * PREVIEW_PAGE_SIZE);
  };

  if (!show) return null;

  const limit = messageType === 'SMS' ? 90 : 2000;
  const bytes = current ? calculateSmsBytes(current.text) : 0;

  return createPortal(
    <div className="fixed inset-0 z-[1500] bg-neutral-900/45 flex items-center justify-center p-4">
      <div className={`${CUI_MODAL} max-w-[880px]`} role="dialog" aria-modal="true" aria-label="받는 사람별 발송 내용 미리보기">
        <div className={CUI_MODAL_HEAD}>
          <div className="min-w-0">
            <h3 className={CUI_MODAL_TITLE}>받는 사람별 발송 내용</h3>
            <p className={`${CUI_MODAL_DESC} truncate`}>{title}{subtitle ? ` · ${subtitle}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} className={CUI_MODAL_CLOSE} aria-label="닫기">
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && <div className="py-16 grid place-items-center text-neutral-400"><Loader2 className="w-5 h-5 animate-spin" /></div>}
          {error && !loading && <p className="py-10 text-center text-[13px] text-rose-600">{error}</p>}
          {!loading && !error && samples.length === 0 && (
            <p className="py-16 text-center text-[13px] text-neutral-400">보여 줄 수신자가 없습니다.</p>
          )}

          {!loading && !error && samples.length > 0 && (
            <div className="flex flex-col md:flex-row gap-5">
              {/* 왼쪽: 받는 사람 목록 */}
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] text-neutral-500 mb-2">
                  {total > shown
                    ? <>전체 <span className="tabular-nums font-semibold text-neutral-700">{total.toLocaleString()}</span>명 가운데 상위 <span className="tabular-nums font-semibold text-neutral-700">{shown}</span>명의 목록입니다. 누르면 오른쪽 화면이 바뀝니다.</>
                    : <>받는 사람 <span className="tabular-nums font-semibold text-neutral-700">{shown}</span>명 전체입니다. 누르면 오른쪽 화면이 바뀝니다.</>}
                </p>
                <ul className="rounded-xl border border-neutral-200 divide-y divide-neutral-100 overflow-hidden">
                  {pageItems.map((s, i) => {
                    const idx = page * PREVIEW_PAGE_SIZE + i;
                    const on = idx === selected;
                    return (
                      <li key={idx}>
                        <button
                          type="button"
                          onClick={() => setSelected(idx)}
                          className={`w-full text-left px-3.5 py-2.5 transition-colors ${on ? 'bg-indigo-50' : 'bg-white hover:bg-neutral-50'}`}
                          aria-current={on}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-[13px] font-semibold tabular-nums ${on ? 'text-indigo-700' : 'text-neutral-900'}`}>{s.phone}</span>
                            <span className="text-[11.5px] text-neutral-400 tabular-nums shrink-0">{idx + 1}번째</span>
                          </div>
                          <p className="mt-0.5 text-[12px] text-neutral-500 truncate">{s.text.replace(/\n/g, ' ')}</p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {pageCount > 1 && (
                  <div className="mt-2.5 flex items-center justify-center gap-2">
                    <button
                      type="button" onClick={() => movePage(page - 1)} disabled={page === 0}
                      className="h-8 w-8 grid place-items-center rounded-lg border border-neutral-200 bg-white text-neutral-500 hover:text-neutral-900 disabled:opacity-40"
                      aria-label="이전"
                    ><ChevronLeft className="w-4 h-4" strokeWidth={2.2} /></button>
                    <span className="text-[12px] text-neutral-500 tabular-nums">{page + 1} / {pageCount}</span>
                    <button
                      type="button" onClick={() => movePage(page + 1)} disabled={page >= pageCount - 1}
                      className="h-8 w-8 grid place-items-center rounded-lg border border-neutral-200 bg-white text-neutral-500 hover:text-neutral-900 disabled:opacity-40"
                      aria-label="다음"
                    ><ChevronRight className="w-4 h-4" strokeWidth={2.2} /></button>
                  </div>
                )}
              </div>

              {/* 오른쪽: 받는 화면 그대로 (서버가 조립한 문장만 그린다) */}
              <div className="w-full md:w-[320px] shrink-0">
                <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-neutral-100 flex items-center justify-between">
                    <span className="text-[11.5px] font-medium text-neutral-400">문자메시지</span>
                    <span className="text-[11.5px] font-bold text-indigo-600">{messageType}</span>
                  </div>
                  <div className="px-4 py-4 min-h-[320px]">
                    <div className="flex gap-2.5">
                      <span className="h-8 w-8 shrink-0 rounded-xl bg-indigo-50 text-indigo-600 grid place-items-center">
                        <Send className="w-3.5 h-3.5" strokeWidth={2} />
                      </span>
                      <div className="min-w-0 rounded-2xl rounded-tl-md border border-neutral-200 bg-white px-3.5 py-3 shadow-sm">
                        {imageList.length > 0 && (
                          <div className="mb-2">
                            {/* 실제 붙어 나갈 이미지 그대로. 공용 CT가 서버 경로를 서빙 URL로 바꾼다 */}
                            <MmsImagePreview images={imageList} size="full" maxHeight="200px" compact borderColor="border border-neutral-200" />
                            <span className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-neutral-500">
                              <ImageIcon className="w-3 h-3" strokeWidth={2} />이미지 {imageList.length}장이 함께 나갑니다
                            </span>
                          </div>
                        )}
                        {current?.subject && (
                          <p className="text-[13px] font-bold text-neutral-900 mb-1 break-words">{current.subject}</p>
                        )}
                        <p className="text-[13px] leading-relaxed text-neutral-800 whitespace-pre-wrap break-words">{current?.text || ''}</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-4 py-2.5 border-t border-neutral-100 text-center">
                    <span className={`text-[11.5px] tabular-nums ${bytes > limit ? 'text-rose-600 font-semibold' : 'text-neutral-400'}`}>
                      {bytes} / {limit} bytes
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-[12px] text-neutral-500 text-center">
                  {current ? <><span className="tabular-nums font-semibold text-neutral-700">{current.phone}</span>에게 나갈 내용입니다</> : ''}
                </p>
                {callbackNumber && (
                  <p className="mt-0.5 text-[11.5px] text-neutral-400 text-center tabular-nums">보내는 번호 {callbackNumber}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
