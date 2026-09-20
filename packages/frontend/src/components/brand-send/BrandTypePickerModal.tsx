/**
 * BrandTypePickerModal — 브랜드메시지 유형 선택 창 (★ 2026-09-20 신설)
 *
 * 왜 만들었나:
 *   유형 카드를 작성 화면에 펼쳐 두면 8종일 때 화면의 큰 몫을 차지한다(Harold 접수).
 *   작성 화면에는 「지금 유형 + 변경」 한 줄 버튼만 두고, 고르는 일은 이 작은 창이 맡는다.
 *
 * 규격 숫자는 여기 적지 않는다 — 전부 `constants/brand-message-spec.ts`(백엔드 CT-12 사본)에서 읽는다.
 * 여기 있는 것은 **표시용 설명과 구조 그림**뿐이다.
 *
 * ⛔ 보여 주는 유형은 호출부가 정한다(`codes`). 발송이 열리지 않은 유형을 여기서 그리지 않는다 —
 *    고를 수 있는데 서버가 막는 버튼은 막다른 길이다(BrandMessageEditor 원칙 그대로).
 *
 * 겹침: SendWorkspaceShell이 `backdrop-blur`를 쓰므로 그 안의 fixed 자손은 갇힌다(LESSONS_FRONTEND 0818).
 *   그래서 body로 포털한다. z는 확인 다이얼로그와 같은 z-[2100].
 * 백드롭 클릭으로 닫히지 않는다(0704 전면 제거 룰). 닫기 = 고르기 · 닫기 버튼 · ESC.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Info } from 'lucide-react';
import { BRAND_SPEC, type BrandSpec } from '../../constants/brand-message-spec';

export type BrandTypeAccent = 'violet' | 'indigo';

const TONE = {
  violet: { cardOn: 'ring-2 ring-violet-600 bg-gradient-to-b from-white to-violet-50', label: 'text-violet-700', chipOn: 'bg-white text-violet-700 ring-1 ring-violet-200', img: 'bg-violet-200', imgOff: 'bg-slate-300' },
  indigo: { cardOn: 'ring-2 ring-indigo-600 bg-gradient-to-b from-white to-indigo-50', label: 'text-indigo-700', chipOn: 'bg-white text-indigo-700 ring-1 ring-indigo-200', img: 'bg-indigo-200', imgOff: 'bg-slate-300' },
} as const;

/** 유형별 한 줄 설명 — 숫자를 적지 않는다(숫자는 brandTypeChips가 규격에서 만든다) */
const TYPE_DESC: Record<string, string> = {
  TEXT: '텍스트 + 버튼',
  IMAGE: '이미지 + 텍스트 + 버튼',
  WIDE: '가로 배너 + 짧은 텍스트',
  WIDE_ITEM_LIST: '헤더 + 아이템 목록',
  CAROUSEL_FEED: '옆으로 넘기는 카드',
  PREMIUM_VIDEO: '동영상 + 짧은 텍스트',
  COMMERCE: '상품 이미지 + 가격',
  CAROUSEL_COMMERCE: '옆으로 넘기는 상품 카드',
};

export const brandTypeDesc = (code: string): string => TYPE_DESC[code] || '';

/** 규격 힌트 칩 — 값은 전부 BRAND_SPEC에서 온다. 앞의 두 개만 쓴다 */
export function brandTypeChips(s: BrandSpec): string[] {
  const chips: string[] = [];
  if (s.carousel) chips.push(`카드 ${s.carousel.listMin}~${s.carousel.listMax}장`);
  if (s.maxItems > 0) chips.push(`아이템 ${s.minItems}~${s.maxItems}개`);
  if (s.requireVideo) chips.push('동영상 필수');
  if (s.requireImage) chips.push('이미지 필수');
  if (s.maxCommerceTitle > 0 && !s.carousel) chips.push(`상품명 ${s.maxCommerceTitle}자`);
  if (s.maxMessage > 0) chips.push(`본문 ${s.maxMessage.toLocaleString()}자`);
  if (s.maxHeader > 0) chips.push(`헤더 ${s.maxHeader}자`);
  if (s.maxButtons > 0) chips.push(s.minButtons > 0 ? `버튼 ${s.minButtons}~${s.maxButtons}개` : `버튼 ${s.maxButtons}개`);
  return chips.slice(0, 2);
}

/** 유형 구조 그림 — 이모지 대신 실제 말풍선 배치를 보여준다 */
export function BrandTypeThumb({ code, active, accent = 'violet', compact }: {
  code: string; active: boolean; accent?: BrandTypeAccent; compact?: boolean;
}) {
  const t = TONE[accent];
  const img = active ? t.img : t.imgOff;
  const bar = active ? 'bg-slate-300' : 'bg-slate-200';
  const line = <div className={`h-1 w-full rounded-full ${bar}`} />;
  const short = <div className={`h-1 w-3/5 rounded-full ${bar}`} />;
  const box = compact
    ? 'w-[34px] h-[26px] p-1 gap-[3px] rounded-md'
    : 'w-full h-[58px] p-2 gap-1 rounded-lg';
  const s = BRAND_SPEC[code];
  return (
    <div className={`${box} shrink-0 flex flex-col justify-center overflow-hidden bg-white ring-1 ring-slate-900/5`}>
      {s?.carousel ? (
        <div className="flex gap-[3px] h-full">
          <div className={`basis-2/5 rounded ${img}`} />
          <div className={`basis-2/5 rounded ${img}`} />
          <div className={`basis-1/5 rounded ${img} opacity-50`} />
        </div>
      ) : (
        <>
          {s?.requireVideo && <div className={`${compact ? 'h-2.5' : 'h-6'} w-full rounded bg-slate-700`} />}
          {s?.requireImage && <div className={`${compact ? 'h-2.5' : code === 'WIDE' ? 'h-7' : 'h-5'} w-full rounded ${img}`} />}
          {s && s.maxItems > 0 && (
            <>
              <div className={`${compact ? 'h-2' : 'h-3.5'} w-full rounded ${img}`} />
              {!compact && <div className="flex items-center gap-1"><div className={`w-2.5 h-2.5 rounded-sm ${img}`} />{line}</div>}
            </>
          )}
          {line}
          {!(compact && (s?.requireImage || s?.requireVideo || (s && s.maxItems > 0))) && short}
        </>
      )}
    </div>
  );
}

interface BrandTypePickerModalProps {
  show: boolean;
  /** 고를 수 있는 유형 코드 — 발송이 열린 것만 호출부가 넘긴다 */
  codes: string[];
  /** 그중 시험 계정에게만 열린 유형 — 카드에 「시험 발송」 표식을 단다(실측 전이라는 사실을 고르는 사람이 알아야 한다) */
  trialCodes?: string[];
  value: string;
  onPick: (code: string) => void;
  onClose: () => void;
  accent?: BrandTypeAccent;
}

export default function BrandTypePickerModal({ show, codes, trialCodes, value, onPick, onClose, accent = 'violet' }: BrandTypePickerModalProps) {
  const t = TONE[accent];

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();   // 뒤의 발송 창까지 닫히지 않게 캡처 단계에서 먼저 잡는다
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [show, onClose]);

  if (!show) return null;

  return createPortal(
    <div className="fixed inset-0 z-[2100] bg-slate-900/40 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="메시지 유형 선택"
        className="w-full max-w-[680px] max-h-[88vh] flex flex-col bg-white rounded-2xl overflow-hidden ring-1 ring-slate-900/5 shadow-[0_40px_90px_-20px_rgba(15,23,42,0.55)]"
      >
        <div className="shrink-0 flex items-center justify-between gap-3 px-5 pt-4 pb-1">
          <h2 className="text-[15px] font-semibold text-slate-900 tracking-tight">메시지 유형 선택</h2>
          <button type="button" onClick={onClose} aria-label="닫기"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
            <X size={15} strokeWidth={1.9} />
          </button>
        </div>
        <p className="shrink-0 px-5 pb-3 text-[12px] text-slate-500">고르면 바로 적용되고 이 창은 닫힙니다.</p>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-1">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {codes.map((code) => {
              const s = BRAND_SPEC[code];
              if (!s) return null;
              const on = code === value;
              return (
                <button key={code} type="button" onClick={() => onPick(code)} aria-pressed={on}
                  className={`relative flex flex-col text-left p-2.5 rounded-xl shadow-sm transition ${
                    on ? t.cardOn : 'bg-white ring-1 ring-slate-200 hover:ring-slate-300 hover:-translate-y-0.5'
                  }`}>
                  {trialCodes?.includes(code) && (
                    <span className="absolute top-1.5 right-1.5 text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 ring-1 ring-amber-200/70">
                      시험 발송
                    </span>
                  )}
                  <BrandTypeThumb code={code} active={on} accent={accent} />
                  <span className={`text-[13px] font-semibold mt-2 ${on ? t.label : 'text-slate-800'}`}>{s.label}</span>
                  <span className="text-[11px] text-slate-500 leading-snug mt-0.5 min-h-[30px]">{brandTypeDesc(code)}</span>
                  <span className="flex gap-1 flex-wrap mt-1.5">
                    {brandTypeChips(s).map((c) => (
                      <span key={c} className={`text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap ${on ? t.chipOn : 'bg-slate-100 text-slate-600'}`}>
                        {c}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2.5 px-5 pt-3 pb-4">
          <Info size={14} strokeWidth={1.9} className="shrink-0 text-slate-400" />
          <p className="min-w-0 flex-1 text-[11.5px] text-slate-500 leading-relaxed">
            유형을 바꾸면 버튼과 유형별 입력(아이템·상품·카드)이 초기화됩니다. 본문·수신자·발신 프로필·080 번호는 그대로 남습니다.
          </p>
          <button type="button" onClick={onClose}
            className="shrink-0 px-3.5 py-2 rounded-xl text-[12.5px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 transition">
            닫기
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
