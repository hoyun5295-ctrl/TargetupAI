/**
 * LayoutThumb — ★ 2026-11-08 C118 B4 모양 예시 그림 한 곳(입구 갤러리 · 모양 메뉴가 함께 쓴다 · 두 벌 0).
 *   실제 그리는 부품으로 그린 작은 미리보기 · 표본 사진 = 화면 안 그림(저장되지 않는다) · 옛 위치 = InAppEntryGallery Thumb.
 */
import type { CSSProperties } from 'react';
import { InAppMessagePreview, AppInAppPreview } from '../InAppMessagePreview';
import { PosterSheetPreview, type PosterLayout } from './PosterSheetPreview';
import { layoutStyle, designForKey, type LayoutKey } from './inappSlides';
import { PosterFramePreview } from './PosterFramePreview';

const svg = (s: string) => `data:image/svg+xml;utf8,${encodeURIComponent(s)}`;
const SAMPLE_IMG = {
  coffee: svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#efe6d6'/><stop offset='1' stop-color='#d9ccb6'/></linearGradient></defs><rect width='400' height='300' fill='url(#g)'/><ellipse cx='150' cy='250' rx='120' ry='18' fill='#c9b99c'/><path d='M60 150 Q150 110 240 150 L230 185 Q150 210 70 185Z' fill='#c98d44'/><rect x='70' y='176' width='160' height='20' rx='10' fill='#e9d3a8'/><path d='M60 196 Q150 170 240 196 L232 226 Q150 246 68 226Z' fill='#d59a4f'/><rect x='262' y='70' width='92' height='180' rx='10' fill='#4a2614'/></svg>`),
  cake: svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 500'><rect width='400' height='500' fill='#f3e8ff'/><circle cx='330' cy='90' r='60' fill='#ddd6fe'/><rect x='90' y='250' width='220' height='130' rx='14' fill='#fbcfe8'/><rect x='90' y='250' width='220' height='34' rx='14' fill='#fff'/><rect x='118' y='190' width='164' height='70' rx='12' fill='#f9a8d4'/><circle cx='200' cy='170' r='18' fill='#e11d48'/></svg>`),
  bundle: svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 300'><rect x='40' y='60' width='70' height='210' rx='26' fill='#b91c1c'/><rect x='52' y='40' width='46' height='30' rx='8' fill='#7f1d1d'/><rect x='120' y='110' width='90' height='160' rx='10' fill='#65a30d'/><rect x='200' y='90' width='80' height='180' rx='10' fill='#facc15'/></svg>`),
  // ★ 2026-11-05 통짜 표본 = 글이 그림 안에 든 3:4 포스터(화면 안 그림 · 저장되지 않는다)
  // ★ C118 앱 채널 표본 = 정사각(스튜디오 인앱용 · 꽉 찬 그림 · 위쪽 빈 공간에 글)
  bakedSquare: svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 300'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fbe7ef'/><stop offset='1' stop-color='#e9d5ff'/></linearGradient></defs><rect width='300' height='300' fill='url(#g)'/><text x='150' y='70' font-family='sans-serif' font-size='13' font-weight='700' fill='#9d174d' text-anchor='middle'>NEW</text><text x='150' y='102' font-family='sans-serif' font-size='26' font-weight='800' fill='#4c1d95' text-anchor='middle'>새로 나온 케이크</text><text x='150' y='126' font-family='sans-serif' font-size='13' fill='#6b21a8' text-anchor='middle'>부드러운 크림과 제철 과일</text><rect x='96' y='176' width='108' height='70' rx='14' fill='#f9a8d4'/><rect x='96' y='164' width='108' height='22' rx='11' fill='#fdf2f8'/><circle cx='150' cy='158' r='10' fill='#be123c'/></svg>`),
  cakeSquare: svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 300'><rect width='300' height='300' fill='#f3e8ff'/><circle cx='250' cy='60' r='44' fill='#ddd6fe'/><rect x='88' y='150' width='124' height='84' rx='16' fill='#f9a8d4'/><rect x='88' y='136' width='124' height='26' rx='13' fill='#fdf2f8'/><circle cx='150' cy='128' r='11' fill='#be123c'/></svg>`),
  baked: svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 400'><rect width='300' height='400' fill='#f3e8ff'/><circle cx='240' cy='80' r='54' fill='#ddd6fe'/><rect x='70' y='220' width='160' height='96' rx='12' fill='#fbcfe8'/><rect x='70' y='220' width='160' height='26' rx='12' fill='#fff'/><rect x='92' y='176' width='116' height='54' rx='10' fill='#f9a8d4'/><circle cx='150' cy='160' r='14' fill='#e11d48'/><text x='150' y='58' font-size='14' font-weight='700' text-anchor='middle' fill='#6d28d9' font-family='sans-serif' letter-spacing='3'>NEW</text><text x='150' y='96' font-size='28' font-weight='900' text-anchor='middle' fill='#3b0764' font-family='sans-serif'>새로 나온 케이크</text><text x='150' y='356' font-size='15' text-anchor='middle' fill='#6b21a8' font-family='sans-serif'>매일 아침 구워요</text></svg>`),
};

/** 썸네일 표본(가상 브랜드 문안 · 화면 안 그림 사진) */
function sampleFor(k: PosterLayout) {
  if (k === 'event_card') return [{ ...layoutStyle('event_card'), eyebrow: 'EVENT', title: '이달의 샌드위치', body: '오전 11시 이후 음료와 함께\n시즌 샌드위치를 만나 보세요', image_url: SAMPLE_IMG.coffee }, {}, {}];
  if (k === 'banner_sheet') return [{ ...layoutStyle('banner_sheet'), eyebrow: '장보기·쇼핑', subtitle: '이제 1만원부터 배달 가능!', title: '편의점 특가대전', body: '1+1 모아 담기', image_url: SAMPLE_IMG.bundle, cta: { label: '보러 가기' } }];
  return [{ ...layoutStyle('overlay'), eyebrow: 'NEW', title: '가을 한정 케이크', body: '부드러운 크림과 제철 과일', image_url: SAMPLE_IMG.cake, cta: { label: '케이크 보러 가기' } }, {}];
}

/** 270px 기준 표본(작게 = LayoutThumb scale) */
function ThumbBody({ k, channel }: { k: LayoutKey; channel: 'web' | 'app' }) {
  const box: CSSProperties = { position: 'relative', height: 270, borderRadius: 14, overflow: 'hidden', background: '#e2e8f0' };
  // ★ 2026-11-05 새 틀(통짜 · 떠 있는 카드) = 실제 그리는 부품으로 그린다(2배 크기로 그려 반으로 줄인다)
  // ★ C114 I-3 사진 위 글(overlay)도 실제 그리는 부품(새 틀)으로 그린다
  if (k === 'baked_sheet' || k === 'baked_card' || k === 'live_card' || k === 'overlay') {
    const baked = k === 'baked_sheet' || k === 'baked_card';
    const sq = channel === 'app';   // ★ C118 앱 채널 = 스튜디오 인앱용과 같은 정사각 표본
    const slides = baked
      ? [{ image_url: sq ? SAMPLE_IMG.bakedSquare : SAMPLE_IMG.baked, title: '새로 나온 케이크', cta: { label: '케이크 보러 가기' } }]
      : [{ ...layoutStyle('overlay'), eyebrow: 'NEW', title: '새로 나온 케이크', body: '부드러운 크림과 제철 과일', image_url: sq ? SAMPLE_IMG.cakeSquare : SAMPLE_IMG.cake, cta: { label: '케이크 보러 가기' } }];
    return (
      <div style={box} aria-hidden>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,#f1f5f9,#e2e8f0)' }} />
        <div style={{ position: 'absolute', left: 0, top: 0, width: '200%', height: 540, transform: 'scale(.5)', transformOrigin: 'top left' }}>
          <PosterFramePreview slides={slides as any} design={designForKey(k, { dismiss_mode: 'snooze_day' })} accentColor="#6d28d9" height={540} />
        </div>
      </div>
    );
  }
  if (k === 'event_card' || k === 'banner_sheet') {
    return (
      <div style={box} aria-hidden>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,#f1f5f9,#e2e8f0)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,.42)' }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', maxHeight: '100%' }}>
          <PosterSheetPreview layout={k} slides={sampleFor(k) as any} design={{ dismiss_mode: 'snooze_day', poster_layout: k }} scale={0.5} radius="12px 12px 0 0" shadow="none" />
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

/** 예시 그림 · scale = 270px 표본을 줄여 그린다(모양 메뉴 = 작게) */
export function LayoutThumb({ k, channel, scale = 1 }: { k: LayoutKey; channel: 'web' | 'app'; scale?: number }) {
  if (scale === 1) return <ThumbBody k={k} channel={channel} />;
  return (
    <div style={{ position: 'relative', height: Math.round(270 * scale), overflow: 'hidden', borderRadius: 12 }} aria-hidden>
      <div style={{ position: 'absolute', left: 0, top: 0, width: `${100 / scale}%`, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <ThumbBody k={k} channel={channel} />
      </div>
    </div>
  );
}
