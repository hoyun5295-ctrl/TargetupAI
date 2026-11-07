/**
 * 할인 템플릿 실제 샘플 · 갤러리 예시 — 로드맵 V2(2026-11-08 · 원장 = status/ROADMAP.md §V2 · 설계서 docs/2026-11-08-c114-roadmap-v2-design.md §3 B)
 *
 * ★ C114 = 템플릿은 카탈로그(image-studio-templates-discount.ts) · 숫자 · 틀 줄은 CT(studio-discount.ts) · 프롬프트 = 운영 buildPosterPrompt 그대로.
 *   이 스크립트는 그 셋을 부르기만 한다(같은 문장을 다시 쓰지 않는다).
 *   기본 = 고객 생성과 같은 엔진(studioImageEngine) 한 번씩 · --both = OpenAI · Gemini 둘 다(비교용 · OpenAI 실패 → Gemini 대체가 나면 Gemini 차례 건너뜀)
 *   --save = 갤러리 예시로 저장(saveTemplateSample · 기본 엔진 결과만) · --dry = 프롬프트만(AI 0 · 키 불필요)
 *   제품 = 저장소 인앱 예시 누끼(assets/inapp-examples) · 세트 = 두 장을 서버 묶음 함수로 한 장(운영과 같다).
 *   비용 = 장당 약 $0.067(OpenAI) · 크레딧 · DB 무관 · 산출 /tmp/discount-template-samples.
 *
 * 실행: cd packages/backend && /usr/bin/ts-node -T scripts/discount-template-samples.ts [--both] [--save] [--dry]
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  resolvePreset, buildPosterPrompt, generatePoster, isStudioReady, studioImageEngine, groupProductCutouts, saveTemplateSample,
  type StudioImageEngine,
} from '../src/utils/image-studio';
import { STUDIO_TEMPLATES } from '../src/utils/image-studio-templates';
import { readDiscountOffer, discountDrawnTexts, type DiscountOffer } from '../src/utils/studio-discount';

const OUT = '/tmp/discount-template-samples';
const CUTS = path.join(__dirname, '../assets/inapp-examples');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const BOTH = args.includes('--both');
const SAVE = args.includes('--save');

/** 템플릿마다 예시 값(가상 브랜드 · 1108 샘플과 같은 숫자) */
const SAMPLE_INPUT: Record<string, { title: string; products: string[]; offer: Record<string, unknown> }> = {
  'discount-price-cream': { title: '결온 앰버 세럼', products: ['cut-kyeolon.png'], offer: { before: 38000, sale: 29900 } },
  'discount-price-black': { title: '소요 울 케이블 니트', products: ['cut-soyo.png'], offer: { before: 129000, sale: 89000 } },
  'discount-price-cafe': { title: '오후담 크림 라떼', products: ['cut-ohudam.png'], offer: { before: 6500, sale: 4900 } },
  'discount-nplus-coral': { title: '오후담 크림 라떼', products: ['cut-ohudam.png'], offer: { n: 1, m: 1, unit: 6500 } },
  'discount-nplus-sky': { title: '결온 앰버 세럼', products: ['cut-kyeolon.png'], offer: { n: 2, m: 1, unit: 38000 } },
  'discount-period-navy': { title: '소요 울 케이블 니트', products: ['cut-soyo.png'], offer: { before: 129000, sale: 99000, period: '11.10 ~ 11.16', gift: '울 머플러' } },
  'discount-set-beige': { title: '겨울 선물 세트', products: ['cut-kyeolon.png', 'cut-soyo.png'], offer: { items: ['앰버 세럼', '케이블 니트'], prices: [38000, 129000], sale: 139000 } },
  'discount-set-white': { title: '포근한 겨울 세트', products: ['cut-soyo.png', 'cut-ohudam.png'], offer: { items: ['케이블 니트', '크림 라떼'], prices: [129000, 6500], sale: 119000 } },
};

(async () => {
  const preset = resolvePreset('poster');
  const templates = STUDIO_TEMPLATES.filter((t) => t.kind === 'discount');
  const plans = templates.map((t) => {
    const input = SAMPLE_INPUT[t.id];
    if (!input) throw new Error(`예시 값 없음: ${t.id}`);
    const read = readDiscountOffer(input.offer, t.offer);
    if (!read.ok) throw new Error(`${t.id} 혜택 오류: ${read.field} ${read.error}`);
    const offer: DiscountOffer = read.offer;
    const prompt = buildPosterPrompt({
      template: t, preset, hasProduct: true, productCount: input.products.length,
      texts: { label: t.defaultTexts.label || '', title: input.title, subtitle: '' }, offer,
    });
    const expect = [...(t.defaultTexts.label ? [t.defaultTexts.label] : []), input.title, ...discountDrawnTexts(offer)];
    return { t, input, prompt, expect };
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
  const main = studioImageEngine();
  const engines: StudioImageEngine[] = BOTH ? ['openai', 'gemini'] : [main];
  for (const p of plans) {
    const files = p.input.products.map((f) => path.join(CUTS, f));
    const cut = files.length === 1
      ? { base64: fs.readFileSync(files[0]).toString('base64'), mime: 'image/png' }
      : await groupProductCutouts(files);
    const done = new Set<StudioImageEngine>();   // OpenAI 실패 → Gemini 대체가 나면 Gemini 차례 건너뜀(중복 과금 0)
    for (const engine of engines) {
      const name = `${p.t.id}_${engine}`;
      if (done.has(engine)) { say(`${name} | 건너뜀(대체로 이미 그림)`); continue; }
      try {
        const img = await generatePoster(p.prompt, preset, cut, { engine });
        done.add(img.engine);
        const ext = img.mime.includes('png') ? 'png' : 'jpg';
        fs.writeFileSync(`${OUT}/${name}.${ext}`, Buffer.from(img.base64, 'base64'));
        const saved = SAVE && img.engine === main ? saveTemplateSample(p.t.id, img) : null;
        say(`${name}.${ext} | 실제엔진=${img.engine}${img.engine !== engine ? ' ★대체됨' : ''} | ${img.ms}ms${saved ? ` | 예시 저장 ${saved}` : ''}`);
      } catch (e: any) {
        say(`${name} | 실패 ${String(e?.code || e?.message || e).slice(0, 120)}`);
      }
    }
  }
  fs.writeFileSync(`${OUT}/_log.txt`, log.join('\n') + '\n');
  say(`저장 위치: ${OUT}`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
