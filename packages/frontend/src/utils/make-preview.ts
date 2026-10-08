/**
 * make-preview.ts — 만들기 개편 미리보기 주입 CT (★ 2026-09-27 설계서 docs/2026-09-27-make-redesign-design.md §1 불변 1·4)
 *
 * 서버가 그린 HTML(DM 뷰어 · 이메일 렌더러 출력 그대로)을 iframe srcdoc 에 넣기 전에 딱 두 가지만 더한다.
 *   ① `<head>` 첫 자식 = CSP `connect-src 'none'` — 열람 비콘·응답 전송(sendBeacon·fetch)이 미리보기에서 나가지 않는다
 *   ② 문서 끝 다리 스크립트 1개 — 섹션 탭(data-section-id) 알림 · 스크롤 위치 보고/복원 · 선택 표시 · 링크 이동 차단
 * iframe 은 `sandbox="allow-scripts"` 만 준다(불투명 출처 · 부모 DOM 접근 0). 부모는 `event.source === iframe.contentWindow` 로 거른다.
 * ⛔ 렌더러 출력을 고치지 않는다(세 번째 렌더러 0). 더하는 것은 CSP 한 줄과 스크립트 한 개뿐이다.
 * 계약 = backend `utils/__tests__/make-preview-guard.test.ts`.
 */

export const MK_PREVIEW_CSP = "connect-src 'none'";
/** 다리 메시지 표식(부모가 다른 postMessage 와 가른다) */
export const MK_PREVIEW_SRC = 'mk-preview';

export type MkPreviewInbound =
  | { src: typeof MK_PREVIEW_SRC; type: 'ready' }
  /** 그림까지 다 받아 높이가 정해졌다(★1008 · 부모가 이때 새 문서로 바꿔 끼운다) */
  | { src: typeof MK_PREVIEW_SRC; type: 'loaded' }
  | { src: typeof MK_PREVIEW_SRC; type: 'tap'; id: string }
  | { src: typeof MK_PREVIEW_SRC; type: 'scroll'; y: number }
  /** 고른 블록이 화면 안 어디에 있는가(문서 좌표 아님 · iframe 보이는 영역 기준) — 휴대폰 위 도구줄 자리 */
  | { src: typeof MK_PREVIEW_SRC; type: 'rect'; id: string | null; top: number; height: number };

/** iframe 안에서 도는 다리(ES5 · 외부 의존 0). tap = 섹션 탭 알림을 켤지(편집 화면만). */
function bridgeSource(tap: boolean): string {
  return [
    '(function(){',
    'var P=window.parent,TAP=' + (tap ? 'true' : 'false') + ',SRC=' + JSON.stringify(MK_PREVIEW_SRC) + ';',
    'function send(m){try{m.src=SRC;P.postMessage(m,"*");}catch(e){}}',
    'var SEL=null;',
    // ★ 2026-09-29 남지현 접수 — 여기 `\"` 가 `\\"` 가 아니어서 스크립트 전체가 문법 오류로 한 번도 돌지 않았다
    //   (링크 막기·탭·선택 테두리·스크롤 복원 전부 죽음 · 수신거부 누르면 미리보기가 다른 주소로 넘어가 문구가 사라짐).
    //   계약 = make-preview-guard.test.ts 가 이 스크립트를 실제로 해석·실행한다.
    'function report(){if(!SEL){send({type:"rect",id:null,top:0,height:0});return;}var el=document.querySelector("[data-section-id=\\""+String(SEL).replace(/"/g,"")+"\\"]");',
    'if(!el){send({type:"rect",id:null,top:0,height:0});return;}var r=el.getBoundingClientRect();send({type:"rect",id:SEL,top:r.top,height:r.height});}',
    'function mark(id){SEL=id||null;var ns=document.querySelectorAll("[data-section-id]");for(var i=0;i<ns.length;i++){var n=ns[i];',
    'if(id&&n.getAttribute("data-section-id")===id){n.style.outline="2px solid #8b5cf6";n.style.outlineOffset="-2px";}else{n.style.outline="";n.style.outlineOffset="";}}report();}',
    // 링크는 미리보기 안에서 이동하지 않는다(클릭 추적 주소를 거치지 않게) · 버튼(장 넘김·참여형)은 그대로 동작
    'document.addEventListener("click",function(e){var t=e.target;if(!t||!t.closest)return;',
    'var a=t.closest("a[href]");if(a){e.preventDefault();}',
    'if(TAP){var w=t.closest("[data-section-id]");if(w){send({type:"tap",id:w.getAttribute("data-section-id")});}}},true);',
    'document.addEventListener("submit",function(e){e.preventDefault();},true);',
    // ★ 2026-10-08 (남지현 접수 cmuz1os880) 스크롤 복원 = 그림이 다 들어와 문서가 자랄 때까지 다시 맞춘다.
    //   옛: ready(그림 받기 전) 한 번만 scrollTo → 문서가 짧아 위쪽에서 멈추고, 그 멈춘 값이 scroll 로 부모에 보고돼 기억까지 덮였다(고칠 때마다 맨 위).
    //   WANT = 돌아갈 자리. 맞출 때까지 scroll 보고를 하지 않는다 · 사람이 직접 움직이면(휠·터치·누름·키) 바로 내려놓는다 · 3초 뒤 포기.
    'var WANT=-1;function stopWant(){WANT=-1;}',
    'function apply(){if(WANT<0)return;window.scrollTo(0,WANT);if(Math.abs((window.scrollY||0)-WANT)<2)WANT=-1;}',
    'var HUMAN=["wheel","touchstart","mousedown","keydown"];for(var hi=0;hi<HUMAN.length;hi++){window.addEventListener(HUMAN[hi],stopWant,{passive:true});}',
    'window.addEventListener("load",function(){apply();send({type:"loaded"});});',
    'document.addEventListener("load",function(){apply();},true);',
    'var q=false;window.addEventListener("scroll",function(){if(q)return;q=true;',
    '(window.requestAnimationFrame||setTimeout)(function(){q=false;if(WANT<0)send({type:"scroll",y:window.scrollY||0});report();});},{passive:true});',
    // 장 넘김(가로 슬라이드)처럼 창이 아닌 칸이 움직이면 창 scroll 이 안 온다 — 칸 안 스크롤도 받아 자리를 다시 알린다
    'document.addEventListener("scroll",function(){if(SEL)report();},true);',
    'window.addEventListener("message",function(e){if(e.source!==P)return;var d=e.data||{};if(d.src!==SRC)return;',
    'if(d.type==="scrollTo"&&typeof d.y==="number"){WANT=d.y;apply();setTimeout(stopWant,3000);}',
    'if(d.type==="select"){mark(d.id||null);if(d.id&&d.reveal){var el=document.querySelector("[data-section-id=\\""+String(d.id).replace(/"/g,"")+"\\"]");',
    // ★ 2026-10-01 장 넘김 효과(책장 넘김·페이드) DM 은 장을 한자리에 겹쳐 두어 스크롤이 없다 — scrollIntoView 로는 고른 장으로 가지 않았다
    //   (편집기 왼쪽에서 쪽을 골라도 미리보기가 1쪽에 멈춤 · 박성용 접수 cmunux3e4). 그 장의 점을 눌러 뷰어의 장 이동(goToPage → fxGo)을 탄다.
    'if(el&&document.body&&document.body.classList&&document.body.classList.contains("dm-fx")){var pg=el.closest?el.closest(".dm-page"):null;',
    'var pi=pg?parseInt(pg.getAttribute("data-page-idx")||"-1",10):-1;var ds=document.querySelectorAll(".dm-page-dots .dot");if(pi>=0&&ds[pi]&&ds[pi].click)ds[pi].click();setTimeout(report,700);}',
    'else if(el&&el.scrollIntoView){el.scrollIntoView({block:"center"});setTimeout(report,60);}}}});',
    'send({type:"ready"});',
    '})();',
  ].join('');
}

/**
 * 서버 HTML → 미리보기 HTML. CSP 는 `<head>` 첫 자식, 다리 스크립트는 마지막 `</body>` 바로 앞(없으면 끝).
 * `<head>` 가 없으면 만들어 넣는다(이메일·뷰어 모두 있지만 빈 값·조각도 안전하게).
 */
export function guardPreviewHtml(html: string, opts: { tap?: boolean } = {}): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${MK_PREVIEW_CSP}">`;
  let out = String(html ?? '');
  const headOpen = /<head(\s[^>]*)?>/i;
  const htmlOpen = /<html(\s[^>]*)?>/i;
  if (headOpen.test(out)) out = out.replace(headOpen, (m) => m + csp);
  else if (htmlOpen.test(out)) out = out.replace(htmlOpen, (m) => `${m}<head>${csp}</head>`);
  else out = `<head>${csp}</head>${out}`;
  const script = `<script>${bridgeSource(!!opts.tap)}</script>`;
  const at = out.toLowerCase().lastIndexOf('</body>');
  return at >= 0 ? out.slice(0, at) + script + out.slice(at) : out + script;
}

/** 부모 쪽 판정 — 이 iframe 이 보낸 다리 메시지인가 */
export function readPreviewMessage(e: MessageEvent, frame: HTMLIFrameElement | null): MkPreviewInbound | null {
  if (!frame || e.source !== frame.contentWindow) return null;
  const d = e.data as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || d.src !== MK_PREVIEW_SRC) return null;
  if (d.type === 'ready') return { src: MK_PREVIEW_SRC, type: 'ready' };
  if (d.type === 'loaded') return { src: MK_PREVIEW_SRC, type: 'loaded' };
  if (d.type === 'tap' && typeof d.id === 'string' && d.id) return { src: MK_PREVIEW_SRC, type: 'tap', id: d.id };
  if (d.type === 'scroll' && typeof d.y === 'number' && Number.isFinite(d.y)) return { src: MK_PREVIEW_SRC, type: 'scroll', y: d.y };
  if (d.type === 'rect' && typeof d.top === 'number' && typeof d.height === 'number') return { src: MK_PREVIEW_SRC, type: 'rect', id: typeof d.id === 'string' ? d.id : null, top: d.top, height: d.height };
  return null;
}

/** 부모 → iframe(불투명 출처라 대상 출처는 '*' · 받는 쪽이 부모 창인지 확인한다) */
export function postToPreview(frame: HTMLIFrameElement | null, msg: { type: 'scrollTo'; y: number } | { type: 'select'; id: string | null; reveal?: boolean }): void {
  try { frame?.contentWindow?.postMessage({ ...msg, src: MK_PREVIEW_SRC }, '*'); } catch { /* 닫힌 창 = 무시 */ }
}
