/**
 * PosterFramePreview — 새 틀(통짜 · 떠 있는 카드 · 기능 띠) 미리보기(★ 2026-11-05 인앱 포스터 재구성 설계서 §3-7)
 *
 * 그리는 부품(generated/poster-frame.ts = SDK poster-frame.ts 글자 그대로 사본 · CT-IA5)의 결과를 그림자 DOM 에 붙인다.
 *   → 몰 화면과 같은 DOM · 같은 규칙 상수 · 앱 전역 서체 !important 규칙이 닿지 않아 서체도 실물과 같다.
 *   mount = 'frame'(휴대폰 틀 안 · 배경 = 틀 크기 · 높이 기준 = 틀 높이).
 *   남은 시간은 고정 목업이 아니라 같은 셈으로 1초마다 다시 센다(LESSONS_FRONTEND · 미리보기도 같은 셈).
 *   편집 클릭 = data-hjl-part 위임 → onPart(그림 · 버튼 · 띠) · 장 넘김(쪽 번호 화살표 · 넘기기) = onActive.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { buildPosterFrame, countdownEndMs, formatCountdown, frameSlidesWithFlat, type PosterFrameSlide } from './generated/poster-frame';
import { safeFontFamily } from './blockTheme';
import { LEGACY_BAKE_VIEW, LEGACY_BAKE_SAFE } from './legacy-app-view';

export type PosterFramePart = 'image' | 'cta' | 'strip';

/** 넘김 레일 스크롤바 숨김(SDK inapp.ts ensureCarouselStyle 과 같은 규칙) */
export const PREVIEW_RAIL_CSS = '[data-hjl-carousel]{scrollbar-width:none;-ms-overflow-style:none}[data-hjl-carousel]::-webkit-scrollbar{display:none;width:0;height:0}';

export function PosterFramePreview({
  slides, design, accentColor, badge, endAt, height, active = 0, onActive, onPart, replaceVars, copyable = false, still = null, bakeFit = false, bakeFull = false,
}: {
  slides: PosterFrameSlide[];
  design: Record<string, any> | null | undefined;
  accentColor?: string | null;
  badge?: string | null;
  /** 남은 시간 띠의 마감(게시 끝 시각 · 예시 = 연 시각 + 2일) */
  endAt?: string | number | null;
  /** 틀 높이(px) — 높이 상한 기준 · 없으면 부모 높이를 잰다(공용 미리보기 안) */
  height?: number;
  active?: number;
  onActive?: (i: number) => void;
  onPart?: (part: PosterFramePart, slide: number) => void;
  replaceVars?: (t: string) => string;
  /** 쿠폰 [복사]가 실제로 복사한다(예시 상세 창) · 편집 무대 = 띠 칸 열기 */
  copyable?: boolean;
  /** ★ 2026-11-08 C116 D11 정지 그리기(구버전 앱 모습 = 서버가 구워 보내는 그림 그대로) · 시계 · 버튼 · 복사 · 닫기 부품 0 · 넘김 유지 */
  still?: { deadlineText?: string | null } | null;
  /** ★ C116 Codex 구현 1R ⑤ 서버 굽기와 같은 모습 — 서버 화면(390 × 844)에서 그린 틀 상자를 이 칸의 안전 칸(80% × 92%) 가운데에 맞춘다 */
  bakeFit?: boolean;
  /** ★ C118 B2 인앱용(전부 `.full.`) = 여백 0(서버 합성 = 정사각 cover) */
  bakeFull?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState(0);
  useEffect(() => {
    if (height) return;
    const el = hostRef.current;
    if (!el) return;
    const read = () => setMeasured(el.clientHeight || 0);
    read();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [height]);
  const h = height || measured;
  const cbRef = useRef({ onActive, onPart });
  cbRef.current = { onActive, onPart };
  const list = slides.filter((s) => s && String(s.image_url || '').trim());
  const count = list.length;
  const idx = Math.max(0, Math.min(count - 1, active));
  const key = JSON.stringify([list, design, accentColor, badge, endAt, h, idx, copyable, still, bakeFit, bakeFull]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || count === 0 || h <= 0) return;
    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    shadow.textContent = '';
    // ★ 2026-11-08 C116 D11 넘김 레일 스크롤바 숨김 — 그림자 DOM 이라 전역 CSS 가 닿지 않는다(SDK 는 inapp.ts ensureCarouselStyle 이 문서에 같은 규칙)
    const rail = document.createElement('style');
    rail.textContent = PREVIEW_RAIL_CSS;
    shadow.appendChild(rail);
    const built = buildPosterFrame({
      slides: list, design, accentColor, badge, endAt, now: Date.now(), active: idx, mount: 'frame', viewportHeight: bakeFit ? LEGACY_BAKE_VIEW.height : h,
      text: replaceVars, displayFont: safeFontFamily(design?.font_display, ''), still,
    });
    // 서버 굽기와 같은 모습 = 서버 화면 크기 칸에서 그리고 틀 상자를 이 칸의 안전 칸에 맞춘다(크기 · 줄바꿈 · 여백 같음)
    let stage: HTMLDivElement | null = null;
    const placeBake = () => {
      if (!stage) return;
      const host2 = hostRef.current;
      if (!host2) return;
      stage.style.transform = 'none';
      // ★ Codex 구현 2R ② = 1R ⑤ 와 같은 부류(좌표계 섞임) · 구조 처방 = 전부 변환 전 좌표 — 조상 배율(편집 무대 scale(fit))을 화면 측정값에서 나눈다
      const W = host2.clientWidth, H = host2.clientHeight;
      const k = W > 0 ? host2.getBoundingClientRect().width / W : 1;
      if (!(k > 0)) return;
      const sr = stage.getBoundingClientRect();
      const r0 = built.root.getBoundingClientRect();
      const rw = r0.width / k, rh = r0.height / k, rx = (r0.left - sr.left) / k, ry = (r0.top - sr.top) / k;
      if (!(rw > 0 && rh > 0)) return;
      // ★ C118 B2 인앱용 = 정사각 칸을 꽉(서버 composeInAppBakeSlide full = cover) · 그 밖 = 가운데 안전 칸
      const sc = bakeFull ? Math.max(W / rw, H / rh) : Math.min((W * LEGACY_BAKE_SAFE.w) / rw, (H * LEGACY_BAKE_SAFE.h) / rh);
      const tx = (W - rw * sc) / 2 - rx * sc;
      const ty = (H - rh * sc) / 2 - ry * sc;
      stage.style.transform = `translate(${tx}px, ${ty}px) scale(${sc})`;
    };
    if (bakeFit) {
      stage = document.createElement('div');
      Object.assign(stage.style, { position: 'absolute', left: '0', top: '0', width: `${LEGACY_BAKE_VIEW.width}px`, height: `${LEGACY_BAKE_VIEW.height}px`, transformOrigin: '0 0' });
      stage.appendChild(built.backdrop);
      shadow.appendChild(stage);
    } else {
      shadow.appendChild(built.backdrop);
    }
    const { parts } = built;
    const imgLoads: Array<() => void> = [];
    if (bakeFit) {
      requestAnimationFrame(placeBake);
      for (const im of parts.images) { const f = () => placeBake(); im.addEventListener('load', f); imgLoads.push(() => im.removeEventListener('load', f)); }
    }
    // 지금 장으로 바로(애니메이션 없이)
    requestAnimationFrame(() => { parts.rail.scrollLeft = idx * (parts.rail.clientWidth || 0); });
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const w = parts.rail.clientWidth || 1;
        const n = Math.max(0, Math.min(count - 1, Math.round(parts.rail.scrollLeft / w)));
        if (n !== idx) cbRef.current.onActive?.(n);
      });
    };
    if (count > 1) parts.rail.addEventListener('scroll', onScroll);
    const onClick = (e: Event) => {
      const t = (e.target as HTMLElement | null)?.closest?.('[data-hjl-part]') as HTMLElement | null;
      if (!t) return;
      const part = t.getAttribute('data-hjl-part') || '';
      e.stopPropagation();
      if (part === 'prev' || part === 'next') {
        cbRef.current.onActive?.(((idx + (part === 'next' ? 1 : -1)) % count + count) % count);
        return;
      }
      if (part === 'strip-copy' && copyable) {
        const code = String(parts.stripCode?.textContent || '');
        const done = () => { t.textContent = '복사했어요'; window.setTimeout(() => { t.textContent = '복사'; }, 2000); };
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(done, () => undefined);
        return;
      }
      if (part === 'image') cbRef.current.onPart?.('image', idx);
      else if (part === 'cta') cbRef.current.onPart?.('cta', idx);
      else if (part.startsWith('strip')) cbRef.current.onPart?.('strip', idx);
    };
    built.backdrop.addEventListener('click', onClick);
    // 남은 시간 = 같은 셈으로 1초마다
    const endMs = countdownEndMs(endAt ?? null);
    const timer = parts.stripTimer && endMs !== null
      ? window.setInterval(() => { if (parts.stripTimer) parts.stripTimer.textContent = formatCountdown(endMs - Date.now()); }, 1000)
      : null;
    return () => {
      for (const off of imgLoads) off();
      if (timer) window.clearInterval(timer);
      built.backdrop.removeEventListener('click', onClick);
      parts.rail.removeEventListener('scroll', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => { const sh = hostRef.current?.shadowRoot; if (sh) sh.textContent = ''; }, []);

  return <div ref={hostRef} data-poster-frame-preview style={{ position: 'relative', width: '100%', height: height || '100%' }} />;
}

/** 편집 작업본 · 저장 칸 장 → 그리는 부품 장(장이 없으면 flat 에서 첫 장 · SDK 와 같은 규칙) */
export function frameSlidesOf(m: Record<string, any>): PosterFrameSlide[] {
  const raw: any[] = Array.isArray(m.poster_slides) ? m.poster_slides : [];
  const b0 = Array.isArray(m.buttons) ? m.buttons[0] : null;
  // ★ C114 Codex 구현 1R ① 장 + 바깥 칸 폴백 = SDK 와 같은 공용 함수(generated/poster-frame.ts 사본)
  return frameSlidesWithFlat(raw.filter((s) => s && typeof s === 'object').map((s) => ({ ...s, image_url: String(s.image_url || '') })), {
    image_url: m.image_url ? String(m.image_url) : null, title: m.title || '', body: m.body || '', eyebrow: m.badge_text || null,
    cta: b0 && (b0.label || b0.action_url) ? { label: b0.label, action_url: b0.action_url ?? null } : null,
    link_url: m.image_link_url || null,
  }, m.design);
}
