/**
 * dm-catalog-templates.ts — 카탈로그 쪽 템플릿 4종(순수 · DB·sharp·파이썬 0)
 *
 * ★ 2026-09-16 (Harold 승인 · 목업 탭1) 완성된 쪽 이미지가 없는 고객도 카탈로그 DM 을 만들 수 있게,
 *   "자리(슬롯)"만 정해 두고 서버가 그 자리에 사진과 글자를 얹어 쪽 이미지 1장으로 합성한다.
 *   합성 결과가 이미지 1장짜리 장이라 뷰어 자격(dm-slides-expand isSwipeImagePage · 갤러리 1장)을 그대로 통과한다.
 *
 * 소유(한 곳) : 템플릿 정의 · 자리 좌표 · 줄 나눔 · 합성기 글자 항목. 합성 실행(sharp·파이썬·저장)은 호출부.
 * 소비처 = 편집기 "템플릿으로 만들기" · AI 자동제작 카탈로그 채널(단계 3·4에서 합류).
 *
 * ⚠ 파이썬 합성기(image_studio_service _draw_typography)는 **한 항목에 한 줄**만 찍는다(줄바꿈 기능 없음).
 *   그래서 줄 나눔·말줄임을 여기서 계산해 줄마다 항목 하나로 낸다.
 * ⚠ 숫자(가격·할인율)는 이미지에 새기지 않는다 — 값이 바뀌면 이미지가 거짓말을 한다. 수치는 DM 이 글자로 싣는다.
 */

/** 쪽 규격 = 3:4 (아웃리치 카탈로그 카드와 같은 캔버스) */
export const CATALOG_PAGE = { width: 1200, height: 1600 } as const;

export type CatalogTemplateKey = 'cover' | 'one' | 'duo' | 'end';
export type CatalogTextKey = 'title' | 'desc' | 'label1' | 'label2';

/** 이미지 자리(0~1 비율 · 왼쪽 위 기준) */
export interface CatalogImageSlot { x: number; y: number; w: number; h: number; fit: 'cover' | 'contain' }

/** 글자 자리. size·lineGap 은 쪽 높이 대비 비율(파이썬 합성기 규약과 같다) */
export interface CatalogTextBlock {
  key: CatalogTextKey;
  x: number; y: number;
  size: number; lineGap: number;
  color: string;
  align: 'left' | 'center' | 'right';
  weight: 'bold' | 'regular';
  effect: 'plain' | 'shadow';
  maxLines: number;
  /** 글자가 차지할 수 있는 최대 폭(쪽 폭 대비 비율) */
  maxWidth: number;
}

export interface CatalogTemplate {
  key: CatalogTemplateKey;
  name: string;
  /** tint = 브랜드색 옅은 바탕 · photo = 사진이 쪽 전체 */
  background: 'tint' | 'photo';
  /** 사진 위 글자를 읽히게 하는 아래쪽 어둠(표지 전용) */
  veil: boolean;
  images: CatalogImageSlot[];
  texts: CatalogTextBlock[];
}

/** 합성기에 넘길 글자 항목(ComposeTypography 와 같은 모양 · 순수 모듈이라 타입만 따로 둔다) */
export interface CatalogTypographyItem {
  text: string;
  fontPath: string | null;
  size: number;
  color: string;
  align: 'left' | 'center' | 'right';
  x: number; y: number;
  weight: 'bold' | 'regular';
  effect: 'plain' | 'shadow';
}

const INK = '#111111';
const SUB = '#4b5563';

export const CATALOG_TEMPLATES: readonly CatalogTemplate[] = [
  {
    key: 'cover', name: '표지', background: 'photo', veil: true,
    images: [{ x: 0, y: 0, w: 1, h: 1, fit: 'cover' }],
    texts: [
      { key: 'title', x: 0.08, y: 0.76, size: 0.062, lineGap: 0.074, color: '#ffffff', align: 'left', weight: 'bold', effect: 'shadow', maxLines: 2, maxWidth: 0.84 },
      { key: 'desc', x: 0.08, y: 0.90, size: 0.030, lineGap: 0.040, color: '#ffffff', align: 'left', weight: 'regular', effect: 'shadow', maxLines: 1, maxWidth: 0.84 },
    ],
  },
  {
    key: 'one', name: '상품 한 점', background: 'tint', veil: false,
    images: [{ x: 0.10, y: 0.08, w: 0.80, h: 0.56, fit: 'contain' }],
    texts: [
      { key: 'title', x: 0.5, y: 0.70, size: 0.042, lineGap: 0.052, color: INK, align: 'center', weight: 'bold', effect: 'plain', maxLines: 1, maxWidth: 0.84 },
      { key: 'desc', x: 0.5, y: 0.775, size: 0.028, lineGap: 0.038, color: SUB, align: 'center', weight: 'regular', effect: 'plain', maxLines: 2, maxWidth: 0.84 },
    ],
  },
  {
    key: 'duo', name: '두 점 비교', background: 'tint', veil: false,
    images: [
      { x: 0.07, y: 0.09, w: 0.86, h: 0.33, fit: 'cover' },
      { x: 0.07, y: 0.53, w: 0.86, h: 0.33, fit: 'cover' },
    ],
    texts: [
      { key: 'label1', x: 0.5, y: 0.445, size: 0.028, lineGap: 0.036, color: INK, align: 'center', weight: 'bold', effect: 'plain', maxLines: 1, maxWidth: 0.84 },
      { key: 'label2', x: 0.5, y: 0.885, size: 0.028, lineGap: 0.036, color: INK, align: 'center', weight: 'bold', effect: 'plain', maxLines: 1, maxWidth: 0.84 },
    ],
  },
  {
    key: 'end', name: '마무리 안내', background: 'tint', veil: false,
    images: [],
    texts: [
      { key: 'title', x: 0.5, y: 0.40, size: 0.050, lineGap: 0.062, color: INK, align: 'center', weight: 'bold', effect: 'plain', maxLines: 2, maxWidth: 0.80 },
      { key: 'desc', x: 0.5, y: 0.55, size: 0.028, lineGap: 0.038, color: SUB, align: 'center', weight: 'regular', effect: 'plain', maxLines: 3, maxWidth: 0.80 },
    ],
  },
] as const;

/** 키 → 템플릿. 모르는 키는 상품 한 점(가장 흔한 쪽)으로 떨어진다 */
export function catalogTemplateOf(key: CatalogTemplateKey): CatalogTemplate {
  return CATALOG_TEMPLATES.find((t) => t.key === key) || CATALOG_TEMPLATES[1];
}

/** 이미지 자리 → 픽셀 사각형(캔버스를 넘지 않게 자른다) */
export function imageSlotPx(slot: CatalogImageSlot): { left: number; top: number; width: number; height: number } {
  const left = Math.round(slot.x * CATALOG_PAGE.width);
  const top = Math.round(slot.y * CATALOG_PAGE.height);
  const width = Math.min(Math.round(slot.w * CATALOG_PAGE.width), CATALOG_PAGE.width - left);
  const height = Math.min(Math.round(slot.h * CATALOG_PAGE.height), CATALOG_PAGE.height - top);
  return { left, top, width, height };
}

/**
 * 글자 한 칸이 차지하는 폭(글자 크기 1 기준 배수).
 * 한글·한자·전각은 한 칸, 영문·숫자는 좁다. 실제 폰트 실측이 아니라 **줄 나눔을 정하기 위한 근사**다.
 */
function charEm(ch: string): number {
  if (ch === ' ') return 0.32;
  const c = ch.codePointAt(0) || 0;
  if (c >= 0xac00 && c <= 0xd7a3) return 1;       // 한글 음절
  if (c >= 0x1100 && c <= 0x11ff) return 1;       // 한글 자모
  if (c >= 0x3000 && c <= 0x9fff) return 1;       // CJK·한중일 기호
  if (c >= 0xf900 && c <= 0xfaff) return 1;
  if (c >= 0xff00 && c <= 0xff60) return 1;       // 전각
  if (ch >= '0' && ch <= '9') return 0.58;
  if (ch >= 'A' && ch <= 'Z') return 0.66;
  if (ch >= 'a' && ch <= 'z') return 0.52;
  return 0.45;
}

function emWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charEm(ch);
  return w;
}

type WrapBlock = { maxWidth: number; size: number; maxLines: number };

/** 한 줄에 들어갈 수 있는 글자 폭(글자 크기 배수). size·maxWidth 가 기준이 다르므로(높이·폭) 여기서 환산한다 */
function maxEmOf(block: WrapBlock): number {
  const px = block.maxWidth * CATALOG_PAGE.width;
  const em = Math.max(1, block.size * CATALOG_PAGE.height);
  return px / em;
}

function hardSplit(word: string, maxEm: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of word) {
    if (cur && emWidth(cur + ch) > maxEm) { out.push(cur); cur = ch; } else { cur += ch; }
  }
  if (cur) out.push(cur);
  return out;
}

/** 마지막 줄을 말줄임으로 끝낸다(들어갈 때까지 글자를 뺀다) */
function ellipsize(line: string, maxEm: number): string {
  let s = line.trimEnd();
  while (s && emWidth(s + '…') > maxEm) s = Array.from(s).slice(0, -1).join('').trimEnd();
  return s + '…';
}

/**
 * 글자 → 줄 배열. 줄바꿈 문자는 그 자리에서 나누고, 길면 띄어쓰기에서, 띄어쓰기가 없으면 글자에서 자른다.
 * 줄 수 상한을 넘으면 마지막 줄을 말줄임으로 끝낸다. 빈 값이면 빈 배열(= 합성기 항목을 만들지 않는다).
 */
export function wrapCatalogText(text: string | null | undefined, block: WrapBlock): string[] {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  const maxEm = maxEmOf(block);
  const lines: string[] = [];
  for (const para of raw.split(/\r?\n/)) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    let cur = '';
    for (const w of words) {
      const pieces = emWidth(w) > maxEm ? hardSplit(w, maxEm) : [w];
      for (const piece of pieces) {
        const next = cur ? `${cur} ${piece}` : piece;
        if (cur && emWidth(next) > maxEm) { lines.push(cur); cur = piece; } else { cur = next; }
      }
    }
    if (cur) lines.push(cur);
  }
  if (lines.length <= block.maxLines) return lines;
  const kept = lines.slice(0, block.maxLines);
  kept[kept.length - 1] = ellipsize(kept[kept.length - 1], maxEm);
  return kept;
}

/** 템플릿 글자 값 (자리에 없는 키는 무시된다) */
export type CatalogTextValues = Partial<Record<CatalogTextKey, string | null | undefined>>;

/**
 * 템플릿 + 글자 값 → 합성기 글자 항목(줄마다 하나).
 * 값이 빈 자리는 항목을 만들지 않는다. 글꼴 경로는 그대로 싣는다(한글 폰트 보증 = 호출부).
 */
export function catalogTypographyOf(key: CatalogTemplateKey, values: CatalogTextValues, fontPath: string | null): CatalogTypographyItem[] {
  const tpl = catalogTemplateOf(key);
  const out: CatalogTypographyItem[] = [];
  for (const block of tpl.texts) {
    const lines = wrapCatalogText(values[block.key], block);
    lines.forEach((line, i) => {
      out.push({
        text: line,
        fontPath,
        size: block.size,
        color: block.color,
        align: block.align,
        x: block.x,
        y: block.y + i * block.lineGap,
        weight: block.weight,
        effect: block.effect,
      });
    });
  }
  return out;
}
