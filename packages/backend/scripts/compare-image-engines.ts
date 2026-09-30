/**
 * 이미지 생성 엔진 2차 블라인드 비교 — 스위치(STUDIO_IMAGE_ENGINE)를 켜기 전 확인용 (2026-09-30)
 * 원장 = docs/2026-09-30-ai-model-prompt-upgrade.md §2-4
 *
 * 운영 함수(generatePoster · editOrUpscale) 그대로 엔진만 바꿔 부른다 — 크레딧 · 임시 저장소 · DB 무관.
 *   템플릿 6종(글자만 4 · 상품 사진 첨부 2) × 엔진 2(OpenAI · Gemini) + 수정 지시 2건 × 엔진 2 = 16장(약 $1.7 · 5~10분)
 *   상품 사진 = PRODUCT_IMG(기본 /tmp/product.jpg) → 누끼 서비스로 누끼. 없으면 상품 2건만 건너뛴다(AI 호출 안 함).
 * 블라인드: 사례마다 A/B 무작위 · 실행 순서 섞음 · 화면엔 진행 숫자만(엔진 로그는 _raw/_log.txt) · 전부 1536×2048 로 맞춰 저장.
 *   판정 뒤에 _key.txt 를 연다. 대체(OpenAI 실패 → Gemini)가 난 장은 _key.txt 에 "★대체됨(비교 무효)"로 찍힌다.
 *
 * 실행: cd packages/backend && /usr/bin/ts-node -T scripts/compare-image-engines.ts
 * 산출: /tmp/image-engine-compare/*.jpg (비교용) · _key.txt(대응표) · _raw/(원본 · 엔진 로그 — 판정 전 열지 말 것)
 */
import 'dotenv/config';
import fs from 'fs';
import sharp from 'sharp';
import {
  resolvePreset, buildPosterPrompt, buildEditInstruction, generatePoster, editOrUpscale, removeBackground,
  type GeneratedImage, type StudioImageEngine,
} from '../src/utils/image-studio';
import { getTemplate } from '../src/utils/image-studio-templates';

const OUT = '/tmp/image-engine-compare';
const PRODUCT = process.env.PRODUCT_IMG || '/tmp/product.jpg';
fs.mkdirSync(`${OUT}/_raw`, { recursive: true });

// 블라인드 — 운영 코드의 엔진 로그([image-studio] ...)는 화면 대신 파일로(진행 줄 사이에 찍히면 대응이 드러난다)
const studioLog: string[] = [];
for (const lv of ['log', 'warn', 'error'] as const) {
  const orig = console[lv].bind(console);
  console[lv] = (...a: unknown[]) => {
    if (String(a[0]).startsWith('[image-studio]')) { studioLog.push(a.map(String).join(' ')); return; }
    orig(...a);
  };
}

const P = resolvePreset('poster');
const EDIT_ASK = '배경을 해 질 녘 노을빛 분위기로 바꿔 주세요';
const EDIT = buildEditInstruction(EDIT_ASK);
const NAME: Record<StudioImageEngine, string> = { openai: 'gpt-image(글자까지 AI)', gemini: 'Nano Banana Pro(글자까지 AI · 현행)' };
interface Case { t: string; id: string; edit?: boolean; product?: boolean; texts: { label: string; title: string; subtitle: string } }
const CASES: Case[] = [
  { t: 'p1', id: 'sale-time-urgent', edit: true, texts: { label: 'TIME SALE', title: '오늘 단 하루 최대 50% 할인', subtitle: '10월 7일(화) 오후 2시~6시 · 온라인몰 한정' } },
  { t: 'p2', id: 'cafe-dessert-sweet', edit: true, texts: { label: 'NEW DESSERT', title: '밤 몽블랑 출시', subtitle: '가을 한정 · 10월 한 달만 만나요' } },
  { t: 'p3', id: 'season-korean-holiday', texts: { label: 'GIFT SET', title: '마음을 전하는 명절 선물', subtitle: '사전 예약 시 선물 포장 무료' } },
  { t: 'p4', id: 'fashion-magazine-serif', texts: { label: 'F/W COLLECTION', title: '2026 가을 겨울 컬렉션', subtitle: '신상품 입고 · 매장과 온라인 동시 오픈' } },
  { t: 'p5', id: 'beauty-lux-dark', product: true, texts: { label: 'NEW', title: '프리미엄 앰플 세럼 출시', subtitle: '첫 구매 고객 사은품 증정' } },
  { t: 'p6', id: 'beauty-clean-bright', product: true, texts: { label: 'BEST SELLER', title: '수분 크림 1+1 기획전', subtitle: '10월 15일(수)까지 · 선착순 300명' } },
];
const ENGINES: StudioImageEngine[] = ['openai', 'gemini'];
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [a[i], a[k]] = [a[k], a[i]]; }
  return a;
}

const key: string[] = [];
let cutout: { base64: string; mime: string } | null = null;
let productNote = '';
async function prepareProduct(): Promise<void> {
  if (!fs.existsSync(PRODUCT)) { productNote = `상품 사진 없음(${PRODUCT}) — 상품 첨부 2건 건너뜀(AI 호출 안 함)`; return; }
  try {
    const out = `${OUT}/_raw/_cutout.png`;
    await removeBackground(PRODUCT, out);
    cutout = { base64: fs.readFileSync(out).toString('base64'), mime: 'image/png' };
    productNote = `상품 사진 = ${PRODUCT} → 누끼 _raw/_cutout.png`;
  } catch (e: any) {
    productNote = `누끼 실패(${e?.code || e?.message}) — 상품 첨부 2건 건너뜀`;
  }
}
async function save(file: string, img: GeneratedImage): Promise<void> {
  const buf = Buffer.from(img.base64, 'base64');
  fs.writeFileSync(`${OUT}/_raw/${file}`, buf);
  fs.writeFileSync(`${OUT}/${file}`, await sharp(buf).resize(1536, 2048).jpeg({ quality: 92 }).toBuffer());
}
type Attempt = { ok: true; img: GeneratedImage } | { ok: false; err: string };
async function attempt(fn: () => Promise<GeneratedImage>): Promise<Attempt> {
  try { return { ok: true, img: await fn() }; } catch (e: any) { return { ok: false, err: String(e?.code || e?.message || e).slice(0, 120) }; }
}
function keyLine(file: string, want: StudioImageEngine, r: Attempt, prefix = ''): string {
  if (!r.ok) return `${file} = ${prefix}${NAME[want]} | FAIL ${r.err}`;
  const swapped = r.img.engine !== want ? ' ★대체됨(비교 무효)' : '';
  return `${file} = ${prefix}${NAME[want]} | OK 실제엔진=${r.img.engine}${swapped} | ${r.img.ms}ms | 이미지토큰 ${r.img.imageTokens}`;
}
let done = 0, failed = 0, total = 0;
function tick(ok: boolean): void {
  done += 1;
  if (!ok) failed += 1;
  console.log(`진행 ${done}/${total}${failed ? ` (실패 ${failed} · 사유는 _key.txt)` : ''}`);
}

async function runCase(c: Case, engine: StudioImageEngine, letter: string): Promise<void> {
  const template = getTemplate(c.id);
  if (!template) { key.push(`${c.t}_${letter}.jpg = ${NAME[engine]} | FAIL 템플릿 없음 ${c.id}`); tick(false); return; }
  const useProduct = !!(c.product && cutout);
  const prompt = buildPosterPrompt({ template, preset: P, texts: c.texts, hasProduct: useProduct });
  const file = `${c.t}_${letter}.jpg`;
  const r = await attempt(() => generatePoster(prompt, P, useProduct ? cutout : null, { engine }));
  if (r.ok) await save(file, r.img);
  key.push(keyLine(file, engine, r));
  tick(r.ok);
  if (!c.edit) return;
  const efile = `${c.t}_${letter}_edit.jpg`;
  if (!r.ok) { key.push(`${efile} = 수정 · ${NAME[engine]} | 건너뜀(원본 실패)`); tick(false); return; }
  const e = await attempt(() => editOrUpscale({
    baseImageBase64: r.img.base64, baseMime: r.img.mime, basePrompt: prompt, instruction: EDIT,
    imageSize: '2K', aspectRatio: P.aspectRatio, engine,
  }));
  if (e.ok) await save(efile, e.img);
  key.push(keyLine(efile, engine, e, '수정 · '));
  tick(e.ok);
}

(async () => {
  await prepareProduct();
  const cases = CASES.filter((c) => !c.product || cutout);
  const jobs: Array<{ c: Case; engine: StudioImageEngine; letter: string }> = [];
  for (const c of cases) {
    const letters = shuffle(['A', 'B']);
    ENGINES.forEach((engine, i) => jobs.push({ c, engine, letter: letters[i] }));
  }
  total = jobs.reduce((n, j) => n + (j.c.edit ? 2 : 1), 0);
  console.log(productNote);
  shuffle(jobs);
  const queue = jobs.slice();
  const worker = async () => { while (queue.length) { const j = queue.shift()!; await runCase(j.c, j.engine, j.letter); } };
  await Promise.all([worker(), worker(), worker()]);
  key.sort();
  fs.writeFileSync(`${OUT}/_raw/_log.txt`, studioLog.join('\n') + '\n');
  fs.writeFileSync(`${OUT}/_key.txt`, `${productNote}\n수정 지시 = ${EDIT_ASK}\n${key.join('\n')}\n`);
  console.log('저장 위치:', OUT, '· 대응표 = _key.txt(판정 뒤에 여세요) · 원본 = _raw/(판정 전 열지 말 것)');
})();
