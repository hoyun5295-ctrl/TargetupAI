/**
 * identityProvider.ts — 본인확인기관 인증 창 연결 (★2026-10-02 전송자격인증 2.1 ①-1 · ★2026-10-03 팝업 통로)
 *
 * 서버가 돌려준 시작 값으로 인증 창을 열고, 그 창이 돌려준 결과를 **그대로** 넘긴다.
 * 결과가 진짜인지는 여기서 판단하지 않는다 — 서버가 인증기관에 확인한다(`utils/identity-verify.ts`).
 *
 * 흐름(인증기관 공통 — 팝업에서 인증하고 등록해 둔 주소로 돌아오는 방식)
 *   1. 사용자가 버튼을 누른 그 순간에 빈 창을 먼저 연다(`openIdentityWindow`).
 *      ⛔ 서버 응답을 기다린 뒤에 열면 브라우저가 팝업으로 보고 막는다. 여는 것은 누름과 같은 순간이어야 한다.
 *   2. 서버의 시작 값(`mode: 'popup_form'`)으로 그 창에 인증기관 요청을 보낸다.
 *   3. 인증이 끝나면 인증기관이 창을 우리 복귀 주소(`/api/auth/identity/return`)로 돌려보내고,
 *      그 화면이 결과를 이 창에 메시지로 넘긴 뒤 닫힌다.
 *
 * ⛔ 받는 메시지는 셋을 모두 확인한다 — 보낸 창이 **우리가 연 그 창**이고, 출처가 **이 사이트**이고, 종류가 맞을 때만.
 *   하나라도 빠지면 다른 창이 남의 인증 결과를 끼워 넣을 수 있다. (그 결과가 이 요청의 것인지는 서버가 다시 확인한다)
 *
 * 한국모바일인증 모듈과 규격을 받으면 고칠 곳은 서버의 인증기관 구현이다. 이 파일은 팝업 방식이면 그대로 쓴다.
 */

/** 복귀 창이 보내는 메시지 종류 — 서버 `utils/identity-return.ts` 의 `IDENTITY_RETURN_MESSAGE_TYPE` 과 같은 값 */
const RETURN_MESSAGE_TYPE = 'hanjullo:identity';
/** 인증 창을 기다리는 최대 시간 — 서버의 본인인증 진행 시간(10분)과 같다 */
const WAIT_LIMIT_MS = 10 * 60 * 1000;
const CLOSED_POLL_MS = 500;

export class IdentityWindowError extends Error {
  constructor(public code: 'POPUP_BLOCKED' | 'WINDOW_CLOSED' | 'TIMEOUT' | 'UNSUPPORTED' | 'INVALID_START') {
    super(code);
  }
}

/**
 * 인증 창을 미리 연다. **버튼 누름 처리 안에서, 다른 일을 기다리기 전에** 불러야 한다.
 * 막혔으면 null — 호출부가 팝업 허용 안내를 보인다.
 */
export function openIdentityWindow(): Window | null {
  const width = 480;
  const height = 720;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  // 창 이름을 매번 새로 만든다 — 다른 화면이 같은 이름으로 이 창을 가로채 주소를 바꾸지 못하게
  const name = `identity_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const win = window.open('about:blank', name, `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`);
  return win && !win.closed ? win : null;
}

function isAllowedAction(action: string): boolean {
  try {
    const url = new URL(action);
    if (url.protocol === 'https:') return true;
    // 개발 환경의 시험용 인증 창만 http 를 허용한다
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/**
 * 미리 연 창에 인증기관 요청을 보낸다(폼 전송).
 * ⛔ 폼의 동작은 **원형의 메서드로** 부른다(★Codex 1R) — 폼 안의 입력칸은 이름이 곧 폼의 속성이 된다.
 *   인증기관이 `submit` · `remove` · `appendChild` 같은 이름의 값을 요구하면 `form.submit()`이 그 입력칸을 가리켜
 *   요청이 나가지 않는다. 주소 · 방식 · 대상 창도 입력칸을 붙이기 **전에** 정한다.
 */
function submitToWindow(win: Window, start: Record<string, any>): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = String(start.action);
  form.target = win.name;
  form.style.display = 'none';
  if (typeof start.charset === 'string' && start.charset) form.acceptCharset = start.charset;
  const fields = (start.fields && typeof start.fields === 'object') ? start.fields : {};
  for (const [key, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = String(value);
    Node.prototype.appendChild.call(form, input);
  }
  document.body.appendChild(form);
  try {
    HTMLFormElement.prototype.submit.call(form);
  } finally {
    document.body.removeChild(form);
  }
}

/**
 * 인증 창을 진행하고 결과(인증기관이 돌려준 값 묶음)를 돌려준다.
 * @param win `openIdentityWindow()` 로 미리 연 창
 */
export async function launchIdentityProvider(
  provider: string,
  start: Record<string, any>,
  win: Window | null,
): Promise<Record<string, string>> {
  if (start?.mode !== 'popup_form') {
    if (win && !win.closed) win.close();
    throw new IdentityWindowError('UNSUPPORTED');
  }
  if (!win || win.closed) throw new IdentityWindowError('POPUP_BLOCKED');
  if (!isAllowedAction(String(start.action || ''))) {
    win.close();
    throw new IdentityWindowError('INVALID_START');
  }

  return new Promise<Record<string, string>>((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      window.clearInterval(closedTimer);
      window.clearTimeout(limitTimer);
      fn();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== win) return;
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || data.type !== RETURN_MESSAGE_TYPE) return;
      const fields = (data.fields && typeof data.fields === 'object') ? data.fields as Record<string, string> : {};
      finish(() => resolve(fields));
    };
    const closedTimer = window.setInterval(() => {
      if (!win.closed) return;
      // 복귀 화면은 결과를 넘긴 직후 스스로 닫힌다. 닫힘을 먼저 보더라도 줄 서 있던 메시지가 먼저 처리되게 한 박자 둔다
      window.clearInterval(closedTimer);
      window.setTimeout(() => finish(() => reject(new IdentityWindowError('WINDOW_CLOSED'))), 400);
    }, CLOSED_POLL_MS);
    const limitTimer = window.setTimeout(() => {
      finish(() => {
        if (!win.closed) win.close();
        reject(new IdentityWindowError('TIMEOUT'));
      });
    }, WAIT_LIMIT_MS);

    window.addEventListener('message', onMessage);
    try {
      submitToWindow(win, start);
    } catch {
      finish(() => {
        if (!win.closed) win.close();
        reject(new IdentityWindowError('INVALID_START'));
      });
    }
  });
}

/** 인증 창 오류를 사용자에게 보일 문장으로 */
export function identityWindowErrorMessage(err: unknown): string {
  const code = err instanceof IdentityWindowError ? err.code : null;
  if (code === 'POPUP_BLOCKED') return '본인인증 창이 차단되었습니다. 브라우저에서 팝업을 허용한 뒤 다시 시도해주세요.';
  if (code === 'WINDOW_CLOSED') return '본인인증 창이 닫혔습니다. 다시 시도해주세요.';
  if (code === 'TIMEOUT') return '본인인증 시간이 지났습니다. 다시 시도해주세요.';
  return '본인인증 창을 열지 못했습니다. 잠시 후 다시 시도해주세요.';
}
