/**
 * InAppEntryGallery — 새 인앱 메시지 입구(★ 2026-09-29 인앱 만들기 개편 · 설계서 §2 · 목업 ① 입구)
 *
 * 채널(웹/앱) → 「용도로 바로 시작」(문안·장이 채워진 완성본) · 모양 고르기(실제 렌더 썸네일) · 기본 알림 문구 스타일(정예 템플릿 재분류 · 3차).
 * 고르면 그 상태로 편집기가 열린다(초안 = 멈춤 · 발행 전까지 과금 없음).
 * 썸네일 표본 사진은 화면 안 그림(SVG)이다 — 저장되지 않는다.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowLeft, Globe, Smartphone, Sparkles, Layers, Lock } from 'lucide-react';
import { InAppMessagePreview, AppInAppPreview } from '../InAppMessagePreview';
import { PosterSheetPreview, type PosterLayout } from './PosterSheetPreview';
import { LAYOUT_INFO, layoutsFor, layoutStyle, APP_SHEET_LAYOUTS_UNLOCKED, type LayoutKey } from './inappSlides';
import { INAPP_STARTERS, blankSeedFor, type InAppStarter } from './inappStarters';
import type { GoldenInAppTemplate } from './goldenTemplates';
import { MK_HEADER, MK_BACK, MK_HEAD_SEG, MK_HEAD_SEG_OFF, MK_HEAD_SEG_ON } from '../../utils/make-ui';

const svg = (s: string) => `data:image/svg+xml;utf8,${encodeURIComponent(s)}`;
const SAMPLE_IMG = {
  coffee: svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#efe6d6'/><stop offset='1' stop-color='#d9ccb6'/></linearGradient></defs><rect width='400' height='300' fill='url(#g)'/><ellipse cx='150' cy='250' rx='120' ry='18' fill='#c9b99c'/><path d='M60 150 Q150 110 240 150 L230 185 Q150 210 70 185Z' fill='#c98d44'/><rect x='70' y='176' width='160' height='20' rx='10' fill='#e9d3a8'/><path d='M60 196 Q150 170 240 196 L232 226 Q150 246 68 226Z' fill='#d59a4f'/><rect x='262' y='70' width='92' height='180' rx='10' fill='#4a2614'/></svg>`),
  cake: svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 500'><rect width='400' height='500' fill='#f3e8ff'/><circle cx='330' cy='90' r='60' fill='#ddd6fe'/><rect x='90' y='250' width='220' height='130' rx='14' fill='#fbcfe8'/><rect x='90' y='250' width='220' height='34' rx='14' fill='#fff'/><rect x='118' y='190' width='164' height='70' rx='12' fill='#f9a8d4'/><circle cx='200' cy='170' r='18' fill='#e11d48'/></svg>`),
  bundle: svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 300'><rect x='40' y='60' width='70' height='210' rx='26' fill='#b91c1c'/><rect x='52' y='40' width='46' height='30' rx='8' fill='#7f1d1d'/><rect x='120' y='110' width='90' height='160' rx='10' fill='#65a30d'/><rect x='200' y='90' width='80' height='180' rx='10' fill='#facc15'/></svg>`),
};

/** 썸네일 표본(가상 브랜드 문안 · 화면 안 그림 사진) */
function sampleFor(k: PosterLayout) {
  if (k === 'event_card') return [{ ...layoutStyle('event_card'), eyebrow: 'EVENT', title: '이달의 샌드위치', body: '오전 11시 이후 음료와 함께\n시즌 샌드위치를 만나 보세요', image_url: SAMPLE_IMG.coffee }, {}, {}];
  if (k === 'banner_sheet') return [{ ...layoutStyle('banner_sheet'), eyebrow: '장보기·쇼핑', subtitle: '이제 1만원부터 배달 가능!', title: '편의점 특가대전', body: '1+1 모아 담기', image_url: SAMPLE_IMG.bundle, cta: { label: '보러 가기' } }];
  return [{ ...layoutStyle('overlay'), eyebrow: 'NEW', title: '가을 한정 케이크', body: '부드러운 크림과 제철 과일', image_url: SAMPLE_IMG.cake, cta: { label: '케이크 보러 가기' } }, {}];
}

function Thumb({ k, channel }: { k: LayoutKey; channel: 'web' | 'app' }) {
  const box: CSSProperties = { position: 'relative', height: 270, borderRadius: 14, overflow: 'hidden', background: '#e2e8f0' };
  if (k === 'event_card' || k === 'banner_sheet' || k === 'overlay') {
    return (
      <div style={box} aria-hidden>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,#f1f5f9,#e2e8f0)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,.42)' }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', maxHeight: '100%' }}>
          <PosterSheetPreview layout={k} slides={sampleFor(k) as any} design={{ dismiss_mode: 'snooze_day', ...(k === 'overlay' ? {} : { poster_layout: k }) }} scale={0.5} radius="12px 12px 0 0" shadow="none" />
        </div>
      </div>
    );
  }
  const common = {
    title: k === 'toast' ? '주문하신 상품이 출발했어요' : k === 'floating_button' ? '쿠폰 받기' : '다시 오신 것을 환영해요',
    body: '오늘 들러 주셔서 고마워요. 새로 들어온 상품을 먼저 보여 드릴게요.',
    imageUrl: k === 'toast' || k === 'floating_button' ? null : SAMPLE_IMG.coffee,
    buttons: [{ label: k === 'floating_button' ? '쿠폰 받기' : '둘러보기', style: 'primary' as const, background_color: '#6d28d9', text_color: '#ffffff' }],
    backgroundColor: '#ffffff',
    textColor: '#0f172a',
  };
  return (
    <div style={box} aria-hidden>
      <div style={{ position: 'absolute', left: '50%', top: 0, width: channel === 'app' ? 300 : 440, transform: `translateX(-50%) scale(${channel === 'app' ? 0.44 : 0.47})`, transformOrigin: 'top center' }}>
        {channel === 'app'
          ? <AppInAppPreview template={k} {...common} captureMode />
          : <InAppMessagePreview template={k} {...common} captureMode />}
      </div>
    </div>
  );
}

export default function InAppEntryGallery({ channel, onChannel, onPick, onClose, goldens }: {
  channel: 'web' | 'app';
  onChannel: (c: 'web' | 'app') => void;
  /** 편집기 시작 상태 */
  onPick: (seed: Record<string, any>) => void;
  onClose: () => void;
  /** 정예 템플릿(서버 컴파일 · 웹 블록 전용) — 기본 알림의 문구 스타일로 보인다 */
  goldens: Array<GoldenInAppTemplate & { difference?: string }>;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const keys = layoutsFor(channel);
  const starters = INAPP_STARTERS.filter((s) => channel === 'web' || !s.webOnly);
  const [hover, setHover] = useState<string | null>(null);
  const pickStarter = (s: InAppStarter) => onPick({ ...s.seed() });
  const card = (k: LayoutKey) => {
    const L = LAYOUT_INFO[k];
    const lock = channel === 'app' && !!L.isNew && !APP_SHEET_LAYOUTS_UNLOCKED;
    return (
      <button key={k} type="button" onClick={() => onPick(blankSeedFor(k))} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}
        className={`text-left rounded-2xl border p-3 transition-colors ${hover === k ? 'border-violet-300 bg-slate-100' : 'border-slate-200 bg-white'}`}>
        <div className="flex gap-1.5 mb-2 min-h-[22px]">
          {L.kind === 'big' && <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-900">좌우 슬라이드</span>}
          {L.isNew && <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-900">NEW</span>}
          {lock && <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 inline-flex items-center gap-1"><Lock className="w-2.5 h-2.5" />앱 업데이트 필요</span>}
        </div>
        <Thumb k={k} channel={channel} />
        <b className="block text-[14px] text-slate-900 mt-2.5">{L.name}</b>
        <span className="block text-[12px] text-slate-500 mt-0.5 leading-snug">{L.desc}{lock ? ' · 앱 업데이트 전에는 포스터 모양으로 보입니다' : ''}</span>
      </button>
    );
  };
  const big = keys.filter((k) => LAYOUT_INFO[k].kind === 'big');
  const basic = keys.filter((k) => LAYOUT_INFO[k].kind === 'basic');
  const small = keys.filter((k) => LAYOUT_INFO[k].kind === 'small');

  return (
    <div className="fixed inset-0 z-50 bg-slate-100 text-slate-900 overflow-y-auto">
      <header className={MK_HEADER}>
        <div className="h-[64px] md:h-[68px] flex items-center gap-3 px-3 md:px-6 max-w-6xl mx-auto">
          <button type="button" onClick={onClose} className={MK_BACK} aria-label="뒤로"><ArrowLeft className="w-5 h-5" /></button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center shrink-0"><Layers className="w-5 h-5 text-white" /></div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] md:text-[19px] font-bold truncate">새 인앱 메시지</h1>
            <p className="text-[12px] text-slate-400 hidden md:block truncate">모양을 고르면 바로 편집 화면이 열립니다 · 사진만 넣고 글자를 눌러 고치면 끝</p>
          </div>
          <div className={MK_HEAD_SEG} role="tablist" aria-label="채널">
            {(['web', 'app'] as const).map((c) => (
              <button key={c} type="button" role="tab" aria-selected={channel === c} onClick={() => onChannel(c)}
                className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-semibold ${channel === c ? MK_HEAD_SEG_ON : MK_HEAD_SEG_OFF}`}>
                {c === 'web' ? <Globe className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}{c === 'web' ? '웹(쇼핑몰)' : '앱'}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-8">
        <section>
          <div className="flex items-baseline gap-2 mb-3 flex-wrap">
            <h2 className="text-[15px] font-bold inline-flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-fuchsia-700" />용도로 바로 시작</h2>
            <span className="text-[12px] text-slate-400">누르면 문안·장까지 채워진 완성본이 열립니다 · 사진을 넣고 혜택 칸만 직접 채우세요</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {starters.map((s) => {
              const lock = channel === 'app' && !!LAYOUT_INFO[s.layout].isNew && !APP_SHEET_LAYOUTS_UNLOCKED;
              return (
                <button key={s.id} type="button" onClick={() => pickStarter(s)}
                  className="text-left rounded-2xl border border-slate-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 hover:border-violet-300 p-3.5 transition-colors">
                  <b className="block text-[13.5px] text-slate-900">{s.title}</b>
                  <span className="block text-[11.5px] text-slate-500 mt-1">{s.desc}{lock ? ' · 앱 업데이트 필요' : ''}</span>
                  <i className="not-italic block text-[11.5px] text-violet-800 mt-2.5">누르면 완성본 →</i>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <div className="flex items-baseline gap-2 mb-3 flex-wrap">
            <h2 className="text-[15px] font-bold">크게 보여 주기</h2>
            <span className="text-[12px] text-slate-400">사진 중심 · 최대 5장까지 좌우로 넘겨 보기</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{big.map(card)}</div>
        </section>

        <section>
          <div className="flex items-baseline gap-2 mb-3 flex-wrap">
            <h2 className="text-[15px] font-bold">기본 알림</h2>
            <span className="text-[12px] text-slate-400">글과 버튼 중심 · 한 장</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{basic.map(card)}</div>
          {channel === 'web' && goldens.length > 0 && (
            <div className="mt-4">
              <div className="text-[12.5px] font-bold text-slate-700 mb-2">문구 스타일로 시작 <span className="font-normal text-slate-400">가운데 팝업 · 목적별로 짜 둔 구성</span></div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {goldens.map((g) => (
                  <button key={g.id} type="button" title={g.difference || ''}
                    onClick={() => onPick({
                      template: ['center_modal', 'slide_in', 'toast', 'floating_button'].includes(g.template) ? g.template : 'center_modal',
                      card_style: g.card_style, theme: g.theme,
                      design: Object.keys(g.design || {}).length > 0 ? { ...g.design } : null,
                      content_blocks: JSON.parse(JSON.stringify(g.content_blocks || [])),
                      ...(g.badge_text ? { badge_text: g.badge_text } : {}),
                    })}
                    className="rounded-xl border border-amber-200 bg-white hover:bg-white hover:border-amber-300 p-2 text-left transition-colors">
                    <span className="flex h-7 rounded-lg overflow-hidden border border-slate-200">{g.swatches.map((c, i) => <span key={i} className="flex-1" style={{ background: c }} />)}</span>
                    <span className="block text-[11.5px] font-bold mt-1.5 text-slate-700">{g.label}</span>
                    <span className="block text-[10px] text-slate-400 mt-0.5 leading-snug">{g.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {small.length > 0 && (
          <section>
            <div className="flex items-baseline gap-2 mb-3 flex-wrap">
              <h2 className="text-[15px] font-bold">작게 알리기 <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 ml-1">웹 전용</span></h2>
              <span className="text-[12px] text-slate-400">쇼핑을 가리지 않는 작은 알림</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{small.map(card)}</div>
          </section>
        )}
        <p className="text-[10px] text-slate-400 italic">Data source: 썸네일은 편집기 · 쇼핑몰과 같은 렌더 규칙으로 그린 실제 모양 · 표본 문안과 그림은 가상 브랜드</p>
      </div>
    </div>
  );
}
