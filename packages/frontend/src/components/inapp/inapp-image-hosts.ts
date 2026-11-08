/**
 * inapp-image-hosts.ts — ★ 2026-11-08 C116-B D6 서버가 「우리 그림」으로 인정하는 호스트 목록 한 곳(설계서 docs/2026-11-08-c116b-inapp-universal-output-design.md).
 *   GET /api/cdp/inapp/own-image-hosts(서버 CT trustedImageHosts 그대로)를 한 번 받아 「구버전 앱 모습」 거울(legacy-app-view)이 판정에 쓴다.
 *   받기 전 = loading · 실패 = error(다시 시도 때만 또 받음) · 받으면 구독한 화면이 다시 그린다. 화면 호스트 자동 신뢰 0(짐작 0).
 */
import { useEffect, useSyncExternalStore } from 'react';
import api from '../../api/client';
import { DEFAULT_OWN_IMAGE_HOSTS, type OwnHostsSnapshot } from './legacy-app-view';

let snap: OwnHostsSnapshot = { status: 'loading', hosts: DEFAULT_OWN_IMAGE_HOSTS };
let inflight = false;
const subs = new Set<() => void>();
const emit = () => { for (const f of subs) f(); };

/** 목록 받기 — 이미 받았으면 그만 · 받는 중이면 그만 · 실패 뒤에는 다시 부를 때만(다시 시도) */
export function loadOwnImageHosts(): void {
  if (snap.status === 'ready' || inflight) return;
  inflight = true;
  if (snap.status === 'error') { snap = { status: 'loading', hosts: snap.hosts }; emit(); }
  api.get('/cdp/inapp/own-image-hosts')
    .then((r) => {
      const list = Array.isArray(r.data?.hosts) ? (r.data.hosts as unknown[]).map((h) => String(h).toLowerCase().replace(/\.$/, '')) : null;
      snap = list ? { status: 'ready', hosts: new Set(list) } : { status: 'error', hosts: DEFAULT_OWN_IMAGE_HOSTS };
    })
    .catch(() => { snap = { status: 'error', hosts: DEFAULT_OWN_IMAGE_HOSTS }; })
    .finally(() => { inflight = false; emit(); });
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const getSnap = () => snap;

/** 「구버전 앱 모습」을 그리는 두 자리(편집기 · 공용 미리보기)가 쓴다 — 처음 쓰일 때 받기 시작 */
export function useOwnImageHosts(): OwnHostsSnapshot {
  const s = useSyncExternalStore(subscribe, getSnap, getSnap);
  useEffect(() => { loadOwnImageHosts(); }, []);
  return s;
}
