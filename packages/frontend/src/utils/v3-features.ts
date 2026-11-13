/**
 * v3-features.ts — 이 회사에 지금 열린 한줄로 V3 기능(★ 2026-11-13 C133 · 서버 = GET /api/plans/v3-features · 판정 = backend utils/v3-stage.ts 한 곳)
 *
 * 화면은 「이 기능의 입구를 그릴까」만 묻는다(값은 각 기능의 서버 길이 다시 판정한다 = 여기 값으로 권한을 정하지 않는다).
 * 모르면 그리지 않는다 — 실패 · 시간 제한 = 전부 닫힘. 한 로그인 동안 한 번만 묻는다(실패한 답은 기억하지 않는다).
 */
import { useEffect, useState } from 'react';
import { fetchJson } from './dashboard-live';

export type V3FeatureKey = 'journey-pack' | 'product-insight' | 'benchmark' | 'reco' | 'split' | 'inbox';
type Features = Partial<Record<V3FeatureKey, boolean>>;

let cache: { mark: string; promise: Promise<Features> } | null = null;
const loginMark = (): string => (localStorage.getItem('token') || '').slice(-24);

export function fetchV3Features(): Promise<Features> {
  const mark = loginMark();
  if (!mark) return Promise.resolve({});
  if (cache && cache.mark === mark) return cache.promise;
  const promise: Promise<Features> = fetchJson('/api/plans/v3-features').then((r) =>
    (r.ok && r.body?.success === true && r.body.features && typeof r.body.features === 'object' ? (r.body.features as Features) : {}));
  cache = { mark, promise };
  void promise.then((f) => { if (Object.keys(f).length === 0 && cache?.promise === promise) cache = null; });
  return promise;
}

/** 이 기능이 열렸는가(답이 오기 전 · 실패 = false) */
export function useV3Feature(key: V3FeatureKey): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchV3Features().then((f) => { if (alive) setOn(f[key] === true); });
    return () => { alive = false; };
  }, [key]);
  return on;
}
