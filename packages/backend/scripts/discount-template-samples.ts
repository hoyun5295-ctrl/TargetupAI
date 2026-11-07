/**
 * 할인 템플릿 실제 샘플 — 로드맵 V2 첫 일(2026-11-08 · Harold 「할인카드 실제 샘플뽑아서 체크」)
 * 원장 = status/ROADMAP.md §V2 「★1107 Harold 정정(할인 포스터 = 정해진 틀의 템플릿)」
 *
 * 틀 = 맨 위 제목(제품명) → 그 밑 혜택(빗금 가격 › 판매가 · N+M 표지) → 정해진 제품 자리(혜택을 가리지 않음) · 글자 크게.
 * 운영 함수(buildPosterPrompt · generatePoster) 그대로 · 템플릿은 이 파일 안에만 있다(카탈로그 · 화면 · DB · 크레딧 무관).
 *   샘플 6 × 엔진 2(Gemini · OpenAI) = 12장(compare-image-engines 기록 기준 장당 약 $0.1) · 제품 = 저장소 인앱 예시 누끼 3장.
 *   --dry = 프롬프트만 찍고 끝(AI 호출 0 · 키 불필요).
 *
 * 실행: cd packages/backend && /usr/bin/ts-node -T scripts/discount-template-samples.ts
 * 산출: /tmp/discount-template-samples/<번호>_<엔진>.(png|jpg) · _expect.txt(찍혀야 할 글자) · _log.txt
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { resolvePreset, buildPosterPrompt, generatePoster, isStudioReady, type StudioImageEngine } from '../src/utils/image-studio';
import { getTemplate } from '../src/utils/image-studio-templates';

const OUT = '/tmp/discount-template-samples';
const CUTS = path.join(__dirname, '../assets/inapp-examples');
const ENGINES: StudioImageEngine[] = ['openai', 'gemini'];   // OpenAI 먼저(실패하면 운영 함수가 Gemini 로 대체 · 그 뒤 Gemini 차례는 건너뜀)
const DRY = process.argv.includes('--dry');
const LAST_RULE = 'Use ONLY the text given above';

const won = (n: number) => `${n.toLocaleString('en-US')}원`;
/** 할인율 = (할인 전 − 판매가) × 100 을 할인 전으로 나눈 몫 · 1% 미만 = null(회의 합의 §B) */
function rate(before: number, sale: number): number | null {
  if (!Number.isInteger(before) || !Number.isInteger(sale) || !(sale > 0 && sale < before)) throw new Error(`가격 오류 ${before} → ${sale}`);
  const r = Math.floor(((before - sale) * 100) / before);
  return r >= 1 ? r : null;
}

type Offer =
  | { kind: 'price'; before: number; sale: number }
  | { kind: 'nplus'; n: number; m: number; unit: number };

interface Sample {
  no: string; name: string; product: string; label?: string; title: string; offer: Offer;
  period?: string; gift?: string; scaffold: string; textStyle: string;
}

const SAMPLES: Sample[] = [
  {
    no: '01', name: '가격 할인 · 크림(뷰티)', product: 'cut-kyeolon.png', label: 'SPECIAL PRICE', title: '결온 앰버 세럼',
    offer: { kind: 'price', before: 38000, sale: 29900 },
    scaffold: 'A bright premium cosmetics promotion scene: warm cream-beige seamless studio backdrop with a smooth, plain upper half, soft diffused daylight, a round matte ivory pedestal in the lower center for the product, a few delicate dried flowers only at the far bottom edges. Clean, airy, high-end shopping-mall promotion styling.',
    textStyle: 'Modern bold Korean sans-serif in deep warm brown, the discount rate and the strike line in a refined red, generous spacing, premium department-store sale typography.',
  },
  {
    no: '02', name: '가격 할인 · 블랙(의류)', product: 'cut-soyo.png', label: 'LIMITED OFFER', title: '소요 울 케이블 니트',
    offer: { kind: 'price', before: 129000, sale: 89000 },
    scaffold: 'A premium dark fashion promotion scene: deep charcoal-black studio, a soft warm spotlight from above onto a low glossy black plinth in the lower center, subtle haze, the upper half dark and plain. Luxurious, high-contrast, editorial.',
    textStyle: 'Bold clean white Korean sans-serif headline, gold-yellow accents for the discount rate and the strike line, crisp high-contrast luxury sale typography.',
  },
  {
    no: '03', name: '1+1 · 코랄(요식)', product: 'cut-ohudam.png', title: '오후담 크림 라떼',
    offer: { kind: 'nplus', n: 1, m: 1, unit: 6500 },
    scaffold: 'A vivid, cheerful cafe promotion scene: saturated coral-red seamless backdrop with a smooth, plain upper half, a simple round light pedestal in the lower center, a few soft confetti dots only at the edges. Energetic, playful, modern delivery-app promotion styling.',
    textStyle: 'Extra-bold rounded Korean display type in white, the offer badge as a white pill with coral-red text, punchy and playful.',
  },
  {
    no: '04', name: '2+1 · 하늘(뷰티)', product: 'cut-kyeolon.png', title: '결온 앰버 세럼',
    offer: { kind: 'nplus', n: 2, m: 1, unit: 38000 },
    scaffold: 'A fresh, clean skincare promotion scene: soft sky-blue gradient backdrop with a plain upper half, a glossy white round pedestal in the lower center with gentle water reflections, airy morning light. Fresh, clean, modern.',
    textStyle: 'Bold modern Korean sans-serif in deep navy, the offer badge as a vivid blue circle with white text, clean and confident.',
  },
  {
    no: '05', name: '기간 특가 + 증정 · 네이비(의류)', product: 'cut-soyo.png', title: '소요 울 케이블 니트',
    offer: { kind: 'price', before: 129000, sale: 99000 }, period: '11.10 ~ 11.16', gift: '울 머플러',
    scaffold: 'A confident fashion sale scene: deep navy-blue studio backdrop with a subtle gradient and a plain upper area, a light stone pedestal in the lower center, crisp soft light. Modern, trustworthy, campaign-like.',
    textStyle: 'Bold white Korean sans-serif headline, bright yellow accents for the date pill, the discount rate and the strike line, strong and clean sale typography.',
  },
  {
    no: '06', name: '가격 할인 · 웜 카페(요식)', product: 'cut-ohudam.png', title: '오후담 크림 라떼',
    offer: { kind: 'price', before: 6500, sale: 4900 },
    scaffold: 'A warm, cozy cafe promotion scene: warm caramel-beige backdrop with a plain upper half, a light wooden tabletop in the lower part for the cup, soft window light, a few coffee beans only at the bottom edges. Cozy, appetizing, modern cafe menu-board styling.',
    textStyle: 'Bold friendly Korean sans-serif in dark espresso brown, the discount rate in warm red-orange, appetizing modern menu typography.',
  },
];

/** 혜택 줄(그릴 글자 = 숫자에서 만든다) + 찍혀야 할 글자 목록 */
function offerLines(s: Sample): { lines: string[]; expect: string[] } {
  const lines: string[] = [];
  const expect: string[] = [s.title];
  if (s.period) {
    lines.push(`- Date pill at the very top of the poster, above the headline: "${s.period}" in a bright rounded pill.`);
    expect.push(s.period);
  }
  if (s.offer.kind === 'price') {
    const { before, sale } = s.offer;
    const r = rate(before, sale);
    lines.push(`- Price row directly below the headline, centered, ONE single row, the most prominent element of the poster: the original price "${won(before)}" in smaller muted gray with one diagonal strike line through it, then a right-pointing chevron "›", then ${r ? `the discount rate "${r}%" in bold accent color, then ` : ''}the sale price "${won(sale)}" as the largest and boldest text on the whole poster.`);
    expect.push(won(before), ...(r ? [`${r}%`] : []), won(sale));
  } else {
    const { n, m, unit } = s.offer;
    const badge = `${n}+${m}`;
    lines.push(`- Offer badge between the headline and the price row, centered: a large bold rounded badge reading exactly "${badge}".`);
    lines.push(`- Price row below the badge, centered, ONE single row: the small label "${n + m}개", the original total "${won(unit * (n + m))}" in muted gray with one diagonal strike line through it, a right-pointing chevron "›", then "${won(unit * n)}" large and bold.`);
    expect.push(badge, `${n + m}개`, won(unit * (n + m)), won(unit * n));
  }
  if (s.gift) {
    lines.push(`- Gift tag at the very bottom of the poster, below the product: a small red tag reading "증정" followed by "${s.gift}" inside one white rounded pill.`);
    expect.push('증정', s.gift);
  }
  return { lines, expect };
}

const fixedLayout = (s: Sample) => `FIXED TEMPLATE LAYOUT (this rule overrides every placement direction above): ${s.period ? 'the date pill at the very top, then ' : ''}the headline, then the offer elements in the order listed, all inside the upper 40% of the poster on a calm, plain area of the backdrop.${s.gift ? ' The gift tag alone sits at the very bottom edge, below the product.' : ''} The product occupies only the lower 55% of the poster, centered, and must never overlap, touch, or sit behind any text. Typography must be LARGE and bold for phone screens: the headline about 5% of the poster height, the sale price about 8% of the poster height, no tiny fine print anywhere. Render every number exactly as given, digit by digit, including the commas and the "원" unit.`;

function promptFor(s: Sample): { prompt: string; expect: string[] } {
  const base = getTemplate('beauty-clean-bright');
  if (!base) throw new Error('기준 템플릿 없음');
  const template = { ...base, id: `discount-sample-${s.no}`, scaffold: s.scaffold, textStyle: s.textStyle };
  const preset = resolvePreset('poster');
  const out = buildPosterPrompt({ template, preset, hasProduct: true, texts: { label: s.label || '', title: s.title, subtitle: '' } });
  const lines = out.split('\n');
  const i = lines.findIndex((l) => l.startsWith(LAST_RULE));
  if (i < 0) throw new Error('마지막 금지 줄을 못 찾음(buildPosterPrompt 문구가 바뀜)');
  const { lines: offer, expect } = offerLines(s);
  lines.splice(i, 0, ...offer);       // 혜택 줄 = 지정 문구(헤드라인) 바로 뒤 · 마지막 금지 줄 앞
  lines.push(fixedLayout(s));          // 최후미 = 고정 틀
  if (s.label) expect.unshift(s.label);
  return { prompt: lines.join('\n'), expect };
}

(async () => {
  const preset = resolvePreset('poster');
  const plans = SAMPLES.map((s) => ({ s, ...promptFor(s) }));
  if (DRY) {
    for (const p of plans) console.log(`\n===== ${p.s.no} ${p.s.name}\n${p.prompt}\n[찍혀야 할 글자] ${p.expect.join(' | ')}`);
    return;
  }
  if (!isStudioReady()) { console.log('생성 키가 없어 멈춤'); process.exitCode = 1; return; }
  fs.mkdirSync(OUT, { recursive: true });
  const log: string[] = [];
  const say = (t: string) => { console.log(t); log.push(t); };
  fs.writeFileSync(`${OUT}/_expect.txt`, plans.map((p) => `${p.s.no} ${p.s.name} = ${p.expect.join(' | ')}`).join('\n') + '\n');
  for (const p of plans) {
    const cut = { base64: fs.readFileSync(path.join(CUTS, p.s.product)).toString('base64'), mime: 'image/png' };
    const done = new Set<StudioImageEngine>();   // 실제로 그린 엔진 · OpenAI 실패 → Gemini 대체가 나면 Gemini 를 다시 부르지 않는다
    for (const engine of ENGINES) {
      const name = `${p.s.no}_${engine}`;
      if (done.has(engine)) { say(`${name} | 건너뜀(대체로 이미 그림)`); continue; }
      try {
        const img = await generatePoster(p.prompt, preset, cut, { engine });
        done.add(img.engine);
        const ext = img.mime.includes('png') ? 'png' : 'jpg';
        fs.writeFileSync(`${OUT}/${name}.${ext}`, Buffer.from(img.base64, 'base64'));
        say(`${name}.${ext} | 실제엔진=${img.engine}${img.engine !== engine ? ' ★대체됨' : ''} | ${img.ms}ms`);
      } catch (e: any) {
        say(`${name} | 실패 ${String(e?.code || e?.message || e).slice(0, 120)}`);
      }
    }
  }
  fs.writeFileSync(`${OUT}/_log.txt`, log.join('\n') + '\n');
  say(`저장 위치: ${OUT}`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
