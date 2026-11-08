/**
 * C112 이미지 스튜디오 브랜드 로고 층 — 소스 계약 시험(★ 2026-11-07 설계서 docs/2026-11-07-c112-studio-brand-logo-design.md §5 「계약 시험」)
 *
 * 대상은 소스에서 기계로 뽑는다(공용 훅을 부르는 화면 · saveStudioTemp 호출 자리) · 기대값은 손으로 쓴 값.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const PKG = join(__dirname, '..', '..', '..', '..');   // packages/
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (!['__tests__', 'node_modules', 'dist'].includes(f)) walk(p, out); }
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
};
const load = (dir: string) => walk(join(PKG, dir)).map((p) => ({ rel: relative(PKG, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }));
const backend = load('backend/src');
const frontend = load('frontend/src');
const read = (rel: string) => {
  const f = [...backend, ...frontend].find((x) => x.rel === rel);
  if (!f) throw new Error(`파일 없음 ${rel}`);
  return f.text;
};
/** 주석을 뺀 본문(화면 문구 검사용) */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
/** 라우트 손잡이 한 덩어리 = 그 post( 부터 다음 imageStudioRouter. 앞까지 */
const handler = (src: string, route: string) => {
  const start = src.indexOf(`imageStudioRouter.post('${route}'`);
  if (start < 0) throw new Error(`라우트 없음 ${route}`);
  const next = src.indexOf('imageStudioRouter.', start + 10);
  return src.slice(start, next < 0 ? undefined : next);
};
/** 함수 본문 = 그 선언부터 다음 줄머리 export 앞까지 */
const fnBody = (src: string, name: string) => {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) throw new Error(`함수 없음 ${name}`);
  const next = src.indexOf('\nexport ', start + 10);
  return src.slice(start, next < 0 ? undefined : next);
};

const ROUTE = read('backend/src/routes/image-studio.ts');
const LOGO = read('backend/src/utils/studio-logo.ts');

describe('K1 두 결과 화면 = 같은 로고 줄 · 같은 저장 layers(한쪽만 고치면 빨간불)', () => {
  // 공용 만들기 훅을 부르는 화면 = 기계로 뽑는다
  const screens = frontend.filter((f) => /\buseStudioMake\(/.test(f.text) && !f.rel.endsWith('components/studio/StudioMake.tsx'));

  it('훅을 부르는 화면 = 스튜디오 결과 카드 · DM 삽입 창(둘)', () => {
    expect(screens.map((s) => s.rel).sort()).toEqual([
      'frontend/src/components/dm/build/StudioInsertModal.tsx',
      'frontend/src/pages/ImageStudioPage.tsx',
    ]);
  });

  // ★ C113 D9 — 홈페이지 로고 = 찾기(make.findLogo) · 「이 로고로 저장」(make.saveFoundLogo) 두 단계
  it.each(['frontend/src/components/dm/build/StudioInsertModal.tsx', 'frontend/src/pages/ImageStudioPage.tsx'])('%s = StudioLogoControls · make.relayer · make.findLogo · make.saveFoundLogo', (rel) => {
    const t = read(rel);
    expect(t).toMatch(/<StudioLogoControls\b/);
    expect(t).toMatch(/make\.relayer\(/);
    expect(t).toMatch(/onFind=\{make\.findLogo\}/);
    expect(t).toMatch(/make\.saveFoundLogo\(/);
  });

  it('saveStudioTemp 를 부르는 모든 자리 = 셋째 인자 layersForSave(…)', () => {
    const calls = frontend.flatMap((f) => [...code(f.text).matchAll(/\bsaveStudioTemp\(([^;]*?)\);/g)].map((m) => ({ rel: f.rel, args: m[1] })))
      .filter((c) => !c.rel.endsWith('lib/studio-api.ts'));
    expect(calls.length).toBe(2);
    for (const c of calls) expect(c.args, c.rel).toMatch(/,\s*layersForSave\(/);
  });

  it('생성 결과 = 바탕 받은 뒤 곧바로 /layers(켜짐 · 자동) · 결과에 로고 상태', () => {
    const make = read('frontend/src/components/studio/StudioMake.tsx');
    const gen = make.slice(make.indexOf('const buildGenerateBody = ('), make.indexOf('return {\n    template,'));   // ★ C118 생성 = 본문 짜기 + 보내기 + generate
    expect(gen).toMatch(/postLayers\(im\.tempId, \{ on: true, corner: null, size: null \}, textless\)/);
    expect(make).toMatch(/studioPost\('\/api\/image-studio\/layers', layerRequest\(/);
    expect(make).toMatch(/export interface StudioMade extends LogoCardState/);
  });

  it('DM 창 = 결과가 만들어진 판(글 없는 판 여부)으로 미리보기 · 읽기 · 저장(부른 쪽 지금 값 아님)', () => {
    const modal = read('frontend/src/components/dm/build/StudioInsertModal.tsx');
    expect(modal).toMatch(/layersForSave\(made\.logo, made\.logoFailed, made\.textless\)/);
    expect(modal).toMatch(/make\.relayer\(made\.tempId, s, made\.textless\)/);
    expect(modal).toMatch(/make\.saveFoundLogo\(lc, made\.tempId, made\.textless\)/);   // ★ C113 D9
    expect(modal).toMatch(/textless: r\.textless/);
  });

  it('스튜디오 저장한 카드 그림 = 저장된 소재 주소(화면 = 저장값)', () => {
    expect(read('frontend/src/pages/ImageStudioPage.tsx')).toMatch(/const shown = c\.saved\?\.url \|\| c\.layered \|\| c\.blob;/);
  });
});

describe('K2 /save = 로고 단계가 저장 잠금 안 · 지금 갈래 앞 · 같은 등재 판정 CT', () => {
  const save = handler(ROUTE, '/save');

  it('순서 = layers 꼴 검사 → 잠금(runSerial studio-save) → logoSaveStage → 지금 갈래(let meta = readTempMeta)', () => {
    const iParse = save.indexOf('readLogoSaveLayers(req.body?.layers)');
    const iLock = save.indexOf('await runSerial(`studio-save:${companyId}:${tempId}`');
    const iStage = save.indexOf('await logoSaveStage(');
    const iMeta = save.indexOf('let meta = readTempMeta(companyId, tempId);');
    expect([iParse, iLock, iStage, iMeta].every((i) => i > 0)).toBe(true);
    expect(iParse < iLock && iLock < iStage && iStage < iMeta).toBe(true);
  });

  it('등재 판정 = 지금 갈래 · 로고 갈래 모두 registerAssetConfirmed(옛 손 판정 잘라 옮김)', () => {
    expect(save.match(/registerAssetConfirmed\(/g)?.length).toBe(1);
    expect(LOGO).toMatch(/registerConfirmed: \(input\) => registerAssetConfirmed\(input\)/);
    expect(fnBody(LOGO, 'logoSaveStage')).toMatch(/await deps\.registerConfirmed\(/);
  });

  it('로고 갈래 영구 이름 = 바탕 id · 옛 MMS 꼴 · 포스터 아닌 임시 그림은 로고 갈래 없음', () => {
    const stage = fnBody(LOGO, 'logoSaveStage');
    expect(stage).toMatch(/writeStudioPermanent\(companyId, tempId, 'jpeg', buf, \{ full: isStudioFullPreset\(meta\.presetKey\) \}\)/);   // ★ C118 A3 인앱용 = .full. 이름
    expect(stage).toMatch(/const wantLogo = !!layers && effectiveSpec !== 'mms' && meta\.kind === 'poster';/);
    // 1단계(남은 바탕의 영구 파일)가 켜짐 · 꺼짐 판단보다 앞
    expect(stage.indexOf('findPermanentByTempId(companyId, tempId)')).toBeLessThan(stage.indexOf('if (!wantLogo || !layers) return null;'));
  });
});

describe('K3 /layers = 읽기만(임시 쓰기 0 · 잠금 0) · 이 회사 포스터만', () => {
  const route = handler(ROUTE, '/layers');
  const preview = fnBody(LOGO, 'previewLogoStage');

  it('라우트 · 미리보기 함수에 쓰기 · 잠금 호출 0', () => {
    for (const body of [route, preview]) {
      expect(body).not.toMatch(/\b(writeTemp|writeTempBuffer|allocTempPath|writeStudioPermanent|runSerial|moveTempToPermanent)\(/);
    }
  });

  it('바탕 = 이 회사 임시 조회 + kind poster 판정', () => {
    expect(preview).toMatch(/readTempMeta\(companyId, baseTempId\)/);
    expect(preview).toMatch(/findTempFile\(companyId, baseTempId\)/);
    expect(preview).toMatch(/meta\.kind !== 'poster'/);
  });
});

describe('K4 무변경 잠금 · 경계', () => {
  it('생성 프롬프트 마지막 제한 = 로고를 그리지 않는다(로고는 서버가 얹는다)', () => {
    expect(read('backend/src/utils/image-studio.ts')).toContain('Do not render any other text, prices, logos, QR codes, or watermarks.');
  });

  it('py 합성기 · 한 줄 헤드라인 · AI 영업 = 로고 CT 를 쓰지 않는다', () => {
    const py = readFileSync(join(PKG, 'backend', 'python', 'image_studio_service.py'), 'utf8');
    expect(py).not.toMatch(/studio-logo|studio_logo|brand_kit/);
    for (const rel of ['backend/src/utils/line-headline-make.ts', 'backend/src/utils/sales-outreach-produce.ts']) {
      expect(read(rel), rel).not.toMatch(/studio-logo/);
    }
    const line = handler(ROUTE, '/line-headline');
    expect(line).not.toMatch(/\b(previewLogoStage|logoSaveStage|readHomepageLogo|readLogoSaveLayers|readLayerPreviewRequest)\(/);
  });

  it('로고 CT 를 import 하는 곳 = 스튜디오 라우트 하나', () => {
    const importers = backend.filter((f) => /from '(\.\.?\/)+(utils\/)?studio-logo'/.test(f.text)).map((f) => f.rel);
    expect(importers).toEqual(['backend/src/routes/image-studio.ts']);
  });
});

describe('K5 화면 사본 = 서버 글자 그대로 · 화면 문구 내부 이름 0', () => {
  const fe = read('frontend/src/lib/studio-layers.ts');
  const zones = read('backend/src/utils/studio-zones.ts');
  const typeText = (src: string, name: string) => {
    const m = src.match(new RegExp(`export type ${name} =([\\s\\S]*?);\\n`));
    if (!m) throw new Error(`타입 없음 ${name}`);
    return m[1].replace(/\s+/g, ' ').trim();
  };

  it('LogoView · LogoCorner · LogoSize · LogoUnusableReason = 서버와 같은 글자', () => {
    expect(typeText(fe, 'LogoView')).toBe(typeText(LOGO, 'LogoView'));
    expect(typeText(fe, 'LogoUnusableReason')).toBe(typeText(LOGO, 'LogoUnusableReason'));
    expect(typeText(fe, 'LogoCorner')).toBe(typeText(zones, 'LogoCorner'));
    expect(typeText(fe, 'LogoSize')).toBe(typeText(zones, 'LogoSize'));
  });

  it.each([
    'frontend/src/lib/studio-layers.ts',
    'frontend/src/components/studio/StudioLogoControls.tsx',
    'frontend/src/components/studio/StudioMake.tsx',
    'frontend/src/pages/ImageStudioPage.tsx',
    'frontend/src/components/dm/build/StudioInsertModal.tsx',
  ])('%s 화면 문구 = 내부 이름 · 모델명 0', (rel) => {
    expect(code(read(rel))).not.toMatch(/C112|Claude|Anthropic|Opus|Sonnet|Haiku|GPT|Gemini/i);
  });
});
