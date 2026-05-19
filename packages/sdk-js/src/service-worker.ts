/**
 * @hanjullo/sdk — Service Worker (D175-A, 2026-05-19)
 *
 * 자사몰이 본 파일 내용을 `/hanjullo-sw.js`로 박은 후 SDK가 등록 + Web Push 수신.
 *
 * 사용 (자사몰 측 진입):
 *   1. 본 파일 내용을 자사몰 루트의 hanjullo-sw.js로 복사
 *   2. SDK가 hanjullo.push.subscribe() 호출 시 자동으로 SW 등록
 *
 * 본 파일은 service worker context에서 실행됩니다 (self 전역, window 미박힘).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const self: any;

self.addEventListener('push', (event: any) => {
  let payload: { title?: string; body?: string; url?: string; icon?: string; badge?: string } = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: '한줄로', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || '한줄로 알림';
  const options: any = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/badge-72.png',
    data: { url: payload.url || '/' },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: any) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList: any[]) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
      return null;
    }),
  );
});

self.addEventListener('install', () => {
  self.skipWaiting?.();
});

self.addEventListener('activate', (event: any) => {
  event.waitUntil(self.clients.claim?.());
});
