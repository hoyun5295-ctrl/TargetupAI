/**
 * Pageview 자동 수집 (§5 #4).
 * history.pushState/replaceState patching + popstate + hashchange + 초기 load.
 * SPA (Next.js / React Router / Vue Router 등) 흐름.
 */

export interface PageviewEvent {
  url: string;
  title: string;
  referrer: string;
}

export function setupPageviewTracking(
  emit: (event: PageviewEvent) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  let lastReferrer = document.referrer || '';

  const fire = () => {
    emit({
      url: window.location.href,
      title: document.title || '',
      referrer: lastReferrer,
    });
    lastReferrer = window.location.href;
  };

  fire();

  const originalPush = window.history.pushState;
  const originalReplace = window.history.replaceState;
  window.history.pushState = function (...args) {
    const result = originalPush.apply(this, args);
    fire();
    return result;
  };
  window.history.replaceState = function (...args) {
    const result = originalReplace.apply(this, args);
    fire();
    return result;
  };

  const onPopState = () => fire();
  const onHashChange = () => fire();
  window.addEventListener('popstate', onPopState);
  window.addEventListener('hashchange', onHashChange);

  return () => {
    window.history.pushState = originalPush;
    window.history.replaceState = originalReplace;
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('hashchange', onHashChange);
  };
}
