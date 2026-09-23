/**
 * ★ 2026-09-23 AI 영업 담당자 직접 발송 확인 창(설계서 docs/2026-09-23-outreach-direct-send-design.md §12)
 *
 * - 받는 사람(도메인 굵게) · 도메인 뱃지 · 브랜드 · "(광고)" 제목 · DM 첫 화면 · 오늘 n/상한 · 되돌릴 수 없다는 문장.
 * - 화면에 보이는 값은 전부 서버 값이다. 보내기는 서버에 expectedTo(여기 보인 주소)를 함께 보내고, 그 사이 바뀌었으면 서버가 거절한다.
 * - portal + z-[2000](확인 모달 티어) · ESC 캡처 · 백드롭 클릭 닫힘 0 · native dialog 0.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Send, X, Loader2 } from 'lucide-react';
import { DOMAIN_BADGE, splitEmail, type ContactDomainVerdict } from './sales-outreach-shared';

export interface DirectSendItem {
  jobId: string;
  companyName: string;
  to: string;
  domainVerdict: ContactDomainVerdict;
  directSubject: string | null;
  captureUrl: string | null;
}

interface Props {
  open: boolean;
  items: DirectSendItem[];
  today: number;
  cap: number;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export default function OutreachDirectSendConfirm({ open, items, today, cap, busy, onConfirm, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, busy, onClose]);

  if (!open || items.length === 0) return null;
  const single = items.length === 1 ? items[0] : null;
  const left = Math.max(0, cap - today);

  return createPortal(
    <div className="fixed inset-0 z-[2000] bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-gray-200/70 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200/70 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">{single ? '담당자에게 보냅니다' : `선택한 ${items.length}건을 담당자에게 보냅니다`}</h3>
          <button onClick={onClose} disabled={busy} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 disabled:opacity-40"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          {single ? (
            <div className="flex gap-3">
              {single.captureUrl && (
                <img src={single.captureUrl} alt="모바일 DM 첫 화면" className="w-24 h-44 object-cover object-top rounded-lg border border-gray-200 shrink-0 bg-gray-50" />
              )}
              <div className="min-w-0 space-y-2 text-sm">
                <div>
                  <div className="text-[11px] text-gray-400">받는 사람</div>
                  <div className="text-gray-900 break-all">{splitEmail(single.to).local}<b className="font-semibold">{splitEmail(single.to).domain}</b></div>
                  <span className={`mt-1 inline-block text-[11px] px-1.5 py-0.5 rounded border ${DOMAIN_BADGE[single.domainVerdict].cls}`}>{DOMAIN_BADGE[single.domainVerdict].label}</span>
                </div>
                <div>
                  <div className="text-[11px] text-gray-400">업체</div>
                  <div className="text-gray-900">{single.companyName}</div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-400">제목</div>
                  <div className="text-gray-900 break-keep">{single.directSubject || '제목 없음'}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 divide-y divide-gray-100">
              {items.map((it) => (
                <div key={it.jobId} className="px-3 py-2 text-xs flex items-center gap-2">
                  <span className="w-24 shrink-0 truncate text-gray-900 font-medium">{it.companyName}</span>
                  <span className="flex-1 min-w-0 truncate text-gray-700">{splitEmail(it.to).local}<b>{splitEmail(it.to).domain}</b></span>
                  <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${DOMAIN_BADGE[it.domainVerdict].cls}`}>{DOMAIN_BADGE[it.domainVerdict].label}</span>
                </div>
              ))}
            </div>
          )}
          <div className="text-xs text-gray-500 space-y-1">
            <p>오늘 보낸 수 {today}/{cap}건 · 남은 수 {left}건{!single ? ' · 30초 간격으로 한 건씩 보냅니다' : ''}</p>
            <p>보낸 메일은 되돌릴 수 없습니다. 제목 앞에 (광고)가 붙고, 맨 아래에 발신자 정보와 수신거부 링크가 들어갑니다. 회사 수신함으로 사본이 한 통 따로 갑니다.</p>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-200/70 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">취소</button>
          <button onClick={onConfirm} disabled={busy || left === 0}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-40 flex items-center gap-1.5 max-w-[70%]">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span className="truncate">{single ? `${single.to}로 보내기` : `${items.length}건 보내기`}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
