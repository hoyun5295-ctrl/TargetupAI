/**
 * brand-image-resolver — 자유형 브랜드메시지 이미지의 **카카오 콘텐츠 서버 확정** (2026-09-02)
 *
 * 왜 있나
 *   `ATTACHMENT.image.img_url`에는 **카카오 콘텐츠 서버에 업로드된 URL만** 실을 수 있다.
 *   외부 URL(우리 웹서버 포함)은 규격 밖이다. `image.imc.*` 계열은 IMC 에이전트 설치 서버의
 *   로컬 이미지를 대신 올려 주는 에이전트 전용 기능이라, 소켓 직연동인 우리는 쓸 수 없다.
 *   (2026-09-02 IMC 회신 — 매뉴얼 §6.10.5 표기 혼선이 이 회신으로 닫혔다)
 *
 *   그런데 자유형 편집기는 이미지를 우리 자산 저장소(`/api/cdp/inapp/image/...`)에 올리고
 *   그 URL을 그대로 실어 보내고 있었다. 실측 = 2026-09-01 14:04 IMAGE 2건이
 *   `img_url: https://hanjul.ai/api/cdp/inapp/image/...`로 나가 `status_code 9999`로 종료됐다
 *   (같은 발신프로필·같은 `k_etc_json` 구조의 TEXT 건은 1800 성공 — 이미지 유형만 죽었다).
 *
 * 어디에 있나 — **발송 조립 경로 안**이다(`sendBrandMessage`).
 *   입구가 화면 하나가 아니라서(라이브러리·업로드·AI 생성) 화면에서 막으면 다른 입구로 샌다.
 *   게이트는 효과가 만들어지는 함수 안에 둔다.
 *
 * ⛔ 순서 계약 — **AI 생성 이미지 판정(`isBrandImageAiGenerated`)이 먼저, 치환이 나중**이다.
 *   그 판정은 "카카오가 내려받는 실물"인 `img_url`의 라이브러리 행을 근거로 삼는다
 *   (asset_id를 믿으면 id와 URL을 엇갈리게 보내 표시를 우회할 수 있다 — 0901 Codex 1R H1).
 *   치환을 먼저 하면 URL이 우리 경로가 아니게 되어 판정이 통째로 false가 되고, 안내 문구가
 *   조용히 사라진다. 두 호출의 순서를 바꾸지 말 것.
 *
 * ⛔ 차감보다 앞에서 돈다. 업로드 실패는 발송을 세우지만 돈은 움직이지 않는다.
 */
import fs from 'fs';
import path from 'path';
import { query } from '../config/database';
import * as imc from './alimtalk-api';
import { extractImageFromAnyShape } from './alimtalk-api';

/** 인앱 이미지 실물 저장 경로 — `utils/assets.ts`·`routes/cdp.ts`와 동일 정의(단일 env 소스) */
const INAPP_IMAGE_BASE = process.env.INAPP_IMAGE_PATH || path.resolve('./uploads/inapp');

/** 우리 공개 서빙 경로 — `{companyId}/{filename}`까지 정확히 맞을 때만 우리 파일로 인정한다 */
const OWN_IMAGE_RE = /^\/api\/cdp\/inapp\/image\/([^/]+)\/([^/?#]+)$/;

/** DNS 표기 정규화 — 소문자 + root dot 제거(`hanjul.ai.` = `hanjul.ai`) */
const normalizeHost = (h: string): string => h.toLowerCase().replace(/\.$/, '');

/** 절대 URL을 우리 서빙으로 인정할 호스트 — `brand-message.ts`와 같은 env 규약 */
function trustedImageHosts(): Set<string> {
  const hosts = new Set<string>(['hanjul.ai', 'app.hanjul.ai', 'localhost', '127.0.0.1']);
  for (const v of [process.env.HANJUL_BASE_URL, process.env.PUBLIC_BASE_URL]) {
    if (!v) continue;
    try { hosts.add(normalizeHost(new URL(v).hostname)); } catch { /* 잘못된 env 값은 무시 */ }
  }
  return hosts;
}

/**
 * 유형 → IMC 업로드 창구. 카카오가 유형마다 다른 규격(비율·크기)을 요구해서 창구가 갈린다.
 * ⛔ 여기 없는 유형은 **치환하지 않고 그대로 통과**한다 — 창구를 추측해서 고르면 규격이 어긋난
 *    이미지를 올리게 된다. 늘릴 때는 매뉴얼에서 그 유형의 창구를 확인한 뒤 한 줄씩 추가한다.
 *    (현재 편집기가 낼 수 있는 이미지 유형 = IMAGE·WIDE 둘뿐이다)
 */
const UPLOAD_BY_BUBBLE: Record<string, { uploadType: string; upload: (buf: Buffer, name: string) => Promise<any> }> = {
  // 참조를 캡처하지 않고 호출 시점에 찾는다(모듈 로드 순서·대역 교체에 영향받지 않게).
  IMAGE: { uploadType: 'brand_send_default', upload: (b, n) => imc.uploadBrandDefaultImage(b, n) },
  WIDE: { uploadType: 'brand_send_wide', upload: (b, n) => imc.uploadBrandWideImage(b, n) },
};

export class BrandImageResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrandImageResolveError';
  }
}

/**
 * 우리 서빙 URL인가 — **조립기의 거부 게이트와 여기가 같은 판정을 써야 한다.**
 * 판정이 두 벌이면 한쪽이 통과시킨 것을 다른 쪽이 막거나 그 반대가 된다.
 */
export function isOwnServingImageUrl(imgUrl: unknown): boolean {
  return toOwnImageRef(String(imgUrl || '').trim()) !== null;
}

/** 우리 서빙 URL이면 `{companyId, filename}`, 아니면 null */
function toOwnImageRef(imgUrl: string): { companyId: string; filename: string } | null {
  let pathname: string | null = null;
  if (imgUrl.startsWith('/api/cdp/inapp/image/')) {
    pathname = imgUrl.split(/[?#]/)[0];
  } else {
    try {
      const u = new URL(imgUrl);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      if (!trustedImageHosts().has(normalizeHost(u.hostname))) return null;
      pathname = u.pathname;
    } catch {
      return null;
    }
  }
  const m = pathname.match(OWN_IMAGE_RE);
  if (!m) return null;
  return { companyId: m[1], filename: m[2] };
}

/**
 * **우리가 올린 URL인가** — 허용 목록 판정.
 *
 * ★2026-09-02 Codex 1R high1 수용. 처음에는 "자사 서빙 URL이 아니면 그대로 통과"였는데,
 * 그러면 인증 사용자가 API로 임의 URL을 직접 넣어 화면 제거를 우회할 수 있었다(외부 URL은
 * 종전과 같은 9999, 남의 카카오 CDN URL은 **타사 소재 재사용**). 카카오 콘텐츠 호스트 목록을
 * 우리가 확정할 수 없으므로 호스트로 가르지 않는다 — **우리 업로드 이력에 남은 URL만** 통과시킨다.
 * 그것이 "우리가 올린 것"의 유일한 증명이다(차단 목록이 아니라 허용 목록).
 *
 * ⛔ 회사 경계가 곧 판정 경계다 — 남의 회사가 올린 URL은 통과시키지 않는다.
 * ⛔ **업로드 유형도 함께 본다**(★Codex 2R high1 수용) — 카카오는 유형마다 규격이 다르므로
 *    IMAGE용으로 올린 URL을 WIDE 발송에 실으면 규격이 어긋나 같은 9999가 난다. 회사·URL만
 *    맞추면 "재업로드를 우회하는 통로"가 된다.
 */
async function isOurUploadedImage(companyId: string, imageUrl: string, uploadType: string): Promise<boolean> {
  const r = await query(
    `SELECT 1
       FROM kakao_image_uploads
      WHERE company_id = $1::uuid
        AND image_url = $2
        AND upload_type = $3
      LIMIT 1`,
    [companyId, imageUrl, uploadType],
  );
  return (r.rows?.length || 0) > 0;
}

async function rememberUpload(input: {
  companyId: string;
  userId?: string | null;
  uploadType: string;
  imageName: string;
  imageUrl: string;
  filename: string;
  bytes: number;
}): Promise<void> {
  // ⛔ 기록 실패는 발송을 세우지 않는다. 다만 이 기록은 **다음 발송의 허용 목록 근거**이므로,
  //   실패하면 그 URL로 재발송·예약을 걸 때 거절될 수 있다(그때는 이미지를 다시 고르면 된다).
  //   조용히 통과시키는 쪽(fail-open)보다 이쪽이 안전하다.
  try {
    await query(
      `INSERT INTO kakao_image_uploads
         (company_id, user_id, upload_type, image_name, image_url,
          original_filename, file_size, created_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, now())`,
      [
        input.companyId,
        input.userId || null,
        input.uploadType,
        input.imageName,
        input.imageUrl,
        input.filename,
        input.bytes,
      ],
    );
  } catch (e: any) {
    console.warn('[brand-image-resolver] 업로드 캐시 기록 실패(발송은 계속):', e?.message);
  }
}

/**
 * 이미지 URL 하나를 카카오 URL로 확정한다. 세 갈래뿐이다.
 *   - 우리 서빙 URL      → 로컬 파일을 읽어 IMC에 올리고 반환 URL로 치환
 *   - 우리가 올린 URL    → 그대로 통과(재발송·예약분)
 *   - 그 밖             → **거절**(fail-closed)
 *
 * 자기 서버를 HTTP로 다시 부르지 않고 **디스크에서 직접 읽는다** — 임의 URL을 내려받는 통로를
 * 만들지 않기 위해서다.
 *
 * ⛔ **업로드 결과를 캐시해 재사용하지 않는다.** 카카오 URL의 수명을 우리가 모르기 때문이다
 *    (IMC가 만료 시점을 주는지 미확인). 만료분을 재사용하면 이번 사고와 **똑같은 증상**
 *    (큐에는 들어가고 발송만 9999)이 재현되고, 예약 발송은 조립 시점에 URL이 굳어 더 위험하다.
 *    발송 한 건당 업로드 한 번이라 아끼는 값도 크지 않다(수신자 수와 무관). ★Codex 1R high3 수용.
 *    `kakao_image_uploads` 기록은 **재사용이 아니라 위 허용 목록 판정의 근거**로 계속 남긴다.
 */
async function resolveOne(input: {
  companyId: string;
  userId?: string | null;
  bubbleType: string;
  imgUrl: string;
}): Promise<string> {
  const ref = toOwnImageRef(input.imgUrl);
  const route = UPLOAD_BY_BUBBLE[String(input.bubbleType || '').trim().toUpperCase()];

  if (!ref) {
    // 우리 서빙 URL이 아니다 — **그 유형으로** 우리가 올린 것일 때만 통과시킨다.
    // 창구를 모르는 유형은 판정할 근거가 없으므로 손대지 않고 넘긴다(조립기가 뒤에서 본다).
    if (!route) return input.imgUrl;
    if (await isOurUploadedImage(input.companyId, input.imgUrl, route.uploadType)) return input.imgUrl;
    throw new BrandImageResolveError(
      '이미지를 확인할 수 없습니다. 라이브러리에서 이미지를 선택하거나 새로 올린 뒤 발송해주세요',
    );
  }

  if (!route) return input.imgUrl;   // 창구를 모르는 유형은 손대지 않는다(위 표 주석)

  // 다른 회사의 자산 경로는 올리지 않는다 — URL만 바꿔 남의 소재를 발송에 태우는 통로가 된다.
  if (ref.companyId !== input.companyId) {
    throw new BrandImageResolveError('첨부한 이미지를 사용할 수 없습니다. 이미지를 다시 선택해주세요');
  }
  // 경로 조작 차단 — 서빙 라우트(routes/cdp.ts)와 같은 규칙.
  if (ref.filename.includes('..') || ref.filename.includes('/') || ref.filename.includes('\\')) {
    throw new BrandImageResolveError('첨부한 이미지를 사용할 수 없습니다. 이미지를 다시 선택해주세요');
  }

  const filePath = path.join(INAPP_IMAGE_BASE, ref.companyId, ref.filename);
  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    throw new BrandImageResolveError('첨부한 이미지 파일을 찾을 수 없습니다. 이미지를 다시 올려주세요');
  }

  let res: any;
  try {
    res = await route.upload(buf, ref.filename);
  } catch (e: any) {
    // IMC 오류 원문은 사용자에게 그대로 내지 않는다(내부 식별자·엔드포인트가 섞여 있다).
    console.error('[brand-image-resolver] 카카오 이미지 업로드 실패:', e?.message);
    throw new BrandImageResolveError('이미지를 카카오에 등록하지 못했습니다. 잠시 후 다시 시도해주세요');
  }
  if (res?.code !== '0000') {
    console.error(
      `[brand-image-resolver] 카카오 이미지 업로드 거절 code=${res?.code} message=${String(res?.message || '').slice(0, 200)}`,
    );
    throw new BrandImageResolveError(
      `카카오가 이미지를 받지 않았습니다${res?.message ? ` (${String(res.message).slice(0, 80)})` : ''}. 다른 이미지를 사용해주세요`,
    );
  }
  const { imageUrl, imageName } = extractImageFromAnyShape(res);
  if (!imageUrl) {
    console.error('[brand-image-resolver] 업로드 응답에 imageUrl 없음:', JSON.stringify(res).slice(0, 400));
    throw new BrandImageResolveError('이미지 등록 결과를 확인하지 못했습니다. 잠시 후 다시 시도해주세요');
  }

  await rememberUpload({
    companyId: input.companyId,
    userId: input.userId,
    uploadType: route.uploadType,
    imageName: imageName || ref.filename,
    imageUrl,
    filename: ref.filename,
    bytes: buf.length,
  });
  return imageUrl;
}

/**
 * 발송 직전 이미지 확정 — 첨부에서 이미지를 쓰는 자리를 여기 한 곳에서 통과시킨다.
 * 입력 객체를 **바꾸지 않고** 새 객체를 돌려준다(호출부가 원본 URL로 판정을 이미 끝냈다).
 */
export async function resolveBrandSendImage(input: {
  companyId: string;
  userId?: string | null;
  bubbleType: string;
  image?: { img_url: string; img_link?: string; asset_id?: string };
}): Promise<{ img_url: string; img_link?: string; asset_id?: string } | undefined> {
  const img = input.image;
  if (!img || !String(img.img_url || '').trim()) return img;
  const resolved = await resolveOne({
    companyId: input.companyId,
    userId: input.userId,
    bubbleType: input.bubbleType,
    imgUrl: String(img.img_url).trim(),
  });
  return resolved === img.img_url ? img : { ...img, img_url: resolved };
}

/**
 * 이미 조립된 ATTACHMENT JSON **문자열**을 받는 경로용(AI 캠페인·직접발송·워커).
 * 그 경로들은 객체가 아니라 문자열을 들고 다녀서 위 함수를 쓸 수 없다.
 *
 * ⛔ **수신자 루프 안에서 부르지 마라.** 발송 한 건당 한 번이면 되는 일이고,
 *    루프 안에서 부르면 같은 이미지를 사람 수만큼 올린다.
 * 값을 못 알아보면(파싱 실패·형태 다름) **손대지 않고 그대로 돌려준다** — 조립기의 거부 게이트가
 * 뒤에서 한 번 더 본다. 여기서 삼키면 그 게이트가 볼 것이 없어진다.
 */
export async function resolveBrandSendAttachmentJson(input: {
  companyId: string;
  userId?: string | null;
  bubbleType: string;
  attachmentJson?: string | null;
}): Promise<string | null | undefined> {
  const raw = input.attachmentJson;
  if (!raw || typeof raw !== 'string' || !raw.trim()) return raw;

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;                                   // 형식 오류는 조립기가 사유를 만든다
  }
  if (!parsed || typeof parsed !== 'object') return raw;

  const imgUrl = parsed?.image?.img_url;
  if (typeof imgUrl !== 'string' || !imgUrl.trim()) return raw;

  const resolved = await resolveOne({
    companyId: input.companyId,
    userId: input.userId,
    bubbleType: input.bubbleType,
    imgUrl: imgUrl.trim(),
  });
  if (resolved === imgUrl) return raw;

  return JSON.stringify({ ...parsed, image: { ...parsed.image, img_url: resolved } });
}
