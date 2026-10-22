/**
 * LineCompositionBoard.tsx — 한줄 CT 재료 판의 미리보기 · 구성 고르기 (★ 2026-10-22 · 설계서 docs/2026-10-22-oneline-ct-design.md §11-5)
 *
 *   - 미리보기 = 서버가 결과물과 같은 조립 함수 · 같은 렌더러로 지금 재료를 그린 것(빈 칸 = 점선 자리 · AI 0 · 0원).
 *     칸을 고치는 동안(paused)은 다시 그리지 않고, 재료 판으로 돌아올 때 한 번 그린다(요청은 하나씩 · 늦게 온 응답은 버린다).
 *   - 구성 고르기 = 5종 카드 · AI 가 고른 구성에 이유 한 줄 · 바꾸기는 0원(진단만 다시).
 * ⛔ 모델명 0 · native dialog 0 · 줄표 0.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Sparkles, Layers, Rows3 } from 'lucide-react';
import PreviewFrame from '../make/PreviewFrame';
import { InAppMessagePreview } from '../InAppMessagePreview';
import ZoneSegmented from './ZoneSegmented';
import {
  fetchCompositionPreview, lineManualPrice, lineProofRows, lineRichRows, lineStoreOf,
  type LineCompositionId, type LineCompositionInfo, type LineStepsAnswers, type LineStepsChannel, type LineLayout,
} from '../../utils/one-line';

const PHONE_W = 390;
const PHONE_H = 760;

/** (순수) 지금 답 → 미리보기 재료(서버 미리보기 칸 이름) */
export function previewMaterialsOf(a: LineStepsAnswers): Record<string, unknown> {
  const products = [
    ...(a.picks || []).filter((c) => c.imageUrl).map((c) => ({ name: c.name, price: c.price || c.salePrice, ...(c.salePrice && c.price && c.salePrice < c.price ? { discount_price: c.salePrice } : {}), image_url: c.imageUrl })),
    ...(a.manualList || []).filter((m) => m.name.trim() && m.image).map((m) => ({ name: m.name.trim(), price: lineManualPrice(m.price) ?? 0, image_url: m.image, ...(m.category?.trim() ? { category: m.category.trim() } : {}) })),
  ];
  const poster = a.hero ? { url: a.hero, as_is: a.heroPoster === true } : a.page?.banner ? { url: a.page.banner } : null;
  return {
    products,
    ...(poster ? { poster } : {}),
    ...(typeof a.benefit === 'string' && a.benefit.trim() ? { benefit: a.benefit.trim() } : {}),
    ...(a.period ? { period_end: a.period } : {}),
    proof: lineProofRows(a),
    rich: {
      points: lineRichRows(a.points),
      usage: lineRichRows(a.usage),
      mood: (a.mood || []).filter(Boolean).slice(0, 3),
      ...(a.couponCode ? { coupon_code: a.couponCode } : {}),
      ...(lineStoreOf(a) ? { store: lineStoreOf(a) } : {}),
      ...(a.benefitNote?.trim() ? { benefit_note: a.benefitNote.trim().slice(0, 120) } : {}),
    },
  };
}

/** 미리보기 휴대폰 한 장 */
export default function LineCompositionPreview({ composition, channel, answers, paused, width }: {
  composition: LineCompositionId | null;
  channel: LineStepsChannel;
  answers: LineStepsAnswers;
  /** 칸을 고치는 중 = 다시 그리지 않는다(판으로 돌아오면 그린다) */
  paused: boolean;
  width: number;
}) {
  const [view, setView] = useState<{ html?: string; message?: Record<string, any>; missing: number } | null | 'loading'>('loading');
  const ticket = useRef(0);
  const key = composition ? JSON.stringify([composition, channel, previewMaterialsOf(answers)]) : '';
  const lastKey = useRef('');
  useEffect(() => {
    if (!composition || paused || key === lastKey.current) return;
    lastKey.current = key;
    const n = ++ticket.current;
    const ctrl = new AbortController();
    setView((v) => (v && v !== 'loading' ? v : 'loading'));
    // 너무 잦은 요청을 피한다(재료 판으로 돌아온 뒤 0.25초)
    const t = setTimeout(() => {
      void fetchCompositionPreview(composition, channel, previewMaterialsOf(answers), ctrl.signal).then((r) => { if (n === ticket.current) setView(r); });
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
    // key 가 재료 전부를 담는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition, channel, paused, key]);
  const height = Math.round((width / PHONE_W) * PHONE_H);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative shrink-0 rounded-[28px] bg-slate-900 p-2 shadow-xl" style={{ width: width + 16 }}>
        <div className="relative overflow-hidden rounded-[22px] bg-white" style={{ width, height }}>
          {view === 'loading' ? (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : !view ? (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-slate-500">미리보기를 그리지 못했어요. 만들기는 그대로 할 수 있어요</div>
          ) : view.html ? (
            <PreviewFrame html={view.html} viewport={PHONE_W} displayWidth={width} displayHeight={height} title="우리 재료 미리보기" />
          ) : view.message ? (
            <div className="absolute inset-0 bg-slate-100">
              <div style={{ position: 'absolute', left: '50%', top: 12, width: 440, transform: `translateX(-50%) scale(${width / 440})`, transformOrigin: 'top center' }}>
                <InAppMessagePreview
                  template={String(view.message.template || 'center_modal')} title={String(view.message.title || '')} body={String(view.message.body || '')}
                  imageUrl={view.message.image_url ?? null} badge={view.message.badge_text ?? null}
                  buttons={Array.isArray(view.message.buttons) ? view.message.buttons : []}
                  backgroundColor="#ffffff" textColor="#111827"
                  blocks={view.message.content_blocks} theme={view.message.theme} accentColor={view.message.accent_color} cardStyle={view.message.card_style}
                  isAd captureMode
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {view && view !== 'loading' && view.missing > 0 && <p className="text-[12px] font-semibold text-violet-700">빈 칸 {view.missing}개 · 채우면 구역이 생겨요</p>}
    </div>
  );
}

/** 구성 고르기 — 5종 카드 · AI 가 고른 구성 = 이유 한 줄 · DM = 세로 스크롤 / 넘기는 슬라이드 */
export function LineCompositionPick({ infos, chosen, recommended, reason, layout, channel, onChoose, onLayout }: {
  infos: LineCompositionInfo[];
  chosen: LineCompositionId | null;
  recommended: LineCompositionId | null;
  reason: string | null;
  layout: LineLayout;
  channel: LineStepsChannel;
  onChoose: (id: LineCompositionId) => void;
  onLayout: (l: LineLayout) => void;
}) {
  return (
    <div className="space-y-4">
      {channel === 'dm' && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[12.5px] font-semibold text-slate-600">형태</span>
          <ZoneSegmented<LineLayout> ariaLabel="형태" value={layout} onChange={onLayout}
            items={[{ id: 'page', label: '세로 스크롤', icon: Rows3 }, { id: 'slides', label: '넘기는 슬라이드', icon: Layers }]} />
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {infos.map((c) => {
          const on = c.id === chosen;
          const rec = c.id === recommended;
          return (
            <button key={c.id} type="button" aria-pressed={on} onClick={() => onChoose(c.id)}
              className={`text-left rounded-2xl border-2 p-4 transition-colors ${on ? 'border-violet-500 bg-violet-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
              <span className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg shrink-0" style={{ background: c.primary }} aria-hidden />
                <span className="flex-1 min-w-0 text-[15px] font-bold text-slate-900">{c.label}</span>
                {on && <span className="w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center shrink-0"><Check className="w-3.5 h-3.5" /></span>}
              </span>
              <span className="block mt-2 text-[12.5px] text-slate-600 leading-relaxed">{c.desc}</span>
              {rec && (
                <span className="mt-2.5 inline-flex items-start gap-1.5 rounded-lg bg-violet-100/70 px-2.5 py-1.5 text-[12px] font-semibold text-violet-800">
                  <Sparkles className="w-3.5 h-3.5 mt-px shrink-0" />{reason || '이 한 줄에 맞는 구성이에요'}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[12px] text-slate-500">구성을 바꿔도 넣은 재료는 그대로예요. 바꾸는 데 크레딧은 들지 않아요</p>
    </div>
  );
}
