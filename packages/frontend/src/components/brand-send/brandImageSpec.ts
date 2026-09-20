/**
 * brandImageSpec — 브랜드메시지 발송 이미지 규격표 · 판정 · 자동 맞춤 (★ 2026-09-20 신설)
 *
 * 왜 있나
 *   발송 창은 이미지 자리가 7종인데 규격 안내가 「jpg·png · 2MB」 한 줄뿐이었고, 규격 밖 이미지는
 *   발송 직전 카카오 업로드에서야 거절됐다(0920 캐러셀 피드 실측). 고객은 무엇을 어떻게 맞춰야 하는지 알 수 없었다.
 *   규격을 **한 곳**에 두고, 고르는 순간 실제 크기를 재서 알려 주고, 원하면 맞춰 준다.
 *
 * 규격 출처 = 중계사 Agent 매뉴얼 v2.3.1 「친구톡 이미지 공통 규격」·「아이템 이미지 규격」·
 *   「프리미엄 동영상 썸네일 이미지 규격」·「캐러셀 인트로 이미지 규격」.
 *   와이드 리스트의 1번 2:1 · 나머지 1:1은 템플릿 등록 화면(BrandTemplateForm)과 같은 기준이다.
 * ⛔ 카카오 한도는 5MB지만 **우리 업로드 한도가 2MB**(routes/assets.ts)라 화면은 2MB로 안내한다.
 * ⛔ 여기 판정은 미리 막아 주는 거울이다 — 최종 판정자는 발송 직전 카카오 업로드다(brand-image-resolver).
 */

export type BrandImageSlotKind = 'main' | 'wideItemFirst' | 'wideItem' | 'carousel';

export interface BrandImageRule {
  /** 가로 최소(px) */
  minWidth: number;
  /** 가로÷세로 허용 범위 */
  ratioMin: number;
  ratioMax: number;
  /** 화면에 보여 줄 비율 표기 */
  ratioText: string;
  /** 권장 크기 표기 */
  recommend: string;
  /** 자동 맞춤 결과의 가로 상한(px) — 이보다 크면 줄이고, 작으면 키우지 않는다 */
  fitWidth: number;
}

export const BRAND_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIMES = ['image/jpeg', 'image/png'];

export const BRAND_IMAGE_RULES: Record<BrandImageSlotKind, BrandImageRule> = {
  // 이미지 · 와이드 · 커머스 · 동영상 썸네일
  main: { minWidth: 500, ratioMin: 0.75, ratioMax: 2, ratioText: '2:1 ~ 3:4', recommend: '800×400', fitWidth: 800 },
  // 와이드 리스트 1번(대표)
  wideItemFirst: { minWidth: 400, ratioMin: 2, ratioMax: 2, ratioText: '2:1', recommend: '800×400', fitWidth: 800 },
  // 와이드 리스트 2번 이후
  wideItem: { minWidth: 400, ratioMin: 1, ratioMax: 1, ratioText: '1:1', recommend: '400×400', fitWidth: 400 },
  // 캐러셀 카드 · 인트로 — 카드끼리 비율이 같아야 한다(matchRatio로 받는다)
  carousel: { minWidth: 500, ratioMin: 0.75, ratioMax: 2, ratioText: '2:1 ~ 3:4', recommend: '800×600 또는 800×400', fitWidth: 800 },
};

/** 비율 비교 허용 오차(1%) — 801×400 같은 반올림 차이는 같은 비율로 본다 */
const RATIO_TOLERANCE = 0.01;
export const sameRatio = (a: number, b: number): boolean => Math.abs(a - b) / b <= RATIO_TOLERANCE;

export interface BrandImageFacts { width: number; height: number; bytes: number; mime: string }

/** 자리 아래에 늘 보이는 규격 한 줄 */
export function brandImageHint(kind: BrandImageSlotKind, matchRatio?: number | null): string {
  const r = BRAND_IMAGE_RULES[kind];
  const ratio = matchRatio ? '첫 이미지와 같은 비율' : `비율 ${r.ratioText}`;
  return `jpg·png · 2MB 이하 · 가로 ${r.minWidth}px 이상 · ${ratio} (권장 ${r.recommend})`;
}

/** 경고 창에 보여 줄 규격 목록 */
export function brandImageSpecLines(kind: BrandImageSlotKind, matchRatio?: number | null): { label: string; value: string }[] {
  const r = BRAND_IMAGE_RULES[kind];
  return [
    { label: '형식', value: 'jpg · png' },
    { label: '용량', value: '2MB 이하' },
    { label: '가로', value: `${r.minWidth}px 이상` },
    { label: '비율', value: matchRatio ? `첫 이미지와 같은 비율 (${ratioLabel(matchRatio)})` : r.ratioText },
    { label: '권장', value: r.recommend },
  ];
}

/** 1.333 → '4:3' 같은 읽기 쉬운 표기. 딱 떨어지지 않으면 소수 둘째 자리까지 */
export function ratioLabel(ratio: number): string {
  const known: [number, string][] = [[2, '2:1'], [16 / 9, '16:9'], [1.5, '3:2'], [4 / 3, '4:3'], [1, '1:1'], [0.75, '3:4']];
  const hit = known.find(([v]) => sameRatio(ratio, v));
  return hit ? hit[1] : `${ratio.toFixed(2)}:1`;
}

export const formatBytes = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;

/** 파일명 확장자로 형식을 짐작한다 — 라이브러리 자산은 mime을 들고 오지 않는다 */
export function mimeFromName(name: string): string {
  const ext = (String(name || '').split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return '';
}

export interface BrandImageViolation { key: 'format' | 'bytes' | 'width' | 'ratio'; text: string }

/**
 * 규격 판정 — 어긋난 항목을 전부 돌려준다(빈 배열 = 통과).
 * 형식을 모르는 경우(mime 빈 값)는 형식 위반으로 치지 않는다 — 모르는 것을 틀렸다고 말하지 않는다.
 */
export function judgeBrandImage(kind: BrandImageSlotKind, f: BrandImageFacts, matchRatio?: number | null): BrandImageViolation[] {
  const r = BRAND_IMAGE_RULES[kind];
  const out: BrandImageViolation[] = [];
  if (f.mime && !ALLOWED_MIMES.includes(f.mime)) out.push({ key: 'format', text: 'jpg·png 형식이 아닙니다' });
  if (f.bytes > BRAND_IMAGE_MAX_BYTES) out.push({ key: 'bytes', text: `용량이 2MB를 넘습니다 (${formatBytes(f.bytes)})` });
  if (f.width < r.minWidth) out.push({ key: 'width', text: `가로가 ${r.minWidth}px보다 작습니다 (${f.width}px)` });
  const ratio = f.width / f.height;
  if (matchRatio) {
    if (!sameRatio(ratio, matchRatio)) out.push({ key: 'ratio', text: `첫 이미지와 비율이 다릅니다 (첫 이미지 ${ratioLabel(matchRatio)} · 이 이미지 ${ratioLabel(ratio)})` });
  } else if (ratio < r.ratioMin * (1 - RATIO_TOLERANCE) || ratio > r.ratioMax * (1 + RATIO_TOLERANCE)) {
    out.push({ key: 'ratio', text: `비율이 ${r.ratioText} 범위 밖입니다 (${ratioLabel(ratio)})` });
  }
  return out;
}

export interface BrandImageFitPlan { sx: number; sy: number; sw: number; sh: number; outW: number; outH: number }

/**
 * 자동 맞춤 계획 — 가운데를 기준으로 비율에 맞게 자르고, 가로가 fitWidth보다 크면 줄인다.
 * **키우지는 않는다**(작은 이미지를 늘리면 흐려진 채로 고객에게 나간다) — 잘라 낸 가로가 최소 가로보다 작으면 null.
 */
export function planBrandImageFit(kind: BrandImageSlotKind, width: number, height: number, matchRatio?: number | null): BrandImageFitPlan | null {
  const r = BRAND_IMAGE_RULES[kind];
  if (!(width > 0 && height > 0)) return null;
  const ratio = width / height;
  const target = matchRatio || Math.min(r.ratioMax, Math.max(r.ratioMin, ratio));
  let sw = width;
  let sh = height;
  if (ratio > target) sw = Math.round(height * target);      // 너무 넓다 → 양옆을 자른다
  else if (ratio < target) sh = Math.round(width / target);  // 너무 길다 → 위아래를 자른다
  if (sw < r.minWidth) return null;
  const outW = Math.min(sw, r.fitWidth);
  const outH = Math.round(outW / target);
  return { sx: Math.round((width - sw) / 2), sy: Math.round((height - sh) / 2), sw, sh, outW, outH };
}

/** 이미지 주소(자산 URL · object URL)의 실제 크기를 잰다 */
export function measureImage(src: string): Promise<{ width: number; height: number; el: HTMLImageElement }> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve({ width: el.naturalWidth, height: el.naturalHeight, el });
    el.onerror = () => reject(new Error('이미지를 읽지 못했습니다. 다른 이미지를 선택해 주세요.'));
    el.src = src;
  });
}

/** 캔버스를 파일로 — 브라우저가 거부하면(다른 출처 이미지 등) 예외 원문을 올리지 않고 null로 돌려준다 */
const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> =>
  new Promise((resolve) => {
    try { canvas.toBlob(resolve, type, quality); } catch { resolve(null); }
  });

/**
 * 자동 맞춤 실행 — 계획대로 잘라 새 파일을 만든다. 원본은 건드리지 않는다.
 * png는 png로 두되 2MB를 넘으면 jpg로 바꾼다. 그 밖은 흰 바탕 jpg(투명 영역이 검게 나오지 않게).
 */
export async function renderBrandImageFit(el: HTMLImageElement, plan: BrandImageFitPlan, sourceName: string, sourceMime: string): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = plan.outW;
  canvas.height = plan.outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지를 맞추지 못했습니다. 다른 이미지를 선택해 주세요.');
  const base = (String(sourceName || 'image').split(/[?#]/)[0].split('/').pop() || 'image').replace(/\.[^.]+$/, '') || 'image';
  const draw = () => ctx.drawImage(el, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, plan.outW, plan.outH);

  if (sourceMime === 'image/png') {
    draw();
    const png = await toBlob(canvas, 'image/png');
    if (png && png.size <= BRAND_IMAGE_MAX_BYTES) return new File([png], `${base}-fit.png`, { type: 'image/png' });
    ctx.clearRect(0, 0, plan.outW, plan.outH);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, plan.outW, plan.outH);
  draw();
  for (const q of [0.92, 0.8, 0.65]) {
    const jpg = await toBlob(canvas, 'image/jpeg', q);
    if (jpg && jpg.size <= BRAND_IMAGE_MAX_BYTES) return new File([jpg], `${base}-fit.jpg`, { type: 'image/jpeg' });
  }
  throw new Error('이미지를 규격에 맞추지 못했습니다. 다른 이미지를 선택해 주세요.');
}
