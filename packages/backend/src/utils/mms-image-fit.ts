/**
 * mms-image-fit.ts — 사진을 MMS 규격(JPG · 장당 300KB)에 맞추는 컨트롤타워
 * (★2026-09-10 대행발송 · 임은지 접수 cmttqx2gy0c8sjnotlvs441r1 · Harold 확정 "변환은 문제가 아니다")
 *
 * 입구 둘이 이 함수를 지난다:
 *   - 대행발송 화면 접수 업로드  routes/agency-send.ts  POST /api/agency-send/mms-image
 *   - 대행발송 메일 접수         utils/agency-send-email.ts  prepareMailMmsImages
 * 직원이 대행하던 시절에는 직원이 사진을 규격에 맞게 줄여 줬다. 기계로 옮겼으면 기계가 그 일을 한다.
 *
 * ⛔ 이미 규격인 JPG(SOI 바이트 · 300KB 이하)는 원본 바이트 그대로 둔다. 다시 인코딩하지 않는다.
 * ⛔ 규격 밖만 바꾼다: 회전 정보 반영 → 투명 배경 흰색 → 긴 변 1080 이하 → JPEG 품질을 낮춰 300KB 이하.
 *   긴 변 1080 = 라이브러리 소재 변환(python _save_jpeg_under)과 같은 값이다.
 *   출력은 순차(baseline) JPEG다 — 점진(progressive) JPEG는 통신사 호환이 확인되지 않았다.
 * ⛔ 파이썬 서비스를 부르지 않는다. 같은 프로세스의 sharp로 한다(변환 서비스 장애가 접수 장애가 되지 않게).
 * ⛔ 형식은 허용 목록으로만 받는다(jpeg·png·webp·gif·tiff·heif). SVG·PDF 같은 것은 사진으로 받지 않는다.
 * ⛔ 실패는 던지지 않고 사유를 돌려준다. 호출부가 파일별 사유로 반려한다(맞추지 못한 사진의 결말은 예전과 같다).
 */
import sharp from 'sharp';
import type { Metadata } from 'sharp';
import { LIMITS } from '../config/defaults';
import { isJpegBuffer } from './mms-image-util';

/** 변환 결과 긴 변 상한(px) */
export const MMS_FIT_MAX_EDGE = 1080;
/** 디코드 폭탄 방어 — 이 화소 수를 넘는 사진은 풀지 않는다(4800만 화소 휴대폰 사진까지 받는다) */
export const MMS_FIT_MAX_PIXELS = 50_000_000;
/** 화면 접수 원본 한 장 상한. 프론트 사전 검사(`MMS_AUTOFIT_MAX_UPLOAD_BYTES`)와 같은 값이어야 한다(계약 테스트) */
export const MMS_FIT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'tiff', 'heif']);
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);
/** 품질을 끝까지 낮춰도 넘으면 가로세로를 0.8배씩 줄여 다시 본다. 그 횟수 상한 */
const SHRINK_ROUNDS = 6;

export type MmsFitFailure = 'heic' | 'unsupported' | 'too_many_pixels' | 'unreadable' | 'cannot_fit';
export type MmsFitResult =
  | { ok: true; buffer: Buffer; converted: boolean; fromBytes: number; toBytes: number }
  | { ok: false; reason: MmsFitFailure };

/** ISO-BMFF ftyp 상자의 브랜드로 HEIC(HEVC 부호화)인지 본다. 디코더가 없어 못 읽을 때 사유를 가르는 용도 */
export function isHeicBuffer(buf: Buffer | null | undefined): boolean {
  if (!buf || buf.length < 16 || buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  if (HEIC_BRANDS.has(buf.toString('ascii', 8, 12))) return true;
  const boxEnd = Math.min(buf.readUInt32BE(0), buf.length);
  for (let o = 16; o + 4 <= boxEnd; o += 4) {
    if (HEIC_BRANDS.has(buf.toString('ascii', o, o + 4))) return true;
  }
  return false;
}

type RawImage = { data: Buffer; width: number; height: number; channels: 1 | 2 | 3 | 4 };

/** 한 번 풀어 둔 픽셀을 품질 이진 탐색으로 maxBytes 이하 JPEG로 만든다. 30까지 낮춰도 넘으면 null */
async function encodeUnder(img: RawImage, maxBytes: number): Promise<Buffer | null> {
  let lo = 30;
  let hi = 92;
  let best: Buffer | null = null;
  while (lo <= hi) {
    const q = (lo + hi) >> 1;
    const out = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: img.channels } })
      .jpeg({ quality: q, progressive: false })
      .toBuffer();
    if (out.length <= maxBytes) { best = out; lo = q + 1; } else { hi = q - 1; }
  }
  return best;
}

/**
 * 사진 한 장을 MMS 규격에 맞춘다.
 * @param opts 테스트용 상한 주입(기본 = 300KB · 5천만 화소)
 */
export async function fitMmsImage(
  input: Buffer,
  opts: { maxBytes?: number; maxPixels?: number } = {},
): Promise<MmsFitResult> {
  const maxBytes = opts.maxBytes ?? LIMITS.mmsImageSize;
  const maxPixels = opts.maxPixels ?? MMS_FIT_MAX_PIXELS;
  if (!input || input.length === 0) return { ok: false, reason: 'unreadable' };

  // 1) 이미 규격이면 그대로(원본 보존)
  if (isJpegBuffer(input) && input.length <= maxBytes) {
    return { ok: true, buffer: input, converted: false, fromBytes: input.length, toBytes: input.length };
  }

  // 2) 형식·크기 판정 — 헤더만 읽는다(픽셀을 풀기 전에 막는다)
  let meta: Metadata;
  try {
    meta = await sharp(input, { failOn: 'error' }).metadata();
  } catch {
    return { ok: false, reason: isHeicBuffer(input) ? 'heic' : 'unreadable' };
  }
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) return { ok: false, reason: 'unsupported' };
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) return { ok: false, reason: 'unreadable' };
  if (width * height > maxPixels) return { ok: false, reason: 'too_many_pixels' };

  // 3) 한 번만 푼다: 회전 반영 → 흰 배경 → 긴 변 상한
  let img: RawImage;
  try {
    const r = await sharp(input, { failOn: 'error', limitInputPixels: maxPixels })
      .autoOrient()
      .flatten({ background: '#ffffff' })
      .resize({ width: MMS_FIT_MAX_EDGE, height: MMS_FIT_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    img = { data: r.data, width: r.info.width, height: r.info.height, channels: r.info.channels };
  } catch {
    return { ok: false, reason: isHeicBuffer(input) ? 'heic' : 'unreadable' };
  }

  // 4) 품질을 낮춰 맞추고, 그래도 넘으면 가로세로를 줄여 다시 본다
  for (let round = 0; round <= SHRINK_ROUNDS; round++) {
    const out = await encodeUnder(img, maxBytes);
    if (out) return { ok: true, buffer: out, converted: true, fromBytes: input.length, toBytes: out.length };
    if (round === SHRINK_ROUNDS) break;
    const w = Math.max(1, Math.floor(img.width * 0.8));
    const h = Math.max(1, Math.floor(img.height * 0.8));
    const r = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: img.channels } })
      .resize(w, h)
      .raw()
      .toBuffer({ resolveWithObject: true });
    img = { data: r.data, width: r.info.width, height: r.info.height, channels: r.info.channels };
  }
  return { ok: false, reason: 'cannot_fit' };
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`;
}

/** 파일별 반려 사유(사용자 노출 · 줄표 0). 화면 접수·메일 회신이 같은 문장을 쓴다 */
export function describeMmsFitFailure(name: string, reason: MmsFitFailure): string {
  const maxKb = Math.floor(LIMITS.mmsImageSize / 1024);
  switch (reason) {
    case 'heic': return `${name}: 아이폰 고효율 사진(HEIC)은 읽을 수 없습니다. JPG로 저장한 파일을 사용해 주세요.`;
    case 'unsupported': return `${name}: 사진으로 읽을 수 없는 형식입니다. JPG나 PNG 파일을 사용해 주세요.`;
    case 'too_many_pixels': return `${name}: 사진 해상도가 너무 큽니다. 크기를 줄인 파일을 사용해 주세요.`;
    case 'cannot_fit': return `${name}: ${maxKb}KB 이하로 줄이지 못했습니다. 크기를 줄인 파일을 사용해 주세요.`;
    default: return `${name}: 이미지 파일을 읽지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.`;
  }
}

/** 맞춘 사진 한 장의 고지 문구 조각: "포스터.png (2.3MB → 273KB)" */
export function describeMmsFitNote(name: string, fromBytes: number, toBytes: number): string {
  return `${name} (${formatBytes(fromBytes)} → ${formatBytes(toBytes)})`;
}

/**
 * multer가 latin1로 읽은 한글 파일명을 되돌린다. 이미 유니코드(0xFF 초과 글자)면 그대로 둔다.
 * 되돌린 결과에 깨진 글자(U+FFFD)가 생기면 원래 값을 쓴다.
 */
export function restoreUploadFileName(raw: string | null | undefined): string {
  const s = String(raw || '');
  if (!s || /[^\u0000-\u00ff]/.test(s)) return s;
  const utf8 = Buffer.from(s, 'latin1').toString('utf8');
  return utf8.includes('\uFFFD') ? s : utf8;
}
