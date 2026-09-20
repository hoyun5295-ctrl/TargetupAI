/**
 * BrandRichSections — 브랜드메시지 자유형 5종의 입력부 (★ 2026-09-20 신설)
 *
 * 헤더 · 와이드 리스트 아이템 · 프리미엄 동영상 · 커머스 · 캐러셀(인트로·카드·더보기).
 * 어떤 구획이 보이는지는 **규격(`BRAND_SPEC`)이 정한다** — 유형 이름으로 가르지 않는다.
 * 상태·검사·payload는 `brandRich.ts`가 소유하고, 여기는 그리기만 한다.
 *
 * 톤 = 발송 창과 같은 화이트 고급형(FIELD·PANEL 클래스는 호출부가 넘긴다 — 액센트가 호출부에서 갈린다).
 */
import { useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { BRAND_SPEC } from '../../constants/brand-message-spec';
import BrandImageSlot from './BrandImageSlot';
import {
  calcRate, carouselRefRatio, cpLen, emptyCard, emptyItem, nlCount,
  type CardState, type CommerceState, type RichButton, type RichState,
} from './brandRich';

export interface RichButtonTypeOption { code: string; label: string; needUrl: boolean; fixedName?: string }

interface BrandRichSectionsProps {
  code: string;
  value: RichState;
  onChange: (next: RichState) => void;
  /** 입력칸 클래스(액센트별 포커스 링 포함) */
  fieldClass: string;
  panelClass: string;
  /** 강조 글자색 클래스 (예: text-violet-600) */
  accentText: string;
  /** 카드 버튼에 쓸 수 있는 버튼 종류 — 편집기의 BUTTON_TYPES 중 대상 범위에 맞는 것 */
  buttonTypes: RichButtonTypeOption[];
}

const LABEL = 'text-[13px] font-semibold text-slate-700';
const SUB = 'text-slate-400 font-normal';

function Count({ value, max, maxNl }: { value: string; max: number; maxNl?: number }) {
  const len = cpLen(value.trim());
  const nl = nlCount(value.trim());
  return (
    <span className="text-[11px] tabular-nums flex items-center gap-2">
      {typeof maxNl === 'number' && maxNl > 0 && (
        <span className={nl > maxNl ? 'text-rose-500 font-bold' : 'text-slate-400'}>줄바꿈 {nl} / {maxNl}</span>
      )}
      <span className={len > max ? 'text-rose-500 font-bold' : 'text-slate-400'}>{len} / {max}</span>
    </span>
  );
}

function Row({ label, right, children }: { label: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className={LABEL}>{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/** 가격 3칸 — 할인가를 넣으면 할인율이 자동으로 계산된다(직접 고칠 수도 있다) */
function PriceFields({ value, onChange, fieldClass, titleMax }: {
  value: CommerceState; onChange: (next: CommerceState) => void; fieldClass: string; titleMax: number;
}) {
  return (
    <div className="space-y-2.5">
      <Row label={<>상품명 <span className="text-rose-500">*</span></>} right={<Count value={value.title} max={titleMax} />}>
        <input type="text" value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })}
          className={fieldClass} placeholder="상품명" />
      </Row>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(108px,1fr))] gap-2">
        <Row label={<>정상가 <span className="text-rose-500">*</span></>}>
          <input type="text" inputMode="numeric" value={value.regular}
            onChange={(e) => onChange({ ...value, regular: e.target.value, rate: calcRate(e.target.value, value.discount) })}
            className={`${fieldClass} tabular-nums`} placeholder="숫자만" />
        </Row>
        <Row label={<>할인가 <span className={SUB}>선택</span></>}>
          <input type="text" inputMode="numeric" value={value.discount}
            onChange={(e) => onChange({ ...value, discount: e.target.value, rate: calcRate(value.regular, e.target.value) })}
            className={`${fieldClass} tabular-nums`} placeholder="숫자만" />
        </Row>
        <Row label={<>할인율 % <span className={SUB}>자동 계산</span></>}>
          <input type="text" inputMode="numeric" value={value.rate} disabled={!value.discount.trim()}
            onChange={(e) => onChange({ ...value, rate: e.target.value })}
            className={`${fieldClass} tabular-nums disabled:bg-slate-50 disabled:text-slate-400`} placeholder="할인가 입력 시" />
        </Row>
      </div>
    </div>
  );
}

function ButtonRows({ buttons, onChange, max, nameMax, fieldClass, accentText, buttonTypes }: {
  buttons: RichButton[]; onChange: (next: RichButton[]) => void; max: number; nameMax: number;
  fieldClass: string; accentText: string; buttonTypes: RichButtonTypeOption[];
}) {
  const set = (i: number, patch: Partial<RichButton>) => onChange(buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className={LABEL}>버튼 <span className={SUB}>최대 {max}개 · 버튼명 {nameMax}자</span></span>
        {buttons.length < max && (
          <button type="button" onClick={() => onChange([...buttons, { name: '', type: 'WL', url_mobile: '' }])}
            className={`inline-flex items-center gap-1 text-[12px] font-medium px-2 py-1 rounded-lg hover:bg-slate-50 transition ${accentText}`}>
            <Plus size={13} strokeWidth={2.2} /> 버튼 추가
          </button>
        )}
      </div>
      <div className="space-y-2">
        {buttons.map((b, i) => {
          const spec = buttonTypes.find((t) => t.code === b.type);
          return (
            <div key={i} className="grid grid-cols-[92px_minmax(0,1fr)_minmax(0,1.3fr)_28px] gap-1.5 items-center rounded-xl bg-white ring-1 ring-slate-900/5 p-1.5">
              <select value={b.type}
                onChange={(e) => {
                  const next = buttonTypes.find((t) => t.code === e.target.value);
                  set(i, { type: e.target.value, ...(next?.fixedName ? { name: next.fixedName } : {}) });
                }}
                className={`${fieldClass} !px-2 !py-1.5 !text-xs`}>
                {buttonTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
              <input type="text" value={b.name} maxLength={nameMax} onChange={(e) => set(i, { name: e.target.value })}
                className={`${fieldClass} !px-2.5 !py-1.5 !text-xs`} placeholder="버튼명" />
              {spec?.needUrl
                ? <input type="text" value={b.url_mobile || ''} onChange={(e) => set(i, { url_mobile: e.target.value })}
                    className={`${fieldClass} !px-2.5 !py-1.5 !text-xs`} placeholder="URL" />
                : <span />}
              <button type="button" onClick={() => onChange(buttons.filter((_, j) => j !== i))} aria-label="버튼 삭제"
                className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-slate-50 transition">
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          );
        })}
        {buttons.length === 0 && <p className="text-[11px] text-slate-400 px-1">버튼 없이 보낼 수 있습니다.</p>}
      </div>
    </div>
  );
}

export default function BrandRichSections({ code, value, onChange, fieldClass, panelClass, accentText, buttonTypes }: BrandRichSectionsProps) {
  const s = BRAND_SPEC[code];
  /** 캐러셀 편집 위치 — 'intro' | 카드 index | 'tail' */
  const [tab, setTab] = useState<'intro' | 'tail' | number>(0);
  if (!s) return null;
  const cs = s.carousel;
  const set = (patch: Partial<RichState>) => onChange({ ...value, ...patch });
  const setCard = (i: number, patch: Partial<CardState>) =>
    set({ cards: value.cards.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const useIntro = !!cs?.allowIntro && value.introOn;
  const cardMax = cs ? (useIntro ? cs.listMaxWithIntro : cs.listMax) : 0;
  const cardMin = cs ? (useIntro ? cs.listMinWithIntro : cs.listMin) : 0;
  const activeCard = typeof tab === 'number' ? value.cards[Math.min(tab, value.cards.length - 1)] : undefined;
  const activeIdx = typeof tab === 'number' ? Math.min(tab, value.cards.length - 1) : -1;
  /** 카드끼리 비율이 같아야 한다 — 기준은 인트로(쓰면) 또는 첫 카드. 기준 자리 자신에게는 걸지 않는다 */
  const ratioRef = carouselRefRatio(value, useIntro);
  const cardMatchRatio = (i: number): number | null => (i === 0 && !ratioRef.isIntro ? null : ratioRef.ratio);

  const tabCls = (on: boolean) =>
    `shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap transition ${
      on ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-700'
    }`;

  return (
    <div className="space-y-5">
      {/* 헤더 — 와이드 리스트는 필수, 프리미엄 동영상은 선택 */}
      {s.maxHeader > 0 && !cs && (
        <Row label={<>헤더 {s.requireHeader ? <span className="text-rose-500">*</span> : <span className={SUB}>선택</span>}</>}
          right={<Count value={value.header} max={s.maxHeader} />}>
          <input type="text" value={value.header} onChange={(e) => set({ header: e.target.value })}
            className={fieldClass} placeholder="말풍선 맨 위에 굵게 보이는 제목" />
        </Row>
      )}

      {/* 프리미엄 동영상 */}
      {s.requireVideo && (
        <div className={panelClass}>
          <Row label={<>동영상 <span className="text-rose-500">*</span></>} right={<span className="text-[11px] text-slate-400">카카오TV 주소만 쓸 수 있습니다</span>}>
            <input type="text" value={value.video.url} onChange={(e) => set({ video: { ...value.video, url: e.target.value } })}
              className={fieldClass} placeholder="https://tv.kakao.com/v/..." />
          </Row>
          <div className="mt-2.5">
            <BrandImageSlot label="썸네일 (선택)" kind="main" note="비우면 동영상의 기본 썸네일이 보입니다" blockGenerated
              value={value.video.thumb} onChange={(img) => set({ video: { ...value.video, thumb: img } })} />
          </div>
        </div>
      )}

      {/* 와이드 리스트 아이템 */}
      {s.maxItems > 0 && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className={LABEL}>아이템 <span className="text-rose-500">*</span> <span className={SUB}>{s.minItems}~{s.maxItems}개 · 첫 아이템은 큰 이미지로 보입니다</span></span>
            {value.items.length < s.maxItems && (
              <button type="button" onClick={() => set({ items: [...value.items, emptyItem()] })}
                className={`inline-flex items-center gap-1 text-[12px] font-medium px-2 py-1 rounded-lg hover:bg-slate-50 transition ${accentText}`}>
                <Plus size={13} strokeWidth={2.2} /> 아이템 추가
              </button>
            )}
          </div>
          <div className={`${panelClass} space-y-2.5`}>
            {value.items.map((it, i) => (
              <div key={i} className="min-w-0 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11.5px] font-semibold text-slate-500">{i === 0 ? '1번 (대표)' : `${i + 1}번`}</span>
                  {value.items.length > s.minItems && (
                    <button type="button" onClick={() => set({ items: value.items.filter((_, j) => j !== i) })}
                      className="text-[11px] text-slate-400 hover:text-rose-500 transition">삭제</button>
                  )}
                </div>
                <BrandImageSlot label={`${i + 1}번 아이템 이미지`} kind={i === 0 ? 'wideItemFirst' : 'wideItem'} blockGenerated thumbWidth={i === 0 ? 96 : 48}
                  value={it.image} onChange={(img) => set({ items: value.items.map((x, j) => (j === i ? { ...x, image: img } : x)) })} />
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-1.5">
                  <input type="text" value={it.title}
                    onChange={(e) => set({ items: value.items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                    className={`${fieldClass} !py-2 !text-[13px]`} placeholder={i === 0 ? '제목 (선택)' : '제목'} />
                  <input type="text" value={it.urlMobile}
                    onChange={(e) => set({ items: value.items.map((x, j) => (j === i ? { ...x, urlMobile: e.target.value } : x)) })}
                    className={`${fieldClass} !py-2 !text-[13px]`} placeholder="누르면 이동할 주소" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 커머스(단일) */}
      {s.requireCommerce && !cs && (
        <div className={`${panelClass} space-y-2.5`}>
          <PriceFields value={value.commerce} onChange={(c) => set({ commerce: c })} fieldClass={fieldClass} titleMax={s.maxCommerceTitle} />
          <Row label={<>부가 정보 <span className={SUB}>선택</span></>} right={<Count value={value.additional} max={s.maxAdditional} maxNl={s.maxAdditionalNewline} />}>
            <input type="text" value={value.additional} onChange={(e) => set({ additional: e.target.value })}
              className={fieldClass} placeholder="예) 9월 30일까지 · 무료 배송" />
          </Row>
        </div>
      )}

      {/* 캐러셀 */}
      {cs && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className={LABEL}>카드 <span className="text-rose-500">*</span> <span className={SUB}>{cardMin}~{cardMax}장 · 옆으로 넘겨 봅니다</span></span>
          </div>
          <div className="flex gap-1 p-1 rounded-xl bg-slate-100/80 overflow-x-auto mb-2.5 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300">
            {cs.allowIntro && (
              <button type="button" onClick={() => setTab('intro')} className={tabCls(tab === 'intro')}>
                인트로{value.introOn ? '' : ' (안 씀)'}
              </button>
            )}
            {value.cards.map((_, i) => (
              <button key={i} type="button" onClick={() => setTab(i)} className={tabCls(activeIdx === i)}>카드 {i + 1}</button>
            ))}
            {value.cards.length < cardMax && (
              <button type="button"
                onClick={() => { set({ cards: [...value.cards, emptyCard()] }); setTab(value.cards.length); }}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap ${accentText}`}>
                + 카드 추가
              </button>
            )}
            <button type="button" onClick={() => setTab('tail')} className={tabCls(tab === 'tail')}>
              더보기{value.tailOn ? '' : ' (안 씀)'}
            </button>
          </div>

          {tab === 'intro' && cs.allowIntro && (
            <div className={`${panelClass} space-y-2.5`}>
              <label className="inline-flex items-center gap-2 text-[13px] text-slate-700 cursor-pointer select-none">
                <input type="checkbox" checked={value.introOn} onChange={(e) => set({ introOn: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300" />
                인트로 사용 <span className="text-[11.5px] text-slate-400">맨 앞에 소개 카드가 하나 붙습니다 (쓰면 카드는 {cs.listMinWithIntro}~{cs.listMaxWithIntro}장)</span>
              </label>
              {value.introOn && (
                <>
                  <BrandImageSlot label="인트로 이미지" kind="carousel" note="이 비율이 모든 카드의 기준이 됩니다" blockGenerated
                    value={value.intro.image} onChange={(img) => set({ intro: { ...value.intro, image: img } })} />
                  <Row label={<>인트로 제목 <span className="text-rose-500">*</span></>} right={<Count value={value.intro.header} max={cs.introHeaderMax} />}>
                    <input type="text" value={value.intro.header} onChange={(e) => set({ intro: { ...value.intro, header: e.target.value } })} className={fieldClass} />
                  </Row>
                  <Row label={<>인트로 내용 <span className="text-rose-500">*</span></>} right={<Count value={value.intro.content} max={cs.introContentMax} maxNl={cs.introContentNewline} />}>
                    <textarea rows={2} value={value.intro.content} onChange={(e) => set({ intro: { ...value.intro, content: e.target.value } })} className={`${fieldClass} resize-none`} />
                  </Row>
                  <input type="text" value={value.intro.urlMobile} onChange={(e) => set({ intro: { ...value.intro, urlMobile: e.target.value } })}
                    className={fieldClass} placeholder="인트로를 누르면 이동할 주소 (선택)" />
                </>
              )}
            </div>
          )}

          {activeCard && (
            <div className={`${panelClass} space-y-2.5`}>
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] font-semibold text-slate-500">카드 {activeIdx + 1}</span>
                {value.cards.length > cardMin && (
                  <button type="button"
                    onClick={() => { set({ cards: value.cards.filter((_, j) => j !== activeIdx) }); setTab(Math.max(0, activeIdx - 1)); }}
                    className="text-[11px] text-slate-400 hover:text-rose-500 transition">이 카드 삭제</button>
                )}
              </div>
              <BrandImageSlot key={activeIdx} label={`카드 ${activeIdx + 1} 이미지`} kind="carousel" matchRatio={cardMatchRatio(activeIdx)} blockGenerated
                note={activeIdx === 0 && !ratioRef.isIntro ? '이 비율이 나머지 카드의 기준이 됩니다' : undefined}
                value={activeCard.image} onChange={(img) => setCard(activeIdx, { image: img })} />
              <input type="text" value={activeCard.imgLink} onChange={(e) => setCard(activeIdx, { imgLink: e.target.value })}
                className={fieldClass} placeholder="이미지를 누르면 이동할 주소 (선택)" />

              {cs.itemHeader === 'required' && (
                <Row label={<>카드 제목 <span className="text-rose-500">*</span></>} right={<Count value={activeCard.header} max={cs.itemHeaderMax} />}>
                  <input type="text" value={activeCard.header} onChange={(e) => setCard(activeIdx, { header: e.target.value })} className={fieldClass} />
                </Row>
              )}
              {cs.itemMessage === 'required' && (
                <Row label={<>카드 내용 <span className="text-rose-500">*</span></>} right={<Count value={activeCard.message} max={cs.itemMessageMax} maxNl={cs.itemMessageNewline} />}>
                  <textarea rows={3} value={activeCard.message} onChange={(e) => setCard(activeIdx, { message: e.target.value })} className={`${fieldClass} resize-none leading-relaxed`} />
                </Row>
              )}
              {s.requireCommerce && (
                <PriceFields value={activeCard.commerce} onChange={(c) => setCard(activeIdx, { commerce: c })} fieldClass={fieldClass} titleMax={s.maxCommerceTitle} />
              )}
              {cs.itemAdditional === 'allowed' && (
                <Row label={<>부가 정보 <span className={SUB}>선택</span></>} right={<Count value={activeCard.additional} max={cs.itemAdditionalMax} maxNl={cs.itemAdditionalNewline} />}>
                  <input type="text" value={activeCard.additional} onChange={(e) => setCard(activeIdx, { additional: e.target.value })} className={fieldClass} placeholder="예) 무료 배송" />
                </Row>
              )}
              <ButtonRows buttons={activeCard.buttons} onChange={(b) => setCard(activeIdx, { buttons: b })}
                max={cs.itemButtonMax} nameMax={s.maxButtonName} fieldClass={fieldClass} accentText={accentText} buttonTypes={buttonTypes} />
            </div>
          )}

          {tab === 'tail' && (
            <div className={`${panelClass} space-y-2.5`}>
              <label className="inline-flex items-center gap-2 text-[13px] text-slate-700 cursor-pointer select-none">
                <input type="checkbox" checked={value.tailOn} onChange={(e) => set({ tailOn: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300" />
                더보기 사용 <span className="text-[11.5px] text-slate-400">맨 끝에 「더보기」 카드가 붙습니다</span>
              </label>
              {value.tailOn && (
                <input type="text" value={value.tailUrl} onChange={(e) => set({ tailUrl: e.target.value })}
                  className={fieldClass} placeholder="더보기를 누르면 이동할 주소" />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
