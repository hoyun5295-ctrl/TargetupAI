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
