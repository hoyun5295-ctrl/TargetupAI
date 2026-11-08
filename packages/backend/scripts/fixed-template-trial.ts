/**
 * 고정 템플릿 시험 — 「원본 그림 한 장 + 칸만 바꾸기」가 디자인을 지키는지(2026-11-08 · Harold 「맞아, 시험부터」)
 *
 * 접수(1108 Harold): 할인 · 행사 템플릿 = 디자인이 고정된 완성 포스터 · 정해진 칸(글 · 제품 사진)만 바뀐다 · 할인율 = 자동.
 *   리아데이형(행사명 · 날짜 · 상품명 · 정가 빗금 → 판매가 · 자동 % 배지 · 제품) · 레고형(최대 % · 할인 종류 · 기간 · 제품).
 * 방식 C = 원본(AI 로 한 번) → 쓸 때마다 OpenAI 수정 끝점에 [원본, 제품 누끼] 두 장 + CHANGE / PRESERVE / CONSTRAINTS 지시.
 *   지시 꼴 = 외부 스킬 image-prompting(BlockRunAI)의 편집 규칙(바꿀 것 · 지킬 것 · 금지)을 옮김(설치 0).
 *
 * ⛔ 운영 코드 변경 0 · 크레딧 · DB 무관 · 일회성 시험 스크립트(채택되면 운영 CT 로 다시 만든다).
 *   ponytail: OpenAI 수정 호출을 이 파일 안에 짧게 둔다(운영 callOpenAIImage 는 사진 여러 장을 받지만 내보내지 않음) · 채택 때 운영 함수 하나로.
 * 비용 = 원본 2 + 편집 6 = 8장 · 장당 약 $0.067 · 산출 /tmp/fixed-template-trial(그림 + 쓴 지시문 .txt).
 *
 * 실행: cd packages/backend && /usr/bin/ts-node -T scripts/fixed-template-trial.ts [--dry]
 *   --dry = 지시문만 /tmp/fixed-template-trial 에 쓴다(AI 0 · 키 불필요)
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  resolvePreset, generatePoster, groupProductCutouts, openaiImageSize, OPENAI_IMAGE_MODEL,
} from '../src/utils/image-studio';
import { discountRate, wonText } from '../src/utils/studio-discount';

const OUT = '/tmp/fixed-template-trial';
const CUTS = path.join(__dirname, '../assets/inapp-examples');
const DRY = process.argv.includes('--dry');
const preset = resolvePreset('poster');

type PicData = { base64: string; mime: string };

/** 리아데이형 칸(글 4 · 자동 % · 제품) */
interface PriceDaySlots { title: string; date: string; name: string; before: number; sale: number; products: string[] }
/** 레고형 칸(% · 할인 종류 · 기간 · 제품) */
interface PercentSlots { pct: number; what: string; period: string; products: string[] }

const PRICE_DAY_MASTER: PriceDaySlots = { title: '금요일은 한줄데이!', date: '11.14 (금) 10am - 10pm', name: '오후담 크림 라떼', before: 6500, sale: 4900, products: ['cut-ohudam.png'] };
const PRICE_DAY_EDITS: PriceDaySlots[] = [
  { title: '주말엔 뷰티데이!', date: '11.22 (토) ~ 11.23 (일)', name: '결온 앰버 세럼', before: 38000, sale: 29900, products: ['cut-kyeolon.png'] },
  { title: '니트 위크 특가!', date: '11.24 (월) ~ 11.30 (일)', name: '소요 울 케이블 니트', before: 129000, sale: 89000, products: ['cut-soyo.png'] },
  { title: '목요일은 세트데이!', date: '11.27 (목) 10am - 10pm', name: '앰버 세럼 + 크림 라떼', before: 44500, sale: 33000, products: ['cut-kyeolon.png', 'cut-ohudam.png'] },
];
const PERCENT_MASTER: PercentSlots = { pct: 30, what: '겨울 니트 할인', period: '11.10 (월) ~ 11.16 (일)', products: ['cut-soyo.png'] };
const PERCENT_EDITS: PercentSlots[] = [
  { pct: 50, what: '뷰티 세럼 할인', period: '12.1 (월) ~ 12.7 (일)', products: ['cut-kyeolon.png'] },
  { pct: 20, what: '카페 음료 할인', period: '11.20 (목) ~ 11.23 (일)', products: ['cut-ohudam.png'] },
  { pct: 40, what: '연말 선물 할인', period: '12.15 (월) ~ 12.25 (목)', products: ['cut-soyo.png', 'cut-kyeolon.png'] },
];

const rateOf = (s: PriceDaySlots): number => {
  const r = discountRate(s.before, s.sale);
  if (r === null) throw new Error(`할인율 없음: ${s.before} → ${s.sale}`);
  return r;
};

const COMMON_CONSTRAINTS = 'CONSTRAINTS: Render every number exactly as given, digit by digit, including the commas, the % sign and the "원" unit. Use ONLY the text given above, each piece exactly once. No extra words, no duplicate text, no logos, no watermark. Polished native-quality Korean typography with correct spelling.';

// ── 원본(템플릿) 지시 — 디자인을 정하는 단 한 번 ────────────────────────────
function priceDayMasterPrompt(s: PriceDaySlots): string {
  return [
    'A finished Korean food-court style promotional poster, portrait 3:4, flat graphic design (not a photo scene).',
    'SCENE: a solid deep navy background (#14213d) with a soft circular spotlight glow behind the product, a subtle darker vignette at the edges, no other props.',
    'SUBJECT: the attached product photo (transparent background) placed large in the center of the poster on the spotlight, preserved EXACTLY as provided (shape, colors, label text), with a soft ground shadow.',
    'LAYOUT, top to bottom:',
    `- HEADLINE (EXACT TEXT, top, centered, the biggest text, heavy rounded Korean display font in warm yellow #ffc83d): "${s.title}"`,
    `- DATE LINE (EXACT TEXT, under the headline, centered, bold white sans): "${s.date}"`,
    '- the product in the middle.',
    `- RATE BADGE: a solid yellow (#ffc83d) circle overlapping the lower right of the product, inside it in heavy dark navy two lines: "${rateOf(s)}%" large and "할인" smaller.`,
    `- PRODUCT NAME (EXACT TEXT, under the product, centered, heavy white Korean font): "${s.name}"`,
    `- PRICE ROW (bottom, centered, one row): the original price "${wonText(s.before)}" in light gray with one diagonal strike line through it, then the sale price "${wonText(s.sale)}" in very large heavy yellow (#ffc83d) digits with a smaller "원".`,
    'Typography must be LARGE for phone screens: headline about 9% of the poster height, sale price about 10%.',
    COMMON_CONSTRAINTS,
  ].join('\n');
}

function percentMasterPrompt(s: PercentSlots): string {
  return [
    'A finished Korean retail sale poster, portrait 3:4, bold flat graphic design (not a photo scene).',
    'SCENE: a vivid coral-red background (#ff4b3e) with subtle radial sunburst rays from the center, a few small cream and yellow confetti pieces near the top corners, and a round cream podium at the bottom center.',
    'SUBJECT: the attached product photo (transparent background) standing on the podium at the bottom center, preserved EXACTLY as provided (shape, colors, label text), with a soft shadow on the podium.',
    'LAYOUT, top to bottom:',
    '- a small white rounded tag reading exactly "최대" at the upper left of the big number.',
    `- BIG NUMBER (EXACT TEXT, the dominant element, about 30% of the poster height): "${s.pct}%" as giant 3D extruded cream-yellow (#ffe7a3) digits with a thick dark brown (#3b1f14) outline and a deep drop shadow, the % sign slightly smaller.`,
    `- SALE TYPE (EXACT TEXT, directly under the number, heavy white Korean display font with a thick dark brown outline): "${s.what}"`,
    `- PERIOD (EXACT TEXT, under the sale type, dark brown bold text inside one white rounded pill): "${s.period}"`,
    '- the product on the podium in the lower third.',
    COMMON_CONSTRAINTS,
  ].join('\n');
}

// ── 편집 지시 — 칸만 바꾸고 나머지는 그대로 ──────────────────────────────
function editPrompt(changes: string[], productCount: number): string {
  return [
    'The FIRST attached image is a finished poster template. The SECOND attached image is a product photo with a transparent background.',
    'Edit the FIRST image, changing ONLY the elements listed under CHANGE.',
    'CHANGE:',
    ...changes.map((c) => `- ${c}`),
    `- PRODUCT: remove the product currently shown in the template and put ${productCount >= 2 ? `the ${productCount} products from the SECOND image, together as one group in their given order,` : 'the product from the SECOND image'} in exactly the same spot at a similar overall size. Preserve the new product EXACTLY as provided (shape, proportions, colors, packaging, label text), with lighting and a soft shadow matching the template.`,
    'Every replaced text keeps exactly the same font, weight, color, outline, 3D effect, alignment and position as the text it replaces. If a new text is longer, scale it down slightly so it fits the same area. None of the old replaced text may remain anywhere.',
    'PRESERVE: the background, colors, decorations, badge and pill shapes, layout and every element not listed under CHANGE exactly as in the FIRST image, including any fixed template words that are not listed (for example a small tag or a word under a number). Same aspect ratio and framing.',
    // 원본 지시의 「위에 준 글만」은 쓰지 않는다 — 편집에서는 목록에 없는 원본 고정 글(최대 · 할인)까지 지우라는 뜻이 된다
    'CONSTRAINTS: Render every number exactly as given, digit by digit, including the commas, the % sign and the "원" unit. Do not add any new text beyond the replacements above, each replacement appears exactly once. No duplicate text, no logos, no watermark. Polished native-quality Korean typography with correct spelling.',
  ].join('\n');
}

function priceDayChanges(from: PriceDaySlots, to: PriceDaySlots): string[] {
  return [
    `HEADLINE: replace "${from.title}" with "${to.title}" (EXACT TEXT)`,
    `DATE LINE: replace "${from.date}" with "${to.date}" (EXACT TEXT)`,
    `PRODUCT NAME: replace "${from.name}" with "${to.name}" (EXACT TEXT)`,
    `ORIGINAL PRICE with the strike line: replace "${wonText(from.before)}" with "${wonText(to.before)}" (EXACT TEXT, keep the strike line)`,
    `SALE PRICE: replace "${wonText(from.sale)}" with "${wonText(to.sale)}" (EXACT TEXT)`,
    `RATE BADGE: replace "${rateOf(from)}%" with "${rateOf(to)}%" (EXACT TEXT, keep "할인" under it)`,
  ];
}

function percentChanges(from: PercentSlots, to: PercentSlots): string[] {
  return [
    `BIG NUMBER: replace "${from.pct}%" with "${to.pct}%" (EXACT TEXT, same 3D extruded style)`,
    `SALE TYPE: replace "${from.what}" with "${to.what}" (EXACT TEXT)`,
    `PERIOD: replace "${from.period}" with "${to.period}" (EXACT TEXT)`,
  ];
}

// ── 그림 ────────────────────────────────────────────────────────────────
async function productImage(files: string[]): Promise<PicData> {
  const abs = files.map((f) => path.join(CUTS, f));
  if (abs.length >= 2) return groupProductCutouts(abs);
  return { base64: fs.readFileSync(abs[0]).toString('base64'), mime: 'image/png' };
}

/** OpenAI 수정 끝점 · 사진 여러 장(운영 callOpenAIImage 와 같은 형식) — 키 값은 출력하지 않는다 */
async function openaiEdit(prompt: string, images: PicData[]): Promise<PicData> {
  const key = process.env.OPENAI_API_KEY || '';
  if (!key) throw new Error('OPENAI_API_KEY 없음');
  const form = new FormData();
  form.append('model', OPENAI_IMAGE_MODEL);
  form.append('prompt', prompt);
  form.append('size', openaiImageSize(preset.aspectRatio, '2K'));
  form.append('quality', 'high');
  form.append('output_format', 'jpeg');
  images.forEach((img, i) => form.append('image[]', new Blob([Buffer.from(img.base64, 'base64')], { type: img.mime }), `input-${i}.${img.mime.includes('png') ? 'png' : 'jpg'}`));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 180_000);
  try {
    const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: ac.signal });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${JSON.stringify(json?.error?.message ?? json).slice(0, 300)}`);
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI 응답에 그림 없음');
    return { base64: b64, mime: 'image/jpeg' };
  } finally {
    clearTimeout(timer);
  }
}

function save(name: string, img: PicData | null, prompt: string): void {
  fs.writeFileSync(path.join(OUT, `${name}.txt`), prompt);
  if (img) fs.writeFileSync(path.join(OUT, `${name}.jpg`), Buffer.from(img.base64, 'base64'));
  console.log(`${name}${img ? ' 저장' : ' 지시문만'}`);
}

async function runSet<T extends { products: string[] }>(
  key: string, master: T, edits: T[], masterPrompt: (s: T) => string, changes: (a: T, b: T) => string[],
): Promise<void> {
  const mp = masterPrompt(master);
  let base: PicData | null = null;
  if (!DRY) {
    const t0 = Date.now();
    const g = await generatePoster(mp, preset, await productImage(master.products), { engine: 'openai' });
    base = { base64: g.base64, mime: g.mime };
    console.log(`${key} 원본 ${Math.round((Date.now() - t0) / 1000)}초 · 엔진 ${(g as any).engine || '?'}`);
  }
  save(`${key}-0-master`, base, mp);
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    const ep = editPrompt(changes(master, e), e.products.length);
    let out: PicData | null = null;
    if (base) {
      const t0 = Date.now();
      try {
        out = await openaiEdit(ep, [base, await productImage(e.products)]);
        console.log(`${key} 편집 ${i + 1} ${Math.round((Date.now() - t0) / 1000)}초`);
      } catch (err: any) {
        console.log(`${key} 편집 ${i + 1} 실패: ${err?.message || err}`);
      }
    }
    save(`${key}-${i + 1}-edit`, out, ep);
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`${DRY ? '지시문만(--dry)' : `모델 ${OPENAI_IMAGE_MODEL} · 8장`} → ${OUT}`);
  await runSet('A-priceday', PRICE_DAY_MASTER, PRICE_DAY_EDITS, priceDayMasterPrompt, priceDayChanges);
  await runSet('B-percent', PERCENT_MASTER, PERCENT_EDITS, percentMasterPrompt, percentChanges);
  console.log('끝');
}

main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
