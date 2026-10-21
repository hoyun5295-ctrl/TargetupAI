/**
 * LineTemplatePick.tsx — 한 줄 → 템플릿 고르기 판 · 예시 미리보기 (★ 2026-10-17 · 설계서 docs/2026-10-17-line-template-campaign-design.md §2-7)
 *
 * "예시를 보고 고르고, 고른 템플릿이 묻는 것만 답하면 완성본이 나온다."
 *   - 예시 = 서버가 진짜 조립 함수 + 진짜 렌더러로 그린 가상 업체 결과(화면은 받은 html 을 그대로 띄운다 · 세 번째 렌더러 0).
 *   - 추천 = 서버 규칙(한 줄에 걸린 낱말을 이유로) · 안 걸리면 배지 없음.
 *   - 휴대폰을 누르면 크게 보기(같은 예시를 실제 크기로).
 * ⛔ 모델명 0 · native dialog 0 · 줄표 0.
 */
import { useEffect, useState } from 'react';
import { Check, Maximize2, Sparkles, X, Loader2, Layers, Rows3 } from 'lucide-react';
import PreviewFrame from '../make/PreviewFrame';
import { InAppMessagePreview } from '../InAppMessagePreview';
import JourneyModalShell from '../journey/JourneyModalShell';
import ZoneSegmented from './ZoneSegmented';
import {
  fetchLineTemplateExample, type LineTemplateInfo, type LineTemplateRank, type LineTemplateId, type LineLayout, type LineTemplateExample, type LineStepsChannel,
} from '../../utils/one-line';

/** 휴대폰 문서 폭(예시 html 이 스스로 아는 폭) · 세로 비율 */
const PHONE_W = 390;
const PHONE_H = 760;

/** 예시 한 장(휴대폰 크기로 줄여 그린다) — 받는 중 = 뼈대 · 실패 = 한 줄 */
export function LineTemplateExampleView({ id, channel, layout, width, onZoom }: {
  id: LineTemplateId;
  channel: LineStepsChannel;
  layout: LineLayout;
  width: number;
  onZoom?: () => void;
}) {
  const [ex, setEx] = useState<LineTemplateExample | null | 'loading'>('loading');
  useEffect(() => {
    const ctrl = new AbortController();
    setEx('loading');
    void fetchLineTemplateExample(id, channel, layout, ctrl.signal).then((r) => { if (!ctrl.signal.aborted) setEx(r); });
    return () => ctrl.abort();
  }, [id, channel, layout]);
  const height = Math.round((width / PHONE_W) * PHONE_H);
  return (
    <div className="relative shrink-0 rounded-[28px] bg-slate-900 p-2 shadow-xl" style={{ width: width + 16 }}>
      <div className="relative overflow-hidden rounded-[22px] bg-white" style={{ width, height }}>
        {ex === 'loading' ? (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : !ex ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-slate-500">예시를 불러오지 못했어요. 템플릿은 그대로 고를 수 있어요</div>
        ) : 'html' in ex ? (
          <PreviewFrame html={ex.html} viewport={PHONE_W} displayWidth={width} displayHeight={height} title="템플릿 예시" />
        ) : (
          <div className="absolute inset-0 bg-slate-100">
            <div style={{ position: 'absolute', left: '50%', top: 12, width: 440, transform: `translateX(-50%) scale(${width / 440})`, transformOrigin: 'top center' }}>
              <InAppMessagePreview
                template={String(ex.message.template || 'center_modal')} title={String(ex.message.title || '')} body={String(ex.message.body || '')}
                imageUrl={ex.message.image_url ?? null} badge={ex.message.badge_text ?? null}
                buttons={Array.isArray(ex.message.buttons) ? ex.message.buttons : []}
                backgroundColor="#ffffff" textColor="#111827"
                blocks={ex.message.content_blocks} theme={ex.message.theme} accentColor={ex.message.accent_color} cardStyle={ex.message.card_style}
                isAd captureMode
              />
            </div>
          </div>
        )}
        {onZoom && ex && ex !== 'loading' && (
          <button type="button" onClick={onZoom} aria-label="예시 크게 보기"
            className="absolute right-2.5 bottom-2.5 inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-slate-900/80 text-white text-[12px] font-semibold hover:bg-slate-900 whitespace-nowrap">
            <Maximize2 className="w-3.5 h-3.5" />크게 보기
          </button>
        )}
      </div>
    </div>
  );
}

/** 크게 보기 — 같은 예시를 화면 높이에 맞춰(휴대폰 실제 폭에 가깝게) */
export function LineTemplateZoom({ open, onClose, id, channel, layout, label }: { open: boolean; onClose: () => void; id: LineTemplateId; channel: LineStepsChannel; layout: LineLayout; label: string }) {
  const [w, setW] = useState(360);
  useEffect(() => {
    if (!open) return;
    const fit = () => setW(Math.max(260, Math.min(390, Math.floor(((window.innerHeight - 120) / PHONE_H) * PHONE_W), window.innerWidth - 48)));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open]);
  if (!open) return null;
  return (
    <JourneyModalShell open={open} onClose={onClose} labelledBy="line-tpl-zoom" zIndexClassName="z-[1600]" panelClassName="w-auto md:max-w-none !bg-transparent !border-0 !shadow-none">
      <div className="flex flex-col items-center gap-3 p-3">
        <div className="flex items-center gap-3 w-full justify-between">
          <h2 id="line-tpl-zoom" className="text-[14px] font-semibold text-white">{label} · 예시</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="w-9 h-9 rounded-lg flex items-center justify-center text-white/80 hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>
        <LineTemplateExampleView id={id} channel={channel} layout={layout} width={w} />
      </div>
    </JourneyModalShell>
  );
}

const ROLE_TONE: Record<string, string> = { 기: 'bg-indigo-50 text-indigo-700', 승: 'bg-violet-50 text-violet-700', 전: 'bg-fuchsia-50 text-fuchsia-700', 결: 'bg-amber-50 text-amber-800' };

/** 필요한 재료 한 줄(서버 원장 needs 를 그대로 읽는다) */
function needsLine(t: LineTemplateInfo, channel: LineStepsChannel): string[] {
  const out: string[] = [];
  if (t.needs.benefit === 'required') out.push('혜택(꼭)');
  else if (t.needs.benefit === 'optional') out.push('혜택(있으면)');
  if (t.needs.period === 'required' && channel !== 'inapp') out.push('마감일(꼭)');
  const max = t.needs.products.max[channel];
  if (max > 0) out.push(t.needs.products.min > 0 ? `상품 ${t.needs.products.min}개 이상(최대 ${max})` : `상품(있으면 최대 ${max})`);
  if (t.needs.hero === 'ask') out.push('대표 사진(있으면)');
  return out;
}

/** 고르기 판 — 왼쪽 예시 휴대폰 · 오른쪽 이름 · 어울리는 이유 · 배치 · 기승전결 · 필요한 재료 · 아래 템플릿 줄 */
export default function LineTemplatePick({ list, ranks, chosen, layout, channel, onChoose, onLayout, onConfirm }: {
  list: LineTemplateInfo[];
  ranks: LineTemplateRank[] | null;
  chosen: LineTemplateId;
  layout: LineLayout;
  channel: LineStepsChannel;
  onChoose: (id: LineTemplateId) => void;
  onLayout: (l: LineLayout) => void;
  onConfirm: () => void;
}) {
  const [zoom, setZoom] = useState(false);
  const [phoneW, setPhoneW] = useState(300);
  useEffect(() => {
    const fit = () => {
      const mobile = window.innerWidth < 768;
      const room = mobile ? Math.min(window.innerHeight * 0.52, 520) : Math.min(window.innerHeight - 330, 600);
      setPhoneW(Math.max(200, Math.min(mobile ? window.innerWidth - 80 : 330, Math.floor((room / PHONE_H) * PHONE_W))));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  const t = list.find((x) => x.id === chosen) ?? list[0];
  if (!t) return null;
  const rank = ranks?.find((r) => r.id === t.id) ?? null;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-center md:items-start">
        <LineTemplateExampleView id={t.id} channel={channel} layout={layout} width={phoneW} onZoom={() => setZoom(true)} />
        <div className="flex-1 min-w-0 w-full">
          {rank?.recommended && (
            <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-violet-50 text-violet-800 text-[12px] font-semibold">
              <Sparkles className="w-3.5 h-3.5" />이 한 줄에 어울려요
            </span>
          )}
          <h3 className="mt-2 text-[19px] font-bold text-slate-900">{t.label}</h3>
          <p className="mt-1 text-[13.5px] text-slate-600 leading-relaxed">{t.desc}</p>
          {rank && rank.reasons.length > 0 && (
            <p className="mt-2 text-[12.5px] text-violet-700">한 줄의 {rank.reasons.map((w) => `「${w}」`).join(' ')} 낱말을 보고 골랐어요</p>
          )}
          {channel === 'dm' ? (
            <div className="mt-4">
              <ZoneSegmented<LineLayout> ariaLabel="형태" value={layout} onChange={onLayout}
                items={[{ id: 'page', label: '세로 스크롤', icon: Rows3 }, { id: 'slides', label: '넘기는 슬라이드', icon: Layers }]} />
              <p className="mt-1.5 text-[12px] text-slate-500">{layout === 'slides' ? '옆으로 넘겨 보는 장마다 화면을 꽉 채워요' : '위에서 아래로 이어서 읽어요 · 브랜드 DM 대부분이 이 형태예요'}</p>
            </div>
          ) : (
            <p className="mt-4 text-[12.5px] text-slate-500">{channel === 'email' ? '이메일은 한 페이지로 만들어요' : '인앱은 팝업 한 장으로 만들어요'}</p>
          )}
          <ol className="mt-4 space-y-1.5">
            {t.story.map((s) => (
              <li key={s.role} className="flex items-start gap-2.5">
                <span className={`shrink-0 w-6 h-6 rounded-md text-[12px] font-bold flex items-center justify-center ${ROLE_TONE[s.role] || 'bg-slate-100 text-slate-600'}`}>{s.role}</span>
                <span className="text-[13px] text-slate-700 leading-6">{s.text}</span>
              </li>
            ))}
          </ol>
          <div className="mt-4">
            <span className="block text-[12px] font-semibold text-slate-500">필요한 재료</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {needsLine(t, channel).map((n) => <span key={n} className="h-7 px-2.5 rounded-lg bg-slate-100 text-[12.5px] text-slate-700 inline-flex items-center whitespace-nowrap">{n}</span>)}
            </div>
          </div>
          <button type="button" onClick={onConfirm} className="mt-5 w-full md:w-auto h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[14px] font-bold inline-flex items-center justify-center gap-2">
            <Check className="w-4 h-4" />이 템플릿으로
          </button>
          <p className="mt-2 text-[11.5px] text-slate-400">예시 · 가상 브랜드 「{t.example.company}」({t.example.industry}) · 실제 결과는 우리 회사 재료로 채워요</p>
        </div>
      </div>

      <div>
        <span className="block text-[12px] font-semibold text-slate-500 mb-2">다른 템플릿</span>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {list.map((x) => {
            const on = x.id === t.id;
            const r = ranks?.find((y) => y.id === x.id);
            return (
              <button key={x.id} type="button" aria-pressed={on} onClick={() => onChoose(x.id)}
                className={`text-left rounded-xl p-3 border-2 transition-colors ${on ? 'border-violet-500 bg-violet-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full shrink-0" style={{ background: `linear-gradient(135deg, ${x.design.primary}, ${x.design.accent})` }} />
                  <span className="text-[13.5px] font-bold text-slate-900 truncate">{x.label}</span>
                </span>
                <span className="block mt-1 text-[12px] text-slate-500 line-clamp-2 leading-snug">{x.desc}</span>
                {r?.recommended && <span className="mt-1.5 inline-block text-[11px] font-semibold text-violet-700">어울려요</span>}
              </button>
            );
          })}
        </div>
      </div>
      <LineTemplateZoom open={zoom} onClose={() => setZoom(false)} id={t.id} channel={channel} layout={layout} label={t.label} />
    </div>
  );
}
