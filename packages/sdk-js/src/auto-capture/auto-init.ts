/**
 * 스니펫 자동 init — <script src="...hanjul.min.js" data-hjl-key="hjl_..."></script>
 * 설치 담당자가 init() 코드를 따로 안 써도, 스크립트 태그의 data-hjl-key만으로 수집이 시작된다.
 * (마케팅 담당자 UX — 추가 입력 0)
 */

/** 현재 로드된 SDK script 태그에서 data-hjl-key(+ data-hjl-inapp-container)를 읽어 hjl.init 자동 호출. */
export function autoInitFromScriptTag(): void {
  if (typeof document === 'undefined') return;

  // 1) document.currentScript 우선 (스크립트 실행 시점)
  let apiKey: string | null = null;
  let inappContainer: string | null = null;
  const current = document.currentScript as HTMLScriptElement | null;
  if (current && current.getAttribute) {
    apiKey = current.getAttribute('data-hjl-key');
    inappContainer = current.getAttribute('data-hjl-inapp-container');
  }

  // 2) fallback — data-hjl-key 속성을 가진 script 태그 탐색 (async/defer 로드 시 currentScript=null)
  if (!apiKey) {
    const tags = document.querySelectorAll('script[data-hjl-key]');
    for (let i = 0; i < tags.length; i++) {
      const v = tags[i].getAttribute('data-hjl-key');
      if (v) {
        apiKey = v;
        inappContainer = tags[i].getAttribute('data-hjl-inapp-container');
        break;
      }
    }
  }

  if (!apiKey) return;

  const hjl = (window as any).hjl;
  if (!hjl || typeof hjl.init !== 'function') return;

  try {
    hjl.init({ apiKey, ...(inappContainer ? { inappContainer } : {}) });
  } catch (err) {
    // init 실패(키 포맷 오류 등)는 콘솔로만 — 호스트 페이지 동작 방해 X
    if (typeof console !== 'undefined') console.error('[Hanjullo] 자동 init 실패:', err);
  }
}
