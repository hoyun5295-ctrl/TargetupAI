/**
 * InAppEntryGallery — 새 인앱 메시지 입구(★ 2026-09-29 인앱 만들기 개편 · 설계서 §2 · 목업 ① 입구)
 *
 * 채널(웹/앱) → 「용도로 바로 시작」(문안·장이 채워진 완성본) · 모양 고르기(실제 렌더 썸네일) · 기본 알림 문구 스타일(정예 템플릿 재분류 · 3차).
 * 고르면 그 상태로 편집기가 열린다(초안 = 멈춤 · 발행 전까지 과금 없음).
 * 썸네일 표본 사진은 화면 안 그림(SVG)이다 — 저장되지 않는다.
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, Globe, Smartphone, Sparkles, Layers } from 'lucide-react';
import { LAYOUT_INFO, layoutsFor, appCapsNoteForKey, type LayoutKey } from './inappSlides';
import { LayoutThumb } from './LayoutThumb';   // ★ C118 B4 예시 그림 한 곳
import InAppExampleGallery, { type InAppExampleItem } from './InAppExampleGallery';
import { INAPP_STARTERS, blankSeedFor, type InAppStarter } from './inappStarters';
import type { GoldenInAppTemplate } from './goldenTemplates';
import { MK_HEADER, MK_BACK, MK_HEAD_SEG, MK_HEAD_SEG_OFF, MK_HEAD_SEG_ON } from '../../utils/make-ui';

export default function InAppEntryGallery({ channel, onChannel, onPick, onClose, goldens, onExampleStart }: {
  channel: 'web' | 'app';
  onChannel: (c: 'web' | 'app') => void;
  /** 편집기 시작 상태 */
  onPick: (seed: Record<string, any>) => void;
  /** ★ 2026-11-05 §3-9 예시에서 시작(seed + 장마다 스튜디오 재료) */
  onExampleStart: (seed: Record<string, any>, studio: InAppExampleItem['studio']) => void;
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
    const note = channel === 'app' ? appCapsNoteForKey(k) : null;
    const lock = !!note;
    return (
      <button key={k} type="button" onClick={() => onPick(blankSeedFor(k))} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}
        className={`text-left rounded-2xl border p-3 transition-colors ${hover === k ? 'border-violet-300 bg-slate-100' : 'border-slate-200 bg-white'}`}>
        <div className="flex gap-1.5 mb-2 min-h-[22px]">
          {L.kind === 'big' && <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-900">좌우 슬라이드</span>}
          {L.isNew && <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-900">NEW</span>}
          {/* ★ C114 I-4 = 잠금이 아니라 옛 앱에서 다르게 보이는 것만 알린다(내보내지 않음 0) */}
          {lock && note && <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 break-keep">{note.text}</span>}
        </div>
        <LayoutThumb k={k} channel={channel} />
        {/* ★ C114 I-5 낱말 중간 끊김 0(「통짜 포스터 카 / 드」 Harold 1107) */}
        <b className="block text-[14px] text-slate-900 mt-2.5 break-keep">{L.name}</b>
        <span className="block text-[12px] text-slate-500 mt-0.5 leading-snug">{L.desc}</span>
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
        <InAppExampleGallery onStart={onExampleStart} />
        <section>
          <div className="flex items-baseline gap-2 mb-3 flex-wrap">
            <h2 className="text-[15px] font-bold inline-flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-fuchsia-700" />용도로 바로 시작</h2>
            <span className="text-[12px] text-slate-400">누르면 문안·장까지 채워진 완성본이 열립니다 · 사진을 넣고 혜택 칸만 직접 채우세요</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {starters.map((s) => {
              const sNote = channel === 'app' ? appCapsNoteForKey(s.layout) : null;
              return (
                <button key={s.id} type="button" onClick={() => pickStarter(s)}
                  className="text-left rounded-2xl border border-slate-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 hover:border-violet-300 p-3.5 transition-colors">
                  <b className="block text-[13.5px] text-slate-900">{s.title}</b>
                  <span className="block text-[11.5px] text-slate-500 mt-1">{s.desc}{sNote ? ` · ${sNote.text}` : ''}</span>
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
        <p className="text-[10px] text-slate-400 italic">표본 문안과 그림은 가상 브랜드</p>
      </div>
    </div>
  );
}
