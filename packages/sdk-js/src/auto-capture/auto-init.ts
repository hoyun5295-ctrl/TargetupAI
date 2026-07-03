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
  let platform: string | null = null;
  const current = document.currentScript as HTMLScriptElement | null;
  if (current && current.getAttribute) {
    apiKey = current.getAttribute('data-hjl-key');
    inappContainer = current.getAttribute('data-hjl-inapp-container');
    platform = current.getAttribute('data-hjl-platform');
  }

  // 2) fallback — data-hjl-key 속성을 가진 script 태그 탐색 (async/defer 로드 시 currentScript=null)
  if (!apiKey) {
    const tags = document.querySelectorAll('script[data-hjl-key]');
    for (let i = 0; i < tags.length; i++) {
      const v = tags[i].getAttribute('data-hjl-key');
      if (v) {
        apiKey = v;
        inappContainer = tags[i].getAttribute('data-hjl-inapp-container');
        platform = tags[i].getAttribute('data-hjl-platform');
        break;
      }
    }
  }

  // 3) fallback — src의 ?k= 쿼리에서 공개 키를 읽는다.
  //    자사몰 앱 연동(카페24 scripttags 등)은 data 속성을 부여할 수 없고 src만 등록되므로
  //    src="https://app.hanjul.ai/sdk/vX/hanjul.min.js?k=hjl_..." 형태로 키를 전달한다.
  if (!apiKey) {
    const keyFromSrc = (src: string | null | undefined): string | null => {
      if (!src) return null;
      const q = src.indexOf('?');
      if (q < 0) return null;
      try {
        return new URLSearchParams(src.slice(q + 1)).get('k');
      } catch {
        return null;
      }
    };
    apiKey = keyFromSrc(current ? current.src : null);
    if (!apiKey) {
      const srcTags = document.querySelectorAll('script[src]');
      for (let i = 0; i < srcTags.length; i++) {
        const src = (srcTags[i] as HTMLScriptElement).src;
        if (src && src.indexOf('hanjul') >= 0) {
          const k = keyFromSrc(src);
          if (k) { apiKey = k; break; }
        }
      }
    }
  }

  if (!apiKey) return;

  const hjl = (window as any).hjl;
  if (!hjl || typeof hjl.init !== 'function') return;

  try {
    hjl.init({
      apiKey,
      ...(inappContainer ? { inappContainer } : {}),
      ...(platform === 'app' ? { platform: 'app' as const } : {}),
    });
  } catch (err) {
    // init 실패(키 포맷 오류 등)는 콘솔로만 — 호스트 페이지 동작 방해 X
    if (typeof console !== 'undefined') console.error('[Hanjullo] 자동 init 실패:', err);
  }
}
