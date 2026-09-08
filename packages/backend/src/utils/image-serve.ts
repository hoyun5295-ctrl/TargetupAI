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

/** 표시 최대 폭(px) — 이메일 본문 552 · 셸 600의 2.5배. 위 주석의 실측이 이 값의 근거다. */
export const SERVE_MAX_WIDTH = 1400;

/** JPEG 인코딩 품질 — 92 = 표시 크기에서 원본과 평균차 1.07/255. */
export const SERVE_JPEG_QUALITY = 92;

/** 변환본이 쌓이는 하위 디렉터리 이름(회사 폴더 안). 원본과 섞이지 않게 숨김 이름을 쓴다. */
const CACHE_DIR_NAME = '.opt';

/** 변환 대상 확장자 — 정지 이미지만. gif는 애니메이션일 수 있어 제외한다. */
const OPTIMIZABLE = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** 이 CT가 이미지를 다룰 수 있는 형식인지(호출부가 미리 거를 때 쓴다). */
export function isOptimizableImage(filename: string): boolean {
  return OPTIMIZABLE.has(path.extname(filename).toLowerCase());
}

/**
 * 서빙할 파일의 실제 경로를 돌려준다.
 * 줄일 필요가 없거나(원본이 이미 작다) 변환에 실패하면 **원본 경로를 그대로** 돌려준다 —
 * 이 함수 때문에 이미지가 안 나가는 일은 없어야 한다(서빙은 실패보다 원본이 낫다).
 */
export async function getServePath(originalPath: string): Promise<string> {
  try {
    const ext = path.extname(originalPath).toLowerCase();
    if (!OPTIMIZABLE.has(ext)) return originalPath;
    if (!fs.existsSync(originalPath)) return originalPath;

    const dir = path.dirname(originalPath);
    const base = path.basename(originalPath);
    const cacheDir = path.join(dir, CACHE_DIR_NAME, String(SERVE_MAX_WIDTH));
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
    // 이미 표시 기준 안이면 변환 이득이 없다 — 원본을 그대로 낸다(재인코딩은 품질만 깎는다).
    if (!meta.width || meta.width <= SERVE_MAX_WIDTH) return originalPath;

    let pipeline = sharp(srcBuf).resize({ width: SERVE_MAX_WIDTH, withoutEnlargement: true });
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
