/**
 * line-template-page.ts — 템플릿 캠페인 이벤트 페이지 재료 확정 (★ 2026-10-17 · 설계서 docs/2026-10-17-line-template-campaign-design.md §4)
 *
 * 화면이 읽은 페이지(`/event-campaigns/materials/read-url`)를 생성 요청이 **주소 + 그대로 쓰기 켠 카드 지문**으로만 싣고 온다.
 * 서버는 같은 읽기 함수(`readBrandPage` · 10분 캐시 → 없으면 같은 주소 다시 읽기 · AI 0 · 0원)로 다시 얻고 지문을 대조한다.
 * ⛔ 화면이 보낸 글 · 사진 주소를 믿지 않는다 — 문구 · 표지 사진은 서버가 다시 읽은 결과에서만 꺼낸다(사진 = 이 회사 사본 경로).
 * ⛔ 그대로 쓰기 켠 카드가 다시 읽은 결과에 없으면 409 PAGE_CHANGED(그사이 페이지가 바뀌었다 · AI · 차감 전).
 */
import { readBrandPage, type PageReadResult } from './brand-page-reader';

export interface LinePageMaterial {
  /** 버튼 주소 후보(담당자가 붙여넣은 주소) */
  url: string;
  /** 표지 사진(폭 600 이상 · 가로/세로 0.8 이상 · 이 회사 사본 경로) · 없으면 null */
  banner: string | null;
  /** 그대로 쓰기 켠 카드 문구(숫자 근거로 인정) · 없으면 null */
  licensedText: string | null;
}

export interface LinePageError { status: number; code: 'PAGE_CHANGED' | 'PAGE_UNREADABLE'; error: string }

const BANNER_MIN_WIDTH = 600;
const BANNER_MIN_RATIO = 0.8;

const bannerOk = (w: number | null, h: number | null) => !!w && !!h && w >= BANNER_MIN_WIDTH && w / h >= BANNER_MIN_RATIO;

/** (순수) 표지 사진 고르기 — 카드 배너 먼저 · 그다음 페이지 사진(읽기 응답 `line_banner` 와 생성이 같은 함수를 쓴다) */
export function lineBannerOf(r: Pick<PageReadResult, 'cards' | 'images'>): string | null {
  return r.cards.find((c) => c.imageUrl && bannerOk(c.imageWidth, c.imageHeight))?.imageUrl
    ?? r.images.find((im) => bannerOk(im.width, im.height))?.url
    ?? null;
}

/** (순수) 다시 읽은 결과 + 지문 → 재료 · 지문이 없으면 PAGE_CHANGED */
export function lineMaterialFromPage(r: PageReadResult, url: string, licensedHashes: readonly string[]): LinePageMaterial | LinePageError {
  const licensed = licensedHashes.map((h) => r.cards.find((c) => c.hash === h));
  if (licensed.some((c) => !c)) return { status: 409, code: 'PAGE_CHANGED', error: '그사이 페이지 내용이 바뀌었어요. 페이지를 다시 읽고 만들어 주세요.' };
  const banner = lineBannerOf(r);
  const text = licensed.map((c) => `${c!.title}\n${c!.text}`.trim()).filter(Boolean).join('\n');
  return { url, banner, licensedText: text || null };
}

/** 생성 요청의 페이지 → 재료(읽기 실패 = 409 PAGE_UNREADABLE · 차감 전) */
export async function resolveLinePage(
  companyId: string,
  page: { url: string; licensedHashes: readonly string[] },
  read: (companyId: string, url: string) => Promise<PageReadResult> = readBrandPage,
): Promise<LinePageMaterial | LinePageError> {
  let r: PageReadResult;
  try {
    r = await read(companyId, page.url);
  } catch {
    // 주소 형식(400) · 읽기 실패(422) · 크롤 예외 모두 = 이 페이지 없이(화면이 그대로 묻는다)
    return { status: 409, code: 'PAGE_UNREADABLE', error: '이벤트 페이지를 다시 읽지 못했어요. 페이지를 빼고 만들거나 잠시 뒤 다시 시도해 주세요.' };
  }
  return lineMaterialFromPage(r, page.url, page.licensedHashes);
}

export function isLinePageError(v: unknown): v is LinePageError {
  return !!v && typeof v === 'object' && typeof (v as LinePageError).status === 'number' && typeof (v as LinePageError).code === 'string';
}
