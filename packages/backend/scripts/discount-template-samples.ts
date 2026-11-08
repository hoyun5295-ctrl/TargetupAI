/**
 * 할인 템플릿 갤러리 예시 — 로드맵 V2(C114) · ★ 2026-11-08 C119(설계서 docs/2026-11-08-c119-discount-templates-20-design.md D4)
 *
 * ★ C114 = 템플릿은 카탈로그(image-studio-templates-discount.ts) · 숫자 · 틀 줄은 CT(studio-discount.ts) · 프롬프트 = 운영 buildPosterPrompt 그대로.
 * ★ C119 Harold 「브랜드명은 빼 · 제품이 들어가는 공간만 확실하게」 「세트 화장품+의류 말이 되냐」 =
 *   제목 = 카탈로그 sample.title(「상품명」 · 이 파일에 제목 칸 0) · 제품 사진 0 = 고객이 사진 없이 만드는 길 그대로(OpenAI = 빈 진열면) ·
 *   세트 구성 = 「상품 A · 상품 B(· 상품 C)」 · 혜택 값만 템플릿마다 ·
 *   엔진 = OpenAI 고정(서버 기본 엔진 · ENV 무관) · 저장 = 실제 엔진이 openai 인 결과만(대체 Gemini · --both 의 Gemini = 파일만 · Codex 설계 2R ①).
 *   --only id,id = 고른 템플릿만 · --save = 갤러리 예시로 저장 · --dry = 프롬프트만(AI 0 · 키 불필요) · --both = 비교용 Gemini 도.
 *   비용 = 장당 약 $0.067(OpenAI) · 크레딧 · DB 무관 · 산출 /tmp/discount-template-samples.
 *
 * 실행: cd packages/backend && /usr/bin/ts-node -T scripts/discount-template-samples.ts --save [--only id,id] [--both] [--dry]
 */
import 'dotenv/config';
import fs from 'fs';
import {
  resolvePreset, buildPosterPrompt, generatePoster, isStudioReady, saveTemplateSample, type StudioImageEngine,
} from '../src/utils/image-studio';
import { STUDIO_TEMPLATES } from '../src/utils/image-studio-templates';
import { readDiscountOffer, discountDrawnTexts, type DiscountOffer } from '../src/utils/studio-discount';

const OUT = '/tmp/discount-template-samples';
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const BOTH = args.includes('--both');
const SAVE = args.includes('--save');
const onlyAt = args.indexOf('--only');
/** --only 없음 = 전체 · 있음 = id 하나 이상 필수(값 없음 · 빈 목록 = 생성 전에 멈춤 · 전체 덮어쓰기 0 · Codex 구현 1R ①) */
function readOnly(): Set<string> | null {
  if (onlyAt < 0) return null;
  const raw = args[onlyAt + 1];
  const ids = raw && !raw.startsWith('--') ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (ids.length === 0) throw new Error('--only 다음에 템플릿 id 를 쉼표로 넣어 주세요(전체는 --only 를 빼고 실행)');
  return new Set(ids);
}
const ONLY = readOnly();
/** 예시 = OpenAI 로만 저장(Harold 「GPT 로」) */
const SAMPLE_ENGINE: StudioImageEngine = 'openai';

/** 템플릿마다 예시 혜택 값(숫자 = 혜택 꼴이 찍히는 모습 · 세트 구성 = 상품 A · B · C · 브랜드 0) */
const SAMPLE_OFFER: Record<string, Record<string, unknown>> = {
  'discount-price-cream': { before: 38000, sale: 29900 },
  'discount-price-black': { before: 129000, sale: 89000 },
  'discount-price-cafe': { before: 6500, sale: 4900 },
  'discount-nplus-coral': { n: 1, m: 1, unit: 6500 },
  'discount-nplus-sky': { n: 2, m: 1, unit: 38000 },
  'discount-period-navy': { before: 129000, sale: 99000, period: '11.10 ~ 11.16', gift: '사은품' },
  'discount-set-beige': { items: ['상품 A', '상품 B'], prices: [38000, 129000], sale: 139000 },
  'discount-set-white': { items: ['상품 A', '상품 B'], prices: [129000, 6500], sale: 119000 },
  'discount-price-bold-red': { before: 59000, sale: 29900 },
  'discount-price-minimal-white': { before: 45000, sale: 36000 },
  'discount-price-vivid-yellow': { before: 25000, sale: 15900 },
  'discount-price-gradient': { before: 32000, sale: 24900 },
  'discount-period-orange': { before: 39000, sale: 19900, period: '오늘 자정까지' },
  'discount-nplus-neon': { n: 2, m: 1, unit: 12000 },
  'discount-nplus-mint': { n: 1, m: 1, unit: 8900 },
  'discount-nplus-lavender': { n: 1, m: 1, unit: 15000 },
  'discount-nplus-charcoal': { n: 2, m: 1, unit: 19900 },
  'discount-set-black-gold': { items: ['상품 A', '상품 B'], prices: [89000, 45000], sale: 109000 },
  'discount-set-pale-blue': { items: ['상품 A', '상품 B'], prices: [24000, 18000], sale: 35000 },
  'discount-set-sage': { items: ['상품 A', '상품 B', '상품 C'], prices: [18000, 22000, 15000], sale: 45000 },
  'discount-price-basic-gray': { before: 30000, sale: 21000 },
  'discount-price-basic-blue': { before: 50000, sale: 35000 },
  'discount-nplus-basic-white': { n: 1, m: 1, unit: 10000 },
  'discount-set-basic-gray': { items: ['상품 A', '상품 B'], prices: [30000, 20000], sale: 39000 },
};

(async () => {
  const preset = resolvePreset('poster');
  const templates = STUDIO_TEMPLATES.filter((t) => t.kind === 'discount' && (!ONLY || ONLY.has(t.id)));
  if (ONLY) for (const id of ONLY) if (!templates.some((t) => t.id === id)) throw new Error(`--only 에 없는 할인 템플릿: ${id}`);
  const plans = templates.map((t) => {
    const raw = SAMPLE_OFFER[t.id];
    if (!raw) throw new Error(`예시 혜택 값 없음: ${t.id}`);
    const read = readDiscountOffer(raw, t.offer);
    if (!read.ok) throw new Error(`${t.id} 혜택 오류: ${read.field} ${read.error}`);
    const offer: DiscountOffer = read.offer;
    const title = t.sample?.title || '상품명';
    const prompt = buildPosterPrompt({
      template: t, preset, hasProduct: false, productCount: 0,
      texts: { label: t.defaultTexts.label || '', title, subtitle: '' }, offer,
    });
    const expect = [...(t.defaultTexts.label ? [t.defaultTexts.label] : []), title, ...discountDrawnTexts(offer)];
    return { t, prompt, expect };
  });
  if (DRY) {
    for (const p of plans) console.log(`\n===== ${p.t.id} ${p.t.name}\n${p.prompt}\n[찍혀야 할 글자] ${p.expect.join(' | ')}`);
    return;
  }
  if (!isStudioReady()) { console.log('생성 키가 없어 멈춤'); process.exitCode = 1; return; }
  fs.mkdirSync(OUT, { recursive: true });
  const log: string[] = [];
  const say = (t: string) => { console.log(t); log.push(t); };
  fs.writeFileSync(`${OUT}/_expect.txt`, plans.map((p) => `${p.t.id} ${p.t.name} = ${p.expect.join(' | ')}`).join('\n') + '\n');
  const engines: StudioImageEngine[] = BOTH ? [SAMPLE_ENGINE, 'gemini'] : [SAMPLE_ENGINE];
  for (const p of plans) {
    const done = new Set<StudioImageEngine>();   // OpenAI 실패 → Gemini 대체가 나면 Gemini 차례 건너뜀(중복 과금 0)
    for (const engine of engines) {
      const name = `${p.t.id}_${engine}`;
      if (done.has(engine)) { say(`${name} | 건너뜀(대체로 이미 그림)`); continue; }
      try {
        // 제품 사진 0 = 고객이 사진 없이 만드는 길 그대로(OpenAI = 빈 진열면 문장 · 예시 전용 갈래 0)
        const img = await generatePoster(p.prompt, preset, null, { engine });
        done.add(img.engine);
        const ext = img.mime.includes('png') ? 'png' : 'jpg';
        fs.writeFileSync(`${OUT}/${name}.${ext}`, Buffer.from(img.base64, 'base64'));
        const saved = SAVE && img.engine === SAMPLE_ENGINE ? saveTemplateSample(p.t.id, img) : null;
        say(`${name}.${ext} | 실제엔진=${img.engine}${img.engine !== engine ? ' ★대체됨(저장 안 함)' : ''} | ${img.ms}ms${saved ? ` | 예시 저장 ${saved}` : ''}`);
      } catch (e: any) {
        say(`${name} | 실패 ${String(e?.code || e?.message || e).slice(0, 120)}`);
      }
    }
  }
  fs.writeFileSync(`${OUT}/_log.txt`, log.join('\n') + '\n');
  say(`저장 위치: ${OUT}`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
