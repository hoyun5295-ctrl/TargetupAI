/**
 * ★ 2026-09-24 네이버 스토어 화면 가져오기(설계서 docs/2026-09-23-outreach-direct-send-design.md §9-1)
 * 북마크 버튼(책갈피 스크립트) → 이 앱의 수신 페이지(OUTREACH_GRAB_PATH) → 서버 POST /api/sales-outreach/store-grab.
 *
 * 규율:
 * - 버튼은 직원 브라우저에 이미 떠 있는 화면만 읽는다(네이버에 추가 요청 0). 행사 문구 추출은 서버 CT 하나 — 여기는 걷어내기·압축·전달만.
 * - 전달 = 새 탭 주소의 # 뒤(서버 로그에 안 남는다 · 네이버 쪽 보안 설정과 무관). 수신 페이지가 읽자마자 주소에서 지운다.
 * - 설치 열쇠(이 브라우저 localStorage) = 버튼에 심는다. 수신 페이지는 열쇠가 맞을 때만 받는다(남이 만든 링크로 문구를 못 붙인다).
 * - 번들이 난독화되므로 버튼 스크립트는 함수 직렬화가 아니라 문자열로 조립한다(난독화 보조 함수가 네이버 화면에는 없다).
 */

export const OUTREACH_GRAB_PATH = '/admin/outreach-grab';
/** 버튼 판(바뀌면 수신 페이지가 옛 버튼을 거절하고 다시 설치를 안내한다) */
export const OUTREACH_GRAB_VERSION = 1;
const KEY_STORAGE = 'outreachGrabKey';
const CHANNEL = 'hanjul-outreach';
/** 버튼이 보내는 화면 HTML 상한(글자) — 서버 업로드 상한 2MB 안쪽(한글 3바이트 기준) */
const GRAB_HTML_MAX = 600_000;

export function readGrabKey(): string | null {
  try { return localStorage.getItem(KEY_STORAGE); } catch { return null; }
}

/** 설치 열쇠(32자 hex) — 있으면 그대로(다시 끌어다 놓아도 같은 열쇠) · 없으면 만든다 */
export function ensureGrabKey(): string {
  const cur = readGrabKey();
  if (cur && /^[0-9a-f]{32}$/.test(cur)) return cur;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(KEY_STORAGE, key); } catch { /* 저장 불가 = 수신 페이지가 열쇠 불일치로 안내한다 */ }
  return key;
}

// 버튼 본문(네이버 화면에서 실행) — O 앱 주소 · P 수신 경로 · V 판 · K 열쇠 · M 상한은 앞에서 주입한다.
// 머리글·바닥글은 걷어낸다(로그인한 직원 이름이 머리글에 있다) · 속성은 class·id·href 만(추출기가 쓰는 것).
const GRAB_SCRIPT_BODY = [
  "const s=t=>{const d=document.createElement('div');d.style.cssText='position:fixed;top:12px;right:12px;z-index:2147483647;background:#0f172a;color:#fff;padding:12px 16px;border-radius:10px;font:14px/1.6 sans-serif;max-width:360px';d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),6000)};",
  'try{',
  "if(!location.hostname.endsWith('naver.com')){s('한줄로: 네이버 스토어 화면에서 눌러 주세요');return}",
  'const c=document.body.cloneNode(true);',
  "c.querySelectorAll('script,style,svg,noscript,iframe,template,link,meta,img,video,picture,source,canvas,header,footer,input,textarea,select').forEach(e=>e.remove());",
  "c.querySelectorAll('*').forEach(e=>{for(const a of [...e.attributes]){if(a.name!=='class'&&a.name!=='id'&&a.name!=='href')e.removeAttribute(a.name)}});",
  "const h=c.innerHTML.replace(/\\s+/g,' ').slice(0,M);",
  "const z=new Uint8Array(await new Response(new Blob([JSON.stringify({u:location.href,h:h})]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());",
  "let b='';for(let i=0;i<z.length;i+=8192)b+=String.fromCharCode.apply(null,z.subarray(i,i+8192));",
  "const w=window.open(O+P+'#v='+V+'&k='+K+'&g='+btoa(b).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''),'_blank');",
  "s(w?'한줄로로 보냈습니다':'한줄로: 새 창이 막혔습니다. 이 사이트의 팝업을 허용해 주세요')",
  "}catch(e){s('한줄로 가져오기 오류 · '+(e&&e.message||e))}",
].join('');

/** 북마크바에 끌어다 놓을 주소(javascript:) — 앱 주소·열쇠를 심는다 */
export function buildGrabBookmarklet(origin: string, key: string): string {
  const head = `const O=${JSON.stringify(origin)},P=${JSON.stringify(OUTREACH_GRAB_PATH)},V=${OUTREACH_GRAB_VERSION},K=${JSON.stringify(key)},M=${GRAB_HTML_MAX};`;
  return 'javascript:' + encodeURIComponent(`(async()=>{${head}${GRAB_SCRIPT_BODY}})();`);
}

/** 수신 페이지 주소의 # → 판·열쇠·압축본(압축은 아직 풀지 않는다 · 열쇠 먼저 본다) */
export function parseGrabHash(hash: string): { v: number; k: string; g: string } | null {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const g = p.get('g') || '';
  if (!/^[A-Za-z0-9_-]+$/.test(g)) return null;
  return { v: Number(p.get('v')) || 0, k: String(p.get('k') || ''), g };
}

/** 압축본 → { u: 스토어 화면 주소, h: 걷어낸 HTML } · 실패 = null */
export async function inflateGrab(g: string): Promise<{ u: string; h: string } | null> {
  try {
    const b64 = g.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const o = JSON.parse(text);
    if (!o || typeof o.u !== 'string' || typeof o.h !== 'string') return null;
    return { u: o.u, h: o.h };
  } catch {
    return null;
  }
}

/** 수신 페이지 → 같은 앱의 다른 탭(AI 영업 창·작업대)에 "이 건에 붙었다" 알림 */
export function notifyStoreGrab(jobId: string): void {
  try {
    const c = new BroadcastChannel(CHANNEL);
    c.postMessage({ type: 'store_grab', jobId });
    c.close();
  } catch { /* 알림 실패 = 원래 창은 다음 새로고침에 보인다 */ }
}

/** 알림 구독 — 돌려주는 함수로 해제 */
export function onStoreGrab(cb: (jobId: string) => void): () => void {
  let c: BroadcastChannel | null = null;
  try {
    c = new BroadcastChannel(CHANNEL);
    c.onmessage = (e: MessageEvent) => {
      if (e?.data?.type === 'store_grab' && typeof e.data.jobId === 'string') cb(e.data.jobId);
    };
  } catch { /* 미지원 브라우저 = 알림 없이 폴링·새로고침으로 */ }
  return () => { try { c?.close(); } catch { /* 무시 */ } };
}
