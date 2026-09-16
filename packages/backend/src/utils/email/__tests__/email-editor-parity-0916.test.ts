/**
 * ★ 2026-09-16 접수 8건 행동 파리티 — 헤더 형태·브랜드명 표시 / 히어로 오버레이 프리셋 /
 *   매장 지도·이메일 / SNS 표시 방식·핸들 / 푸터 수신거부.
 *
 * 전부 "편집기에는 있는데 이메일 렌더러가 한 줄도 안 읽는" 같은 부류였다(DM은 넷 다 읽고 있었다).
 * `email-editor-coverage.test.ts`는 **읽는가**를 보고, 이 파일은 **값을 바꾸면 출력이 달라지는가**를 밟는다.
 * 둘 다 필요하다 — 읽기만 하고 출력이 같으면 사용자 화면에서는 여전히 "눌러도 안 바뀐다"다.
 */
import { describe, it, expect } from 'vitest';
import { renderEmailSections, EMAIL_FOOTER_SLOT } from '../email-section-renderer';
import { resolveEmailBrand } from '../email-tokens';
import {
  EMAIL_HEADER_VARIANTS, EMAIL_HEADER_VARIANT_PROPS, EMAIL_HEADER_BRAND_OFF_ALIGN,
  EMAIL_HERO_OVERLAY_BANDS, EMAIL_HERO_OVERLAY_TOP,
  EMAIL_STORE_INFO_PROPS, EMAIL_SNS_LAYOUTS, EMAIL_SNS_CHIPS_PER_ROW,
} from '../email-property-contract';
import type { Section } from '../../dm/dm-section-registry';

const sec = (type: string, props: Record<string, unknown>): Section =>
  ({ id: 's-' + type, type, order: 0, visible: true, props } as unknown as Section);
const render = (type: string, props: Record<string, unknown>) => renderEmailSections([sec(type, props)], {});

// ──────────────── 헤더 형태 (남지현 접수 cmu3m03ze03najnlu1fjw857n) ────────────────
const rh = (props: Record<string, unknown>) => render('header', props);
const BRAND = { brand_name: '인비토' };

describe('헤더 형태 — 4종이 서로 다른 출력을 낸다', () => {
  it('형태별 출력이 모두 다르다(옛 렌더러는 banner 말고 전부 같은 줄로 떨어졌다)', () => {
    const outs = EMAIL_HEADER_VARIANTS.map((v) => rh({
      ...BRAND, variant: v,
      banner_image_url: 'https://x.example.com/b.jpg',
      event_date: '2026-12-31T00:00:00.000Z', event_title: '테스트',
      discount_label: '20% 할인', coupon_code: 'SPRING20',
    }));
    expect(new Set(outs).size, '형태를 바꿔도 같은 HTML = "아무런 변화가 없음" 접수 그대로')
      .toBe(EMAIL_HEADER_VARIANTS.length);
  });

  for (const { variant, props } of EMAIL_HEADER_VARIANT_PROPS) {
    for (const prop of props) {
      it(`[${variant}] ${prop} 입력값이 출력에 실린다`, () => {
        // 종료일은 날짜 원문이 아니라 D-Day 문구로 나간다(이메일은 JS가 없어 렌더 시점 정적 계산).
        if (prop === 'event_date') {
          expect(rh({ ...BRAND, variant, event_date: '2026-12-31T00:00:00.000Z' })).toMatch(/D-\d+|D-Day|D\+\d+/);
          return;
        }
        const probe = prop === 'phone' ? '02-1234-5678' : `probe-${prop}`;
        expect(rh({ ...BRAND, variant, [prop]: probe })).toContain(probe);
      });
    }
  }

  it('D-Day는 지난 날짜면 D+n', () => {
    const past = new Date(Date.now() - 3 * 86400000).toISOString();
    expect(rh({ ...BRAND, variant: 'countdown', event_date: past })).toContain('D+3');
  });

  it('그라데이션 면은 solid 폴백을 함께 싣는다(아웃룩은 background-image를 무시한다)', () => {
    const countdown = rh({ ...BRAND, variant: 'countdown', event_date: '2026-12-31T00:00:00.000Z' });
    const coupon = rh({ ...BRAND, variant: 'coupon', discount_label: '20% 할인' });
    for (const html of [countdown, coupon]) {
      expect(html).toMatch(/background:#[0-9a-fA-F]{3,8};background-image:linear-gradient/);
    }
  });

  it('쿠폰 코드 알약은 표 셀 bgcolor를 싣는다(아웃룩에서 흰 면이 빠지면 글씨가 사라진다)', () => {
    expect(rh({ ...BRAND, variant: 'coupon', coupon_code: 'SPRING20' })).toContain('<td bgcolor="#ffffff"');
  });
});

// ──────────────── 브랜드명 표시 (남지현 접수 cmu3mkzba03wmjnlufa4o1n68) ────────────────
describe('헤더 브랜드명 표시 — 끄면 로고만 중앙', () => {
  const LOGO = { brand_name: '인비토', logo_url: 'https://x.example.com/logo.png' };

  it('미사용이면 브랜드명이 사라지고 사용이면 나온다', () => {
    expect(rh({ ...LOGO, show_brand_name: false })).not.toContain('>인비토</span>');
    expect(rh({ ...LOGO, show_brand_name: true })).toContain('>인비토</span>');
  });

  it('미사용이면 왼쪽 정렬을 골랐어도 로고가 중앙이다(편집기 안내문이 약속한 동작)', () => {
    expect(rh({ ...LOGO, align: 'left', show_brand_name: false })).toContain(`text-align:${EMAIL_HEADER_BRAND_OFF_ALIGN}`);
    expect(rh({ ...LOGO, align: 'left', show_brand_name: true })).toContain('text-align:left');
  });

  it('미지정 = 사용과 같은 출력(기존 캠페인 회귀 0)', () => {
    expect(rh(LOGO)).toBe(rh({ ...LOGO, show_brand_name: true }));
  });

  it('대표 전화가 tel 링크로 나간다(편집기 안내 "탭하면 전화 연결")', () => {
    expect(rh({ ...LOGO, phone: '02-1234-5678' })).toContain('href="tel:02-1234-5678"');
  });
});

// ──────────────── 히어로 오버레이 프리셋 (남지현 접수 cmu3n4c4b03xfjnlumbg75qcz) ────────────────
const rhero = (props: Record<string, unknown>) =>
  render('hero', { headline: '봄 특가', image_url: 'https://x.example.com/h.jpg', ...props });

describe('히어로 오버레이 프리셋 — 6값이 서로 다른 출력을 낸다', () => {
  it('프리셋마다 출력이 다르다(옛 렌더러는 overlay를 한 번도 안 읽었다)', () => {
    const outs = Object.keys(EMAIL_HERO_OVERLAY_BANDS).map((k) => rhero({ overlay: k }));
    expect(new Set(outs).size, '프리셋을 바꿔도 같은 HTML = "변화가 없음" 접수 그대로').toBe(outs.length);
  });

  it('미지정 = 옛 토글 그대로(기존 캠페인 출력 무변화)', () => {
    expect(rhero({})).toBe(rhero({ overlay: undefined }));
    expect(rhero({})).toContain('#171717');
  });

  it('없음은 다크 밴드를 내리고 강하게는 유지한다', () => {
    expect(rhero({ overlay: 'none' })).not.toContain('#171717');
    expect(rhero({ overlay: 'strong' })).toContain('#171717');
  });

  it('상단 방향은 텍스트 밴드가 사진보다 먼저 나온다', () => {
    // ⛔ 헤드라인 문자열로 위치를 재면 안 된다 — 프리헤더(숨은 미리보기 줄)가 문서 맨 앞에 같은 글을 싣는다.
    //   밴드 **셀 자체**(bgcolor)와 사진 태그의 순서로 잰다.
    const top = rhero({ overlay: EMAIL_HERO_OVERLAY_TOP });
    expect(top.indexOf('bgcolor="#171717"'), '밴드가 사진 뒤면 방향이 안 바뀐 것').toBeLessThan(top.indexOf('<img'));
    const bottom = rhero({ overlay: 'strong' });
    expect(bottom.indexOf('<img')).toBeLessThan(bottom.indexOf('bgcolor="#171717"'));
  });

  it('브랜드 틴트는 회사 주색을 쓴다(원장에 색을 리터럴로 굳히지 않는다)', () => {
    expect(rhero({ overlay: 'brand' })).toContain(resolveEmailBrand(null, null).primary);
  });

  it('밴드 면은 bgcolor 속성도 싣는다(면이 빠지면 흰 위 흰 글씨가 된다)', () => {
    expect(rhero({ overlay: 'strong' })).toContain('bgcolor="#171717"');
  });

  it('문구가 없으면 밴드를 안 그린다(완성 포스터 통짜 업로드 — 기존 계약 유지)', () => {
    expect(rhero({ headline: '', sub_copy: '', overlay: 'strong' })).not.toContain('bgcolor="#171717"');
  });
});

// ──────────────── 매장/고객센터 (임은지 접수 cmu3lnjg403mgjnlu1fnxdmuc) ────────────────
const rst = (props: Record<string, unknown>) => render('store_info', props);

describe('매장/고객센터 — 지도 링크·이메일이 발송 HTML에 실린다', () => {
  for (const { prop, desc, probe } of EMAIL_STORE_INFO_PROPS) {
    it(`${prop} (${desc}) · 값을 주면 출력이 실제로 달라진다`, () => {
      expect(rst({ [prop]: probe }), `${prop} 미소비`).not.toBe(rst({}));
    });
  }

  it('지도 링크만 있어도 블록이 나온다(옛 코드는 다른 칸이 비면 통째로 버렸다)', () => {
    const html = rst({ map_url: 'https://map.kakao.com/link/map/test,37.5,127.0' });
    expect(html).toContain('매장 위치 보기');
    expect(html).toContain('map.kakao.com');
  });

  it('지도 버튼은 버튼 CT를 써 아웃룩 VML 폴백이 따라온다', () => {
    expect(rst({ map_url: 'https://map.naver.com/p/test' })).toContain('v:roundrect');
  });

  it('이메일 주소는 mailto 링크다', () => {
    expect(rst({ email: 'shop@example.com' })).toContain('href="mailto:shop@example.com"');
  });

  it('입력이 하나도 없으면 블록을 그리지 않는다(회귀 0)', () => {
    // 렌더러는 문서 전체를 내므로 빈 문자열이 아니라 **그 블록의 표식이 없음**으로 잰다.
    const html = rst({});
    for (const mark of ['주소', '전화', '운영시간', '매장 위치 보기', 'mailto:']) {
      expect(html, `입력 0인데 ${mark} 가 나온다`).not.toContain(mark);
    }
  });
});

// ──────────────── SNS (임은지 접수 cmu3lxucs03mqjnluyeihh7p4) ────────────────
// ⛔ 채널 URL에 `@핸들` 꼴을 쓰지 않는다 — 핸들 표시 여부를 재는 문자열이 URL에서도 걸려 오탐이 된다
//   (유튜브 주소 `youtube.com/@brand`가 실제로 그 함정이었다).
const rsns = (props: Record<string, unknown>) => render('sns', {
  channels: [
    { type: 'instagram', url: 'https://instagram.com/brandshop', handle: 'brand' },
    { type: 'youtube', url: 'https://youtube.com/c/brandtv' },
  ],
  ...props,
});

describe('SNS — 표시 방식·핸들·아웃룩 배경', () => {
  it('표시 방식 2값이 서로 다른 출력을 낸다(옛 렌더러는 layout을 안 읽었다)', () => {
    const outs = EMAIL_SNS_LAYOUTS.map((l) => rsns({ layout: l }));
    expect(new Set(outs).size).toBe(EMAIL_SNS_LAYOUTS.length);
  });

  it('버튼(라벨 포함)에서만 핸들이 붙는다(편집기가 그 방식에서만 입력칸을 여는 것과 같은 조건)', () => {
    expect(rsns({ layout: 'buttons' })).toContain('@brand');
    expect(rsns({ layout: 'icons' })).not.toContain('@brand');
  });

  it('칩 면을 표 셀 bgcolor로 싣는다 — 아웃룩에서 배경이 사라져 글씨만 남던 자리', () => {
    for (const l of EMAIL_SNS_LAYOUTS) {
      expect(rsns({ layout: l }), `${l} 배경이 a 태그 인라인 단독`).toMatch(/<td bgcolor="[^"]+"/);
    }
  });

  it('a 태그에 background 인라인 단독으로 면을 내보내지 않는다', () => {
    expect(rsns({ layout: 'icons' })).not.toMatch(/<a [^>]*style="[^"]*background:/);
  });

  it('URL이 없는 채널은 버린다(회귀 0)', () => {
    expect(rsns({ channels: [{ type: 'instagram', url: '' }] })).not.toContain('Instagram');
  });

  it('아이콘 배치는 줄당 개수를 끊는다 — 표의 한 행은 줄바꿈되지 않아 채널이 늘면 폭을 넘는다', () => {
    const six = ['instagram', 'youtube', 'kakao', 'naver', 'facebook', 'twitter']
      .map((t, i) => ({ type: t, url: `https://example.com/ch${i}` }));
    const html = rsns({ layout: 'icons', channels: six });
    // 바깥 행의 시작(`<tr>` 바로 뒤 첫 칩 셀)만 세면 행 수가 나온다. 칩 안쪽에도 표가 있어 `<tr>` 총수로는 못 센다.
    const rowStarts = (html.match(/<tr><td style="padding:4px 4px"/g) || []).length;
    expect(rowStarts, '한 행에 다 몰면 본문 폭 600px를 넘는다').toBe(Math.ceil(six.length / EMAIL_SNS_CHIPS_PER_ROW));
    expect((html.match(/<td style="padding:4px 4px"/g) || []).length, '칩이 누락·중복되면 안 된다').toBe(six.length);
  });

  it('채널이 줄당 개수 이하면 한 행 그대로', () => {
    expect((rsns({ layout: 'icons' }).match(/<tr><td style="padding:4px 4px"/g) || []).length).toBe(1);
  });
});

// ──────────────── 푸터 수신거부 (임은지 접수 cmu3m2hey03nsjnludt2b1zv6) ────────────────
const rft = (props: Record<string, unknown>) => render('footer', props);

describe('푸터 수신거부 — 편집기가 아니라 발송 엔진이 소유한다', () => {
  it('렌더러는 수신거부 링크를 그리지 않는다(광고 footer 슬롯이 그 자리를 소유한다)', () => {
    const html = rft({ notes: '유의사항' });
    expect(html).toContain(EMAIL_FOOTER_SLOT);
    expect(html).not.toContain('/api/email/u/');
  });

  it('토글 값과 무관하게 렌더 출력이 같다 — 끌 수 있는 값이 아니라 편집기에서 감췄다', () => {
    expect(rft({ notes: '유의사항', show_unsubscribe_link: false }))
      .toBe(rft({ notes: '유의사항', show_unsubscribe_link: true }));
  });
});
