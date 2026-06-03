/**
 * 사후 크레딧 토스트 인터셉터 — 차감 응답 헤더 X-Credit-* 를 감지해 credit:used 이벤트를 쏜다.
 * ToastProvider가 수신해 "N 크레딧 사용 · 잔여 X" 토스트를 띄운다(큰 차감은 사전 모달이 안내하므로 ToastProvider가 skip).
 *
 * 차감은 callAIWithFallback 내부에서 일어나 호출처가 모르므로, 백엔드가 응답 헤더로 차감 결과를 실어주고
 * 여기서 전역으로 가로챈다 — 수십 곳의 fetch/axios 호출처는 무수정.
 *   - fetch: import 시 전역 1회 래핑
 *   - axios: 인스턴스마다 attachCreditInterceptor(instance)로 부착
 */
import type { AxiosInstance } from 'axios';

function emit(used?: string | null, balance?: string | null, source?: string | null) {
  if (!used || !source) return;
  window.dispatchEvent(new CustomEvent('credit:used', {
    detail: { used: Number(used), balance: Number(balance), source },
  }));
}

// fetch 전역 래핑 (import 시 1회)
const _fetch = window.fetch;
window.fetch = (async (...args: Parameters<typeof fetch>) => {
  const res = await _fetch(...args);
  try {
    emit(res.headers.get('X-Credit-Used'), res.headers.get('X-Credit-Balance'), res.headers.get('X-Credit-Source'));
  } catch { /* noop */ }
  return res;
}) as typeof fetch;

/** axios 인스턴스에 크레딧 헤더 감지 인터셉터 부착. */
export function attachCreditInterceptor(instance: AxiosInstance) {
  instance.interceptors.response.use(
    (res) => {
      try {
        const h = (res.headers || {}) as Record<string, string | undefined>;
        emit(h['x-credit-used'], h['x-credit-balance'], h['x-credit-source']);
      } catch { /* noop */ }
      return res;
    },
    (err) => Promise.reject(err),
  );
}
