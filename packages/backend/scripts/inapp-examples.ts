/**
 * 인앱 예시 갤러리 그림 — 서버 스크립트(★ 2026-11-05 인앱 포스터 재구성 설계서 §3-9 · studio-samples.ts 와 같은 꼴)
 *
 *   make <장수> [id,id]  그림이 없는 장만 앞에서부터 <장수>장 생성(AI 과금 · 실패 3번이면 멈춤). id 를 주면 그 예시 안에서만.
 *   warm                 있는 예시 그림 전부 서빙본(1400px)을 미리 만든다(AI 0 · 돈 0).
 * 엔진 = 고객 생성과 같은 studioImageEngine() · 프롬프트 = buildPosterPrompt + 템플릿 + 예시 글(통짜) 또는 글 없는 판(글 얹기 · 아래 자리를 비움).
 * 누끼 = backend/assets/inapp-examples/cut-*.png · 크레딧 · DB 무관. 저장 = INAPP_EXAMPLE_PATH(기본 ./uploads/inapp-examples) · <id>-<장>.jpg.
 * ⛔ 같은 명령을 두 창에서 동시에 돌리지 않는다(같은 장을 두 번 만들어 돈이 두 번 나간다).
 *
 * 실행: cd packages/backend && /usr/bin/ts-node -T scripts/inapp-examples.ts make 14
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  resolvePreset, buildPosterPrompt, generatePoster, studioImageEngine, isStudioReady, runSampleBatch,
} from '../src/utils/image-studio';
import { getTemplate } from '../src/utils/image-studio-templates';
import { getServePath } from '../src/utils/image-serve';
import {
  INAPP_EXAMPLES, findInAppExampleImage, saveInAppExampleImage, inAppExampleAssetDir,
} from '../src/utils/inapp-examples';

const MB = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;

/** 그림이 아직 없는 장(예시 표 순서) */
function missingSlides(ids: string[] | null): Array<{ id: string; exId: string; slide: number }> {
  const out: Array<{ id: string; exId: string; slide: number }> = [];
  for (const ex of INAPP_EXAMPLES) {
    if (ids && !ids.includes(ex.id)) continue;
    ex.slides.forEach((_, i) => {
      if (!findInAppExampleImage(ex.id, i)) out.push({ id: `${ex.id}-${i}`, exId: ex.id, slide: i });
    });
  }
  return out;
}

async function warm(): Promise<void> {
  let orig = 0, served = 0, n = 0;
  for (const ex of INAPP_EXAMPLES) {
    for (let i = 0; i < ex.slides.length; i++) {
      const f = findInAppExampleImage(ex.id, i);
      if (!f) continue;
      const p = await getServePath(f.absPath);
      orig += fs.statSync(f.absPath).size;
      served += fs.statSync(p).size;
      n++;
    }
  }
  console.log(`서빙본 준비 ${n}장 · 원본 합 ${MB(orig)} → 서빙본 합 ${MB(served)}`);
}

async function make(count: number, ids: string[] | null): Promise<void> {
  if (!isStudioReady()) { console.log('생성 키가 없어 멈춤(GEMINI_API_KEY)'); process.exitCode = 1; return; }
  const engine = studioImageEngine();
  const preset = resolvePreset('poster');
  const missing = missingSlides(ids);
  console.log(`엔진 ${engine} · 그림 없는 장 ${missing.length}개 · 이번 ${Math.min(count, missing.length)}장`);
  const { made, failed } = await runSampleBatch(missing, count, async (job) => {
    const ex = INAPP_EXAMPLES.find((e) => e.id === job.exId)!;
    const sl = ex.slides[job.slide];
    const template = getTemplate(sl.studioTemplateId);
    if (!template) throw new Error(`템플릿 없음 ${sl.studioTemplateId}`);
    let cutout: { base64: string; mime: string } | null = null;
    if (sl.product) {
      const p = path.join(inAppExampleAssetDir(), sl.product);
      cutout = { base64: fs.readFileSync(p).toString('base64'), mime: 'image/png' };
    }
    const hasText = !!(sl.texts.label || sl.texts.title || sl.texts.subtitle);
    const prompt = buildPosterPrompt({
      template, preset, hasProduct: !!cutout,
      texts: { label: sl.texts.label || '', title: sl.texts.title || '', subtitle: sl.texts.subtitle || '' },
      // 글 얹기 장 = 글 없는 판 · 렌더러가 글을 얹을 아래 자리를 비운다
      textPosition: hasText ? null : 'bottom',
    });
    const img = await generatePoster(prompt, preset, cutout, { engine });
    await getServePath(saveInAppExampleImage(job.exId, job.slide, img));
  });
  console.log(`끝 · 만듦 ${made.length} · 실패 ${failed.length}${failed.length ? ` (${failed.join(', ')})` : ''} · 남은 그림 없는 장 ${missingSlides(ids).length}개`);
}

async function main(): Promise<void> {
  const [mode, a, b] = process.argv.slice(2);
  if (mode === 'warm') return warm();
  const count = Number(a);
  if (mode === 'make' && Number.isInteger(count) && count >= 1 && count <= 50) {
    return make(count, b ? b.split(',').map((s) => s.trim()).filter(Boolean) : null);
  }
  console.log('사용법: inapp-examples.ts make <1~50> [id,id] | warm');
  process.exitCode = 1;
}

// DB 모듈(예시 표 → 인앱 CT)에 닿는다 = 성공해도 스스로 끝낸다(열린 풀이 남아 멈추지 않게 · R26)
main().then(
  () => { const code = Number(process.exitCode || 0); process.exit(code); },
  (e) => { console.error(e); process.exit(1); },
);
