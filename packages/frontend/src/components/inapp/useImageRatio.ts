/**
 * useImageRatio — ★ 2026-11-08 C118 E5 ⑥ 그림 가로 / 세로 비율을 주소별 세 상태로(읽는 중 · 확인 · 실패).
 *   결과에 주소를 달아 돌려준다 — 쓰는 쪽은 지금 주소와 같을 때만 쓴다(늦게 온 옛 주소 결과 = 버림 · Codex 설계 1R ②).
 */
import { useEffect, useState } from 'react';

export interface ImageRatioState { url: string | null; status: 'none' | 'loading' | 'ready' | 'error'; ratio: number }

export function useImageRatio(url: string | null): ImageRatioState {
  const [st, setSt] = useState<ImageRatioState>({ url: null, status: 'none', ratio: 0 });
  useEffect(() => {
    if (!url) { setSt({ url: null, status: 'none', ratio: 0 }); return; }
    let alive = true;
    setSt({ url, status: 'loading', ratio: 0 });
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const ok = img.naturalWidth > 0 && img.naturalHeight > 0;
      setSt({ url, status: ok ? 'ready' : 'error', ratio: ok ? img.naturalWidth / img.naturalHeight : 0 });
    };
    img.onerror = () => { if (alive) setSt({ url, status: 'error', ratio: 0 }); };
    img.src = url;
    return () => { alive = false; img.onload = null; img.onerror = null; };
  }, [url]);
  return st;
}
