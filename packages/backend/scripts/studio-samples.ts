/**
 * 이미지 스튜디오 템플릿 예시 그림 — 서버 스크립트(2026-11-01 · Harold 「스크립트로 만들자」)
 * 원장 = docs/FEATURE-IMAGE-STUDIO.md §5 · 배포 원장 C88-S1
 *
 * 옛 길(슈퍼관리자 주소 /template-samples/generate)은 1025 구조체크 #115(R15 · 화면 호출 0)로 지웠다. 주소를 다시 열지 않고 서버에서만 돈다.
 *   make <장수> [id,id]  예시가 없는 템플릿만 앞에서부터 <장수>장 생성(AI 과금 · 실패 3번이면 멈춤). id 를 주면 그 안에서만.
 *   warm                 있는 예시 전부 서빙본(1400px)을 미리 만든다(AI 0 · 돈 0). 원본 · 서빙본 합계를 찍는다.
 * 엔진 = 고객 생성과 같은 studioImageEngine()(STUDIO_IMAGE_ENGINE · 기본 Gemini). 크레딧 · DB 무관.
 * ⛔ 같은 명령을 두 창에서 동시에 돌리지 않는다(같은 템플릿을 두 번 만들어 돈이 두 번 나간다).
 *
 * 실행: cd packages/backend && /usr/bin/ts-node -T scripts/studio-samples.ts make 20
 */
import 'dotenv/config';
import fs from 'fs';
import {
  resolvePreset, buildPosterPrompt, generatePoster, studioImageEngine, isStudioReady,
  findTemplateSample, templatesMissingSample, saveTemplateSample, runSampleBatch,
} from '../src/utils/image-studio';
import { STUDIO_TEMPLATES } from '../src/utils/image-studio-templates';
import { getServePath } from '../src/utils/image-serve';

const MB = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;

async function warm(): Promise<void> {
  let orig = 0, served = 0, n = 0;
  for (const t of STUDIO_TEMPLATES) {
    const s = findTemplateSample(t.id);
    if (!s) continue;
    const p = await getServePath(s.absPath);
    orig += fs.statSync(s.absPath).size;
    served += fs.statSync(p).size;
    if (++n % 50 === 0) console.log(`${n}장 …`);
  }
  console.log(`서빙본 준비 ${n}장 · 원본 합 ${MB(orig)} → 서빙본 합 ${MB(served)} · 한 장 평균 ${MB(orig / Math.max(n, 1))} → ${MB(served / Math.max(n, 1))}`);
}

async function make(count: number, ids: string[] | null): Promise<void> {
  if (!isStudioReady()) { console.log('생성 키가 없어 멈춤(GEMINI_API_KEY)'); process.exitCode = 1; return; }
  const engine = studioImageEngine();
  const preset = resolvePreset('poster');
  // ★ 2026-11-08 C114 B 할인 템플릿 예시 = 제품 사진 + 혜택 숫자가 있어야 해서 scripts/discount-template-samples.ts --save 가 만든다(여기서 빼야 숫자 없는 예시 0)
  const missing = templatesMissingSample(STUDIO_TEMPLATES.filter((t) => t.kind !== 'discount'), ids);
  console.log(`엔진 ${engine} · 예시 없는 템플릿 ${missing.length}개 · 이번 ${Math.min(count, missing.length)}장`);
  const { made, failed } = await runSampleBatch(missing, count, async (t) => {
    const prompt = buildPosterPrompt({
      template: t, preset, hasProduct: false,
      texts: { label: t.defaultTexts.label || '', title: t.sample.title, subtitle: t.sample.subtitle || '' },
    });
    const img = await generatePoster(prompt, preset, null, { engine });
    await getServePath(saveTemplateSample(t.id, img));
  });
  console.log(`끝 · 만듦 ${made.length} · 실패 ${failed.length}${failed.length ? ` (${failed.join(', ')})` : ''} · 남은 예시 없는 템플릿 ${templatesMissingSample(STUDIO_TEMPLATES.filter((t) => t.kind !== 'discount'), ids).length}개`);
}

async function main(): Promise<void> {
  const [mode, a, b] = process.argv.slice(2);
  if (mode === 'warm') return warm();
  const count = Number(a);
  if (mode === 'make' && Number.isInteger(count) && count >= 1 && count <= 200) {
    return make(count, b ? b.split(',').map((s) => s.trim()).filter(Boolean) : null);
  }
  console.log('사용법: studio-samples.ts make <1~200> [id,id] | warm');
  process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
