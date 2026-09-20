/**
 * 브랜드메시지 발송 창 입력 검사 계약 (★2026-09-20 신설)
 *
 * 왜 있나
 *   0920 실측에서 두 건이 발송 뒤에야 죽었다 — 프리미엄 동영상에 유튜브 주소(카카오 동영상 오류),
 *   캐러셀에 규격 밖 이미지(카카오 업로드 거절). 화면이 규격을 알려 주지도 막지도 않았기 때문이다.
 *   그래서 발송 창에 규격표·판정·자동 맞춤(`brandImageSpec.ts`)과 값 검사(`brandRich.ts`)를 넣었다.
 *   프론트 패키지에는 테스트 러너가 없어, 순수 함수만 골라 여기서 못 박는다.
 *
 * ⚠ 프론트 소스를 **경로 문자열로 동적 import** 한다 — 정적 import를 쓰면 백엔드 tsc가 패키지 경계를 넘는다
 *   (brand-spec-parity.test.ts가 텍스트로 읽는 것과 같은 이유). 두 파일 모두 React·DOM을 import하지 않는 순수 모듈이다.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';

const FRONT = path.resolve(__dirname, '../../../../frontend/src/components/brand-send');
const load = (file: string): Promise<any> => import(/* @vite-ignore */ pathToFileURL(path.join(FRONT, file)).href);

let spec: any;
let rich: any;
beforeAll(async () => {
  spec = await load('brandImageSpec.ts');
  rich = await load('brandRich.ts');
});

const MB = 1024 * 1024;
const facts = (width: number, height: number, bytes = 300 * 1024, mime = 'image/jpeg') => ({ width, height, bytes, mime });
const keys = (v: { key: string }[]) => v.map((x) => x.key);

describe('이미지 규격 판정 — judgeBrandImage', () => {
  it('권장 크기는 자리마다 통과한다', () => {
    expect(spec.judgeBrandImage('main', facts(800, 400))).toEqual([]);
    expect(spec.judgeBrandImage('main', facts(800, 600))).toEqual([]);
    expect(spec.judgeBrandImage('carousel', facts(800, 600))).toEqual([]);
    expect(spec.judgeBrandImage('wideItemFirst', facts(800, 400))).toEqual([]);
    expect(spec.judgeBrandImage('wideItem', facts(400, 400))).toEqual([]);
  });

  it('본 이미지 — 비율 2:1~3:4 밖 · 가로 500 미만 · 2MB 초과 · jpg/png 아님을 각각 잡는다', () => {
    expect(keys(spec.judgeBrandImage('main', facts(1200, 400)))).toEqual(['ratio']);     // 3:1
    expect(keys(spec.judgeBrandImage('main', facts(600, 1000)))).toEqual(['ratio']);     // 3:5
    expect(keys(spec.judgeBrandImage('main', facts(480, 320)))).toEqual(['width']);
    expect(keys(spec.judgeBrandImage('main', facts(800, 400, 3 * MB)))).toEqual(['bytes']);
    expect(keys(spec.judgeBrandImage('main', facts(800, 400, 1000, 'image/webp')))).toEqual(['format']);
  });

  it('경계값(정확히 2:1 · 정확히 3:4)은 통과하고, 반올림 차이(801×400)도 같은 비율로 본다', () => {
    expect(spec.judgeBrandImage('main', facts(1000, 500))).toEqual([]);
    expect(spec.judgeBrandImage('main', facts(600, 800))).toEqual([]);
    expect(spec.judgeBrandImage('wideItemFirst', facts(801, 400))).toEqual([]);
  });

  it('와이드 리스트 — 1번은 2:1, 나머지는 1:1만 받는다', () => {
    expect(keys(spec.judgeBrandImage('wideItemFirst', facts(800, 600)))).toEqual(['ratio']);
    expect(keys(spec.judgeBrandImage('wideItem', facts(800, 400)))).toEqual(['ratio']);
  });

  it('캐러셀 — 기준 비율이 있으면 범위 안이어도 비율이 다르면 잡는다', () => {
    expect(spec.judgeBrandImage('carousel', facts(800, 600), 4 / 3)).toEqual([]);
    expect(keys(spec.judgeBrandImage('carousel', facts(800, 400), 4 / 3))).toEqual(['ratio']);
  });

  it('형식을 모르는 자산(mime 빈 값)은 형식 위반으로 치지 않는다', () => {
    expect(spec.judgeBrandImage('main', facts(800, 400, 1000, ''))).toEqual([]);
  });
});

describe('자동 맞춤 계획 — planBrandImageFit', () => {
  it('너무 넓으면 양옆을, 너무 길면 위아래를 가운데 기준으로 자르고 권장 가로로 줄인다', () => {
    expect(spec.planBrandImageFit('main', 3000, 1000)).toEqual({ sx: 500, sy: 0, sw: 2000, sh: 1000, outW: 800, outH: 400 });
    expect(spec.planBrandImageFit('main', 900, 1500)).toEqual({ sx: 0, sy: 150, sw: 900, sh: 1200, outW: 800, outH: 1067 });
  });

  it('비율이 맞으면 자르지 않고 줄이기만 한다(2MB 초과·형식 변환용)', () => {
    expect(spec.planBrandImageFit('main', 1600, 1200)).toEqual({ sx: 0, sy: 0, sw: 1600, sh: 1200, outW: 800, outH: 600 });
  });

  it('키우지 않는다 — 잘라 낸 가로가 최소 가로보다 작으면 계획이 없다', () => {
    expect(spec.planBrandImageFit('main', 480, 320)).toBeNull();
    expect(spec.planBrandImageFit('main', 600, 1600)).not.toBeNull();   // 600×800으로 자른다(가로 600 ≥ 500)
    expect(spec.planBrandImageFit('wideItem', 900, 300)).toBeNull();     // 1:1로 자르면 가로 300 < 400
  });

  it('와이드 리스트·캐러셀 기준 비율 — 결과가 정확히 그 비율이다', () => {
    expect(spec.planBrandImageFit('wideItemFirst', 1200, 1200)).toMatchObject({ outW: 800, outH: 400 });
    expect(spec.planBrandImageFit('wideItem', 1200, 800)).toMatchObject({ outW: 400, outH: 400 });
    expect(spec.planBrandImageFit('carousel', 1600, 800, 4 / 3)).toMatchObject({ outW: 800, outH: 600 });
  });

  it('맞춘 결과는 같은 자리의 판정을 통과한다', () => {
    for (const [kind, w, h, ref] of [['main', 3000, 1000, null], ['wideItem', 1200, 800, null], ['carousel', 1600, 800, 4 / 3]] as const) {
      const p = spec.planBrandImageFit(kind, w, h, ref);
      expect(spec.judgeBrandImage(kind, facts(p.outW, p.outH), ref)).toEqual([]);
    }
  });
});

describe('값 검사 — 링크 · 동영상 주소 · 가격', () => {
  it('링크는 http(s)로 시작해야 한다 — 변수로 시작하는 값과 빈 값은 통과', () => {
    expect(rich.isWebLink('https://www.hanjul.ai')).toBe(true);
    expect(rich.isWebLink('http://a.co/x?y=1')).toBe(true);
    expect(rich.isWebLink('#{링크}')).toBe(true);
    expect(rich.isWebLink('www.hanjul.ai')).toBe(false);          // 0920 접수 화면의 실제 입력값
    expect(rich.isWebLink('https://a b')).toBe(false);
    expect(rich.linkReason('', '링크는')).toBe('');
    expect(rich.linkReason('www.hanjul.ai', '더보기 링크는')).toContain('http:// 또는 https://');
  });

  it('★0920 링크 칸 자동 https — 도메인 형태인데 스킴이 없는 값에만 붙인다(칸에 보이는 값을 바꾼다)', () => {
    expect(rich.normalizeLinkInput('www.naver.com')).toBe('https://www.naver.com');
    expect(rich.normalizeLinkInput('  naver.com/event?x=1  ')).toBe('https://naver.com/event?x=1');
    expect(rich.normalizeLinkInput('www.hanjul.ai')).toBe('https://www.hanjul.ai');       // 0920 접수 화면의 실제 입력값
    // 건드리지 않는 것 — 이미 스킴이 있는 값 · 변수 · 도메인 형태가 아닌 값 · 빈 값
    expect(rich.normalizeLinkInput('http://a.co/x')).toBe('http://a.co/x');
    expect(rich.normalizeLinkInput('HTTPS://A.CO')).toBe('HTTPS://A.CO');
    expect(rich.normalizeLinkInput('#{상품링크}')).toBe('#{상품링크}');
    expect(rich.normalizeLinkInput('네이버')).toBe('네이버');
    expect(rich.normalizeLinkInput('ftp://a.co')).toBe('ftp://a.co');
    expect(rich.normalizeLinkInput('')).toBe('');
    // 붙인 결과는 검사를 통과하고, 도메인 형태가 아닌 값은 그대로 남아 검사에 걸린다
    expect(rich.linkReason(rich.normalizeLinkInput('www.naver.com'), '링크는')).toBe('');
    expect(rich.linkReason(rich.normalizeLinkInput('네이버'), '링크는')).toContain('http:// 또는 https://');
    // 두 번 적용해도 같다(멱등)
    expect(rich.normalizeLinkInput(rich.normalizeLinkInput('www.naver.com'))).toBe('https://www.naver.com');
  });

  it('★0920 자동 https 의 도메인 판정은 백엔드 normalizeWebUrl 과 같은 식이다(두 벌이 갈리면 화면과 서버가 다른 주소를 만든다)', async () => {
    const fs = await import('fs');
    const front = fs.readFileSync(path.join(FRONT, 'brandRich.ts'), 'utf8');
    const back = fs.readFileSync(path.resolve(__dirname, '../normalize.ts'), 'utf8');
    const DOMAIN_RE = String.raw`/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i`;
    expect(front).toContain(DOMAIN_RE);
    expect(back).toContain(DOMAIN_RE);
  });

  it('동영상은 카카오TV 주소만 — 0920 실측 실패값(유튜브 단축 주소)을 막는다', () => {
    expect(rich.isKakaoTvUrl('https://tv.kakao.com/v/422641013')).toBe(true);
    expect(rich.isKakaoTvUrl('https://tv.kakao.com/channel/1391/cliplink/455082924')).toBe(true);
    expect(rich.isKakaoTvUrl('https://youtu.be/abcdefghijk')).toBe(false);
    expect(rich.isKakaoTvUrl('https://tv.kakao.com.evil.example/v/1')).toBe(false);
    expect(rich.isKakaoTvUrl('tv.kakao.com/v/1')).toBe(false);
  });

  const video = (url: string) => ({ ...rich.initialRich('PREMIUM_VIDEO'), video: { url, thumb: null } });
  it('발송 전 검사가 유튜브 주소를 사유와 함께 막는다', () => {
    expect(rich.richBlockReason('PREMIUM_VIDEO', video('https://youtu.be/abcdefghijk'), ['WL'])).toContain('카카오TV');
    expect(rich.richBlockReason('PREMIUM_VIDEO', video('https://tv.kakao.com/v/422641013'), ['WL'])).toBe('');
  });

  it('가격은 99,999,999원까지', () => {
    const st = { ...rich.initialRich('COMMERCE'), commerce: { title: '상품', regular: '100,000,000', discount: '', rate: '' } };
    expect(rich.richBlockReason('COMMERCE', st, ['WL'])).toContain('99,999,999');
    st.commerce.regular = '99,999,999';
    expect(rich.richBlockReason('COMMERCE', st, ['WL'])).toBe('');
  });
});

describe('캐러셀 — 카드끼리 같은 비율', () => {
  const img = (w: number, h: number) => ({ url: 'https://hanjul.ai/api/cdp/inapp/image/c/a.jpg', assetId: 'a', kind: 'uploaded', name: 'a.jpg', w, h });
  const card = (w: number, h: number, i: number) => ({
    image: img(w, h), imgLink: '', header: `카드 ${i}`, message: '내용', additional: '',
    commerce: { title: '', regular: '', discount: '', rate: '' }, buttons: [],
  });
  const feed = (cards: any[]) => ({ ...rich.initialRich('CAROUSEL_FEED'), cards });

  it('첫 카드와 비율이 다른 카드를 짚어 준다', () => {
    const reason = rich.richBlockReason('CAROUSEL_FEED', feed([card(800, 600, 1), card(800, 400, 2)]), ['WL']);
    expect(reason).toContain('카드 2:');
    expect(reason).toContain('4:3');
    expect(reason).toContain('2:1');
  });

  it('비율이 같으면 통과한다(크기는 달라도 된다)', () => {
    expect(rich.richBlockReason('CAROUSEL_FEED', feed([card(800, 600, 1), card(1200, 900, 2)]), ['WL'])).toBe('');
  });

  it('카드 이미지 링크도 형식을 본다', () => {
    const cards = [card(800, 600, 1), { ...card(800, 600, 2), imgLink: 'www.hanjul.ai' }];
    expect(rich.richBlockReason('CAROUSEL_FEED', feed(cards), ['WL'])).toContain('카드 2: 이미지 링크는');
  });
});
