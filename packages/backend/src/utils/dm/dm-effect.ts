/**
 * dm-effect.ts — 장 넘김 효과 조각 (순수 · DB 0)
 *
 * ★ 2026-09-16 (Harold 승인) 슬라이드 DM 의 장 넘김을 DM 마다 고른다. 밀어내기(기본·현행) · 책장 넘김 · 페이드.
 *   저장 = dm_pages.settings.effect (이 컬럼은 catalog 키를 이미 쓰고 있다 · DDL 0).
 *
 * ⛔ 효과를 고르지 않은 DM 은 이 파일의 모든 반환이 빈 문자열이라 **발행 HTML 이 한 글자도 바뀌지 않는다.**
 *    (브라우저 기본 가로 스크롤 + scroll-snap 경로 그대로)
 * ⚠ 아래 문자열은 dm-viewer.ts 의 template literal 안에 들어간다 : 백틱·"$"+"{"·정규식·역슬래시를 쓰지 않는다.
 * 소비처 = dm-viewer.ts renderPagesHtml 한 곳. 검증 = dm-effect.test.ts.
 */
import { catalogSettingsOf } from './dm-viewer-catalog';

export const DM_EFFECTS = ['slide', 'flip', 'fade'] as const;
export type DmEffect = (typeof DM_EFFECTS)[number];
/** 현행 경로를 벗어나는 효과만 = 자체 넘김이 필요한 것 */
export type DmActiveEffect = 'flip' | 'fade';

/** 넘길 장이 있는 슬라이드 DM 에서 고른 효과만 돌려준다. 그 밖(미지정·slide·모르는 값·세로 스크롤·1장) = null */
export function effectOf(dm: { settings?: unknown } | null | undefined, mode: string, totalPages: number): DmActiveEffect | null {
  if (mode !== 'slides' || totalPages < 2) return null;
  const raw = catalogSettingsOf(dm?.settings).effect;
  return raw === 'flip' || raw === 'fade' ? raw : null;
}

/** <body> 클래스 (앞 공백 포함 · 효과 없으면 빈 문자열) */
export function effectBodyClass(fx: DmActiveEffect | null): string {
  return fx ? ' dm-fx dm-fx-' + fx : '';
}

/** 효과 CSS — 장을 겹쳐 놓고(절대배치) 효과별 전환만 다르게 */
export function renderEffectCss(fx: DmActiveEffect | null): string {
  if (!fx) return '';
  const base = [
    '.dm-fx .dm-viewer{display:block;overflow:hidden;position:relative;perspective:1600px}',
    '.dm-fx .dm-page{position:absolute;left:0;top:0;width:100%;height:var(--dm-vh,100vh);overflow-y:auto;backface-visibility:hidden;will-change:transform,opacity;z-index:1}',
    '.dm-fx .dm-page[data-fx="hide"]{opacity:0;pointer-events:none}',
    '.dm-fx .dm-page[data-fx="cur"]{opacity:1;z-index:2}',
    '@media (prefers-reduced-motion: reduce){.dm-fx .dm-page{transition:none}}',
  ].join('\n');
  const own = fx === 'flip'
    ? [
      '.dm-fx-flip .dm-page{transition:transform .58s cubic-bezier(.42,.06,.2,1),opacity .58s ease;transform-origin:left center}',
      '.dm-fx-flip .dm-page[data-fx="flipped"]{transform:rotateY(-160deg);opacity:.25}',
    ].join('\n')
    : '.dm-fx-fade .dm-page{transition:opacity .34s ease}';
  return base + '\n' + own + '\n';
}

/**
 * 효과 스크립트 — 뷰어 스크립트 안(pageEls·currentIdx·updateCurrent 가 있는 자리)에 들어간다.
 * 도달 장·점·카운터·화살표 갱신은 기존 updateCurrent 한 곳을 그대로 부른다(추적 계약 무변경).
 */
export function renderEffectScript(fx: DmActiveEffect | null): string {
  if (!fx) return '';
  const ms = fx === 'flip' ? 620 : 360;
  return [
    '  // ★ 2026-09-16 장 넘김 효과(' + fx + ') — 기본 가로 스크롤 대신 겹친 장을 직접 넘긴다',
    '  var FX_KIND = "' + fx + '";',
    '  var FX_MS = ' + ms + ';',
    '  var fxBusy = false;',
    '  function fxApply(i) {',
    '    for (var k = 0; k < pageEls.length; k++) {',
    '      var el = pageEls[k];',
    '      el.style.transition = "none";',
    '      el.style.transform = "";',
    '      el.setAttribute("data-fx", k === i ? "cur" : "hide");',
    '      el.style.zIndex = k === i ? "2" : "1";',
    '    }',
    '    window.setTimeout(function(){ for (var j = 0; j < pageEls.length; j++) pageEls[j].style.transition = ""; }, 20);',
    '  }',
    '  function fxGo(i) {',
    '    if (fxBusy || !pageEls[i] || i === currentIdx) return;',
    '    var back = i < currentIdx;',
    '    var from = pageEls[currentIdx], to = pageEls[i];',
    '    fxBusy = true;',
    '    to.setAttribute("data-fx", "cur");',
    '    to.style.zIndex = back ? "3" : "2";',
    '    if (FX_KIND === "flip") {',
    '      if (back) {',
    '        to.setAttribute("data-fx", "flipped");',
    '        to.style.zIndex = "3";',
    '        window.setTimeout(function(){ to.setAttribute("data-fx", "cur"); }, 20);',
    '      } else {',
    '        from.style.zIndex = "3";',
    '        from.setAttribute("data-fx", "flipped");',
    '      }',
    '    } else if (!back) {',
    '      from.setAttribute("data-fx", "hide");',
    '    }',
    '    updateCurrent(i);',
    '    window.setTimeout(function(){ fxApply(i); fxBusy = false; }, FX_MS);',
    '  }',
    '  (function fxInit(){',
    '    var vw = document.querySelector(".dm-viewer");',
    '    if (!vw || pageEls.length < 2) return;',
    '    fxApply(0);',
    '    var sx = null, sy = null;',
    '    function down(x, y) { sx = x; sy = y; }',
    '    function up(x, y) {',
    '      if (sx === null) return;',
    '      var dx = x - sx, dy = y - sy;',
    '      sx = null;',
    '      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) fxGo(currentIdx + (dx < 0 ? 1 : -1));',
    '    }',
    '    vw.addEventListener("touchstart", function(e){ var t = e.touches[0]; down(t.clientX, t.clientY); }, { passive: true });',
    '    vw.addEventListener("touchend", function(e){ var t = e.changedTouches[0]; up(t.clientX, t.clientY); }, { passive: true });',
    '    vw.addEventListener("pointerdown", function(e){ if (e.pointerType !== "touch") down(e.clientX, e.clientY); });',
    '    vw.addEventListener("pointerup", function(e){ if (e.pointerType !== "touch") up(e.clientX, e.clientY); });',
    '  })();',
    '',
  ].join('\n');
}
