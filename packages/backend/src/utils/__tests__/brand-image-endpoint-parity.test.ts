/**
 * 브랜드 이미지 업로드 엔드포인트 파리티 계약 (★2026-08-28)
 *
 * 왜 있나
 *   업로드 실패는 **배포 후에야 보인다.** 화면은 파일을 고르는 데까지 정상으로 보이고,
 *   서버가 필드를 못 찾아 400을 낼 뿐이라 tsc·테스트·빌드가 전부 통과한다.
 *   실제로 0828 화면 재작성 직후 **세 자리가 어긋나 있었다** — 배열 엔드포인트
 *   (`/wide-list` · `/carousel-feed` · `/carousel-commerce`)에 `image` 한 장을 보내고 있었고,
 *   그대로 배포했으면 캐러셀 카드와 와이드리스트 2번 이후 이미지가 전부 올라가지 않았다.
 *
 * 못 박는 것
 *   백엔드 라우트가 `upload.single('image')`인지 `upload.array('images')`인지와,
 *   프론트 `IMG_EP`의 `multi` 값이 경로별로 정확히 일치한다.
 *
 * ⚠ 양쪽 소스를 텍스트로 읽어 비교한다(패키지 경계를 넘는 import를 만들지 않는다).
 *   선례 = `brand-spec-parity.test.ts` · `admin-role-label-parity.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const BE = path.resolve(__dirname, '../../routes/alimtalk.ts');
const FE = path.resolve(__dirname, '../../../../frontend/src/components/alimtalk/BrandTemplateForm.tsx');

/** 백엔드에서 `/images/brand/...` 라우트별 multer 형태를 뽑는다 */
function parseBackend(): Record<string, boolean> {
  const src = fs.readFileSync(BE, 'utf8');
  const out: Record<string, boolean> = {};
  // router.post(\n '/images/brand/xxx',\n ...,\n upload.single('image') | upload.array('images', N),
  const re = /'(\/images\/brand\/[a-z/-]+)'[\s\S]{0,400}?upload\.(single|array)\(\s*'(image|images)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out[m[1]] = m[2] === 'array';
  }
  return out;
}

/** 프론트 IMG_EP에서 { 경로: multi } 를 뽑는다 */
function parseFrontend(): Record<string, boolean> {
  const src = fs.readFileSync(FE, 'utf8');
  const start = src.indexOf('const IMG_EP = {');
  if (start < 0) throw new Error('프론트 IMG_EP 선언을 찾지 못했다 — 이름이 바뀌었으면 이 계약도 함께 고친다');
  const block = src.slice(start, src.indexOf('} as const satisfies', start));
  const out: Record<string, boolean> = {};
  // 프론트 경로는 `/api/alimtalk/images/brand/...` 이고 백엔드 라우터는 `/images/brand/...`로 마운트된다.
  // 비교 키는 뒤쪽 공통 부분이다.
  const re = /url:\s*'\/api\/alimtalk(\/images\/brand\/[a-z/-]+)'\s*,\s*multi:\s*(true|false)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    out[m[1]] = m[2] === 'true';
  }
  return out;
}

describe('이미지 업로드 필드 형태가 백엔드와 프론트에서 같다', () => {
  const be = parseBackend();
  const fe = parseFrontend();

  it('추출 자체가 비면 이 계약이 죽은 것이다', () => {
    expect(Object.keys(be).length, '백엔드 라우트 추출 0건').toBeGreaterThan(0);
    expect(Object.keys(fe).length, '프론트 IMG_EP 추출 0건').toBeGreaterThan(0);
  });

  it('프론트가 부르는 경로는 전부 백엔드에 있다', () => {
    for (const p of Object.keys(fe)) {
      expect(be[p], `${p}: 백엔드에 이 라우트가 없다`).toBeDefined();
    }
  });

  it('경로마다 single/array 형태가 같다', () => {
    for (const [p, multi] of Object.entries(fe)) {
      expect(multi, `${p}: 백엔드=${be[p] ? "array('images')" : "single('image')"}인데 프론트 multi=${multi}`)
        .toBe(be[p]);
    }
  });

  it('화면이 필드명을 직접 적지 않는다 (엔드포인트가 소유한다)', () => {
    const src = fs.readFileSync(FE, 'utf8');
    // fd.append(...)는 `ep.multi ? 'images' : 'image'` 한 자리에서만 나와야 한다
    const appends = src.match(/fd\.append\([^)]*\)/g) || [];
    expect(appends.length, `fd.append가 ${appends.length}곳 — 한 곳이어야 한다`).toBe(1);
    expect(appends[0]).toContain('ep.multi');
  });
});
