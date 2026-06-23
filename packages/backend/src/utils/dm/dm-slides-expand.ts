/**
 * dm-slides-expand.ts — 슬라이드(가로 스와이프) 모드 페이지 펼치기 (순수, DB import 0)
 *
 * ★ 2026-06-23: 'slides' DM이 1페이지에 갤러리/슬라이드쇼 1개로 이미지 N장을 담고 있어
 *   가로 스와이프가 안 되고 세로 스크롤로만 보이던 문제(직원 신고 — 시세이도 완성 이미지 DM).
 *   슬라이드 모드 렌더 직전, 이미지 전용 페이지(갤러리/슬라이드쇼)의 이미지 N장을
 *   각 1페이지(단일 이미지 갤러리·list_1xN 원본 비율 풀폭)로 펼쳐 페이지 단위 스와이프가 되게 한다.
 *   - 이미 이미지당 1페이지(좌우 슬라이드 업로드)면 변화 없음(원본 반환).
 *   - 헤더 등 다른 섹션이 섞인 페이지는 그대로 둔다(이미지 전용 페이지만 대상).
 *   - 슬라이드쇼(첫 장만 16:9 크롭 렌더 버그)도 각 장을 원본 비율 갤러리 페이지로 펼쳐 함께 해결.
 */
type SlideSection = { id?: string; type?: string; order?: number; props?: any };
export type SlidePage = { id: string; name?: string; sections: SlideSection[] };

const IMAGE_SECTION_TYPES = new Set(['gallery', 'slideshow']);

function extractImages(s: SlideSection): Array<{ url: string; caption?: string }> {
  if (s?.type === 'gallery') {
    const imgs = Array.isArray(s.props?.images) ? s.props.images : [];
    return imgs
      .map((img: any) => ({ url: String(img?.url || ''), caption: img?.caption }))
      .filter((i: { url: string }) => i.url !== '');
  }
  if (s?.type === 'slideshow') {
    const slides = Array.isArray(s.props?.slides) ? s.props.slides : [];
    return slides
      .map((x: any) => ({ url: String(x?.image_url || x?.url || ''), caption: x?.caption }))
      .filter((i: { url: string }) => i.url !== '');
  }
  return [];
}

export function expandSlidePagesForSwipe(pages: SlidePage[]): SlidePage[] {
  const out: SlidePage[] = [];
  let changed = false;
  for (const page of pages) {
    const secs = Array.isArray(page.sections) ? page.sections : [];
    const imageOnly = secs.length > 0 && secs.every((s) => IMAGE_SECTION_TYPES.has(String(s?.type)));
    if (!imageOnly) {
      out.push(page);
      continue;
    }
    const images = secs.flatMap(extractImages);
    if (images.length <= 1) {
      // 0~1장이면 펼칠 게 없음 — 원래 페이지 유지
      out.push(page);
      continue;
    }
    changed = true;
    images.forEach((img, i) => {
      out.push({
        id: `${page.id}-s${i}`,
        name: page.name,
        sections: [
          {
            id: `${page.id}-s${i}-img`,
            type: 'gallery',
            order: 0,
            props: { images: [{ url: img.url, caption: img.caption }], layout: 'list_1xN' },
          },
        ],
      });
    });
  }
  return changed ? out : pages;
}
