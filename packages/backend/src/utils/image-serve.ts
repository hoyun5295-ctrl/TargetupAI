/**
 * image-serve.ts — 업로드 이미지 서빙 최적화 컨트롤타워 (2026-09-08)
 *
 * 경위: 남지현 접수 `cmtqsp5uw09yujnot3k93uh62` 진단 중, 발송된 메일에 **1792×2400 · 2.4MB** 원본이
 *   그대로 실려 나가는 것이 드러났다(탑텐 캠페인 쿠폰 이미지). 업로드 4곳(dm·cdp·campaign-agency·mms)
 *   어디에도 리사이즈가 없었다.
 *
 * 방식 = **서빙 시 변환 + 디스크 캐시**. 업로드 시점에 줄이지 않는 이유는 둘이다.
 *   ①원본을 그대로 보존한다(품질이 필요해지면 되돌릴 수 있다) ②이미 올라간 기존 이미지까지 커버한다
 *   (업로드 시점 처리는 신규분만 고친다 — 이번 접수의 그 이미지는 재업로드 없이는 안 바뀐다).
 *
 * 품질 기준(실측 근거): 이메일 본문 표시 폭 552px · 셸 600px이 최대다. 여기의 2.5배인 **1400px**까지 남기고
 *   JPEG 품질 92(mozjpeg)로 인코딩하면, 표시 크기로 되돌렸을 때 원본과의 채널 평균차가 1.07/255다
 *   (식별 불가 수준 · 8 초과로 벌어진 픽셀 0.10%). 용량은 2,391KB → 241KB로 90% 줄었다.
 *   ⛔ 이 값을 낮추려면 같은 방식으로 다시 실측한다. "작게가 좋다"로 내리면 고객 산출물의 품질이 깎인다.
 *
 * ⛔ MMS 이미지(`mms-images.ts`)는 이 CT를 쓰지 않는다 — 통신사 규격(해상도·용량)이 따로 있어
 *   우리 표시 기준으로 줄이면 발송이 거부될 수 있다.
 * ⛔ 애니메이션(GIF·다중 프레임 WebP)은 변환하지 않고 원본을 그대로 낸다(프레임이 깨진다).
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import type { Sharp } from 'sharp';

/** 표시 최대 폭(px) — 이메일 본문 552 · 셸 600의 2.5배. 위 주석의 실측이 이 값의 근거다. */
export const SERVE_MAX_WIDTH = 1400;

/** JPEG 인코딩 품질 — 92 = 표시 크기에서 원본과 평균차 1.07/255. */
export const SERVE_JPEG_QUALITY = 92;

/** 변환본이 쌓이는 하위 디렉터리 이름(회사 폴더 안). 원본과 섞이지 않게 숨김 이름을 쓴다. */
const CACHE_DIR_NAME = '.opt';

/**
 * ★ 2026-09-08(2) 비율 맞춤(레터박스) — 상품 카드에서 사진 크기가 제각각으로 보이던 것.
 *
 * 경위: 상품 격자는 `object-fit:contain`으로 그린다(0905 "이미지 다 짤리게" 지적으로 cover에서 바꾼 자리).
 *   contain은 원본 비율을 보존하므로 가로형은 위아래, 세로형은 좌우에 여백이 생겨 **사진 크기가 서로 달라 보인다**.
 *   cover로 되돌리면 크기는 맞지만 잘림이 되살아난다 - 두 요구가 정면으로 부딪힌다.
 *
 * 해법 = **이미지 자체를 같은 비율로 만들어 내보낸다.** 사진은 안 잘리고(원본 전체가 들어간다)
 *   모든 상품이 같은 크기로 보인다. 뷰어가 CSS를 어떻게 다루든 결과가 흔들리지 않는 것도 이 방식의 이점이다.
 *
 * ★ 남는 자리는 **사진마다 다르게** 채운다 — 한 방식으로 통일하면 어느 한쪽이 반드시 흉해진다(비교 캡처로 확인).
 *   ①가장자리 색이 균일하면(단색 배경 스튜디오 컷) 그 색으로 → 이음매가 아예 안 보인다.
 *   ②복잡하면 원본을 캔버스 크기로 채워 흐리게 깐 뒤 그 위에 원본을 얹는다(블러 확장) → 배경이 자연스레 이어진다.
 *   판별 기준 = `EDGE_UNIFORM_THRESHOLD`(image-fit-spec.ts가 근거와 함께 소유).
 *
 * 규격(비율 표·기본 키·판별 기준)은 `image-fit-spec.ts`가 소유한다 - 렌더러가 sharp를 끌어오지 않게 뗀 것이다.
 */
export { ASPECT_RATIOS, PRODUCT_GRID_ASPECT } from './image-fit-spec';
import { ASPECT_RATIOS, EDGE_UNIFORM_THRESHOLD, FIT_MODES, type FitMode } from './image-fit-spec';

/** 변환 대상 확장자 — 정지 이미지만. gif는 애니메이션일 수 있어 제외한다. */
const OPTIMIZABLE = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** 이 CT가 이미지를 다룰 수 있는 형식인지(호출부가 미리 거를 때 쓴다). */
export function isOptimizableImage(filename: string): boolean {
  return OPTIMIZABLE.has(path.extname(filename).toLowerCase());
}

/** 요청 쿼리에서 비율 맞춤 지시를 읽어 정규화한다. 화이트리스트 밖·형식 위반은 **무시**(= 맞춤 없음).
 *  여백을 무엇으로 채울지는 요청이 정하지 않는다 — 사진을 보고 서버가 고른다(위 주석 ①②). */
export function parseFitOption(query: unknown): { aspect: string; mode: FitMode } | null {
  const q = (query || {}) as Record<string, unknown>;
  const aspect = String(q.fit || '').trim();
  if (!ASPECT_RATIOS[aspect]) return null;
  const raw = String(q.mode || 'pad').trim();
  const mode = (FIT_MODES as readonly string[]).includes(raw) ? (raw as FitMode) : 'pad';
  return { aspect, mode };
}

/** 가장자리 픽셀의 평균색과 흩어진 정도. 흩어짐이 작다 = 단색 배경 사진이라 그 색으로 이어 붙일 수 있다. */
async function edgeStats(buf: Buffer): Promise<{ rgb: [number, number, number]; deviation: number }> {
  const N = 64;
  const { data, info } = await sharp(buf).resize(N, N, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const px: Array<[number, number, number]> = [];
  for (let i = 0; i < N; i++) {
    for (const [x, y] of [[i, 0], [i, N - 1], [0, i], [N - 1, i]] as Array<[number, number]>) {
      const o = (y * N + x) * ch;
      px.push([data[o], data[o + 1], data[o + 2]]);
    }
  }
  const mean = [0, 1, 2].map((c) => px.reduce((s, p) => s + p[c], 0) / px.length) as [number, number, number];
  const variance = px.reduce((s, p) => s + [0, 1, 2].reduce((t, c) => t + (p[c] - mean[c]) ** 2, 0), 0) / (px.length * 3);
  return { rgb: mean.map(Math.round) as [number, number, number], deviation: Math.sqrt(variance) };
}

/** 비율 캔버스로 굽는다. `crop`이면 꽉 채우고 넘치는 가장자리를 자른다(편집기의 "채우기" 선택 그대로). */
async function fitToCanvas(buf: Buffer, canvasW: number, canvasH: number, mode: FitMode): Promise<Buffer> {
  if (mode === 'crop') {
    return sharp(buf).resize({ width: canvasW, height: canvasH, fit: 'cover', position: 'centre' }).toBuffer();
  }
  const { rgb, deviation } = await edgeStats(buf);
  if (deviation < EDGE_UNIFORM_THRESHOLD) {
    // 단색 배경 — 그 색으로 이어 붙이면 이음매가 보이지 않는다.
    return sharp(buf)
      .resize({ width: canvasW, height: canvasH, fit: 'contain', background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 } })
      .toBuffer();
  }
  // 복잡한 배경 — 사진을 캔버스만큼 채워 흐리게 깔고(살짝 밝혀 앞의 사진이 도드라지게) 그 위에 원본을 얹는다.
  const background = await sharp(buf).resize({ width: canvasW, height: canvasH, fit: 'cover' }).blur(24).modulate({ brightness: 1.03 }).toBuffer();
  const foreground = await sharp(buf).resize({ width: canvasW, height: canvasH, fit: 'inside' }).toBuffer();
  return sharp(background).composite([{ input: foreground, gravity: 'center' }]).toBuffer();
}

/**
 * 서빙할 파일의 실제 경로를 돌려준다.
 * 줄일 필요가 없거나(원본이 이미 작다) 변환에 실패하면 **원본 경로를 그대로** 돌려준다 —
 * 이 함수 때문에 이미지가 안 나가는 일은 없어야 한다(서빙은 실패보다 원본이 낫다).
 *
 * `fit`을 주면 그 비율로 캔버스를 만들어 원본을 통째로 넣고(잘림 0) 남는 자리를 `bg`로 채운다.
 */
export async function getServePath(
  originalPath: string,
  fit?: { aspect: string; mode?: FitMode } | null,
): Promise<string> {
  try {
    const ext = path.extname(originalPath).toLowerCase();
    if (!OPTIMIZABLE.has(ext)) return originalPath;
    if (!fs.existsSync(originalPath)) return originalPath;

    const ratio = fit && ASPECT_RATIOS[fit.aspect] ? ASPECT_RATIOS[fit.aspect] : null;
    const mode: FitMode = fit?.mode === 'crop' ? 'crop' : 'pad';
    const variant = ratio ? `${SERVE_MAX_WIDTH}-${fit!.aspect}-${mode}` : String(SERVE_MAX_WIDTH);

    const dir = path.dirname(originalPath);
    const base = path.basename(originalPath);
    const cacheDir = path.join(dir, CACHE_DIR_NAME, variant);
    const cachePath = path.join(cacheDir, base);

    // 캐시가 원본보다 새것이면 그대로 쓴다(원본이 교체되면 다시 만든다).
    const srcStat = fs.statSync(originalPath);
    if (fs.existsSync(cachePath)) {
      const cacheStat = fs.statSync(cachePath);
      if (cacheStat.mtimeMs >= srcStat.mtimeMs) return cachePath;
    }

    // ⛔ 파일 경로를 sharp에 직접 주지 않는다 — 처리 뒤에도 핸들이 남아 원본 교체·정리가 막힌다(윈도우에서 재현).
    //   업로드 상한이 5MB라 버퍼로 읽는 비용은 작다.
    const srcBuf = fs.readFileSync(originalPath);
    const meta = await sharp(srcBuf).metadata();
    // 애니메이션(다중 프레임)은 손대지 않는다.
    if ((meta.pages || 1) > 1) return originalPath;
    if (!meta.width || !meta.height) return originalPath;

    // 할 일이 없으면 원본을 그대로 낸다(재인코딩은 품질만 깎는다).
    //   비율 맞춤이 없으면 = 이미 표시 기준 안일 때 / 있으면 = 이미 그 비율이고 표시 기준 안일 때.
    const alreadyRatio = ratio ? meta.width * ratio.h === meta.height * ratio.w : false;
    if (meta.width <= SERVE_MAX_WIDTH && meta.height <= SERVE_MAX_WIDTH && (!ratio || alreadyRatio)) return originalPath;

    let pipeline: Sharp;
    if (ratio) {
      // 캔버스 크기는 **모드에 따라 다르다** — 어느 쪽도 원본을 확대하지 않아야 화질이 안 깎인다.
      //   pad(맞추기)  = 긴 변 기준. 원본이 통째로 들어가고 짧은 쪽만 채워진다.
      //   crop(채우기) = 짧은 변 기준. 긴 쪽을 잘라내기만 한다(긴 변 기준으로 잡으면 원본을 확대해 자르게 된다).
      const canvasW = Math.min(
        SERVE_MAX_WIDTH,
        mode === 'crop' ? Math.min(meta.width, meta.height) : Math.max(meta.width, meta.height),
      );
      const canvasH = Math.round((canvasW * ratio.h) / ratio.w);
      pipeline = sharp(await fitToCanvas(srcBuf, canvasW, canvasH, mode));
    } else {
      pipeline = sharp(srcBuf).resize({ width: SERVE_MAX_WIDTH, withoutEnlargement: true });
    }
    if (ext === '.png') {
      // PNG는 무손실 유지(투명도·선명한 경계가 이유로 PNG를 골랐을 것이다).
      pipeline = pipeline.png({ compressionLevel: 9 });
    } else if (ext === '.webp') {
      pipeline = pipeline.webp({ quality: SERVE_JPEG_QUALITY });
    } else {
      pipeline = pipeline.jpeg({ quality: SERVE_JPEG_QUALITY, mozjpeg: true });
    }
    const buf = await pipeline.toBuffer();

    // 같은 파일을 동시에 요청해도 반쪽 파일이 서빙되지 않게 임시 파일에 쓰고 원자적으로 옮긴다.
    fs.mkdirSync(cacheDir, { recursive: true });
    const tmp = path.join(cacheDir, `.tmp-${randomUUID()}`);
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, cachePath);
    return cachePath;
  } catch {
    // 변환 실패(손상 파일·형식 불일치·디스크 문제)는 원본 서빙으로 흘린다.
    return originalPath;
  }
}
