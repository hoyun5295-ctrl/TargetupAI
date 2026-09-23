/**
 * sns-media-fit.ts — 채널 규격 판정 (순수 · sharp 의존 0) · 2026-09-21 S2
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-7 · 불변 §2-13.
 *
 * ⛔ **Harold 확정(2026-09-21): 원본을 멋대로 자르지 않는다.**
 *   이 파일이 그 규칙을 값으로 만든다.
 *   ① 원본 비율이 그 채널 허용 범위 **안이면 비율을 건드리지 않는다.** 손대는 것이 기본이 아니라 예외다.
 *   ② 범위 밖이어도 **자르지 않는다.** 가장 가까운 경계 비율로 캔버스를 만들고 원본을 통째로 넣는다(pad).
 *      가장 가까운 경계라서 여백이 최소다 — 3:4(0.75) 포스터는 1:1 이 아니라 4:5(0.8) 로 간다.
 *   ③ 자르기(crop)는 **사용자가 그 채널에 대해 명시적으로 고른 경우에만** 한다. 기본값이 될 수 없다.
 *
 * 여백을 무엇으로 채울지는 이 파일이 정하지 않는다 — `image-serve.ts fitToCanvas` 가 사진을 보고 고른다
 * (단색 배경이면 가장자리 색 · 복잡하면 블러 확장 · 0908 비교 캡처로 확정된 판정).
 *
 * sharp 를 import 하지 않는다. 순수 계산만 두어 화면·테스트가 가볍게 같은 판정을 쓸 수 있게 한다.
 */

export interface SnsImageSpec {
  imageAspectMin: number;
  imageAspectMax: number;
  imageMaxWidth: number;
  imageMaxBytes: number;
}

export type SnsFitMode = 'pad' | 'crop';

export interface SnsFitPlan {
  /** 비율을 바꿔야 하는가. false = 원본 비율 그대로(가장 좋은 결과) */
  needsAspectChange: boolean;
  /** 바꿔야 할 때의 목표 비율(가로/세로). needsAspectChange=false 면 null */
  targetAspect: number | null;
  /** 결과 캔버스 크기. needsAspectChange=false 면 원본(또는 폭만 줄인) 크기 */
  canvasWidth: number;
  canvasHeight: number;
  /** 폭 상한 때문에 줄였는가 */
  resized: boolean;
  /** pad = 잘림 0(기본) · crop = 사용자가 고른 경우만 */
  mode: SnsFitMode;
  /**
   * 사람에게 보여줄 한 줄. 화면이 미리보기 위에 그대로 쓴다.
   * ⛔ 아무 일도 안 할 때는 빈 문자열이다 — 하지 않은 일을 설명하지 않는다.
   */
  notice: string;
}

/** 0 나눗셈·비정상 값 방어. 못 읽으면 1(정사각)으로 보지 않고 null 을 돌려 호출부가 멈추게 한다. */
export function aspectOf(width: number | null | undefined, height: number | null | undefined): number | null {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

/**
 * 이 사진을 이 채널에 올리려면 무엇을 해야 하는가.
 * @param mode 사용자가 그 채널에 대해 고른 방식. 기본은 언제나 'pad'.
 */
export function planSnsFit(
  width: number,
  height: number,
  spec: SnsImageSpec,
  mode: SnsFitMode = 'pad',
): SnsFitPlan {
  const aspect = aspectOf(width, height);
  if (aspect === null) {
    // 크기를 모르면 아무것도 계산하지 않는다. 호출부가 원본 그대로 두거나 거절한다.
    return { needsAspectChange: false, targetAspect: null, canvasWidth: width, canvasHeight: height, resized: false, mode, notice: '' };
  }

  // ⛔ 경계에 **허용 오차**를 둔다. 1200x628(가로형 표준)은 1.9108 이라 1.91 을 0.04% 넘는데,
  //   그 차이로 여백을 붙이는 것이야말로 "멋대로 건드리는" 것이다. 플랫폼도 이 정도는 받아들인다.
  const EPS = 0.005;
  const within = aspect >= spec.imageAspectMin * (1 - EPS) && aspect <= spec.imageAspectMax * (1 + EPS);

  // ① 범위 안 — 비율은 건드리지 않는다. 폭 상한만 본다.
  if (within) {
    if (width <= spec.imageMaxWidth) {
      return { needsAspectChange: false, targetAspect: null, canvasWidth: width, canvasHeight: height, resized: false, mode, notice: '' };
    }
    const w = spec.imageMaxWidth;
    const h = Math.max(1, Math.round(w / aspect));
    return {
      needsAspectChange: false, targetAspect: null, canvasWidth: w, canvasHeight: h, resized: true, mode,
      notice: '사진이 커서 크기만 줄입니다. 잘리는 곳은 없어요.',
    };
  }

  // ② 범위 밖 — **가장 가까운 경계**로 간다. 멀리 있는 정사각으로 보내지 않는다(여백 최소).
  const target = aspect < spec.imageAspectMin ? spec.imageAspectMin : spec.imageAspectMax;

  // 캔버스는 원본이 통째로 들어가는 크기로 잡고(잘림 0), 폭 상한을 넘으면 비율을 지키며 줄인다.
  let canvasW: number;
  let canvasH: number;
  if (aspect < target) {
    // 원본이 더 세로로 길다 → 좌우에 여백
    canvasH = height;
    canvasW = Math.round(canvasH * target);
  } else {
    // 원본이 더 가로로 길다 → 위아래에 여백
    canvasW = width;
    canvasH = Math.round(canvasW / target);
  }
  let resized = false;
  if (canvasW > spec.imageMaxWidth) {
    const ratio = spec.imageMaxWidth / canvasW;
    canvasW = spec.imageMaxWidth;
    canvasH = Math.max(1, Math.round(canvasH * ratio));
    resized = true;
  }

  return {
    needsAspectChange: true,
    targetAspect: target,
    canvasWidth: Math.max(1, canvasW),
    canvasHeight: Math.max(1, canvasH),
    resized,
    mode,
    notice: mode === 'crop'
      ? '이 채널 규격에 맞춰 가장자리를 잘라냅니다.'
      : '이 채널 규격에 맞춰 여백을 채웁니다. 사진은 잘리지 않아요.',
  };
}

/** 이 사진이 손대지 않고 그대로 올라가는 채널 수. 화면이 "N개 채널은 원본 그대로"를 말할 때 쓴다. */
export function countUntouched(
  width: number,
  height: number,
  specs: readonly SnsImageSpec[],
): number {
  return specs.filter((s) => !planSnsFit(width, height, s).needsAspectChange && !planSnsFit(width, height, s).resized).length;
}

// ───────────────────────── ★ 2026-09-23 1차-B — 채널별 미디어 수용 · 영상 판정 ─────────────────────────
// 설계 SoT = docs/2026-09-23-sns-1b-design.md §3-4 · 불변 22.
// ⛔ 화면 미러 = frontend/src/utils/sns-view.ts 의 같은 이름 함수. **문구까지 같아야 한다** — 칩 아래 사유와
//    저장 거절 사유가 다르면 사용자가 두 번 헷갈린다. 계약 테스트(sns-1b-rules)가 같은 표로 둘을 맞춘다.

export interface SnsMediaSummary {
  images: number;
  videos: number;
}

export interface SnsMediaRules {
  publishText: boolean;
  publishImage: boolean;
  publishVideo: boolean;
  publishCarousel: boolean;
  maxMediaCount: number;
}

/** 이 채널이 이 미디어 조합을 받지 못하는 사유 한 문장. 받으면 null. */
export function snsMediaBlockReason(summary: SnsMediaSummary, cap: SnsMediaRules): string | null {
  const images = Math.max(0, summary.images | 0);
  const videos = Math.max(0, summary.videos | 0);
  if (images + videos === 0) return cap.publishText ? null : '사진이나 영상이 있어야 올릴 수 있어요.';
  if (videos > 1) return '영상은 한 개만 올릴 수 있어요.';
  if (videos > 0 && images > 0) return '영상과 사진은 함께 올릴 수 없어요.';
  if (videos > 0) return cap.publishVideo ? null : '영상은 올릴 수 없어요.';
  if (!cap.publishImage) return '사진은 올릴 수 없어요.';
  if (images > 1 && !cap.publishCarousel) return '사진은 한 장만 올릴 수 있어요.';
  if (images > cap.maxMediaCount) return `사진은 ${cap.maxMediaCount}장까지 올릴 수 있어요.`;
  return null;
}

export interface SnsVideoFacts {
  bytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
}

export interface SnsVideoRules {
  maxBytes: number;
  minSec: number;
  maxSec: number;
  aspectMin: number;
  aspectMax: number;
  maxWidth: number | null;
  codecs: readonly string[] | null;
}

function secText(sec: number): string {
  return sec >= 60 && sec % 60 === 0 ? `${sec / 60}분` : `${sec}초`;
}
function bytesText(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024}GB` : `${Math.floor(mb)}MB`;
}
function ratioText(r: number): string {
  return r >= 1 ? `${Math.round(r * 100) / 100}:1` : `1:${Math.round((1 / r) * 100) / 100}`;
}
function codecNames(codecs: readonly string[]): string {
  const names: string[] = [];
  if (codecs.some((c) => c === 'avc1' || c === 'avc3')) names.push('H.264');
  if (codecs.some((c) => c === 'hvc1' || c === 'hev1')) names.push('HEVC');
  return names.join(' 또는 ');
}

/**
 * 이 영상을 이 채널이 받는가. **확인된 위반만 막는다**(불변 22) — 판독이 못 읽은 값(null)은 통과시킨다.
 * 사유는 사람에게 그대로 보여 줄 한 문장이다.
 */
export function planSnsVideoFit(v: SnsVideoFacts, spec: SnsVideoRules | null): { accepted: boolean; notice: string } {
  if (!spec) return { accepted: false, notice: '영상은 올릴 수 없어요.' };
  if (v.bytes > spec.maxBytes) return { accepted: false, notice: `영상이 너무 커요. ${bytesText(spec.maxBytes)} 이하로 올려 주세요.` };
  if (v.durationSec !== null && v.durationSec < spec.minSec) {
    return { accepted: false, notice: `영상이 너무 짧아요. ${secText(spec.minSec)} 이상이어야 해요.` };
  }
  if (v.durationSec !== null && v.durationSec > spec.maxSec) {
    return { accepted: false, notice: `영상이 너무 길어요. ${secText(spec.maxSec)}까지 올릴 수 있어요.` };
  }
  if (spec.codecs && v.videoCodec !== null && !spec.codecs.includes(v.videoCodec)) {
    return { accepted: false, notice: `받지 않는 영상 형식이에요. ${codecNames(spec.codecs)}로 내보낸 영상을 올려 주세요.` };
  }
  if (spec.maxWidth !== null && v.width !== null && v.width > spec.maxWidth) {
    return { accepted: false, notice: `가로 ${spec.maxWidth}px 이하로 내보낸 영상만 올릴 수 있어요.` };
  }
  const aspect = aspectOf(v.width, v.height);
  if (aspect !== null && (aspect < spec.aspectMin || aspect > spec.aspectMax)) {
    return { accepted: false, notice: `화면 비율이 받는 범위(${ratioText(spec.aspectMin)}~${ratioText(spec.aspectMax)})를 벗어났어요.` };
  }
  return { accepted: true, notice: '' };
}
