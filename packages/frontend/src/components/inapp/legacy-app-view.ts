/**
 * legacy-app-view.ts — ★ 2026-11-08 C114 I-2 · K2 옛 앱(웹뷰를 붙이지 않은 앱 · caps 없음)이 실제로 받는 꼴 · React 0 · 순수.
 *   서버 legacyServeTransform(utils/inapp-message.ts) 의 거울 — 백엔드 계약 시험(c114-inapp-serve-1108)이 같은 표본으로 두 함수를 대조한다.
 */

/** 게시 끝 시각 → 「11월 30일 23:59」(한국 시각) — 서버 inAppDeadlineText 와 같은 글(계약 시험이 묶는다) */
export function inAppDeadlineText(endAt: string | number | Date | null | undefined): string | null {
  if (endAt === null || endAt === undefined || endAt === '') return null;
  const ms = endAt instanceof Date ? endAt.getTime() : new Date(endAt).getTime();
  if (!Number.isFinite(ms)) return null;
  const k = new Date(ms + 9 * 3600 * 1000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 ${p2(k.getUTCHours())}:${p2(k.getUTCMinutes())}`;
}

/**
 * ★ 2026-11-08 C114 I-2 · K2 편집기 「구버전 앱 모습」 = 서버가 옛 앱(caps 없음)에 실제로 보내는 꼴(서버 legacyServeTransform 거울 · 계약 시험이 표본 표로 묶는다).
 *   틀 지움 · 통짜 = 글 비움 · 띠 = 글 한 줄(통짜면 글 얹기로 내림) · 하루 보지 않기 = 옛 앱에 없다(다시 보지 않기).
 *   여러 장 그림 4:5 미리 맞춤은 그리는 쪽(PosterSheetPreview overlay 여러 장 = 맞추기)이 같은 결과를 낸다.
 */
export function legacyAppPreviewOf<S extends Record<string, any>>(
  design: Record<string, any> | null | undefined, slides: S[], endAt?: string | number | Date | null,
): { design: Record<string, any>; slides: S[] } {
  const { poster_frame: _f, dismiss_mode: _d, ...base } = design || {};
  let d: Record<string, any> = base;
  const baked = d.poster_text === 'baked';
  let out: S[] = baked
    ? slides.map((s) => { const { title: _t, body: _b, eyebrow: _e, subtitle: _s, ...rest } = s; return rest as S; })
    : slides.slice();
  const strip = d.poster_strip && typeof d.poster_strip === 'object' ? d.poster_strip : null;
  if (strip && (strip.type === 'coupon' || strip.type === 'countdown')) {
    const line = strip.type === 'coupon'
      ? (String(strip.code || '').trim() ? `쿠폰 코드 ${String(strip.code).trim()}` : '')
      : (inAppDeadlineText(endAt) ? `${inAppDeadlineText(endAt)}까지` : '');
    const { poster_strip: _p, ...r1 } = d;
    d = r1;
    if (line) {
      if (d.poster_text === 'baked') { const { poster_text: _t, ...r2 } = d; d = r2; }
      out = out.map((s, i) => (i === 0 ? { ...s, body: String(s.body ?? '').trim() ? `${String(s.body).trim()}\n${line}` : line } : s));
    }
  }
  return { design: d, slides: out };
}
