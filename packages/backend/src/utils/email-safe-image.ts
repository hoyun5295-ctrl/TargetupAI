/**
 * email-safe-image.ts — 메일에 싣는 사진 = 메일 프로그램이 다 보여 주는 형식(JPEG·PNG·GIF)만 (컨트롤타워 · ★2026-09-29)
 *
 * 경위: 서수란 접수 `cmukvvy0z014hjna6gvsefoo2` "AI영업 이메일 — 하이웍스는 보이는데 아웃룩은 이미지 깨짐".
 *   실측(Harold SQL · 토니모리 최신 메일 판) = 사진 9장 중 png·jpeg 2장은 아웃룩 정상, 상품 사진 7장은 WebP(RIFF…WEBP)라
 *   "연결된 이미지를 표시할 수 없습니다". 같은 메일 · 같은 서버 주소에서 형식만 갈랐다(윈도우용 아웃룩은 WebP 를 못 그린다 ·
 *   하이웍스는 브라우저가 그린다). WebP 가 들어온 길 = AI 영업 사진 수집(`fetchImageGuarded` 가 WebP·AVIF 를 받겠다고 요청)과
 *   DM·이메일 편집기 업로드(`/dm/upload-image` 가 WebP 허용) 두 갈래다.
 *
 * 방식 = **메일이 나가는 입구에서 바꾼다**(입구 = `company-smtp-client.ts sendEmail` · `outreach-mailer.ts sendViaOutreachAccount` 둘뿐).
 *   저장된 메일 판 · DM(모바일은 WebP 를 잘 그린다) · 미리보기는 그대로 두고, 나가는 HTML 의 우리 저장소 사진 주소만
 *   옆에 만든 사본(`원래이름.mail.jpg` · 투명이면 `.mail.png`)으로 갈아 끼운다. 이미 만든 메일 판도 다시 보내면 바로 고쳐진다.
 * 판별은 확장자가 아니라 **파일 머리**다 — 수집 경로가 AVIF 를 `.jpeg` 로 이름 붙인 파일도 잡는다.
 * ⛔ 이 함수는 절대 던지지 않는다. 변환 실패 · 우리 것이 아닌 주소 · 없는 파일 = 원래 주소 그대로(사진 때문에 발송이 멈추면 안 된다).
 * 사본 정리 = `image-serve.ts dropServeVariants`(원본 삭제 경로가 이미 부르는 CT)가 `emailSafeCopyPaths` 로 함께 지운다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';

// 저장소 위치 — routes/cdp.ts(인앱·소재) · routes/dm.ts(DM 업로드)와 동일 정의(단일 env 소스 · utils/assets.ts 와 같은 관례)
const INAPP_IMAGE_BASE = process.env.INAPP_IMAGE_PATH || path.resolve('./uploads/inapp');
const DM_IMAGE_DIR = path.join(process.cwd(), 'uploads', 'dm-images');

/** 사본 이름 꼬리(원래 이름 뒤에 붙인다 · 원본과 한 폴더 · 서빙 라우트가 확장자로 Content-Type 을 정한다) */
const COPY_MARK = '.mail';
/** JPEG 품질 — image-serve.ts SERVE_JPEG_QUALITY(92 · 표시 크기에서 원본과 평균차 1.07/255)와 같은 근거 */
const COPY_JPEG_QUALITY = 92;

export type SniffedFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'avif' | 'heic' | 'unknown';
/** 메일 프로그램이 못 그리는 형식(윈도우용 아웃룩 기준) */
const UNSAFE = new Set<SniffedFormat>(['webp', 'avif', 'heic']);

/** 파일 머리(앞 16바이트)로 형식을 가른다. */
export function sniffImageFormat(head: Buffer): SniffedFormat {
  if (!head || head.length < 12) return 'unknown';
  if (head[0] === 0xff && head[1] === 0xd8) return 'jpeg';
  if (head[0] === 0x89 && head.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (head.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (head.toString('ascii', 4, 8) === 'ftyp') {
    const brand = head.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'msf1' || brand === 'hevc') return 'heic';
  }
  return 'unknown';
}

/** 원본 경로 → 이 CT 가 만들 수 있는 사본 경로(정리용 · jpg·png 둘 다) */
export function emailSafeCopyPaths(originalPath: string): string[] {
  return [`${originalPath}${COPY_MARK}.jpg`, `${originalPath}${COPY_MARK}.png`];
}

export interface EmailSafeImageOptions {
  /** 저장소 위치(테스트 주입) */
  dirs?: { inapp: string; dm: string };
  /** 우리 서버로 인정하는 호스트(소문자) — 상대 주소는 늘 우리 것 */
  hosts?: string[];
}

function ourHosts(): string[] {
  const out = new Set<string>(['hanjul.ai', 'www.hanjul.ai']);
  try { const h = new URL(String(process.env.PUBLIC_BASE_URL || '')).hostname.toLowerCase(); if (h) out.add(h); } catch { /* 미설정 */ }
  return [...out];
}

// 원본 절대 경로 → 사본 파일 이름(바꿀 필요 없음·실패 = null). 같은 파일은 한 번만 판정 · 동시에 오면 한 번만 변환.
const verdictCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();
export function clearEmailSafeImageCache(): void { verdictCache.clear(); inflight.clear(); }

async function safeCopyNameFor(originalPath: string): Promise<string | null> {
  if (verdictCache.has(originalPath)) {
    const hit = verdictCache.get(originalPath)!;
    // 사본이 지워졌으면(원본 삭제·정리) 다시 판정한다
    if (hit === null || fs.existsSync(path.join(path.dirname(originalPath), hit))) return hit;
    verdictCache.delete(originalPath);
  }
  const running = inflight.get(originalPath);
  if (running) return running;
  const job = buildSafeCopy(originalPath)
    .then((name) => { verdictCache.set(originalPath, name); return name; })
    .catch(() => null)
    .finally(() => inflight.delete(originalPath));
  inflight.set(originalPath, job);
  return job;
}

async function buildSafeCopy(originalPath: string): Promise<string | null> {
  if (!fs.existsSync(originalPath)) return null;
  const buf = fs.readFileSync(originalPath);
  if (!UNSAFE.has(sniffImageFormat(buf.subarray(0, 16)))) return null;
  const [jpgPath, pngPath] = emailSafeCopyPaths(originalPath);
  // 이미 만든 사본이 있으면 그대로 쓴다(프로세스가 다시 떠도 다시 변환하지 않는다)
  for (const p of [jpgPath, pngPath]) {
    if (fs.existsSync(p) && fs.statSync(p).mtimeMs >= fs.statSync(originalPath).mtimeMs) return path.basename(p);
  }
  try {
    // 다중 프레임(움직이는 WebP)은 첫 장만 남는다 — 아웃룩은 어차피 못 그리므로 첫 장이라도 보이는 편이 낫다
    const meta = await sharp(buf, { failOn: 'none' }).metadata();
    if (!meta.width || !meta.height) return null;
    const pipe = sharp(buf, { failOn: 'none' }).rotate();
    const withAlpha = !!meta.hasAlpha;
    const out = withAlpha ? await pipe.png({ compressionLevel: 9 }).toBuffer() : await pipe.jpeg({ quality: COPY_JPEG_QUALITY, mozjpeg: true }).toBuffer();
    const dest = withAlpha ? pngPath : jpgPath;
    // 같은 사본을 동시에 만들어도 반쪽 파일이 나가지 않게 임시 파일에 쓰고 옮긴다
    const tmp = path.join(path.dirname(dest), `.tmp-mail-${randomUUID()}`);
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, dest);
    return path.basename(dest);
  } catch (err: any) {
    console.error('[email-safe-image] 메일용 사본을 만들지 못했습니다(원래 주소로 보냅니다):', path.basename(originalPath), err?.message);
    return null;
  }
}

// 우리 저장소 사진 주소 — (호스트)(경로 머리)(회사 id)/(파일 이름). 파일 이름 뒤의 ?·#·따옴표·괄호에서 끊긴다.
const OUR_IMAGE_RE = /(https?:\/\/[A-Za-z0-9.-]+(?::\d+)?)?(\/api\/(?:cdp\/inapp\/image|dm\/v\/images)\/)([0-9a-fA-F-]{36})\/([A-Za-z0-9_-][A-Za-z0-9._-]*)/g;

/**
 * 나가는 메일 HTML 의 우리 저장소 사진 중 메일 프로그램이 못 그리는 형식(WebP·AVIF·HEIC)을 JPEG·PNG 사본 주소로 바꾼다.
 * 그 밖의 것은 한 글자도 바꾸지 않는다. 절대 던지지 않는다(실패 = 원래 HTML).
 */
export async function emailSafeImageHtml(html: string, opts: EmailSafeImageOptions = {}): Promise<string> {
  try {
    const src = String(html ?? '');
    if (!src || (!src.includes('/api/cdp/inapp/image/') && !src.includes('/api/dm/v/images/'))) return src;
    const dirs = opts.dirs || { inapp: INAPP_IMAGE_BASE, dm: DM_IMAGE_DIR };
    const hosts = new Set((opts.hosts || ourHosts()).map((h) => h.toLowerCase()));
    const replacements = new Map<string, string>();
    for (const m of src.matchAll(OUR_IMAGE_RE)) {
      const [whole, origin, prefix, companyId, filename] = m;
      if (replacements.has(whole)) continue;
      if (origin) {
        let host = '';
        try { host = new URL(origin).hostname.toLowerCase(); } catch { /* 형식 밖 */ }
        if (!hosts.has(host)) continue;   // 남의 서버 = 우리 파일이 아니다
      }
      if (filename.includes('..')) continue;
      const base = prefix.includes('/dm/') ? dirs.dm : dirs.inapp;
      const originalPath = path.join(base, companyId, filename);
      const copyName = await safeCopyNameFor(originalPath);
      if (copyName) replacements.set(whole, `${origin || ''}${prefix}${companyId}/${copyName}`);
    }
    if (replacements.size === 0) return src;
    return src.replace(OUR_IMAGE_RE, (whole) => replacements.get(whole) ?? whole);
  } catch (err: any) {
    console.error('[email-safe-image] 사진 주소 점검 실패(원래 HTML 로 보냅니다):', err?.message);
    return String(html ?? '');
  }
}
