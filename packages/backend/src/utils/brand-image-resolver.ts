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
import sharp from 'sharp';
import { query } from '../config/database';
import * as imc from './alimtalk-api';
import { extractImageFromAnyShape, extractImageListFromAnyShape, sanitizeImcMessageForUser } from './alimtalk-api';

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
 *    (★2026-09-20 편집기가 5종을 더 낸다 — 아래 ROUTES·resolveBrandSendRichImages가 그 자리들을 맡는다)
 */
type UploadRoute = { uploadType: string; upload: (buf: Buffer, name: string) => Promise<any> };

/**
 * IMC 업로드 창구 6개 — ★2026-09-20 자유형 5종 개통으로 4개를 더했다.
 * 창구 배정의 근거 = 템플릿 등록 화면(`BrandTemplateForm` `IMG_EP`·`imageEndpointFor`)이 같은 자리에 쓰는 창구다.
 * 발송 쪽에서 카카오가 받는지는 **유형별 실측으로만** 확정된다(0920 실측 = 캐러셀 피드 창구 업로드 성공 · code 0000).
 * 다중 창구(wide-list·carousel-*)도 한 장씩 올린다 — 자리마다 제목·링크가 달라 한 장 단위가 규격에 맞다.
 * `upload_type`은 varchar(30)이다(SCHEMA.md kakao_image_uploads) — 이름을 늘릴 때 길이를 본다.
 */
const ROUTES = {
  // 참조를 캡처하지 않고 호출 시점에 찾는다(모듈 로드 순서·대역 교체에 영향받지 않게).
  default: { uploadType: 'brand_send_default', upload: (b, n) => imc.uploadBrandDefaultImage(b, n) },
  wide: { uploadType: 'brand_send_wide', upload: (b, n) => imc.uploadBrandWideImage(b, n) },
  wideListFirst: { uploadType: 'brand_send_wide_list_first', upload: (b, n) => imc.uploadBrandWideListFirstImage(b, n) },
  wideList: { uploadType: 'brand_send_wide_list', upload: (b, n) => imc.uploadBrandWideListImages([{ buffer: b, name: n }]) },
  carouselFeed: { uploadType: 'brand_send_carousel_feed', upload: (b, n) => imc.uploadBrandCarouselFeedImages([{ buffer: b, name: n }]) },
  carouselCommerce: { uploadType: 'brand_send_carousel_commerce', upload: (b, n) => imc.uploadBrandCarouselCommerceImages([{ buffer: b, name: n }]) },
} satisfies Record<string, UploadRoute>;

/** 첨부 `image` 자리의 창구 — 유형으로 갈린다. 여기 없는 유형의 `image`는 손대지 않는다 */
const UPLOAD_BY_BUBBLE: Record<string, UploadRoute> = {
  IMAGE: ROUTES.default,
  WIDE: ROUTES.wide,
  COMMERCE: ROUTES.default,
};

/** 캐러셀 카드·인트로 이미지의 창구 */
const CAROUSEL_ROUTE_BY_BUBBLE: Record<string, UploadRoute> = {
  CAROUSEL_FEED: ROUTES.carouselFeed,
  CAROUSEL_COMMERCE: ROUTES.carouselCommerce,
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
  /** 이 자리의 업로드 창구. 없으면(창구를 모르는 자리) 손대지 않고 넘긴다 */
  route: UploadRoute | undefined;
  imgUrl: string;
  /** 자리 이름 — 거절 사유 앞에 붙인다(이미지 자리가 여럿인 유형에서 어느 이미지인지 알 수 있게). 예: "카드 2 이미지" */
  at?: string;
  /** ★2026-10-01 같은 크기로 맞춘 버퍼(캐러셀 커머스 · prepareCarouselSameSize) — 있으면 디스크 원본 대신 이것을 올린다 */
  prepared?: Buffer | null;
}): Promise<string> {
  const ref = toOwnImageRef(input.imgUrl);
  const route = input.route;

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
  if (input.prepared) {
    buf = input.prepared;
  } else {
    try {
      buf = fs.readFileSync(filePath);
    } catch {
      throw new BrandImageResolveError('첨부한 이미지 파일을 찾을 수 없습니다. 이미지를 다시 올려주세요');
    }
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
    // ★2026-09-20 거절 원문을 그대로 붙이지 않는다 — 영문 예외명·깨진 파일명이 섞여 고객이 읽을 수 없었다.
    //   템플릿 등록 화면과 같은 변환기로 사유(한글 문장)만 남긴다. 규격 사유는 대부분 여기에 들어 있다(비율·크기).
    const reason = sanitizeImcMessageForUser(res?.message, res?.code, '이미지 규격을 확인해 주세요');
    throw new BrandImageResolveError(
      `${input.at ? `${input.at}: ` : ''}카카오가 이미지를 받지 않았습니다 (${reason}). 규격에 맞는 이미지로 다시 선택해주세요`,
    );
  }
  // 단일 창구는 객체, 다중 창구는 목록으로 온다 — 한 장씩 올리므로 목록이면 첫 항목이다
  const single = extractImageFromAnyShape(res);
  const { imageUrl, imageName } = single.imageUrl ? single : (extractImageListFromAnyShape(res)[0] || {});
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

// ─────────────────────────────────────────────────────────────────────────────
// ★2026-10-01 캐러셀 커머스 = 전 장을 **같은 픽셀 크기**로 맞춰 올린다 (박성용 접수 `cmuc0buy…` 재오픈 · B-0923-3)
//
// 실측: `SMSQ_SEND_15` seqno 457376 = 버튼·상품·이미지를 다 갖추고도 `KAKAO_3024_MESSAGE_INVALID_IMAGE`.
//   두 카드 원본 = 676×534(가로/세로 1.2659) · 506×400(1.2650). 규격(attachment_method.pdf §3.4) =
//   「캐러셀 커머스는 전체 이미지 비율이 동일해야 함」. 화면은 「첫 이미지와 같은 비율」을 1% 오차까지
//   통과시키고, 우리는 한 장씩 따로 올리므로 올릴 때는 장마다 접수되고 **발송 때** 카카오가 비교해 거절한다
//   (그때는 이미 차감 뒤다).
//
// 왜 서버인가: 화면에서 둘째 장만 맞추면 반올림 때문에 다시 어긋난다(676×534 에 맞춘 506 폭 = 400 → 1.2650).
//   「정확히 같다」는 전 장이 같은 가로·세로일 때만 성립하고, 그것을 보장할 수 있는 자리는 올리는 함수 하나다.
//
// ⛔ 커머스에만 건다 — 규격이 비율 동일을 적은 유형이 커머스뿐이고, 피드는 운영에서 그대로 성공하고 있다
//    (0920 seqno 115652). 근거 없이 넓히면 지금 되는 발송의 이미지를 우리가 바꾸게 된다.
// ⛔ 키우지 않는다 — 결과 가로 = 가장 작은 장의 가로(상한 800) · 결과 세로도 어느 장의 세로를 넘지 않는다.
//    그래서 최소 가로(500)를 우리가 무너뜨리지 않는다. 잘리는 양은 오차 한도(1%) 안이다.
// ⛔ 최소 가로에 못 미치는 장이 섞이면 맞추지 않는다 — 전 장을 그 폭으로 줄이면 카카오의 「가로 부족」 거절이
//    엉뚱한 장에 붙는다. 종전대로 그 장만 거절되게 둔다.
// ─────────────────────────────────────────────────────────────────────────────

/** 비율 비교 허용 오차 — 화면(`brandImageSpec.ts RATIO_TOLERANCE`)과 같은 값. 이보다 크게 다르면 맞추지 않고 거절한다 */
export const CAROUSEL_RATIO_TOLERANCE = 0.01;
/** 맞춘 결과의 가로 상한(px) — 화면 자동 맞춤(`BRAND_IMAGE_RULES.carousel.fitWidth`)과 같은 값 */
export const CAROUSEL_FIT_WIDTH = 800;
/** 캐러셀 이미지 최소 가로(px) — 화면(`BRAND_IMAGE_RULES.carousel.minWidth`)과 같은 값 */
export const CAROUSEL_MIN_WIDTH = 500;

export type CarouselSizePlan =
  /** 이미 전 장이 같은 크기 — 손대지 않는다 */
  | { kind: 'same'; width: number; height: number }
  /** 전 장을 이 크기로 맞춘다 */
  | { kind: 'fit'; width: number; height: number }
  /** index 번째 장이 기준(0번)과 오차 밖으로 다르다 — 맞추지 않고 거절한다 */
  | { kind: 'mismatch'; index: number };

/**
 * 전 장의 가로·세로 → 맞춤 계획(순수). 0번 = 기준(인트로가 있으면 인트로 · 없으면 카드 1 = 화면 `carouselRefRatio` 와 같은 순서).
 * 판단할 수 없는 입력(빈 목록 · 0 이하 크기)은 null.
 */
export function planCarouselSameSize(dims: ReadonlyArray<{ width: number; height: number }>): CarouselSizePlan | null {
  if (dims.length === 0 || dims.some((d) => !(d.width > 0 && d.height > 0))) return null;
  const r0 = dims[0].width / dims[0].height;
  for (let i = 1; i < dims.length; i++) {
    const r = dims[i].width / dims[i].height;
    if (Math.abs(r - r0) / r0 > CAROUSEL_RATIO_TOLERANCE) return { kind: 'mismatch', index: i };
  }
  const w0 = dims[0].width;
  const h0 = dims[0].height;
  if (dims.every((d) => d.width === w0 && d.height === h0)) return { kind: 'same', width: w0, height: h0 };
  // 가장 넓은 비율에 맞춘다 = 가장 넓은 장은 그대로 줄이고, 나머지는 위아래를 오차만큼 잘라 낸다
  const widest = Math.max(...dims.map((d) => d.width / d.height));
  const width = Math.min(CAROUSEL_FIT_WIDTH, ...dims.map((d) => d.width));
  // 세로도 가장 작은 장을 넘지 않는다(반올림 1px 로 키우는 일이 없게)
  const height = Math.min(Math.round(width / widest), ...dims.map((d) => d.height));
  return { kind: 'fit', width, height };
}

type CarouselSlot = { at: string; url: string };

/**
 * 캐러셀 커머스 이미지 자리(기준 먼저 = 인트로 → 카드 순)를 같은 크기로 맞춘 버퍼로 돌려준다.
 *   - 배열(자리 순서 그대로) = 그 자리에 올릴 버퍼 · null 인 자리는 이미 그 크기라 원본을 그대로 올린다
 *   - null = 여기서 판단하지 않는다(종전 경로 그대로): 자리가 1개 이하 · 우리 서빙 파일이 아닌 자리가 섞임
 *     (이미 올린 카카오 URL = 재발송·예약분) · 크기를 읽을 수 없는 파일 · 이미 전 장 같은 크기
 *   - 오차 밖으로 다르면 올리기 **전에** 거절한다(한 장도 올리지 않는다 · 차감 앞)
 */
async function prepareCarouselSameSize(companyId: string, slots: CarouselSlot[]): Promise<Array<Buffer | null> | null> {
  if (slots.length < 2) return null;
  const loaded: Array<{ buf: Buffer; width: number; height: number; format: 'jpeg' | 'png'; rotated: boolean }> = [];
  for (const s of slots) {
    const ref = toOwnImageRef(s.url);
    // 우리 파일이 아니거나 경로가 이상한 자리는 뒤의 resolveOne 이 종전 규칙으로 통과·거절한다
    if (!ref || ref.companyId !== companyId || ref.filename.includes('..') || ref.filename.includes('/') || ref.filename.includes('\\')) return null;
    try {
      const buf = fs.readFileSync(path.join(INAPP_IMAGE_BASE, ref.companyId, ref.filename));
      const m = await sharp(buf).metadata();
      if (!m.width || !m.height || (m.format !== 'jpeg' && m.format !== 'png')) return null;
      // EXIF 방향 5~8 = 보이는 가로·세로가 저장값과 뒤바뀐다(화면이 잰 크기와 같은 기준으로 본다)
      const o = m.orientation || 1;
      const swap = o >= 5;
      loaded.push({ buf, width: swap ? m.height : m.width, height: swap ? m.width : m.height, format: m.format, rotated: o !== 1 });
    } catch {
      return null;
    }
  }
  if (loaded.some((l) => l.width < CAROUSEL_MIN_WIDTH)) return null;
  const plan = planCarouselSameSize(loaded);
  if (!plan || plan.kind === 'same') return null;
  if (plan.kind === 'mismatch') {
    throw new BrandImageResolveError(
      `${slots[plan.index].at}: ${slots[0].at}와 비율이 다릅니다. 같은 비율의 이미지로 바꿔 주세요`,
    );
  }
  const out: Array<Buffer | null> = [];
  for (let i = 0; i < loaded.length; i++) {
    const l = loaded[i];
    if (l.width === plan.width && l.height === plan.height && !l.rotated) { out.push(null); continue; }
    try {
      const fitted = sharp(l.buf).rotate().resize(plan.width, plan.height, { fit: 'cover', position: 'centre' });
      out.push(await (l.format === 'png' ? fitted.png({ compressionLevel: 9 }) : fitted.jpeg({ quality: 92, mozjpeg: true })).toBuffer());
    } catch (e: any) {
      // 다르다는 것을 알고도 그대로 올리면 발송 때(차감 뒤) 거절된다 — 여기서 세운다
      console.error('[brand-image-resolver] 캐러셀 이미지 크기 맞춤 실패:', e?.message);
      throw new BrandImageResolveError(`${slots[i].at}: 이미지 크기를 맞추지 못했습니다. 카드 이미지를 같은 크기로 준비해 다시 올려 주세요`);
    }
  }
  return out;
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
    route: UPLOAD_BY_BUBBLE[String(input.bubbleType || '').trim().toUpperCase()],
    imgUrl: String(img.img_url).trim(),
  });
  return resolved === img.img_url ? img : { ...img, img_url: resolved };
}

/**
 * ★2026-09-20 자유형 5종의 **나머지 이미지 자리** 확정 — 아이템 목록 · 동영상 썸네일 · 캐러셀 카드·인트로.
 * 첨부 `image` 자리는 위 `resolveBrandSendImage`가 그대로 맡는다(호출부가 둘을 함께 부른다).
 * 입력을 바꾸지 않고 새 객체를 돌려준다. 값이 없는 자리는 그대로 통과한다.
 *
 * ⛔ 수신자 루프 **밖** · 차감 **앞**에서 한 번만 부른다(자리 수만큼 업로드가 나간다 — 캐러셀 6장이면 6번).
 * ⛔ AI 생성 이미지 판정은 이 함수 **앞**에서 끝내야 한다(치환 뒤에는 우리 URL이 아니라 판정이 안 된다).
 */
export async function resolveBrandSendRichImages<
  TItem extends { img_url: string },
  TVideo extends { thumbnail_url?: string },
  TCard extends { image?: { img_url: string } },
  THead extends { image_url: string },
>(input: {
  companyId: string;
  userId?: string | null;
  bubbleType: string;
  itemList?: TItem[];
  video?: TVideo;
  carouselCards?: TCard[];
  carouselIntro?: THead;
}): Promise<{ itemList?: TItem[]; video?: TVideo; carouselCards?: TCard[]; carouselIntro?: THead }> {
  const base = { companyId: input.companyId, userId: input.userId };
  const bubble = String(input.bubbleType || '').trim().toUpperCase();
  const one = (route: UploadRoute | undefined, url: string, at: string, prepared?: Buffer | null) =>
    resolveOne({ ...base, route, imgUrl: String(url).trim(), at, prepared });

  let itemList = input.itemList;
  if (bubble === 'WIDE_ITEM_LIST' && Array.isArray(itemList)) {
    const next: TItem[] = [];
    for (let i = 0; i < itemList.length; i++) {
      const it = itemList[i];
      const url = String(it?.img_url || '').trim();
      // 1번 아이템만 큰 이미지 규격이라 창구가 다르다(wide-list/first)
      next.push(url ? { ...it, img_url: await one(i === 0 ? ROUTES.wideListFirst : ROUTES.wideList, url, `${i + 1}번째 아이템 이미지`) } : it);
    }
    itemList = next;
  }

  let video = input.video;
  const thumb = String(video?.thumbnail_url || '').trim();
  if (bubble === 'PREMIUM_VIDEO' && video && thumb) {
    video = { ...video, thumbnail_url: await one(ROUTES.default, thumb, '동영상 썸네일') };
  }

  const carRoute = CAROUSEL_ROUTE_BY_BUBBLE[bubble];
  let carouselCards = input.carouselCards;
  let carouselIntro = input.carouselIntro;
  if (carRoute) {
    const introUrl = String(carouselIntro?.image_url || '').trim();
    // ★2026-10-01 커머스 = 전 장을 같은 크기로 맞춘 뒤 올린다(위 prepareCarouselSameSize). 자리 순서 = 기준 먼저(인트로 → 카드).
    const slots: CarouselSlot[] = [];
    if (carouselIntro && introUrl) slots.push({ at: '인트로 이미지', url: introUrl });
    if (Array.isArray(carouselCards)) {
      carouselCards.forEach((c, i) => {
        const url = String(c?.image?.img_url || '').trim();
        if (url && c.image) slots.push({ at: `카드 ${i + 1} 이미지`, url });
      });
    }
    const prepared = bubble === 'CAROUSEL_COMMERCE' ? await prepareCarouselSameSize(input.companyId, slots) : null;
    const preparedOf = (at: string): Buffer | null => (prepared ? prepared[slots.findIndex((s) => s.at === at)] ?? null : null);
    if (Array.isArray(carouselCards)) {
      const next: TCard[] = [];
      for (let i = 0; i < carouselCards.length; i++) {
        const c = carouselCards[i];
        const url = String(c?.image?.img_url || '').trim();
        const at = `카드 ${i + 1} 이미지`;
        next.push(url && c.image ? { ...c, image: { ...c.image, img_url: await one(carRoute, url, at, preparedOf(at)) } } : c);
      }
      carouselCards = next;
    }
    if (carouselIntro && introUrl) {
      carouselIntro = { ...carouselIntro, image_url: await one(carRoute, introUrl, '인트로 이미지', preparedOf('인트로 이미지')) };
    }
  }

  return { itemList, video, carouselCards, carouselIntro };
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
    route: UPLOAD_BY_BUBBLE[String(input.bubbleType || '').trim().toUpperCase()],
    imgUrl: imgUrl.trim(),
  });
  if (resolved === imgUrl) return raw;

  return JSON.stringify({ ...parsed, image: { ...parsed.image, img_url: resolved } });
}
