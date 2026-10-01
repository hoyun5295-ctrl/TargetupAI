/**
 * PreviewPair — 휴대폰 미리보기(크게) + PC 미리보기(작게 + 크게 보기) (★ 2026-09-27 만들기 개편 · 설계서 §1 불변 2 · 목업 (라))
 *
 * 둘은 서로 다르게 보여야 한다(Harold 0927): 휴대폰 = 받는 사람 대부분의 화면 · PC = 실제 PC 모습.
 *   DM 일반 = PC 가운데 480 기둥 · 옆으로 넘기기 = 양옆 넘김 화살표 · 이메일 = 본문 600 · 카탈로그 = 휴대폰 슬라이드 + 넘김 효과 / PC 책(효과 무관 · 상품 칩 없음).
 * 두 화면 모두 같은 서버 HTML(렌더러 출력)이다 — 폭만 다르게 준다(문서가 스스로 폭을 보고 그린다).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Smartphone, Monitor, Loader2, X, Check, AlertCircle, ChevronUp, ChevronDown, Copy, Trash2 } from 'lucide-react';
import PreviewFrame from './PreviewFrame';
import { MK_BTN_OUTLINE, MK_MODAL, MK_MODAL_BACKDROP } from '../../utils/make-ui';

export type PreviewKind = 'dm' | 'dm-slides' | 'catalog' | 'email';

/** 휴대폰 위 고른 블록 도구줄(위로 · 아래로 · 복제 · 빼기) */
export interface BlockTools { onUp?: () => void; onDown?: () => void; onDuplicate?: () => void; onDelete?: () => void; canUp?: boolean; canDown?: boolean }

const PHONE_VIEWPORT = 375;
const PC_VIEWPORT = 1280;

function pcNotes(kind: PreviewKind): Array<{ text: string; warn?: boolean }> {
  switch (kind) {
    case 'email': return [{ text: 'PC 메일에서는 본문 폭(600) 그대로 보여요' }, { text: '휴대폰에서는 화면 폭에 맞춰 줄어들어요' }];
    case 'catalog': return [{ text: '책처럼 두 쪽을 펼쳐 보여요' }, { text: '넘김은 늘 책장 넘김(휴대폰 효과와 상관없음)' }, { text: '상품 칩은 PC 책에 보이지 않아요', warn: true }];
    case 'dm-slides': return [{ text: '휴대폰 화면 폭 그대로 가운데에 세워 보여요' }, { text: '양옆에 넘김 화살표가 생겨요' }];
    default: return [{ text: '휴대폰 화면 폭 그대로 가운데에 세워 보여요' }, { text: '옆으로 넘기기 DM은 양옆에 넘김 화살표가 생겨요' }];
  }
}

function modalNotes(kind: PreviewKind): Array<{ text: string; warn?: boolean }> {
  if (kind === 'catalog') return [{ text: '받는 사람이 PC로 열면 이렇게 책처럼 보여요' }, { text: '넘김은 책장 넘김 · 멀리 건너뛰면 페이드' }, { text: '상품 칩(가격·링크)은 PC 책에 보이지 않아요', warn: true }];
  if (kind === 'email') return [{ text: '받는 사람 PC 메일 화면 폭으로 그렸어요' }, { text: '광고 메일이면 맨 아래 법정 문구까지 실제와 같아요' }];
  return [{ text: '받는 사람이 PC로 열면 이렇게 보여요' }, { text: '휴대폰 모습이 가운데에 그대로 서요' }];
}

/** 부모 높이를 재서 휴대폰 화면 높이를 정한다(창 크기에 맞춰 한 화면 안에) */
function useBoxHeight(min: number, max: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(max);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setH(Math.max(min, Math.min(max, Math.floor(el.clientHeight)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min, max]);
  return { ref, h };
}

export default function PreviewPair({
  kind, html, loading, error, selectedId, onTap, phoneTop, inboxHead, compact = false, blockTools, emptyText,
}: {
  kind: PreviewKind;
  html: string;
  loading?: boolean;
  error?: string | null;
  selectedId?: string | null;
  onTap?: (id: string) => void;
  /** 휴대폰 위 한 줄(카탈로그 넘김 효과 등) */
  phoneTop?: ReactNode;
  /** 이메일 = 받은편지함 머리(보낸 사람 · 제목) */
  inboxHead?: { from: string; subject: string } | null;
  /** 좁은 화면(결과 화면 가운데 칸) — PC 카드를 휴대폰 아래로 */
  compact?: boolean;
  blockTools?: BlockTools | null;
  /** 그릴 것이 아직 없을 때(새 빈 DM 등) 휴대폰 안 안내 */
  emptyText?: string | null;
}) {
  const [bigOpen, setBigOpen] = useState(false);
  const [rect, setRect] = useState<{ id: string | null; top: number; height: number } | null>(null);
  const box = useBoxHeight(420, 700);
  const phoneW = 316;
  // 받은편지함 머리 높이 = 안의 줄 높이 합(글꼴과 무관하게 줄 높이를 px로 고정한다).
  //   ★ 2026-09-29 남지현 접수 — 옛 64px는 내용(약 76px)보다 작아 제목 줄이 아래 미리보기에 가려 잘려 보였다.
  //   위 12 + 보낸 사람 줄 30(이름 16 · 시각 14) + 간격 4 + 제목 19 + 아래 10 + 선 1 = 76.
  const headH = inboxHead ? 76 : 0;
  const screenH = Math.max(360, box.h - 40 - (phoneTop ? 44 : 0));

  return (
    <div className={`h-full min-h-0 flex ${compact ? 'flex-col items-center gap-5' : 'gap-6 xl:gap-8'} justify-center`}>
      {/* 휴대폰 */}
      <div className="flex flex-col min-h-0 shrink-0" style={{ width: phoneW + 20 }}>
        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700 mb-2.5 h-5">
          <Smartphone className="w-3.5 h-3.5 text-violet-700" />휴대폰으로 볼 때
          <span className="text-slate-400 font-normal text-[11.5px]">고치면 바로 바뀌어요</span>
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-700 ml-auto" aria-label="다시 그리는 중" />}
        </div>
        {phoneTop && <div className="mb-2.5">{phoneTop}</div>}
        <div ref={box.ref} className="flex-1 min-h-0">
          <div className="mk-phone mx-auto" style={{ width: phoneW + 20 }}>
            <div className="mk-phone-screen" style={{ width: phoneW, height: screenH }}>
              {inboxHead && (
                <div className="px-4 pt-3 pb-2.5 border-b border-slate-200 bg-white" style={{ height: headH }}>
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-[#9a4f2c] text-white text-[12px] font-bold flex items-center justify-center shrink-0">{(inboxHead.from || 'H').slice(0, 1)}</span>
                    <div className="min-w-0">
                      <div className="text-[12px] leading-[16px] font-bold text-slate-900 truncate">{inboxHead.from || '보내는 사람'}</div>
                      <div className="text-[10.5px] leading-[14px] text-slate-500">지금 · 나에게</div>
                    </div>
                  </div>
                  <div className="text-[12.5px] leading-[19px] font-bold text-slate-900 mt-1 truncate">{inboxHead.subject || '제목을 넣어 주세요'}</div>
                </div>
              )}
              {html ? (
                <PreviewFrame html={html} viewport={PHONE_VIEWPORT} displayWidth={phoneW} displayHeight={screenH - headH} tap={!!onTap} selectedId={selectedId} onTap={onTap} onRect={setRect} title="휴대폰 미리보기" />
              ) : (
                <div className="flex items-center justify-center text-slate-500 text-[12px]" style={{ height: screenH - headH }} data-empty>
                  {error ? <span className="inline-flex items-center gap-1.5 text-rose-500"><AlertCircle className="w-4 h-4" />{error}</span> : emptyText ? <span className="px-6 text-center leading-relaxed">{emptyText}</span> : <Loader2 className="w-5 h-5 animate-spin" />}
                </div>
              )}
              {blockTools && html && selectedId && rect && rect.id === selectedId && rect.top + rect.height > 0 && rect.top < screenH - headH && (
                <div
                  className="absolute right-2 z-10 flex items-center gap-0.5 rounded-xl bg-indigo-50 border border-slate-300 shadow-xl px-1 py-1"
                  style={{ top: Math.max(headH + 6, Math.min(screenH - 44, headH + rect.top + 8)) }}
                >
                  <button type="button" onClick={blockTools.onUp} disabled={!blockTools.canUp} className="w-8 h-8 rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-30 flex items-center justify-center" aria-label="위로"><ChevronUp className="w-4 h-4" /></button>
                  <button type="button" onClick={blockTools.onDown} disabled={!blockTools.canDown} className="w-8 h-8 rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-30 flex items-center justify-center" aria-label="아래로"><ChevronDown className="w-4 h-4" /></button>
                  {blockTools.onDuplicate && <button type="button" onClick={blockTools.onDuplicate} className="w-8 h-8 rounded-lg text-slate-700 hover:bg-slate-100 flex items-center justify-center" aria-label="복제"><Copy className="w-4 h-4" /></button>}
                  {blockTools.onDelete && <button type="button" onClick={blockTools.onDelete} className="w-8 h-8 rounded-lg text-rose-700 hover:bg-rose-100 flex items-center justify-center" aria-label="빼기"><Trash2 className="w-4 h-4" /></button>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* PC */}
      <div className={`${compact ? 'w-full max-w-[336px]' : 'w-[240px] xl:w-[250px]'} shrink-0`}>
        <PcPanel kind={kind} html={html} width={compact ? 336 : 240} onOpen={() => setBigOpen(true)} />
      </div>

      {bigOpen && <PcBigModal kind={kind} html={html} onClose={() => setBigOpen(false)} />}
    </div>
  );
}

/**
 * PC로 볼 때 묶음(제목 · 작은 PC 카드 · 안내 · 크게 보기 버튼) — 수정 화면 가운데와 결과 화면(카탈로그 오른쪽 칸)이 같이 쓴다.
 * ★ 2026-10-01 PreviewPair 안에 있던 것을 그대로 꺼냈다(겉모습 무변경).
 */
export function PcPanel({ kind, html, width, onOpen }: { kind: PreviewKind; html: string; width: number; onOpen: () => void }) {
  return (
    <>
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700 mb-2.5 h-5"><Monitor className="w-3.5 h-3.5 text-violet-700" />PC로 볼 때</div>
      <PcCard kind={kind} html={html} width={width} onOpen={onOpen} />
      <ul className="mt-3 space-y-1.5">
        {pcNotes(kind).map((n) => (
          <li key={n.text} className={`flex gap-1.5 text-[11.5px] leading-snug ${n.warn ? 'text-amber-700' : 'text-slate-500'}`}>
            <span className={`mt-[6px] w-1 h-1 rounded-full shrink-0 ${n.warn ? 'bg-amber-300' : 'bg-violet-400'}`} />{n.text}
          </li>
        ))}
      </ul>
      <button type="button" onClick={onOpen} disabled={!html} className={`${MK_BTN_OUTLINE} w-full mt-3 h-10`}>
        <Monitor className="w-4 h-4" />PC 화면 크게 보기
      </button>
    </>
  );
}

/** 작은 PC 카드 — 브라우저 틀(이메일은 메일 화면 틀) 안에 PC 폭 문서를 줄여 담는다 */
function PcCard({ kind, html, width, onOpen }: { kind: PreviewKind; html: string; width: number; onOpen: () => void }) {
  const chromeH = 16;
  const bodyH = Math.round(width * 0.62);
  const mail = kind === 'email';
  const sideW = mail ? Math.round(width * 0.14) : 0;
  return (
    <button type="button" onClick={onOpen} className="block rounded-xl overflow-hidden border border-slate-300 bg-slate-100 text-left hover:border-violet-300 transition-colors" style={{ width }} aria-label="PC 화면 크게 보기">
      <div className="flex items-center gap-1 px-2 bg-slate-300/80" style={{ height: chromeH }}>
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500/70" /><span className="w-1.5 h-1.5 rounded-full bg-slate-500/70" /><span className="w-1.5 h-1.5 rounded-full bg-slate-500/70" />
      </div>
      <div className="flex" style={{ height: bodyH }}>
        {mail && (
          <div className="bg-slate-200 border-r border-slate-300 py-2 px-1.5 space-y-1.5" style={{ width: sideW }}>
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-1.5 rounded bg-slate-300" />)}
          </div>
        )}
        <div className="flex-1 pointer-events-none" style={{ background: kind === 'catalog' ? '#0f172a' : '#fff' }}>
          {html ? <PreviewFrame html={html} viewport={mail ? 1100 : PC_VIEWPORT} displayWidth={width - sideW} displayHeight={bodyH} title="PC 미리보기(작게)" /> : null}
        </div>
      </div>
    </button>
  );
}

/** PC 화면 크게 보기 — 목업 (라) ⑥ */
export function PcBigModal({ kind, html, onClose }: { kind: PreviewKind; html: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const w = Math.min(1100, (typeof window !== 'undefined' ? window.innerWidth : 1280) - 96);
  const h = Math.min(Math.round(w * 0.56), (typeof window !== 'undefined' ? window.innerHeight : 800) - 230);
  return (
    <div className={MK_MODAL_BACKDROP} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${MK_MODAL} w-full max-w-[1160px] p-5 md:p-6`} role="dialog" aria-label="PC에서 볼 때">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[17px] font-bold text-slate-900 inline-flex items-center gap-2"><Monitor className="w-5 h-5 text-violet-700" />PC에서 볼 때</div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-100 p-3 flex justify-center">
          <div className="rounded-lg overflow-hidden" style={{ width: w }}>
            <PreviewFrame html={html} viewport={kind === 'email' ? 1100 : PC_VIEWPORT} displayWidth={w} displayHeight={h} title="PC 미리보기(크게)" />
          </div>
        </div>
        <div className="mt-3.5 flex flex-wrap gap-x-5 gap-y-1.5">
          {modalNotes(kind).map((n) => (
            <span key={n.text} className={`inline-flex items-center gap-1.5 text-[12px] ${n.warn ? 'text-amber-700' : 'text-slate-600'}`}>
              {n.warn ? <AlertCircle className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5 text-emerald-600" />}{n.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
