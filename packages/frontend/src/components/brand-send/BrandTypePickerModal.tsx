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
import { X, Info, LayoutTemplate } from 'lucide-react';
import BrandMessagePreview from '../BrandMessagePreview';
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

/**
 * ★2026-09-25 유형마다 보여 줄 예시 화면(받는 사람 화면 그대로 · Harold 목업 v2 승인).
 *   규격 숫자는 여기 적지 않는다 — 칩은 여전히 brandTypeChips(규격 사본)가 만든다. 여기는 그림용 예시 글뿐이다.
 */
const TYPE_EXAMPLE: Record<string, Record<string, any>> = {
  TEXT: { message: '새로 나온 소식을 전해 드려요.\n자세한 내용은 아래 버튼에서 확인해 주세요.', buttons: [{ name: '자세히 보기', type: 'WL' }] },
  IMAGE: { message: '이번 주 새로 나온 소식이에요.', buttons: [{ name: '자세히 보기', type: 'WL' }] },
  WIDE: { message: '지금 확인해 보세요', buttons: [{ name: '보러 가기', type: 'WL' }] },
  WIDE_ITEM_LIST: {
    header: '이번 주 추천',
    rich: { items: [{ title: '첫 번째 소식' }, { title: '두 번째 소식' }, { title: '세 번째 소식' }] },
    buttons: [{ name: '더 보기', type: 'WL' }],
  },
  CAROUSEL_FEED: {
    rich: { carousel: { cards: [
      { header: '첫 번째 카드', message: '카드마다 이미지와 글', additional: '', buttons: ['자세히 보기'] },
      { header: '두 번째 카드', message: '옆으로 넘겨 봐요', additional: '', buttons: ['자세히 보기'] },
    ], tail: false } },
  },
  PREMIUM_VIDEO: { header: '새 영상', message: '짧은 영상으로 소개해요', rich: { video: {} }, buttons: [{ name: '보러 가기', type: 'WL' }] },
  COMMERCE: {
    rich: { additional: '상품 설명 한 줄', commerce: { title: '상품 이름', regular: '20000', discount: '16000', rate: '20' } },
    buttons: [{ name: '구매하기', type: 'WL' }],
  },
  CAROUSEL_COMMERCE: {
    rich: { carousel: { cards: [
      { header: '', message: '', additional: '', commerce: { title: '상품 A', regular: '20000', discount: '16000', rate: '20' }, buttons: ['구매하기'] },
      { header: '', message: '', additional: '', commerce: { title: '상품 B', regular: '30000', discount: '24000', rate: '20' }, buttons: ['구매하기'] },
    ], tail: false } },
  },
};

const ACCENT_HEX: Record<BrandTypeAccent, string> = { violet: '#7C3AED', indigo: '#4F46E5' };

export default function BrandTypePickerModal({ show, codes, trialCodes, value, onPick, onClose, accent = 'violet' }: BrandTypePickerModalProps) {
  const hex = ACCENT_HEX[accent];

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
    <div className="ds-scope ks-picker-back">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="메시지 유형 선택"
        className="ks-picker"
        style={{ ['--ks-accent' as any]: hex }}
      >
        <div className="ks-picker__head">
          <span className="ks-picker__ic" style={{ background: hex }}><LayoutTemplate size={18} strokeWidth={2} /></span>
          <div className="min-w-0">
            <b>메시지 유형 고르기</b>
            <small>받는 사람에게 보이는 모습 그대로예요 · 고르면 바로 적용되고 이 창은 닫혀요</small>
          </div>
          <button type="button" className="ks-pop__x ml-auto" onClick={onClose} aria-label="닫기"><X size={18} strokeWidth={2} /></button>
        </div>

        <div className="ks-picker__grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(236px, 1fr))' }}>
          {codes.map((code) => {
            const s = BRAND_SPEC[code];
            if (!s) return null;
            const on = code === value;
            return (
              <button key={code} type="button" onClick={() => onPick(code)} aria-pressed={on} className={`ks-card ${on ? 'on' : ''}`}>
                <div className="ks-card__view" style={{ height: 250 }} aria-hidden>
                  <BrandMessagePreview bubbleType={code} isAd {...(TYPE_EXAMPLE[code] || {})} />
                </div>
                <div className="ks-card__meta">
                  <b>{s.label}</b>
                  <small>{brandTypeDesc(code)}</small>
                  <div className="ks-tags">
                    {brandTypeChips(s).map((c) => <span key={c}>{c}</span>)}
                    {trialCodes?.includes(code) && <span className="wait">시험 발송</span>}
                    {on && <span className="ok">지금 쓰는 중</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="ks-picker__foot">
          <Info size={14} strokeWidth={1.9} className="shrink-0 text-slate-400" />
          <p className="ks-note">유형을 바꾸면 버튼과 유형별 입력(아이템·상품·카드)이 초기화돼요. 본문·수신자·발신 프로필·080 번호는 그대로 남아요.</p>
          <button type="button" className="ks-picker__cancel" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
