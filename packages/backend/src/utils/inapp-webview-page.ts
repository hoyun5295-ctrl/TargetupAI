/**
 * inapp-webview-page.ts — 앱 웹뷰 호스트(계약 v5) 정적 페이지 한 장(★ 2026-11-08 C114 I-1 · 설계서 docs/2026-11-08-c114-roadmap-v2-design.md)
 *
 * 앱은 /inapp/active?caps=webview 로 받은 메시지 하나를 이 페이지에 넣는다:
 *   RN = injectedJavaScriptBeforeContentLoaded 로 window.__HJL_INAPP__ = { message, serverNow, customer? }
 *   iOS · 안드로이드 네이티브 = 로드 뒤 HanjulInApp.render(json)
 * 그리기 = 웹 SDK renderInAppForHost(몰 화면 · 편집 미리보기와 같은 렌더러) · 기록 · 이동 · 닫기 · 복사 = 다리 사건으로 앱에 넘긴다.
 * ⛔ 이 페이지는 API 를 부르지 않는다(CSP connect-src 'none') · 정적 자원(SDK 파일 · 그림 · 글꼴)만 받는다(Codex 설계 1R ③).
 * 순수(문자열만) — 라우트가 nonce 를 만들어 넘긴다.
 */
import { SERVED_SDK_VERSIONS } from './sdk-serve';

/** 페이지가 싣는 SDK 판 = 서빙 폴더 중 가장 새 판(빌드 동기화가 v0.3.8 이상 전 폴더에 같은 파일을 둔다) */
export const INAPP_WEBVIEW_SDK_PATH = `/api/cdp/sdk/${SERVED_SDK_VERSIONS[SERVED_SDK_VERSIONS.length - 1]}/hanjul.min.js`;

export function inAppWebviewCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com data:",
    "img-src 'self' https: data: blob:",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

export function buildInAppWebviewPage(nonce: string): { html: string; csp: string } {
  const n = String(nonce || '').replace(/[^0-9a-zA-Z]/g, '');
  // 부팅 글 = 한 번만 그린다 · 받는 길 셋(미리 넣은 값 · render 함수 · postMessage) · 그 밖 일은 SDK 가 한다
  const boot = [
    '(function(){',
    'var done=false;',
    'function render(p){',
    '  if(done)return;',
    '  var v=p;',
    "  if(typeof v==='string'){try{v=JSON.parse(v);}catch(e){return;}}",
    '  if(!v||!v.message||!window.Hanjullo||!window.Hanjullo.renderInAppForHost)return;',
    '  done=true;',
    '  window.Hanjullo.renderInAppForHost(v);',
    '}',
    'window.HanjulInApp={render:render};',
    'function onMsg(ev){',
    '  var d=ev&&ev.data;',
    "  if(typeof d==='string'){try{d=JSON.parse(d);}catch(e){return;}}",
    "  if(d&&d.type==='hanjul-inapp-render')render(d.payload);",
    '}',
    "window.addEventListener('message',onMsg);",
    "document.addEventListener('message',onMsg);",
    'if(window.__HJL_INAPP__)render(window.__HJL_INAPP__);',
    '})();',
  ].join('\n');
  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<title>한줄로 인앱</title>
<style>html,body{margin:0;padding:0;background:transparent;height:100%;overflow:hidden;-webkit-tap-highlight-color:transparent;}</style>
</head>
<body>
<script src="${INAPP_WEBVIEW_SDK_PATH}"></script>
<script nonce="${n}">
${boot}
</script>
</body>
</html>`;
  return { html, csp: inAppWebviewCsp(n) };
}
